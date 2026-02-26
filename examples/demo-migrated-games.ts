import { Keypair, Transaction, type Commitment } from '@solana/web3.js';
import { readFileSync } from 'node:fs';
import { createSnapJsHostedMultiplayerClient, createSnapMultiplayerClient } from '../src/adapters/snapMultiplayerClient.js';
import type { SnapAuthoritySigner } from '../src/adapters/magicblock/types.js';

type TacticsState = { turn: number; hpByPlayer: Record<string, number> };
type TacticsAction =
  | { kind: 'END_TURN' }
  | { kind: 'ATTACK'; actor: string; target: string; damage: number };

type CardState = { round: number; pot: number; folded: string[] };
type CardAction =
  | { kind: 'BET'; actor: string; amount: number }
  | { kind: 'FOLD'; actor: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function text32(input: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(encoder.encode(input).slice(0, 32));
  return out;
}

function jsonEncode<T>(value: T): Uint8Array {
  return encoder.encode(JSON.stringify(value));
}

function jsonDecode<T>(bytes: Uint8Array): T {
  return JSON.parse(decoder.decode(bytes)) as T;
}

function keypairSignerFromFile(path: string): SnapAuthoritySigner {
  const arr = JSON.parse(readFileSync(path, 'utf8')) as number[];
  const keypair = Keypair.fromSecretKey(Uint8Array.from(arr));
  return {
    publicKey: keypair.publicKey,
    async signTransaction(tx: Transaction): Promise<Transaction> {
      tx.partialSign(keypair);
      return tx;
    },
  };
}

async function runTacticsDemo(base: {
  programId: string;
  signer: SnapAuthoritySigner;
  useMagicBlock: boolean;
  magicblockRpcUrl?: string;
  solanaRpcUrl?: string;
  commitment?: Commitment;
}) {
  const client = createSnapJsHostedMultiplayerClient<TacticsState, TacticsAction>({
    ...base,
    codec: {
      decodeState: jsonDecode<TacticsState>,
      encodeState: jsonEncode<TacticsState>,
      encodeActionType: (action) => (action.kind === 'END_TURN' ? 1 : 2),
    },
    plugin: {
      validateAction(state, action) {
        if (action.kind === 'ATTACK') {
          if (!action.actor || !action.target) throw new Error('ATTACK requires actor and target');
          if (!Number.isFinite(action.damage) || action.damage <= 0) throw new Error('damage must be > 0');
          if ((state.hpByPlayer[action.target] ?? 0) <= 0) throw new Error('target already eliminated');
        }
      },
      applyAction(state, action) {
        if (action.kind === 'END_TURN') return { ...state, turn: state.turn + 1 };
        return {
          ...state,
          hpByPlayer: {
            ...state.hpByPlayer,
            [action.target]: Math.max(0, Number(state.hpByPlayer[action.target] ?? 0) - action.damage),
          },
        };
      },
    },
  });

  const matchId = text32(`tactics-${Date.now()}`);
  await client.createMatch({
    matchId,
    gameId: text32('migrated-tactics'),
    minPlayers: 1,
    maxPlayers: 2,
    turnMode: 'ROUND_BASED',
    maxStateBytes: 2048,
    initialState: { turn: 1, hpByPlayer: { p1: 100, p2: 100 } },
  });

  await client.authority.startMatch(matchId);
  await client.submitAction({ matchId, action: { kind: 'ATTACK', actor: 'p1', target: 'p2', damage: 15 } });
  const state = await client.getMatch(matchId);
  console.log('[TACTICS] stateVersion=', state.stateVersion.toString(), 'actionCount=', state.actionCount.toString());
}

async function runCardDemo(base: {
  programId: string;
  signer: SnapAuthoritySigner;
  useMagicBlock: boolean;
  magicblockRpcUrl?: string;
  solanaRpcUrl?: string;
  commitment?: Commitment;
}) {
  const client = createSnapJsHostedMultiplayerClient<CardState, CardAction>({
    ...base,
    codec: {
      decodeState: jsonDecode<CardState>,
      encodeState: jsonEncode<CardState>,
      encodeActionType: (action) => (action.kind === 'BET' ? 11 : 12),
    },
    plugin: {
      validateAction(state, action) {
        if (action.kind === 'BET') {
          if (!Number.isFinite(action.amount) || action.amount <= 0) throw new Error('BET amount must be > 0');
          if (state.folded.includes(action.actor)) throw new Error('folded player cannot bet');
        }
      },
      applyAction(state, action) {
        if (action.kind === 'FOLD') {
          if (state.folded.includes(action.actor)) return state;
          return { ...state, folded: [...state.folded, action.actor] };
        }
        return { ...state, pot: state.pot + action.amount, round: state.round + 1 };
      },
    },
  });

  const matchId = text32(`card-${Date.now()}`);
  await client.createMatch({
    matchId,
    gameId: text32('migrated-card'),
    minPlayers: 1,
    maxPlayers: 4,
    turnMode: 'FREE_TURN',
    maxStateBytes: 2048,
    initialState: { round: 0, pot: 0, folded: [] },
  });

  await client.authority.startMatch(matchId);
  await client.submitAction({ matchId, action: { kind: 'BET', actor: 'p1', amount: 25 } });
  const state = await client.getMatch(matchId);
  console.log('[CARD] stateVersion=', state.stateVersion.toString(), 'actionCount=', state.actionCount.toString());
}

async function main() {
  const programId = process.env.SNAP_PROGRAM_ID?.trim();
  const keypairPath = process.env.SNAP_SIGNER_KEYPAIR?.trim();
  if (!programId || !keypairPath) {
    throw new Error('Set SNAP_PROGRAM_ID and SNAP_SIGNER_KEYPAIR env vars');
  }

  const signer = keypairSignerFromFile(keypairPath);
  const backend = (process.env.SNAP_AUTHORITY_BACKEND ?? 'magicblock').trim().toLowerCase();
  const base = {
    programId,
    signer,
    useMagicBlock: backend !== 'local',
    magicblockRpcUrl: process.env.MAGICBLOCK_RPC_URL,
    solanaRpcUrl: process.env.SOLANA_RPC_URL,
    commitment: (process.env.SNAP_COMMITMENT?.trim() as Commitment | undefined)
      ?? ((process.env.SOLANA_RPC_URL ?? '').includes('127.0.0.1') ? 'processed' : 'confirmed'),
  };

  // Fresh deployments need engine PDA initialization before match creation.
  const bootstrap = createSnapMultiplayerClient(base);
  try {
    await bootstrap.getEngine();
  } catch {
    await bootstrap.initializeEngine();
  }

  await runTacticsDemo(base);
  await runCardDemo(base);
  console.log('Done: migrated game demos submitted.');
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});

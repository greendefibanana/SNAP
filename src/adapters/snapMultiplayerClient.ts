import type { Commitment, PublicKey } from '@solana/web3.js';
import {
  createMagicBlockMultiplayerAuthorityClient,
  type MagicBlockMultiplayerAuthorityClient,
  type CreateMatchParams,
  type MultiplayerAuthorityMatchState,
  type SubmitActionParams,
} from './magicblock/multiplayerAuthorityClient.js';
import type { SnapAuthoritySigner } from './magicblock/types.js';
import type { SnapAuthorityTxResult } from './magicblock/types.js';

export interface SnapMultiplayerClientConfig {
  programId: string | PublicKey;
  signer: SnapAuthoritySigner;
  rpcUrl?: string;
  useMagicBlock?: boolean;
  magicblockRpcUrl?: string;
  solanaRpcUrl?: string;
  commitment?: Commitment;
}

export interface SnapJsHostedCodec<GameState, GameAction> {
  decodeState: (bytes: Uint8Array) => GameState;
  encodeState: (state: GameState) => Uint8Array;
  encodeActionType?: (action: GameAction) => number;
}

export interface SnapJsHostedPlugin<GameState, GameAction> {
  validateAction?: (state: GameState, action: GameAction) => void | Promise<void>;
  applyAction: (state: GameState, action: GameAction) => GameState | Promise<GameState>;
}

export interface SnapJsHostedClient<GameState, GameAction> {
  readonly authority: MagicBlockMultiplayerAuthorityClient;
  createMatch(params: Omit<CreateMatchParams, 'initialState' | 'pluginProgram' | 'pluginConfigHash'> & {
    initialState: GameState;
    vrfModule?: PublicKey | string | null;
  }): Promise<SnapAuthorityTxResult>;
  getMatch(matchId: Uint8Array): Promise<MultiplayerAuthorityMatchState>;
  submitAction(params: { matchId: Uint8Array; action: GameAction }): Promise<SnapAuthorityTxResult>;
}

/**
 * SNAP-first multiplayer client.
 * Game devs can use one API and ignore MagicBlock internals.
 */
export function createSnapMultiplayerClient(
  config: SnapMultiplayerClientConfig,
): MagicBlockMultiplayerAuthorityClient {
  const useMagicBlock = config.useMagicBlock ?? true;
  const backend = useMagicBlock ? 'magicblock' : 'local';
  return createMagicBlockMultiplayerAuthorityClient({
    backend,
    programId: config.programId,
    signer: config.signer,
    commitment: config.commitment,
    magicblockRpcUrl: config.magicblockRpcUrl,
    solanaRpcUrl: config.solanaRpcUrl ?? config.rpcUrl,
  });
}

function bytesKey(bytes: Uint8Array): string {
  return Array.from(bytes).map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function createSnapJsHostedMultiplayerClient<GameState, GameAction>(
  config: SnapMultiplayerClientConfig & {
    codec: SnapJsHostedCodec<GameState, GameAction>;
    plugin: SnapJsHostedPlugin<GameState, GameAction>;
  },
): SnapJsHostedClient<GameState, GameAction> {
  const authority = createSnapMultiplayerClient(config);
  const cache = new Map<string, { state: GameState; version: bigint }>();

  async function hydrate(matchId: Uint8Array): Promise<{ state: GameState; version: bigint; chain: MultiplayerAuthorityMatchState }> {
    const chain = await authority.getMatch(matchId);
    const state = config.codec.decodeState(chain.gameState);
    const entry = { state, version: chain.stateVersion };
    cache.set(bytesKey(matchId), entry);
    return { ...entry, chain };
  }

  async function submitComputed(
    matchId: Uint8Array,
    action: GameAction,
    expected: { state: GameState; version: bigint },
  ) {
    if (config.plugin.validateAction) {
      await config.plugin.validateAction(expected.state, action);
    }
    const nextState = await config.plugin.applyAction(expected.state, action);
    const nextStateBytes = config.codec.encodeState(nextState);
    const actionType = Math.max(0, Math.floor(Number(config.codec.encodeActionType?.(action) ?? 0)));
    const submitParams: SubmitActionParams = {
      matchId,
      actionType,
      payload: nextStateBytes,
      expectedStateVersion: expected.version,
    };
    const tx = await authority.submitAction(submitParams);
    cache.set(bytesKey(matchId), {
      state: nextState,
      version: expected.version + BigInt(1),
    });
    return tx;
  }

  return {
    authority,
    async createMatch(params) {
      const tx = await authority.createMatch({
        ...params,
        initialState: config.codec.encodeState(params.initialState),
        pluginProgram: null,
        pluginConfigHash: new Uint8Array(32),
      });
      cache.set(bytesKey(params.matchId), { state: params.initialState, version: BigInt(0) });
      return tx;
    },
    async getMatch(matchId) {
      const chain = await authority.getMatch(matchId);
      cache.set(bytesKey(matchId), {
        state: config.codec.decodeState(chain.gameState),
        version: chain.stateVersion,
      });
      return chain;
    },
    async submitAction({ matchId, action }) {
      const key = bytesKey(matchId);
      const cached = cache.get(key);
      try {
        if (!cached) {
          const hydrated = await hydrate(matchId);
          return await submitComputed(matchId, action, hydrated);
        }
        return await submitComputed(matchId, action, cached);
      } catch {
        // Fast-action loops can race state versions; refresh from chain and retry once.
        const hydrated = await hydrate(matchId);
        return submitComputed(matchId, action, hydrated);
      }
    },
  };
}

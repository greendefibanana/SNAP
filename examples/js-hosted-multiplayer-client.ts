import { createSnapJsHostedMultiplayerClient } from '../src/adapters/snapMultiplayerClient.js';
import type { SnapAuthoritySigner } from '../src/adapters/magicblock/types.js';

type DemoState = {
  tick: number;
  ammoByPlayer: Record<string, number>;
};

type DemoAction =
  | { kind: 'TICK' }
  | { kind: 'RELOAD'; actor: string; amount: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeState(state: DemoState): Uint8Array {
  return encoder.encode(JSON.stringify(state));
}

function decodeState(bytes: Uint8Array): DemoState {
  const text = decoder.decode(bytes);
  const parsed = JSON.parse(text) as DemoState;
  return {
    tick: Number(parsed.tick ?? 0),
    ammoByPlayer: { ...(parsed.ammoByPlayer ?? {}) },
  };
}

export function createDemoJsHostedClient(config: {
  programId: string;
  signer: SnapAuthoritySigner; // Delegated/session signer recommended for rapid gameplay loops.
  useMagicBlock?: boolean;
  magicblockRpcUrl?: string;
  solanaRpcUrl?: string;
}) {
  return createSnapJsHostedMultiplayerClient<DemoState, DemoAction>({
    ...config,
    codec: {
      decodeState,
      encodeState,
      encodeActionType: (action) => (action.kind === 'TICK' ? 1 : 2),
    },
    plugin: {
      validateAction(state, action) {
        if (action.kind === 'RELOAD') {
          if (!action.actor) throw new Error('RELOAD requires actor');
          if (!Number.isFinite(action.amount) || action.amount <= 0) {
            throw new Error('RELOAD amount must be > 0');
          }
          if (state.tick < 1) throw new Error('Cannot RELOAD before first tick');
        }
      },
      applyAction(state, action) {
        if (action.kind === 'TICK') {
          return { ...state, tick: state.tick + 1 };
        }
        return {
          ...state,
          ammoByPlayer: {
            ...state.ammoByPlayer,
            [action.actor]: Number(state.ammoByPlayer[action.actor] ?? 0) + action.amount,
          },
        };
      },
    },
  });
}


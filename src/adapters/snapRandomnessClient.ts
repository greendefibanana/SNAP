import { PublicKey } from '@solana/web3.js';
import {
  createMagicBlockVrfInstructionCodecFromIdl,
  createSnapVrfInstructionCodecFromIdl,
  type AnchorIdlLike,
} from './magicblock/vrfAnchorCodecs.js';
import { createMagicBlockVrfClientAdapter, MagicBlockVrfClientAdapter } from './magicblock/vrfClientAdapter.js';
import type {
  CardShuffleResult,
  MagicBlockVrfClientConfig,
  SnapVrfConsumeParams,
  SnapVrfFulfillParams,
  SnapVrfRequestHandle,
  SnapVrfRequestParams,
} from './magicblock/vrfTypes.js';
import type { SnapAuthorityTxResult } from './magicblock/types.js';

export type SnapRandomnessMode = 'managed_magicblock' | 'custom';
export type SnapManagedMagicBlockPreset = 'generic_v1';

export interface ManagedMagicBlockRandomnessConfig {
  mode: 'managed_magicblock';
  preset?: SnapManagedMagicBlockPreset;
  signer: MagicBlockVrfClientConfig['signer'];
  snapVrfProgramId: string;
  magicBlockVrfProgramId: string;
  solanaRpcUrl?: string;
  magicblockRpcUrl?: string;
  useMagicBlockForSnapTx?: boolean;
  snapVrfIdl?: AnchorIdlLike;
  magicBlockVrfIdl?: AnchorIdlLike;
}

export interface CustomRandomnessConfig {
  mode: 'custom';
  adapter: MagicBlockVrfClientAdapter;
}

export type SnapRandomnessClientConfig = ManagedMagicBlockRandomnessConfig | CustomRandomnessConfig;

export interface SnapRandomnessClient {
  readonly mode: SnapRandomnessMode;
  readonly adapter: MagicBlockVrfClientAdapter;
  request_randomness(params: SnapVrfRequestParams): Promise<SnapVrfRequestHandle>;
  consume_randomness(params: SnapVrfConsumeParams & { gameId: Uint8Array }): Promise<SnapAuthorityTxResult>;
  fulfill_randomness(params: SnapVrfFulfillParams): Promise<SnapAuthorityTxResult>;
  card_shuffle(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<CardShuffleResult>;
  drop_randomness(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle>;
  matchmaking_seed(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle>;
  generic_randomness(input: SnapVrfRequestParams): Promise<SnapVrfRequestHandle>;
}

class DefaultSnapRandomnessClient implements SnapRandomnessClient {
  readonly mode: SnapRandomnessMode;
  readonly adapter: MagicBlockVrfClientAdapter;

  constructor(mode: SnapRandomnessMode, adapter: MagicBlockVrfClientAdapter) {
    this.mode = mode;
    this.adapter = adapter;
  }

  request_randomness(params: SnapVrfRequestParams): Promise<SnapVrfRequestHandle> {
    return this.adapter.requestRandomness(params);
  }

  consume_randomness(params: SnapVrfConsumeParams & { gameId: Uint8Array }): Promise<SnapAuthorityTxResult> {
    return this.adapter.consumeRandomness(params);
  }

  fulfill_randomness(params: SnapVrfFulfillParams): Promise<SnapAuthorityTxResult> {
    return this.adapter.fulfillRandomness(params);
  }

  card_shuffle(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<CardShuffleResult> {
    return this.adapter.requestCardShuffle(input);
  }

  drop_randomness(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle> {
    return this.adapter.requestDropRandomness(input);
  }

  matchmaking_seed(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle> {
    return this.adapter.requestMatchmakingSeed(input);
  }

  generic_randomness(input: SnapVrfRequestParams): Promise<SnapVrfRequestHandle> {
    return this.adapter.requestGenericChance(input);
  }
}

const SNAP_VRF_IDL_MIN: AnchorIdlLike = {
  instructions: [
    {
      name: 'initialize_match',
      discriminator: [156, 133, 52, 179, 176, 29, 64, 124],
      accounts: [
        { name: 'payer', writable: true, signer: true },
        { name: 'engine', writable: false, signer: false },
        { name: 'match_state', writable: true, signer: false },
        { name: 'system_program', writable: false, signer: false },
      ],
      args: [
        { name: 'match_id', type: { array: ['u8', 32] } },
        { name: 'game_id', type: { array: ['u8', 32] } },
      ],
    },
    {
      name: 'request_randomness',
      discriminator: [213, 5, 173, 166, 37, 236, 31, 18],
      accounts: [
        { name: 'requester', writable: true, signer: true },
        { name: 'engine', writable: false, signer: false },
        { name: 'match_state', writable: true, signer: false },
        { name: 'request', writable: true, signer: false },
        { name: 'system_program', writable: false, signer: false },
      ],
      args: [
        { name: 'request_id', type: 'u64' },
        { name: 'randomness_type', type: { defined: 'RandomnessType' } },
        { name: 'namespace', type: { defined: 'RandomnessNamespace' } },
        { name: 'request_nonce', type: 'u64' },
        { name: 'metadata', type: { array: ['u8', 32] } },
      ],
    },
    {
      name: 'record_external_request_id',
      discriminator: [28, 165, 136, 120, 105, 147, 74, 17],
      accounts: [
        { name: 'admin', writable: false, signer: true },
        { name: 'engine', writable: false, signer: false },
        { name: 'request', writable: true, signer: false },
      ],
      args: [{ name: 'external_request_id', type: { array: ['u8', 32] } }],
    },
    {
      name: 'fulfill_randomness',
      discriminator: [235, 105, 140, 46, 40, 88, 117, 2],
      accounts: [
        { name: 'vrf_authority', writable: false, signer: true },
        { name: 'engine', writable: false, signer: false },
        { name: 'match_state', writable: true, signer: false },
        { name: 'request', writable: true, signer: false },
      ],
      args: [
        { name: 'vrf_seed', type: { array: ['u8', 32] } },
        { name: 'vrf_output', type: { array: ['u8', 32] } },
      ],
    },
    {
      name: 'consume_randomness',
      discriminator: [190, 217, 49, 162, 99, 26, 73, 234],
      accounts: [
        { name: 'consumer', writable: false, signer: true },
        { name: 'engine', writable: false, signer: false },
        { name: 'match_state', writable: false, signer: false },
        { name: 'request', writable: true, signer: false },
        { name: 'namespace_config', writable: false, signer: false },
      ],
      args: [],
    },
  ],
  types: [
    {
      name: 'RandomnessType',
      type: {
        kind: 'enum',
        variants: [
          { name: 'Drop' },
          { name: 'MatchSeed' },
          { name: 'Loot' },
          { name: 'Card' },
          { name: 'ArenaEvent' },
          { name: 'Generic' },
        ],
      },
    },
    {
      name: 'RandomnessNamespace',
      type: {
        kind: 'enum',
        variants: [
          { name: 'Drop' },
          { name: 'MatchRule' },
          { name: 'Loot' },
          { name: 'Card' },
          { name: 'ArenaEvent' },
        ],
      },
    },
  ],
};

const MAGICBLOCK_GENERIC_V1_IDL: AnchorIdlLike = {
  instructions: [
    {
      name: 'request_randomness',
      // Anchor discriminator for "global:request_randomness"
      discriminator: [213, 5, 173, 166, 37, 236, 31, 18],
      accounts: [
        { name: 'authority', writable: true, signer: true },
        { name: 'request', writable: true, signer: false },
      ],
      args: [
        { name: 'request_id', type: 'u64' },
        { name: 'request_nonce', type: 'u64' },
        { name: 'namespace', type: 'string' },
      ],
    },
  ],
};

function createManagedAdapter(config: ManagedMagicBlockRandomnessConfig): MagicBlockVrfClientAdapter {
  const preset = config.preset ?? 'generic_v1';
  if (preset !== 'generic_v1') throw new Error(`Unsupported managed preset: ${preset}`);

  const snapCodec = createSnapVrfInstructionCodecFromIdl({
    idl: config.snapVrfIdl ?? SNAP_VRF_IDL_MIN,
  });

  const magicBlockCodec = createMagicBlockVrfInstructionCodecFromIdl({
    idl: config.magicBlockVrfIdl ?? MAGICBLOCK_GENERIC_V1_IDL,
    instructionName: 'request_randomness',
    accountResolver: ({ signer, requestPda }) => ({
      authority: { pubkey: signer, isSigner: true, isWritable: true },
      request: { pubkey: requestPda, isSigner: false, isWritable: true },
    }),
    argResolver: ({ requestId, requestNonce, namespace }) => ({
      request_id: requestId,
      request_nonce: requestNonce,
      namespace,
    }),
    resolveExternalRequestId: ({ signature }) => {
      const out = new Uint8Array(32);
      const bytes = new TextEncoder().encode(signature.slice(0, 32));
      out.set(bytes.subarray(0, Math.min(32, bytes.length)));
      return out;
    },
  });

  return createMagicBlockVrfClientAdapter(
    {
      programId: new PublicKey(config.snapVrfProgramId),
      magicBlockVrfProgramId: new PublicKey(config.magicBlockVrfProgramId),
      signer: config.signer,
      solanaRpcUrl: config.solanaRpcUrl,
      magicblockRpcUrl: config.magicblockRpcUrl,
      useMagicBlockForSnapTx: config.useMagicBlockForSnapTx ?? true,
    },
    {
      snap: snapCodec,
      magicblock: magicBlockCodec,
    },
  );
}

export function createSnapRandomnessClient(config: SnapRandomnessClientConfig): SnapRandomnessClient {
  if (config.mode === 'custom') {
    return new DefaultSnapRandomnessClient('custom', config.adapter);
  }
  const adapter = createManagedAdapter(config);
  return new DefaultSnapRandomnessClient('managed_magicblock', adapter);
}


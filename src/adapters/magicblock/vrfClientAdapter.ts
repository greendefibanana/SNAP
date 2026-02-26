import { Connection, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { SnapAuthorityTxResult } from './types.js';
import type {
  CardShuffleResult,
  MagicBlockVrfClientConfig,
  MagicBlockVrfInstructionCodec,
  SnapVrfConsumeParams,
  SnapVrfFulfillParams,
  SnapVrfInstructionCodec,
  SnapVrfModuleTxResult,
  SnapVrfNamespace,
  SnapVrfNamespaceWeights,
  SnapVrfRequestHandle,
  SnapVrfRequestIds,
  SnapVrfRequestParams,
  SnapVrfRoutedOutcome,
} from './vrfTypes.js';

const DEFAULT_SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_MAGICBLOCK_RPC_URL = 'http://127.0.0.1:8899';
const ENGINE_SEED = asUtf8('engine');
const MATCH_SEED = asUtf8('match');
const REQUEST_SEED = asUtf8('request');
const NAMESPACE_SEED = asUtf8('namespace');
const BPS_DENOMINATOR = 10_000;

function asUtf8(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function ensure32(input: Uint8Array | undefined, fieldName: string): Uint8Array {
  const value = input ?? new Uint8Array(32);
  if (value.length !== 32) throw new Error(`${fieldName} must be exactly 32 bytes`);
  return value;
}

function u64ToLe(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function parseU64Le(bytes: Uint8Array): bigint {
  if (bytes.length < 8) throw new Error('Expected at least 8 bytes for u64');
  let out = 0n;
  for (let i = 0; i < 8; i++) out |= BigInt(bytes[i] ?? 0) << BigInt(8 * i);
  return out;
}

function namespaceLabel(ns: SnapVrfNamespace): Uint8Array {
  return asUtf8(ns);
}

function weightedChoice(weights: readonly number[], roll: bigint): number {
  const total = weights.reduce((acc, v) => acc + Math.max(0, Math.floor(v)), 0);
  if (total <= 0) throw new Error('weights must sum to > 0');
  let point = Number(roll % BigInt(total));
  for (let i = 0; i < weights.length; i++) {
    const weight = Math.max(0, Math.floor(weights[i] ?? 0));
    if (point < weight) return i;
    point -= weight;
  }
  return 0;
}

function mixSeed(seed32: Uint8Array, label: Uint8Array): Uint8Array {
  // Lightweight deterministic mixer for off-chain routing helpers.
  // Canonical truth remains on-chain in SNAP VRF engine events/accounts.
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const a = seed32[i] ?? 0;
    const b = label[i % label.length] ?? 0;
    out[i] = (a ^ b ^ ((i * 31) & 0xff)) & 0xff;
  }
  return out;
}

function xorshift64(seed: bigint): bigint {
  let x = seed & 0xffff_ffff_ffff_ffffn;
  x ^= x << 13n;
  x ^= x >> 7n;
  x ^= x << 17n;
  return x & 0xffff_ffff_ffff_ffffn;
}

export class MagicBlockVrfClientAdapter {
  private readonly snapProgramId: PublicKey;
  private readonly magicBlockVrfProgramId: PublicKey;
  private readonly signer: MagicBlockVrfClientConfig['signer'];
  private readonly solanaRpcUrl: string;
  private readonly magicblockRpcUrl: string;
  private readonly useMagicBlockForSnapTx: boolean;
  private readonly snapCodec: SnapVrfInstructionCodec;
  private readonly magicBlockCodec: MagicBlockVrfInstructionCodec;

  constructor(
    config: MagicBlockVrfClientConfig,
    codecs: {
      snap: SnapVrfInstructionCodec;
      magicblock: MagicBlockVrfInstructionCodec;
    },
  ) {
    this.snapProgramId = config.programId;
    this.magicBlockVrfProgramId = config.magicBlockVrfProgramId;
    this.signer = config.signer;
    this.solanaRpcUrl = (config.solanaRpcUrl ?? DEFAULT_SOLANA_RPC_URL).trim() || DEFAULT_SOLANA_RPC_URL;
    this.magicblockRpcUrl = (config.magicblockRpcUrl ?? DEFAULT_MAGICBLOCK_RPC_URL).trim() || DEFAULT_MAGICBLOCK_RPC_URL;
    this.useMagicBlockForSnapTx = Boolean(config.useMagicBlockForSnapTx ?? true);
    this.snapCodec = codecs.snap;
    this.magicBlockCodec = codecs.magicblock;
  }

  getSnapProgramId(): PublicKey {
    return this.snapProgramId;
  }

  deriveRequestIds(matchId: Uint8Array, requestId: bigint): SnapVrfRequestIds {
    if (matchId.length !== 32) throw new Error('matchId must be exactly 32 bytes');
    const [enginePda] = PublicKey.findProgramAddressSync([ENGINE_SEED], this.snapProgramId);
    const [matchPda] = PublicKey.findProgramAddressSync(
      [MATCH_SEED, enginePda.toBytes(), matchId],
      this.snapProgramId,
    );
    const [requestPda] = PublicKey.findProgramAddressSync(
      [REQUEST_SEED, matchPda.toBytes(), u64ToLe(requestId)],
      this.snapProgramId,
    );
    return { enginePda, matchPda, requestPda };
  }

  deriveNamespaceConfigPda(enginePda: PublicKey, gameId: Uint8Array, namespace: SnapVrfNamespace): PublicKey {
    if (gameId.length !== 32) throw new Error('gameId must be exactly 32 bytes');
    return PublicKey.findProgramAddressSync(
      [NAMESPACE_SEED, enginePda.toBytes(), gameId, namespaceLabel(namespace)],
      this.snapProgramId,
    )[0];
  }

  async requestRandomness(params: SnapVrfRequestParams): Promise<SnapVrfRequestHandle> {
    const metadata32 = ensure32(params.metadata32, 'metadata32');
    const ids = this.deriveRequestIds(params.matchId, params.requestId);

    const requestIx = this.snapCodec.buildRequestRandomnessIx({
      programId: this.snapProgramId,
      signer: this.signer.publicKey,
      enginePda: ids.enginePda,
      matchPda: ids.matchPda,
      requestPda: ids.requestPda,
      requestId: params.requestId,
      requestNonce: params.requestNonce,
      randomnessType: params.randomnessType,
      namespace: params.namespace,
      metadata32,
    });
    const requestTx = await this.sendTransaction([requestIx], this.useMagicBlockForSnapTx);

    const mbIx = this.magicBlockCodec.buildVrfRequestIx({
      magicBlockVrfProgramId: this.magicBlockVrfProgramId,
      signer: this.signer.publicKey,
      enginePda: ids.enginePda,
      matchPda: ids.matchPda,
      requestPda: ids.requestPda,
      namespace: params.namespace,
      requestId: params.requestId,
      requestNonce: params.requestNonce,
    });
    const mbTx = await this.sendTransaction([mbIx], true);

    const resolvedExternalId =
      this.magicBlockCodec.resolveExternalRequestId?.({
        signature: mbTx.signature,
        logs: mbTx.logs,
        requestPda: ids.requestPda,
        matchPda: ids.matchPda,
        requestId: params.requestId,
      }) ?? padTo32(u64ToLe(params.requestId));

    const recordIx = this.snapCodec.buildRecordExternalRequestIdIx({
      programId: this.snapProgramId,
      admin: this.signer.publicKey,
      enginePda: ids.enginePda,
      requestPda: ids.requestPda,
      externalRequestId32: resolvedExternalId,
    });
    const recordTx = await this.sendTransaction([recordIx], this.useMagicBlockForSnapTx);

    return {
      ...ids,
      requestSignature: requestTx.signature,
      magicBlockRequestSignature: mbTx.signature,
      recordExternalIdSignature: recordTx.signature,
      externalRequestId32: resolvedExternalId,
    };
  }

  async fulfillRandomness(params: SnapVrfFulfillParams): Promise<SnapAuthorityTxResult> {
    const ids = this.deriveRequestIds(params.matchId, params.requestId);
    const ix = this.snapCodec.buildFulfillRandomnessIx({
      programId: this.snapProgramId,
      vrfAuthority: this.signer.publicKey,
      enginePda: ids.enginePda,
      matchPda: ids.matchPda,
      requestPda: ids.requestPda,
      vrfSeed32: ensure32(params.vrfSeed32, 'vrfSeed32'),
      vrfOutput32: ensure32(params.vrfOutput32, 'vrfOutput32'),
    });
    const tx = await this.sendTransaction([ix], this.useMagicBlockForSnapTx);
    return tx;
  }

  async consumeRandomness(params: SnapVrfConsumeParams & { gameId: Uint8Array }): Promise<SnapAuthorityTxResult> {
    const ids = this.deriveRequestIds(params.matchId, params.requestId);
    const namespaceConfigPda = this.deriveNamespaceConfigPda(ids.enginePda, params.gameId, params.namespace);
    const ix = this.snapCodec.buildConsumeRandomnessIx({
      programId: this.snapProgramId,
      consumer: this.signer.publicKey,
      enginePda: ids.enginePda,
      matchPda: ids.matchPda,
      requestPda: ids.requestPda,
      namespaceConfigPda,
    });
    const tx = await this.sendTransaction([ix], this.useMagicBlockForSnapTx);
    return tx;
  }

  async requestCardShuffle(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<CardShuffleResult> {
    const request = await this.requestRandomness({
      ...input,
      randomnessType: 'CARD',
      namespace: 'CARD',
    });
    const deckSeed32 = this.deriveDeckSeedFromExternalId(request.externalRequestId32, input.matchId, input.requestId);
    return { ...request, deckSeed32 };
  }

  deterministicDeckOrder(deckSeed32: Uint8Array, deckSize: number): number[] {
    if (!Number.isInteger(deckSize) || deckSize <= 0) throw new Error('deckSize must be > 0');
    const deck = [...Array(deckSize).keys()];
    let state = parseU64Le(deckSeed32);
    for (let i = deckSize - 1; i > 0; i--) {
      state = xorshift64(state ^ BigInt(i));
      const j = Number(state % BigInt(i + 1));
      const tmp = deck[i]!;
      deck[i] = deck[j]!;
      deck[j] = tmp;
    }
    return deck;
  }

  routeRandomEvent(seed32: Uint8Array, namespace: SnapVrfNamespace, cfg: SnapVrfNamespaceWeights): SnapVrfRoutedOutcome {
    const tierSeed = mixSeed(seed32, concatBytes(namespaceLabel(namespace), asUtf8('TIER')));
    const weightedSeed = mixSeed(seed32, concatBytes(namespaceLabel(namespace), asUtf8('WEIGHTED')));
    const triggerSeed = mixSeed(seed32, concatBytes(namespaceLabel(namespace), asUtf8('TRIGGER')));
    const modifierSeed = mixSeed(seed32, concatBytes(namespaceLabel(namespace), asUtf8('MODIFIERS')));

    const tierIdx = weightedChoice(cfg.dropTierWeights, parseU64Le(tierSeed));
    const tier = (['COMMON', 'RARE', 'EPIC', 'LEGENDARY'] as const)[tierIdx] ?? 'COMMON';
    const weightedOutcomeIndex = weightedChoice(cfg.weightedOutcomeWeights, parseU64Le(weightedSeed));
    const eventTriggered = Number(parseU64Le(triggerSeed) % 10_000n) < clampBps(cfg.eventTriggerBps);

    let modifierMask = 0;
    for (let i = 0; i < cfg.modifierActivationBps.length; i++) {
      const stepSeed = mixSeed(modifierSeed, new Uint8Array([i]));
      const active = Number(parseU64Le(stepSeed) % 10_000n) < clampBps(cfg.modifierActivationBps[i] ?? 0);
      if (active) modifierMask |= 1 << i;
    }

    return { tier, weightedOutcomeIndex, eventTriggered, modifierMask };
  }

  async requestMatchmakingSeed(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle> {
    return this.requestRandomness({
      ...input,
      randomnessType: 'MATCH_SEED',
      namespace: 'MATCH_RULE',
    });
  }

  async requestDropRandomness(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle> {
    return this.requestRandomness({
      ...input,
      randomnessType: 'DROP',
      namespace: 'DROP',
    });
  }

  async requestLootRandomness(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle> {
    return this.requestRandomness({
      ...input,
      randomnessType: 'LOOT',
      namespace: 'LOOT',
    });
  }

  async requestArenaEventRandomness(input: Omit<SnapVrfRequestParams, 'randomnessType' | 'namespace'>): Promise<SnapVrfRequestHandle> {
    return this.requestRandomness({
      ...input,
      randomnessType: 'ARENA_EVENT',
      namespace: 'ARENA_EVENT',
    });
  }

  async requestGenericChance(input: SnapVrfRequestParams): Promise<SnapVrfRequestHandle> {
    return this.requestRandomness(input);
  }

  async requestFulfillAndConsume(
    request: SnapVrfRequestParams,
    fulfill?: SnapVrfFulfillParams,
  ): Promise<SnapVrfModuleTxResult> {
    const requested = await this.requestRandomness(request);
    if (!fulfill) return { request: requested };
    const fulfilled = await this.fulfillRandomness(fulfill);
    const consumed = await this.consumeRandomness({
      matchId: request.matchId,
      requestId: request.requestId,
      namespace: request.namespace,
      gameId: request.gameId,
    });
    return { request: requested, fulfill: fulfilled, consume: consumed };
  }

  private deriveDeckSeedFromExternalId(externalRequestId32: Uint8Array, matchId: Uint8Array, requestId: bigint): Uint8Array {
    const idLe = u64ToLe(requestId);
    return mixSeed(externalRequestId32, concatBytes(matchId, idLe));
  }

  private getConnection(useMagicBlock: boolean): Connection {
    const endpoint = useMagicBlock ? this.magicblockRpcUrl : this.solanaRpcUrl;
    return new Connection(endpoint, 'confirmed');
  }

  private async sendTransaction(
    instructions: readonly TransactionInstruction[],
    useMagicBlock: boolean,
  ): Promise<SnapAuthorityTxResult & { logs?: string[] }> {
    const connection = this.getConnection(useMagicBlock);
    const latest = await connection.getLatestBlockhash('confirmed');
    const tx = new Transaction({
      feePayer: this.signer.publicKey,
      recentBlockhash: latest.blockhash,
    });
    for (const ix of instructions) tx.add(ix);
    const signed = await this.signer.signTransaction(tx);
    const raw = signed.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    const result = await connection.confirmTransaction({ signature, ...latest }, 'confirmed');
    let logs: string[] | undefined;
    if (!result.value?.err) {
      const tx = await connection.getTransaction(signature, {
        commitment: 'confirmed',
        maxSupportedTransactionVersion: 0,
      });
      const logMessages = tx?.meta?.logMessages;
      if (logMessages && logMessages.length > 0) logs = [...logMessages];
    }
    return {
      backendUsed: useMagicBlock ? 'magicblock' : 'local',
      rpcUrl: connection.rpcEndpoint,
      signature,
      logs,
    };
  }
}

function padTo32(input: Uint8Array): Uint8Array {
  if (input.length === 32) return input;
  const out = new Uint8Array(32);
  out.set(input.subarray(0, 32));
  return out;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function clampBps(input: number): number {
  if (!Number.isFinite(input)) return 0;
  const rounded = Math.floor(input);
  if (rounded < 0) return 0;
  if (rounded > BPS_DENOMINATOR) return BPS_DENOMINATOR;
  return rounded;
}

export function createMagicBlockVrfClientAdapter(
  config: MagicBlockVrfClientConfig,
  codecs: {
    snap: SnapVrfInstructionCodec;
    magicblock: MagicBlockVrfInstructionCodec;
  },
): MagicBlockVrfClientAdapter {
  return new MagicBlockVrfClientAdapter(config, codecs);
}

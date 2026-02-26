import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { createHash } from "crypto";

// Namespace strings expected by the on-chain enum.
export type RandomnessNamespace = "DROP" | "MATCH_RULE" | "LOOT" | "CARD" | "ARENA_EVENT";

// Game-level config managed on-chain in NamespaceConfig.
export interface NamespaceWeights {
  dropTierWeights: [number, number, number, number];
  weightedOutcomeWeights: [number, number, number, number, number, number, number, number];
  eventTriggerBps: number;
  modifierActivationBps: [number, number, number, number, number, number, number, number];
}

export interface RoutedOutcome {
  tier: "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
  weightedOutcomeIndex: number;
  eventTriggered: boolean;
  modifierMask: number;
  derivedValueHex: string;
}

const PROGRAM_ID = new PublicKey("6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA");
const ENGINE_SEED = Buffer.from("engine");
const MATCH_SEED = Buffer.from("match");
const REQUEST_SEED = Buffer.from("request");
const NAMESPACE_SEED = Buffer.from("namespace");
const DOMAIN = Buffer.from("SNAP_VRF_ENGINE_V1");

export function namespaceLabel(ns: RandomnessNamespace): Buffer {
  return Buffer.from(ns);
}

function sha256(parts: Buffer[]): Buffer {
  const h = createHash("sha256");
  for (const p of parts) h.update(p);
  return h.digest();
}

export function deriveRandomValue(seed32: Buffer, namespace: RandomnessNamespace, label: Buffer): Buffer {
  return sha256([DOMAIN, seed32, namespaceLabel(namespace), label]);
}

function deriveWithRawNamespace(seed32: Buffer, namespaceLabelBytes: Buffer, label: Buffer): Buffer {
  return sha256([DOMAIN, seed32, namespaceLabelBytes, label]);
}

function u64LEFrom32(bytes32: Buffer): bigint {
  const b = bytes32.subarray(0, 8);
  return b.readBigUInt64LE(0);
}

function weightedChoice(weights: number[], roll: bigint): number {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error("weights must sum > 0");
  let point = Number(roll % BigInt(total));
  for (let i = 0; i < weights.length; i += 1) {
    if (point < weights[i]) return i;
    point -= weights[i];
  }
  throw new Error("weightedChoice unreachable");
}

export function routeOutcome(vrfOutput32: Buffer, ns: RandomnessNamespace, cfg: NamespaceWeights): RoutedOutcome {
  const tierSeed = deriveRandomValue(vrfOutput32, ns, Buffer.from("TIER"));
  const weightedSeed = deriveRandomValue(vrfOutput32, ns, Buffer.from("WEIGHTED"));
  const triggerSeed = deriveRandomValue(vrfOutput32, ns, Buffer.from("TRIGGER"));
  const modifierSeed = deriveRandomValue(vrfOutput32, ns, Buffer.from("MODIFIERS"));

  const tierIdx = weightedChoice(cfg.dropTierWeights, u64LEFrom32(tierSeed));
  const tier = (["COMMON", "RARE", "EPIC", "LEGENDARY"] as const)[tierIdx];
  const weightedOutcomeIndex = weightedChoice(cfg.weightedOutcomeWeights, u64LEFrom32(weightedSeed));
  const eventTriggered = Number(u64LEFrom32(triggerSeed) % 10_000n) < cfg.eventTriggerBps;

  let modifierMask = 0;
  for (let i = 0; i < cfg.modifierActivationBps.length; i += 1) {
    const stepSeed = deriveWithRawNamespace(modifierSeed, Buffer.from("MODIFIER_STEP"), Buffer.from([i]));
    const active = Number(u64LEFrom32(stepSeed) % 10_000n) < cfg.modifierActivationBps[i];
    if (active) modifierMask |= 1 << i;
  }

  const derivedValueHex = deriveRandomValue(vrfOutput32, ns, Buffer.from("OUTCOME")).toString("hex");
  return { tier, weightedOutcomeIndex, eventTriggered, modifierMask, derivedValueHex };
}

// Example adapter contract for any VRF provider integration layer.
export interface VrfProviderAdapter {
  requestRandomness(requestPda: PublicKey, seedMaterial: Buffer): Promise<Buffer>;
}

export interface RequestArgs {
  matchId: Buffer;
  gameId: Buffer;
  requestId: bigint;
  requestNonce: bigint;
  randomnessType: "DROP" | "MATCH_SEED" | "LOOT" | "CARD" | "ARENA_EVENT" | "GENERIC";
  namespace: RandomnessNamespace;
  metadata32?: Buffer;
}

// End-to-end orchestration sketch for backend relayers (Web2 or Web3 games).
export async function requestAndResolveRandomness(
  provider: anchor.AnchorProvider,
  program: anchor.Program,
  vrfAdapter: VrfProviderAdapter,
  args: RequestArgs
): Promise<{ requestPda: PublicKey; externalRequestId: Buffer }> {
  const [enginePda] = PublicKey.findProgramAddressSync([ENGINE_SEED], PROGRAM_ID);
  const [matchPda] = PublicKey.findProgramAddressSync(
    [MATCH_SEED, enginePda.toBuffer(), args.matchId],
    PROGRAM_ID
  );
  const reqLe = Buffer.alloc(8);
  reqLe.writeBigUInt64LE(args.requestId);
  const [requestPda] = PublicKey.findProgramAddressSync([REQUEST_SEED, matchPda.toBuffer(), reqLe], PROGRAM_ID);

  await program.methods
    .requestRandomness(
      new anchor.BN(args.requestId.toString()),
      mapRandomnessType(args.randomnessType),
      mapNamespace(args.namespace),
      new anchor.BN(args.requestNonce.toString()),
      (args.metadata32 ?? Buffer.alloc(32)) as any
    )
    .accounts({
      requester: provider.publicKey,
      engine: enginePda,
      matchState: matchPda,
      request: requestPda,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();

  // Integrate MagicBlock VRF here via your concrete adapter.
  // The adapter can call MagicBlock, then return provider-specific request id bytes.
  const externalRequestId = await vrfAdapter.requestRandomness(requestPda, Buffer.concat([args.matchId, reqLe]));

  await program.methods
    .recordExternalRequestId(externalRequestId as any)
    .accounts({
      admin: provider.publicKey,
      engine: enginePda,
      request: requestPda,
    })
    .rpc();

  return { requestPda, externalRequestId };
}

export class SnapRandomnessClient {
  constructor(
    private readonly provider: anchor.AnchorProvider,
    private readonly program: anchor.Program
  ) {}

  async request_randomness(args: RequestArgs): Promise<PublicKey> {
    const [enginePda] = PublicKey.findProgramAddressSync([ENGINE_SEED], PROGRAM_ID);
    const [matchPda] = PublicKey.findProgramAddressSync(
      [MATCH_SEED, enginePda.toBuffer(), args.matchId],
      PROGRAM_ID
    );
    const reqLe = Buffer.alloc(8);
    reqLe.writeBigUInt64LE(args.requestId);
    const [requestPda] = PublicKey.findProgramAddressSync([REQUEST_SEED, matchPda.toBuffer(), reqLe], PROGRAM_ID);

    await this.program.methods
      .requestRandomness(
        new anchor.BN(args.requestId.toString()),
        mapRandomnessType(args.randomnessType),
        mapNamespace(args.namespace),
        new anchor.BN(args.requestNonce.toString()),
        (args.metadata32 ?? Buffer.alloc(32)) as any
      )
      .accounts({
        requester: this.provider.publicKey,
        engine: enginePda,
        matchState: matchPda,
        request: requestPda,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    return requestPda;
  }

  async consume_randomness(matchId: Buffer, requestId: bigint, namespace: RandomnessNamespace): Promise<void> {
    const [enginePda] = PublicKey.findProgramAddressSync([ENGINE_SEED], PROGRAM_ID);
    const [matchPda] = PublicKey.findProgramAddressSync([MATCH_SEED, enginePda.toBuffer(), matchId], PROGRAM_ID);
    const reqLe = Buffer.alloc(8);
    reqLe.writeBigUInt64LE(requestId);
    const [requestPda] = PublicKey.findProgramAddressSync([REQUEST_SEED, matchPda.toBuffer(), reqLe], PROGRAM_ID);

    const matchAccount = (await this.program.account.matchRandomness.fetch(matchPda)) as any;
    const [namespaceConfigPda] = PublicKey.findProgramAddressSync(
      [NAMESPACE_SEED, enginePda.toBuffer(), Buffer.from(matchAccount.gameId), namespaceLabel(namespace)],
      PROGRAM_ID
    );

    await this.program.methods
      .consumeRandomness()
      .accounts({
        consumer: this.provider.publicKey,
        engine: enginePda,
        matchState: matchPda,
        request: requestPda,
        namespaceConfig: namespaceConfigPda,
      })
      .rpc();
  }

  derive_random_value(seed32: Buffer, namespace: RandomnessNamespace): Buffer {
    return deriveRandomValue(seed32, namespace, Buffer.alloc(32));
  }
}

function mapNamespace(namespace: RandomnessNamespace): any {
  if (namespace === "DROP") return { drop: {} };
  if (namespace === "MATCH_RULE") return { matchRule: {} };
  if (namespace === "LOOT") return { loot: {} };
  if (namespace === "CARD") return { card: {} };
  return { arenaEvent: {} };
}

function mapRandomnessType(kind: RequestArgs["randomnessType"]): any {
  if (kind === "DROP") return { drop: {} };
  if (kind === "MATCH_SEED") return { matchSeed: {} };
  if (kind === "LOOT") return { loot: {} };
  if (kind === "CARD") return { card: {} };
  if (kind === "ARENA_EVENT") return { arenaEvent: {} };
  return { generic: {} };
}

// Web2 service pattern:
// 1) game server asks this module for request id + namespace
// 2) relayer executes requestAndResolveRandomness
// 3) VRF callback service calls fulfill_randomness with trusted authority key
// 4) game server calls consume_randomness then uses emitted outcomes

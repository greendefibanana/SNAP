import type { PublicKey, TransactionInstruction } from '@solana/web3.js';
import type { SnapAuthoritySigner, SnapAuthorityTxResult } from './types.js';

export type SnapVrfNamespace = 'DROP' | 'MATCH_RULE' | 'LOOT' | 'CARD' | 'ARENA_EVENT';
export type SnapVrfRandomnessType = 'DROP' | 'MATCH_SEED' | 'LOOT' | 'CARD' | 'ARENA_EVENT' | 'GENERIC';

export interface SnapVrfRequestIds {
  enginePda: PublicKey;
  matchPda: PublicKey;
  requestPda: PublicKey;
}

export interface SnapVrfRequestParams {
  matchId: Uint8Array;
  gameId: Uint8Array;
  requestId: bigint;
  requestNonce: bigint;
  randomnessType: SnapVrfRandomnessType;
  namespace: SnapVrfNamespace;
  metadata32?: Uint8Array;
}

export interface SnapVrfFulfillParams {
  matchId: Uint8Array;
  requestId: bigint;
  vrfSeed32: Uint8Array;
  vrfOutput32: Uint8Array;
}

export interface SnapVrfConsumeParams {
  matchId: Uint8Array;
  requestId: bigint;
  namespace: SnapVrfNamespace;
}

export interface SnapVrfNamespaceWeights {
  dropTierWeights: [number, number, number, number];
  weightedOutcomeWeights: [number, number, number, number, number, number, number, number];
  eventTriggerBps: number;
  modifierActivationBps: [number, number, number, number, number, number, number, number];
}

export interface SnapVrfRoutedOutcome {
  tier: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
  weightedOutcomeIndex: number;
  eventTriggered: boolean;
  modifierMask: number;
}

export interface MagicBlockVrfClientConfig {
  programId: PublicKey;
  magicBlockVrfProgramId: PublicKey;
  signer: SnapAuthoritySigner;
  solanaRpcUrl?: string;
  magicblockRpcUrl?: string;
  useMagicBlockForSnapTx?: boolean;
}

export interface SnapVrfInstructionCodec {
  buildInitializeMatchIx?(input: {
    programId: PublicKey;
    signer: PublicKey;
    enginePda: PublicKey;
    matchPda: PublicKey;
    matchId: Uint8Array;
    gameId: Uint8Array;
  }): TransactionInstruction;

  buildRequestRandomnessIx(input: {
    programId: PublicKey;
    signer: PublicKey;
    enginePda: PublicKey;
    matchPda: PublicKey;
    requestPda: PublicKey;
    requestId: bigint;
    requestNonce: bigint;
    randomnessType: SnapVrfRandomnessType;
    namespace: SnapVrfNamespace;
    metadata32: Uint8Array;
  }): TransactionInstruction;

  buildRecordExternalRequestIdIx(input: {
    programId: PublicKey;
    admin: PublicKey;
    enginePda: PublicKey;
    requestPda: PublicKey;
    externalRequestId32: Uint8Array;
  }): TransactionInstruction;

  buildFulfillRandomnessIx(input: {
    programId: PublicKey;
    vrfAuthority: PublicKey;
    enginePda: PublicKey;
    matchPda: PublicKey;
    requestPda: PublicKey;
    vrfSeed32: Uint8Array;
    vrfOutput32: Uint8Array;
  }): TransactionInstruction;

  buildConsumeRandomnessIx(input: {
    programId: PublicKey;
    consumer: PublicKey;
    enginePda: PublicKey;
    matchPda: PublicKey;
    requestPda: PublicKey;
    namespaceConfigPda: PublicKey;
  }): TransactionInstruction;
}

export interface MagicBlockVrfInstructionCodec {
  buildVrfRequestIx(input: {
    magicBlockVrfProgramId: PublicKey;
    signer: PublicKey;
    enginePda: PublicKey;
    matchPda: PublicKey;
    requestPda: PublicKey;
    namespace: SnapVrfNamespace;
    requestId: bigint;
    requestNonce: bigint;
  }): TransactionInstruction;

  resolveExternalRequestId?(input: {
    signature: string;
    logs?: string[];
    requestPda: PublicKey;
    matchPda: PublicKey;
    requestId: bigint;
  }): Uint8Array | null;
}

export interface SnapVrfRequestHandle extends SnapVrfRequestIds {
  requestSignature: string;
  magicBlockRequestSignature: string;
  recordExternalIdSignature: string;
  externalRequestId32: Uint8Array;
}

export interface SnapVrfModuleTxResult {
  request: SnapVrfRequestHandle;
  fulfill?: SnapAuthorityTxResult;
  consume?: SnapAuthorityTxResult;
}

export interface CardShuffleResult extends SnapVrfRequestHandle {
  deckSeed32: Uint8Array;
}


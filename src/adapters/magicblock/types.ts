import type { PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import type { SnapAction, SnapState } from '../../engine/types.js';

export type SnapAuthorityBackend = 'local' | 'magicblock';

export interface SnapAuthorityRpcConfig {
    backend: SnapAuthorityBackend;
    magicblockRpcUrl?: string;
    solanaRpcUrl?: string;
}

export interface SnapSendTransactionOptions {
    delegated?: boolean;
    skipPreflight?: boolean;
    maxRetries?: number;
    minContextSlot?: number;
    preflightCommitment?: 'processed' | 'confirmed' | 'finalized';
}

export interface SnapAuthorityTxResult {
    backendUsed: SnapAuthorityBackend;
    rpcUrl: string;
    signature: string;
}

export interface SnapAuthoritySigner {
    publicKey: PublicKey;
    signTransaction: (transaction: Transaction) => Promise<Transaction>;
}

export interface SnapAuthorityBridgeConfig extends SnapAuthorityRpcConfig {
    programId: string;
    signer: SnapAuthoritySigner;
    matchSeedHex?: string;
    pollHz?: number;
}

export type TokenizationBackendHint = 'any' | 'solana' | 'magicblock';

export interface TokenizationChainHint {
    backend?: TokenizationBackendHint;
    useEphemeralRollup?: boolean;
    priorityFeeLamports?: number;
    programId?: string;
    collectionAddress?: string;
    mintAddress?: string;
}

export interface TokenizationInstructionBuildContext {
    action: SnapAction;
    chainHint: TokenizationChainHint;
    tokenizationProgramId: PublicKey;
}

export type TokenizationInstructionBuilder = (
    ctx: TokenizationInstructionBuildContext,
) => TransactionInstruction[] | Promise<TransactionInstruction[]>;

export interface MagicBlockTokenizationClientConfig extends SnapAuthorityRpcConfig {
    signer: SnapAuthoritySigner;
    tokenizationProgramId?: string;
    instructionMode?: 'memo' | 'spl';
    splTokenProgramId?: string;
    associatedTokenProgramId?: string;
    nftMetadataMode?: 'none' | 'metaplex';
    metaplexTokenMetadataProgramId?: string;
    defaultChainHint?: TokenizationChainHint;
    instructionBuilder?: TokenizationInstructionBuilder;
    maxMemoBytes?: number;
    commitment?: 'processed' | 'confirmed' | 'finalized';
}

export interface SnapAuthorityChainState {
    eventSeq: number;
    signal: {
        blue: number;
        red: number;
    };
    zone: {
        index: number;
        phase: 'COUNTDOWN' | 'ACTIVE';
        remainingSec: number;
    };
    activeDropBuff: {
        blue: number;
        red: number;
    };
    dropInfo: {
        lastDropId: number;
        blueEndsAt: number;
        redEndsAt: number;
    };
    selectedLoadoutSlot: number;
    stateHashHex: string;
    ended: boolean;
}

/**
 * @deprecated Use `SnapClient` from `../snapClient.js` instead.
 */
export interface SnapAuthorityBridge {
    dispatch(action: SnapAction): Promise<void>;
    getState(): Promise<SnapState>;
    subscribe(callback: (state: SnapState) => void): () => void;
}

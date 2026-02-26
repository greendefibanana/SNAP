import {
  Connection,
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import type { SnapAction } from '../../engine/types.js';
import type {
  MagicBlockTokenizationClientConfig,
  SnapAuthorityBackend,
  SnapAuthorityTxResult,
  TokenizationChainHint,
  TokenizationInstructionBuilder,
} from './types.js';

const DEFAULT_SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_MAGICBLOCK_RPC_URL = 'http://127.0.0.1:8899';
const DEFAULT_MEMO_PROGRAM_ID = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
const DEFAULT_SPL_TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const DEFAULT_ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const DEFAULT_METAPLEX_TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s');
const UTF8 = new TextEncoder();
const SPL_MINT_ACCOUNT_BYTES = 82;
const BIG_ZERO = BigInt(0);
const BIG_ONE = BigInt(1);
const BIG_255 = BigInt(255);
const BIG_EIGHT = BigInt(8);
const METAPLEX_CREATE_METADATA_V3_DISCRIMINATOR = 33;
const TOKENIZATION_ACTIONS = new Set([
  'TOKEN_CLASS_DEFINE',
  'TOKEN_MINT',
  'TOKEN_TRANSFER',
  'TOKEN_BURN',
  'TOKEN_METADATA_SET',
]);

interface KnownTokenClassChain {
  classId: string;
  hint: TokenizationChainHint;
  mintAddress?: string;
  tokenType?: 'FT' | 'NFT';
  decimals?: number;
}

function isTokenizationAction(action: SnapAction): boolean {
  return TOKENIZATION_ACTIONS.has(action.kind);
}

function toStringValue(input: unknown, fallback = ''): string {
  const s = String(input ?? '').trim();
  return s.length > 0 ? s : fallback;
}

function extractChainHint(action: SnapAction): TokenizationChainHint {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const chainRaw = (payload.chain ?? {}) as Record<string, unknown>;
  const backend = chainRaw.backend === 'solana' || chainRaw.backend === 'magicblock' || chainRaw.backend === 'any'
    ? chainRaw.backend
    : undefined;
  const useEphemeralRollup = typeof chainRaw.useEphemeralRollup === 'boolean'
    ? chainRaw.useEphemeralRollup
    : undefined;
  const priorityFeeLamports = Number(chainRaw.priorityFeeLamports);
  const programId = toStringValue(chainRaw.programId);
  const collectionAddress = toStringValue(chainRaw.collectionAddress);
  const mintAddress = toStringValue(chainRaw.mintAddress);
  return {
    ...(backend ? { backend } : {}),
    ...(useEphemeralRollup !== undefined ? { useEphemeralRollup } : {}),
    ...(Number.isFinite(priorityFeeLamports) && priorityFeeLamports >= 0 ? { priorityFeeLamports } : {}),
    ...(programId ? { programId } : {}),
    ...(collectionAddress ? { collectionAddress } : {}),
    ...(mintAddress ? { mintAddress } : {}),
  };
}

function mergeHints(base: TokenizationChainHint, override: TokenizationChainHint): TokenizationChainHint {
  return {
    ...(base.backend ? { backend: base.backend } : {}),
    ...(base.useEphemeralRollup !== undefined ? { useEphemeralRollup: base.useEphemeralRollup } : {}),
    ...(base.priorityFeeLamports !== undefined ? { priorityFeeLamports: base.priorityFeeLamports } : {}),
    ...(base.programId ? { programId: base.programId } : {}),
    ...(base.collectionAddress ? { collectionAddress: base.collectionAddress } : {}),
    ...(base.mintAddress ? { mintAddress: base.mintAddress } : {}),
    ...(override.backend ? { backend: override.backend } : {}),
    ...(override.useEphemeralRollup !== undefined ? { useEphemeralRollup: override.useEphemeralRollup } : {}),
    ...(override.priorityFeeLamports !== undefined ? { priorityFeeLamports: override.priorityFeeLamports } : {}),
    ...(override.programId ? { programId: override.programId } : {}),
    ...(override.collectionAddress ? { collectionAddress: override.collectionAddress } : {}),
    ...(override.mintAddress ? { mintAddress: override.mintAddress } : {}),
  };
}

function backendFromHint(hint: TokenizationChainHint, configuredBackend: SnapAuthorityBackend): SnapAuthorityBackend {
  if (hint.backend === 'magicblock') return 'magicblock';
  if (hint.backend === 'solana') return 'local';
  if (hint.useEphemeralRollup) return 'magicblock';
  return configuredBackend;
}

function getClassId(action: SnapAction): string {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  return toStringValue(payload.classId);
}

function defaultMemoInstructionBuilder(maxMemoBytes: number): TokenizationInstructionBuilder {
  return ({ action, chainHint, tokenizationProgramId }) => {
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    const encoded = {
      kind: action.kind,
      matchId: action.matchId,
      actor: action.actor,
      t: action.t,
      payload,
      chainHint,
      tokenizationProgramId: tokenizationProgramId.toBase58(),
    };
    let memo = JSON.stringify(encoded);
    if (UTF8.encode(memo).length > maxMemoBytes) {
      memo = JSON.stringify({
        kind: action.kind,
        matchId: action.matchId,
        actor: action.actor,
        classId: toStringValue(payload.classId),
        t: action.t,
      });
      if (UTF8.encode(memo).length > maxMemoBytes) {
        throw new Error(`Tokenization memo payload exceeds maxMemoBytes=${maxMemoBytes}`);
      }
    }
    return [
      new TransactionInstruction({
        programId: DEFAULT_MEMO_PROGRAM_ID,
        keys: [],
        data: UTF8.encode(memo) as any,
      }),
    ];
  };
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function u64LE(value: number | bigint, field: string): Uint8Array {
  const n = typeof value === 'bigint' ? value : BigInt(Math.floor(Number(value)));
  if (n < BIG_ZERO) throw new Error(`${field} must be >= 0`);
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & BIG_255);
    v >>= BIG_EIGHT;
  }
  if (v !== BIG_ZERO) throw new Error(`${field} exceeds u64`);
  return out;
}

function deriveSeed(matchId: string, classId: string): string {
  const base = `${matchId}|${classId}`;
  const h1 = fnv1a32(base).toString(16).padStart(8, '0');
  const h2 = fnv1a32(`${base}#2`).toString(16).padStart(8, '0');
  return `snaptok${h1}${h2}`;
}

function toInteger(input: unknown, fallback: number): number {
  const n = Math.floor(Number(input));
  return Number.isFinite(n) ? n : fallback;
}

function resolveTokenType(raw: unknown): 'FT' | 'NFT' {
  return toStringValue(raw, 'NFT').toUpperCase() === 'FT' ? 'FT' : 'NFT';
}

function resolveAmount(action: SnapAction, tokenType: 'FT' | 'NFT'): bigint {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  if (tokenType === 'NFT') return BIG_ONE;
  const n = Number(payload.amount ?? 0);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) {
    throw new Error(`Action '${action.kind}' requires integer payload.amount > 0 for SPL execution`);
  }
  return BigInt(n);
}

function initMintInstruction(
  mint: PublicKey,
  mintAuthority: PublicKey,
  freezeAuthority: PublicKey | null,
  decimals: number,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  const data = new Uint8Array(1 + 1 + 32 + 4 + 32);
  let o = 0;
  data[o++] = 0; // InitializeMint
  data[o++] = decimals & 0xff;
  data.set(mintAuthority.toBytes(), o); o += 32;
  if (freezeAuthority) {
    data[o++] = 1; data[o++] = 0; data[o++] = 0; data[o++] = 0;
    data.set(freezeAuthority.toBytes(), o);
  } else {
    data[o++] = 0; data[o++] = 0; data[o++] = 0; data[o++] = 0;
  }
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: data as any,
  });
}

function mintToInstruction(
  mint: PublicKey,
  destinationAta: PublicKey,
  authority: PublicKey,
  amount: bigint,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  const data = new Uint8Array(1 + 8);
  data[0] = 7; // MintTo
  data.set(u64LE(amount, 'amount'), 1);
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: false },
    ],
    data: data as any,
  });
}

function transferInstruction(
  sourceAta: PublicKey,
  destinationAta: PublicKey,
  owner: PublicKey,
  amount: bigint,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  const data = new Uint8Array(1 + 8);
  data[0] = 3; // Transfer
  data.set(u64LE(amount, 'amount'), 1);
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: destinationAta, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: data as any,
  });
}

function burnInstruction(
  sourceAta: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
  tokenProgramId: PublicKey,
): TransactionInstruction {
  const data = new Uint8Array(1 + 8);
  data[0] = 8; // Burn
  data.set(u64LE(amount, 'amount'), 1);
  return new TransactionInstruction({
    programId: tokenProgramId,
    keys: [
      { pubkey: sourceAta, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: data as any,
  });
}

function deriveAta(owner: PublicKey, mint: PublicKey, tokenProgramId: PublicKey, associatedTokenProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBytes(), tokenProgramId.toBytes(), mint.toBytes()],
    associatedTokenProgramId,
  )[0];
}

function createAssociatedTokenIdempotentInstruction(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
  tokenProgramId: PublicKey,
  associatedTokenProgramId: PublicKey,
): TransactionInstruction {
  const ata = deriveAta(owner, mint, tokenProgramId, associatedTokenProgramId);
  return new TransactionInstruction({
    programId: associatedTokenProgramId,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: tokenProgramId, isSigner: false, isWritable: false },
    ],
    data: Uint8Array.of(1) as any, // CreateIdempotent
  });
}

function u16LE(value: number, field: string): Uint8Array {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 65535) throw new Error(`${field} must be uint16`);
  return Uint8Array.of(n & 0xff, (n >> 8) & 0xff);
}

function u32LE(value: number, field: string): Uint8Array {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 4294967295) throw new Error(`${field} must be uint32`);
  return Uint8Array.of(
    n & 0xff,
    (n >>> 8) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 24) & 0xff,
  );
}

function utf8StringField(value: string): Uint8Array {
  const bytes = UTF8.encode(value);
  const out = new Uint8Array(4 + bytes.length);
  out.set(u32LE(bytes.length, 'string length'), 0);
  out.set(bytes, 4);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function deriveMetadataPda(mint: PublicKey, metadataProgramId: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [UTF8.encode('metadata'), metadataProgramId.toBytes(), mint.toBytes()],
    metadataProgramId,
  )[0];
}

function buildCreateMetadataV3Data(input: {
  name: string;
  symbol: string;
  uri: string;
  sellerFeeBasisPoints: number;
  isMutable: boolean;
}): Uint8Array {
  // mpl-token-metadata CreateMetadataAccountV3 with minimal optional fields (all None).
  return concatBytes([
    Uint8Array.of(METAPLEX_CREATE_METADATA_V3_DISCRIMINATOR),
    utf8StringField(input.name),
    utf8StringField(input.symbol),
    utf8StringField(input.uri),
    u16LE(input.sellerFeeBasisPoints, 'sellerFeeBasisPoints'),
    Uint8Array.of(0), // creators: Option::None
    Uint8Array.of(0), // collection: Option::None
    Uint8Array.of(0), // uses: Option::None
    Uint8Array.of(input.isMutable ? 1 : 0),
    Uint8Array.of(0), // collectionDetails: Option::None
  ]);
}

function withPayload(action: SnapAction, patch: Record<string, unknown>): SnapAction {
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  return {
    ...action,
    payload: {
      ...payload,
      ...patch,
    },
  };
}

export interface MagicBlockTokenizationClientAdapter {
  dispatch(action: SnapAction): Promise<SnapAuthorityTxResult | null>;
  dispatchAndAttachTxRef(action: SnapAction): Promise<SnapAction>;
  getRpcUrlForAction(action: SnapAction): string;
}

export class DefaultMagicBlockTokenizationClientAdapter implements MagicBlockTokenizationClientAdapter {
  private readonly backend: SnapAuthorityBackend;
  private readonly signer: MagicBlockTokenizationClientConfig['signer'];
  private readonly magicblockRpcUrl: string;
  private readonly solanaRpcUrl: string;
  private readonly commitment: 'processed' | 'confirmed' | 'finalized';
  private readonly instructionMode: 'memo' | 'spl';
  private readonly hasCustomInstructionBuilder: boolean;
  private readonly nftMetadataMode: 'none' | 'metaplex';
  private readonly instructionBuilder: TokenizationInstructionBuilder;
  private readonly classHints = new Map<string, KnownTokenClassChain>();
  private readonly defaultHint: TokenizationChainHint;
  private readonly tokenizationProgramId: PublicKey;
  private readonly splTokenProgramId: PublicKey;
  private readonly associatedTokenProgramId: PublicKey;
  private readonly metaplexTokenMetadataProgramId: PublicKey;

  constructor(config: MagicBlockTokenizationClientConfig) {
    this.backend = config.backend;
    this.signer = config.signer;
    this.magicblockRpcUrl = (config.magicblockRpcUrl ?? DEFAULT_MAGICBLOCK_RPC_URL).trim() || DEFAULT_MAGICBLOCK_RPC_URL;
    this.solanaRpcUrl = (config.solanaRpcUrl ?? DEFAULT_SOLANA_RPC_URL).trim() || DEFAULT_SOLANA_RPC_URL;
    this.commitment = config.commitment ?? 'confirmed';
    this.defaultHint = config.defaultChainHint ?? {};
    this.instructionMode = config.instructionMode ?? 'spl';
    this.hasCustomInstructionBuilder = Boolean(config.instructionBuilder);
    this.nftMetadataMode = config.nftMetadataMode ?? 'none';
    this.tokenizationProgramId = new PublicKey(
      config.tokenizationProgramId
      ?? this.defaultHint.programId
      ?? DEFAULT_MEMO_PROGRAM_ID.toBase58(),
    );
    this.splTokenProgramId = new PublicKey(config.splTokenProgramId ?? DEFAULT_SPL_TOKEN_PROGRAM_ID.toBase58());
    this.associatedTokenProgramId = new PublicKey(
      config.associatedTokenProgramId ?? DEFAULT_ASSOCIATED_TOKEN_PROGRAM_ID.toBase58(),
    );
    this.metaplexTokenMetadataProgramId = new PublicKey(
      config.metaplexTokenMetadataProgramId ?? DEFAULT_METAPLEX_TOKEN_METADATA_PROGRAM_ID.toBase58(),
    );
    this.instructionBuilder = config.instructionBuilder ?? defaultMemoInstructionBuilder(
      Math.max(64, Math.floor(config.maxMemoBytes ?? 1100)),
    );
  }

  private resolveHint(action: SnapAction): TokenizationChainHint {
    const inlineHint = extractChainHint(action);
    const classId = getClassId(action);
    const classHint = classId ? this.classHints.get(classId)?.hint ?? {} : {};
    return mergeHints(mergeHints(this.defaultHint, classHint), inlineHint);
  }

  private getConnectionForBackend(backend: SnapAuthorityBackend): Connection {
    const rpcUrl = backend === 'magicblock' ? this.magicblockRpcUrl : this.solanaRpcUrl;
    return new Connection(rpcUrl, this.commitment);
  }

  private async sendInstructions(
    backend: SnapAuthorityBackend,
    instructions: readonly TransactionInstruction[],
  ): Promise<SnapAuthorityTxResult> {
    const connection = this.getConnectionForBackend(backend);
    const latest = await connection.getLatestBlockhash(this.commitment);
    const tx = new Transaction({
      feePayer: this.signer.publicKey,
      recentBlockhash: latest.blockhash,
    });
    for (const ix of instructions) tx.add(ix);
    const signed = await this.signer.signTransaction(tx);
    const raw = signed.serialize();
    const signature = await connection.sendRawTransaction(raw, { skipPreflight: false });
    await connection.confirmTransaction({ signature, ...latest }, this.commitment);
    return {
      backendUsed: backend,
      rpcUrl: connection.rpcEndpoint,
      signature,
    };
  }

  private async mintAddressForClass(action: SnapAction): Promise<string> {
    const classId = getClassId(action);
    if (!classId) throw new Error('Missing classId');
    const seed = deriveSeed(action.matchId, classId);
    const mint = await PublicKey.createWithSeed(this.signer.publicKey, seed, this.splTokenProgramId);
    return mint.toBase58();
  }

  private resolveMintAddress(action: SnapAction): string {
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    const explicit = toStringValue(payload.mintAddress);
    if (explicit) return explicit;
    const chain = (payload.chain ?? {}) as Record<string, unknown>;
    const inChain = toStringValue(chain.mintAddress);
    if (inChain) return inChain;
    const classId = getClassId(action);
    if (!classId) return '';
    return toStringValue(this.classHints.get(classId)?.mintAddress);
  }

  private async buildNativeSplInstructions(
    action: SnapAction,
    connection: Connection,
  ): Promise<{ instructions: TransactionInstruction[]; mintedClassAddress?: string }> {
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    const classId = getClassId(action);
    const remembered = classId ? this.classHints.get(classId) : undefined;
    const tokenType = remembered?.tokenType ?? resolveTokenType(payload.tokenType);

    if (action.kind === 'TOKEN_CLASS_DEFINE') {
      if (!classId) throw new Error('TOKEN_CLASS_DEFINE requires classId');
      const mintAuthority = new PublicKey(toStringValue(payload.mintAuthority, this.signer.publicKey.toBase58()));
      if (!mintAuthority.equals(this.signer.publicKey)) {
        throw new Error('SPL execution requires payload.mintAuthority (or default) to equal signer.publicKey');
      }
      const freezeAuthority = toStringValue(payload.freezeAuthority)
        ? new PublicKey(toStringValue(payload.freezeAuthority))
        : null;
      const decimals = toInteger(payload.decimals, tokenType === 'NFT' ? 0 : 0);
      if (tokenType === 'NFT' && decimals !== 0) {
        throw new Error('SPL NFT-like classes require decimals=0');
      }
      const mintAddress = await this.mintAddressForClass(action);
      const mint = new PublicKey(mintAddress);
      const mintInfo = await connection.getAccountInfo(mint, this.commitment);
      const instructions: TransactionInstruction[] = [];
      if (!mintInfo) {
        const lamports = await connection.getMinimumBalanceForRentExemption(SPL_MINT_ACCOUNT_BYTES, this.commitment);
        const seed = deriveSeed(action.matchId, classId);
        instructions.push(SystemProgram.createAccountWithSeed({
          fromPubkey: this.signer.publicKey,
          basePubkey: this.signer.publicKey,
          seed,
          newAccountPubkey: mint,
          lamports,
          space: SPL_MINT_ACCOUNT_BYTES,
          programId: this.splTokenProgramId,
        }));
        instructions.push(initMintInstruction(mint, mintAuthority, freezeAuthority, decimals, this.splTokenProgramId));
        if (tokenType === 'NFT' && this.nftMetadataMode === 'metaplex') {
          const metadataPda = deriveMetadataPda(mint, this.metaplexTokenMetadataProgramId);
          const metadataInfo = await connection.getAccountInfo(metadataPda, this.commitment);
          if (!metadataInfo) {
            const media = ((payload.media ?? {}) as Record<string, unknown>);
            const metadataRaw = ((payload.metadata ?? {}) as Record<string, unknown>);
            const name = toStringValue(metadataRaw.name, toStringValue(payload.classId).slice(0, 32) || 'SNAP Asset');
            const symbol = toStringValue(metadataRaw.symbol, 'SNAP').slice(0, 10);
            const uri = toStringValue(metadataRaw.uri, toStringValue(media.uri));
            if (!uri) {
              throw new Error('Metaplex metadata requires payload.media.uri or payload.metadata.uri');
            }
            const sellerFeeBasisPoints = toInteger(
              metadataRaw.sellerFeeBasisPoints ?? (((payload.economics ?? {}) as Record<string, unknown>).royaltyBps),
              0,
            );
            const isMutable = metadataRaw.isMutable === undefined ? true : Boolean(metadataRaw.isMutable);
            instructions.push(
              new TransactionInstruction({
                programId: this.metaplexTokenMetadataProgramId,
                keys: [
                  { pubkey: metadataPda, isSigner: false, isWritable: true },
                  { pubkey: mint, isSigner: false, isWritable: false },
                  { pubkey: mintAuthority, isSigner: true, isWritable: false },
                  { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
                  { pubkey: mintAuthority, isSigner: true, isWritable: false },
                  { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
                  { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
                ],
                data: buildCreateMetadataV3Data({
                  name,
                  symbol,
                  uri,
                  sellerFeeBasisPoints: Math.max(0, Math.min(10000, sellerFeeBasisPoints)),
                  isMutable,
                }) as any,
              }),
            );
          }
        }
      }
      if (instructions.length === 0) {
        instructions.push(...(await this.instructionBuilder({
          action,
          chainHint: this.resolveHint(action),
          tokenizationProgramId: this.tokenizationProgramId,
        })));
      }
      return { instructions, mintedClassAddress: mintAddress };
    }

    if (action.kind === 'TOKEN_MINT') {
      const mintAddress = this.resolveMintAddress(action);
      if (!mintAddress) throw new Error(`TOKEN_MINT missing mintAddress for class '${classId}'`);
      const mint = new PublicKey(mintAddress);
      const destinationOwner = new PublicKey(toStringValue(payload.to));
      const destinationAta = deriveAta(destinationOwner, mint, this.splTokenProgramId, this.associatedTokenProgramId);
      return {
        instructions: [
          createAssociatedTokenIdempotentInstruction(
            this.signer.publicKey,
            destinationOwner,
            mint,
            this.splTokenProgramId,
            this.associatedTokenProgramId,
          ),
          mintToInstruction(
            mint,
            destinationAta,
            this.signer.publicKey,
            resolveAmount(action, tokenType),
            this.splTokenProgramId,
          ),
        ],
      };
    }

    if (action.kind === 'TOKEN_TRANSFER') {
      const mintAddress = this.resolveMintAddress(action);
      if (!mintAddress) throw new Error(`TOKEN_TRANSFER missing mintAddress for class '${classId}'`);
      const mint = new PublicKey(mintAddress);
      const fromOwner = new PublicKey(toStringValue(payload.from, action.actor));
      const toOwner = new PublicKey(toStringValue(payload.to));
      const fromAta = deriveAta(fromOwner, mint, this.splTokenProgramId, this.associatedTokenProgramId);
      const toAta = deriveAta(toOwner, mint, this.splTokenProgramId, this.associatedTokenProgramId);
      return {
        instructions: [
          createAssociatedTokenIdempotentInstruction(
            this.signer.publicKey,
            toOwner,
            mint,
            this.splTokenProgramId,
            this.associatedTokenProgramId,
          ),
          transferInstruction(
            fromAta,
            toAta,
            this.signer.publicKey,
            resolveAmount(action, tokenType),
            this.splTokenProgramId,
          ),
        ],
      };
    }

    if (action.kind === 'TOKEN_BURN') {
      const mintAddress = this.resolveMintAddress(action);
      if (!mintAddress) throw new Error(`TOKEN_BURN missing mintAddress for class '${classId}'`);
      const mint = new PublicKey(mintAddress);
      const owner = new PublicKey(toStringValue(payload.owner, action.actor));
      const ownerAta = deriveAta(owner, mint, this.splTokenProgramId, this.associatedTokenProgramId);
      return {
        instructions: [
          burnInstruction(
            ownerAta,
            mint,
            this.signer.publicKey,
            resolveAmount(action, tokenType),
            this.splTokenProgramId,
          ),
        ],
      };
    }

    return {
      instructions: await this.instructionBuilder({
        action,
        chainHint: this.resolveHint(action),
        tokenizationProgramId: this.tokenizationProgramId,
      }),
    };
  }

  private rememberClassHint(action: SnapAction, hint: TokenizationChainHint, mintedClassAddress?: string): void {
    if (action.kind !== 'TOKEN_CLASS_DEFINE') return;
    const classId = getClassId(action);
    if (!classId) return;
    const payload = (action.payload ?? {}) as Record<string, unknown>;
    this.classHints.set(classId, {
      classId,
      hint,
      ...(mintedClassAddress ? { mintAddress: mintedClassAddress } : {}),
      tokenType: resolveTokenType(payload.tokenType),
      decimals: toInteger(payload.decimals, resolveTokenType(payload.tokenType) === 'NFT' ? 0 : 0),
    });
  }

  getRpcUrlForAction(action: SnapAction): string {
    const hint = this.resolveHint(action);
    const backend = backendFromHint(hint, this.backend);
    return backend === 'magicblock' ? this.magicblockRpcUrl : this.solanaRpcUrl;
  }

  async dispatch(action: SnapAction): Promise<SnapAuthorityTxResult | null> {
    if (!isTokenizationAction(action)) return null;
    const hint = this.resolveHint(action);
    const backend = backendFromHint(hint, this.backend);
    const connection = this.getConnectionForBackend(backend);
    const native = this.instructionMode === 'spl' && !this.hasCustomInstructionBuilder;
    const built = native
      ? await this.buildNativeSplInstructions(action, connection)
      : {
          instructions: await this.instructionBuilder({
            action,
            chainHint: hint,
            tokenizationProgramId: this.tokenizationProgramId,
          }),
          mintedClassAddress: undefined,
        };
    const result = await this.sendInstructions(backend, built.instructions);
    this.rememberClassHint(action, hint, built.mintedClassAddress);
    return result;
  }

  async dispatchAndAttachTxRef(action: SnapAction): Promise<SnapAction> {
    const result = await this.dispatch(action);
    if (!result) return action;
    const patch: Record<string, unknown> = { txRef: result.signature };
    if (action.kind === 'TOKEN_CLASS_DEFINE') {
      const classId = getClassId(action);
      const minted = classId ? this.classHints.get(classId)?.mintAddress : undefined;
      if (minted) {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const chain = (payload.chain ?? {}) as Record<string, unknown>;
        patch.chain = { ...chain, mintAddress: minted };
      }
    } else {
      const mintAddress = this.resolveMintAddress(action);
      if (mintAddress) patch.mintAddress = mintAddress;
    }
    return withPayload(action, patch);
  }
}

export function createMagicBlockTokenizationClientAdapter(
  config: MagicBlockTokenizationClientConfig,
): MagicBlockTokenizationClientAdapter {
  return new DefaultMagicBlockTokenizationClientAdapter(config);
}

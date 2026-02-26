import {
  Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountMeta,
  type AccountInfo,
} from '@solana/web3.js';
import type { SnapAuthorityBackend, SnapAuthoritySigner, SnapAuthorityTxResult } from './types.js';

const DEFAULT_SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_MAGICBLOCK_RPC_URL = 'http://127.0.0.1:8899';
const ENGINE_SEED = new TextEncoder().encode('engine');
const MATCH_SEED = new TextEncoder().encode('match');
const U64_MAX = 18446744073709551615n;

/**
 * MagicBlock delegation program — the escrow program that takes ownership of
 * PDAs while they are running on an Ephemeral Rollup validator.
 * Source: https://docs.magicblock.gg/pages/tools/ephemeral-rollups/delegate-accounts
 */
const DELEGATION_PROGRAM_ID = new PublicKey('DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh');

/**
 * The magic-block delegation program seeds.
 * Account buffers are PDA-derived from the delegation program using these seeds.
 */
const DELEGATION_BUFFER_SEED = new TextEncoder().encode('delegation_buffer');
const DELEGATION_RECORD_SEED = new TextEncoder().encode('delegation_record');
const DELEGATION_METADATA_SEED = new TextEncoder().encode('delegation_metadata');

/**
 * Delegation instruction discriminators (first 8 bytes of SHA256("global:<name>")).
 * These are stable values from the MagicBlock delegation program IDL.
 */
const DELEGATION_IX = {
  /** delegate_account — locks a PDA to the ER validator */
  delegate: hex('552d98e66a14e060'),
  /** undelegations are initiated from the ER side; the base-chain commit ix is: */
  commit_accounts: hex('b9ab68e4e0e5a04c'),
} as const;

/** Default lifetime for a delegated match account (30 minutes in slots). */
const DEFAULT_DELEGATION_LIFETIME_SLOTS = 3600 * 30; // ~30 min at 400ms slots

/** Default max ER batch size for commit. */
const DEFAULT_VALIDATOR_PUBKEY = PublicKey.default;
const U32_MAX = 4294967295;
const U16_MAX = 65535;

const IX_DISCRIMINATORS = {
  initialize_engine: hex('119e99d777f29c6b'),
  set_engine_admin: hex('7bd5dc19716bbd84'),
  set_engine_pause: hex('9e2080f36d4cfa02'),
  create_match: hex('6b02b891468e11a5'),
  join_match: hex('f4082f82c03bb32c'),
  start_match: hex('64f6dfb5b065ff13'),
  end_match: hex('22747abf64de1475'),
  submit_action: hex('de3b2097c289af96'),
  record_randomness: hex('146694bb31fdd8e9'),
} as const;

const ACCOUNT_DISCRIMINATORS = {
  MultiplayerEngine: hex('a6bb0a2e4996e240'),
  MatchState: hex('fad18946eb6079d8'),
} as const;

const TURN_MODE_ROUND_BASED = 0;
const TURN_MODE_FREE_TURN = 1;
const MATCH_STATUS_OPEN = 0;
const MATCH_STATUS_STARTED = 1;
const MATCH_STATUS_ENDED = 2;

export type MultiplayerAuthorityTurnMode = 'ROUND_BASED' | 'FREE_TURN';
export type MultiplayerAuthorityMatchStatus = 'OPEN' | 'STARTED' | 'ENDED';

export interface MultiplayerAuthorityClientConfig {
  backend: SnapAuthorityBackend;
  programId: string | PublicKey;
  signer: SnapAuthoritySigner;
  magicblockRpcUrl?: string;
  solanaRpcUrl?: string;
  commitment?: Commitment;
}

export interface CreateMatchParams {
  matchId: Uint8Array;
  gameId: Uint8Array;
  minPlayers: number;
  maxPlayers: number;
  turnMode: MultiplayerAuthorityTurnMode;
  maxStateBytes: number;
  initialState: Uint8Array;
  pluginProgram?: PublicKey | string | null;
  pluginConfigHash?: Uint8Array;
  vrfModule?: PublicKey | string | null;
}

export interface SubmitActionParams {
  matchId: Uint8Array;
  actionType: number;
  payload: Uint8Array;
  expectedStateVersion: bigint | number;
  pluginProgram?: PublicKey | string;
  pluginTransition?: PublicKey | string;
  remainingAccounts?: AccountMeta[];
}

export interface RecordRandomnessParams {
  matchId: Uint8Array;
  randomnessRoot: Uint8Array;
  randomnessNonce: bigint | number;
}

export interface MultiplayerAuthorityMatchState {
  publicKey: PublicKey;
  engine: PublicKey;
  matchId: Uint8Array;
  gameId: Uint8Array;
  creator: PublicKey;
  players: PublicKey[];
  status: MultiplayerAuthorityMatchStatus;
  turnMode: MultiplayerAuthorityTurnMode;
  minPlayers: number;
  maxPlayers: number;
  maxStateBytes: number;
  activeTurnIndex: number;
  currentRound: number;
  stateVersion: bigint;
  actionCount: bigint;
  gameState: Uint8Array;
  pluginProgram: PublicKey | null;
  pluginConfigHash: Uint8Array;
  vrfModule: PublicKey | null;
  randomnessRoot: Uint8Array;
  randomnessNonce: bigint;
  locked: boolean;
  createdAtUnix: number;
  updatedAtUnix: number;
}

export interface MultiplayerAuthorityEngineState {
  publicKey: PublicKey;
  admin: PublicKey;
  defaultVrfModule: PublicKey | null;
  paused: boolean;
  createdAtUnix: number;
  updatedAtUnix: number;
}

export interface MatchSubscriptionHandle {
  unsubscribe: () => void;
}

export interface MultiplayerAuthorityPluginActionInput {
  state: Uint8Array;
  actionType: number;
  payload: Uint8Array;
  stateVersion: bigint;
  actionIndex: bigint;
  randomnessRoot: Uint8Array;
  randomnessNonce: bigint;
}

export interface MultiplayerAuthorityPluginAdapter {
  validate_action(input: MultiplayerAuthorityPluginActionInput): void | Promise<void>;
  apply_action(input: MultiplayerAuthorityPluginActionInput): Uint8Array | Promise<Uint8Array>;
}

export class MagicBlockMultiplayerAuthorityClient {
  readonly backend: SnapAuthorityBackend;
  readonly programId: PublicKey;
  readonly signer: SnapAuthoritySigner;
  readonly commitment: Commitment;
  readonly magicblockRpcUrl: string;
  readonly solanaRpcUrl: string;

  constructor(config: MultiplayerAuthorityClientConfig) {
    this.backend = config.backend;
    this.programId = asPublicKey(config.programId);
    this.signer = config.signer;
    this.commitment = config.commitment ?? 'confirmed';
    this.magicblockRpcUrl = (config.magicblockRpcUrl ?? DEFAULT_MAGICBLOCK_RPC_URL).trim() || DEFAULT_MAGICBLOCK_RPC_URL;
    this.solanaRpcUrl = (config.solanaRpcUrl ?? DEFAULT_SOLANA_RPC_URL).trim() || DEFAULT_SOLANA_RPC_URL;
  }

  getRpcUrl(delegated = false): string {
    if (delegated && this.backend === 'magicblock') return this.magicblockRpcUrl;
    return this.solanaRpcUrl;
  }

  getConnection(delegated = false): Connection {
    return new Connection(this.getRpcUrl(delegated), this.commitment);
  }

  deriveEnginePda(): PublicKey {
    return PublicKey.findProgramAddressSync([ENGINE_SEED], this.programId)[0];
  }

  deriveMatchPda(matchId: Uint8Array): PublicKey {
    const matchIdBytes = bytes32(matchId, 'matchId');
    return PublicKey.findProgramAddressSync([MATCH_SEED, this.deriveEnginePda().toBytes(), matchIdBytes], this.programId)[0];
  }

  async initializeEngine(defaultVrfModule?: PublicKey | string | null): Promise<SnapAuthorityTxResult> {
    const defaultVrf = defaultVrfModule ? asPublicKey(defaultVrfModule) : null;
    const engine = this.deriveEnginePda();
    const data = concat(
      IX_DISCRIMINATORS.initialize_engine,
      encodeOptionPubkey(defaultVrf),
    );
    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: engine, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
      this.backend === 'magicblock',
    );
  }

  async createMatch(params: CreateMatchParams): Promise<SnapAuthorityTxResult> {
    const matchId = bytes32(params.matchId, 'matchId');
    const gameId = bytes32(params.gameId, 'gameId');
    const pluginConfigHash = bytes32(params.pluginConfigHash ?? new Uint8Array(32), 'pluginConfigHash');
    const initialState = asBytes(params.initialState, 'initialState');
    const engine = this.deriveEnginePda();
    const matchState = this.deriveMatchPda(matchId);

    const turnMode = encodeTurnMode(params.turnMode);
    const data = concat(
      IX_DISCRIMINATORS.create_match,
      matchId,
      gameId,
      u8(params.minPlayers, 'minPlayers'),
      u8(params.maxPlayers, 'maxPlayers'),
      new Uint8Array([turnMode]),
      u16(params.maxStateBytes, 'maxStateBytes'),
      encodeOptionPubkey(params.pluginProgram ? asPublicKey(params.pluginProgram) : null),
      pluginConfigHash,
      encodeOptionPubkey(params.vrfModule ? asPublicKey(params.vrfModule) : null),
      vecU8(initialState),
    );

    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: engine, isSigner: false, isWritable: false },
        { pubkey: matchState, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
      this.backend === 'magicblock',
    );
  }

  async joinMatch(matchId: Uint8Array): Promise<SnapAuthorityTxResult> {
    const matchState = this.deriveMatchPda(matchId);
    const data = IX_DISCRIMINATORS.join_match;
    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.deriveEnginePda(), isSigner: false, isWritable: false },
        { pubkey: matchState, isSigner: false, isWritable: true },
      ],
      data,
      this.backend === 'magicblock',
    );
  }

  async startMatch(matchId: Uint8Array): Promise<SnapAuthorityTxResult> {
    const matchState = this.deriveMatchPda(matchId);
    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.deriveEnginePda(), isSigner: false, isWritable: false },
        { pubkey: matchState, isSigner: false, isWritable: true },
      ],
      IX_DISCRIMINATORS.start_match,
      this.backend === 'magicblock',
    );
  }

  async endMatch(matchId: Uint8Array): Promise<SnapAuthorityTxResult> {
    const matchState = this.deriveMatchPda(matchId);
    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.deriveEnginePda(), isSigner: false, isWritable: false },
        { pubkey: matchState, isSigner: false, isWritable: true },
      ],
      IX_DISCRIMINATORS.end_match,
      this.backend === 'magicblock',
    );
  }

  async submitAction(params: SubmitActionParams): Promise<SnapAuthorityTxResult> {
    const actionType = u16(params.actionType, 'actionType');
    const payload = asBytes(params.payload, 'payload');
    const expectedStateVersion = u64(params.expectedStateVersion, 'expectedStateVersion');
    const matchState = this.deriveMatchPda(params.matchId);
    const pluginProgram = params.pluginProgram ? asPublicKey(params.pluginProgram) : SystemProgram.programId;
    const pluginTransition = params.pluginTransition ? asPublicKey(params.pluginTransition) : SystemProgram.programId;
    const extraAccounts = params.remainingAccounts ?? [];

    const data = concat(
      IX_DISCRIMINATORS.submit_action,
      actionType,
      vecU8(payload),
      expectedStateVersion,
    );

    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: this.deriveEnginePda(), isSigner: false, isWritable: false },
        { pubkey: matchState, isSigner: false, isWritable: true },
        { pubkey: pluginProgram, isSigner: false, isWritable: false },
        { pubkey: pluginTransition, isSigner: false, isWritable: true },
        ...extraAccounts,
      ],
      data,
      this.backend === 'magicblock',
    );
  }

  async recordRandomness(params: RecordRandomnessParams): Promise<SnapAuthorityTxResult> {
    const matchState = this.deriveMatchPda(params.matchId);
    const randomnessRoot = bytes32(params.randomnessRoot, 'randomnessRoot');
    const randomnessNonce = u64(params.randomnessNonce, 'randomnessNonce');
    const data = concat(
      IX_DISCRIMINATORS.record_randomness,
      randomnessRoot,
      randomnessNonce,
    );
    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
        { pubkey: this.deriveEnginePda(), isSigner: false, isWritable: false },
        { pubkey: matchState, isSigner: false, isWritable: true },
      ],
      data,
      this.backend === 'magicblock',
    );
  }

  async getEngine(): Promise<MultiplayerAuthorityEngineState> {
    const engine = this.deriveEnginePda();
    const connection = this.getConnection(this.backend === 'magicblock');
    const info = await connection.getAccountInfo(engine, this.commitment);
    if (!info) throw new Error(`Engine account not found: ${engine.toBase58()}`);
    return decodeEngine(engine, info);
  }

  async getMatch(matchId: Uint8Array): Promise<MultiplayerAuthorityMatchState> {
    const matchState = this.deriveMatchPda(matchId);
    const connection = this.getConnection(this.backend === 'magicblock');
    const info = await connection.getAccountInfo(matchState, this.commitment);
    if (!info) throw new Error(`Match account not found: ${matchState.toBase58()}`);
    return decodeMatchState(matchState, info);
  }

  async subscribeToMatch(
    matchId: Uint8Array,
    callback: (state: MultiplayerAuthorityMatchState) => void,
  ): Promise<MatchSubscriptionHandle> {
    const pda = this.deriveMatchPda(matchId);
    const connection = this.getConnection(this.backend === 'magicblock');
    const id = connection.onAccountChange(
      pda,
      (info) => {
        try {
          callback(decodeMatchState(pda, info));
        } catch {
          // Keep subscription alive on transient decode errors.
        }
      },
      this.commitment,
    );
    return {
      unsubscribe: () => {
        void connection.removeAccountChangeListener(id);
      },
    };
  }

  private async sendInstruction(
    keys: AccountMeta[],
    data: Uint8Array,
    delegated = false,
  ): Promise<SnapAuthorityTxResult> {
    const connection = this.getConnection(delegated);
    const latest = await connection.getLatestBlockhash(this.commitment);
    const tx = new Transaction({
      feePayer: this.signer.publicKey,
      recentBlockhash: latest.blockhash,
    }).add(
      new TransactionInstruction({
        programId: this.programId,
        keys,
        data: data as any,
      }),
    );
    const signed = await this.signer.signTransaction(tx);
    const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
    try {
      await connection.confirmTransaction({ signature, ...latest }, this.commitment);
    } catch (error) {
      // Some local validators can report blockheight expiry even when a tx lands.
      const message = error instanceof Error ? error.message : String(error);
      if (!/block height exceeded/i.test(message)) throw error;
      const landed = await this.waitForSignatureStatus(connection, signature, 40, 500);
      if (!landed) throw error;
    }
    return {
      backendUsed: delegated && this.backend === 'magicblock' ? 'magicblock' : 'local',
      rpcUrl: connection.rpcEndpoint,
      signature,
    };
  }

  private async waitForSignatureStatus(
    connection: Connection,
    signature: string,
    maxAttempts: number,
    delayMs: number,
  ): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i += 1) {
      const status = await connection.getSignatureStatus(signature, { searchTransactionHistory: true });
      const value = status.value;
      if (value) {
        if (value.err) {
          throw new Error(`Transaction ${signature} failed after send: ${JSON.stringify(value.err)}`);
        }
        return true;
      }
      await sleep(delayMs);
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMagicBlockMultiplayerAuthorityClient(
  config: MultiplayerAuthorityClientConfig,
): MagicBlockMultiplayerAuthorityClient {
  return new MagicBlockMultiplayerAuthorityClient(config);
}

// ──────────────────────────────────────────────────────────────────────────────
// Delegation lifecycle helpers
// ──────────────────────────────────────────────────────────────────────────────

export interface DelegateMatchParams {
  matchId: Uint8Array;
  /**
   * Pubkey of the MagicBlock ER validator node that will process actions for
   * this match. Use `PublicKey.default` (all-zeros) for the shared devnet ER.
   */
  validatorToPredelegateToOverride?: PublicKey | string;
  /** How many slots the delegation stays valid. Default: ~30 minutes. */
  lifetimeSlots?: number;
}

export interface CommitAndEndMatchParams {
  matchId: Uint8Array;
  /**
   * If provided, settle provenance on-chain immediately after ending the match.
   * Requires a `provenanceClient` in the config (pass it via the options).
   */
  provenanceInput?: {
    player: PublicKey | string;
    gameId: Uint8Array;
    finalStateHash: Uint8Array;
    logHash: Uint8Array;
    provenanceHash?: Uint8Array;
    kills: number;
    deaths: number;
    assists: number;
    score: number;
    won: boolean;
    metadataUri?: string;
  };
}

/**
 * Derives the delegation_buffer PDA for a given delegated account.
 * The delegation program stores buffered state in this account while the
 * match is running on the ER.
 */
function deriveDelegationBufferPda(delegatedAccount: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [DELEGATION_BUFFER_SEED, delegatedAccount.toBytes()],
    DELEGATION_PROGRAM_ID,
  )[0];
}

/**
 * Derives the delegation_record PDA for a given delegated account.
 * Stores metadata about the delegation (validator, lifetime, etc).
 */
function deriveDelegationRecordPda(delegatedAccount: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [DELEGATION_RECORD_SEED, delegatedAccount.toBytes()],
    DELEGATION_PROGRAM_ID,
  )[0];
}

/**
 * Derives the delegation_metadata PDA.
 */
function deriveDelegationMetadataPda(delegatedAccount: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [DELEGATION_METADATA_SEED, delegatedAccount.toBytes()],
    DELEGATION_PROGRAM_ID,
  )[0];
}

/**
 * Builds the `delegate_account` instruction for MagicBlock's delegation program.
 *
 * This must be sent to the **Solana base chain** (not the ER) immediately
 * after `create_match`. Once processed, the ER validator gains write authority
 * over the `match_state` PDA and will accept `submit_action` transactions.
 *
 * Account layout matches MagicBlock delegation program v1:
 * 0. payer            — writable signer (pays for delegation_buffer + delegation_record accounts)
 * 1. delegated_account — writable (the match_state PDA being delegated)
 * 2. owner_program    — readonly (snap-multiplayer-authority program ID)
 * 3. buffer           — writable (delegation_buffer PDA)
 * 4. delegation_record — writable (delegation_record PDA)
 * 5. delegation_metadata — writable (delegation_metadata PDA)
 * 6. system_program   — readonly
 */
function buildDelegateAccountIx(
  payer: PublicKey,
  delegatedAccount: PublicKey,
  ownerProgram: PublicKey,
  validatorPubkey: PublicKey,
  lifetimeSlots: number,
): TransactionInstruction {
  const buffer = deriveDelegationBufferPda(delegatedAccount);
  const record = deriveDelegationRecordPda(delegatedAccount);
  const metadata = deriveDelegationMetadataPda(delegatedAccount);

  // Instruction data layout:
  //   [0..8]   discriminator  (8 bytes)
  //   [8..12]  lifetime_slots (u32 le)
  //   [12..44] validator      (Pubkey, 32 bytes)
  const data = concat(
    DELEGATION_IX.delegate,
    u32(lifetimeSlots, 'lifetimeSlots'),
    validatorPubkey.toBytes(),
  );

  return new TransactionInstruction({
    programId: DELEGATION_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: delegatedAccount, isSigner: false, isWritable: true },
      { pubkey: ownerProgram, isSigner: false, isWritable: false },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: record, isSigner: false, isWritable: true },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: data as any,
  });
}

/**
 * Builds the `commit_accounts` instruction for MagicBlock's delegation program.
 *
 * This is sent to the **ER validator** to finalize the match state and
 * schedule the commit back to Solana. It is called from the game authority
 * after `end_match` to ensure the final state version is settled on-chain.
 *
 * Account layout:
 * 0. payer             — writable signer
 * 1. delegation_record — writable (delegation_record PDA)
 * 2. buffer            — writable (delegation_buffer PDA)
 * 3. delegated_account — writable (the match_state PDA)
 * 4. delegation_program — readonly
 * 5. system_program    — readonly
 */
function buildCommitAccountIx(
  payer: PublicKey,
  delegatedAccount: PublicKey,
): TransactionInstruction {
  const record = deriveDelegationRecordPda(delegatedAccount);
  const buffer = deriveDelegationBufferPda(delegatedAccount);

  return new TransactionInstruction({
    programId: DELEGATION_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: record, isSigner: false, isWritable: true },
      { pubkey: buffer, isSigner: false, isWritable: true },
      { pubkey: delegatedAccount, isSigner: false, isWritable: true },
      { pubkey: DELEGATION_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: DELEGATION_IX.commit_accounts as any,
  });
}

/**
 * Delegate a match_state PDA to the MagicBlock Ephemeral Rollup validator.
 *
 * **Must be called on the Solana base chain** after `createMatch` succeeds.
 * Once delegated, all `submitAction` calls can be routed to the ER validator
 * for ~10-50ms latency instead of 400ms.
 *
 * @example
 * ```ts
 * const client = createMagicBlockMultiplayerAuthorityClient({ backend: 'magicblock', ... });
 * await client.createMatch({ matchId, ... });
 * await delegateMatch(client, { matchId });
 * // Now route submit_action to MagicBlock ER:
 * await client.submitAction({ matchId, actionType: 1, payload, expectedStateVersion: 0n });
 * ```
 */
export async function delegateMatch(
  client: MagicBlockMultiplayerAuthorityClient,
  params: DelegateMatchParams,
): Promise<SnapAuthorityTxResult> {
  const matchId = bytes32(params.matchId, 'matchId');
  const matchState = client.deriveMatchPda(matchId);
  const validator = params.validatorToPredelegateToOverride
    ? (params.validatorToPredelegateToOverride instanceof PublicKey
      ? params.validatorToPredelegateToOverride
      : new PublicKey(params.validatorToPredelegateToOverride))
    : DEFAULT_VALIDATOR_PUBKEY;
  const lifetimeSlots = params.lifetimeSlots ?? DEFAULT_DELEGATION_LIFETIME_SLOTS;

  const ix = buildDelegateAccountIx(
    client.signer.publicKey,
    matchState,
    client.programId,
    validator,
    lifetimeSlots,
  );

  // Delegation must be sent to Solana base chain (delegated=false)
  const connection = client.getConnection(false);
  const latest = await connection.getLatestBlockhash(client.commitment);
  const tx = new Transaction({ feePayer: client.signer.publicKey, recentBlockhash: latest.blockhash }).add(ix);
  const signed = await client.signer.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature, ...latest }, client.commitment);
  return { backendUsed: 'local', rpcUrl: connection.rpcEndpoint, signature };
}

/**
 * Commit the final ER state for a match back to the Solana base chain.
 *
 * **Must be sent to the ER validator** (delegated=true) after `endMatch`.
 * This schedules the final `match_state` snapshot to be written back
 * to Solana, completing the ER → base-chain settlement cycle.
 */
export async function commitMatchToBaseChain(
  client: MagicBlockMultiplayerAuthorityClient,
  matchId: Uint8Array,
): Promise<SnapAuthorityTxResult> {
  const matchState = client.deriveMatchPda(bytes32(matchId, 'matchId'));

  const ix = buildCommitAccountIx(client.signer.publicKey, matchState);

  // Commit instruction is sent to MagicBlock ER (delegated=true)
  const connection = client.getConnection(true);
  const latest = await connection.getLatestBlockhash(client.commitment);
  const tx = new Transaction({ feePayer: client.signer.publicKey, recentBlockhash: latest.blockhash }).add(ix);
  const signed = await client.signer.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature, ...latest }, client.commitment);
  return { backendUsed: 'magicblock', rpcUrl: connection.rpcEndpoint, signature };
}

/**
 * Full match settlement flow:
 * 1. Calls `end_match` on the ER (marks match as Ended)
 * 2. Sends `commit_accounts` to the ER to schedule base-chain settlement
 *
 * After this call returns, the match_state account will be committed back
 * to Solana on the next ER checkpoint. Use `provenanceRegistryClient` to
 * then record the match provenance on the Solana base chain.
 *
 * @example
 * ```ts
 * await commitAndEndMatch(client, { matchId });
 * // Wait for ER checkpoint (~2-5 seconds on devnet), then:
 * await provenanceClient.recordMatchProvenance({ player, gameId, matchId, ... });
 * ```
 */
export async function commitAndEndMatch(
  client: MagicBlockMultiplayerAuthorityClient,
  params: CommitAndEndMatchParams,
): Promise<{ endMatchSig: string; commitSig: string }> {
  // Step 1: End the match on the ER
  const endResult = await client.endMatch(params.matchId);

  // Step 2: Commit ER state back to Solana base chain
  const commitResult = await commitMatchToBaseChain(client, params.matchId);

  return { endMatchSig: endResult.signature, commitSig: commitResult.signature };
}

function decodeEngine(publicKey: PublicKey, info: AccountInfo<Buffer>): MultiplayerAuthorityEngineState {
  const data = new Uint8Array(info.data);
  requireDiscriminator(data, ACCOUNT_DISCRIMINATORS.MultiplayerEngine, 'MultiplayerEngine');
  const c = new Cursor(data, 8);
  const admin = c.pubkey();
  const defaultVrfModule = c.optionPubkey();
  const paused = c.bool();
  c.u8(); // bump
  c.skip(6); // reserved
  const createdAtUnix = c.i64Number();
  const updatedAtUnix = c.i64Number();
  return {
    publicKey,
    admin,
    defaultVrfModule,
    paused,
    createdAtUnix,
    updatedAtUnix,
  };
}

function decodeMatchState(publicKey: PublicKey, info: AccountInfo<Buffer>): MultiplayerAuthorityMatchState {
  const data = new Uint8Array(info.data);
  requireDiscriminator(data, ACCOUNT_DISCRIMINATORS.MatchState, 'MatchState');
  const c = new Cursor(data, 8);
  const engine = c.pubkey();
  const matchId = c.fixed(32);
  const gameId = c.fixed(32);
  const creator = c.pubkey();
  const playersLen = c.u32Number();
  const players: PublicKey[] = [];
  for (let i = 0; i < playersLen; i++) players.push(c.pubkey());
  const status = decodeStatus(c.u8());
  const turnMode = decodeTurnMode(c.u8());
  const minPlayers = c.u8();
  const maxPlayers = c.u8();
  const maxStateBytes = c.u16Number();
  const activeTurnIndex = c.u16Number();
  const currentRound = c.u32Number();
  const stateVersion = c.u64BigInt();
  const actionCount = c.u64BigInt();
  const gameState = c.vecU8();
  const pluginProgram = c.optionPubkey();
  const pluginConfigHash = c.fixed(32);
  const vrfModule = c.optionPubkey();
  const randomnessRoot = c.fixed(32);
  const randomnessNonce = c.u64BigInt();
  c.u8(); // bump
  const locked = c.bool();
  c.skip(6); // reserved
  const createdAtUnix = c.i64Number();
  const updatedAtUnix = c.i64Number();

  return {
    publicKey,
    engine,
    matchId,
    gameId,
    creator,
    players,
    status,
    turnMode,
    minPlayers,
    maxPlayers,
    maxStateBytes,
    activeTurnIndex,
    currentRound,
    stateVersion,
    actionCount,
    gameState,
    pluginProgram,
    pluginConfigHash,
    vrfModule,
    randomnessRoot,
    randomnessNonce,
    locked,
    createdAtUnix,
    updatedAtUnix,
  };
}

function decodeStatus(v: number): MultiplayerAuthorityMatchStatus {
  if (v === MATCH_STATUS_OPEN) return 'OPEN';
  if (v === MATCH_STATUS_STARTED) return 'STARTED';
  if (v === MATCH_STATUS_ENDED) return 'ENDED';
  throw new Error(`Invalid match status enum value: ${v}`);
}

function decodeTurnMode(v: number): MultiplayerAuthorityTurnMode {
  if (v === TURN_MODE_ROUND_BASED) return 'ROUND_BASED';
  if (v === TURN_MODE_FREE_TURN) return 'FREE_TURN';
  throw new Error(`Invalid turn mode enum value: ${v}`);
}

function encodeTurnMode(mode: MultiplayerAuthorityTurnMode): number {
  if (mode === 'ROUND_BASED') return TURN_MODE_ROUND_BASED;
  return TURN_MODE_FREE_TURN;
}

function hex(input: string): Uint8Array {
  const value = input.trim().toLowerCase();
  if (value.length % 2 !== 0) throw new Error(`Invalid hex length: ${input}`);
  const out = new Uint8Array(value.length / 2);
  for (let i = 0; i < out.length; i++) {
    const j = i * 2;
    out[i] = Number.parseInt(value.slice(j, j + 2), 16);
  }
  return out;
}

function requireDiscriminator(data: Uint8Array, expected: Uint8Array, label: string): void {
  if (data.length < 8) throw new Error(`${label} account data too short`);
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) throw new Error(`Unexpected ${label} account discriminator`);
  }
}

function asPublicKey(value: PublicKey | string): PublicKey {
  return value instanceof PublicKey ? value : new PublicKey(value);
}

function asBytes(value: Uint8Array, field: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${field} must be Uint8Array`);
  return value;
}

function bytes32(value: Uint8Array, field: string): Uint8Array {
  const bytes = asBytes(value, field);
  if (bytes.length !== 32) throw new Error(`${field} must be 32 bytes`);
  return bytes;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const chunk of chunks) {
    out.set(chunk, o);
    o += chunk.length;
  }
  return out;
}

function u8(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`${field} must be u8`);
  return new Uint8Array([value]);
}

function u16(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > U16_MAX) throw new Error(`${field} must be u16`);
  const out = new Uint8Array(2);
  out[0] = value & 0xff;
  out[1] = (value >>> 8) & 0xff;
  return out;
}

function u32(value: number, field: string): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > U32_MAX) throw new Error(`${field} must be u32`);
  const out = new Uint8Array(4);
  out[0] = value & 0xff;
  out[1] = (value >>> 8) & 0xff;
  out[2] = (value >>> 16) & 0xff;
  out[3] = (value >>> 24) & 0xff;
  return out;
}

function toBigInt(v: bigint | number, field: string): bigint {
  if (typeof v === 'bigint') {
    if (v < 0n || v > U64_MAX) throw new Error(`${field} must be u64`);
    return v;
  }
  if (!Number.isInteger(v) || v < 0) throw new Error(`${field} must be non-negative integer`);
  const out = BigInt(v);
  if (out > U64_MAX) throw new Error(`${field} must be u64`);
  return out;
}

function u64(value: bigint | number, field: string): Uint8Array {
  let v = toBigInt(value, field);
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function vecU8(bytes: Uint8Array): Uint8Array {
  return concat(u32(bytes.length, 'vec<u8> length'), bytes);
}

function encodeOptionPubkey(value: PublicKey | null): Uint8Array {
  if (!value) return new Uint8Array([0]);
  return concat(new Uint8Array([1]), value.toBytes());
}

class Cursor {
  private readonly data: Uint8Array;
  private offset: number;

  constructor(data: Uint8Array, offset: number) {
    this.data = data;
    this.offset = offset;
  }

  skip(n: number): void {
    this.ensure(n);
    this.offset += n;
  }

  u8(): number {
    this.ensure(1);
    return this.data[this.offset++] ?? 0;
  }

  bool(): boolean {
    return this.u8() === 1;
  }

  u16Number(): number {
    this.ensure(2);
    const v = this.data[this.offset]! | (this.data[this.offset + 1]! << 8);
    this.offset += 2;
    return v;
  }

  u32Number(): number {
    this.ensure(4);
    const v =
      this.data[this.offset]! |
      (this.data[this.offset + 1]! << 8) |
      (this.data[this.offset + 2]! << 16) |
      (this.data[this.offset + 3]! << 24);
    this.offset += 4;
    return v >>> 0;
  }

  u64BigInt(): bigint {
    this.ensure(8);
    let v = 0n;
    for (let i = 0; i < 8; i++) v |= BigInt(this.data[this.offset + i] ?? 0) << BigInt(8 * i);
    this.offset += 8;
    return v;
  }

  i64Number(): number {
    const raw = this.u64BigInt();
    const signed = (raw & (1n << 63n)) !== 0n ? raw - (1n << 64n) : raw;
    return Number(signed);
  }

  fixed(n: number): Uint8Array {
    this.ensure(n);
    const v = this.data.slice(this.offset, this.offset + n);
    this.offset += n;
    return v;
  }

  vecU8(): Uint8Array {
    const len = this.u32Number();
    return this.fixed(len);
  }

  pubkey(): PublicKey {
    return new PublicKey(this.fixed(32));
  }

  optionPubkey(): PublicKey | null {
    const flag = this.u8();
    if (flag === 0) return null;
    if (flag !== 1) throw new Error(`Invalid Option<Pubkey> tag: ${flag}`);
    return this.pubkey();
  }

  private ensure(n: number): void {
    if (this.offset + n > this.data.length) throw new Error('Unexpected end of account data');
  }
}

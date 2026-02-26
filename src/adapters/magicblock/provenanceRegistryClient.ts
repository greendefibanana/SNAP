import {
  Commitment,
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  type AccountInfo,
  type AccountMeta,
} from '@solana/web3.js';
import type { SnapAuthorityBackend, SnapAuthoritySigner, SnapAuthorityTxResult } from './types.js';

const DEFAULT_SOLANA_RPC_URL = 'https://api.devnet.solana.com';
const DEFAULT_MAGICBLOCK_RPC_URL = 'http://127.0.0.1:8899';
const REGISTRY_SEED = new TextEncoder().encode('registry');
const PLAYER_CV_SEED = new TextEncoder().encode('player_cv');
const PLAYER_GAME_CV_SEED = new TextEncoder().encode('player_game_cv');
const MATCH_PROVENANCE_SEED = new TextEncoder().encode('match_provenance');
const U64_MAX = 18446744073709551615n;
const U32_MAX = 4294967295;

const IX_DISCRIMINATORS = {
  initialize_registry: hex('bdb51411ae39f93b'),
  set_registry_admin: hex('801c6188fbb227ce'),
  set_registry_pause: hex('db896bfd3052906c'),
  set_trusted_signer: hex('deb8114132cd5945'),
  record_match_provenance: hex('d502f61f500483b5'),
} as const;

const ACCOUNT_DISCRIMINATORS = {
  ProvenanceRegistry: hex('28e87a79730f824a'),
  PlayerCv: hex('1a0835f292a79313'),
  PlayerGameCv: hex('d70a173c43edea95'),
  MatchProvenance: hex('d96dbcf4743c5101'),
} as const;

export interface ProvenanceRegistryClientConfig {
  backend: SnapAuthorityBackend;
  programId: string | PublicKey;
  signer: SnapAuthoritySigner;
  magicblockRpcUrl?: string;
  solanaRpcUrl?: string;
  commitment?: Commitment;
}

export interface RecordMatchProvenanceParams {
  player: PublicKey | string;
  gameId: Uint8Array;
  matchId: Uint8Array;
  finalStateHash: Uint8Array;
  logHash: Uint8Array;
  provenanceHash?: Uint8Array;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  won: boolean;
  metadataUri?: string;
}

export interface ProvenanceRegistryState {
  publicKey: PublicKey;
  admin: PublicKey;
  paused: boolean;
  trustedSigners: PublicKey[];
  createdAtUnix: number;
  updatedAtUnix: number;
}

export interface PlayerCvState {
  publicKey: PublicKey;
  registry: PublicKey;
  player: PublicKey;
  gamesPlayed: bigint;
  wins: bigint;
  kills: bigint;
  deaths: bigint;
  assists: bigint;
  score: bigint;
  matchesRecorded: bigint;
  lastMatchAtUnix: number;
  createdAtUnix: number;
  updatedAtUnix: number;
}

export interface PlayerGameCvState extends PlayerCvState {
  gameId: Uint8Array;
}

export interface MatchProvenanceState {
  publicKey: PublicKey;
  registry: PublicKey;
  player: PublicKey;
  gameId: Uint8Array;
  matchId: Uint8Array;
  reporter: PublicKey;
  finalStateHash: Uint8Array;
  logHash: Uint8Array;
  provenanceHash: Uint8Array;
  kills: number;
  deaths: number;
  assists: number;
  score: number;
  won: boolean;
  recordedAtUnix: number;
  metadataUri: string;
}

export class MagicBlockProvenanceRegistryClient {
  readonly backend: SnapAuthorityBackend;
  readonly programId: PublicKey;
  readonly signer: SnapAuthoritySigner;
  readonly commitment: Commitment;
  readonly magicblockRpcUrl: string;
  readonly solanaRpcUrl: string;

  constructor(config: ProvenanceRegistryClientConfig) {
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

  deriveRegistryPda(): PublicKey {
    return PublicKey.findProgramAddressSync([REGISTRY_SEED], this.programId)[0];
  }

  derivePlayerCvPda(player: PublicKey | string): PublicKey {
    const playerKey = asPublicKey(player);
    return PublicKey.findProgramAddressSync(
      [PLAYER_CV_SEED, this.deriveRegistryPda().toBytes(), playerKey.toBytes()],
      this.programId,
    )[0];
  }

  derivePlayerGameCvPda(player: PublicKey | string, gameId: Uint8Array): PublicKey {
    const playerKey = asPublicKey(player);
    const gameIdBytes = bytes32(gameId, 'gameId');
    return PublicKey.findProgramAddressSync(
      [PLAYER_GAME_CV_SEED, this.deriveRegistryPda().toBytes(), playerKey.toBytes(), gameIdBytes],
      this.programId,
    )[0];
  }

  deriveMatchProvenancePda(player: PublicKey | string, gameId: Uint8Array, matchId: Uint8Array): PublicKey {
    const playerKey = asPublicKey(player);
    const gameIdBytes = bytes32(gameId, 'gameId');
    const matchIdBytes = bytes32(matchId, 'matchId');
    return PublicKey.findProgramAddressSync(
      [MATCH_PROVENANCE_SEED, this.deriveRegistryPda().toBytes(), playerKey.toBytes(), gameIdBytes, matchIdBytes],
      this.programId,
    )[0];
  }

  async initializeRegistry(): Promise<SnapAuthorityTxResult> {
    const registry = this.deriveRegistryPda();
    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      IX_DISCRIMINATORS.initialize_registry,
      this.backend === 'magicblock',
    );
  }

  async setRegistryAdmin(newAdmin: PublicKey | string): Promise<SnapAuthorityTxResult> {
    return this.sendInstruction(
      [
        { pubkey: this.deriveRegistryPda(), isSigner: false, isWritable: true },
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
      ],
      concat(IX_DISCRIMINATORS.set_registry_admin, asPublicKey(newAdmin).toBytes()),
      this.backend === 'magicblock',
    );
  }

  async setRegistryPause(paused: boolean): Promise<SnapAuthorityTxResult> {
    return this.sendInstruction(
      [
        { pubkey: this.deriveRegistryPda(), isSigner: false, isWritable: true },
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
      ],
      concat(IX_DISCRIMINATORS.set_registry_pause, bool(paused)),
      this.backend === 'magicblock',
    );
  }

  async setTrustedSigner(signer: PublicKey | string, enabled: boolean): Promise<SnapAuthorityTxResult> {
    return this.sendInstruction(
      [
        { pubkey: this.deriveRegistryPda(), isSigner: false, isWritable: true },
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: false },
      ],
      concat(IX_DISCRIMINATORS.set_trusted_signer, asPublicKey(signer).toBytes(), bool(enabled)),
      this.backend === 'magicblock',
    );
  }

  async recordMatchProvenance(params: RecordMatchProvenanceParams): Promise<SnapAuthorityTxResult> {
    const player = asPublicKey(params.player);
    const registry = this.deriveRegistryPda();
    const gameId = bytes32(params.gameId, 'gameId');
    const matchId = bytes32(params.matchId, 'matchId');
    const finalStateHash = bytes32(params.finalStateHash, 'finalStateHash');
    const logHash = bytes32(params.logHash, 'logHash');
    const provenanceHash = bytes32(params.provenanceHash ?? params.logHash, 'provenanceHash');
    const metadataUri = String(params.metadataUri ?? '');

    const playerCv = this.derivePlayerCvPda(player);
    const playerGameCv = this.derivePlayerGameCvPda(player, gameId);
    const matchProvenance = this.deriveMatchProvenancePda(player, gameId, matchId);

    const data = concat(
      IX_DISCRIMINATORS.record_match_provenance,
      gameId,
      matchId,
      finalStateHash,
      logHash,
      provenanceHash,
      u32(params.kills, 'kills'),
      u32(params.deaths, 'deaths'),
      u32(params.assists, 'assists'),
      u32(params.score, 'score'),
      bool(params.won),
      str(metadataUri),
    );

    return this.sendInstruction(
      [
        { pubkey: this.signer.publicKey, isSigner: true, isWritable: true },
        { pubkey: player, isSigner: false, isWritable: false },
        { pubkey: registry, isSigner: false, isWritable: true },
        { pubkey: playerCv, isSigner: false, isWritable: true },
        { pubkey: playerGameCv, isSigner: false, isWritable: true },
        { pubkey: matchProvenance, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
      this.backend === 'magicblock',
    );
  }

  async getRegistry(): Promise<ProvenanceRegistryState> {
    const registry = this.deriveRegistryPda();
    const connection = this.getConnection(this.backend === 'magicblock');
    const info = await connection.getAccountInfo(registry, this.commitment);
    if (!info) throw new Error(`Registry account not found: ${registry.toBase58()}`);
    return decodeRegistry(registry, info);
  }

  async getPlayerCv(player: PublicKey | string): Promise<PlayerCvState> {
    const pda = this.derivePlayerCvPda(player);
    const connection = this.getConnection(this.backend === 'magicblock');
    const info = await connection.getAccountInfo(pda, this.commitment);
    if (!info) throw new Error(`Player CV account not found: ${pda.toBase58()}`);
    return decodePlayerCv(pda, info);
  }

  async getPlayerGameCv(player: PublicKey | string, gameId: Uint8Array): Promise<PlayerGameCvState> {
    const pda = this.derivePlayerGameCvPda(player, gameId);
    const connection = this.getConnection(this.backend === 'magicblock');
    const info = await connection.getAccountInfo(pda, this.commitment);
    if (!info) throw new Error(`Player game CV account not found: ${pda.toBase58()}`);
    return decodePlayerGameCv(pda, info);
  }

  async getMatchProvenance(
    player: PublicKey | string,
    gameId: Uint8Array,
    matchId: Uint8Array,
  ): Promise<MatchProvenanceState> {
    const pda = this.deriveMatchProvenancePda(player, gameId, matchId);
    const connection = this.getConnection(this.backend === 'magicblock');
    const info = await connection.getAccountInfo(pda, this.commitment);
    if (!info) throw new Error(`Match provenance account not found: ${pda.toBase58()}`);
    return decodeMatchProvenance(pda, info);
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
    await connection.confirmTransaction({ signature, ...latest }, this.commitment);
    return {
      backendUsed: delegated && this.backend === 'magicblock' ? 'magicblock' : 'local',
      rpcUrl: connection.rpcEndpoint,
      signature,
    };
  }
}

export function createMagicBlockProvenanceRegistryClient(
  config: ProvenanceRegistryClientConfig,
): MagicBlockProvenanceRegistryClient {
  return new MagicBlockProvenanceRegistryClient(config);
}

function decodeRegistry(publicKey: PublicKey, info: AccountInfo<Buffer>): ProvenanceRegistryState {
  const data = new Uint8Array(info.data);
  requireDiscriminator(data, ACCOUNT_DISCRIMINATORS.ProvenanceRegistry, 'ProvenanceRegistry');
  const c = new Cursor(data, 8);
  const admin = c.pubkey();
  const paused = c.bool();
  c.u8(); // bump
  c.skip(6); // reserved
  const trustedSignerLen = c.u32Number();
  const trustedSigners: PublicKey[] = [];
  for (let i = 0; i < trustedSignerLen; i++) trustedSigners.push(c.pubkey());
  const createdAtUnix = c.i64Number();
  const updatedAtUnix = c.i64Number();
  return {
    publicKey,
    admin,
    paused,
    trustedSigners,
    createdAtUnix,
    updatedAtUnix,
  };
}

function decodePlayerCv(publicKey: PublicKey, info: AccountInfo<Buffer>): PlayerCvState {
  const data = new Uint8Array(info.data);
  requireDiscriminator(data, ACCOUNT_DISCRIMINATORS.PlayerCv, 'PlayerCv');
  const c = new Cursor(data, 8);
  const registry = c.pubkey();
  const player = c.pubkey();
  const gamesPlayed = c.u64BigInt();
  const wins = c.u64BigInt();
  const kills = c.u64BigInt();
  const deaths = c.u64BigInt();
  const assists = c.u64BigInt();
  const score = c.u64BigInt();
  const matchesRecorded = c.u64BigInt();
  const lastMatchAtUnix = c.i64Number();
  c.u8(); // bump
  c.skip(7); // reserved
  const createdAtUnix = c.i64Number();
  const updatedAtUnix = c.i64Number();
  return {
    publicKey,
    registry,
    player,
    gamesPlayed,
    wins,
    kills,
    deaths,
    assists,
    score,
    matchesRecorded,
    lastMatchAtUnix,
    createdAtUnix,
    updatedAtUnix,
  };
}

function decodePlayerGameCv(publicKey: PublicKey, info: AccountInfo<Buffer>): PlayerGameCvState {
  const data = new Uint8Array(info.data);
  requireDiscriminator(data, ACCOUNT_DISCRIMINATORS.PlayerGameCv, 'PlayerGameCv');
  const c = new Cursor(data, 8);
  const registry = c.pubkey();
  const player = c.pubkey();
  const gameId = c.fixed(32);
  const gamesPlayed = c.u64BigInt();
  const wins = c.u64BigInt();
  const kills = c.u64BigInt();
  const deaths = c.u64BigInt();
  const assists = c.u64BigInt();
  const score = c.u64BigInt();
  const matchesRecorded = c.u64BigInt();
  const lastMatchAtUnix = c.i64Number();
  c.u8(); // bump
  c.skip(7); // reserved
  const createdAtUnix = c.i64Number();
  const updatedAtUnix = c.i64Number();
  return {
    publicKey,
    registry,
    player,
    gameId,
    gamesPlayed,
    wins,
    kills,
    deaths,
    assists,
    score,
    matchesRecorded,
    lastMatchAtUnix,
    createdAtUnix,
    updatedAtUnix,
  };
}

function decodeMatchProvenance(publicKey: PublicKey, info: AccountInfo<Buffer>): MatchProvenanceState {
  const data = new Uint8Array(info.data);
  requireDiscriminator(data, ACCOUNT_DISCRIMINATORS.MatchProvenance, 'MatchProvenance');
  const c = new Cursor(data, 8);
  const registry = c.pubkey();
  const player = c.pubkey();
  const gameId = c.fixed(32);
  const matchId = c.fixed(32);
  const reporter = c.pubkey();
  const finalStateHash = c.fixed(32);
  const logHash = c.fixed(32);
  const provenanceHash = c.fixed(32);
  const kills = c.u32Number();
  const deaths = c.u32Number();
  const assists = c.u32Number();
  const score = c.u32Number();
  const won = c.bool();
  c.u8(); // bump
  c.skip(6); // reserved
  const recordedAtUnix = c.i64Number();
  const metadataUri = c.string();
  return {
    publicKey,
    registry,
    player,
    gameId,
    matchId,
    reporter,
    finalStateHash,
    logHash,
    provenanceHash,
    kills,
    deaths,
    assists,
    score,
    won,
    recordedAtUnix,
    metadataUri,
  };
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

function bool(value: boolean): Uint8Array {
  return new Uint8Array([value ? 1 : 0]);
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

function str(value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  return concat(u32(bytes.length, 'string length'), bytes);
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
    if (v < 0n || v > U64_MAX) throw new Error('u64 out of range');
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

  string(): string {
    const len = this.u32Number();
    const bytes = this.fixed(len);
    return new TextDecoder().decode(bytes);
  }

  pubkey(): PublicKey {
    return new PublicKey(this.fixed(32));
  }

  private ensure(n: number): void {
    if (this.offset + n > this.data.length) throw new Error('Unexpected end of account data');
  }
}

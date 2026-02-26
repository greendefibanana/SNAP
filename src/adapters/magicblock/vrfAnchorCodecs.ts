import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type {
  MagicBlockVrfInstructionCodec,
  SnapVrfInstructionCodec,
  SnapVrfNamespace,
  SnapVrfRandomnessType,
} from './vrfTypes.js';

type IdlPrimitive =
  | 'bool'
  | 'u8'
  | 'i8'
  | 'u16'
  | 'i16'
  | 'u32'
  | 'i32'
  | 'u64'
  | 'i64'
  | 'u128'
  | 'i128'
  | 'string'
  | 'bytes'
  | 'pubkey'
  | 'publicKey';

type IdlTypeNode =
  | IdlPrimitive
  | { array: [IdlTypeNode, number] }
  | { vec: IdlTypeNode }
  | { option: IdlTypeNode }
  | { defined: string | { name: string } }
  | { tuple: IdlTypeNode[] };

interface IdlField {
  name: string;
  type: IdlTypeNode;
}

interface IdlTypeDef {
  name: string;
  type: { kind: 'enum'; variants: { name: string; fields?: IdlField[] }[] } | { kind: 'struct'; fields: IdlField[] };
}

interface IdlAccountItem {
  name: string;
  isMut?: boolean;
  isSigner?: boolean;
  writable?: boolean;
  signer?: boolean;
  accounts?: IdlAccountItem[];
}

interface IdlInstruction {
  name: string;
  discriminator?: number[];
  args: IdlField[];
  accounts: IdlAccountItem[];
}

export interface AnchorIdlLike {
  instructions: IdlInstruction[];
  types?: IdlTypeDef[];
}

interface WritableSigner {
  pubkey: PublicKey;
  isWritable: boolean;
  isSigner: boolean;
}

interface SnapCodecFactoryConfig {
  idl: AnchorIdlLike;
}

interface MagicBlockCodecFactoryConfig {
  idl: AnchorIdlLike;
  instructionName: string;
  accountResolver: (input: {
    signer: PublicKey;
    enginePda: PublicKey;
    matchPda: PublicKey;
    requestPda: PublicKey;
    namespace: SnapVrfNamespace;
    requestId: bigint;
    requestNonce: bigint;
  }) => Record<string, WritableSigner | PublicKey>;
  argResolver: (input: {
    namespace: SnapVrfNamespace;
    requestId: bigint;
    requestNonce: bigint;
    signer: PublicKey;
    enginePda: PublicKey;
    matchPda: PublicKey;
    requestPda: PublicKey;
  }) => Record<string, unknown>;
  resolveExternalRequestId?: MagicBlockVrfInstructionCodec['resolveExternalRequestId'];
}

const RANDOMNESS_TYPE_VARIANTS: Record<SnapVrfRandomnessType, string> = {
  DROP: 'Drop',
  MATCH_SEED: 'MatchSeed',
  LOOT: 'Loot',
  CARD: 'Card',
  ARENA_EVENT: 'ArenaEvent',
  GENERIC: 'Generic',
};

const NAMESPACE_VARIANTS: Record<SnapVrfNamespace, string> = {
  DROP: 'Drop',
  MATCH_RULE: 'MatchRule',
  LOOT: 'Loot',
  CARD: 'Card',
  ARENA_EVENT: 'ArenaEvent',
};

class BytesWriter {
  private chunks: Uint8Array[] = [];
  private size = 0;

  push(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  writeU8(value: number): void {
    this.push(Uint8Array.of(value & 0xff));
  }

  writeBool(value: boolean): void {
    this.writeU8(value ? 1 : 0);
  }

  writeU16(value: number): void {
    const out = new Uint8Array(2);
    out[0] = value & 0xff;
    out[1] = (value >>> 8) & 0xff;
    this.push(out);
  }

  writeU32(value: number): void {
    const out = new Uint8Array(4);
    out[0] = value & 0xff;
    out[1] = (value >>> 8) & 0xff;
    out[2] = (value >>> 16) & 0xff;
    out[3] = (value >>> 24) & 0xff;
    this.push(out);
  }

  writeU64(value: bigint): void {
    const out = new Uint8Array(8);
    let v = value;
    for (let i = 0; i < 8; i++) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    this.push(out);
  }

  writeI64(value: bigint): void {
    this.writeU64(BigInt.asUintN(64, value));
  }

  writeU128(value: bigint): void {
    const out = new Uint8Array(16);
    let v = value;
    for (let i = 0; i < 16; i++) {
      out[i] = Number(v & 0xffn);
      v >>= 8n;
    }
    this.push(out);
  }

  writeI128(value: bigint): void {
    this.writeU128(BigInt.asUintN(128, value));
  }

  writeBytes(bytes: Uint8Array): void {
    this.push(bytes);
  }

  writeString(value: string): void {
    const bytes = new TextEncoder().encode(value);
    this.writeU32(bytes.length >>> 0);
    this.push(bytes);
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}

function asBytes32(value: unknown, fieldName: string): Uint8Array {
  if (value instanceof Uint8Array && value.length === 32) return value;
  throw new Error(`${fieldName} must be a 32-byte Uint8Array`);
}

function asBool(value: unknown, fieldName: string): boolean {
  if (typeof value === 'boolean') return value;
  throw new Error(`${fieldName} must be boolean`);
}

function asNumber(value: unknown, fieldName: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  throw new Error(`${fieldName} must be number`);
}

function asBigint(value: unknown, fieldName: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return BigInt(value);
  throw new Error(`${fieldName} must be bigint/number/string bigint`);
}

function asString(value: unknown, fieldName: string): string {
  if (typeof value === 'string') return value;
  throw new Error(`${fieldName} must be string`);
}

function findInstruction(idl: AnchorIdlLike, instructionName: string): IdlInstruction {
  const ix = idl.instructions.find((i) => i.name === instructionName);
  if (!ix) throw new Error(`Instruction not found in IDL: ${instructionName}`);
  return ix;
}

function toSnakeCase(input: string): string {
  return input.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

function toCamelCase(input: string): string {
  return input.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function lookupByAlias<T>(source: Record<string, T>, key: string): T | undefined {
  return source[key] ?? source[toSnakeCase(key)] ?? source[toCamelCase(key)];
}

function findTypeDef(idl: AnchorIdlLike, name: string): IdlTypeDef {
  const def = idl.types?.find((t) => t.name === name);
  if (!def) throw new Error(`Defined type not found in IDL: ${name}`);
  return def;
}

function resolveDiscriminator(ix: IdlInstruction): Uint8Array {
  if (!Array.isArray(ix.discriminator) || ix.discriminator.length !== 8) {
    throw new Error(
      `Instruction "${ix.name}" is missing 8-byte discriminator in IDL. Provide modern Anchor IDL with discriminators.`,
    );
  }
  return Uint8Array.from(ix.discriminator.map((n) => n & 0xff));
}

function normalizeDefinedName(node: { defined: string | { name: string } }): string {
  if (typeof node.defined === 'string') return node.defined;
  return node.defined.name;
}

function encodeType(
  writer: BytesWriter,
  idl: AnchorIdlLike,
  typeNode: IdlTypeNode,
  value: unknown,
  fieldName: string,
): void {
  if (typeof typeNode === 'string') {
    if (typeNode === 'bool') return writer.writeBool(asBool(value, fieldName));
    if (typeNode === 'u8' || typeNode === 'i8') return writer.writeU8(asNumber(value, fieldName));
    if (typeNode === 'u16' || typeNode === 'i16') return writer.writeU16(asNumber(value, fieldName));
    if (typeNode === 'u32' || typeNode === 'i32') return writer.writeU32(asNumber(value, fieldName));
    if (typeNode === 'u64') return writer.writeU64(asBigint(value, fieldName));
    if (typeNode === 'i64') return writer.writeI64(asBigint(value, fieldName));
    if (typeNode === 'u128') return writer.writeU128(asBigint(value, fieldName));
    if (typeNode === 'i128') return writer.writeI128(asBigint(value, fieldName));
    if (typeNode === 'string') return writer.writeString(asString(value, fieldName));
    if (typeNode === 'bytes') {
      if (!(value instanceof Uint8Array)) throw new Error(`${fieldName} must be Uint8Array`);
      writer.writeU32(value.length >>> 0);
      return writer.writeBytes(value);
    }
    if (typeNode === 'pubkey' || typeNode === 'publicKey') {
      if (value instanceof PublicKey) return writer.writeBytes(value.toBytes());
      return writer.writeBytes(asBytes32(value, fieldName));
    }
    throw new Error(`Unsupported primitive IDL type: ${typeNode}`);
  }

  if ('array' in typeNode) {
    const [inner, len] = typeNode.array;
    if (!(value instanceof Uint8Array) && !Array.isArray(value)) {
      throw new Error(`${fieldName} must be array/Uint8Array`);
    }
    const arr = value instanceof Uint8Array ? [...value] : value;
    if (arr.length !== len) throw new Error(`${fieldName} must have length ${len}`);
    for (let i = 0; i < len; i++) encodeType(writer, idl, inner, arr[i], `${fieldName}[${i}]`);
    return;
  }

  if ('vec' in typeNode) {
    if (!(value instanceof Uint8Array) && !Array.isArray(value)) throw new Error(`${fieldName} must be vector`);
    const arr = value instanceof Uint8Array ? [...value] : value;
    writer.writeU32(arr.length >>> 0);
    for (let i = 0; i < arr.length; i++) encodeType(writer, idl, typeNode.vec, arr[i], `${fieldName}[${i}]`);
    return;
  }

  if ('option' in typeNode) {
    if (value === null || value === undefined) {
      writer.writeU8(0);
      return;
    }
    writer.writeU8(1);
    encodeType(writer, idl, typeNode.option, value, fieldName);
    return;
  }

  if ('tuple' in typeNode) {
    if (!Array.isArray(value)) throw new Error(`${fieldName} must be tuple array`);
    if (value.length !== typeNode.tuple.length) throw new Error(`${fieldName} tuple length mismatch`);
    for (let i = 0; i < typeNode.tuple.length; i++) {
      encodeType(writer, idl, typeNode.tuple[i]!, value[i], `${fieldName}[${i}]`);
    }
    return;
  }

  if ('defined' in typeNode) {
    const defName = normalizeDefinedName(typeNode);
    const def = findTypeDef(idl, defName);
    if (def.type.kind === 'enum') {
      const enumInput = typeof value === 'string' ? value : (value as { variant?: string })?.variant;
      if (!enumInput) throw new Error(`${fieldName} enum requires variant string`);
      const variantIdx = def.type.variants.findIndex((v) => v.name === enumInput);
      if (variantIdx < 0) throw new Error(`${fieldName} variant not found: ${enumInput}`);
      writer.writeU8(variantIdx);
      const variant = def.type.variants[variantIdx]!;
      if (!variant.fields || variant.fields.length === 0) return;
      const fieldsObj = (value as { fields?: Record<string, unknown> })?.fields ?? {};
      for (const f of variant.fields) encodeType(writer, idl, f.type, fieldsObj[f.name], `${fieldName}.${f.name}`);
      return;
    }
    if (def.type.kind === 'struct') {
      const obj = value as Record<string, unknown>;
      if (!obj || typeof obj !== 'object') throw new Error(`${fieldName} struct requires object`);
      for (const f of def.type.fields) encodeType(writer, idl, f.type, obj[f.name], `${fieldName}.${f.name}`);
      return;
    }
  }

  throw new Error(`Unsupported IDL type node for ${fieldName}`);
}

function encodeInstructionData(
  idl: AnchorIdlLike,
  instructionName: string,
  args: Record<string, unknown>,
): Uint8Array {
  const ix = findInstruction(idl, instructionName);
  const writer = new BytesWriter();
  writer.writeBytes(resolveDiscriminator(ix));
  for (const arg of ix.args) {
    encodeType(writer, idl, arg.type, lookupByAlias(args, arg.name), arg.name);
  }
  return writer.finish();
}

function flattenAccounts(items: IdlAccountItem[]): IdlAccountItem[] {
  const out: IdlAccountItem[] = [];
  for (const item of items) {
    if (item.accounts && item.accounts.length > 0) {
      out.push(...flattenAccounts(item.accounts));
    } else {
      out.push(item);
    }
  }
  return out;
}

function resolveMetaFlags(account: IdlAccountItem): { isWritable: boolean; isSigner: boolean } {
  return {
    isWritable: Boolean(account.writable ?? account.isMut),
    isSigner: Boolean(account.signer ?? account.isSigner),
  };
}

function accountMetaListFromIdl(
  idl: AnchorIdlLike,
  instructionName: string,
  accountMap: Record<string, WritableSigner | PublicKey>,
) {
  const ix = findInstruction(idl, instructionName);
  const flat = flattenAccounts(ix.accounts);
  return flat.map((a) => {
    const resolved = lookupByAlias(accountMap, a.name);
    if (!resolved) throw new Error(`Missing account mapping for "${a.name}" in instruction "${instructionName}"`);
    const flags = resolveMetaFlags(a);
    if (resolved instanceof PublicKey) {
      return { pubkey: resolved, isWritable: flags.isWritable, isSigner: flags.isSigner };
    }
    return {
      pubkey: resolved.pubkey,
      isWritable: resolved.isWritable ?? flags.isWritable,
      isSigner: resolved.isSigner ?? flags.isSigner,
    };
  });
}

export function createSnapVrfInstructionCodecFromIdl(config: SnapCodecFactoryConfig): SnapVrfInstructionCodec {
  const idl = config.idl;
  return {
    buildInitializeMatchIx(input) {
      const data = encodeInstructionData(idl, 'initialize_match', {
        match_id: input.matchId,
        game_id: input.gameId,
      });
      return new TransactionInstruction({
        programId: input.programId,
        keys: accountMetaListFromIdl(idl, 'initialize_match', {
          payer: { pubkey: input.signer, isSigner: true, isWritable: true },
          engine: input.enginePda,
          match_state: input.matchPda,
          system_program: SystemProgram.programId,
        }),
        data: Buffer.from(data),
      });
    },

    buildRequestRandomnessIx(input) {
      const data = encodeInstructionData(idl, 'request_randomness', {
        request_id: input.requestId,
        randomness_type: RANDOMNESS_TYPE_VARIANTS[input.randomnessType],
        namespace: NAMESPACE_VARIANTS[input.namespace],
        request_nonce: input.requestNonce,
        metadata: input.metadata32,
      });
      return new TransactionInstruction({
        programId: input.programId,
        keys: accountMetaListFromIdl(idl, 'request_randomness', {
          requester: { pubkey: input.signer, isSigner: true, isWritable: true },
          engine: input.enginePda,
          match_state: input.matchPda,
          request: input.requestPda,
          system_program: SystemProgram.programId,
        }),
        data: Buffer.from(data),
      });
    },

    buildRecordExternalRequestIdIx(input) {
      const data = encodeInstructionData(idl, 'record_external_request_id', {
        external_request_id: input.externalRequestId32,
      });
      return new TransactionInstruction({
        programId: input.programId,
        keys: accountMetaListFromIdl(idl, 'record_external_request_id', {
          admin: { pubkey: input.admin, isSigner: true, isWritable: false },
          engine: input.enginePda,
          request: input.requestPda,
        }),
        data: Buffer.from(data),
      });
    },

    buildFulfillRandomnessIx(input) {
      const data = encodeInstructionData(idl, 'fulfill_randomness', {
        vrf_seed: input.vrfSeed32,
        vrf_output: input.vrfOutput32,
      });
      return new TransactionInstruction({
        programId: input.programId,
        keys: accountMetaListFromIdl(idl, 'fulfill_randomness', {
          vrf_authority: { pubkey: input.vrfAuthority, isSigner: true, isWritable: false },
          engine: input.enginePda,
          match_state: input.matchPda,
          request: input.requestPda,
        }),
        data: Buffer.from(data),
      });
    },

    buildConsumeRandomnessIx(input) {
      const data = encodeInstructionData(idl, 'consume_randomness', {});
      return new TransactionInstruction({
        programId: input.programId,
        keys: accountMetaListFromIdl(idl, 'consume_randomness', {
          consumer: { pubkey: input.consumer, isSigner: true, isWritable: false },
          engine: input.enginePda,
          match_state: input.matchPda,
          request: input.requestPda,
          namespace_config: input.namespaceConfigPda,
        }),
        data: Buffer.from(data),
      });
    },
  };
}

export function createMagicBlockVrfInstructionCodecFromIdl(
  config: MagicBlockCodecFactoryConfig,
): MagicBlockVrfInstructionCodec {
  const { idl, instructionName, accountResolver, argResolver } = config;
  return {
    buildVrfRequestIx(input) {
      const accountMap = accountResolver({
        signer: input.signer,
        enginePda: input.enginePda,
        matchPda: input.matchPda,
        requestPda: input.requestPda,
        namespace: input.namespace,
        requestId: input.requestId,
        requestNonce: input.requestNonce,
      });
      const args = argResolver({
        namespace: input.namespace,
        requestId: input.requestId,
        requestNonce: input.requestNonce,
        signer: input.signer,
        enginePda: input.enginePda,
        matchPda: input.matchPda,
        requestPda: input.requestPda,
      });
      const data = encodeInstructionData(idl, instructionName, args);
      const keys = accountMetaListFromIdl(idl, instructionName, accountMap);
      return new TransactionInstruction({
        programId: input.magicBlockVrfProgramId,
        keys,
        data: Buffer.from(data),
      });
    },
    resolveExternalRequestId: config.resolveExternalRequestId,
  };
}

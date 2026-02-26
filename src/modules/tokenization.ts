import type { SnapManifest, SnapState } from '../engine/types.js';
import type { SnapModule } from './types.js';

type TokenType = 'NFT' | 'FT';
type ChainBackendHint = 'any' | 'solana' | 'magicblock';

interface TokenMediaSpec {
  kind: '2d' | '3d' | 'any';
  uri: string;
  previewUri?: string;
  modelUri?: string;
  animationUri?: string;
  format?: string;
  attributes?: Record<string, unknown>;
}

interface TokenEconomicsSpec {
  mintPrice?: number;
  currencyMint?: string;
  royaltyBps?: number;
}

interface TokenChainSpec {
  backend?: ChainBackendHint;
  useEphemeralRollup?: boolean;
  priorityFeeLamports?: number;
  programId?: string;
  collectionAddress?: string;
  mintAddress?: string;
}

interface TokenClass {
  classId: string;
  tokenType: TokenType;
  standard: string;
  decimals: number;
  maxSupply: number | null;
  mintedSupply: number;
  burnedSupply: number;
  mintAuthority: string;
  freezeAuthority: string | null;
  transferable: boolean;
  burnable: boolean;
  mutableMetadata: boolean;
  metadataSchema: Record<string, unknown>;
  media: TokenMediaSpec;
  economics: TokenEconomicsSpec;
  chain: TokenChainSpec;
  tags: string[];
}

interface TokenNftInstance {
  tokenId: string;
  classId: string;
  owner: string;
  mintedAtT: number;
  metadataOverrides?: Record<string, unknown>;
}

interface TokenizationEvent {
  eventId: string;
  kind: string;
  t: number;
  classId: string;
  actor: string;
  amount?: number;
  from?: string;
  to?: string;
  tokenId?: string;
  txRef?: string;
  backendHint?: ChainBackendHint;
}

interface TokenizationRulesConfig {
  defaultStandard: string;
  defaultBackendHint: ChainBackendHint;
  defaultUseEphemeralRollup: boolean;
  defaultMintAuthority: string;
  defaultTransferable: boolean;
  defaultBurnable: boolean;
  historyLimit: number;
  allowMetadataMutation: boolean;
}

interface TokenizationModuleState extends Record<string, unknown> {
  classesById: Record<string, TokenClass>;
  ftBalances: Record<string, Record<string, number>>;
  nftByTokenId: Record<string, TokenNftInstance>;
  nftIdsByClass: Record<string, string[]>;
  eventLog: TokenizationEvent[];
}

function toStringValue(input: unknown, fallback = ''): string {
  const s = String(input ?? '').trim();
  return s.length > 0 ? s : fallback;
}

function toPositiveNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function toNonNegativeNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function toInteger(input: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input;
  return fallback;
}

function toBackendHint(input: unknown, fallback: ChainBackendHint): ChainBackendHint {
  if (input === 'solana' || input === 'magicblock' || input === 'any') {
    return input;
  }
  return fallback;
}

function cloneMapOfNumbers(input: unknown): Record<string, number> {
  if (!input || typeof input !== 'object') return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    const key = toStringValue(k);
    const n = Number(v);
    if (!key || !Number.isFinite(n) || n < 0) continue;
    out[key] = n;
  }
  return out;
}

function readTokenizationRules(manifest: SnapManifest): TokenizationRulesConfig {
  const cfg = (manifest.moduleConfig?.tokenization ?? {}) as Record<string, unknown>;
  return {
    defaultStandard: toStringValue(cfg.defaultStandard, 'SPL'),
    defaultBackendHint: toBackendHint(cfg.defaultBackendHint, 'magicblock'),
    defaultUseEphemeralRollup: toBool(cfg.defaultUseEphemeralRollup, true),
    defaultMintAuthority: toStringValue(cfg.defaultMintAuthority, ''),
    defaultTransferable: toBool(cfg.defaultTransferable, true),
    defaultBurnable: toBool(cfg.defaultBurnable, true),
    historyLimit: toInteger(cfg.historyLimit, 300, 1, 10000),
    allowMetadataMutation: toBool(cfg.allowMetadataMutation, true),
  };
}

function sanitizeMedia(input: unknown): TokenMediaSpec {
  const raw = (input ?? {}) as Record<string, unknown>;
  const kindRaw = toStringValue(raw.kind, 'any').toLowerCase();
  const kind = kindRaw === '2d' || kindRaw === '3d' ? kindRaw : 'any';
  const uri = toStringValue(raw.uri);
  if (!uri) throw new Error('TOKEN_CLASS_DEFINE requires media.uri');
  return {
    kind,
    uri,
    ...(toStringValue(raw.previewUri) ? { previewUri: toStringValue(raw.previewUri) } : {}),
    ...(toStringValue(raw.modelUri) ? { modelUri: toStringValue(raw.modelUri) } : {}),
    ...(toStringValue(raw.animationUri) ? { animationUri: toStringValue(raw.animationUri) } : {}),
    ...(toStringValue(raw.format) ? { format: toStringValue(raw.format) } : {}),
    ...(raw.attributes && typeof raw.attributes === 'object'
      ? { attributes: { ...(raw.attributes as Record<string, unknown>) } }
      : {}),
  };
}

function sanitizeEconomics(input: unknown): TokenEconomicsSpec {
  const raw = (input ?? {}) as Record<string, unknown>;
  const mintPrice = Number(raw.mintPrice);
  const royaltyBps = Number(raw.royaltyBps);
  return {
    ...(Number.isFinite(mintPrice) && mintPrice >= 0 ? { mintPrice } : {}),
    ...(toStringValue(raw.currencyMint) ? { currencyMint: toStringValue(raw.currencyMint) } : {}),
    ...(Number.isFinite(royaltyBps) && royaltyBps >= 0 ? { royaltyBps: Math.min(10000, royaltyBps) } : {}),
  };
}

function sanitizeChain(input: unknown, rules: TokenizationRulesConfig): TokenChainSpec {
  const raw = (input ?? {}) as Record<string, unknown>;
  const priorityFeeLamports = Number(raw.priorityFeeLamports);
  return {
    backend: toBackendHint(raw.backend, rules.defaultBackendHint),
    useEphemeralRollup: toBool(raw.useEphemeralRollup, rules.defaultUseEphemeralRollup),
    ...(Number.isFinite(priorityFeeLamports) && priorityFeeLamports >= 0 ? { priorityFeeLamports } : {}),
    ...(toStringValue(raw.programId) ? { programId: toStringValue(raw.programId) } : {}),
    ...(toStringValue(raw.collectionAddress) ? { collectionAddress: toStringValue(raw.collectionAddress) } : {}),
    ...(toStringValue(raw.mintAddress) ? { mintAddress: toStringValue(raw.mintAddress) } : {}),
  };
}

function ensureState(state: SnapState): TokenizationModuleState {
  const existing = state.modules.tokenization as TokenizationModuleState | undefined;
  if (!existing || typeof existing !== 'object') {
    return {
      classesById: {},
      ftBalances: {},
      nftByTokenId: {},
      nftIdsByClass: {},
      eventLog: [],
    };
  }

  const classesById: Record<string, TokenClass> = {};
  if (existing.classesById && typeof existing.classesById === 'object') {
    for (const [classId, rawClass] of Object.entries(existing.classesById)) {
      if (!rawClass || typeof rawClass !== 'object') continue;
      const c = rawClass as TokenClass;
      const key = toStringValue(classId);
      if (!key) continue;
      const tokenType: TokenType = c.tokenType === 'NFT' ? 'NFT' : 'FT';
      classesById[key] = {
        classId: key,
        tokenType,
        standard: toStringValue(c.standard, 'SPL'),
        decimals: toInteger(c.decimals, tokenType === 'NFT' ? 0 : 0, 0, 12),
        maxSupply: Number.isFinite(c.maxSupply) ? Math.max(1, Number(c.maxSupply)) : null,
        mintedSupply: toNonNegativeNumber(c.mintedSupply, 0),
        burnedSupply: toNonNegativeNumber(c.burnedSupply, 0),
        mintAuthority: toStringValue(c.mintAuthority),
        freezeAuthority: toStringValue(c.freezeAuthority) || null,
        transferable: Boolean(c.transferable),
        burnable: Boolean(c.burnable),
        mutableMetadata: Boolean(c.mutableMetadata),
        metadataSchema: c.metadataSchema && typeof c.metadataSchema === 'object'
          ? { ...(c.metadataSchema as Record<string, unknown>) }
          : {},
        media: c.media ?? { kind: 'any', uri: '' },
        economics: c.economics ?? {},
        chain: c.chain ?? {},
        tags: Array.isArray(c.tags) ? c.tags.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0) : [],
      };
    }
  }

  const ftBalances: Record<string, Record<string, number>> = {};
  if (existing.ftBalances && typeof existing.ftBalances === 'object') {
    for (const [classId, balancesRaw] of Object.entries(existing.ftBalances)) {
      const key = toStringValue(classId);
      if (!key) continue;
      ftBalances[key] = cloneMapOfNumbers(balancesRaw);
    }
  }

  const nftByTokenId: Record<string, TokenNftInstance> = {};
  if (existing.nftByTokenId && typeof existing.nftByTokenId === 'object') {
    for (const [tokenId, rawNft] of Object.entries(existing.nftByTokenId)) {
      if (!rawNft || typeof rawNft !== 'object') continue;
      const nft = rawNft as TokenNftInstance;
      const safeTokenId = toStringValue(tokenId);
      const classId = toStringValue(nft.classId);
      const owner = toStringValue(nft.owner);
      if (!safeTokenId || !classId || !owner) continue;
      nftByTokenId[safeTokenId] = {
        tokenId: safeTokenId,
        classId,
        owner,
        mintedAtT: toNonNegativeNumber(nft.mintedAtT, 0),
        ...(nft.metadataOverrides && typeof nft.metadataOverrides === 'object'
          ? { metadataOverrides: { ...(nft.metadataOverrides as Record<string, unknown>) } }
          : {}),
      };
    }
  }

  const nftIdsByClass: Record<string, string[]> = {};
  for (const nft of Object.values(nftByTokenId)) {
    if (!nftIdsByClass[nft.classId]) nftIdsByClass[nft.classId] = [];
    nftIdsByClass[nft.classId]!.push(nft.tokenId);
  }

  const eventLog = Array.isArray(existing.eventLog)
    ? existing.eventLog
        .map((e) => {
          if (!e || typeof e !== 'object') return null;
          const raw = e as TokenizationEvent;
          const eventId = toStringValue(raw.eventId);
          const kind = toStringValue(raw.kind);
          const classId = toStringValue(raw.classId);
          const actor = toStringValue(raw.actor);
          if (!eventId || !kind || !classId || !actor) return null;
          return {
            eventId,
            kind,
            t: toNonNegativeNumber(raw.t, 0),
            classId,
            actor,
            ...(Number.isFinite(raw.amount) ? { amount: Number(raw.amount) } : {}),
            ...(toStringValue(raw.from) ? { from: toStringValue(raw.from) } : {}),
            ...(toStringValue(raw.to) ? { to: toStringValue(raw.to) } : {}),
            ...(toStringValue(raw.tokenId) ? { tokenId: toStringValue(raw.tokenId) } : {}),
            ...(toStringValue(raw.txRef) ? { txRef: toStringValue(raw.txRef) } : {}),
            ...(raw.backendHint ? { backendHint: raw.backendHint } : {}),
          } as TokenizationEvent;
        })
        .filter((v): v is TokenizationEvent => Boolean(v))
    : [];

  return {
    classesById,
    ftBalances,
    nftByTokenId,
    nftIdsByClass,
    eventLog,
  };
}

function sumMap(map: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(map)) total += Number(v ?? 0);
  return total;
}

function pushEvent(events: TokenizationEvent[], e: TokenizationEvent, limit: number): TokenizationEvent[] {
  const next = events.concat(e);
  if (next.length <= limit) return next;
  return next.slice(next.length - limit);
}

function requireClass(state: TokenizationModuleState, classId: string, actionKind: string): TokenClass {
  const tokenClass = state.classesById[classId];
  if (!tokenClass) throw new Error(`${actionKind} unknown classId '${classId}'`);
  return tokenClass;
}

function nextNftTokenId(classId: string, state: TokenizationModuleState): string {
  const ids = state.nftIdsByClass[classId] ?? [];
  return `nft:${classId}:${ids.length + 1}`;
}

export function createTokenizationModule(): SnapModule {
  return {
    id: 'tokenization',
    init(_manifest, state) {
      return {
        ...state,
        modules: {
          ...state.modules,
          tokenization: ensureState(state),
        },
      };
    },
    validateAction(action, manifest, state) {
      const rules = readTokenizationRules(manifest);
      const tokenization = ensureState(state);
      const payload = (action.payload ?? {}) as Record<string, unknown>;

      if (action.kind === 'TOKEN_CLASS_DEFINE') {
        const classId = toStringValue(payload.classId);
        if (!classId) throw new Error('TOKEN_CLASS_DEFINE requires classId');
        if (tokenization.classesById[classId]) {
          throw new Error(`TOKEN_CLASS_DEFINE classId '${classId}' already exists`);
        }
        const tokenType = toStringValue(payload.tokenType, 'NFT').toUpperCase();
        if (tokenType !== 'NFT' && tokenType !== 'FT') {
          throw new Error("TOKEN_CLASS_DEFINE tokenType must be 'NFT' or 'FT'");
        }
        const decimals = toInteger(payload.decimals, tokenType === 'NFT' ? 0 : 0, 0, 12);
        if (tokenType === 'NFT' && decimals !== 0) {
          throw new Error('TOKEN_CLASS_DEFINE NFT class must use decimals=0');
        }
        sanitizeMedia(payload.media);
        return;
      }

      if (action.kind === 'TOKEN_MINT') {
        const classId = toStringValue(payload.classId);
        if (!classId) throw new Error('TOKEN_MINT requires classId');
        const tokenClass = requireClass(tokenization, classId, 'TOKEN_MINT');
        const to = toStringValue(payload.to);
        if (!to) throw new Error('TOKEN_MINT requires to');
        const amount = Number(payload.amount ?? 1);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('TOKEN_MINT amount must be > 0');
        if (tokenClass.tokenType === 'NFT' && amount !== 1) {
          throw new Error('TOKEN_MINT amount must be 1 for NFT classes');
        }
        const nextSupply = tokenClass.mintedSupply + amount;
        if (tokenClass.maxSupply !== null && nextSupply > tokenClass.maxSupply) {
          throw new Error(`TOKEN_MINT exceeds maxSupply for class '${classId}'`);
        }
        if (tokenClass.mintAuthority && tokenClass.mintAuthority !== action.actor) {
          throw new Error(`TOKEN_MINT actor '${action.actor}' is not mintAuthority`);
        }
        return;
      }

      if (action.kind === 'TOKEN_TRANSFER') {
        const classId = toStringValue(payload.classId);
        if (!classId) throw new Error('TOKEN_TRANSFER requires classId');
        const tokenClass = requireClass(tokenization, classId, 'TOKEN_TRANSFER');
        if (!tokenClass.transferable) throw new Error(`TOKEN_TRANSFER disabled for class '${classId}'`);
        const from = toStringValue(payload.from, action.actor);
        const to = toStringValue(payload.to);
        if (!from || !to) throw new Error('TOKEN_TRANSFER requires from and to');
        if (tokenClass.tokenType === 'NFT') {
          const tokenId = toStringValue(payload.tokenId);
          if (!tokenId) throw new Error('TOKEN_TRANSFER for NFT requires tokenId');
          const nft = tokenization.nftByTokenId[tokenId];
          if (!nft || nft.classId !== classId) throw new Error(`TOKEN_TRANSFER unknown tokenId '${tokenId}'`);
          if (nft.owner !== from || action.actor !== from) {
            throw new Error(`TOKEN_TRANSFER actor must be NFT owner '${from}'`);
          }
        } else {
          const amount = Number(payload.amount ?? 0);
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('TOKEN_TRANSFER amount must be > 0');
          const balance = Number(tokenization.ftBalances[classId]?.[from] ?? 0);
          if (balance < amount) throw new Error(`TOKEN_TRANSFER insufficient balance for '${from}'`);
        }
        return;
      }

      if (action.kind === 'TOKEN_BURN') {
        const classId = toStringValue(payload.classId);
        if (!classId) throw new Error('TOKEN_BURN requires classId');
        const tokenClass = requireClass(tokenization, classId, 'TOKEN_BURN');
        if (!tokenClass.burnable) throw new Error(`TOKEN_BURN disabled for class '${classId}'`);
        if (tokenClass.tokenType === 'NFT') {
          const tokenId = toStringValue(payload.tokenId);
          if (!tokenId) throw new Error('TOKEN_BURN for NFT requires tokenId');
          const nft = tokenization.nftByTokenId[tokenId];
          if (!nft || nft.classId !== classId) throw new Error(`TOKEN_BURN unknown tokenId '${tokenId}'`);
          if (nft.owner !== action.actor) throw new Error('TOKEN_BURN actor must own NFT');
        } else {
          const amount = Number(payload.amount ?? 0);
          if (!Number.isFinite(amount) || amount <= 0) throw new Error('TOKEN_BURN amount must be > 0');
          const owner = toStringValue(payload.owner, action.actor);
          const balance = Number(tokenization.ftBalances[classId]?.[owner] ?? 0);
          if (balance < amount) throw new Error(`TOKEN_BURN insufficient FT balance for '${owner}'`);
        }
        return;
      }

      if (action.kind === 'TOKEN_METADATA_SET') {
        if (!rules.allowMetadataMutation) {
          throw new Error('TOKEN_METADATA_SET disabled by module config');
        }
        const classId = toStringValue(payload.classId);
        if (!classId) throw new Error('TOKEN_METADATA_SET requires classId');
        const tokenClass = requireClass(tokenization, classId, 'TOKEN_METADATA_SET');
        if (!tokenClass.mutableMetadata) {
          throw new Error(`TOKEN_METADATA_SET denied for immutable class '${classId}'`);
        }
        if (!payload.patch || typeof payload.patch !== 'object') {
          throw new Error('TOKEN_METADATA_SET requires object patch');
        }
      }
    },
    applyAction(action, manifest, state) {
      const rules = readTokenizationRules(manifest);
      const tokenization = ensureState(state);
      const payload = (action.payload ?? {}) as Record<string, unknown>;

      if (action.kind === 'TOKEN_CLASS_DEFINE') {
        const classId = toStringValue(payload.classId);
        const tokenType = (toStringValue(payload.tokenType, 'NFT').toUpperCase() === 'FT' ? 'FT' : 'NFT') as TokenType;
        const maxSupplyRaw = Number(payload.maxSupply);
        const maxSupply = Number.isFinite(maxSupplyRaw) ? Math.max(1, maxSupplyRaw) : null;
        const tokenClass: TokenClass = {
          classId,
          tokenType,
          standard: toStringValue(payload.standard, rules.defaultStandard),
          decimals: toInteger(payload.decimals, tokenType === 'NFT' ? 0 : 0, 0, 12),
          maxSupply,
          mintedSupply: 0,
          burnedSupply: 0,
          mintAuthority: toStringValue(payload.mintAuthority, rules.defaultMintAuthority || action.actor),
          freezeAuthority: toStringValue(payload.freezeAuthority) || null,
          transferable: toBool(payload.transferable, rules.defaultTransferable),
          burnable: toBool(payload.burnable, rules.defaultBurnable),
          mutableMetadata: toBool(payload.mutableMetadata, true),
          metadataSchema: payload.metadataSchema && typeof payload.metadataSchema === 'object'
            ? { ...(payload.metadataSchema as Record<string, unknown>) }
            : {},
          media: sanitizeMedia(payload.media),
          economics: sanitizeEconomics(payload.economics),
          chain: sanitizeChain(payload.chain, rules),
          tags: Array.isArray(payload.tags)
            ? payload.tags.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
            : [],
        };

        const eventId = `tok:${state.matchId}:${state.seq + 1}`;
        const event: TokenizationEvent = {
          eventId,
          kind: action.kind,
          t: action.t,
          classId,
          actor: action.actor,
          ...(tokenClass.chain.backend ? { backendHint: tokenClass.chain.backend } : {}),
        };

        return {
          ...state,
          modules: {
            ...state.modules,
            tokenization: {
              ...tokenization,
              classesById: {
                ...tokenization.classesById,
                [classId]: tokenClass,
              },
              ftBalances: {
                ...tokenization.ftBalances,
                ...(tokenType === 'FT' ? { [classId]: tokenization.ftBalances[classId] ?? {} } : {}),
              },
              nftIdsByClass: {
                ...tokenization.nftIdsByClass,
                ...(tokenType === 'NFT' ? { [classId]: tokenization.nftIdsByClass[classId] ?? [] } : {}),
              },
              eventLog: pushEvent(tokenization.eventLog, event, rules.historyLimit),
            },
          },
        };
      }

      if (action.kind === 'TOKEN_MINT') {
        const classId = toStringValue(payload.classId);
        const tokenClass = requireClass(tokenization, classId, action.kind);
        const to = toStringValue(payload.to);
        const amount = Number(payload.amount ?? 1);
        const txRef = toStringValue(payload.txRef);

        const nextClasses = { ...tokenization.classesById };
        nextClasses[classId] = {
          ...tokenClass,
          mintedSupply: tokenClass.mintedSupply + amount,
        };

        let nextFtBalances = tokenization.ftBalances;
        let nextNftByTokenId = tokenization.nftByTokenId;
        let nextNftIdsByClass = tokenization.nftIdsByClass;
        let tokenId: string | undefined;

        if (tokenClass.tokenType === 'FT') {
          const classBalances = {
            ...(tokenization.ftBalances[classId] ?? {}),
          };
          classBalances[to] = Number(classBalances[to] ?? 0) + amount;
          nextFtBalances = {
            ...tokenization.ftBalances,
            [classId]: classBalances,
          };
        } else {
          tokenId = toStringValue(payload.tokenId, nextNftTokenId(classId, tokenization));
          nextNftByTokenId = {
            ...tokenization.nftByTokenId,
            [tokenId]: {
              tokenId,
              classId,
              owner: to,
              mintedAtT: action.t,
              ...(payload.metadataOverrides && typeof payload.metadataOverrides === 'object'
                ? { metadataOverrides: { ...(payload.metadataOverrides as Record<string, unknown>) } }
                : {}),
            },
          };
          nextNftIdsByClass = {
            ...tokenization.nftIdsByClass,
            [classId]: (tokenization.nftIdsByClass[classId] ?? []).concat(tokenId),
          };
        }

        const event: TokenizationEvent = {
          eventId: `tok:${state.matchId}:${state.seq + 1}`,
          kind: action.kind,
          t: action.t,
          classId,
          actor: action.actor,
          amount,
          to,
          ...(tokenId ? { tokenId } : {}),
          ...(txRef ? { txRef } : {}),
          ...(tokenClass.chain.backend ? { backendHint: tokenClass.chain.backend } : {}),
        };

        return {
          ...state,
          modules: {
            ...state.modules,
            tokenization: {
              ...tokenization,
              classesById: nextClasses,
              ftBalances: nextFtBalances,
              nftByTokenId: nextNftByTokenId,
              nftIdsByClass: nextNftIdsByClass,
              eventLog: pushEvent(tokenization.eventLog, event, rules.historyLimit),
            },
          },
        };
      }

      if (action.kind === 'TOKEN_TRANSFER') {
        const classId = toStringValue(payload.classId);
        const tokenClass = requireClass(tokenization, classId, action.kind);
        const from = toStringValue(payload.from, action.actor);
        const to = toStringValue(payload.to);
        const txRef = toStringValue(payload.txRef);

        let nextFtBalances = tokenization.ftBalances;
        let nextNftByTokenId = tokenization.nftByTokenId;
        let amount = Number(payload.amount ?? 1);
        let tokenId = toStringValue(payload.tokenId);

        if (tokenClass.tokenType === 'FT') {
          const classBalances = { ...(tokenization.ftBalances[classId] ?? {}) };
          classBalances[from] = Number(classBalances[from] ?? 0) - amount;
          classBalances[to] = Number(classBalances[to] ?? 0) + amount;
          nextFtBalances = {
            ...tokenization.ftBalances,
            [classId]: classBalances,
          };
          tokenId = '';
        } else {
          amount = 1;
          const nft = tokenization.nftByTokenId[tokenId]!;
          nextNftByTokenId = {
            ...tokenization.nftByTokenId,
            [tokenId]: {
              ...nft,
              owner: to,
            },
          };
        }

        const event: TokenizationEvent = {
          eventId: `tok:${state.matchId}:${state.seq + 1}`,
          kind: action.kind,
          t: action.t,
          classId,
          actor: action.actor,
          amount,
          from,
          to,
          ...(tokenId ? { tokenId } : {}),
          ...(txRef ? { txRef } : {}),
          ...(tokenClass.chain.backend ? { backendHint: tokenClass.chain.backend } : {}),
        };

        return {
          ...state,
          modules: {
            ...state.modules,
            tokenization: {
              ...tokenization,
              ftBalances: nextFtBalances,
              nftByTokenId: nextNftByTokenId,
              eventLog: pushEvent(tokenization.eventLog, event, rules.historyLimit),
            },
          },
        };
      }

      if (action.kind === 'TOKEN_BURN') {
        const classId = toStringValue(payload.classId);
        const tokenClass = requireClass(tokenization, classId, action.kind);
        const txRef = toStringValue(payload.txRef);
        const nextClasses = { ...tokenization.classesById };
        let nextFtBalances = tokenization.ftBalances;
        let nextNftByTokenId = tokenization.nftByTokenId;
        let nextNftIdsByClass = tokenization.nftIdsByClass;
        let amount = Number(payload.amount ?? 1);
        let tokenId = toStringValue(payload.tokenId);
        let owner = action.actor;

        if (tokenClass.tokenType === 'FT') {
          owner = toStringValue(payload.owner, action.actor);
          const classBalances = { ...(tokenization.ftBalances[classId] ?? {}) };
          classBalances[owner] = Number(classBalances[owner] ?? 0) - amount;
          nextFtBalances = {
            ...tokenization.ftBalances,
            [classId]: classBalances,
          };
          tokenId = '';
        } else {
          amount = 1;
          const nft = tokenization.nftByTokenId[tokenId]!;
          owner = nft.owner;
          const { [tokenId]: _drop, ...rest } = tokenization.nftByTokenId;
          nextNftByTokenId = rest;
          nextNftIdsByClass = {
            ...tokenization.nftIdsByClass,
            [classId]: (tokenization.nftIdsByClass[classId] ?? []).filter((id) => id !== tokenId),
          };
        }

        nextClasses[classId] = {
          ...tokenClass,
          burnedSupply: tokenClass.burnedSupply + amount,
        };

        const event: TokenizationEvent = {
          eventId: `tok:${state.matchId}:${state.seq + 1}`,
          kind: action.kind,
          t: action.t,
          classId,
          actor: action.actor,
          amount,
          from: owner,
          ...(tokenId ? { tokenId } : {}),
          ...(txRef ? { txRef } : {}),
          ...(tokenClass.chain.backend ? { backendHint: tokenClass.chain.backend } : {}),
        };

        return {
          ...state,
          modules: {
            ...state.modules,
            tokenization: {
              ...tokenization,
              classesById: nextClasses,
              ftBalances: nextFtBalances,
              nftByTokenId: nextNftByTokenId,
              nftIdsByClass: nextNftIdsByClass,
              eventLog: pushEvent(tokenization.eventLog, event, rules.historyLimit),
            },
          },
        };
      }

      if (action.kind === 'TOKEN_METADATA_SET') {
        const classId = toStringValue(payload.classId);
        const tokenClass = requireClass(tokenization, classId, action.kind);
        const patch = payload.patch as Record<string, unknown>;
        const nextClass: TokenClass = {
          ...tokenClass,
          metadataSchema: {
            ...tokenClass.metadataSchema,
            ...patch,
          },
        };

        const event: TokenizationEvent = {
          eventId: `tok:${state.matchId}:${state.seq + 1}`,
          kind: action.kind,
          t: action.t,
          classId,
          actor: action.actor,
          ...(tokenClass.chain.backend ? { backendHint: tokenClass.chain.backend } : {}),
        };

        return {
          ...state,
          modules: {
            ...state.modules,
            tokenization: {
              ...tokenization,
              classesById: {
                ...tokenization.classesById,
                [classId]: nextClass,
              },
              eventLog: pushEvent(tokenization.eventLog, event, rules.historyLimit),
            },
          },
        };
      }

      return state;
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(_manifest, state) {
      const tokenization = ensureState(state);
      const classes = Object.values(tokenization.classesById);
      const byType = { NFT: 0, FT: 0 };
      const supply: Record<string, { minted: number; burned: number; circulating: number }> = {};
      for (const c of classes) {
        byType[c.tokenType] += 1;
        const circulating = c.tokenType === 'FT'
          ? sumMap(tokenization.ftBalances[c.classId] ?? {})
          : (tokenization.nftIdsByClass[c.classId] ?? []).length;
        supply[c.classId] = {
          minted: c.mintedSupply,
          burned: c.burnedSupply,
          circulating,
        };
      }

      return {
        tokenization: {
          totals: {
            classes: classes.length,
            byType,
            nftInstances: Object.keys(tokenization.nftByTokenId).length,
          },
          supply,
          classes: classes.map((c) => ({
            classId: c.classId,
            tokenType: c.tokenType,
            standard: c.standard,
            media: c.media,
            chain: c.chain,
            economics: c.economics,
            mintedSupply: c.mintedSupply,
            burnedSupply: c.burnedSupply,
            maxSupply: c.maxSupply,
            tags: c.tags,
          })),
          recentEvents: tokenization.eventLog.slice(Math.max(0, tokenization.eventLog.length - 15)),
        },
      };
    },
  };
}

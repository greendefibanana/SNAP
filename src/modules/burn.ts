import type { SnapManifest, SnapState } from '../engine/types.js';
import type { SnapModule } from './types.js';

type BurnActionKind = 'BURN_USE' | 'ASSET_BURN' | 'POWERUP_BURN';

interface BurnAbilityCostConfig {
  amount: number;
  tokenMint: string;
  sinkAccount: string;
  requireLicenseAsset: boolean;
  allowAmountOverride: boolean;
}

interface BurnRulesConfig {
  defaultAmount: number;
  defaultTokenMint: string;
  defaultSinkAccount: string;
  requireLicenseAsset: boolean;
  allowAmountOverride: boolean;
  allowUnconfiguredAbilities: boolean;
  allowMissingSinkAccount: boolean;
  historyLimit: number;
  abilityCosts: Record<string, BurnAbilityCostConfig>;
}

interface BurnReceipt {
  burnId: string;
  actor: string;
  abilityId: string;
  licenseAssetId: string | null;
  amount: number;
  tokenMint: string;
  sinkAccount: string;
  t: number;
  txRef?: string;
}

interface BurnModuleState extends Record<string, unknown> {
  totalBurned: number;
  burnedByActor: Record<string, number>;
  burnedByMint: Record<string, number>;
  useCountByAbility: Record<string, number>;
  receipts: BurnReceipt[];
}

interface BurnResolvedUse {
  burnId: string;
  abilityId: string;
  amount: number;
  tokenMint: string;
  sinkAccount: string;
  licenseAssetId: string | null;
  txRef?: string;
}

const BURN_ACTION_KINDS: BurnActionKind[] = ['BURN_USE', 'ASSET_BURN', 'POWERUP_BURN'];

function isBurnAction(kind: string): kind is BurnActionKind {
  return BURN_ACTION_KINDS.includes(kind as BurnActionKind);
}

function toNonNegativeNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function toPositiveNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function toBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input;
  return fallback;
}

function toStringValue(input: unknown, fallback = ''): string {
  const s = String(input ?? '').trim();
  return s.length > 0 ? s : fallback;
}

function normalizeAbilityCost(input: unknown, defaults: BurnRulesConfig): BurnAbilityCostConfig | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const amount = toPositiveNumber(raw.amount, defaults.defaultAmount);
  if (amount <= 0) return null;
  return {
    amount,
    tokenMint: toStringValue(raw.tokenMint, defaults.defaultTokenMint),
    sinkAccount: toStringValue(raw.sinkAccount, defaults.defaultSinkAccount),
    requireLicenseAsset: toBool(raw.requireLicenseAsset, defaults.requireLicenseAsset),
    allowAmountOverride: toBool(raw.allowAmountOverride, defaults.allowAmountOverride),
  };
}

function readBurnRules(manifest: SnapManifest): BurnRulesConfig {
  const cfg = (manifest.moduleConfig?.burn ?? {}) as Record<string, unknown>;
  const defaults: BurnRulesConfig = {
    defaultAmount: toPositiveNumber(cfg.defaultAmount, 1),
    defaultTokenMint: toStringValue(cfg.defaultTokenMint, ''),
    defaultSinkAccount: toStringValue(cfg.defaultSinkAccount, ''),
    requireLicenseAsset: toBool(cfg.requireLicenseAsset, false),
    allowAmountOverride: toBool(cfg.allowAmountOverride, false),
    allowUnconfiguredAbilities: toBool(cfg.allowUnconfiguredAbilities, true),
    allowMissingSinkAccount: toBool(cfg.allowMissingSinkAccount, false),
    historyLimit: Math.max(1, Math.floor(toNonNegativeNumber(cfg.historyLimit, 250) || 250)),
    abilityCosts: {},
  };

  const abilityCosts: Record<string, BurnAbilityCostConfig> = {};
  const rawAbilityCosts = cfg.abilityCosts;
  if (rawAbilityCosts && typeof rawAbilityCosts === 'object') {
    for (const [abilityId, abilityCfg] of Object.entries(rawAbilityCosts as Record<string, unknown>)) {
      const key = String(abilityId ?? '').trim();
      if (!key) continue;
      const normalized = normalizeAbilityCost(abilityCfg, defaults);
      if (normalized) {
        abilityCosts[key] = normalized;
      }
    }
  }

  return {
    ...defaults,
    abilityCosts,
  };
}

function ensureBurnState(state: SnapState): BurnModuleState {
  const existing = state.modules.burn as BurnModuleState | undefined;
  if (!existing || typeof existing !== 'object') {
    return {
      totalBurned: 0,
      burnedByActor: {},
      burnedByMint: {},
      useCountByAbility: {},
      receipts: [],
    };
  }

  const coerceMap = (value: unknown): Record<string, number> => {
    if (!value || typeof value !== 'object') return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const key = String(k ?? '').trim();
      if (!key) continue;
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) out[key] = n;
    }
    return out;
  };

  const receipts = Array.isArray(existing.receipts)
    ? existing.receipts
        .map((r) => {
          if (!r || typeof r !== 'object') return null;
          const raw = r as unknown as Record<string, unknown>;
          const burnId = toStringValue(raw.burnId);
          const actor = toStringValue(raw.actor);
          const abilityId = toStringValue(raw.abilityId);
          const tokenMint = toStringValue(raw.tokenMint);
          const sinkAccount = toStringValue(raw.sinkAccount);
          const amount = Number(raw.amount);
          const t = Number(raw.t);
          if (!burnId || !actor || !abilityId || !tokenMint || !Number.isFinite(amount) || amount <= 0 || !Number.isFinite(t)) {
            return null;
          }
          const next: BurnReceipt = {
            burnId,
            actor,
            abilityId,
            licenseAssetId: toStringValue(raw.licenseAssetId) || null,
            amount,
            tokenMint,
            sinkAccount,
            t,
          };
          const txRef = toStringValue(raw.txRef);
          if (txRef) next.txRef = txRef;
          return next;
        })
        .filter((v): v is BurnReceipt => Boolean(v))
    : [];

  return {
    totalBurned: toNonNegativeNumber(existing.totalBurned, 0),
    burnedByActor: coerceMap(existing.burnedByActor),
    burnedByMint: coerceMap(existing.burnedByMint),
    useCountByAbility: coerceMap(existing.useCountByAbility),
    receipts,
  };
}

function resolveBurnUse(
  actionKind: string,
  payload: unknown,
  actor: string,
  matchId: string,
  nextSeq: number,
  rules: BurnRulesConfig,
): BurnResolvedUse {
  if (!isBurnAction(actionKind)) {
    throw new Error(`Unsupported burn action kind: '${actionKind}'`);
  }

  const p = (payload ?? {}) as Record<string, unknown>;
  const abilityId = toStringValue(p.abilityId);
  if (!abilityId) {
    throw new Error(`${actionKind} requires abilityId`);
  }

  const configured = rules.abilityCosts[abilityId];
  if (!configured && !rules.allowUnconfiguredAbilities) {
    throw new Error(`${actionKind} ability '${abilityId}' is not configured for burn usage`);
  }

  const base = configured ?? {
    amount: rules.defaultAmount,
    tokenMint: rules.defaultTokenMint,
    sinkAccount: rules.defaultSinkAccount,
    requireLicenseAsset: rules.requireLicenseAsset,
    allowAmountOverride: rules.allowAmountOverride,
  };

  const explicitAmount = Number(p.amount);
  const hasExplicitAmount = Number.isFinite(explicitAmount);
  const amount = hasExplicitAmount ? explicitAmount : base.amount;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`${actionKind} requires positive burn amount`);
  }
  if (!base.allowAmountOverride && hasExplicitAmount && amount !== base.amount) {
    throw new Error(`${actionKind} for ability '${abilityId}' requires amount=${base.amount}`);
  }
  if (amount < base.amount) {
    throw new Error(`${actionKind} burn amount must be >= configured base amount (${base.amount})`);
  }

  const tokenMint = toStringValue(p.tokenMint, base.tokenMint);
  if (!tokenMint) {
    throw new Error(`${actionKind} requires tokenMint (payload or burn config)`);
  }

  const sinkAccount = toStringValue(p.sinkAccount, base.sinkAccount);
  if (!sinkAccount && !rules.allowMissingSinkAccount) {
    throw new Error(`${actionKind} requires sinkAccount (payload or burn config)`);
  }

  const licenseAssetId = toStringValue(p.licenseAssetId) || null;
  if (base.requireLicenseAsset && !licenseAssetId) {
    throw new Error(`${actionKind} for ability '${abilityId}' requires licenseAssetId`);
  }

  const burnId = toStringValue(p.burnId, `burn:${matchId}:${nextSeq}:${actor}`);
  const txRef = toStringValue(p.txRef);

  return {
    burnId,
    abilityId,
    amount,
    tokenMint,
    sinkAccount,
    licenseAssetId,
    ...(txRef ? { txRef } : {}),
  };
}

function trimReceipts(receipts: BurnReceipt[], limit: number): BurnReceipt[] {
  if (receipts.length <= limit) return receipts;
  return receipts.slice(receipts.length - limit);
}

export function createBurnModule(): SnapModule {
  return {
    id: 'burn',
    init(_manifest, state) {
      return {
        ...state,
        modules: {
          ...state.modules,
          burn: ensureBurnState(state),
        },
      };
    },
    validateAction(action, manifest, state) {
      if (!isBurnAction(action.kind)) return;
      const rules = readBurnRules(manifest);
      const burn = ensureBurnState(state);
      const resolved = resolveBurnUse(action.kind, action.payload, action.actor, state.matchId, state.seq + 1, rules);
      if (burn.receipts.some((r) => r.burnId === resolved.burnId)) {
        throw new Error(`${action.kind} burnId '${resolved.burnId}' already exists`);
      }
    },
    applyAction(action, manifest, state) {
      if (!isBurnAction(action.kind)) return state;
      const rules = readBurnRules(manifest);
      const burn = ensureBurnState(state);
      const resolved = resolveBurnUse(action.kind, action.payload, action.actor, state.matchId, state.seq + 1, rules);

      const receipt: BurnReceipt = {
        burnId: resolved.burnId,
        actor: action.actor,
        abilityId: resolved.abilityId,
        licenseAssetId: resolved.licenseAssetId,
        amount: resolved.amount,
        tokenMint: resolved.tokenMint,
        sinkAccount: resolved.sinkAccount,
        t: action.t,
        ...(resolved.txRef ? { txRef: resolved.txRef } : {}),
      };

      const next: BurnModuleState = {
        totalBurned: burn.totalBurned + resolved.amount,
        burnedByActor: {
          ...burn.burnedByActor,
          [action.actor]: Number(burn.burnedByActor[action.actor] ?? 0) + resolved.amount,
        },
        burnedByMint: {
          ...burn.burnedByMint,
          [resolved.tokenMint]: Number(burn.burnedByMint[resolved.tokenMint] ?? 0) + resolved.amount,
        },
        useCountByAbility: {
          ...burn.useCountByAbility,
          [resolved.abilityId]: Number(burn.useCountByAbility[resolved.abilityId] ?? 0) + 1,
        },
        receipts: trimReceipts(burn.receipts.concat(receipt), rules.historyLimit),
      };

      return {
        ...state,
        modules: {
          ...state.modules,
          burn: next,
        },
      };
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(_manifest, state) {
      const burn = ensureBurnState(state);
      return {
        burn: {
          totalBurned: burn.totalBurned,
          burnedByActor: burn.burnedByActor,
          burnedByMint: burn.burnedByMint,
          useCountByAbility: burn.useCountByAbility,
          receiptCount: burn.receipts.length,
          recentReceipts: burn.receipts.slice(Math.max(0, burn.receipts.length - 10)),
        },
      };
    },
  };
}

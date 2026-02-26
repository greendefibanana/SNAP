import type { SnapAction, SnapManifest, SnapState } from '../engine/types.js';
import type { SnapModule } from './types.js';

type ActorPath = 'actor' | `payload.${string}`;

interface StarterPackRule {
  id: string;
  classId: string;
  amount: number;
  maxClaimsPerActor: number;
}

interface ScoreRewardRule {
  id: string;
  counter: string;
  threshold: number;
  classId: string;
  amount: number;
  actorPath: ActorPath;
  repeatable: boolean;
  maxClaimsPerActor: number;
}

interface ActionRewardRule {
  id: string;
  actionKind: string;
  classId: string;
  amount: number;
  actorPath: ActorPath;
  cooldownSec: number;
  maxClaimsPerActor: number;
}

interface PurchaseRewardRule {
  sku: string;
  classId: string;
  amount: number;
  maxClaimsPerActor: number;
}

interface AcquisitionPolicyRulesConfig {
  starterPacks: StarterPackRule[];
  scoreRewards: ScoreRewardRule[];
  actionRewards: ActionRewardRule[];
  purchaseRewards: PurchaseRewardRule[];
  adminActors: string[];
  allowDirectGrantAction: boolean;
  historyLimit: number;
}

interface AcquisitionGrantReceipt {
  grantId: string;
  t: number;
  actor: string;
  recipient: string;
  classId: string;
  amount: number;
  source: 'starter' | 'score' | 'action' | 'purchase' | 'direct';
  sourceId: string;
  actionKind: string;
  txRef?: string;
}

interface AcquisitionPolicyModuleState extends Record<string, unknown> {
  claimsByActor: Record<string, Record<string, number>>;
  lastClaimAtByActor: Record<string, Record<string, number>>;
  totalGrantedByClass: Record<string, number>;
  grants: AcquisitionGrantReceipt[];
}

interface TokenClass {
  classId: string;
  tokenType: 'FT' | 'NFT';
  maxSupply: number | null;
  mintedSupply: number;
}

interface TokenizationState {
  classesById: Record<string, TokenClass>;
  ftBalances: Record<string, Record<string, number>>;
  nftByTokenId: Record<string, Record<string, unknown>>;
  nftIdsByClass: Record<string, string[]>;
  eventLog: Array<Record<string, unknown>>;
}

function toStringValue(input: unknown, fallback = ''): string {
  const v = String(input ?? '').trim();
  return v.length > 0 ? v : fallback;
}

function toPositiveNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function toPositiveInteger(input: unknown, fallback: number): number {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function toNonNegativeInteger(input: unknown, fallback: number): number {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

function toBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input;
  return fallback;
}

function parseActorPath(input: unknown, fallback: ActorPath): ActorPath {
  const v = toStringValue(input);
  if (v === 'actor') return 'actor';
  if (v.startsWith('payload.') && v.length > 'payload.'.length) {
    return v as ActorPath;
  }
  return fallback;
}

function readRules(manifest: SnapManifest): AcquisitionPolicyRulesConfig {
  const cfg = (manifest.moduleConfig?.acquisitionPolicy ?? {}) as Record<string, unknown>;

  const starterPacks: StarterPackRule[] = Array.isArray(cfg.starterPacks)
    ? cfg.starterPacks
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const raw = r as Record<string, unknown>;
        const id = toStringValue(raw.id);
        const classId = toStringValue(raw.classId);
        if (!id || !classId) return null;
        return {
          id,
          classId,
          amount: toPositiveNumber(raw.amount, 1),
          maxClaimsPerActor: toPositiveInteger(raw.maxClaimsPerActor, 1),
        };
      })
      .filter((v): v is StarterPackRule => Boolean(v))
    : [];

  const scoreRewards: ScoreRewardRule[] = Array.isArray(cfg.scoreRewards)
    ? cfg.scoreRewards
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const raw = r as Record<string, unknown>;
        const id = toStringValue(raw.id);
        const counter = toStringValue(raw.counter);
        const classId = toStringValue(raw.classId);
        if (!id || !counter || !classId) return null;
        return {
          id,
          counter,
          threshold: toPositiveNumber(raw.threshold, 1),
          classId,
          amount: toPositiveNumber(raw.amount, 1),
          actorPath: parseActorPath(raw.actorPath, 'payload.entityId'),
          repeatable: toBool(raw.repeatable, false),
          maxClaimsPerActor: toPositiveInteger(raw.maxClaimsPerActor, 1),
        };
      })
      .filter((v): v is ScoreRewardRule => Boolean(v))
    : [];

  const actionRewards: ActionRewardRule[] = Array.isArray(cfg.actionRewards)
    ? cfg.actionRewards
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const raw = r as Record<string, unknown>;
        const id = toStringValue(raw.id);
        const actionKind = toStringValue(raw.actionKind);
        const classId = toStringValue(raw.classId);
        if (!id || !actionKind || !classId) return null;
        return {
          id,
          actionKind,
          classId,
          amount: toPositiveNumber(raw.amount, 1),
          actorPath: parseActorPath(raw.actorPath, 'actor'),
          cooldownSec: Math.max(0, Number(raw.cooldownSec ?? 0)),
          maxClaimsPerActor: toPositiveInteger(raw.maxClaimsPerActor, Number.MAX_SAFE_INTEGER),
        };
      })
      .filter((v): v is ActionRewardRule => Boolean(v))
    : [];

  const purchaseRewards: PurchaseRewardRule[] = Array.isArray(cfg.purchaseRewards)
    ? cfg.purchaseRewards
      .map((r) => {
        if (!r || typeof r !== 'object') return null;
        const raw = r as Record<string, unknown>;
        const sku = toStringValue(raw.sku);
        const classId = toStringValue(raw.classId);
        if (!sku || !classId) return null;
        return {
          sku,
          classId,
          amount: toPositiveNumber(raw.amount, 1),
          maxClaimsPerActor: toPositiveInteger(raw.maxClaimsPerActor, Number.MAX_SAFE_INTEGER),
        };
      })
      .filter((v): v is PurchaseRewardRule => Boolean(v))
    : [];

  return {
    starterPacks,
    scoreRewards,
    actionRewards,
    purchaseRewards,
    adminActors: Array.isArray(cfg.adminActors)
      ? cfg.adminActors.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
      : [],
    allowDirectGrantAction: toBool(cfg.allowDirectGrantAction, true),
    historyLimit: Math.max(1, toNonNegativeInteger(cfg.historyLimit, 500) || 500),
  };
}

function ensureState(state: SnapState): AcquisitionPolicyModuleState {
  const existing = state.modules.acquisitionPolicy as AcquisitionPolicyModuleState | undefined;
  if (!existing || typeof existing !== 'object') {
    return {
      claimsByActor: {},
      lastClaimAtByActor: {},
      totalGrantedByClass: {},
      grants: [],
    };
  }

  const claimsByActor: Record<string, Record<string, number>> = {};
  if (existing.claimsByActor && typeof existing.claimsByActor === 'object') {
    for (const [actor, claims] of Object.entries(existing.claimsByActor)) {
      const a = toStringValue(actor);
      if (!a || !claims || typeof claims !== 'object') continue;
      claimsByActor[a] = {};
      for (const [key, raw] of Object.entries(claims as Record<string, unknown>)) {
        const k = toStringValue(key);
        if (!k) continue;
        claimsByActor[a]![k] = toNonNegativeInteger(raw, 0);
      }
    }
  }

  const lastClaimAtByActor: Record<string, Record<string, number>> = {};
  if (existing.lastClaimAtByActor && typeof existing.lastClaimAtByActor === 'object') {
    for (const [actor, claimTimes] of Object.entries(existing.lastClaimAtByActor)) {
      const a = toStringValue(actor);
      if (!a || !claimTimes || typeof claimTimes !== 'object') continue;
      lastClaimAtByActor[a] = {};
      for (const [key, raw] of Object.entries(claimTimes as Record<string, unknown>)) {
        const k = toStringValue(key);
        const t = Number(raw);
        if (!k || !Number.isFinite(t) || t < 0) continue;
        lastClaimAtByActor[a]![k] = t;
      }
    }
  }

  const totalGrantedByClass: Record<string, number> = {};
  if (existing.totalGrantedByClass && typeof existing.totalGrantedByClass === 'object') {
    for (const [classId, raw] of Object.entries(existing.totalGrantedByClass)) {
      const classKey = toStringValue(classId);
      if (!classKey) continue;
      const n = Number(raw);
      if (Number.isFinite(n) && n >= 0) totalGrantedByClass[classKey] = n;
    }
  }

  const grants = Array.isArray(existing.grants)
    ? existing.grants
      .map((g) => {
        if (!g || typeof g !== 'object') return null;
        const raw = g as unknown as Record<string, unknown>;
        const grantId = toStringValue(raw.grantId);
        const actor = toStringValue(raw.actor);
        const recipient = toStringValue(raw.recipient);
        const classId = toStringValue(raw.classId);
        const sourceId = toStringValue(raw.sourceId);
        const actionKind = toStringValue(raw.actionKind);
        const source = toStringValue(raw.source) as AcquisitionGrantReceipt['source'];
        const t = Number(raw.t);
        const amount = Number(raw.amount);
        if (!grantId || !actor || !recipient || !classId || !sourceId || !actionKind) return null;
        if (!Number.isFinite(t) || t < 0 || !Number.isFinite(amount) || amount <= 0) return null;
        if (!['starter', 'score', 'action', 'purchase', 'direct'].includes(source)) return null;
        const out: AcquisitionGrantReceipt = {
          grantId,
          t,
          actor,
          recipient,
          classId,
          amount,
          source: source as AcquisitionGrantReceipt['source'],
          sourceId,
          actionKind,
        };
        const txRef = toStringValue(raw.txRef);
        if (txRef) out.txRef = txRef;
        return out as unknown as AcquisitionGrantReceipt;
      })
      .filter((v): v is AcquisitionGrantReceipt => Boolean(v))
    : [];

  return {
    claimsByActor,
    lastClaimAtByActor,
    totalGrantedByClass,
    grants,
  };
}

function ensureTokenizationState(state: SnapState, actionKind: string): TokenizationState {
  const tokenization = state.modules.tokenization as TokenizationState | undefined;
  if (!tokenization || typeof tokenization !== 'object') {
    throw new Error(`${actionKind} requires tokenization module to be enabled`);
  }
  return {
    classesById: { ...(tokenization.classesById ?? {}) },
    ftBalances: { ...(tokenization.ftBalances ?? {}) },
    nftByTokenId: { ...(tokenization.nftByTokenId ?? {}) },
    nftIdsByClass: { ...(tokenization.nftIdsByClass ?? {}) },
    eventLog: Array.isArray(tokenization.eventLog) ? tokenization.eventLog.slice() : [],
  };
}

function claimCount(state: AcquisitionPolicyModuleState, actor: string, ruleId: string): number {
  return Number(state.claimsByActor[actor]?.[ruleId] ?? 0);
}

function lastClaimAt(state: AcquisitionPolicyModuleState, actor: string, ruleId: string): number | null {
  const value = state.lastClaimAtByActor[actor]?.[ruleId];
  return Number.isFinite(value) ? Number(value) : null;
}

function incrementClaim(state: AcquisitionPolicyModuleState, actor: string, ruleId: string, t: number): void {
  const actorClaims = { ...(state.claimsByActor[actor] ?? {}) };
  actorClaims[ruleId] = Number(actorClaims[ruleId] ?? 0) + 1;
  state.claimsByActor = {
    ...state.claimsByActor,
    [actor]: actorClaims,
  };

  const actorTimes = { ...(state.lastClaimAtByActor[actor] ?? {}) };
  actorTimes[ruleId] = t;
  state.lastClaimAtByActor = {
    ...state.lastClaimAtByActor,
    [actor]: actorTimes,
  };
}

function readPath(action: SnapAction, actorPath: ActorPath): string {
  if (actorPath === 'actor') return toStringValue(action.actor);
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const key = actorPath.slice('payload.'.length);
  return toStringValue(payload[key]);
}

function readCounterValue(state: SnapState, counter: string, entityId: string): number {
  const scoring = (state.modules.scoring ?? {}) as { counters?: Record<string, Record<string, number>> };
  return Number(scoring.counters?.[counter]?.[entityId] ?? 0);
}

function nextNftTokenId(classId: string, tokenization: TokenizationState): string {
  const ids = tokenization.nftIdsByClass[classId] ?? [];
  return `nft:${classId}:${ids.length + 1}`;
}

function trimGrants(grants: AcquisitionGrantReceipt[], limit: number): AcquisitionGrantReceipt[] {
  if (grants.length <= limit) return grants;
  return grants.slice(grants.length - limit);
}

function mintToRecipient(
  tokenization: TokenizationState,
  action: SnapAction,
  recipient: string,
  classId: string,
  amount: number,
  txRef: string | null,
): TokenizationState {
  const tokenClass = tokenization.classesById[classId];
  if (!tokenClass) {
    throw new Error(`Acquisition grant failed: class '${classId}' is not defined`);
  }
  if (tokenClass.maxSupply !== null && tokenClass.mintedSupply + amount > tokenClass.maxSupply) {
    throw new Error(`Acquisition grant failed: class '${classId}' exceeds maxSupply`);
  }

  const next: TokenizationState = {
    classesById: { ...tokenization.classesById },
    ftBalances: { ...tokenization.ftBalances },
    nftByTokenId: { ...tokenization.nftByTokenId },
    nftIdsByClass: { ...tokenization.nftIdsByClass },
    eventLog: tokenization.eventLog.slice(),
  };

  next.classesById[classId] = {
    ...tokenClass,
    mintedSupply: tokenClass.mintedSupply + amount,
  };

  if (tokenClass.tokenType === 'FT') {
    const bucket = { ...(next.ftBalances[classId] ?? {}) };
    bucket[recipient] = Number(bucket[recipient] ?? 0) + amount;
    next.ftBalances[classId] = bucket;
    next.eventLog.push({
      eventId: `acq-mint:${action.matchId}:${action.t}:${classId}:${recipient}`,
      kind: 'TOKEN_MINT',
      t: action.t,
      classId,
      actor: action.actor,
      amount,
      to: recipient,
      ...(txRef ? { txRef } : {}),
    });
    return next;
  }

  const nftAmount = Math.floor(amount);
  if (nftAmount !== amount || nftAmount <= 0) {
    throw new Error(`Acquisition grant failed: NFT grant amount must be a positive integer for class '${classId}'`);
  }
  const ids = (next.nftIdsByClass[classId] ?? []).slice();
  for (let i = 0; i < nftAmount; i++) {
    const tokenId = nextNftTokenId(classId, {
      ...next,
      nftIdsByClass: { ...next.nftIdsByClass, [classId]: ids },
    });
    ids.push(tokenId);
    next.nftByTokenId[tokenId] = {
      tokenId,
      classId,
      owner: recipient,
      mintedAtT: action.t,
      metadataOverrides: { source: 'acquisitionPolicy' },
    };
    next.eventLog.push({
      eventId: `acq-mint:${action.matchId}:${action.t}:${classId}:${tokenId}`,
      kind: 'TOKEN_MINT',
      t: action.t,
      classId,
      actor: action.actor,
      amount: 1,
      to: recipient,
      tokenId,
      ...(txRef ? { txRef } : {}),
    });
  }
  next.nftIdsByClass[classId] = ids;
  return next;
}

function applyGrant(
  state: SnapState,
  moduleState: AcquisitionPolicyModuleState,
  action: SnapAction,
  params: {
    actorForClaims: string;
    recipient: string;
    classId: string;
    amount: number;
    source: AcquisitionGrantReceipt['source'];
    sourceId: string;
    txRef?: string;
  },
  rules: AcquisitionPolicyRulesConfig,
): SnapState {
  const tokenization = ensureTokenizationState(state, action.kind);
  const updatedTokenization = mintToRecipient(
    tokenization,
    action,
    params.recipient,
    params.classId,
    params.amount,
    params.txRef ? params.txRef : null,
  );

  incrementClaim(moduleState, params.actorForClaims, params.sourceId, action.t);
  moduleState.totalGrantedByClass = {
    ...moduleState.totalGrantedByClass,
    [params.classId]: Number(moduleState.totalGrantedByClass[params.classId] ?? 0) + params.amount,
  };

  const receipt: AcquisitionGrantReceipt = {
    grantId: `acq:${action.matchId}:${state.seq + 1}:${moduleState.grants.length + 1}`,
    t: action.t,
    actor: action.actor,
    recipient: params.recipient,
    classId: params.classId,
    amount: params.amount,
    source: params.source,
    sourceId: params.sourceId,
    actionKind: action.kind,
    ...(params.txRef ? { txRef: params.txRef } : {}),
  };
  moduleState.grants = trimGrants(moduleState.grants.concat(receipt), rules.historyLimit);

  return {
    ...state,
    modules: {
      ...state.modules,
      tokenization: updatedTokenization as unknown as Record<string, unknown>,
      acquisitionPolicy: moduleState as unknown as Record<string, unknown>,
    },
  };
}

function isAdmin(action: SnapAction, rules: AcquisitionPolicyRulesConfig): boolean {
  return rules.adminActors.length === 0 || rules.adminActors.includes(action.actor);
}

export function createAcquisitionPolicyModule(): SnapModule {
  return {
    id: 'acquisitionPolicy',
    init(_manifest, state) {
      return {
        ...state,
        modules: {
          ...state.modules,
          acquisitionPolicy: ensureState(state),
        },
      };
    },
    validateAction(action, manifest, state) {
      const rules = readRules(manifest);
      const acq = ensureState(state);
      const payload = (action.payload ?? {}) as Record<string, unknown>;

      if (action.kind === 'ACQ_CLAIM_STARTER') {
        const packId = toStringValue(payload.packId);
        if (!packId) throw new Error('ACQ_CLAIM_STARTER requires packId');
        const pack = rules.starterPacks.find((r) => r.id === packId);
        if (!pack) throw new Error(`ACQ_CLAIM_STARTER unknown packId '${packId}'`);
        if (claimCount(acq, action.actor, pack.id) >= pack.maxClaimsPerActor) {
          throw new Error(`ACQ_CLAIM_STARTER limit reached for pack '${pack.id}'`);
        }
      }

      if (action.kind === 'ACQ_PURCHASE_CREDIT') {
        const sku = toStringValue(payload.sku);
        const recipient = toStringValue(payload.recipient, action.actor);
        if (!sku) throw new Error('ACQ_PURCHASE_CREDIT requires sku');
        if (!recipient) throw new Error('ACQ_PURCHASE_CREDIT requires recipient');
        const reward = rules.purchaseRewards.find((r) => r.sku === sku);
        if (!reward) throw new Error(`ACQ_PURCHASE_CREDIT unknown sku '${sku}'`);
        if (claimCount(acq, recipient, `purchase:${sku}`) >= reward.maxClaimsPerActor) {
          throw new Error(`ACQ_PURCHASE_CREDIT max claims reached for sku '${sku}'`);
        }
      }

      if (action.kind === 'ACQ_GRANT') {
        if (!rules.allowDirectGrantAction) throw new Error('ACQ_GRANT is disabled by module config');
        if (!isAdmin(action, rules)) throw new Error(`ACQ_GRANT actor '${action.actor}' is not allowed`);
        const classId = toStringValue(payload.classId);
        const recipient = toStringValue(payload.recipient);
        const amount = Number(payload.amount);
        if (!classId) throw new Error('ACQ_GRANT requires classId');
        if (!recipient) throw new Error('ACQ_GRANT requires recipient');
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('ACQ_GRANT requires positive amount');
      }
    },
    applyAction(action, manifest, state) {
      const rules = readRules(manifest);
      const payload = (action.payload ?? {}) as Record<string, unknown>;
      let acq = ensureState(state);

      if (action.kind === 'ACQ_CLAIM_STARTER') {
        const packId = toStringValue(payload.packId);
        const pack = rules.starterPacks.find((r) => r.id === packId);
        if (!pack) return state;
        if (claimCount(acq, action.actor, pack.id) >= pack.maxClaimsPerActor) return state;
        return applyGrant(state, acq, action, {
          actorForClaims: action.actor,
          recipient: action.actor,
          classId: pack.classId,
          amount: pack.amount,
          source: 'starter',
          sourceId: pack.id,
          txRef: toStringValue(payload.txRef) || undefined,
        }, rules);
      }

      if (action.kind === 'ACQ_PURCHASE_CREDIT') {
        const sku = toStringValue(payload.sku);
        const recipient = toStringValue(payload.recipient, action.actor);
        const reward = rules.purchaseRewards.find((r) => r.sku === sku);
        if (!reward || !recipient) return state;
        const claimKey = `purchase:${sku}`;
        if (claimCount(acq, recipient, claimKey) >= reward.maxClaimsPerActor) return state;
        return applyGrant(state, acq, action, {
          actorForClaims: recipient,
          recipient,
          classId: reward.classId,
          amount: reward.amount,
          source: 'purchase',
          sourceId: claimKey,
          txRef: toStringValue(payload.txRef) || undefined,
        }, rules);
      }

      if (action.kind === 'ACQ_GRANT') {
        if (!rules.allowDirectGrantAction || !isAdmin(action, rules)) return state;
        const classId = toStringValue(payload.classId);
        const recipient = toStringValue(payload.recipient);
        const amount = Number(payload.amount);
        if (!classId || !recipient || !Number.isFinite(amount) || amount <= 0) return state;
        const grantId = toStringValue(payload.grantId, `direct:${classId}`);
        if (claimCount(acq, recipient, grantId) >= 1) {
          throw new Error(`ACQ_GRANT duplicate grantId '${grantId}' for recipient '${recipient}'`);
        }
        return applyGrant(state, acq, action, {
          actorForClaims: recipient,
          recipient,
          classId,
          amount,
          source: 'direct',
          sourceId: grantId,
          txRef: toStringValue(payload.txRef) || undefined,
        }, rules);
      }

      for (const reward of rules.actionRewards) {
        if (reward.actionKind !== action.kind) continue;
        const recipient = readPath(action, reward.actorPath);
        if (!recipient) continue;
        const claimed = claimCount(acq, recipient, reward.id);
        if (claimed >= reward.maxClaimsPerActor) continue;
        const lastT = lastClaimAt(acq, recipient, reward.id);
        if (lastT !== null && reward.cooldownSec > 0) {
          const elapsedSec = Math.max(0, (action.t - lastT) / 1000);
          if (elapsedSec < reward.cooldownSec) continue;
        }
        state = applyGrant(state, acq, action, {
          actorForClaims: recipient,
          recipient,
          classId: reward.classId,
          amount: reward.amount,
          source: 'action',
          sourceId: reward.id,
        }, rules);
        acq = ensureState(state);
      }

      if (action.kind === 'SCORE_ADD') {
        for (const reward of rules.scoreRewards) {
          const payloadCounter = toStringValue(payload.counter);
          if (payloadCounter !== reward.counter) continue;
          const recipient = readPath(action, reward.actorPath);
          if (!recipient) continue;
          const currentValue = readCounterValue(state, reward.counter, recipient);
          const achieved = reward.repeatable
            ? Math.floor(currentValue / reward.threshold)
            : currentValue >= reward.threshold ? 1 : 0;
          const maxAllowed = Math.min(reward.maxClaimsPerActor, achieved);
          while (claimCount(acq, recipient, reward.id) < maxAllowed) {
            state = applyGrant(state, acq, action, {
              actorForClaims: recipient,
              recipient,
              classId: reward.classId,
              amount: reward.amount,
              source: 'score',
              sourceId: reward.id,
            }, rules);
            acq = ensureState(state);
          }
        }
      }

      return state;
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(_manifest, state) {
      const acq = ensureState(state);
      return {
        acquisitionPolicy: {
          totalGrantedByClass: acq.totalGrantedByClass,
          grantCount: acq.grants.length,
          recentGrants: acq.grants.slice(Math.max(0, acq.grants.length - 15)),
        },
      };
    },
  };
}

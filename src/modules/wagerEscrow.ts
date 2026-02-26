import type { SnapManifest, SnapState } from '../engine/types.js';
import type { SnapModule } from './types.js';

type WagerOrderStatus = 'OPEN' | 'LOCKED' | 'SETTLED' | 'REFUNDED' | 'CANCELLED';
type WagerMode = 'single-player' | 'multiplayer' | 'any';
type WagerComparator = '>=' | '>' | '==' | '<=' | '<';

interface WagerObjective {
  kind: string;
  description?: string;
  counter?: string;
  entityId?: string;
  comparator?: WagerComparator;
  target?: number;
}

interface WagerPayoutEntry {
  recipient: string;
  amount: number;
  reason?: string;
}

interface WagerOrder {
  orderId: string;
  createdBy: string;
  status: WagerOrderStatus;
  createdAtT: number;
  lockedAtT: number | null;
  resolvedAtT: number | null;
  currencyMint: string;
  escrowAccount: string;
  escrowProgram: string;
  entryAmount: number;
  participants: string[];
  maxParticipants: number;
  isSinglePlayer: boolean;
  objective: WagerObjective | null;
  potAmount: number;
  winners: string[];
  payoutBreakdown: WagerPayoutEntry[];
  metadata?: Record<string, unknown>;
  settlementId?: string;
}

interface WagerActorStats {
  posted: number;
  joined: number;
  won: number;
  lost: number;
  refunded: number;
  totalWagered: number;
  totalPayout: number;
}

interface WagerEscrowRulesConfig {
  mode: WagerMode;
  allowMultipleOpenOrdersPerActor: boolean;
  autoLockOnJoin: boolean;
  allowCancelOpenOrder: boolean;
  historyLimit: number;
  defaultCurrencyMint: string;
  defaultEscrowProgram: string;
  defaultEscrowAccount: string;
  defaultMaxParticipants: number;
  singlePlayerLoseRecipient: string;
  objectiveKindsAllowlist: string[];
}

interface WagerEscrowModuleState extends Record<string, unknown> {
  ordersById: Record<string, WagerOrder>;
  actorStats: Record<string, WagerActorStats>;
  history: WagerOrder[];
}

const DEFAULT_ACTOR_STATS: WagerActorStats = {
  posted: 0,
  joined: 0,
  won: 0,
  lost: 0,
  refunded: 0,
  totalWagered: 0,
  totalPayout: 0,
};

function toStringValue(input: unknown, fallback = ''): string {
  const s = String(input ?? '').trim();
  return s.length > 0 ? s : fallback;
}

function toPositiveNumber(input: unknown, fallback: number): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function toIntInRange(input: unknown, fallback: number, min: number, max: number): number {
  const n = Math.floor(Number(input));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function toBool(input: unknown, fallback: boolean): boolean {
  if (typeof input === 'boolean') return input;
  return fallback;
}

function toComparator(input: unknown): WagerComparator | undefined {
  if (input === '>=' || input === '>' || input === '==' || input === '<=' || input === '<') {
    return input;
  }
  return undefined;
}

function sanitizeObjective(input: unknown, allowKinds: string[]): WagerObjective | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const kind = toStringValue(raw.kind);
  if (!kind) return null;
  if (allowKinds.length > 0 && !allowKinds.includes(kind)) {
    throw new Error(`WAGER objective kind '${kind}' is not allowed by config`);
  }
  const target = Number(raw.target);
  const comparator = toComparator(raw.comparator);
  return {
    kind,
    ...(toStringValue(raw.description) ? { description: toStringValue(raw.description) } : {}),
    ...(toStringValue(raw.counter) ? { counter: toStringValue(raw.counter) } : {}),
    ...(toStringValue(raw.entityId) ? { entityId: toStringValue(raw.entityId) } : {}),
    ...(comparator ? { comparator } : {}),
    ...(Number.isFinite(target) ? { target } : {}),
  };
}

function readWagerEscrowRules(manifest: SnapManifest): WagerEscrowRulesConfig {
  const cfg = (manifest.moduleConfig?.wagerEscrow ?? {}) as Record<string, unknown>;
  const modeRaw = toStringValue(cfg.mode, 'any');
  const mode: WagerMode = modeRaw === 'single-player' || modeRaw === 'multiplayer' ? modeRaw : 'any';
  const objectiveKindsAllowlist = Array.isArray(cfg.objectiveKindsAllowlist)
    ? cfg.objectiveKindsAllowlist.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
    : [];

  return {
    mode,
    allowMultipleOpenOrdersPerActor: toBool(cfg.allowMultipleOpenOrdersPerActor, true),
    autoLockOnJoin: toBool(cfg.autoLockOnJoin, true),
    allowCancelOpenOrder: toBool(cfg.allowCancelOpenOrder, true),
    historyLimit: toIntInRange(cfg.historyLimit, 250, 1, 10000),
    defaultCurrencyMint: toStringValue(cfg.defaultCurrencyMint),
    defaultEscrowProgram: toStringValue(cfg.defaultEscrowProgram),
    defaultEscrowAccount: toStringValue(cfg.defaultEscrowAccount),
    defaultMaxParticipants: toIntInRange(cfg.defaultMaxParticipants, 2, 1, 64),
    singlePlayerLoseRecipient: toStringValue(cfg.singlePlayerLoseRecipient, ''),
    objectiveKindsAllowlist,
  };
}

function cloneObjective(input: WagerObjective | null): WagerObjective | null {
  if (!input) return null;
  return {
    kind: input.kind,
    ...(input.description ? { description: input.description } : {}),
    ...(input.counter ? { counter: input.counter } : {}),
    ...(input.entityId ? { entityId: input.entityId } : {}),
    ...(input.comparator ? { comparator: input.comparator } : {}),
    ...(input.target !== undefined ? { target: input.target } : {}),
  };
}

function sanitizePayoutBreakdown(input: unknown): WagerPayoutEntry[] {
  if (!Array.isArray(input)) return [];
  const out: WagerPayoutEntry[] = [];
  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const raw = entry as Record<string, unknown>;
    const recipient = toStringValue(raw.recipient);
    const amount = Number(raw.amount);
    if (!recipient || !Number.isFinite(amount) || amount < 0) continue;
    out.push({
      recipient,
      amount,
      ...(toStringValue(raw.reason) ? { reason: toStringValue(raw.reason) } : {}),
    });
  }
  return out;
}

function cloneOrder(input: WagerOrder): WagerOrder {
  return {
    ...input,
    participants: input.participants.slice(),
    winners: input.winners.slice(),
    payoutBreakdown: input.payoutBreakdown.map((p) => ({ ...p })),
    objective: cloneObjective(input.objective),
    ...(input.metadata ? { metadata: { ...input.metadata } } : {}),
  };
}

function ensureWagerEscrowState(state: SnapState): WagerEscrowModuleState {
  const existing = state.modules.wagerEscrow as WagerEscrowModuleState | undefined;
  if (!existing || typeof existing !== 'object') {
    return {
      ordersById: {},
      actorStats: {},
      history: [],
    };
  }

  const ordersById: Record<string, WagerOrder> = {};
  if (existing.ordersById && typeof existing.ordersById === 'object') {
    for (const [orderId, orderRaw] of Object.entries(existing.ordersById)) {
      if (!orderRaw || typeof orderRaw !== 'object') continue;
      const order = orderRaw as WagerOrder;
      const key = toStringValue(orderId);
      if (!key) continue;
      const entryAmount = Number(order.entryAmount);
      if (!Number.isFinite(entryAmount) || entryAmount <= 0) continue;
      const participants = Array.isArray(order.participants)
        ? order.participants.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
        : [];
      if (participants.length === 0) continue;

      const maxParticipants = toIntInRange(order.maxParticipants, participants.length, 1, 64);
      const status = toStringValue(order.status, 'OPEN') as WagerOrderStatus;
      if (status !== 'OPEN' && status !== 'LOCKED' && status !== 'SETTLED' && status !== 'REFUNDED' && status !== 'CANCELLED') {
        continue;
      }

      const normalized: WagerOrder = {
        orderId: key,
        createdBy: toStringValue(order.createdBy, participants[0] ?? ''),
        status,
        createdAtT: Number.isFinite(order.createdAtT) ? Number(order.createdAtT) : 0,
        lockedAtT: Number.isFinite(order.lockedAtT) ? Number(order.lockedAtT) : null,
        resolvedAtT: Number.isFinite(order.resolvedAtT) ? Number(order.resolvedAtT) : null,
        currencyMint: toStringValue(order.currencyMint),
        escrowAccount: toStringValue(order.escrowAccount),
        escrowProgram: toStringValue(order.escrowProgram),
        entryAmount,
        participants,
        maxParticipants,
        isSinglePlayer: Boolean(order.isSinglePlayer),
        objective: cloneObjective(order.objective ?? null),
        potAmount: Number.isFinite(order.potAmount) ? Math.max(0, Number(order.potAmount)) : entryAmount * participants.length,
        winners: Array.isArray(order.winners)
          ? order.winners.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
          : [],
        payoutBreakdown: sanitizePayoutBreakdown(order.payoutBreakdown),
      };
      if (order.metadata && typeof order.metadata === 'object') {
        normalized.metadata = { ...(order.metadata as Record<string, unknown>) };
      }
      if (toStringValue(order.settlementId)) {
        normalized.settlementId = toStringValue(order.settlementId);
      }
      ordersById[key] = normalized;
    }
  }

  const actorStats: Record<string, WagerActorStats> = {};
  if (existing.actorStats && typeof existing.actorStats === 'object') {
    for (const [actor, statsRaw] of Object.entries(existing.actorStats)) {
      const key = toStringValue(actor);
      if (!key || !statsRaw || typeof statsRaw !== 'object') continue;
      const stats = statsRaw as unknown as Record<string, unknown>;
      actorStats[key] = {
        posted: Math.max(0, Math.floor(Number(stats.posted ?? 0))),
        joined: Math.max(0, Math.floor(Number(stats.joined ?? 0))),
        won: Math.max(0, Math.floor(Number(stats.won ?? 0))),
        lost: Math.max(0, Math.floor(Number(stats.lost ?? 0))),
        refunded: Math.max(0, Math.floor(Number(stats.refunded ?? 0))),
        totalWagered: Math.max(0, Number(stats.totalWagered ?? 0)),
        totalPayout: Math.max(0, Number(stats.totalPayout ?? 0)),
      };
    }
  }

  const history = Array.isArray(existing.history)
    ? existing.history
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return null;
          const raw = entry as WagerOrder;
          const orderId = toStringValue(raw.orderId);
          return orderId && ordersById[orderId] ? cloneOrder(ordersById[orderId]!) : null;
        })
        .filter((v): v is WagerOrder => Boolean(v))
    : [];

  return {
    ordersById,
    actorStats,
    history,
  };
}

function actorStats(state: WagerEscrowModuleState, actor: string): WagerActorStats {
  return {
    ...(state.actorStats[actor] ?? DEFAULT_ACTOR_STATS),
  };
}

function updateActorStats(
  current: Record<string, WagerActorStats>,
  actor: string,
  mutator: (stats: WagerActorStats) => WagerActorStats,
): Record<string, WagerActorStats> {
  return {
    ...current,
    [actor]: mutator({
      ...(current[actor] ?? DEFAULT_ACTOR_STATS),
    }),
  };
}

function hasOpenOrderForActor(state: WagerEscrowModuleState, actor: string): boolean {
  for (const order of Object.values(state.ordersById)) {
    if (order.status !== 'OPEN') continue;
    if (order.participants.includes(actor)) return true;
  }
  return false;
}

function compareObjective(value: number, comparator: WagerComparator, target: number): boolean {
  if (comparator === '>=') return value >= target;
  if (comparator === '>') return value > target;
  if (comparator === '==') return value === target;
  if (comparator === '<=') return value <= target;
  return value < target;
}

function getCounterValue(state: SnapState, counter: string, entityId: string): number {
  const scoring = (state.modules.scoring ?? {}) as { counters?: Record<string, Record<string, number>> };
  const counters = scoring.counters ?? {};
  const bucket = counters[counter] ?? {};
  return Number(bucket[entityId] ?? 0);
}

function evaluateSinglePlayerObjective(order: WagerOrder, state: SnapState): boolean | null {
  const objective = order.objective;
  if (!objective) return null;
  const counter = toStringValue(objective.counter);
  const comparator = objective.comparator;
  const target = Number(objective.target);
  if (!counter || !comparator || !Number.isFinite(target)) {
    return null;
  }
  const entityId = toStringValue(objective.entityId, '$actor') === '$actor'
    ? order.createdBy
    : toStringValue(objective.entityId);
  if (!entityId) return null;
  const value = getCounterValue(state, counter, entityId);
  return compareObjective(value, comparator, target);
}

function defaultMultiplayerPayout(order: WagerOrder, winners: string[]): WagerPayoutEntry[] {
  if (winners.length === 0) return [];
  const base = Math.floor((order.potAmount / winners.length) * 1_000_000) / 1_000_000;
  let remaining = order.potAmount;
  return winners.map((winner, idx) => {
    const amount = idx === winners.length - 1 ? remaining : Math.min(remaining, base);
    remaining -= amount;
    return {
      recipient: winner,
      amount: Math.max(0, amount),
      reason: 'wager_settle',
    };
  });
}

function trimHistory(history: WagerOrder[], limit: number): WagerOrder[] {
  if (history.length <= limit) return history;
  return history.slice(history.length - limit);
}

export function createWagerEscrowModule(): SnapModule {
  return {
    id: 'wagerEscrow',
    init(_manifest, state) {
      return {
        ...state,
        modules: {
          ...state.modules,
          wagerEscrow: ensureWagerEscrowState(state),
        },
      };
    },
    validateAction(action, manifest, state) {
      const rules = readWagerEscrowRules(manifest);
      const escrow = ensureWagerEscrowState(state);
      if (action.kind === 'WAGER_POST') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId, `wager:${state.matchId}:${state.seq + 1}`);
        if (escrow.ordersById[orderId]) {
          throw new Error(`WAGER_POST orderId '${orderId}' already exists`);
        }
        if (!rules.allowMultipleOpenOrdersPerActor && hasOpenOrderForActor(escrow, action.actor)) {
          throw new Error('WAGER_POST denied: actor already has an open wager');
        }
        const amount = Number(payload.amount);
        if (!Number.isFinite(amount) || amount <= 0) {
          throw new Error('WAGER_POST requires positive amount');
        }
        const mode = toStringValue(payload.mode);
        const isSinglePlayer = mode === 'single-player' || mode === 'single' || Number(payload.maxParticipants) === 1;
        if (rules.mode === 'single-player' && !isSinglePlayer) {
          throw new Error('WAGER_POST denied: wagerEscrow configured for single-player only');
        }
        if (rules.mode === 'multiplayer' && isSinglePlayer) {
          throw new Error('WAGER_POST denied: wagerEscrow configured for multiplayer only');
        }
        const currencyMint = toStringValue(payload.currencyMint, rules.defaultCurrencyMint);
        if (!currencyMint) {
          throw new Error('WAGER_POST requires currencyMint (payload or module config defaultCurrencyMint)');
        }
        const escrowAccount = toStringValue(payload.escrowAccount, rules.defaultEscrowAccount);
        if (!escrowAccount) {
          throw new Error('WAGER_POST requires escrowAccount (payload or module config defaultEscrowAccount)');
        }
        sanitizeObjective(payload.objective, rules.objectiveKindsAllowlist);
      }

      if (action.kind === 'WAGER_JOIN') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId);
        if (!orderId) throw new Error('WAGER_JOIN requires orderId');
        const order = escrow.ordersById[orderId];
        if (!order) throw new Error(`WAGER_JOIN unknown orderId '${orderId}'`);
        if (order.status !== 'OPEN') throw new Error(`WAGER_JOIN order '${orderId}' is not OPEN`);
        if (order.participants.includes(action.actor)) {
          throw new Error(`WAGER_JOIN actor '${action.actor}' already in order '${orderId}'`);
        }
        if (order.isSinglePlayer) {
          throw new Error(`WAGER_JOIN not allowed for single-player order '${orderId}'`);
        }
        if (order.participants.length >= order.maxParticipants) {
          throw new Error(`WAGER_JOIN order '${orderId}' is full`);
        }
        if (!rules.allowMultipleOpenOrdersPerActor && hasOpenOrderForActor(escrow, action.actor)) {
          throw new Error('WAGER_JOIN denied: actor already has an open wager');
        }
      }

      if (action.kind === 'WAGER_MATCH_LOCK' || action.kind === 'WAGER_CANCEL' || action.kind === 'WAGER_SETTLE' || action.kind === 'WAGER_REFUND') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId);
        if (!orderId) throw new Error(`${action.kind} requires orderId`);
        const order = escrow.ordersById[orderId];
        if (!order) throw new Error(`${action.kind} unknown orderId '${orderId}'`);

        if (action.kind === 'WAGER_MATCH_LOCK') {
          if (order.status !== 'OPEN') throw new Error(`WAGER_MATCH_LOCK order '${orderId}' is not OPEN`);
          if (!order.participants.includes(action.actor)) {
            throw new Error(`WAGER_MATCH_LOCK actor '${action.actor}' is not a participant`);
          }
          if (order.isSinglePlayer) {
            if (order.participants.length !== 1) throw new Error(`WAGER_MATCH_LOCK single-player order '${orderId}' must have exactly one participant`);
          } else if (order.participants.length < 2) {
            throw new Error(`WAGER_MATCH_LOCK multiplayer order '${orderId}' requires at least two participants`);
          }
        }

        if (action.kind === 'WAGER_CANCEL') {
          if (!rules.allowCancelOpenOrder) throw new Error('WAGER_CANCEL disabled by module config');
          if (order.status !== 'OPEN') throw new Error(`WAGER_CANCEL order '${orderId}' is not OPEN`);
          if (order.createdBy !== action.actor) throw new Error(`WAGER_CANCEL allowed only for order creator '${order.createdBy}'`);
        }

        if (action.kind === 'WAGER_SETTLE') {
          if (order.status !== 'LOCKED') throw new Error(`WAGER_SETTLE order '${orderId}' is not LOCKED`);
          if (!order.participants.includes(action.actor)) {
            throw new Error(`WAGER_SETTLE actor '${action.actor}' is not a participant`);
          }
          const p = payload;
          const settlementId = toStringValue(p.settlementId);
          if (!settlementId && !order.isSinglePlayer && !Array.isArray(p.winners) && !Array.isArray(p.payoutBreakdown)) {
            throw new Error('WAGER_SETTLE multiplayer orders require winners, payoutBreakdown, or settlementId');
          }
        }

        if (action.kind === 'WAGER_REFUND') {
          if (order.status !== 'OPEN' && order.status !== 'LOCKED') {
            throw new Error(`WAGER_REFUND order '${orderId}' cannot be refunded from status '${order.status}'`);
          }
          if (!order.participants.includes(action.actor)) {
            throw new Error(`WAGER_REFUND actor '${action.actor}' is not a participant`);
          }
        }
      }
    },
    applyAction(action, manifest, state) {
      const rules = readWagerEscrowRules(manifest);
      const escrow = ensureWagerEscrowState(state);

      if (action.kind === 'WAGER_POST') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId, `wager:${state.matchId}:${state.seq + 1}`);
        const mode = toStringValue(payload.mode);
        const explicitSingle = mode === 'single-player' || mode === 'single';
        const maxParticipants = explicitSingle
          ? 1
          : toIntInRange(payload.maxParticipants, rules.defaultMaxParticipants, 1, 64);
        const isSinglePlayer = explicitSingle || maxParticipants === 1;
        const amount = Number(payload.amount);
        const participants = [action.actor];
        const objective = sanitizeObjective(payload.objective, rules.objectiveKindsAllowlist);

        const order: WagerOrder = {
          orderId,
          createdBy: action.actor,
          status: 'OPEN',
          createdAtT: action.t,
          lockedAtT: null,
          resolvedAtT: null,
          currencyMint: toStringValue(payload.currencyMint, rules.defaultCurrencyMint),
          escrowAccount: toStringValue(payload.escrowAccount, rules.defaultEscrowAccount),
          escrowProgram: toStringValue(payload.escrowProgram, rules.defaultEscrowProgram),
          entryAmount: amount,
          participants,
          maxParticipants: Math.max(1, maxParticipants),
          isSinglePlayer,
          objective,
          potAmount: amount,
          winners: [],
          payoutBreakdown: [],
        };
        if (payload.metadata && typeof payload.metadata === 'object') {
          order.metadata = { ...(payload.metadata as Record<string, unknown>) };
        }

        let actorStatsMap = updateActorStats(escrow.actorStats, action.actor, (stats) => ({
          ...stats,
          posted: stats.posted + 1,
          totalWagered: stats.totalWagered + amount,
        }));

        if (isSinglePlayer && toBool(payload.lockOnPost, false)) {
          order.status = 'LOCKED';
          order.lockedAtT = action.t;
        }

        const nextState: WagerEscrowModuleState = {
          ordersById: {
            ...escrow.ordersById,
            [orderId]: order,
          },
          actorStats: actorStatsMap,
          history: escrow.history,
        };

        return {
          ...state,
          modules: {
            ...state.modules,
            wagerEscrow: nextState,
          },
        };
      }

      if (action.kind === 'WAGER_JOIN') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId);
        const existing = escrow.ordersById[orderId];
        if (!existing) return state;

        const order = cloneOrder(existing);
        order.participants = order.participants.concat(action.actor);
        order.potAmount = order.entryAmount * order.participants.length;
        if (rules.autoLockOnJoin && order.participants.length >= order.maxParticipants) {
          order.status = 'LOCKED';
          order.lockedAtT = action.t;
        }

        let actorStatsMap = updateActorStats(escrow.actorStats, action.actor, (stats) => ({
          ...stats,
          joined: stats.joined + 1,
          totalWagered: stats.totalWagered + order.entryAmount,
        }));

        const nextState: WagerEscrowModuleState = {
          ordersById: {
            ...escrow.ordersById,
            [orderId]: order,
          },
          actorStats: actorStatsMap,
          history: escrow.history,
        };

        return {
          ...state,
          modules: {
            ...state.modules,
            wagerEscrow: nextState,
          },
        };
      }

      if (action.kind === 'WAGER_MATCH_LOCK') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId);
        const existing = escrow.ordersById[orderId];
        if (!existing) return state;

        const order = cloneOrder(existing);
        order.status = 'LOCKED';
        order.lockedAtT = action.t;

        return {
          ...state,
          modules: {
            ...state.modules,
            wagerEscrow: {
              ...escrow,
              ordersById: {
                ...escrow.ordersById,
                [orderId]: order,
              },
            },
          },
        };
      }

      if (action.kind === 'WAGER_CANCEL') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId);
        const existing = escrow.ordersById[orderId];
        if (!existing) return state;
        const order = cloneOrder(existing);
        order.status = 'CANCELLED';
        order.resolvedAtT = action.t;
        order.payoutBreakdown = order.participants.map((recipient) => ({
          recipient,
          amount: order.entryAmount,
          reason: 'cancel_refund',
        }));

        let actorStatsMap = { ...escrow.actorStats };
        for (const participant of order.participants) {
          actorStatsMap = updateActorStats(actorStatsMap, participant, (stats) => ({
            ...stats,
            refunded: stats.refunded + 1,
            totalPayout: stats.totalPayout + order.entryAmount,
          }));
        }

        const nextHistory = trimHistory(escrow.history.concat(order), rules.historyLimit);

        return {
          ...state,
          modules: {
            ...state.modules,
            wagerEscrow: {
              ordersById: {
                ...escrow.ordersById,
                [orderId]: order,
              },
              actorStats: actorStatsMap,
              history: nextHistory,
            },
          },
        };
      }

      if (action.kind === 'WAGER_SETTLE') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId);
        const existing = escrow.ordersById[orderId];
        if (!existing) return state;
        const order = cloneOrder(existing);
        const winners = Array.isArray(payload.winners)
          ? payload.winners.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0)
          : [];
        const payoutBreakdown = sanitizePayoutBreakdown(payload.payoutBreakdown);

        let resolvedWinners = winners.filter((w) => order.participants.includes(w));
        let resolvedPayout = payoutBreakdown;

        if (order.isSinglePlayer) {
          const fromPayload = payload.objectiveResult && typeof payload.objectiveResult === 'object'
            ? Boolean((payload.objectiveResult as Record<string, unknown>).success)
            : null;
          const fromState = evaluateSinglePlayerObjective(order, state);
          const success = fromPayload !== null ? fromPayload : (fromState ?? false);
          resolvedWinners = success ? [order.createdBy] : [];
          if (resolvedPayout.length === 0) {
            if (success) {
              resolvedPayout = [{
                recipient: order.createdBy,
                amount: order.potAmount,
                reason: 'single_player_success',
              }];
            } else if (rules.singlePlayerLoseRecipient) {
              resolvedPayout = [{
                recipient: rules.singlePlayerLoseRecipient,
                amount: order.potAmount,
                reason: 'single_player_fail',
              }];
            }
          }
        } else {
          if (resolvedWinners.length === 0 && resolvedPayout.length > 0) {
            resolvedWinners = resolvedPayout
              .map((entry) => entry.recipient)
              .filter((v) => order.participants.includes(v));
          }
          if (resolvedPayout.length === 0) {
            resolvedPayout = defaultMultiplayerPayout(order, resolvedWinners);
          }
        }

        order.status = 'SETTLED';
        order.resolvedAtT = action.t;
        order.winners = [...new Set(resolvedWinners)];
        order.payoutBreakdown = resolvedPayout;
        const settlementId = toStringValue(payload.settlementId, `wager-settle:${state.matchId}:${state.seq + 1}`);
        if (settlementId) order.settlementId = settlementId;

        let actorStatsMap = { ...escrow.actorStats };
        const winnerSet = new Set(order.winners);
        for (const participant of order.participants) {
          actorStatsMap = updateActorStats(actorStatsMap, participant, (stats) => ({
            ...stats,
            won: stats.won + (winnerSet.has(participant) ? 1 : 0),
            lost: stats.lost + (winnerSet.has(participant) ? 0 : 1),
          }));
        }
        for (const payout of order.payoutBreakdown) {
          actorStatsMap = updateActorStats(actorStatsMap, payout.recipient, (stats) => ({
            ...stats,
            totalPayout: stats.totalPayout + payout.amount,
          }));
        }

        const nextHistory = trimHistory(escrow.history.concat(order), rules.historyLimit);

        return {
          ...state,
          modules: {
            ...state.modules,
            wagerEscrow: {
              ordersById: {
                ...escrow.ordersById,
                [orderId]: order,
              },
              actorStats: actorStatsMap,
              history: nextHistory,
            },
          },
        };
      }

      if (action.kind === 'WAGER_REFUND') {
        const payload = (action.payload ?? {}) as Record<string, unknown>;
        const orderId = toStringValue(payload.orderId);
        const existing = escrow.ordersById[orderId];
        if (!existing) return state;
        const order = cloneOrder(existing);
        order.status = 'REFUNDED';
        order.resolvedAtT = action.t;
        order.winners = [];
        order.payoutBreakdown = order.participants.map((recipient) => ({
          recipient,
          amount: order.entryAmount,
          reason: 'refund',
        }));

        let actorStatsMap = { ...escrow.actorStats };
        for (const participant of order.participants) {
          actorStatsMap = updateActorStats(actorStatsMap, participant, (stats) => ({
            ...stats,
            refunded: stats.refunded + 1,
            totalPayout: stats.totalPayout + order.entryAmount,
          }));
        }

        const nextHistory = trimHistory(escrow.history.concat(order), rules.historyLimit);

        return {
          ...state,
          modules: {
            ...state.modules,
            wagerEscrow: {
              ordersById: {
                ...escrow.ordersById,
                [orderId]: order,
              },
              actorStats: actorStatsMap,
              history: nextHistory,
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
      const escrow = ensureWagerEscrowState(state);
      const orders = Object.values(escrow.ordersById);
      const countByStatus = {
        OPEN: 0,
        LOCKED: 0,
        SETTLED: 0,
        REFUNDED: 0,
        CANCELLED: 0,
      };
      let totalEscrowed = 0;
      let totalSettledPayout = 0;

      for (const order of orders) {
        countByStatus[order.status] += 1;
        totalEscrowed += order.potAmount;
        if (order.status === 'SETTLED' || order.status === 'REFUNDED' || order.status === 'CANCELLED') {
          for (const payout of order.payoutBreakdown) {
            totalSettledPayout += payout.amount;
          }
        }
      }

      return {
        wagerEscrow: {
          totals: {
            orders: orders.length,
            totalEscrowed,
            totalSettledPayout,
            byStatus: countByStatus,
          },
          actorStats: escrow.actorStats,
          recentResolvedOrders: escrow.history.slice(Math.max(0, escrow.history.length - 10)),
        },
      };
    },
  };
}

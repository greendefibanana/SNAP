import type { SnapAction, SnapState } from '../engine/types.js';

interface TokenizationBurnEvent {
  eventId: string;
  kind: string;
  classId: string;
  actor: string;
  amount?: number;
  from?: string;
}

interface TokenBurnGuardRuntimeState {
  spentByEventId: Record<string, number>;
}

export interface TokenBurnSpendRequirement {
  actionKind: string;
  classId: string;
  amount: number;
  actorPath?: 'actor' | `payload.${string}`;
  when?: (action: SnapAction, state: SnapState) => boolean;
  errorMessage?: string;
}

export interface TokenBurnGuardConfig {
  requirements: TokenBurnSpendRequirement[];
  customStateKey?: string;
}

function toStringValue(input: unknown): string {
  return String(input ?? '').trim();
}

function toPositiveAmount(input: unknown): number {
  const n = Number(input);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

function readTokenizationBurnEvents(state: SnapState): TokenizationBurnEvent[] {
  const tokenization = (state.modules.tokenization ?? {}) as { eventLog?: unknown[] };
  const rawEvents = Array.isArray(tokenization.eventLog) ? tokenization.eventLog : [];
  const burns: TokenizationBurnEvent[] = [];
  for (const raw of rawEvents) {
    if (!raw || typeof raw !== 'object') continue;
    const event = raw as Record<string, unknown>;
    if (toStringValue(event.kind) !== 'TOKEN_BURN') continue;
    const eventId = toStringValue(event.eventId);
    const classId = toStringValue(event.classId);
    const actor = toStringValue(event.actor);
    if (!eventId || !classId || !actor) continue;
    const amount = Number(event.amount);
    burns.push({
      eventId,
      kind: 'TOKEN_BURN',
      classId,
      actor,
      ...(Number.isFinite(amount) && amount > 0 ? { amount } : {}),
      ...(toStringValue(event.from) ? { from: toStringValue(event.from) } : {}),
    });
  }
  return burns;
}

function ensureGuardRuntimeState(state: SnapState, customStateKey: string): TokenBurnGuardRuntimeState {
  const raw = state.custom[customStateKey];
  if (!raw || typeof raw !== 'object') {
    return { spentByEventId: {} };
  }
  const input = raw as { spentByEventId?: unknown };
  const spentByEventId: Record<string, number> = {};
  if (input.spentByEventId && typeof input.spentByEventId === 'object') {
    for (const [eventId, spent] of Object.entries(input.spentByEventId as Record<string, unknown>)) {
      const key = toStringValue(eventId);
      if (!key) continue;
      const n = Number(spent);
      if (Number.isFinite(n) && n > 0) spentByEventId[key] = n;
    }
  }
  return { spentByEventId };
}

function withGuardRuntimeState(
  state: SnapState,
  customStateKey: string,
  runtime: TokenBurnGuardRuntimeState,
): SnapState {
  return {
    ...state,
    custom: {
      ...state.custom,
      [customStateKey]: {
        spentByEventId: runtime.spentByEventId,
      },
    },
  };
}

function readPath(action: SnapAction, actorPath: TokenBurnSpendRequirement['actorPath']): string {
  if (!actorPath || actorPath === 'actor') return toStringValue(action.actor);
  const payload = (action.payload ?? {}) as Record<string, unknown>;
  const key = actorPath.slice('payload.'.length);
  if (!key) return toStringValue(action.actor);
  return toStringValue(payload[key]);
}

function actionRequirements(
  action: SnapAction,
  state: SnapState,
  requirements: TokenBurnSpendRequirement[],
): TokenBurnSpendRequirement[] {
  return requirements.filter((req) => {
    if (req.actionKind !== action.kind) return false;
    if (req.when && !req.when(action, state)) return false;
    return true;
  });
}

function consumeBurnCredits(
  runtime: TokenBurnGuardRuntimeState,
  events: TokenizationBurnEvent[],
  classId: string,
  actor: string,
  requiredAmount: number,
): boolean {
  let remaining = requiredAmount;
  const eligible = events.filter((e) => e.classId === classId && (e.actor === actor || e.from === actor));
  for (const event of eligible) {
    const total = toPositiveAmount(event.amount ?? 0);
    if (total <= 0) continue;
    const spent = Number(runtime.spentByEventId[event.eventId] ?? 0);
    const available = Math.max(0, total - spent);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    runtime.spentByEventId[event.eventId] = spent + take;
    remaining -= take;
    if (remaining <= 0) {
      return true;
    }
  }
  return false;
}

export function applyTokenBurnGuards(state: SnapState, action: SnapAction, config: TokenBurnGuardConfig): SnapState {
  const customStateKey = toStringValue(config.customStateKey) || 'tokenBurnGuard';
  const requirements = actionRequirements(action, state, config.requirements);
  if (requirements.length === 0) return state;

  const burns = readTokenizationBurnEvents(state);
  const runtime = ensureGuardRuntimeState(state, customStateKey);

  for (const requirement of requirements) {
    const amount = toPositiveAmount(requirement.amount);
    if (amount <= 0) continue;
    const actor = readPath(action, requirement.actorPath);
    if (!actor) {
      throw new Error(`Token burn guard missing actor for action '${action.kind}'`);
    }
    const ok = consumeBurnCredits(runtime, burns, requirement.classId, actor, amount);
    if (!ok) {
      throw new Error(
        requirement.errorMessage
        ?? `Action '${action.kind}' requires burning ${amount} of token class '${requirement.classId}'`,
      );
    }
  }

  return withGuardRuntimeState(state, customStateKey, runtime);
}

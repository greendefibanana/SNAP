import type { SnapState } from '../engine/types.js';
import type { SnapModule } from './types.js';

export interface ScoringModuleState extends Record<string, unknown> {
  counters: Record<string, Record<string, number>>;
}

function ensureScoringState(state: SnapState): ScoringModuleState {
  const existing = state.modules.scoring as ScoringModuleState | undefined;
  if (existing && typeof existing === 'object' && existing.counters && typeof existing.counters === 'object') {
    return {
      counters: { ...existing.counters },
    };
  }
  return {
    counters: {},
  };
}

export function addToCounter(
  scoring: ScoringModuleState,
  counterName: string,
  entityId: string,
  delta: number,
): ScoringModuleState {
  const safeCounterName = String(counterName || '').trim();
  const safeEntityId = String(entityId || '').trim();
  if (!safeCounterName || !safeEntityId) {
    return scoring;
  }

  const nextCounters: Record<string, Record<string, number>> = {
    ...scoring.counters,
  };

  const counter = {
    ...(nextCounters[safeCounterName] ?? {}),
  };

  const current = Number(counter[safeEntityId] ?? 0);
  const next = current + (Number.isFinite(delta) ? delta : 0);
  counter[safeEntityId] = next;
  nextCounters[safeCounterName] = counter;

  return {
    counters: nextCounters,
  };
}

export function createScoringModule(): SnapModule {
  return {
    id: 'scoring',
    init(_manifest, state) {
      return {
        ...state,
        modules: {
          ...state.modules,
          scoring: ensureScoringState(state),
        },
      };
    },
    applyAction(action, _manifest, state) {
      if (action.kind !== 'SCORE_ADD') {
        return state;
      }
      const payload = (action.payload ?? {}) as {
        counter?: string;
        entityId?: string;
        delta?: number;
      };

      const scoring = ensureScoringState(state);
      const updated = addToCounter(
        scoring,
        String(payload.counter ?? ''),
        String(payload.entityId ?? ''),
        Number(payload.delta ?? 0),
      );

      return {
        ...state,
        modules: {
          ...state.modules,
          scoring: updated,
        },
      };
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(_manifest, state) {
      const scoring = ensureScoringState(state);
      return {
        scoring: {
          counters: scoring.counters,
        },
      };
    },
  };
}

import type { SnapModule } from './types.js';
import type { SnapManifest, SnapState } from '../engine/types.js';

export interface ProvenanceModuleState extends Record<string, unknown> {
  usedModifierIds: string[];
  logHash: string;
}

function ensureProvenanceState(state: SnapState): ProvenanceModuleState {
  const existing = state.modules.provenance as ProvenanceModuleState | undefined;
  if (!existing || typeof existing !== 'object') {
    return {
      usedModifierIds: [],
      logHash: 'genesis',
    };
  }

  const usedModifierIds = Array.isArray(existing.usedModifierIds)
    ? existing.usedModifierIds.map((v) => String(v))
    : [];

  return {
    usedModifierIds,
    logHash: String(existing.logHash ?? 'genesis'),
  };
}

function collectActiveModifiers(state: SnapState): string[] {
  const mutation = (state.modules.mutation ?? {}) as { activeModifiers?: Record<string, unknown> };
  const activeModifiers = mutation.activeModifiers ?? {};
  return Object.keys(activeModifiers);
}

function collectFinalCounters(state: SnapState): Record<string, Record<string, number>> {
  const scoring = (state.modules.scoring ?? {}) as { counters?: Record<string, Record<string, number>> };
  return { ...(scoring.counters ?? {}) };
}

function collectStakeInfo(state: SnapState): Record<string, unknown> | null {
  const stake = state.modules.stake;
  if (!stake) return null;
  const s = stake as Record<string, unknown>;
  return {
    wagerAmount: Number(s.wagerAmount ?? 0),
    currencyMint: String(s.currencyMint ?? ''),
    escrowAccount: String(s.escrowAccount ?? ''),
    escalationLevel: Number(s.escalationLevel ?? 0),
  };
}

export function buildMatchSummary(state: SnapState, manifest: SnapManifest): Record<string, unknown> {
  const provenance = ensureProvenanceState(state);
  const activeModifiers = collectActiveModifiers(state);
  const usedModifiers = [...new Set([...provenance.usedModifierIds, ...activeModifiers])];

  return {
    matchId: state.matchId,
    gameId: manifest.gameId,
    rulesetId: manifest.rulesetId,
    finalCounters: collectFinalCounters(state),
    activeModifiersUsed: usedModifiers,
    ...(collectStakeInfo(state) ? { stake: collectStakeInfo(state) } : {}),
    finalStateHash: state.stateHash,
    logHash: provenance.logHash || 'genesis',
  };
}

export function createProvenanceModule(): SnapModule {
  return {
    id: 'provenance',
    init(_manifest, state) {
      const provenance = ensureProvenanceState(state);
      return {
        ...state,
        modules: {
          ...state.modules,
          provenance,
        },
      };
    },
    applyAction(action, _manifest, state) {
      const provenance = ensureProvenanceState(state);
      if (action.kind === 'MODIFIER_START') {
        const payload = (action.payload ?? {}) as { id?: unknown };
        const id = String(payload.id ?? '').trim();
        if (id && !provenance.usedModifierIds.includes(id)) {
          provenance.usedModifierIds = provenance.usedModifierIds.concat(id);
        }
      }

      return {
        ...state,
        modules: {
          ...state.modules,
          provenance,
        },
      };
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(manifest, state) {
      return buildMatchSummary(state, manifest);
    },
  };
}

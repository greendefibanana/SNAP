import { addToCounter, type ScoringModuleState } from '../modules/scoring.js';
import type { SnapAction, SnapManifest, SnapRuleset, SnapState } from '../engine/types.js';

interface SpaceHuggersRunState {
  resources: {
    grenades: number;
  };
  progress: {
    level: number;
  };
  runEnd: {
    result: string | null;
    provenanceSummary: Record<string, unknown> | null;
  };
}

function getMatchId(manifest: SnapManifest): string {
  const rv = manifest.ruleVars?.matchId;
  if (rv && (rv.type === 'string' || rv.type === 'enum')) {
    return String(rv.value);
  }
  return 'space-huggers-local';
}

function getScoringState(state: SnapState): ScoringModuleState {
  const raw = state.modules.scoring as ScoringModuleState | undefined;
  if (raw && typeof raw === 'object' && raw.counters && typeof raw.counters === 'object') {
    return {
      counters: { ...raw.counters },
    };
  }
  return { counters: {} };
}

function withCounter(state: SnapState, counter: string, entityId: string, delta: number): SnapState {
  const scoring = getScoringState(state);
  const updated = addToCounter(scoring, counter, entityId, delta);
  return {
    ...state,
    modules: {
      ...state.modules,
      scoring: updated,
    },
  };
}

function getRunState(state: SnapState): SpaceHuggersRunState {
  const raw = state.custom.spaceHuggersRun as Partial<SpaceHuggersRunState> | undefined;
  return {
    resources: {
      grenades: Number.isFinite(raw?.resources?.grenades) ? Number(raw?.resources?.grenades) : 0,
    },
    progress: {
      level: Number.isFinite(raw?.progress?.level) ? Number(raw?.progress?.level) : 0,
    },
    runEnd: {
      result: typeof raw?.runEnd?.result === 'string' ? raw.runEnd.result : null,
      provenanceSummary: raw?.runEnd?.provenanceSummary && typeof raw.runEnd.provenanceSummary === 'object'
        ? { ...raw.runEnd.provenanceSummary as Record<string, unknown> }
        : null,
    },
  };
}

function withRunState(state: SnapState, run: SpaceHuggersRunState): SnapState {
  return {
    ...state,
    custom: {
      ...state.custom,
      spaceHuggersRun: run,
    },
  };
}

export const spaceHuggersRunRuleset: SnapRuleset = {
  id: 'space-huggers-run',
  createInitialState(manifest: SnapManifest): SnapState {
    return {
      matchId: getMatchId(manifest),
      phase: 'PREMATCH',
      seq: 0,
      stateHash: '',
      ruleVars: { ...(manifest.ruleVars ?? {}) },
      modules: {},
      custom: {
        spaceHuggersRun: {
          resources: {
            grenades: 0,
          },
          progress: {
            level: 0,
          },
          runEnd: {
            result: null,
            provenanceSummary: null,
          },
        } satisfies SpaceHuggersRunState,
      },
    };
  },
  reduce(inputState: SnapState, action: SnapAction): SnapState {
    let state = inputState;
    const run = getRunState(state);

    if (action.kind === 'KILL') {
      state = withCounter(state, 'kills', 'player', 1);
      if (state.phase === 'PREMATCH') {
        state = { ...state, phase: 'LIVE' };
      }
      return withRunState(state, run);
    }

    if (action.kind === 'SCORE_ADD') {
      const payload = (action.payload ?? {}) as { delta?: number };
      const delta = Number(payload.delta ?? 0);
      state = withCounter(state, 'score', 'player', Number.isFinite(delta) ? delta : 0);
      if (state.phase === 'PREMATCH') {
        state = { ...state, phase: 'LIVE' };
      }
      return withRunState(state, run);
    }

    if (action.kind === 'RESOURCE_SET') {
      const payload = (action.payload ?? {}) as { key?: string; value?: number };
      if (String(payload.key || '').trim() === 'grenades') {
        run.resources.grenades = Math.max(0, Math.floor(Number(payload.value ?? 0)));
      }
      if (state.phase === 'PREMATCH') {
        state = { ...state, phase: 'LIVE' };
      }
      return withRunState(state, run);
    }

    if (action.kind === 'PROGRESS_SET') {
      const payload = (action.payload ?? {}) as { key?: string; value?: number };
      if (String(payload.key || '').trim() === 'level') {
        run.progress.level = Math.max(0, Math.floor(Number(payload.value ?? 0)));
      }
      if (state.phase === 'PREMATCH') {
        state = { ...state, phase: 'LIVE' };
      }
      return withRunState(state, run);
    }

    if (action.kind === 'RUN_END') {
      const payload = (action.payload ?? {}) as { result?: string } | { result?: { type?: string } };
      const resultRaw = (payload && typeof payload.result === 'object')
        ? (payload.result as { type?: string }).type
        : (payload as { result?: string }).result;
      run.runEnd.result = String(resultRaw ?? 'unknown');
      const provenance = state.modules.provenance;
      run.runEnd.provenanceSummary = provenance && typeof provenance === 'object'
        ? { ...provenance as Record<string, unknown> }
        : { stateHash: state.stateHash, seq: state.seq };
      state = { ...state, phase: 'POSTMATCH' };
      return withRunState(state, run);
    }

    return state;
  },
};

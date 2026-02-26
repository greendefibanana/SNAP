import { createScoringModule } from '../modules/scoring.js';
import type { ScoringModuleState } from '../modules/scoring.js';
import type { SnapAction, SnapManifest, SnapRuleset, SnapState } from '../engine/types.js';

interface Ctf2dState {
  scoresByTeam: Record<string, number>;
  flagHeldBy?: {
    teamId: string;
    playerId: string;
  };
  timer: number;
}

const scoringModule = createScoringModule();

function getMatchId(manifest: SnapManifest): string {
  const rv = manifest.ruleVars?.matchId;
  if (rv && (rv.type === 'string' || rv.type === 'enum')) {
    return String(rv.value);
  }
  return 'ctf-2d-sim';
}

function getCtf2dState(state: SnapState): Ctf2dState {
  const existing = state.custom.ctf2d as Partial<Ctf2dState> | undefined;
  return {
    scoresByTeam: { ...(existing?.scoresByTeam ?? {}) },
    ...(existing?.flagHeldBy ? { flagHeldBy: { ...existing.flagHeldBy } } : {}),
    timer: Number.isFinite(existing?.timer) ? Number(existing?.timer) : 0,
  };
}

function withCtf2dState(state: SnapState, ctf2d: Ctf2dState): SnapState {
  return {
    ...state,
    custom: {
      ...state.custom,
      ctf2d,
    },
  };
}

function applyScoreAdd(state: SnapState, teamId: string): SnapState {
  const apply = scoringModule.applyAction;
  if (!apply) return state;
  return apply(
    {
      matchId: state.matchId,
      actor: 'ruleset:ctf2d',
      t: 0,
      kind: 'SCORE_ADD',
      payload: {
        counter: 'ctf_score',
        entityId: teamId,
        delta: 1,
      },
    },
    {} as SnapManifest,
    state,
  );
}

function readCounterValue(state: SnapState, teamId: string): number {
  const scoring = (state.modules.scoring as ScoringModuleState | undefined) ?? { counters: {} };
  return Number(scoring.counters?.ctf_score?.[teamId] ?? 0);
}

export const ctf2dRuleset: SnapRuleset = {
  id: 'ctf-2d',
  createInitialState(manifest: SnapManifest): SnapState {
    const matchId = getMatchId(manifest);
    return {
      matchId,
      phase: 'PREMATCH',
      seq: 0,
      stateHash: '',
      ruleVars: { ...(manifest.ruleVars ?? {}) },
      modules: {},
      custom: {
        ctf2d: {
          scoresByTeam: {},
          timer: 0,
        } satisfies Ctf2dState,
      },
    };
  },
  reduce(inputState: SnapState, action: SnapAction): SnapState {
    let state = inputState;
    const ctf2d = getCtf2dState(state);

    if (action.kind === 'FLAG_PICKUP') {
      const payload = (action.payload ?? {}) as { teamId?: string; playerId?: string };
      const teamId = String(payload.teamId ?? '').trim();
      const playerId = String(payload.playerId ?? '').trim();
      if (!teamId || !playerId) return state;
      ctf2d.flagHeldBy = { teamId, playerId };
      if (state.phase === 'PREMATCH') {
        state = { ...state, phase: 'LIVE' };
      }
      return withCtf2dState(state, ctf2d);
    }

    if (action.kind === 'FLAG_CAPTURE') {
      const payload = (action.payload ?? {}) as { teamId?: string };
      const teamId = String(payload.teamId ?? '').trim();
      if (!teamId) return state;
      state = applyScoreAdd(state, teamId);
      const nextValue = readCounterValue(state, teamId);
      ctf2d.scoresByTeam[teamId] = nextValue;
      delete ctf2d.flagHeldBy;
      if (state.phase === 'PREMATCH') {
        state = { ...state, phase: 'LIVE' };
      }
      return withCtf2dState(state, ctf2d);
    }

    if (action.kind === 'TICK') {
      const payload = (action.payload ?? {}) as { dtSec?: number };
      const dtSec = Math.max(0, Number(payload.dtSec ?? 0));
      ctf2d.timer += dtSec;
      if (state.phase === 'PREMATCH' && dtSec > 0) {
        state = { ...state, phase: 'LIVE' };
      }
      return withCtf2dState(state, ctf2d);
    }

    return state;
  },
};

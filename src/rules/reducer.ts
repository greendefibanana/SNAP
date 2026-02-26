import { createMatchConfig } from './config.js';
import { computeMatchStateHash } from './hash.js';
import type { MatchAction, MatchConfig, MatchState, TeamId } from './types.js';

const TEAM_IDS: TeamId[] = ['blue', 'red'];

function positiveOrZero(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value;
}

function normalizePresenceCount(value: number): number {
  return Math.floor(positiveOrZero(value));
}

function cloneState(state: MatchState): MatchState {
  return {
    ...state,
    config: { ...state.config },
    signalTotals: { ...state.signalTotals },
    presence: { ...state.presence },
    drop: { ...state.drop },
    activeDropBuff: { ...state.activeDropBuff },
    grantedDropIds: new Set(state.grantedDropIds),
  };
}

function recalcControl(state: MatchState): void {
  const blue = state.presence.blue;
  const red = state.presence.red;

  if (blue > 0 && red > 0) {
    state.contested = true;
    state.ownerTeamId = null;
    return;
  }
  state.contested = false;
  if (blue > 0 && red === 0) {
    state.ownerTeamId = 'blue';
    return;
  }
  if (red > 0 && blue === 0) {
    state.ownerTeamId = 'red';
    return;
  }
  state.ownerTeamId = null;
}

function settleWinCondition(state: MatchState): boolean {
  for (const teamId of TEAM_IDS) {
    if (state.signalTotals[teamId] >= state.config.winSignal) {
      state.phase = 'POSTMATCH';
      state.winnerTeamId = teamId;
      state.phaseEndsAt = null;
      return true;
    }
  }
  return false;
}

function advanceZonePhase(state: MatchState): void {
  if (state.zonePhase === 'COUNTDOWN') {
    state.zonePhase = 'ACTIVE';
    state.phaseEndsAt = state.nowSec + state.config.zoneActiveSec;
    return;
  }

  state.activeZoneIndex += 1;
  state.zonePhase = 'COUNTDOWN';
  state.phaseEndsAt = state.nowSec + state.config.zoneCountdownSec;
}

function applyTick(state: MatchState, dtSec: number): void {
  let remaining = positiveOrZero(dtSec);
  if (remaining <= 0) {
    return;
  }

  while (remaining > 0) {
    if (state.phase !== 'LIVE' || state.phaseEndsAt === null) {
      state.nowSec += remaining;
      return;
    }

    const timeToBoundary = Math.max(0, state.phaseEndsAt - state.nowSec);
    const step = Math.min(remaining, timeToBoundary);

    if (step > 0 && state.zonePhase === 'ACTIVE' && !state.contested && state.ownerTeamId) {
      state.signalTotals[state.ownerTeamId] += step * state.config.signalRatePerSec;
      if (settleWinCondition(state)) {
        state.nowSec += step;
        return;
      }
    }

    state.nowSec += step;
    remaining -= step;

    if (state.phase !== 'LIVE') {
      if (remaining > 0) {
        state.nowSec += remaining;
      }
      return;
    }

    if (state.phaseEndsAt !== null && state.nowSec + 1e-9 >= state.phaseEndsAt) {
      advanceZonePhase(state);
    }

    if (step === 0 && timeToBoundary === 0) {
      advanceZonePhase(state);
      if (remaining <= 0) {
        return;
      }
    }
  }
}

function attachHash(state: MatchState): MatchState {
  state.stateHash = computeMatchStateHash(state);
  return state;
}

export function createInitialMatchState(configOverride: Partial<MatchConfig> = {}): MatchState {
  const config = createMatchConfig(configOverride);
  const state: MatchState = {
    config,
    phase: 'PREMATCH',
    activeZoneIndex: 0,
    zonePhase: 'COUNTDOWN',
    phaseEndsAt: null,
    nowSec: 0,
    signalTotals: { blue: 0, red: 0 },
    contested: false,
    ownerTeamId: null,
    presence: { blue: 0, red: 0 },
    drop: {
      status: 'IDLE',
      activeDropId: null,
      lastExtractedByTeamId: null,
    },
    activeDropBuff: { blue: null, red: null },
    grantedDropIds: new Set<string>(),
    selectedLoadoutSlot: null,
    winnerTeamId: null,
    seq: 0,
    stateHash: '',
  };
  return attachHash(state);
}

export function applyAction(current: MatchState, action: MatchAction): MatchState {
  const next = cloneState(current);
  next.seq += 1;

  if (action.type === 'SELECT_LOADOUT') {
    next.selectedLoadoutSlot = Math.floor(action.slot);
    if (next.phase === 'PREMATCH') {
      next.phase = 'LIVE';
      next.zonePhase = 'COUNTDOWN';
      next.phaseEndsAt = next.nowSec + next.config.zoneCountdownSec;
    }
    return attachHash(next);
  }

  if (action.type === 'PRESENCE') {
    next.presence[action.teamId] = normalizePresenceCount(action.count);
    recalcControl(next);
    return attachHash(next);
  }

  if (action.type === 'DROP_EXTRACT_COMPLETE') {
    if (next.phase !== 'POSTMATCH' && next.config.dropsEnabled && !next.grantedDropIds.has(action.dropId)) {
      next.grantedDropIds.add(action.dropId);
      next.drop.status = 'EXTRACTED';
      next.drop.activeDropId = action.dropId;
      next.drop.lastExtractedByTeamId = action.teamId;
      next.activeDropBuff[action.teamId] = action.buffKey ?? `drop:${action.dropId}`;
    }
    return attachHash(next);
  }

  applyTick(next, action.dtSec);
  return attachHash(next);
}

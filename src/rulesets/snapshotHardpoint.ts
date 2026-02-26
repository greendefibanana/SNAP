import { createMutationModule } from '../modules/mutation.js';
import { addToCounter } from '../modules/scoring.js';
import type { ScoringModuleState } from '../modules/scoring.js';
import type { SnapAction, SnapManifest, SnapRuleset, SnapState } from '../engine/types.js';

type ZonePhase = 'COUNTDOWN' | 'ACTIVE';
type DropState = 'INACTIVE' | 'INCOMING' | 'LANDED' | 'EXTRACTING' | 'EXTRACTED' | 'EXPIRED';

interface SnapshotHardpointDrop {
  state: DropState;
  dropId: string | null;
  zoneIndex: number | null;
  eligibleTeamId: string | null;
  endsAtMs: number | null;
  extractProgressMs: number;
  rewardKey: string;
  extractingTeamId?: string;
  extractingPlayerId?: string;
}

interface SnapshotHardpointState {
  activeZoneIndex: number;
  zonePhase: ZonePhase;
  phaseEndsAtMs: number;
  ownerTeamId: string | null;
  contested: boolean;
  presenceByTeam: Record<string, number>;
  drop: SnapshotHardpointDrop;
  dropSeq: number;
  dropScheduleRemainingMs: number;
  selectedLoadoutSlot: number | null;
  grantedDropIds: Record<string, true>;
  activeDropBuffByTeam: Record<string, string>;
}

const COUNTDOWN_MS = 30_000;
const ACTIVE_MS = 60_000;
const DEFAULT_ZONE_COUNT = 3;
const DEFAULT_DROP_INTERVAL_SEC = 30;
const DEFAULT_DROP_INCOMING_SEC = 2;
const DEFAULT_DROP_EXTRACT_SEC = 8;
const DEFAULT_DROP_EXPIRE_SEC = 60;
const DROP_TERMINAL_LINGER_MS = 1_000;
const mutationModule = createMutationModule();

const BUFF_TTL_SEC: Record<string, number> = {
  FORGE_LINK: 30,
  OVERCLOCK: 20,
  default: 25,
};
const DROP_REWARDS = [
  'FORGE_LINK',
  'SKY_EYE_RECON',
  'NEURO_TOXIN_CLOUD',
  'STAMPEDE_OVERDRIVE',
  'SCRAP_MAGNET',
] as const;

function getZoneCount(manifest: SnapManifest): number {
  const raw = manifest.ruleVars?.zoneCount;
  if (raw && raw.type === 'number') {
    const n = Math.floor(raw.value);
    if (n > 0) return n;
  }
  return DEFAULT_ZONE_COUNT;
}

function getRuleVarSeconds(manifest: SnapManifest, key: string, fallbackSec: number): number {
  const raw = manifest.ruleVars?.[key];
  if (raw && raw.type === 'number') {
    const n = Number(raw.value);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return fallbackSec;
}

function getDropIntervalMs(manifest: SnapManifest): number {
  return Math.round(getRuleVarSeconds(manifest, 'dropIntervalSec', DEFAULT_DROP_INTERVAL_SEC) * 1000);
}

function getDropIncomingMs(manifest: SnapManifest): number {
  return Math.round(getRuleVarSeconds(manifest, 'dropIncomingSec', DEFAULT_DROP_INCOMING_SEC) * 1000);
}

function getDropExtractMs(manifest: SnapManifest): number {
  return Math.round(getRuleVarSeconds(manifest, 'dropExtractSec', DEFAULT_DROP_EXTRACT_SEC) * 1000);
}

function getDropExpireMs(manifest: SnapManifest): number {
  return Math.round(getRuleVarSeconds(manifest, 'dropExpireSec', DEFAULT_DROP_EXPIRE_SEC) * 1000);
}

function pickDeterministicReward(dropId: string): string {
  let h = 2166136261;
  for (let i = 0; i < dropId.length; i++) {
    h ^= dropId.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return DROP_REWARDS[h % DROP_REWARDS.length] ?? DROP_REWARDS[0];
}

function getHardpointState(state: SnapState): SnapshotHardpointState {
  const existing = state.custom.snapshotHardpoint as Partial<SnapshotHardpointState> | undefined;
  const intervalMs = getDropIntervalMs({ ...state, ruleVars: state.ruleVars } as unknown as SnapManifest);
  const existingDrop = existing?.drop;
  const normalizedDropState = (
    existingDrop?.state === 'INCOMING'
      || existingDrop?.state === 'LANDED'
      || existingDrop?.state === 'EXTRACTING'
      || existingDrop?.state === 'EXTRACTED'
      || existingDrop?.state === 'EXPIRED'
  ) ? existingDrop.state : 'INACTIVE';
  return {
    activeZoneIndex: Number.isFinite(existing?.activeZoneIndex) ? Number(existing?.activeZoneIndex) : 0,
    zonePhase: existing?.zonePhase === 'ACTIVE' ? 'ACTIVE' : 'COUNTDOWN',
    phaseEndsAtMs: Number.isFinite(existing?.phaseEndsAtMs) ? Number(existing?.phaseEndsAtMs) : COUNTDOWN_MS,
    ownerTeamId: typeof existing?.ownerTeamId === 'string' ? existing.ownerTeamId : null,
    contested: Boolean(existing?.contested),
    presenceByTeam: { ...(existing?.presenceByTeam ?? {}) },
    drop: {
      state: normalizedDropState,
      dropId: typeof existingDrop?.dropId === 'string' ? existingDrop.dropId : null,
      zoneIndex: Number.isFinite(existingDrop?.zoneIndex) ? Number(existingDrop?.zoneIndex) : null,
      eligibleTeamId: typeof existingDrop?.eligibleTeamId === 'string' ? existingDrop.eligibleTeamId : null,
      endsAtMs: Number.isFinite(existingDrop?.endsAtMs) ? Number(existingDrop?.endsAtMs) : null,
      extractProgressMs: Number.isFinite(existingDrop?.extractProgressMs) ? Number(existingDrop?.extractProgressMs) : 0,
      rewardKey: typeof existingDrop?.rewardKey === 'string' && existingDrop.rewardKey ? existingDrop.rewardKey : 'FORGE_LINK',
      ...(typeof existingDrop?.extractingTeamId === 'string'
        ? { extractingTeamId: existingDrop.extractingTeamId }
        : {}),
      ...(typeof existingDrop?.extractingPlayerId === 'string'
        ? { extractingPlayerId: existingDrop.extractingPlayerId }
        : {}),
    },
    dropSeq: Number.isFinite(existing?.dropSeq) ? Number(existing?.dropSeq) : 0,
    dropScheduleRemainingMs: Number.isFinite(existing?.dropScheduleRemainingMs)
      ? Math.max(0, Number(existing?.dropScheduleRemainingMs))
      : intervalMs,
    selectedLoadoutSlot: Number.isFinite(existing?.selectedLoadoutSlot) ? Number(existing?.selectedLoadoutSlot) : null,
    grantedDropIds: { ...(existing?.grantedDropIds ?? {}) },
    activeDropBuffByTeam: { ...(existing?.activeDropBuffByTeam ?? {}) },
  };
}

function withHardpointState(state: SnapState, hardpoint: SnapshotHardpointState): SnapState {
  return {
    ...state,
    custom: {
      ...state.custom,
      snapshotHardpoint: hardpoint,
    },
  };
}

function refreshOwnership(hardpoint: SnapshotHardpointState): SnapshotHardpointState {
  const activeTeams = Object.entries(hardpoint.presenceByTeam)
    .filter(([, count]) => Number(count) > 0)
    .map(([teamId]) => teamId);

  if (activeTeams.length === 1) {
    return {
      ...hardpoint,
      ownerTeamId: activeTeams[0] ?? null,
      contested: false,
    };
  }

  if (activeTeams.length > 1) {
    return {
      ...hardpoint,
      ownerTeamId: null,
      contested: true,
    };
  }

  return {
    ...hardpoint,
    ownerTeamId: null,
    contested: false,
  };
}

function applyScoreAdd(state: SnapState, teamId: string, delta: number): SnapState {
  if (!teamId || delta <= 0) return state;
  const scoring = (state.modules.scoring as ScoringModuleState | undefined) ?? { counters: {} };
  const nextScoring = addToCounter(scoring, 'signal', teamId, delta);
  return {
    ...state,
    modules: {
      ...state.modules,
      scoring: nextScoring,
    },
  };
}

function applyMutationAction(state: SnapState, action: SnapAction): SnapState {
  const apply = mutationModule.applyAction;
  if (!apply) return state;
  return apply(action, {} as SnapManifest, state);
}

function getBuffTtlSec(buffKey: string): number {
  return BUFF_TTL_SEC[buffKey] ?? BUFF_TTL_SEC.default;
}

function logDropTransition(
  from: DropState,
  to: DropState,
  dropId: string | null,
  zoneIndex: number | null,
  reason: string,
): void {
  if (from === to) return;
  console.log('[SNAP][snapshot-hardpoint][drop]', { from, to, dropId, zoneIndex, reason });
}

function resetDropToInactive(hardpoint: SnapshotHardpointState, manifest: SnapManifest, reason: string): void {
  logDropTransition(hardpoint.drop.state, 'INACTIVE', hardpoint.drop.dropId, hardpoint.drop.zoneIndex, reason);
  hardpoint.drop = {
    state: 'INACTIVE',
    dropId: null,
    zoneIndex: null,
    eligibleTeamId: null,
    endsAtMs: null,
    extractProgressMs: 0,
    rewardKey: 'FORGE_LINK',
  };
  hardpoint.dropScheduleRemainingMs = getDropIntervalMs(manifest);
}

function startIncomingDrop(hardpoint: SnapshotHardpointState, nowMs: number, manifest: SnapManifest): void {
  const nextSeq = Math.max(0, Math.floor(hardpoint.dropSeq)) + 1;
  const dropId = `drop_${nextSeq}`;
  const incomingEndsAtMs = nowMs + getDropIncomingMs(manifest);
  const from = hardpoint.drop.state;
  hardpoint.dropSeq = nextSeq;
  hardpoint.dropScheduleRemainingMs = 0;
  hardpoint.drop = {
    state: 'INCOMING',
    dropId,
    zoneIndex: hardpoint.activeZoneIndex,
    eligibleTeamId: hardpoint.contested ? null : hardpoint.ownerTeamId,
    endsAtMs: incomingEndsAtMs,
    extractProgressMs: 0,
    rewardKey: pickDeterministicReward(dropId),
  };
  logDropTransition(from, 'INCOMING', dropId, hardpoint.activeZoneIndex, 'schedule_elapsed');
}

function completeDropExtraction(
  state: SnapState,
  hardpoint: SnapshotHardpointState,
  action: SnapAction,
  teamId: string,
  manifest: SnapManifest,
): SnapState {
  const dropId = hardpoint.drop.dropId;
  if (!dropId) return state;
  if (hardpoint.grantedDropIds[dropId]) return state;

  const buffKey = hardpoint.drop.rewardKey || 'FORGE_LINK';
  const modifierId = `dropbuff:${buffKey}`;
  const ttlSec = getBuffTtlSec(buffKey);
  const existingModifierId = hardpoint.activeDropBuffByTeam[teamId];
  if (existingModifierId && existingModifierId !== modifierId) {
    state = applyMutationAction(state, {
      matchId: state.matchId,
      actor: action.actor,
      t: action.t,
      kind: 'MODIFIER_END',
      payload: { id: existingModifierId },
      ...(action.sig ? { sig: action.sig } : {}),
    });
  }

  state = applyMutationAction(state, {
    matchId: state.matchId,
    actor: action.actor,
    t: action.t,
    kind: 'MODIFIER_START',
    payload: {
      id: modifierId,
      data: { teamId, dropId, buffKey },
      ttlSec,
    },
    ...(action.sig ? { sig: action.sig } : {}),
  });

  hardpoint = getHardpointState(state);
  hardpoint.grantedDropIds[dropId] = true;
  hardpoint.activeDropBuffByTeam[teamId] = modifierId;
  const from = hardpoint.drop.state;
  hardpoint.drop = {
    ...hardpoint.drop,
    state: 'EXTRACTED',
    endsAtMs: action.t + DROP_TERMINAL_LINGER_MS,
    extractProgressMs: getDropExtractMs(manifest),
    extractingTeamId: teamId,
  };
  logDropTransition(from, 'EXTRACTED', dropId, hardpoint.drop.zoneIndex, 'extract_complete');
  return withHardpointState(state, hardpoint);
}

function isDropTeamEligible(drop: SnapshotHardpointDrop, teamId: string): boolean {
  if (!drop.eligibleTeamId) return true;
  return drop.eligibleTeamId === teamId;
}

function advanceDropByTime(hardpoint: SnapshotHardpointState, upToMs: number, manifest: SnapManifest): void {
  if (hardpoint.drop.state === 'INCOMING') {
    const endsAtMs = hardpoint.drop.endsAtMs;
    if (endsAtMs !== null && upToMs >= endsAtMs) {
      const dropId = hardpoint.drop.dropId;
      const zoneIndex = hardpoint.drop.zoneIndex;
      logDropTransition('INCOMING', 'LANDED', dropId, zoneIndex, 'incoming_complete');
      hardpoint.drop = {
        ...hardpoint.drop,
        state: 'LANDED',
        endsAtMs: endsAtMs + getDropExpireMs(manifest),
      };
    }
  }

  if (hardpoint.drop.state === 'LANDED' || hardpoint.drop.state === 'EXTRACTING') {
    const endsAtMs = hardpoint.drop.endsAtMs;
    if (endsAtMs !== null && upToMs >= endsAtMs) {
      const dropId = hardpoint.drop.dropId;
      const zoneIndex = hardpoint.drop.zoneIndex;
      logDropTransition(hardpoint.drop.state, 'EXPIRED', dropId, zoneIndex, 'expire_timeout');
      hardpoint.drop = {
        ...hardpoint.drop,
        state: 'EXPIRED',
        endsAtMs: endsAtMs + DROP_TERMINAL_LINGER_MS,
        extractProgressMs: 0,
      };
      delete hardpoint.drop.extractingTeamId;
      delete hardpoint.drop.extractingPlayerId;
    }
  }

  if (hardpoint.drop.state === 'EXTRACTED' || hardpoint.drop.state === 'EXPIRED') {
    const cleanupAtMs = hardpoint.drop.endsAtMs;
    if (cleanupAtMs !== null && upToMs >= cleanupAtMs) {
      resetDropToInactive(hardpoint, manifest, 'terminal_cleanup');
    }
  }
}

export const snapshotHardpointRuleset: SnapRuleset = {
  id: 'snapshot-hardpoint',
  createInitialState(manifest: SnapManifest): SnapState {
    const matchIdRuleVar = manifest.ruleVars?.matchId;
    const matchId =
      matchIdRuleVar && (matchIdRuleVar.type === 'string' || matchIdRuleVar.type === 'enum')
        ? String(matchIdRuleVar.value)
        : 'snap-match';
    return {
      matchId,
      phase: 'PREMATCH',
      seq: 0,
      stateHash: '',
      ruleVars: { ...(manifest.ruleVars ?? {}) },
      modules: {},
      custom: {
        snapshotHardpoint: {
          ...getHardpointState({
          matchId,
          phase: 'PREMATCH',
          seq: 0,
          stateHash: '',
          ruleVars: {},
          modules: {},
          custom: {},
          }),
          dropScheduleRemainingMs: getDropIntervalMs(manifest),
        },
      },
    };
  },
  reduce(inputState: SnapState, action: SnapAction, manifest: SnapManifest): SnapState {
    let state = inputState;
    let hardpoint = getHardpointState(state);
    const kind = action.kind;

    if (kind === 'SELECT_LOADOUT') {
      const payload = (action.payload ?? {}) as { slot?: number };
      hardpoint.selectedLoadoutSlot = Number.isFinite(payload.slot) ? Number(payload.slot) : null;
      return withHardpointState(state, hardpoint);
    }

    if (kind === 'PRESENCE_UPDATE' || kind === 'PRESENCE') {
      const payload = (action.payload ?? {}) as { teamId?: string; count?: number };
      const teamId = String(payload.teamId ?? '').trim();
      if (!teamId) return state;
      const count = Math.max(0, Math.floor(Number(payload.count ?? 0)));
      hardpoint.presenceByTeam[teamId] = count;
      hardpoint = refreshOwnership(hardpoint);
      return withHardpointState(state, hardpoint);
    }

    if (kind === 'DROP_EXTRACT_START') {
      const payload = (action.payload ?? {}) as {
        dropId?: string;
        playerId?: string;
        teamId?: string;
        inRange?: boolean;
      };
      const dropId = String(payload.dropId ?? '').trim();
      const playerId = String(payload.playerId ?? '').trim();
      const teamId = String(payload.teamId ?? '').trim();
      const inRange = Boolean(payload.inRange);
      if (!dropId || !playerId || !teamId || !inRange) return state;
      if (hardpoint.drop.dropId !== dropId) return state;
      if (hardpoint.grantedDropIds[dropId]) return state;
      if (!isDropTeamEligible(hardpoint.drop, teamId)) return state;
      if (hardpoint.drop.state === 'LANDED') {
        logDropTransition('LANDED', 'EXTRACTING', dropId, hardpoint.drop.zoneIndex, 'extract_start');
        hardpoint.drop = {
          ...hardpoint.drop,
          state: 'EXTRACTING',
          extractingTeamId: teamId,
          extractingPlayerId: playerId,
          extractProgressMs: 0,
        };
        return withHardpointState(state, hardpoint);
      }
      if (hardpoint.drop.state === 'EXTRACTING'
        && hardpoint.drop.extractingPlayerId === playerId
        && hardpoint.drop.extractingTeamId === teamId) {
        return state;
      }
      return state;
    }

    if (kind === 'DROP_EXTRACT_CANCEL') {
      const payload = (action.payload ?? {}) as {
        dropId?: string;
        playerId?: string;
        teamId?: string;
      };
      const dropId = String(payload.dropId ?? '').trim();
      const playerId = String(payload.playerId ?? '').trim();
      const teamId = String(payload.teamId ?? '').trim();
      if (!dropId || !playerId || !teamId) return state;
      if (hardpoint.drop.state !== 'EXTRACTING') return state;
      if (hardpoint.drop.dropId !== dropId) return state;
      if (hardpoint.drop.extractingPlayerId !== playerId || hardpoint.drop.extractingTeamId !== teamId) return state;
      logDropTransition('EXTRACTING', 'LANDED', dropId, hardpoint.drop.zoneIndex, 'extract_cancel');
      hardpoint.drop = {
        ...hardpoint.drop,
        state: 'LANDED',
        extractProgressMs: 0,
      };
      delete hardpoint.drop.extractingPlayerId;
      delete hardpoint.drop.extractingTeamId;
      return withHardpointState(state, hardpoint);
    }

    if (kind === 'DROP_EXTRACT_TICK') {
      const payload = (action.payload ?? {}) as {
        dropId?: string;
        playerId?: string;
        teamId?: string;
        dtSec?: number;
        inRange?: boolean;
        tookDamage?: boolean;
      };
      const dropId = String(payload.dropId ?? '').trim();
      const playerId = String(payload.playerId ?? '').trim();
      const teamId = String(payload.teamId ?? '').trim();
      const inRange = Boolean(payload.inRange);
      const tookDamage = Boolean(payload.tookDamage);
      const dtMs = Math.max(0, Math.round(Number(payload.dtSec ?? 0) * 1000));
      if (!dropId || !playerId || !teamId || dtMs <= 0) return state;
      if (hardpoint.drop.dropId !== dropId) return state;
      if (hardpoint.grantedDropIds[dropId]) return state;
      if (!isDropTeamEligible(hardpoint.drop, teamId)) return state;

      if (hardpoint.drop.state === 'LANDED') {
        if (!inRange) return state;
        logDropTransition('LANDED', 'EXTRACTING', dropId, hardpoint.drop.zoneIndex, 'extract_tick_start');
        hardpoint.drop = {
          ...hardpoint.drop,
          state: 'EXTRACTING',
          extractingTeamId: teamId,
          extractingPlayerId: playerId,
          extractProgressMs: 0,
        };
      }

      if (hardpoint.drop.state !== 'EXTRACTING') return state;
      if (hardpoint.drop.extractingPlayerId !== playerId || hardpoint.drop.extractingTeamId !== teamId) return state;
      if (!inRange) {
        logDropTransition('EXTRACTING', 'LANDED', dropId, hardpoint.drop.zoneIndex, 'extract_out_of_range');
        hardpoint.drop = {
          ...hardpoint.drop,
          state: 'LANDED',
          extractProgressMs: 0,
        };
        delete hardpoint.drop.extractingPlayerId;
        delete hardpoint.drop.extractingTeamId;
        return withHardpointState(state, hardpoint);
      }
      if (tookDamage) {
        return state;
      }

      const extractTargetMs = getDropExtractMs(manifest);
      hardpoint.drop.extractProgressMs = Math.min(extractTargetMs, hardpoint.drop.extractProgressMs + dtMs);
      if (hardpoint.drop.extractProgressMs < extractTargetMs) {
        return withHardpointState(state, hardpoint);
      }
      state = completeDropExtraction(state, hardpoint, action, teamId, manifest);
      return state;
    }

    if (kind === 'DROP_EXTRACT_COMPLETE') {
      const payload = (action.payload ?? {}) as { dropId?: string; teamId?: string };
      const dropId = String(payload.dropId ?? '').trim();
      const teamId = String(payload.teamId ?? '').trim();
      if (!dropId || !teamId) return state;
      if (hardpoint.drop.dropId !== dropId) return state;
      if (hardpoint.grantedDropIds[dropId]) return state;
      if (!isDropTeamEligible(hardpoint.drop, teamId)) return state;
      state = completeDropExtraction(state, hardpoint, action, teamId, manifest);
      return state;
    }

    if (kind === 'TICK') {
      const payload = (action.payload ?? {}) as { dtSec?: number };
      const dtSec = Math.max(0, Number(payload.dtSec ?? 0));
      if (dtSec <= 0) return state;

      const dtMs = Math.round(dtSec * 1000);
      let nowMs = action.t - dtMs;
      let remainingMs = dtMs;

      while (remainingMs > 0) {
        const untilPhaseEnd = Math.max(0, hardpoint.phaseEndsAtMs - nowMs);
        const segmentMs = Math.max(1, Math.min(remainingMs, untilPhaseEnd > 0 ? untilPhaseEnd : remainingMs));
        const segmentEndMs = nowMs + segmentMs;

        if (hardpoint.zonePhase === 'ACTIVE' && hardpoint.ownerTeamId && !hardpoint.contested) {
          state = applyScoreAdd(state, hardpoint.ownerTeamId, segmentMs / 1000);
        }

        if (hardpoint.drop.state === 'INACTIVE' && hardpoint.zonePhase === 'ACTIVE') {
          hardpoint.dropScheduleRemainingMs = Math.max(0, hardpoint.dropScheduleRemainingMs - segmentMs);
          if (hardpoint.dropScheduleRemainingMs <= 0) {
            startIncomingDrop(hardpoint, segmentEndMs, manifest);
          }
        }
        // COUNTDOWN policy: pause drop scheduling while zone is inactive.

        advanceDropByTime(hardpoint, segmentEndMs, manifest);
        nowMs = segmentEndMs;
        remainingMs -= segmentMs;

        if (segmentEndMs >= hardpoint.phaseEndsAtMs) {
          if (hardpoint.zonePhase === 'COUNTDOWN') {
            hardpoint.zonePhase = 'ACTIVE';
            hardpoint.phaseEndsAtMs = segmentEndMs + ACTIVE_MS;
            state = {
              ...state,
              phase: 'LIVE',
            };
          } else {
            const zoneCount = getZoneCount(manifest);
            hardpoint.zonePhase = 'COUNTDOWN';
            hardpoint.activeZoneIndex = (hardpoint.activeZoneIndex + 1) % zoneCount;
            hardpoint.phaseEndsAtMs = segmentEndMs + COUNTDOWN_MS;
            hardpoint.ownerTeamId = null;
            hardpoint.contested = false;
          }
        }
      }

      return withHardpointState(state, hardpoint);
    }

    return state;
  },
};

import type { SnapAction, SnapManifest, SnapState } from '../../engine/types.js';
import type { SnapModule } from '../types.js';
import {
  applyRake,
  calculateProportional,
  calculateSplitTopK,
  calculateWinnerTakeAll,
  validateCustomPayout,
} from './payout.js';
import type {
  WagerConfig,
  WagerEscalateConfirmPayload,
  WagerEscalateRequestPayload,
  WagerForfeitPayload,
  WagerJoinPayload,
  WagerLeavePayload,
  WagerPayout,
  WagerReadyPayload,
  WagerResult,
  WagerSetResultPayload,
  WagerState,
} from './types.js';

function int(value: unknown, fallback = 0): number {
  const n = Math.floor(Number(value));
  return Number.isInteger(n) ? n : fallback;
}

function str(value: unknown): string {
  return String(value ?? '').trim();
}

function uniqueSorted(values: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const v of values) {
    const key = str(v);
    if (!key || seen[key]) continue;
    seen[key] = true;
    out.push(key);
  }
  return out.sort();
}

function sortParticipants(
  participants: WagerState['participants'],
): WagerState['participants'] {
  return Object.entries(participants)
    .sort(([a], [b]) => a.localeCompare(b))
    .reduce((acc, [actorId, value]) => {
      acc[actorId] = value;
      return acc;
    }, {} as WagerState['participants']);
}

function hasInteger(value: unknown): value is number {
  return Number.isInteger(Math.floor(Number(value)));
}

function getScoringBucket(state: SnapState, counter: string): Record<string, number> {
  return ((state.modules.scoring as { counters?: Record<string, Record<string, number>> } | undefined)?.counters ?? {})[counter] ?? {};
}

function rankFromScores(scores: Array<{ recipient: string; score: number }>): Array<{ recipient: string; placement: number }> {
  return scores
    .slice()
    .sort((a, b) => (b.score - a.score) || a.recipient.localeCompare(b.recipient))
    .map((item, idx) => ({ recipient: item.recipient, placement: idx + 1 }));
}

function toTeamFromActor(wager: WagerState, actorId: string): string {
  return str(wager.participants[actorId]?.teamId);
}

function activeActorIds(wager: WagerState): string[] {
  return Object.keys(wager.participants)
    .filter((actorId) => !wager.participants[actorId]?.forfeited)
    .sort();
}

function activeEntityIds(config: WagerConfig, wager: WagerState): string[] {
  if (config.participationModel === 'teams') {
    return uniqueSorted(
      activeActorIds(wager)
        .map((actorId) => str(wager.participants[actorId]?.teamId))
        .filter((teamId) => teamId.length > 0),
    );
  }
  if (config.participationModel === 'seats') {
    return uniqueSorted(
      activeActorIds(wager)
        .map((actorId) => str(wager.participants[actorId]?.seatId))
        .filter((seatId) => seatId.length > 0),
    );
  }
  return activeActorIds(wager);
}

function computeRefundPayouts(config: WagerConfig, wager: WagerState): WagerPayout[] {
  const actors = Object.keys(wager.participants).sort();
  if (actors.length === 0 || wager.pot.total <= 0) return [];
  const stakePerActor = Math.floor(wager.pot.total / actors.length);
  const penaltyBps = Math.max(0, Math.min(10_000, int(config.antiAbuse?.forfeitPenaltyBps, 0)));
  const nonForfeited = actors.filter((actorId) => !wager.participants[actorId]?.forfeited);
  const penaltyRecipients = nonForfeited.length > 0 ? nonForfeited : actors;

  const payouts: WagerPayout[] = actors.map((actorId) => {
    const forfeited = Boolean(wager.participants[actorId]?.forfeited);
    const penalty = forfeited ? Math.floor((stakePerActor * penaltyBps) / 10_000) : 0;
    return { recipient: actorId, amount: stakePerActor - penalty };
  });

  let distributed = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  let penaltyPool = wager.pot.total - distributed;

  let i = 0;
  while (penaltyPool > 0 && penaltyRecipients.length > 0) {
    const recipient = penaltyRecipients[i % penaltyRecipients.length]!;
    const index = payouts.findIndex((p) => p.recipient === recipient);
    if (index >= 0) {
      payouts[index]!.amount += 1;
      penaltyPool -= 1;
    }
    i += 1;
  }
  distributed = payouts.reduce((sum, payout) => sum + payout.amount, 0);
  if (distributed !== wager.pot.total) {
    throw new Error('refund payouts must sum to pot total');
  }
  return payouts.sort((a, b) => a.recipient.localeCompare(b.recipient));
}

function readConfig(manifest: SnapManifest): WagerConfig {
  const cfg = (manifest.moduleConfig?.wager ?? {}) as Record<string, unknown>;
  const model = ['solo', 'ffa', 'teams', 'seats'].includes(str(cfg.participationModel)) ? str(cfg.participationModel) : 'solo';
  const lockPolicy = ['immediate', 'manual_ready', 'time_lock'].includes(str(cfg.lockPolicy)) ? str(cfg.lockPolicy) : 'immediate';
  const settlementModel = ['winner_take_all', 'split_top_k', 'proportional', 'custom'].includes(str(cfg.settlementModel)) ? str(cfg.settlementModel) : 'winner_take_all';
  const winnerDetermination = ['ruleset', 'score_counter', 'placement', 'threshold_activity'].includes(str(cfg.winnerDetermination)) ? str(cfg.winnerDetermination) : 'ruleset';
  return {
    currency: {
      kind: cfg.currency && typeof cfg.currency === 'object' && (cfg.currency as { kind?: unknown }).kind === 'SPL' ? 'SPL' : 'SOL',
      ...(cfg.currency && typeof cfg.currency === 'object' && str((cfg.currency as { mint?: unknown }).mint) ? { mint: str((cfg.currency as { mint?: unknown }).mint) } : {}),
    },
    entryAmount: Math.max(0, int(cfg.entryAmount)),
    maxParticipants: Math.max(1, int(cfg.maxParticipants, 1)),
    participationModel: model as WagerConfig['participationModel'],
    ...(model === 'teams'
      ? {
        teams: {
          teamIds: Array.isArray((cfg.teams as { teamIds?: unknown } | undefined)?.teamIds)
            ? uniqueSorted(((cfg.teams as { teamIds?: unknown }).teamIds as unknown[]).map((v) => str(v)).filter((v) => v.length > 0))
            : [],
          ...(int((cfg.teams as { teamSize?: unknown } | undefined)?.teamSize, 0) > 0 ? { teamSize: int((cfg.teams as { teamSize?: unknown } | undefined)?.teamSize, 0) } : {}),
        },
      }
      : {}),
    ...(model === 'seats'
      ? {
        seats: {
          seatIds: Array.isArray((cfg.seats as { seatIds?: unknown } | undefined)?.seatIds)
            ? uniqueSorted(((cfg.seats as { seatIds?: unknown }).seatIds as unknown[]).map((v) => str(v)).filter((v) => v.length > 0))
            : [],
        },
      }
      : {}),
    lockPolicy: lockPolicy as WagerConfig['lockPolicy'],
    ...(hasInteger(cfg.lockAtMs) ? { lockAtMs: int(cfg.lockAtMs) } : {}),
    escrowModel: ['offchain_stub', 'solana_escrow', 'magicblock_delegated'].includes(str(cfg.escrowModel))
      ? (str(cfg.escrowModel) as WagerConfig['escrowModel'])
      : 'offchain_stub',
    settlementModel: settlementModel as WagerConfig['settlementModel'],
    winnerDetermination: winnerDetermination as WagerConfig['winnerDetermination'],
    ...(cfg.activityWin && typeof cfg.activityWin === 'object'
      ? {
        activityWin: {
          type: (str((cfg.activityWin as { type?: unknown }).type) || 'score_at_least') as NonNullable<WagerConfig['activityWin']>['type'],
          threshold: int((cfg.activityWin as { threshold?: unknown }).threshold, 0),
          ...(str((cfg.activityWin as { counter?: unknown }).counter) ? { counter: str((cfg.activityWin as { counter?: unknown }).counter) } : {}),
          ...(hasInteger((cfg.activityWin as { timeLimitSec?: unknown }).timeLimitSec)
            ? { timeLimitSec: int((cfg.activityWin as { timeLimitSec?: unknown }).timeLimitSec) }
            : {}),
        },
      }
      : {}),
    ...(cfg.escalation && typeof cfg.escalation === 'object'
      ? {
        escalation: {
          enabled: Boolean((cfg.escalation as { enabled?: unknown }).enabled),
          windows: Array.isArray((cfg.escalation as { windows?: unknown }).windows)
            ? ((cfg.escalation as { windows?: unknown }).windows as Array<{ atSec?: unknown; multiplier?: unknown }>)
              .map((w) => ({ atSec: int(w.atSec, -1), multiplier: Math.max(1, int(w.multiplier, 1)) }))
              .filter((w) => w.atSec >= 0)
              .sort((a, b) => a.atSec - b.atSec)
            : [],
          ...(cfg.escalation && (cfg.escalation as { requireAll?: unknown }).requireAll !== undefined
            ? { requireAll: Boolean((cfg.escalation as { requireAll?: unknown }).requireAll) }
            : {}),
        },
      }
      : {}),
    ...(cfg.antiAbuse && typeof cfg.antiAbuse === 'object'
      ? {
        antiAbuse: {
          ...(hasInteger((cfg.antiAbuse as { minDurationSec?: unknown }).minDurationSec)
            ? { minDurationSec: Math.max(0, int((cfg.antiAbuse as { minDurationSec?: unknown }).minDurationSec)) }
            : {}),
          ...((cfg.antiAbuse as { allowRejoin?: unknown }).allowRejoin !== undefined
            ? { allowRejoin: Boolean((cfg.antiAbuse as { allowRejoin?: unknown }).allowRejoin) }
            : {}),
          ...(hasInteger((cfg.antiAbuse as { forfeitPenaltyBps?: unknown }).forfeitPenaltyBps)
            ? { forfeitPenaltyBps: Math.max(0, Math.min(10_000, int((cfg.antiAbuse as { forfeitPenaltyBps?: unknown }).forfeitPenaltyBps))) }
            : {}),
        },
      }
      : {}),
    ...(cfg.splitTopK && typeof cfg.splitTopK === 'object'
      ? {
        splitTopK: {
          topK: Math.max(1, int((cfg.splitTopK as { topK?: unknown }).topK, 3)),
          ...(Array.isArray((cfg.splitTopK as { weightCurve?: unknown }).weightCurve)
            ? { weightCurve: ((cfg.splitTopK as { weightCurve?: unknown }).weightCurve as unknown[]).map((v) => Math.max(0, int(v))) }
            : {}),
        },
      }
      : {}),
    ...(cfg.scoreCounter && typeof cfg.scoreCounter === 'object' && str((cfg.scoreCounter as { counter?: unknown }).counter)
      ? { scoreCounter: { counter: str((cfg.scoreCounter as { counter?: unknown }).counter) } }
      : {}),
    ...(hasInteger(cfg.rakeBps) ? { rakeBps: Math.max(0, Math.min(10_000, int(cfg.rakeBps))) } : {}),
    ...(str(cfg.rakeRecipient) ? { rakeRecipient: str(cfg.rakeRecipient) } : {}),
  };
}

function ensureState(state: SnapState, config: WagerConfig): WagerState {
  const wager = state.modules.wager as WagerState | undefined;
  if (!wager || typeof wager !== 'object') {
    return {
      phase: 'OPEN',
      participants: {},
      pot: { total: 0, currency: { ...config.currency } },
      ...(config.escrowModel !== 'offchain_stub' ? { escrowRef: `todo:${config.escrowModel}` } : {}),
      escalationLevel: 0,
      escalationMultiplier: 1,
      settlement: {},
      audit: { lastActionSeq: state.seq, lastUpdatedAtMs: 0 },
      leftActors: [],
      escalationConfirmations: [],
    };
  }
  return { ...wager, pot: { ...wager.pot, currency: { ...config.currency } } };
}

function deriveResult(config: WagerConfig, wager: WagerState, state: SnapState, actionT: number): WagerResult {
  if (config.winnerDetermination === 'ruleset' || config.winnerDetermination === 'placement') {
    return wager.result ?? {};
  }
  if (config.winnerDetermination === 'score_counter') {
    const counter = str(config.scoreCounter?.counter ?? config.activityWin?.counter);
    if (!counter) {
      throw new Error('score_counter winnerDetermination requires scoreCounter.counter');
    }
    const entities = activeEntityIds(config, wager);
    const bucket = getScoringBucket(state, counter);
    const scores = entities.map((recipient) => ({ recipient, score: int(bucket[recipient], 0) }));
    if (config.settlementModel === 'split_top_k') {
      return {
        placements: rankFromScores(scores),
      };
    }
    const maxScore = scores.reduce((m, s) => Math.max(m, s.score), 0);
    return {
      winnerIds: scores.filter((s) => s.score === maxScore).map((s) => s.recipient).sort(),
    };
  }

  const soloActor = activeActorIds(wager)[0];
  if (!soloActor) return {};
  const win = config.activityWin;
  if (!win) {
    throw new Error('threshold_activity winnerDetermination requires activityWin config');
  }
  if (win.type === 'time_under') {
    const startAt = wager.liveAtMs ?? wager.lockedAtMs ?? wager.audit.lastUpdatedAtMs;
    const elapsedSec = Math.max(0, Math.floor((actionT - startAt) / 1000));
    const capSec = hasInteger(win.timeLimitSec) ? int(win.timeLimitSec) : int(win.threshold);
    const success = elapsedSec <= capSec;
    return { winnerIds: success ? [soloActor] : [] };
  }

  const counter = str(win.counter ?? config.scoreCounter?.counter);
  if (!counter) {
    throw new Error('threshold_activity requires a counter for score/kills/level checks');
  }
  const bucket = getScoringBucket(state, counter);
  const value = int(bucket[soloActor], 0);
  const success = value >= int(win.threshold, 0);
  return { winnerIds: success ? [soloActor] : [] };
}

function settle(config: WagerConfig, wager: WagerState, state: SnapState, actionT: number): WagerPayout[] {
  const result = deriveResult(config, wager, state, actionT);
  const { distributable, rakePayout } = applyRake(wager.pot.total, int(config.rakeBps, 0), config.rakeRecipient);
  let payouts: WagerPayout[] = [];

  if (config.winnerDetermination === 'placement') {
    payouts = calculateSplitTopK(
      distributable,
      result.placements ?? [],
      int(config.splitTopK?.topK, 3),
      config.splitTopK?.weightCurve,
    );
  } else if (config.settlementModel === 'winner_take_all') {
    payouts = calculateWinnerTakeAll(distributable, (result.winnerIds ?? []).slice().sort());
  } else if (config.settlementModel === 'split_top_k') {
    payouts = calculateSplitTopK(distributable, result.placements ?? [], int(config.splitTopK?.topK, 3), config.splitTopK?.weightCurve);
  } else if (config.settlementModel === 'proportional') {
    const counter = str(config.scoreCounter?.counter ?? config.activityWin?.counter);
    const bucket = getScoringBucket(state, counter);
    const scores = activeEntityIds(config, wager).map((recipient) => ({ recipient, score: int(bucket[recipient], 0) }));
    payouts = calculateProportional(distributable, scores);
  } else {
    payouts = validateCustomPayout(distributable, result.payouts ?? []);
  }

  if (rakePayout) payouts = payouts.concat(rakePayout);
  payouts = payouts.sort((a, b) => a.recipient.localeCompare(b.recipient));
  if (payouts.reduce((sum, p) => sum + p.amount, 0) !== wager.pot.total) {
    throw new Error('settlement payouts must sum to pot total');
  }
  return payouts;
}

function maybeFinalize(action: SnapAction, config: WagerConfig, wager: WagerState, state: SnapState): WagerState {
  const should = action.kind === 'MATCH_END' || action.kind === 'SNAP_END' || wager.phase === 'SETTLING';
  if (!should || wager.phase === 'SETTLED' || wager.phase === 'CANCELLED') return wager;
  const minDuration = int(config.antiAbuse?.minDurationSec, 0);
  const startAt = wager.liveAtMs ?? wager.lockedAtMs ?? wager.audit.lastUpdatedAtMs;
  const elapsedSec = Math.max(0, Math.floor((action.t - startAt) / 1000));
  if (Object.keys(wager.participants).length === 0 || (minDuration > 0 && elapsedSec < minDuration)) {
    return {
      ...wager,
      phase: 'CANCELLED',
      settlement: {
        payouts: computeRefundPayouts(config, wager),
        reason: Object.keys(wager.participants).length === 0 ? 'no_participants' : 'min_duration_not_met',
      },
    };
  }
  try {
    const payouts = settle(config, wager, state, action.t);
    if (payouts.length === 0) {
      return {
        ...wager,
        phase: 'CANCELLED',
        settlement: {
          payouts: computeRefundPayouts(config, wager),
          reason: 'no_winner_refund',
        },
      };
    }
    return {
      ...wager,
      phase: 'SETTLED',
      settlement: { payouts, reason: 'settled' },
    };
  } catch {
    return {
      ...wager,
      phase: 'CANCELLED',
      settlement: {
        payouts: computeRefundPayouts(config, wager),
        reason: 'invalid_result_refund',
      },
    };
  }
}

export function createWagerModule(): SnapModule {
  return {
    id: 'wager',
    init(manifest, state) {
      const wager = ensureState(state, readConfig(manifest));
      return { ...state, modules: { ...state.modules, wager } };
    },
    validateAction(action, manifest, state) {
      const config = readConfig(manifest);
      const wager = ensureState(state, config);
      if (action.kind === 'WAGER_JOIN') {
        const p = (action.payload ?? {}) as WagerJoinPayload;
        if (!str(p.actorId) || str(p.actorId) !== action.actor) throw new Error('WAGER_JOIN actorId mismatch');
        if (wager.phase !== 'OPEN') throw new Error('WAGER_JOIN only in OPEN');
        if (wager.participants[p.actorId]) throw new Error('WAGER_JOIN duplicate actor');
        if ((wager.leftActors ?? []).includes(p.actorId) && config.antiAbuse?.allowRejoin === false) throw new Error('WAGER_JOIN rejoin disabled');
        if (Object.keys(wager.participants).length >= config.maxParticipants) throw new Error('WAGER_JOIN maxParticipants reached');
        if (config.participationModel === 'teams') {
          const teamId = str(p.teamId);
          if (!teamId) throw new Error('WAGER_JOIN requires teamId for teams mode');
          if (!(config.teams?.teamIds ?? []).includes(teamId)) throw new Error('WAGER_JOIN teamId not allowed');
          if (int(config.teams?.teamSize, 0) > 0) {
            const teamCount = Object.values(wager.participants).filter((entry) => str(entry.teamId) === teamId).length;
            if (teamCount >= int(config.teams?.teamSize, 0)) throw new Error('WAGER_JOIN team full');
          }
        }
        if (config.participationModel === 'seats') {
          const seatId = str(p.seatId);
          if (!seatId) throw new Error('WAGER_JOIN requires seatId for seats mode');
          if (!(config.seats?.seatIds ?? []).includes(seatId)) throw new Error('WAGER_JOIN seatId not allowed');
          if (Object.values(wager.participants).some((entry) => str(entry.seatId) === seatId)) throw new Error('WAGER_JOIN seat already occupied');
        }
      }
      if (action.kind === 'WAGER_LEAVE') {
        const p = (action.payload ?? {}) as WagerLeavePayload;
        if (str(p.actorId) !== action.actor) throw new Error('WAGER_LEAVE actorId mismatch');
        if (wager.phase !== 'OPEN') throw new Error('WAGER_LEAVE only in OPEN');
        if (!wager.participants[p.actorId]) throw new Error('WAGER_LEAVE actor not joined');
      }
      if (action.kind === 'WAGER_READY') {
        const p = (action.payload ?? {}) as WagerReadyPayload;
        if (config.lockPolicy !== 'manual_ready') throw new Error('WAGER_READY requires manual_ready lock policy');
        if (wager.phase !== 'OPEN' || str(p.actorId) !== action.actor || !wager.participants[p.actorId] || p.ready !== true) throw new Error('WAGER_READY invalid');
      }
      if (action.kind === 'WAGER_LOCK') {
        if (config.lockPolicy !== 'manual_ready') throw new Error('WAGER_LOCK requires manual_ready');
        if (wager.phase !== 'OPEN') throw new Error('WAGER_LOCK only in OPEN');
        if (!Object.values(wager.participants).every((x) => x.ready)) throw new Error('WAGER_LOCK requires all ready');
      }
      if (action.kind === 'WAGER_FORFEIT') {
        const p = (action.payload ?? {}) as WagerForfeitPayload;
        if (str(p.actorId) !== action.actor || !wager.participants[p.actorId]) throw new Error('WAGER_FORFEIT invalid actor');
        if (!(wager.phase === 'LOCKED' || wager.phase === 'LIVE')) throw new Error('WAGER_FORFEIT only in LOCKED/LIVE');
        if (wager.participants[p.actorId]?.forfeited) throw new Error('WAGER_FORFEIT already forfeited');
      }
      if (action.kind === 'WAGER_ESCALATE_REQUEST') {
        const p = (action.payload ?? {}) as WagerEscalateRequestPayload;
        if (!config.escalation?.enabled) throw new Error('WAGER_ESCALATE_REQUEST disabled');
        if (!(wager.phase === 'LOCKED' || wager.phase === 'LIVE')) throw new Error('WAGER_ESCALATE_REQUEST only in LOCKED/LIVE');
        const windowIndex = int(p.windowIndex, -1);
        if (windowIndex < 0 || windowIndex >= config.escalation.windows.length) throw new Error('WAGER_ESCALATE_REQUEST invalid windowIndex');
        if (windowIndex < wager.escalationLevel) throw new Error('WAGER_ESCALATE_REQUEST window already applied');
        const actorId = str(p.actorId || action.actor);
        if (!wager.participants[actorId]) throw new Error('WAGER_ESCALATE_REQUEST actor not joined');
        if (config.participationModel === 'teams') {
          const teamId = str(p.teamId || toTeamFromActor(wager, actorId));
          if (!teamId) throw new Error('WAGER_ESCALATE_REQUEST teamId required in teams mode');
          if (!activeEntityIds(config, wager).includes(teamId)) throw new Error('WAGER_ESCALATE_REQUEST team inactive');
        }
        const startAt = wager.liveAtMs ?? wager.lockedAtMs ?? wager.audit.lastUpdatedAtMs;
        const elapsedSec = Math.max(0, Math.floor((action.t - startAt) / 1000));
        if (elapsedSec < int(config.escalation.windows[windowIndex]?.atSec, 0)) {
          throw new Error('WAGER_ESCALATE_REQUEST window not open');
        }
      }
      if (action.kind === 'WAGER_ESCALATE_CONFIRM') {
        if (!config.escalation?.enabled || wager.pendingEscalationWindowIndex === undefined) throw new Error('WAGER_ESCALATE_CONFIRM requires pending request');
        const p = (action.payload ?? {}) as WagerEscalateConfirmPayload;
        const actorId = str(p.actorId || action.actor);
        if (!wager.participants[actorId]) throw new Error('WAGER_ESCALATE_CONFIRM actor not joined');
      }
      if (action.kind === 'WAGER_SET_RESULT' && !['ruleset', 'placement'].includes(config.winnerDetermination)) {
        throw new Error('WAGER_SET_RESULT only for ruleset/placement winner determination');
      }
    },
    applyAction(action, manifest, state) {
      const config = readConfig(manifest);
      let wager = ensureState(state, config);

      if (action.kind === 'WAGER_JOIN') {
        const p = (action.payload ?? {}) as WagerJoinPayload;
        wager.participants[p.actorId] = {
          joinedAtMs: action.t,
          paid: true,
          ready: false,
          ...(str(p.teamId) ? { teamId: str(p.teamId) } : {}),
          ...(str(p.seatId) ? { seatId: str(p.seatId) } : {}),
        };
        wager.pot.total = config.entryAmount * Object.keys(wager.participants).length * Math.max(1, int(wager.escalationMultiplier, 1));
        if (config.lockPolicy === 'immediate' && Object.keys(wager.participants).length >= config.maxParticipants) {
          wager.phase = 'LOCKED';
          wager.lockedAtMs = action.t;
        }
      } else if (action.kind === 'WAGER_LEAVE') {
        const p = (action.payload ?? {}) as WagerLeavePayload;
        delete wager.participants[p.actorId];
        wager.leftActors = uniqueSorted([...(wager.leftActors ?? []), p.actorId]);
        wager.pot.total = config.entryAmount * Object.keys(wager.participants).length * Math.max(1, int(wager.escalationMultiplier, 1));
      } else if (action.kind === 'WAGER_READY') {
        const p = (action.payload ?? {}) as WagerReadyPayload;
        wager.participants[p.actorId] = { ...wager.participants[p.actorId]!, ready: true };
      } else if (action.kind === 'WAGER_LOCK') {
        wager.phase = 'LOCKED';
        wager.lockedAtMs = action.t;
      } else if (action.kind === 'WAGER_FORFEIT') {
        const p = (action.payload ?? {}) as WagerForfeitPayload;
        wager.participants[p.actorId] = { ...wager.participants[p.actorId]!, forfeited: true };
        if (Object.values(wager.participants).filter((x) => !x.forfeited).length <= 1) wager.phase = 'SETTLING';
      } else if (action.kind === 'WAGER_ESCALATE_REQUEST') {
        const p = (action.payload ?? {}) as WagerEscalateRequestPayload;
        wager.pendingEscalationWindowIndex = int(p.windowIndex);
        const requestActor = str(p.actorId || action.actor);
        const requestKey = config.participationModel === 'teams'
          ? str(p.teamId || wager.participants[requestActor]?.teamId)
          : requestActor;
        wager.escalationConfirmations = [requestKey];
      } else if (action.kind === 'WAGER_ESCALATE_CONFIRM') {
        const p = (action.payload ?? {}) as WagerEscalateConfirmPayload;
        const confirmActor = str(p.actorId || action.actor);
        const key = config.participationModel === 'teams'
          ? str(p.teamId || wager.participants[confirmActor]?.teamId)
          : confirmActor;
        wager.escalationConfirmations = uniqueSorted([...(wager.escalationConfirmations ?? []), key]);
        const required = config.participationModel === 'teams'
          ? uniqueSorted(Object.values(wager.participants).filter((x) => !x.forfeited).map((x) => str(x.teamId)).filter((x) => x.length > 0))
          : Object.keys(wager.participants).filter((actorId) => !wager.participants[actorId]!.forfeited).sort();
        const requireAll = config.escalation?.requireAll !== false;
        const complete = requireAll ? required.every((x) => wager.escalationConfirmations!.includes(x)) : wager.escalationConfirmations.length > 0;
        if (complete && wager.pendingEscalationWindowIndex !== undefined && config.escalation?.windows[wager.pendingEscalationWindowIndex]) {
          const w = config.escalation.windows[wager.pendingEscalationWindowIndex]!;
          wager.escalationLevel = Math.max(int(wager.escalationLevel, 0), wager.pendingEscalationWindowIndex + 1);
          wager.escalationMultiplier = Math.max(1, int(w.multiplier, 1));
          wager.pendingEscalationWindowIndex = undefined;
          wager.escalationConfirmations = [];
          wager.pot.total = config.entryAmount * Object.keys(wager.participants).length * wager.escalationMultiplier;
        }
      } else if (action.kind === 'WAGER_SET_RESULT') {
        wager.result = ((action.payload ?? {}) as WagerSetResultPayload).result;
      }

      if (wager.phase === 'OPEN' && config.lockPolicy === 'time_lock' && Number.isInteger(config.lockAtMs) && action.t >= (config.lockAtMs ?? 0)) {
        wager.phase = 'LOCKED';
        wager.lockedAtMs = action.t;
      }
      if (wager.phase === 'LOCKED' && action.kind === 'MATCH_START') {
        wager.phase = 'LIVE';
        wager.liveAtMs = action.t;
      }

      wager = maybeFinalize(action, config, wager, state);
      wager.participants = sortParticipants(wager.participants);
      wager.audit = { lastActionSeq: state.seq + 1, lastUpdatedAtMs: action.t };
      return { ...state, modules: { ...state.modules, wager } };
    },
    tick(_dtSec, manifest, state) {
      const config = readConfig(manifest);
      const wager = ensureState(state, config);
      return { ...state, modules: { ...state.modules, wager } };
    },
    finalize(manifest, state) {
      const wager = ensureState(state, readConfig(manifest));
      return {
        wager: {
          phase: wager.phase,
          participants: wager.participants,
          pot: wager.pot,
          settlement: wager.settlement,
          escalationLevel: wager.escalationLevel,
          escalationMultiplier: wager.escalationMultiplier,
          audit: wager.audit,
        },
      };
    },
  };
}

export * from './types.js';
export * from './payout.js';

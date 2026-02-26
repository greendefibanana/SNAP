export type MatchAuthorityPhase = 'PREMATCH_LOADOUT' | 'LIVE' | 'POSTMATCH';
import type {
    SnapAction,
    SnapEventLogEntry,
    SnapManifest,
    SnapRuleVars,
    SnapState,
} from '../engine/types.js';

export type MatchAuthorityEventType =
    | 'MATCH_STARTED'
    | 'PHASE_SET'
    | 'SCORE_SET'
    | 'SCORE_ADDED'
    | 'MATCH_ENDED'
    | 'EXTERNAL_EVENT';

export interface MatchAuthorityEvent<TData = unknown> {
    seq: number;
    timestamp: number;
    type: MatchAuthorityEventType;
    data: TData;
}

export interface MatchAuthorityState {
    phase: MatchAuthorityPhase;
    startedAtMs: number | null;
    endedAtMs: number | null;
    winner: string | null;
    scores: Record<string, number>;
    version: number;
    lastEventSeq: number;
    lastEventAtMs: number | null;
    eventLogHash: string;
    stateHash: string;
}

export type AuthorityEventInput = Omit<MatchAuthorityEvent, 'seq' | 'timestamp'> & Partial<Pick<MatchAuthorityEvent, 'seq' | 'timestamp'>>;

// Temporary migration surface: legacy core can consume/produce universal SNAP types.
export type {
    SnapManifest,
    SnapAction,
    SnapState,
    SnapRuleVars,
    SnapEventLogEntry,
};

function toLegacyPhase(phase: SnapState['phase']): MatchAuthorityPhase {
    if (phase === 'PREMATCH') return 'PREMATCH_LOADOUT';
    if (phase === 'LIVE') return 'LIVE';
    return 'POSTMATCH';
}

function toSnapPhase(phase: MatchAuthorityPhase): SnapState['phase'] {
    if (phase === 'PREMATCH_LOADOUT') return 'PREMATCH';
    if (phase === 'LIVE') return 'LIVE';
    return 'POSTMATCH';
}

export function adaptSnapStateToMatchAuthorityState(state: SnapState): MatchAuthorityState {
    const legacyScores = ((state.custom.snapshotHardpoint as { signalTotals?: Record<string, number> } | undefined)?.signalTotals) ?? {};
    return {
        phase: toLegacyPhase(state.phase),
        startedAtMs: null,
        endedAtMs: state.phase === 'POSTMATCH' ? Date.now() : null,
        winner: null,
        scores: { ...legacyScores },
        version: state.seq,
        lastEventSeq: state.seq,
        lastEventAtMs: null,
        eventLogHash: 'legacy-adapter',
        stateHash: state.stateHash,
    };
}

export function adaptMatchAuthorityStateToSnapState(
    state: MatchAuthorityState,
    manifest: Pick<SnapManifest, 'ruleVars'> & { matchId?: string } = {},
): SnapState {
    return {
        matchId: manifest.matchId ?? 'legacy-match',
        phase: toSnapPhase(state.phase),
        seq: state.lastEventSeq,
        stateHash: state.stateHash,
        ruleVars: { ...(manifest.ruleVars ?? {}) },
        modules: {},
        custom: {
            snapshotHardpoint: {
                signalTotals: { ...state.scores },
            },
        },
    };
}

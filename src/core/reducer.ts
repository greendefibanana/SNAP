import { computeStateHash } from './stateHash';
import type { MatchAuthorityEvent, MatchAuthorityState } from './types';

function withHashes(next: Omit<MatchAuthorityState, 'stateHash'>): MatchAuthorityState {
    const stateHash = computeStateHash(next);
    return {
        ...next,
        stateHash,
    };
}

export function createInitialMatchAuthorityState(): MatchAuthorityState {
    return withHashes({
        phase: 'PREMATCH_LOADOUT',
        startedAtMs: null,
        endedAtMs: null,
        winner: null,
        scores: {},
        version: 0,
        lastEventSeq: 0,
        lastEventAtMs: null,
        eventLogHash: 'genesis',
    });
}

export function reduceMatchAuthorityState(
    current: MatchAuthorityState,
    event: MatchAuthorityEvent,
): MatchAuthorityState {
    const next: Omit<MatchAuthorityState, 'stateHash'> = {
        ...current,
        version: current.version + 1,
        lastEventSeq: event.seq,
        lastEventAtMs: event.timestamp,
    };

    switch (event.type) {
        case 'MATCH_STARTED':
            next.phase = 'PREMATCH_LOADOUT';
            next.startedAtMs = event.timestamp;
            next.endedAtMs = null;
            next.winner = null;
            return withHashes(next);
        case 'PHASE_SET': {
            const payload = event.data as { phase?: MatchAuthorityState['phase'] };
            if (payload.phase) {
                next.phase = payload.phase;
            }
            return withHashes(next);
        }
        case 'SCORE_SET': {
            const payload = event.data as { key?: string; value?: number };
            const key = payload.key ?? '';
            if (key) {
                next.scores = {
                    ...next.scores,
                    [key]: Number(payload.value ?? 0),
                };
            }
            return withHashes(next);
        }
        case 'SCORE_ADDED': {
            const payload = event.data as { key?: string; delta?: number };
            const key = payload.key ?? '';
            if (key) {
                next.scores = {
                    ...next.scores,
                    [key]: Number(next.scores[key] ?? 0) + Number(payload.delta ?? 0),
                };
            }
            return withHashes(next);
        }
        case 'MATCH_ENDED': {
            const payload = event.data as { winner?: string | null };
            next.phase = 'POSTMATCH';
            next.winner = payload.winner ?? null;
            next.endedAtMs = event.timestamp;
            return withHashes(next);
        }
        case 'EXTERNAL_EVENT':
        default:
            return withHashes(next);
    }
}


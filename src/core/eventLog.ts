import { computeChainedHash } from './stateHash';
import type { MatchAuthorityEvent } from './types';

export interface DeterministicEventLog {
    events: MatchAuthorityEvent[];
    hash: string;
}

export function createDeterministicEventLog(): DeterministicEventLog {
    return {
        events: [],
        hash: 'genesis',
    };
}

export function appendDeterministicEvent(
    log: DeterministicEventLog,
    event: MatchAuthorityEvent,
    maxEvents: number = 4096,
): DeterministicEventLog {
    const nextEvents = log.events.concat(event);
    const trimmedEvents = nextEvents.length > maxEvents
        ? nextEvents.slice(nextEvents.length - maxEvents)
        : nextEvents;
    return {
        events: trimmedEvents,
        hash: computeChainedHash(log.hash, event),
    };
}


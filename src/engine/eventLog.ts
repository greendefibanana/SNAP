import { computeChainedHash } from '../core/stateHash.js';
import type { SnapEventLogEntry } from './types.js';

export interface SnapDeterministicEventLog {
  events: SnapEventLogEntry[];
  hash: string;
}

export function createSnapDeterministicEventLog(): SnapDeterministicEventLog {
  return {
    events: [],
    hash: 'genesis',
  };
}

export function appendSnapEvent(
  log: SnapDeterministicEventLog,
  event: Omit<SnapEventLogEntry, 'hash'>,
  maxEvents = 8192,
): SnapDeterministicEventLog {
  const hash = computeChainedHash(log.hash, {
    seq: event.seq,
    kind: event.kind,
    timestamp: event.timestamp,
  });
  const next: SnapEventLogEntry = { ...event, hash };
  const appended = log.events.concat(next);
  const events = appended.length > maxEvents
    ? appended.slice(appended.length - maxEvents)
    : appended;
  return {
    events,
    hash,
  };
}

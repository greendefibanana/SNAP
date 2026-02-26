import { createDeterministicEventLog, appendDeterministicEvent } from '../core/eventLog';
import { adaptSnapStateToMatchAuthorityState } from '../core/types';
import type { MatchAuthorityEvent, MatchAuthorityState, SnapAction, SnapManifest, SnapState } from '../core/types';
import { createLocalSnapClient } from './localSnapClient.js';
import type { SnapClient } from './snapClient.js';

export interface SignalAuthorityEventLike {
  seq: number;
  timestamp: number;
  type: string;
  data: unknown;
}

export interface SignalLocalAdapterOptions {
  maxEvents?: number;
  manifest?: SnapManifest;
}

function defaultManifest(): SnapManifest {
  return {
    version: '1',
    gameId: 'snapshot',
    rulesetId: 'snapshot-hardpoint',
    ruleVars: {
      matchId: { type: 'string', value: 'signal-local-adapter' },
      zoneCount: { type: 'number', value: 3 },
    },
  };
}

function normalizeLegacyState(state: SnapState): MatchAuthorityState {
  const next = adaptSnapStateToMatchAuthorityState(state);
  const scoring = (state.modules.scoring ?? {}) as { counters?: Record<string, Record<string, number>> };
  const signal = scoring.counters?.signal ?? {};
  return {
    ...next,
    scores: { ...signal },
  };
}

function toSnapActions<TEvent extends SignalAuthorityEventLike>(event: TEvent, matchId: string): SnapAction[] {
  if (event.type === 'SIGNAL_GENERATED') {
    const payload = event.data as { team?: string; amount?: number };
    const teamId = String(payload.team ?? '').trim();
    if (!teamId) return [];
    return [
      {
        matchId,
        actor: 'signal-local-adapter',
        t: Number.isFinite(event.timestamp) ? Number(event.timestamp) : 0,
        kind: 'SCORE_ADD',
        payload: {
          counter: 'signal',
          entityId: teamId,
          delta: Number(payload.amount ?? 0),
        },
      },
    ];
  }

  if (event.type === 'DROP_EXTRACTED') {
    const payload = event.data as { dropId?: string; teamId?: string; buffKey?: string };
    const dropId = String(payload.dropId ?? '').trim();
    const teamId = String(payload.teamId ?? '').trim();
    if (!dropId || !teamId) return [];
    return [
      {
        matchId,
        actor: 'signal-local-adapter',
        t: Number.isFinite(event.timestamp) ? Number(event.timestamp) : 0,
        kind: 'DROP_EXTRACT_COMPLETE',
        payload: {
          dropId,
          teamId,
          ...(payload.buffKey ? { buffKey: payload.buffKey } : {}),
        },
      },
    ];
  }

  return [];
}

/**
 * @deprecated Use `createLocalSnapClient(manifest)` directly.
 * This adapter is retained for compatibility and now delegates to SnapClient internally.
 */
export class SignalProtocolLocalAdapter<TEvent extends SignalAuthorityEventLike = SignalAuthorityEventLike> {
  private readonly maxEvents: number;
  private readonly client: SnapClient;
  private authorityState: MatchAuthorityState;
  private eventLog = createDeterministicEventLog();
  private nextSeq = 1;
  private readonly matchId: string;

  constructor(options: SignalLocalAdapterOptions = {}) {
    this.maxEvents = options.maxEvents ?? 4096;
    const manifest = options.manifest ?? defaultManifest();
    const matchIdRuleVar = manifest.ruleVars?.matchId;
    this.matchId =
      matchIdRuleVar && (matchIdRuleVar.type === 'string' || matchIdRuleVar.type === 'enum')
        ? String(matchIdRuleVar.value)
        : 'signal-local-adapter';
    this.client = createLocalSnapClient(manifest);

    this.authorityState = {
      phase: 'PREMATCH_LOADOUT',
      startedAtMs: null,
      endedAtMs: null,
      winner: null,
      scores: {},
      version: 0,
      lastEventSeq: 0,
      lastEventAtMs: null,
      eventLogHash: this.eventLog.hash,
      stateHash: 'genesis',
    };

    this.client.subscribe((state) => {
      const normalized = normalizeLegacyState(state);
      this.authorityState = {
        ...normalized,
        eventLogHash: this.eventLog.hash,
        lastEventAtMs: this.authorityState.lastEventAtMs,
      };
    });
  }

  record(event: TEvent): void {
    const seq = Number.isFinite(event.seq) && Number(event.seq) > 0 ? Number(event.seq) : this.nextSeq++;
    const timestamp = Number.isFinite(event.timestamp) ? Number(event.timestamp) : Date.now();
    const typedEvent: MatchAuthorityEvent = {
      seq,
      timestamp,
      type: 'EXTERNAL_EVENT',
      data: { signalType: event.type, data: event.data },
    };
    this.eventLog = appendDeterministicEvent(this.eventLog, typedEvent, this.maxEvents);
    this.authorityState = {
      ...this.authorityState,
      lastEventSeq: seq,
      version: this.authorityState.version + 1,
      lastEventAtMs: timestamp,
      eventLogHash: this.eventLog.hash,
    };

    const actions = toSnapActions(event, this.matchId);
    for (const action of actions) {
      this.client.dispatch(action).catch(() => undefined);
    }
  }

  getState(): MatchAuthorityState {
    return {
      ...this.authorityState,
      scores: { ...this.authorityState.scores },
    };
  }

  getStateHash(): string {
    return this.authorityState.stateHash;
  }

  getEventLogHash(): string {
    return this.eventLog.hash;
  }

  getEventLog(): MatchAuthorityEvent[] {
    return this.eventLog.events.slice();
  }
}

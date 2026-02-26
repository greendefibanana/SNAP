import { createSnapDeterministicEventLog, appendSnapEvent } from './eventLog.js';
import { computeSnapStateHash } from './hash.js';
import { validateActionEnvelope } from './validation.js';
import { createBuiltinModules } from '../modules/index.js';
import type { SnapDeterministicEventLog } from './eventLog.js';
import type { SnapModule } from '../modules/types.js';
import type {
  CreateSnapEngineOptions,
  SnapAction,
  SnapEngine,
  SnapEventLogEntry,
  SnapManifest,
  SnapModuleId,
  SnapModuleReducers,
  SnapReplayResult,
  SnapRuleset,
  SnapState,
} from './types.js';

const MODULE_ORDER: SnapModuleId[] = [
  'wager',
  'stake',
  'registry',
  'scoring',
  'mutation',
  'burn',
  'wagerEscrow',
  'tokenization',
  'acquisitionPolicy',
  'settlement',
  'provenance',
];

function resolveEnabled(manifest: SnapManifest, moduleId: SnapModuleId): boolean {
  return manifest.modules?.[moduleId] !== false;
}

function deriveMatchId(options: CreateSnapEngineOptions, manifest: SnapManifest): string {
  if (options.matchId && options.matchId.trim().length > 0) return options.matchId;
  const rv = manifest.ruleVars?.matchId;
  if (rv && (rv.type === 'string' || rv.type === 'enum') && typeof rv.value === 'string' && rv.value.trim().length > 0) {
    return rv.value;
  }
  return `${manifest.gameId}:${manifest.rulesetId}:local`;
}

function createInitialState(
  manifest: SnapManifest,
  ruleset: SnapRuleset,
  modules: Partial<Record<SnapModuleId, SnapModule>>,
  options: CreateSnapEngineOptions,
): SnapState {
  let state: SnapState = {
    matchId: deriveMatchId(options, manifest),
    phase: 'PREMATCH',
    seq: 0,
    stateHash: '',
    ruleVars: { ...(manifest.ruleVars ?? {}) },
    modules: {},
    custom: {},
  };
  state = ruleset.createInitialState(manifest);
  state = {
    ...state,
    matchId: state.matchId || deriveMatchId(options, manifest),
    phase: state.phase ?? 'PREMATCH',
    seq: 0,
    stateHash: '',
    ruleVars: { ...(manifest.ruleVars ?? {}), ...(state.ruleVars ?? {}) },
    modules: { ...(state.modules ?? {}) },
    custom: { ...(state.custom ?? {}) },
  };

  for (const moduleId of MODULE_ORDER) {
    if (!resolveEnabled(manifest, moduleId)) continue;
    const module = modules[moduleId];
    if (!module) continue;
    state = module.init(manifest, state);
  }

  state.stateHash = computeSnapStateHash({ ...state, stateHash: '' });
  return state;
}

export class Engine implements SnapEngine {
  readonly manifest: SnapManifest;
  private readonly ruleset: SnapRuleset;
  private readonly moduleReducers: SnapModuleReducers;
  private readonly modules: Partial<Record<SnapModuleId, SnapModule>>;
  private readonly systemActor: string;
  private state: SnapState;
  private log: SnapDeterministicEventLog;
  private readonly subscribers = new Set<(state: SnapState) => void>();
  private lastActionT = 0;

  constructor(manifest: SnapManifest, ruleset: SnapRuleset, options: CreateSnapEngineOptions = {}) {
    this.manifest = manifest;
    this.ruleset = ruleset;
    this.moduleReducers = { ...(options.moduleReducers ?? {}) };
    this.modules = {
      ...(createBuiltinModules() as Partial<Record<SnapModuleId, SnapModule>>),
      ...(options.modules ?? {}),
    };
    this.systemActor = options.systemActor ?? 'engine:local';
    this.state = createInitialState(manifest, ruleset, this.modules, options);
    this.log = createSnapDeterministicEventLog();
  }

  getState(): SnapState {
    return this.state;
  }

  getEventLog(): SnapEventLogEntry[] {
    return this.log.events.slice();
  }

  private buildSummaryState(): SnapState {
    const provenanceRaw = (this.state.modules.provenance ?? {}) as Record<string, unknown>;
    return {
      ...this.state,
      modules: {
        ...this.state.modules,
        provenance: {
          ...provenanceRaw,
          logHash: this.log.hash,
        },
      },
    };
  }

  getSummary(): Record<string, unknown> {
    const summary: Record<string, unknown> = {};
    const summaryState = this.buildSummaryState();
    for (const moduleId of MODULE_ORDER) {
      if (!resolveEnabled(this.manifest, moduleId)) continue;
      const module = this.modules[moduleId];
      if (!module?.finalize) continue;
      const partial = module.finalize(this.manifest, summaryState);
      Object.assign(summary, partial);
    }
    return summary;
  }

  endMatch(): Record<string, unknown> {
    if (this.state.phase !== 'POSTMATCH') {
      const next: SnapState = {
        ...this.state,
        phase: 'POSTMATCH',
        stateHash: '',
      };
      next.stateHash = computeSnapStateHash(next);
      this.state = next;
      this.subscribers.forEach((cb) => cb(this.state));
    }
    return this.getSummary();
  }

  dispatch(action: SnapAction): SnapState {
    validateActionEnvelope(action);
    if (action.matchId !== this.state.matchId) {
      throw new Error(`Action matchId mismatch: expected ${this.state.matchId}, received ${action.matchId}`);
    }

    let next = this.state;

    for (const moduleId of MODULE_ORDER) {
      if (!resolveEnabled(this.manifest, moduleId)) continue;
      const module = this.modules[moduleId];
      module?.validateAction?.(action, this.manifest, next);
      if (module?.applyAction) {
        next = module.applyAction(action, this.manifest, next);
      }
      if (action.kind === 'TICK' && module?.tick) {
        const payload = (action.payload ?? {}) as { dtSec?: number };
        const dtSec = Number.isFinite(payload.dtSec) ? Number(payload.dtSec) : 0;
        next = module.tick(Math.max(0, dtSec), this.manifest, next);
      }

      const reducer = this.moduleReducers[moduleId];
      if (!reducer) continue;
      next = reducer(next, action, this.manifest);
    }

    next = this.ruleset.reduce(next, action, this.manifest);

    const seq = this.state.seq + 1;
    const finalized: SnapState = {
      ...next,
      matchId: this.state.matchId,
      seq,
      stateHash: '',
    };

    finalized.stateHash = computeSnapStateHash(finalized);

    this.log = appendSnapEvent(this.log, {
      seq,
      kind: action.kind,
      timestamp: action.t,
    });

    this.state = finalized;
    this.lastActionT = action.t;

    const snapshot = this.state;
    this.subscribers.forEach((cb) => cb(snapshot));
    return snapshot;
  }

  tick(dtSec: number): SnapState {
    const safeDt = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
    const nextT = this.lastActionT + Math.round(safeDt * 1000);
    return this.dispatch({
      matchId: this.state.matchId,
      actor: this.systemActor,
      t: nextT,
      kind: 'TICK',
      payload: { dtSec: safeDt },
    });
  }

  subscribe(callback: (state: SnapState) => void): () => void {
    this.subscribers.add(callback);
    callback(this.state);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  replay(log: SnapAction[]): SnapReplayResult {
    let replayState = createInitialState(this.manifest, this.ruleset, {
      ...this.modules,
    }, {
      matchId: this.state.matchId,
    });

    for (let i = 0; i < log.length; i++) {
      const action = log[i]!;
      validateActionEnvelope(action);
      if (action.matchId !== replayState.matchId) {
        throw new Error(`Replay action matchId mismatch at index ${i}`);
      }

      let next = replayState;
      for (const moduleId of MODULE_ORDER) {
        if (!resolveEnabled(this.manifest, moduleId)) continue;
        const module = this.modules[moduleId];
        module?.validateAction?.(action, this.manifest, next);
        if (module?.applyAction) {
          next = module.applyAction(action, this.manifest, next);
        }
        if (action.kind === 'TICK' && module?.tick) {
          const payload = (action.payload ?? {}) as { dtSec?: number };
          const dtSec = Number.isFinite(payload.dtSec) ? Number(payload.dtSec) : 0;
          next = module.tick(Math.max(0, dtSec), this.manifest, next);
        }

        const reducer = this.moduleReducers[moduleId];
        if (!reducer) continue;
        next = reducer(next, action, this.manifest);
      }
      next = this.ruleset.reduce(next, action, this.manifest);
      replayState = {
        ...next,
        matchId: replayState.matchId,
        seq: replayState.seq + 1,
        stateHash: '',
      };
      replayState.stateHash = computeSnapStateHash(replayState);
    }

    const expectedHash = this.state.stateHash;
    const actualHash = replayState.stateHash;
    return {
      state: replayState,
      expectedHash,
      actualHash,
      verified: expectedHash === actualHash,
    };
  }
}

import type { SnapModule } from '../modules/types.js';
import type { WagerConfig, WagerState } from '../modules/wager/types.js';

export type SnapPhase = 'PREMATCH' | 'LIVE' | 'POSTMATCH';
export type SnapModuleId =
  | 'wager'
  | 'stake'
  | 'acquisitionPolicy'
  | 'registry'
  | 'scoring'
  | 'mutation'
  | 'burn'
  | 'wagerEscrow'
  | 'tokenization'
  | 'settlement'
  | 'provenance';

export type SnapRuleVarValue =
  | { type: 'number'; value: number }
  | { type: 'bool'; value: boolean }
  | { type: 'string'; value: string }
  | { type: 'enum'; value: string }
  | { type: 'json'; value: unknown };

export type SnapRuleVars = Record<string, SnapRuleVarValue>;

export interface SnapModuleConfigMap {
  wager?: WagerConfig;
  stake?: Record<string, unknown>;
  acquisitionPolicy?: Record<string, unknown>;
  registry?: Record<string, unknown>;
  scoring?: Record<string, unknown>;
  mutation?: Record<string, unknown>;
  burn?: Record<string, unknown>;
  wagerEscrow?: Record<string, unknown>;
  tokenization?: Record<string, unknown>;
  settlement?: Record<string, unknown>;
  provenance?: Record<string, unknown>;
}

export interface SnapModuleToggleMap {
  wager?: boolean;
  stake?: boolean;
  acquisitionPolicy?: boolean;
  registry?: boolean;
  scoring?: boolean;
  mutation?: boolean;
  burn?: boolean;
  wagerEscrow?: boolean;
  tokenization?: boolean;
  settlement?: boolean;
  provenance?: boolean;
}

export interface SnapManifest {
  version: string;
  gameId: string;
  rulesetId: string;
  allowedAssets?: string[];
  policy?: 'allowlist' | 'denylist';
  temporaryAssetsAllowed?: boolean;
  modules?: SnapModuleToggleMap;
  moduleConfig?: SnapModuleConfigMap;
  ruleVars?: SnapRuleVars;
}

export interface SnapAction {
  matchId: string;
  actor: string; // pubkey string
  t: number; // ms or tick
  kind: string;
  payload: unknown;
  sig?: string;
}

export interface SnapState {
  matchId: string;
  phase: SnapPhase;
  seq: number;
  stateHash: string;
  ruleVars: SnapRuleVars;
  modules: {
    wager?: WagerState;
    stake?: Record<string, unknown>;
    acquisitionPolicy?: Record<string, unknown>;
    registry?: Record<string, unknown>;
    scoring?: Record<string, unknown>;
    mutation?: Record<string, unknown>;
    burn?: Record<string, unknown>;
    wagerEscrow?: Record<string, unknown>;
    tokenization?: Record<string, unknown>;
    settlement?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
  };
  custom: Record<string, unknown>;
}

export interface SnapEventLogEntry {
  seq: number;
  kind: string;
  timestamp: number;
  hash: string;
}

export interface SnapRuleset {
  id: string;
  createInitialState(manifest: SnapManifest): SnapState;
  reduce(state: SnapState, action: SnapAction, manifest: SnapManifest): SnapState;
}

export type SnapReducer = (state: SnapState, action: SnapAction, manifest: SnapManifest) => SnapState;

export type SnapModuleReducers = Partial<Record<SnapModuleId, SnapReducer>>;

export interface SnapEngineActionLogItem {
  action: SnapAction;
  event: SnapEventLogEntry;
}

export interface SnapReplayResult {
  state: SnapState;
  verified: boolean;
  expectedHash: string;
  actualHash: string;
}

export interface CreateSnapEngineOptions {
  ruleset?: SnapRuleset;
  moduleReducers?: SnapModuleReducers;
  modules?: Partial<Record<SnapModuleId, SnapModule>>;
  systemActor?: string;
  matchId?: string;
}

export interface SnapEngine {
  readonly manifest: SnapManifest;
  getState(): SnapState;
  getEventLog(): SnapEventLogEntry[];
  getSummary(): Record<string, unknown>;
  endMatch(): Record<string, unknown>;
  dispatch(action: SnapAction): SnapState;
  tick(dtSec: number): SnapState;
  subscribe(callback: (state: SnapState) => void): () => void;
  replay(log: SnapAction[]): SnapReplayResult;
}

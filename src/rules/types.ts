export type TeamId = 'blue' | 'red';

export type MatchPhase = 'PREMATCH' | 'LIVE' | 'POSTMATCH';
export type ZonePhase = 'COUNTDOWN' | 'ACTIVE';

export interface MatchConfig {
  zoneCountdownSec: number;
  zoneActiveSec: number;
  signalRatePerSec: number;
  winSignal: number;
  dropsEnabled: boolean;
}

export interface DropLifecycle {
  status: 'IDLE' | 'EXTRACTED';
  activeDropId: string | null;
  lastExtractedByTeamId: TeamId | null;
}

export interface MatchState {
  config: MatchConfig;
  phase: MatchPhase;
  activeZoneIndex: number;
  zonePhase: ZonePhase;
  phaseEndsAt: number | null;
  nowSec: number;
  signalTotals: Record<TeamId, number>;
  contested: boolean;
  ownerTeamId: TeamId | null;
  presence: Record<TeamId, number>;
  drop: DropLifecycle;
  activeDropBuff: Record<TeamId, string | null>;
  grantedDropIds: Set<string>;
  selectedLoadoutSlot: number | null;
  winnerTeamId: TeamId | null;
  seq: number;
  stateHash: string;
}

export type MatchAction =
  | { type: 'TICK'; dtSec: number }
  | { type: 'PRESENCE'; teamId: TeamId; count: number }
  | { type: 'SELECT_LOADOUT'; slot: number }
  | { type: 'DROP_EXTRACT_COMPLETE'; dropId: string; teamId: TeamId; buffKey?: string };

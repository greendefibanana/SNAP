export type WagerCurrencyKind = 'SOL' | 'SPL';

export interface WagerCurrency {
  kind: WagerCurrencyKind;
  mint?: string;
}

export type WagerParticipationModel = 'solo' | 'ffa' | 'teams' | 'seats';
export type WagerLockPolicyKind = 'immediate' | 'manual_ready' | 'time_lock';
export type WagerEscrowModel = 'offchain_stub' | 'solana_escrow' | 'magicblock_delegated';
export type WagerSettlementModel = 'winner_take_all' | 'split_top_k' | 'proportional' | 'custom';
export type WagerWinnerDetermination = 'ruleset' | 'score_counter' | 'placement' | 'threshold_activity';

export interface WagerSplitTopKConfig {
  topK: number;
  weightCurve?: number[];
}

export interface WagerScoreCounterConfig {
  counter: string;
}

export interface WagerActivityWinConfig {
  type: 'score_at_least' | 'kills_at_least' | 'level_at_least' | 'time_under';
  counter?: string;
  threshold: number;
  timeLimitSec?: number;
}

export interface WagerEscalationConfig {
  enabled: boolean;
  windows: Array<{ atSec: number; multiplier: number }>;
  requireAll?: boolean;
}

export interface WagerAntiAbuseConfig {
  minDurationSec?: number;
  allowRejoin?: boolean;
  forfeitPenaltyBps?: number;
}

export interface WagerConfig {
  currency: WagerCurrency;
  entryAmount: number;
  maxParticipants: number;
  participationModel: WagerParticipationModel;
  teams?: { teamIds: string[]; teamSize?: number };
  seats?: { seatIds: string[] };
  lockPolicy: WagerLockPolicyKind;
  lockAtMs?: number;
  escrowModel: WagerEscrowModel;
  settlementModel: WagerSettlementModel;
  winnerDetermination: WagerWinnerDetermination;
  activityWin?: WagerActivityWinConfig;
  escalation?: WagerEscalationConfig;
  antiAbuse?: WagerAntiAbuseConfig;
  splitTopK?: WagerSplitTopKConfig;
  scoreCounter?: WagerScoreCounterConfig;
  rakeBps?: number;
  rakeRecipient?: string;
}

export interface WagerParticipantState {
  teamId?: string;
  seatId?: string;
  joinedAtMs: number;
  paid: boolean;
  ready: boolean;
  forfeited?: boolean;
}

export interface WagerPayout {
  recipient: string;
  amount: number;
}

export type WagerPhase = 'OPEN' | 'LOCKED' | 'LIVE' | 'SETTLING' | 'SETTLED' | 'CANCELLED';

export interface WagerResultPlacement {
  recipient: string;
  placement: number;
}

export interface WagerResult {
  winnerIds?: string[];
  placements?: WagerResultPlacement[];
  payouts?: WagerPayout[];
}

export interface WagerState extends Record<string, unknown> {
  phase: WagerPhase;
  participants: Record<string, WagerParticipantState>;
  pot: { total: number; currency: WagerCurrency };
  escrowRef?: string;
  escalationLevel: number;
  escalationMultiplier: number;
  settlement: { payouts?: WagerPayout[]; reason?: string };
  audit: { lastActionSeq: number; lastUpdatedAtMs: number };
  lockedAtMs?: number;
  liveAtMs?: number;
  result?: WagerResult;
  leftActors?: string[];
  pendingEscalationWindowIndex?: number;
  escalationConfirmations?: string[];
}

export interface WagerJoinPayload {
  actorId: string;
  teamId?: string;
  seatId?: string;
}

export interface WagerLeavePayload {
  actorId: string;
}

export interface WagerReadyPayload {
  actorId: string;
  ready: true;
}

export interface WagerForfeitPayload {
  actorId: string;
}

export interface WagerEscalateRequestPayload {
  actorId?: string;
  teamId?: string;
  windowIndex: number;
}

export interface WagerEscalateConfirmPayload {
  actorId?: string;
  teamId?: string;
}

export interface WagerSetResultPayload {
  result: WagerResult;
}

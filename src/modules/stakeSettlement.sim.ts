import { createSettlementModule } from './settlement.js';
import { createStakeModule } from './stake.js';
import type { SnapManifest, SnapState } from '../engine/types.js';

export function runStakeSettlementModuleSim(): {
  stakeEscalationLevel: number;
  payoutCount: number;
  summaryStakeEscalationLevel: number;
  summarySettlementId: string | null;
} {
  const manifest: SnapManifest = {
    version: '1',
    gameId: 'sim',
    rulesetId: 'sim',
    moduleConfig: {
      stake: {
        escalationWindowsSec: [60, 120],
        escalationMultipliers: [1.5, 2],
      },
    },
  };

  const stake = createStakeModule();
  const settlement = createSettlementModule();

  let state: SnapState = {
    matchId: 'sim-match',
    phase: 'PREMATCH',
    seq: 0,
    stateHash: 'sim',
    ruleVars: {},
    modules: {},
    custom: {},
  };

  state = stake.init(manifest, state);
  state = settlement.init(manifest, state);

  state = stake.applyAction!({
    matchId: 'sim-match',
    actor: 'actor',
    t: 0,
    kind: 'STAKE_LOCK',
    payload: {
      wagerAmount: 100,
      currencyMint: 'mint:abc',
      escrowAccount: 'escrow:xyz',
    },
  }, manifest, state);

  state = stake.applyAction!({
    matchId: 'sim-match',
    actor: 'actor',
    t: 5000,
    kind: 'ESCALATE_REQUEST',
    payload: {},
  }, manifest, state);

  state = stake.applyAction!({
    matchId: 'sim-match',
    actor: 'actor',
    t: 5100,
    kind: 'ESCALATE_CONFIRM',
    payload: {},
  }, manifest, state);

  state = settlement.applyAction!({
    matchId: 'sim-match',
    actor: 'actor',
    t: 10000,
    kind: 'MATCH_SETTLE',
    payload: {
      settlementId: 'settle-1',
      payoutBreakdown: [
        { recipient: 'teamA', amount: 150, reason: 'winner' },
        { recipient: 'teamB', amount: 50, reason: 'remainder' },
      ],
    },
  }, manifest, state);

  const stakeState = state.modules.stake as { escalationLevel?: number } | undefined;
  const settlementState = state.modules.settlement as { payoutBreakdown?: unknown[] } | undefined;

  const summary = {
    ...(stake.finalize?.(manifest, state) ?? {}),
    ...(settlement.finalize?.(manifest, state) ?? {}),
  } as {
    stake?: { escalationLevel?: number };
    settlement?: { settlementId?: string | null };
  };

  return {
    stakeEscalationLevel: Number(stakeState?.escalationLevel ?? 0),
    payoutCount: Array.isArray(settlementState?.payoutBreakdown) ? settlementState!.payoutBreakdown!.length : 0,
    summaryStakeEscalationLevel: Number(summary.stake?.escalationLevel ?? 0),
    summarySettlementId: summary.settlement?.settlementId ?? null,
  };
}

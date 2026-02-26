import { createSnapEngine } from './engine/createSnapEngine.js';
import type { SnapAction, SnapManifest, SnapRuleset, SnapState } from './engine/types.js';

const passthroughRuleset: SnapRuleset = {
  id: 'wager-sim',
  createInitialState(manifest) {
    return {
      matchId: (manifest.ruleVars?.matchId?.value as string) ?? 'wager-sim',
      phase: 'PREMATCH',
      seq: 0,
      stateHash: '',
      ruleVars: { ...(manifest.ruleVars ?? {}) },
      modules: {},
      custom: {},
    };
  },
  reduce(state, action) {
    if (action.kind === 'MATCH_END') {
      return { ...state, phase: 'POSTMATCH' };
    }
    return state;
  },
};

function runScenario(name: string, manifest: SnapManifest, actions: Array<Omit<SnapAction, 'matchId'>>): SnapState {
  const engine = createSnapEngine(manifest, { ruleset: passthroughRuleset });
  const matchId = engine.getState().matchId;
  console.log(`\n=== ${name} ===`);
  console.log(`INIT phase=${(engine.getState().modules.wager as { phase?: string } | undefined)?.phase ?? 'n/a'} hash=${engine.getState().stateHash}`);
  for (const action of actions) {
    const next = engine.dispatch({ ...action, matchId });
    const wager = next.modules.wager as {
      phase?: string;
      settlement?: { payouts?: Array<{ recipient: string; amount: number }> };
    } | undefined;
    const payouts = wager?.settlement?.payouts ?? [];
    const payoutLabel = payouts.length > 0 ? ` payouts=${JSON.stringify(payouts)}` : '';
    console.log(`${action.kind} phase=${wager?.phase ?? 'n/a'}${payoutLabel} hash=${next.stateHash}`);
  }
  console.log(`FINAL hash=${engine.getState().stateHash}`);
  return engine.getState();
}

function nowActions(startT = 1_000): { next: (kind: string, actor: string, payload: unknown, stepMs?: number) => Omit<SnapAction, 'matchId'> } {
  let t = startT;
  return {
    next(kind, actor, payload, stepMs = 1_000) {
      t += stepMs;
      return { kind, actor, payload, t };
    },
  };
}

function runSinglePlayer(): void {
  const tx = nowActions();
  runScenario(
    'Single Player Threshold',
    {
      version: '1',
      gameId: 'generic',
      rulesetId: 'wager-sim',
      modules: { wager: true, scoring: true, wagerEscrow: false },
      moduleConfig: {
        wager: {
          currency: { kind: 'SOL' },
          entryAmount: 1_000,
          maxParticipants: 1,
          participationModel: 'solo',
          lockPolicy: 'immediate',
          escrowModel: 'offchain_stub',
          settlementModel: 'winner_take_all',
          winnerDetermination: 'threshold_activity',
          activityWin: { type: 'kills_at_least', counter: 'kills', threshold: 5 },
        },
      },
    },
    [
      tx.next('WAGER_JOIN', 'p1', { actorId: 'p1' }),
      tx.next('MATCH_START', 'system', {}),
      tx.next('SCORE_ADD', 'system', { counter: 'kills', entityId: 'p1', delta: 5 }),
      tx.next('MATCH_END', 'system', {}),
    ],
  );
}

function runFiveVFive(): void {
  const tx = nowActions(20_000);
  runScenario(
    '5v5 Teams Score Counter',
    {
      version: '1',
      gameId: 'generic',
      rulesetId: 'wager-sim',
      modules: { wager: true, scoring: true, wagerEscrow: false },
      moduleConfig: {
        wager: {
          currency: { kind: 'SOL' },
          entryAmount: 500,
          maxParticipants: 10,
          participationModel: 'teams',
          teams: { teamIds: ['blue', 'red'], teamSize: 5 },
          lockPolicy: 'manual_ready',
          escrowModel: 'offchain_stub',
          settlementModel: 'winner_take_all',
          winnerDetermination: 'score_counter',
          scoreCounter: { counter: 'signal' },
        },
      },
    },
    [
      tx.next('WAGER_JOIN', 'b1', { actorId: 'b1', teamId: 'blue' }),
      tx.next('WAGER_JOIN', 'b2', { actorId: 'b2', teamId: 'blue' }),
      tx.next('WAGER_JOIN', 'r1', { actorId: 'r1', teamId: 'red' }),
      tx.next('WAGER_JOIN', 'r2', { actorId: 'r2', teamId: 'red' }),
      tx.next('WAGER_READY', 'b1', { actorId: 'b1', ready: true }),
      tx.next('WAGER_READY', 'b2', { actorId: 'b2', ready: true }),
      tx.next('WAGER_READY', 'r1', { actorId: 'r1', ready: true }),
      tx.next('WAGER_READY', 'r2', { actorId: 'r2', ready: true }),
      tx.next('WAGER_LOCK', 'b1', {}),
      tx.next('MATCH_START', 'system', {}),
      tx.next('SCORE_ADD', 'system', { counter: 'signal', entityId: 'blue', delta: 120 }),
      tx.next('SCORE_ADD', 'system', { counter: 'signal', entityId: 'red', delta: 90 }),
      tx.next('MATCH_END', 'system', {}),
    ],
  );
}

function runBlackjackSeats(): void {
  const tx = nowActions(40_000);
  runScenario(
    'Blackjack Seats Ruleset Result',
    {
      version: '1',
      gameId: 'generic',
      rulesetId: 'wager-sim',
      modules: { wager: true, scoring: true, wagerEscrow: false },
      moduleConfig: {
        wager: {
          currency: { kind: 'SPL', mint: 'USDC_MINT' },
          entryAmount: 100,
          maxParticipants: 3,
          participationModel: 'seats',
          seats: { seatIds: ['seatA', 'seatB', 'seatC'] },
          lockPolicy: 'immediate',
          escrowModel: 'offchain_stub',
          settlementModel: 'split_top_k',
          splitTopK: { topK: 2, weightCurve: [3, 1] },
          winnerDetermination: 'ruleset',
        },
      },
    },
    [
      tx.next('WAGER_JOIN', 'u1', { actorId: 'u1', seatId: 'seatA' }),
      tx.next('WAGER_JOIN', 'u2', { actorId: 'u2', seatId: 'seatB' }),
      tx.next('WAGER_JOIN', 'u3', { actorId: 'u3', seatId: 'seatC' }),
      tx.next('MATCH_START', 'system', {}),
      tx.next('WAGER_SET_RESULT', 'system', {
        result: {
          placements: [
            { recipient: 'u1', placement: 1 },
            { recipient: 'u3', placement: 2 },
            { recipient: 'u2', placement: 3 },
          ],
        },
      }),
      tx.next('MATCH_END', 'system', {}),
    ],
  );
}

runSinglePlayer();
runFiveVFive();
runBlackjackSeats();

import assert from 'node:assert/strict';
import type { SnapAction, SnapManifest, SnapState } from '../../engine/types.js';
import { createWagerModule } from './index.js';

function baseState(): SnapState {
  return {
    matchId: 'm1',
    phase: 'PREMATCH',
    seq: 0,
    stateHash: 'h0',
    ruleVars: {},
    modules: {},
    custom: {},
  };
}

const manifest: SnapManifest = {
  version: '1',
  gameId: 'g',
  rulesetId: 'r',
  modules: { wager: true },
  moduleConfig: {
    wager: {
      currency: { kind: 'SOL' },
      entryAmount: 10,
      maxParticipants: 2,
      participationModel: 'solo',
      lockPolicy: 'manual_ready',
      escrowModel: 'offchain_stub',
      settlementModel: 'winner_take_all',
      winnerDetermination: 'ruleset',
      antiAbuse: { allowRejoin: false },
    },
  },
};

function action(kind: string, actor: string, payload: unknown, t: number): SnapAction {
  return { matchId: 'm1', kind, actor, payload, t };
}

function runValidationTests(): void {
  const mod = createWagerModule();
  let state = mod.init(manifest, baseState());

  const joinA = action('WAGER_JOIN', 'a', { actorId: 'a' }, 1);
  assert.doesNotThrow(() => mod.validateAction?.(joinA, manifest, state));
  state = mod.applyAction?.(joinA, manifest, state) ?? state;

  assert.throws(() => mod.validateAction?.(action('WAGER_READY', 'b', { actorId: 'b', ready: true }, 2), manifest, state));
  assert.doesNotThrow(() => mod.validateAction?.(action('WAGER_READY', 'a', { actorId: 'a', ready: true }, 2), manifest, state));

  const leaveA = action('WAGER_LEAVE', 'a', { actorId: 'a' }, 3);
  assert.doesNotThrow(() => mod.validateAction?.(leaveA, manifest, state));
  state = mod.applyAction?.(leaveA, manifest, state) ?? state;

  assert.throws(() => mod.validateAction?.(joinA, manifest, state), /rejoin disabled/);
}

function runTeamsValidationTests(): void {
  const mod = createWagerModule();
  const teamsManifest: SnapManifest = {
    version: '1',
    gameId: 'g',
    rulesetId: 'r',
    modules: { wager: true, scoring: true },
    moduleConfig: {
      wager: {
        currency: { kind: 'SOL' },
        entryAmount: 10,
        maxParticipants: 4,
        participationModel: 'teams',
        teams: { teamIds: ['blue', 'red'], teamSize: 2 },
        lockPolicy: 'manual_ready',
        escrowModel: 'offchain_stub',
        settlementModel: 'winner_take_all',
        winnerDetermination: 'score_counter',
        scoreCounter: { counter: 'signal' },
      },
    },
  };
  let state = mod.init(teamsManifest, baseState());

  assert.throws(
    () => mod.validateAction?.(action('WAGER_JOIN', 'b1', { actorId: 'b1' }, 1), teamsManifest, state),
    /teamId/,
  );
  assert.doesNotThrow(() => mod.validateAction?.(action('WAGER_JOIN', 'b1', { actorId: 'b1', teamId: 'blue' }, 1), teamsManifest, state));
  state = mod.applyAction?.(action('WAGER_JOIN', 'b1', { actorId: 'b1', teamId: 'blue' }, 1), teamsManifest, state) ?? state;
  assert.throws(
    () => mod.validateAction?.(action('WAGER_JOIN', 'x1', { actorId: 'x1', teamId: 'green' }, 2), teamsManifest, state),
    /teamId not allowed/,
  );
}

function runScoreCounterSettlementTest(): void {
  const mod = createWagerModule();
  const scoreManifest: SnapManifest = {
    version: '1',
    gameId: 'g',
    rulesetId: 'r',
    modules: { wager: true, scoring: true },
    moduleConfig: {
      wager: {
        currency: { kind: 'SOL' },
        entryAmount: 10,
        maxParticipants: 2,
        participationModel: 'teams',
        teams: { teamIds: ['blue', 'red'], teamSize: 1 },
        lockPolicy: 'manual_ready',
        escrowModel: 'offchain_stub',
        settlementModel: 'winner_take_all',
        winnerDetermination: 'score_counter',
        scoreCounter: { counter: 'signal' },
      },
    },
  };
  let state = mod.init(scoreManifest, baseState());
  state = mod.applyAction?.(action('WAGER_JOIN', 'b1', { actorId: 'b1', teamId: 'blue' }, 1), scoreManifest, state) ?? state;
  state = mod.applyAction?.(action('WAGER_JOIN', 'r1', { actorId: 'r1', teamId: 'red' }, 2), scoreManifest, state) ?? state;
  state = mod.applyAction?.(action('WAGER_READY', 'b1', { actorId: 'b1', ready: true }, 3), scoreManifest, state) ?? state;
  state = mod.applyAction?.(action('WAGER_READY', 'r1', { actorId: 'r1', ready: true }, 4), scoreManifest, state) ?? state;
  state = mod.applyAction?.(action('WAGER_LOCK', 'b1', {}, 5), scoreManifest, state) ?? state;
  state = mod.applyAction?.(action('MATCH_START', 'system', {}, 6), scoreManifest, state) ?? state;
  // Populate scoring module state directly (wager module reads from state.modules.scoring)
  state = {
    ...state,
    modules: {
      ...state.modules,
      scoring: {
        counters: {
          signal: { blue: 9, red: 2 },
        },
      },
    },
  };
  state = mod.applyAction?.(action('MATCH_END', 'system', {}, 9), scoreManifest, state) ?? state;
  const wager = state.modules.wager as { settlement?: { payouts?: Array<{ recipient: string; amount: number }> } };
  assert.deepEqual(wager.settlement?.payouts, [{ recipient: 'blue', amount: 20 }]);
}


function runThresholdActivityTest(): void {
  const mod = createWagerModule();
  const thresholdManifest: SnapManifest = {
    version: '1',
    gameId: 'g',
    rulesetId: 'r',
    modules: { wager: true, scoring: true },
    moduleConfig: {
      wager: {
        currency: { kind: 'SOL' },
        entryAmount: 100,
        maxParticipants: 1,
        participationModel: 'solo',
        lockPolicy: 'immediate',
        escrowModel: 'offchain_stub',
        settlementModel: 'winner_take_all',
        winnerDetermination: 'threshold_activity',
        activityWin: { type: 'kills_at_least', counter: 'kills', threshold: 3 },
      },
    },
  };
  let state = mod.init(thresholdManifest, baseState());
  state = mod.applyAction?.(action('WAGER_JOIN', 'p1', { actorId: 'p1' }, 1), thresholdManifest, state) ?? state;
  state = mod.applyAction?.(action('MATCH_START', 'system', {}, 2), thresholdManifest, state) ?? state;
  state = mod.applyAction?.(action('SCORE_ADD', 'system', { counter: 'kills', entityId: 'p1', delta: 3 }, 3), thresholdManifest, state) ?? state;
  state = mod.applyAction?.(action('MATCH_END', 'system', {}, 4), thresholdManifest, state) ?? state;
  const wager = state.modules.wager as { settlement?: { payouts?: Array<{ recipient: string; amount: number }> } };
  assert.deepEqual(wager.settlement?.payouts, [{ recipient: 'p1', amount: 100 }]);
}

runValidationTests();
runTeamsValidationTests();
runScoreCounterSettlementTest();
runThresholdActivityTest();
console.log('wager validation tests passed');

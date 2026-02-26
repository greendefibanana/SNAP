import { createSnapEngine } from './createSnapEngine.js';
import type { SnapManifest } from './types.js';

export function runEngineOnlySim(): { seq: number; hash: string } {
  const manifest: SnapManifest = {
    version: '1',
    gameId: 'snapshot',
    rulesetId: '2d-ctf',
    ruleVars: {
      matchId: { type: 'string', value: 'sim-match' },
    },
  };

  const engine = createSnapEngine(manifest, {
    ruleset: {
      id: '2d-ctf',
      createInitialState: () => ({
        matchId: 'sim-match',
        phase: 'PREMATCH',
        seq: 0,
        stateHash: '',
        ruleVars: {},
        modules: {},
        custom: {},
      }),
      reduce: (state, action) => ({
        ...state,
        phase: action.kind === 'START' ? 'LIVE' : state.phase,
      }),
    },
  });

  engine.dispatch({
    matchId: 'sim-match',
    actor: 'sim-actor',
    t: 1,
    kind: 'START',
    payload: {},
  });

  engine.tick(1);
  const state = engine.getState();
  return { seq: state.seq, hash: state.stateHash };
}

export function runEndMatchSummarySim(): Record<string, unknown> {
  const manifest: SnapManifest = {
    version: '1',
    gameId: 'snap-game',
    rulesetId: 'sim-ruleset',
    moduleConfig: {
      stake: {
        escalationWindowsSec: [60],
        escalationMultipliers: [1.5],
      },
    },
    ruleVars: {
      matchId: { type: 'string', value: 'sim-match-summary' },
    },
  };

  const engine = createSnapEngine(manifest, {
    ruleset: {
      id: 'sim-ruleset',
      createInitialState: () => ({
        matchId: 'sim-match-summary',
        phase: 'PREMATCH',
        seq: 0,
        stateHash: '',
        ruleVars: {},
        modules: {},
        custom: {},
      }),
      reduce: (state) => state,
    },
  });

  engine.dispatch({
    matchId: 'sim-match-summary',
    actor: 'sim',
    t: 1,
    kind: 'STAKE_LOCK',
    payload: {
      wagerAmount: 100,
      currencyMint: 'mint:sim',
      escrowAccount: 'escrow:sim',
    },
  });

  engine.dispatch({
    matchId: 'sim-match-summary',
    actor: 'sim',
    t: 2,
    kind: 'SCORE_ADD',
    payload: {
      counter: 'signal',
      entityId: 'teamA',
      delta: 3,
    },
  });

  engine.dispatch({
    matchId: 'sim-match-summary',
    actor: 'sim',
    t: 3,
    kind: 'MODIFIER_START',
    payload: {
      id: 'dropbuff:forge_link',
      data: {},
      ttlSec: 10,
    },
  });

  return engine.endMatch();
}

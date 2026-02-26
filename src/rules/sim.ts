import { applyAction, createInitialMatchState } from './reducer.js';
import type { MatchAction, MatchState } from './types.js';

const scriptedActions: MatchAction[] = [
  { type: 'SELECT_LOADOUT', slot: 1 },
  { type: 'PRESENCE', teamId: 'blue', count: 3 },
  { type: 'PRESENCE', teamId: 'red', count: 0 },
  { type: 'TICK', dtSec: 30 },
  { type: 'TICK', dtSec: 15 },
  { type: 'DROP_EXTRACT_COMPLETE', dropId: 'drop-alpha', teamId: 'blue', buffKey: 'forge_link' },
  { type: 'TICK', dtSec: 45 },
  { type: 'PRESENCE', teamId: 'red', count: 2 },
  { type: 'TICK', dtSec: 10 },
  { type: 'PRESENCE', teamId: 'blue', count: 0 },
  { type: 'TICK', dtSec: 20 },
];

function activeBuffSummary(state: MatchState): string {
  return `blue=${state.activeDropBuff.blue ?? '-'} red=${state.activeDropBuff.red ?? '-'}`;
}

export function runScriptedSimulation(): MatchState {
  let state = createInitialMatchState();
  for (const action of scriptedActions) {
    state = applyAction(state, action);
    console.log(
      [
        `seq=${state.seq}`,
        `signal={blue:${state.signalTotals.blue.toFixed(2)},red:${state.signalTotals.red.toFixed(2)}}`,
        `zone=${state.zonePhase}@${state.activeZoneIndex}`,
        `buff=${activeBuffSummary(state)}`,
        `hash=${state.stateHash}`,
      ].join(' '),
    );
  }
  return state;
}

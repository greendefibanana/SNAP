import { createLocalSnapClient } from './adapters/localSnapClient.js';
import { createSnapEngine } from './engine/createSnapEngine.js';
import type { SnapAction, SnapManifest, SnapState } from './engine/types.js';
import { registerBuiltinRulesets } from './rulesets/index.js';

function readSignal(state: SnapState): string {
  const scoring = (state.modules.scoring ?? {}) as { counters?: Record<string, Record<string, number>> };
  const signal = scoring.counters?.signal ?? {};
  return JSON.stringify(signal);
}

function readHardpoint(state: SnapState): string {
  const hp = (state.custom.snapshotHardpoint ?? {}) as {
    activeZoneIndex?: number;
    zonePhase?: string;
    phaseEndsAtMs?: number;
    ownerTeamId?: string | null;
    contested?: boolean;
    drop?: { state?: string; dropId?: string | null; endsAtMs?: number | null; extractingTeamId?: string };
  };
  return JSON.stringify({
    zone: hp.activeZoneIndex,
    zonePhase: hp.zonePhase,
    phaseEndsAtMs: hp.phaseEndsAtMs,
    ownerTeamId: hp.ownerTeamId ?? null,
    contested: Boolean(hp.contested),
    drop: hp.drop ?? null,
  });
}

function printState(label: string, state: SnapState): void {
  console.log(
    `${label} seq=${state.seq} signal=${readSignal(state)} hardpoint=${readHardpoint(state)} hash=${state.stateHash}`,
  );
}

export async function runSnapshotHardpointSim(): Promise<SnapState> {
  registerBuiltinRulesets();

  const manifest: SnapManifest = {
    version: '1',
    gameId: 'snapshot',
    rulesetId: 'snapshot-hardpoint',
    ruleVars: {
      matchId: { type: 'string', value: 'snapshot-hardpoint-sim' },
      zoneCount: { type: 'number', value: 3 },
    },
  };

  const client = createLocalSnapClient(manifest);
  const initial = await client.getState();
  const matchId = initial.matchId;
  let t = 0;
  const step = async (kind: string, payload: unknown) => {
    if (kind === 'TICK') {
      t += Math.round(Number((payload as { dtSec?: number }).dtSec ?? 0) * 1000);
    }
    const action: SnapAction = {
      matchId,
      actor: 'sim',
      t,
      kind,
      payload,
    };
    await client.dispatch(action);
    const next = await client.getState();
    printState(kind, next);
  };

  printState('INIT', initial);
  await step('SELECT_LOADOUT', { slot: 1 });
  await step('PRESENCE_UPDATE', { teamId: 'blue', count: 3 });
  await step('PRESENCE_UPDATE', { teamId: 'red', count: 0 });
  await step('TICK', { dtSec: 30 });
  await step('TICK', { dtSec: 15 });
  await step('DROP_EXTRACT_COMPLETE', { dropId: 'drop-alpha', teamId: 'blue', buffKey: 'forge_link' });
  await step('TICK', { dtSec: 20 });
  await step('PRESENCE_UPDATE', { teamId: 'red', count: 2 });
  await step('TICK', { dtSec: 15 });
  await step('PRESENCE_UPDATE', { teamId: 'blue', count: 0 });
  await step('TICK', { dtSec: 30 });

  return client.getState();
}

function readCtf2d(state: SnapState): string {
  const ctf2d = (state.custom.ctf2d ?? {}) as {
    scoresByTeam?: Record<string, number>;
    flagHeldBy?: { teamId: string; playerId: string };
    timer?: number;
  };
  const scoring = (state.modules.scoring ?? {}) as { counters?: Record<string, Record<string, number>> };
  const ctfScore = scoring.counters?.ctf_score ?? {};
  return JSON.stringify({
    scoresByTeam: ctf2d.scoresByTeam ?? {},
    flagHeldBy: ctf2d.flagHeldBy ?? null,
    timer: Number(ctf2d.timer ?? 0),
    ctfCounter: ctfScore,
  });
}

function printCtfState(label: string, state: SnapState): void {
  console.log(`${label} seq=${state.seq} ctf2d=${readCtf2d(state)} hash=${state.stateHash}`);
}

export function runCtf2dSim(): SnapState {
  registerBuiltinRulesets();

  const manifest: SnapManifest = {
    version: '1',
    gameId: 'snapshot',
    rulesetId: 'ctf-2d',
    ruleVars: {
      matchId: { type: 'string', value: 'ctf-2d-sim' },
    },
  };

  const engine = createSnapEngine(manifest);
  let t = 0;
  const step = (kind: string, payload: unknown) => {
    if (kind === 'TICK') {
      t += Math.round(Number((payload as { dtSec?: number }).dtSec ?? 0) * 1000);
    }
    const next = engine.dispatch({
      matchId: engine.getState().matchId,
      actor: 'sim',
      t,
      kind,
      payload,
    });
    printCtfState(kind, next);
  };

  printCtfState('INIT', engine.getState());
  step('TICK', { dtSec: 5 });
  step('FLAG_PICKUP', { teamId: 'blue', playerId: 'p1' });
  step('TICK', { dtSec: 3 });
  step('FLAG_CAPTURE', { teamId: 'blue' });
  step('FLAG_PICKUP', { teamId: 'red', playerId: 'p9' });
  step('FLAG_CAPTURE', { teamId: 'red' });
  step('TICK', { dtSec: 2 });

  return engine.getState();
}

export async function runAllRulesetsSim(): Promise<void> {
  console.log('=== snapshot-hardpoint ===');
  await runSnapshotHardpointSim();
  console.log('=== ctf-2d ===');
  runCtf2dSim();
}

void runAllRulesetsSim();

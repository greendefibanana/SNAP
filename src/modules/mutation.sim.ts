import { createMutationModule } from './mutation.js';
import type { SnapManifest, SnapState } from '../engine/types.js';

export function runMutationModuleSim(): {
  nowSec: number;
  beforeExpireActive: string[];
  afterExpireActive: string[];
} {
  const module = createMutationModule();
  const manifest: SnapManifest = {
    version: '1',
    gameId: 'sim',
    rulesetId: 'sim',
  };

  let state: SnapState = {
    matchId: 'sim-match',
    phase: 'PREMATCH',
    seq: 0,
    stateHash: 'sim',
    ruleVars: {},
    modules: {},
    custom: {},
  };

  state = module.init(manifest, state);
  state = module.applyAction!({
    matchId: state.matchId,
    actor: 'sim-actor',
    t: 0,
    kind: 'MODIFIER_START',
    payload: {
      id: 'dropbuff:forge_link',
      data: { source: 'sim' },
      ttlSec: 2,
    },
  }, manifest, state);

  const before = Object.keys(((state.modules.mutation as any)?.activeModifiers ?? {}));

  state = module.tick!(1, manifest, state);
  state = module.tick!(1.1, manifest, state);

  const after = Object.keys(((state.modules.mutation as any)?.activeModifiers ?? {}));
  const nowSec = Number(((state.modules.mutation as any)?.nowSec ?? 0));

  return {
    nowSec,
    beforeExpireActive: before,
    afterExpireActive: after,
  };
}

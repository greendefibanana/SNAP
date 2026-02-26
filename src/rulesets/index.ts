import { registerRuleset as registerEngineRuleset } from '../engine/registry.js';
import { ctf2dRuleset } from './ctf2d.js';
import { spaceHuggersRunRuleset } from './spaceHuggersRun.js';
import { snapshotHardpointRuleset } from './snapshotHardpoint.js';
import { decaySurvivalRuleset } from './decaySurvival.js';

let registered = false;

export function registerBuiltinRulesets(): void {
  if (registered) return;
  registerEngineRuleset(snapshotHardpointRuleset);
  registerEngineRuleset(ctf2dRuleset);
  registerEngineRuleset(spaceHuggersRunRuleset);
  registerEngineRuleset(decaySurvivalRuleset);
  registered = true;
}

export * from './types.js';
export * from './registry.js';
export * from './snapshotHardpoint.js';
export * from './ctf2d.js';
export * from './spaceHuggersRun.js';
export * from './decaySurvival.js';

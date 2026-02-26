import type { SnapRuleset } from './types.js';

const rulesets = new Map<string, SnapRuleset>();

export function registerRuleset(ruleset: SnapRuleset): void {
  rulesets.set(ruleset.id, ruleset);
}

export function getRuleset(rulesetId: string): SnapRuleset {
  const ruleset = rulesets.get(rulesetId);
  if (!ruleset) {
    throw new Error(`No ruleset registered for id: ${rulesetId}`);
  }
  return ruleset;
}

export function listRulesets(): string[] {
  return [...rulesets.keys()];
}

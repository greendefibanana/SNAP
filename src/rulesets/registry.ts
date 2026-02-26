import type { RulesetId, RulesetPlugin } from './types.js';

const rulesetPlugins = new Map<RulesetId, RulesetPlugin>();

export function registerRuleset(plugin: RulesetPlugin): void {
  rulesetPlugins.set(plugin.id, plugin);
}

export function getRuleset(id: RulesetId): RulesetPlugin {
  const plugin = rulesetPlugins.get(id);
  if (!plugin) {
    throw new Error(`No ruleset plugin registered for id: ${id}`);
  }
  return plugin;
}

export function __clearRulesetsForTests(): void {
  rulesetPlugins.clear();
}

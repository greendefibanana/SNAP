import { createMagicBlockSnapClient, createLocalSnapClient } from './adapters/index.js';
import { createSnapEngine } from './engine/createSnapEngine.js';
import { registerBuiltinRulesets } from './rulesets/index.js';
import { createBuiltinModules } from './modules/index.js';
import { spaceHuggersRunRuleset } from './rulesets/spaceHuggersRun.js';

declare const __SNAP_VERSION__: string | undefined;

function getVersion(): string {
  return typeof __SNAP_VERSION__ === 'string' && __SNAP_VERSION__.trim().length > 0
    ? __SNAP_VERSION__
    : '0.0.0-dev';
}

export function registerBuiltins(): void {
  // Force inclusion and validation of builtin module factories in the browser bundle.
  createBuiltinModules();
  // Keep this ruleset as a hard reference in browser entry to avoid aggressive tree-shaking.
  void spaceHuggersRunRuleset.id;
  registerBuiltinRulesets();
}

export const version = getVersion();
export {
  createLocalSnapClient,
  createMagicBlockSnapClient,
  createSnapEngine,
  spaceHuggersRunRuleset,
};

const browserApi = {
  registerBuiltins,
  createLocalSnapClient,
  createMagicBlockSnapClient,
  createSnapEngine,
  spaceHuggersRunRuleset,
  version,
};

export default browserApi;

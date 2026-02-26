import { Engine } from './Engine.js';
import { getRuleset } from './registry.js';
import type { CreateSnapEngineOptions, SnapEngine, SnapManifest } from './types.js';

export function createSnapEngine(manifest: SnapManifest, options: CreateSnapEngineOptions = {}): SnapEngine {
  const ruleset = options.ruleset ?? getRuleset(manifest.rulesetId);
  return new Engine(manifest, ruleset, options);
}

import type { SnapAction, SnapManifest, SnapState } from '../engine/types.js';

export type RulesetId = string;

export interface RulesetPlugin {
  id: RulesetId;
  init(manifest: SnapManifest, state: SnapState): SnapState;
  validateAction?(action: SnapAction, manifest: SnapManifest, state: SnapState): void;
  applyAction(action: SnapAction, manifest: SnapManifest, state: SnapState): SnapState;
  tick?(dtSec: number, manifest: SnapManifest, state: SnapState): SnapState;
  selectors?(state: SnapState): Record<string, unknown>;
}

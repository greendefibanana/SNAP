import type { SnapAction, SnapManifest, SnapState } from '../engine/types.js';

export interface SnapModule {
  id: string;
  init(manifest: SnapManifest, state: SnapState): SnapState;
  validateAction?(action: SnapAction, manifest: SnapManifest, state: SnapState): void;
  applyAction?(action: SnapAction, manifest: SnapManifest, state: SnapState): SnapState;
  tick?(dtSec: number, manifest: SnapManifest, state: SnapState): SnapState;
  finalize?(manifest: SnapManifest, state: SnapState): Partial<Record<string, unknown>>;
}

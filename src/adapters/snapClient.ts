import type { SnapAction, SnapManifest, SnapState } from '../engine/types.js';

export interface SnapClient {
  readonly backend: 'local' | 'magicblock';
  dispatch(action: SnapAction): Promise<void>;
  getState(): Promise<SnapState>;
  subscribe(callback: (state: SnapState) => void): () => void;
  getSummary?(): Promise<Record<string, unknown>>;
}

export type LocalSnapClientConfig = SnapManifest;

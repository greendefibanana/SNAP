import { createSnapEngine } from '../engine/createSnapEngine.js';
import type { SnapAction, SnapState } from '../engine/types.js';
import { registerBuiltinRulesets } from '../rulesets/index.js';
import type { LocalSnapClientConfig, SnapClient } from './snapClient.js';

export function createLocalSnapClient(manifest: LocalSnapClientConfig): SnapClient {
  registerBuiltinRulesets();
  const engine = createSnapEngine(manifest);
  const listeners = new Set<(state: SnapState) => void>();

  const emit = () => {
    const state = engine.getState();
    listeners.forEach((listener) => listener(state));
  };

  return {
    backend: 'local',
    async dispatch(action: SnapAction): Promise<void> {
      engine.dispatch(action);
      emit();
    },
    async getState(): Promise<SnapState> {
      return engine.getState();
    },
    async getSummary(): Promise<Record<string, unknown>> {
      return engine.getSummary();
    },
    subscribe(callback: (state: SnapState) => void): () => void {
      listeners.add(callback);
      callback(engine.getState());
      return () => {
        listeners.delete(callback);
      };
    },
  };
}

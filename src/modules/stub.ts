import type { SnapModule } from './types.js';

export function createStubModule(id: string): SnapModule {
  return {
    id,
    init(_manifest, state) {
      return state;
    },
    applyAction(_action, _manifest, state) {
      return state;
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize() {
      return {};
    },
  };
}

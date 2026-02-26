import { createMagicBlockSnapClientAdapter } from './magicblock/clientAdapter.js';
import { createMagicBlockTokenizationClientAdapter } from './magicblock/tokenizationClientAdapter.js';
import type { SnapAuthorityBridgeConfig, MagicBlockTokenizationClientConfig } from './magicblock/types.js';
import type { SnapClient } from './snapClient.js';

type TokenizationAutoConfig =
  | boolean
  | Omit<MagicBlockTokenizationClientConfig, 'backend' | 'signer' | 'magicblockRpcUrl' | 'solanaRpcUrl'>;

export interface MagicBlockSnapClientConfig extends SnapAuthorityBridgeConfig {
  tokenization?: TokenizationAutoConfig;
}

export function createMagicBlockSnapClient(config: MagicBlockSnapClientConfig): SnapClient {
  const base = createMagicBlockSnapClientAdapter(config);
  const tokenizationCfg = config.tokenization ?? true;
  const tokenizationEnabled = tokenizationCfg !== false;

  const tokenization = tokenizationEnabled
    ? createMagicBlockTokenizationClientAdapter({
        backend: config.backend,
        signer: config.signer,
        magicblockRpcUrl: config.magicblockRpcUrl,
        solanaRpcUrl: config.solanaRpcUrl,
        ...(typeof tokenizationCfg === 'object' ? tokenizationCfg : {}),
      })
    : null;

  return {
    backend: base.backend,
    async dispatch(action) {
      const actionWithTxRef = tokenization
        ? await tokenization.dispatchAndAttachTxRef(action)
        : action;
      await base.dispatch(actionWithTxRef);
    },
    async getState() {
      return base.getState();
    },
    async getSummary() {
      return base.getSummary ? base.getSummary() : {};
    },
    subscribe(callback) {
      return base.subscribe(callback);
    },
  };
}

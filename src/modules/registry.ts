import type { SnapModule } from './types.js';
import type { SnapAction, SnapManifest, SnapState } from '../engine/types.js';

interface RegistryPolicyConfig {
  allowedAssets: string[];
  policy: 'allowlist' | 'denylist';
  temporaryAssetsAllowed: boolean;
}

interface RegistryModuleState extends Record<string, unknown> {
  allowedAssets: string[];
  policy: 'allowlist' | 'denylist';
  temporaryAssetsAllowed: boolean;
}

function readRegistryPolicy(manifest: SnapManifest): RegistryPolicyConfig {
  const fromModule = (manifest.moduleConfig?.registry ?? {}) as Partial<RegistryPolicyConfig>;

  const allowedAssets = Array.isArray(fromModule.allowedAssets)
    ? fromModule.allowedAssets.map((v) => String(v))
    : Array.isArray(manifest.allowedAssets)
      ? manifest.allowedAssets.map((v) => String(v))
      : [];

  const policy = fromModule.policy === 'denylist' || manifest.policy === 'denylist'
    ? 'denylist'
    : 'allowlist';

  const temporaryAssetsAllowed = Boolean(
    fromModule.temporaryAssetsAllowed ?? manifest.temporaryAssetsAllowed ?? false,
  );

  return {
    allowedAssets,
    policy,
    temporaryAssetsAllowed,
  };
}

function ensureRegistryState(state: SnapState, manifest: SnapManifest): RegistryModuleState {
  const existing = state.modules.registry as RegistryModuleState | undefined;
  const policy = readRegistryPolicy(manifest);
  if (existing && typeof existing === 'object') {
    return {
      allowedAssets: [...policy.allowedAssets],
      policy: policy.policy,
      temporaryAssetsAllowed: policy.temporaryAssetsAllowed,
    };
  }
  return {
    allowedAssets: [...policy.allowedAssets],
    policy: policy.policy,
    temporaryAssetsAllowed: policy.temporaryAssetsAllowed,
  };
}

function isAssetReferenced(action: SnapAction): { referenced: boolean; assetId: string | null } {
  if (action.kind.startsWith('ASSET_')) {
    const payload = (action.payload ?? {}) as { assetId?: unknown };
    const id = payload.assetId === undefined || payload.assetId === null
      ? null
      : String(payload.assetId);
    return { referenced: true, assetId: id };
  }

  if (action.payload && typeof action.payload === 'object') {
    const payload = action.payload as Record<string, unknown>;
    if (Object.prototype.hasOwnProperty.call(payload, 'assetId')) {
      const raw = payload.assetId;
      const id = raw === undefined || raw === null ? null : String(raw);
      return { referenced: true, assetId: id };
    }
  }

  return { referenced: false, assetId: null };
}

function isTemporaryAsset(assetId: string): boolean {
  return assetId.startsWith('temp:') || assetId.startsWith('tmp:');
}

function validateAssetAgainstPolicy(assetId: string, cfg: RegistryModuleState): void {
  if (cfg.temporaryAssetsAllowed && isTemporaryAsset(assetId)) {
    return;
  }

  const listed = cfg.allowedAssets.includes(assetId);

  if (cfg.policy === 'allowlist') {
    if (!listed) {
      throw new Error(`Registry policy violation: asset '${assetId}' is not allowlisted`);
    }
    return;
  }

  if (listed) {
    throw new Error(`Registry policy violation: asset '${assetId}' is denylisted`);
  }
}

export function createRegistryModule(): SnapModule {
  return {
    id: 'registry',
    init(manifest, state) {
      const registry = ensureRegistryState(state, manifest);
      return {
        ...state,
        modules: {
          ...state.modules,
          registry,
        },
      };
    },
    validateAction(action, manifest, state) {
      const registry = ensureRegistryState(state, manifest);
      const ref = isAssetReferenced(action);
      if (!ref.referenced) return;
      if (!ref.assetId || ref.assetId.trim().length === 0) {
        throw new Error(`Registry policy violation: action '${action.kind}' references missing assetId`);
      }
      validateAssetAgainstPolicy(ref.assetId, registry);
    },
    applyAction(_action, manifest, state) {
      const registry = ensureRegistryState(state, manifest);
      return {
        ...state,
        modules: {
          ...state.modules,
          registry,
        },
      };
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(_manifest, state) {
      const registry = (state.modules.registry as RegistryModuleState | undefined) ?? {
        allowedAssets: [],
        policy: 'allowlist',
        temporaryAssetsAllowed: false,
      };
      return {
        registry: {
          policy: registry.policy,
          allowedAssets: [...registry.allowedAssets],
          temporaryAssetsAllowed: registry.temporaryAssetsAllowed,
        },
      };
    },
  };
}

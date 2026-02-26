export type { SnapManifest, SnapAction, SnapState, SnapEventLogEntry } from './engine/types.js';
export { createSnapEngine } from './engine/createSnapEngine.js';
export { registerRuleset } from './engine/registry.js';

export { createLocalSnapClient } from './adapters/localSnapClient.js';
export { createMagicBlockSnapClient } from './adapters/magicBlockSnapClient.js';
export { createSnapRandomnessClient } from './adapters/snapRandomnessClient.js';
export { createSnapMultiplayerClient, createSnapJsHostedMultiplayerClient } from './adapters/snapMultiplayerClient.js';
export { createSnapGoldenClients } from './adapters/snapGoldenClients.js';
export { createSnapProvenanceClient } from './adapters/snapProvenanceClient.js';

export * from './modules/index.js';

// Legacy exports retained temporarily during migration.
export * from './core/types';
export * from './core/stateHash';
export * from './core/reducer';
export * from './core/eventLog';
export * from './adapters/signalLocalAdapter';
export * from './adapters/magicblock';
export * from './rules';

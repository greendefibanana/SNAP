export * from './types.js';
export * from './acquisitionPolicy.js';
export * from './stake.js';
export * from './registry.js';
export * from './scoring.js';
export * from './mutation.js';
export * from './burn.js';
export * from './wagerEscrow.js';
export * from './wager/index.js';
export * from './tokenization.js';
export * from './settlement.js';
export * from './provenance.js';

import { createBurnModule } from './burn.js';
import { createAcquisitionPolicyModule } from './acquisitionPolicy.js';
import { createMutationModule } from './mutation.js';
import { createProvenanceModule } from './provenance.js';
import { createRegistryModule } from './registry.js';
import { createScoringModule } from './scoring.js';
import { createSettlementModule } from './settlement.js';
import { createStakeModule } from './stake.js';
import { createTokenizationModule } from './tokenization.js';
import { createWagerEscrowModule } from './wagerEscrow.js';
import { createWagerModule } from './wager/index.js';
import type { SnapModule } from './types.js';

export function createBuiltinModules(): Record<string, SnapModule> {
  return {
    wager: createWagerModule(),
    stake: createStakeModule(),
    acquisitionPolicy: createAcquisitionPolicyModule(),
    registry: createRegistryModule(),
    scoring: createScoringModule(),
    mutation: createMutationModule(),
    burn: createBurnModule(),
    wagerEscrow: createWagerEscrowModule(),
    tokenization: createTokenizationModule(),
    settlement: createSettlementModule(),
    provenance: createProvenanceModule(),
  };
}

import type { Commitment, PublicKey } from '@solana/web3.js';
import {
  createMagicBlockProvenanceRegistryClient,
  type MagicBlockProvenanceRegistryClient,
} from './magicblock/provenanceRegistryClient.js';
import type { SnapAuthoritySigner } from './magicblock/types.js';

export interface SnapProvenanceClientConfig {
  programId: string | PublicKey;
  signer: SnapAuthoritySigner;
  rpcUrl?: string;
  useMagicBlock?: boolean;
  magicblockRpcUrl?: string;
  solanaRpcUrl?: string;
  commitment?: Commitment;
}

/**
 * SNAP-first provenance registry client.
 * Game devs can record player CV data onchain without managing transport details.
 */
export function createSnapProvenanceClient(
  config: SnapProvenanceClientConfig,
): MagicBlockProvenanceRegistryClient {
  const useMagicBlock = Boolean(config.useMagicBlock);
  const backend = useMagicBlock ? 'magicblock' : 'local';
  return createMagicBlockProvenanceRegistryClient({
    backend,
    programId: config.programId,
    signer: config.signer,
    commitment: config.commitment,
    magicblockRpcUrl: config.magicblockRpcUrl,
    solanaRpcUrl: config.solanaRpcUrl ?? config.rpcUrl,
  });
}

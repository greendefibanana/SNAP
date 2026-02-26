import type { Commitment, PublicKey } from '@solana/web3.js';
import { createMagicBlockTokenizationClientAdapter } from './magicblock/tokenizationClientAdapter.js';
import type { SnapAuthoritySigner } from './magicblock/types.js';
import { createSnapMultiplayerClient, type SnapMultiplayerClientConfig } from './snapMultiplayerClient.js';
import { createSnapProvenanceClient } from './snapProvenanceClient.js';
import { createSnapRandomnessClient } from './snapRandomnessClient.js';

export interface SnapGoldenClientsConfig {
  signer: SnapAuthoritySigner;
  multiplayerProgramId: string | PublicKey;
  rpcUrl?: string;
  solanaRpcUrl?: string;
  magicblockRpcUrl?: string;
  useMagicBlock?: boolean;
  commitment?: Commitment;
  tokenizationProgramId?: string;
  provenanceProgramId?: string | PublicKey;
  snapVrfProgramId?: string;
  magicBlockVrfProgramId?: string;
}

export interface SnapGoldenClients {
  multiplayer: ReturnType<typeof createSnapMultiplayerClient>;
  tokenization: ReturnType<typeof createMagicBlockTokenizationClientAdapter>;
  provenance?: ReturnType<typeof createSnapProvenanceClient>;
  randomness?: ReturnType<typeof createSnapRandomnessClient>;
}

/**
 * MagicBlock-first SDK composition for integrators.
 * Defaults to ER routing and ephemeral rollup hints for token actions.
 */
export function createSnapGoldenClients(config: SnapGoldenClientsConfig): SnapGoldenClients {
  const useMagicBlock = config.useMagicBlock ?? true;
  const solanaRpcUrl = config.solanaRpcUrl ?? config.rpcUrl;
  const magicblockRpcUrl = config.magicblockRpcUrl;

  const multiplayerConfig: SnapMultiplayerClientConfig = {
    programId: config.multiplayerProgramId,
    signer: config.signer,
    useMagicBlock,
    rpcUrl: config.rpcUrl,
    solanaRpcUrl,
    magicblockRpcUrl,
    commitment: config.commitment,
  };

  const multiplayer = createSnapMultiplayerClient(multiplayerConfig);

  const tokenization = createMagicBlockTokenizationClientAdapter({
    backend: useMagicBlock ? 'magicblock' : 'local',
    signer: config.signer,
    solanaRpcUrl,
    magicblockRpcUrl,
    tokenizationProgramId: config.tokenizationProgramId,
    commitment: (config.commitment ?? 'confirmed') as 'processed' | 'confirmed' | 'finalized',
    defaultChainHint: {
      backend: useMagicBlock ? 'magicblock' : 'solana',
      useEphemeralRollup: useMagicBlock,
    },
  });

  const provenance = config.provenanceProgramId
    ? createSnapProvenanceClient({
      programId: config.provenanceProgramId,
      signer: config.signer,
      useMagicBlock,
      rpcUrl: config.rpcUrl,
      solanaRpcUrl,
      magicblockRpcUrl,
      commitment: config.commitment,
    })
    : undefined;

  const randomness = config.snapVrfProgramId && config.magicBlockVrfProgramId
    ? createSnapRandomnessClient({
      mode: 'managed_magicblock',
      signer: config.signer,
      snapVrfProgramId: config.snapVrfProgramId,
      magicBlockVrfProgramId: config.magicBlockVrfProgramId,
      solanaRpcUrl,
      magicblockRpcUrl,
      useMagicBlockForSnapTx: useMagicBlock,
    })
    : undefined;

  return {
    multiplayer,
    tokenization,
    ...(provenance ? { provenance } : {}),
    ...(randomness ? { randomness } : {}),
  };
}

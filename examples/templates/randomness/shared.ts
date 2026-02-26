import { createHash } from 'crypto';
import type { Transaction } from '@solana/web3.js';
import { Keypair } from '@solana/web3.js';
import { createSnapRandomnessClient } from '../../../src/adapters/snapRandomnessClient.js';

function text32(input: string): Uint8Array {
  const digest = createHash('sha256').update(input).digest();
  return new Uint8Array(digest.subarray(0, 32));
}

export function makeMatchId(externalMatchId: string): Uint8Array {
  return text32(`match:${externalMatchId}`);
}

export function makeGameId(externalGameId: string): Uint8Array {
  return text32(`game:${externalGameId}`);
}

export interface DemoSigner {
  publicKey: Keypair['publicKey'];
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

export function makeDemoSigner(): DemoSigner {
  const kp = Keypair.generate();
  return {
    publicKey: kp.publicKey,
    async signTransaction(tx: Transaction): Promise<Transaction> {
      tx.partialSign(kp);
      return tx;
    },
  };
}

export function createManagedDemoRandomnessClient(input: {
  signer: DemoSigner;
  snapVrfProgramId: string;
  magicBlockVrfProgramId: string;
  solanaRpcUrl?: string;
  magicblockRpcUrl?: string;
}) {
  return createSnapRandomnessClient({
    mode: 'managed_magicblock',
    preset: 'generic_v1',
    signer: input.signer,
    snapVrfProgramId: input.snapVrfProgramId,
    magicBlockVrfProgramId: input.magicBlockVrfProgramId,
    solanaRpcUrl: input.solanaRpcUrl,
    magicblockRpcUrl: input.magicblockRpcUrl,
    useMagicBlockForSnapTx: true,
  });
}

export function makeSeed(label: string): Uint8Array {
  return text32(`seed:${label}`);
}


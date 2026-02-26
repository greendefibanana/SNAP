import { PublicKey } from '@solana/web3.js';
import {
  createMagicBlockVrfClientAdapter,
} from '../src/adapters/magicblock/vrfClientAdapter.js';
import {
  createMagicBlockVrfInstructionCodecFromIdl,
  createSnapVrfInstructionCodecFromIdl,
  type AnchorIdlLike,
} from '../src/adapters/magicblock/vrfAnchorCodecs.js';

// Load your actual IDL JSON here (from Anchor build artifacts or source control).
// Example:
// import snapVrfIdlJson from '../idl/snap_vrf_engine.json' assert { type: 'json' };
// import magicBlockVrfIdlJson from '../idl/magicblock_vrf.json' assert { type: 'json' };
export interface BuildCodecsInput {
  snapVrfIdl: AnchorIdlLike;
  magicBlockVrfIdl: AnchorIdlLike;
}

export function buildIdlCodecs(input: BuildCodecsInput) {
  const snapCodec = createSnapVrfInstructionCodecFromIdl({
    idl: input.snapVrfIdl,
  });

  const magicBlockCodec = createMagicBlockVrfInstructionCodecFromIdl({
    idl: input.magicBlockVrfIdl,
    instructionName: 'request_randomness', // replace if your MagicBlock VRF IDL uses a different name
    accountResolver: ({ signer, requestPda }) => ({
      authority: { pubkey: signer, isSigner: true, isWritable: true },
      request: { pubkey: requestPda, isSigner: false, isWritable: true },
    }),
    argResolver: ({ requestId, requestNonce, namespace }) => ({
      request_id: requestId,
      request_nonce: requestNonce,
      namespace,
    }),
    resolveExternalRequestId: ({ signature }) => {
      const out = new Uint8Array(32);
      const bytes = new TextEncoder().encode(signature.slice(0, 32));
      out.set(bytes.subarray(0, Math.min(bytes.length, 32)));
      return out;
    },
  });

  return { snapCodec, magicBlockCodec };
}

export async function createDemoClient(
  signer: {
    publicKey: PublicKey;
    signTransaction: (tx: any) => Promise<any>;
  },
  idls: BuildCodecsInput,
) {
  const { snapCodec, magicBlockCodec } = buildIdlCodecs(idls);
  return createMagicBlockVrfClientAdapter(
    {
      programId: new PublicKey('6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA'),
      magicBlockVrfProgramId: new PublicKey('6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA'),
      signer,
      solanaRpcUrl: 'https://api.devnet.solana.com',
      magicblockRpcUrl: 'http://127.0.0.1:8899',
      useMagicBlockForSnapTx: true,
    },
    {
      snap: snapCodec,
      magicblock: magicBlockCodec,
    },
  );
}


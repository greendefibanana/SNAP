import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import type {
  MagicBlockVrfInstructionCodec,
  SnapVrfInstructionCodec,
  SnapVrfNamespace,
  SnapVrfRandomnessType,
} from '../src/adapters/magicblock/vrfTypes.js';
import { createMagicBlockVrfClientAdapter } from '../src/adapters/magicblock/vrfClientAdapter.js';

// Replace this placeholder serializer with your Anchor discriminator + borsh encoder.
function placeholderData(tag: string, fields: readonly (Uint8Array | number | bigint | string)[]): Uint8Array {
  const txt = `${tag}:${fields.map((v) => (typeof v === 'string' ? v : String(v))).join('|')}`;
  return new TextEncoder().encode(txt);
}

const snapCodec: SnapVrfInstructionCodec = {
  buildRequestRandomnessIx(input) {
    return new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.signer, isSigner: true, isWritable: true },
        { pubkey: input.enginePda, isSigner: false, isWritable: false },
        { pubkey: input.matchPda, isSigner: false, isWritable: true },
        { pubkey: input.requestPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: placeholderData('request_randomness', [
        input.requestId,
        input.requestNonce,
        input.randomnessType,
        input.namespace,
      ]),
    });
  },
  buildRecordExternalRequestIdIx(input) {
    return new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.admin, isSigner: true, isWritable: false },
        { pubkey: input.enginePda, isSigner: false, isWritable: false },
        { pubkey: input.requestPda, isSigner: false, isWritable: true },
      ],
      data: placeholderData('record_external_request_id', [input.externalRequestId32.length]),
    });
  },
  buildFulfillRandomnessIx(input) {
    return new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.vrfAuthority, isSigner: true, isWritable: false },
        { pubkey: input.enginePda, isSigner: false, isWritable: false },
        { pubkey: input.matchPda, isSigner: false, isWritable: true },
        { pubkey: input.requestPda, isSigner: false, isWritable: true },
      ],
      data: placeholderData('fulfill_randomness', [input.vrfSeed32.length, input.vrfOutput32.length]),
    });
  },
  buildConsumeRandomnessIx(input) {
    return new TransactionInstruction({
      programId: input.programId,
      keys: [
        { pubkey: input.consumer, isSigner: true, isWritable: false },
        { pubkey: input.enginePda, isSigner: false, isWritable: false },
        { pubkey: input.matchPda, isSigner: false, isWritable: false },
        { pubkey: input.requestPda, isSigner: false, isWritable: true },
        { pubkey: input.namespaceConfigPda, isSigner: false, isWritable: false },
      ],
      data: placeholderData('consume_randomness', []),
    });
  },
};

const magicBlockCodec: MagicBlockVrfInstructionCodec = {
  buildVrfRequestIx(input) {
    return new TransactionInstruction({
      programId: input.magicBlockVrfProgramId,
      keys: [
        { pubkey: input.signer, isSigner: true, isWritable: true },
        { pubkey: input.requestPda, isSigner: false, isWritable: true },
      ],
      data: placeholderData('magicblock_vrf_request', [input.requestId, input.requestNonce, input.namespace]),
    });
  },
  resolveExternalRequestId(input) {
    // Replace with exact MagicBlock VRF event/log parsing.
    const out = new Uint8Array(32);
    const seed = new TextEncoder().encode(input.signature.slice(0, 32));
    out.set(seed.subarray(0, Math.min(seed.length, 32)));
    return out;
  },
};

export async function runExample(signer: {
  publicKey: PublicKey;
  signTransaction: (tx: any) => Promise<any>;
}) {
  const adapter = createMagicBlockVrfClientAdapter(
    {
      programId: new PublicKey('6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA'),
      magicBlockVrfProgramId: new PublicKey('6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA'),
      signer,
      solanaRpcUrl: 'https://api.devnet.solana.com',
      magicblockRpcUrl: 'http://127.0.0.1:8899',
      useMagicBlockForSnapTx: true,
    },
    { snap: snapCodec, magicblock: magicBlockCodec },
  );

  const matchId = new Uint8Array(32);
  const gameId = new Uint8Array(32);
  matchId[0] = 7;
  gameId[0] = 99;

  const cardShuffle = await adapter.requestCardShuffle({
    matchId,
    gameId,
    requestId: 1n,
    requestNonce: 1001n,
  });
  const deck = adapter.deterministicDeckOrder(cardShuffle.deckSeed32, 52);

  const dropReq = await adapter.requestDropRandomness({
    matchId,
    gameId,
    requestId: 2n,
    requestNonce: 1002n,
  });

  const routed = adapter.routeRandomEvent(
    cardShuffle.deckSeed32,
    'DROP',
    {
      dropTierWeights: [7800, 1700, 450, 50],
      weightedOutcomeWeights: [5000, 2200, 1200, 700, 450, 250, 150, 50],
      eventTriggerBps: 3500,
      modifierActivationBps: [500, 800, 1200, 1500, 700, 600, 200, 100],
    },
  );

  return { cardShuffle, deck, dropReq, routed };
}

// Type utilities so app code can keep shared signatures.
export type RandomnessType = SnapVrfRandomnessType;
export type Namespace = SnapVrfNamespace;


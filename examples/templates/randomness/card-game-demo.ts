import {
  createManagedDemoRandomnessClient,
  makeDemoSigner,
  makeGameId,
  makeMatchId,
  makeSeed,
} from './shared.js';

/**
 * Card game template:
 * - requests CARD randomness
 * - fulfills and consumes
 * - derives deterministic deck order
 */
export async function runCardGameDemo() {
  const randomness = createManagedDemoRandomnessClient({
    signer: makeDemoSigner(),
    snapVrfProgramId: process.env.SNAP_VRF_PROGRAM_ID ?? '6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA',
    magicBlockVrfProgramId: process.env.MAGICBLOCK_VRF_PROGRAM_ID ?? '6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA',
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    magicblockRpcUrl: process.env.MAGICBLOCK_RPC_URL ?? 'http://127.0.0.1:8899',
  });
  const matchId = makeMatchId('poker-table-001');
  const gameId = makeGameId('poker');

  const cardRequest = await randomness.card_shuffle({
    matchId,
    gameId,
    requestId: 1n,
    requestNonce: 10001n,
  });

  // In production, these come from your VRF callback service.
  const vrfSeed32 = makeSeed('card-seed');
  const vrfOutput32 = makeSeed('card-output');

  await randomness.fulfill_randomness({
    matchId,
    requestId: 1n,
    vrfSeed32,
    vrfOutput32,
  });

  await randomness.consume_randomness({
    matchId,
    requestId: 1n,
    namespace: 'CARD',
    gameId,
  });

  const deckOrder = randomness.adapter.deterministicDeckOrder(cardRequest.deckSeed32, 52);
  return {
    requestPda: cardRequest.requestPda.toBase58(),
    deckSeedHex: Buffer.from(cardRequest.deckSeed32).toString('hex'),
    firstTenCards: deckOrder.slice(0, 10),
  };
}

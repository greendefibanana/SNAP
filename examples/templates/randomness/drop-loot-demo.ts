import {
  createManagedDemoRandomnessClient,
  makeDemoSigner,
  makeGameId,
  makeMatchId,
  makeSeed,
} from './shared.js';

/**
 * Drop/loot template:
 * - requests DROP randomness
 * - fulfills and consumes
 * - routes deterministic drop outcome
 */
export async function runDropLootDemo() {
  const randomness = createManagedDemoRandomnessClient({
    signer: makeDemoSigner(),
    snapVrfProgramId: process.env.SNAP_VRF_PROGRAM_ID ?? '6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA',
    magicBlockVrfProgramId: process.env.MAGICBLOCK_VRF_PROGRAM_ID ?? '6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA',
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    magicblockRpcUrl: process.env.MAGICBLOCK_RPC_URL ?? 'http://127.0.0.1:8899',
  });

  const matchId = makeMatchId('arena-24');
  const gameId = makeGameId('arena-shooter');

  const request = await randomness.drop_randomness({
    matchId,
    gameId,
    requestId: 2n,
    requestNonce: 20001n,
  });

  await randomness.fulfill_randomness({
    matchId,
    requestId: 2n,
    vrfSeed32: makeSeed('drop-seed'),
    vrfOutput32: makeSeed('drop-output'),
  });

  await randomness.consume_randomness({
    matchId,
    requestId: 2n,
    namespace: 'DROP',
    gameId,
  });

  // Example game-specific routing config.
  const routed = randomness.adapter.routeRandomEvent(makeSeed('drop-output'), 'DROP', {
    dropTierWeights: [7800, 1700, 450, 50],
    weightedOutcomeWeights: [5000, 2200, 1200, 700, 450, 250, 150, 50],
    eventTriggerBps: 3200,
    modifierActivationBps: [500, 600, 700, 800, 400, 300, 200, 100],
  });

  return {
    requestPda: request.requestPda.toBase58(),
    tier: routed.tier,
    weightedOutcomeIndex: routed.weightedOutcomeIndex,
    eventTriggered: routed.eventTriggered,
    modifierMask: routed.modifierMask,
  };
}


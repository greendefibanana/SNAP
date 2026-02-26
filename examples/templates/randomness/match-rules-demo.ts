import {
  createManagedDemoRandomnessClient,
  makeDemoSigner,
  makeGameId,
  makeMatchId,
  makeSeed,
} from './shared.js';

/**
 * Match-rule template:
 * - requests MATCH_SEED randomness through MATCH_RULE namespace
 * - fulfills and consumes
 * - interprets modifier bitmask as match rule toggles
 */
export async function runMatchRulesDemo() {
  const randomness = createManagedDemoRandomnessClient({
    signer: makeDemoSigner(),
    snapVrfProgramId: process.env.SNAP_VRF_PROGRAM_ID ?? '6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA',
    magicBlockVrfProgramId: process.env.MAGICBLOCK_VRF_PROGRAM_ID ?? '6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA',
    solanaRpcUrl: process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com',
    magicblockRpcUrl: process.env.MAGICBLOCK_RPC_URL ?? 'http://127.0.0.1:8899',
  });

  const matchId = makeMatchId('ranked-9001');
  const gameId = makeGameId('tactics-arena');

  const request = await randomness.matchmaking_seed({
    matchId,
    gameId,
    requestId: 3n,
    requestNonce: 30001n,
  });

  const vrfOutput = makeSeed('match-rule-output');

  await randomness.fulfill_randomness({
    matchId,
    requestId: 3n,
    vrfSeed32: makeSeed('match-rule-seed'),
    vrfOutput32: vrfOutput,
  });

  await randomness.consume_randomness({
    matchId,
    requestId: 3n,
    namespace: 'MATCH_RULE',
    gameId,
  });

  const routed = randomness.adapter.routeRandomEvent(vrfOutput, 'MATCH_RULE', {
    dropTierWeights: [2500, 2500, 2500, 2500],
    weightedOutcomeWeights: [1300, 1300, 1300, 1300, 1200, 1100, 900, 600],
    eventTriggerBps: 10_000,
    modifierActivationBps: [1200, 900, 700, 500, 400, 250, 150, 80],
  });

  const modifiers = {
    doubleDamage: Boolean(routed.modifierMask & (1 << 0)),
    fogMap: Boolean(routed.modifierMask & (1 << 1)),
    speedBoost: Boolean(routed.modifierMask & (1 << 2)),
  };

  return {
    requestPda: request.requestPda.toBase58(),
    modifierMask: routed.modifierMask,
    modifiers,
  };
}


import { Keypair } from '@solana/web3.js';
import {
  createSnapProvenanceClient,
} from '../src/adapters/snapProvenanceClient.js';
import type { SnapAuthoritySigner } from '../src/adapters/magicblock/types.js';

function random32(): Uint8Array {
  return Keypair.generate().publicKey.toBytes();
}

async function main(): Promise<void> {
  const signerKeypair = Keypair.generate();
  const signer: SnapAuthoritySigner = {
    publicKey: signerKeypair.publicKey,
    async signTransaction(tx) {
      tx.partialSign(signerKeypair);
      return tx;
    },
  };

  const client = createSnapProvenanceClient({
    programId: '9sprEpyqwvhJxgMdANYVCLbkj1ygoag1zUzkUKAdcped',
    signer,
    rpcUrl: 'https://api.devnet.solana.com',
  });

  // Initialize once per deployment.
  await client.initializeRegistry();

  // Allow a backend signer to report provenance on behalf of players.
  await client.setTrustedSigner(signer.publicKey, true);

  // Record one ended match into global + per-game CV and immutable match provenance.
  await client.recordMatchProvenance({
    player: signer.publicKey,
    gameId: random32(),
    matchId: random32(),
    finalStateHash: random32(),
    logHash: random32(),
    provenanceHash: random32(),
    kills: 24,
    deaths: 8,
    assists: 11,
    score: 3200,
    won: true,
    metadataUri: 'ipfs://<snap-match-summary-cid>',
  });

  const cv = await client.getPlayerCv(signer.publicKey);
  console.log('CV totals', {
    gamesPlayed: cv.gamesPlayed.toString(),
    wins: cv.wins.toString(),
    kills: cv.kills.toString(),
    score: cv.score.toString(),
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

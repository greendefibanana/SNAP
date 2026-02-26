import { createMagicBlockMultiplayerAuthorityClient } from '../src/adapters/magicblock/multiplayerAuthorityClient.js';
import type { SnapAuthoritySigner } from '../src/adapters/magicblock/types.js';

function text32(input: string): Uint8Array {
  const out = new Uint8Array(32);
  const bytes = new TextEncoder().encode(input);
  out.set(bytes.slice(0, 32));
  return out;
}

export async function runMultiplayerAuthorityExample(signer: SnapAuthoritySigner): Promise<void> {
  const client = createMagicBlockMultiplayerAuthorityClient({
    backend: 'magicblock',
    programId: 'DiTw7JwsHqrNZSfHhPDxLAfzKWoCcqpo1Pk4y2toABfK',
    signer,
  });

  const matchId = text32('demo-match-001');
  const gameId = text32('turn-based-generic');

  await client.createMatch({
    matchId,
    gameId,
    minPlayers: 2,
    maxPlayers: 4,
    turnMode: 'ROUND_BASED',
    maxStateBytes: 1024,
    initialState: new Uint8Array([1, 0, 0]),
  });

  await client.joinMatch(matchId);
  await client.startMatch(matchId);

  await client.submitAction({
    matchId,
    actionType: 1,
    payload: new Uint8Array([7, 8, 9]),
    expectedStateVersion: 0n,
  });
}

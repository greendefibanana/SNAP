# SNAP 15-Minute Quickstart For Web2 Teams

This is the fastest path to run multiplayer authority on-chain with SNAP, without learning Web3 internals first.

## Goal

Ship a deterministic turn-based game loop using one API:
- `createMatch`
- `joinMatch`
- `startMatch`
- `submitAction`
- `subscribeToMatch`

You can use plain Solana RPC first, then enable MagicBlock later without changing game logic code.

## 1) Install + Import

```ts
import { createSnapMultiplayerClient } from '@snapshot/snap';
```

## 2) Create Client (Simple Mode)

```ts
const client = createSnapMultiplayerClient({
  programId: 'DiTw7JwsHqrNZSfHhPDxLAfzKWoCcqpo1Pk4y2toABfK',
  signer, // wallet/signer adapter used by your app
  rpcUrl: 'https://api.devnet.solana.com',
});
```

That is enough to start.

## 3) Create + Start A Match

```ts
const matchId = new Uint8Array(32); // your generated id bytes
const gameId = new Uint8Array(32);  // your game id bytes
const initialState = new Uint8Array([1, 0, 0]); // your serialized initial game state

await client.createMatch({
  matchId,
  gameId,
  minPlayers: 2,
  maxPlayers: 6,
  turnMode: 'ROUND_BASED',
  maxStateBytes: 2048,
  initialState,
  pluginProgram, // your game rules plugin program id
});

await client.joinMatch(matchId);
await client.startMatch(matchId);
```

## 4) Submit Player Actions

```ts
const state = await client.getMatch(matchId);

await client.submitAction({
  matchId,
  actionType: 1,                   // game-defined
  payload: encodedActionPayload,   // game-defined bytes
  expectedStateVersion: state.stateVersion,
  pluginProgram,
  pluginTransition,
});
```

## 5) Subscribe For Live UI Updates

```ts
const sub = await client.subscribeToMatch(matchId, (next) => {
  // decode next.gameState and render
  console.log('stateVersion', next.stateVersion.toString());
});

// later:
sub.unsubscribe();
```

## 6) Turn On MagicBlock Later (Optional)

No API rewrite required.

```ts
const client = createSnapMultiplayerClient({
  programId: 'DiTw7JwsHqrNZSfHhPDxLAfzKWoCcqpo1Pk4y2toABfK',
  signer,
  rpcUrl: 'https://api.devnet.solana.com',
  useMagicBlock: true,
  magicblockRpcUrl: 'http://127.0.0.1:8899',
});
```

## 7) What You Still Need To Provide

- A game plugin program with:
  - `validate_action(state, action)`
  - `apply_action(state, action)`
- Your state/action serialization format
- Frontend signer integration

### Pluginless Option (JS-Hosted)

If you want to avoid Rust plugin development, use `createSnapJsHostedMultiplayerClient(...)`.
It runs validation + state transition in JS and submits next-state bytes onchain.
This is useful for rapid iteration and Web2-first game teams.

Use a delegated/session signer when possible so players do not need wallet approval every action.

## 8) Web2 Mental Model Mapping

- Colyseus room create -> `createMatch`
- Colyseus room join -> `joinMatch`
- Server message handler -> `submitAction`
- Room broadcast/state patch -> `subscribeToMatch`

SNAP is the authority layer; your plugin is the game logic layer.

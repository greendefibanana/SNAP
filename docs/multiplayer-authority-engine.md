# SNAP Multiplayer Authority Engine

This module is a game-agnostic on-chain authority layer for deterministic multiplayer matches on Solana.

It is implemented as:
- Anchor program: `programs/snap-multiplayer-authority/`
- MagicBlock-aware TypeScript SDK: `src/adapters/magicblock/multiplayerAuthorityClient.ts`
- SNAP-first wrapper SDK: `src/adapters/snapMultiplayerClient.ts`
- Optional VRF integration: `record_randomness` with per-match or engine-level VRF authority

## Why This Replaces Traditional Backends (Colyseus-style) for Turn-Based Games

Traditional turn servers (for example Colyseus rooms) usually provide:
- Room lifecycle and participant admission
- Turn ownership and action gating
- Authoritative state transitions
- Event fanout to clients

SNAP Multiplayer Authority replaces those responsibilities with on-chain primitives:
- Room lifecycle -> `create_match`, `join_match`, `start_match`, `end_match`
- Turn ownership -> `active_turn_index` + `turn_mode` checks in `submit_action`
- Authoritative transitions -> deterministic state writes in `submit_action`
- Event fanout -> Solana logs/events + direct account subscriptions (`subscribeToMatch`)

Result: no centralized room server, no single operator trust assumption, and replayable/verifiable history from chain state.

## Core Requirements Coverage

1. Match Lifecycle
- `create_match(config)` creates a match PDA with config + initial state.
- `join_match()` enforces unique players and `max_players`.
- `start_match()` requires min player threshold; match locks on start.
- `end_match()` finalizes match.

2. Turn Authority
- `active_turn_index` stored in `MatchState`.
- `submit_action` enforces active actor for `RoundBased` mode.
- `TurnMode` supports:
  - `RoundBased`
  - `FreeTurn`

3. Action Execution Engine
- `submit_action(match_id, action_type, payload)` entrypoint.
- If plugin configured: engine invokes plugin `validate_action` and `apply_action` hooks via CPI.
- Engine verifies transition envelope (version/hash/size) and rejects invalid transitions.
- Emits `ActionSubmitted` with action index, hashes, state version, turn/round pointers.

4. Game State Storage
- `game_state: Vec<u8>` generic serialized blob.
- Engine enforces size/counter/turn integrity, not game-specific schema.
- Game developers define serialization format externally.

5. Optional Randomness Hook
- `record_randomness(randomness_root, randomness_nonce)` stores match randomness source.
- Supports per-match `vrf_module` or fallback engine default module.
- Derived deterministic random bytes emitted per action (`derived_randomness`).

6. MagicBlock ER Optimization
- SDK can route authority transactions to MagicBlock RPC (`backend: 'magicblock'`).
- Ephemeral Rollups reduce confirmation latency and improve turn responsiveness.
- Lower perceived interaction friction in rapid turn loops (especially with delegated/session signing).

7. TypeScript SDK Layer
- `createMatch()`
- `joinMatch()`
- `submitAction()`
- `subscribeToMatch()`
- Also includes `startMatch()`, `endMatch()`, `recordRandomness()`, `getMatch()`, `getEngine()`.
- Transport is direct Solana/MagicBlock RPC only; no centralized coordinator required.

8. Developer Plugin Interface
- On-chain adapter contract is explicit and game-agnostic:
  - `validate_action(state, action)`
  - `apply_action(state, action)`
- SDK exports `MultiplayerAuthorityPluginAdapter` for implementing these hooks consistently in external game logic tooling.
- Plugin output contract (`plugin_transition`) is deterministic and versioned.

## On-Chain Plugin Hook Envelope

Engine -> plugin CPI payload:
- Prefix: `SNAP_AUTH_PLUGIN_V1`
- Hook kind: `1=validate`, `2=apply`
- `action_type: u16`
- `payload_len: u32`
- `payload: [u8; payload_len]`
- `state_version: u64`
- `action_index: u64`
- `randomness_root: [u8;32]`
- `randomness_nonce: u64`

Plugin -> engine transition account payload:
- Magic: `SNAPTRN1`
- `next_state_version: u64`
- `next_state_hash: [u8;32]`
- `next_state_len: u16`
- `next_state: [u8; next_state_len]`

## Minimal SDK Usage

```ts
import { createSnapMultiplayerClient } from '@snapshot/snap';

const authority = createSnapMultiplayerClient({
  programId: 'DiTw7JwsHqrNZSfHhPDxLAfzKWoCcqpo1Pk4y2toABfK',
  signer,
  rpcUrl: 'https://api.devnet.solana.com',
  // Optional transport acceleration:
  // useMagicBlock: true,
  // magicblockRpcUrl: 'http://127.0.0.1:8899',
});

await authority.createMatch({
  matchId,            // Uint8Array(32)
  gameId,             // Uint8Array(32)
  minPlayers: 2,
  maxPlayers: 4,
  turnMode: 'ROUND_BASED',
  maxStateBytes: 1024,
  initialState,       // Uint8Array
  pluginProgram,      // optional game rules program
});

await authority.joinMatch(matchId);
await authority.startMatch(matchId);

await authority.submitAction({
  matchId,
  actionType: 1,
  payload: actionPayload,
  expectedStateVersion: 0n,
  pluginProgram,
  pluginTransition,
});

const sub = await authority.subscribeToMatch(matchId, (next) => {
  console.log(next.stateVersion, next.activeTurnIndex);
});
```

## Zero-Friction Mode For Non-Web3 Teams

- Use `createSnapMultiplayerClient(...)` and ignore MagicBlock internals.
- Build gameplay first on standard Solana RPC.
- Enable `useMagicBlock` later for lower latency and better UX.
- No plugin/game-logic rewrite is needed when toggling transport.

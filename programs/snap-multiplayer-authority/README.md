# snap-multiplayer-authority

Game-agnostic Anchor authority engine for deterministic, turn-based multiplayer.

## Scope
- Match lifecycle (`create_match`, `join_match`, `start_match`, `end_match`)
- Turn authority (`active_turn_index`, round-based and free-turn modes)
- Deterministic action pipeline (`submit_action`)
- Generic serialized `game_state` blob storage
- Optional VRF hook (`record_randomness`)
- External game-logic plugin interface via CPI
- TypeScript SDK for Solana + MagicBlock transport (`createMatch`, `joinMatch`, `submitAction`, `subscribeToMatch`)

## Instructions
- `initialize_engine(default_vrf_module)`
- `set_engine_admin(new_admin)`
- `set_engine_pause(paused)`
- `create_match(args)`
- `join_match()`
- `start_match()`
- `end_match()`
- `submit_action(args)`
- `record_randomness(randomness_root, randomness_nonce)`

## Plugin Interface (Game Logic Adapter)
This engine does not embed game rules. Games plug in a separate Solana program that supports two hooks:

- `validate_action(state, action)`
- `apply_action(state, action)`

The engine calls these hooks via CPI with a shared binary envelope:

- Prefix: `SNAP_AUTH_PLUGIN_V1`
- Hook kind: `1` validate, `2` apply
- `action_type: u16`
- `payload_len: u32`
- `payload: [u8; payload_len]`
- `state_version: u64`
- `action_index: u64`
- `randomness_root: [u8;32]`
- `randomness_nonce: u64`

The plugin must write its transition result into a plugin-owned account (`plugin_transition`) using:

- Magic: `SNAPTRN1` (8 bytes)
- `next_state_version: u64`
- `next_state_hash: [u8;32]`
- `next_state_len: u16`
- `next_state: [u8; next_state_len]`

Engine checks version/hash/size before committing the new match state.

## Important
- Replace `declare_id!` with deployed program id.
- For production, always configure `plugin_program` to enforce rules on-chain.
- `record_randomness` accepts authority from per-match `vrf_module`, falling back to engine default.

## TypeScript SDK

SDK location:
- `src/adapters/magicblock/multiplayerAuthorityClient.ts`

Factory:
- `createMagicBlockMultiplayerAuthorityClient(config)`

Primary methods:
- `createMatch()`
- `joinMatch()`
- `startMatch()`
- `endMatch()`
- `submitAction()`
- `subscribeToMatch()`
- `recordRandomness()`

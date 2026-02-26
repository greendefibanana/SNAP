# snap-vrf-engine

Reusable Anchor program for verifiable randomness in SNAP.

## Scope
- Non-game-specific randomness primitives
- Multi-request lifecycle per match
- Deterministic routing from VRF output
- Configurable weighted logic per game + namespace

## Instructions
- `initialize_engine(vrf_authority, min_request_confirmations)`
- `set_engine_admin(new_admin)`
- `set_vrf_authority(new_vrf_authority)`
- `set_engine_pause(paused)`
- `initialize_match(match_id, game_id)`
- `set_namespace_config(game_id, namespace, drop_tier_weights, weighted_outcome_weights, event_trigger_bps, modifier_activation_bps)`
- `request_randomness(request_id, randomness_type, namespace, request_nonce, metadata)`
- `record_external_request_id(external_request_id)`
- `fulfill_randomness(vrf_seed, vrf_output)`
- `consume_randomness()`
- `derive_random_value(seed, namespace, salt)`

## Namespaces
- `DROP`
- `MATCH_RULE`
- `LOOT`
- `CARD`
- `ARENA_EVENT`

## Important
- Replace `declare_id!` with your deployed program id before deployment.
- Configure `vrf_authority` as your MagicBlock VRF callback signer/relay authority.
- Minimal IDL for TS codec integration lives at `idl/snap_vrf_engine.min.json`.

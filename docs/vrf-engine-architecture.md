# SNAP Verifiable Randomness Engine (Anchor + MagicBlock VRF)

## Goal
This module turns randomness from a trust assumption into a verifiable, replayable, deterministic subsystem for SNAP.

It is designed as reusable infrastructure, not a game ruleset. There is no blackjack or game-specific logic in the program.

## What This Module Solves

1. Random Event Module
- Uses VRF output to drive:
  - drop spawn timing triggers
  - drop tier distribution (`Common`, `Rare`, `Epic`, `Legendary`)
  - generic weighted outcomes
- Every outcome is deterministic from the same VRF seed + namespace.
- Weights are configurable per game and per namespace through on-chain `NamespaceConfig`.

2. Matchmaking Seed Module
- Supports `RandomnessType::MatchSeed` to lock a match-level seed.
- First fulfilled match-seed request permanently locks `match_seed` on `MatchRandomness`.
- Immutable seed enables deterministic rule modifiers (double damage, fog, speed boost, etc.).

3. Generic Randomness Interface
- On-chain interface mirrors requested API shape:
  - `request_randomness(match_id, randomness_type)` -> instruction `request_randomness`
  - `consume_randomness(request_id)` -> instruction `consume_randomness`
  - `derive_random_value(seed, namespace)` -> instruction `derive_random_value`
- Namespace support:
  - `DROP`
  - `MATCH_RULE`
  - `LOOT`
  - `CARD`
  - `ARENA_EVENT`

4. Randomness Router
- Deterministic route function converts one VRF output into:
  - tier selection
  - weighted outcome index
  - random event trigger boolean
  - modifier bitmask
- Router is pure and verifiable (`route_from_vrf_output`).

5. Multi-request Handling
- Multiple requests per match are supported via monotonic `request_id`.
- Metadata is persisted in `RandomnessRequest`:
  - requester
  - nonce
  - timestamps and slots
  - external VRF request id
  - seed + output + status lifecycle

## Program Layout

Path: `programs/snap-vrf-engine/src/lib.rs`

Core accounts:
- `VrfEngine`
  - global authority, pause flag, VRF authority
- `MatchRandomness`
  - per-match state, immutable `match_seed`, request counter
- `RandomnessRequest`
  - per-request lifecycle and metadata
- `NamespaceConfig`
  - per-game + per-namespace weights and trigger settings

Core instruction flow:
1. `initialize_engine`
2. `initialize_match`
3. `set_namespace_config`
4. `request_randomness`
5. off-chain VRF adapter requests MagicBlock VRF and stores `external_request_id` via `record_external_request_id`
6. authorized VRF authority calls `fulfill_randomness`
7. consumer calls `consume_randomness` for deterministic routed outcomes

## Determinism and Verifiability Model

Determinism is guaranteed by domain-separated hashing:
- `hash("SNAP_VRF_ENGINE_V1", seed, namespace, label)`

The router derives independent random streams from a single VRF output:
- `TIER`
- `WEIGHTED`
- `TRIGGER`
- `MODIFIERS`
- `OUTCOME`

Because each stream is deterministically derived with explicit labels, client/server/indexer can recompute outcomes exactly.

## Random Event Module Design

Drop timing and event triggers:
- `event_trigger_bps` in `NamespaceConfig` controls trigger probability.
- Deterministic boolean:
  - `event_triggered = derive(seed, "TRIGGER") % 10000 < event_trigger_bps`

Drop tiers:
- Weighted by `drop_tier_weights: [u16; 4]`
- Mapping:
  - index 0 -> `Common`
  - index 1 -> `Rare`
  - index 2 -> `Epic`
  - index 3 -> `Legendary`

Game-defined weighted outcomes:
- `weighted_outcome_weights: [u16; 8]`
- Returned as `weighted_outcome_index`

## Match Rule Modifier Design

Modifier activation mask:
- `modifier_activation_bps: [u16; 8]`
- For each modifier slot `i`, derive step entropy and compare to configured BPS.
- Emits `modifier_mask` as `u16` bitset.

Example interpretation (off-chain in game backend):
- bit 0 = double damage
- bit 1 = fog map
- bit 2 = speed boost
- etc.

The chain does not encode game-specific semantics. It only returns deterministic activation bits.

## MagicBlock VRF Integration Pattern

This module intentionally keeps VRF provider coupling minimal:
- On-chain:
  - stores `external_request_id` bytes
  - only accepts fulfillments from configured `vrf_authority`
- Off-chain adapter:
  - sends VRF request to MagicBlock VRF
  - maps provider request id -> `RandomnessRequest`
  - posts callback fulfillment transaction

This avoids hardcoding provider wire format while preserving full verifiability.

## Web2 Plug-in Model

Any Web2 game can integrate with a thin backend service:

1. Create or locate `match_id`.
2. Call `request_randomness`.
3. Backend requests MagicBlock VRF.
4. Backend writes `external_request_id`.
5. VRF callback submits `fulfill_randomness`.
6. Game server (or relayer) calls `consume_randomness`.
7. Both game server and clients verify outputs by recomputing router from on-chain `vrf_output`.

Why this works for Web2:
- no custom cryptography required in game client
- on-chain source of truth for seed/output/status
- deterministic replay for audits, anti-cheat, and dispute resolution

## Typescript Integration Example

See:
- `examples/vrf-engine-client.ts` (Anchor client + deterministic local verification)

The example shows:
- request flow
- external request id recording
- fulfillment
- consumption
- local deterministic verification function mirroring on-chain derivation

## Recommended Production Extensions

1. Add explicit CPI adapter crate for MagicBlock VRF program ids and instruction codecs.
2. Add replay-protection and fulfillment proof checks if provider format allows on-chain proof verification.
3. Add per-request confirmation window based on `min_request_confirmations`.
4. Add indexer or webhook service that publishes routed outcomes to game backend in real time.

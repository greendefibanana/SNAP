# MagicBlock VRF Modules for SNAP

This integration layer makes SNAP a verifiable randomness toolkit for any game, not just a competitive authority runtime.

## What Was Added

Adapter entry points:
- `src/adapters/magicblock/vrfTypes.ts`
- `src/adapters/magicblock/vrfClientAdapter.ts`
- `src/adapters/magicblock/vrfAnchorCodecs.ts`

Exports:
- `src/adapters/magicblock/index.ts`

## Modular VRF Components

1. Card Shuffle Module
- `requestCardShuffle(...)` requests `CARD` randomness through SNAP VRF engine.
- `deterministicDeckOrder(deckSeed32, deckSize)` creates deterministic shuffle order.
- No player/server can precompute outcomes before VRF fulfillment.

2. Random Event Module
- `requestDropRandomness(...)` requests `DROP` randomness.
- `routeRandomEvent(seed32, namespace, weights)` maps entropy into:
  - drop tier (Common/Rare/Epic/Legendary)
  - weighted outcome index
  - event trigger boolean
  - modifier mask

3. Matchmaking Seed Module
- `requestMatchmakingSeed(...)` requests `MATCH_SEED` with `MATCH_RULE` namespace.
- Match-level seed can be locked on-chain by the VRF engine and reused for rule modifiers.

4. On-Chain Chance Mechanics
- `requestGenericChance(...)` supports namespace-based randomness for any mechanic:
  - `DROP`
  - `MATCH_RULE`
  - `LOOT`
  - `CARD`
  - `ARENA_EVENT`

## Zero-Friction Integration Pattern

`MagicBlockVrfClientAdapter` owns:
- PDA derivation for engine/match/request accounts
- request -> MagicBlock VRF -> record external request id flow
- fulfill and consume transactions

To avoid forcing one serialization format, the adapter accepts two codec interfaces:
- `SnapVrfInstructionCodec`: encode SNAP VRF program instructions
- `MagicBlockVrfInstructionCodec`: encode MagicBlock VRF request instruction and optional request-id resolver

This keeps game logic stable while you swap provider-specific codecs.

## Exact IDL Codecs (Anchor Byte-Accurate)

Use:
- `createSnapVrfInstructionCodecFromIdl(...)`
- `createMagicBlockVrfInstructionCodecFromIdl(...)`

These factories encode instruction data using:
- Anchor 8-byte instruction discriminators from IDL
- Borsh serialization for args (u64, arrays, enums, structs, options, vectors)
- Account metas from IDL account definitions

Example:
- `examples/magicblock-vrf-idl-codec-example.ts`

Important:
- This repo does not include your production MagicBlock VRF IDL.
- Plug in your actual IDL JSON and account mapping in `accountResolver` + `argResolver`.
- A minimal SNAP VRF IDL is included at `programs/snap-vrf-engine/idl/snap_vrf_engine.min.json`.

## Web2 Backend Pattern

Any Web2 game backend can use this flow:

1. Game server asks for randomness (`card`, `drop`, `match rule`, etc.).
2. Relayer calls `requestRandomness`.
3. Relayer calls MagicBlock VRF through `buildVrfRequestIx`.
4. Relayer records provider request id on-chain (`recordExternalRequestId`).
5. Callback worker fulfills (`fulfillRandomness`) when randomness arrives.
6. Game server consumes (`consumeRandomness`) and applies deterministic outcome.

Result:
- fairness is verifiable from on-chain state
- randomness lifecycle is auditable
- same infrastructure works across multiple game genres

## Why This Is Bigger Than Match Authority

With this adapter + SNAP VRF engine:
- card games get verifiable shuffle and draw entropy
- shooters and MOBAs get fair drops/events and rule modifiers
- any Web2 title can externalize chance mechanics into an immutable, replayable ledger

SNAP becomes a reusable verifiable game logic substrate, not only a score/authority system.

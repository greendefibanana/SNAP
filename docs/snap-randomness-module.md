# SNAP Randomness Module (Managed MagicBlock + Provider-Agnostic Core)

## Purpose

This module makes randomness feel native to SNAP so game developers do not have to learn MagicBlock internals to ship fair on-chain chance mechanics.

Game devs call SNAP APIs.
SNAP handles VRF orchestration under the hood.

## Core Design

SNAP now exposes a high-level client:
- `createSnapRandomnessClient(...)`

Path:
- `src/adapters/snapRandomnessClient.ts`

It supports two modes:

1. `managed_magicblock` (default for low friction)
- Uses a built-in preset codec pipeline.
- Game team only provides signer + program ids + rpc urls.
- No per-game VRF instruction coding required.

2. `custom` (advanced teams)
- Teams can inject their own provider adapter/codec stack.
- Keeps SNAP provider-agnostic long term.

## Why This Removes Friction

Without this layer, every game team must:
- map PDAs/accounts
- encode VRF provider instructions
- map provider request ids
- maintain callback/fulfillment wiring

With this layer, teams call:
- `request_randomness(...)`
- `consume_randomness(...)`
- `fulfill_randomness(...)`
- module helpers:
  - `card_shuffle(...)`
  - `drop_randomness(...)`
  - `matchmaking_seed(...)`
  - `generic_randomness(...)`

## Managed MagicBlock Preset

Preset:
- `generic_v1`

Behavior:
- Uses built-in SNAP VRF IDL defaults for the SNAP side.
- Uses a generic MagicBlock request schema:
  - instruction: `request_randomness`
  - accounts: `authority`, `request`
  - args: `request_id`, `request_nonce`, `namespace`

If a team uses a different MagicBlock VRF schema, they can pass `magicBlockVrfIdl` (or use `custom` mode).

## Architecture Stack

1. High-level API
- `src/adapters/snapRandomnessClient.ts`

2. Provider orchestration
- `src/adapters/magicblock/vrfClientAdapter.ts`

3. IDL-based byte-accurate encoding
- `src/adapters/magicblock/vrfAnchorCodecs.ts`

4. Shared types
- `src/adapters/magicblock/vrfTypes.ts`

## Example (Managed Mode)

```ts
import { createSnapRandomnessClient } from '@snapshot/snap';

const randomness = createSnapRandomnessClient({
  mode: 'managed_magicblock',
  preset: 'generic_v1',
  signer,
  snapVrfProgramId: '6MNEnDDewn4VG2TKhQwk16D6VkvpvJLDzNk1PC37jfoA',
  magicBlockVrfProgramId: '<MAGICBLOCK_VRF_PROGRAM_ID>',
  solanaRpcUrl: 'https://api.devnet.solana.com',
  magicblockRpcUrl: 'http://127.0.0.1:8899',
});

const card = await randomness.card_shuffle({
  matchId,
  gameId,
  requestId: 1n,
  requestNonce: 1001n,
});
```

## Demo Templates (Open-Source Onboarding)

Ready-to-adapt templates:

- `examples/templates/randomness/card-game-demo.ts`
- `examples/templates/randomness/drop-loot-demo.ts`
- `examples/templates/randomness/match-rules-demo.ts`
- `examples/templates/randomness/index.ts`

These are intentionally provider-hidden examples that call only SNAP randomness APIs.

## Open-Source Migration Story

For game developers migrating Web2 -> on-chain:

1. Keep existing gameplay systems.
2. Replace local RNG calls with SNAP randomness calls.
3. Use module namespace by feature:
- `CARD` for shuffle/draw
- `DROP` for spawn/tier rolls
- `MATCH_RULE` for rule modifiers
- `LOOT` / `ARENA_EVENT` for other chance logic

This turns SNAP into reusable verifiable game logic infrastructure instead of one game-specific stack.

## Production Recommendation

For production OSS releases:
- keep `managed_magicblock` as the onboarding default
- publish tested provider presets per MagicBlock VRF version
- keep `custom` mode for advanced ecosystems and future provider expansion

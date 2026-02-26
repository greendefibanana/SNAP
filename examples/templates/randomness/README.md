# SNAP Randomness Demo Templates

These templates show game-facing integration using only:

- `createSnapRandomnessClient(...)`

No game code needs to build provider-specific VRF instructions.

## Files

- `card-game-demo.ts`
  - Verifiable deck seed + deterministic shuffle order.
- `drop-loot-demo.ts`
  - Fair drop randomness + weighted routing.
- `match-rules-demo.ts`
  - Match seed randomness for rule modifiers.
- `shared.ts`
  - Shared helpers for match/game ids and managed client setup.

## Typical Flow

1. Build managed client once per backend service.
2. Request randomness for feature namespace.
3. Fulfill when VRF callback is available.
4. Consume on-chain result.
5. Apply deterministic result in game server.

## Runtime Inputs You Must Provide

- `SNAP_VRF_PROGRAM_ID`
- `MAGICBLOCK_VRF_PROGRAM_ID`
- signer implementation (`publicKey`, `signTransaction`)
- RPC endpoints for Solana and MagicBlock

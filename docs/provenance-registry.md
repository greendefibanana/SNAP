# SNAP Provenance Registry

`snap-provenance-registry` is a game-agnostic on-chain module for player reputation and match provenance.

Program path:
- `programs/snap-provenance-registry/`

TypeScript clients:
- `src/adapters/magicblock/provenanceRegistryClient.ts`
- `src/adapters/snapProvenanceClient.ts`

## Accounts

- `registry` (PDA: `["registry"]`)
  - Admin, pause flag, trusted reporter signers.
- `player_cv` (PDA: `["player_cv", registry, player]`)
  - Cross-game aggregate totals per player.
- `player_game_cv` (PDA: `["player_game_cv", registry, player, gameId]`)
  - Per-game aggregate totals per player.
- `match_provenance` (PDA: `["match_provenance", registry, player, gameId, matchId]`)
  - Immutable per-match provenance record.

## Trust Model

- Record writer (`reporter`) must be:
  - The player wallet itself, or
  - A trusted signer configured by registry admin.
- `match_provenance` is uniquely keyed by `(player, gameId, matchId)` to prevent duplicates.

## Record Payload

`record_match_provenance` stores:
- `final_state_hash`, `log_hash`, `provenance_hash`
- `kills`, `deaths`, `assists`, `score`, `won`
- optional `metadata_uri` (for IPFS/Arweave JSON)

Each record increments:
- Global `player_cv`
- Per-game `player_game_cv`

## Minimal Flow

1. `initializeRegistry()`
2. Optional: `setTrustedSigner(reporter, true)`
3. For each ended match: `recordMatchProvenance(...)`
4. Read CV data with `getPlayerCv(...)` / `getPlayerGameCv(...)`

# SNAP Game Dev Migration Playbook

This guide is for teams moving from Web2 multiplayer backends (Colyseus, custom Node servers, etc.) to SNAP's on-chain Multiplayer Authority Engine.

Use this when your game is deterministic and can run in turn-based or round-based authority mode.

## 1) What SNAP Replaces From Web2

Typical Web2 server responsibilities:
- Room lifecycle
- Player admission
- Turn authority
- Action validation
- State transitions
- Match event stream

SNAP replacement:
- Room lifecycle -> `create_match`, `join_match`, `start_match`, `end_match`
- Admission/limits -> `min_players`, `max_players`, lock after start
- Turn authority -> `turn_mode` + `active_turn_index` checks
- Validation/transition -> plugin hooks (`validate_action`, `apply_action`)
- Event stream -> on-chain events + account subscriptions (`subscribeToMatch`)
- Randomness -> optional VRF hook (`record_randomness`)

## 2) Migration Fit Checklist

Best fit:
- Deterministic rules
- Turn/round progression
- Compact state representation
- Can tolerate transaction confirmation latency

Not ideal:
- High-FPS real-time action loops
- Authoritative physics at 30-60 ticks/sec on L1 transactions

## 3) Universal Migration Architecture

For every game category:
1. Keep game rules in a plugin program, not in the engine.
2. Serialize game state to `game_state: Vec<u8>`.
3. Map each server command to `submit_action(action_type, payload)`.
4. Route txs through Solana or MagicBlock ER from client SDK.
5. Subscribe to match account changes for UI sync.

### SNAP-First (No MagicBlock Knowledge Required)

Use:
- `createSnapMultiplayerClient({ programId, signer, rpcUrl })`

Optional later:
- set `useMagicBlock: true` + `magicblockRpcUrl`

This keeps one stable API for game teams while allowing performance upgrades without rewriting game logic.

## 4) Plugin Contract (All Games)

Required hook model:
- `validate_action(state, action)` -> reject invalid actions
- `apply_action(state, action)` -> return deterministic next state

Engine-enforced guarantees:
- State version sequencing
- Turn ownership (round mode)
- Max state bytes
- Transition hash/version verification

## 5) Game Type Templates

All examples below follow this action envelope:
- `action_type: u16`
- `payload: bytes`
- deterministic state transition

### A) Turn-Based Tactics (XCOM-style)

Web2 commands:
- `MOVE_UNIT`
- `ATTACK_UNIT`
- `END_TURN`

On-chain mapping:
- `action_type 1 = MOVE_UNIT`
- `action_type 2 = ATTACK_UNIT`
- `action_type 3 = END_TURN`

State schema suggestion:
- board/grid
- unit stats
- initiative/turn pointer
- round counter

Plugin checks:
- actor owns unit
- movement range and LOS
- cooldown/resource constraints

### B) Card Games (Poker/TCG/Deck Builders)

Web2 commands:
- `START_HAND`
- `BET/CALL/RAISE/FOLD` or `PLAY_CARD`
- `SHOWDOWN/RESOLVE`

On-chain mapping:
- `action_type 10 = START_HAND`
- `action_type 11 = PLAYER_ACTION`
- `action_type 12 = RESOLVE_HAND`

State schema suggestion:
- table seats
- stacks/pot
- betting round
- board/private commitments
- hand status flags

VRF usage:
- derive deterministic shuffle seed
- deterministic deck order from seed + nonce

### C) Auto-Battlers

Web2 commands:
- `BUY_UNIT`, `SELL_UNIT`, `POSITION_UNIT`, `LOCK_SHOP`, `START_COMBAT`

On-chain mapping:
- `action_type 20..24`

State schema suggestion:
- roster/bench
- economy
- shop offers seed/index
- round number
- combat result snapshot

Plugin checks:
- econ and slot constraints
- deterministic combat sim from current state + seed

### D) Async Strategy (Civilization/PBEM-like)

Web2 commands:
- `SUBMIT_TURN`
- `RESOLVE_TURN_BATCH`

On-chain mapping:
- `action_type 30 = SUBMIT_TURN_FRAGMENT`
- `action_type 31 = FINALIZE_TURN`

State schema suggestion:
- map ownership
- units/cities/resources
- per-player submitted orders
- epoch/turn id

Mode:
- `ROUND_BASED` strongly recommended

### E) Chess/Checkers/Go

Web2 commands:
- `MAKE_MOVE`
- `RESIGN`
- `DRAW_OFFER/ACCEPT`

On-chain mapping:
- `action_type 40 = MAKE_MOVE`
- `action_type 41 = RESIGN`

State schema suggestion:
- board representation
- side to move
- repetition/ko/clock metadata

Plugin checks:
- legal move generation
- terminal result detection

### F) Word/Board/Social Turn Games

Web2 commands:
- `PLAY_WORD`, `PLACE_TILE`, `PASS`, `CHALLENGE`

On-chain mapping:
- `action_type 50..53`

State schema suggestion:
- board layout
- racks/hands
- bag/deck pointer
- scores and turn order

VRF usage:
- deterministic tile draw ordering

### G) Draft + Match Flows (CCG Draft, Pack Opening)

Web2 commands:
- `OPEN_PACK`, `PICK_CARD`, `LOCK_DECK`, `START_MATCH`

On-chain mapping:
- `action_type 60..63`

State schema suggestion:
- draft pool
- pick history
- deck lock flag
- phase enum

VRF usage:
- pack generation seed

### H) Turn-Based Roguelite Runs

Web2 commands:
- `CHOOSE_PATH`, `PLAY_ENCOUNTER_ACTION`, `CLAIM_REWARD`

On-chain mapping:
- `action_type 70..72`

State schema suggestion:
- run seed
- node graph progression
- inventory/status
- encounter state

VRF usage:
- deterministic encounter/loot generation from match randomness

## 6) Example Implementation Skeleton (Category-Agnostic)

### Step 1: Create Match

```ts
await authority.createMatch({
  matchId,                 // Uint8Array(32)
  gameId,                  // Uint8Array(32)
  minPlayers: 2,
  maxPlayers: 6,
  turnMode: 'ROUND_BASED',
  maxStateBytes: 2048,
  initialState,            // game-defined bytes
  pluginProgram,           // game plugin program id
});
```

### Step 2: Join/Start

```ts
await authority.joinMatch(matchId);
await authority.startMatch(matchId);
```

### Step 3: Submit Actions

```ts
const current = await authority.getMatch(matchId);
await authority.submitAction({
  matchId,
  actionType: 11,                  // game-defined
  payload: encodedActionPayload,    // game-defined
  expectedStateVersion: current.stateVersion,
  pluginProgram,
  pluginTransition,
});
```

### Step 4: Client Sync

```ts
const sub = await authority.subscribeToMatch(matchId, (state) => {
  renderFromStateBytes(state.gameState);
});
```

## 7) Colyseus-to-SNAP Mapping Table

- `Room.onCreate` -> `create_match`
- `Room.onJoin` -> `join_match`
- `Room.lock` -> auto lock on `start_match`
- `Room.onMessage(type, payload)` -> `submit_action(action_type, payload)`
- Server-side `state.applyPatch` -> plugin `apply_action` -> engine commit
- `broadcast` -> account change subscription + event logs
- `onLeave`/cleanup -> optional `end_match`

## 8) Latency/UX With MagicBlock ER

How to keep UX close to Web2:
- Send turn transactions to MagicBlock ER RPC
- Use delegated/session signing where possible
- Optimistically render pending local state, reconcile on confirmation
- Keep payloads compact and deterministic

## 9) Migration Phases

1. Extract deterministic reducer from current game server.
2. Define binary state + action payload schemas.
3. Implement plugin hooks (`validate_action`, `apply_action`).
4. Integrate SDK calls in frontend.
5. Run replay tests: Web2 transcript vs on-chain transcript hash equality.
6. Launch limited testnet matches per game mode.

## 10) Demo Checklist (Multi-Game Capability)

- One shared engine deployment.
- Multiple game plugins (tactics, poker/card, chess, roguelite, etc.).
- Separate `game_id` per game.
- Same client SDK surface for all games.
- Show deterministic replay from chain logs/state.

This demonstrates SNAP as a reusable, game-agnostic multiplayer authority substrate.

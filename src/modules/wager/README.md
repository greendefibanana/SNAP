# Wager Module

Generic wager lifecycle + settlement planning for SNAP rulesets.

## Integration Steps
1. Enable module in manifest: `modules.wager = true` and add `moduleConfig.wager`.
2. Dispatch wager actions (`WAGER_JOIN`, `WAGER_LOCK`, `WAGER_SET_RESULT`, `MATCH_END`) from your game flow.
3. Read settlement output from `state.modules.wager.settlement.payouts`.

## Required Manifest Config
```ts
moduleConfig: {
  wager: {
    currency: { kind: "SOL" | "SPL", mint?: string },
    entryAmount: number,           // smallest units
    maxParticipants: number,
    participationModel: "solo" | "ffa" | "teams" | "seats",
    teams?: { teamIds: string[]; teamSize?: number },
    seats?: { seatIds: string[] },
    lockPolicy: "immediate" | "manual_ready" | "time_lock",
    lockAtMs?: number,
    escrowModel: "offchain_stub" | "solana_escrow" | "magicblock_delegated",
    settlementModel: "winner_take_all" | "split_top_k" | "proportional" | "custom",
    winnerDetermination: "ruleset" | "score_counter" | "placement" | "threshold_activity",
    activityWin?: {
      type: "score_at_least" | "kills_at_least" | "level_at_least" | "time_under",
      counter?: string,
      threshold: number,
      timeLimitSec?: number
    },
    escalation?: {
      enabled: boolean,
      windows: Array<{ atSec: number; multiplier: number }>,
      requireAll?: boolean
    },
    antiAbuse?: {
      minDurationSec?: number,
      allowRejoin?: boolean,
      forfeitPenaltyBps?: number
    },
    splitTopK?: { topK: number; weightCurve?: number[] },
    scoreCounter?: { counter: string },
    rakeBps?: number,
    rakeRecipient?: string
  }
}
```

## Emitted / Required Actions
- `WAGER_JOIN { actorId, teamId?, seatId? }`
- `WAGER_LEAVE { actorId }`
- `WAGER_READY { actorId, ready: true }`
- `WAGER_LOCK {}`
- `WAGER_FORFEIT { actorId }`
- `WAGER_ESCALATE_REQUEST { actorId?|teamId?, windowIndex }`
- `WAGER_ESCALATE_CONFIRM { actorId?|teamId? }`
- `WAGER_SET_RESULT { result }`
- `MATCH_END` or `SNAP_END` finalizes settlement

## Example Manifests

### Single Player Threshold
```ts
{
  modules: { wager: true, scoring: true },
  moduleConfig: {
    wager: {
      currency: { kind: "SOL" },
      entryAmount: 1000,
      maxParticipants: 1,
      participationModel: "solo",
      lockPolicy: "immediate",
      escrowModel: "offchain_stub",
      settlementModel: "winner_take_all",
      winnerDetermination: "threshold_activity",
      activityWin: { type: "kills_at_least", counter: "kills", threshold: 5 }
    }
  }
}
```

### Team PvP
```ts
{
  modules: { wager: true, scoring: true },
  moduleConfig: {
    wager: {
      currency: { kind: "SOL" },
      entryAmount: 500,
      maxParticipants: 10,
      participationModel: "teams",
      teams: { teamIds: ["blue", "red"], teamSize: 5 },
      lockPolicy: "manual_ready",
      escrowModel: "offchain_stub",
      settlementModel: "winner_take_all",
      winnerDetermination: "score_counter",
      scoreCounter: { counter: "signal" }
    }
  }
}
```

### Blackjack Seats
```ts
{
  modules: { wager: true, scoring: true },
  moduleConfig: {
    wager: {
      currency: { kind: "SPL", mint: "USDC_MINT" },
      entryAmount: 100,
      maxParticipants: 3,
      participationModel: "seats",
      seats: { seatIds: ["seatA", "seatB", "seatC"] },
      lockPolicy: "immediate",
      escrowModel: "offchain_stub",
      settlementModel: "split_top_k",
      splitTopK: { topK: 2, weightCurve: [3, 1] },
      winnerDetermination: "ruleset"
    }
  }
}
```

## Security / Determinism Notes
- Integer-only math in smallest units; no floating-point settlement math.
- Payout tables are sorted by recipient for deterministic output.
- `custom` settlement validates totals equal distributable pot.
- Escrow backends (`solana_escrow`, `magicblock_delegated`) are currently stubs for future integration.

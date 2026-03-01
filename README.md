Hi team,

I just noticed I accidentally pasted the wrong Loom link in my submission. That's completely my fault.

Here's the correct demo video (it was recorded before the deadline):
https://www.loom.com/share/c98fbc257d7c43fc84e9ff546f4b396d

I've updated the GitHub README with the right link as well.

Sorry about the mix up, and thanks for taking the time to review it.

Best,
Eze

# SNAP

SNAP is a deterministic match authority runtime for Snapshot.
It is an open-source toolkit released under the MIT License.

It provides:
- A universal state/action model (`SnapState`, `SnapAction`, `SnapManifest`)
- A local deterministic engine + event log + state hash
- Pluggable modules (scoring, mutation, registry, stake, acquisitionPolicy, burn, wagerEscrow, tokenization, settlement, provenance)
- Pluggable rulesets (game logic)
- Client adapters:
  - `createLocalSnapClient(...)`
  - `createMagicBlockSnapClient(...)`

## Verifiable Randomness Engine (Anchor)

A reusable Solana Anchor module for verifiable randomness has been added at:
- `programs/snap-vrf-engine/`

Architecture and integration documentation:
- `docs/vrf-engine-architecture.md`

TypeScript integration example:
- `examples/vrf-engine-client.ts`
- `examples/magicblock-vrf-adapter-example.ts`
- `examples/magicblock-vrf-idl-codec-example.ts`
- `examples/templates/randomness/`

MagicBlock VRF adapter architecture:
- `docs/magicblock-vrf-integration.md`
- `docs/snap-randomness-module.md`

## Multiplayer Authority Engine (Anchor + MagicBlock)

A game-agnostic on-chain multiplayer authority engine is available at:
- `programs/snap-multiplayer-authority/`

Architecture + backend replacement notes:
- `docs/multiplayer-authority-engine.md`
- `docs/game-dev-migration-playbook.md`
- `docs/web2-team-quickstart.md`
- `docs/snap-game-dev-e2e-guide.md`
- `docs/devnet-contract-deploy.md`
- `docs/magicblock-er-devnet-settlement.md`

TypeScript SDK entrypoint:
- `createSnapMultiplayerClient(...)` (recommended)
- `createSnapGoldenClients(...)` (MagicBlock-first bundled clients for multiplayer + tokenization + optional VRF/provenance)
- `createMagicBlockMultiplayerAuthorityClient(...)`
- Example: `examples/multiplayer-authority-client.ts`

## Provenance Registry (Anchor + MagicBlock)

A game-agnostic on-chain provenance CV registry is available at:
- `programs/snap-provenance-registry/`

TypeScript SDK entrypoint:
- `createSnapProvenanceClient(...)` (recommended)
- `createMagicBlockProvenanceRegistryClient(...)`
- Architecture: `docs/provenance-registry.md`
- Example: `examples/provenance-registry-client.ts`

What it stores:
- Global player CV (`player_cv`) aggregated across all games.
- Per-game player CV (`player_game_cv`) for game-specific stats.
- Immutable per-match provenance record (`match_provenance`) keyed by `player + gameId + matchId`.

Example:

```ts
import { createSnapProvenanceClient } from '@snapshot/snap';

const provenance = createSnapProvenanceClient({
  programId: '9sprEpyqwvhJxgMdANYVCLbkj1ygoag1zUzkUKAdcped',
  signer,
  rpcUrl: 'https://api.devnet.solana.com',
});

await provenance.recordMatchProvenance({
  player: signer.publicKey,
  gameId,
  matchId,
  finalStateHash,
  logHash,
  provenanceHash: logHash,
  kills: 24,
  deaths: 8,
  assists: 11,
  score: 3200,
  won: true,
  metadataUri: 'ipfs://<summary-cid>',
});
```

## Layout

`src/engine/`
- Engine runtime and hashing

`src/modules/`
- Generic modules (no game-specific naming)

`src/rulesets/`
- `snapshot-hardpoint`
- `ctf-2d` (minimal portability ruleset)

`src/adapters/`
- Local and MagicBlock SnapClient adapters

## Core Concepts

`SnapManifest`
- Declares game/ruleset and module config/toggles

`SnapAction`
- Envelope for deterministic actions:
  - `matchId`, `actor`, `t`, `kind`, `payload`, optional `sig`

`SnapState`
- Engine state:
  - phase/seq/hash/ruleVars/modules/custom
- Ruleset-specific fields live in `state.custom.<namespace>`

## Modules

Builtin module factories are exported from `src/modules/index.ts`:
- `stake`
- `acquisitionPolicy`
- `registry`
- `scoring`
- `mutation`
- `burn`
- `wagerEscrow`
- `tokenization`
- `settlement`
- `provenance`

Typical usage:
- Rulesets write counters via scoring (`SCORE_ADD`)
- Rulesets apply timed modifiers via mutation (`MODIFIER_START` / `MODIFIER_END`)
- Rulesets can enable burn-to-use economics via burn (`BURN_USE`)
- Rulesets can support wager posting/lock/settlement flows via wagerEscrow
- Rulesets can tokenize any game asset via tokenization (`TOKEN_CLASS_DEFINE`, `TOKEN_MINT`, `TOKEN_TRANSFER`, `TOKEN_BURN`)
- Rulesets can declare acquisition rules (starter packs, kill rewards, purchase credits) via acquisitionPolicy

### Acquisition Policy Module

`acquisitionPolicy` is a declarative reward allocator for custom FT/NFT classes in `tokenization`.

Supported patterns:
- Starter pack claim: `ACQ_CLAIM_STARTER`
- Purchase credit grant: `ACQ_PURCHASE_CREDIT` (sku -> token rewards)
- Score thresholds (e.g. kills >= N): auto-grants on `SCORE_ADD`
- Action rewards (e.g. first reload, objective complete): auto-grants on matching action kinds
- Admin direct grants: `ACQ_GRANT` (optional, configurable)

Example config (FPS: free mags + kill rewards + store packs):

```ts
moduleConfig: {
  acquisitionPolicy: {
    starterPacks: [
      { id: 'starter-mags', classId: 'ammo.mag', amount: 10, maxClaimsPerActor: 1 },
    ],
    scoreRewards: [
      {
        id: 'kill-reward',
        counter: 'kills',
        threshold: 5,
        classId: 'ammo.mag',
        amount: 2,
        actorPath: 'payload.entityId',
        repeatable: true,
        maxClaimsPerActor: 100,
      },
    ],
    purchaseRewards: [
      { sku: 'mag_pack_small', classId: 'ammo.mag', amount: 15, maxClaimsPerActor: 999999 },
    ],
    actionRewards: [
      { id: 'daily-login', actionKind: 'DAILY_LOGIN', classId: 'ammo.mag', amount: 5, actorPath: 'actor', cooldownSec: 86400 },
    ],
    adminActors: ['game:backend'],
    allowDirectGrantAction: true,
  },
}
```

### Tokenization Module (2D/3D + MagicBlock Hints)

The `tokenization` module is chain-authority deterministic state for turning game assets into:
- NFTs (`tokenType: 'NFT'`)
- Fungible tokens (`tokenType: 'FT'`)

Class definitions support media metadata for both 2D and 3D assets:
- `media.kind`: `2d`, `3d`, or `any`
- `media.uri`, optional `previewUri`, `modelUri`, `animationUri`, `format`

It also supports optional execution hints to simplify MagicBlock ER routing in clients:
- `chain.backend`: `magicblock`, `solana`, or `any`
- `chain.useEphemeralRollup`: boolean
- `chain.priorityFeeLamports`, `chain.programId`, `chain.collectionAddress`

## Rulesets

### `snapshot-hardpoint`
- Zone countdown/active rotation
- Presence ownership/contested state
- Signal scoring while owned and uncontested
- Drop extraction -> mutation modifier flow

### `ctf-2d`
- `state.custom.ctf2d = { scoresByTeam, flagHeldBy?, timer }`
- Handles `FLAG_PICKUP`, `FLAG_CAPTURE`, `TICK`
- On capture, writes `ctf_score` via scoring module

## Run Sims

From repo root:

```bash
npm run sim --workspace=@snapshot/snap
```

This runs both rulesets and prints deterministic state snapshots and hashes.

## Client Adapters

### Local

```ts
import { createLocalSnapClient } from '@snapshot/snap';

const client = createLocalSnapClient(manifest);
await client.dispatch(action);
const state = await client.getState();
const stop = client.subscribe((s) => console.log(s.seq, s.stateHash));
```

### MagicBlock

```ts
import { createMagicBlockSnapClient } from '@snapshot/snap';

const client = createMagicBlockSnapClient({
  backend: 'magicblock',
  programId: 'DiTw7JwsHqrNZSfHhPDxLAfzKWoCcqpo1Pk4y2toABfK',
  signer, // web3 signer adapter
  magicblockRpcUrl: 'http://127.0.0.1:8899',
  solanaRpcUrl: 'https://api.devnet.solana.com',
  // Optional: auto-submit TOKEN_* actions and inject payload.txRef.
  tokenization: true,
});
```

### MagicBlock Tokenization Adapter

```ts
import { createMagicBlockTokenizationClientAdapter } from '@snapshot/snap';

const tokenization = createMagicBlockTokenizationClientAdapter({
  backend: 'magicblock',
  signer,
  magicblockRpcUrl: 'http://127.0.0.1:8899',
  solanaRpcUrl: 'https://api.devnet.solana.com',
  // Default mode is `spl`:
  // - TOKEN_CLASS_DEFINE => creates SPL mint account
  // - TOKEN_MINT / TOKEN_TRANSFER / TOKEN_BURN => sends SPL token instructions
  instructionMode: 'spl',
  nftMetadataMode: 'metaplex',
  defaultChainHint: {
    backend: 'magicblock',
    useEphemeralRollup: true,
  },
});

// Sends onchain tx and injects txRef(signature) into payload for SNAP modules.
const actionWithTx = await tokenization.dispatchAndAttachTxRef(tokenMintAction);
```

Notes:
- `TOKEN_METADATA_SET` remains memo-level unless you provide a custom `instructionBuilder`.
- For NFT class defines, set `nftMetadataMode: 'metaplex'` to auto-create a Metaplex metadata account from `payload.metadata`/`payload.media`.
- NFT classes in `spl` mode are handled as NFT-like SPL mints (`decimals=0`, supply `1`).
- Optional overrides: `metaplexTokenMetadataProgramId`, `splTokenProgramId`, `associatedTokenProgramId`.
- Set `instructionMode: 'memo'` to keep the previous transport-only behavior.

### JS-Hosted Multiplayer (No Rust Plugin Required)

If you do not want to write an on-chain plugin program, use JS-hosted mode:

```ts
import { createSnapJsHostedMultiplayerClient } from '@snapshot/snap';

const client = createSnapJsHostedMultiplayerClient({
  programId: 'DiTw7JwsHqrNZSfHhPDxLAfzKWoCcqpo1Pk4y2toABfK',
  signer, // can be a delegated/session signer for low-friction rapid actions
  useMagicBlock: true,
  magicblockRpcUrl: 'http://127.0.0.1:8899',
  codec: {
    decodeState: (bytes) => decodeGameState(bytes),
    encodeState: (state) => encodeGameState(state),
    encodeActionType: (action) => action.typeId,
  },
  plugin: {
    validateAction(state, action) {
      // optional
    },
    applyAction(state, action) {
      return reduceGameState(state, action);
    },
  },
});
```

How it works:
- state transitions run in JS (`validateAction`/`applyAction`)
- the resulting next state bytes are submitted onchain through SNAP authority
- with `useMagicBlock: true`, write txs route through MagicBlock ER for low latency

Quick migrated-games demo:

```bash
set SNAP_PROGRAM_ID=<SNAP_MULTIPLAYER_PROGRAM_ID>
set SNAP_SIGNER_KEYPAIR=C:\path\to\id.json
set MAGICBLOCK_RPC_URL=<MAGICBLOCK_RPC>
set SOLANA_RPC_URL=https://api.devnet.solana.com
npm run demo:migrated
```

This runs two pluginless migrated demos (`migrated-tactics`, `migrated-card`) against the same SNAP authority program.
`SNAP_AUTHORITY_BACKEND` defaults to `magicblock`; set it to `local` only if you want to disable ER routing.

## FT Ammo / Charges Pattern (Magazines, Potions, Energy)

Yes, SNAP supports this pattern directly:

1. Define a fungible token class for charges/ammo.
2. Mint balances to player wallets/accounts.
3. On reload/use, burn FT amount onchain (`TOKEN_BURN`).
4. Dispatch gameplay action only after burn succeeds.

Example flow:

```ts
await client.dispatch({
  matchId,
  actor: playerPubkey,
  t: Date.now(),
  kind: 'TOKEN_BURN',
  payload: {
    classId: 'ammo.mag',
    owner: playerPubkey,
    amount: 1,
    chain: { backend: 'magicblock', useEphemeralRollup: true },
  },
});

await client.dispatch({
  matchId,
  actor: playerPubkey,
  t: Date.now(),
  kind: 'RELOAD',
  payload: { weaponId: 'rifle.alpha' },
});
```

With MagicBlock session/delegation, players do not need to approve every mid-match burn manually; the delegated signer/session handles tx submission.

### Ruleset Guard Helper (Burn Before Action)

For shooter reloads, consumables, or ability charges, use `applyTokenBurnGuards(...)` in your ruleset:

```ts
import { applyTokenBurnGuards } from '@snapshot/snap';

const guardConfig = {
  requirements: [
    // Burn 1 FT ammo token before RELOAD.
    { actionKind: 'RELOAD', classId: 'ammo.mag', amount: 1 },
    // Burn 1 FT energy token before GRENADE_THROW.
    { actionKind: 'GRENADE_THROW', classId: 'energy.frag', amount: 1 },
  ],
};

function reduce(state: SnapState, action: SnapAction, manifest: SnapManifest): SnapState {
  state = applyTokenBurnGuards(state, action, guardConfig);
  // continue with your gameplay reducer...
  return state;
}
```

### FPS Setup: Wager Kills + FT Mags

1. Pre-match:
- `WAGER_POST` with single-player objective or multiplayer wager pool.
- Kill objective can be tracked via scoring counter (e.g. `kills`).

2. During match:
- Shooter emits `TOKEN_BURN` for `ammo.mag` on each reload.
- Ruleset gates `RELOAD` using `applyTokenBurnGuards`.

3. End of match:
- Resolve wager with `WAGER_SETTLE`.
- For single-player objective wager, set objective with comparator/target (for example, `kills >= 20`).

Notes:
- Adapter is transport/execution only.
- Rules logic stays in rulesets/modules, not in adapter code.

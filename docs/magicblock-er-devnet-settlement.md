# MagicBlock ER Devnet Settlement Runbook

This runbook is for grant-required flow:
- low-latency multiplayer authority execution on MagicBlock ER
- settlement/finality on Solana devnet

## 1) Deploy SNAP authority programs to Solana devnet

Follow [docs/devnet-contract-deploy.md](/C:/Users/ezevi/Documents/SNAP/SNAP/docs/devnet-contract-deploy.md) first to:
- generate keypairs
- set program IDs
- deploy `snap_multiplayer_authority` and optional `snap_vrf_engine`

You need the deployed `snap_multiplayer_authority` program ID for client config.

## 2) Start MagicBlock local/devnet validator endpoint

Use your MagicBlock environment (local ER validator or managed endpoint).

Local reference commands (from existing adapter notes):
- `mb-test-validator --reset`
- or `magicblock ephemeral-validator --ledger ./.mb-ledger --rpc-port 8899 --faucet-port 9900 --gossip-port 10001 --dynamic-port-range 10002-10012`

## 3) Configure environment

Set:
- `SNAP_AUTHORITY_BACKEND=magicblock`
- `MAGICBLOCK_RPC_URL=<your magicblock rpc>`
- `SOLANA_RPC_URL=https://api.devnet.solana.com`

Run:
- `npm run mb:er:doctor`

## 4) Route multiplayer authority txs to MagicBlock ER

Use SNAP wrapper:

```ts
import { createSnapMultiplayerClient } from '@snapshot/snap';

const authority = createSnapMultiplayerClient({
  programId: '<SNAP_MULTIPLAYER_PROGRAM_ID>',
  signer,
  rpcUrl: process.env.SOLANA_RPC_URL,
  useMagicBlock: true,
  magicblockRpcUrl: process.env.MAGICBLOCK_RPC_URL,
});
```

With `useMagicBlock: true`, write-path instructions (`createMatch`, `joinMatch`, `startMatch`, `submitAction`, `endMatch`, `recordRandomness`) are sent through MagicBlock RPC for low-latency UX.

## 5) Read state and prove settlement on Solana

`MatchState` and `MultiplayerEngine` are Solana program accounts. Settlement/finality is observable on Solana by:
- querying account state via Solana RPC
- checking confirmed transaction signatures against Solana explorers/RPC

Minimal verification checklist after action submission:
- `stateVersion` increments in `getMatch(matchId)`
- `actionCount` increments
- `updatedAtUnix` changes
- tx signature is retrievable from Solana RPC history for the authority program

## 6) Grant demo checklist

- Show same gameplay flow with `useMagicBlock: false` and `useMagicBlock: true`
- Capture action round-trip latency in both modes
- Show finalized state on Solana account for the same match PDA
- Document delegated/session signing setup for reduced per-action user friction

## Notes

- Game logic enforcement still depends on your plugin program (`plugin_program`) if you require strict on-chain rule validation.
- Without plugin enforcement, `submit_action` can still update state blob directly, which is not sufficient for most production game authority models.

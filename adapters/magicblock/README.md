# Snapshot MagicBlock Adapter (Skeleton)

This folder documents local MagicBlock setup and the adapter wiring added in `@snapshot/snap`.

## Local Validator

Per MagicBlock docs:

1. Install latest toolchain:
   - `curl https://sh.rustup.rs -sSf | sh`
   - `cargo install magicblock-cli --locked`
2. Start local validator:
   - `mb-test-validator --reset`
3. Optional ephemeral validator flow:
   - `magicblock ephemeral-validator --ledger ./.mb-ledger --rpc-port 8899 --faucet-port 9900 --gossip-port 10001 --dynamic-port-range 10002-10012`

Docs:
- https://docs.magicblock.gg/pages/get-started/install
- https://docs.magicblock.gg/pages/get-started/local-development

## Env Flags

Client wiring reads:

- `SNAP_AUTHORITY_BACKEND=local|magicblock`
- `MAGICBLOCK_RPC_URL=...`
- `SOLANA_RPC_URL=...`

For Vite client runtime, set these in `packages/client/.env` (or root `.env` if already loaded by your setup), for example:

```bash
SNAP_AUTHORITY_BACKEND=local
SOLANA_RPC_URL=https://api.devnet.solana.com
MAGICBLOCK_RPC_URL=http://127.0.0.1:8899
```

## Current Scope

- Includes transaction transport plus a default SPL token instruction path for `TOKEN_*` actions.
- Default tokenization mode is `spl` (real on-chain SPL mint/transfer/burn submission).
- Optional NFT metadata creation via Metaplex (`nftMetadataMode: 'metaplex'`).
- `memo` mode is still available for transport-only compatibility.
- `TOKEN_METADATA_SET` requires a custom instruction builder for non-memo execution.
- For rapid game loops, use delegated/session signers so users do not approve every action.

## Delegation Flow Scripts

The repo root now includes MagicBlock flow tasks for `snap_authority`:

- `npm run snap:mb:local`
- `npm run snap:mb:doctor`
- `npm run snap:mb:delegate`
- `npm run snap:mb:run`
- `npm run snap:mb:commit`
- `npm run snap:mb:undelegate`

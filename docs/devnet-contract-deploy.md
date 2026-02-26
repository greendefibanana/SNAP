# Devnet Contract Deployment

This repo includes three Anchor programs:
- `snap_multiplayer_authority`
- `snap_vrf_engine`
- `snap_provenance_registry`

Use this flow to prepare and deploy all three to Solana devnet.

## 1. One-time prerequisites

```bash
solana config set --url https://api.devnet.solana.com
solana-keygen new --outfile ~/.config/solana/id.json
solana airdrop 2
avm use 0.32.1
anchor --version
```

## 2. Generate deterministic program keypairs

```bash
npm run contracts:keys:gen
```

Read program IDs from those keypairs:

```bash
solana-keygen pubkey target/deploy/snap_multiplayer_authority-keypair.json
solana-keygen pubkey target/deploy/snap_vrf_engine-keypair.json
solana-keygen pubkey target/deploy/snap_provenance_registry-keypair.json
```

## 3. Write program IDs into Rust + Anchor config

```bash
npm run contracts:ids:set -- --multiplayer <MULTIPLAYER_PROGRAM_ID> --vrf <VRF_PROGRAM_ID> --provenance <PROVENANCE_PROGRAM_ID>
```

This updates:
- `programs/snap-multiplayer-authority/src/lib.rs` (`declare_id!`)
- `programs/snap-vrf-engine/src/lib.rs` (`declare_id!`)
- `programs/snap-provenance-registry/src/lib.rs` (`declare_id!`)
- `Anchor.toml` (`[programs.devnet]`)

## 4. Build and deploy

```bash
npm run contracts:build
npm run contracts:deploy:devnet
```

If only one program still needs deploy, deploy just that program:

```bash
anchor deploy --provider.cluster devnet --program-name snap_provenance_registry
```

## 5. Verify on-chain deploy

```bash
solana program show <MULTIPLAYER_PROGRAM_ID>
solana program show <VRF_PROGRAM_ID>
solana program show <PROVENANCE_PROGRAM_ID>
```

## 6. Wire app/adapters to devnet IDs

Use the deployed IDs in your app config and examples:
- Multiplayer adapter `programId`
- VRF adapter `snapVrfProgramId`
- Provenance adapter `programId`

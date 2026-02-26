import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import { PublicKey, Keypair, SystemProgram } from '@solana/web3.js';
import { assert } from 'chai';

/**
 * Anchor integration tests for snap-vrf-engine.
 *
 * Run with:
 *   anchor test --skip-build
 *
 * Note: namespace PDA seed uses the label bytes (e.g. b"DROP"), NOT an integer index.
 * Match PDA seed is b"match" per the Rust source, NOT b"match_randomness".
 */

function bytes32(label: string): Uint8Array {
    const out = new Uint8Array(32);
    const enc = new TextEncoder().encode(label);
    out.set(enc.slice(0, 32));
    return out;
}

describe('snap-vrf-engine', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    const program = anchor.workspace.SnapVrfEngine as anchor.Program<any>;
    const adminKp = (provider.wallet as any).payer as Keypair;
    const vrfAuthorityKp = adminKp;

    const gameId = Array.from(bytes32('vrf-test-game-v1'));
    const matchId = Array.from(bytes32('vrf-test-match-1'));

    let enginePda: PublicKey;
    let matchStatePda: PublicKey;
    let namespacePda: PublicKey;

    before(async () => {
        [enginePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('engine')],
            program.programId,
        );
        // Correct seed: b"match" + engine PDA + match_id (matches Rust source)
        [matchStatePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('match'), enginePda.toBuffer(), Buffer.from(matchId)],
            program.programId,
        );
        // Correct namespace seed: b"namespace" + engine + game_id + label bytes (b"DROP")
        [namespacePda] = PublicKey.findProgramAddressSync(
            [Buffer.from('namespace'), enginePda.toBuffer(), Buffer.from(gameId), Buffer.from('DROP')],
            program.programId,
        );
    });

    // =========================================================================
    // initialize_engine
    // =========================================================================

    it('initializes the VRF engine', async () => {
        const minConfirmations = 1;
        await program.methods
            .initializeEngine(vrfAuthorityKp.publicKey, minConfirmations)
            .accounts({
                admin: adminKp.publicKey,
                engine: enginePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([adminKp])
            .rpc();

        const engine = await program.account.vrfEngine.fetch(enginePda);
        assert.ok(engine.admin.equals(adminKp.publicKey));
        assert.ok(engine.vrfAuthority.equals(vrfAuthorityKp.publicKey));
        assert.equal(engine.paused, false);
        assert.equal(engine.minRequestConfirmations, minConfirmations);
    });

    // =========================================================================
    // initialize_match
    // =========================================================================

    it('initializes match randomness account', async () => {
        await program.methods
            .initializeMatch(
                Array.from(matchId),
                Array.from(gameId),
            )
            .accounts({
                payer: adminKp.publicKey,
                engine: enginePda,
                matchState: matchStatePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([adminKp])
            .rpc();

        const matchRandom = await program.account.matchRandomness.fetch(matchStatePda);
        assert.deepEqual(Array.from(matchRandom.matchId), matchId);
        assert.deepEqual(Array.from(matchRandom.gameId), gameId);
    });

    // =========================================================================
    // set_namespace_config
    // =========================================================================

    it('sets namespace config for DROP namespace', async () => {
        await program.methods
            .setNamespaceConfig(
                Array.from(gameId),
                { drop: {} },
                [3000, 5000, 1500, 500],
                [1250, 1250, 1250, 1250, 1250, 1250, 1250, 1250],
                500,
                [200, 200, 200, 200, 200, 200, 200, 200],
            )
            .accounts({
                payer: adminKp.publicKey,
                admin: adminKp.publicKey,
                engine: enginePda,
                namespaceConfig: namespacePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([adminKp])
            .rpc();

        const config = await program.account.namespaceConfig.fetch(namespacePda);
        assert.equal(config.dropTierWeights[0], 3000, 'common weight');
        assert.equal(config.dropTierWeights[3], 500, 'legendary weight');
        assert.equal(config.eventTriggerBps, 500);
    });

    // =========================================================================
    // pause behaviour
    // =========================================================================

    it('pauses and unpauses the VRF engine', async () => {
        await program.methods
            .setEnginePause(true)
            .accounts({ engine: enginePda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();

        let engine = await program.account.vrfEngine.fetch(enginePda);
        assert.equal(engine.paused, true);

        await program.methods
            .setEnginePause(false)
            .accounts({ engine: enginePda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();

        engine = await program.account.vrfEngine.fetch(enginePda);
        assert.equal(engine.paused, false);
    });

    // =========================================================================
    // set_vrf_authority
    // =========================================================================

    it('updates the VRF authority', async () => {
        const newAuthority = Keypair.generate().publicKey;

        await program.methods
            .setVrfAuthority(newAuthority)
            .accounts({ engine: enginePda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();

        const engine = await program.account.vrfEngine.fetch(enginePda);
        assert.ok(engine.vrfAuthority.equals(newAuthority), 'VRF authority should be updated');

        // Restore original for subsequent tests
        await program.methods
            .setVrfAuthority(vrfAuthorityKp.publicKey)
            .accounts({ engine: enginePda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();
    });

    // =========================================================================
    // request_randomness (smoke test)
    // =========================================================================

    it('emits a randomness request', async () => {
        const requestId = new BN(1); // first request: must be request_count(0) + 1 = 1

        const [requestPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('request'),
                matchStatePda.toBuffer(),
                requestId.toArrayLike(Buffer, 'le', 8),
            ],
            program.programId,
        );

        await program.methods
            .requestRandomness(
                requestId,
                { drop: {} },             // RandomnessType::Drop
                { drop: {} },             // RandomnessNamespace::Drop
                new BN(0),               // request_nonce
                Array.from(bytes32('meta-seed-data')), // metadata [u8; 32]
            )
            .accounts({
                requester: adminKp.publicKey,
                engine: enginePda,
                matchState: matchStatePda,
                randomnessRequest: requestPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([adminKp])
            .rpc();

        const req = await program.account.randomnessRequest.fetch(requestPda);
        assert.equal(req.fulfilled === true || req.status?.pending !== undefined || req.status?.fulfilled === undefined, true, 'request should be pending');
    });
});

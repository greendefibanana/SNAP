import * as anchor from '@coral-xyz/anchor';
import BN from 'bn.js';
import { PublicKey, Keypair, SystemProgram, Transaction } from '@solana/web3.js';
import { assert } from 'chai';

/**
 * Anchor integration tests for snap-provenance-registry.
 *
 * Tests the full settlement flow:
 *   initialize_registry → set_trusted_signer
 *   → record_match_provenance → verify PlayerCv accumulation
 *
 * Run with:
 *   anchor test --skip-local-validator
 *   anchor test
 */

function bytes32(label: string): Uint8Array {
    const out = new Uint8Array(32);
    const enc = new TextEncoder().encode(label);
    out.set(enc.slice(0, 32));
    return out;
}

describe('snap-provenance-registry', () => {
    const provider = anchor.AnchorProvider.env();
    anchor.setProvider(provider);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const program = anchor.workspace.SnapProvenanceRegistry as anchor.Program<any>;
    const adminKp = (provider.wallet as any).payer as Keypair;
    const trustedReporterKp = Keypair.generate();
    const playerKp = Keypair.generate();

    const gameId = Array.from(bytes32('test-game-snap-v1'));
    const matchId = Array.from(bytes32('test-match-prov-1'));

    let registryPda: PublicKey;
    let playerCvPda: PublicKey;
    let playerGameCvPda: PublicKey;
    let matchProvenancePda: PublicKey;

    before(async () => {
        // Fund reporter via SOL transfer from admin (avoids faucet Internal error on localnet)
        const tx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: adminKp.publicKey,
                toPubkey: trustedReporterKp.publicKey,
                lamports: 3_000_000_000,
            }),
        );
        await provider.sendAndConfirm(tx, [adminKp]);

        [registryPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('registry')],
            program.programId,
        );
        [playerCvPda] = PublicKey.findProgramAddressSync(
            [Buffer.from('player_cv'), registryPda.toBuffer(), playerKp.publicKey.toBuffer()],
            program.programId,
        );
        [playerGameCvPda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('player_game_cv'),
                registryPda.toBuffer(),
                playerKp.publicKey.toBuffer(),
                Buffer.from(gameId),
            ],
            program.programId,
        );
        [matchProvenancePda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('match_provenance'),
                registryPda.toBuffer(),
                playerKp.publicKey.toBuffer(),
                Buffer.from(gameId),
                Buffer.from(matchId),
            ],
            program.programId,
        );
    });

    // =========================================================================
    // initialize_registry
    // =========================================================================

    it('initializes the provenance registry', async () => {
        await program.methods
            .initializeRegistry()
            .accounts({
                admin: adminKp.publicKey,
                registry: registryPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([adminKp])
            .rpc();

        const registry = await program.account.provenanceRegistry.fetch(registryPda);
        assert.ok(registry.admin.equals(adminKp.publicKey));
        assert.equal(registry.paused, false);
        assert.equal(registry.trustedSigners.length, 0);
    });

    // =========================================================================
    // set_trusted_signer
    // =========================================================================

    it('adds a trusted signer', async () => {
        await program.methods
            .setTrustedSigner(trustedReporterKp.publicKey, true)
            .accounts({
                registry: registryPda,
                admin: adminKp.publicKey,
            })
            .signers([adminKp])
            .rpc();

        const registry = await program.account.provenanceRegistry.fetch(registryPda);
        assert.equal(registry.trustedSigners.length, 1);
        assert.ok(registry.trustedSigners[0].equals(trustedReporterKp.publicKey));
    });

    it('removes a trusted signer', async () => {
        // Add a temp signer and immediately remove it
        const tempKp = Keypair.generate();

        await program.methods
            .setTrustedSigner(tempKp.publicKey, true)
            .accounts({ registry: registryPda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();

        let registry = await program.account.provenanceRegistry.fetch(registryPda);
        assert.equal(registry.trustedSigners.length, 2);

        await program.methods
            .setTrustedSigner(tempKp.publicKey, false)
            .accounts({ registry: registryPda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();

        registry = await program.account.provenanceRegistry.fetch(registryPda);
        assert.equal(registry.trustedSigners.length, 1, 'temp signer should be removed');
    });

    // =========================================================================
    // record_match_provenance
    // =========================================================================

    it('records match provenance via trusted signer', async () => {
        const finalStateHash = Array.from(bytes32('state-hash-v1'));
        const logHash = Array.from(bytes32('log-hash-v1'));
        const provenanceHash = Array.from(bytes32('prov-hash-v1'));

        await program.methods
            .recordMatchProvenance({
                gameId,
                matchId,
                finalStateHash,
                logHash,
                provenanceHash,
                kills: 12,
                deaths: 3,
                assists: 7,
                score: 9800,
                won: true,
                metadataUri: 'https://snap.example.com/match/test-match-prov-1',
            })
            .accounts({
                reporter: trustedReporterKp.publicKey,
                player: playerKp.publicKey,
                registry: registryPda,
                playerCv: playerCvPda,
                playerGameCv: playerGameCvPda,
                matchProvenance: matchProvenancePda,
                systemProgram: SystemProgram.programId,
            })
            .signers([trustedReporterKp])
            .rpc();

        // Verify MatchProvenance account
        const prov = await program.account.matchProvenance.fetch(matchProvenancePda);
        assert.ok(prov.player.equals(playerKp.publicKey));
        assert.ok(prov.reporter.equals(trustedReporterKp.publicKey));
        assert.equal(prov.kills, 12);
        assert.equal(prov.deaths, 3);
        assert.equal(prov.assists, 7);
        assert.equal(prov.score, 9800);
        assert.equal(prov.won, true);
        assert.equal(prov.metadataUri, 'https://snap.example.com/match/test-match-prov-1');
    });

    it('accumulates PlayerCv stats', async () => {
        const cv = await program.account.playerCv.fetch(playerCvPda);
        assert.equal(cv.gamesPlayed.toNumber(), 1);
        assert.equal(cv.wins.toNumber(), 1);
        assert.equal(cv.kills.toNumber(), 12);
        assert.equal(cv.deaths.toNumber(), 3);
        assert.equal(cv.assists.toNumber(), 7);
        assert.equal(cv.score.toNumber(), 9800);
        assert.equal(cv.matchesRecorded.toNumber(), 1);
    });

    it('accumulates PlayerGameCv stats', async () => {
        const gcv = await program.account.playerGameCv.fetch(playerGameCvPda);
        assert.equal(gcv.gamesPlayed.toNumber(), 1);
        assert.equal(gcv.kills.toNumber(), 12);
        assert.equal(gcv.score.toNumber(), 9800);
        assert.deepEqual(Array.from(gcv.gameId), gameId);
    });

    it('rejects duplicate provenance for same (player, game, match)', async () => {
        try {
            await program.methods
                .recordMatchProvenance({
                    gameId,
                    matchId, // same matchId — PDA already exists
                    finalStateHash: Array.from(bytes32('other-hash')),
                    logHash: Array.from(bytes32('other-log')),
                    provenanceHash: Array.from(bytes32('other-prov')),
                    kills: 0,
                    deaths: 0,
                    assists: 0,
                    score: 0,
                    won: false,
                    metadataUri: '',
                })
                .accounts({
                    reporter: trustedReporterKp.publicKey,
                    player: playerKp.publicKey,
                    registry: registryPda,
                    playerCv: playerCvPda,
                    playerGameCv: playerGameCvPda,
                    matchProvenance: matchProvenancePda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([trustedReporterKp])
                .rpc();
            assert.fail('Expected account-already-initialized error');
        } catch (err: unknown) {
            const msg = String(err);
            assert.ok(
                msg.includes('already in use') || msg.includes('already initialized') || msg.includes('0x0'),
                `Expected already-initialized error, got: ${msg}`,
            );
        }
    });

    it('rejects reporting from an unauthorized (untrusted) signer', async () => {
        const randomKp = Keypair.generate();
        // Fund random keypair via transfer from admin to avoid faucet Internal error
        const fundTx = new Transaction().add(
            SystemProgram.transfer({
                fromPubkey: adminKp.publicKey,
                toPubkey: randomKp.publicKey,
                lamports: 1_000_000_000,
            }),
        );
        await provider.sendAndConfirm(fundTx, [adminKp]);

        const secondMatchId = Array.from(bytes32('test-match-prov-2'));
        const [secondProvenancePda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('match_provenance'),
                registryPda.toBuffer(),
                playerKp.publicKey.toBuffer(),
                Buffer.from(gameId),
                Buffer.from(secondMatchId),
            ],
            program.programId,
        );

        try {
            await program.methods
                .recordMatchProvenance({
                    gameId,
                    matchId: secondMatchId,
                    finalStateHash: Array.from(bytes32('state-2')),
                    logHash: Array.from(bytes32('log-2')),
                    provenanceHash: Array.from(bytes32('prov-2')),
                    kills: 0,
                    deaths: 0,
                    assists: 0,
                    score: 0,
                    won: false,
                    metadataUri: '',
                })
                .accounts({
                    reporter: randomKp.publicKey,
                    player: playerKp.publicKey,
                    registry: registryPda,
                    playerCv: playerCvPda,
                    playerGameCv: playerGameCvPda,
                    matchProvenance: secondProvenancePda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([randomKp])
                .rpc();
            assert.fail('Expected error: UnauthorizedReporter');
        } catch (err: unknown) {
            const msg = String(err);
            assert.ok(
                msg.includes('UnauthorizedReporter') || msg.includes('not authorized'),
                `Expected UnauthorizedReporter, got: ${msg}`,
            );
        }
    });

    // =========================================================================
    // pause
    // =========================================================================

    it('pauses and rejects provenance recording while paused', async () => {
        await program.methods
            .setRegistryPause(true)
            .accounts({ registry: registryPda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();

        const thirdMatchId = Array.from(bytes32('test-match-prov-3'));
        const [thirdProvenancePda] = PublicKey.findProgramAddressSync(
            [
                Buffer.from('match_provenance'),
                registryPda.toBuffer(),
                playerKp.publicKey.toBuffer(),
                Buffer.from(gameId),
                Buffer.from(thirdMatchId),
            ],
            program.programId,
        );

        try {
            await program.methods
                .recordMatchProvenance({
                    gameId,
                    matchId: thirdMatchId,
                    finalStateHash: Array.from(bytes32('s3')),
                    logHash: Array.from(bytes32('l3')),
                    provenanceHash: Array.from(bytes32('p3')),
                    kills: 0, deaths: 0, assists: 0, score: 0,
                    won: false, metadataUri: '',
                })
                .accounts({
                    reporter: trustedReporterKp.publicKey,
                    player: playerKp.publicKey,
                    registry: registryPda,
                    playerCv: playerCvPda,
                    playerGameCv: playerGameCvPda,
                    matchProvenance: thirdProvenancePda,
                    systemProgram: SystemProgram.programId,
                })
                .signers([trustedReporterKp])
                .rpc();
            assert.fail('Expected error: RegistryPaused');
        } catch (err: unknown) {
            const msg = String(err);
            assert.ok(
                msg.includes('RegistryPaused') || msg.includes('paused'),
                `Expected RegistryPaused, got: ${msg}`,
            );
        }

        // Restore
        await program.methods
            .setRegistryPause(false)
            .accounts({ registry: registryPda, admin: adminKp.publicKey })
            .signers([adminKp])
            .rpc();
    });
});

import assert from 'node:assert/strict';
import { createBurnModule } from './burn.js';
import type { SnapAction, SnapManifest, SnapState } from '../engine/types.js';

function baseState(): SnapState {
    return {
        matchId: 'm1',
        phase: 'LIVE',
        seq: 0,
        stateHash: 'h0',
        ruleVars: {},
        modules: {},
        custom: {},
    };
}

const manifest: SnapManifest = {
    version: '1',
    gameId: 'g',
    rulesetId: 'r',
    modules: { burn: true },
    moduleConfig: {
        burn: {
            defaultAmount: 1,
            defaultTokenMint: 'SOL',
            defaultSinkAccount: 'sink1',
            allowUnconfiguredAbilities: true,
            allowMissingSinkAccount: false,
            abilityCosts: {
                grenade: { amount: 2, tokenMint: 'SOL', sinkAccount: 'sink1', requireLicenseAsset: false, allowAmountOverride: false },
            },
        },
    },
};

function burnAction(abilityId: string, extra: Record<string, unknown> = {}): SnapAction {
    return { matchId: 'm1', kind: 'BURN_USE', actor: 'p1', t: 1, payload: { abilityId, ...extra } };
}

function testInit(): void {
    const mod = createBurnModule();
    const state = mod.init(manifest, baseState());
    const burn = state.modules.burn as { totalBurned: number };
    assert.equal(burn.totalBurned, 0);
}

function testBurnUse(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    assert.doesNotThrow(() => mod.validateAction!(burnAction('grenade'), manifest, state));
    state = mod.applyAction!(burnAction('grenade'), manifest, state);
    const burn = state.modules.burn as { totalBurned: number; burnedByActor: Record<string, number>; receipts: Array<{ abilityId: string }> };
    assert.equal(burn.totalBurned, 2); // grenade configured for amount: 2
    assert.equal(burn.burnedByActor['p1'], 2);
    assert.equal(burn.receipts.length, 1);
    assert.equal(burn.receipts[0]!.abilityId, 'grenade');
}

function testUnconfiguredAbility(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    // Unconfigured ability should use defaults (amount=1)
    state = mod.applyAction!(burnAction('shield'), manifest, state);
    const burn = state.modules.burn as { totalBurned: number };
    assert.equal(burn.totalBurned, 1);
}

function testUnconfiguredDisallowed(): void {
    const restrictedManifest: SnapManifest = {
        ...manifest,
        moduleConfig: {
            burn: {
                ...(manifest.moduleConfig!.burn as Record<string, unknown>),
                allowUnconfiguredAbilities: false,
            },
        },
    };
    const mod = createBurnModule();
    let state = mod.init(restrictedManifest, baseState());
    assert.throws(
        () => mod.validateAction!(burnAction('unknown-ability'), restrictedManifest, state),
        /not configured/,
    );
}

function testMissingAbilityId(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    const badAction: SnapAction = { matchId: 'm1', kind: 'BURN_USE', actor: 'p1', t: 1, payload: {} };
    assert.throws(() => mod.validateAction!(badAction, manifest, state), /abilityId/);
}

function testAmountOverrideRejected(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    // grenade has allowAmountOverride: false, configured amount: 2
    assert.throws(
        () => mod.validateAction!(burnAction('grenade', { amount: 5 }), manifest, state),
        /requires amount/,
    );
}

function testDuplicateBurnId(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(burnAction('shield', { burnId: 'unique-burn' }), manifest, state);
    assert.throws(
        () => mod.validateAction!(burnAction('shield', { burnId: 'unique-burn' }), manifest, state),
        /already exists/,
    );
}

function testFinalize(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(burnAction('grenade'), manifest, state);
    state = mod.applyAction!({ ...burnAction('shield'), t: 2, payload: { abilityId: 'shield' } }, manifest, state);
    const summary = mod.finalize!(manifest, state);
    const burn = summary.burn as { totalBurned: number; useCountByAbility: Record<string, number> };
    assert.equal(burn.totalBurned, 3); // 2 + 1
    assert.equal(burn.useCountByAbility['grenade'], 1);
    assert.equal(burn.useCountByAbility['shield'], 1);
}

function testAssetBurnKind(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    const assetBurn: SnapAction = { matchId: 'm1', kind: 'ASSET_BURN', actor: 'p1', t: 1, payload: { abilityId: 'sword' } };
    assert.doesNotThrow(() => mod.validateAction!(assetBurn, manifest, state));
    state = mod.applyAction!(assetBurn, manifest, state);
    const burn = state.modules.burn as { totalBurned: number };
    assert.equal(burn.totalBurned, 1);
}

function testIgnoresNonBurnActions(): void {
    const mod = createBurnModule();
    let state = mod.init(manifest, baseState());
    const nonBurn: SnapAction = { matchId: 'm1', kind: 'MOVE', actor: 'p1', t: 1, payload: {} };
    const result = mod.applyAction!(nonBurn, manifest, state);
    assert.deepEqual(result, state);
}

testInit();
testBurnUse();
testUnconfiguredAbility();
testUnconfiguredDisallowed();
testMissingAbilityId();
testAmountOverrideRejected();
testDuplicateBurnId();
testFinalize();
testAssetBurnKind();
testIgnoresNonBurnActions();
console.log('burn tests passed');

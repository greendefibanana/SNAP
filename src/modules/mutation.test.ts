import assert from 'node:assert/strict';
import { createMutationModule } from './mutation.js';
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
    modules: { mutation: true },
};

function rulevarAction(key: string, value: unknown, ttlSec?: number): SnapAction {
    return { matchId: 'm1', kind: 'RULEVAR_SET', actor: 'system', t: 1, payload: { key, value, ttlSec } };
}

function modifierStart(id: string, data: unknown, ttlSec?: number): SnapAction {
    return { matchId: 'm1', kind: 'MODIFIER_START', actor: 'system', t: 1, payload: { id, data, ttlSec } };
}

function modifierEnd(id: string): SnapAction {
    return { matchId: 'm1', kind: 'MODIFIER_END', actor: 'system', t: 1, payload: { id } };
}

function testInit(): void {
    const mod = createMutationModule();
    const state = mod.init(manifest, baseState());
    const mutation = state.modules.mutation as { nowSec: number; ruleVarOverrides: object; activeModifiers: object };
    assert.equal(mutation.nowSec, 0);
    assert.deepEqual(mutation.ruleVarOverrides, {});
    assert.deepEqual(mutation.activeModifiers, {});
}

function testRulevarSet(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(rulevarAction('speed', 2.0), manifest, state);
    assert.deepEqual(state.ruleVars['speed'], { type: 'number', value: 2.0 });
}

function testRulevarSetWithTtl(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(rulevarAction('speed', 2.0, 10), manifest, state);
    const mutation = state.modules.mutation as { ruleVarOverrides: Record<string, { expiresAtSec: number | null }> };
    assert.equal(mutation.ruleVarOverrides['speed']!.expiresAtSec, 10); // nowSec(0) + ttlSec(10)
}

function testRulevarExpiry(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(rulevarAction('speed', 2.0, 5), manifest, state);
    assert.deepEqual(state.ruleVars['speed'], { type: 'number', value: 2.0 });

    // Tick 3 seconds — should not expire yet
    state = mod.tick!(3, manifest, state);
    assert.deepEqual(state.ruleVars['speed'], { type: 'number', value: 2.0 });

    // Tick 3 more seconds (total 6 > ttl 5) — should expire
    state = mod.tick!(3, manifest, state);
    assert.equal(state.ruleVars['speed'], undefined);
}

function testModifierStart(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(modifierStart('double_dmg', { multiplier: 2 }), manifest, state);
    const mutation = state.modules.mutation as { activeModifiers: Record<string, { data: unknown }> };
    assert.deepEqual(mutation.activeModifiers['double_dmg']!.data, { multiplier: 2 });
}

function testModifierEnd(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(modifierStart('double_dmg', { multiplier: 2 }), manifest, state);
    state = mod.applyAction!(modifierEnd('double_dmg'), manifest, state);
    const mutation = state.modules.mutation as { activeModifiers: Record<string, unknown> };
    assert.equal(mutation.activeModifiers['double_dmg'], undefined);
}

function testModifierExpiry(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(modifierStart('shield', { hp: 50 }, 10), manifest, state);
    const mutation1 = state.modules.mutation as { activeModifiers: Record<string, unknown> };
    assert.ok(mutation1.activeModifiers['shield']);

    state = mod.tick!(11, manifest, state);
    const mutation2 = state.modules.mutation as { activeModifiers: Record<string, unknown> };
    assert.equal(mutation2.activeModifiers['shield'], undefined);
}

function testFinalize(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(modifierStart('effect_a', null), manifest, state);
    state = mod.applyAction!(rulevarAction('gravity', 0.5), manifest, state);
    const summary = mod.finalize!(manifest, state);
    const mutation = summary.mutation as { activeModifierIds: string[]; ruleVarOverrideKeys: string[] };
    assert.ok(mutation.activeModifierIds.includes('effect_a'));
    assert.ok(mutation.ruleVarOverrideKeys.includes('gravity'));
}

function testIgnoresUnknownActions(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, baseState());
    const moveAction: SnapAction = { matchId: 'm1', kind: 'MOVE', actor: 'p1', t: 1, payload: {} };
    const result = mod.applyAction!(moveAction, manifest, state);
    assert.deepEqual(result, state);
}

function testRulevarRestore(): void {
    const mod = createMutationModule();
    let state = mod.init(manifest, {
        ...baseState(),
        ruleVars: { speed: { type: 'number', value: 1.0 } },
    });
    // Override speed with TTL
    state = mod.applyAction!(rulevarAction('speed', 3.0, 5), manifest, state);
    assert.deepEqual(state.ruleVars['speed'], { type: 'number', value: 3.0 });

    // Expire it — should restore to original value 1.0
    state = mod.tick!(6, manifest, state);
    assert.deepEqual(state.ruleVars['speed'], { type: 'number', value: 1.0 });
}

testInit();
testRulevarSet();
testRulevarSetWithTtl();
testRulevarExpiry();
testModifierStart();
testModifierEnd();
testModifierExpiry();
testFinalize();
testIgnoresUnknownActions();
testRulevarRestore();
console.log('mutation tests passed');

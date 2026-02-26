import assert from 'node:assert/strict';
import { createScoringModule } from './scoring.js';
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
    modules: { scoring: true },
};

function action(counter: string, entityId: string, delta: number, t = 1): SnapAction {
    return { matchId: 'm1', kind: 'SCORE_ADD', actor: 'system', t, payload: { counter, entityId, delta } };
}

function testInit(): void {
    const mod = createScoringModule();
    const state = mod.init(manifest, baseState());
    const scoring = state.modules.scoring as { counters: Record<string, Record<string, number>> };
    assert.ok(scoring);
    assert.deepEqual(scoring.counters, {});
}

function testScoreAdd(): void {
    const mod = createScoringModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(action('kills', 'player1', 3), manifest, state);
    const scoring = state.modules.scoring as { counters: Record<string, Record<string, number>> };
    assert.equal(scoring.counters['kills']!['player1'], 3);
}

function testScoreAccumulates(): void {
    const mod = createScoringModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(action('kills', 'player1', 3), manifest, state);
    state = mod.applyAction!(action('kills', 'player1', 2), manifest, state);
    const scoring = state.modules.scoring as { counters: Record<string, Record<string, number>> };
    assert.equal(scoring.counters['kills']!['player1'], 5);
}

function testMultipleCounters(): void {
    const mod = createScoringModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(action('kills', 'p1', 3), manifest, state);
    state = mod.applyAction!(action('deaths', 'p1', 1), manifest, state);
    state = mod.applyAction!(action('kills', 'p2', 5), manifest, state);
    const scoring = state.modules.scoring as { counters: Record<string, Record<string, number>> };
    assert.equal(scoring.counters['kills']!['p1'], 3);
    assert.equal(scoring.counters['kills']!['p2'], 5);
    assert.equal(scoring.counters['deaths']!['p1'], 1);
}

function testIgnoresNonScoreActions(): void {
    const mod = createScoringModule();
    let state = mod.init(manifest, baseState());
    const nonScoreAction: SnapAction = { matchId: 'm1', kind: 'MOVE', actor: 'p1', t: 1, payload: {} };
    const result = mod.applyAction!(nonScoreAction, manifest, state);
    assert.deepEqual(result, state);
}

function testFinalize(): void {
    const mod = createScoringModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(action('kills', 'p1', 10), manifest, state);
    const summary = mod.finalize!(manifest, state);
    const scoring = summary.scoring as { counters: Record<string, Record<string, number>> };
    assert.equal(scoring.counters['kills']!['p1'], 10);
}

function testEmptyCounterKey(): void {
    const mod = createScoringModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(action('', 'p1', 5), manifest, state);
    const scoring = state.modules.scoring as { counters: Record<string, Record<string, number>> };
    // Empty counter name should be silently ignored
    assert.equal(Object.keys(scoring.counters).length, 0);
}

testInit();
testScoreAdd();
testScoreAccumulates();
testMultipleCounters();
testIgnoresNonScoreActions();
testFinalize();
testEmptyCounterKey();
console.log('scoring tests passed');

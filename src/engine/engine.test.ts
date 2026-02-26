import assert from 'node:assert/strict';
import { Engine } from './Engine.js';
import { registerRuleset, getRuleset, listRulesets } from './registry.js';
import { createSnapEngine } from './createSnapEngine.js';
import type { SnapAction, SnapManifest, SnapRuleset, SnapState } from './types.js';

// ----- Helpers -----

const testRuleset: SnapRuleset = {
    id: 'test-ruleset',
    createInitialState(manifest) {
        return {
            matchId: `${manifest.gameId}:${manifest.rulesetId}:local`,
            phase: 'PREMATCH',
            seq: 0,
            stateHash: '',
            ruleVars: { ...(manifest.ruleVars ?? {}) },
            modules: {},
            custom: { counter: 0 },
        };
    },
    reduce(state, action, _manifest) {
        if (action.kind === 'INCREMENT') {
            const counter = (state.custom.counter as number ?? 0) + 1;
            return { ...state, custom: { ...state.custom, counter } };
        }
        if (action.kind === 'SET_PHASE') {
            const payload = action.payload as { phase: string };
            return { ...state, phase: payload.phase as SnapState['phase'] };
        }
        return state;
    },
};

const manifest: SnapManifest = {
    version: '1',
    gameId: 'test-game',
    rulesetId: 'test-ruleset',
};

function makeAction(kind: string, t: number, matchId: string, payload: unknown = {}): SnapAction {
    return { matchId, actor: 'player1', t, kind, payload };
}

// ----- Tests -----

function testEngineCreation(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const state = engine.getState();
    assert.equal(state.phase, 'PREMATCH');
    assert.equal(state.seq, 0);
    assert.equal(state.custom.counter, 0);
    assert.ok(state.stateHash.length > 0, 'should have initial hash');
}

function testEngineDispatch(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const matchId = engine.getState().matchId;

    const s1 = engine.dispatch(makeAction('INCREMENT', 1000, matchId));
    assert.equal(s1.seq, 1);
    assert.equal(s1.custom.counter, 1);
    assert.ok(s1.stateHash.length > 0);

    const s2 = engine.dispatch(makeAction('INCREMENT', 2000, matchId));
    assert.equal(s2.seq, 2);
    assert.equal(s2.custom.counter, 2);
    assert.notEqual(s1.stateHash, s2.stateHash, 'hash should change between states');
}

function testDeterministicHashing(): void {
    registerRuleset(testRuleset);
    const engine1 = createSnapEngine(manifest);
    const engine2 = createSnapEngine(manifest);
    const matchId = engine1.getState().matchId;

    assert.equal(engine1.getState().stateHash, engine2.getState().stateHash, 'initial hashes should match');

    engine1.dispatch(makeAction('INCREMENT', 1000, matchId));
    engine2.dispatch(makeAction('INCREMENT', 1000, matchId));
    assert.equal(engine1.getState().stateHash, engine2.getState().stateHash, 'hashes after same actions should match');

    engine1.dispatch(makeAction('INCREMENT', 2000, matchId));
    assert.notEqual(engine1.getState().stateHash, engine2.getState().stateHash, 'hashes after divergent actions should differ');
}

function testReplay(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const matchId = engine.getState().matchId;

    const actions: SnapAction[] = [
        makeAction('INCREMENT', 1000, matchId),
        makeAction('INCREMENT', 2000, matchId),
        makeAction('INCREMENT', 3000, matchId),
    ];

    for (const a of actions) engine.dispatch(a);

    const result = engine.replay(actions);
    assert.equal(result.verified, true, 'replay should verify');
    assert.equal(result.expectedHash, result.actualHash);
    assert.equal(result.state.seq, 3);
    assert.equal(result.state.custom.counter, 3);
}

function testReplayMismatch(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const matchId = engine.getState().matchId;

    engine.dispatch(makeAction('INCREMENT', 1000, matchId));
    engine.dispatch(makeAction('INCREMENT', 2000, matchId));

    // Replay with different actions
    const wrongActions = [makeAction('INCREMENT', 1000, matchId)];
    const result = engine.replay(wrongActions);
    assert.equal(result.verified, false, 'replay with wrong actions should fail');
}

function testEventLog(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const matchId = engine.getState().matchId;

    assert.equal(engine.getEventLog().length, 0);

    engine.dispatch(makeAction('INCREMENT', 1000, matchId));
    engine.dispatch(makeAction('INCREMENT', 2000, matchId));

    const log = engine.getEventLog();
    assert.equal(log.length, 2);
    assert.equal(log[0]!.kind, 'INCREMENT');
    assert.equal(log[0]!.seq, 1);
    assert.equal(log[1]!.seq, 2);
    assert.ok(log[0]!.hash.length > 0);
}

function testSubscription(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const matchId = engine.getState().matchId;

    const states: SnapState[] = [];
    const unsub = engine.subscribe((s) => states.push(s));

    // subscribe fires immediately with initial state
    assert.equal(states.length, 1);

    engine.dispatch(makeAction('INCREMENT', 1000, matchId));
    assert.equal(states.length, 2);
    assert.equal(states[1]!.custom.counter, 1);

    unsub();
    engine.dispatch(makeAction('INCREMENT', 2000, matchId));
    assert.equal(states.length, 2, 'should not receive after unsub');
}

function testTick(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);

    const s1 = engine.tick(1);
    assert.equal(s1.seq, 1);
}

function testMatchIdMismatch(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);

    assert.throws(
        () => engine.dispatch(makeAction('INCREMENT', 1000, 'wrong-match-id')),
        /matchId mismatch/,
    );
}

function testValidationErrors(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const matchId = engine.getState().matchId;

    assert.throws(
        () => engine.dispatch({ matchId, actor: '', t: 1, kind: 'INCREMENT', payload: {} }),
        /actor is required/,
    );
    assert.throws(
        () => engine.dispatch({ matchId, actor: 'p1', t: 1, kind: '', payload: {} }),
        /kind is required/,
    );
    assert.throws(
        () => engine.dispatch({ matchId: '', actor: 'p1', t: 1, kind: 'X', payload: {} }),
        /matchId is required/,
    );
}

function testEndMatch(): void {
    registerRuleset(testRuleset);
    const engine = createSnapEngine(manifest);
    const matchId = engine.getState().matchId;

    engine.dispatch(makeAction('INCREMENT', 1000, matchId));
    const summary = engine.endMatch();
    assert.equal(engine.getState().phase, 'POSTMATCH');
    assert.ok(typeof summary === 'object');

    // calling again should be idempotent
    const summary2 = engine.endMatch();
    assert.equal(engine.getState().phase, 'POSTMATCH');
}

function testRegistryList(): void {
    registerRuleset(testRuleset);
    const list = listRulesets();
    assert.ok(list.includes('test-ruleset'));
    assert.throws(() => getRuleset('nonexistent-ruleset'), /No ruleset/);
}

// ----- Run -----
testEngineCreation();
testEngineDispatch();
testDeterministicHashing();
testReplay();
testReplayMismatch();
testEventLog();
testSubscription();
testTick();
testMatchIdMismatch();
testValidationErrors();
testEndMatch();
testRegistryList();
console.log('engine tests passed');

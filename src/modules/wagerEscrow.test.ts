import assert from 'node:assert/strict';
import { createWagerEscrowModule } from './wagerEscrow.js';
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
    modules: { wagerEscrow: true, scoring: true },
    moduleConfig: {
        wagerEscrow: {
            mode: 'any',
            defaultCurrencyMint: 'SOL',
            defaultEscrowAccount: 'escrow1',
            defaultMaxParticipants: 2,
            autoLockOnJoin: true,
            allowCancelOpenOrder: true,
        },
    },
};

function postAction(amount: number, extra: Record<string, unknown> = {}): SnapAction {
    return { matchId: 'm1', kind: 'WAGER_POST', actor: 'p1', t: 1, payload: { amount, ...extra } };
}

function joinAction(orderId: string, actor = 'p2'): SnapAction {
    return { matchId: 'm1', kind: 'WAGER_JOIN', actor, t: 2, payload: { orderId } };
}

function lockAction(orderId: string, actor = 'p1'): SnapAction {
    return { matchId: 'm1', kind: 'WAGER_MATCH_LOCK', actor, t: 3, payload: { orderId } };
}

function settleAction(orderId: string, winners: string[], actor = 'p1', extra: Record<string, unknown> = {}): SnapAction {
    return { matchId: 'm1', kind: 'WAGER_SETTLE', actor, t: 4, payload: { orderId, winners, ...extra } };
}

function cancelAction(orderId: string, actor = 'p1'): SnapAction {
    return { matchId: 'm1', kind: 'WAGER_CANCEL', actor, t: 5, payload: { orderId } };
}

function refundAction(orderId: string, actor = 'p1'): SnapAction {
    return { matchId: 'm1', kind: 'WAGER_REFUND', actor, t: 6, payload: { orderId } };
}

type WagerState = {
    ordersById: Record<string, {
        orderId: string; status: string; participants: string[];
        potAmount: number; winners: string[]; payoutBreakdown: Array<{ recipient: string; amount: number }>;
    }>;
    actorStats: Record<string, { posted: number; won: number; lost: number; totalWagered: number; totalPayout: number }>;
};

function getWagerState(state: SnapState): WagerState {
    return state.modules.wagerEscrow as WagerState;
}

function getFirstOrderId(state: SnapState): string {
    const wager = getWagerState(state);
    return Object.keys(wager.ordersById)[0]!;
}

// ---- Tests ----

function testInit(): void {
    const mod = createWagerEscrowModule();
    const state = mod.init(manifest, baseState());
    const wager = getWagerState(state);
    assert.ok(wager);
    assert.deepEqual(wager.ordersById, {});
}

function testPostWager(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    assert.doesNotThrow(() => mod.validateAction!(postAction(100), manifest, state));
    state = mod.applyAction!(postAction(100), manifest, state);
    const wager = getWagerState(state);
    const orderId = getFirstOrderId(state);
    assert.ok(orderId);
    assert.equal(wager.ordersById[orderId]!.status, 'OPEN');
    assert.equal(wager.ordersById[orderId]!.potAmount, 100);
    assert.deepEqual(wager.ordersById[orderId]!.participants, ['p1']);
}

function testPostInvalidAmount(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    assert.throws(() => mod.validateAction!(postAction(0), manifest, state), /positive amount/);
    assert.throws(() => mod.validateAction!(postAction(-5), manifest, state), /positive amount/);
}

function testJoinWager(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const orderId = getFirstOrderId(state);
    state = mod.applyAction!(joinAction(orderId), manifest, state);
    const wager = getWagerState(state);
    assert.deepEqual(wager.ordersById[orderId]!.participants, ['p1', 'p2']);
    assert.equal(wager.ordersById[orderId]!.potAmount, 100); // 50 * 2
    // autoLockOnJoin = true, maxParticipants = 2
    assert.equal(wager.ordersById[orderId]!.status, 'LOCKED');
}

function testJoinAlreadyIn(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const orderId = getFirstOrderId(state);
    assert.throws(() => mod.validateAction!(joinAction(orderId, 'p1'), manifest, state), /already in/);
}

function testSettleMultiplayer(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const orderId = getFirstOrderId(state);
    state = mod.applyAction!(joinAction(orderId), manifest, state);
    // order is now LOCKED after join (autoLockOnJoin)
    state = mod.applyAction!(settleAction(orderId, ['p1']), manifest, state);
    const wager = getWagerState(state);
    assert.equal(wager.ordersById[orderId]!.status, 'SETTLED');
    assert.deepEqual(wager.ordersById[orderId]!.winners, ['p1']);
    // All pot goes to winner  
    const payout = wager.ordersById[orderId]!.payoutBreakdown;
    assert.ok(payout.length > 0);
    const totalPayout = payout.reduce((sum, p) => sum + p.amount, 0);
    assert.equal(totalPayout, 100);
}

function testSettleNotLocked(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const orderId = getFirstOrderId(state);
    // order is OPEN, not LOCKED
    assert.throws(
        () => mod.validateAction!(settleAction(orderId, ['p1']), manifest, state),
        /not LOCKED/,
    );
}

function testCancelWager(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const orderId = getFirstOrderId(state);
    state = mod.applyAction!(cancelAction(orderId), manifest, state);
    const wager = getWagerState(state);
    assert.equal(wager.ordersById[orderId]!.status, 'CANCELLED');
}

function testCancelByNonCreator(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const orderId = getFirstOrderId(state);
    assert.throws(
        () => mod.validateAction!(cancelAction(orderId, 'stranger'), manifest, state),
        /order creator/,
    );
}

function testRefundWager(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const orderId = getFirstOrderId(state);
    state = mod.applyAction!(refundAction(orderId), manifest, state);
    const wager = getWagerState(state);
    assert.equal(wager.ordersById[orderId]!.status, 'REFUNDED');
    assert.equal(wager.ordersById[orderId]!.payoutBreakdown.length, 1);
    assert.equal(wager.ordersById[orderId]!.payoutBreakdown[0]!.amount, 50);
}

function testSinglePlayerWager(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    // Post single-player wager without lockOnPost so order stays OPEN
    state = mod.applyAction!(postAction(100, { mode: 'single-player' }), manifest, state);
    const orderId = getFirstOrderId(state);
    const wager = getWagerState(state);
    assert.equal(wager.ordersById[orderId]!.status, 'OPEN');
    // Single-player should not allow join
    assert.throws(
        () => mod.validateAction!(joinAction(orderId), manifest, state),
        /single-player/,
    );
}


function testActorStats(): void {
    const mod = createWagerEscrowModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(postAction(50), manifest, state);
    const wager = getWagerState(state);
    assert.equal(wager.actorStats['p1']!.posted, 1);
    assert.equal(wager.actorStats['p1']!.totalWagered, 50);
}

function testManualLock(): void {
    const noAutoManifest: SnapManifest = {
        ...manifest,
        moduleConfig: {
            wagerEscrow: {
                ...(manifest.moduleConfig!.wagerEscrow as Record<string, unknown>),
                autoLockOnJoin: false,
            },
        },
    };
    const mod = createWagerEscrowModule();
    let state = mod.init(noAutoManifest, baseState());
    state = mod.applyAction!(postAction(50), noAutoManifest, state);
    const orderId = getFirstOrderId(state);
    state = mod.applyAction!(joinAction(orderId), noAutoManifest, state);
    // Should still be OPEN with autoLockOnJoin=false
    let wager = getWagerState(state);
    assert.equal(wager.ordersById[orderId]!.status, 'OPEN');
    // Manual lock
    state = mod.applyAction!(lockAction(orderId), noAutoManifest, state);
    wager = getWagerState(state);
    assert.equal(wager.ordersById[orderId]!.status, 'LOCKED');
}

// ---- Run ----
testInit();
testPostWager();
testPostInvalidAmount();
testJoinWager();
testJoinAlreadyIn();
testSettleMultiplayer();
testSettleNotLocked();
testCancelWager();
testCancelByNonCreator();
testRefundWager();
testSinglePlayerWager();
testActorStats();
testManualLock();
console.log('wagerEscrow tests passed');

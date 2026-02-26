import assert from 'node:assert/strict';
import { createTokenizationModule } from './tokenization.js';
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
    modules: { tokenization: true },
    moduleConfig: {
        tokenization: {
            defaultStandard: 'SPL',
            defaultBackendHint: 'magicblock',
            defaultMintAuthority: '',
        },
    },
};

function defineAction(classId: string, tokenType: string, extra: Record<string, unknown> = {}): SnapAction {
    return {
        matchId: 'm1', kind: 'TOKEN_CLASS_DEFINE', actor: 'admin', t: 1,
        payload: {
            classId, tokenType,
            media: { kind: '2d', uri: 'https://example.com/img.png' },
            ...extra,
        },
    };
}

function mintAction(classId: string, to: string, amount: number, extra: Record<string, unknown> = {}): SnapAction {
    return { matchId: 'm1', kind: 'TOKEN_MINT', actor: 'admin', t: 2, payload: { classId, to, amount, ...extra } };
}

function transferAction(classId: string, from: string, to: string, amount: number, extra: Record<string, unknown> = {}): SnapAction {
    return { matchId: 'm1', kind: 'TOKEN_TRANSFER', actor: from, t: 3, payload: { classId, from, to, amount, ...extra } };
}

function burnAction(classId: string, owner: string, amount: number, extra: Record<string, unknown> = {}): SnapAction {
    return { matchId: 'm1', kind: 'TOKEN_BURN', actor: owner, t: 4, payload: { classId, owner, amount, ...extra } };
}

type TokenModState = {
    classesById: Record<string, { classId: string; tokenType: string; mintedSupply: number; burnedSupply: number }>;
    ftBalances: Record<string, Record<string, number>>;
    nftByTokenId: Record<string, { tokenId: string; classId: string; owner: string }>;
    eventLog: Array<{ kind: string }>;
};

function getTokenState(state: SnapState): TokenModState {
    return state.modules.tokenization as TokenModState;
}

// ---- Tests ----

function testInit(): void {
    const mod = createTokenizationModule();
    const state = mod.init(manifest, baseState());
    const tok = getTokenState(state);
    assert.ok(tok);
    assert.deepEqual(tok.classesById, {});
    assert.deepEqual(tok.ftBalances, {});
}

function testDefineNFTClass(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    assert.doesNotThrow(() => mod.validateAction!(defineAction('sword', 'NFT'), manifest, state));
    state = mod.applyAction!(defineAction('sword', 'NFT'), manifest, state);
    const tok = getTokenState(state);
    assert.ok(tok.classesById['sword']);
    assert.equal(tok.classesById['sword']!.tokenType, 'NFT');
    assert.equal(tok.classesById['sword']!.mintedSupply, 0);
}

function testDefineFTClass(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('ammo.mag', 'FT'), manifest, state);
    const tok = getTokenState(state);
    assert.equal(tok.classesById['ammo.mag']!.tokenType, 'FT');
}

function testDuplicateClassReject(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('sword', 'NFT'), manifest, state);
    assert.throws(() => mod.validateAction!(defineAction('sword', 'NFT'), manifest, state), /already exists/);
}

function testFTMintAndBalance(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('ammo', 'FT'), manifest, state);
    state = mod.applyAction!(mintAction('ammo', 'player1', 100), manifest, state);
    const tok = getTokenState(state);
    assert.equal(tok.ftBalances['ammo']!['player1'], 100);
    assert.equal(tok.classesById['ammo']!.mintedSupply, 100);
}

function testFTTransfer(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('gold', 'FT'), manifest, state);
    state = mod.applyAction!(mintAction('gold', 'p1', 50), manifest, state);
    assert.doesNotThrow(() => mod.validateAction!(transferAction('gold', 'p1', 'p2', 20), manifest, state));
    state = mod.applyAction!(transferAction('gold', 'p1', 'p2', 20), manifest, state);
    const tok = getTokenState(state);
    assert.equal(tok.ftBalances['gold']!['p1'], 30);
    assert.equal(tok.ftBalances['gold']!['p2'], 20);
}

function testFTTransferInsufficientBalance(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('gold', 'FT'), manifest, state);
    state = mod.applyAction!(mintAction('gold', 'p1', 10), manifest, state);
    assert.throws(
        () => mod.validateAction!(transferAction('gold', 'p1', 'p2', 50), manifest, state),
        /insufficient balance/,
    );
}

function testFTBurn(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('ammo', 'FT'), manifest, state);
    state = mod.applyAction!(mintAction('ammo', 'p1', 30), manifest, state);
    state = mod.applyAction!(burnAction('ammo', 'p1', 10), manifest, state);
    const tok = getTokenState(state);
    assert.equal(tok.ftBalances['ammo']!['p1'], 20);
    assert.equal(tok.classesById['ammo']!.burnedSupply, 10);
}

function testFTBurnInsufficientBalance(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('ammo', 'FT'), manifest, state);
    state = mod.applyAction!(mintAction('ammo', 'p1', 5), manifest, state);
    assert.throws(
        () => mod.validateAction!(burnAction('ammo', 'p1', 10), manifest, state),
        /insufficient/,
    );
}

function testNFTMint(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('sword', 'NFT'), manifest, state);
    state = mod.applyAction!(mintAction('sword', 'p1', 1), manifest, state);
    const tok = getTokenState(state);
    const nftIds = Object.keys(tok.nftByTokenId);
    assert.equal(nftIds.length, 1);
    assert.equal(tok.nftByTokenId[nftIds[0]!]!.owner, 'p1');
    assert.equal(tok.classesById['sword']!.mintedSupply, 1);
}

function testNFTMintAmountNot1(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('sword', 'NFT'), manifest, state);
    assert.throws(
        () => mod.validateAction!(mintAction('sword', 'p1', 5), manifest, state),
        /must be 1 for NFT/,
    );
}

function testMaxSupply(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('limited', 'FT', { maxSupply: 10 }), manifest, state);
    state = mod.applyAction!(mintAction('limited', 'p1', 10), manifest, state);
    assert.throws(
        () => mod.validateAction!(mintAction('limited', 'p1', 1), manifest, state),
        /maxSupply/,
    );
}

function testBurnNonBurnable(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('soulbound', 'FT', { burnable: false }), manifest, state);
    state = mod.applyAction!(mintAction('soulbound', 'p1', 10), manifest, state);
    assert.throws(
        () => mod.validateAction!(burnAction('soulbound', 'p1', 1), manifest, state),
        /disabled/,
    );
}

function testTransferNonTransferable(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('soul', 'FT', { transferable: false }), manifest, state);
    state = mod.applyAction!(mintAction('soul', 'p1', 10), manifest, state);
    assert.throws(
        () => mod.validateAction!(transferAction('soul', 'p1', 'p2', 5), manifest, state),
        /disabled/,
    );
}

function testUnknownClass(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    assert.throws(
        () => mod.validateAction!(mintAction('nonexistent', 'p1', 1), manifest, state),
        /unknown classId/,
    );
}

function testEventLog(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('coin', 'FT'), manifest, state);
    state = mod.applyAction!(mintAction('coin', 'p1', 100), manifest, state);
    const tok = getTokenState(state);
    assert.equal(tok.eventLog.length, 2);
    assert.equal(tok.eventLog[0]!.kind, 'TOKEN_CLASS_DEFINE');
    assert.equal(tok.eventLog[1]!.kind, 'TOKEN_MINT');
}

function testFinalize(): void {
    const mod = createTokenizationModule();
    let state = mod.init(manifest, baseState());
    state = mod.applyAction!(defineAction('gold', 'FT'), manifest, state);
    state = mod.applyAction!(mintAction('gold', 'p1', 50), manifest, state);
    state = mod.applyAction!(burnAction('gold', 'p1', 10), manifest, state);
    const summary = mod.finalize!(manifest, state);
    const tok = summary.tokenization as {
        totals: { classes: number; byType: { NFT: number; FT: number } };
        supply: Record<string, { minted: number; burned: number; circulating: number }>;
    };
    assert.equal(tok.totals.classes, 1);
    assert.equal(tok.totals.byType.FT, 1);
    assert.equal(tok.supply['gold']!.minted, 50);
    assert.equal(tok.supply['gold']!.burned, 10);
    assert.equal(tok.supply['gold']!.circulating, 40);
}

// ---- Run ----
testInit();
testDefineNFTClass();
testDefineFTClass();
testDuplicateClassReject();
testFTMintAndBalance();
testFTTransfer();
testFTTransferInsufficientBalance();
testFTBurn();
testFTBurnInsufficientBalance();
testNFTMint();
testNFTMintAmountNot1();
testMaxSupply();
testBurnNonBurnable();
testTransferNonTransferable();
testUnknownClass();
testEventLog();
testFinalize();
console.log('tokenization tests passed');

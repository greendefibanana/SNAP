import assert from 'node:assert/strict';
import {
  applyRake,
  calculateProportional,
  calculateSplitTopK,
  calculateWinnerTakeAll,
  validateCustomPayout,
} from './payout.js';

function testWinnerTakeAll(): void {
  const payouts = calculateWinnerTakeAll(101, ['z', 'a']);
  assert.deepEqual(payouts, [
    { recipient: 'a', amount: 51 },
    { recipient: 'z', amount: 50 },
  ]);
}


function testSplitTopK(): void {
  const payouts = calculateSplitTopK(100, [
    { recipient: 'p1', placement: 1 },
    { recipient: 'p2', placement: 2 },
    { recipient: 'p3', placement: 3 },
  ], 2, [3, 1]);
  assert.deepEqual(payouts, [
    { recipient: 'p1', amount: 75 },
    { recipient: 'p2', amount: 25 },
  ]);
}

function testProportional(): void {
  const payouts = calculateProportional(100, [
    { recipient: 'a', score: 3 },
    { recipient: 'b', score: 1 },
  ]);
  assert.deepEqual(payouts, [
    { recipient: 'a', amount: 75 },
    { recipient: 'b', amount: 25 },
  ]);
}

function testCustom(): void {
  const payouts = validateCustomPayout(10, [
    { recipient: 'x', amount: 3 },
    { recipient: 'y', amount: 7 },
  ]);
  assert.equal(payouts.length, 2);
  assert.throws(() => validateCustomPayout(10, [{ recipient: 'x', amount: 9 }]));
}

function testApplyRake(): void {
  const withRake = applyRake(10_000, 500, 'house');
  assert.equal(withRake.distributable, 9_500);
  assert.deepEqual(withRake.rakePayout, { recipient: 'house', amount: 500 });
}

testWinnerTakeAll();
testSplitTopK();
testProportional();
testCustom();
testApplyRake();
console.log('wager payout tests passed');

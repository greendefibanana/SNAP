import assert from 'node:assert/strict';
import type { SnapManifest, SnapState } from '../engine/types.js';
import { __clearRulesetsForTests, getRuleset, registerRuleset } from './registry.js';
import type { RulesetPlugin } from './types.js';

const manifest: SnapManifest = {
  version: '1',
  gameId: 'snapshot',
  rulesetId: 'test-ruleset',
};

const baseState: SnapState = {
  matchId: 'm1',
  phase: 'PREMATCH',
  seq: 0,
  stateHash: 'h0',
  ruleVars: {},
  modules: {},
  custom: {},
};

function testRegisterAndGet(): void {
  __clearRulesetsForTests();

  const plugin: RulesetPlugin = {
    id: 'test-ruleset',
    init(_manifest, state) {
      return state;
    },
    applyAction(_action, _manifest, state) {
      return state;
    },
  };

  registerRuleset(plugin);
  const got = getRuleset('test-ruleset');

  assert.equal(got.id, plugin.id);
  assert.equal(got.init(manifest, baseState), baseState);
}

function testMissingRulesetThrows(): void {
  __clearRulesetsForTests();
  assert.throws(() => getRuleset('missing-ruleset'), /No ruleset plugin registered/);
}

testRegisterAndGet();
testMissingRulesetThrows();
console.log('rulesets registry tests passed');

import assert from 'node:assert/strict';
import { createRegistryModule } from './registry.js';
import type { SnapManifest, SnapState } from '../engine/types.js';

function baseState(): SnapState {
  return {
    matchId: 'm1',
    phase: 'PREMATCH',
    seq: 0,
    stateHash: 'h0',
    ruleVars: {},
    modules: {},
    custom: {},
  };
}

function runAllowlistTest(): void {
  const mod = createRegistryModule();
  const manifest: SnapManifest = {
    version: '1',
    gameId: 'g',
    rulesetId: 'r',
    allowedAssets: ['asset:alpha'],
    policy: 'allowlist',
    temporaryAssetsAllowed: true,
  };

  const state = mod.init(manifest, baseState());

  assert.doesNotThrow(() => mod.validateAction?.({
    matchId: 'm1',
    actor: 'a',
    t: 1,
    kind: 'ASSET_USE',
    payload: { assetId: 'asset:alpha' },
  }, manifest, state));

  assert.throws(() => mod.validateAction?.({
    matchId: 'm1',
    actor: 'a',
    t: 2,
    kind: 'ASSET_USE',
    payload: { assetId: 'asset:beta' },
  }, manifest, state), /not allowlisted/);

  assert.doesNotThrow(() => mod.validateAction?.({
    matchId: 'm1',
    actor: 'a',
    t: 3,
    kind: 'ASSET_USE',
    payload: { assetId: 'temp:session-1' },
  }, manifest, state));
}

function runDenylistTest(): void {
  const mod = createRegistryModule();
  const manifest: SnapManifest = {
    version: '1',
    gameId: 'g',
    rulesetId: 'r',
    allowedAssets: ['asset:block'],
    policy: 'denylist',
    temporaryAssetsAllowed: false,
  };

  const state = mod.init(manifest, baseState());

  assert.throws(() => mod.validateAction?.({
    matchId: 'm1',
    actor: 'a',
    t: 1,
    kind: 'ACTION',
    payload: { assetId: 'asset:block' },
  }, manifest, state), /denylisted/);

  assert.doesNotThrow(() => mod.validateAction?.({
    matchId: 'm1',
    actor: 'a',
    t: 2,
    kind: 'ACTION',
    payload: { assetId: 'asset:ok' },
  }, manifest, state));
}

runAllowlistTest();
runDenylistTest();
console.log('registry module tests passed');

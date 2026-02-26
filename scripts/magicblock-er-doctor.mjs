#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

function hasCmd(cmd) {
  const result = spawnSync('where', [cmd], { stdio: 'pipe' });
  return result.status === 0;
}

function checkEnv(name) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    return { ok: false, value: '<missing>' };
  }
  return { ok: true, value };
}

const checks = [
  ['solana', hasCmd('solana')],
  ['anchor', hasCmd('anchor')],
  ['magicblock', hasCmd('magicblock') || hasCmd('mb-test-validator')],
];

const backendRaw = process.env.SNAP_AUTHORITY_BACKEND?.trim().toLowerCase() ?? '';
const effectiveBackend = backendRaw || 'magicblock';

const envChecks = [
  ['SOLANA_RPC_URL', checkEnv('SOLANA_RPC_URL')],
  ['MAGICBLOCK_RPC_URL', checkEnv('MAGICBLOCK_RPC_URL')],
  ['SNAP_AUTHORITY_BACKEND', backendRaw ? { ok: true, value: backendRaw } : { ok: true, value: '<default: magicblock>' }],
];

console.log('SNAP MagicBlock ER Doctor');
console.log('=========================');
console.log('');

console.log('CLI checks:');
for (const [name, ok] of checks) {
  console.log(`- ${name}: ${ok ? 'ok' : 'missing'}`);
}
console.log('');

console.log('Environment checks:');
for (const [name, result] of envChecks) {
  console.log(`- ${name}: ${result.ok ? 'ok' : 'missing'} (${result.value})`);
}
console.log('');

if (effectiveBackend !== 'magicblock') {
  console.log('WARN: effective backend is not "magicblock".');
}

if (!process.env.MAGICBLOCK_RPC_URL?.trim()) {
  console.log('WARN: MAGICBLOCK_RPC_URL is not set.');
}

if (!process.env.SOLANA_RPC_URL?.trim()) {
  console.log('WARN: SOLANA_RPC_URL is not set.');
}

console.log('');
console.log('Expected multiplayer client config:');
console.log(`createSnapMultiplayerClient({
  programId: '<SNAP_MULTIPLAYER_PROGRAM_ID>',
  signer,
  rpcUrl: process.env.SOLANA_RPC_URL,
  useMagicBlock: true,
  magicblockRpcUrl: process.env.MAGICBLOCK_RPC_URL,
});`);

console.log('');
console.log('Execution model:');
console.log('- Authority transactions route to MagicBlock ER RPC for low latency.');
console.log('- State settlement/finality is anchored to Solana program accounts.');

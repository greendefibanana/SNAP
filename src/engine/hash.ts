import { computeStateHash } from '../core/stateHash.js';
import type { SnapState } from './types.js';

function normalizeRuleVarValue(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => normalizeRuleVarValue(v));
  const input = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(input).sort((a, b) => a.localeCompare(b));
  for (const key of keys) {
    out[key] = normalizeRuleVarValue(input[key]);
  }
  return out;
}

function normalizeState(state: SnapState): unknown {
  return {
    ...state,
    ruleVars: normalizeRuleVarValue(state.ruleVars),
    modules: normalizeRuleVarValue(state.modules),
    custom: normalizeRuleVarValue(state.custom),
  };
}

export function computeSnapStateHash(state: SnapState): string {
  return computeStateHash(normalizeState(state));
}

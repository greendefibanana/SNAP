import type { MatchState } from './types.js';

function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const valueType = typeof value;
  if (valueType === 'number' || valueType === 'boolean') return JSON.stringify(value);
  if (valueType === 'string') return JSON.stringify(value);
  if (valueType !== 'object') return JSON.stringify(String(value));

  if (value instanceof Set) {
    const setItems = [...value].map((item) => stableStringify(item)).sort();
    return `[${setItems.join(',')}]`;
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  const mapped = entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${mapped.join(',')}}`;
}

function fnv1a32(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `snap-rules-v1:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function normalizeStateForHash(state: MatchState): unknown {
  return {
    ...state,
    signalTotals: {
      blue: Number(state.signalTotals.blue.toFixed(6)),
      red: Number(state.signalTotals.red.toFixed(6)),
    },
    grantedDropIds: [...state.grantedDropIds].sort(),
  };
}

export function computeMatchStateHash(state: MatchState): string {
  return fnv1a32(stableStringify(normalizeStateForHash(state)));
}

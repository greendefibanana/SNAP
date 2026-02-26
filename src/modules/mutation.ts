import type { SnapModule } from './types.js';
import type { SnapRuleVarValue, SnapState } from '../engine/types.js';

export interface MutationRuleVarOverride {
  value: SnapRuleVarValue;
  previousValue?: SnapRuleVarValue;
  expiresAtSec: number | null;
}

export interface MutationModifierEntry {
  data: unknown;
  expiresAtSec: number | null;
}

export interface MutationModuleState extends Record<string, unknown> {
  nowSec: number;
  ruleVarOverrides: Record<string, MutationRuleVarOverride>;
  activeModifiers: Record<string, MutationModifierEntry>;
}

function inferRuleVarValue(input: unknown): SnapRuleVarValue {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const maybe = input as Partial<SnapRuleVarValue>;
    if (typeof maybe.type === 'string' && 'value' in maybe) {
      if (maybe.type === 'number') return { type: 'number', value: Number((maybe as any).value ?? 0) };
      if (maybe.type === 'bool') return { type: 'bool', value: Boolean((maybe as any).value) };
      if (maybe.type === 'string') return { type: 'string', value: String((maybe as any).value ?? '') };
      if (maybe.type === 'enum') return { type: 'enum', value: String((maybe as any).value ?? '') };
      if (maybe.type === 'json') return { type: 'json', value: (maybe as any).value };
    }
  }

  if (typeof input === 'number') return { type: 'number', value: input };
  if (typeof input === 'boolean') return { type: 'bool', value: input };
  if (typeof input === 'string') return { type: 'string', value: input };
  return { type: 'json', value: input };
}

function ensureMutationState(state: SnapState): MutationModuleState {
  const existing = state.modules.mutation as MutationModuleState | undefined;
  if (!existing || typeof existing !== 'object') {
    return {
      nowSec: 0,
      ruleVarOverrides: {},
      activeModifiers: {},
    };
  }
  return {
    nowSec: Number.isFinite(existing.nowSec) ? Number(existing.nowSec) : 0,
    ruleVarOverrides: { ...(existing.ruleVarOverrides ?? {}) },
    activeModifiers: { ...(existing.activeModifiers ?? {}) },
  };
}

function resolveExpiry(nowSec: number, ttlSec: unknown): number | null {
  if (ttlSec === undefined || ttlSec === null) return null;
  const ttl = Number(ttlSec);
  if (!Number.isFinite(ttl)) return null;
  return nowSec + Math.max(0, ttl);
}

function finalizeMutationState(base: SnapState, mutation: MutationModuleState, ruleVars: SnapState['ruleVars']): SnapState {
  return {
    ...base,
    ruleVars,
    modules: {
      ...base.modules,
      mutation,
    },
  };
}

function expireMutationEntries(state: SnapState, dtSec: number): SnapState {
  const mutation = ensureMutationState(state);
  const nextNow = mutation.nowSec + Math.max(0, Number.isFinite(dtSec) ? dtSec : 0);

  const nextOverrides: Record<string, MutationRuleVarOverride> = {};
  const nextRuleVars = { ...state.ruleVars };

  for (const [key, entry] of Object.entries(mutation.ruleVarOverrides)) {
    const expired = entry.expiresAtSec !== null && entry.expiresAtSec <= nextNow;
    if (!expired) {
      nextOverrides[key] = entry;
      continue;
    }
    if (entry.previousValue !== undefined) {
      nextRuleVars[key] = entry.previousValue;
    } else {
      delete nextRuleVars[key];
    }
  }

  const nextModifiers: Record<string, MutationModifierEntry> = {};
  for (const [id, entry] of Object.entries(mutation.activeModifiers)) {
    const expired = entry.expiresAtSec !== null && entry.expiresAtSec <= nextNow;
    if (!expired) {
      nextModifiers[id] = entry;
    }
  }

  const nextMutation: MutationModuleState = {
    nowSec: nextNow,
    ruleVarOverrides: nextOverrides,
    activeModifiers: nextModifiers,
  };

  return finalizeMutationState(state, nextMutation, nextRuleVars);
}

export function createMutationModule(): SnapModule {
  return {
    id: 'mutation',
    init(_manifest, state) {
      const mutation = ensureMutationState(state);
      return {
        ...state,
        modules: {
          ...state.modules,
          mutation,
        },
      };
    },
    applyAction(action, _manifest, state) {
      const mutation = ensureMutationState(state);
      const nextRuleVars = { ...state.ruleVars };

      if (action.kind === 'RULEVAR_SET') {
        const payload = (action.payload ?? {}) as { key?: string; value?: unknown; ttlSec?: number };
        const key = String(payload.key ?? '').trim();
        if (!key) return state;

        const value = inferRuleVarValue(payload.value);
        const existing = mutation.ruleVarOverrides[key];
        const previousValue = existing?.previousValue ?? nextRuleVars[key];

        mutation.ruleVarOverrides[key] = {
          value,
          ...(previousValue !== undefined ? { previousValue } : {}),
          expiresAtSec: resolveExpiry(mutation.nowSec, payload.ttlSec),
        };
        nextRuleVars[key] = value;

        return finalizeMutationState(state, mutation, nextRuleVars);
      }

      if (action.kind === 'MODIFIER_START') {
        const payload = (action.payload ?? {}) as { id?: string; data?: unknown; ttlSec?: number };
        const id = String(payload.id ?? '').trim();
        if (!id) return state;
        mutation.activeModifiers[id] = {
          data: payload.data,
          expiresAtSec: resolveExpiry(mutation.nowSec, payload.ttlSec),
        };
        return finalizeMutationState(state, mutation, nextRuleVars);
      }

      if (action.kind === 'MODIFIER_END') {
        const payload = (action.payload ?? {}) as { id?: string };
        const id = String(payload.id ?? '').trim();
        if (!id) return state;
        delete mutation.activeModifiers[id];
        return finalizeMutationState(state, mutation, nextRuleVars);
      }

      return state;
    },
    tick(dtSec, _manifest, state) {
      return expireMutationEntries(state, dtSec);
    },
    finalize(_manifest, state) {
      const mutation = ensureMutationState(state);
      return {
        mutation: {
          nowSec: mutation.nowSec,
          activeModifierIds: Object.keys(mutation.activeModifiers),
          ruleVarOverrideKeys: Object.keys(mutation.ruleVarOverrides),
        },
      };
    },
  };
}

import type { SnapModule } from './types.js';
import type { SnapManifest, SnapState } from '../engine/types.js';

export interface SettlementBreakdownEntry {
  recipient: string;
  amount: number;
  reason?: string;
}

export interface SettlementModuleState extends Record<string, unknown> {
  settled: boolean;
  settledAtT: number | null;
  settlementId: string | null;
  payoutBreakdown: SettlementBreakdownEntry[];
}

function ensureSettlementState(state: SnapState): SettlementModuleState {
  const existing = state.modules.settlement as SettlementModuleState | undefined;
  if (!existing || typeof existing !== 'object') {
    return {
      settled: false,
      settledAtT: null,
      settlementId: null,
      payoutBreakdown: [],
    };
  }

  const payoutBreakdown = Array.isArray(existing.payoutBreakdown)
    ? existing.payoutBreakdown.map((entry) => ({
        recipient: String((entry as SettlementBreakdownEntry).recipient ?? ''),
        amount: Number((entry as SettlementBreakdownEntry).amount ?? 0),
        ...(String((entry as SettlementBreakdownEntry).reason ?? '').trim().length > 0
          ? { reason: String((entry as SettlementBreakdownEntry).reason) }
          : {}),
      }))
    : [];

  return {
    settled: Boolean(existing.settled),
    settledAtT: Number.isFinite(existing.settledAtT) ? Number(existing.settledAtT) : null,
    settlementId: String(existing.settlementId ?? '') || null,
    payoutBreakdown,
  };
}

export function createSettlementModule(): SnapModule {
  return {
    id: 'settlement',
    init(_manifest, state) {
      const settlement = ensureSettlementState(state);
      return {
        ...state,
        modules: {
          ...state.modules,
          settlement,
        },
      };
    },
    validateAction(action, _manifest, _state) {
      if (action.kind !== 'MATCH_SETTLE') return;
      const payload = (action.payload ?? {}) as {
        settlementId?: string;
        payoutBreakdown?: Array<{ recipient?: string; amount?: number; reason?: string }>;
      };

      const entries = Array.isArray(payload.payoutBreakdown) ? payload.payoutBreakdown : [];
      if (entries.length === 0) {
        throw new Error('MATCH_SETTLE requires non-empty payoutBreakdown');
      }
      for (const entry of entries) {
        if (!String(entry.recipient ?? '').trim()) {
          throw new Error('MATCH_SETTLE payoutBreakdown recipient is required');
        }
        if (!Number.isFinite(entry.amount) || Number(entry.amount) < 0) {
          throw new Error('MATCH_SETTLE payoutBreakdown amount must be >= 0');
        }
      }
    },
    applyAction(action, _manifest, state) {
      if (action.kind !== 'MATCH_SETTLE') return state;

      const payload = (action.payload ?? {}) as {
        settlementId?: string;
        payoutBreakdown?: Array<{ recipient?: string; amount?: number; reason?: string }>;
      };

      const settlement: SettlementModuleState = {
        settled: true,
        settledAtT: action.t,
        settlementId: String(payload.settlementId ?? '').trim() || `settle:${state.matchId}:${state.seq + 1}`,
        payoutBreakdown: (Array.isArray(payload.payoutBreakdown) ? payload.payoutBreakdown : []).map((entry) => ({
          recipient: String(entry.recipient ?? ''),
          amount: Number(entry.amount ?? 0),
          ...(String(entry.reason ?? '').trim().length > 0 ? { reason: String(entry.reason) } : {}),
        })),
      };

      return {
        ...state,
        modules: {
          ...state.modules,
          settlement,
        },
      };
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(_manifest, state) {
      const settlement = ensureSettlementState(state);
      return {
        settlement: {
          settled: settlement.settled,
          settledAtT: settlement.settledAtT,
          settlementId: settlement.settlementId,
          payoutBreakdown: settlement.payoutBreakdown,
        },
      };
    },
  };
}

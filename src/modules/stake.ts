import type { SnapModule } from './types.js';
import type { SnapManifest, SnapState } from '../engine/types.js';

export interface StakeRulesConfig extends Record<string, unknown> {
  escalationWindowsSec: number[];
  escalationMultipliers: number[];
}

export interface StakeModuleState extends Record<string, unknown> {
  wagerAmount: number;
  currencyMint: string;
  escrowAccount: string;
  escalationLevel: number;
  locked: boolean;
  lockedAtT: number | null;
  escalationRequestedLevel: number | null;
  escalationRequestedAtT: number | null;
  rules: StakeRulesConfig;
}

function toNumberArray(input: unknown): number[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v) && v >= 0);
}

function readStakeRules(manifest: SnapManifest): StakeRulesConfig {
  const cfg = (manifest.moduleConfig?.stake ?? {}) as Record<string, unknown>;
  const escalationWindowsSec = toNumberArray(cfg.escalationWindowsSec);
  const escalationMultipliers = toNumberArray(cfg.escalationMultipliers);
  return {
    escalationWindowsSec,
    escalationMultipliers,
  };
}

function ensureStakeState(state: SnapState, manifest: SnapManifest): StakeModuleState {
  const existing = state.modules.stake as StakeModuleState | undefined;
  const rules = readStakeRules(manifest);
  if (existing && typeof existing === 'object') {
    return {
      wagerAmount: Number(existing.wagerAmount ?? 0),
      currencyMint: String(existing.currencyMint ?? ''),
      escrowAccount: String(existing.escrowAccount ?? ''),
      escalationLevel: Math.max(0, Math.floor(Number(existing.escalationLevel ?? 0))),
      locked: Boolean(existing.locked),
      lockedAtT: Number.isFinite(existing.lockedAtT) ? Number(existing.lockedAtT) : null,
      escalationRequestedLevel: Number.isFinite(existing.escalationRequestedLevel)
        ? Number(existing.escalationRequestedLevel)
        : null,
      escalationRequestedAtT: Number.isFinite(existing.escalationRequestedAtT)
        ? Number(existing.escalationRequestedAtT)
        : null,
      rules,
    };
  }

  return {
    wagerAmount: 0,
    currencyMint: '',
    escrowAccount: '',
    escalationLevel: 0,
    locked: false,
    lockedAtT: null,
    escalationRequestedLevel: null,
    escalationRequestedAtT: null,
    rules,
  };
}

function maxEscalationLevel(rules: StakeRulesConfig): number {
  const byWindow = rules.escalationWindowsSec.length;
  const byMultiplier = rules.escalationMultipliers.length;
  return Math.max(byWindow, byMultiplier, 1);
}

function isEscalationWindowOpen(stake: StakeModuleState, nowT: number, nextLevel: number): boolean {
  if (stake.lockedAtT === null) return false;
  const idx = Math.max(0, nextLevel - 1);
  const limitSec = stake.rules.escalationWindowsSec[idx];
  if (limitSec === undefined) return true;
  const elapsedSec = Math.max(0, (nowT - stake.lockedAtT) / 1000);
  return elapsedSec <= limitSec;
}

export function createStakeModule(): SnapModule {
  return {
    id: 'stake',
    init(manifest, state) {
      const stake = ensureStakeState(state, manifest);
      return {
        ...state,
        modules: {
          ...state.modules,
          stake,
        },
      };
    },
    validateAction(action, manifest, state) {
      if (action.kind !== 'STAKE_LOCK' && action.kind !== 'ESCALATE_REQUEST' && action.kind !== 'ESCALATE_CONFIRM') {
        return;
      }

      const stake = ensureStakeState(state, manifest);

      if (action.kind === 'STAKE_LOCK') {
        const payload = (action.payload ?? {}) as {
          wagerAmount?: number;
          currencyMint?: string;
          escrowAccount?: string;
        };
        if (!Number.isFinite(payload.wagerAmount) || Number(payload.wagerAmount) <= 0) {
          throw new Error('STAKE_LOCK requires positive wagerAmount');
        }
        if (!String(payload.currencyMint ?? '').trim()) {
          throw new Error('STAKE_LOCK requires currencyMint');
        }
        if (!String(payload.escrowAccount ?? '').trim()) {
          throw new Error('STAKE_LOCK requires escrowAccount');
        }
        return;
      }

      if (!stake.locked) {
        throw new Error(`${action.kind} requires STAKE_LOCK first`);
      }

      if (action.kind === 'ESCALATE_REQUEST') {
        const nextLevel = stake.escalationLevel + 1;
        if (nextLevel > maxEscalationLevel(stake.rules)) {
          throw new Error('ESCALATE_REQUEST exceeds configured escalation levels');
        }
        if (!isEscalationWindowOpen(stake, action.t, nextLevel)) {
          throw new Error('ESCALATE_REQUEST outside escalation window');
        }
      }

      if (action.kind === 'ESCALATE_CONFIRM') {
        if (stake.escalationRequestedLevel === null) {
          throw new Error('ESCALATE_CONFIRM requires an active ESCALATE_REQUEST');
        }
      }
    },
    applyAction(action, manifest, state) {
      const stake = ensureStakeState(state, manifest);

      if (action.kind === 'STAKE_LOCK') {
        const payload = (action.payload ?? {}) as {
          wagerAmount?: number;
          currencyMint?: string;
          escrowAccount?: string;
        };
        const next: StakeModuleState = {
          ...stake,
          wagerAmount: Number(payload.wagerAmount ?? 0),
          currencyMint: String(payload.currencyMint ?? ''),
          escrowAccount: String(payload.escrowAccount ?? ''),
          escalationLevel: 0,
          locked: true,
          lockedAtT: action.t,
          escalationRequestedLevel: null,
          escalationRequestedAtT: null,
        };
        return {
          ...state,
          modules: {
            ...state.modules,
            stake: next,
          },
        };
      }

      if (action.kind === 'ESCALATE_REQUEST') {
        const nextLevel = stake.escalationLevel + 1;
        const next: StakeModuleState = {
          ...stake,
          escalationRequestedLevel: nextLevel,
          escalationRequestedAtT: action.t,
        };
        return {
          ...state,
          modules: {
            ...state.modules,
            stake: next,
          },
        };
      }

      if (action.kind === 'ESCALATE_CONFIRM') {
        const next: StakeModuleState = {
          ...stake,
          escalationLevel: Math.max(stake.escalationLevel, stake.escalationRequestedLevel ?? stake.escalationLevel),
          escalationRequestedLevel: null,
          escalationRequestedAtT: null,
        };
        return {
          ...state,
          modules: {
            ...state.modules,
            stake: next,
          },
        };
      }

      return state;
    },
    tick(_dtSec, _manifest, state) {
      return state;
    },
    finalize(manifest, state) {
      const stake = ensureStakeState(state, manifest);
      const currentMultiplier = stake.rules.escalationMultipliers[Math.max(0, stake.escalationLevel - 1)] ?? 1;
      return {
        stake: {
          wagerAmount: stake.wagerAmount,
          currencyMint: stake.currencyMint,
          escrowAccount: stake.escrowAccount,
          escalationLevel: stake.escalationLevel,
          multiplier: currentMultiplier,
        },
      };
    },
  };
}

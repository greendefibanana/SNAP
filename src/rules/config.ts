import type { MatchConfig } from './types.js';

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  zoneCountdownSec: 30,
  zoneActiveSec: 60,
  signalRatePerSec: 1,
  winSignal: 500,
  dropsEnabled: true,
};

export function createMatchConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    ...DEFAULT_MATCH_CONFIG,
    ...overrides,
  };
}

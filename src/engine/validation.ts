import type { SnapAction } from './types.js';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateActionEnvelope(action: SnapAction): void {
  if (!isNonEmptyString(action.matchId)) {
    throw new Error('Invalid action: matchId is required');
  }
  if (!isNonEmptyString(action.actor)) {
    throw new Error('Invalid action: actor is required');
  }
  if (!isNonEmptyString(action.kind)) {
    throw new Error('Invalid action: kind is required');
  }
  if (!Number.isFinite(action.t)) {
    throw new Error('Invalid action: t must be finite number');
  }
}

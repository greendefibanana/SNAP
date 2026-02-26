import type { WagerPayout } from './types.js';

function assertInt(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
}

function normalizeRecipients(input: string[]): string[] {
  const seen: Record<string, true> = {};
  const out: string[] = [];
  for (const raw of input) {
    const value = String(raw ?? '').trim();
    if (!value || seen[value]) continue;
    seen[value] = true;
    out.push(value);
  }
  return out.sort();
}

function allocateByWeights(total: number, recipients: string[], weights: number[]): WagerPayout[] {
  assertInt(total, 'total');
  if (recipients.length === 0) return [];
  if (weights.length !== recipients.length) {
    throw new Error('weights length must equal recipients length');
  }

  const normalizedWeights = weights.map((w) => Math.floor(Number(w)));
  if (normalizedWeights.some((w) => !Number.isInteger(w) || w < 0)) {
    throw new Error('weights must be non-negative integers');
  }
  const sumWeights = normalizedWeights.reduce((acc, n) => acc + n, 0);
  if (sumWeights <= 0) {
    throw new Error('weights sum must be > 0');
  }

  const prelim = recipients.map((recipient, idx) => {
    const weighted = total * normalizedWeights[idx]!;
    const base = Math.floor(weighted / sumWeights);
    const rem = weighted % sumWeights;
    return { recipient, amount: base, rem };
  });

  let remaining = total - prelim.reduce((acc, item) => acc + item.amount, 0);
  const orderedByRemainder = prelim
    .map((item, idx) => ({ ...item, idx }))
    .sort((a, b) => (b.rem - a.rem) || a.recipient.localeCompare(b.recipient));

  for (let i = 0; i < orderedByRemainder.length && remaining > 0; i += 1) {
    prelim[orderedByRemainder[i]!.idx]!.amount += 1;
    remaining -= 1;
  }

  return prelim
    .map((item) => ({ recipient: item.recipient, amount: item.amount }))
    .sort((a, b) => a.recipient.localeCompare(b.recipient));
}

export function computeRake(totalPot: number, rakeBps: number): number {
  assertInt(totalPot, 'totalPot');
  const safeBps = Math.floor(Number(rakeBps));
  if (!Number.isInteger(safeBps) || safeBps < 0 || safeBps > 10_000) {
    throw new Error('rakeBps must be an integer between 0 and 10000');
  }
  return Math.floor((totalPot * safeBps) / 10_000);
}

export function applyRake(
  totalPot: number,
  rakeBps: number,
  rakeRecipient?: string,
): { distributable: number; rakePayout?: WagerPayout } {
  const rake = computeRake(totalPot, rakeBps);
  const recipient = String(rakeRecipient ?? '').trim();
  if (rake <= 0 || recipient.length === 0) {
    return { distributable: totalPot };
  }
  return {
    distributable: totalPot - rake,
    rakePayout: {
      recipient,
      amount: rake,
    },
  };
}

export function calculateWinnerTakeAll(total: number, winners: string[]): WagerPayout[] {
  const recipients = normalizeRecipients(winners);
  if (recipients.length === 0) return [];
  const equalWeights = recipients.map(() => 1);
  return allocateByWeights(total, recipients, equalWeights);
}

export function calculateSplitTopK(
  total: number,
  placements: Array<{ recipient: string; placement: number }>,
  topK: number,
  weightCurve?: number[],
): WagerPayout[] {
  assertInt(total, 'total');
  const safeTopK = Math.max(1, Math.floor(Number(topK)));
  const eligible = placements
    .map((entry) => ({
      recipient: String(entry.recipient ?? '').trim(),
      placement: Math.floor(Number(entry.placement)),
    }))
    .filter((entry) => entry.recipient.length > 0 && Number.isInteger(entry.placement) && entry.placement > 0)
    .sort((a, b) => (a.placement - b.placement) || a.recipient.localeCompare(b.recipient))
    .slice(0, safeTopK);

  if (eligible.length === 0) return [];
  const recipients = eligible.map((entry) => entry.recipient);
  const weights = Array.isArray(weightCurve) && weightCurve.length > 0
    ? recipients.map((_, idx) => Math.max(0, Math.floor(Number(weightCurve[idx] ?? 0))))
    : recipients.map((_, idx) => Math.max(1, safeTopK - idx));

  return allocateByWeights(total, recipients, weights);
}

export function calculateProportional(
  total: number,
  scores: Array<{ recipient: string; score: number }>,
): WagerPayout[] {
  assertInt(total, 'total');
  const normalized = scores
    .map((entry) => ({
      recipient: String(entry.recipient ?? '').trim(),
      score: Math.floor(Number(entry.score)),
    }))
    .filter((entry) => entry.recipient.length > 0 && Number.isInteger(entry.score) && entry.score > 0)
    .sort((a, b) => a.recipient.localeCompare(b.recipient));

  if (normalized.length === 0) {
    throw new Error('proportional settlement requires positive scores');
  }

  return allocateByWeights(total, normalized.map((item) => item.recipient), normalized.map((item) => item.score));
}

export function validateCustomPayout(total: number, payouts: WagerPayout[]): WagerPayout[] {
  assertInt(total, 'total');
  const normalized = payouts
    .map((entry) => ({
      recipient: String(entry.recipient ?? '').trim(),
      amount: Math.floor(Number(entry.amount)),
    }))
    .filter((entry) => entry.recipient.length > 0)
    .sort((a, b) => a.recipient.localeCompare(b.recipient));

  for (const payout of normalized) {
    assertInt(payout.amount, `custom payout amount for ${payout.recipient}`);
  }

  const sum = normalized.reduce((acc, item) => acc + item.amount, 0);
  if (sum !== total) {
    throw new Error(`custom payout sum ${sum} must equal distributable pot ${total}`);
  }
  return normalized;
}

export function appendAndSortPayouts(base: WagerPayout[], extra?: WagerPayout): WagerPayout[] {
  const payouts = extra ? base.concat(extra) : base.slice();
  return payouts.sort((a, b) => a.recipient.localeCompare(b.recipient));
}

import { runCardGameDemo } from './card-game-demo.js';
import { runDropLootDemo } from './drop-loot-demo.js';
import { runMatchRulesDemo } from './match-rules-demo.js';

export async function runAllRandomnessDemos() {
  const [card, drop, match] = await Promise.all([
    runCardGameDemo(),
    runDropLootDemo(),
    runMatchRulesDemo(),
  ]);
  return { card, drop, match };
}


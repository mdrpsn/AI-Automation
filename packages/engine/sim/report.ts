/**
 * Prints the fairness scorecard for the current weights.
 *
 * Run with `npm run scorecard` after changing anything in `src/cost.ts` or the
 * presets — the assertions in `session.test.ts` catch regressions, this shows
 * you which direction a change actually moved things.
 */

import { runSession, type SimResult } from './session.js';
import { DEFAULT_CONFIG } from '../src/config.js';

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))]!;
}

function regulars(result: SimResult) {
  const longest = Math.max(...result.players.map((p) => p.presentSeconds), 1);
  return result.players.filter((p) => p.presentSeconds >= 0.8 * longest);
}

const sessions = SEEDS.map((seed) => runSession({ seed }));
const allMatches = sessions.flatMap((s) => s.matches);
const allRegulars = sessions.flatMap((s) => regulars(s));
const solveTimes = sessions.flatMap((s) => s.solveTimes);

const partnerRatios: number[] = [];
for (const s of sessions) {
  const partners = new Map<string, Set<string>>();
  for (const m of s.matches) {
    for (const [x, y] of [m.teamA, m.teamB]) {
      if (!partners.has(x)) partners.set(x, new Set());
      if (!partners.has(y)) partners.set(y, new Set());
      partners.get(x)!.add(y);
      partners.get(y)!.add(x);
    }
  }
  for (const p of regulars(s)) {
    partnerRatios.push((partners.get(p.id)?.size ?? 0) / Math.max(1, p.gamesPlayed));
  }
}

const courtMinuteError: number[] = [];
for (const s of sessions) {
  const group = regulars(s);
  const mean = group.reduce((sum, p) => sum + p.courtSeconds, 0) / group.length;
  for (const p of group) courtMinuteError.push(Math.abs(p.courtSeconds - mean) / mean);
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

console.log(`\nFairness scorecard — ${SEEDS.length} sessions, 28 players, 4 courts, 3h`);
console.log(`Preset: balanced (cap ${DEFAULT_CONFIG.spreadCap})`);
console.log(`Weights: ${JSON.stringify(DEFAULT_CONFIG.weights)}\n`);

console.table({
  'matches played': { value: allMatches.length },
  'games per regular (p10-p90)': {
    value: `${quantile(allRegulars.map((p) => p.gamesPlayed), 0.1)}-${quantile(
      allRegulars.map((p) => p.gamesPlayed),
      0.9,
    )}`,
  },
  'worst wait (rotations, p99)': {
    value: quantile(allRegulars.map((p) => p.maxWaitRotations), 0.99).toFixed(2),
  },
  'worst wait (rotations, max)': {
    value: Math.max(...allRegulars.map((p) => p.maxWaitRotations)).toFixed(2),
  },
  'court-minute error (p95)': { value: pct(quantile(courtMinuteError, 0.95)) },
  'within spread cap': {
    value: pct(
      allMatches.filter((m) => m.spread <= DEFAULT_CONFIG.spreadCap + 1e-9).length /
        allMatches.length,
    ),
  },
  'max spread seen': { value: Math.max(...allMatches.map((m) => m.spread)).toFixed(2) },
  'team imbalance (p90)': { value: quantile(allMatches.map((m) => m.imbalance), 0.9).toFixed(3) },
  'close games (true p in .3-.7)': {
    value: pct(
      allMatches.filter((m) => m.trueWinProbA >= 0.3 && m.trueWinProbA <= 0.7).length /
        allMatches.length,
    ),
  },
  'partner variety (median)': { value: quantile(partnerRatios, 0.5).toFixed(2) },
  'partner variety (p10)': { value: quantile(partnerRatios, 0.1).toFixed(2) },
  'idle courts with a queue': { value: sessions.reduce((n, s) => n + s.idleWithQueue, 0) },
  'solve p50 / p99 (ms)': {
    value: `${quantile(solveTimes, 0.5)} / ${quantile(solveTimes, 0.99)}`,
  },
});

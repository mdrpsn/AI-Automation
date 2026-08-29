import { describe, expect, it } from 'vitest';
import { runSession, type SimPlayer, type SimResult } from './session.js';
import { fillCourts } from '../src/select.js';
import { settleSession } from '../src/rating.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { makeRng } from '../src/rng.js';
import type { CourtState, PlayerState, Snapshot } from '../src/types.js';

/** Seeds run for every statistical invariant, so one lucky session cannot pass. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[idx]!;
}

/** Players present for most of the session — the ones equity claims apply to. */
function regulars(result: SimResult): SimPlayer[] {
  const longest = Math.max(...result.players.map((p) => p.presentSeconds), 1);
  return result.players.filter((p) => p.presentSeconds >= 0.8 * longest);
}

const sessions = SEEDS.map((seed) => runSession({ seed }));

describe('the simulated session is actually exercising the engine', () => {
  it('runs a realistic number of games', () => {
    for (const s of sessions) {
      // 4 courts * 180 min / ~12 min per game is ~60 games.
      expect(s.matches.length).toBeGreaterThan(35);
      expect(s.players.length).toBe(28);
      expect(s.players.some((p) => p.arrivesAt > p.leavesAt - 1000)).toBe(false);
    }
  });

  it('actually exercises churn, or the invariants prove nothing', () => {
    // Aggregate across seeds: any single session can happen to have no breaks.
    const all = sessions.flatMap((s) => s.players);
    const start = Math.min(...all.map((p) => p.arrivesAt));

    expect(all.filter((p) => p.breakStart !== undefined).length).toBeGreaterThan(5);
    expect(all.filter((p) => p.ghostAt !== undefined).length).toBeGreaterThan(3);
    expect(all.filter((p) => p.arrivesAt > start + 60_000).length).toBeGreaterThan(20);
  });
});

describe('BLOCKING: nobody gets stranded', () => {
  it('holds every regular under 3 rotations of waiting', () => {
    // The headline promise. A sign-flipped priority term fails this instantly.
    for (const s of sessions) {
      for (const p of regulars(s)) {
        expect(
          p.maxWaitRotations,
          `${p.id} waited ${p.maxWaitRotations.toFixed(2)} rotations in seed ${s.options.seed}`,
        ).toBeLessThan(3.0);
      }
    }
  });

  it('gets every regular onto court at least a few times', () => {
    for (const s of sessions) {
      for (const p of regulars(s)) {
        expect(p.gamesPlayed, `${p.id} played ${p.gamesPlayed}`).toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('BLOCKING: courts do not sit idle', () => {
  it('never leaves an open court unfilled while four are waiting', () => {
    for (const s of sessions) {
      expect(s.idleWithQueue, `seed ${s.options.seed}`).toBe(0);
    }
  });
});

describe('BLOCKING: the blowout guard holds', () => {
  it('keeps all but a few percent of matches inside the spread cap', () => {
    for (const s of sessions) {
      const withinCap = s.matches.filter((m) => m.spread <= DEFAULT_CONFIG.spreadCap + 1e-9);
      const share = withinCap.length / s.matches.length;
      expect(share, `seed ${s.options.seed}: ${(share * 100).toFixed(1)}% in band`).toBeGreaterThan(
        0.9,
      );
    }
  });

  it('never lets any match run far past the cap', () => {
    for (const s of sessions) {
      for (const m of s.matches) {
        expect(m.spread).toBeLessThanOrEqual(DEFAULT_CONFIG.spreadCap + 0.75);
      }
    }
  });
});

describe('BLOCKING: the engine is a total function', () => {
  it('never throws and never returns an invalid assignment on fuzzed input', () => {
    const rng = makeRng(0xc0ffee);
    const statuses: PlayerState['status'][] = ['waiting', 'playing', 'paused', 'left'];

    for (let iteration = 0; iteration < 3000; iteration++) {
      const n = rng.int(40);
      const shape = rng.int(5);

      const players: PlayerState[] = Array.from({ length: n }, (_, i) => {
        // Deliberately nasty rating distributions.
        const rating =
          shape === 0
            ? 3.5 // everyone identical
            : shape === 1
              ? rng.next() < 0.5
                ? 3.0
                : 4.5 // bimodal, empty middle
              : 2.0 + rng.next() * 3.5;
        return {
          id: `p${i}`,
          name: `P${i}`,
          rating,
          status: shape === 3 ? 'paused' : statuses[rng.int(4)]!,
          availableSince: 1_700_000_000_000 - rng.int(3_600_000),
          presentSeconds: rng.int(7200),
          gamesPlayed: rng.int(10),
          courtSeconds: rng.int(6000),
          stretchCredit: rng.int(3),
          ...(rng.next() < 0.15 ? { avoid: [`p${rng.int(Math.max(1, n))}`] } : {}),
        };
      });

      const courts: CourtState[] = Array.from({ length: rng.int(9) }, (_, i) => ({
        id: `c${i}`,
        label: `C${i}`,
        status: (['open', 'in_use', 'closed'] as const)[rng.int(3)]!,
      }));

      const ids = players.map((p) => p.id);
      const pick = () => (ids.length ? ids[rng.int(ids.length)]! : 'nobody');

      const snapshot: Snapshot = {
        now: 1_700_000_000_000,
        players,
        courts,
        history: [],
        config: DEFAULT_CONFIG,
        overrides: {
          pinned: rng.next() < 0.3 ? [pick()] : [],
          excluded: rng.next() < 0.3 ? [pick()] : [],
          // Contradictory constraints are deliberately allowed through.
          mustPairWith: rng.next() < 0.3 ? [[pick(), pick()]] : [],
          ...(rng.next() < 0.2 && courts.length > 0
            ? { lockedSlots: { [courts[0]!.id]: [pick(), pick()] } }
            : {}),
        },
      };

      const result = fillCourts(snapshot);

      const assigned = result.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
      // No duplicates, anywhere.
      expect(new Set(assigned).size).toBe(assigned.length);

      const excluded = new Set(snapshot.overrides!.excluded!);
      const byId = new Map(players.map((p) => [p.id, p]));
      for (const id of assigned) {
        const p = byId.get(id);
        expect(p, `unknown player ${id} returned`).toBeDefined();
        // Only genuinely available players may be put on court.
        expect(p!.status).toBe('waiting');
        expect(excluded.has(id)).toBe(false);
      }

      // Every match is on a distinct, open court.
      const usedCourts = result.matches.map((m) => m.courtId);
      expect(new Set(usedCourts).size).toBe(usedCourts.length);
      const openIds = new Set(courts.filter((c) => c.status === 'open').map((c) => c.id));
      for (const id of usedCourts) expect(openIds.has(id)).toBe(true);
    }
  });
});

describe('BLOCKING: determinism', () => {
  it('replays an entire session identically', () => {
    const a = runSession({ seed: 42 });
    const b = runSession({ seed: 42 });
    expect(JSON.stringify(b.matches)).toBe(JSON.stringify(a.matches));
  });
});

describe('scorecard: fairness', () => {
  it('gives the bulk of the regulars near-identical game counts', () => {
    for (const s of sessions) {
      const games = regulars(s).map((p) => p.gamesPlayed);
      const spread = quantile(games, 0.9) - quantile(games, 0.1);
      expect(
        spread,
        `seed ${s.options.seed}: p10-p90 games ${quantile(games, 0.1)}-${quantile(games, 0.9)}`,
      ).toBeLessThanOrEqual(2);
    }
  });

  it('does not abandon a skill outlier, even though it cannot fully equalize them', () => {
    // A lone 2.25 in a pool clustered at 2.75-4.0 genuinely has fewer in-band
    // partners, and forcing parity would mean wrecking everyone else's games to
    // manufacture partners that do not exist. The engine should still keep them
    // meaningfully involved rather than parking them on the bench all night.
    for (const s of sessions) {
      const games = regulars(s).map((p) => p.gamesPlayed);
      const median = quantile(games, 0.5);
      expect(
        Math.min(...games) / median,
        `seed ${s.options.seed}: worst-served regular got ${Math.min(...games)} vs median ${median}`,
      ).toBeGreaterThanOrEqual(0.55);
    }
  });

  it('shares court minutes evenly among the regulars', () => {
    for (const s of sessions) {
      const group = regulars(s);
      const mean = group.reduce((sum, p) => sum + p.courtSeconds, 0) / group.length;
      const errors = group.map((p) => Math.abs(p.courtSeconds - mean) / mean);
      expect(quantile(errors, 0.95), `seed ${s.options.seed}`).toBeLessThan(0.35);
    }
  });

  it('does not repeatedly draft the same accommodating strong player down', () => {
    for (const s of sessions) {
      const stretches = s.players.map((p) => p.stretchCount);
      const mean = stretches.reduce((a, b) => a + b, 0) / stretches.length;
      if (mean < 0.5) continue; // barely any stretching happened
      expect(Math.max(...stretches)).toBeLessThanOrEqual(Math.max(3, mean * 3));
    }
  });
});

describe('scorecard: match quality', () => {
  it('produces games that are genuinely close on hidden true ratings', () => {
    for (const s of sessions) {
      const close = s.matches.filter(
        (m) => m.trueWinProbA >= 0.3 && m.trueWinProbA <= 0.7,
      ).length;
      const share = close / s.matches.length;
      expect(share, `seed ${s.options.seed}: ${(share * 100).toFixed(1)}% close`).toBeGreaterThan(
        0.7,
      );
    }
  });

  it('keeps team averages near level', () => {
    for (const s of sessions) {
      const imbalances = s.matches.map((m) => m.imbalance);
      expect(quantile(imbalances, 0.9)).toBeLessThanOrEqual(0.3);
    }
  });

  it('mixes partners rather than forming cliques', () => {
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
      // Judged on the distribution, not per player: skill banding genuinely
      // limits who someone at the edge of a band can partner, so requiring
      // every single player to clear the bar would be testing the wrong thing.
      const ratios = regulars(s).map(
        (p) => (partners.get(p.id)?.size ?? 0) / Math.max(1, p.gamesPlayed),
      );
      const median = quantile(ratios, 0.5);
      expect(median, `seed ${s.options.seed}: median ${median.toFixed(2)}`).toBeGreaterThan(0.65);
      expect(quantile(ratios, 0.1), `seed ${s.options.seed} p10`).toBeGreaterThan(0.45);
    }
  });
});

describe('scorecard: latency', () => {
  it('solves fast enough to feel instant on a phone', () => {
    const all = sessions.flatMap((s) => s.solveTimes);
    expect(quantile(all, 0.99), `p99 ${quantile(all, 0.99)}ms`).toBeLessThan(50);
  });

  it('stays responsive at the largest realistic session', () => {
    // 60 players across 8 courts. What matters is that a tap feels instant, so
    // the typical solve is held well inside the perceptual threshold and even
    // the tail stays under a noticeable pause. The p99 only occurs when every
    // court frees at once, which is essentially just the start of a session.
    const big = runSession({ seed: 9, playerCount: 60, courtCount: 8 });
    expect(quantile(big.solveTimes, 0.5), 'p50').toBeLessThan(60);
    expect(quantile(big.solveTimes, 0.99), 'p99').toBeLessThan(250);
  });
});


describe('scorecard: rating convergence', () => {
  /**
   * There is a real tension worth naming here: the better the matcher gets, the
   * less each result tells you. A well-matched game is close to a coin flip,
   * and a coin flip says almost nothing about who is actually better.
   *
   * Signal and noise both scale with K, so no choice of K fixes this — only
   * more evidence does. Hence the two properties below: never move a rating on
   * one inconclusive night, and do converge once evidence has accumulated.
   */

  it('never moves a rating on one session of inconclusive evidence', () => {
    // The safety property. Without the evidence gate, a correctly-rated player
    // random-walks away from the truth and ratings get worse over time.
    let errorBefore = 0;
    let errorAfter = 0;

    for (const s of sessions) {
      const rated = s.players.filter((p) => p.ratedGames >= 5);
      const { pending } = settleSession(
        rated.map((p) => ({
          playerId: p.id,
          rating: p.rating,
          ratingLocked: false,
          pendingDelta: p.accumulatedDelta,
          pendingGames: p.ratedGames,
          priorRatedGames: p.ratedGames,
        })),
      );
      const applied = new Map(pending.map((c) => [c.playerId, c.after]));

      for (const p of rated) {
        errorBefore += Math.abs(p.trueRating - p.rating);
        errorAfter += Math.abs(p.trueRating - (applied.get(p.id) ?? p.rating));
      }
    }

    expect(
      errorAfter,
      `total error ${errorBefore.toFixed(2)} -> ${errorAfter.toFixed(2)}`,
    ).toBeLessThanOrEqual(errorBefore);
  });

  it('corrects players the organizer genuinely mis-rated, and leaves the rest alone', () => {
    // This is the case that matters. Most of a roster is rated about right, and
    // there is nothing there to fix — the win is the handful of people the
    // organizer guessed badly wrong about.
    //
    // The two groups are checked together on purpose: a rating engine that
    // fixes the mis-rated by shaking everyone else around has not helped.
    const probe = runSession({ seed: 900, playerCount: 24, courtCount: 3 });
    const truth = new Map(probe.players.map((p) => [p.id, p.trueRating]));

    // Deliberately mis-rate every third player by 0.75 in alternating directions.
    const misrated = new Set<string>();
    let ratings = new Map(
      probe.players.map((p, i) => {
        if (i % 3 !== 0) return [p.id, p.trueRating];
        misrated.add(p.id);
        return [p.id, Math.max(2, Math.min(5.5, p.trueRating + (i % 2 === 0 ? 0.75 : -0.75)))];
      }),
    );

    const errorOf = (group: Set<string> | null) => {
      const ids = [...ratings.keys()].filter((id) => (group ? group.has(id) : !misrated.has(id)));
      return ids.reduce((sum, id) => sum + Math.abs(truth.get(id)! - ratings.get(id)!), 0) / ids.length;
    };

    const startMisrated = errorOf(misrated);
    const startCorrect = errorOf(null);

    let carried = new Map<string, { pendingDelta: number; pendingGames: number }>();
    const lifetimeGames = new Map<string, number>();

    // Corrections land roughly every 8 and then every 18 sessions as the error
    // shrinks and the evidence needed grows, so this needs a real stretch of
    // play — about a season of weekly open plays — to show two of them.
    for (let session = 0; session < 40; session++) {
      const result = runSession({
        seed: 900 + session,
        playerCount: 24,
        courtCount: 3,
        initialRatings: ratings,
        initialTrueRatings: truth,
      });

      const settlement = settleSession(
        result.players.map((p) => {
          const prior = carried.get(p.id) ?? { pendingDelta: 0, pendingGames: 0 };
          const lifetime = (lifetimeGames.get(p.id) ?? 0) + p.ratedGames;
          lifetimeGames.set(p.id, lifetime);
          return {
            playerId: p.id,
            rating: p.rating,
            ratingLocked: false,
            pendingDelta: prior.pendingDelta + p.accumulatedDelta,
            pendingGames: prior.pendingGames + p.ratedGames,
            priorRatedGames: lifetime,
          };
        }),
      );

      const applied = new Map(settlement.pending.map((c) => [c.playerId, c.after]));
      carried = settlement.carry;
      ratings = new Map(result.players.map((p) => [p.id, applied.get(p.id) ?? p.rating]));
    }

    const endMisrated = errorOf(misrated);
    const endCorrect = errorOf(null);

    // The mis-rated must be pulled materially toward the truth. The pace is
    // deliberately limited by `sessionDriftCap`, so a season of play buys about
    // one full correction rather than snapping straight to the right number —
    // an organizer's rating should not lurch, it should be nudged.
    expect(
      startMisrated - endMisrated,
      `mis-rated error ${startMisrated.toFixed(3)} -> ${endMisrated.toFixed(3)}`,
    ).toBeGreaterThanOrEqual(0.15);

    // ...without dragging the correctly-rated majority off their marks.
    expect(
      endCorrect,
      `correctly-rated error ${startCorrect.toFixed(3)} -> ${endCorrect.toFixed(3)}`,
    ).toBeLessThan(0.2);
  });
});

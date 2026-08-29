import { describe, expect, it } from 'vitest';
import { bestSplit, spreadCost, pairCost } from '../src/cost.js';
import type { CostContext, Foursome } from '../src/cost.js';
import { buildHardConstraints } from '../src/cost.js';
import { buildPairHistory } from '../src/history.js';
import { makePriorityContext } from '../src/priority.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import { match, player, snapshot, T0 } from './fixtures.js';

function ctxFor(players = [player('a', 3.5)], history = buildPairHistory([])): CostContext {
  const snap = snapshot(players);
  return {
    config: snap.config,
    priorityCtx: makePriorityContext(snap),
    history,
    hard: buildHardConstraints(players),
    poolSize: Math.max(players.length, 8),
  };
}

describe('spreadCost — hinge, not hard reject', () => {
  it('is zero for an identical foursome and 1.0 exactly at the cap', () => {
    expect(spreadCost(0, 0.6)).toBe(0);
    expect(spreadCost(0.6, 0.6)).toBeCloseTo(1, 10);
  });

  it('grows gently below the cap', () => {
    expect(spreadCost(0.3, 0.6)).toBeCloseTo(0.25, 10);
  });

  it('becomes overwhelming past the cap, so over-cap is a last resort', () => {
    // An over-cap match must cost far more than any realistic in-band match, so
    // it is only ever chosen when nothing else exists.
    expect(spreadCost(0.9, 0.6)).toBeGreaterThan(10);
    expect(spreadCost(1.2, 0.6)).toBeGreaterThan(40);
  });

  it('is monotonic — a wider spread never costs less', () => {
    let previous = -1;
    for (let s = 0; s <= 2; s += 0.05) {
      const cost = spreadCost(s, 0.6);
      expect(cost).toBeGreaterThanOrEqual(previous);
      previous = cost;
    }
  });

  it('never returns a non-finite number, even at a zero cap', () => {
    expect(Number.isFinite(spreadCost(0.5, 0))).toBe(true);
    expect(spreadCost(0, 0)).toBe(0);
  });
});

describe('team selection', () => {
  const stackedOrFlat = () =>
    [
      player('p1', 4.5),
      player('p2', 3.5),
      player('p3', 4.0),
      player('p4', 4.0),
    ] as unknown as Foursome;

  it('accepts a stacked pair when it is the only way to level the teams', () => {
    // Two real options for 4.5/4.0/4.0/3.5:
    //   stacked: (4.5,3.5) v (4.0,4.0) -> averages dead level, 1.0 within-team gap
    //   flat:    (4.5,4.0) v (3.5,4.0) -> 0.5 average gap, 0.5 within-team gap
    // A 0.5 team-average gap is a visibly one-sided game, so under Balanced the
    // level-averages option wins. The gap term is a counterweight, not a veto.
    const { lineup, breakdown } = bestSplit(stackedOrFlat(), ctxFor());
    const teamA = [lineup[0].rating, lineup[1].rating].sort();

    expect(teamA).toEqual([3.5, 4.5]);
    expect(breakdown.rawImbalance).toBeCloseTo(0, 10);
    expect(breakdown.rawIntraGap).toBeCloseTo(1.0, 10);
  });

  it('switches to the flat split once the gap term is weighted above balance', () => {
    // Proves the intra-team gap term is wired in and can actually decide the
    // split, rather than being dead weight the imbalance term always overrides.
    const ctx = ctxFor();
    const gapAverse: CostContext = {
      ...ctx,
      config: {
        ...ctx.config,
        weights: { ...ctx.config.weights, imbalance: 1.0, intraGap: 10.0 },
      },
    };

    const { lineup, breakdown } = bestSplit(stackedOrFlat(), gapAverse);
    const teamA = [lineup[0].rating, lineup[1].rating].sort();

    expect(teamA).toEqual([4.0, 4.5]);
    expect(breakdown.rawIntraGap).toBeCloseTo(0.5, 10);
  });

  it('balances team averages when it can do so without stacking', () => {
    const four = [
      player('p1', 4.0),
      player('p2', 3.0),
      player('p3', 3.5),
      player('p4', 3.5),
    ] as unknown as Foursome;

    const { breakdown } = bestSplit(four, ctxFor([...four]));
    expect(breakdown.rawImbalance).toBeCloseTo(0, 10);
  });
});

describe('pairCost — relative to expectation, not absolute', () => {
  it('is zero for two players who have never met', () => {
    const a = player('a', 3.5, { gamesPlayed: 0 });
    const b = player('b', 3.5, { gamesPlayed: 0 });
    expect(pairCost(a, b, true, buildPairHistory([]), 12)).toBe(0);
  });

  it('penalizes a partner repeat more than an opponent repeat', () => {
    const history = buildPairHistory([match(1, ['a', 'b'], ['c', 'd'], T0)]);
    const a = player('a', 3.5, { gamesPlayed: 1 });
    const b = player('b', 3.5, { gamesPlayed: 1 });
    const c = player('c', 3.5, { gamesPlayed: 1 });

    const partnerRepeat = pairCost(a, b, true, history, 12);
    const opponentRepeat = pairCost(a, c, false, history, 12);

    expect(partnerRepeat).toBeGreaterThan(0);
    expect(partnerRepeat).toBeGreaterThan(opponentRepeat);
  });

  it('does not saturate in a small pool where everyone has played everyone', () => {
    // 8 players, many games: an absolute count would flag every pair equally.
    // Expectation-relative cost still separates over-repeated pairs from normal ones.
    const history = buildPairHistory([
      match(1, ['a', 'b'], ['c', 'd'], T0),
      match(2, ['a', 'b'], ['e', 'f'], T0),
      match(3, ['a', 'b'], ['g', 'h'], T0),
      match(4, ['a', 'c'], ['d', 'e'], T0),
    ]);
    const a = player('a', 3.5, { gamesPlayed: 4 });
    const b = player('b', 3.5, { gamesPlayed: 3 });
    const c = player('c', 3.5, { gamesPlayed: 2 });

    const overRepeated = pairCost(a, b, true, history, 8); // partnered 3 times
    const normal = pairCost(a, c, true, history, 8); // partnered once
    expect(overRepeated).toBeGreaterThan(normal);
  });

  it('decays as the repeat recedes into the past', () => {
    const recent = buildPairHistory([
      match(1, ['x', 'y'], ['w', 'z'], T0),
      match(2, ['a', 'b'], ['c', 'd'], T0),
    ]);
    const old = buildPairHistory([
      match(1, ['a', 'b'], ['c', 'd'], T0),
      ...Array.from({ length: 10 }, (_, i) =>
        match(i + 2, ['x', 'y'], ['w', 'z'], T0),
      ),
    ]);

    const a = player('a', 3.5, { gamesPlayed: 1 });
    const b = player('b', 3.5, { gamesPlayed: 1 });

    expect(pairCost(a, b, true, recent, 12)).toBeGreaterThan(
      pairCost(a, b, true, old, 12),
    );
  });
});

describe('priority enters the cost as a reward', () => {
  it('lowers total cost for a foursome of long waiters', () => {
    const now = T0 + 60 * 60_000;
    const fresh = [
      player('f1', 3.5, { availableSince: now }),
      player('f2', 3.5, { availableSince: now }),
      player('f3', 3.5, { availableSince: now }),
      player('f4', 3.5, { availableSince: now }),
    ];
    const waited = [
      player('w1', 3.5, { availableSince: now - 20 * 60_000 }),
      player('w2', 3.5, { availableSince: now - 20 * 60_000 }),
      player('w3', 3.5, { availableSince: now - 20 * 60_000 }),
      player('w4', 3.5, { availableSince: now - 20 * 60_000 }),
    ];

    const snap = snapshot([...fresh, ...waited], 1, { now });
    const ctx: CostContext = {
      config: DEFAULT_CONFIG,
      priorityCtx: makePriorityContext(snap),
      history: buildPairHistory([]),
      hard: buildHardConstraints(snap.players),
      poolSize: 8,
    };

    const freshCost = bestSplit(fresh as unknown as Foursome, ctx).breakdown.total;
    const waitedCost = bestSplit(waited as unknown as Foursome, ctx).breakdown.total;

    // Identical on every skill term; only wait differs. If priority were ADDED
    // instead of subtracted this assertion flips and the engine would prefer
    // players who just walked off court.
    expect(waitedCost).toBeLessThan(freshCost);
  });
});

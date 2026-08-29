import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RATING_CONFIG,
  actualScore,
  expectedScore,
  ratingDelta,
  settleSession,
} from '../src/rating.js';
import type { RatingEvidence } from '../src/rating.js';

const CFG = DEFAULT_RATING_CONFIG;

describe('expectedScore', () => {
  it('is even between equal teams', () => {
    expect(expectedScore(3.5, 3.5, CFG.scale)).toBeCloseTo(0.5, 10);
  });

  it('puts a half-point gap near 2:1, not at a blowout', () => {
    // A 0.75 scale implied 82/18 for a 0.5 gap, which is far steeper than rec
    // doubles actually plays. This is the single most important calibration.
    const p = expectedScore(4.0, 3.5, CFG.scale);
    expect(p).toBeGreaterThan(0.6);
    expect(p).toBeLessThan(0.72);
  });

  it('is symmetric', () => {
    expect(expectedScore(4.0, 3.0, CFG.scale) + expectedScore(3.0, 4.0, CFG.scale)).toBeCloseTo(
      1,
      10,
    );
  });
});

describe('actualScore', () => {
  it('returns null for an unrecorded result, so ratings do not move', () => {
    expect(
      actualScore({ teamARatings: [3.5, 3.5], teamBRatings: [3.5, 3.5], winner: null }),
    ).toBeNull();
  });

  it('falls back to a clean win/loss when no score was entered', () => {
    expect(
      actualScore({ teamARatings: [3.5, 3.5], teamBRatings: [3.5, 3.5], winner: 'a' }),
    ).toBe(1);
  });

  it('keeps margin mild and clamped', () => {
    const blowout = actualScore({
      teamARatings: [3.5, 3.5],
      teamBRatings: [3.5, 3.5],
      winner: 'a',
      scoreA: 11,
      scoreB: 0,
    })!;
    const squeaker = actualScore({
      teamARatings: [3.5, 3.5],
      teamBRatings: [3.5, 3.5],
      winner: 'a',
      scoreA: 11,
      scoreB: 9,
    })!;

    expect(blowout).toBeGreaterThan(squeaker);
    // Games to 11 win-by-2 compress the range; one cold streak on serve should
    // not look like a skill gap.
    expect(blowout).toBeLessThanOrEqual(0.85);
    expect(squeaker).toBeGreaterThanOrEqual(0.55);
  });

  it('never credits the loser above the winner', () => {
    const aWon = actualScore({
      teamARatings: [3.5, 3.5],
      teamBRatings: [3.5, 3.5],
      winner: 'a',
      scoreA: 11,
      scoreB: 9,
    })!;
    const bWon = actualScore({
      teamARatings: [3.5, 3.5],
      teamBRatings: [3.5, 3.5],
      winner: 'b',
      scoreA: 9,
      scoreB: 11,
    })!;
    expect(aWon).toBeGreaterThan(0.5);
    expect(bWon).toBeLessThan(0.5);
  });
});

describe('ratingDelta', () => {
  it('is zero-sum between the two teams for equal experience levels', () => {
    const d = ratingDelta(
      { teamARatings: [3.5, 3.5], teamBRatings: [3.5, 3.5], winner: 'a' },
      [20, 20, 20, 20],
    );
    expect(d.teamA).toBeCloseTo(-d.teamB, 10);
  });

  it('rewards an upset far more than an expected win', () => {
    const upset = ratingDelta(
      { teamARatings: [3.0, 3.0], teamBRatings: [4.0, 4.0], winner: 'a' },
      [20, 20, 20, 20],
    );
    const expectedWin = ratingDelta(
      { teamARatings: [4.0, 4.0], teamBRatings: [3.0, 3.0], winner: 'a' },
      [20, 20, 20, 20],
    );
    expect(upset.teamA).toBeGreaterThan(expectedWin.teamA);
    expect(expectedWin.teamA).toBeGreaterThan(0);
  });

  it('moves a provisional player faster than an established one', () => {
    const provisional = ratingDelta(
      { teamARatings: [3.5, 3.5], teamBRatings: [3.5, 3.5], winner: 'a' },
      [0, 0, 20, 20],
    );
    const established = ratingDelta(
      { teamARatings: [3.5, 3.5], teamBRatings: [3.5, 3.5], winner: 'a' },
      [20, 20, 20, 20],
    );
    expect(Math.abs(provisional.teamA)).toBeGreaterThan(Math.abs(established.teamA));
  });

  it('does not move ratings at all on an unrecorded result', () => {
    const d = ratingDelta(
      { teamARatings: [3.0, 3.0], teamBRatings: [4.5, 4.5], winner: null },
      [1, 1, 1, 1],
    );
    expect(d).toEqual({ teamA: 0, teamB: 0 });
  });
});


describe('settleSession', () => {
  // A month or so of play for an established player. Over 40 games the noise
  // band is 2.5 * 0.03 * 0.5 * sqrt(40) = 0.237.
  const evidence = (over: Partial<RatingEvidence> = {}): RatingEvidence => ({
    playerId: 'a',
    rating: 3.5,
    ratingLocked: false,
    pendingDelta: 0,
    pendingGames: 40,
    priorRatedGames: 60,
    ...over,
  });

  it('never moves a locked rating, and banks no evidence for one', () => {
    const { pending, carry } = settleSession([
      evidence({ ratingLocked: true, pendingDelta: 0.9 }),
    ]);
    expect(pending).toEqual([]);
    expect(carry.get('a')).toEqual({ pendingDelta: 0, pendingGames: 0 });
  });

  it('refuses to re-rate anyone on a single night of play', () => {
    // One open-play session is about nine games. Whatever happened, it is not
    // enough to tell a mis-rating from a hot streak.
    const { pending, carry } = settleSession([
      evidence({ pendingDelta: 0.9, pendingGames: 9 }),
    ]);
    expect(pending).toEqual([]);
    // The evidence is kept, so a real trend still surfaces later.
    expect(carry.get('a')).toEqual({ pendingDelta: 0.9, pendingGames: 9 });
  });

  it('ignores drift no larger than chance would produce', () => {
    const { pending, carry } = settleSession([evidence({ pendingDelta: 0.1 })]);
    expect(pending).toEqual([]);
    expect(carry.get('a')!.pendingDelta).toBeCloseTo(0.1, 10);
    expect(carry.get('a')!.pendingGames).toBe(40);
  });

  it('acts once the evidence clears the noise band', () => {
    const { pending, carry } = settleSession([evidence({ pendingDelta: 0.4 })]);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.after).toBeGreaterThan(3.5);
    // Evidence about the old rating is spent once the rating moves.
    expect(carry.get('a')).toEqual({ pendingDelta: 0, pendingGames: 0 });
  });

  it('applies the full accumulated delta, not just the excess over the band', () => {
    // Shrinking by the band as well would double-count the caution: since the
    // evidence resets on a change, each firing would contribute only a sliver.
    // 35 games puts the band at 0.222, leaving room for a sub-cap change.
    const { pending } = settleSession([evidence({ pendingDelta: 0.24, pendingGames: 35 })]);
    expect(pending[0]!.delta).toBeCloseTo(0.24, 2);
  });

  it('lets a persistent bias accumulate until it counts', () => {
    // Signal grows linearly with games while noise only grows as sqrt(games),
    // so the SAME per-game bias becomes conclusive given enough of them.
    const perGame = 0.004;
    const oneMonth = settleSession([
      evidence({ pendingDelta: perGame * 40, pendingGames: 40 }),
    ]);
    const oneSeason = settleSession([
      evidence({ pendingDelta: perGame * 200, pendingGames: 200 }),
    ]);

    expect(oneMonth.pending).toEqual([]);
    expect(oneSeason.pending).toHaveLength(1);
  });

  it('caps a settlement at the drift limit', () => {
    const { pending } = settleSession([evidence({ pendingDelta: 1.2 })]);
    expect(pending[0]!.after).toBeCloseTo(3.75, 10);
  });

  it('holds ratings inside the scale bounds', () => {
    const low = settleSession([evidence({ rating: 2.05, pendingDelta: -1 })]);
    const high = settleSession([evidence({ playerId: 'b', rating: 5.45, pendingDelta: 1 })]);
    expect(low.pending[0]!.after).toBeGreaterThanOrEqual(CFG.min);
    expect(high.pending[0]!.after).toBeLessThanOrEqual(CFG.max);
  });

  it('holds a provisional player to a wider noise band than an established one', () => {
    // Provisional K is larger, so more of a new player's swing is just noise.
    const delta = 0.4;
    const provisional = settleSession([evidence({ pendingDelta: delta, priorRatedGames: 1 })]);
    const established = settleSession([evidence({ pendingDelta: delta, priorRatedGames: 60 })]);

    expect(provisional.pending).toEqual([]);
    expect(established.pending).toHaveLength(1);
  });
});

import { clamp } from './priority.js';

/**
 * Rating adjustment from recorded results.
 *
 * Elo-like, but on the native 2.0-5.5 pickleball scale rather than a 1500-based
 * one. Changes are proposed, not applied: the console shows them at session end
 * behind a review screen. Applying them mid-session would change the skill band
 * mid-session, creating a feedback loop between this and the matcher that is
 * baffling to debug and untestable.
 */

export interface RatingConfig {
  /** Rating points per 10x change in odds. Calibrate against real results. */
  scale: number;
  /** Adjustment rate for a player with few rated games. */
  provisionalK: number;
  /** Adjustment rate once established. */
  establishedK: number;
  /** Rated games before a player is no longer provisional. */
  provisionalGames: number;
  /** Maximum total movement in a single session, in rating points. */
  sessionDriftCap: number;
  /**
   * How many standard deviations of pure chance the accumulated drift must
   * exceed before any change is proposed. See `settleSession`.
   */
  evidenceSigmas: number;
  /**
   * Rated games that must sit behind a change before it can be proposed at all.
   * One open-play night is about nine games — nowhere near enough to tell a
   * mis-rating from a hot streak — so this makes "we do not re-rate you on one
   * night" an exact guarantee rather than a statistical tendency.
   */
  minGamesForChange: number;
  min: number;
  max: number;
}

export const DEFAULT_RATING_CONFIG: RatingConfig = {
  // At 0.75 a half-point gap implied an 82/18 blowout, which is far steeper than
  // rec doubles actually plays. 1.35 puts a 0.5 gap near 35/65.
  scale: 1.35,
  // K sets the SIZE of a correction, not its confidence — the noise band scales
  // with K too, so the gate fires at the same point either way. It is chosen so
  // the band is comparable to `sessionDriftCap` at around 60 games: much larger
  // and every correction would be cap-sized, much smaller and they would crawl.
  provisionalK: 0.1,
  establishedK: 0.03,
  provisionalGames: 5,
  sessionDriftCap: 0.25,
  // 2.5 sigma. At 1 sigma roughly a third of correctly-rated players clear the
  // band by chance, and the simulation showed that added more error than the
  // genuine corrections removed.
  evidenceSigmas: 2.5,
  minGamesForChange: 30,
  min: 2.0,
  max: 5.5,
};

export interface MatchResult {
  teamARatings: readonly [number, number];
  teamBRatings: readonly [number, number];
  /** Null means the game was played but no result was recorded. */
  winner: 'a' | 'b' | null;
  scoreA?: number;
  scoreB?: number;
}

export function expectedScore(ratingA: number, ratingB: number, scale: number): number {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / scale));
}

/**
 * Margin is deliberately mild and clamped. Games to 11 win-by-2 compress the
 * range, and a single cold streak on serve swings it more than skill does.
 */
export function actualScore(result: MatchResult): number | null {
  if (result.winner === null) return null;

  const { scoreA, scoreB } = result;
  if (scoreA === undefined || scoreB === undefined) {
    return result.winner === 'a' ? 1 : 0;
  }

  const margin = clamp(0.5 + (0.4 * (scoreA - scoreB)) / 11, 0.15, 0.85);
  return result.winner === 'a' ? Math.max(0.55, margin) : Math.min(0.45, margin);
}

export interface RatingDelta {
  /** Applied to both players on team A. */
  teamA: number;
  /** Applied to both players on team B. */
  teamB: number;
}

/**
 * Delta is split EQUALLY between partners. Attributing a share of the result to
 * one partner over the other is indefensible from the sideline and starts
 * exactly the arguments this app exists to prevent.
 */
export function ratingDelta(
  result: MatchResult,
  ratedGames: readonly [number, number, number, number],
  config: RatingConfig = DEFAULT_RATING_CONFIG,
): RatingDelta {
  const actual = actualScore(result);
  if (actual === null) return { teamA: 0, teamB: 0 };

  const avgA = (result.teamARatings[0] + result.teamARatings[1]) / 2;
  const avgB = (result.teamBRatings[0] + result.teamBRatings[1]) / 2;
  const expected = expectedScore(avgA, avgB, config.scale);

  // A team is provisional if either player still is; new players move faster.
  const kFor = (a: number, b: number) =>
    Math.min(a, b) < config.provisionalGames ? config.provisionalK : config.establishedK;

  const kA = kFor(ratedGames[0], ratedGames[1]);
  const kB = kFor(ratedGames[2], ratedGames[3]);

  return {
    teamA: kA * (actual - expected),
    teamB: kB * (expected - actual),
  };
}

export interface PendingRating {
  playerId: string;
  before: number;
  after: number;
  delta: number;
}

/**
 * Per-player evidence carried between sessions.
 *
 * A single open-play night is roughly nine games, which is nowhere near enough
 * to move a rating with any confidence — this is why DUPR needs hundreds. So
 * sub-threshold evidence is not thrown away at the end of the night; it is
 * banked and keeps accumulating until it is strong enough to act on.
 */
export interface RatingEvidence {
  playerId: string;
  rating: number;
  ratingLocked: boolean;
  /** Delta accumulated since the last applied change, across sessions. */
  pendingDelta: number;
  /** Rated games behind `pendingDelta`. */
  pendingGames: number;
  /** Lifetime rated games, deciding provisional vs established K. */
  priorRatedGames?: number;
}

export interface Settlement {
  /** Changes strong enough to propose to the organizer. */
  pending: PendingRating[];
  /** Evidence to carry into the next session, keyed by player id. */
  carry: Map<string, { pendingDelta: number; pendingGames: number }>;
}

/**
 * Fold a session's accumulated deltas into final proposed ratings, applying the
 * per-session drift cap and the rating bounds. Locked players never move.
 *
 * The evidence gate is the important part. A well-matched game is close to a
 * coin flip, so over a single session the accumulated delta is mostly a random
 * walk: without a gate, ratings drift on noise and a correctly-rated player ends
 * up further from the truth than they started. Signal and noise both scale with
 * K, so a bigger or smaller K does not help — only more evidence does.
 *
 * So: estimate the drift pure chance would produce over this many games, ignore
 * anything inside that band, and keep only the excess (soft thresholding). A
 * player who genuinely over-performed all night still moves; a player who went
 * 5-4 in even games does not.
 */
export function settleSession(
  players: readonly RatingEvidence[],
  config: RatingConfig = DEFAULT_RATING_CONFIG,
): Settlement {
  const pending: PendingRating[] = [];
  const carry = new Map<string, { pendingDelta: number; pendingGames: number }>();

  for (const p of players) {
    const keep = (pendingDelta: number, pendingGames: number) =>
      carry.set(p.playerId, { pendingDelta, pendingGames });

    if (p.ratingLocked) {
      keep(0, 0);
      continue;
    }
    if (
      p.pendingGames <= 0 ||
      p.pendingDelta === 0 ||
      p.pendingGames < config.minGamesForChange
    ) {
      keep(p.pendingDelta, p.pendingGames);
      continue;
    }

    const k =
      (p.priorRatedGames ?? p.pendingGames) < config.provisionalGames
        ? config.provisionalK
        : config.establishedK;

    // A per-game residual (actual - expected) has std <= 0.5, so over N games
    // chance alone produces a drift of about k * 0.5 * sqrt(N). Anything inside
    // that band is noise and must not move a rating the organizer set.
    const chanceDrift = config.evidenceSigmas * k * 0.5 * Math.sqrt(p.pendingGames);

    if (Math.abs(p.pendingDelta) <= chanceDrift) {
      // Not conclusive yet — bank it and keep watching.
      keep(p.pendingDelta, p.pendingGames);
      continue;
    }

    // Past the gate, apply what the evidence actually says. Shrinking by the
    // band as well would double-count the caution: because the evidence resets
    // once a rating moves, each firing would contribute only the sliver above
    // the threshold, and a badly mis-rated player would take years to correct.
    // The K damping already makes this estimate conservative.
    const capped = clamp(p.pendingDelta, -config.sessionDriftCap, config.sessionDriftCap);
    const after = clamp(Math.round((p.rating + capped) * 100) / 100, config.min, config.max);

    if (after === p.rating) {
      keep(p.pendingDelta, p.pendingGames);
      continue;
    }

    pending.push({ playerId: p.playerId, before: p.rating, after, delta: after - p.rating });
    // The rating has moved, so evidence gathered about the old one is spent.
    keep(0, 0);
  }

  return { pending, carry };
}

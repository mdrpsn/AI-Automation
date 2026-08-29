/**
 * A discrete-event simulation of a real open-play session.
 *
 * This is how the weights get tuned without burning actual open plays on bad
 * pairings. It models the things that break naive schedulers: people arriving
 * late, leaving without telling anyone, taking a break mid-session, and a skill
 * distribution with real clusters rather than a tidy uniform spread.
 *
 * Every player also carries a hidden "true" rating that decides who actually
 * wins, which lets the harness measure whether matches were genuinely close and
 * whether the rating engine converges on the truth.
 */

import { fillCourts } from '../src/select.js';
import { expectedScore, ratingDelta, DEFAULT_RATING_CONFIG } from '../src/rating.js';
import { makeRng, type Rng } from '../src/rng.js';
import { rawWaitRotations, makePriorityContext } from '../src/priority.js';
import { DEFAULT_CONFIG } from '../src/config.js';
import type {
  CourtState,
  EngineConfig,
  MatchRecord,
  PlayerState,
  Snapshot,
} from '../src/types.js';

const MINUTE = 60_000;

export interface SimPlayer extends PlayerState {
  /** Hidden ground truth; decides outcomes. The engine never sees this. */
  trueRating: number;
  arrivesAt: number;
  leavesAt: number;
  /** Break window, if this player takes one. */
  breakStart?: number;
  breakEnd?: number;
  /** A ghost stops showing up but never tells the organizer. */
  ghostAt?: number;
  /**
   * Worst wait this player ever endured, in rotations. This is the sit-out
   * measure that matters — counting "fill events I was passed over for" would
   * inflate by the court count, since four courts free at four different times.
   */
  maxWaitRotations: number;
  /** Fill events where this player was available and not chosen. Diagnostic. */
  passedOver: number;
  /** Times placed in a match more than `stretchThreshold` below their rating. */
  stretchCount: number;
  accumulatedDelta: number;
  ratedGames: number;
}

export interface SimOptions {
  seed: number;
  playerCount: number;
  courtCount: number;
  durationMinutes: number;
  config?: Partial<EngineConfig>;
  /** Fraction arriving after the session starts. */
  lateFraction: number;
  /** Fraction leaving before it ends. */
  earlyLeaveFraction: number;
  /** Fraction taking one mid-session break. */
  breakFraction: number;
  /** Fraction who quietly stop responding. */
  ghostFraction: number;
  /** Carry ratings forward from a previous session, keyed by player id. */
  initialRatings?: ReadonlyMap<string, number>;
  /** Carry hidden true ratings forward, so a roster stays the same people. */
  initialTrueRatings?: ReadonlyMap<string, number>;
}

export const DEFAULT_SIM: SimOptions = {
  seed: 1,
  playerCount: 28,
  courtCount: 4,
  durationMinutes: 180,
  lateFraction: 0.2,
  earlyLeaveFraction: 0.15,
  breakFraction: 0.1,
  ghostFraction: 0.05,
};

/** Realistic club mixture: clusters at 3.0, 3.5 and 4.0 rather than a flat spread. */
function sampleRating(rng: Rng): number {
  const u = rng.next();
  const mode = u < 0.35 ? 3.0 : u < 0.75 ? 3.5 : 4.0;
  // Gaussian-ish jitter via the mean of three uniforms.
  const jitter = ((rng.next() + rng.next() + rng.next()) / 3 - 0.5) * 1.2;
  const raw = mode + jitter;
  return Math.round(Math.max(2.0, Math.min(5.0, raw)) * 4) / 4;
}

function truncatedNormal(rng: Rng, mean: number, sd: number, lo: number, hi: number): number {
  const z = (rng.next() + rng.next() + rng.next() + rng.next() - 2) * 1.1;
  return Math.max(lo, Math.min(hi, mean + z * sd));
}

/**
 * Play the game out point by point, to 11, win by 2.
 *
 * A team's edge per rally is much smaller than its edge over a whole game, so
 * the match-level probability is damped down to a point-level one. Simulating
 * the score rather than just flipping for a winner matters: the margin is where
 * most of the rating signal lives, and a win/loss bit alone is nearly noise.
 */
function playGame(rng: Rng, trueWinProbA: number): { scoreA: number; scoreB: number } {
  const pPoint = 0.5 + (trueWinProbA - 0.5) * 0.34;
  let a = 0;
  let b = 0;
  // Cap the rally count so a pathological deuce cannot hang the simulation.
  for (let rally = 0; rally < 200; rally++) {
    if ((a >= 11 || b >= 11) && Math.abs(a - b) >= 2) break;
    if (rng.next() < pPoint) a++;
    else b++;
  }
  return { scoreA: a, scoreB: b };
}

export interface CompletedMatch extends MatchRecord {
  courtId: string;
  /** Engine-visible spread at the time of assignment. */
  spread: number;
  imbalance: number;
  intraGap: number;
  /** True win probability for team A from hidden ratings. Fairness metric. */
  trueWinProbA: number;
  winner: 'a' | 'b';
  scoreA: number;
  scoreB: number;
}

export interface SimResult {
  players: SimPlayer[];
  matches: CompletedMatch[];
  /** Times an open court sat idle while four or more players were available. */
  idleWithQueue: number;
  solveTimes: number[];
  rotationsRun: number;
  options: SimOptions;
}

export function runSession(options: Partial<SimOptions> = {}): SimResult {
  const opts: SimOptions = { ...DEFAULT_SIM, ...options };
  const rng = makeRng(opts.seed);
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...opts.config };

  const start = 1_700_000_000_000;
  const end = start + opts.durationMinutes * MINUTE;

  // --- Roster ------------------------------------------------------------

  const players: SimPlayer[] = [];
  for (let i = 0; i < opts.playerCount; i++) {
    const id = `p${String(i).padStart(2, '0')}`;
    // Carrying forward keeps the roster the same people across sessions, which
    // is the only way rating convergence can be measured honestly.
    const trueRating = opts.initialTrueRatings?.get(id) ?? sampleRating(rng);
    // The organizer's first guess is a noisy read of the truth.
    const assigned =
      opts.initialRatings?.get(id) ??
      Math.round(Math.max(2.0, Math.min(5.5, trueRating + (rng.next() - 0.5) * 0.5)) * 4) / 4;

    const isLate = rng.next() < opts.lateFraction;
    const arrivesAt = isLate ? start + rng.next() * 45 * MINUTE : start;
    const leavesEarly = rng.next() < opts.earlyLeaveFraction;
    const leavesAt = leavesEarly
      ? arrivesAt + (0.4 + rng.next() * 0.4) * (end - arrivesAt)
      : end + MINUTE;

    const player: SimPlayer = {
      id,
      name: `P${i}`,
      rating: assigned,
      trueRating,
      status: 'waiting',
      availableSince: arrivesAt,
      presentSeconds: 0,
      gamesPlayed: 0,
      courtSeconds: 0,
      stretchCredit: 0,
      arrivesAt,
      leavesAt,
      maxWaitRotations: 0,
      passedOver: 0,
      stretchCount: 0,
      accumulatedDelta: 0,
      ratedGames: 0,
    };

    if (rng.next() < opts.breakFraction) {
      const breakStart = arrivesAt + rng.next() * Math.max(0, leavesAt - arrivesAt - 30 * MINUTE);
      player.breakStart = breakStart;
      player.breakEnd = breakStart + 20 * MINUTE;
    }
    if (rng.next() < opts.ghostFraction) {
      player.ghostAt = arrivesAt + (0.3 + rng.next() * 0.5) * (end - arrivesAt);
    }

    players.push(player);
  }

  const courts: CourtState[] = Array.from({ length: opts.courtCount }, (_, i) => ({
    id: `c${i + 1}`,
    label: `Court ${i + 1}`,
    status: 'open',
  }));

  // --- Event loop --------------------------------------------------------

  const byId = new Map(players.map((p) => [p.id, p]));
  const active = new Map<string, { players: SimPlayer[]; endsAt: number; record: CompletedMatch }>();
  const history: MatchRecord[] = [];
  const matches: CompletedMatch[] = [];
  const solveTimes: number[] = [];

  let now = start;
  let seq = 0;
  let idleWithQueue = 0;
  let rotationsRun = 0;
  const STEP = MINUTE;

  const refreshStatuses = (at: number) => {
    for (const p of players) {
      if (p.status === 'playing') continue;
      if (at >= p.leavesAt || (p.ghostAt !== undefined && at >= p.ghostAt)) {
        p.status = 'left';
        continue;
      }
      if (at < p.arrivesAt) {
        p.status = 'left'; // not yet present; excluded from selection
        continue;
      }
      const onBreak =
        p.breakStart !== undefined && p.breakEnd !== undefined && at >= p.breakStart && at < p.breakEnd;
      if (onBreak) {
        p.status = 'paused';
        continue;
      }
      // Coming back from a break resets the wait clock.
      if (p.status === 'paused') p.availableSince = at;
      p.status = 'waiting';
    }
  };

  const accrualFor = (p: SimPlayer, at: number): boolean => {
    if (at < p.arrivesAt || at >= p.leavesAt) return false;
    if (p.ghostAt !== undefined && at >= p.ghostAt) return false;
    if (p.breakStart !== undefined && p.breakEnd !== undefined && at >= p.breakStart && at < p.breakEnd)
      return false;
    return true;
  };

  while (now < end) {
    // 1. Finish matches that have ended.
    for (const [courtId, running] of [...active.entries()]) {
      if (running.endsAt > now) continue;

      const court = courts.find((c) => c.id === courtId)!;
      court.status = 'open';
      active.delete(courtId);

      const durationSeconds = (running.endsAt - running.record.startedAt) / 1000;
      for (const p of running.players) {
        p.status = 'waiting';
        p.availableSince = running.endsAt;
        p.gamesPlayed++;
        p.courtSeconds += durationSeconds;
        p.ratedGames++;
      }

      running.record.endedAt = running.endsAt;
      history.push(running.record);
      matches.push(running.record);

      // Rating movement from the (hidden-truth) result.
      const [a1, a2, b1, b2] = running.players as [SimPlayer, SimPlayer, SimPlayer, SimPlayer];
      const delta = ratingDelta(
        {
          teamARatings: [a1.rating, a2.rating],
          teamBRatings: [b1.rating, b2.rating],
          winner: running.record.winner,
          scoreA: running.record.scoreA,
          scoreB: running.record.scoreB,
        },
        [a1.ratedGames, a2.ratedGames, b1.ratedGames, b2.ratedGames],
        DEFAULT_RATING_CONFIG,
      );
      a1.accumulatedDelta += delta.teamA;
      a2.accumulatedDelta += delta.teamA;
      b1.accumulatedDelta += delta.teamB;
      b2.accumulatedDelta += delta.teamB;
    }

    refreshStatuses(now);

    // 2. Fill any open court.
    const openCourts = courts.filter((c) => c.status === 'open');
    const waiting = players.filter((p) => p.status === 'waiting');

    if (openCourts.length > 0 && waiting.length >= 4) {
      const snapshot: Snapshot = {
        now,
        players,
        courts,
        history,
        config,
      };

      const result = fillCourts(snapshot);
      solveTimes.push(result.solveMs);

      if (result.matches.length > 0) {
        rotationsRun++;
        const priorityCtx = makePriorityContext(snapshot);
        const selected = new Set<string>();

        for (const proposal of result.matches) {
          const lineup = [...proposal.teamA, ...proposal.teamB].map((id) => byId.get(id)!) as [
            SimPlayer,
            SimPlayer,
            SimPlayer,
            SimPlayer,
          ];

          const duration = truncatedNormal(rng, 12, 3, 8, 18) * MINUTE;
          const trueA = (lineup[0].trueRating + lineup[1].trueRating) / 2;
          const trueB = (lineup[2].trueRating + lineup[3].trueRating) / 2;
          const trueWinProbA = expectedScore(trueA, trueB, DEFAULT_RATING_CONFIG.scale);
          const { scoreA, scoreB } = playGame(rng, trueWinProbA);
          const winner: 'a' | 'b' = scoreA > scoreB ? 'a' : 'b';

          const record: CompletedMatch = {
            id: `m${++seq}`,
            seq,
            courtId: proposal.courtId,
            teamA: proposal.teamA as readonly [string, string],
            teamB: proposal.teamB as readonly [string, string],
            startedAt: now,
            endedAt: null,
            spread: proposal.breakdown.rawSpread,
            imbalance: proposal.breakdown.rawImbalance,
            intraGap: proposal.breakdown.rawIntraGap,
            trueWinProbA,
            winner,
            scoreA,
            scoreB,
          };

          const avgRating = lineup.reduce((s, p) => s + p.rating, 0) / 4;
          for (const p of lineup) {
            // Record the wait this match just ended, before the clock resets.
            p.maxWaitRotations = Math.max(
              p.maxWaitRotations,
              rawWaitRotations(p, now, priorityCtx.rotationSeconds),
            );
            p.status = 'playing';
            selected.add(p.id);
            // Banked credit for playing down, so the same accommodating strong
            // player is not drafted into weaker games all night.
            if (p.rating - avgRating > config.stretchThreshold) {
              p.stretchCount++;
              p.stretchCredit += 1;
            } else {
              p.stretchCredit = Math.max(0, p.stretchCredit - 0.34);
            }
          }

          const court = courts.find((c) => c.id === proposal.courtId)!;
          court.status = 'in_use';
          active.set(court.id, { players: lineup, endsAt: now + duration, record });
        }

        // Anyone still available after the fill has been passed over.
        for (const p of players) {
          if (p.status !== 'waiting' || selected.has(p.id)) continue;
          const waited = rawWaitRotations(p, now, priorityCtx.rotationSeconds);
          p.maxWaitRotations = Math.max(p.maxWaitRotations, waited);
          if (waited >= 0.5) p.passedOver++;
        }
      } else if (waiting.length >= 4) {
        idleWithQueue++;
      }
    } else if (openCourts.length > 0 && waiting.length >= 4) {
      idleWithQueue++;
    }

    // 3. Advance the clock and accrue presence.
    now += STEP;
    for (const p of players) {
      if (p.status === 'playing' || accrualFor(p, now)) p.presentSeconds += STEP / 1000;
    }
  }

  return { players, matches, idleWithQueue, solveTimes, rotationsRun, options: opts };
}

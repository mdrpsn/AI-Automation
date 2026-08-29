import type { EngineConfig, MatchRecord, PlayerState, Snapshot } from './types.js';

/**
 * Wait is capped at this many rotations. This is what stops a late arrival from
 * bulldozing the queue: their wait grows to the cap and stops, while their games
 * deficit stays near zero because `presentSeconds` is small. They get on court
 * soon, but never ahead of someone who has been there two hours.
 */
export const WAIT_ROTATION_CAP = 3.0;

/** Superlinear so a 2-rotation wait hurts much more than twice a 1-rotation wait. */
const WAIT_EXPONENT = 1.6;

const DEFICIT_MIN = -2;
const DEFICIT_MAX = 3;

/** How strongly banked stretch credit lifts priority. */
const STRETCH_CREDIT_WEIGHT = 0.5;

const EWMA_ALPHA = 0.3;
/** Guard rails so one absurd match duration cannot poison the rotation estimate. */
const MIN_ROTATION_SECONDS = 240;
const MAX_ROTATION_SECONDS = 2400;

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/**
 * Exponentially-weighted mean of recent completed match durations. This is the
 * unit everything fairness-related is measured in — "two rotations behind" is
 * meaningful in a way that "14 minutes" is not, because it is comparable across
 * sessions with very different game lengths.
 */
export function estimateRotationSeconds(
  history: readonly MatchRecord[],
  config: EngineConfig,
): number {
  let estimate = config.defaultRotationSeconds;
  let seen = false;

  // Oldest first, so the most recent games dominate.
  const completed = history
    .filter((m): m is MatchRecord & { endedAt: number } => m.endedAt !== null)
    .sort((a, b) => a.seq - b.seq);

  for (const match of completed) {
    const duration = (match.endedAt - match.startedAt) / 1000;
    if (duration <= 0) continue;
    const bounded = clamp(duration, MIN_ROTATION_SECONDS, MAX_ROTATION_SECONDS);
    estimate = seen ? EWMA_ALPHA * bounded + (1 - EWMA_ALPHA) * estimate : bounded;
    seen = true;
  }

  return clamp(estimate, MIN_ROTATION_SECONDS, MAX_ROTATION_SECONDS);
}

/** Players the engine is allowed to pick from. */
export function availablePlayers(snapshot: Snapshot): PlayerState[] {
  const excluded = new Set(snapshot.overrides?.excluded ?? []);
  return snapshot.players.filter((p) => p.status === 'waiting' && !excluded.has(p.id));
}

/** How many rotations this player has been waiting, capped. */
export function waitRotations(
  player: PlayerState,
  now: number,
  rotationSeconds: number,
): number {
  const waited = Math.max(0, (now - player.availableSince) / 1000);
  return Math.min(waited / rotationSeconds, WAIT_ROTATION_CAP);
}

/**
 * Uncapped wait, in rotations. Used by the starvation guard and by the
 * simulation's sit-out invariant, both of which need to see past the cap.
 */
export function rawWaitRotations(
  player: PlayerState,
  now: number,
  rotationSeconds: number,
): number {
  return Math.max(0, (now - player.availableSince) / 1000) / rotationSeconds;
}

export interface PriorityContext {
  now: number;
  rotationSeconds: number;
  config: EngineConfig;
  /** Games a player would have had by now if court time were shared perfectly. */
  fairShare: ReadonlyMap<string, number>;
}

/**
 * Fair share is expressed in games: how many games this player would have played
 * by now if every present player got an equal slice of available court time.
 *
 * Court capacity is measured over the whole pool (playing + waiting), not just
 * open courts, because someone currently on court is still consuming capacity.
 */
export function computeFairShare(
  snapshot: Snapshot,
  rotationSeconds: number,
): Map<string, number> {
  const present = snapshot.players.filter(
    (p) => p.status === 'waiting' || p.status === 'playing' || p.status === 'paused',
  );
  const usableCourts = snapshot.courts.filter((c) => c.status !== 'closed').length;

  const fairShare = new Map<string, number>();
  if (present.length === 0 || usableCourts === 0) return fairShare;

  const totalPresentSeconds = present.reduce((sum, p) => sum + p.presentSeconds, 0);
  if (totalPresentSeconds <= 0) {
    for (const p of present) fairShare.set(p.id, 0);
    return fairShare;
  }

  // Total player-slots the courts could have produced over the session so far,
  // apportioned to each player by the share of that time they were present for.
  const meanPresentSeconds = totalPresentSeconds / present.length;
  const gamesPerCourt = meanPresentSeconds / rotationSeconds;
  const totalSlots = gamesPerCourt * usableCourts * 4;

  for (const p of present) {
    const share = p.presentSeconds / totalPresentSeconds;
    fairShare.set(p.id, totalSlots * share);
  }
  return fairShare;
}

export function makePriorityContext(snapshot: Snapshot): PriorityContext {
  const rotationSeconds =
    snapshot.rotationSeconds ?? estimateRotationSeconds(snapshot.history, snapshot.config);
  return {
    now: snapshot.now,
    rotationSeconds,
    config: snapshot.config,
    fairShare: computeFairShare(snapshot, rotationSeconds),
  };
}

/**
 * How badly this player deserves to be on court next. Higher is more urgent.
 *
 * Note this is a REWARD: the cost function subtracts it. Adding it would invert
 * the whole engine into preferring players who just came off court.
 */
export function priority(player: PlayerState, ctx: PriorityContext): number {
  const { config } = ctx;

  const wait = waitRotations(player, ctx.now, ctx.rotationSeconds);
  const waitTerm = config.waitWeight * Math.pow(wait, WAIT_EXPONENT);

  const expected = ctx.fairShare.get(player.id) ?? 0;
  const deficit = clamp(expected - player.gamesPlayed, DEFICIT_MIN, DEFICIT_MAX);
  const deficitTerm = config.deficitWeight * deficit;

  return waitTerm + deficitTerm + STRETCH_CREDIT_WEIGHT * player.stretchCredit;
}

/**
 * Players who have waited past the configured limit. These become must-includes
 * when there is room for all of them; when there are more starving players than
 * seats (30 people, 1 court) the guard would be unsatisfiable, so the caller
 * disables it and lets the priority reward order them instead.
 */
export function findStarving(
  players: readonly PlayerState[],
  ctx: PriorityContext,
): PlayerState[] {
  return players.filter(
    (p) => rawWaitRotations(p, ctx.now, ctx.rotationSeconds) >= ctx.config.maxWaitRotations,
  );
}

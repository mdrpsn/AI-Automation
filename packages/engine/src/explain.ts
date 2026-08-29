import type { CostContext, Lineup } from './cost.js';
import type { PriorityContext } from './priority.js';
import { waitRotations } from './priority.js';
import type { CostBreakdown } from './types.js';

/**
 * A one-line justification the organizer can read at a glance and, more
 * importantly, repeat out loud to a player who thinks they got skipped.
 *
 * This is the whole reason the engine is worth trusting, so it states the facts
 * that drove the decision rather than a score.
 */

function formatWait(rotations: number, rotationSeconds: number): string {
  const minutes = Math.round((rotations * rotationSeconds) / 60);
  return `${minutes}m`;
}

function round(value: number, places = 2): string {
  return value.toFixed(places).replace(/\.?0+$/, '') || '0';
}

export function explainMatch(
  lineup: Lineup,
  breakdown: CostBreakdown,
  ctx: CostContext,
  priorityCtx: PriorityContext,
): string {
  const parts: string[] = [];
  const [a1, a2, b1, b2] = lineup;

  // Lead with whoever this match is being run for.
  const longest = lineup.reduce((best, p) =>
    p.availableSince < best.availableSince ? p : best,
  );
  const longestWait = waitRotations(longest, priorityCtx.now, priorityCtx.rotationSeconds);
  if (longestWait >= 0.75) {
    parts.push(
      `${longest.name} waiting ${formatWait(longestWait, priorityCtx.rotationSeconds)}`,
    );
  }

  const behind = lineup.filter((p) => {
    const expected = priorityCtx.fairShare.get(p.id) ?? 0;
    return expected - p.gamesPlayed >= 1;
  });
  if (behind.length > 0) {
    parts.push(
      behind.length === 1
        ? `${behind[0]!.name} a game behind`
        : `${behind.length} players behind on games`,
    );
  }

  // Skill quality.
  if (breakdown.rawSpread <= ctx.config.spreadCap) {
    parts.push(`spread ${round(breakdown.rawSpread)}`);
  } else {
    parts.push(
      `STRETCH: spread ${round(breakdown.rawSpread)} over the ${round(ctx.config.spreadCap)} cap — no in-band option`,
    );
  }

  const avgA = (a1.rating + a2.rating) / 2;
  const avgB = (b1.rating + b2.rating) / 2;
  parts.push(`teams ${round(avgA)} v ${round(avgB)}`);

  if (breakdown.rawIntraGap >= 0.5) {
    parts.push(`uneven pairing (${round(breakdown.rawIntraGap)} gap)`);
  }

  // Repeats.
  const repeats: string[] = [];
  if (ctx.history.partnerCount(a1.id, a2.id) > 0) {
    repeats.push(`${a1.name}+${a2.name}`);
  }
  if (ctx.history.partnerCount(b1.id, b2.id) > 0) {
    repeats.push(`${b1.name}+${b2.name}`);
  }
  parts.push(repeats.length === 0 ? 'no repeat partners' : `repeat: ${repeats.join(', ')}`);

  return parts.join(' · ');
}

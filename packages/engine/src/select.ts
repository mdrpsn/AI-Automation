import {
  buildHardConstraints,
  bestSplit,
  cachedPairCost,
  makeCostCache,
  matchCost,
  priorityOf,
  spreadCost,
} from './cost.js';
import type { CostContext, Foursome, Lineup } from './cost.js';
import { buildPairHistory } from './history.js';
import {
  availablePlayers,
  estimateRotationSeconds,
  findStarving,
  makePriorityContext,
  priority,
} from './priority.js';
import { hashString, makeRng } from './rng.js';
import type { Rng } from './rng.js';
import { explainMatch } from './explain.js';
import type {
  CourtState,
  EngineReason,
  EngineResult,
  PlayerId,
  PlayerState,
  ProposedMatch,
  Snapshot,
} from './types.js';

/**
 * Safety valve so a pathological cost landscape cannot loop forever.
 *
 * The neighborhood grows quadratically with court count, so a big session gets
 * fewer passes. It needs them less: banded construction already starts close to
 * optimal when every court is interchangeable.
 */
function maxPassesFor(courtCount: number): number {
  return courtCount <= 2 ? 30 : courtCount <= 4 ? 20 : 10;
}

/** Restarts buy diversity on small problems and mostly cost time on large ones. */
function restartsFor(configured: number, courtCount: number): number {
  if (courtCount <= 1) return Math.max(1, configured);
  return Math.max(1, Math.min(configured, Math.ceil(16 / courtCount)));
}
/** How many candidates the constructor considers at each greedy step. */
const CONSTRUCT_JITTER_WIDTH = 3;

/** Highest-priority slice of the bench considered for swaps onto a court. */
const BENCH_CANDIDATES = 14;

interface Group {
  court: CourtState;
  players: PlayerState[];
}

// ---------------------------------------------------------------------------
// Partial-group scoring, used only to guide construction.
// ---------------------------------------------------------------------------

/**
 * Approximate cost of a partially-filled court. Team split is unknown until the
 * fourth player lands, so partner/opponent repeat is blended rather than exact.
 */
function partialCost(players: readonly PlayerState[], ctx: CostContext): number {
  if (players.length === 0) return 0;
  const w = ctx.config.weights;

  let min = players[0]!.rating;
  let max = players[0]!.rating;
  for (const p of players) {
    if (p.rating < min) min = p.rating;
    if (p.rating > max) max = p.rating;
  }

  let cost = w.spread * spreadCost(max - min, ctx.config.spreadCap);

  for (let i = 0; i < players.length; i++) {
    for (let j = i + 1; j < players.length; j++) {
      const a = players[i]!;
      const b = players[j]!;
      const asPartners = cachedPairCost(a, b, true, ctx);
      const asOpponents = cachedPairCost(a, b, false, ctx);
      cost += w.repeat * ((asPartners + asOpponents) / 2);
      if (ctx.hard.avoid.get(a.id)?.has(b.id)) cost += 1000;
    }
  }

  for (const p of players) cost -= w.priority * priorityOf(p, ctx);
  return cost;
}

function groupCost(players: readonly PlayerState[], ctx: CostContext): number {
  if (players.length === 4) {
    return bestSplit(players as unknown as Foursome, ctx).breakdown.total;
  }
  return partialCost(players, ctx);
}

// ---------------------------------------------------------------------------
// Exact solver — single court, small pool. Provably optimal.
// ---------------------------------------------------------------------------

function forEachCombination(
  n: number,
  k: number,
  visit: (indices: readonly number[]) => void,
): void {
  if (k < 0 || k > n) return;
  if (k === 0) {
    visit([]);
    return;
  }
  const idx = new Array<number>(k);
  for (let i = 0; i < k; i++) idx[i] = i;

  for (;;) {
    visit(idx);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]!++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1]! + 1;
  }
}

function solveExact(
  base: readonly PlayerState[],
  candidates: readonly PlayerState[],
  ctx: CostContext,
): Lineup | null {
  const slots = 4 - base.length;
  if (slots < 0) return null;
  if (slots === 0) return bestSplit(base as unknown as Foursome, ctx).lineup;
  if (candidates.length < slots) return null;

  let bestLineup: Lineup | null = null;
  let bestTotal = Number.POSITIVE_INFINITY;

  forEachCombination(candidates.length, slots, (indices) => {
    const four: PlayerState[] = base.slice();
    for (const i of indices) four.push(candidates[i]!);
    const { lineup, breakdown } = bestSplit(four as unknown as Foursome, ctx);
    if (breakdown.total < bestTotal) {
      bestTotal = breakdown.total;
      bestLineup = lineup;
    }
  });

  return bestLineup;
}

// ---------------------------------------------------------------------------
// Heuristic solver — multiple courts or a large pool.
// ---------------------------------------------------------------------------

function byPriorityDesc(ctx: CostContext) {
  return (a: PlayerState, b: PlayerState) =>
    priority(b, ctx.priorityCtx) - priority(a, ctx.priorityCtx) || (a.id < b.id ? -1 : 1);
}

/**
 * Decide who is guaranteed a seat this round.
 *
 * Precedence matters: an explicit pin is the organizer telling the engine
 * something it cannot know, so it outranks the automatic starvation guard. A
 * starving player is only forced in if doing so does not break a constraint the
 * organizer set — otherwise the guard would silently override `avoid` and
 * `mustPairWith`, which is exactly the behavior that makes people stop trusting
 * the tool.
 */
function assembleRequired(
  free: readonly PlayerState[],
  pinned: ReadonlySet<PlayerId>,
  starving: readonly PlayerState[],
  freeSlots: number,
  ctx: CostContext,
): PlayerState[] {
  const byId = new Map(free.map((p) => [p.id, p]));
  const result: PlayerState[] = [];
  const taken = new Set<PlayerId>();

  const conflictsWithChosen = (p: PlayerState) =>
    result.some((r) => ctx.hard.avoid.get(r.id)?.has(p.id));

  const tryAdd = (p: PlayerState, force: boolean) => {
    if (taken.has(p.id)) return;

    // A required partner comes along as a unit, or the constraint is unsatisfiable.
    const partnerId = ctx.hard.mustPairWith.get(p.id);
    const partner =
      partnerId !== undefined && !taken.has(partnerId) ? byId.get(partnerId) : undefined;
    const need = partner ? 2 : 1;

    if (result.length + need > freeSlots) return;
    if (partner && ctx.hard.avoid.get(p.id)?.has(partner.id)) return;
    if (!force && (conflictsWithChosen(p) || (partner && conflictsWithChosen(partner)))) return;

    result.push(p);
    taken.add(p.id);
    if (partner) {
      result.push(partner);
      taken.add(partner.id);
    }
  };

  const sorted = byPriorityDesc(ctx);
  for (const p of free.filter((p) => pinned.has(p.id)).sort(sorted)) tryAdd(p, true);
  for (const p of [...starving].sort(sorted)) tryAdd(p, false);

  return result;
}

/**
 * Take the highest-priority 4M players, sort them by rating, and cut into
 * consecutive bands of four — which is what a good organizer does by eye.
 *
 * Seeding courts one player at a time instead produces the opposite: with four
 * 3.0s at the front of the queue, three courts all seed at 3.0 and no court can
 * form a clean band afterwards.
 */
function constructBanded(
  courts: readonly CourtState[],
  pool: readonly PlayerState[],
  required: readonly PlayerState[],
  ctx: CostContext,
): { groups: Group[]; bench: PlayerState[] } | null {
  const need = courts.length * 4;
  if (pool.length < need) return null;

  const requiredIds = new Set(required.map((p) => p.id));
  const selected = required.slice();
  for (const p of pool.filter((p) => !requiredIds.has(p.id)).sort(byPriorityDesc(ctx))) {
    if (selected.length >= need) break;
    selected.push(p);
  }
  if (selected.length < need) return null;

  selected.sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : 1));

  const groups = courts.map((court, i) => ({
    court,
    players: selected.slice(i * 4, (i + 1) * 4),
  }));
  const chosen = new Set(selected.map((p) => p.id));

  return { groups, bench: pool.filter((p) => !chosen.has(p.id)) };
}

function pickLeastFilled(groups: readonly Group[]): Group | null {
  let best: Group | null = null;
  for (const g of groups) {
    if (g.players.length >= 4) continue;
    if (best === null || g.players.length < best.players.length) best = g;
  }
  return best;
}

function construct(
  courts: readonly CourtState[],
  locked: ReadonlyMap<string, PlayerState[]>,
  pool: readonly PlayerState[],
  required: readonly PlayerState[],
  ctx: CostContext,
  rng: Rng,
  greedy: boolean,
): { groups: Group[]; bench: PlayerState[] } {
  const groups: Group[] = courts.map((court) => ({
    court,
    players: (locked.get(court.id) ?? []).slice(),
  }));

  const assigned = new Set<PlayerId>();
  for (const g of groups) for (const p of g.players) assigned.add(p.id);

  // Seed with must-includes first, highest priority to the emptiest court, so a
  // starving player can never be squeezed out by the greedy fill.
  const seeds = required
    .filter((p) => !assigned.has(p.id))
    .slice()
    .sort(
      (a, b) =>
        priority(b, ctx.priorityCtx) - priority(a, ctx.priorityCtx) || (a.id < b.id ? -1 : 1),
    );
  for (const seed of seeds) {
    const target = pickLeastFilled(groups);
    if (!target) break;
    target.players.push(seed);
    assigned.add(seed.id);
  }

  // Fill remaining slots, always topping up the emptiest court so no single
  // court hoovers up the best-fitting players and leaves the rest with residue.
  for (;;) {
    const target = pickLeastFilled(groups);
    if (!target) break;

    const candidates = pool.filter((p) => !assigned.has(p.id));
    if (candidates.length === 0) break;

    const scored = candidates
      .map((c) => ({ player: c, cost: partialCost([...target.players, c], ctx) }))
      .sort((a, b) => a.cost - b.cost || (a.player.id < b.player.id ? -1 : 1));

    const width = greedy ? 1 : Math.min(CONSTRUCT_JITTER_WIDTH, scored.length);
    const chosen = scored[greedy ? 0 : rng.int(width)]!.player;

    target.players.push(chosen);
    assigned.add(chosen.id);
  }

  const bench = pool.filter((p) => !assigned.has(p.id));
  return { groups, bench };
}

/**
 * Steepest descent over three move types.
 *
 * The bench<->court move is the one that matters. Filling courts one at a time
 * is what creates the leftover pile in the first place, and shuffling only among
 * already-selected players cannot fix a bad *selection*.
 */
function improve(
  groups: Group[],
  bench: PlayerState[],
  ctx: CostContext,
  immovable: ReadonlySet<PlayerId>,
  mustPlay: ReadonlySet<PlayerId>,
): void {
  const full = groups.filter((g) => g.players.length === 4);
  if (full.length === 0) return;
  const maxPasses = maxPassesFor(full.length);

  const costs = new Map<string, number>();
  const costOf = (g: Group) => {
    let c = costs.get(g.court.id);
    if (c === undefined) {
      c = groupCost(g.players, ctx);
      costs.set(g.court.id, c);
    }
    return c;
  };

  for (let pass = 0; pass < maxPasses; pass++) {
    let bestGain = 1e-9;
    let apply: (() => void) | null = null;

    // 1. Cross-court swaps.
    for (let gi = 0; gi < full.length; gi++) {
      for (let gj = gi + 1; gj < full.length; gj++) {
        const g1 = full[gi]!;
        const g2 = full[gj]!;
        const before = costOf(g1) + costOf(g2);

        for (let i = 0; i < g1.players.length; i++) {
          const p1 = g1.players[i]!;
          if (immovable.has(p1.id)) continue;
          for (let j = 0; j < g2.players.length; j++) {
            const p2 = g2.players[j]!;
            if (immovable.has(p2.id)) continue;

            const a = g1.players.slice();
            const b = g2.players.slice();
            a[i] = p2;
            b[j] = p1;
            const gain = before - (groupCost(a, ctx) + groupCost(b, ctx));
            if (gain > bestGain) {
              bestGain = gain;
              apply = () => {
                g1.players = a;
                g2.players = b;
                costs.delete(g1.court.id);
                costs.delete(g2.court.id);
              };
            }
          }
        }
      }
    }

    // 2. Bench <-> court swaps. This is the move that fixes the leftover pile:
    //    shuffling only among already-selected players cannot undo a bad pick.
    //    Only the highest-priority slice of the bench is worth considering —
    //    someone who just came off court will not improve any lineup.
    const benchIndices = bench
      .map((p, index) => ({ p, index }))
      .sort((a, b) => priorityOf(b.p, ctx) - priorityOf(a.p, ctx) || (a.p.id < b.p.id ? -1 : 1))
      .slice(0, BENCH_CANDIDATES)
      .map((entry) => entry.index);

    for (const g of full) {
      const before = costOf(g);
      for (let i = 0; i < g.players.length; i++) {
        const onCourt = g.players[i]!;
        if (immovable.has(onCourt.id) || mustPlay.has(onCourt.id)) continue;
        for (const bi of benchIndices) {
          const benched = bench[bi]!;
          const next = g.players.slice();
          next[i] = benched;
          const gain = before - groupCost(next, ctx);
          if (gain > bestGain) {
            bestGain = gain;
            const captured = { g, next, bi, onCourt };
            apply = () => {
              captured.g.players = captured.next;
              bench[captured.bi] = captured.onCourt;
              costs.delete(captured.g.court.id);
            };
          }
        }
      }
    }

    // 3. Team re-splits are folded into groupCost via bestSplit, so there is no
    //    separate move for them.

    if (!apply) return;
    apply();
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function emptyResult(reason: EngineReason, rotationSeconds: number, solveMs: number): EngineResult {
  return { matches: [], reason, benched: [], starving: [], rotationSeconds, solveMs };
}

/**
 * Propose a foursome for every open court.
 *
 * Never throws and never returns an invalid assignment: on any degenerate input
 * it returns zero matches with a typed reason.
 */
export function fillCourts(snapshot: Snapshot): EngineResult {
  const startedAt = Date.now();
  const config = snapshot.config;
  const priorityCtx = makePriorityContext(snapshot);
  const rotationSeconds = priorityCtx.rotationSeconds;
  const finish = () => Date.now() - startedAt;

  const openCourts = snapshot.courts.filter((c) => c.status === 'open');
  if (openCourts.length === 0) return emptyResult('no_open_courts', rotationSeconds, finish());

  const byId = new Map(snapshot.players.map((p) => [p.id, p]));
  // Canonical order, so the same players in a different row order from the
  // database cannot produce a different answer.
  const pool = availablePlayers(snapshot).sort((a, b) => (a.id < b.id ? -1 : 1));

  if (pool.length === 0) {
    const anyWaiting = snapshot.players.some((p) => p.status === 'waiting');
    return emptyResult(
      anyWaiting ? 'all_excluded' : 'not_enough_players',
      rotationSeconds,
      finish(),
    );
  }

  // Locked slots: players the organizer has already dropped onto a court by hand.
  const poolIds = new Set(pool.map((p) => p.id));
  const locked = new Map<string, PlayerState[]>();
  const lockedIds = new Set<PlayerId>();
  for (const court of openCourts) {
    const ids = snapshot.overrides?.lockedSlots?.[court.id] ?? [];
    const players: PlayerState[] = [];
    for (const id of ids) {
      const p = byId.get(id);
      // Only honor a lock for someone actually available and not double-placed.
      if (p && poolIds.has(id) && !lockedIds.has(id) && players.length < 4) {
        players.push(p);
        lockedIds.add(id);
      }
    }
    if (players.length > 0) locked.set(court.id, players);
  }

  const free = pool.filter((p) => !lockedIds.has(p.id));

  // Drop courts we cannot fill, preferring to keep those with locked players.
  const ranked = openCourts
    .map((court, index) => ({ court, index, lockedCount: locked.get(court.id)?.length ?? 0 }))
    .sort((a, b) => b.lockedCount - a.lockedCount || a.index - b.index);

  const chosen: CourtState[] = [];
  let remaining = free.length;
  for (const entry of ranked) {
    const need = 4 - entry.lockedCount;
    if (need > remaining) continue;
    remaining -= need;
    chosen.push(entry.court);
  }
  if (chosen.length === 0) return emptyResult('not_enough_players', rotationSeconds, finish());

  // Restore the organizer's court ordering.
  const courtOrder = new Map(openCourts.map((c, i) => [c.id, i]));
  chosen.sort((a, b) => courtOrder.get(a.id)! - courtOrder.get(b.id)!);

  const lockedCount = chosen.reduce((sum, c) => sum + (locked.get(c.id)?.length ?? 0), 0);
  const freeSlots = chosen.length * 4 - lockedCount;

  const ctx: CostContext = {
    config,
    priorityCtx,
    history: buildPairHistory(snapshot.history),
    hard: buildHardConstraints(snapshot.players, snapshot.overrides?.mustPairWith),
    poolSize: pool.length,
    cache: makeCostCache(),
  };

  // Must-includes: pinned players, plus anyone who has starved past the limit.
  // When more players are starving than there are seats (30 people, 1 court)
  // nobody is being singled out — it is just a busy session — so the guard
  // stands down and the priority reward orders them instead.
  const pinned = new Set(snapshot.overrides?.pinned ?? []);
  const starving = findStarving(free, priorityCtx);
  const required = assembleRequired(
    free,
    pinned,
    starving.length <= freeSlots ? starving : [],
    freeSlots,
    ctx,
  );
  const mustPlay = new Set(required.map((p) => p.id));

  // --- Solve -------------------------------------------------------------

  let groups: Group[];
  let bench: PlayerState[];

  const useExact = chosen.length === 1 && free.length <= config.exactPoolLimit;

  if (useExact) {
    const court = chosen[0]!;
    const base = [...(locked.get(court.id) ?? []), ...required].slice(0, 4);
    const baseIds = new Set(base.map((p) => p.id));
    const candidates = free.filter((p) => !baseIds.has(p.id));
    const lineup = solveExact(base, candidates, ctx);

    if (!lineup) return emptyResult('not_enough_players', rotationSeconds, finish());
    const onCourt = new Set(lineup.map((p) => p.id));
    groups = [{ court, players: lineup.slice() }];
    bench = pool.filter((p) => !onCourt.has(p.id));
  } else {
    // `free` is already in canonical id order, so the seed does not depend on
    // the order rows happened to arrive in.
    const seed = hashString(
      `${snapshot.now}|${free.map((p) => p.id).join(',')}|${chosen.map((c) => c.id).join(',')}`,
    );

    const score = (built: { groups: Group[] }) =>
      built.groups
        .filter((g) => g.players.length === 4)
        .reduce((sum, g) => sum + groupCost(g.players, ctx), 0);

    let best: { groups: Group[]; bench: PlayerState[]; total: number } | null = null;
    const consider = (built: { groups: Group[]; bench: PlayerState[] }) => {
      improve(built.groups, built.bench, ctx, lockedIds, mustPlay);
      const total = score(built);
      if (best === null || total < best.total) best = { ...built, total };
    };

    // Banding is only meaningful when every court is interchangeable; a locked
    // slot ties specific players to a specific court, so fall back to the
    // incremental constructor there.
    if (lockedIds.size === 0) {
      const banded = constructBanded(chosen, free, required, ctx);
      if (banded) consider(banded);
    }

    const restarts = restartsFor(config.restarts, chosen.length);
    for (let r = 0; r < restarts; r++) {
      const rng = makeRng(seed + r * 0x9e3779b9);
      consider(construct(chosen, locked, free, required, ctx, rng, r === 0));
    }

    groups = best!.groups;
    bench = best!.bench;
  }

  // --- Emit --------------------------------------------------------------

  const matches: ProposedMatch[] = [];
  for (const g of groups) {
    if (g.players.length !== 4) continue;
    const { lineup, breakdown } = bestSplit(g.players as unknown as Foursome, ctx);
    matches.push({
      courtId: g.court.id,
      teamA: [lineup[0].id, lineup[1].id],
      teamB: [lineup[2].id, lineup[3].id],
      cost: breakdown.total,
      breakdown,
      isStretch: breakdown.rawSpread > config.spreadCap,
      explanation: explainMatch(lineup, breakdown, ctx, priorityCtx),
    });
  }

  if (matches.length === 0) return emptyResult('not_enough_players', rotationSeconds, finish());

  const benchIds = new Set(bench.map((p) => p.id));
  const benched = pool
    .filter((p) => benchIds.has(p.id))
    .sort((a, b) => priority(b, priorityCtx) - priority(a, priorityCtx) || (a.id < b.id ? -1 : 1))
    .map((p) => p.id);

  return {
    matches,
    reason: 'ok',
    benched,
    starving: starving.map((p) => p.id),
    rotationSeconds,
    solveMs: finish(),
  };
}

export { estimateRotationSeconds, matchCost };

# Open Play — skill-aware court matching for pickleball

A session manager for pickleball open play. The point of it is the part that is
hardest to do by hand: **deciding who plays next**, balancing skill so games are
competitive against wait fairness so nobody sits out repeatedly — and showing
the organizer *why* each foursome was chosen, so the call can be defended to a
player who thinks they got skipped.

Status: **the matching engine and its simulation harness are built and tested.**
The web app around them is not.

## Layout

```
packages/engine/          zero-dependency, deterministic match-selection engine
  src/types.ts            the contract everything depends on
  src/priority.ts         wait + games-deficit fairness
  src/cost.ts             the scoring function
  src/select.ts           two-regime solver
  src/explain.ts          human-readable justification per match
  src/rating.ts           rating adjustment from recorded results
  sim/session.ts          discrete-event simulation of a real session
  sim/session.test.ts     fairness invariants
  sim/report.ts           scorecard printer
```

## Commands

```
npm test          # everything (77 tests)
npm run test:unit # engine unit tests only
npm run sim       # fairness invariants
npm run scorecard # print the fairness table for the current weights
npm run check     # typecheck + test
```

## Design

The engine is **pure, dependency-free and deterministic**. It takes a plain
snapshot (players, wait state, match history, config, `now`) and returns
proposed matches plus an explanation for each. No network, no DOM, no clock, no
database. That makes every fairness claim a unit test, lets the whole thing run
client-side when venue wifi drops, and makes the simulation harness possible.

### Selection

- **1 open court, pool ≤ 30** → exhaustive enumeration of all 27,405 foursomes ×
  3 team splits. Provably optimal, under 20 ms.
- **Multiple courts or a big pool** → take the highest-priority 4M players, sort
  by rating and cut into bands of four, then steepest descent over three moves:
  cross-court swap, **bench↔court swap**, and team re-split.

The bench↔court move is the one that matters. Filling courts one at a time is
what *creates* the leftover pile — the last court gets the residue by
construction — and shuffling only among already-selected players cannot fix a
bad selection.

### Fairness

Priority is a **reward subtracted from cost**, not a penalty added. Adding it
inverts the engine into preferring players who just walked off court; a
simulation invariant catches the sign flip.

Wait is capped at 3 rotations and paired with a games-deficit term computed from
time actually present. That is what stops a late arrival — who has "waited"
since check-in but is owed nothing — from bulldozing the queue.

The guarantee is **"nobody sits out two rotations in a row"**, implemented as a
narrow hard guard on top of the reward. An earlier design forced the
longest-waiting player into every match; that optimizes *ordering* when what
matters is *max wait*, and it can push an 11:30 waiter back a full rotation to
protect a 30-second difference.

### Skill

The spread cap is a **steep hinge, not a hard reject**: over-cap costs ~41
against a typical 1–3, so it is chosen only when nothing else exists.
Infeasibility becomes impossible — the engine always returns a least-bad match
and flags it as a stretch — which deletes an entire "widen the band, then give
up, then warn" escalation ladder.

Team balance alone is not enough. `(4.0, 4.0)` and `(4.5, 3.5)` have identical
team averages and are completely different games, so there is a separate
intra-team gap term; without it the optimizer *systematically* produces
best-with-worst pairings, because stacking is the cheapest way to level
averages.

Repeat-pairing cost is measured **relative to chance expectation**. An absolute
count saturates — with 12 players everyone has partnered everyone after four
games — and stops discriminating.

### Ratings

Ratings are organizer-assigned; the engine only ever *proposes* changes, for
review at session end. Three findings from the simulation shaped this:

1. **Winner-only results are nearly pure noise.** A well-matched game is a coin
   flip. Recording the score matters — the margin is where the signal is.
2. **No choice of K fixes that**, because signal and noise both scale with K.
   Only more evidence does.
3. So changes are gated on evidence: the accumulated drift must exceed 2.5σ of
   what chance alone would produce, and sub-threshold evidence is **carried
   forward between sessions** rather than discarded. A rating is never moved on
   one night's play. Before the gate existed, the rating engine measurably made
   ratings *worse* over a session.

## Fairness scorecard

8 simulated sessions — 28 players, 4 courts, 3 hours, with late arrivals, early
departures, mid-session breaks and players who quietly stop showing up:

| | |
| --- | --- |
| matches played | 445 |
| games per regular (p10–p90) | 7–9 |
| worst wait, max | 2.17 rotations |
| court-minute error (p95) | 18.3% |
| within spread cap | 97.1% |
| max spread seen | 0.75 |
| team imbalance (p90) | 0.125 |
| close games (true win prob .3–.7) | 98.7% |
| partner variety (median) | 0.89 |
| open court left idle with a queue | 0 |
| solve time p50 / p99 | 4 ms / 19 ms |

Blocking invariants in CI: nobody stranded past 3 rotations, no idle court while
four are waiting, no match past the cap + 0.75, byte-identical output on replay,
and a total function over 3,000 fuzzed snapshots (empty pools, everyone
identical, bimodal with nothing in the middle, contradictory constraints).

One honest limitation the simulation surfaced: a genuine skill outlier — a lone
2.25 in a pool clustered at 2.75–4.0 — gets meaningfully fewer games than
everyone else. The engine keeps them involved rather than benching them all
night, but it cannot manufacture in-band partners who are not there. The app
should surface that to the organizer as a "hard to place" warning rather than
silently absorbing it.

## Next

The web app: Next.js + Supabase organizer console, live player view over a share
link, offline-first session state, and the session-end rating review screen. See
the plan for the full build order.

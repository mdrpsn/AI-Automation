# Open Play — skill-aware court matching for pickleball

A session manager for pickleball open play. The point of it is the part that is
hardest to do by hand: **deciding who plays next**, balancing skill so games are
competitive against wait fairness so nobody sits out repeatedly — and showing
the organizer *why* each foursome was chosen, so the call can be defended to a
player who thinks they got skipped.

Status: **the engine, the organizer console, the live player view and self
check-in all work.** You can run a real session today: the organizer drives it
from one device, players scan a QR to check themselves in and to watch the
queue.

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

packages/web/             Next.js organizer console
  src/lib/session.ts      session state + reducer over the engine
  src/lib/useSession.ts   state, undo, live proposals
  src/lib/storage.ts      persistence boundary (IndexedDB today)
  src/lib/publicSnapshot.ts  what players are allowed to see
  src/lib/checkin.ts      self check-in rules (the untrusted-input boundary)
  src/lib/dupr.ts         seam for a real DUPR rating lookup
  src/lib/liveStore.ts    server-side relay for published sessions
  src/components/         courts, queue, check-in, roster, share, summary
  e2e/smoke.mjs           drives a whole session in a real browser
  e2e/live.mjs            organizer + player, two browsers at once
  e2e/checkin.mjs         a player checks in, the organizer accepts
```

## Commands

```
npm run dev       # organizer console at localhost:3000
npm test          # everything (133 tests)
npm run sim       # fairness invariants
npm run scorecard # print the fairness table for the current weights
npm run e2e       # browser tests, console + live view (needs the dev server)
npm run check     # typecheck + test
```

## The console

One device, no account, no network. A session lives in IndexedDB on the
organizer's phone, so it keeps working when the venue wifi does not, and a
reload picks up exactly where it left off — wait times included.

- **Courts** — every open court shows who is up next, the team averages, and a
  one-line reason. Start, Reshuffle, or tap any player to swap them out.
- **Queue** — in the engine's own priority order, so what you see matches what
  it will do. Sorting by raw wait instead would quietly disagree with the
  proposals and undermine trust in both. Anyone past the sit-out limit is
  flagged in red.
- **Roster** — ratings, matching preset, spread cap, and per-player "keep apart
  from" pairs (stored, never shown to players).
- **Undo** on every action, because mis-taps outdoors are constant.
- Screen wake lock, so the phone does not sleep mid-rotation.

Session state stores raw timestamps rather than derived counters, so nothing
depends on a ticking timer being alive to stay correct.

## The live player view

Press **Start sharing** and the console produces a QR code. Players scan it and
get a read-only page: who is on each court with a running clock, the queue in
order, roughly how long their wait is, and a clear **up next** marker — which is
the question they were going to ask you anyway.

The page has no buttons and no inputs at all. There is nothing to argue with and
no way to act, which is deliberate; an e2e test asserts it stays that way.

**What players can see is a hand-built projection**, not a filtered copy of the
session (`src/lib/publicSnapshot.ts`). Adding a field to `SessionState` must
never silently publish it, so private data — "keep apart from" pairs, rating
movement, internal ids, the publish secret — has nowhere to travel through.
Ratings are off by default and are a per-session opt-in: showing people their
assigned number tends to start arguments. Tests serialize the whole payload and
assert the private fields are absent.

**Read and write are separate secrets.** The share token is public by design —
everyone who scans the QR has it — so it cannot also authorize publishing, or
any player could rewrite the queue. A distinct 32-character publish secret,
which never leaves the organizer's device, does that. "New link" rotates the
share token and the old QR stops working immediately.

Publishing is fire-and-forget and never blocks the console. If the network is
down the organizer keeps running the session and players just see slightly
stale data until the next publish lands — the right trade at a venue with bad
wifi.

The player page **long-polls** rather than using SSE or WebSockets. On a patchy
venue network a long-lived stream that quietly dies looks exactly like "nothing
has changed", whereas a poll that returns and re-issues heals itself on the next
pass.

## Self check-in

Turn on **Let players check themselves in** and the same QR gains a check-in
route. A player types their name, taps a skill level, and lands in a tray on the
organizer's roster tab. **Nothing reaches the matching engine until the
organizer accepts it.**

That approval step is the whole design. A claimed rating is the one piece of
stranger input that can reach the matcher, people round their own level up, and
an inflated rating wrecks the first game they are put into. The player is
standing in front of the organizer anyway, so the cost is a tap — and there is
`Accept all` for a rush. Accepted players stay flagged **self-rated** in the
roster and queue until the organizer confirms or corrects the number; editing
the rating counts as confirming it.

Two people checking in under the same name is flagged as a probable double
scan rather than silently creating a second player.

The check-in list is fetched with the publish secret, not the share token:
everyone at the venue holds the share token, and the list carries names and
claimed ratings. Submissions are rate limited per address and the tray is
bounded, so a bored teenager with the QR cannot flood it — and even a flood
lands in a tray the organizer can empty, never in the queue.

### DUPR

A session can require a DUPR ID. **This is identity, not a rating.** DUPR's API
is partner-gated: a club needs credentials from their account manager before
ratings can be fetched by id, so today the ID is recorded against the player for
recognition and manual verification, and the player still taps their own level.

`src/lib/dupr.ts` is the seam. Implement `DuprLookup` against the partner API,
read credentials from a server-only env var, pass it to `setDuprLookup`, and
accepted check-ins arrive with a verified rating instead of a claimed one —
nothing else changes. To switch it on, ask your DUPR club account manager for
partner API access and the rating-lookup endpoint for `duprIds`.

### Deploying it

`liveStore` keeps published snapshots in memory, which is correct for a single
long-running Node process — `next start` on a VPS, Fly, Railway, or a laptop at
the venue. **On a serverless platform each instance would hold its own copy**,
so a deploy there needs a shared adapter (Postgres, Redis, Supabase) behind the
`LiveStore` interface. Nothing in it is a source of truth: the organizer's
device is authoritative, so losing the relay costs a refresh, not a session.

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

- **A persistent club roster.** This is the significant gap. The engine banks
  rating evidence across sessions by design — one night is about nine games,
  nowhere near enough to separate a mis-rating from a hot streak — but nothing
  persists a roster yet, so that banked evidence is discarded at the end of
  every session and ratings will never actually move. Until this exists, the
  rating review screen will keep correctly reporting "no changes proposed"
  forever.
- **A shared `LiveStore` adapter**, if this is deployed serverless.
- **Sync across organizer devices**, so a co-organizer can help run a session.

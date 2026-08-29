import { describe, expect, it } from 'vitest';
import { buildPublicSnapshot } from '../src/lib/publicSnapshot.js';
import { createSession, reduce, type SessionState } from '../src/lib/session.js';

const T0 = 1_700_000_000_000;
const MINUTE = 60_000;

function session(playerCount = 8): SessionState {
  let state = createSession('Thursday', 2);
  for (let i = 0; i < playerCount; i++) {
    state = reduce(state, {
      type: 'player/add',
      name: `Player${i}`,
      rating: 3.0 + (i % 4) * 0.25,
      isGuest: false,
      now: T0,
    });
  }
  return reduce(state, { type: 'session/start', now: T0 });
}

describe('what leaves the organizer device', () => {
  it('never publishes ratings unless the organizer opted in', () => {
    const state = session();
    const snapshot = buildPublicSnapshot(state, T0 + MINUTE);

    expect(snapshot.showRatings).toBe(false);
    for (const entry of snapshot.queue) expect(entry.rating).toBeUndefined();

    const shown = buildPublicSnapshot(
      reduce(state, { type: 'session/showRatings', on: true }),
      T0 + MINUTE,
    );
    expect(shown.queue.every((e) => typeof e.rating === 'number')).toBe(true);
  });

  it('never publishes keep-apart pairs', () => {
    let state = session();
    const [a, b] = state.playerOrder as [string, string];
    state = reduce(state, { type: 'player/avoid', id: a, otherId: b, on: true });

    // Serialize the whole payload and check the private data is nowhere in it.
    const json = JSON.stringify(buildPublicSnapshot(state, T0 + MINUTE));
    expect(json).not.toContain('avoid');
    expect(json).not.toContain(a);
    expect(json).not.toContain(b);
  });

  it('never publishes the tokens or internal ids', () => {
    const state = session();
    const json = JSON.stringify(buildPublicSnapshot(state, T0 + MINUTE));

    expect(json).not.toContain(state.publishToken);
    expect(json).not.toContain(state.shareToken);
    expect(json).not.toContain(state.id);
    for (const id of state.playerOrder) expect(json).not.toContain(id);
  });

  it('never publishes rating movement', () => {
    let state = session();
    const [a, b, c, d] = state.playerOrder as [string, string, string, string];
    state = reduce(state, {
      type: 'match/start',
      courtId: 'court-1',
      teamA: [a, b],
      teamB: [c, d],
      explanation: 'x',
      isStretch: false,
      now: T0,
    });
    state = reduce(state, {
      type: 'match/end',
      courtId: 'court-1',
      winner: 'a',
      scoreA: 11,
      scoreB: 3,
      now: T0 + 12 * MINUTE,
    });

    expect(state.players[a]!.accumulatedDelta).not.toBe(0);
    const json = JSON.stringify(buildPublicSnapshot(state, T0 + 13 * MINUTE));
    expect(json).not.toContain('accumulatedDelta');
    expect(json).not.toContain('stretchCredit');
  });

  it('publishes only fields the projection declares', () => {
    const state = session();
    const snapshot = buildPublicSnapshot(state, T0 + MINUTE);

    expect(Object.keys(snapshot).sort()).toEqual([
      'courts',
      'queue',
      'rotationSeconds',
      'sessionName',
      'showRatings',
      'status',
      'totals',
      'updatedAt',
    ]);
    for (const entry of snapshot.queue) {
      for (const key of Object.keys(entry)) {
        expect(['name', 'rating', 'waitSeconds', 'games', 'upNext', 'onBreak', 'etaSeconds'])
          .toContain(key);
      }
    }
  });
});

describe('what players see', () => {
  it('shows who is on each court, with the names', () => {
    let state = session();
    const [a, b, c, d] = state.playerOrder as [string, string, string, string];
    state = reduce(state, {
      type: 'match/start',
      courtId: 'court-1',
      teamA: [a, b],
      teamB: [c, d],
      explanation: 'x',
      isStretch: false,
      now: T0,
    });

    const snapshot = buildPublicSnapshot(state, T0 + 3 * MINUTE);
    const court = snapshot.courts.find((c) => c.state === 'playing')!;
    expect(court.teamA).toEqual(['Player0', 'Player1']);
    expect(court.teamB).toEqual(['Player2', 'Player3']);
    expect(court.startedAt).toBe(T0);
    // The client renders the clock, so it keeps ticking between publishes.
    expect(snapshot.courts.filter((c) => c.state === 'open')).toHaveLength(1);
  });

  it('orders the queue the same way the engine does', () => {
    let state = session(6);
    const [a] = state.playerOrder as [string];
    // Give one player a much longer wait than everyone else.
    state = {
      ...state,
      players: { ...state.players, [a]: { ...state.players[a]!, availableSince: T0 - 30 * MINUTE } },
    };

    const snapshot = buildPublicSnapshot(state, T0);
    expect(snapshot.queue[0]!.name).toBe('Player0');
  });

  it('flags the players the organizer is about to put on', () => {
    const state = session();
    const [a, b] = state.playerOrder as [string, string];
    const snapshot = buildPublicSnapshot(state, T0 + MINUTE, [a, b]);

    const flagged = snapshot.queue.filter((e) => e.upNext).map((e) => e.name);
    expect(flagged.sort()).toEqual(['Player0', 'Player1']);
    // "Up next" is the answer to the question, so no ETA guesswork on top.
    expect(snapshot.queue.find((e) => e.upNext)!.etaSeconds).toBe(0);
  });

  it('lists players on a break separately, with no queue position implied', () => {
    let state = session();
    const [a] = state.playerOrder as [string];
    state = reduce(state, { type: 'player/pause', id: a, now: T0 + MINUTE });

    const snapshot = buildPublicSnapshot(state, T0 + 2 * MINUTE);
    const paused = snapshot.queue.filter((e) => e.onBreak);
    expect(paused).toHaveLength(1);
    expect(paused[0]!.name).toBe('Player0');
    expect(paused[0]!.etaSeconds).toBeNull();
    // Everyone on a break sorts after everyone actually waiting.
    expect(snapshot.queue.findIndex((e) => e.onBreak)).toBe(snapshot.queue.length - 1);
  });

  it('gives a longer estimate the further down the queue you are', () => {
    let state = session(12);
    const [a, b, c, d] = state.playerOrder as [string, string, string, string];
    state = reduce(state, {
      type: 'match/start',
      courtId: 'court-1',
      teamA: [a, b],
      teamB: [c, d],
      explanation: 'x',
      isStretch: false,
      now: T0,
    });

    const snapshot = buildPublicSnapshot(state, T0 + MINUTE);
    const etas = snapshot.queue.filter((e) => !e.onBreak).map((e) => e.etaSeconds!);
    expect(etas[0]).toBeLessThan(etas[etas.length - 1]!);
    for (const eta of etas) expect(eta).toBeGreaterThanOrEqual(0);
  });

  it('omits players who have gone home', () => {
    let state = session();
    const [a] = state.playerOrder as [string];
    state = reduce(state, { type: 'player/leave', id: a, now: T0 + MINUTE });

    const snapshot = buildPublicSnapshot(state, T0 + 2 * MINUTE);
    expect(snapshot.queue.map((e) => e.name)).not.toContain('Player0');
  });

  it('reports the session as finished once it has ended', () => {
    const state = reduce(session(), { type: 'session/end', now: T0 + 60 * MINUTE });
    expect(buildPublicSnapshot(state, T0 + 61 * MINUTE).status).toBe('ended');
  });
});

describe('share tokens', () => {
  it('gives read and write separate secrets', () => {
    const state = createSession('x', 2);
    // Anyone who scans the QR holds the share token; it must not let them publish.
    expect(state.shareToken).not.toBe(state.publishToken);
    expect(state.publishToken.length).toBeGreaterThanOrEqual(32);
  });

  it('issues a different token to every session', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => createSession('x', 1).shareToken));
    expect(tokens.size).toBe(50);
  });

  it('rotating the link leaves the publish secret alone', () => {
    const state = createSession('x', 2);
    const rotated = reduce(state, { type: 'session/rotateShareToken' });
    expect(rotated.shareToken).not.toBe(state.shareToken);
    expect(rotated.publishToken).toBe(state.publishToken);
  });
});

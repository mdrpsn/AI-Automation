import { describe, expect, it } from 'vitest';
import {
  createSession,
  presentSeconds,
  reduce,
  toSnapshot,
  type Action,
  type SessionState,
} from '../src/lib/session.js';

const MINUTE = 60_000;

function withPlayers(count: number, at: number): SessionState {
  let state = createSession('Test', 2);
  for (let i = 0; i < count; i++) {
    state = reduce(state, {
      type: 'player/add',
      name: `P${i}`,
      rating: 3.0 + (i % 4) * 0.25,
      isGuest: false,
      now: at,
    });
  }
  return reduce(state, { type: 'session/start', now: at });
}

function apply(state: SessionState, actions: Action[]): SessionState {
  return actions.reduce(reduce, state);
}

const T0 = 1_700_000_000_000;

describe('presence accounting', () => {
  it('excludes break time, so a break does not inflate what someone is owed', () => {
    let state = withPlayers(4, T0);
    const id = state.playerOrder[0]!;

    state = apply(state, [
      { type: 'player/pause', id, now: T0 + 10 * MINUTE },
      { type: 'player/resume', id, now: T0 + 30 * MINUTE },
    ]);

    const player = state.players[id]!;
    // Present for 60 minutes of wall clock, 20 of which were a break.
    expect(presentSeconds(player, T0 + 60 * MINUTE)).toBeCloseTo(40 * 60, 0);
  });

  it('counts an ongoing break as it happens, not only once it ends', () => {
    let state = withPlayers(4, T0);
    const id = state.playerOrder[0]!;
    state = reduce(state, { type: 'player/pause', id, now: T0 + 10 * MINUTE });
    expect(presentSeconds(state.players[id]!, T0 + 30 * MINUTE)).toBeCloseTo(10 * 60, 0);
  });

  it('stops accruing presence once someone has left', () => {
    let state = withPlayers(4, T0);
    const id = state.playerOrder[0]!;
    state = reduce(state, { type: 'player/leave', id, now: T0 + 20 * MINUTE });
    expect(presentSeconds(state.players[id]!, T0 + 90 * MINUTE)).toBeCloseTo(20 * 60, 0);
  });

  it('sends someone back from a break to the back of the queue', () => {
    let state = withPlayers(4, T0);
    const id = state.playerOrder[0]!;
    state = apply(state, [
      { type: 'player/pause', id, now: T0 + 10 * MINUTE },
      { type: 'player/resume', id, now: T0 + 30 * MINUTE },
    ]);
    // Waiting through a break is not waiting for a game.
    expect(state.players[id]!.availableSince).toBe(T0 + 30 * MINUTE);
  });
});

describe('match lifecycle', () => {
  const start = (
    state: SessionState,
    now: number,
    courtId = 'court-1',
  ): Extract<Action, { type: 'match/start' }> => ({
    type: 'match/start',
    courtId,
    teamA: [state.playerOrder[0]!, state.playerOrder[1]!],
    teamB: [state.playerOrder[2]!, state.playerOrder[3]!],
    explanation: 'test',
    isStretch: false,
    now,
  });

  it('takes the four off the queue and marks the court in use', () => {
    let state = withPlayers(8, T0);
    state = reduce(state, start(state, T0));

    expect(state.courts.find((c) => c.id === 'court-1')!.status).toBe('in_use');
    for (const id of state.playerOrder.slice(0, 4)) {
      expect(state.players[id]!.status).toBe('playing');
    }
    expect(toSnapshot(state, T0).players.filter((p) => p.status === 'waiting')).toHaveLength(4);
  });

  it('refuses to start with anyone who is not actually available', () => {
    let state = withPlayers(8, T0);
    state = reduce(state, start(state, T0));
    // The same four are now on court; starting them again must be rejected.
    const again = reduce(state, start(state, T0, 'court-2'));
    expect(again).toBe(state);
  });

  it('credits games and court time, and resets the wait clock, on end', () => {
    let state = withPlayers(8, T0);
    state = apply(state, [
      start(state, T0),
      {
        type: 'match/end',
        courtId: 'court-1',
        winner: 'a',
        scoreA: 11,
        scoreB: 7,
        now: T0 + 12 * MINUTE,
      },
    ]);

    const player = state.players[state.playerOrder[0]!]!;
    expect(player.status).toBe('waiting');
    expect(player.gamesPlayed).toBe(1);
    expect(player.courtSeconds).toBeCloseTo(12 * 60, 0);
    expect(player.availableSince).toBe(T0 + 12 * MINUTE);
    expect(state.completed).toHaveLength(1);
    expect(state.courts.find((c) => c.id === 'court-1')!.status).toBe('open');
  });

  it('moves the winners up and the losers down', () => {
    let state = withPlayers(8, T0);
    state = apply(state, [
      start(state, T0),
      { type: 'match/end', courtId: 'court-1', winner: 'a', scoreA: 11, scoreB: 4, now: T0 + MINUTE },
    ]);

    expect(state.players[state.playerOrder[0]!]!.accumulatedDelta).toBeGreaterThan(0);
    expect(state.players[state.playerOrder[2]!]!.accumulatedDelta).toBeLessThan(0);
  });

  it('leaves ratings alone when no result is recorded', () => {
    let state = withPlayers(8, T0);
    state = apply(state, [
      start(state, T0),
      {
        type: 'match/end',
        courtId: 'court-1',
        winner: null,
        scoreA: null,
        scoreB: null,
        now: T0 + MINUTE,
      },
    ]);

    for (const id of state.playerOrder.slice(0, 4)) {
      expect(state.players[id]!.accumulatedDelta).toBe(0);
      expect(state.players[id]!.ratedGames).toBe(0);
      // The game still counts for fairness, even without a score.
      expect(state.players[id]!.gamesPlayed).toBe(1);
    }
  });

  it('cancelling returns players to the queue without touching their wait', () => {
    let state = withPlayers(8, T0);
    const before = state.players[state.playerOrder[0]!]!.availableSince;
    state = apply(state, [start(state, T0 + 5 * MINUTE), { type: 'match/cancel', courtId: 'court-1' }]);

    const player = state.players[state.playerOrder[0]!]!;
    expect(player.status).toBe('waiting');
    expect(player.gamesPlayed).toBe(0);
    // They were called and then stood down; they are owed their place.
    expect(player.availableSince).toBe(before);
    expect(state.completed).toHaveLength(0);
  });
});

describe('ending a session', () => {
  it('records games still on court instead of discarding them', () => {
    let state = withPlayers(8, T0);
    state = reduce(state, {
      type: 'match/start',
      courtId: 'court-1',
      teamA: [state.playerOrder[0]!, state.playerOrder[1]!],
      teamB: [state.playerOrder[2]!, state.playerOrder[3]!],
      explanation: 'test',
      isStretch: false,
      now: T0,
    });

    state = reduce(state, { type: 'session/end', now: T0 + 11 * MINUTE });

    expect(state.status).toBe('ended');
    expect(state.active).toEqual({});
    // The game happened; losing it would corrupt court-time fairness and the
    // leaderboard for everyone who played it.
    expect(state.completed).toHaveLength(1);
    expect(state.completed[0]!.winner).toBeNull();
    expect(state.players[state.playerOrder[0]!]!.gamesPlayed).toBe(1);
    expect(state.players[state.playerOrder[0]!]!.courtSeconds).toBeCloseTo(11 * 60, 0);
  });
});

describe('stretch credit', () => {
  it('banks credit for a strong player put into a weaker game', () => {
    let state = createSession('Test', 1);
    for (const [name, rating] of [
      ['strong', 4.5],
      ['a', 3.0],
      ['b', 3.0],
      ['c', 3.0],
    ] as const) {
      state = reduce(state, { type: 'player/add', name, rating, isGuest: false, now: T0 });
    }
    state = reduce(state, { type: 'session/start', now: T0 });

    const [s, a, b, c] = state.playerOrder as [string, string, string, string];
    state = reduce(state, {
      type: 'match/start',
      courtId: 'court-1',
      teamA: [s, a],
      teamB: [b, c],
      explanation: 'stretch',
      isStretch: true,
      now: T0,
    });

    expect(state.players[s]!.stretchCredit).toBe(1);
    expect(state.players[a]!.stretchCredit).toBe(0);
  });
});

describe('courts', () => {
  it('never removes a court that has a game on it', () => {
    let state = withPlayers(8, T0);
    state = reduce(state, {
      type: 'match/start',
      courtId: 'court-2',
      teamA: [state.playerOrder[0]!, state.playerOrder[1]!],
      teamB: [state.playerOrder[2]!, state.playerOrder[3]!],
      explanation: 'test',
      isStretch: false,
      now: T0,
    });

    state = reduce(state, { type: 'courts/set', count: 1 });
    expect(state.courts.map((c) => c.id)).toContain('court-2');
  });

  it('will not close a court mid-game', () => {
    let state = withPlayers(8, T0);
    state = reduce(state, {
      type: 'match/start',
      courtId: 'court-1',
      teamA: [state.playerOrder[0]!, state.playerOrder[1]!],
      teamB: [state.playerOrder[2]!, state.playerOrder[3]!],
      explanation: 'test',
      isStretch: false,
      now: T0,
    });
    state = reduce(state, { type: 'courts/toggle', courtId: 'court-1' });
    expect(state.courts.find((c) => c.id === 'court-1')!.status).toBe('in_use');
  });
});

describe('snapshot', () => {
  it('passes avoid pairs through to the engine', () => {
    let state = withPlayers(6, T0);
    const [a, b] = state.playerOrder as [string, string];
    state = reduce(state, { type: 'player/avoid', id: a, otherId: b, on: true });

    const snapshot = toSnapshot(state, T0);
    expect(snapshot.players.find((p) => p.id === a)!.avoid).toEqual([b]);
    expect(snapshot.players.find((p) => p.id === b)!.avoid).toBeUndefined();
  });

  it('hands completed matches to the engine as pairing history', () => {
    let state = withPlayers(8, T0);
    state = apply(state, [
      {
        type: 'match/start',
        courtId: 'court-1',
        teamA: [state.playerOrder[0]!, state.playerOrder[1]!],
        teamB: [state.playerOrder[2]!, state.playerOrder[3]!],
        explanation: 'test',
        isStretch: false,
        now: T0,
      },
      { type: 'match/end', courtId: 'court-1', winner: 'a', scoreA: 11, scoreB: 9, now: T0 + MINUTE },
    ]);

    const snapshot = toSnapshot(state, T0 + MINUTE);
    expect(snapshot.history).toHaveLength(1);
    expect(snapshot.history[0]!.teamA).toEqual([state.playerOrder[0], state.playerOrder[1]]);
  });
});

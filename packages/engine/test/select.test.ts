import { describe, expect, it } from 'vitest';
import { fillCourts } from '../src/select.js';
import { namesOf, player, snapshot, waitingFor, MINUTE, T0 } from './fixtures.js';
import type { PlayerState } from '../src/types.js';

const NOW = T0 + 60 * MINUTE;

function pool(spec: ReadonlyArray<[string, number, number]>): PlayerState[] {
  // [id, rating, minutesWaiting]
  return spec.map(([id, rating, minutes]) => waitingFor(id, rating, minutes, NOW));
}

describe('degenerate inputs — the engine is a total function', () => {
  it('reports no open courts rather than throwing', () => {
    const snap = snapshot(pool([['a', 3.5, 5]]), 0);
    const result = fillCourts(snap);
    expect(result.reason).toBe('no_open_courts');
    expect(result.matches).toEqual([]);
  });

  it('reports not enough players with fewer than four waiting', () => {
    const result = fillCourts(snapshot(pool([['a', 3.5, 5], ['b', 3.5, 5], ['c', 3.5, 5]]), 1));
    expect(result.reason).toBe('not_enough_players');
    expect(result.matches).toEqual([]);
  });

  it('distinguishes an all-excluded pool from an empty one', () => {
    const players = pool([
      ['a', 3.5, 5],
      ['b', 3.5, 5],
      ['c', 3.5, 5],
      ['d', 3.5, 5],
    ]);
    const result = fillCourts(
      snapshot(players, 1, { overrides: { excluded: ['a', 'b', 'c', 'd'] } }),
    );
    expect(result.reason).toBe('all_excluded');
  });

  it('ignores players who are playing, paused, or gone', () => {
    const players = [
      ...pool([['a', 3.5, 5], ['b', 3.5, 5], ['c', 3.5, 5], ['d', 3.5, 5]]),
      player('busy', 3.5, { status: 'playing' }),
      player('resting', 3.5, { status: 'paused' }),
      player('gone', 3.5, { status: 'left' }),
    ];
    const result = fillCourts(snapshot(players, 1));
    expect(result.reason).toBe('ok');
    expect(namesOf(result.matches[0]!)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('handles an entire pool at one identical rating', () => {
    const players = pool(
      Array.from({ length: 8 }, (_, i) => [`p${i}`, 3.5, i] as [string, number, number]),
    );
    const result = fillCourts(snapshot(players, 1));
    expect(result.reason).toBe('ok');
    expect(result.matches[0]!.breakdown.rawSpread).toBe(0);
  });

  it('never returns a player twice across simultaneous courts', () => {
    const players = pool(
      Array.from({ length: 16 }, (_, i) => [`p${i}`, 3.0 + (i % 5) * 0.25, i] as [string, number, number]),
    );
    const result = fillCourts(snapshot(players, 4));
    const all = result.matches.flatMap((m) => [...m.teamA, ...m.teamB]);
    expect(all).toHaveLength(16);
    expect(new Set(all).size).toBe(16);
  });
});

describe('skill matching', () => {
  it('groups players into a tight band rather than mixing extremes', () => {
    // Four 3.0s and four 4.5s, all waiting equally. One court: it must pick a
    // band, not one from each end.
    const players = pool([
      ['low1', 3.0, 10],
      ['low2', 3.0, 10],
      ['low3', 3.0, 10],
      ['low4', 3.0, 10],
      ['high1', 4.5, 10],
      ['high2', 4.5, 10],
      ['high3', 4.5, 10],
      ['high4', 4.5, 10],
    ]);
    const result = fillCourts(snapshot(players, 1));
    const chosen = namesOf(result.matches[0]!);

    expect(result.matches[0]!.breakdown.rawSpread).toBe(0);
    const allLow = chosen.every((n) => n.startsWith('low'));
    const allHigh = chosen.every((n) => n.startsWith('high'));
    expect(allLow || allHigh).toBe(true);
  });

  it('flags a stretch instead of refusing when no in-band foursome exists', () => {
    // One lone 2.5 among 4.5s. There is no good answer; there must still be an
    // answer, and it must be labelled.
    const players = pool([
      ['odd', 2.5, 40],
      ['h1', 4.5, 3],
      ['h2', 4.5, 3],
      ['h3', 4.5, 3],
    ]);
    const result = fillCourts(snapshot(players, 1));

    expect(result.reason).toBe('ok');
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]!.isStretch).toBe(true);
    expect(result.matches[0]!.explanation).toContain('STRETCH');
  });

  it('splits a large mixed pool into bands across simultaneous courts', () => {
    const players = pool([
      ...Array.from({ length: 4 }, (_, i) => [`a${i}`, 3.0, 10] as [string, number, number]),
      ...Array.from({ length: 4 }, (_, i) => [`b${i}`, 3.5, 10] as [string, number, number]),
      ...Array.from({ length: 4 }, (_, i) => [`c${i}`, 4.5, 10] as [string, number, number]),
    ]);
    const result = fillCourts(snapshot(players, 3));

    expect(result.matches).toHaveLength(3);
    for (const m of result.matches) {
      expect(m.breakdown.rawSpread).toBeLessThanOrEqual(0.001);
    }
  });
});

describe('wait fairness', () => {
  it('prefers long waiters over players who just came off court', () => {
    const players = pool([
      ['waited1', 3.5, 25],
      ['waited2', 3.5, 24],
      ['waited3', 3.5, 23],
      ['waited4', 3.5, 22],
      ['fresh1', 3.5, 0],
      ['fresh2', 3.5, 0],
      ['fresh3', 3.5, 0],
      ['fresh4', 3.5, 0],
    ]);
    const result = fillCourts(snapshot(players, 1));
    expect(namesOf(result.matches[0]!)).toEqual([
      'waited1',
      'waited2',
      'waited3',
      'waited4',
    ]);
  });

  it('forces a starving player on court even against a tidier alternative', () => {
    // `starved` has waited well past maxWaitRotations (2 rotations = 26 min).
    // Leaving them out would make a cleaner game, so this is exactly the case
    // the guard exists for.
    const players = pool([
      ['starved', 3.0, 45],
      ['h1', 3.5, 2],
      ['h2', 3.5, 2],
      ['h3', 3.5, 2],
      ['h4', 3.5, 2],
    ]);
    const result = fillCourts(snapshot(players, 1));

    expect(result.starving).toContain('starved');
    expect(namesOf(result.matches[0]!)).toContain('starved');
  });

  it('disables the starvation guard when more are starving than there are seats', () => {
    // 12 starving players, one court. The guard cannot be satisfied, so it must
    // stand down rather than produce nothing.
    const players = pool(
      Array.from({ length: 12 }, (_, i) => [`p${i}`, 3.5, 40 + i] as [string, number, number]),
    );
    const result = fillCourts(snapshot(players, 1));

    expect(result.reason).toBe('ok');
    expect(result.starving).toHaveLength(12);
    expect(result.matches).toHaveLength(1);
  });

  it('does not let a fresh arrival leapfrog a long-present player', () => {
    // The late arrival has waited "forever" since check-in but has no games
    // deficit, because presentSeconds is tiny. Wait is capped; deficit is not.
    const veterans = pool([
      ['vet1', 3.5, 20],
      ['vet2', 3.5, 20],
      ['vet3', 3.5, 20],
      ['vet4', 3.5, 20],
    ]).map((p) => ({ ...p, presentSeconds: 7200, gamesPlayed: 4 }));

    const latecomers = pool([
      ['late1', 3.5, 20],
      ['late2', 3.5, 20],
      ['late3', 3.5, 20],
      ['late4', 3.5, 20],
    ]).map((p) => ({ ...p, presentSeconds: 300, gamesPlayed: 0 }));

    const result = fillCourts(snapshot([...veterans, ...latecomers], 1));
    // Equal wait, but the veterans are owed games and the latecomers are not.
    expect(namesOf(result.matches[0]!)).toEqual(['vet1', 'vet2', 'vet3', 'vet4']);
  });
});

describe('organizer overrides are engine inputs, not UI escape hatches', () => {
  const base = pool([
    ['a', 3.0, 30],
    ['b', 3.0, 30],
    ['c', 3.0, 30],
    ['d', 3.0, 30],
    ['x', 4.5, 1],
    ['y', 4.5, 1],
    ['z', 4.5, 1],
    ['w', 4.5, 1],
  ]);

  it('never selects an excluded player', () => {
    const result = fillCourts(
      snapshot(base, 1, { overrides: { excluded: ['a', 'b'] } }),
    );
    const chosen = namesOf(result.matches[0]!);
    expect(chosen).not.toContain('a');
    expect(chosen).not.toContain('b');
  });

  it('places a pinned player even when the cost says otherwise', () => {
    const result = fillCourts(snapshot(base, 1, { overrides: { pinned: ['x'] } }));
    expect(namesOf(result.matches[0]!)).toContain('x');
  });

  it('honors locked slots the organizer has already filled by hand', () => {
    const result = fillCourts(
      snapshot(base, 1, { overrides: { lockedSlots: { 'court-1': ['x', 'y'] } } }),
    );
    const chosen = namesOf(result.matches[0]!);
    expect(chosen).toContain('x');
    expect(chosen).toContain('y');
    expect(chosen).toHaveLength(4);
  });

  it('keeps a must-pair couple on the same team', () => {
    const result = fillCourts(
      snapshot(base, 1, { overrides: { mustPairWith: [['a', 'x']] } }),
    );
    const m = result.matches[0]!;
    const sameTeam =
      (m.teamA.includes('a') && m.teamA.includes('x')) ||
      (m.teamB.includes('a') && m.teamB.includes('x'));
    expect(sameTeam).toBe(true);
  });

  it('keeps two players who avoid each other off the same court', () => {
    const players = base.map((p) => (p.id === 'a' ? { ...p, avoid: ['b'] } : p));
    const result = fillCourts(snapshot(players, 1));
    const chosen = namesOf(result.matches[0]!);
    expect(chosen.includes('a') && chosen.includes('b')).toBe(false);
  });

  it('applies avoid symmetrically, from either side', () => {
    const players = base.map((p) => (p.id === 'b' ? { ...p, avoid: ['a'] } : p));
    const result = fillCourts(snapshot(players, 1));
    const chosen = namesOf(result.matches[0]!);
    expect(chosen.includes('a') && chosen.includes('b')).toBe(false);
  });

  it('supports the sub-in flow: lock three, let the engine fill the fourth', () => {
    const result = fillCourts(
      snapshot(base, 1, { overrides: { lockedSlots: { 'court-1': ['a', 'b', 'c'] } } }),
    );
    const chosen = namesOf(result.matches[0]!);
    expect(chosen).toHaveLength(4);
    for (const id of ['a', 'b', 'c']) expect(chosen).toContain(id);
    // The fourth should be the in-band option, not a 4.5.
    expect(chosen).toContain('d');
  });
});

describe('repeat avoidance', () => {
  it('breaks up a pair who just partnered when an equal alternative exists', () => {
    const players = pool([
      ['a', 3.5, 20],
      ['b', 3.5, 20],
      ['c', 3.5, 20],
      ['d', 3.5, 20],
    ]).map((p) => ({ ...p, gamesPlayed: 1 }));

    const history = [
      {
        id: 'm1',
        seq: 1,
        teamA: ['a', 'b'] as const,
        teamB: ['c', 'd'] as const,
        startedAt: NOW - 20 * MINUTE,
        endedAt: NOW - 8 * MINUTE,
      },
    ];

    const result = fillCourts(snapshot(players, 1, { history }));
    const m = result.matches[0]!;
    const aWithB =
      (m.teamA.includes('a') && m.teamA.includes('b')) ||
      (m.teamB.includes('a') && m.teamB.includes('b'));
    expect(aWithB).toBe(false);
  });
});

describe('determinism', () => {
  it('produces byte-identical output for an identical snapshot', () => {
    const players = pool(
      Array.from(
        { length: 40 },
        (_, i) => [`p${i}`, 2.5 + (i % 9) * 0.25, i % 17] as [string, number, number],
      ),
    );
    const snap = snapshot(players, 6);

    const first = JSON.stringify(fillCourts(snap).matches);
    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(fillCourts(snap).matches)).toBe(first);
    }
  });

  it('is stable regardless of the order players appear in the snapshot', () => {
    const players = pool(
      Array.from({ length: 12 }, (_, i) => [`p${i}`, 3.0 + (i % 4) * 0.25, 10] as [string, number, number]),
    );
    const forward = fillCourts(snapshot(players, 2));
    const reversed = fillCourts(snapshot([...players].reverse(), 2));

    const key = (r: typeof forward) =>
      r.matches.map((m) => namesOf(m).join('+')).sort().join('|');
    expect(key(reversed)).toBe(key(forward));
  });
});

describe('explanations', () => {
  it('names the longest waiter and reports the spread and team averages', () => {
    const players = pool([
      ['ana', 3.5, 22],
      ['ben', 3.5, 4],
      ['cy', 3.5, 3],
      ['dee', 3.5, 2],
    ]);
    const text = fillCourts(snapshot(players, 1)).matches[0]!.explanation;

    expect(text).toContain('ANA');
    expect(text).toMatch(/waiting \d+m/);
    expect(text).toContain('spread');
    expect(text).toContain('teams');
    expect(text).toContain('no repeat partners');
  });
});

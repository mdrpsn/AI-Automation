import type {
  CourtState,
  EngineConfig,
  MatchRecord,
  PlayerId,
  PlayerState,
  PlayerStatus,
  Snapshot,
} from '@openplay/engine';
import { DEFAULT_CONFIG, PRESETS, ratingDelta, type PresetName } from '@openplay/engine';

/**
 * Session state for the organizer console.
 *
 * Players store raw facts (when they joined, how long they have been paused)
 * rather than derived counters, so state never needs a ticking timer to stay
 * correct — `toSnapshot` derives what the engine wants at the moment it is
 * asked. A reload then rehydrates to exactly the right numbers.
 */

export interface SessionPlayer {
  id: PlayerId;
  name: string;
  rating: number;
  ratingLocked: boolean;
  isGuest: boolean;
  avoid: PlayerId[];

  status: PlayerStatus;
  joinedAt: number;
  availableSince: number;
  /** Accumulated completed break time, in seconds. */
  pausedSeconds: number;
  /** Set while status is 'paused'. */
  pausedAt: number | null;
  leftAt: number | null;

  gamesPlayed: number;
  courtSeconds: number;
  stretchCredit: number;

  /** Rating movement banked this session; proposed only at session end. */
  accumulatedDelta: number;
  ratedGames: number;
}

export interface ActiveMatch {
  id: string;
  seq: number;
  courtId: string;
  teamA: [PlayerId, PlayerId];
  teamB: [PlayerId, PlayerId];
  startedAt: number;
  explanation: string;
  isStretch: boolean;
}

export interface CompletedMatch extends MatchRecord {
  courtId: string;
  winner: 'a' | 'b' | null;
  scoreA: number | null;
  scoreB: number | null;
  explanation: string;
}

export interface SessionState {
  id: string;
  name: string;
  /** Read-only link handed to players. Rotatable. */
  shareToken: string;
  /** Write secret held only by the organizer's device. Never leaves it. */
  publishToken: string;
  /** Off by default: showing players their assigned rating starts arguments. */
  publicShowRatings: boolean;
  /** Whether this session is being published for players to watch. */
  published: boolean;
  status: 'setup' | 'live' | 'ended';
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;

  presetName: PresetName;
  config: EngineConfig;

  courts: CourtState[];
  players: Record<PlayerId, SessionPlayer>;
  /** Insertion order, so the roster does not reshuffle as things change. */
  playerOrder: PlayerId[];

  active: Record<string, ActiveMatch>;
  completed: CompletedMatch[];
  seq: number;
}

let idCounter = 0;
/** Stable, collision-free ids without pulling in a uuid dependency. */
export function newId(prefix: string): string {
  idCounter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}${rand}`;
}

const TOKEN_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';

/**
 * A share token is the only thing standing between a stranger and a session's
 * live page, so it comes from a real CSPRNG rather than Math.random. 22
 * characters of this alphabet is ~110 bits.
 */
export function newToken(length = 22): string {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += TOKEN_ALPHABET[byte % TOKEN_ALPHABET.length];
  return out;
}

export function createSession(
  name: string,
  courtCount: number,
  preset: PresetName = 'balanced',
): SessionState {
  const now = Date.now();
  return {
    id: newId('s'),
    name,
    shareToken: newToken(),
    publishToken: newToken(32),
    publicShowRatings: false,
    published: false,
    status: 'setup',
    createdAt: now,
    startedAt: null,
    endedAt: null,
    presetName: preset,
    config: { ...DEFAULT_CONFIG, ...PRESETS[preset] },
    courts: Array.from({ length: courtCount }, (_, i) => ({
      id: `court-${i + 1}`,
      label: `Court ${i + 1}`,
      status: 'open' as const,
    })),
    players: {},
    playerOrder: [],
    active: {},
    completed: [],
    seq: 0,
  };
}

/**
 * Seconds this player has actually been present and available — excluding
 * breaks, and excluding time before they checked in. This is what stops a late
 * arrival being owed as many games as someone there since the start.
 */
export function presentSeconds(player: SessionPlayer, now: number): number {
  const end = player.leftAt ?? now;
  const gross = Math.max(0, (end - player.joinedAt) / 1000);
  const paused =
    player.pausedSeconds +
    (player.pausedAt !== null ? Math.max(0, (now - player.pausedAt) / 1000) : 0);
  return Math.max(0, gross - paused);
}

/** Build the plain snapshot the engine consumes. */
export function toSnapshot(state: SessionState, now: number): Snapshot {
  const players: PlayerState[] = state.playerOrder.map((id) => {
    const p = state.players[id]!;
    return {
      id: p.id,
      name: p.name,
      rating: p.rating,
      status: p.status,
      availableSince: p.availableSince,
      presentSeconds: presentSeconds(p, now),
      gamesPlayed: p.gamesPlayed,
      courtSeconds: p.courtSeconds,
      stretchCredit: p.stretchCredit,
      ...(p.avoid.length > 0 ? { avoid: p.avoid } : {}),
    };
  });

  const history: MatchRecord[] = state.completed.map((m) => ({
    id: m.id,
    seq: m.seq,
    teamA: m.teamA,
    teamB: m.teamB,
    startedAt: m.startedAt,
    endedAt: m.endedAt,
  }));

  return { now, players, courts: state.courts, history, config: state.config };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'session/rename'; name: string }
  | { type: 'session/publish'; on: boolean }
  | { type: 'session/showRatings'; on: boolean }
  | { type: 'session/rotateShareToken' }
  | { type: 'session/preset'; preset: PresetName }
  | { type: 'session/spreadCap'; cap: number }
  | { type: 'session/start'; now: number }
  | { type: 'session/end'; now: number }
  | { type: 'courts/set'; count: number }
  | { type: 'courts/toggle'; courtId: string }
  | { type: 'player/add'; name: string; rating: number; isGuest: boolean; now: number }
  | { type: 'player/edit'; id: PlayerId; name?: string; rating?: number; ratingLocked?: boolean }
  | { type: 'player/avoid'; id: PlayerId; otherId: PlayerId; on: boolean }
  | { type: 'player/pause'; id: PlayerId; now: number }
  | { type: 'player/resume'; id: PlayerId; now: number }
  | { type: 'player/leave'; id: PlayerId; now: number }
  | { type: 'player/rejoin'; id: PlayerId; now: number }
  | {
      type: 'match/start';
      courtId: string;
      teamA: [PlayerId, PlayerId];
      teamB: [PlayerId, PlayerId];
      explanation: string;
      isStretch: boolean;
      now: number;
    }
  | {
      type: 'match/end';
      courtId: string;
      winner: 'a' | 'b' | null;
      scoreA: number | null;
      scoreB: number | null;
      now: number;
    }
  | { type: 'match/cancel'; courtId: string };

function clone(state: SessionState): SessionState {
  return {
    ...state,
    courts: state.courts.map((c) => ({ ...c })),
    players: Object.fromEntries(
      Object.entries(state.players).map(([id, p]) => [id, { ...p, avoid: [...p.avoid] }]),
    ),
    playerOrder: [...state.playerOrder],
    active: Object.fromEntries(Object.entries(state.active).map(([k, m]) => [k, { ...m }])),
    completed: [...state.completed],
  };
}

export function reduce(state: SessionState, action: Action): SessionState {
  const next = clone(state);

  switch (action.type) {
    case 'session/rename':
      next.name = action.name;
      return next;

    case 'session/publish':
      next.published = action.on;
      return next;

    case 'session/showRatings':
      next.publicShowRatings = action.on;
      return next;

    case 'session/rotateShareToken':
      // Revoking a link that got shared too widely. The old one 404s at once.
      next.shareToken = newToken();
      return next;

    case 'session/preset':
      next.presetName = action.preset;
      next.config = { ...next.config, ...PRESETS[action.preset] };
      return next;

    case 'session/spreadCap':
      next.config = { ...next.config, spreadCap: action.cap };
      return next;

    case 'session/start':
      next.status = 'live';
      next.startedAt = action.now;
      return next;

    case 'session/end': {
      // Close out anything still on court. Discarding an in-flight match would
      // lose games people actually played, which corrupts both the fairness
      // accounting and the leaderboard. No winner is recorded, so ratings are
      // untouched, but the court time counts.
      let closing = next;
      for (const courtId of Object.keys(next.active)) {
        closing = reduce(closing, {
          type: 'match/end',
          courtId,
          winner: null,
          scoreA: null,
          scoreB: null,
          now: action.now,
        });
      }
      closing.status = 'ended';
      closing.endedAt = action.now;
      return closing;
    }

    case 'courts/set': {
      const count = Math.max(1, Math.min(12, action.count));
      const kept = next.courts.slice(0, count);
      for (let i = kept.length; i < count; i++) {
        kept.push({ id: `court-${i + 1}`, label: `Court ${i + 1}`, status: 'open' });
      }
      // Never drop a court that has a match on it.
      for (const courtId of Object.keys(next.active)) {
        if (!kept.some((c) => c.id === courtId)) {
          const court = state.courts.find((c) => c.id === courtId);
          if (court) kept.push({ ...court });
        }
      }
      kept.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
      next.courts = kept;
      return next;
    }

    case 'courts/toggle': {
      next.courts = next.courts.map((c) =>
        c.id === action.courtId && c.status !== 'in_use'
          ? { ...c, status: c.status === 'open' ? 'closed' : 'open' }
          : c,
      );
      return next;
    }

    case 'player/add': {
      const id = newId('p');
      next.players[id] = {
        id,
        name: action.name.trim(),
        rating: action.rating,
        ratingLocked: false,
        isGuest: action.isGuest,
        avoid: [],
        status: 'waiting',
        joinedAt: action.now,
        availableSince: action.now,
        pausedSeconds: 0,
        pausedAt: null,
        leftAt: null,
        gamesPlayed: 0,
        courtSeconds: 0,
        stretchCredit: 0,
        accumulatedDelta: 0,
        ratedGames: 0,
      };
      next.playerOrder.push(id);
      return next;
    }

    case 'player/edit': {
      const p = next.players[action.id];
      if (!p) return state;
      if (action.name !== undefined) p.name = action.name.trim();
      if (action.rating !== undefined) p.rating = action.rating;
      if (action.ratingLocked !== undefined) p.ratingLocked = action.ratingLocked;
      return next;
    }

    case 'player/avoid': {
      const p = next.players[action.id];
      if (!p) return state;
      p.avoid = action.on
        ? [...new Set([...p.avoid, action.otherId])]
        : p.avoid.filter((x) => x !== action.otherId);
      return next;
    }

    case 'player/pause': {
      const p = next.players[action.id];
      // Someone on court cannot take a break mid-game; end the match first.
      if (!p || p.status !== 'waiting') return state;
      p.status = 'paused';
      p.pausedAt = action.now;
      return next;
    }

    case 'player/resume': {
      const p = next.players[action.id];
      if (!p || p.status !== 'paused') return state;
      if (p.pausedAt !== null) p.pausedSeconds += Math.max(0, (action.now - p.pausedAt) / 1000);
      p.pausedAt = null;
      p.status = 'waiting';
      // Back from a break is back of the queue, not credit for waiting through it.
      p.availableSince = action.now;
      return next;
    }

    case 'player/leave': {
      const p = next.players[action.id];
      if (!p || p.status === 'playing') return state;
      if (p.status === 'paused' && p.pausedAt !== null) {
        p.pausedSeconds += Math.max(0, (action.now - p.pausedAt) / 1000);
        p.pausedAt = null;
      }
      p.status = 'left';
      p.leftAt = action.now;
      return next;
    }

    case 'player/rejoin': {
      const p = next.players[action.id];
      if (!p || p.status !== 'left') return state;
      p.status = 'waiting';
      p.leftAt = null;
      p.availableSince = action.now;
      return next;
    }

    case 'match/start': {
      const court = next.courts.find((c) => c.id === action.courtId);
      if (!court || court.status !== 'open') return state;

      const ids = [...action.teamA, ...action.teamB];
      if (new Set(ids).size !== 4) return state;
      if (ids.some((id) => next.players[id]?.status !== 'waiting')) return state;

      next.seq += 1;
      const avgRating = ids.reduce((sum, id) => sum + next.players[id]!.rating, 0) / 4;

      for (const id of ids) {
        const p = next.players[id]!;
        p.status = 'playing';
        // Bank credit for playing down, so the same obliging strong player is
        // not drafted into weaker games all night.
        if (p.rating - avgRating > next.config.stretchThreshold) p.stretchCredit += 1;
        else p.stretchCredit = Math.max(0, p.stretchCredit - 0.34);
      }

      court.status = 'in_use';
      next.active[action.courtId] = {
        id: newId('m'),
        seq: next.seq,
        courtId: action.courtId,
        teamA: action.teamA,
        teamB: action.teamB,
        startedAt: action.now,
        explanation: action.explanation,
        isStretch: action.isStretch,
      };
      return next;
    }

    case 'match/end': {
      const match = next.active[action.courtId];
      if (!match) return state;

      const durationSeconds = Math.max(0, (action.now - match.startedAt) / 1000);
      const ids = [...match.teamA, ...match.teamB];

      for (const id of ids) {
        const p = next.players[id];
        if (!p) continue;
        p.status = 'waiting';
        p.availableSince = action.now;
        p.gamesPlayed += 1;
        p.courtSeconds += durationSeconds;
      }

      if (action.winner !== null) {
        const roster = ids.map((id) => next.players[id]);
        if (roster.every((p): p is SessionPlayer => p !== undefined)) {
          const [pa1, pa2, pb1, pb2] = roster as [
            SessionPlayer,
            SessionPlayer,
            SessionPlayer,
            SessionPlayer,
          ];
          const delta = ratingDelta(
            {
              teamARatings: [pa1.rating, pa2.rating],
              teamBRatings: [pb1.rating, pb2.rating],
              winner: action.winner,
              ...(action.scoreA !== null && action.scoreB !== null
                ? { scoreA: action.scoreA, scoreB: action.scoreB }
                : {}),
            },
            [pa1.ratedGames, pa2.ratedGames, pb1.ratedGames, pb2.ratedGames],
          );
          pa1.accumulatedDelta += delta.teamA;
          pa2.accumulatedDelta += delta.teamA;
          pb1.accumulatedDelta += delta.teamB;
          pb2.accumulatedDelta += delta.teamB;
          for (const p of roster) p.ratedGames += 1;
        }
      }

      next.completed.push({
        id: match.id,
        seq: match.seq,
        courtId: match.courtId,
        teamA: match.teamA,
        teamB: match.teamB,
        startedAt: match.startedAt,
        endedAt: action.now,
        winner: action.winner,
        scoreA: action.scoreA,
        scoreB: action.scoreB,
        explanation: match.explanation,
      });

      delete next.active[action.courtId];
      const court = next.courts.find((c) => c.id === action.courtId);
      if (court) court.status = 'open';
      return next;
    }

    case 'match/cancel': {
      const match = next.active[action.courtId];
      if (!match) return state;
      // No game happened, so wait time is left untouched: these people are owed
      // their place in the queue, not sent to the back of it.
      for (const id of [...match.teamA, ...match.teamB]) {
        const p = next.players[id];
        if (p) p.status = 'waiting';
      }
      delete next.active[action.courtId];
      const court = next.courts.find((c) => c.id === action.courtId);
      if (court) court.status = 'open';
      return next;
    }

    default:
      return state;
  }
}

import { DEFAULT_CONFIG } from '../src/config.js';
import type {
  CourtState,
  EngineConfig,
  MatchRecord,
  PlayerState,
  Snapshot,
} from '../src/types.js';

export const T0 = 1_700_000_000_000;
export const MINUTE = 60_000;

/** A player with sensible defaults; override only what a test cares about. */
export function player(
  id: string,
  rating: number,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return {
    id,
    name: id.toUpperCase(),
    rating,
    status: 'waiting',
    availableSince: T0,
    presentSeconds: 3600,
    gamesPlayed: 3,
    courtSeconds: 2340,
    stretchCredit: 0,
    ...overrides,
  };
}

/** Players waiting a given number of minutes as of `now`. */
export function waitingFor(
  id: string,
  rating: number,
  minutes: number,
  now: number,
  overrides: Partial<PlayerState> = {},
): PlayerState {
  return player(id, rating, { availableSince: now - minutes * MINUTE, ...overrides });
}

export function courts(count: number, status: CourtState['status'] = 'open'): CourtState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `court-${i + 1}`,
    label: `Court ${i + 1}`,
    status,
  }));
}

export function match(
  seq: number,
  teamA: readonly [string, string],
  teamB: readonly [string, string],
  now: number,
): MatchRecord {
  return {
    id: `m${seq}`,
    seq,
    teamA,
    teamB,
    startedAt: now - 13 * MINUTE,
    endedAt: now - MINUTE,
  };
}

export function snapshot(
  players: readonly PlayerState[],
  courtCount = 1,
  overrides: Partial<Snapshot> = {},
): Snapshot {
  const config: EngineConfig = { ...DEFAULT_CONFIG, ...(overrides.config ?? {}) };
  return {
    now: T0 + 60 * MINUTE,
    players,
    courts: courts(courtCount),
    history: [],
    // Pin the rotation so wait maths in tests is exact and readable.
    rotationSeconds: 780,
    ...overrides,
    config,
  };
}

/** Names of everyone in the first proposed match, sorted for stable comparison. */
export function namesOf(match: { teamA: readonly string[]; teamB: readonly string[] }): string[] {
  return [...match.teamA, ...match.teamB].sort();
}

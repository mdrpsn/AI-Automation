import type { PlayerId } from '@openplay/engine';
import { makePriorityContext, priority } from '@openplay/engine';
import { toSnapshot, type SessionState } from './session.js';

/**
 * What players are allowed to see.
 *
 * This is a hand-built projection, not a filtered copy of the session. That is
 * deliberate: adding a field to SessionState must never silently publish it.
 * Anything a player should not see — "keep apart from" pairs, rating movement,
 * the publish token — simply has nowhere to travel through.
 */

export interface PublicCourt {
  label: string;
  state: 'playing' | 'open' | 'closed';
  teamA?: string[];
  teamB?: string[];
  /** Epoch ms; the client renders the running clock so it stays live. */
  startedAt?: number;
}

export interface PublicQueueEntry {
  name: string;
  /** Only present when the organizer has opted in. */
  rating?: number;
  waitSeconds: number;
  games: number;
  /** In a proposal the organizer has not started yet. */
  upNext: boolean;
  onBreak: boolean;
  /** Rough seconds until this person is likely on court. */
  etaSeconds: number | null;
}

export interface PublicCheckIn {
  open: boolean;
  /** Players must supply a DUPR ID before the form will submit. */
  duprRequired: boolean;
}

export interface PublicSnapshot {
  sessionName: string;
  status: SessionState['status'];
  updatedAt: number;
  showRatings: boolean;
  rotationSeconds: number;
  courts: PublicCourt[];
  queue: PublicQueueEntry[];
  totals: { waiting: number; playing: number; games: number };
  checkIn: PublicCheckIn;
}

/**
 * Estimated wait for someone at `index` in the queue.
 *
 * Courts free one at a time, so roughly every `rotation / courts` a group of
 * four comes off. Deliberately coarse — players read this as "about 20 minutes",
 * and a precise-looking number would only be precisely wrong.
 */
function estimateEta(
  index: number,
  activeCourts: number,
  rotationSeconds: number,
  soonestFreeSeconds: number | null,
): number | null {
  if (activeCourts === 0) return null;
  const groupsAhead = Math.floor(index / 4);
  const perGroup = rotationSeconds / activeCourts;
  const base = soonestFreeSeconds ?? perGroup;
  return Math.max(0, Math.round(base + groupsAhead * perGroup));
}

export function buildPublicSnapshot(
  state: SessionState,
  now: number,
  /** Players in proposals the organizer has not started yet. */
  upNextIds: readonly PlayerId[] = [],
): PublicSnapshot {
  const snapshot = toSnapshot(state, now);
  const ctx = makePriorityContext(snapshot);
  const upNext = new Set(upNextIds);

  const courts: PublicCourt[] = state.courts.map((court) => {
    const active = state.active[court.id];
    if (active) {
      return {
        label: court.label,
        state: 'playing',
        teamA: active.teamA.map((id) => state.players[id]?.name ?? '—'),
        teamB: active.teamB.map((id) => state.players[id]?.name ?? '—'),
        startedAt: active.startedAt,
      };
    }
    return { label: court.label, state: court.status === 'closed' ? 'closed' : 'open' };
  });

  // When the next court is likely to free up, for the ETA at the top of the queue.
  const running = Object.values(state.active);
  const soonestFreeSeconds =
    running.length === 0
      ? null
      : Math.max(
          0,
          Math.min(
            ...running.map((m) => ctx.rotationSeconds - (now - m.startedAt) / 1000),
          ),
        );

  const waiting = snapshot.players
    .filter((p) => p.status === 'waiting')
    .map((p) => ({ player: p, score: priority(p, ctx) }))
    .sort((a, b) => b.score - a.score || (a.player.name < b.player.name ? -1 : 1));

  const paused = snapshot.players.filter((p) => p.status === 'paused');
  const activeCourts = state.courts.filter((c) => c.status !== 'closed').length;

  const queue: PublicQueueEntry[] = [
    ...waiting.map(({ player }, index) => ({
      name: player.name,
      ...(state.publicShowRatings ? { rating: player.rating } : {}),
      waitSeconds: Math.max(0, Math.round((now - player.availableSince) / 1000)),
      games: player.gamesPlayed,
      upNext: upNext.has(player.id),
      onBreak: false,
      etaSeconds: upNext.has(player.id)
        ? 0
        : estimateEta(index, activeCourts, ctx.rotationSeconds, soonestFreeSeconds),
    })),
    ...paused.map((player) => ({
      name: player.name,
      ...(state.publicShowRatings ? { rating: player.rating } : {}),
      waitSeconds: 0,
      games: player.gamesPlayed,
      upNext: false,
      onBreak: true,
      etaSeconds: null,
    })),
  ];

  return {
    sessionName: state.name,
    status: state.status,
    updatedAt: now,
    showRatings: state.publicShowRatings,
    rotationSeconds: ctx.rotationSeconds,
    courts,
    queue,
    totals: {
      waiting: waiting.length,
      playing: running.length * 4,
      games: state.completed.length,
    },
    checkIn: {
      // Check-in closes with the session; nobody should be joining a queue for
      // a session that has finished.
      open: state.checkInOpen && state.status !== 'ended',
      duprRequired: state.duprRequired,
    },
  };
}

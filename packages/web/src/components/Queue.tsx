'use client';

import { useMemo } from 'react';
import type { PlayerId } from '@openplay/engine';
import { makePriorityContext, priority, rawWaitRotations } from '@openplay/engine';
import type { SessionState } from '@/lib/session';
import { toSnapshot } from '@/lib/session';
import { formatWait } from '@/lib/format';
import { RatingBadge, WaitBadge } from './primitives';

export interface QueueRow {
  id: PlayerId;
  name: string;
  rating: number;
  waitSeconds: number;
  waitRotations: number;
  gamesPlayed: number;
  starving: boolean;
  status: 'waiting' | 'paused';
}

/**
 * The queue in the engine's own priority order, so what the organizer sees
 * matches what the engine will do. Sorting this by raw wait time instead would
 * quietly disagree with the proposals and undermine trust in both.
 */
export function useQueueRows(state: SessionState, now: number): QueueRow[] {
  return useMemo(() => {
    const snapshot = toSnapshot(state, now);
    const ctx = makePriorityContext(snapshot);

    const rows: (QueueRow & { score: number })[] = [];
    for (const player of snapshot.players) {
      if (player.status !== 'waiting' && player.status !== 'paused') continue;
      const waitSeconds = Math.max(0, (now - player.availableSince) / 1000);
      const rotations = rawWaitRotations(player, now, ctx.rotationSeconds);
      rows.push({
        id: player.id,
        name: player.name,
        rating: player.rating,
        waitSeconds,
        waitRotations: rotations,
        gamesPlayed: player.gamesPlayed,
        starving: player.status === 'waiting' && rotations >= state.config.maxWaitRotations,
        status: player.status === 'paused' ? 'paused' : 'waiting',
        score: player.status === 'waiting' ? priority(player, ctx) : -Infinity,
      });
    }

    rows.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
    return rows.map(({ score: _score, ...row }) => row);
  }, [state, now]);
}

export function QueueList({
  rows,
  onPause,
  onResume,
  onLeave,
  selectingFor,
  onSelect,
}: {
  rows: QueueRow[];
  onPause: (id: PlayerId) => void;
  onResume: (id: PlayerId) => void;
  onLeave: (id: PlayerId) => void;
  /** When set, tapping a row picks that player as a replacement. */
  selectingFor?: { courtId: string; outId: PlayerId } | null;
  onSelect?: (id: PlayerId) => void;
}) {
  if (rows.length === 0) {
    return <p className="px-1 py-6 text-center text-sm text-ink-faint">Nobody in the queue.</p>;
  }

  return (
    <ul className="space-y-1.5">
      {rows.map((row, index) => {
        const paused = row.status === 'paused';
        const selectable = Boolean(selectingFor) && !paused;

        return (
          <li
            key={row.id}
            className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
              paused
                ? 'border-surface-line bg-surface-sunk opacity-70'
                : row.starving
                  ? 'border-stop/30 bg-stop-soft'
                  : 'border-surface-line bg-surface'
            }`}
          >
            <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-ink-faint">
              {paused ? '–' : index + 1}
            </span>

            <button
              type="button"
              disabled={!selectable}
              onClick={() => selectable && onSelect?.(row.id)}
              className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
                selectable ? 'rounded-lg hover:bg-accent-soft' : 'cursor-default'
              }`}
            >
              <span className="truncate font-semibold">{row.name}</span>
              <RatingBadge rating={row.rating} dim={paused} />
            </button>

            <span className="flex shrink-0 items-center gap-1.5">
              <span className="text-xs tabular-nums text-ink-faint" title="Games played">
                {row.gamesPlayed}g
              </span>
              {paused ? (
                <span className="chip bg-surface-sunk text-ink-faint">on break</span>
              ) : (
                <WaitBadge label={formatWait(row.waitSeconds)} urgent={row.starving} />
              )}
            </span>

            {selectingFor ? null : (
              <span className="flex shrink-0 gap-1">
                {paused ? (
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs font-bold text-go hover:bg-go-soft"
                    onClick={() => onResume(row.id)}
                  >
                    back
                  </button>
                ) : (
                  <button
                    type="button"
                    className="rounded-lg px-2 py-1 text-xs font-bold text-ink-soft hover:bg-surface-sunk"
                    onClick={() => onPause(row.id)}
                  >
                    break
                  </button>
                )}
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-xs font-bold text-ink-faint hover:bg-stop-soft hover:text-stop"
                  onClick={() => onLeave(row.id)}
                >
                  left
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

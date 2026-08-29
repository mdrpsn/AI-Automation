'use client';

import type { PlayerId } from '@openplay/engine';
import type { SessionPlayer } from '@/lib/session';
import { RatingBadge } from './primitives';

/** One side of a match. Names lead; ratings are secondary detail. */
export function TeamRow({
  ids,
  players,
  label,
  onTapPlayer,
  highlight,
}: {
  ids: readonly PlayerId[];
  players: Record<PlayerId, SessionPlayer>;
  label: string;
  onTapPlayer?: (id: PlayerId) => void;
  highlight?: boolean;
}) {
  const average =
    ids.reduce((sum, id) => sum + (players[id]?.rating ?? 0), 0) / Math.max(1, ids.length);

  return (
    <div
      className={`rounded-xl px-3 py-2 ${highlight ? 'bg-go-soft' : 'bg-surface-sunk'}`}
    >
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-faint">{label}</span>
        <span className="text-xs tabular-nums text-ink-faint">avg {average.toFixed(2)}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-2">
        {ids.map((id) => {
          const player = players[id];
          if (!player) return null;
          const content = (
            <>
              <span className="truncate font-semibold">{player.name}</span>
              <RatingBadge rating={player.rating} dim />
            </>
          );
          return onTapPlayer ? (
            <button
              key={id}
              type="button"
              onClick={() => onTapPlayer(id)}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-surface-line
                         bg-surface px-2 hover:border-accent hover:bg-accent-soft"
              title="Tap to swap this player out"
            >
              {content}
            </button>
          ) : (
            <span
              key={id}
              className="inline-flex min-h-[36px] items-center gap-2 rounded-lg bg-surface px-2"
            >
              {content}
            </span>
          );
        })}
      </div>
    </div>
  );
}

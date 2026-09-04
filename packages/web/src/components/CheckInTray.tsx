'use client';

import { useMemo } from 'react';
import type { PendingCheckIn } from '@/lib/checkin';
import { looksLikeSamePerson } from '@/lib/checkin';
import type { Action, SessionState } from '@/lib/session';
import { formatRating } from '@/lib/format';

/**
 * People who have scanned the QR and are waiting to be let in.
 *
 * Nothing here has reached the matching engine yet. That is the point of the
 * step: a claimed rating is the one piece of stranger input that can wreck a
 * game, and the person is standing in front of the organizer anyway.
 */
export function CheckInTray({
  state,
  dispatch,
  pending,
  resolve,
  reachable,
}: {
  state: SessionState;
  dispatch: (action: Action) => void;
  pending: PendingCheckIn[];
  resolve: (ids: readonly string[]) => Promise<void>;
  reachable: boolean;
}) {
  const roster = useMemo(
    () => state.playerOrder.map((id) => state.players[id]!),
    [state.playerOrder, state.players],
  );

  const rows = useMemo(
    () =>
      pending.map((entry) => ({
        entry,
        // Someone already checked in under this name — usually a double scan,
        // occasionally a namesake. Either way the organizer should look.
        duplicate: roster.find(
          (p) => p.status !== 'left' && looksLikeSamePerson(p.name, entry.name),
        ),
      })),
    [pending, roster],
  );

  const accept = (entry: PendingCheckIn) => {
    dispatch({
      type: 'player/add',
      name: entry.name,
      rating: entry.rating,
      isGuest: true,
      selfReported: true,
      ...(entry.duprId ? { duprId: entry.duprId } : {}),
      now: Date.now(),
    });
    void resolve([entry.id]);
  };

  const acceptAll = () => {
    const now = Date.now();
    for (const { entry } of rows) {
      dispatch({
        type: 'player/add',
        name: entry.name,
        rating: entry.rating,
        isGuest: true,
        selfReported: true,
        ...(entry.duprId ? { duprId: entry.duprId } : {}),
        now,
      });
    }
    void resolve(rows.map((row) => row.entry.id));
  };

  if (!state.checkInOpen) return null;

  return (
    <section className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-bold">
          Checking in{pending.length > 0 ? ` (${pending.length})` : ''}
        </h2>
        {!reachable ? (
          <span className="chip bg-warn-soft text-warn">offline</span>
        ) : pending.length > 1 ? (
          <button type="button" className="btn-go px-3 text-sm" onClick={acceptAll}>
            Accept all
          </button>
        ) : null}
      </div>

      {pending.length === 0 ? (
        <p className="text-sm text-ink-faint">
          Nobody waiting. Anyone who scans the QR shows up here before they join the queue.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(({ entry, duplicate }) => (
            <li
              key={entry.id}
              className={`rounded-xl border px-3 py-2 ${
                duplicate ? 'border-warn/40 bg-warn-soft' : 'border-surface-line'
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{entry.name}</span>
                  <span className="block text-xs text-ink-faint">
                    says {formatRating(entry.rating)}
                    {entry.duprId ? ` · DUPR ${entry.duprId}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  className="btn-go px-3 text-sm"
                  onClick={() => accept(entry)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  className="rounded-lg px-2 py-1 text-xs font-bold text-ink-faint hover:bg-stop-soft hover:text-stop"
                  onClick={() => void resolve([entry.id])}
                >
                  Decline
                </button>
              </div>
              {duplicate ? (
                <p className="mt-1 text-xs font-semibold text-warn">
                  {duplicate.name} is already checked in at {formatRating(duplicate.rating)} —
                  probably a second scan.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2 text-xs text-ink-faint">
        Accepted players are marked <strong>self-rated</strong> in the roster until you confirm or
        change their level.
      </p>
    </section>
  );
}

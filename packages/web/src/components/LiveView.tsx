'use client';

import { useEffect, useRef, useState } from 'react';
import type { PublicSnapshot } from '@/lib/publicSnapshot';
import { formatDuration, formatRating } from '@/lib/format';

function etaLabel(seconds: number | null): string {
  if (seconds === null) return '';
  if (seconds <= 30) return 'now';
  const minutes = Math.round(seconds / 60);
  return minutes <= 1 ? '~1 min' : `~${minutes} min`;
}

/**
 * What a player sees after scanning the QR at the fence.
 *
 * Read-only by construction: there is no way to act from here, so nobody can
 * argue their way up the queue through the app.
 */
export function LiveView({
  token,
  initial,
  initialUpdatedAt,
}: {
  token: string;
  initial: PublicSnapshot;
  initialUpdatedAt: number;
}) {
  const [snapshot, setSnapshot] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [connected, setConnected] = useState(true);
  const updatedAt = useRef(initialUpdatedAt);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Long-poll loop. Each response immediately re-issues the next request, so a
  // dropped connection heals itself on the following pass instead of leaving
  // the page silently stale.
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      while (!cancelled) {
        try {
          const response = await fetch(
            `/api/live/${encodeURIComponent(token)}/stream?since=${updatedAt.current}`,
            { cache: 'no-store' },
          );
          if (cancelled) return;

          if (!response.ok) {
            setConnected(false);
            await new Promise((r) => setTimeout(r, 5000));
            continue;
          }

          const body = (await response.json()) as {
            changed: boolean;
            snapshot?: PublicSnapshot;
            updatedAt?: number;
          };
          setConnected(true);
          if (body.changed && body.snapshot && body.updatedAt) {
            updatedAt.current = body.updatedAt;
            setSnapshot(body.snapshot);
          }
        } catch {
          if (cancelled) return;
          setConnected(false);
          await new Promise((r) => setTimeout(r, 5000));
        }
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const playing = snapshot.courts.filter((c) => c.state === 'playing');

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-3 pb-10">
      <header className="flex items-baseline justify-between gap-2 pt-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold">{snapshot.sessionName}</h1>
          <p className="text-xs text-ink-faint">
            {snapshot.totals.waiting} waiting · {snapshot.totals.playing} on court ·{' '}
            {snapshot.totals.games} games
          </p>
        </div>
        <span
          className={`chip shrink-0 ${connected ? 'bg-go-soft text-go' : 'bg-warn-soft text-warn'}`}
        >
          {connected ? 'live' : 'reconnecting'}
        </span>
      </header>

      {snapshot.status === 'ended' ? (
        <p className="rounded-xl bg-surface-sunk px-3 py-2 text-sm text-ink-soft">
          This session has finished.
        </p>
      ) : null}

      {snapshot.checkIn.open ? (
        <a
          href={`/join/${token}`}
          className="flex items-center justify-between gap-2 rounded-xl border border-accent
                     bg-accent-soft px-3 py-2.5 text-sm font-bold text-accent"
        >
          <span>Not on the list yet? Check in</span>
          <span aria-hidden="true">&rarr;</span>
        </a>
      ) : null}

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-ink-faint">
          On court
        </h2>
        {playing.length === 0 ? (
          <p className="px-1 text-sm text-ink-faint">No games running right now.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {playing.map((court) => (
              <div key={court.label} className="card overflow-hidden">
                <div className="flex items-center justify-between bg-go px-3 py-1.5 text-white">
                  <span className="text-sm font-bold">{court.label}</span>
                  <span className="text-sm tabular-nums">
                    {court.startedAt ? formatDuration((now - court.startedAt) / 1000) : ''}
                  </span>
                </div>
                <div className="p-2 text-sm">
                  <p className="font-semibold">{court.teamA?.join(' & ')}</p>
                  {/* A ruled divider reads as "these two sides" at a glance;
                      a bare letter floating between the lines does not. */}
                  <div className="my-1.5 flex items-center gap-2" aria-hidden="true">
                    <span className="h-px flex-1 bg-surface-line" />
                    <span className="text-[10px] font-bold uppercase tracking-wider text-ink-faint">
                      vs
                    </span>
                    <span className="h-px flex-1 bg-surface-line" />
                  </div>
                  <p className="font-semibold">{court.teamB?.join(' & ')}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-bold uppercase tracking-wide text-ink-faint">
          Queue
        </h2>
        {snapshot.queue.length === 0 ? (
          <p className="px-1 text-sm text-ink-faint">Nobody waiting.</p>
        ) : (
          <ul className="space-y-1">
            {snapshot.queue.map((entry, index) => (
              <li
                key={`${entry.name}-${index}`}
                className={`flex items-center gap-2 rounded-xl border px-3 py-2 ${
                  entry.onBreak
                    ? 'border-surface-line bg-surface-sunk opacity-70'
                    : entry.upNext
                      ? 'border-go bg-go-soft'
                      : 'border-surface-line bg-surface'
                }`}
              >
                <span className="w-6 shrink-0 text-center text-sm font-bold tabular-nums text-ink-faint">
                  {entry.onBreak ? '–' : index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-semibold">{entry.name}</span>
                {entry.rating !== undefined ? (
                  <span className="chip shrink-0 bg-surface-sunk text-ink-faint">
                    {formatRating(entry.rating)}
                  </span>
                ) : null}
                <span className="shrink-0 text-xs tabular-nums text-ink-faint">
                  {entry.games}g
                </span>
                <span className="w-16 shrink-0 text-right text-xs font-semibold tabular-nums">
                  {entry.onBreak ? (
                    <span className="text-ink-faint">on break</span>
                  ) : entry.upNext ? (
                    <span className="text-go">up next</span>
                  ) : (
                    <span className="text-ink-soft">{etaLabel(entry.etaSeconds)}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="px-1 text-center text-xs text-ink-faint">
        Wait times are estimates. The organizer has the final say on matchups.
      </p>
    </main>
  );
}

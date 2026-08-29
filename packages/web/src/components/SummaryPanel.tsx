'use client';

import { useMemo, useState } from 'react';
import { settleSession, type PendingRating } from '@openplay/engine';
import type { SessionState } from '@/lib/session';
import { formatDuration, formatRating, formatSigned } from '@/lib/format';

/**
 * End of session: what happened, and which ratings the engine wants to change.
 *
 * Changes are proposed, never silently applied. In practice most nights produce
 * none at all — one session is about nine games, which is not enough evidence
 * to separate a mis-rating from a hot streak, so the engine banks it instead.
 */
export function SummaryPanel({ state }: { state: SessionState }) {
  const [applied, setApplied] = useState<Set<string>>(new Set());

  const players = state.playerOrder.map((id) => state.players[id]!);

  const pending: PendingRating[] = useMemo(
    () =>
      settleSession(
        players.map((p) => ({
          playerId: p.id,
          rating: p.rating,
          ratingLocked: p.ratingLocked,
          pendingDelta: p.accumulatedDelta,
          pendingGames: p.ratedGames,
          priorRatedGames: p.ratedGames,
        })),
      ).pending,
    [players],
  );

  const leaderboard = useMemo(() => {
    const wins = new Map<string, number>();
    for (const match of state.completed) {
      if (match.winner === null) continue;
      const winners = match.winner === 'a' ? match.teamA : match.teamB;
      for (const id of winners) wins.set(id, (wins.get(id) ?? 0) + 1);
    }
    return players
      .filter((p) => p.gamesPlayed > 0)
      .map((p) => ({ player: p, wins: wins.get(p.id) ?? 0 }))
      .sort((a, b) => b.wins - a.wins || b.player.gamesPlayed - a.player.gamesPlayed);
  }, [players, state.completed]);

  const totalMinutes = state.completed.reduce(
    (sum, m) => sum + ((m.endedAt ?? m.startedAt) - m.startedAt) / 60000,
    0,
  );

  const exportCsv = () => {
    const header = 'name,rating,games,court_minutes,wins,proposed_rating\n';
    const byId = new Map(pending.map((p) => [p.playerId, p]));
    const winsById = new Map(leaderboard.map((row) => [row.player.id, row.wins]));
    const rows = players
      .map((p) =>
        [
          `"${p.name.replace(/"/g, '""')}"`,
          p.rating,
          p.gamesPlayed,
          Math.round(p.courtSeconds / 60),
          winsById.get(p.id) ?? 0,
          byId.get(p.id)?.after ?? p.rating,
        ].join(','),
      )
      .join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.name.replace(/[^\w-]+/g, '-')}-summary.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <header>
        <h1 className="text-2xl font-bold">{state.name}</h1>
        <p className="text-sm text-ink-faint">
          {state.completed.length} games · {Math.round(totalMinutes)} court-minutes ·{' '}
          {players.length} players
        </p>
      </header>

      <section className="card p-3">
        <h2 className="mb-2 font-bold">Rating review</h2>
        {pending.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No rating changes proposed. One session is about nine games — not enough to tell a
            mis-rating from a good night — so the evidence is banked and carried into your next
            session instead.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {pending.map((change) => {
              const player = state.players[change.playerId];
              const done = applied.has(change.playerId);
              return (
                <li
                  key={change.playerId}
                  className="flex items-center gap-3 rounded-xl border border-surface-line px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate font-semibold">{player?.name}</span>
                  <span className="tabular-nums text-sm text-ink-soft">
                    {formatRating(change.before)} → <strong>{formatRating(change.after)}</strong>{' '}
                    <span className={change.delta > 0 ? 'text-go' : 'text-stop'}>
                      ({formatSigned(change.delta)})
                    </span>
                  </span>
                  <button
                    type="button"
                    className={done ? 'btn-quiet px-3 text-sm' : 'btn-go px-3 text-sm'}
                    onClick={() =>
                      setApplied((current) => {
                        const next = new Set(current);
                        if (next.has(change.playerId)) next.delete(change.playerId);
                        else next.add(change.playerId);
                        return next;
                      })
                    }
                  >
                    {done ? 'Undo' : 'Apply'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card p-3">
        <h2 className="mb-2 font-bold">Leaderboard</h2>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-ink-faint">No games were played this session.</p>
        ) : null}
        <ul className="space-y-1">
          {leaderboard.map((row, index) => (
            <li key={row.player.id} className="flex items-center gap-3 px-1 py-1.5">
              <span className="w-6 text-center font-bold tabular-nums text-ink-faint">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{row.player.name}</span>
              <span className="text-sm tabular-nums text-ink-faint">
                {row.wins}W / {row.player.gamesPlayed}G ·{' '}
                {formatDuration(row.player.courtSeconds)}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn-quiet" onClick={exportCsv}>
          Export CSV
        </button>
        <a href="/" className="btn-primary">
          Done
        </a>
      </div>
    </div>
  );
}

'use client';

import { useState } from 'react';
import type { PlayerId } from '@openplay/engine';
import type { PresetName } from '@openplay/engine';
import type { Action, SessionState } from '@/lib/session';
import { formatRating } from '@/lib/format';

const PRESET_BLURB: Record<PresetName, string> = {
  competitive: 'Tight skill bands. Best when people care about the scoreline.',
  balanced: 'The default. Weighs close games against fair waits.',
  social: 'Loose bands, heavy mixing. Best for a mixer or a new group.',
};

export function RosterPanel({
  state,
  dispatch,
}: {
  state: SessionState;
  dispatch: (action: Action) => void;
}) {
  const [expanded, setExpanded] = useState<PlayerId | null>(null);

  const roster = state.playerOrder
    .map((id) => state.players[id]!)
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));

  return (
    <div className="space-y-4">
      <section className="card p-3">
        <h2 className="mb-2 font-bold">Session settings</h2>

        <label className="mb-3 block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-faint">
            Courts
          </span>
          <input
            type="number"
            min={1}
            max={12}
            className="field tabular-nums"
            value={state.courts.length}
            onChange={(e) => dispatch({ type: 'courts/set', count: Number(e.target.value) })}
          />
        </label>

        <div className="mb-3">
          <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-ink-faint">
            Matching style
          </span>
          <div className="grid grid-cols-3 gap-1.5">
            {(['competitive', 'balanced', 'social'] as const).map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => dispatch({ type: 'session/preset', preset })}
                className={`min-h-[44px] rounded-xl border px-2 text-sm font-bold capitalize ${
                  state.presetName === preset
                    ? 'border-accent bg-accent text-white'
                    : 'border-surface-line bg-surface text-ink-soft'
                }`}
              >
                {preset}
              </button>
            ))}
          </div>
          <p className="mt-1.5 text-xs text-ink-faint">{PRESET_BLURB[state.presetName]}</p>
        </div>

        <label className="block">
          <span className="mb-1 flex items-baseline justify-between text-xs font-bold uppercase tracking-wide text-ink-faint">
            <span>Skill spread cap</span>
            <span className="tabular-nums">{state.config.spreadCap.toFixed(2)}</span>
          </span>
          <input
            type="range"
            min={0.25}
            max={1.5}
            step={0.05}
            className="w-full accent-accent"
            value={state.config.spreadCap}
            onChange={(e) => dispatch({ type: 'session/spreadCap', cap: Number(e.target.value) })}
          />
          <span className="mt-1 block text-xs text-ink-faint">
            The widest rating gap allowed on one court before a match is flagged as a stretch.
          </span>
        </label>
      </section>

      <section className="card p-3">
        <h2 className="mb-2 font-bold">Roster ({roster.length})</h2>
        <ul className="space-y-1.5">
          {roster.map((player) => {
            const open = expanded === player.id;
            return (
              <li key={player.id} className="rounded-xl border border-surface-line">
                <div className="flex items-center gap-2 px-3 py-2">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    onClick={() => setExpanded(open ? null : player.id)}
                  >
                    <span className="truncate font-semibold">{player.name}</span>
                    {player.selfReported ? (
                      <span
                        className="ml-2 chip bg-warn-soft text-warn"
                        title="This rating came from the player, not from you"
                      >
                        self-rated
                      </span>
                    ) : null}
                    {player.status === 'left' ? (
                      <span className="ml-2 chip bg-surface-sunk text-ink-faint">left</span>
                    ) : null}
                  </button>
                  <span className="shrink-0 text-sm tabular-nums text-ink-faint">
                    {player.gamesPlayed}g
                  </span>
                  <input
                    type="number"
                    step={0.25}
                    min={2}
                    max={5.5}
                    aria-label={`${player.name} rating`}
                    className="w-20 shrink-0 rounded-lg border border-surface-line px-2 py-1 text-center tabular-nums"
                    value={player.rating}
                    onChange={(e) =>
                      dispatch({ type: 'player/edit', id: player.id, rating: Number(e.target.value) })
                    }
                  />
                </div>

                {open ? (
                  <div className="space-y-2 border-t border-surface-line px-3 py-2">
                    {player.selfReported ? (
                      <div className="rounded-xl bg-warn-soft px-2 py-2 text-xs text-warn">
                        <p className="font-semibold">
                          {player.name} chose this level themselves.
                        </p>
                        <p className="mt-0.5">
                          Change the number above if it looks wrong, or confirm it once
                          you&rsquo;ve seen them play.
                        </p>
                        <button
                          type="button"
                          className="btn-quiet mt-1.5 w-full text-xs"
                          onClick={() =>
                            dispatch({ type: 'player/confirmRating', id: player.id })
                          }
                        >
                          Looks right
                        </button>
                      </div>
                    ) : null}
                    {player.duprId ? (
                      <p className="text-xs text-ink-faint">
                        DUPR ID <strong className="font-mono">{player.duprId}</strong> — recorded
                        for identity only, not used as a rating.
                      </p>
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="h-5 w-5 accent-accent"
                        checked={player.ratingLocked}
                        onChange={(e) =>
                          dispatch({
                            type: 'player/edit',
                            id: player.id,
                            ratingLocked: e.target.checked,
                          })
                        }
                      />
                      <span>Lock rating (never auto-adjust)</span>
                    </label>

                    {player.status === 'left' ? (
                      <button
                        type="button"
                        className="btn-quiet w-full text-sm"
                        onClick={() =>
                          dispatch({ type: 'player/rejoin', id: player.id, now: Date.now() })
                        }
                      >
                        Back in the queue
                      </button>
                    ) : null}

                    <div>
                      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-ink-faint">
                        Keep apart from
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {roster
                          .filter((other) => other.id !== player.id)
                          .map((other) => {
                            const on = player.avoid.includes(other.id);
                            return (
                              <button
                                key={other.id}
                                type="button"
                                onClick={() =>
                                  dispatch({
                                    type: 'player/avoid',
                                    id: player.id,
                                    otherId: other.id,
                                    on: !on,
                                  })
                                }
                                className={`rounded-lg border px-2 py-1 text-xs font-semibold ${
                                  on
                                    ? 'border-stop bg-stop-soft text-stop'
                                    : 'border-surface-line text-ink-faint'
                                }`}
                              >
                                {other.name}
                              </button>
                            );
                          })}
                      </div>
                      <p className="mt-1 text-xs text-ink-faint">
                        Never shown to players. Used only to keep them off the same court.
                      </p>
                    </div>

                    <p className="text-xs text-ink-faint">
                      Rating {formatRating(player.rating)} · {player.ratedGames} rated games this
                      session
                    </p>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

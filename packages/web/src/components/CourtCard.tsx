'use client';

import { useState } from 'react';
import type { PlayerId, ProposedMatch } from '@openplay/engine';
import type { ActiveMatch, SessionPlayer } from '@/lib/session';
import { formatDuration } from '@/lib/format';
import { TeamRow } from './TeamRow';
import { StretchBadge } from './primitives';

/** A court with a game on it: elapsed time, who is playing, and how to end it. */
export function ActiveCourtCard({
  label,
  match,
  players,
  now,
  onEnd,
  onCancel,
}: {
  label: string;
  match: ActiveMatch;
  players: Record<PlayerId, SessionPlayer>;
  now: number;
  onEnd: (winner: 'a' | 'b' | null, scoreA: number | null, scoreB: number | null) => void;
  onCancel: () => void;
}) {
  const [scoring, setScoring] = useState(false);
  const [scoreA, setScoreA] = useState('');
  const [scoreB, setScoreB] = useState('');

  const elapsed = (now - match.startedAt) / 1000;
  const parse = (value: string) => {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  };

  const submit = (winner: 'a' | 'b') => {
    const a = parse(scoreA);
    const b = parse(scoreB);
    const bothPresent = a !== null && b !== null;
    onEnd(winner, bothPresent ? a : null, bothPresent ? b : null);
    setScoring(false);
    setScoreA('');
    setScoreB('');
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between bg-go px-4 py-2 text-white">
        <span className="font-bold">{label}</span>
        <span className="flex items-center gap-2">
          {match.isStretch ? <StretchBadge /> : null}
          <span className="tabular-nums font-semibold">{formatDuration(elapsed)}</span>
        </span>
      </div>

      <div className="space-y-2 p-3">
        <TeamRow ids={match.teamA} players={players} label="Team A" />
        <TeamRow ids={match.teamB} players={players} label="Team B" />

        {scoring ? (
          <div className="space-y-2 rounded-xl border border-surface-line p-3">
            <p className="text-sm font-semibold text-ink-soft">
              Score (optional — it sharpens ratings, but tap a winner either way)
            </p>
            <div className="flex items-center gap-2">
              <input
                className="field text-center tabular-nums"
                inputMode="numeric"
                placeholder="A"
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
                aria-label="Team A score"
              />
              <span className="text-ink-faint">–</span>
              <input
                className="field text-center tabular-nums"
                inputMode="numeric"
                placeholder="B"
                value={scoreB}
                onChange={(e) => setScoreB(e.target.value)}
                aria-label="Team B score"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" className="btn-go" onClick={() => submit('a')}>
                A won
              </button>
              <button type="button" className="btn-go" onClick={() => submit('b')}>
                B won
              </button>
            </div>
            <button
              type="button"
              className="btn-quiet w-full"
              onClick={() => {
                onEnd(null, null, null);
                setScoring(false);
              }}
            >
              End with no result
            </button>
            <button type="button" className="btn-quiet w-full" onClick={() => setScoring(false)}>
              Back
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="btn-primary" onClick={() => setScoring(true)}>
              End game
            </button>
            <button type="button" className="btn-quiet" onClick={onCancel}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** An open court with the engine's suggestion for who should play next. */
export function ProposalCard({
  label,
  proposal,
  players,
  onAccept,
  onReshuffle,
  onSwapOut,
  onReset,
  hasOverrides,
}: {
  label: string;
  proposal: ProposedMatch | null;
  players: Record<PlayerId, SessionPlayer>;
  onAccept: () => void;
  onReshuffle: () => void;
  onSwapOut: (id: PlayerId) => void;
  onReset: () => void;
  hasOverrides: boolean;
}) {
  if (!proposal) {
    return (
      <div className="card overflow-hidden opacity-70">
        <div className="flex items-center justify-between bg-surface-sunk px-4 py-2">
          <span className="font-bold">{label}</span>
          <span className="text-sm text-ink-faint">open</span>
        </div>
        <p className="p-4 text-sm text-ink-faint">
          Not enough players available to fill this court.
        </p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between bg-accent px-4 py-2 text-white">
        <span className="font-bold">{label}</span>
        <span className="flex items-center gap-2">
          {proposal.isStretch ? <StretchBadge /> : null}
          <span className="text-sm font-semibold">up next</span>
        </span>
      </div>

      <div className="space-y-2 p-3">
        <TeamRow ids={proposal.teamA} players={players} label="Team A" onTapPlayer={onSwapOut} />
        <TeamRow ids={proposal.teamB} players={players} label="Team B" onTapPlayer={onSwapOut} />

        {/* The whole point: the organizer can read this out to anyone who asks
            why they were not picked. */}
        <p className="rounded-xl bg-surface-sunk px-3 py-2 text-sm leading-relaxed text-ink-soft">
          {proposal.explanation}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className="btn-go" onClick={onAccept}>
            Start
          </button>
          <button type="button" className="btn-quiet" onClick={onReshuffle}>
            Reshuffle
          </button>
        </div>
        {hasOverrides ? (
          <button type="button" className="btn-quiet w-full text-sm" onClick={onReset}>
            Reset to the engine&rsquo;s pick
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function ClosedCourtCard({ label, onOpen }: { label: string; onOpen: () => void }) {
  return (
    <div className="card overflow-hidden opacity-60">
      <div className="flex items-center justify-between bg-surface-sunk px-4 py-2">
        <span className="font-bold">{label}</span>
        <button type="button" className="text-sm font-semibold text-accent" onClick={onOpen}>
          Reopen
        </button>
      </div>
      <p className="p-4 text-sm text-ink-faint">Closed — not being filled.</p>
    </div>
  );
}

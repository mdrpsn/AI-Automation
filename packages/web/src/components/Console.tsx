'use client';

import { useEffect, useMemo, useState } from 'react';
import type { PlayerId } from '@openplay/engine';
import type { SessionState } from '@/lib/session';
import { useProposals, useSessionController } from '@/lib/useSession';
import { usePublish } from '@/lib/usePublish';
import { ActiveCourtCard, ClosedCourtCard, ProposalCard } from './CourtCard';
import { QueueList, useQueueRows } from './Queue';
import { CheckIn } from './CheckIn';
import { RosterPanel } from './RosterPanel';
import { ShareSheet } from './ShareSheet';
import { SummaryPanel } from './SummaryPanel';
import { Empty } from './primitives';

type Tab = 'courts' | 'queue' | 'roster' | 'share';

/** Keeps the organizer's phone awake — it locking mid-rotation is infuriating. */
function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        if (!('wakeLock' in navigator)) return;
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) void sentinel.release();
      } catch {
        // Denied or unsupported: not worth interrupting anyone over.
      }
    };

    void request();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [active]);
}

export function Console({ initial }: { initial: SessionState }) {
  const { state, now, dispatch, undo, canUndo, lastActionLabel, saving } =
    useSessionController(initial);
  const proposals = useProposals(state);
  const rows = useQueueRows(state, now);
  const [tab, setTab] = useState<Tab>('courts');
  const [swapping, setSwapping] = useState<{ courtId: string; outId: PlayerId } | null>(null);

  // Players see who the engine has queued up next, not just who is on court —
  // "you're next" is the single most-asked question at an open play.
  const upNextIds = useMemo(
    () => (proposals.result?.matches ?? []).flatMap((m) => [...m.teamA, ...m.teamB]),
    [proposals.result],
  );
  const publishStatus = usePublish(state, upNextIds);

  useWakeLock(state.status === 'live');

  const waitingCount = rows.filter((r) => r.status === 'waiting').length;
  const playingCount = Object.values(state.active).length * 4;
  const starving = rows.filter((r) => r.starving);

  if (state.status === 'ended') {
    return <SummaryPanel state={state} />;
  }

  const acceptProposal = (courtId: string) => {
    const match = proposals.result?.matches.find((m) => m.courtId === courtId);
    if (!match) return;
    dispatch({
      type: 'match/start',
      courtId,
      teamA: [...match.teamA] as [PlayerId, PlayerId],
      teamB: [...match.teamB] as [PlayerId, PlayerId],
      explanation: match.explanation,
      isStretch: match.isStretch,
      now: Date.now(),
    });
    proposals.clearOverrides(courtId);
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col">
      <header className="sticky top-0 z-10 border-b border-surface-line bg-surface/95 backdrop-blur">
        <div className="flex items-center justify-between gap-2 px-4 py-2.5">
          <div className="min-w-0">
            <h1 className="truncate text-lg font-bold leading-tight">{state.name}</h1>
            <p className="text-xs text-ink-faint">
              {waitingCount} waiting · {playingCount} on court · {state.completed.length} games
              {saving ? ' · saving…' : ''}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              className="btn-quiet px-3 text-sm"
              onClick={undo}
              disabled={!canUndo}
              title={lastActionLabel ? `Undo ${lastActionLabel}` : 'Nothing to undo'}
            >
              Undo
            </button>
            {state.status === 'setup' ? (
              <button
                type="button"
                className="btn-go px-3 text-sm"
                onClick={() => dispatch({ type: 'session/start', now: Date.now() })}
                disabled={state.playerOrder.length < 4}
              >
                Start
              </button>
            ) : (
              <button
                type="button"
                className="btn-quiet px-3 text-sm"
                onClick={() => {
                  const running = Object.keys(state.active).length;
                  const warning =
                    running > 0
                      ? `${running} game${running > 1 ? 's are' : ' is'} still on court. ` +
                        'They will be recorded with no winner. '
                      : '';
                  if (confirm(`${warning}End the session? Ratings are reviewed on the next screen.`)) {
                    dispatch({ type: 'session/end', now: Date.now() });
                  }
                }}
              >
                End
              </button>
            )}
          </div>
        </div>

        <nav className="flex border-t border-surface-line">
          {(['courts', 'queue', 'roster', 'share'] as const).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={`flex-1 py-2.5 text-sm font-bold capitalize transition ${
                tab === key
                  ? 'border-b-2 border-accent text-accent'
                  : 'border-b-2 border-transparent text-ink-faint'
              }`}
            >
              {key}
              {key === 'queue' && waitingCount > 0 ? ` (${waitingCount})` : ''}
              {key === 'share' && publishStatus === 'live' ? (
                <span className="ml-1 inline-block h-2 w-2 rounded-full bg-go align-middle" />
              ) : null}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 space-y-3 p-3">
        {starving.length > 0 && tab === 'courts' ? (
          <div className="rounded-xl border border-stop/30 bg-stop-soft px-3 py-2 text-sm text-stop">
            <strong>Waiting too long:</strong>{' '}
            {starving.map((r) => r.name).join(', ')}. The engine will force them into the next
            match it can.
          </div>
        ) : null}

        {tab === 'courts' ? (
          state.status === 'setup' ? (
            <Empty
              title="Session not started"
              hint={
                state.playerOrder.length < 4
                  ? 'Check in at least four players, then press Start.'
                  : 'Press Start to begin filling courts.'
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {state.courts.map((court) => {
                const active = state.active[court.id];
                if (active) {
                  return (
                    <ActiveCourtCard
                      key={court.id}
                      label={court.label}
                      match={active}
                      players={state.players}
                      now={now}
                      onEnd={(winner, scoreA, scoreB) =>
                        dispatch({
                          type: 'match/end',
                          courtId: court.id,
                          winner,
                          scoreA,
                          scoreB,
                          now: Date.now(),
                        })
                      }
                      onCancel={() => dispatch({ type: 'match/cancel', courtId: court.id })}
                    />
                  );
                }

                if (court.status === 'closed') {
                  return (
                    <ClosedCourtCard
                      key={court.id}
                      label={court.label}
                      onOpen={() => dispatch({ type: 'courts/toggle', courtId: court.id })}
                    />
                  );
                }

                const proposal =
                  proposals.result?.matches.find((m) => m.courtId === court.id) ?? null;
                const overrides = proposals.overridesFor(court.id);

                return (
                  <ProposalCard
                    key={court.id}
                    label={court.label}
                    proposal={proposal}
                    players={state.players}
                    onAccept={() => acceptProposal(court.id)}
                    onReshuffle={() => proposals.reshuffle(court.id)}
                    onSwapOut={(id) => {
                      setSwapping({ courtId: court.id, outId: id });
                      setTab('queue');
                    }}
                    onReset={() => proposals.clearOverrides(court.id)}
                    hasOverrides={overrides.excluded.length > 0 || overrides.locked.length > 0}
                  />
                );
              })}
            </div>
          )
        ) : null}

        {tab === 'queue' ? (
          <>
            {swapping ? (
              <div className="flex items-center justify-between rounded-xl border border-accent bg-accent-soft px-3 py-2 text-sm">
                <span className="font-semibold text-accent">
                  Pick a replacement for {state.players[swapping.outId]?.name}
                </span>
                <button
                  type="button"
                  className="font-bold text-accent underline"
                  onClick={() => setSwapping(null)}
                >
                  Cancel
                </button>
              </div>
            ) : null}
            <QueueList
              rows={rows}
              onPause={(id) => dispatch({ type: 'player/pause', id, now: Date.now() })}
              onResume={(id) => dispatch({ type: 'player/resume', id, now: Date.now() })}
              onLeave={(id) => dispatch({ type: 'player/leave', id, now: Date.now() })}
              selectingFor={swapping}
              onSelect={(id) => {
                if (!swapping) return;
                proposals.swapIn(swapping.courtId, swapping.outId, id);
                setSwapping(null);
                setTab('courts');
              }}
            />
          </>
        ) : null}

        {tab === 'roster' ? (
          <div className="space-y-4">
            <section className="card p-3">
              <h2 className="mb-2 font-bold">Check in a player</h2>
              <CheckIn
                onAdd={(name, rating) =>
                  dispatch({ type: 'player/add', name, rating, isGuest: false, now: Date.now() })
                }
              />
            </section>
            <RosterPanel state={state} dispatch={dispatch} />
          </div>
        ) : null}

        {tab === 'share' ? (
          <ShareSheet state={state} dispatch={dispatch} status={publishStatus} />
        ) : null}
      </main>
    </div>
  );
}

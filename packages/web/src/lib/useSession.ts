'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fillCourts, type EngineResult, type PlayerId } from '@openplay/engine';
import { reduce, toSnapshot, type Action, type SessionState } from './session.js';
import { getStore } from './storage.js';

const UNDO_DEPTH = 25;
/** Display timers tick every second. */
const CLOCK_MS = 1000;
/** Proposals only need to track slow-moving wait times. */
const SOLVE_MS = 15_000;

export interface SessionController {
  state: SessionState;
  now: number;
  dispatch(action: Action): void;
  undo(): void;
  canUndo: boolean;
  /** Label of the action undo would reverse, for the button. */
  lastActionLabel: string | null;
  saving: boolean;
}

const ACTION_LABELS: Record<string, string> = {
  'match/start': 'start match',
  'match/end': 'end match',
  'match/cancel': 'cancel match',
  'player/add': 'add player',
  'player/pause': 'pause player',
  'player/resume': 'resume player',
  'player/leave': 'mark left',
  'player/rejoin': 'rejoin',
  'player/edit': 'edit player',
  'player/avoid': 'avoid setting',
  'courts/set': 'court count',
  'courts/toggle': 'court open/closed',
  'session/preset': 'preset',
  'session/spreadCap': 'spread cap',
  'session/start': 'start session',
  'session/end': 'end session',
  'session/rename': 'rename',
};

export function useSessionController(initial: SessionState): SessionController {
  const [state, setState] = useState(initial);
  const [now, setNow] = useState(() => Date.now());
  const [saving, setSaving] = useState(false);
  const history = useRef<{ state: SessionState; label: string }[]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => clearInterval(timer);
  }, []);

  // Write through to storage. Failures are surfaced rather than swallowed:
  // an organizer needs to know if the session is not being saved.
  const persist = useCallback((next: SessionState) => {
    setSaving(true);
    void getStore()
      .save(next)
      .catch((error: unknown) => {
        console.error('Failed to save session', error);
      })
      .finally(() => setSaving(false));
  }, []);

  const dispatch = useCallback(
    (action: Action) => {
      setState((current) => {
        const next = reduce(current, action);
        if (next === current) return current;

        history.current = [
          ...history.current.slice(-(UNDO_DEPTH - 1)),
          { state: current, label: ACTION_LABELS[action.type] ?? action.type },
        ];
        setHistoryDepth(history.current.length);
        persist(next);
        return next;
      });
    },
    [persist],
  );

  const undo = useCallback(() => {
    const previous = history.current.pop();
    setHistoryDepth(history.current.length);
    if (!previous) return;
    setState(previous.state);
    persist(previous.state);
  }, [persist]);

  const last = history.current[history.current.length - 1];

  return {
    state,
    now,
    dispatch,
    undo,
    canUndo: historyDepth > 0,
    lastActionLabel: last?.label ?? null,
    saving,
  };
}

export interface CourtProposals {
  result: EngineResult | null;
  /** Extra exclusions per court, accumulated by pressing Reshuffle. */
  reshuffle(courtId: string): void;
  resetReshuffle(courtId: string): void;
  /** Swap one player out of a court's proposal and let the engine refill. */
  swapOut(courtId: string, playerId: PlayerId): void;
  /** Force a specific player into a court's proposal. */
  swapIn(courtId: string, outId: PlayerId, inId: PlayerId): void;
  overridesFor(courtId: string): { excluded: PlayerId[]; locked: PlayerId[] };
  clearOverrides(courtId: string): void;
}

interface CourtOverrides {
  excluded: PlayerId[];
  locked: PlayerId[];
}

/**
 * Live proposals for every open court.
 *
 * Recomputed on state change and on a slow timer — wait times move slowly, and
 * a solve is only a few milliseconds, but re-solving every second would make
 * the "up next" list flicker while the organizer is reading it.
 */
export function useProposals(state: SessionState): CourtProposals {
  const [overrides, setOverrides] = useState<Record<string, CourtOverrides>>({});
  const [solveAt, setSolveAt] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setSolveAt(Date.now()), SOLVE_MS);
    return () => clearInterval(timer);
  }, []);

  // A state change should refresh proposals immediately, not on the next tick.
  useEffect(() => {
    setSolveAt(Date.now());
  }, [state]);

  const result = useMemo(() => {
    if (state.status !== 'live') return null;

    const excluded = Object.values(overrides).flatMap((o) => o.excluded);
    const lockedSlots: Record<string, PlayerId[]> = {};
    for (const [courtId, o] of Object.entries(overrides)) {
      if (o.locked.length > 0) lockedSlots[courtId] = o.locked;
    }

    const snapshot = toSnapshot(state, solveAt);
    return fillCourts({
      ...snapshot,
      overrides: {
        ...(excluded.length > 0 ? { excluded } : {}),
        ...(Object.keys(lockedSlots).length > 0 ? { lockedSlots } : {}),
      },
    });
  }, [state, overrides, solveAt]);

  const patch = useCallback((courtId: string, change: Partial<CourtOverrides>) => {
    setOverrides((current) => {
      const existing = current[courtId] ?? { excluded: [], locked: [] };
      return { ...current, [courtId]: { ...existing, ...change } };
    });
  }, []);

  const reshuffle = useCallback(
    (courtId: string) => {
      const match = result?.matches.find((m) => m.courtId === courtId);
      if (!match) return;
      const existing = overrides[courtId] ?? { excluded: [], locked: [] };
      // Drop one member each press so the next solve genuinely differs. Beyond
      // a few, the alternatives get worse than the original, so stop.
      if (existing.excluded.length >= 3) {
        patch(courtId, { excluded: [], locked: [] });
        return;
      }
      const members = [...match.teamA, ...match.teamB];
      const drop = members[existing.excluded.length % members.length]!;
      patch(courtId, { excluded: [...existing.excluded, drop], locked: [] });
    },
    [result, overrides, patch],
  );

  const swapOut = useCallback(
    (courtId: string, playerId: PlayerId) => {
      const match = result?.matches.find((m) => m.courtId === courtId);
      if (!match) return;
      const keep = [...match.teamA, ...match.teamB].filter((id) => id !== playerId);
      const existing = overrides[courtId] ?? { excluded: [], locked: [] };
      patch(courtId, { excluded: [...existing.excluded, playerId], locked: keep });
    },
    [result, overrides, patch],
  );

  const swapIn = useCallback(
    (courtId: string, outId: PlayerId, inId: PlayerId) => {
      const match = result?.matches.find((m) => m.courtId === courtId);
      if (!match) return;
      const keep = [...match.teamA, ...match.teamB].filter((id) => id !== outId);
      const existing = overrides[courtId] ?? { excluded: [], locked: [] };
      patch(courtId, {
        excluded: [...existing.excluded.filter((id) => id !== inId), outId],
        locked: [...keep, inId],
      });
    },
    [result, overrides, patch],
  );

  const clearOverrides = useCallback((courtId: string) => {
    setOverrides((current) => {
      const next = { ...current };
      delete next[courtId];
      return next;
    });
  }, []);

  const overridesFor = useCallback(
    (courtId: string) => overrides[courtId] ?? { excluded: [], locked: [] },
    [overrides],
  );

  return {
    result,
    reshuffle,
    resetReshuffle: clearOverrides,
    swapOut,
    swapIn,
    overridesFor,
    clearOverrides,
  };
}

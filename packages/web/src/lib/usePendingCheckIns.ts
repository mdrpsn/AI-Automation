'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingCheckIn } from './checkin.js';
import type { SessionState } from './session.js';

const POLL_MS = 6000;

export interface PendingCheckIns {
  pending: PendingCheckIn[];
  /** Drop these from the relay once the organizer has dealt with them. */
  resolve(ids: readonly string[]): Promise<void>;
  reachable: boolean;
}

/**
 * Pulls self check-ins waiting on the relay.
 *
 * Players never write to the session directly — the organizer's device stays
 * authoritative — so this is an inbox that gets drained on approval. If the
 * network is down the console carries on exactly as before and check-ins simply
 * arrive late.
 */
export function usePendingCheckIns(state: SessionState): PendingCheckIns {
  const [pending, setPending] = useState<PendingCheckIn[]>([]);
  const [reachable, setReachable] = useState(true);

  const { shareToken, publishToken, published, checkInOpen } = state;
  const active = published && checkInOpen;
  // Avoid re-arming the poll loop on every unrelated session change.
  const tokens = useRef({ shareToken, publishToken });
  tokens.current = { shareToken, publishToken };

  useEffect(() => {
    if (!active) {
      setPending([]);
      return;
    }

    let cancelled = false;

    const pull = async () => {
      try {
        const response = await fetch(
          `/api/live/${encodeURIComponent(tokens.current.shareToken)}/checkin`,
          { headers: { 'x-publish-token': tokens.current.publishToken }, cache: 'no-store' },
        );
        if (cancelled) return;
        if (!response.ok) {
          setReachable(false);
          return;
        }
        const body = (await response.json()) as { pending?: PendingCheckIn[] };
        setReachable(true);
        setPending(body.pending ?? []);
      } catch {
        if (!cancelled) setReachable(false);
      }
    };

    void pull();
    const timer = setInterval(() => void pull(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [active]);

  const resolve = useCallback(async (ids: readonly string[]) => {
    // Drop them locally first so the tray never re-shows someone the organizer
    // has already dealt with, even if the network call is slow.
    setPending((current) => current.filter((entry) => !ids.includes(entry.id)));
    try {
      await fetch(`/api/live/${encodeURIComponent(tokens.current.shareToken)}/checkin`, {
        method: 'DELETE',
        headers: {
          'content-type': 'application/json',
          'x-publish-token': tokens.current.publishToken,
        },
        body: JSON.stringify({ ids }),
      });
    } catch {
      // It reappears on the next poll if this failed, which is the safe way round.
    }
  }, []);

  return { pending, resolve, reachable };
}

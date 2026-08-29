'use client';

import { useEffect, useRef, useState } from 'react';
import type { PlayerId } from '@openplay/engine';
import { buildPublicSnapshot } from './publicSnapshot.js';
import type { SessionState } from './session.js';

/** Coalesce bursts of edits into one request. */
const DEBOUNCE_MS = 400;
/** Republish periodically so wait times and ETAs on player phones stay honest. */
const HEARTBEAT_MS = 20_000;

export type PublishStatus = 'off' | 'publishing' | 'live' | 'error';

/**
 * Pushes the public projection to the relay whenever the session changes.
 *
 * Deliberately fire-and-forget: the organizer's device stays authoritative and
 * the console must never block, stall, or fail because the network is down. A
 * failed publish just means players see slightly stale data until the next one
 * lands, which is the right trade at a venue with bad wifi.
 */
export function usePublish(
  state: SessionState,
  upNextIds: readonly PlayerId[],
): PublishStatus {
  const [status, setStatus] = useState<PublishStatus>(state.published ? 'publishing' : 'off');
  const inFlight = useRef(false);
  const pending = useRef(false);

  // Keep the latest values without making them re-trigger the effect.
  const latest = useRef({ state, upNextIds });
  latest.current = { state, upNextIds };

  useEffect(() => {
    if (!state.published) {
      setStatus('off');
      return;
    }

    let cancelled = false;

    const send = async () => {
      if (cancelled) return;
      if (inFlight.current) {
        pending.current = true;
        return;
      }
      inFlight.current = true;

      const current = latest.current;
      try {
        const response = await fetch(`/api/live/${encodeURIComponent(current.state.shareToken)}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            publishToken: current.state.publishToken,
            snapshot: buildPublicSnapshot(current.state, Date.now(), current.upNextIds),
          }),
        });
        if (!cancelled) setStatus(response.ok ? 'live' : 'error');
      } catch {
        if (!cancelled) setStatus('error');
      } finally {
        inFlight.current = false;
        if (pending.current && !cancelled) {
          pending.current = false;
          void send();
        }
      }
    };

    const debounce = setTimeout(() => void send(), DEBOUNCE_MS);
    const heartbeat = setInterval(() => void send(), HEARTBEAT_MS);

    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(heartbeat);
    };
  }, [state, upNextIds, state.published]);

  return status;
}

/** Take a session off the relay. */
export async function unpublish(state: SessionState): Promise<void> {
  try {
    await fetch(`/api/live/${encodeURIComponent(state.shareToken)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ publishToken: state.publishToken, unpublish: true }),
    });
  } catch {
    // The entry ages out on its own; nothing worth interrupting the organizer for.
  }
}

'use client';

import { useEffect, useState } from 'react';
import type { SessionState } from '@/lib/session';
import { getStore } from '@/lib/storage';
import { Console } from './Console';

/**
 * Rehydrates from local storage before rendering the console. Session state is
 * derived from stored timestamps, so a reload mid-session picks up exactly
 * where it left off — including wait times.
 */
export function SessionLoader({ id }: { id: string }) {
  const [state, setState] = useState<SessionState | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    void getStore()
      .load(id)
      .then((loaded) => (loaded ? setState(loaded) : setMissing(true)))
      .catch(() => setMissing(true));
  }, [id]);

  if (missing) {
    return (
      <div className="mx-auto max-w-xl space-y-3 p-6 text-center">
        <p className="font-semibold">Session not found on this device.</p>
        <p className="text-sm text-ink-faint">
          Sessions are stored locally, so they do not follow you to another phone or browser.
        </p>
        <a href="/" className="btn-primary">
          Back
        </a>
      </div>
    );
  }

  if (!state) return <p className="p-6 text-center text-ink-faint">Loading session…</p>;

  return <Console initial={state} />;
}

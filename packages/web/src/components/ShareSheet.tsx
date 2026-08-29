'use client';

import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import type { Action, SessionState } from '@/lib/session';
import { unpublish, type PublishStatus } from '@/lib/usePublish';

const STATUS_LABEL: Record<PublishStatus, string> = {
  off: 'Not sharing',
  publishing: 'Starting…',
  live: 'Players can see this',
  error: 'Cannot reach the server',
};

/**
 * The QR players scan, plus the controls for what they are allowed to see.
 *
 * The QR is rendered big enough to read from a couple of metres away, because
 * in practice this gets held up or taped to a fence.
 */
export function ShareSheet({
  state,
  dispatch,
  status,
}: {
  state: SessionState;
  dispatch: (action: Action) => void;
  status: PublishStatus;
}) {
  const [qr, setQr] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const link = `${window.location.origin}/live/${state.shareToken}`;
    setUrl(link);
    void QRCode.toString(link, {
      type: 'svg',
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1220', light: '#ffffff' },
    }).then(setQr);
  }, [state.shareToken]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section className="card space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-bold">Share with players</h2>
        <span
          className={`chip ${
            status === 'live'
              ? 'bg-go-soft text-go'
              : status === 'error'
                ? 'bg-stop-soft text-stop'
                : 'bg-surface-sunk text-ink-faint'
          }`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>

      {state.published ? (
        <>
          {qr ? (
            <div
              className="mx-auto w-full max-w-[260px] rounded-xl bg-white p-3"
              // The QR is generated locally from our own URL; no external input.
              dangerouslySetInnerHTML={{ __html: qr }}
            />
          ) : (
            <div className="mx-auto h-[260px] w-full max-w-[260px] animate-pulse rounded-xl bg-surface-sunk" />
          )}

          <div className="flex gap-2">
            <input readOnly className="field flex-1 text-xs" value={url} aria-label="Share link" />
            <button type="button" className="btn-quiet px-3 text-sm" onClick={() => void copy()}>
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-5 w-5 accent-accent"
              checked={state.publicShowRatings}
              onChange={(e) => dispatch({ type: 'session/showRatings', on: e.target.checked })}
            />
            <span>
              Show ratings to players
              <span className="block text-xs text-ink-faint">
                Off by default. Showing people their assigned rating tends to start arguments.
              </span>
            </span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              className="btn-quiet text-sm"
              onClick={() => {
                if (confirm('Replace the link? The old QR and any shared link stop working.')) {
                  void unpublish(state);
                  dispatch({ type: 'session/rotateShareToken' });
                }
              }}
            >
              New link
            </button>
            <button
              type="button"
              className="btn-danger text-sm"
              onClick={() => {
                void unpublish(state);
                dispatch({ type: 'session/publish', on: false });
              }}
            >
              Stop sharing
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-soft">
            Publish a read-only page players can watch on their phones — who is on court, the
            queue order, and roughly how long their wait is. They cannot change anything from it.
          </p>
          <button
            type="button"
            className="btn-primary w-full"
            onClick={() => dispatch({ type: 'session/publish', on: true })}
          >
            Start sharing
          </button>
        </>
      )}
    </section>
  );
}

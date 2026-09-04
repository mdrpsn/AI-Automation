'use client';

import { useEffect, useState } from 'react';
import { RATING_STEPS } from '@/lib/checkin';

type Phase = 'form' | 'sending' | 'done';

/**
 * The form a player fills in after scanning the QR.
 *
 * Two fields and a row of buttons. Someone is standing at the gate with a
 * paddle in one hand, so anything more than name plus one tap gets abandoned.
 */
export function JoinForm({
  token,
  sessionName,
  duprRequired,
}: {
  token: string;
  sessionName: string;
  duprRequired: boolean;
}) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState<number | null>(null);
  const [duprId, setDuprId] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  // On a slow venue connection the page paints well before it can respond to a
  // tap. Saying so beats a button that silently does nothing.
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);

  const submit = async () => {
    setError(null);
    if (name.trim().length === 0) return setError('Please enter your name.');
    if (rating === null) return setError('Please choose your skill level.');
    if (duprRequired && duprId.trim().length === 0) {
      return setError('This session needs your DUPR ID.');
    }

    setPhase('sending');
    try {
      const response = await fetch(`/api/live/${encodeURIComponent(token)}/checkin`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, rating, duprId: duprId.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as { message?: string };

      if (!response.ok) {
        setError(body.message ?? 'Could not check you in. Please see the organizer.');
        setPhase('form');
        return;
      }
      setPhase('done');
    } catch {
      setError('No connection. Please see the organizer.');
      setPhase('form');
    }
  };

  if (phase === 'done') {
    return (
      <main className="mx-auto w-full max-w-md space-y-4 p-6 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-go-soft text-3xl">
          ✓
        </div>
        <h1 className="text-xl font-bold">You&rsquo;re on the list, {name.trim()}</h1>
        <p className="text-sm text-ink-soft">
          The organizer will add you to the queue in a moment. Watch the live page to see when
          you&rsquo;re up.
        </p>
        <a href={`/live/${token}`} className="btn-primary w-full">
          See the queue
        </a>
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-4 pb-10">
      <header className="pt-4">
        <h1 className="text-2xl font-bold">Check in</h1>
        <p className="text-sm text-ink-faint">{sessionName}</p>
      </header>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-faint">
          Your name
        </span>
        <input
          className="field"
          placeholder="First name and last initial is plenty"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          enterKeyHint="done"
        />
      </label>

      <div>
        <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-ink-faint">
          Your skill level
        </span>
        <div className="grid grid-cols-5 gap-1.5">
          {RATING_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setRating(step)}
              className={`min-h-[52px] rounded-xl border text-base font-bold tabular-nums transition ${
                rating === step
                  ? 'border-accent bg-accent text-white'
                  : 'border-surface-line bg-surface text-ink-soft'
              }`}
            >
              {step.toFixed(2)}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-ink-faint">
          Your best honest guess. The organizer checks these before you go on, and a level that
          is too high just means a game nobody enjoys.
        </p>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-faint">
          DUPR ID {duprRequired ? '' : '(optional)'}
        </span>
        <input
          className="field uppercase"
          placeholder="e.g. AB12CD"
          value={duprId}
          onChange={(e) => setDuprId(e.target.value)}
          autoCapitalize="characters"
          autoComplete="off"
        />
        <span className="mt-1 block text-xs text-ink-faint">
          {duprRequired
            ? 'This session is tracked in DUPR, so the organizer needs your ID.'
            : 'Helps the organizer recognise you next time.'}
        </span>
      </label>

      {error ? (
        <p role="alert" className="rounded-xl bg-stop-soft px-3 py-2 text-sm font-semibold text-stop">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        className="btn-primary w-full"
        onClick={() => void submit()}
        disabled={!ready || phase === 'sending'}
        data-ready={ready ? 'true' : 'false'}
      >
        {!ready ? 'Loading…' : phase === 'sending' ? 'Checking in…' : 'Check in'}
      </button>
    </main>
  );
}

'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createSession } from '@/lib/session';
import { getStore, type SessionSummary } from '@/lib/storage';
import { formatClock } from '@/lib/format';

export function Home() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [name, setName] = useState('');
  const [courts, setCourts] = useState(4);

  useEffect(() => {
    void getStore()
      .list()
      .then(setSessions)
      .catch(() => setSessions([]));
  }, []);

  const start = async () => {
    const label = name.trim() || `Open play — ${new Date().toLocaleDateString()}`;
    const session = createSession(label, courts);
    await getStore().save(session);
    router.push(`/session/${session.id}`);
  };

  return (
    <div className="mx-auto w-full max-w-xl space-y-5 p-4">
      <header className="pt-6">
        <h1 className="text-3xl font-bold">Open Play</h1>
        <p className="mt-1 text-ink-soft">
          Skill-aware court matching. It picks the next four and tells you why.
        </p>
      </header>

      <section className="card space-y-3 p-4">
        <h2 className="font-bold">New session</h2>
        <input
          className="field"
          placeholder="Session name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-faint">
            Courts
          </span>
          <input
            type="number"
            min={1}
            max={12}
            className="field tabular-nums"
            value={courts}
            onChange={(e) => setCourts(Number(e.target.value))}
          />
        </label>
        <button type="button" className="btn-primary w-full" onClick={() => void start()}>
          Create session
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 font-bold">Recent sessions</h2>
        {sessions === null ? (
          <p className="px-1 text-sm text-ink-faint">Loading…</p>
        ) : sessions.length === 0 ? (
          <p className="px-1 text-sm text-ink-faint">
            Nothing yet. Sessions are stored on this device, so they keep working with no signal.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sessions.map((session) => (
              <li key={session.id}>
                <a
                  href={`/session/${session.id}`}
                  className="card flex items-center gap-3 px-3 py-2.5 hover:border-accent"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{session.name}</span>
                    <span className="block text-xs text-ink-faint">
                      {formatClock(session.createdAt)} · {session.playerCount} players ·{' '}
                      {session.matchCount} games
                    </span>
                  </span>
                  <span
                    className={`chip ${
                      session.status === 'live'
                        ? 'bg-go-soft text-go'
                        : session.status === 'ended'
                          ? 'bg-surface-sunk text-ink-faint'
                          : 'bg-accent-soft text-accent'
                    }`}
                  >
                    {session.status}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

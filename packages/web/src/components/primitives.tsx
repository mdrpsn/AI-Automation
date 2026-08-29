'use client';

import { formatRating } from '@/lib/format';

export function RatingBadge({ rating, dim }: { rating: number; dim?: boolean }) {
  return (
    <span
      className={`chip tabular-nums ${dim ? 'bg-surface-sunk text-ink-faint' : 'bg-accent-soft text-accent'}`}
    >
      {formatRating(rating)}
    </span>
  );
}

export function StretchBadge() {
  return (
    <span className="chip bg-warn-soft text-warn" title="Wider skill spread than the cap allows">
      stretch
    </span>
  );
}

export function WaitBadge({ label, urgent }: { label: string; urgent?: boolean }) {
  return (
    <span className={`chip tabular-nums ${urgent ? 'bg-stop-soft text-stop' : 'bg-surface-sunk text-ink-soft'}`}>
      {label}
    </span>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-surface-line px-4 py-8 text-center">
      <p className="font-semibold text-ink-soft">{title}</p>
      {hint ? <p className="mt-1 text-sm text-ink-faint">{hint}</p> : null}
    </div>
  );
}

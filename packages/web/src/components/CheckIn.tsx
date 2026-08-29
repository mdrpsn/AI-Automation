'use client';

import { useState } from 'react';

const RATING_STEPS = [2.5, 2.75, 3.0, 3.25, 3.5, 3.75, 4.0, 4.25, 4.5, 5.0];

/**
 * Adding people is the highest-friction moment of a session — a queue of
 * players standing in front of you — so it is one field, one rating tap, done.
 */
export function CheckIn({
  onAdd,
  defaultRating = 3.5,
}: {
  onAdd: (name: string, rating: number) => void;
  defaultRating?: number;
}) {
  const [name, setName] = useState('');
  const [rating, setRating] = useState(defaultRating);
  const [bulk, setBulk] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd(trimmed, rating);
    setName('');
  };

  const submitBulk = () => {
    const names = bulkText
      .split(/[\n,]/)
      .map((n) => n.trim())
      .filter(Boolean);
    for (const n of names) onAdd(n, rating);
    setBulkText('');
    setBulk(false);
  };

  return (
    <div className="space-y-3">
      {bulk ? (
        <>
          <textarea
            className="field min-h-[120px] py-2"
            placeholder={'One name per line — paste a list straight in'}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <p className="text-xs text-ink-faint">
            Everyone pasted starts at {rating.toFixed(2)}. Adjust individuals afterwards.
          </p>
        </>
      ) : (
        <input
          className="field"
          placeholder="Player name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
          autoComplete="off"
        />
      )}

      <div>
        <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-ink-faint">
          Skill rating
        </p>
        <div className="flex flex-wrap gap-1.5">
          {RATING_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => setRating(step)}
              className={`min-h-[40px] min-w-[56px] rounded-xl border px-2 text-sm font-bold tabular-nums transition ${
                rating === step
                  ? 'border-accent bg-accent text-white'
                  : 'border-surface-line bg-surface text-ink-soft hover:border-accent'
              }`}
            >
              {step.toFixed(2)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className="btn-primary"
          onClick={bulk ? submitBulk : submit}
          disabled={bulk ? bulkText.trim().length === 0 : name.trim().length === 0}
        >
          {bulk ? 'Add all' : 'Check in'}
        </button>
        <button type="button" className="btn-quiet" onClick={() => setBulk((b) => !b)}>
          {bulk ? 'Single' : 'Paste a list'}
        </button>
      </div>
    </div>
  );
}

/** Display helpers. Everything here is read at arm's length, outdoors. */

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (minutes < 60) return `${minutes}:${String(secs).padStart(2, '0')}`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${String(minutes % 60).padStart(2, '0')}`;
}

/** Compact wait label for the queue: "just off", "4m", "22m". */
export function formatWait(seconds: number): string {
  if (seconds < 45) return 'just off';
  return `${Math.round(seconds / 60)}m`;
}

export function formatRating(rating: number): string {
  return rating.toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

export function formatSigned(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(2)}`;
}

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

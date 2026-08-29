import { liveStore } from '@/lib/liveStore';

export const dynamic = 'force-dynamic';

/** Long-poll window. Long enough to be cheap, short enough to survive proxies. */
const WAIT_MS = 25_000;

/**
 * Long-poll rather than SSE or WebSockets.
 *
 * A player's phone drops in and out of a patchy venue network constantly, and a
 * long-lived stream that silently dies looks identical to "nothing changed".
 * A poll that returns and is re-issued is self-healing, and the state here is
 * small enough that the extra round trips cost nothing.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const since = Number(new URL(request.url).searchParams.get('since') ?? 0);

  const entry = await liveStore.waitForChange(token, Number.isFinite(since) ? since : 0, WAIT_MS);

  if (!entry) {
    return Response.json({ changed: false }, { headers: { 'cache-control': 'no-store' } });
  }
  return Response.json(
    { changed: true, snapshot: entry.snapshot, updatedAt: entry.updatedAt },
    { headers: { 'cache-control': 'no-store' } },
  );
}

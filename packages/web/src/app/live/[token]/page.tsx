import { liveStore } from '@/lib/liveStore';
import { LiveView } from '@/components/LiveView';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const entry = await liveStore.read(token);
  return { title: entry ? `${entry.snapshot.sessionName} — live` : 'Open Play' };
}

/**
 * The page a player lands on from the QR code.
 *
 * Server-rendered with the current state already in the HTML, so it shows
 * something useful on the first paint over a bad venue connection rather than
 * a spinner waiting on JavaScript.
 */
export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const entry = await liveStore.read(token);

  if (!entry) {
    return (
      <div className="mx-auto max-w-md space-y-2 px-6 py-16 text-center">
        <h1 className="text-xl font-bold">Session not found</h1>
        <p className="text-sm text-ink-faint">
          This link may have expired, or the organizer has stopped sharing. Ask them for a fresh
          one.
        </p>
      </div>
    );
  }

  return <LiveView token={token} initial={entry.snapshot} initialUpdatedAt={entry.updatedAt} />;
}

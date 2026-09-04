import { liveStore } from '@/lib/liveStore';
import { JoinForm } from '@/components/JoinForm';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const entry = await liveStore.read(token);
  return { title: entry ? `Check in — ${entry.snapshot.sessionName}` : 'Check in' };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const entry = await liveStore.read(token);

  if (!entry) {
    return (
      <main className="mx-auto max-w-md space-y-2 px-6 py-16 text-center">
        <h1 className="text-xl font-bold">Session not found</h1>
        <p className="text-sm text-ink-faint">
          This link may have expired. Ask the organizer for a fresh one.
        </p>
      </main>
    );
  }

  if (!entry.snapshot.checkIn.open) {
    return (
      <main className="mx-auto max-w-md space-y-3 px-6 py-16 text-center">
        <h1 className="text-xl font-bold">Check-in is closed</h1>
        <p className="text-sm text-ink-faint">
          The organizer is not taking self check-ins for {entry.snapshot.sessionName} right now.
          Go and say hello to them instead.
        </p>
        <a href={`/live/${token}`} className="btn-quiet">
          See the queue
        </a>
      </main>
    );
  }

  return (
    <JoinForm
      token={token}
      sessionName={entry.snapshot.sessionName}
      duprRequired={entry.snapshot.checkIn.duprRequired}
    />
  );
}

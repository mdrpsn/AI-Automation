import { NextResponse } from 'next/server';
import { CHECK_IN_MESSAGES, MAX_PENDING, validateCheckIn } from '@/lib/checkin';
import type { PendingCheckIn } from '@/lib/checkin';
import { hashToken, liveStore, safeEqual } from '@/lib/liveStore';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ token: string }>;
}

/** One person filling in a form a few times over, not a flood. */
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 6;

/**
 * Coarse per-submitter key. Behind a shared venue wifi everyone looks like one
 * address, so this is a throttle on runaway submissions rather than an identity
 * check — the organizer's approval step is what actually gates the queue.
 */
function fingerprint(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded?.split(',')[0] ?? request.headers.get('x-real-ip') ?? 'unknown').trim();
}

/** A player submits a check-in. Public: the share token is the only credential. */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;

  const entry = await liveStore.read(token);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  const open = entry.snapshot.checkIn?.open === true;
  if (!open) {
    return NextResponse.json(
      { error: 'closed', message: CHECK_IN_MESSAGES.closed },
      { status: 403 },
    );
  }

  const who = fingerprint(request);
  if ((await liveStore.countRecent(token, who, RATE_WINDOW_MS)) >= RATE_LIMIT) {
    return NextResponse.json(
      { error: 'rate_limited', message: 'Too many attempts. Please wait a minute.' },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const pendingCount = (await liveStore.listPending(token)).length;
  const result = validateCheckIn(body as Record<string, unknown>, {
    open,
    duprRequired: entry.snapshot.checkIn?.duprRequired === true,
    pendingCount,
  });

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error, message: CHECK_IN_MESSAGES[result.error] },
      { status: result.error === 'too_many_pending' ? 503 : 400 },
    );
  }

  await liveStore.noteSubmission(token, who);
  const record: PendingCheckIn = {
    ...result.value,
    id: globalThis.crypto.randomUUID(),
    submittedAt: Date.now(),
  };
  await liveStore.addPending(token, record);

  return NextResponse.json({ ok: true, name: record.name, queued: pendingCount + 1 });
}

/**
 * The organizer's device collects what has come in.
 *
 * Gated on the publish secret, not the share token: everyone at the venue holds
 * the share token, and the check-in list carries names and claimed ratings that
 * are nobody else's business.
 */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const supplied = request.headers.get('x-publish-token') ?? '';
  if (supplied.length < 16) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const entry = await liveStore.read(token);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!safeEqual(entry.publishTokenHash, await hashToken(supplied))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const pending = await liveStore.listPending(token);
  return NextResponse.json(
    { pending, limit: MAX_PENDING },
    { headers: { 'cache-control': 'no-store' } },
  );
}

/** The organizer has dealt with these — accepted or declined, either way gone. */
export async function DELETE(request: Request, { params }: Params) {
  const { token } = await params;
  const supplied = request.headers.get('x-publish-token') ?? '';
  if (supplied.length < 16) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const entry = await liveStore.read(token);
  if (!entry) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  if (!safeEqual(entry.publishTokenHash, await hashToken(supplied))) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let ids: unknown;
  try {
    ids = ((await request.json()) as { ids?: unknown }).ids;
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }
  if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) {
    return NextResponse.json({ error: 'bad_ids' }, { status: 400 });
  }

  await liveStore.removePending(token, ids as string[]);
  return NextResponse.json({ ok: true });
}

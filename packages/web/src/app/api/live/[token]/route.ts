import { NextResponse } from 'next/server';
import { hashToken, liveStore, safeEqual } from '@/lib/liveStore';
import type { PublicSnapshot } from '@/lib/publicSnapshot';

export const dynamic = 'force-dynamic';

interface Params {
  params: Promise<{ token: string }>;
}

/** Players read the current state. No auth: the share token IS the credential. */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const entry = await liveStore.read(token);
  if (!entry) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json(entry.snapshot, {
    headers: { 'cache-control': 'no-store' },
  });
}

/**
 * The organizer's device publishes a new projection.
 *
 * The share token is public by design, so it cannot also authorize writes —
 * otherwise anyone who scanned the QR could rewrite the queue. A separate
 * publish secret, which never leaves the organizer's device, does that.
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;

  let body: { publishToken?: string; snapshot?: PublicSnapshot; unpublish?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'bad_json' }, { status: 400 });
  }

  const publishToken = body.publishToken;
  if (typeof publishToken !== 'string' || publishToken.length < 16) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const publishTokenHash = await hashToken(publishToken);

  const existing = await liveStore.read(token);
  // First publish claims the token; after that only the same secret may write.
  if (existing && !safeEqual(existing.publishTokenHash, publishTokenHash)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (body.unpublish) {
    await liveStore.remove(token);
    return NextResponse.json({ ok: true });
  }

  const snapshot = body.snapshot;
  if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.courts)) {
    return NextResponse.json({ error: 'bad_snapshot' }, { status: 400 });
  }

  await liveStore.publish(token, {
    snapshot,
    publishTokenHash,
    updatedAt: Date.now(),
  });
  return NextResponse.json({ ok: true });
}

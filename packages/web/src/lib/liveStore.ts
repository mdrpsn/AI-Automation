import type { PublicSnapshot } from './publicSnapshot.js';

/**
 * Server-side relay for published sessions.
 *
 * The organizer's device stays authoritative — this only ever holds the latest
 * public projection plus the hash of the token allowed to write it. Nothing
 * here is a source of truth, so losing it costs a page refresh, not a session.
 *
 * The in-memory implementation is correct for a single long-running Node
 * process (`next start` on a VPS, Fly, Railway, a laptop at the venue). On a
 * serverless platform each instance would hold its own copy, so a deploy there
 * needs a shared adapter — Postgres, Redis or Supabase — behind this same
 * interface.
 */
export interface LiveStore {
  publish(token: string, entry: LiveEntry): Promise<void>;
  read(token: string): Promise<LiveEntry | null>;
  remove(token: string): Promise<void>;
  /** Resolves when the entry for `token` changes, or on timeout. */
  waitForChange(token: string, since: number, timeoutMs: number): Promise<LiveEntry | null>;
}

export interface LiveEntry {
  snapshot: PublicSnapshot;
  /** SHA-256 of the publish token. The secret itself is never stored. */
  publishTokenHash: string;
  updatedAt: number;
}

/** Sessions go stale when an organizer closes the tab without unpublishing. */
const TTL_MS = 12 * 60 * 60 * 1000;

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time compare, so a wrong token cannot be found byte by byte. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

type Waiter = (entry: LiveEntry) => void;

function createMemoryStore(): LiveStore {
  const entries = new Map<string, LiveEntry>();
  const waiters = new Map<string, Set<Waiter>>();

  const sweep = () => {
    const cutoff = Date.now() - TTL_MS;
    for (const [token, entry] of entries) {
      if (entry.updatedAt < cutoff) entries.delete(token);
    }
  };

  return {
    async publish(token, entry) {
      sweep();
      entries.set(token, entry);
      const listeners = waiters.get(token);
      if (listeners) {
        for (const notify of listeners) notify(entry);
        waiters.delete(token);
      }
    },

    async read(token) {
      const entry = entries.get(token);
      if (!entry) return null;
      if (entry.updatedAt < Date.now() - TTL_MS) {
        entries.delete(token);
        return null;
      }
      return entry;
    },

    async remove(token) {
      entries.delete(token);
      const listeners = waiters.get(token);
      if (listeners) {
        waiters.delete(token);
      }
    },

    async waitForChange(token, since, timeoutMs) {
      const current = entries.get(token);
      if (current && current.updatedAt > since) return current;

      return new Promise<LiveEntry | null>((resolve) => {
        let settled = false;
        const notify: Waiter = (entry) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(entry);
        };

        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          waiters.get(token)?.delete(notify);
          resolve(null);
        }, timeoutMs);

        let set = waiters.get(token);
        if (!set) {
          set = new Set();
          waiters.set(token, set);
        }
        set.add(notify);
      });
    },
  };
}

// Next.js reloads modules in development, so the store is pinned to globalThis
// to survive a hot reload — otherwise every edit would drop live sessions.
const globalKey = Symbol.for('openplay.liveStore');
type GlobalWithStore = typeof globalThis & { [globalKey]?: LiveStore };
const globalRef = globalThis as GlobalWithStore;

export const liveStore: LiveStore = globalRef[globalKey] ?? createMemoryStore();
globalRef[globalKey] = liveStore;

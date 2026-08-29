import type { SessionState } from './session.js';

/**
 * Persistence boundary.
 *
 * The console keeps the authoritative session in memory and writes through to
 * this. Today the only implementation is IndexedDB on the organizer's own
 * device, which is what makes the app work at a venue with bad wifi — nothing
 * in the core loop touches the network. A Supabase adapter implements the same
 * interface later to add the live player view, without the UI changing.
 */
export interface SessionStore {
  load(id: string): Promise<SessionState | null>;
  save(state: SessionState): Promise<void>;
  list(): Promise<SessionSummary[]>;
  remove(id: string): Promise<void>;
}

export interface SessionSummary {
  id: string;
  name: string;
  status: SessionState['status'];
  createdAt: number;
  playerCount: number;
  matchCount: number;
}

const DB_NAME = 'openplay';
const DB_VERSION = 1;
const STORE = 'sessions';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function summarize(state: SessionState): SessionSummary {
  return {
    id: state.id,
    name: state.name,
    status: state.status,
    createdAt: state.createdAt,
    playerCount: state.playerOrder.length,
    matchCount: state.completed.length,
  };
}

export const indexedDbStore: SessionStore = {
  async load(id) {
    const db = await openDb();
    try {
      const value = await promisify<SessionState | undefined>(
        db.transaction(STORE, 'readonly').objectStore(STORE).get(id),
      );
      return value ?? null;
    } finally {
      db.close();
    }
  },

  async save(state) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(state);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },

  async list() {
    const db = await openDb();
    try {
      const all = await promisify<SessionState[]>(
        db.transaction(STORE, 'readonly').objectStore(STORE).getAll(),
      );
      return all.map(summarize).sort((a, b) => b.createdAt - a.createdAt);
    } finally {
      db.close();
    }
  },

  async remove(id) {
    const db = await openDb();
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } finally {
      db.close();
    }
  },
};

/** Used during SSR and in tests, where IndexedDB does not exist. */
export const memoryStore: SessionStore = (() => {
  const map = new Map<string, SessionState>();
  return {
    async load(id) {
      return map.get(id) ?? null;
    },
    async save(state) {
      map.set(state.id, state);
    },
    async list() {
      return [...map.values()].map(summarize).sort((a, b) => b.createdAt - a.createdAt);
    },
    async remove(id) {
      map.delete(id);
    },
  };
})();

export function getStore(): SessionStore {
  return typeof indexedDB === 'undefined' ? memoryStore : indexedDbStore;
}

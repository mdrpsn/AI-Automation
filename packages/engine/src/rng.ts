/**
 * Deterministic PRNG. The engine must produce byte-identical output for an
 * identical snapshot, so restarts are seeded from the snapshot rather than from
 * `Math.random`.
 */

/** FNV-1a. Stable across platforms and Node versions. */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number;
  /** Uniform integer in [0, max). */
  int(max: number): number;
}

/** mulberry32 — small, fast, good enough for restart diversity. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (max) => (max <= 0 ? 0 : Math.floor(next() * max) % max),
  };
}

/**
 * Deterministic pseudo-random number generation.
 *
 * Every generation-critical decision in BLOCKWORLD flows through these helpers so
 * that a world seed always reproduces the same terrain, structures and loot.
 * Math.random() is reserved for purely cosmetic things (particle jitter, sound
 * pitch) where determinism does not matter.
 */

/** 32-bit integer hash (avalanche function from the "splitmix"/"murmur" family). */
export function hash32(x: number): number {
  let h = x | 0;
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad);
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97);
  h = h ^ (h >>> 15);
  return h >>> 0;
}

/** Combine several integers into one well-mixed 32-bit value. */
export function hashCombine(...values: number[]): number {
  let h = 0x9e3779b9;
  for (let i = 0; i < values.length; i++) {
    h = hash32(h ^ (values[i] | 0));
  }
  return h >>> 0;
}

/** Hash an arbitrary string into a 32-bit unsigned integer (FNV-1a + avalanche). */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return hash32(h);
}

/**
 * Turn user seed input into a numeric seed.
 * Blank -> random, numeric text -> that number, anything else -> hashed.
 */
export function parseSeed(input: string): number {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return (Math.floor(Math.random() * 0xffffffff) ^ Date.now()) >>> 0;
  }
  if (/^-?\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isSafeInteger(n)) return hash32(n) >>> 0;
  }
  return hashString(trimmed);
}

/**
 * Small fast PRNG (mulberry32). Deterministic, seedable and cheap to create,
 * which matters because worldgen spawns one per chunk/feature.
 */
export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x1a2b3c4d;
  }

  /** Raw 32-bit unsigned integer. */
  nextUint(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) >>> 0;
  }

  /** Float in [0, 1). */
  next(): number {
    return this.nextUint() / 4294967296;
  }

  /** Integer in [0, max). */
  int(max: number): number {
    if (max <= 0) return 0;
    return this.nextUint() % max;
  }

  /** Integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    if (max <= min) return min;
    return min + this.int(max - min + 1);
  }

  /** Float in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /** True with the given probability. */
  chance(probability: number): boolean {
    return this.next() < probability;
  }

  /** Pick one element of an array. */
  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  /** Fisher-Yates shuffle in place. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const tmp = items[i];
      items[i] = items[j];
      items[j] = tmp;
    }
    return items;
  }

  /** Approximately gaussian value via the sum of uniforms. */
  gaussian(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 1.1547;
  }
}

/** Convenience: a Random deterministically derived from a seed plus coordinates. */
export function chunkRandom(seed: number, cx: number, cz: number, salt = 0): Random {
  return new Random(hashCombine(seed, cx * 341873128, cz * 132897987, salt));
}

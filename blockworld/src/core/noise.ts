/**
 * Seeded value/perlin noise used by the world generator.
 *
 * The 2011 terrain look comes from a handful of octaved 2D/3D noise fields
 * combined with hard thresholds rather than from a modern spline-based density
 * function, so the implementation here stays deliberately small.
 */

import { hashCombine } from './rng';

const GRAD3: ReadonlyArray<readonly [number, number, number]> = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Gradient-based perlin noise with a permutation table derived from the seed. */
export class PerlinNoise {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Deterministic shuffle driven purely by the seed.
    let state = (seed >>> 0) || 1;
    for (let i = 255; i > 0; i--) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      const j = state % (i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise2(x: number, y: number): number {
    return this.noise3(x, y, 0);
  }

  noise3(x: number, y: number, z: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const perm = this.perm;

    const a = perm[xi] + yi;
    const aa = perm[a & 255] + zi;
    const ab = perm[(a + 1) & 255] + zi;
    const b = perm[(xi + 1) & 255] + yi;
    const ba = perm[b & 255] + zi;
    const bb = perm[(b + 1) & 255] + zi;

    const g = (hashIndex: number, dx: number, dy: number, dz: number): number => {
      const grad = GRAD3[perm[hashIndex & 255] % 12];
      return grad[0] * dx + grad[1] * dy + grad[2] * dz;
    };

    const x1 = lerp(g(aa, xf, yf, zf), g(ba, xf - 1, yf, zf), u);
    const x2 = lerp(g(ab, xf, yf - 1, zf), g(bb, xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);
    const x3 = lerp(g(aa + 1, xf, yf, zf - 1), g(ba + 1, xf - 1, yf, zf - 1), u);
    const x4 = lerp(g(ab + 1, xf, yf - 1, zf - 1), g(bb + 1, xf - 1, yf - 1, zf - 1), u);
    const y2 = lerp(x3, x4, v);
    return lerp(y1, y2, w);
  }
}

/** Sum of several perlin octaves; the workhorse of the terrain shaper. */
export class OctaveNoise {
  private readonly octaves: PerlinNoise[];
  private readonly amplitudes: number[];
  private readonly totalAmplitude: number;

  constructor(seed: number, octaveCount: number, persistence = 0.5) {
    this.octaves = [];
    this.amplitudes = [];
    let amp = 1;
    let total = 0;
    for (let i = 0; i < octaveCount; i++) {
      this.octaves.push(new PerlinNoise(hashCombine(seed, i * 7919 + 13)));
      this.amplitudes.push(amp);
      total += amp;
      amp *= persistence;
    }
    this.totalAmplitude = total;
  }

  /** Normalised to roughly [-1, 1]. */
  sample2(x: number, z: number, frequency: number): number {
    let sum = 0;
    let freq = frequency;
    for (let i = 0; i < this.octaves.length; i++) {
      sum += this.octaves[i].noise2(x * freq, z * freq) * this.amplitudes[i];
      freq *= 2;
    }
    return sum / this.totalAmplitude;
  }

  sample3(x: number, y: number, z: number, frequency: number): number {
    let sum = 0;
    let freq = frequency;
    for (let i = 0; i < this.octaves.length; i++) {
      sum += this.octaves[i].noise3(x * freq, y * freq, z * freq) * this.amplitudes[i];
      freq *= 2;
    }
    return sum / this.totalAmplitude;
  }
}

/**
 * Cheap deterministic value noise sampled directly from a hash. Used where a
 * smooth gradient is unnecessary (scatter decisions, per-column jitter).
 */
export function valueNoise2(seed: number, x: number, z: number): number {
  return hashCombine(seed, x, z) / 4294967296;
}

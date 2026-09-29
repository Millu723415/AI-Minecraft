/**
 * Tiny 16x16 pixel painter used to author every texture of the game in code.
 * Pixels are RGBA bytes. For opaque block textures alpha doubles as a tint
 * mask: 255 = draw as-is, 128 = multiply by the biome tint colour.
 */

import { Random, hashString } from '../core/rng';

export type RGB = [number, number, number];

export const TINT_ALPHA = 128;

export class PixelTile {
  readonly size: number;
  readonly data: Uint8ClampedArray;
  readonly rng: Random;

  constructor(name: string, size = 16) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
    this.rng = new Random(hashString(name));
  }

  set(x: number, y: number, c: RGB, a = 255): this {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return this;
    const i = (y * this.size + x) * 4;
    this.data[i] = c[0];
    this.data[i + 1] = c[1];
    this.data[i + 2] = c[2];
    this.data[i + 3] = a;
    return this;
  }

  get(x: number, y: number): RGB {
    const i = (y * this.size + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2]];
  }

  alpha(x: number, y: number): number {
    return this.data[(y * this.size + x) * 4 + 3];
  }

  setAlpha(x: number, y: number, a: number): void {
    this.data[(y * this.size + x) * 4 + 3] = a;
  }

  /** Fill with a base colour plus per-pixel brightness noise. */
  noise(base: RGB, variance: number, a = 255): this {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const v = (this.rng.next() - 0.5) * 2 * variance;
        this.set(x, y, shade(base, v), a);
      }
    }
    return this;
  }

  fill(c: RGB, a = 255): this {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, c, a);
    return this;
  }

  clear(): this {
    this.data.fill(0);
    return this;
  }

  rect(x0: number, y0: number, w: number, h: number, c: RGB, a = 255): this {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) this.set(x, y, c, a);
    return this;
  }

  /** Noisy rectangle. */
  noiseRect(x0: number, y0: number, w: number, h: number, base: RGB, variance: number, a = 255): this {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        this.set(x, y, shade(base, (this.rng.next() - 0.5) * 2 * variance), a);
      }
    }
    return this;
  }

  /** Scatter small blobs of a colour (ore veins, speckles). */
  blobs(count: number, color: RGB, minSize: number, maxSize: number, variance = 12, margin = 1): this {
    for (let b = 0; b < count; b++) {
      let x = this.rng.range(margin, this.size - 1 - margin);
      let y = this.rng.range(margin, this.size - 1 - margin);
      const n = this.rng.range(minSize, maxSize);
      for (let k = 0; k < n; k++) {
        this.set(x, y, shade(color, (this.rng.next() - 0.5) * variance * 2));
        const d = this.rng.int(4);
        if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else y--;
        x = Math.max(margin, Math.min(this.size - 1 - margin, x));
        y = Math.max(margin, Math.min(this.size - 1 - margin, y));
      }
    }
    return this;
  }

  /** Apply a brightness change to every pixel matching a predicate. */
  map(fn: (x: number, y: number, c: RGB, a: number) => [RGB, number] | null): this {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const r = fn(x, y, this.get(x, y), this.alpha(x, y));
        if (r) this.set(x, y, r[0], r[1]);
      }
    }
    return this;
  }

  /** Darken the outer ring (bevel), used by many man-made blocks. */
  border(c: RGB, a = 255): this {
    for (let i = 0; i < this.size; i++) {
      this.set(i, 0, c, a);
      this.set(i, this.size - 1, c, a);
      this.set(0, i, c, a);
      this.set(this.size - 1, i, c, a);
    }
    return this;
  }

  /** Draw ASCII art: each char maps to a colour (or null = transparent/skip). */
  art(rows: string[], palette: Record<string, RGB | null>, ox = 0, oy = 0, a = 255): this {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const col = palette[ch];
        if (col) this.set(ox + x, oy + y, col, a);
      }
    }
    return this;
  }

  copyFrom(other: PixelTile): this {
    this.data.set(other.data);
    return this;
  }
}

export function shade(c: RGB, delta: number): RGB {
  return [clampByte(c[0] + delta), clampByte(c[1] + delta), clampByte(c[2] + delta)];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [
    clampByte(a[0] + (b[0] - a[0]) * t),
    clampByte(a[1] + (b[1] - a[1]) * t),
    clampByte(a[2] + (b[2] - a[2]) * t),
  ];
}

export function scale(c: RGB, f: number): RGB {
  return [clampByte(c[0] * f), clampByte(c[1] * f), clampByte(c[2] * f)];
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export function hex(value: number): RGB {
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

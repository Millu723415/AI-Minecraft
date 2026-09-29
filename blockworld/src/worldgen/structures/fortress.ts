/**
 * Nether fortresses: long nether-brick bridges on tall pillars, enclosed
 * halls, blaze spawner platforms and nether wart gardens.
 */

import { BlockId } from '../../blocks/ids';
import { Random, hashCombine } from '../../core/rng';
import type { ChunkWriter } from '../chunkwriter';
import { Piece, boxContains, collides, unionBox, type BBox, type Turn } from './piece';

interface Exit { lx: number; ly: number; lz: number; turn: Turn }

const NB = BlockId.NETHER_BRICK;
const FENCE = BlockId.NETHER_BRICK_FENCE;

export abstract class FortressPiece extends Piece {
  abstract readonly kind: string;
  readonly openings: Exit[] = [];
  abstract exits(r: Random): Exit[];

  /** Nether brick pillar from local y down to the ground or lava. */
  protected pillar(w: ChunkWriter, lx: number, lz: number, top = -1): void {
    this.pillarDown(w, lx, top, lz, NB, 0, 70);
  }

  protected carveOpenings(w: ChunkWriter, height = 3): void {
    for (const e of this.openings) {
      if (e.turn === 'forward') this.fill(w, e.lx - 1, 1, e.lz - 1, e.lx + 1, height, e.lz - 1, 0);
      else if (e.turn === 'left') this.fill(w, e.lx + 1, 1, e.lz - 1, e.lx + 1, height, e.lz + 1, 0);
      else if (e.turn === 'right') this.fill(w, e.lx - 1, 1, e.lz - 1, e.lx - 1, height, e.lz + 1, 0);
    }
  }
}

/** Open bridge span with railings, supported by pillars. */
class Bridge extends FortressPiece {
  readonly kind = 'bridge';
  constructor(seed: number, f: number, x: number, y: number, z: number, len: number) {
    super(seed, f, 5, 7, len, x, y, z, 2, 0);
  }

  exits(): Exit[] {
    return [{ lx: 2, ly: 0, lz: this.d, turn: 'forward' }];
  }

  build(w: ChunkWriter): void {
    const L = this.d - 1;
    this.fill(w, 0, 1, 0, 4, 6, L, 0);
    this.fill(w, 0, 0, 0, 4, 0, L, NB);
    this.fill(w, 0, -1, 0, 0, -1, L, NB);
    this.fill(w, 4, -1, 0, 4, -1, L, NB);
    this.fill(w, 0, 1, 0, 0, 1, L, NB);
    this.fill(w, 4, 1, 0, 4, 1, L, NB);
    for (let z = 0; z <= L; z++) {
      if (z % 2 === 0) { this.set(w, 0, 2, z, FENCE); this.set(w, 4, 2, z, FENCE); }
    }
    for (let z = 2; z <= L; z += 6) {
      this.fill(w, 0, -2, z, 4, -2, z, NB);
      for (const x of [0, 1, 3, 4]) this.pillar(w, x, z, -3);
    }
  }
}

/** Square landing where bridges meet. */
class Crossing extends FortressPiece {
  readonly kind = 'crossing';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 9, 7, 9, x, y, z, 4, 0);
  }

  exits(r: Random): Exit[] {
    const out: Exit[] = [];
    if (r.int(10) < 7) out.push({ lx: 4, ly: 0, lz: 9, turn: 'forward' });
    if (r.int(10) < 7) out.push({ lx: -1, ly: 0, lz: 4, turn: 'left' });
    if (r.int(10) < 7 || out.length === 0) out.push({ lx: 9, ly: 0, lz: 4, turn: 'right' });
    return out;
  }

  build(w: ChunkWriter): void {
    this.fill(w, 0, 1, 0, 8, 6, 8, 0);
    this.fill(w, 0, 0, 0, 8, 0, 8, NB);
    this.fill(w, 0, -1, 0, 8, -1, 8, NB);
    // Parapet, open at the entrance and at every exit that is used.
    for (let i = 0; i <= 8; i++) {
      for (const [x, z] of [[i, 0], [i, 8], [0, i], [8, i]]) {
        this.set(w, x, 1, z, NB);
        if (i % 2 === 0) this.set(w, x, 2, z, FENCE);
      }
    }
    this.fill(w, 3, 1, 0, 5, 2, 0, 0);
    this.carveOpenings(w, 2);
    for (const [x, z] of [[0, 0], [8, 0], [0, 8], [8, 8], [4, 4]]) this.pillar(w, x, z, -2);
    for (const [x, z] of [[1, 0], [0, 1], [7, 0], [8, 1], [0, 7], [1, 8], [8, 7], [7, 8]]) this.pillar(w, x, z, -2);
  }
}

/** Enclosed corridor with barred windows; `mode` adds side exits. */
class Hall extends FortressPiece {
  readonly kind = 'hall';
  constructor(seed: number, f: number, x: number, y: number, z: number, len: number, readonly mode: 'straight' | 'left' | 'right' | 'cross') {
    super(seed, f, 5, 7, len, x, y, z, 2, 0);
  }

  exits(): Exit[] {
    const mid = this.d >> 1;
    switch (this.mode) {
      case 'left': return [{ lx: -1, ly: 0, lz: mid, turn: 'left' }];
      case 'right': return [{ lx: 5, ly: 0, lz: mid, turn: 'right' }];
      case 'cross': return [{ lx: -1, ly: 0, lz: mid, turn: 'left' }, { lx: 5, ly: 0, lz: mid, turn: 'right' }, { lx: 2, ly: 0, lz: this.d, turn: 'forward' }];
      default: return [{ lx: 2, ly: 0, lz: this.d, turn: 'forward' }];
    }
  }

  build(w: ChunkWriter): void {
    const L = this.d - 1;
    this.fill(w, 0, 0, 0, 4, 6, L, NB);
    this.fill(w, 1, 1, 0, 3, 5, L, 0);
    this.fill(w, 1, 1, 0, 3, 3, 0, 0);
    // Front wall stays unless something continues from here.
    this.fill(w, 1, 1, L, 3, 5, L, NB);
    for (let z = 1; z < L; z += 2) {
      for (const x of [0, 4]) { this.set(w, x, 2, z, FENCE); this.set(w, x, 3, z, FENCE); }
    }
    this.carveOpenings(w);
    for (const [x, z] of [[0, 0], [4, 0], [0, L], [4, L]]) this.pillar(w, x, z);
  }
}

/** Open platform with a blaze spawner on a raised dais. */
class BlazePlatform extends FortressPiece {
  readonly kind = 'blaze';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 9, 7, 9, x, y, z, 4, 0);
  }

  exits(): Exit[] {
    return [];
  }

  build(w: ChunkWriter): void {
    this.fill(w, 0, 1, 0, 8, 6, 8, 0);
    this.fill(w, 0, 0, 0, 8, 0, 8, NB);
    this.fill(w, 0, -1, 0, 8, -1, 8, NB);
    for (let i = 0; i <= 8; i++) {
      for (const [x, z] of [[i, 8], [0, i], [8, i]]) { this.set(w, x, 1, z, NB); this.set(w, x, 2, z, FENCE); }
    }
    this.fill(w, 2, 1, 4, 6, 1, 7, NB);
    this.fill(w, 3, 1, 3, 5, 1, 3, BlockId.NETHER_BRICK_STAIRS, this.stairs(0, 1));
    for (const [x, z] of [[2, 4], [6, 4], [2, 7], [6, 7]]) this.set(w, x, 2, z, FENCE);
    this.spawner(w, 4, 2, 6, 'blaze');
    for (const [x, z] of [[0, 0], [8, 0], [0, 8], [8, 8], [4, 4]]) this.pillar(w, x, z, -2);
  }
}

/** Walled garden of nether wart growing in soul sand. */
class WartRoom extends FortressPiece {
  readonly kind = 'wart';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 11, 8, 11, x, y, z, 5, 0);
  }

  exits(r: Random): Exit[] {
    return r.int(2) === 0 ? [{ lx: 5, ly: 0, lz: 11, turn: 'forward' }] : [];
  }

  build(w: ChunkWriter): void {
    this.fill(w, 0, 0, 0, 10, 7, 10, NB);
    this.fill(w, 1, 1, 1, 9, 6, 9, 0);
    this.fill(w, 4, 1, 0, 6, 3, 0, 0);
    for (let z = 2; z <= 8; z += 2) {
      for (const x of [0, 10]) { this.set(w, x, 3, z, FENCE); this.set(w, x, 4, z, FENCE); }
    }
    for (const x0 of [1, 8]) {
      this.fill(w, x0, 1, 2, x0 + 1, 1, 8, BlockId.SOUL_SAND);
      for (let z = 2; z <= 8; z++) {
        for (let x = x0; x <= x0 + 1; x++) {
          this.set(w, x, 2, z, BlockId.NETHER_WART, Math.floor(this.rnd(x, 2, z, 3) * 4));
        }
      }
    }
    this.carveOpenings(w);
    for (const [x, z] of [[0, 0], [10, 0], [0, 10], [10, 10]]) this.pillar(w, x, z);
  }
}

// ---------------------------------------------------------------------------

interface Kind { name: string; weight: number; limit: number; minDepth: number }
const KINDS: Kind[] = [
  { name: 'bridge', weight: 30, limit: 0, minDepth: 0 },
  { name: 'crossing', weight: 12, limit: 8, minDepth: 0 },
  { name: 'hall', weight: 12, limit: 0, minDepth: 1 },
  { name: 'hallturn', weight: 10, limit: 0, minDepth: 1 },
  { name: 'hallcross', weight: 8, limit: 6, minDepth: 1 },
  { name: 'blaze', weight: 12, limit: 3, minDepth: 2 },
  { name: 'wart', weight: 10, limit: 2, minDepth: 3 },
];

export class Fortress {
  readonly pieces: FortressPiece[] = [];
  readonly box: BBox;

  constructor(readonly seed: number, readonly x: number, readonly y: number, readonly z: number) {
    let best: FortressPiece[] | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      this.pieces.length = 0;
      this.plan(new Random(hashCombine(seed, x, z, attempt, 0xf047)));
      const blaze = this.pieces.some((p) => p.kind === 'blaze');
      const wart = this.pieces.some((p) => p.kind === 'wart');
      if (blaze && wart && (!best || this.pieces.length > best.length)) best = this.pieces.slice();
      if (best && best.length >= 25) break;
    }
    if (best) { this.pieces.length = 0; this.pieces.push(...best); }
    this.box = unionBox(this.pieces.map((p) => p.box));
  }

  private plan(r: Random): void {
    const start = new Crossing(this.seed, r.int(4), this.x, this.y, this.z);
    this.pieces.push(start);
    const counts = new Map<string, number>();
    const pending: { parent: FortressPiece; exit: Exit }[] = start.exits(r).map((exit) => ({ parent: start, exit }));
    while (pending.length > 0 && this.pieces.length < 60) {
      const { parent, exit } = pending.splice(r.int(pending.length), 1)[0];
      const at = parent.exit(exit.lx, exit.ly, exit.lz, exit.turn);
      if (Math.abs(at.x - this.x) > 100 || Math.abs(at.z - this.z) > 100) continue;
      const depth = parent.depth + 1;
      for (let attempt = 0; attempt < 5; attempt++) {
        const kind = this.pick(r, counts, depth);
        if (!kind) break;
        const child = this.make(kind, r, at.facing, at.x, at.y, at.z);
        if (collides(this.pieces, child.box)) continue;
        child.depth = depth;
        const exits = child.exits(r);
        this.pieces.push(child);
        parent.openings.push(exit);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        for (const e of exits) pending.push({ parent: child, exit: e });
        break;
      }
    }
  }

  private pick(r: Random, counts: Map<string, number>, depth: number): string | null {
    const avail = KINDS.filter((k) => depth >= k.minDepth && (k.limit === 0 || (counts.get(k.name) ?? 0) < k.limit));
    const total = avail.reduce((s, k) => s + k.weight, 0);
    let n = r.int(total);
    for (const k of avail) { n -= k.weight; if (n < 0) return k.name; }
    return null;
  }

  private make(kind: string, r: Random, f: number, x: number, y: number, z: number): FortressPiece {
    const s = this.seed;
    switch (kind) {
      case 'crossing': return new Crossing(s, f, x, y, z);
      case 'hall': return new Hall(s, f, x, y, z, 5 + 2 * r.int(4), 'straight');
      case 'hallturn': return new Hall(s, f, x, y, z, 5, r.int(2) === 0 ? 'left' : 'right');
      case 'hallcross': return new Hall(s, f, x, y, z, 5, 'cross');
      case 'blaze': return new BlazePlatform(s, f, x, y, z);
      case 'wart': return new WartRoom(s, f, x, y, z);
      default: return new Bridge(s, f, x, y, z, 7 + 6 * r.int(3));
    }
  }

  /** Is the point inside one of the fortress pieces (for blaze spawning)? */
  contains(x: number, y: number, z: number): boolean {
    if (!boxContains({ ...this.box, y0: this.box.y0 - 4, y1: this.box.y1 + 4 }, x, y, z)) return false;
    for (const p of this.pieces) {
      const b = p.box;
      if (boxContains({ ...b, y0: b.y0 - 2, y1: b.y1 + 4 }, x, y, z)) return true;
    }
    return false;
  }
}

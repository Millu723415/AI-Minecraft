/**
 * Oriented structure pieces.
 *
 * A piece is authored in local coordinates: x across its width, y up and z
 * "forward" (away from the entrance). The piece's facing maps local space
 * onto the world. Structures are planned once from the world seed and then
 * rasterised chunk by chunk, so every random choice made while building a
 * piece must be derived from world coordinates (see `rnd`), never from a
 * sequential generator - otherwise neighbouring chunks would disagree.
 */

import { hashCombine } from '../../core/rng';
import { Attach, Facing4 } from '../../blocks/meta';
import type { ChunkWriter } from '../chunkwriter';

export interface BBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

export function bbox(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): BBox {
  return { x0: Math.min(x0, x1), y0: Math.min(y0, y1), z0: Math.min(z0, z1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), z1: Math.max(z0, z1) };
}

export function boxesIntersect(a: BBox, b: BBox): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
}

export function boxContains(b: BBox, x: number, y: number, z: number): boolean {
  return x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1;
}

export function unionBox(boxes: BBox[]): BBox {
  const u = { ...boxes[0] };
  for (const b of boxes) {
    u.x0 = Math.min(u.x0, b.x0); u.y0 = Math.min(u.y0, b.y0); u.z0 = Math.min(u.z0, b.z0);
    u.x1 = Math.max(u.x1, b.x1); u.y1 = Math.max(u.y1, b.y1); u.z1 = Math.max(u.z1, b.z1);
  }
  return u;
}

/** World unit vector of each Facing4 value. */
export const FACING_VEC: ReadonlyArray<readonly [number, number]> = [[0, 1], [-1, 0], [0, -1], [1, 0]];

export function facingOf(dx: number, dz: number): number {
  if (dz > 0) return Facing4.SOUTH;
  if (dx < 0) return Facing4.WEST;
  if (dz < 0) return Facing4.NORTH;
  return Facing4.EAST;
}

/** Local turn relative to a piece's forward direction. */
export type Turn = 'forward' | 'left' | 'right' | 'back';

export abstract class Piece {
  box: BBox;
  /** Depth in the generation tree (used to limit recursion). */
  depth = 0;

  /**
   * @param facing  world direction of local +z.
   * @param size    local width (x), height (y) and depth (z).
   * @param ex,ey,ez world position of local (ox, oy, 0) - the entrance.
   */
  constructor(readonly seed: number, readonly facing: number, readonly w: number, readonly h: number, readonly d: number,
    ex: number, ey: number, ez: number, ox = 0, oy = 0) {
    const y0 = ey - oy;
    const y1 = y0 + h - 1;
    switch (facing) {
      case Facing4.SOUTH: this.box = bbox(ex - ox, y0, ez, ex - ox + w - 1, y1, ez + d - 1); break;
      case Facing4.NORTH: this.box = bbox(ex - ox, y0, ez - d + 1, ex - ox + w - 1, y1, ez); break;
      case Facing4.EAST: this.box = bbox(ex, y0, ez - ox, ex + d - 1, y1, ez - ox + w - 1); break;
      default: this.box = bbox(ex - d + 1, y0, ez - ox, ex, y1, ez - ox + w - 1); break;
    }
  }

  abstract build(w: ChunkWriter): void;

  // --- coordinate transforms ------------------------------------------------
  wx(lx: number, lz: number): number {
    switch (this.facing) {
      case Facing4.SOUTH: case Facing4.NORTH: return this.box.x0 + lx;
      case Facing4.EAST: return this.box.x0 + lz;
      default: return this.box.x1 - lz;
    }
  }

  wz(lx: number, lz: number): number {
    switch (this.facing) {
      case Facing4.SOUTH: return this.box.z0 + lz;
      case Facing4.NORTH: return this.box.z1 - lz;
      default: return this.box.z0 + lx;
    }
  }

  wy(ly: number): number {
    return this.box.y0 + ly;
  }

  /** Transform a local horizontal direction into a world direction. */
  dir(dlx: number, dlz: number): [number, number] {
    switch (this.facing) {
      case Facing4.SOUTH: return [dlx, dlz];
      case Facing4.NORTH: return [dlx, -dlz];
      case Facing4.EAST: return [dlz, dlx];
      default: return [-dlz, dlx];
    }
  }

  turnFacing(t: Turn): number {
    const v: [number, number] = t === 'forward' ? [0, 1] : t === 'back' ? [0, -1] : t === 'left' ? [-1, 0] : [1, 0];
    const [dx, dz] = this.dir(v[0], v[1]);
    return facingOf(dx, dz);
  }

  // --- metadata helpers (arguments are local directions) --------------------
  /** Stairs ascending toward the local direction. */
  stairs(dlx: number, dlz: number, upside = false): number {
    const [dx, dz] = this.dir(dlx, dlz);
    const m = dx > 0 ? 0 : dx < 0 ? 1 : dz > 0 ? 2 : 3;
    return upside ? m | 4 : m;
  }

  /** Wall attachment (torch/ladder/sign) whose support block lies toward the local direction. */
  attach(dlx: number, dlz: number): number {
    const [dx, dz] = this.dir(dlx, dlz);
    return dx > 0 ? Attach.EAST : dx < 0 ? Attach.WEST : dz > 0 ? Attach.SOUTH : Attach.NORTH;
  }

  /** Facing4 of a block whose front points toward the local direction. */
  front(dlx: number, dlz: number): number {
    const [dx, dz] = this.dir(dlx, dlz);
    return facingOf(dx, dz);
  }

  /** Door whose closed panel sits on the local-direction edge of its block. */
  doorMeta(dlx: number, dlz: number): number {
    const [dx, dz] = this.dir(dlx, dlz);
    return dx < 0 ? 0 : dz < 0 ? 1 : dx > 0 ? 2 : 3;
  }

  /** Straight rail running along the local direction. */
  rail(dlx: number, dlz: number): number {
    const [dx] = this.dir(dlx, dlz);
    return dx !== 0 ? 1 : 0;
  }

  // --- block writing -----------------------------------------------------------
  /** Deterministic per-position random in [0, 1). */
  rnd(lx: number, ly: number, lz: number, salt = 0): number {
    return (hashCombine(this.seed, this.wx(lx, lz), this.wy(ly), this.wz(lx, lz), salt) >>> 0) / 4294967296;
  }

  get(w: ChunkWriter, lx: number, ly: number, lz: number): number {
    return w.get(this.wx(lx, lz), this.wy(ly), this.wz(lx, lz));
  }

  set(w: ChunkWriter, lx: number, ly: number, lz: number, id: number, meta = 0): void {
    w.set(this.wx(lx, lz), this.wy(ly), this.wz(lx, lz), id, meta);
  }

  fill(w: ChunkWriter, lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number, id: number, meta = 0): void {
    for (let ly = ly0; ly <= ly1; ly++) {
      for (let lz = lz0; lz <= lz1; lz++) {
        for (let lx = lx0; lx <= lx1; lx++) this.set(w, lx, ly, lz, id, meta);
      }
    }
  }

  /** Fill using a per-position block chooser. */
  fillWith(w: ChunkWriter, lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number,
    pick: (lx: number, ly: number, lz: number) => [number, number] | null): void {
    for (let ly = ly0; ly <= ly1; ly++) {
      for (let lz = lz0; lz <= lz1; lz++) {
        for (let lx = lx0; lx <= lx1; lx++) {
          const b = pick(lx, ly, lz);
          if (b) this.set(w, lx, ly, lz, b[0], b[1]);
        }
      }
    }
  }

  /** Box shell of `wall` with an `inner` interior. */
  shell(w: ChunkWriter, lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number,
    wall: (lx: number, ly: number, lz: number) => [number, number], inner = 0): void {
    this.fillWith(w, lx0, ly0, lz0, lx1, ly1, lz1, (lx, ly, lz) => {
      const edge = lx === lx0 || lx === lx1 || ly === ly0 || ly === ly1 || lz === lz0 || lz === lz1;
      return edge ? wall(lx, ly, lz) : [inner, 0];
    });
  }

  /** Replace only non-air blocks (used to avoid building walls in open air). */
  fillSolidOnly(w: ChunkWriter, lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number, id: number, meta = 0): void {
    this.fillWith(w, lx0, ly0, lz0, lx1, ly1, lz1, (lx, ly, lz) => {
      const cur = this.get(w, lx, ly, lz);
      return cur > 0 ? [id, meta] : null;
    });
  }

  /** Column of `id` from local y down to the first solid block (foundations). */
  pillarDown(w: ChunkWriter, lx: number, ly: number, lz: number, id: number, meta = 0, maxDepth = 24): void {
    for (let y = ly; y > ly - maxDepth && this.wy(y) > 0; y--) {
      const cur = this.get(w, lx, y, lz);
      if (cur < 0) return;
      if (cur !== 0 && cur !== 8 && cur !== 9 && cur !== 10 && cur !== 11 && cur !== 31 && cur !== 78) return;
      this.set(w, lx, y, lz, id, meta);
    }
  }

  /** Clear a column above the local y (removes terrain over buildings). */
  clearUp(w: ChunkWriter, lx: number, ly: number, lz: number, maxHeight = 20): void {
    for (let y = ly; y < ly + maxHeight; y++) {
      const cur = this.get(w, lx, y, lz);
      if (cur <= 0) { if (cur < 0) return; continue; }
      this.set(w, lx, y, lz, 0);
    }
  }

  chest(w: ChunkWriter, lx: number, ly: number, lz: number, loot: string, frontDlx: number, frontDlz: number): void {
    const x = this.wx(lx, lz); const y = this.wy(ly); const z = this.wz(lx, lz);
    if (!w.inside(x, y, z)) return;
    w.set(x, y, z, 54, this.front(frontDlx, frontDlz));
    w.addTile({ kind: 'chest', x, y, z, loot, lootSeed: hashCombine(this.seed, x, y, z, 0x10c7) });
  }

  spawner(w: ChunkWriter, lx: number, ly: number, lz: number, mob: string): void {
    const x = this.wx(lx, lz); const y = this.wy(ly); const z = this.wz(lx, lz);
    if (!w.inside(x, y, z)) return;
    w.set(x, y, z, 52, 0);
    w.addTile({ kind: 'spawner', x, y, z, mob, delay: 200 });
  }

  /** World entrance position for a child attached at local (lx, ly, lz) heading `turn`. */
  exit(lx: number, ly: number, lz: number, turn: Turn): { x: number; y: number; z: number; facing: number } {
    return { x: this.wx(lx, lz), y: this.wy(ly), z: this.wz(lx, lz), facing: this.turnFacing(turn) };
  }
}

/** Rasterise every piece of a structure that touches the chunk. */
export function rasterizePieces(pieces: readonly Piece[], w: ChunkWriter): void {
  const cb = bbox(w.minX, 0, w.minZ, w.minX + 15, 127, w.minZ + 15);
  for (const p of pieces) if (boxesIntersect(p.box, cb)) p.build(w);
}

/** Does any existing piece overlap the box? */
export function collides(pieces: readonly Piece[], b: BBox): boolean {
  for (const p of pieces) if (boxesIntersect(p.box, b)) return true;
  return false;
}

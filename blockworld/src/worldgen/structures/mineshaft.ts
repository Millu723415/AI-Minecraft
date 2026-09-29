/**
 * Abandoned mineshafts: a dirt-floored hub room with long timber-supported
 * corridors, crossings and stairways branching out through the rock.
 */

import { BlockId } from '../../blocks/ids';
import { Random, hashCombine } from '../../core/rng';
import type { ChunkWriter } from '../chunkwriter';
import { Piece, collides, unionBox, type BBox, type Turn } from './piece';

interface Exit { lx: number; ly: number; lz: number; turn: Turn }

const isOpen = (id: number): boolean =>
  id === 0 || id === BlockId.WATER || id === BlockId.WATER_FLOWING || id === BlockId.LAVA || id === BlockId.LAVA_FLOWING;

abstract class MinePiece extends Piece {
  abstract exits(r: Random): Exit[];

  /** Plank bridges wherever the floor below is open. */
  protected bridge(w: ChunkWriter, lx0: number, lx1: number, lz0: number, lz1: number, ly = -1): void {
    for (let z = lz0; z <= lz1; z++) {
      for (let x = lx0; x <= lx1; x++) {
        const id = this.get(w, x, ly, z);
        if (id >= 0 && isOpen(id)) this.set(w, x, ly, z, BlockId.PLANKS);
      }
    }
  }
}

class Room extends MinePiece {
  constructor(seed: number, x: number, y: number, z: number, w: number, h: number, d: number) {
    super(seed, 0, w, h, d, x, y, z, 0, 0);
  }

  exits(r: Random): Exit[] {
    const out: Exit[] = [];
    for (let z = 1 + r.int(3); z < this.d - 3; z += 4 + r.int(4)) {
      if (r.int(3) !== 0) out.push({ lx: -1, ly: 1, lz: z + 1, turn: 'left' });
      if (r.int(3) !== 0) out.push({ lx: this.w, ly: 1, lz: z + 1, turn: 'right' });
    }
    for (let x = 1 + r.int(3); x < this.w - 3; x += 4 + r.int(4)) {
      if (r.int(3) !== 0) out.push({ lx: x + 1, ly: 1, lz: this.d, turn: 'forward' });
      if (r.int(3) !== 0) out.push({ lx: x + 1, ly: 1, lz: -1, turn: 'back' });
    }
    return out;
  }

  build(w: ChunkWriter): void {
    this.fill(w, 0, 0, 0, this.w - 1, 0, this.d - 1, BlockId.DIRT);
    this.fill(w, 0, 1, 0, this.w - 1, this.h - 1, this.d - 1, 0);
  }
}

/** Three wide, three high timbered tunnel. Local y 0 is the walking layer. */
class Corridor extends MinePiece {
  rails = false;
  spiders = false;
  chestZ = -1;
  constructor(seed: number, facing: number, x: number, y: number, z: number, len: number) {
    super(seed, facing, 3, 3, len, x, y, z, 1, 0);
  }

  exits(r: Random): Exit[] {
    this.rails = r.int(3) === 0;
    this.spiders = !this.rails && r.int(23) === 0;
    if (r.int(6) === 0) this.chestZ = 1 + r.int(this.d - 2);
    const out: Exit[] = [];
    const roll = r.int(10);
    if (roll < 8) out.push({ lx: 1, ly: 0, lz: this.d, turn: 'forward' });
    if (roll >= 6 || r.int(4) === 0) out.push({ lx: -1, ly: 0, lz: this.d - 2, turn: 'left' });
    if (roll >= 6 || r.int(4) === 0) out.push({ lx: 3, ly: 0, lz: this.d - 2, turn: 'right' });
    return out;
  }

  build(w: ChunkWriter): void {
    this.fill(w, 0, 0, 0, 2, 2, this.d - 1, 0);
    this.bridge(w, 0, 2, 0, this.d - 1);
    for (let z = 2; z < this.d; z += 5) {
      this.fill(w, 0, 0, z, 0, 1, z, BlockId.FENCE);
      this.fill(w, 2, 0, z, 2, 1, z, BlockId.FENCE);
      this.fill(w, 0, 2, z, 2, 2, z, BlockId.PLANKS);
      if (this.rnd(1, 2, z, 5) < 0.12 && z > 0) this.set(w, 1, 2, z - 1, BlockId.TORCH, this.attach(0, 1));
    }
    const webChance = this.spiders ? 0.12 : 0.012;
    for (let z = 0; z < this.d; z++) {
      for (let y = 0; y <= 2; y++) {
        for (let x = 0; x <= 2; x++) {
          if (this.get(w, x, y, z) === 0 && this.rnd(x, y, z, 6) < webChance) this.set(w, x, y, z, BlockId.COBWEB);
        }
      }
      if (this.rails && this.get(w, 1, 0, z) === 0 && this.rnd(1, 0, z, 7) < 0.7) {
        const below = this.get(w, 1, -1, z);
        if (below > 0 && !isOpen(below)) this.set(w, 1, 0, z, BlockId.RAIL, this.rail(0, 1));
      }
    }
    if (this.spiders) this.spawner(w, 1, 0, Math.floor(this.d / 2), 'cave_spider');
    if (this.chestZ >= 0 && this.chestZ % 5 !== 2) {
      const side = this.rnd(0, 0, this.chestZ, 8) < 0.5 ? 0 : 2;
      this.chest(w, side, 0, this.chestZ, 'mineshaft', side === 0 ? 1 : -1, 0);
    }
  }
}

/** Plus-shaped junction, occasionally two storeys tall. */
class Crossing extends MinePiece {
  constructor(seed: number, facing: number, x: number, y: number, z: number, readonly tall: boolean) {
    super(seed, facing, 5, tall ? 7 : 3, 5, x, y, z, 2, 0);
  }

  exits(r: Random): Exit[] {
    const out: Exit[] = [];
    if (r.int(4) !== 0) out.push({ lx: 2, ly: 0, lz: 5, turn: 'forward' });
    if (r.int(4) !== 0) out.push({ lx: -1, ly: 0, lz: 2, turn: 'left' });
    if (r.int(4) !== 0) out.push({ lx: 5, ly: 0, lz: 2, turn: 'right' });
    if (this.tall) {
      if (r.int(2) === 0) out.push({ lx: -1, ly: 4, lz: 2, turn: 'left' });
      if (r.int(2) === 0) out.push({ lx: 5, ly: 4, lz: 2, turn: 'right' });
    }
    return out;
  }

  build(w: ChunkWriter): void {
    this.fill(w, 1, 0, 0, 3, this.h - 1, 4, 0);
    this.fill(w, 0, 0, 1, 4, this.h - 1, 3, 0);
    this.bridge(w, 1, 3, 0, 4);
    this.bridge(w, 0, 4, 1, 3);
    if (this.tall) {
      this.fill(w, 1, 3, 1, 3, 3, 3, BlockId.PLANKS);
      for (const [x, z] of [[1, 1], [3, 1], [1, 3], [3, 3]]) this.fill(w, x, 0, z, x, 2, z, BlockId.PLANKS);
      this.fill(w, 1, 4, 1, 3, this.h - 1, 3, 0);
    }
  }
}

/** Stairway descending four blocks. */
class Stairs extends MinePiece {
  constructor(seed: number, facing: number, x: number, y: number, z: number) {
    super(seed, facing, 3, 8, 8, x, y, z, 1, 4);
  }

  exits(): Exit[] {
    return [{ lx: 1, ly: 0, lz: 8, turn: 'forward' }];
  }

  build(w: ChunkWriter): void {
    // Entrance level at local y 4, bottom at 0.
    this.fill(w, 0, 4, 0, 2, 6, 1, 0);
    for (let s = 0; s < 4; s++) {
      const z = 2 + s;
      this.fill(w, 0, 3 - s, z, 2, 6 - s, z, 0);
    }
    this.fill(w, 0, 0, 6, 2, 2, 7, 0);
    this.bridge(w, 0, 2, 0, 1, 3);
    this.bridge(w, 0, 2, 6, 7, -1);
  }
}

export class Mineshaft {
  readonly pieces: MinePiece[] = [];
  readonly box: BBox;

  constructor(readonly seed: number, readonly x: number, readonly y: number, readonly z: number) {
    const r = new Random(hashCombine(seed, x, y, z, 0x3a1e));
    const room = new Room(seed, x, y, z, 7 + r.int(8), 4 + r.int(3), 7 + r.int(8));
    this.pieces.push(room);
    const pending: { parent: MinePiece; exit: Exit }[] = room.exits(r).map((exit) => ({ parent: room, exit }));
    while (pending.length > 0 && this.pieces.length < 90) {
      const { parent, exit } = pending.splice(r.int(pending.length), 1)[0];
      if (parent.depth >= 8) continue;
      const at = parent.exit(exit.lx, exit.ly, exit.lz, exit.turn);
      if (Math.abs(at.x - x) > 80 || Math.abs(at.z - z) > 80) continue;
      const roll = r.int(100);
      let child: MinePiece;
      if (roll < 70 || parent instanceof Room) child = new Corridor(seed, at.facing, at.x, at.y, at.z, 5 * (2 + r.int(4)) + 2);
      else if (roll < 85) child = new Crossing(seed, at.facing, at.x, at.y, at.z, r.int(4) === 0);
      else child = new Stairs(seed, at.facing, at.x, at.y, at.z);
      if (child.box.y0 < 6) continue;
      if (collides(this.pieces, child.box)) {
        // Try a shorter corridor before giving up.
        if (!(child instanceof Corridor) || child.d <= 7) continue;
        child = new Corridor(seed, at.facing, at.x, at.y, at.z, 7);
        if (collides(this.pieces, child.box)) continue;
      }
      child.depth = parent.depth + 1;
      this.pieces.push(child);
      for (const e of child.exits(r)) pending.push({ parent: child, exit: e });
    }
    this.box = unionBox(this.pieces.map((p) => p.box));
  }
}

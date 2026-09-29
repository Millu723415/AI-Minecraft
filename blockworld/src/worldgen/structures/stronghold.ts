/**
 * Strongholds: underground stone-brick labyrinths holding the End portal
 * room. A plan is grown piece by piece from a starting staircase, with the
 * portal room guaranteed to appear exactly once.
 */

import { BlockId, StoneBrickType } from '../../blocks/ids';
import { FRAME_EYE, DOOR_UPPER } from '../../blocks/meta';
import { Random, hashCombine } from '../../core/rng';
import type { ChunkWriter } from '../chunkwriter';
import { Piece, collides, unionBox, type BBox, type Turn } from './piece';

type Door = -1 | 0 | 1 | 2 | 3; // closed, opening, wooden door, grates, iron door

interface Exit { lx: number; ly: number; lz: number; turn: Turn }

type Block = [number, number];

function stoneBrick(r: number): Block {
  if (r < 0.03) return [BlockId.MONSTER_EGG, 2];
  if (r < 0.18) return [BlockId.STONE_BRICKS, StoneBrickType.CRACKED];
  if (r < 0.38) return [BlockId.STONE_BRICKS, StoneBrickType.MOSSY];
  return [BlockId.STONE_BRICKS, StoneBrickType.NORMAL];
}

export abstract class StrongholdPiece extends Piece {
  abstract readonly kind: string;
  doorType: Door = 0;
  /** Exits that received a child; their wall gets opened. */
  readonly openings: Exit[] = [];

  /** Random stone brick for a wall position. */
  protected sb = (lx: number, ly: number, lz: number): Block => stoneBrick(this.rnd(lx, ly, lz, 1));

  /** Stone brick shell with an air interior. */
  protected hollow(w: ChunkWriter, lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number): void {
    this.shell(w, lx0, ly0, lz0, lx1, ly1, lz1, this.sb, 0);
  }

  abstract exits(r: Random): Exit[];

  /** Entrance door in the back wall (lz = 0) centred on local x `c`. */
  protected entrance(w: ChunkWriter, c: number, ly = 1): void {
    switch (this.doorType) {
      case -1: return;
      case 0:
        this.fill(w, c - 1, ly, 0, c + 1, ly + 2, 0, 0);
        return;
      case 1: {
        this.fillWith(w, c - 1, ly, 0, c + 1, ly + 2, 0, this.sb);
        const m = this.doorMeta(0, -1);
        this.set(w, c, ly, 0, BlockId.WOODEN_DOOR, m);
        this.set(w, c, ly + 1, 0, BlockId.WOODEN_DOOR, m | DOOR_UPPER);
        return;
      }
      case 2:
        this.fill(w, c - 1, ly, 0, c + 1, ly + 2, 0, BlockId.IRON_BARS);
        this.fill(w, c, ly, 0, c, ly + 1, 0, 0);
        return;
      case 3: {
        this.fillWith(w, c - 1, ly, 0, c + 1, ly + 2, 0, this.sb);
        const m = this.doorMeta(0, -1);
        this.set(w, c, ly, 0, BlockId.IRON_DOOR, m);
        this.set(w, c, ly + 1, 0, BlockId.IRON_DOOR, m | DOOR_UPPER);
        // Buttons on both faces of the wall.
        this.set(w, c + 1, ly + 1, 1, BlockId.STONE_BUTTON, this.attach(0, -1));
        this.set(w, c + 1, ly + 1, -1, BlockId.STONE_BUTTON, this.attach(0, 1));
        return;
      }
    }
  }

  /** Open the walls of every exit that leads somewhere. */
  protected carveOpenings(w: ChunkWriter): void {
    for (const e of this.openings) {
      if (e.turn === 'forward') this.fill(w, e.lx - 1, e.ly, e.lz - 1, e.lx + 1, e.ly + 2, e.lz - 1, 0);
      else if (e.turn === 'left') this.fill(w, e.lx + 1, e.ly, e.lz - 1, e.lx + 1, e.ly + 2, e.lz + 1, 0);
      else if (e.turn === 'right') this.fill(w, e.lx - 1, e.ly, e.lz - 1, e.lx - 1, e.ly + 2, e.lz + 1, 0);
    }
  }

  protected wallTorch(w: ChunkWriter, lx: number, ly: number, lz: number, sdx: number, sdz: number): void {
    this.set(w, lx, ly, lz, BlockId.TORCH, this.attach(sdx, sdz));
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

class Corridor extends StrongholdPiece {
  readonly kind = 'corridor';
  private torches: number[] = [];
  constructor(seed: number, facing: number, x: number, y: number, z: number, len: number) {
    super(seed, facing, 5, 5, len, x, y, z, 2, 1);
  }

  exits(r: Random): Exit[] {
    const out: Exit[] = [{ lx: 2, ly: 1, lz: this.d, turn: 'forward' }];
    if (this.d >= 7) {
      if (r.int(2) === 0) out.push({ lx: -1, ly: 1, lz: r.range(2, this.d - 3), turn: 'left' });
      if (r.int(2) === 0) out.push({ lx: 5, ly: 1, lz: r.range(2, this.d - 3), turn: 'right' });
    }
    for (let z = 2; z < this.d - 1; z += 4) if (r.int(3) === 0) this.torches.push(z);
    return out;
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 4, 4, this.d - 1);
    this.entrance(w, 2);
    this.carveOpenings(w);
    for (const z of this.torches) {
      if (this.get(w, 1, 2, z) === 0 && this.get(w, 0, 2, z) > 0) this.wallTorch(w, 1, 2, z, -1, 0);
    }
  }
}

class Turn90 extends StrongholdPiece {
  readonly kind = 'turn';
  constructor(seed: number, facing: number, x: number, y: number, z: number, readonly left: boolean) {
    super(seed, facing, 5, 5, 5, x, y, z, 2, 1);
  }

  exits(): Exit[] {
    return [this.left ? { lx: -1, ly: 1, lz: 2, turn: 'left' } : { lx: 5, ly: 1, lz: 2, turn: 'right' }];
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 4, 4, 4);
    this.entrance(w, 2);
    this.carveOpenings(w);
  }
}

/** Straight staircase descending six blocks. Entrance stand level is local y 7. */
class Stairs extends StrongholdPiece {
  readonly kind = 'stairs';
  constructor(seed: number, facing: number, x: number, y: number, z: number) {
    super(seed, facing, 5, 11, 8, x, y, z, 2, 7);
  }

  exits(): Exit[] {
    return [{ lx: 2, ly: 1, lz: 8, turn: 'forward' }];
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 4, 10, 7);
    this.entrance(w, 2, 7);
    // Landing at the top.
    this.fillWith(w, 1, 1, 1, 3, 6, 1, this.sb);
    for (let z = 2; z <= 6; z++) {
      const top = 7 - z; // solid top of the step (6 at z=1 .. 1 at z=6)
      if (top > 1) this.fillWith(w, 1, 1, z, 3, top - 1, z, this.sb);
      this.fill(w, 1, top, z, 3, top, z, BlockId.STONE_BRICK_STAIRS, this.stairs(0, -1));
    }
    this.carveOpenings(w);
    if (this.doorType === -1) {
      // The starting staircase has a small torch-lit landing.
      this.wallTorch(w, 2, 9, 1, 0, -1);
    }
  }
}

/** 11x11 room with up to three exits; three interior variants. */
class Room extends StrongholdPiece {
  readonly kind = 'room';
  variant = 0;
  constructor(seed: number, facing: number, x: number, y: number, z: number) {
    super(seed, facing, 11, 7, 11, x, y, z, 5, 1);
  }

  exits(r: Random): Exit[] {
    this.variant = r.int(3);
    const out: Exit[] = [];
    if (r.int(2) === 0) out.push({ lx: 5, ly: 1, lz: 11, turn: 'forward' });
    if (r.int(2) === 0) out.push({ lx: -1, ly: 1, lz: 5, turn: 'left' });
    if (r.int(2) === 0 || out.length === 0) out.push({ lx: 11, ly: 1, lz: 5, turn: 'right' });
    return out;
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 10, 6, 10);
    this.entrance(w, 5);
    this.carveOpenings(w);
    switch (this.variant) {
      case 0: {
        // Central pillar ringed with torches.
        this.fillWith(w, 4, 1, 4, 6, 5, 6, this.sb);
        this.wallTorch(w, 5, 3, 3, 0, 1);
        this.wallTorch(w, 5, 3, 7, 0, -1);
        this.wallTorch(w, 3, 3, 5, 1, 0);
        this.wallTorch(w, 7, 3, 5, -1, 0);
        break;
      }
      case 1: {
        // Fountain basin.
        this.fillWith(w, 3, 1, 3, 7, 1, 7, this.sb);
        this.fill(w, 4, 1, 4, 6, 1, 6, BlockId.WATER);
        this.fillWith(w, 5, 1, 5, 5, 3, 5, this.sb);
        this.set(w, 5, 4, 5, BlockId.WATER);
        this.wallTorch(w, 1, 3, 1, -1, 0);
        this.wallTorch(w, 9, 3, 9, 1, 0);
        break;
      }
      default: {
        // Store room with a raised gallery and a chest.
        this.fillWith(w, 1, 3, 1, 3, 3, 9, this.sb);
        this.fill(w, 1, 4, 1, 3, 4, 9, BlockId.SLAB, 5);
        for (let y = 1; y <= 3; y++) this.set(w, 4, y, 8, BlockId.LADDER, this.attach(-1, 0));
        this.chest(w, 2, 5, 8, 'stronghold_crossing', 1, 0);
        this.wallTorch(w, 9, 3, 5, 1, 0);
        this.wallTorch(w, 5, 3, 9, 0, 1);
        break;
      }
    }
  }
}

/** Hall with iron-barred cells. */
class Prison extends StrongholdPiece {
  readonly kind = 'prison';
  constructor(seed: number, facing: number, x: number, y: number, z: number) {
    super(seed, facing, 9, 5, 11, x, y, z, 2, 1);
  }

  exits(): Exit[] {
    return [{ lx: 2, ly: 1, lz: 11, turn: 'forward' }];
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 8, 4, 10);
    this.entrance(w, 2);
    this.carveOpenings(w);
    this.fill(w, 4, 1, 1, 4, 3, 9, BlockId.IRON_BARS);
    for (const z of [4, 8]) this.fillWith(w, 5, 1, z, 7, 3, z, this.sb);
    for (const z of [2, 6]) {
      const m = this.doorMeta(-1, 0);
      this.set(w, 4, 1, z, BlockId.IRON_DOOR, m);
      this.set(w, 4, 2, z, BlockId.IRON_DOOR, m | DOOR_UPPER);
    }
    this.wallTorch(w, 1, 2, 5, -1, 0);
  }
}

/** Short corridor with a chest in a wall niche. */
class ChestCorridor extends StrongholdPiece {
  readonly kind = 'chest';
  constructor(seed: number, facing: number, x: number, y: number, z: number) {
    super(seed, facing, 5, 5, 7, x, y, z, 2, 1);
  }

  exits(): Exit[] {
    return [{ lx: 2, ly: 1, lz: 7, turn: 'forward' }];
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 4, 4, 6);
    this.entrance(w, 2);
    this.carveOpenings(w);
    this.fill(w, 3, 1, 2, 3, 1, 4, BlockId.SLAB, 5);
    this.chest(w, 3, 2, 3, 'stronghold_corridor', -1, 0);
    this.wallTorch(w, 1, 2, 3, -1, 0);
  }
}

class Library extends StrongholdPiece {
  readonly kind = 'library';
  constructor(seed: number, facing: number, x: number, y: number, z: number) {
    super(seed, facing, 13, 7, 15, x, y, z, 6, 1);
  }

  exits(): Exit[] {
    return [];
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 12, 6, 14);
    this.entrance(w, 6);
    // Wall shelves with the odd gap.
    for (let z = 1; z <= 13; z++) {
      for (let y = 1; y <= 4; y++) {
        if (this.rnd(1, y, z, 3) > 0.08) this.set(w, 1, y, z, BlockId.BOOKSHELF);
        if (this.rnd(11, y, z, 3) > 0.08) this.set(w, 11, y, z, BlockId.BOOKSHELF);
      }
    }
    for (let x = 2; x <= 10; x++) {
      if (x >= 5 && x <= 7) continue;
      for (let y = 1; y <= 4; y++) this.set(w, x, y, 13, BlockId.BOOKSHELF);
    }
    // Free-standing shelf rows.
    for (const z of [4, 8]) {
      for (let x = 3; x <= 9; x++) {
        if (x === 6) continue;
        for (let y = 1; y <= 3; y++) this.set(w, x, y, z, BlockId.BOOKSHELF);
      }
    }
    // Cobwebs in the dusty corners.
    for (let z = 1; z <= 13; z++) {
      for (let y = 1; y <= 5; y++) {
        for (let x = 2; x <= 10; x++) {
          if (this.get(w, x, y, z) === 0 && this.rnd(x, y, z, 4) < 0.05) this.set(w, x, y, z, BlockId.COBWEB);
        }
      }
    }
    this.chest(w, 6, 1, 12, 'stronghold_library', 0, -1);
    this.wallTorch(w, 5, 3, 12, 0, 1);
    this.wallTorch(w, 7, 3, 12, 0, 1);
    this.wallTorch(w, 6, 3, 5, 0, -1);
    this.wallTorch(w, 6, 3, 3, 0, 1);
  }
}

/** The End portal room: lava moat, stairs, raised dais and silverfish spawner. */
export class PortalRoom extends StrongholdPiece {
  readonly kind = 'portal';
  constructor(seed: number, facing: number, x: number, y: number, z: number) {
    super(seed, facing, 11, 8, 16, x, y, z, 5, 1);
  }

  exits(): Exit[] {
    return [];
  }

  /** World position of the centre of the portal interior (at frame height). */
  center(): [number, number, number] {
    return [this.wx(5, 11), this.wy(3), this.wz(5, 11)];
  }

  build(w: ChunkWriter): void {
    this.hollow(w, 0, 0, 0, 10, 7, 15);
    this.entrance(w, 5);
    // Barred windows.
    for (let z = 2; z <= 13; z += 2) {
      this.set(w, 0, 4, z, BlockId.IRON_BARS);
      this.set(w, 10, 4, z, BlockId.IRON_BARS);
      this.set(w, 0, 5, z, BlockId.IRON_BARS);
      this.set(w, 10, 5, z, BlockId.IRON_BARS);
    }
    // Lava moats along the side walls near the entrance.
    this.fillWith(w, 1, 1, 1, 3, 1, 6, this.sb);
    this.fillWith(w, 7, 1, 1, 9, 1, 6, this.sb);
    this.fill(w, 2, 1, 2, 2, 1, 5, BlockId.LAVA);
    this.fill(w, 8, 1, 2, 8, 1, 5, BlockId.LAVA);
    // Stairs up to the dais.
    this.fill(w, 3, 1, 5, 7, 1, 5, BlockId.STONE_BRICK_STAIRS, this.stairs(0, 1));
    this.fillWith(w, 3, 1, 6, 7, 1, 6, this.sb);
    this.fill(w, 3, 2, 6, 7, 2, 6, BlockId.STONE_BRICK_STAIRS, this.stairs(0, 1));
    // Raised dais (standing level 3).
    this.fillWith(w, 1, 1, 7, 9, 2, 14, this.sb);
    // Lava beneath the portal interior.
    this.fill(w, 4, 2, 10, 6, 2, 12, BlockId.LAVA);
    // Twelve frames, each with a small chance of an eye already in place.
    const frames: [number, number, number, number][] = [];
    for (let i = 4; i <= 6; i++) {
      frames.push([i, 9, 0, 1], [i, 13, 0, -1]);
      frames.push([3, i + 6, 1, 0], [7, i + 6, -1, 0]);
    }
    for (const [x, z, fx, fz] of frames) {
      const eye = this.rnd(x, 3, z, 9) < 0.1 ? FRAME_EYE : 0;
      this.set(w, x, 3, z, BlockId.END_PORTAL_FRAME, this.front(fx, fz) | eye);
    }
    this.spawner(w, 5, 3, 7, 'silverfish');
  }
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

interface Kind { name: string; weight: number; limit: number; minDepth: number }

const KINDS: Kind[] = [
  { name: 'corridor', weight: 40, limit: 0, minDepth: 0 },
  { name: 'prison', weight: 5, limit: 5, minDepth: 0 },
  { name: 'left', weight: 20, limit: 0, minDepth: 0 },
  { name: 'right', weight: 20, limit: 0, minDepth: 0 },
  { name: 'room', weight: 10, limit: 6, minDepth: 0 },
  { name: 'stairs', weight: 5, limit: 5, minDepth: 0 },
  { name: 'chest', weight: 5, limit: 4, minDepth: 0 },
  { name: 'library', weight: 10, limit: 2, minDepth: 4 },
  { name: 'portal', weight: 20, limit: 1, minDepth: 7 },
];

export class Stronghold {
  readonly pieces: StrongholdPiece[] = [];
  readonly box: BBox;
  portal: PortalRoom | null = null;

  constructor(readonly seed: number, readonly x: number, readonly y: number, readonly z: number) {
    // Grow plans until one is both large and contains the portal room; keep the
    // best candidate in case none reaches the target size.
    let best: { pieces: StrongholdPiece[]; portal: PortalRoom } | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      this.pieces.length = 0;
      this.portal = null;
      this.plan(new Random(hashCombine(seed, x, z, attempt)));
      if (this.portal && (!best || this.pieces.length > best.pieces.length)) {
        best = { pieces: this.pieces.slice(), portal: this.portal };
      }
      if (best && best.pieces.length >= 35) break;
    }
    if (best) {
      this.pieces.length = 0;
      this.pieces.push(...best.pieces);
      this.portal = best.portal;
    }
    this.box = unionBox(this.pieces.map((p) => p.box));
  }

  private plan(r: Random): void {
    const start = new Stairs(this.seed, r.int(4), this.x, this.y, this.z);
    start.doorType = -1;
    this.pieces.push(start);
    const counts = new Map<string, number>();
    const pending: { parent: StrongholdPiece; exit: Exit }[] = start.exits().map((exit) => ({ parent: start, exit }));
    while (pending.length > 0 && this.pieces.length < 80) {
      const { parent, exit } = pending.splice(r.int(pending.length), 1)[0];
      const at = parent.exit(exit.lx, exit.ly, exit.lz, exit.turn);
      if (Math.abs(at.x - this.x) > 96 || Math.abs(at.z - this.z) > 96) continue;
      const depth = parent.depth + 1;
      for (let attempt = 0; attempt < 6; attempt++) {
        const kind = this.pickKind(r, counts, depth);
        if (!kind) break;
        const child = this.make(kind, r, at.facing, at.x, at.y, at.z);
        if (child.box.y0 < 5 || collides(this.pieces, child.box)) continue;
        child.depth = depth;
        child.doorType = r.int(4) as Door;
        const exits = child.exits(r);
        this.pieces.push(child);
        parent.openings.push(exit);
        counts.set(kind, (counts.get(kind) ?? 0) + 1);
        if (child instanceof PortalRoom) this.portal = child;
        for (const e of exits) pending.push({ parent: child, exit: e });
        break;
      }
    }
  }

  private pickKind(r: Random, counts: Map<string, number>, depth: number): string | null {
    const avail = KINDS.filter((k) => depth >= k.minDepth && (k.limit === 0 || (counts.get(k.name) ?? 0) < k.limit));
    const weight = (k: Kind) => (k.name === 'portal' && this.pieces.length > 25 ? k.weight * 4 : k.weight);
    const total = avail.reduce((s, k) => s + weight(k), 0);
    if (total <= 0) return null;
    let n = r.int(total);
    for (const k of avail) {
      n -= weight(k);
      if (n < 0) return k.name;
    }
    return avail[0].name;
  }

  private make(kind: string, r: Random, f: number, x: number, y: number, z: number): StrongholdPiece {
    const s = this.seed;
    switch (kind) {
      case 'prison': return new Prison(s, f, x, y, z);
      case 'left': return new Turn90(s, f, x, y, z, true);
      case 'right': return new Turn90(s, f, x, y, z, false);
      case 'room': return new Room(s, f, x, y, z);
      case 'stairs': return new Stairs(s, f, x, y, z);
      case 'chest': return new ChestCorridor(s, f, x, y, z);
      case 'library': return new Library(s, f, x, y, z);
      case 'portal': return new PortalRoom(s, f, x, y, z);
      default: return new Corridor(s, f, x, y, z, r.range(5, 15));
    }
  }
}

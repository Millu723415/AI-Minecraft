/**
 * Villages of the 2011 era: a well at the centre, gravel roads spreading
 * outwards and small wooden and cobblestone buildings lining the roads.
 * Desert villages swap timber and cobblestone for sandstone.
 */

import { BlockId, DyeColor } from '../../blocks/ids';
import { DOOR_UPPER } from '../../blocks/meta';
import { Random, hashCombine } from '../../core/rng';
import { SEA_LEVEL } from '../../world/constants';
import type { ChunkWriter } from '../chunkwriter';
import { Piece, boxContains, unionBox, type BBox } from './piece';

type Ground = (x: number, z: number) => number;

/** Village pieces follow the terrain, so overlap is tested in plan view only. */
function collides(pieces: readonly Piece[], b: BBox): boolean {
  for (const p of pieces) {
    const o = p.box;
    if (o.x0 <= b.x1 && o.x1 >= b.x0 && o.z0 <= b.z1 && o.z1 >= b.z0) return true;
  }
  return false;
}

const SOFT = new Set<number>([
  0, BlockId.TALL_GRASS, BlockId.DANDELION, BlockId.ROSE, BlockId.SNOW_LAYER, BlockId.DEAD_BUSH,
  BlockId.BROWN_MUSHROOM, BlockId.RED_MUSHROOM, BlockId.SAPLING, BlockId.SUGAR_CANE, BlockId.CACTUS,
]);

abstract class VillagePiece extends Piece {
  abstract readonly kind: string;
  desert = false;
  /** Local positions where a villager stands when the chunk is first created. */
  villagerSpots: [number, number, number][] = [];

  /** Move the piece so its floor (local y 0) sits at world y. */
  setGround(y: number): void {
    const h = this.box.y1 - this.box.y0;
    this.box.y0 = y;
    this.box.y1 = y + h;
  }

  /** Material substitution for desert villages. */
  protected m(id: number, meta = 0): [number, number] {
    if (!this.desert) return [id, meta];
    switch (id) {
      case BlockId.COBBLESTONE: case BlockId.PLANKS: case BlockId.LOG: return [BlockId.SANDSTONE, 0];
      case BlockId.GRAVEL: return [BlockId.SANDSTONE, 0];
      case BlockId.OAK_STAIRS: case BlockId.COBBLESTONE_STAIRS: return [BlockId.SLAB, 1];
      case BlockId.DIRT: return [BlockId.SAND, 0];
      default: return [id, meta];
    }
  }

  protected put(w: ChunkWriter, lx: number, ly: number, lz: number, id: number, meta = 0): void {
    const [a, b] = this.m(id, meta);
    this.set(w, lx, ly, lz, a, b);
  }

  protected box3(w: ChunkWriter, lx0: number, ly0: number, lz0: number, lx1: number, ly1: number, lz1: number, id: number, meta = 0): void {
    const [a, b] = this.m(id, meta);
    this.fill(w, lx0, ly0, lz0, lx1, ly1, lz1, a, b);
  }

  /** Level the site: foundations below the floor and nothing above the roof. */
  protected prepare(w: ChunkWriter, lx0 = 0, lz0 = 0, lx1 = this.w - 1, lz1 = this.d - 1): void {
    for (let z = lz0; z <= lz1; z++) {
      for (let x = lx0; x <= lx1; x++) {
        this.clearUp(w, x, 1, z, 24);
        const [a, b] = this.m(BlockId.COBBLESTONE);
        this.pillarDown(w, x, -1, z, a, b, 30);
      }
    }
  }

  protected doorAt(w: ChunkWriter, lx: number, lz: number, iron = false): void {
    const id = iron ? BlockId.IRON_DOOR : BlockId.WOODEN_DOOR;
    const meta = this.doorMeta(0, -1);
    this.set(w, lx, 1, lz, id, meta);
    this.set(w, lx, 2, lz, id, meta | DOOR_UPPER);
    // Keep the doorstep walkable.
    if (lz === 0) {
      this.set(w, lx, 1, -1, 0);
      this.set(w, lx, 2, -1, 0);
      const below = this.get(w, lx, 0, -1);
      if (below >= 0 && SOFT.has(below)) this.put(w, lx, 0, -1, BlockId.COBBLESTONE);
    }
  }

  protected torch(w: ChunkWriter, lx: number, ly: number, lz: number, sdx: number, sdz: number): void {
    this.set(w, lx, ly, lz, BlockId.TORCH, this.attach(sdx, sdz));
  }

  /**
   * Pitched roof of oak stairs sloping along local z (ridge along x), starting
   * at local y `base` over the footprint x0..x1 / z0..z1, with plank gables.
   */
  protected pitchedRoof(w: ChunkWriter, x0: number, x1: number, z0: number, z1: number, base: number): void {
    const depth = z1 - z0 + 1;
    const half = Math.floor(depth / 2);
    for (let i = 0; i < half; i++) {
      const y = base + i;
      for (let x = x0 - 1; x <= x1 + 1; x++) {
        this.put(w, x, y, z0 - 1 + i, BlockId.OAK_STAIRS, this.stairs(0, 1));
        this.put(w, x, y, z1 + 1 - i, BlockId.OAK_STAIRS, this.stairs(0, -1));
      }
      for (let z = z0 + i; z <= z1 - i; z++) {
        this.put(w, x0, y, z, BlockId.PLANKS);
        this.put(w, x1, y, z, BlockId.PLANKS);
        for (let x = x0 + 1; x < x1; x++) this.set(w, x, y, z, 0);
      }
    }
    if (depth % 2 === 1) {
      for (let x = x0 - 1; x <= x1 + 1; x++) this.put(w, x, base + half, z0 + half, BlockId.SLAB, 2);
    }
  }

  /** Plank walls with log corner posts between local y 1 and `top`. */
  protected timberWalls(w: ChunkWriter, x0: number, z0: number, x1: number, z1: number, top: number): void {
    for (let y = 1; y <= top; y++) {
      for (let x = x0; x <= x1; x++) {
        for (let z = z0; z <= z1; z++) {
          const edgeX = x === x0 || x === x1;
          const edgeZ = z === z0 || z === z1;
          if (!edgeX && !edgeZ) { this.set(w, x, y, z, 0); continue; }
          this.put(w, x, y, z, edgeX && edgeZ ? BlockId.LOG : BlockId.PLANKS);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------

class Well extends VillagePiece {
  readonly kind = 'well';
  constructor(seed: number, x: number, y: number, z: number) {
    super(seed, 0, 6, 6, 6, x, y, z, 3, 0);
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    this.box3(w, 0, 0, 0, 5, 0, 5, BlockId.GRAVEL);
    this.box3(w, 1, -4, 1, 4, 0, 4, BlockId.COBBLESTONE);
    this.fill(w, 2, -3, 2, 3, 0, 3, BlockId.WATER);
    this.box3(w, 1, 1, 1, 4, 1, 4, BlockId.COBBLESTONE);
    this.fill(w, 2, 1, 2, 3, 1, 3, 0);
    for (const [x, z] of [[1, 1], [4, 1], [1, 4], [4, 4]]) this.fill(w, x, 2, z, x, 3, z, BlockId.FENCE);
    this.box3(w, 1, 4, 1, 4, 4, 4, BlockId.COBBLESTONE);
  }
}

/** Three-wide road; only the actual terrain surface is paved. */
class Road extends VillagePiece {
  readonly kind = 'road';
  constructor(seed: number, facing: number, x: number, y: number, z: number, len: number) {
    super(seed, facing, 3, 4, len, x, y, z, 1, 0);
  }

  build(w: ChunkWriter): void {
    const [pave, pm] = this.m(BlockId.GRAVEL);
    for (let lz = 0; lz < this.d; lz++) {
      for (let lx = 0; lx < 3; lx++) {
        const x = this.wx(lx, lz); const z = this.wz(lx, lz);
        if (!w.inside(x, 64, z)) continue;
        let y = 120;
        while (y > 1 && SOFT.has(w.get(x, y, z))) y--;
        const top = w.get(x, y, z);
        if (top === BlockId.GRASS || top === BlockId.DIRT || top === BlockId.SAND || top === BlockId.GRAVEL ||
          top === BlockId.STONE || top === BlockId.SANDSTONE || top === BlockId.MYCELIUM) {
          w.set(x, y, z, pave, pm);
          const above = w.get(x, y + 1, z);
          if (above > 0 && SOFT.has(above)) w.set(x, y + 1, z, 0);
        }
      }
    }
  }
}

class SmallHouse extends VillagePiece {
  readonly kind = 'house';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 5, 6, 5, x, y, z, 2, 0);
    this.villagerSpots = [[2, 1, 2]];
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    this.box3(w, 0, 0, 0, 4, 0, 4, BlockId.COBBLESTONE);
    this.timberWalls(w, 0, 0, 4, 4, 3);
    this.box3(w, 0, 4, 0, 4, 4, 4, BlockId.PLANKS);
    this.set(w, 0, 2, 2, BlockId.GLASS_PANE);
    this.set(w, 4, 2, 2, BlockId.GLASS_PANE);
    this.set(w, 2, 2, 4, BlockId.GLASS_PANE);
    this.doorAt(w, 2, 0);
    this.torch(w, 2, 3, -1, 0, 1);
  }
}

class Hut extends VillagePiece {
  readonly kind = 'hut';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 5, 6, 5, x, y, z, 2, 0);
    this.villagerSpots = [[1, 1, 2]];
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    this.box3(w, 0, 0, 0, 4, 0, 4, BlockId.COBBLESTONE);
    this.box3(w, 1, 0, 1, 3, 0, 3, BlockId.DIRT);
    this.timberWalls(w, 0, 0, 4, 4, 3);
    this.box3(w, 0, 4, 0, 4, 4, 4, BlockId.LOG);
    this.set(w, 0, 2, 2, BlockId.GLASS_PANE);
    this.set(w, 4, 2, 2, BlockId.GLASS_PANE);
    this.set(w, 3, 1, 3, BlockId.FENCE);
    this.set(w, 3, 2, 3, BlockId.WOODEN_PRESSURE_PLATE);
    this.doorAt(w, 2, 0);
  }
}

class Butcher extends VillagePiece {
  readonly kind = 'butcher';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 9, 7, 7, x, y, z, 4, 0);
    this.villagerSpots = [[2, 1, 3], [6, 1, 4]];
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    this.box3(w, 0, 0, 0, 8, 0, 6, BlockId.COBBLESTONE);
    this.timberWalls(w, 0, 0, 8, 6, 3);
    for (let y = 1; y <= 3; y++) { this.put(w, 4, y, 6, BlockId.LOG); }
    this.pitchedRoof(w, 0, 8, 0, 6, 4);
    for (const x of [2, 6]) { this.set(w, x, 2, 0, BlockId.GLASS_PANE); this.set(w, x, 2, 6, BlockId.GLASS_PANE); }
    this.set(w, 0, 2, 3, BlockId.GLASS_PANE);
    this.set(w, 8, 2, 3, BlockId.GLASS_PANE);
    // Table and chairs.
    this.set(w, 6, 1, 3, BlockId.FENCE);
    this.set(w, 6, 2, 3, BlockId.WOODEN_PRESSURE_PLATE);
    this.put(w, 5, 1, 3, BlockId.OAK_STAIRS, this.stairs(-1, 0));
    this.put(w, 7, 1, 3, BlockId.OAK_STAIRS, this.stairs(1, 0));
    this.box3(w, 1, 1, 5, 2, 1, 5, BlockId.SLAB, 0);
    this.doorAt(w, 4, 0);
    this.torch(w, 3, 3, -1, 0, 1);
    this.torch(w, 5, 3, -1, 0, 1);
  }
}

class Library extends VillagePiece {
  readonly kind = 'library';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 9, 8, 6, x, y, z, 4, 0);
    this.villagerSpots = [[4, 1, 3]];
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    this.box3(w, 0, 0, 0, 8, 0, 5, BlockId.COBBLESTONE);
    this.timberWalls(w, 0, 0, 8, 5, 4);
    this.pitchedRoof(w, 0, 8, 0, 5, 5);
    for (let x = 1; x <= 7; x++) { this.set(w, x, 1, 4, BlockId.BOOKSHELF); this.set(w, x, 2, 4, BlockId.BOOKSHELF); }
    for (const x of [2, 6]) { this.set(w, x, 2, 0, BlockId.GLASS_PANE); this.set(w, x, 3, 0, BlockId.GLASS_PANE); }
    this.set(w, 0, 3, 2, BlockId.GLASS_PANE);
    this.set(w, 8, 3, 2, BlockId.GLASS_PANE);
    this.set(w, 1, 1, 1, BlockId.CRAFTING_TABLE);
    this.set(w, 6, 1, 2, BlockId.FENCE);
    this.set(w, 6, 2, 2, BlockId.WOODEN_PRESSURE_PLATE);
    this.put(w, 5, 1, 2, BlockId.OAK_STAIRS, this.stairs(-1, 0));
    this.doorAt(w, 4, 0);
    this.torch(w, 4, 3, 1, 0, -1);
  }
}

class Blacksmith extends VillagePiece {
  readonly kind = 'blacksmith';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 10, 6, 7, x, y, z, 5, 0);
    this.villagerSpots = [[3, 1, 2]];
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    this.box3(w, 0, 0, 0, 9, 0, 6, BlockId.COBBLESTONE);
    this.fill(w, 0, 1, 0, 9, 3, 6, 0);
    // Back and side walls of the forge; the front is an open porch.
    this.box3(w, 0, 1, 6, 9, 3, 6, BlockId.COBBLESTONE);
    this.box3(w, 0, 1, 3, 0, 3, 6, BlockId.COBBLESTONE);
    this.box3(w, 9, 1, 3, 9, 3, 6, BlockId.COBBLESTONE);
    for (const [x, z] of [[0, 0], [9, 0], [0, 2], [9, 2], [4, 0]]) this.fill(w, x, 1, z, x, 3, z, BlockId.FENCE);
    this.box3(w, 0, 4, 0, 9, 4, 6, BlockId.SLAB, 0);
    // Lava hearth behind bars.
    this.box3(w, 6, 1, 3, 9, 1, 6, BlockId.COBBLESTONE);
    this.fill(w, 7, 1, 4, 8, 1, 5, BlockId.LAVA);
    this.fill(w, 6, 2, 3, 6, 2, 5, BlockId.IRON_BARS);
    this.fill(w, 7, 2, 3, 8, 2, 3, BlockId.IRON_BARS);
    this.set(w, 4, 1, 5, BlockId.FURNACE, this.front(0, -1));
    this.set(w, 5, 1, 5, BlockId.FURNACE, this.front(0, -1));
    this.chest(w, 1, 1, 5, 'village_blacksmith', 0, -1);
    this.torch(w, 2, 3, 5, 0, 1);
  }
}

class Church extends VillagePiece {
  readonly kind = 'church';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 5, 12, 9, x, y, z, 2, 0);
    this.villagerSpots = [[2, 1, 2]];
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    this.box3(w, 0, 0, 0, 4, 0, 8, BlockId.COBBLESTONE);
    // Nave.
    this.box3(w, 0, 1, 0, 4, 4, 4, BlockId.COBBLESTONE);
    this.fill(w, 1, 1, 1, 3, 4, 4, 0);
    this.box3(w, 0, 5, 0, 4, 5, 4, BlockId.COBBLESTONE);
    // Tower.
    this.box3(w, 0, 1, 4, 4, 11, 8, BlockId.COBBLESTONE);
    this.fill(w, 1, 1, 5, 3, 10, 7, 0);
    this.fill(w, 1, 1, 4, 3, 4, 4, 0);
    this.box3(w, 1, 5, 5, 3, 5, 7, BlockId.COBBLESTONE);
    this.set(w, 3, 5, 7, 0);
    for (let y = 1; y <= 10; y++) this.set(w, 3, y, 7, BlockId.LADDER, this.attach(0, 1));
    for (const y of [8, 9]) {
      this.set(w, 2, y, 4, BlockId.GLASS_PANE); this.set(w, 2, y, 8, BlockId.GLASS_PANE);
      this.set(w, 0, y, 6, BlockId.GLASS_PANE); this.set(w, 4, y, 6, BlockId.GLASS_PANE);
    }
    this.set(w, 0, 2, 2, BlockId.GLASS_PANE);
    this.set(w, 4, 2, 2, BlockId.GLASS_PANE);
    this.put(w, 2, 1, 5, BlockId.COBBLESTONE_STAIRS, this.stairs(0, 1));
    this.doorAt(w, 2, 0);
    this.torch(w, 1, 3, 3, -1, 0);
    this.torch(w, 3, 3, 3, 1, 0);
    this.torch(w, 2, 7, 6, 0, 1);
  }
}

class Farm extends VillagePiece {
  readonly kind = 'farm';
  constructor(seed: number, f: number, x: number, y: number, z: number, readonly large: boolean) {
    super(seed, f, large ? 13 : 7, 4, 9, x, y, z, large ? 6 : 3, 0);
  }

  build(w: ChunkWriter): void {
    this.prepare(w);
    for (let x = 0; x < this.w; x++) {
      for (let z = 0; z < this.d; z++) {
        const border = x === 0 || x === this.w - 1 || z === 0 || z === this.d - 1 || x % 6 === 0;
        if (border) { this.put(w, x, 0, z, BlockId.LOG); continue; }
        if (x % 6 === 3) { this.set(w, x, 0, z, BlockId.WATER); continue; }
        this.set(w, x, 0, z, BlockId.FARMLAND, 7);
        const stage = 2 + Math.floor(this.rnd(x, 1, z, 11) * 6);
        this.set(w, x, 1, z, BlockId.WHEAT_CROP, stage);
      }
    }
  }
}

class LampPost extends VillagePiece {
  readonly kind = 'lamp';
  constructor(seed: number, f: number, x: number, y: number, z: number) {
    super(seed, f, 3, 5, 3, x, y, z, 1, 0);
  }

  build(w: ChunkWriter): void {
    this.fill(w, 1, 1, 1, 1, 3, 1, BlockId.FENCE);
    this.set(w, 1, 0, 1, ...this.m(BlockId.COBBLESTONE));
    this.set(w, 1, 4, 1, BlockId.WOOL, DyeColor.BLACK);
    this.torch(w, 0, 4, 1, 1, 0);
    this.torch(w, 2, 4, 1, -1, 0);
    this.torch(w, 1, 4, 0, 0, 1);
    this.torch(w, 1, 4, 2, 0, -1);
  }
}

// ---------------------------------------------------------------------------

interface Kind { name: string; weight: number; limit: number }
const KINDS: Kind[] = [
  { name: 'house', weight: 20, limit: 6 },
  { name: 'hut', weight: 14, limit: 5 },
  { name: 'butcher', weight: 10, limit: 2 },
  { name: 'library', weight: 10, limit: 2 },
  { name: 'blacksmith', weight: 10, limit: 1 },
  { name: 'church', weight: 10, limit: 1 },
  { name: 'farm', weight: 12, limit: 4 },
  { name: 'largefarm', weight: 8, limit: 2 },
  { name: 'lamp', weight: 10, limit: 6 },
];

export class Village {
  readonly pieces: VillagePiece[] = [];
  readonly box: BBox;
  private counts = new Map<string, number>();

  constructor(readonly seed: number, readonly x: number, readonly z: number, readonly desert: boolean, private readonly ground: Ground) {
    const r = new Random(hashCombine(seed, x, z, 0x71a6e));
    const well = new Well(seed, x, 0, z - 3);
    this.place(well);
    const gy = well.box.y0;
    const roads: [number, number, number, number][] = [
      [x, z - 4, 2, 0], [x, z + 3, 0, 0], [x + 3, z, 3, 0], [x - 4, z, 1, 0],
    ];
    for (const [rx, rz, f] of roads) this.road(r, f, rx, gy, rz, 0);
    this.box = unionBox(this.pieces.map((p) => p.box));
  }

  private place(p: VillagePiece): boolean {
    p.desert = this.desert;
    // Floor height from the undisturbed terrain surface under the footprint.
    const b = p.box;
    const pts: [number, number][] = [[b.x0, b.z0], [b.x1, b.z0], [b.x0, b.z1], [b.x1, b.z1], [(b.x0 + b.x1) >> 1, (b.z0 + b.z1) >> 1]];
    let sum = 0; let lo = Infinity;
    for (const [px, pz] of pts) { const g = this.ground(px, pz); sum += g; lo = Math.min(lo, g); }
    const y = Math.round(sum / pts.length);
    if (p.kind !== 'road' && (y < SEA_LEVEL || lo < SEA_LEVEL - 2)) return false;
    p.setGround(y);
    if (collides(this.pieces, p.box)) return false;
    this.pieces.push(p);
    return true;
  }

  private road(r: Random, facing: number, x: number, y: number, z: number, depth: number): void {
    let road: Road | null = null;
    for (let len = 13 + r.int(20); len >= 7; len -= 6) {
      const cand = new Road(this.seed, facing, x, y, z, len);
      cand.desert = this.desert;
      if (!collides(this.pieces, cand.box)) { road = cand; break; }
    }
    if (!road) return;
    this.pieces.push(road);
    // Buildings on both sides.
    for (const side of ['left', 'right'] as const) {
      let lz = 1 + r.int(2);
      while (lz < road.d - 2) {
        const kind = this.pickKind(r);
        const b = kind ? this.make(kind, 0, 0, 0, 0) : null;
        const width = b ? b.w : 5;
        const half = b ? (b.w - 1) >> 1 : 2;
        if (kind && r.int(10) < 8) {
          const at = road.exit(side === 'left' ? -1 : 3, 0, lz + half, side);
          const p = this.make(kind, at.facing, at.x, 0, at.z);
          if (this.place(p)) this.counts.set(kind, (this.counts.get(kind) ?? 0) + 1);
        }
        lz += width + 1 + r.int(2);
      }
    }
    if (depth >= 3) return;
    if (r.int(3) !== 0) {
      const at = road.exit(1, 0, road.d, 'forward');
      this.road(r, at.facing, at.x, y, at.z, depth + 1);
    }
    if (r.int(3) === 0) {
      const at = road.exit(-1, 0, road.d - 2, 'left');
      this.road(r, at.facing, at.x, y, at.z, depth + 1);
    }
    if (r.int(3) === 0) {
      const at = road.exit(3, 0, road.d - 2, 'right');
      this.road(r, at.facing, at.x, y, at.z, depth + 1);
    }
  }

  private pickKind(r: Random): string | null {
    const avail = KINDS.filter((k) => (this.counts.get(k.name) ?? 0) < k.limit);
    const total = avail.reduce((s, k) => s + k.weight, 0);
    if (total <= 0) return null;
    let n = r.int(total);
    for (const k of avail) { n -= k.weight; if (n < 0) return k.name; }
    return null;
  }

  private make(kind: string, f: number, x: number, y: number, z: number): VillagePiece {
    const s = this.seed;
    switch (kind) {
      case 'hut': return new Hut(s, f, x, y, z);
      case 'butcher': return new Butcher(s, f, x, y, z);
      case 'library': return new Library(s, f, x, y, z);
      case 'blacksmith': return new Blacksmith(s, f, x, y, z);
      case 'church': return new Church(s, f, x, y, z);
      case 'farm': return new Farm(s, f, x, y, z, false);
      case 'largefarm': return new Farm(s, f, x, y, z, true);
      case 'lamp': return new LampPost(s, f, x, y, z);
      default: return new SmallHouse(s, f, x, y, z);
    }
  }

  /** World positions of villagers belonging to buildings inside the chunk. */
  villagersIn(cx: number, cz: number): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (const p of this.pieces) {
      for (const [lx, ly, lz] of p.villagerSpots) {
        const x = p.wx(lx, lz); const z = p.wz(lx, lz);
        if (x >> 4 === cx && z >> 4 === cz) out.push([x, p.wy(ly), z]);
      }
    }
    return out;
  }

  /** Is the column occupied by a village building or road (plus a margin)? */
  occupies(x: number, z: number, margin = 2): boolean {
    for (const p of this.pieces) {
      const b = p.box;
      if (boxContains({ x0: b.x0 - margin, y0: 0, z0: b.z0 - margin, x1: b.x1 + margin, y1: 127, z1: b.z1 + margin }, x, 64, z)) return true;
    }
    return false;
  }
}

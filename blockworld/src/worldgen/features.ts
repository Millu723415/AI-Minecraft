/**
 * Population features: ores, trees, plants, lakes, dungeons, springs, snow.
 * Each feature gets its own seeded RNG so that one feature failing (for
 * example because the player changed the ground) does not shift the random
 * sequence of every later feature.
 */

import { BlockId, WoodType } from '../blocks/ids';
import { Random, hashCombine } from '../core/rng';
import type { PopulateAccess } from '../world/generator';
import { Biome, biomeDef } from './biomes';

export type FeatureAccess = PopulateAccess & {
  scheduleFluid?: (x: number, y: number, z: number) => void;
  /** Columns where trees must not grow (village buildings). */
  noTrees?: (x: number, z: number) => boolean;
};

const isAirOrPlant = (id: number) =>
  id === 0 || id === BlockId.TALL_GRASS || id === BlockId.DANDELION || id === BlockId.ROSE ||
  id === BlockId.SNOW_LAYER || id === BlockId.DEAD_BUSH || id === BlockId.SAPLING;
const isSoil = (id: number) => id === BlockId.GRASS || id === BlockId.DIRT || id === BlockId.FARMLAND;

// ---------------------------------------------------------------------------
// Ores
// ---------------------------------------------------------------------------
/** Classic "minable" vein: a line of spheres between two random points. */
export function oreVein(a: FeatureAccess, r: Random, x: number, y: number, z: number, ore: number, size: number, replace = BlockId.STONE): void {
  const angle = r.next() * Math.PI;
  const x1 = x + 8 + (Math.sin(angle) * size) / 8;
  const x2 = x + 8 - (Math.sin(angle) * size) / 8;
  const z1 = z + 8 + (Math.cos(angle) * size) / 8;
  const z2 = z + 8 - (Math.cos(angle) * size) / 8;
  const y1 = y + r.int(3) - 2;
  const y2 = y + r.int(3) - 2;
  for (let i = 0; i <= size; i++) {
    const cx = x1 + ((x2 - x1) * i) / size;
    const cy = y1 + ((y2 - y1) * i) / size;
    const cz = z1 + ((z2 - z1) * i) / size;
    const s = (r.next() * size) / 16;
    const rad = ((Math.sin((i * Math.PI) / size) + 1) * s + 1) / 2;
    const ax = Math.floor(cx - rad); const bx = Math.floor(cx + rad);
    const ay = Math.floor(cy - rad); const by = Math.floor(cy + rad);
    const az = Math.floor(cz - rad); const bz = Math.floor(cz + rad);
    for (let px = ax; px <= bx; px++) {
      const dx = (px + 0.5 - cx) / rad;
      if (dx * dx >= 1) continue;
      for (let py = ay; py <= by; py++) {
        const dy = (py + 0.5 - cy) / rad;
        if (dx * dx + dy * dy >= 1) continue;
        for (let pz = az; pz <= bz; pz++) {
          const dz = (pz + 0.5 - cz) / rad;
          if (dx * dx + dy * dy + dz * dz < 1 && a.getBlock(px, py, pz) === replace) a.setBlock(px, py, pz, ore);
        }
      }
    }
  }
}

export function placeOres(a: FeatureAccess, seed: number, cx: number, cz: number): void {
  const bx = cx * 16;
  const bz = cz * 16;
  const specs: [number, number, number, number, number][] = [
    // block, veins, size, minY, maxY
    [BlockId.DIRT, 20, 32, 0, 128],
    [BlockId.GRAVEL, 10, 32, 0, 128],
    [BlockId.COAL_ORE, 20, 16, 0, 128],
    [BlockId.IRON_ORE, 20, 8, 0, 64],
    [BlockId.GOLD_ORE, 2, 8, 0, 32],
    [BlockId.REDSTONE_ORE, 8, 7, 0, 16],
    [BlockId.DIAMOND_ORE, 1, 7, 0, 16],
  ];
  specs.forEach(([ore, veins, size, minY, maxY], k) => {
    const r = new Random(hashCombine(seed, cx, cz, 0x0e0 + k));
    for (let i = 0; i < veins; i++) {
      oreVein(a, r, bx + r.int(16), minY + r.int(maxY - minY), bz + r.int(16), ore, size);
    }
  });
  // Lapis: triangular distribution centred on y=16.
  const r = new Random(hashCombine(seed, cx, cz, 0x1a9));
  oreVein(a, r, bx + r.int(16), r.int(16) + r.int(16), bz + r.int(16), BlockId.LAPIS_ORE, 6);
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------
function canGrowAt(a: FeatureAccess, x: number, y: number, z: number, height: number, radius: number): boolean {
  if (y < 1 || y + height + 1 > 127) return false;
  if (!isSoil(a.getBlock(x, y - 1, z))) return false;
  for (let yy = y; yy <= y + height + 1; yy++) {
    const rad = yy === y ? 0 : yy >= y + height - 1 ? radius : 1;
    for (let xx = x - rad; xx <= x + rad; xx++) {
      for (let zz = z - rad; zz <= z + rad; zz++) {
        const id = a.getBlock(xx, yy, zz);
        if (!(id === 0 || id === BlockId.LEAVES || isAirOrPlant(id))) return false;
      }
    }
  }
  return true;
}

function leaf(a: FeatureAccess, x: number, y: number, z: number, type: number): void {
  const cur = a.getBlock(x, y, z);
  if (cur === 0 || isAirOrPlant(cur)) a.setBlock(x, y, z, BlockId.LEAVES, type);
}

export function smallTree(a: FeatureAccess, r: Random, x: number, y: number, z: number, type: number): boolean {
  const height = r.int(3) + (type === WoodType.BIRCH ? 5 : 4);
  if (!canGrowAt(a, x, y, z, height, 2)) return false;
  a.setBlock(x, y - 1, z, BlockId.DIRT);
  for (let yy = y + height - 3; yy <= y + height; yy++) {
    const d = yy - (y + height);
    const rad = 1 - Math.floor(d / 2);
    for (let xx = x - rad; xx <= x + rad; xx++) {
      for (let zz = z - rad; zz <= z + rad; zz++) {
        const corner = Math.abs(xx - x) === rad && Math.abs(zz - z) === rad;
        if (corner && (r.int(2) === 0 || d === 0)) continue;
        leaf(a, xx, yy, zz, type);
      }
    }
  }
  for (let i = 0; i < height; i++) a.setBlock(x, y + i, z, BlockId.LOG, type);
  return true;
}

export function spruceTree(a: FeatureAccess, r: Random, x: number, y: number, z: number): boolean {
  const height = r.int(4) + 6;
  const bare = 1 + r.int(2);
  const maxRad = 2 + r.int(2);
  if (!canGrowAt(a, x, y, z, height, maxRad)) return false;
  a.setBlock(x, y - 1, z, BlockId.DIRT);
  let rad = r.int(2);
  let grow = 1;
  let start = 0;
  for (let i = 0; i <= height - bare; i++) {
    const yy = y + height - i;
    for (let xx = x - rad; xx <= x + rad; xx++) {
      for (let zz = z - rad; zz <= z + rad; zz++) {
        if (Math.abs(xx - x) === rad && Math.abs(zz - z) === rad && rad > 0) continue;
        leaf(a, xx, yy, zz, WoodType.SPRUCE);
      }
    }
    if (rad >= grow) {
      rad = start;
      start = 1;
      grow = Math.min(grow + 1, maxRad);
    } else {
      rad++;
    }
  }
  for (let i = 0; i < height - 1; i++) a.setBlock(x, y + i, z, BlockId.LOG, WoodType.SPRUCE);
  leaf(a, x, y + height, z, WoodType.SPRUCE);
  return true;
}

/** Tall "pine" variant: leaves only near the top. */
export function pineTree(a: FeatureAccess, r: Random, x: number, y: number, z: number): boolean {
  const height = r.int(5) + 7;
  if (!canGrowAt(a, x, y, z, height, 2)) return false;
  a.setBlock(x, y - 1, z, BlockId.DIRT);
  const crown = 3 + r.int(2);
  for (let i = 0; i < crown; i++) {
    const yy = y + height - i;
    const rad = i === 0 ? 0 : i === 1 ? 1 : 2 - (i % 2);
    for (let xx = x - rad; xx <= x + rad; xx++) {
      for (let zz = z - rad; zz <= z + rad; zz++) {
        if (Math.abs(xx - x) === rad && Math.abs(zz - z) === rad && rad > 0) continue;
        leaf(a, xx, yy, zz, WoodType.SPRUCE);
      }
    }
  }
  for (let i = 0; i < height; i++) a.setBlock(x, y + i, z, BlockId.LOG, WoodType.SPRUCE);
  return true;
}

/** The rare large oak with a tall trunk and several leaf clusters. */
export function bigOak(a: FeatureAccess, r: Random, x: number, y: number, z: number): boolean {
  const height = 8 + r.int(6);
  if (!canGrowAt(a, x, y, z, Math.min(height, 6), 1)) return false;
  a.setBlock(x, y - 1, z, BlockId.DIRT);
  const clusters: [number, number, number][] = [[x, y + height, z]];
  for (let i = 0; i < 4; i++) {
    const cy = y + height - 2 - r.int(4);
    const ang = r.next() * Math.PI * 2;
    const dist = 2 + r.int(3);
    clusters.push([x + Math.round(Math.cos(ang) * dist), cy, z + Math.round(Math.sin(ang) * dist)]);
  }
  for (const [lx, ly, lz] of clusters) {
    for (let dy = 0; dy < 4; dy++) {
      const rad = dy === 0 || dy === 3 ? 1.8 : 2.8;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        if (dx * dx + dz * dz <= rad * rad) leaf(a, lx + dx, ly + dy - 1, lz + dz, WoodType.OAK);
      }
    }
    // Branch from trunk to cluster.
    const steps = Math.max(Math.abs(lx - x), Math.abs(lz - z));
    for (let s = 0; s <= steps; s++) {
      const bx = Math.round(x + ((lx - x) * s) / Math.max(1, steps));
      const bz = Math.round(z + ((lz - z) * s) / Math.max(1, steps));
      const by = Math.round(ly - 1 - (steps - s) * 0.5);
      if (by > y + 2) a.setBlock(bx, by, bz, BlockId.LOG, WoodType.OAK);
    }
  }
  for (let i = 0; i < height; i++) a.setBlock(x, y + i, z, BlockId.LOG, WoodType.OAK);
  return true;
}

export function hugeMushroom(a: FeatureAccess, r: Random, x: number, y: number, z: number, red: boolean): boolean {
  const height = r.int(3) + 4;
  const below = a.getBlock(x, y - 1, z);
  if (below !== BlockId.MYCELIUM && below !== BlockId.GRASS && below !== BlockId.DIRT) return false;
  for (let yy = y; yy < y + height + 2; yy++) if (a.getBlock(x, yy, z) !== 0 && !isAirOrPlant(a.getBlock(x, yy, z))) return false;
  const id = red ? BlockId.RED_MUSHROOM_BLOCK : BlockId.BROWN_MUSHROOM_BLOCK;
  if (red) {
    for (let yy = y + height - 3; yy <= y + height; yy++) {
      const rad = yy < y + height ? 2 : 1;
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        const edge = Math.abs(dx) === rad || Math.abs(dz) === rad;
        if (yy < y + height && !edge) continue;
        if (Math.abs(dx) === rad && Math.abs(dz) === rad) continue;
        a.setBlock(x + dx, yy, z + dz, id, 0);
      }
    }
  } else {
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
      if (Math.abs(dx) === 3 && Math.abs(dz) === 3) continue;
      a.setBlock(x + dx, y + height, z + dz, id, 0);
    }
  }
  for (let i = 0; i < height; i++) a.setBlock(x, y + i, z, id, 1);
  return true;
}

// ---------------------------------------------------------------------------
// Water/lava lakes, dungeons, springs
// ---------------------------------------------------------------------------
export function lake(a: FeatureAccess, r: Random, x0: number, y0: number, z0: number, liquid: number): boolean {
  // Build a blob mask 16x8x16 from a few ellipsoids.
  const mask = new Uint8Array(16 * 16 * 8);
  const blobs = r.int(4) + 4;
  for (let i = 0; i < blobs; i++) {
    const sx = r.next() * 6 + 3; const sy = r.next() * 4 + 2; const sz = r.next() * 6 + 3;
    const cx = r.next() * (16 - sx - 2) + 1 + sx / 2;
    const cy = r.next() * (8 - sy - 4) + 2 + sy / 2;
    const cz = r.next() * (16 - sz - 2) + 1 + sz / 2;
    for (let x = 1; x < 15; x++) for (let z = 1; z < 15; z++) for (let y = 1; y < 7; y++) {
      const dx = (x - cx) / (sx / 2); const dy = (y - cy) / (sy / 2); const dz = (z - cz) / (sz / 2);
      if (dx * dx + dy * dy + dz * dz < 1) mask[(x * 16 + z) * 8 + y] = 1;
    }
  }
  const m = (x: number, y: number, z: number) => (x >= 0 && x < 16 && z >= 0 && z < 16 && y >= 0 && y < 8 ? mask[(x * 16 + z) * 8 + y] : 0);
  // Reject if the border would leak or if there is water/lava nearby.
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
    const border = !m(x, y, z) && (m(x + 1, y, z) || m(x - 1, y, z) || m(x, y + 1, z) || m(x, y - 1, z) || m(x, y, z + 1) || m(x, y, z - 1));
    if (!border) continue;
    const id = a.getBlock(x0 + x, y0 + y, z0 + z);
    if (y >= 4 && (id === BlockId.WATER || id === BlockId.LAVA)) return false;
    if (y < 4 && id === 0) return false;
  }
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
    if (m(x, y, z)) a.setBlock(x0 + x, y0 + y, z0 + z, y >= 4 ? 0 : liquid);
  }
  for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 4; y < 8; y++) {
    if (m(x, y, z) && a.getBlock(x0 + x, y0 + y - 1, z0 + z) === BlockId.DIRT && a.topY(x0 + x, z0 + z) <= y0 + y) {
      a.setBlock(x0 + x, y0 + y - 1, z0 + z, BlockId.GRASS);
    }
  }
  if (liquid === BlockId.LAVA) {
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 8; y++) {
      const border = !m(x, y, z) && (m(x + 1, y, z) || m(x - 1, y, z) || m(x, y - 1, z) || m(x, y, z + 1) || m(x, y, z - 1));
      if (border && y < 4 && r.int(2) === 0) {
        const id = a.getBlock(x0 + x, y0 + y, z0 + z);
        if (id !== 0 && id !== BlockId.LAVA) a.setBlock(x0 + x, y0 + y, z0 + z, BlockId.STONE);
      }
    }
  }
  return true;
}

const DUNGEON_MOBS = ['skeleton', 'zombie', 'zombie', 'spider'];

export function dungeon(a: FeatureAccess, r: Random, x: number, y: number, z: number, seed: number): boolean {
  const rx = r.int(2) + 2;
  const rz = r.int(2) + 2;
  let openings = 0;
  for (let dx = -rx - 1; dx <= rx + 1; dx++) {
    for (let dz = -rz - 1; dz <= rz + 1; dz++) {
      for (let dy = -1; dy <= 4; dy++) {
        const id = a.getBlock(x + dx, y + dy, z + dz);
        const solid = id !== 0 && id !== BlockId.WATER && id !== BlockId.LAVA;
        if (dy === -1 && !solid) return false;
        if (dy === 4 && !solid) return false;
        const wall = dx === -rx - 1 || dx === rx + 1 || dz === -rz - 1 || dz === rz + 1;
        if (wall && dy === 0 && id === 0 && a.getBlock(x + dx, y + 1, z + dz) === 0) openings++;
      }
    }
  }
  if (openings < 1 || openings > 5) return false;
  for (let dx = -rx - 1; dx <= rx + 1; dx++) {
    for (let dz = -rz - 1; dz <= rz + 1; dz++) {
      for (let dy = 3; dy >= -1; dy--) {
        const px = x + dx; const py = y + dy; const pz = z + dz;
        const wall = dx === -rx - 1 || dx === rx + 1 || dz === -rz - 1 || dz === rz + 1 || dy === -1 || dy === 4;
        if (!wall) a.setBlock(px, py, pz, 0);
        else if (dy >= 0 && a.getBlock(px, py - 1, pz) !== 0 || dy === -1) {
          if (a.getBlock(px, py, pz) !== 0 || dy === -1) {
            a.setBlock(px, py, pz, dy === -1 && r.int(4) !== 0 ? BlockId.MOSSY_COBBLESTONE : BlockId.COBBLESTONE);
          }
        }
      }
    }
  }
  // Two chests against walls.
  for (let c = 0; c < 2; c++) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const cx = x + r.int(rx * 2 + 1) - rx;
      const cz = z + r.int(rz * 2 + 1) - rz;
      if (a.getBlock(cx, y, cz) !== 0) continue;
      let walls = 0;
      for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const id = a.getBlock(cx + ox, y, cz + oz);
        if (id === BlockId.COBBLESTONE || id === BlockId.MOSSY_COBBLESTONE) walls++;
      }
      if (walls !== 1) continue;
      a.setBlock(cx, y, cz, BlockId.CHEST, 0);
      a.addTile({ kind: 'chest', x: cx, y, z: cz, loot: 'dungeon', lootSeed: hashCombine(seed, cx, y, cz) });
      break;
    }
  }
  a.setBlock(x, y, z, BlockId.SPAWNER);
  a.addTile({ kind: 'spawner', x, y, z, mob: DUNGEON_MOBS[r.int(DUNGEON_MOBS.length)], delay: 200 });
  return true;
}

// ---------------------------------------------------------------------------
// Surface decoration
// ---------------------------------------------------------------------------
function surfaceY(a: FeatureAccess, x: number, z: number): number {
  return a.topY(x, z) + 1;
}

export function decorateSurface(a: FeatureAccess, seed: number, cx: number, cz: number): void {
  const ox = cx * 16 + 8;
  const oz = cz * 16 + 8;
  const biome = biomeDef(a.biomeAt(ox + 8, oz + 8));
  const bid = biome.id;

  // Trees.
  {
    const r = new Random(hashCombine(seed, cx, cz, 0x7ee));
    let count = Math.floor(biome.trees) + (r.next() < biome.trees % 1 ? 1 : 0);
    if (r.int(10) === 0 && bid !== Biome.DESERT && bid !== Biome.OCEAN) count++;
    if (bid === Biome.DESERT || bid === Biome.OCEAN || bid === Biome.FROZEN_OCEAN || bid === Biome.RIVER || bid === Biome.FROZEN_RIVER || bid === Biome.MUSHROOM_ISLAND) count = 0;
    for (let i = 0; i < count; i++) {
      const x = ox + r.int(16);
      const z = oz + r.int(16);
      if (a.noTrees?.(x, z)) continue;
      const y = surfaceY(a, x, z);
      const tb = biomeDef(a.biomeAt(x, z)).id;
      if (tb === Biome.TAIGA || tb === Biome.ICE_PLAINS || tb === Biome.ICE_MOUNTAINS) {
        if (r.int(3) === 0) pineTree(a, r, x, y, z); else spruceTree(a, r, x, y, z);
      } else if (tb === Biome.FOREST && r.int(5) === 0) {
        smallTree(a, r, x, y, z, WoodType.BIRCH);
      } else if (r.int(10) === 0 && tb !== Biome.SWAMPLAND) {
        bigOak(a, r, x, y, z);
      } else {
        smallTree(a, r, x, y, z, WoodType.OAK);
      }
    }
  }

  // Huge mushrooms on mushroom islands.
  if (bid === Biome.MUSHROOM_ISLAND) {
    const r = new Random(hashCombine(seed, cx, cz, 0x5ab));
    for (let i = 0; i < 1 + r.int(2); i++) {
      const x = ox + r.int(16);
      const z = oz + r.int(16);
      hugeMushroom(a, r, x, surfaceY(a, x, z), z, r.int(2) === 0);
    }
  }

  // Flowers, tall grass, dead bushes.
  {
    const r = new Random(hashCombine(seed, cx, cz, 0xf10));
    for (let i = 0; i < biome.flowers; i++) {
      const x = ox + r.int(16); const z = oz + r.int(16);
      const type = r.int(4) === 0 ? BlockId.ROSE : BlockId.DANDELION;
      scatter(a, r, x, z, 8, (px, py, pz) => {
        if (a.getBlock(px, py, pz) === 0 && a.getBlock(px, py - 1, pz) === BlockId.GRASS) a.setBlock(px, py, pz, type);
      });
    }
    for (let i = 0; i < biome.grassTufts; i++) {
      const x = ox + r.int(16); const z = oz + r.int(16);
      const fern = (bid === Biome.TAIGA) && r.int(3) === 0;
      scatter(a, r, x, z, 16, (px, py, pz) => {
        if (a.getBlock(px, py, pz) === 0 && a.getBlock(px, py - 1, pz) === BlockId.GRASS) a.setBlock(px, py, pz, BlockId.TALL_GRASS, fern ? 2 : 1);
      });
    }
    if (bid === Biome.DESERT) {
      for (let i = 0; i < 2; i++) {
        const x = ox + r.int(16); const z = oz + r.int(16);
        scatter(a, r, x, z, 4, (px, py, pz) => {
          if (a.getBlock(px, py, pz) === 0 && a.getBlock(px, py - 1, pz) === BlockId.SAND) a.setBlock(px, py, pz, BlockId.DEAD_BUSH);
        });
      }
      // Cacti.
      for (let i = 0; i < 10; i++) {
        const x = ox + r.int(16); const z = oz + r.int(16);
        const y = surfaceY(a, x, z);
        if (a.getBlock(x, y - 1, z) !== BlockId.SAND) continue;
        let ok = true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (a.getBlock(x + dx, y, z + dz) !== 0) ok = false;
        if (!ok) continue;
        const h = 1 + r.int(r.int(3) + 1);
        for (let k = 0; k < h; k++) a.setBlock(x, y + k, z, BlockId.CACTUS);
      }
    }
    if (bid === Biome.SWAMPLAND) {
      for (let i = 0; i < 4; i++) {
        const x = ox + r.int(16); const z = oz + r.int(16);
        const y = surfaceY(a, x, z);
        if (a.getBlock(x, y - 1, z) === BlockId.WATER && a.getBlock(x, y, z) === 0) a.setBlock(x, y, z, BlockId.LILY_PAD);
      }
    }
  }

  // Mushrooms (dark-ish spots) - rare on the surface.
  {
    const r = new Random(hashCombine(seed, cx, cz, 0x3a5));
    const tries = bid === Biome.MUSHROOM_ISLAND ? 3 : bid === Biome.SWAMPLAND ? 2 : 0;
    for (let i = 0; i < tries + (r.int(4) === 0 ? 1 : 0); i++) {
      const x = ox + r.int(16); const z = oz + r.int(16);
      const type = r.int(2) === 0 ? BlockId.BROWN_MUSHROOM : BlockId.RED_MUSHROOM;
      scatter(a, r, x, z, 4, (px, py, pz) => {
        const below = a.getBlock(px, py - 1, pz);
        if (a.getBlock(px, py, pz) === 0 && (below === BlockId.GRASS || below === BlockId.MYCELIUM)) a.setBlock(px, py, pz, type);
      });
    }
  }

  // Sugar cane next to water.
  {
    const r = new Random(hashCombine(seed, cx, cz, 0x5c4));
    for (let i = 0; i < 10; i++) {
      const x = ox + r.int(16); const z = oz + r.int(16);
      const y = surfaceY(a, x, z);
      const ground = a.getBlock(x, y - 1, z);
      if ((ground !== BlockId.GRASS && ground !== BlockId.SAND && ground !== BlockId.DIRT) || a.getBlock(x, y, z) !== 0) continue;
      let water = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (a.getBlock(x + dx, y - 1, z + dz) === BlockId.WATER) water = true;
      if (!water) continue;
      const h = 2 + r.int(r.int(3) + 1);
      for (let k = 0; k < h; k++) a.setBlock(x, y + k, z, BlockId.SUGAR_CANE);
    }
  }

  // Pumpkins (rare patches).
  {
    const r = new Random(hashCombine(seed, cx, cz, 0x9b3));
    if (r.int(32) === 0) {
      const x = ox + r.int(16); const z = oz + r.int(16);
      scatter(a, r, x, z, 12, (px, py, pz) => {
        if (a.getBlock(px, py, pz) === 0 && a.getBlock(px, py - 1, pz) === BlockId.GRASS) a.setBlock(px, py, pz, BlockId.PUMPKIN, r.int(4));
      });
    }
  }

  // Clay under shallow water.
  {
    const r = new Random(hashCombine(seed, cx, cz, 0xc1a));
    for (let i = 0; i < 1; i++) {
      const x = ox + r.int(16); const z = oz + r.int(16);
      const y = surfaceY(a, x, z);
      if (a.getBlock(x, y - 1, z) !== BlockId.WATER) continue;
      const rad = 2 + r.int(2);
      for (let dx = -rad; dx <= rad; dx++) for (let dz = -rad; dz <= rad; dz++) {
        if (dx * dx + dz * dz > rad * rad) continue;
        for (let dy = -3; dy <= 0; dy++) {
          const id = a.getBlock(x + dx, y - 2 + dy, z + dz);
          if (id === BlockId.DIRT || id === BlockId.SAND || id === BlockId.GRAVEL) a.setBlock(x + dx, y - 2 + dy, z + dz, BlockId.CLAY);
        }
      }
    }
  }
}

function scatter(a: FeatureAccess, r: Random, x: number, z: number, count: number, place: (x: number, y: number, z: number) => void): void {
  for (let i = 0; i < count; i++) {
    const px = x + r.int(8) - r.int(8);
    const pz = z + r.int(8) - r.int(8);
    const py = a.topY(px, pz) + 1;
    if (py > 0) place(px, py, pz);
  }
}

/** Snow layers on the ground and ice on still water in cold biomes. */
export function snowAndIce(a: FeatureAccess, cx: number, cz: number): void {
  const ox = cx * 16 + 8;
  const oz = cz * 16 + 8;
  for (let x = ox; x < ox + 16; x++) {
    for (let z = oz; z < oz + 16; z++) {
      const b = biomeDef(a.biomeAt(x, z));
      if (!b.snowy) continue;
      const top = a.topY(x, z);
      if (top < 0) continue;
      const id = a.getBlock(x, top, z);
      if (id === BlockId.WATER && b.freezes) a.setBlock(x, top, z, BlockId.ICE);
      else if (id !== BlockId.WATER && id !== BlockId.ICE && id !== BlockId.LAVA && id !== BlockId.SNOW_LAYER && top < 127) {
        const solidTop = id === BlockId.GRASS || id === BlockId.DIRT || id === BlockId.STONE || id === BlockId.LEAVES ||
          id === BlockId.SAND || id === BlockId.GRAVEL || id === BlockId.LOG || id === BlockId.COBBLESTONE || id === BlockId.PLANKS;
        if (solidTop) a.setBlock(x, top + 1, z, BlockId.SNOW_LAYER);
      }
    }
  }
}

export function springs(a: FeatureAccess, seed: number, cx: number, cz: number): void {
  const r = new Random(hashCombine(seed, cx, cz, 0x5b1));
  const tryPlace = (x: number, y: number, z: number, liquid: number) => {
    if (a.getBlock(x, y, z) !== BlockId.STONE) return;
    if (a.getBlock(x, y + 1, z) !== BlockId.STONE || a.getBlock(x, y - 1, z) !== BlockId.STONE) return;
    let stone = 0; let air = 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const id = a.getBlock(x + dx, y, z + dz);
      if (id === BlockId.STONE) stone++; else if (id === 0) air++;
    }
    if (stone === 3 && air === 1) {
      a.setBlock(x, y, z, liquid);
      a.scheduleFluid?.(x, y, z);
    }
  };
  for (let i = 0; i < 50; i++) tryPlace(cx * 16 + 8 + r.int(16), r.int(r.int(120) + 8), cz * 16 + 8 + r.int(16), BlockId.WATER);
  for (let i = 0; i < 20; i++) tryPlace(cx * 16 + 8 + r.int(16), r.int(r.int(r.int(112) + 8) + 8), cz * 16 + 8 + r.int(16), BlockId.LAVA);
}

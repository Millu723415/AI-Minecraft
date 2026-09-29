/**
 * The Nether: a 128-block-tall cavern of netherrack between bedrock floor
 * and ceiling, a lava sea at y 31, soul sand and gravel shores, glowstone
 * hanging from the ceiling, scattered fires and nether-brick fortresses.
 */

import { BlockId } from '../blocks/ids';
import { OctaveNoise } from '../core/noise';
import { Random, hashCombine } from '../core/rng';
import { clamp } from '../core/math';
import { WORLD_HEIGHT, blockIndex } from '../world/constants';
import type { DimensionGenerator, GeneratedChunk, PopulateAccess } from '../world/generator';
import { Biome } from './biomes';
import { carveCaves } from './carvers';
import { ChunkWriter } from './chunkwriter';
import type { FeatureAccess } from './features';
import { Fortress } from './structures/fortress';
import { bbox, boxesIntersect, rasterizePieces } from './structures/piece';

export const NETHER_LAVA_LEVEL = 31;
const FORTRESS_REGION = 12; // chunks

export class NetherGenerator implements DimensionGenerator {
  readonly generatorVersion = 1;
  private readonly densN: OctaveNoise;
  private readonly detailN: OctaveNoise;
  private readonly shapeN: OctaveNoise;
  private readonly soulN: OctaveNoise;
  private readonly gravelN: OctaveNoise;
  private fortresses = new Map<string, Fortress>();

  constructor(readonly seed: number) {
    this.densN = new OctaveNoise(hashCombine(seed, 0x4e1), 4);
    this.detailN = new OctaveNoise(hashCombine(seed, 0x4e2), 3);
    this.shapeN = new OctaveNoise(hashCombine(seed, 0x4e3), 2);
    this.soulN = new OctaveNoise(hashCombine(seed, 0x4e4), 3);
    this.gravelN = new OctaveNoise(hashCombine(seed, 0x4e5), 3);
  }

  /** Terrain density; positive is solid. */
  density(x: number, y: number, z: number): number {
    const yf = y / WORLD_HEIGHT;
    const floor = clamp((0.2 - yf) / 0.2, 0, 1);
    const ceil = clamp((yf - 0.78) / 0.22, 0, 1);
    const shape = this.shapeN.sample2(x, z, 1 / 160) * 0.25;
    const n = this.densN.sample3(x, y * 1.6, z, 1 / 70) + this.detailN.sample3(x, y, z, 1 / 22) * 0.25;
    return n - 0.05 + shape + floor * floor * 2.4 + ceil * ceil * 2.6;
  }

  generateTerrain(cx: number, cz: number): GeneratedChunk {
    const w = new ChunkWriter(cx, cz);
    w.biomes.fill(Biome.HELL);
    const bx = cx * 16; const bz = cz * 16;
    // Coarse density lattice (4 x 8 x 4), trilinearly interpolated.
    const NX = 5; const NY = 17; const NZ = 5;
    const lat = new Float32Array(NX * NY * NZ);
    for (let gx = 0; gx < NX; gx++) {
      for (let gz = 0; gz < NZ; gz++) {
        for (let gy = 0; gy < NY; gy++) {
          lat[(gx * NZ + gz) * NY + gy] = this.density(bx + gx * 4, gy * 8, bz + gz * 4);
        }
      }
    }
    const blocks = w.blocks;
    for (let lx = 0; lx < 16; lx++) {
      const gx = lx >> 2; const fx = (lx & 3) / 4;
      for (let lz = 0; lz < 16; lz++) {
        const gz = lz >> 2; const fz = (lz & 3) / 4;
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const gy = y >> 3; const fy = (y & 7) / 8;
          const c = (ix: number, iz: number, iy: number): number => lat[((gx + ix) * NZ + gz + iz) * NY + gy + iy];
          const d00 = c(0, 0, 0) + (c(1, 0, 0) - c(0, 0, 0)) * fx;
          const d10 = c(0, 1, 0) + (c(1, 1, 0) - c(0, 1, 0)) * fx;
          const d01 = c(0, 0, 1) + (c(1, 0, 1) - c(0, 0, 1)) * fx;
          const d11 = c(0, 1, 1) + (c(1, 1, 1) - c(0, 1, 1)) * fx;
          const d0 = d00 + (d10 - d00) * fz;
          const d1 = d01 + (d11 - d01) * fz;
          const d = d0 + (d1 - d0) * fy;
          const i = blockIndex(lx, y, lz);
          if (d > 0) blocks[i] = BlockId.NETHERRACK;
          else if (y <= NETHER_LAVA_LEVEL) blocks[i] = BlockId.LAVA;
        }
      }
    }
    this.surface(w);
    carveCaves(w, this.seed, { lavaLevel: 10, nether: true });
    this.rasterizeFortresses(w);
    // Bedrock floor and ceiling.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        blocks[blockIndex(lx, 0, lz)] = BlockId.BEDROCK;
        blocks[blockIndex(lx, WORLD_HEIGHT - 1, lz)] = BlockId.BEDROCK;
        for (let k = 1; k < 5; k++) {
          const h = hashCombine(this.seed, bx + lx, k, bz + lz, 0xbed);
          if ((h & 7) < 5 - k) blocks[blockIndex(lx, k, lz)] = BlockId.BEDROCK;
          if (((h >>> 4) & 7) < 5 - k) blocks[blockIndex(lx, WORLD_HEIGHT - 1 - k, lz)] = BlockId.BEDROCK;
        }
      }
    }
    return { cx, cz, blocks: w.blocks, meta: w.meta, biomes: w.biomes, tiles: w.tiles };
  }

  /** Soul sand and gravel shores around the lava sea. */
  private surface(w: ChunkWriter): void {
    const blocks = w.blocks;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = w.minX + lx; const z = w.minZ + lz;
        const soul = this.soulN.sample2(x, z, 1 / 20) > 0.25;
        const gravel = this.gravelN.sample2(x, z, 1 / 18) > 0.3;
        const depth = 1 + (hashCombine(this.seed, x, z, 0x5011) & 3);
        for (let y = NETHER_LAVA_LEVEL + 6; y >= NETHER_LAVA_LEVEL - 4; y--) {
          const i = blockIndex(lx, y, lz);
          if (blocks[i] !== BlockId.NETHERRACK || blocks[i + 1] !== 0) continue;
          if (!soul && !gravel) continue;
          for (let k = 0; k < depth && y - k > 0; k++) {
            const j = blockIndex(lx, y - k, lz);
            if (blocks[j] !== BlockId.NETHERRACK) break;
            blocks[j] = soul ? BlockId.SOUL_SAND : BlockId.GRAVEL;
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Fortresses
  // ---------------------------------------------------------------------------
  fortressIn(rx: number, rz: number): Fortress {
    const key = `${rx},${rz}`;
    let f = this.fortresses.get(key);
    if (!f) {
      const r = new Random(hashCombine(this.seed, rx, rz, 0xf0f7));
      const cx = rx * FORTRESS_REGION + 2 + r.int(FORTRESS_REGION - 4);
      const cz = rz * FORTRESS_REGION + 2 + r.int(FORTRESS_REGION - 4);
      f = new Fortress(this.seed, cx * 16 + r.int(16), 56 + r.int(12), cz * 16 + r.int(16));
      if (this.fortresses.size > 64) this.fortresses.clear();
      this.fortresses.set(key, f);
    }
    return f;
  }

  private fortressesNear(cx: number, cz: number): Fortress[] {
    const rx = Math.floor(cx / FORTRESS_REGION); const rz = Math.floor(cz / FORTRESS_REGION);
    const out: Fortress[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) out.push(this.fortressIn(rx + dx, rz + dz));
    return out;
  }

  private rasterizeFortresses(w: ChunkWriter): void {
    const cb = bbox(w.minX, 0, w.minZ, w.minX + 15, 127, w.minZ + 15);
    for (const f of this.fortressesNear(w.cx, w.cz)) if (boxesIntersect(f.box, cb)) rasterizePieces(f.pieces, w);
  }

  inFortress(x: number, y: number, z: number): boolean {
    for (const f of this.fortressesNear(x >> 4, z >> 4)) if (f.contains(x, y, z)) return true;
    return false;
  }

  /** Nearest fortress start (tests / debugging). */
  nearestFortress(x: number, z: number): [number, number, number] {
    let best: Fortress | null = null; let bd = Infinity;
    for (const f of this.fortressesNear(x >> 4, z >> 4)) {
      const d = (f.x - x) ** 2 + (f.z - z) ** 2;
      if (d < bd) { bd = d; best = f; }
    }
    return [best!.x, best!.y, best!.z];
  }

  // ---------------------------------------------------------------------------
  // Decoration
  // ---------------------------------------------------------------------------
  populate(access: PopulateAccess, cx: number, cz: number): void {
    const a = access as FeatureAccess;
    const r = new Random(hashCombine(this.seed, cx, cz, 0x9e7));
    const ox = cx * 16 + 8; const oz = cz * 16 + 8;
    // Hidden lava springs.
    for (let i = 0; i < 8; i++) {
      const x = ox + r.int(16); const y = r.int(120) + 4; const z = oz + r.int(16);
      if (a.getBlock(x, y, z) !== BlockId.NETHERRACK || a.getBlock(x, y + 1, z) !== BlockId.NETHERRACK) continue;
      let rack = 0; let air = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const id = a.getBlock(x + dx, y + dy, z + dz);
        if (id === BlockId.NETHERRACK) rack++; else if (id === 0) air++;
      }
      if (rack === 4 && air === 1) { a.setBlock(x, y, z, BlockId.LAVA); a.scheduleFluid?.(x, y, z); }
    }
    // Fire patches.
    const fires = r.int(r.int(10) + 1) + 1;
    for (let i = 0; i < fires; i++) {
      const x = ox + r.int(16); const y = r.int(120) + 4; const z = oz + r.int(16);
      for (let j = 0; j < 32; j++) {
        const px = x + r.int(8) - r.int(8); const py = y + r.int(4) - r.int(4); const pz = z + r.int(8) - r.int(8);
        if (a.getBlock(px, py, pz) === 0 && a.getBlock(px, py - 1, pz) === BlockId.NETHERRACK) a.setBlock(px, py, pz, BlockId.FIRE);
      }
    }
    // Glowstone clusters hanging from the ceiling.
    const clusters = r.int(r.int(10) + 1);
    for (let i = 0; i < clusters + 4; i++) this.glowstone(a, r, ox + r.int(16), r.int(120) + 4, oz + r.int(16));
    // Mushrooms.
    for (const id of [BlockId.BROWN_MUSHROOM, BlockId.RED_MUSHROOM]) {
      if (r.int(2) !== 0) continue;
      const x = ox + r.int(16); const y = r.int(120) + 4; const z = oz + r.int(16);
      for (let j = 0; j < 32; j++) {
        const px = x + r.int(8) - r.int(8); const py = y + r.int(4) - r.int(4); const pz = z + r.int(8) - r.int(8);
        if (a.getBlock(px, py, pz) === 0 && a.getBlock(px, py - 1, pz) === BlockId.NETHERRACK) a.setBlock(px, py, pz, id);
      }
    }
  }

  private glowstone(a: FeatureAccess, r: Random, x: number, y: number, z: number): void {
    if (a.getBlock(x, y, z) !== 0 || a.getBlock(x, y + 1, z) !== BlockId.NETHERRACK) return;
    a.setBlock(x, y, z, BlockId.GLOWSTONE);
    for (let i = 0; i < 500; i++) {
      const px = x + r.int(8) - r.int(8); const py = y - r.int(12); const pz = z + r.int(8) - r.int(8);
      if (a.getBlock(px, py, pz) !== 0) continue;
      let n = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        if (a.getBlock(px + dx, py + dy, pz + dz) === BlockId.GLOWSTONE) n++;
      }
      if (n === 1) a.setBlock(px, py, pz, BlockId.GLOWSTONE);
    }
  }
}

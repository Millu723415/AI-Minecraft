/**
 * Overworld generator in the spirit of the 2011 release: broad simple land
 * masses, oceans, rivers, climate-driven biomes, winding caves and ravines.
 *
 * Terrain parameters are continuous functions of climate noise, so biome
 * borders blend naturally without an explicit blending pass.
 */

import { BlockId } from '../blocks/ids';
import { OctaveNoise } from '../core/noise';
import { hashCombine, Random } from '../core/rng';
import { clamp, lerp, smoothstep } from '../core/math';
import { SEA_LEVEL, WORLD_HEIGHT, blockIndex } from '../world/constants';
import type { DimensionGenerator, GeneratedChunk, PopulateAccess } from '../world/generator';
import { Biome, biomeDef } from './biomes';
import { carveCaves, carveRavines } from './carvers';
import { ChunkWriter } from './chunkwriter';
import { decorateSurface, dungeon, lake, placeOres, snowAndIce, springs, type FeatureAccess } from './features';
import { OverworldStructures } from './structures/overworldstructures';

export const OVERWORLD_GENERATOR_VERSION = 1;

export interface Climate {
  cont: number;
  temp: number;
  humid: number;
  hills: number;
  river: number;
  mush: number;
  detail: number;
}

export class OverworldGenerator implements DimensionGenerator {
  readonly generatorVersion = OVERWORLD_GENERATOR_VERSION;
  private readonly contN: OctaveNoise;
  private readonly tempN: OctaveNoise;
  private readonly humidN: OctaveNoise;
  private readonly hillN: OctaveNoise;
  private readonly riverN: OctaveNoise;
  private readonly detailN: OctaveNoise;
  private readonly mushN: OctaveNoise;
  private readonly surfaceN: OctaveNoise;
  private readonly overhangN: OctaveNoise;
  readonly structures: OverworldStructures;

  constructor(readonly seed: number) {
    this.contN = new OctaveNoise(hashCombine(seed, 1), 4);
    this.tempN = new OctaveNoise(hashCombine(seed, 2), 3);
    this.humidN = new OctaveNoise(hashCombine(seed, 3), 3);
    this.hillN = new OctaveNoise(hashCombine(seed, 4), 3);
    this.riverN = new OctaveNoise(hashCombine(seed, 5), 3, 0.4);
    this.detailN = new OctaveNoise(hashCombine(seed, 6), 6, 0.5);
    this.mushN = new OctaveNoise(hashCombine(seed, 7), 2);
    this.surfaceN = new OctaveNoise(hashCombine(seed, 8), 3);
    this.overhangN = new OctaveNoise(hashCombine(seed, 9), 3);
    this.structures = new OverworldStructures(this);
  }

  climate(x: number, z: number): Climate {
    // Nudge the continent field so the world origin tends to be land.
    const originBias = 0.18 * Math.max(0, 1 - Math.sqrt(x * x + z * z) / 900);
    return {
      cont: this.contN.sample2(x, z, 1 / 700) * 1.6 + 0.08 + originBias,
      temp: this.tempN.sample2(x, z, 1 / 520) * 1.8,
      humid: this.humidN.sample2(x + 3000, z - 2000, 1 / 460) * 1.8,
      hills: this.hillN.sample2(x, z, 1 / 320) * 1.8,
      river: this.riverN.sample2(x, z, 1 / 520) * 1.6,
      mush: this.mushN.sample2(x, z, 1 / 220),
      detail: this.detailN.sample2(x, z, 1 / 110),
    };
  }

  biomeFromClimate(c: Climate): number {
    const cold = c.temp < -0.42;
    if (c.cont < -0.08) {
      if (c.cont < -0.32 && c.mush > 0.42) return c.mush > 0.47 ? Biome.MUSHROOM_ISLAND : Biome.MUSHROOM_SHORE;
      return cold ? Biome.FROZEN_OCEAN : Biome.OCEAN;
    }
    if (Math.abs(c.river) < 0.028 && c.cont > -0.04) return cold ? Biome.FROZEN_RIVER : Biome.RIVER;
    if (cold) return c.hills > 0.3 ? Biome.ICE_MOUNTAINS : Biome.ICE_PLAINS;
    if (c.hills > 0.38) return Biome.EXTREME_HILLS;
    if (c.temp < -0.14) return Biome.TAIGA;
    if (c.temp > 0.3 && c.humid < 0.05) return Biome.DESERT;
    if (c.humid > 0.38 && c.cont < 0.3) return Biome.SWAMPLAND;
    if (c.humid > 0.0) return Biome.FOREST;
    return Biome.PLAINS;
  }

  biomeAt(x: number, z: number): number {
    return this.biomeFromClimate(this.climate(x, z));
  }

  /** Continuous terrain height (before caves/overhangs). */
  heightFromClimate(c: Climate): { height: number; hillsF: number } {
    const landness = smoothstep(-0.12, 0.02, c.cont);
    const oceanFloor = SEA_LEVEL - 16 - 10 * smoothstep(-0.12, -0.6, c.cont) + c.detail * 4;
    const hillsF = smoothstep(0.28, 0.5, c.hills);
    const forestF = smoothstep(-0.05, 0.25, c.humid) * 0.6;
    const variation = 4 + forestF * 5 + hillsF * 32;
    let land = SEA_LEVEL + 3 + Math.max(0, c.cont) * 8 + c.detail * variation + hillsF * 14;
    const swampF = smoothstep(0.3, 0.42, c.humid) * (1 - smoothstep(0.2, 0.35, c.cont)) * (c.temp > -0.42 ? 1 : 0) * (1 - hillsF);
    land = lerp(land, SEA_LEVEL - 0.5 + c.detail * 1.6, swampF);
    let h = lerp(oceanFloor, land, landness);
    const riverF = (1 - smoothstep(0.012, 0.036, Math.abs(c.river))) * smoothstep(-0.04, 0.05, c.cont);
    h = lerp(h, SEA_LEVEL - 5 + c.detail * 2, riverF);
    if (c.cont < -0.3 && c.mush > 0.4) {
      const islandF = smoothstep(0.4, 0.5, c.mush);
      h = lerp(h, SEA_LEVEL + 4 + c.detail * 5, islandF);
    }
    return { height: clamp(h, 6, WORLD_HEIGHT - 8), hillsF: hillsF * (1 - riverF) };
  }

  /** Integer y of the top solid terrain block before carving (flat biomes only exact). */
  surfaceHeight(x: number, z: number): number {
    return Math.floor(this.heightFromClimate(this.climate(x, z)).height);
  }

  generateTerrain(cx: number, cz: number): GeneratedChunk {
    const w = new ChunkWriter(cx, cz);
    const blocks = w.blocks;
    const bx = cx * 16;
    const bz = cz * 16;
    const heights = new Float32Array(256);
    const hillsArr = new Float32Array(256);
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const c = this.climate(bx + lx, bz + lz);
        const { height, hillsF } = this.heightFromClimate(c);
        heights[lx + lz * 16] = height;
        hillsArr[lx + lz * 16] = hillsF;
        w.biomes[lx + (lz << 4)] = this.biomeFromClimate(c);
      }
    }
    // Stone body (with 3D overhangs in hilly areas) and water.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const h = heights[lx + lz * 16];
        const hf = hillsArr[lx + lz * 16];
        const hi = Math.floor(h);
        const top = hf > 0.05 ? Math.min(WORLD_HEIGHT - 2, hi + 16) : hi;
        for (let y = 0; y <= top; y++) {
          let solid = y <= hi;
          if (hf > 0.05 && y > hi - 12) {
            const n = this.overhangN.sample3(bx + lx, y, bz + lz, 1 / 28);
            solid = (h - y) + hf * 22 * n > 0;
          }
          if (solid) blocks[blockIndex(lx, y, lz)] = BlockId.STONE;
        }
        for (let y = 0; y < SEA_LEVEL; y++) {
          const i = blockIndex(lx, y, lz);
          if (blocks[i] === 0) blocks[i] = BlockId.WATER;
        }
      }
    }
    this.applySurface(w);
    carveCaves(w, this.seed, { lavaLevel: 11, nether: false });
    carveRavines(w, this.seed);
    this.structures.rasterize(w);
    // Bedrock floor.
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        blocks[blockIndex(lx, 0, lz)] = BlockId.BEDROCK;
        for (let y = 1; y < 5; y++) {
          if ((hashCombine(this.seed, bx + lx, y, bz + lz) & 7) < 5 - y) blocks[blockIndex(lx, y, lz)] = BlockId.BEDROCK;
        }
      }
    }
    return { cx, cz, blocks: w.blocks, meta: w.meta, biomes: w.biomes, tiles: w.tiles };
  }

  private applySurface(w: ChunkWriter): void {
    const blocks = w.blocks;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const x = w.minX + lx;
        const z = w.minZ + lz;
        const biome = biomeDef(w.biomes[lx + (lz << 4)]);
        const sn = this.surfaceN.sample2(x, z, 1 / 18);
        const depth = Math.floor(3 + sn * 2.5 + ((hashCombine(this.seed, x, z, 77) & 3) / 4));
        const beach = sn > 0.05;
        const gravelBeach = sn < -0.35;
        let run = -1;
        let top = biome.top;
        let filler = biome.filler;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const i = blockIndex(lx, y, lz);
          const id = blocks[i];
          if (id === 0 || id === BlockId.WATER) {
            run = -1;
            continue;
          }
          if (id !== BlockId.STONE) continue;
          if (run === -1) {
            if (depth <= 0) {
              top = 0;
              filler = BlockId.STONE;
            } else if (y >= SEA_LEVEL - 4 && y <= SEA_LEVEL + 1) {
              top = biome.top;
              filler = biome.filler;
              if (gravelBeach && biome.id !== Biome.DESERT) { top = BlockId.GRAVEL; filler = BlockId.GRAVEL; }
              if (beach && biome.id !== Biome.SWAMPLAND && biome.id !== Biome.MUSHROOM_ISLAND) { top = BlockId.SAND; filler = BlockId.SAND; }
            } else {
              top = biome.top;
              filler = biome.filler;
            }
            if (y < SEA_LEVEL - 1 && (top === BlockId.GRASS || top === BlockId.MYCELIUM)) {
              top = y >= SEA_LEVEL - 6 && beach ? BlockId.SAND : BlockId.DIRT;
              if (biome.id === Biome.OCEAN || biome.id === Biome.FROZEN_OCEAN) top = beach ? BlockId.SAND : BlockId.GRAVEL;
              if (biome.id === Biome.RIVER || biome.id === Biome.FROZEN_RIVER) top = BlockId.SAND;
            }
            run = depth;
            blocks[i] = top || BlockId.STONE;
          } else if (run > 0) {
            run--;
            blocks[i] = filler;
            if (run === 0 && filler === BlockId.SAND) {
              run = 1 + ((hashCombine(this.seed, x, z, 91) & 3));
              filler = BlockId.SANDSTONE;
            }
          }
        }
      }
    }
  }

  populate(access: PopulateAccess, cx: number, cz: number): void {
    const a = access as FeatureAccess;
    const seed = this.seed;
    const biome = biomeDef(a.biomeAt(cx * 16 + 16, cz * 16 + 16));
    // Lakes.
    {
      const r = new Random(hashCombine(seed, cx, cz, 0x1a4e));
      if (r.int(4) === 0 && biome.id !== Biome.DESERT) {
        const x = cx * 16 + r.int(16) + 8;
        const z = cz * 16 + r.int(16) + 8;
        const y = r.int(WORLD_HEIGHT);
        if (y > SEA_LEVEL - 10 && y < a.topY(x, z) + 2) lake(a, r, x - 8, y - 4, z - 8, BlockId.WATER);
      }
      if (r.int(8) === 0) {
        const x = cx * 16 + r.int(16) + 8;
        const z = cz * 16 + r.int(16) + 8;
        const y = r.int(r.int(WORLD_HEIGHT - 8) + 8);
        if (y < SEA_LEVEL || r.int(10) === 0) lake(a, r, x - 8, y - 4, z - 8, BlockId.LAVA);
      }
    }
    // Dungeons.
    {
      const r = new Random(hashCombine(seed, cx, cz, 0xd009));
      for (let i = 0; i < 8; i++) {
        dungeon(a, r, cx * 16 + r.int(16) + 8, r.int(WORLD_HEIGHT - 20) + 5, cz * 16 + r.int(16) + 8, seed);
      }
    }
    placeOres(a, seed, cx, cz);
    decorateSurface(a, seed, cx, cz);
    springs(a, seed, cx, cz);
    snowAndIce(a, cx, cz);
  }

  /** Find a safe land spawn near the origin (deterministic). */
  findSpawn(): { x: number; z: number } {
    for (let radius = 0; radius < 2000; radius += 16) {
      const steps = Math.max(1, Math.floor((radius * 2 * Math.PI) / 16));
      for (let s = 0; s < steps; s++) {
        const ang = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(ang) * radius);
        const z = Math.round(Math.sin(ang) * radius);
        const c = this.climate(x, z);
        const b = this.biomeFromClimate(c);
        const h = this.heightFromClimate(c).height;
        if (b !== Biome.OCEAN && b !== Biome.FROZEN_OCEAN && b !== Biome.RIVER && b !== Biome.FROZEN_RIVER &&
            b !== Biome.EXTREME_HILLS && h > SEA_LEVEL + 1 && h < SEA_LEVEL + 20) {
          return { x, z };
        }
      }
    }
    return { x: 0, z: 0 };
  }
}

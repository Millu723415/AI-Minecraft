/**
 * The End: one large floating island of end stone in the void, crowned with
 * obsidian pillars that carry the healing crystals of the dragon.
 */

import { BlockId } from '../blocks/ids';
import { OctaveNoise } from '../core/noise';
import { Random, hashCombine } from '../core/rng';
import { WORLD_HEIGHT, blockIndex } from '../world/constants';
import type { DimensionGenerator, GeneratedChunk, PopulateAccess } from '../world/generator';
import { Biome } from './biomes';
import { ChunkWriter } from './chunkwriter';

export interface EndPillar { x: number; z: number; radius: number; top: number }

const ISLAND_RADIUS = 96;
const SURFACE = 56;

export class EndGenerator implements DimensionGenerator {
  readonly generatorVersion = 1;
  private readonly edgeN: OctaveNoise;
  private readonly topN: OctaveNoise;
  private readonly bottomN: OctaveNoise;
  private pillarCache: EndPillar[] | null = null;

  constructor(readonly seed: number) {
    this.edgeN = new OctaveNoise(hashCombine(seed, 0xe1), 3);
    this.topN = new OctaveNoise(hashCombine(seed, 0xe2), 3);
    this.bottomN = new OctaveNoise(hashCombine(seed, 0xe3), 3);
  }

  /** Island column: [bottom, top] inclusive, or null over the void. */
  column(x: number, z: number): [number, number] | null {
    const ang = Math.atan2(z, x);
    const r = ISLAND_RADIUS * (1 + 0.18 * this.edgeN.sample2(Math.cos(ang) * 40, Math.sin(ang) * 40, 1 / 30));
    const d = Math.sqrt(x * x + z * z) / r;
    if (d >= 1) return null;
    const lens = Math.sqrt(1 - d * d);
    const top = Math.floor(SURFACE + this.topN.sample2(x, z, 1 / 40) * 4 * lens - (1 - lens) * 6);
    const bottom = Math.floor(SURFACE - 8 - lens * 36 + this.bottomN.sample2(x, z, 1 / 20) * 5);
    if (bottom > top) return null;
    return [Math.max(1, bottom), top];
  }

  /** Ten obsidian pillars scattered over the island (deterministic). */
  pillars(): EndPillar[] {
    if (this.pillarCache) return this.pillarCache;
    const r = new Random(hashCombine(this.seed, 0x5e1e));
    const out: EndPillar[] = [];
    let guard = 0;
    while (out.length < 10 && guard++ < 1000) {
      const ang = r.next() * Math.PI * 2;
      const dist = 18 + r.next() * 44;
      const x = Math.round(Math.cos(ang) * dist);
      const z = Math.round(Math.sin(ang) * dist);
      if (out.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 14 * 14)) continue;
      const col = this.column(x, z);
      if (!col) continue;
      const radius = 1 + r.int(3);
      const top = Math.min(WORLD_HEIGHT - 12, col[1] + 12 + r.int(30));
      out.push({ x, z, radius, top });
    }
    this.pillarCache = out;
    return out;
  }

  /** Positions of the bedrock caps where the ender crystals rest. */
  pillarTops(): [number, number, number][] {
    return this.pillars().map((p) => [p.x, p.top, p.z]);
  }

  generateTerrain(cx: number, cz: number): GeneratedChunk {
    const w = new ChunkWriter(cx, cz);
    w.biomes.fill(Biome.SKY);
    const blocks = w.blocks;
    for (let lz = 0; lz < 16; lz++) {
      for (let lx = 0; lx < 16; lx++) {
        const col = this.column(w.minX + lx, w.minZ + lz);
        if (!col) continue;
        for (let y = col[0]; y <= col[1]; y++) blocks[blockIndex(lx, y, lz)] = BlockId.END_STONE;
      }
    }
    for (const p of this.pillars()) {
      if (!w.intersects(p.x - p.radius, p.z - p.radius, p.x + p.radius, p.z + p.radius)) continue;
      const base = (this.column(p.x, p.z)?.[0] ?? SURFACE - 10);
      for (let dx = -p.radius; dx <= p.radius; dx++) {
        for (let dz = -p.radius; dz <= p.radius; dz++) {
          if (dx * dx + dz * dz > p.radius * p.radius + 1) continue;
          for (let y = base; y < p.top; y++) w.set(p.x + dx, y, p.z + dz, BlockId.OBSIDIAN);
        }
      }
      w.set(p.x, p.top, p.z, BlockId.BEDROCK);
    }
    return { cx, cz, blocks: w.blocks, meta: w.meta, biomes: w.biomes, tiles: w.tiles };
  }

  populate(_a: PopulateAccess, _cx: number, _cz: number): void {
    // The End has no decoration in this era.
  }
}

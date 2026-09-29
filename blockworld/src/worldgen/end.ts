/** Placeholder until the full End generator is written. */
import { BlockId } from '../blocks/ids';
import type { DimensionGenerator, GeneratedChunk, PopulateAccess } from '../world/generator';
import { ChunkWriter } from './chunkwriter';

export class EndGenerator implements DimensionGenerator {
  readonly generatorVersion = 1;
  constructor(readonly seed: number) {}
  generateTerrain(cx: number, cz: number): GeneratedChunk {
    const w = new ChunkWriter(cx, cz);
    if (Math.abs(cx) < 4 && Math.abs(cz) < 4) w.fill(w.minX, 40, w.minZ, w.minX + 15, 60, w.minZ + 15, BlockId.END_STONE);
    w.biomes.fill(9);
    return { cx, cz, blocks: w.blocks, meta: w.meta, biomes: w.biomes, tiles: w.tiles };
  }
  populate(_a: PopulateAccess, _cx: number, _cz: number): void {}
}

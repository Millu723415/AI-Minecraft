/** Placeholder until the full Nether generator is written. */
import { BlockId } from '../blocks/ids';
import type { DimensionGenerator, GeneratedChunk, PopulateAccess } from '../world/generator';
import { ChunkWriter } from './chunkwriter';

export class NetherGenerator implements DimensionGenerator {
  readonly generatorVersion = 1;
  constructor(readonly seed: number) {}
  generateTerrain(cx: number, cz: number): GeneratedChunk {
    const w = new ChunkWriter(cx, cz);
    w.fill(w.minX, 0, w.minZ, w.minX + 15, 30, w.minZ + 15, BlockId.NETHERRACK);
    w.biomes.fill(8);
    return { cx, cz, blocks: w.blocks, meta: w.meta, biomes: w.biomes, tiles: w.tiles };
  }
  populate(_a: PopulateAccess, _cx: number, _cz: number): void {}
}

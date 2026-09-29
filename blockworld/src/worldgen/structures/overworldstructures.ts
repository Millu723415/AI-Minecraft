/** Placeholder replaced below; rasterises villages, mineshafts and strongholds. */
import type { ChunkWriter } from '../chunkwriter';
import type { OverworldGenerator } from '../overworld';

export class OverworldStructures {
  constructor(readonly gen: OverworldGenerator) {}
  rasterize(_w: ChunkWriter): void {}
  strongholdPositions(): [number, number][] { return []; }
}

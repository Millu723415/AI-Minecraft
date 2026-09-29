/// <reference lib="webworker" />
/** Terrain generation worker: pure (seed, dimension, chunk) -> block arrays. */

import type { DimId } from '../world/constants';
import type { DimensionGenerator } from '../world/generator';
import { createGenerator } from './index';

interface Request { id: number; seed: number; dim: DimId; cx: number; cz: number }

const generators = new Map<string, DimensionGenerator>();

self.onmessage = (e: MessageEvent<Request>) => {
  const { id, seed, dim, cx, cz } = e.data;
  const key = `${seed}:${dim}`;
  let gen = generators.get(key);
  if (!gen) {
    gen = createGenerator(dim, seed);
    generators.set(key, gen);
  }
  const t0 = performance.now();
  const r = gen.generateTerrain(cx, cz);
  const ms = performance.now() - t0;
  (self as unknown as Worker).postMessage(
    { id, dim, cx, cz, blocks: r.blocks, meta: r.meta, biomes: r.biomes, tiles: r.tiles, ms },
    [r.blocks.buffer, r.meta.buffer, r.biomes.buffer],
  );
};

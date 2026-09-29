/** Generator factory shared by the main thread and the generation workers. */

import { Dim, type DimId } from '../world/constants';
import type { DimensionGenerator } from '../world/generator';
import { OverworldGenerator } from './overworld';
import { NetherGenerator } from './nether';
import { EndGenerator } from './end';

export const GENERATOR_VERSION = 1;

export function createGenerator(dim: DimId, seed: number): DimensionGenerator {
  switch (dim) {
    case Dim.NETHER: return new NetherGenerator(seed);
    case Dim.END: return new EndGenerator(seed);
    default: return new OverworldGenerator(seed);
  }
}

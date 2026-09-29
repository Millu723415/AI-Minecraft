/** A saved world: metadata plus its three dimensions. */

import { Dim, type DimId } from './constants';
import { Dimension } from './dimension';
import { createGenerator } from '../worldgen/index';

export type GameMode = 'survival' | 'creative' | 'hardcore';

export interface WorldMeta {
  id: string;
  name: string;
  seed: number;
  seedText: string;
  gameMode: GameMode;
  difficulty: number;
  generatorVersion: number;
  created: number;
  lastPlayed: number;
}

export class World {
  readonly dimensions = new Map<DimId, Dimension>();
  /** Total ticks since creation. */
  totalTime = 0;
  /** Time of day in ticks (0 = sunrise). */
  dayTime = 1000;
  raining = false;
  rainTime = 12000;
  /** Smoothed 0..1 rain strength for rendering. */
  rainStrength = 0;
  spawnX = 0;
  spawnY = 80;
  spawnZ = 0;
  dragonKilled = false;
  /** The End dragon fight has been initialised (dragon + crystals spawned). */
  endInitialized = false;
  /** The ending sequence was seen at least once. */
  endingSeen = false;

  constructor(public meta: WorldMeta) {}

  get seed(): number {
    return this.meta.seed;
  }

  getDimension(id: DimId): Dimension {
    let d = this.dimensions.get(id);
    if (!d) {
      d = new Dimension(id, createGenerator(id, this.seed), id === Dim.OVERWORLD);
      this.dimensions.set(id, d);
    }
    return d;
  }

  isDay(): boolean {
    const t = this.dayTime % 24000;
    return t < 12500 || t > 23500;
  }
}

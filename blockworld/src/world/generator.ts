/** Interfaces between the world and the dimension generators. */

import type { SerializedTile } from './tileentity';

export interface GeneratedChunk {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  tiles: SerializedTile[];
}

/** World access handed to population (feature placement) passes. */
export interface PopulateAccess {
  getBlock(x: number, y: number, z: number): number;
  getMeta(x: number, y: number, z: number): number;
  /** Writes are silently dropped outside the populated area or into saved chunks. */
  setBlock(x: number, y: number, z: number, id: number, meta?: number): void;
  addTile(tile: SerializedTile): void;
  biomeAt(x: number, z: number): number;
  /** Highest y whose block is not air (or -1). */
  topY(x: number, z: number): number;
}

export interface DimensionGenerator {
  readonly generatorVersion: number;
  generateTerrain(cx: number, cz: number): GeneratedChunk;
  populate(access: PopulateAccess, cx: number, cz: number): void;
}

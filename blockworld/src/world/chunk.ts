/**
 * A 16x128x16 column of blocks. Block ids, metadata and light live in flat
 * typed arrays so that generation, lighting and meshing stay cache friendly.
 */

import { CHUNK_VOLUME, WORLD_HEIGHT, blockIndex } from './constants';
import { OPAQUE_LIGHT } from '../blocks/registry';

export enum ChunkState {
  /** Terrain generated but features not yet placed. */
  TERRAIN = 0,
  /** This chunk's own population pass has run. */
  POPULATED = 1,
}

export class Chunk {
  readonly blocks: Uint8Array;
  readonly meta: Uint8Array;
  /** High nibble: skylight, low nibble: block light. */
  readonly light: Uint8Array;
  /** Per-column height of the highest light-blocking block + 1. */
  readonly heightMap: Uint8Array;
  readonly biomes: Uint8Array;

  state: ChunkState = ChunkState.TERRAIN;
  /** Lighting has been initialised for this chunk. */
  lit = false;
  /** Geometry needs to be rebuilt. */
  dirty = true;
  /** Differs from what the generator produces (needs saving). */
  modified = false;
  /** Has an up-to-date mesh. */
  meshed = false;
  /** Sections (16-high slices) that contain any non-air block. */
  sectionMask = 0;
  lastAccess = 0;

  constructor(readonly cx: number, readonly cz: number, blocks?: Uint8Array, meta?: Uint8Array) {
    this.blocks = blocks ?? new Uint8Array(CHUNK_VOLUME);
    this.meta = meta ?? new Uint8Array(CHUNK_VOLUME);
    this.light = new Uint8Array(CHUNK_VOLUME);
    this.heightMap = new Uint8Array(256);
    this.biomes = new Uint8Array(256);
  }

  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.blocks[blockIndex(x, y, z)];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.meta[blockIndex(x, y, z)];
  }

  setBlockRaw(x: number, y: number, z: number, id: number, meta = 0): void {
    const i = blockIndex(x, y, z);
    this.blocks[i] = id;
    this.meta[i] = meta;
  }

  getSkyLight(x: number, y: number, z: number): number {
    if (y >= WORLD_HEIGHT) return 15;
    if (y < 0) return 0;
    return this.light[blockIndex(x, y, z)] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    return this.light[blockIndex(x, y, z)] & 15;
  }

  /** Recompute the height map and section mask from block data. */
  recomputeHeightMap(): void {
    let mask = 0;
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        let h = 0;
        for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
          const id = this.blocks[blockIndex(x, y, z)];
          if (id !== 0) {
            mask |= 1 << (y >> 4);
            if (h === 0 && OPAQUE_LIGHT[id] > 0) h = y + 1;
          }
        }
        this.heightMap[x | (z << 4)] = h;
      }
    }
    this.sectionMask = mask;
  }

  updateHeightAt(x: number, z: number): void {
    let h = 0;
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (OPAQUE_LIGHT[this.blocks[blockIndex(x, y, z)]] > 0) {
        h = y + 1;
        break;
      }
    }
    this.heightMap[x | (z << 4)] = h;
  }

  /** Highest non-air block y in a column, or -1. */
  topBlockY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      if (this.blocks[blockIndex(x, y, z)] !== 0) return y;
    }
    return -1;
  }
}

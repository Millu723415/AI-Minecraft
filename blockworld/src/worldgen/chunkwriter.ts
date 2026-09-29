/** Clipped writer used by terrain-phase generation and structure rasterisation. */

import { CHUNK_VOLUME, WORLD_HEIGHT, blockIndex } from '../world/constants';
import type { SerializedTile } from '../world/tileentity';

export class ChunkWriter {
  readonly blocks = new Uint8Array(CHUNK_VOLUME);
  readonly meta = new Uint8Array(CHUNK_VOLUME);
  readonly biomes = new Uint8Array(256);
  readonly tiles: SerializedTile[] = [];
  readonly minX: number;
  readonly minZ: number;

  constructor(readonly cx: number, readonly cz: number) {
    this.minX = cx * 16;
    this.minZ = cz * 16;
  }

  inside(x: number, y: number, z: number): boolean {
    return x >= this.minX && x < this.minX + 16 && z >= this.minZ && z < this.minZ + 16 && y >= 0 && y < WORLD_HEIGHT;
  }

  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return -1;
    return this.blocks[blockIndex(x - this.minX, y, z - this.minZ)];
  }

  getMeta(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return 0;
    return this.meta[blockIndex(x - this.minX, y, z - this.minZ)];
  }

  set(x: number, y: number, z: number, id: number, meta = 0): void {
    if (!this.inside(x, y, z)) return;
    const i = blockIndex(x - this.minX, y, z - this.minZ);
    this.blocks[i] = id;
    this.meta[i] = meta;
  }

  /** Set only if the current block is air (or one of `over`). */
  setIf(x: number, y: number, z: number, id: number, meta: number, over: (cur: number) => boolean): void {
    const cur = this.get(x, y, z);
    if (cur >= 0 && over(cur)) this.set(x, y, z, id, meta);
  }

  fill(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, id: number, meta = 0): void {
    const ax = Math.max(x0, this.minX);
    const bx = Math.min(x1, this.minX + 15);
    const az = Math.max(z0, this.minZ);
    const bz = Math.min(z1, this.minZ + 15);
    const ay = Math.max(0, y0);
    const by = Math.min(WORLD_HEIGHT - 1, y1);
    for (let y = ay; y <= by; y++) {
      for (let z = az; z <= bz; z++) {
        for (let x = ax; x <= bx; x++) {
          const i = blockIndex(x - this.minX, y, z - this.minZ);
          this.blocks[i] = id;
          this.meta[i] = meta;
        }
      }
    }
  }

  addTile(tile: SerializedTile): void {
    if (this.inside(tile.x, tile.y, tile.z)) this.tiles.push(tile);
  }

  /** Does the box intersect this chunk (in x/z)? */
  intersects(x0: number, z0: number, x1: number, z1: number): boolean {
    return x1 >= this.minX && x0 < this.minX + 16 && z1 >= this.minZ && z0 < this.minZ + 16;
  }
}

/**
 * Voxel lighting: a skylight channel and a block-light channel, each 0..15,
 * propagated with breadth-first flood fills. Initial lighting runs once per
 * chunk; block edits run incremental removal + re-add passes.
 */

import { LIGHT_EMISSION, OPAQUE_LIGHT } from '../blocks/registry';
import type { Chunk } from './chunk';
import { WORLD_HEIGHT, blockIndex, chunkKey } from './constants';

export interface ChunkSource {
  getChunk(cx: number, cz: number): Chunk | undefined;
  /** Called when a chunk's light changed and it must be re-meshed. */
  markLightDirty(chunk: Chunk): void;
  /** Whether the dimension has a sky (the Nether and End do not). */
  readonly hasSky: boolean;
}

/** Growable int queue storing (x, y, z, level) quadruples. */
class LightQueue {
  data = new Int32Array(4096 * 4);
  head = 0;
  tail = 0;

  push(x: number, y: number, z: number, level: number): void {
    if (this.tail + 4 > this.data.length) {
      if (this.head > 0) {
        this.data.copyWithin(0, this.head, this.tail);
        this.tail -= this.head;
        this.head = 0;
      }
      if (this.tail + 4 > this.data.length) {
        const bigger = new Int32Array(this.data.length * 2);
        bigger.set(this.data.subarray(0, this.tail));
        this.data = bigger;
      }
    }
    const d = this.data;
    d[this.tail++] = x;
    d[this.tail++] = y;
    d[this.tail++] = z;
    d[this.tail++] = level;
  }

  get empty(): boolean {
    return this.head >= this.tail;
  }

  reset(): void {
    this.head = 0;
    this.tail = 0;
  }
}

const DX = [1, -1, 0, 0, 0, 0];
const DY = [0, 0, 1, -1, 0, 0];
const DZ = [0, 0, 0, 0, 1, -1];

export class LightEngine {
  private readonly addQueue = new LightQueue();
  private readonly removeQueue = new LightQueue();
  private cacheKey = NaN;
  private cacheChunk: Chunk | undefined;
  private touched = new Set<Chunk>();

  constructor(private readonly source: ChunkSource) {}

  private chunkAt(x: number, z: number): Chunk | undefined {
    const cx = x >> 4;
    const cz = z >> 4;
    const key = chunkKey(cx, cz);
    if (key !== this.cacheKey) {
      this.cacheKey = key;
      this.cacheChunk = this.source.getChunk(cx, cz);
    }
    return this.cacheChunk;
  }

  resetCache(): void {
    this.cacheKey = NaN;
    this.cacheChunk = undefined;
  }

  /** Compute the initial skylight + block light for a freshly populated chunk. */
  initChunk(chunk: Chunk): void {
    this.resetCache();
    chunk.recomputeHeightMap();
    const light = chunk.light;
    light.fill(0);
    const hasSky = this.source.hasSky;
    const bx = chunk.cx << 4;
    const bz = chunk.cz << 4;

    // 1. Direct skylight columns.
    if (hasSky) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          let level = 15;
          for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
            const i = blockIndex(x, y, z);
            const op = OPAQUE_LIGHT[chunk.blocks[i]];
            if (op > 0) level = Math.max(0, level - op);
            else if (level < 15) level = Math.max(0, level - 1);
            light[i] = level << 4;
            if (level === 0 && op >= 15) break;
          }
        }
      }
    }

    // 2. Seeds: sky cells that can spread sideways, and block light emitters.
    const q = this.addQueue;
    q.reset();
    const neighborHeights = (x: number, z: number): number => {
      let m = chunk.heightMap[x | (z << 4)];
      if (x > 0) m = Math.max(m, chunk.heightMap[(x - 1) | (z << 4)]);
      if (x < 15) m = Math.max(m, chunk.heightMap[(x + 1) | (z << 4)]);
      if (z > 0) m = Math.max(m, chunk.heightMap[x | ((z - 1) << 4)]);
      if (z < 15) m = Math.max(m, chunk.heightMap[x | ((z + 1) << 4)]);
      if (x === 0 || x === 15 || z === 0 || z === 15) m = WORLD_HEIGHT - 1;
      return m;
    };
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const top = hasSky ? Math.min(WORLD_HEIGHT - 1, neighborHeights(x, z) + 1) : -1;
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const i = blockIndex(x, y, z);
          const emit = LIGHT_EMISSION[chunk.blocks[i]];
          if (emit > 0) {
            light[i] = (light[i] & 0xf0) | emit;
            q.push(bx + x, y, bz + z, 1); // channel 1 = block light
          }
          if (hasSky && y <= top && (light[i] >> 4) > 1) q.push(bx + x, y, bz + z, 0);
        }
      }
    }
    // 3. Pull light in from already-lit neighbours across the borders.
    const neighbors: [number, number, number, number, number, number][] = [
      // chunk dx, dz, start x, start z, step x, step z (border cells in neighbour)
      [-1, 0, 15, 0, 0, 1], [1, 0, 0, 0, 0, 1], [0, -1, 0, 15, 1, 0], [0, 1, 0, 0, 1, 0],
    ];
    for (const [dcx, dcz, sx, sz, stx, stz] of neighbors) {
      const n = this.source.getChunk(chunk.cx + dcx, chunk.cz + dcz);
      if (!n || !n.lit) continue;
      const nbx = n.cx << 4;
      const nbz = n.cz << 4;
      for (let k = 0; k < 16; k++) {
        const lx = sx + stx * k;
        const lz = sz + stz * k;
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const v = n.light[blockIndex(lx, y, lz)];
          if ((v >> 4) > 1) q.push(nbx + lx, y, nbz + lz, 0);
          if ((v & 15) > 1) q.push(nbx + lx, y, nbz + lz, 1);
        }
      }
    }
    chunk.lit = true;
    this.touched.clear();
    this.propagate();
    for (const c of this.touched) if (c !== chunk) this.source.markLightDirty(c);
    this.touched.clear();
  }

  /** Flood fill from every queued cell. Level field holds the channel (0 sky, 1 block). */
  private propagate(): void {
    const q = this.addQueue;
    const d = () => q.data;
    while (!q.empty) {
      const data = d();
      const x = data[q.head];
      const y = data[q.head + 1];
      const z = data[q.head + 2];
      const channel = data[q.head + 3];
      q.head += 4;
      const c = this.chunkAt(x, z);
      if (!c) continue;
      const idx = blockIndex(x & 15, y, z & 15);
      const raw = c.light[idx];
      const level = channel === 0 ? raw >> 4 : raw & 15;
      if (level <= 1) continue;
      for (let f = 0; f < 6; f++) {
        const ny = y + DY[f];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const nx = x + DX[f];
        const nz = z + DZ[f];
        const nc = this.chunkAt(nx, nz);
        if (!nc || !nc.lit) continue;
        const ni = blockIndex(nx & 15, ny, nz & 15);
        const op = OPAQUE_LIGHT[nc.blocks[ni]];
        if (op >= 15) continue;
        let nl = level - Math.max(1, op);
        if (channel === 0 && f === 3 && level === 15 && op === 0) nl = 15;
        const nraw = nc.light[ni];
        const cur = channel === 0 ? nraw >> 4 : nraw & 15;
        if (nl > cur) {
          nc.light[ni] = channel === 0 ? (nl << 4) | (nraw & 15) : (nraw & 0xf0) | nl;
          this.touched.add(nc);
          q.push(nx, ny, nz, channel);
        }
      }
      // chunkAt may have been re-pointed; keep going
    }
    q.reset();
  }

  /** Remove light of one channel starting from queued cells, collecting re-light seeds. */
  private removeLight(channel: number): void {
    const rq = this.removeQueue;
    const aq = this.addQueue;
    while (!rq.empty) {
      const data = rq.data;
      const x = data[rq.head];
      const y = data[rq.head + 1];
      const z = data[rq.head + 2];
      const level = data[rq.head + 3];
      rq.head += 4;
      for (let f = 0; f < 6; f++) {
        const ny = y + DY[f];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        const nx = x + DX[f];
        const nz = z + DZ[f];
        const nc = this.chunkAt(nx, nz);
        if (!nc || !nc.lit) continue;
        const ni = blockIndex(nx & 15, ny, nz & 15);
        const nraw = nc.light[ni];
        const nl = channel === 0 ? nraw >> 4 : nraw & 15;
        if (nl === 0) continue;
        const downSky = channel === 0 && f === 3 && level === 15 && nl === 15;
        if (nl < level || downSky) {
          nc.light[ni] = channel === 0 ? nraw & 15 : nraw & 0xf0;
          this.touched.add(nc);
          rq.push(nx, ny, nz, nl);
          // Emitters must keep their own light.
          const emit = LIGHT_EMISSION[nc.blocks[ni]];
          if (channel === 1 && emit > 0) {
            nc.light[ni] = (nc.light[ni] & 0xf0) | emit;
            aq.push(nx, ny, nz, 1);
          }
        } else {
          aq.push(nx, ny, nz, channel);
        }
      }
    }
    rq.reset();
  }

  /** Incrementally update light after the block at (x,y,z) changed. */
  onBlockChanged(x: number, y: number, z: number, oldId: number, newId: number): void {
    this.resetCache();
    const chunk = this.chunkAt(x, z);
    if (!chunk || !chunk.lit) return;
    this.touched.clear();
    this.touched.add(chunk);
    const lx = x & 15;
    const lz = z & 15;
    const idx = blockIndex(lx, y, lz);

    // --- Block light -----------------------------------------------------
    const oldBlock = chunk.light[idx] & 15;
    const newEmit = LIGHT_EMISSION[newId];
    if (oldBlock > 0 || newEmit > 0 || OPAQUE_LIGHT[oldId] !== OPAQUE_LIGHT[newId]) {
      if (oldBlock > 0) {
        chunk.light[idx] &= 0xf0;
        this.removeQueue.push(x, y, z, oldBlock);
        this.removeLight(1);
      }
      if (newEmit > 0) {
        chunk.light[idx] = (chunk.light[idx] & 0xf0) | newEmit;
        this.addQueue.push(x, y, z, 1);
      }
      // Let surrounding light flow back into the (possibly now open) cell.
      for (let f = 0; f < 6; f++) {
        const ny = y + DY[f];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;
        this.addQueue.push(x + DX[f], ny, z + DZ[f], 1);
      }
      this.propagate();
    }

    // --- Skylight ----------------------------------------------------------
    if (this.source.hasSky && OPAQUE_LIGHT[oldId] !== OPAQUE_LIGHT[newId]) {
      const hmIndex = lx | (lz << 4);
      const oldHeight = chunk.heightMap[hmIndex];
      chunk.updateHeightAt(lx, lz);
      const newHeight = chunk.heightMap[hmIndex];
      const top = Math.min(WORLD_HEIGHT - 1, Math.max(oldHeight, newHeight, y + 1));
      // Remove existing column skylight below the affected top.
      for (let yy = top; yy >= 0; yy--) {
        const i = blockIndex(lx, yy, lz);
        const s = chunk.light[i] >> 4;
        if (s > 0) {
          chunk.light[i] &= 15;
          this.removeQueue.push(x, yy, z, s);
        }
      }
      this.removeLight(0);
      // Re-seed the direct column.
      let level = 15;
      for (let yy = WORLD_HEIGHT - 1; yy >= 0; yy--) {
        const i = blockIndex(lx, yy, lz);
        const op = OPAQUE_LIGHT[chunk.blocks[i]];
        if (op > 0) level = Math.max(0, level - op);
        else if (level < 15) level = Math.max(0, level - 1);
        if (yy <= top) {
          const cur = chunk.light[i] >> 4;
          if (level > cur) chunk.light[i] = (level << 4) | (chunk.light[i] & 15);
          if (level > 0) this.addQueue.push(x, yy, z, 0);
        }
        if (level === 0 && op >= 15 && yy < Math.min(oldHeight, newHeight) - 1) break;
      }
      this.propagate();
    }
    for (const c of this.touched) this.source.markLightDirty(c);
    this.touched.clear();
  }

  /** Read combined light at a world position (sky, block). */
  getLight(x: number, y: number, z: number): [number, number] {
    if (y >= WORLD_HEIGHT) return [this.source.hasSky ? 15 : 0, 0];
    if (y < 0) return [0, 0];
    const c = this.chunkAt(x, z);
    if (!c) return [this.source.hasSky ? 15 : 0, 0];
    const v = c.light[blockIndex(x & 15, y, z & 15)];
    return [v >> 4, v & 15];
  }
}

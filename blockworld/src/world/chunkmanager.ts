/**
 * Streams chunks around the player: request terrain, populate, light, mesh
 * and unload, all within a per-frame time budget so the frame rate holds.
 */

import { Chunk, ChunkState } from './chunk';
import { chunkKey } from './constants';
import type { Dimension } from './dimension';
import type { GenerationPool } from './genpool';
import type { SerializedTile } from './tileentity';

export interface SavedChunkData {
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  tiles: SerializedTile[];
}

export interface ChunkManagerHooks {
  /** Load a saved chunk, or null if it is not in the save. */
  loadSaved(dim: Dimension, cx: number, cz: number): Promise<SavedChunkData | null>;
  /** Build/upload the mesh for a chunk. Returns time spent (ms). */
  mesh(chunk: Chunk): void;
  /** Remove the mesh of an unloaded chunk. */
  unmesh(cx: number, cz: number): void;
  /** Persist a chunk that is being unloaded (fire and forget). */
  saveUnloaded(dim: Dimension, chunk: Chunk): void;
  /** A chunk became playable (lit): spawn its entities etc. */
  chunkReady?(chunk: Chunk): void;
  /** A chunk is about to be unloaded: persist its entities. */
  chunkUnloading?(chunk: Chunk): void;
}

export interface ChunkStats {
  loaded: number;
  meshed: number;
  pendingGen: number;
  generatedTotal: number;
  lightMsAvg: number;
  meshMsAvg: number;
  popMsAvg: number;
}

/** Offsets sorted by distance, reused for spiral iteration. */
function spiral(radius: number): [number, number][] {
  const out: [number, number][] = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      if (dx * dx + dz * dz <= (radius + 0.5) * (radius + 0.5)) out.push([dx, dz]);
    }
  }
  out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return out;
}

export class ChunkManager {
  private requested = new Set<number>();
  private spiralCache = new Map<number, [number, number][]>();
  private meshed = new Set<number>();
  private lightTime = 0; private lightCount = 0;
  private meshTime = 0; private meshCount = 0;
  private popTime = 0; private popCount = 0;
  private generation = 0;
  /** Chunks meshed at least once, so the renderer knows what's visible. */
  lastCenter: [number, number] = [0, 0];

  constructor(
    readonly dim: Dimension,
    private readonly pool: GenerationPool,
    private readonly hooks: ChunkManagerHooks,
  ) {}

  private offsets(radius: number): [number, number][] {
    let s = this.spiralCache.get(radius);
    if (!s) {
      s = spiral(radius);
      this.spiralCache.set(radius, s);
    }
    return s;
  }

  /** Is the chunk at (cx, cz) fully ready for gameplay (lit)? */
  isReady(cx: number, cz: number): boolean {
    const c = this.dim.getChunk(cx, cz);
    return !!c && c.lit;
  }

  isMeshed(cx: number, cz: number): boolean {
    return this.meshed.has(chunkKey(cx, cz));
  }

  /**
   * Advance streaming. `renderRadius` chunks are meshed; generation extends two
   * chunks further so population and lighting have their neighbours.
   */
  update(px: number, pz: number, renderRadius: number, budgetMs: number): void {
    const start = performance.now();
    const pcx = Math.floor(px) >> 4;
    const pcz = Math.floor(pz) >> 4;
    this.lastCenter = [pcx, pcz];
    const genRadius = renderRadius + 2;
    const dim = this.dim;

    // 1. Request missing chunks (nearest first).
    for (const [dx, dz] of this.offsets(genRadius)) {
      if (!this.pool.canAccept()) break;
      const cx = pcx + dx;
      const cz = pcz + dz;
      const key = chunkKey(cx, cz);
      if (dim.chunks.has(key) || this.requested.has(key)) continue;
      this.requested.add(key);
      const gen = this.generation;
      if (dim.savedChunkKeys.has(key)) {
        this.hooks.loadSaved(dim, cx, cz).then((saved) => {
          if (gen !== this.generation) return;
          if (saved) {
            this.requested.delete(key);
            if (!dim.chunks.has(key)) dim.addSavedChunk(cx, cz, saved.blocks, saved.meta, saved.biomes, saved.tiles);
          } else {
            dim.savedChunkKeys.delete(key);
            this.requestGen(cx, cz, key, gen);
          }
        }).catch((err) => {
          console.error('chunk load failed', err);
          dim.savedChunkKeys.delete(key);
          this.requestGen(cx, cz, key, gen);
        });
      } else {
        this.requestGen(cx, cz, key, gen);
      }
      if (performance.now() - start > budgetMs) return;
    }

    // 2-4. Populate, light and mesh in one nearest-first sweep so the chunks
    // around the player become visible before distant ones are prepared.
    for (const [dx, dz] of this.offsets(genRadius - 1)) {
      const cx = pcx + dx;
      const cz = pcz + dz;
      const c = dim.getChunk(cx, cz);
      if (!c) continue;
      const ring = Math.max(Math.abs(dx), Math.abs(dz));
      let worked = false;
      if (c.state === ChunkState.TERRAIN && dim.getChunk(cx + 1, cz) && dim.getChunk(cx, cz + 1) && dim.getChunk(cx + 1, cz + 1)) {
        const t0 = performance.now();
        dim.populate(cx, cz);
        this.popTime += performance.now() - t0;
        this.popCount++;
        worked = true;
      }
      if (ring <= renderRadius + 1 && !c.lit && dim.isFinal(cx, cz)) {
        const t0 = performance.now();
        dim.light.initChunk(c);
        this.lightTime += performance.now() - t0;
        this.lightCount++;
        c.dirty = true;
        dim.dirtyChunks.add(c);
        this.hooks.chunkReady?.(c);
        worked = true;
      }
      if (ring <= renderRadius && c.lit && c.dirty && this.neighborsLit(cx, cz)) {
        const t0 = performance.now();
        this.hooks.mesh(c);
        this.meshTime += performance.now() - t0;
        this.meshCount++;
        c.dirty = false;
        dim.dirtyChunks.delete(c);
        this.meshed.add(chunkKey(cx, cz));
        worked = true;
      }
      if (worked && performance.now() - start > budgetMs) return;
    }

    // 5. Unload far chunks.
    const unloadDist = genRadius + 3;
    for (const c of Array.from(dim.chunks.values())) {
      if (Math.abs(c.cx - pcx) > unloadDist || Math.abs(c.cz - pcz) > unloadDist) {
        this.unload(c);
      }
    }
    for (const key of Array.from(this.meshed)) {
      const c = dim.chunks.get(key);
      if (!c) { this.meshed.delete(key); continue; }
      if (Math.abs(c.cx - pcx) > renderRadius + 1 || Math.abs(c.cz - pcz) > renderRadius + 1) {
        this.hooks.unmesh(c.cx, c.cz);
        this.meshed.delete(key);
        c.dirty = true;
      }
    }
  }

  /** Immediately re-mesh dirty chunks near the player (block edits feel instant). */
  flushNearbyDirty(px: number, pz: number, maxChunks = 4): void {
    const pcx = Math.floor(px) >> 4;
    const pcz = Math.floor(pz) >> 4;
    let n = 0;
    for (const c of Array.from(this.dim.dirtyChunks)) {
      if (n >= maxChunks) break;
      if (Math.abs(c.cx - pcx) > 1 || Math.abs(c.cz - pcz) > 1) continue;
      if (!c.lit || !this.meshed.has(chunkKey(c.cx, c.cz))) continue;
      this.hooks.mesh(c);
      c.dirty = false;
      this.dim.dirtyChunks.delete(c);
      n++;
    }
  }

  private neighborsLit(cx: number, cz: number): boolean {
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const n = this.dim.getChunk(cx + dx, cz + dz);
        if (!n || !n.lit) return false;
      }
    }
    return true;
  }

  private requestGen(cx: number, cz: number, key: number, gen: number): void {
    this.pool.request(this.dim.id, cx, cz, (chunk) => {
      if (gen !== this.generation) return;
      this.requested.delete(key);
      if (!this.dim.chunks.has(key)) this.dim.addGeneratedChunk(chunk);
    });
  }

  private unload(c: Chunk): void {
    const key = chunkKey(c.cx, c.cz);
    if (this.meshed.has(key)) {
      this.hooks.unmesh(c.cx, c.cz);
      this.meshed.delete(key);
    }
    // Populated-but-unlit chunks whose neighbours are gone can simply be dropped;
    // modified ones go to the save system.
    if (c.lit) this.hooks.chunkUnloading?.(c);
    if (c.modified) this.hooks.saveUnloaded(this.dim, c);
    this.dim.unloadChunk(c);
  }

  /** Unload everything (dimension change / quit). */
  unloadAll(): void {
    this.generation++;
    this.pool.cancelAll();
    for (const c of Array.from(this.dim.chunks.values())) this.unload(c);
    this.requested.clear();
    this.meshed.clear();
  }

  /** Mark every meshed chunk for rebuild (graphics option change). */
  remeshAll(): void {
    for (const c of this.dim.chunks.values()) {
      if (c.lit) {
        c.dirty = true;
        this.dim.dirtyChunks.add(c);
      }
    }
  }

  stats(): ChunkStats {
    return {
      loaded: this.dim.chunks.size,
      meshed: this.meshed.size,
      pendingGen: this.requested.size,
      generatedTotal: this.pool.totalChunks,
      lightMsAvg: this.lightCount ? this.lightTime / this.lightCount : 0,
      meshMsAvg: this.meshCount ? this.meshTime / this.meshCount : 0,
      popMsAvg: this.popCount ? this.popTime / this.popCount : 0,
    };
  }
}

/**
 * A dimension is an independent world space (Overworld, Nether, End) with its
 * own chunks, block entities, scheduled block updates and light engine.
 */

import { getBlock, IS_FLUID, LIGHT_EMISSION, OPAQUE_LIGHT } from '../blocks/registry';
import { BlockId } from '../blocks/ids';
import { Chunk, ChunkState } from './chunk';
import { CHUNK_SIZE, WORLD_HEIGHT, blockIndex, chunkKey, type DimId } from './constants';
import type { DimensionGenerator, GeneratedChunk, PopulateAccess } from './generator';
import { LightEngine, type ChunkSource } from './lighting';
import { createTile, deserializeTile, posKey, type SerializedTile, type TileEntity, type TileKind } from './tileentity';

export interface BlockHooks {
  /** A neighbouring block changed; the block at (x,y,z) may react. */
  neighborChanged(dim: Dimension, x: number, y: number, z: number, fromX: number, fromY: number, fromZ: number): void;
  /** A scheduled tick fired for the block at (x,y,z). */
  scheduledTick(dim: Dimension, x: number, y: number, z: number, id: number): void;
  /** A random tick hit the block at (x,y,z). */
  randomTick(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): void;
  /** Called after any block change (sounds, particles, redstone bookkeeping). */
  blockChanged(dim: Dimension, x: number, y: number, z: number, oldId: number, newId: number): void;
}

interface Scheduled {
  x: number; y: number; z: number; id: number; time: number;
}

export class Dimension implements ChunkSource {
  readonly chunks = new Map<number, Chunk>();
  readonly tiles = new Map<number, TileEntity>();
  readonly light: LightEngine;
  readonly hasSky: boolean;
  /** Chunks whose light or blocks changed and need a new mesh. */
  readonly dirtyChunks = new Set<Chunk>();
  /** Keys of chunks that exist in the save file (loaded instead of generated). */
  readonly savedChunkKeys = new Set<number>();
  /** Chunks loaded from a save must never receive population writes again. */
  readonly protectedChunks = new Set<number>();
  hooks: BlockHooks | null = null;
  /** Scheduled block updates, keyed by target game tick. */
  private scheduled: Scheduled[] = [];
  private scheduledKeys = new Set<number>();
  currentTick = 0;

  constructor(readonly id: DimId, readonly generator: DimensionGenerator, hasSky: boolean) {
    this.hasSky = hasSky;
    this.light = new LightEngine(this);
  }

  // -------------------------------------------------------------------------
  // Chunk access
  // -------------------------------------------------------------------------
  getChunk(cx: number, cz: number): Chunk | undefined {
    return this.chunks.get(chunkKey(cx, cz));
  }

  getChunkAt(x: number, z: number): Chunk | undefined {
    return this.chunks.get(chunkKey(x >> 4, z >> 4));
  }

  markLightDirty(chunk: Chunk): void {
    chunk.dirty = true;
    this.dirtyChunks.add(chunk);
  }

  /** A chunk is "final" when every population pass that can write into it has run. */
  isFinal(cx: number, cz: number): boolean {
    for (let dx = -1; dx <= 0; dx++) {
      for (let dz = -1; dz <= 0; dz++) {
        const c = this.getChunk(cx + dx, cz + dz);
        if (!c || c.state < ChunkState.POPULATED) return false;
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Block access (world coordinates)
  // -------------------------------------------------------------------------
  getBlock(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return 0;
    return c.blocks[blockIndex(x & 15, y, z & 15)];
  }

  getMeta(x: number, y: number, z: number): number {
    if (y < 0 || y >= WORLD_HEIGHT) return 0;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return 0;
    return c.meta[blockIndex(x & 15, y, z & 15)];
  }

  /** Whether the chunk containing (x,z) is loaded and ready for gameplay. */
  isLoaded(x: number, z: number): boolean {
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    return !!c && c.lit;
  }

  getSkyLight(x: number, y: number, z: number): number {
    return this.light.getLight(x, y, z)[0];
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.light.getLight(x, y, z)[1];
  }

  /** Effective light level for mob spawning / crops, given the current sky darkening. */
  getLightLevel(x: number, y: number, z: number, skyDarken: number): number {
    const [s, b] = this.light.getLight(x, y, z);
    return Math.max(b, s - skyDarken);
  }

  /**
   * Set a block. When `notify` is true neighbours are informed and lighting,
   * meshing and save bookkeeping are updated.
   */
  setBlock(x: number, y: number, z: number, id: number, meta = 0, notify = true): boolean {
    if (y < 0 || y >= WORLD_HEIGHT) return false;
    const c = this.chunks.get(chunkKey(x >> 4, z >> 4));
    if (!c) return false;
    const i = blockIndex(x & 15, y, z & 15);
    const oldId = c.blocks[i];
    const oldMeta = c.meta[i];
    if (oldId === id && oldMeta === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    c.modified = true;
    c.sectionMask |= 1 << (y >> 4);

    if (oldId !== id) {
      // Remove stale tile entities.
      const key = posKey(x, y, z);
      const tile = this.tiles.get(key);
      if (tile && !tileMatches(tile.kind, id)) this.tiles.delete(key);
      if (c.lit && (OPAQUE_LIGHT[oldId] !== OPAQUE_LIGHT[id] || LIGHT_EMISSION[oldId] !== LIGHT_EMISSION[id] || LIGHT_EMISSION[oldId] > 0)) {
        this.light.onBlockChanged(x, y, z, oldId, id);
      }
    }
    this.markBlockDirty(x, y, z);
    if (notify && this.hooks) {
      this.hooks.blockChanged(this, x, y, z, oldId, id);
      this.notifyNeighbors(x, y, z);
    }
    return true;
  }

  /** Change only the metadata of a block. */
  setMeta(x: number, y: number, z: number, meta: number, notify = true): void {
    this.setBlock(x, y, z, this.getBlock(x, y, z), meta, notify);
  }

  notifyNeighbors(x: number, y: number, z: number): void {
    if (!this.hooks) return;
    this.hooks.neighborChanged(this, x + 1, y, z, x, y, z);
    this.hooks.neighborChanged(this, x - 1, y, z, x, y, z);
    this.hooks.neighborChanged(this, x, y + 1, z, x, y, z);
    this.hooks.neighborChanged(this, x, y - 1, z, x, y, z);
    this.hooks.neighborChanged(this, x, y, z + 1, x, y, z);
    this.hooks.neighborChanged(this, x, y, z - 1, x, y, z);
  }

  /** Mark the chunk (and bordering chunks when on an edge) for re-meshing. */
  markBlockDirty(x: number, y: number, z: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    const lx = x & 15;
    const lz = z & 15;
    this.markChunkDirty(cx, cz);
    if (lx === 0) this.markChunkDirty(cx - 1, cz);
    if (lx === 15) this.markChunkDirty(cx + 1, cz);
    if (lz === 0) this.markChunkDirty(cx, cz - 1);
    if (lz === 15) this.markChunkDirty(cx, cz + 1);
    if (lx === 0 && lz === 0) this.markChunkDirty(cx - 1, cz - 1);
    if (lx === 15 && lz === 0) this.markChunkDirty(cx + 1, cz - 1);
    if (lx === 0 && lz === 15) this.markChunkDirty(cx - 1, cz + 1);
    if (lx === 15 && lz === 15) this.markChunkDirty(cx + 1, cz + 1);
  }

  markChunkDirty(cx: number, cz: number): void {
    const c = this.getChunk(cx, cz);
    if (c) {
      c.dirty = true;
      this.dirtyChunks.add(c);
    }
  }

  // -------------------------------------------------------------------------
  // Tile entities
  // -------------------------------------------------------------------------
  getTile(x: number, y: number, z: number): TileEntity | undefined {
    return this.tiles.get(posKey(x, y, z));
  }

  getOrCreateTile(kind: TileKind, x: number, y: number, z: number): TileEntity {
    const key = posKey(x, y, z);
    let t = this.tiles.get(key);
    if (!t || t.kind !== kind) {
      t = createTile(kind, x, y, z);
      this.tiles.set(key, t);
    }
    const c = this.getChunkAt(x, z);
    if (c) c.modified = true;
    return t;
  }

  removeTile(x: number, y: number, z: number): TileEntity | undefined {
    const key = posKey(x, y, z);
    const t = this.tiles.get(key);
    this.tiles.delete(key);
    return t;
  }

  addSerializedTile(s: SerializedTile): void {
    this.tiles.set(posKey(s.x, s.y, s.z), deserializeTile(s));
  }

  tilesInChunk(cx: number, cz: number): TileEntity[] {
    const out: TileEntity[] = [];
    for (const t of this.tiles.values()) {
      if (t.x >> 4 === cx && t.z >> 4 === cz) out.push(t);
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // Scheduled block updates
  // -------------------------------------------------------------------------
  scheduleTick(x: number, y: number, z: number, delay: number): void {
    const key = posKey(x, y, z);
    if (this.scheduledKeys.has(key)) return;
    this.scheduledKeys.add(key);
    this.scheduled.push({ x, y, z, id: this.getBlock(x, y, z), time: this.currentTick + Math.max(1, delay) });
  }

  /** Run due scheduled ticks; a cap keeps huge fluid floods from stalling a frame. */
  runScheduledTicks(maxUpdates = 2000): void {
    if (this.scheduled.length === 0 || !this.hooks) return;
    const due: Scheduled[] = [];
    const later: Scheduled[] = [];
    for (const s of this.scheduled) {
      if (s.time <= this.currentTick && due.length < maxUpdates) due.push(s);
      else later.push(s);
    }
    this.scheduled = later;
    for (const s of due) this.scheduledKeys.delete(posKey(s.x, s.y, s.z));
    for (const s of due) {
      if (!this.isLoaded(s.x, s.z)) continue;
      this.hooks.scheduledTick(this, s.x, s.y, s.z, this.getBlock(s.x, s.y, s.z));
    }
  }

  get pendingTickCount(): number {
    return this.scheduled.length;
  }

  // -------------------------------------------------------------------------
  // Chunk lifecycle
  // -------------------------------------------------------------------------
  /** Insert a chunk produced by the terrain generator. */
  addGeneratedChunk(gen: GeneratedChunk): Chunk {
    const chunk = new Chunk(gen.cx, gen.cz, gen.blocks, gen.meta);
    chunk.biomes.set(gen.biomes);
    this.chunks.set(chunkKey(gen.cx, gen.cz), chunk);
    for (const t of gen.tiles) {
      const key = posKey(t.x, t.y, t.z);
      if (!this.tiles.has(key)) this.tiles.set(key, deserializeTile(t));
    }
    return chunk;
  }

  /** Insert a chunk restored from the save file (already populated). */
  addSavedChunk(cx: number, cz: number, blocks: Uint8Array, meta: Uint8Array, biomes: Uint8Array, tiles: SerializedTile[]): Chunk {
    const chunk = new Chunk(cx, cz, blocks, meta);
    chunk.biomes.set(biomes);
    chunk.state = ChunkState.POPULATED;
    chunk.modified = false;
    const key = chunkKey(cx, cz);
    this.chunks.set(key, chunk);
    this.protectedChunks.add(key);
    for (const t of tiles) this.tiles.set(posKey(t.x, t.y, t.z), deserializeTile(t));
    return chunk;
  }

  /** Run the population pass for chunk (cx, cz), writing into its 2x2 area. */
  populate(cx: number, cz: number): void {
    const chunk = this.getChunk(cx, cz);
    if (!chunk || chunk.state >= ChunkState.POPULATED) return;
    const minX = cx * CHUNK_SIZE;
    const minZ = cz * CHUNK_SIZE;
    const maxX = minX + CHUNK_SIZE * 2;
    const maxZ = minZ + CHUNK_SIZE * 2;
    const inArea = (x: number, z: number) => x >= minX && x < maxX && z >= minZ && z < maxZ;
    const access: PopulateAccess = {
      getBlock: (x, y, z) => (inArea(x, z) ? this.getBlock(x, y, z) : 0),
      getMeta: (x, y, z) => (inArea(x, z) ? this.getMeta(x, y, z) : 0),
      setBlock: (x, y, z, id, meta = 0) => {
        if (!inArea(x, z) || y < 0 || y >= WORLD_HEIGHT) return;
        const key = chunkKey(x >> 4, z >> 4);
        if (this.protectedChunks.has(key)) return;
        const c = this.chunks.get(key);
        if (!c) return;
        const i = blockIndex(x & 15, y, z & 15);
        c.blocks[i] = id;
        c.meta[i] = meta;
      },
      addTile: (t) => {
        if (!inArea(t.x, t.z)) return;
        if (this.protectedChunks.has(chunkKey(t.x >> 4, t.z >> 4))) return;
        this.tiles.set(posKey(t.x, t.y, t.z), deserializeTile(t));
      },
      biomeAt: (x, z) => {
        const c = this.getChunkAt(x, z);
        return c ? c.biomes[(x & 15) | ((z & 15) << 4)] : 0;
      },
      topY: (x, z) => {
        if (!inArea(x, z)) return -1;
        const c = this.getChunkAt(x, z);
        return c ? c.topBlockY(x & 15, z & 15) : -1;
      },
    };
    this.generator.populate(access, cx, cz);
    chunk.state = ChunkState.POPULATED;
  }

  /** Remove a chunk from memory. The caller must persist modified chunks first. */
  unloadChunk(chunk: Chunk): void {
    const key = chunkKey(chunk.cx, chunk.cz);
    for (const t of this.tilesInChunk(chunk.cx, chunk.cz)) this.tiles.delete(posKey(t.x, t.y, t.z));
    if (chunk.modified) this.savedChunkKeys.add(key);
    this.chunks.delete(key);
    this.dirtyChunks.delete(chunk);
    this.protectedChunks.delete(key);
  }

  /** Find the highest solid (colliding) block in a column. */
  highestSolidY(x: number, z: number): number {
    for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
      const id = this.getBlock(x, y, z);
      if (id !== 0 && getBlock(id).collides) return y;
    }
    return -1;
  }

  isFluid(x: number, y: number, z: number): number {
    return IS_FLUID[this.getBlock(x, y, z)];
  }

  isAir(x: number, y: number, z: number): boolean {
    return this.getBlock(x, y, z) === BlockId.AIR;
  }
}

function tileMatches(kind: TileKind, id: number): boolean {
  switch (kind) {
    case 'chest': return id === BlockId.CHEST;
    case 'furnace': return id === BlockId.FURNACE || id === BlockId.LIT_FURNACE;
    case 'brewing': return id === BlockId.BREWING_STAND;
    case 'spawner': return id === BlockId.SPAWNER;
    case 'sign': return id === BlockId.SIGN || id === BlockId.WALL_SIGN;
    case 'note': return id === BlockId.NOTE_BLOCK;
    default: return false;
  }
}


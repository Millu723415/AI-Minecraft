/**
 * IndexedDB persistence. One database holds every world:
 *   worlds   : worldId -> WorldRecord
 *   chunks   : "worldId|dim|cx|cz" -> ChunkRecord (only chunks that differ from the generator)
 *   entities : "worldId|dim|cx|cz" -> EntityData[]
 * Writes happen in single readwrite transactions so a save is all-or-nothing.
 */

import type { EntityData } from '../entity/entity';
import type { SerializedTile } from '../world/tileentity';
import type { WorldMeta } from '../world/world';

export const SAVE_FORMAT_VERSION = 1;
export const GAME_VERSION = '1.0.0';

export interface WorldState {
  totalTime: number;
  dayTime: number;
  raining: boolean;
  rainTime: number;
  spawn: [number, number, number];
  dragonKilled: boolean;
  endInitialized: boolean;
  endingSeen: boolean;
  enchantSeed: number;
}

export interface WorldRecord {
  id: string;
  saveFormatVersion: number;
  generatorVersion: number;
  gameVersion: string;
  meta: WorldMeta;
  state: WorldState;
  player: EntityData | null;
  playerDim: number;
  /** Non-chunk entities (dragon, crystals) keyed by dimension. */
  globalEntities?: Record<string, EntityData[]>;
}

export interface ChunkRecord {
  v: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  biomes: Uint8Array;
  tiles: SerializedTile[];
}

const DB_NAME = 'blockworld';
const DB_VERSION = 1;

export function chunkRecordKey(worldId: string, dim: number, cx: number, cz: number): string {
  return `${worldId}|${dim}|${cx}|${cz}`;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export class Storage {
  private db: IDBDatabase | null = null;

  async open(): Promise<void> {
    if (this.db) return;
    this.db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds');
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
        if (!db.objectStoreNames.contains('entities')) db.createObjectStore('entities');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  private get database(): IDBDatabase {
    if (!this.db) throw new Error('storage not open');
    return this.db;
  }

  async listWorlds(): Promise<WorldRecord[]> {
    await this.open();
    const tx = this.database.transaction('worlds', 'readonly');
    const all = await req(tx.objectStore('worlds').getAll() as IDBRequest<WorldRecord[]>);
    return all.map(migrateWorld).sort((a, b) => b.meta.lastPlayed - a.meta.lastPlayed);
  }

  async getWorld(id: string): Promise<WorldRecord | null> {
    await this.open();
    const tx = this.database.transaction('worlds', 'readonly');
    const rec = await req(tx.objectStore('worlds').get(id) as IDBRequest<WorldRecord | undefined>);
    return rec ? migrateWorld(rec) : null;
  }

  /** Keys (dim, cx, cz) of all saved chunks for a world. */
  async chunkKeys(worldId: string, store: 'chunks' | 'entities' = 'chunks'): Promise<[number, number, number][]> {
    await this.open();
    const tx = this.database.transaction(store, 'readonly');
    const range = IDBKeyRange.bound(`${worldId}|`, `${worldId}|￿`);
    const keys = await req(tx.objectStore(store).getAllKeys(range));
    return keys.map((k) => {
      const parts = String(k).split('|');
      return [Number(parts[1]), Number(parts[2]), Number(parts[3])] as [number, number, number];
    });
  }

  async getChunk(worldId: string, dim: number, cx: number, cz: number): Promise<ChunkRecord | null> {
    await this.open();
    const tx = this.database.transaction('chunks', 'readonly');
    const rec = await req(tx.objectStore('chunks').get(chunkRecordKey(worldId, dim, cx, cz)) as IDBRequest<ChunkRecord | undefined>);
    return rec ?? null;
  }

  async getEntities(worldId: string, dim: number, cx: number, cz: number): Promise<EntityData[] | null> {
    await this.open();
    const tx = this.database.transaction('entities', 'readonly');
    const rec = await req(tx.objectStore('entities').get(chunkRecordKey(worldId, dim, cx, cz)) as IDBRequest<EntityData[] | undefined>);
    return rec ?? null;
  }

  /** Write a world record plus chunk and entity records atomically. */
  async write(
    world: WorldRecord,
    chunks: Map<string, ChunkRecord>,
    entities: Map<string, EntityData[]>,
  ): Promise<void> {
    await this.open();
    const tx = this.database.transaction(['worlds', 'chunks', 'entities'], 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error('save aborted'));
    });
    const cs = tx.objectStore('chunks');
    for (const [k, v] of chunks) cs.put(v, k);
    const es = tx.objectStore('entities');
    for (const [k, v] of entities) es.put(v, k);
    tx.objectStore('worlds').put(world, world.id);
    await done;
  }

  async deleteWorld(id: string): Promise<void> {
    await this.open();
    const tx = this.database.transaction(['worlds', 'chunks', 'entities'], 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    tx.objectStore('worlds').delete(id);
    const range = IDBKeyRange.bound(`${id}|`, `${id}|￿`);
    tx.objectStore('chunks').delete(range);
    tx.objectStore('entities').delete(range);
    await done;
  }
}

/** Upgrade older world records to the current format. */
export function migrateWorld(rec: WorldRecord): WorldRecord {
  const r = { ...rec };
  if (!r.saveFormatVersion) r.saveFormatVersion = 1;
  if (!r.state) {
    r.state = { totalTime: 0, dayTime: 1000, raining: false, rainTime: 12000, spawn: [0, 80, 0], dragonKilled: false, endInitialized: false, endingSeen: false, enchantSeed: 1 };
  }
  if (r.state.enchantSeed === undefined) r.state.enchantSeed = 1;
  // Future migrations: if (r.saveFormatVersion < 2) { ...; r.saveFormatVersion = 2; }
  return r;
}

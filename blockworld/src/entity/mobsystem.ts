/**
 * Mob management: the entity factory (for saves), natural spawning with
 * biome/light/dimension rules and mob caps, spawner blocks, initial
 * world-generation creatures, player<->entity interactions and the End fight
 * setup.
 */

import { BlockId } from '../blocks/ids';
import { getBlock, IS_FLUID, SOLID } from '../blocks/registry';
import { ItemId } from '../items/ids';
import { Dim, WORLD_HEIGHT } from '../world/constants';
import type { Dimension } from '../world/dimension';
import type { Chunk } from '../world/chunk';
import type { SpawnerTile } from '../world/tileentity';
import { Biome, biomeDef } from '../worldgen/biomes';
import type { Game } from '../game/game';
import { Entity, type EntityData } from './entity';
import { LivingEntity } from './living';
import { ItemEntity, XpOrb, FallingBlock, PrimedTnt } from './items';
import { Arrow } from './projectiles';
import { Mob } from './mob';
import { Pig, Cow, Mooshroom, Sheep, Chicken, Squid, Wolf } from './mobs/animals';
import { Zombie, Skeleton, Creeper, Spider, CaveSpider, Slime, MagmaCube, Enderman, ZombiePigman, Silverfish, Ghast, Blaze, Villager } from './mobs/monsters';
import { EnderDragon, EnderCrystal } from './mobs/dragon';
import { Boat, Minecart, dismount } from './vehicles';
import { FishingHook } from './fishing';
import { hashCombine } from '../core/rng';

type Factory = () => Entity;

const FACTORIES: Record<string, Factory> = {
  pig: () => new Pig(), cow: () => new Cow(), mooshroom: () => new Mooshroom(), sheep: () => new Sheep(),
  chicken: () => new Chicken(), squid: () => new Squid(), wolf: () => new Wolf(), zombie: () => new Zombie(),
  skeleton: () => new Skeleton(), creeper: () => new Creeper(), spider: () => new Spider(), cave_spider: () => new CaveSpider(),
  slime: () => new Slime(), magma_cube: () => new MagmaCube(), enderman: () => new Enderman(), zombie_pigman: () => new ZombiePigman(),
  silverfish: () => new Silverfish(), ghast: () => new Ghast(), blaze: () => new Blaze(), villager: () => new Villager(),
  ender_dragon: () => new EnderDragon(), ender_crystal: () => new EnderCrystal(), boat: () => new Boat(), minecart: () => new Minecart(),
  item: () => new ItemEntity({ id: 1, count: 1, meta: 0, damage: 0 }), xp: () => new XpOrb(1),
  falling_block: () => new FallingBlock(BlockId.SAND, 0), tnt: () => new PrimedTnt(), arrow: () => new Arrow(),
};

interface SpawnEntry { type: string; weight: number; min: number; max: number }

const OVERWORLD_MONSTERS: SpawnEntry[] = [
  { type: 'spider', weight: 10, min: 4, max: 4 }, { type: 'zombie', weight: 10, min: 4, max: 4 },
  { type: 'skeleton', weight: 10, min: 4, max: 4 }, { type: 'creeper', weight: 10, min: 4, max: 4 },
  { type: 'slime', weight: 10, min: 4, max: 4 }, { type: 'enderman', weight: 1, min: 1, max: 4 },
];
const OVERWORLD_ANIMALS: SpawnEntry[] = [
  { type: 'sheep', weight: 12, min: 4, max: 4 }, { type: 'pig', weight: 10, min: 4, max: 4 },
  { type: 'chicken', weight: 10, min: 4, max: 4 }, { type: 'cow', weight: 8, min: 4, max: 4 },
];
const NETHER_MONSTERS: SpawnEntry[] = [
  { type: 'ghast', weight: 10, min: 4, max: 4 }, { type: 'zombie_pigman', weight: 10, min: 4, max: 4 },
  { type: 'magma_cube', weight: 1, min: 4, max: 4 },
];
const FORTRESS_MONSTERS: SpawnEntry[] = [
  { type: 'blaze', weight: 10, min: 2, max: 3 }, { type: 'zombie_pigman', weight: 5, min: 4, max: 4 },
  { type: 'magma_cube', weight: 3, min: 4, max: 4 },
];
const END_MONSTERS: SpawnEntry[] = [{ type: 'enderman', weight: 10, min: 4, max: 4 }];

function pick(list: SpawnEntry[]): SpawnEntry {
  const total = list.reduce((s, e) => s + e.weight, 0);
  let r = Math.random() * total;
  for (const e of list) {
    r -= e.weight;
    if (r < 0) return e;
  }
  return list[0];
}

export class MobSystem {
  private hostileTimer = 0;
  private animalTimer = 0;
  private waterTimer = 0;
  private hook: FishingHook | null = null;

  constructor(readonly game: Game) {}

  create(type: string, data?: EntityData): Entity | null {
    const f = FACTORIES[type];
    if (!f) return null;
    const e = f();
    if (data) e.deserialize(data);
    return e;
  }

  isHostile(e: Entity): boolean {
    return e instanceof Mob && (e.category === 'hostile' || (e.type === 'zombie_pigman' && !!e.target));
  }

  /** Entities saved with the world rather than their chunk. */
  isGlobal(e: Entity): boolean {
    return e.type === 'ender_dragon' || e.type === 'ender_crystal';
  }

  /** Hostile mobs are not saved when their chunk unloads. */
  despawnsOnUnload(e: Entity): boolean {
    return e instanceof Mob && e.canDespawn();
  }

  interact(e: Entity): boolean {
    void e;
    return false;
  }

  // ---------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------
  private count(dim: Dimension, category: string): number {
    let n = 0;
    for (const e of this.game.entitiesIn(dim)) {
      if (e instanceof Mob && !e.dead) {
        const c = e.category === 'neutral' ? 'hostile' : e.category;
        if (c === category) n++;
      }
    }
    return n;
  }

  tick(dim: Dimension): void {
    const g = this.game;
    if (g.state !== 'playing') return;
    this.hostileTimer++;
    if (this.hostileTimer >= 2) {
      this.hostileTimer = 0;
      if (g.difficulty > 0 && this.count(dim, 'hostile') < 70) this.spawnCycle(dim, 'hostile');
    }
    if (++this.animalTimer >= 400) {
      this.animalTimer = 0;
      if (dim.id === Dim.OVERWORLD && this.count(dim, 'passive') < 15) this.spawnCycle(dim, 'passive');
    }
    if (++this.waterTimer >= 40) {
      this.waterTimer = 0;
      if (dim.id === Dim.OVERWORLD && this.count(dim, 'water') < 5) this.spawnCycle(dim, 'water');
    }
    if (this.hook && this.hook.removed) this.hook = null;
    this.updateBoss(dim);
  }

  private spawnCycle(dim: Dimension, category: 'hostile' | 'passive' | 'water'): void {
    const p = this.game.player;
    const pcx = Math.floor(p.x) >> 4;
    const pcz = Math.floor(p.z) >> 4;
    const attempts = category === 'hostile' ? 3 : 6;
    for (let a = 0; a < attempts; a++) {
      const cx = pcx + Math.floor(Math.random() * 17) - 8;
      const cz = pcz + Math.floor(Math.random() * 17) - 8;
      const c = dim.getChunk(cx, cz);
      if (!c || !c.lit) continue;
      const x = cx * 16 + Math.floor(Math.random() * 16);
      const z = cz * 16 + Math.floor(Math.random() * 16);
      const top = Math.max(1, c.heightMap[(x & 15) | ((z & 15) << 4)] + 1);
      const y = Math.floor(Math.random() * Math.min(WORLD_HEIGHT, top + 1));
      this.tryPack(dim, c, x, y, z, category);
    }
  }

  private tryPack(dim: Dimension, c: Chunk, x0: number, y0: number, z0: number, category: 'hostile' | 'passive' | 'water'): void {
    const biome = biomeDef(c.biomes[(x0 & 15) | ((z0 & 15) << 4)]);
    let list: SpawnEntry[];
    if (dim.id === Dim.NETHER) list = this.game.inFortress(x0, y0, z0) ? FORTRESS_MONSTERS : NETHER_MONSTERS;
    else if (dim.id === Dim.END) list = END_MONSTERS;
    else if (category === 'water') list = [{ type: 'squid', weight: 10, min: 4, max: 4 }];
    else if (category === 'passive') {
      if (biome.id === Biome.MUSHROOM_ISLAND || biome.id === Biome.MUSHROOM_SHORE) list = [{ type: 'mooshroom', weight: 8, min: 4, max: 8 }];
      else if (biome.id === Biome.FOREST || biome.id === Biome.TAIGA) list = [...OVERWORLD_ANIMALS, { type: 'wolf', weight: 2, min: 4, max: 4 }];
      else if (biome.id === Biome.DESERT || biome.id === Biome.OCEAN || biome.id === Biome.FROZEN_OCEAN) return;
      else list = OVERWORLD_ANIMALS;
    } else {
      if (biome.id === Biome.MUSHROOM_ISLAND || biome.id === Biome.MUSHROOM_SHORE) return;
      list = OVERWORLD_MONSTERS;
    }
    if (category !== 'hostile' && dim.id !== Dim.OVERWORLD) return;
    const entry = pick(list);
    const n = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
    let spawned = 0;
    let x = x0; let y = y0; let z = z0;
    for (let i = 0; i < n * 3 && spawned < n; i++) {
      x += Math.floor(Math.random() * 6) - Math.floor(Math.random() * 6);
      z += Math.floor(Math.random() * 6) - Math.floor(Math.random() * 6);
      if (!this.canSpawnAt(dim, entry.type, category, x, y, z)) continue;
      const e = this.create(entry.type);
      if (!e) continue;
      e.setPosition(x + 0.5, y, z + 0.5);
      e.yaw = Math.random() * Math.PI * 2;
      if (!this.fitsAt(dim, e)) continue;
      this.game.spawn(e, dim);
      spawned++;
    }
  }

  private canSpawnAt(dim: Dimension, type: string, category: string, x: number, y: number, z: number): boolean {
    if (y < 1 || y >= WORLD_HEIGHT - 2) return false;
    if (!dim.isLoaded(x, z)) return false;
    const p = this.game.player;
    const dx = x + 0.5 - p.x; const dy = y - p.y; const dz = z + 0.5 - p.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < 24 * 24) return false;
    const sx = this.game.world.spawnX - x; const sz = this.game.world.spawnZ - z;
    if (dim.id === Dim.OVERWORLD && sx * sx + sz * sz < 24 * 24) return false;
    if (category === 'water') {
      return IS_FLUID[dim.getBlock(x, y, z)] === 1 && IS_FLUID[dim.getBlock(x, y + 1, z)] === 1 && !SOLID[dim.getBlock(x, y - 1, z)];
    }
    const below = dim.getBlock(x, y - 1, z);
    if (!SOLID[below] || below === BlockId.BEDROCK || below === BlockId.GLASS || below === BlockId.LEAVES) return false;
    const feet = dim.getBlock(x, y, z);
    const head = dim.getBlock(x, y + 1, z);
    if (getBlock(feet).collides || IS_FLUID[feet] || getBlock(head).collides || IS_FLUID[head]) return false;
    if (category === 'passive') {
      if (type !== 'mooshroom' && below !== BlockId.GRASS) return false;
      if (type === 'mooshroom' && below !== BlockId.MYCELIUM) return false;
      return dim.getLightLevel(x, y, z, 0) > 8;
    }
    // Monsters need darkness (classic randomised light check).
    if (type === 'ghast' || type === 'blaze' || type === 'magma_cube' || type === 'zombie_pigman') return true;
    if (type === 'slime') {
      const slimeChunk = (hashCombine(this.game.world.seed, x >> 4, z >> 4, 987234911) % 10) === 0;
      if (dim.id === Dim.OVERWORLD && !(slimeChunk && y < 40)) return false;
    }
    const sky = dim.getSkyLight(x, y, z);
    if (sky > Math.floor(Math.random() * 32)) return false;
    const light = dim.getLightLevel(x, y, z, this.game.skyDarken());
    return light <= Math.floor(Math.random() * 8);
  }

  private fitsAt(dim: Dimension, e: Entity): boolean {
    const b = e.box;
    for (let x = Math.floor(b.minX); x <= Math.floor(b.maxX); x++) {
      for (let y = Math.floor(b.minY); y <= Math.floor(b.maxY); y++) {
        for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ); z++) {
          const id = dim.getBlock(x, y, z);
          if (getBlock(id).collides || (IS_FLUID[id] && e.type !== 'squid' && e.type !== 'ghast')) return false;
        }
      }
    }
    return true;
  }

  /** Creatures placed when a chunk is first generated (animals, villagers). */
  spawnInitialCreatures(dim: Dimension, chunk: Chunk): void {
    if (dim.id !== Dim.OVERWORLD) return;
    const villagers = this.game.villagersForChunk(chunk.cx, chunk.cz);
    for (const [x, y, z] of villagers) {
      const v = new Villager();
      v.setPosition(x + 0.5, y, z + 0.5);
      this.game.spawn(v, dim);
    }
    const r = hashCombine(this.game.world.seed, chunk.cx, chunk.cz, 555) / 4294967296;
    if (r > 0.1) return;
    const cx = chunk.cx * 16 + 8; const cz = chunk.cz * 16 + 8;
    const biome = biomeDef(chunk.biomes[8 | (8 << 4)]);
    let list = OVERWORLD_ANIMALS;
    if (biome.id === Biome.MUSHROOM_ISLAND) list = [{ type: 'mooshroom', weight: 1, min: 4, max: 8 }];
    else if (biome.id === Biome.DESERT || biome.id === Biome.OCEAN || biome.id === Biome.FROZEN_OCEAN || biome.id === Biome.RIVER) return;
    else if ((biome.id === Biome.FOREST || biome.id === Biome.TAIGA) && Math.random() < 0.15) list = [{ type: 'wolf', weight: 1, min: 2, max: 4 }];
    const entry = pick(list);
    const n = entry.min + Math.floor(Math.random() * (entry.max - entry.min + 1));
    for (let i = 0; i < n; i++) {
      const x = cx + Math.floor(Math.random() * 12) - 6;
      const z = cz + Math.floor(Math.random() * 12) - 6;
      const y = dim.highestSolidY(x, z) + 1;
      if (y <= 1) continue;
      const below = dim.getBlock(x, y - 1, z);
      if (below !== BlockId.GRASS && below !== BlockId.MYCELIUM) continue;
      const e = this.create(entry.type);
      if (!e) continue;
      e.setPosition(x + 0.5, y, z + 0.5);
      e.yaw = Math.random() * Math.PI * 2;
      this.game.spawn(e, dim);
    }
  }

  tickSpawner(dim: Dimension, t: SpawnerTile): void {
    const p = this.game.player;
    if (p.dim !== dim) return;
    const dx = p.x - (t.x + 0.5); const dy = p.y - (t.y + 0.5); const dz = p.z - (t.z + 0.5);
    if (dx * dx + dy * dy + dz * dz > 16 * 16) return;
    if (this.game.tickCount % 3 === 0) {
      this.game.particles('smoke', dim, t.x + Math.random(), t.y + Math.random(), t.z + Math.random(), 1, { spread: 0 });
      this.game.particles('flame', dim, t.x + Math.random(), t.y + Math.random(), t.z + Math.random(), 1, { spread: 0 });
    }
    if (t.delay > 0) { t.delay--; return; }
    t.delay = 200 + Math.floor(Math.random() * 600);
    if (this.game.difficulty === 0 && t.mob !== 'pig') return;
    let nearby = 0;
    for (const e of this.game.entitiesIn(dim)) {
      if (e.type === t.mob && Math.abs(e.x - t.x) < 8 && Math.abs(e.y - t.y) < 4 && Math.abs(e.z - t.z) < 8) nearby++;
    }
    if (nearby >= 6) return;
    const n = 1 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const e = this.create(t.mob);
      if (!(e instanceof LivingEntity)) return;
      const x = t.x + 0.5 + (Math.random() - Math.random()) * 4;
      const y = t.y + Math.floor(Math.random() * 3) - 1;
      const z = t.z + 0.5 + (Math.random() - Math.random()) * 4;
      e.setPosition(x, y, z);
      e.yaw = Math.random() * Math.PI * 2;
      if (!this.fitsAt(dim, e)) continue;
      if (!SOLID[dim.getBlock(Math.floor(x), Math.floor(y) - 1, Math.floor(z))] && e.type !== 'blaze') continue;
      if (dim.getBlockLight(Math.floor(x), Math.floor(y), Math.floor(z)) > 11 && e.type !== 'blaze') continue;
      this.game.spawn(e, dim);
      this.game.particles('explosion', dim, x, y + 0.5, z, 4, { spread: 0.4 });
    }
  }

  // ---------------------------------------------------------------------------
  // Vehicles, fishing and the End
  // ---------------------------------------------------------------------------
  spawnVehicle(kind: 'boat' | 'minecart', dim: Dimension, x: number, y: number, z: number): void {
    const v = kind === 'boat' ? new Boat() : new Minecart();
    v.setPosition(x, y, z);
    v.yaw = this.game.player.yaw;
    this.game.spawn(v, dim);
  }

  castFishingRod(): void {
    const g = this.game;
    const p = g.player;
    if (this.hook && !this.hook.removed) {
      const cost = this.hook.retrieve(g);
      this.hook = null;
      if (cost > 0) g.interaction.damageHeld(cost);
      return;
    }
    this.hook = new FishingHook(p);
    g.spawn(this.hook, p.dim);
    g.playSound('random.bow', p.x, p.y, p.z, 0.5, 0.4);
  }

  /** First arrival in the End: spawn the dragon and crystals on the pillars. */
  onEnterEnd(): void {
    const g = this.game;
    const dim = g.dim;
    if (g.world.endInitialized) return;
    g.world.endInitialized = true;
    if (g.world.dragonKilled) return;
    const dragon = new EnderDragon();
    dragon.setPosition(0, 90, -40);
    g.spawn(dragon, dim);
    for (const [x, y, z] of g.endPillarTops()) {
      const c = new EnderCrystal();
      c.setPosition(x + 0.5, y + 1, z + 0.5);
      dim.setBlock(x, y, z, BlockId.BEDROCK, 0);
      g.spawn(c, dim);
    }
  }

  private updateBoss(dim: Dimension): void {
    const g = this.game;
    let boss: EnderDragon | null = null;
    if (dim.id === Dim.END) {
      for (const e of g.entitiesIn(dim)) if (e instanceof EnderDragon && !e.removed) { boss = e; break; }
    }
    g.boss = boss ? { name: 'Ender Dragon', health: boss.health, maxHealth: boss.maxHealth } : null;
  }

  /** Right-click entity behaviours not handled by the entity itself. */
  handleEntityUse(e: Entity): boolean {
    if (e instanceof Boat || e instanceof Minecart) {
      const p = this.game.player;
      if (p.vehicle === e) dismount(p);
      return true;
    }
    return false;
  }
}

export { ItemId };

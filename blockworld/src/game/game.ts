/**
 * A running world session: fixed-step simulation at 20 ticks per second with
 * interpolated rendering, chunk streaming, entities, block behaviours,
 * dimensions and persistence.
 */

import * as THREE from 'three';
import type { Renderer, CameraState, HandState } from '../render/renderer';
import { ChunkMesher } from '../render/mesher';
import { EntityRenderer } from '../render/entityrenderer';
import { ParticleSystem } from '../render/particles';
import { World } from '../world/world';
import { ChunkManager } from '../world/chunkmanager';
import { GenerationPool } from '../world/genpool';
import { createGenerator } from '../worldgen/index';
import { Dim, WORLD_HEIGHT, chunkKey, type DimId } from '../world/constants';
import type { Dimension } from '../world/dimension';
import type { Chunk } from '../world/chunk';
import { Player } from '../entity/player';
import { Entity, type EntityData } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { EntityManager } from '../entity/manager';
import { ItemEntity, XpOrb, splitXp } from '../entity/items';
import { Arrow } from '../entity/projectiles';
import { deathMessage } from '../entity/damage';
import type { Input } from './input';
import type { Settings } from './settings';
import type { GameContext, ParticleKind, ParticleOptions } from './context';
import { Interaction, soundGroup, type InteractionHost, type ScreenRequest } from './interaction';
import { BlockBehaviors } from '../world/behaviors';
import { Redstone } from '../world/redstone';
import { explode } from '../world/explosion';
import { cloneStack, createStack, type ItemStack } from '../items/stack';
import { BlockId } from '../blocks/ids';
import { getBlock, IS_FLUID, RANDOM_TICK, SOLID } from '../blocks/registry';
import { blockIndex } from '../world/constants';
import { selectionBox } from '../render/shapes';
import { tickFurnace } from './furnace';
import { tickBrewing } from './brewing';
import { createPortalNear, findPortal } from '../world/portals';
import { rleDecode, rleEncode } from '../save/codec';
import { GAME_VERSION, SAVE_FORMAT_VERSION, chunkRecordKey, type ChunkRecord, type Storage, type WorldRecord } from '../save/storage';
import type { AudioEngine } from '../audio/audio';
import type { UIManager, UIHost } from '../ui/manager';
import { InventoryScreen, CraftingTableScreen, FurnaceScreen, ChestScreen, BrewingScreen, EnchantScreen } from '../ui/screens/containers';
import { SignScreen } from '../ui/screens/sign';
import type { ChestTile, FurnaceTile, BrewingTile, SignTile } from '../world/tileentity';
import { daylightFactor } from '../render/sky';
import { biomeDef } from '../worldgen/biomes';
import { OverworldGenerator } from '../worldgen/overworld';
import { MobSystem } from '../entity/mobsystem';
import { registerMobModels } from '../render/mobmodels';

registerMobModels();

const TICK_MS = 50;
const AUTOSAVE_TICKS = 20 * 45;

export type GameState = 'loading' | 'playing' | 'dead' | 'ending';

export interface GameCallbacks {
  onPause(): void;
  onDeath(message: string, score: number): void;
  onLoadingProgress(title: string, progress: number): void;
  onLoaded(): void;
  onEnding(): void;
  onQuit(): void;
}

export class Game implements GameContext, InteractionHost, UIHost {
  readonly mesher = new ChunkMesher();
  readonly entities = new EntityManager();
  readonly entityRenderer: EntityRenderer;
  readonly particleSystem: ParticleSystem;
  readonly behaviors: BlockBehaviors;
  readonly redstone: Redstone;
  readonly interaction: Interaction;
  readonly mobs: MobSystem;
  world: World;
  player: Player;
  dim!: Dimension;
  chunkManager!: ChunkManager;
  pool: GenerationPool;
  state: GameState = 'loading';
  tickCount = 0;
  private acc = 0;
  paused = false;
  private autosave = 0;
  private saving = false;
  private pendingChunks = new Map<string, ChunkRecord>();
  private pendingEntities = new Map<string, EntityData[]>();
  /** Chunks known to have an entity record in storage. */
  private entityRecordKeys = new Set<string>();
  /** Chunks whose entities were already initialised this session. */
  private entityChunksLoaded = new Set<string>();
  private loadingTarget: { title: string; placeFn: () => boolean } | null = null;
  private loadingTimer = 0;
  thirdPerson = false;
  hideGui = false;
  showDebug = false;
  private fps = 0;
  private fpsFrames = 0;
  private fpsTime = 0;
  private bobPhase = 0;
  private prevBob = 0;
  private bobAmount = 0;
  private prevBobAmount = 0;
  private fovMod = 1;
  private enchSeed = 1;
  private strongholds: [number, number][] | null = null;
  private stepAcc = 0;
  private ambientTimer = 200;
  private lastFrame = 0;
  boss: { name: string; health: number; maxHealth: number } | null = null;
  private portalSound = 0;
  private globalEntities: Record<string, EntityData[]> = {};
  frameTimes: number[] = [];

  constructor(
    readonly renderer: Renderer,
    readonly input: Input,
    readonly ui: UIManager,
    readonly audio: AudioEngine,
    readonly storage: Storage,
    public settings: Settings,
    readonly callbacks: GameCallbacks,
    record: WorldRecord,
  ) {
    this.world = new World(record.meta);
    this.pool = new GenerationPool(record.meta.seed, (d: DimId) => createGenerator(d, record.meta.seed));
    this.player = new Player();
    this.player.displayName = 'Player';
    this.behaviors = new BlockBehaviors(this);
    this.redstone = new Redstone(this);
    this.behaviors.redstone = this.redstone;
    this.interaction = new Interaction(this, input);
    this.mobs = new MobSystem(this);
    this.entityRenderer = new EntityRenderer(renderer.blockItemMaterial, renderer.spriteItemMaterial);
    (window as unknown as { __itemMats: Record<string, unknown> }).__itemMats = { block: renderer.blockItemMaterial, sprite: renderer.spriteItemMaterial };
    renderer.entityGroup.add(this.entityRenderer.group);
    this.particleSystem = new ParticleSystem(renderer.materials.atlas, renderer.materials.uniforms);
    renderer.particleGroup.add(this.particleSystem.points);
    this.particleSystem.solidAt = (x, y, z) => SOLID[this.dim.getBlock(x, y, z)] === 1;
    this.particleSystem.brightnessAt = (x, y, z) => this.brightness(x, y, z);
    this.applyState(record);
  }

  // =========================================================================
  // GameContext
  // =========================================================================
  get difficulty(): number {
    return this.world.meta.difficulty;
  }

  random(): number {
    return Math.random();
  }

  playSound(name: string, x: number, y: number, z: number, volume = 1, pitch = 1): void {
    this.audio.playAt(name, x, y, z, volume, pitch);
  }

  particles(kind: ParticleKind, dim: Dimension, x: number, y: number, z: number, count: number, opts?: ParticleOptions): void {
    if (dim !== this.dim) return;
    this.particleSystem.emit(kind, x, y, z, count, opts);
  }

  private particles_emit(kind: ParticleKind, dim: Dimension, x: number, y: number, z: number, count: number, opts?: ParticleOptions): void {
    this.particles(kind, dim, x, y, z, count, opts);
  }

  explode(dim: Dimension, x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null, breakBlocks = true): void {
    explode(this, dim, x, y, z, power, fire, source, breakBlocks, (bx, by, bz) => this.behaviors.igniteTnt(dim, bx, by, bz, true));
  }

  dropStack(dim: Dimension, x: number, y: number, z: number, stack: ItemStack, pickupDelay = 10, scatter = true): void {
    if (!stack || stack.count <= 0) return;
    const e = new ItemEntity(stack);
    e.setPosition(x, y - 0.125, z);
    if (scatter) {
      e.motionX = (Math.random() - 0.5) * 0.2;
      e.motionY = 0.2;
      e.motionZ = (Math.random() - 0.5) * 0.2;
    }
    e.pickupDelay = pickupDelay;
    this.spawn(e, dim);
  }

  dropXp(dim: Dimension, x: number, y: number, z: number, amount: number): void {
    for (const v of splitXp(amount)) {
      const orb = new XpOrb(v);
      orb.setPosition(x, y, z);
      orb.motionX = (Math.random() - 0.5) * 0.2;
      orb.motionY = Math.random() * 0.2;
      orb.motionZ = (Math.random() - 0.5) * 0.2;
      this.spawn(orb, dim);
    }
  }

  spawn(entity: Entity, dim: Dimension): void {
    this.entities.add(entity, dim);
  }

  entitiesIn(dim: Dimension): readonly Entity[] {
    return this.entities.list(dim);
  }

  skyDarken(): number {
    if (this.dim.id !== Dim.OVERWORLD) return 0;
    return Math.round((1 - daylightFactor(this.world.dayTime, this.world.rainStrength)) * 11);
  }

  travelTo(entity: Entity, dim: number): void {
    if (entity === this.player) this.changeDimension(dim as DimId, 'portal');
    else entity.removed = true;
  }

  message(text: string): void {
    this.ui.hud.message(text);
  }

  // =========================================================================
  // UIHost
  // =========================================================================
  dropItem(stack: ItemStack): void {
    const p = this.player;
    const e = new ItemEntity(stack);
    e.setPosition(p.x, p.y + p.eyeHeight - 0.3, p.z);
    const [lx, ly, lz] = p.lookVector();
    e.motionX = lx * 0.3 + (Math.random() - 0.5) * 0.02;
    e.motionY = ly * 0.3 + 0.1;
    e.motionZ = lz * 0.3 + (Math.random() - 0.5) * 0.02;
    e.pickupDelay = 40;
    this.spawn(e, p.dim);
  }

  onScreenOpened(): void {
    this.input.exitLock();
  }

  onScreenClosed(): void {
    if (this.state === 'playing') this.input.requestLock();
  }

  onCrafted(stack: ItemStack): void {
    this.audio.play2d('random.pop', 0.2, 1.4);
    void stack;
  }

  onSmelted(stack: ItemStack, tile: FurnaceTile): void {
    let xp = tile.storedXp;
    tile.storedXp = 0;
    let whole = Math.floor(xp);
    if (Math.random() < xp - whole) whole++;
    if (whole > 0) this.dropXp(this.dim, this.player.x, this.player.y + 0.5, this.player.z, whole);
    void stack; void xp;
  }

  onChestOpen(open: boolean): void {
    const p = this.player;
    this.audio.playAt(open ? 'chest.open' : 'chest.close', p.x, p.y, p.z, 0.5, 1);
  }

  enchantSeed(): number {
    return this.enchSeed;
  }

  onEnchanted(): void {
    this.enchSeed = (Math.random() * 0x7fffffff) | 0;
    this.audio.play2d('random.levelup', 0.5, 1.3);
  }

  // =========================================================================
  // InteractionHost
  // =========================================================================
  get ctx(): GameContext {
    return this;
  }

  openScreen(req: ScreenRequest): void {
    const d = this.dim;
    switch (req.kind) {
      case 'crafting': this.ui.open(new CraftingTableScreen()); break;
      case 'furnace': this.ui.open(new FurnaceScreen(d.getOrCreateTile('furnace', req.x, req.y, req.z) as FurnaceTile)); break;
      case 'brewing': this.ui.open(new BrewingScreen(d.getOrCreateTile('brewing', req.x, req.y, req.z) as BrewingTile)); break;
      case 'enchant': this.ui.open(new EnchantScreen(d, req.x, req.y, req.z)); break;
      case 'sign': this.ui.open(new SignScreen(d.getOrCreateTile('sign', req.x, req.y, req.z) as SignTile, () => undefined)); break;
      case 'chest': {
        const tiles: ChestTile[] = [];
        const main = d.getOrCreateTile('chest', req.x, req.y, req.z) as ChestTile;
        // Double chest: west/north half goes on top.
        let other: ChestTile | null = null;
        let otherFirst = false;
        for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          if (d.getBlock(req.x + dx, req.y, req.z + dz) === BlockId.CHEST) {
            other = d.getOrCreateTile('chest', req.x + dx, req.y, req.z + dz) as ChestTile;
            otherFirst = dx < 0 || dz < 0;
            break;
          }
        }
        if (other && otherFirst) tiles.push(other);
        tiles.push(main);
        if (other && !otherFirst) tiles.push(other);
        const c = d.getChunkAt(req.x, req.z);
        if (c) c.modified = true;
        this.ui.open(new ChestScreen(tiles, tiles.length > 1 ? 'Large Chest' : 'Chest'));
        break;
      }
    }
  }

  nearestStronghold(x: number, z: number): [number, number] | null {
    if (!this.strongholds) {
      const gen = createGenerator(Dim.OVERWORLD, this.world.seed) as OverworldGenerator;
      this.strongholds = gen.structures.strongholdPositions();
    }
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (const [sx, sz] of this.strongholds ?? []) {
      const d = (sx - x) ** 2 + (sz - z) ** 2;
      if (d < bestD) { bestD = d; best = [sx, sz]; }
    }
    return best;
  }

  trySleep(x: number, y: number, z: number): void {
    const p = this.player;
    if (this.dim.id !== Dim.OVERWORLD) {
      // Beds explode outside the Overworld (classic behaviour).
      this.dim.setBlock(x, y, z, 0, 0);
      this.explode(this.dim, x + 0.5, y + 0.5, z + 0.5, 5, true, null, true);
      return;
    }
    if (this.world.isDay()) {
      this.message('You can only sleep at night');
      return;
    }
    if (Math.abs(p.x - x - 0.5) > 3 || Math.abs(p.y - y) > 2 || Math.abs(p.z - z - 0.5) > 3) {
      this.message('You are too far away from the bed');
      return;
    }
    for (const e of this.entities.list(this.dim)) {
      if (e instanceof LivingEntity && !e.dead && this.mobs.isHostile(e) && Math.abs(e.x - x) < 8 && Math.abs(e.y - y) < 5 && Math.abs(e.z - z) < 8) {
        this.message('You may not rest now, there are monsters nearby');
        return;
      }
    }
    p.bedSpawn = { x, y, z, dim: Dim.OVERWORLD };
    p.sleeping = { x, y, z };
    p.sleepTimer = 0;
    p.setPosition(x + 0.5, y + 0.5625, z + 0.5);
    p.motionX = 0; p.motionY = 0; p.motionZ = 0;
    this.message('Respawn point set');
  }

  interactEntity(e: Entity): boolean {
    return this.mobs.handleEntityUse(e);
  }

  onBlockBroken(_id: number): void {}

  /** Is the block position inside a Nether fortress (Blaze spawning)? */
  inFortress(x: number, y: number, z: number): boolean {
    const gen = this.world.getDimension(Dim.NETHER).generator as unknown as { inFortress?(x: number, y: number, z: number): boolean };
    return gen.inFortress?.(x, y, z) ?? false;
  }

  /** Villager spawn points for a newly generated chunk. */
  villagersForChunk(cx: number, cz: number): [number, number, number][] {
    const gen = this.world.getDimension(Dim.OVERWORLD).generator as unknown as { structures?: { villagersIn?(cx: number, cz: number): [number, number, number][] } };
    return gen.structures?.villagersIn?.(cx, cz) ?? [];
  }

  /** Positions of the End pillar tops (for crystals). */
  endPillarTops(): [number, number, number][] {
    const gen = this.world.getDimension(Dim.END).generator as unknown as { pillarTops?(): [number, number, number][] };
    return gen.pillarTops?.() ?? [];
  }

  spawnVehicle(kind: 'boat' | 'minecart', x: number, y: number, z: number): void {
    this.mobs.spawnVehicle(kind, this.dim, x, y, z);
  }

  castFishingRod(): void {
    this.mobs.castFishingRod();
  }

  // =========================================================================
  // Lifecycle
  // =========================================================================
  private applyState(rec: WorldRecord): void {
    const w = this.world;
    const s = rec.state;
    w.totalTime = s.totalTime;
    w.dayTime = s.dayTime;
    w.raining = s.raining;
    w.rainTime = s.rainTime;
    w.rainStrength = s.raining ? 1 : 0;
    [w.spawnX, w.spawnY, w.spawnZ] = s.spawn;
    w.dragonKilled = s.dragonKilled;
    w.endInitialized = s.endInitialized;
    w.endingSeen = s.endingSeen;
    this.enchSeed = s.enchantSeed;
    this.globalEntities = rec.globalEntities ?? {};
    this.player.creative = rec.meta.gameMode === 'creative';
    if (rec.player) {
      this.player.deserialize(rec.player);
    }
  }

  /** Begin: load saved chunk index then stream the player's surroundings. */
  async begin(record: WorldRecord): Promise<void> {
    const keys = await this.storage.chunkKeys(this.world.meta.id, 'chunks');
    for (const [d, cx, cz] of keys) this.world.getDimension(d as DimId).savedChunkKeys.add(chunkKey(cx, cz));
    for (const [d, cx, cz] of await this.storage.chunkKeys(this.world.meta.id, 'entities')) {
      this.entityRecordKeys.add(chunkRecordKey(this.world.meta.id, d, cx, cz));
    }
    const dimId = (record.player ? record.playerDim : Dim.OVERWORLD) as DimId;
    this.enterDimension(dimId);
    this.restoreGlobalEntities();
    const isNew = !record.player;
    if (isNew) {
      const gen = createGenerator(Dim.OVERWORLD, this.world.seed) as OverworldGenerator;
      const spawn = gen.findSpawn();
      this.world.spawnX = spawn.x;
      this.world.spawnZ = spawn.z;
      this.player.setPosition(spawn.x + 0.5, 100, spawn.z + 0.5);
      this.startLoading('Building terrain', () => this.placeAtSpawn(true));
    } else {
      const p = this.player;
      this.startLoading('Loading world', () => this.chunkReadyAround(p.x, p.z, 2));
    }
    this.state = 'loading';
  }

  private startLoading(title: string, placeFn: () => boolean): void {
    this.loadingTarget = { title, placeFn };
    this.loadingTimer = 0;
    this.state = 'loading';
  }

  private chunkReadyAround(x: number, z: number, radius: number): boolean {
    const cx = Math.floor(x) >> 4;
    const cz = Math.floor(z) >> 4;
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (!this.chunkManager.isReady(cx + dx, cz + dz)) return false;
      }
    }
    return true;
  }

  /** Find a safe surface spawn near the world spawn (chunks must be loaded). */
  private placeAtSpawn(first: boolean): boolean {
    const w = this.world;
    if (!this.chunkReadyAround(w.spawnX, w.spawnZ, 2)) return false;
    const d = this.dim;
    const tryAt = (x: number, z: number): number => {
      for (let y = WORLD_HEIGHT - 2; y > 1; y--) {
        const id = d.getBlock(x, y, z);
        if (id === 0 || getBlock(id).replaceable && !IS_FLUID[id]) continue;
        if (IS_FLUID[id] || id === BlockId.LEAVES || id === BlockId.CACTUS || id === BlockId.FIRE) return -1;
        if (!getBlock(id).collides) continue;
        if (d.getBlock(x, y + 1, z) !== 0 && !getBlock(d.getBlock(x, y + 1, z)).replaceable) return -1;
        if (d.getBlock(x, y + 2, z) !== 0 && !getBlock(d.getBlock(x, y + 2, z)).replaceable) return -1;
        return y + 1;
      }
      return -1;
    };
    let found: [number, number, number] | null = null;
    for (let r = 0; r < 20 && !found; r++) {
      for (let dx = -r; dx <= r && !found; dx++) {
        for (let dz = -r; dz <= r && !found; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = w.spawnX + dx;
          const z = w.spawnZ + dz;
          if (!d.isLoaded(x, z)) continue;
          const y = tryAt(x, z);
          if (y > 0) found = [x, y, z];
        }
      }
    }
    if (!found) found = [w.spawnX, Math.max(64, d.highestSolidY(w.spawnX, w.spawnZ) + 1), w.spawnZ];
    if (first) {
      w.spawnX = found[0];
      w.spawnY = found[1];
      w.spawnZ = found[2];
    }
    this.player.setPosition(found[0] + 0.5, found[1], found[2] + 0.5);
    this.player.fallDistance = 0;
    this.player.motionX = 0; this.player.motionY = 0; this.player.motionZ = 0;
    return true;
  }

  enterDimension(id: DimId): void {
    if (this.chunkManager) this.chunkManager.unloadAll();
    this.renderer.chunks.clear();
    this.entityRenderer.clear();
    this.particleSystem.clear();
    const prev = this.dim;
    this.dim = this.world.getDimension(id);
    this.dim.hooks = this.behaviors;
    if (prev && prev !== this.dim) this.entities.transfer(this.player, this.dim);
    else if (!prev) this.entities.add(this.player, this.dim);
    this.player.dim = this.dim;
    this.chunkManager = new ChunkManager(this.dim, this.pool, {
      loadSaved: async (dim, cx, cz) => {
        const k = chunkRecordKey(this.world.meta.id, dim.id, cx, cz);
        const rec = this.pendingChunks.get(k) ?? (await this.storage.getChunk(this.world.meta.id, dim.id, cx, cz));
        if (!rec) return null;
        return {
          blocks: rleDecode(rec.blocks, 32768),
          meta: rleDecode(rec.meta, 32768),
          biomes: rec.biomes,
          tiles: rec.tiles,
        };
      },
      mesh: (chunk) => {
        const data = this.mesher.build(this.dim, chunk);
        this.renderer.chunks.update(chunk.cx, chunk.cz, data);
      },
      unmesh: (cx, cz) => this.renderer.chunks.remove(cx, cz),
      saveUnloaded: (dim, chunk) => this.bufferChunk(dim, chunk),
      chunkReady: (chunk) => this.onChunkReady(chunk),
      chunkUnloading: (chunk) => this.onChunkUnloading(chunk),
    });
    this.mesher.setOptions({ fancyLeaves: this.settings.fancyGraphics, smoothLighting: this.settings.smoothLighting });
  }

  /** Serialise a chunk into the pending-write buffer. */
  private bufferChunk(dim: Dimension, chunk: Chunk): void {
    const key = chunkRecordKey(this.world.meta.id, dim.id, chunk.cx, chunk.cz);
    this.pendingChunks.set(key, {
      v: 1,
      blocks: rleEncode(chunk.blocks),
      meta: rleEncode(chunk.meta),
      biomes: chunk.biomes.slice(),
      tiles: dim.tilesInChunk(chunk.cx, chunk.cz).map((t) => serializeTileSafe(t)),
    });
    chunk.modified = false;
    dim.savedChunkKeys.add(chunkKey(chunk.cx, chunk.cz));
  }

  private onChunkReady(chunk: Chunk): void {
    const key = chunkRecordKey(this.world.meta.id, this.dim.id, chunk.cx, chunk.cz);
    if (this.entityChunksLoaded.has(key)) return;
    this.entityChunksLoaded.add(key);
    const pending = this.pendingEntities.get(key);
    if (pending) {
      this.pendingEntities.delete(key);
      this.restoreEntities(pending);
      return;
    }
    if (this.entityRecordKeys.has(key)) {
      const dim = this.dim;
      void this.storage.getEntities(this.world.meta.id, dim.id, chunk.cx, chunk.cz).then((list) => {
        if (list && this.dim === dim) this.restoreEntities(list);
      });
      return;
    }
    // First visit: world-generation creature spawning.
    this.mobs.spawnInitialCreatures(this.dim, chunk);
  }

  private onChunkUnloading(chunk: Chunk): void {
    const key = chunkRecordKey(this.world.meta.id, this.dim.id, chunk.cx, chunk.cz);
    const list = this.entities.list(this.dim);
    const saved: EntityData[] = [];
    for (const e of list) {
      if (e === this.player || e.removed || !e.persistent) continue;
      if (Math.floor(e.x) >> 4 !== chunk.cx || Math.floor(e.z) >> 4 !== chunk.cz) continue;
      if (this.mobs.isGlobal(e)) continue;
      if (this.mobs.despawnsOnUnload(e)) { e.removed = true; continue; }
      saved.push(e.serialize());
      e.removed = true;
    }
    if (saved.length > 0 || this.entityRecordKeys.has(key) || this.entityChunksLoaded.has(key)) {
      this.pendingEntities.set(key, saved);
      this.entityRecordKeys.add(key);
    }
    this.entityChunksLoaded.delete(key);
  }

  private restoreEntities(list: EntityData[]): void {
    for (const d of list) {
      const e = this.mobs.create(d.type, d);
      if (e) this.spawn(e, this.dim);
    }
  }

  private restoreGlobalEntities(): void {
    for (const [dimKey, list] of Object.entries(this.globalEntities)) {
      const dim = this.world.getDimension(Number(dimKey) as DimId);
      for (const d of list) {
        const e = this.mobs.create(d.type, d);
        if (e) this.spawn(e, dim);
      }
    }
    this.globalEntities = {};
  }

  // =========================================================================
  // Saving
  // =========================================================================
  private buildRecord(): WorldRecord {
    const w = this.world;
    w.meta.lastPlayed = Date.now();
    const global: Record<string, EntityData[]> = {};
    for (const [dimId, list] of this.entities.all()) {
      const g = list.filter((e) => this.mobs.isGlobal(e) && !e.removed).map((e) => e.serialize());
      if (g.length) global[String(dimId)] = g;
    }
    return {
      id: w.meta.id,
      saveFormatVersion: SAVE_FORMAT_VERSION,
      generatorVersion: w.meta.generatorVersion,
      gameVersion: GAME_VERSION,
      meta: { ...w.meta },
      state: {
        totalTime: w.totalTime, dayTime: w.dayTime, raining: w.raining, rainTime: w.rainTime,
        spawn: [w.spawnX, w.spawnY, w.spawnZ], dragonKilled: w.dragonKilled, endInitialized: w.endInitialized,
        endingSeen: w.endingSeen, enchantSeed: this.enchSeed,
      },
      player: this.player.serialize(),
      playerDim: this.dim.id,
      globalEntities: global,
    };
  }

  /** Persist everything that changed. Atomic via one IndexedDB transaction. */
  async save(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    try {
      for (const dim of this.world.dimensions.values()) {
        for (const c of dim.chunks.values()) {
          if (c.modified && c.lit) this.bufferChunk(dim, c);
        }
      }
      // Entities in loaded chunks of the current dimension.
      const entityRecords = new Map(this.pendingEntities);
      const byChunk = new Map<string, EntityData[]>();
      for (const key of this.entityChunksLoaded) byChunk.set(key, []);
      for (const e of this.entities.list(this.dim)) {
        if (e === this.player || e.removed || !e.persistent || this.mobs.isGlobal(e)) continue;
        const key = chunkRecordKey(this.world.meta.id, this.dim.id, Math.floor(e.x) >> 4, Math.floor(e.z) >> 4);
        if (!byChunk.has(key)) continue;
        byChunk.get(key)!.push(e.serialize());
      }
      for (const [k, v] of byChunk) {
        entityRecords.set(k, v);
        this.entityRecordKeys.add(k);
      }
      const chunks = new Map(this.pendingChunks);
      await this.storage.write(this.buildRecord(), chunks, entityRecords);
      for (const k of chunks.keys()) if (this.pendingChunks.get(k) === chunks.get(k)) this.pendingChunks.delete(k);
      for (const k of this.pendingEntities.keys()) if (entityRecords.has(k)) this.pendingEntities.delete(k);
    } catch (err) {
      console.error('Save failed', err);
      this.message('Saving failed! See console.');
    } finally {
      this.saving = false;
    }
  }

  dispose(): void {
    this.chunkManager?.unloadAll();
    this.pool.dispose();
    this.renderer.chunks.clear();
    this.entityRenderer.clear();
    this.renderer.entityGroup.remove(this.entityRenderer.group);
    this.renderer.particleGroup.remove(this.particleSystem.points);
  }

  // =========================================================================
  // Dimension travel
  // =========================================================================
  changeDimension(target: DimId, via: 'portal' | 'end_portal' | 'exit'): void {
    const p = this.player;
    const from = this.dim.id;
    void this.save();
    let tx = p.x; let tz = p.z;
    if (from === Dim.OVERWORLD && target === Dim.NETHER) { tx = p.x / 8; tz = p.z / 8; }
    if (from === Dim.NETHER && target === Dim.OVERWORLD) { tx = p.x * 8; tz = p.z * 8; }
    this.enterDimension(target);
    p.portalCooldown = 300;
    p.portalTime = 0;
    p.inPortal = false;
    p.fallDistance = 0;
    p.motionX = 0; p.motionY = 0; p.motionZ = 0;
    if (target === Dim.END) {
      p.setPosition(100.5, 50, 0.5);
      this.startLoading('Entering the End', () => {
        if (!this.chunkReadyAround(100, 0, 1)) return false;
        // Classic obsidian arrival platform.
        for (let x = 98; x <= 102; x++) for (let z = -2; z <= 2; z++) {
          this.dim.setBlock(x, 48, z, BlockId.OBSIDIAN, 0);
          for (let y = 49; y <= 51; y++) this.dim.setBlock(x, y, z, 0, 0);
        }
        p.setPosition(100.5, 49, 0.5);
        p.yaw = Math.PI / 2;
        this.mobs.onEnterEnd();
        return true;
      });
      return;
    }
    if (via === 'exit' || (target === Dim.OVERWORLD && from === Dim.END)) {
      const bed = p.bedSpawn;
      if (bed) p.setPosition(bed.x + 0.5, bed.y + 1, bed.z + 0.5);
      else p.setPosition(this.world.spawnX + 0.5, this.world.spawnY, this.world.spawnZ + 0.5);
      this.startLoading('Returning home', () => {
        if (!this.chunkReadyAround(p.x, p.z, 1)) return false;
        if (bed && this.dim.getBlock(bed.x, bed.y, bed.z) === BlockId.BED) {
          this.placeNear(bed.x, bed.y, bed.z);
          return true;
        }
        return this.placeAtSpawn(false);
      });
      return;
    }
    // Nether portal travel: find or build a linked portal.
    p.setPosition(Math.floor(tx) + 0.5, 70, Math.floor(tz) + 0.5);
    const title = target === Dim.NETHER ? 'Entering the Nether' : 'Leaving the Nether';
    this.startLoading(title, () => {
      if (!this.chunkReadyAround(tx, tz, 3)) return false;
      const bx = Math.floor(tx); const bz = Math.floor(tz);
      let portal = findPortal(this.dim, bx, bz, 40);
      if (!portal) portal = createPortalNear(this.dim, bx, bz, target === Dim.NETHER ? 32 : 64, target === Dim.NETHER ? 100 : 110);
      const [px, py, pz] = portal;
      p.setPosition(px + 0.5, py, pz + 0.5);
      // Step out of the portal plane so we do not bounce straight back.
      const axisX = this.dim.getBlock(px + 1, py, pz) === BlockId.NETHER_PORTAL || this.dim.getBlock(px - 1, py, pz) === BlockId.NETHER_PORTAL;
      if (axisX) p.z += this.dim.getBlock(px, py, pz + 1) === 0 ? 1 : -1;
      else p.x += this.dim.getBlock(px + 1, py, pz) === 0 ? 1 : -1;
      p.prevX = p.x; p.prevZ = p.z;
      return true;
    });
  }

  private placeNear(x: number, y: number, z: number): void {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const bx = x + dx; const bz = z + dz;
      for (let dy = -1; dy <= 1; dy++) {
        const by = y + dy;
        if (getBlock(this.dim.getBlock(bx, by - 1, bz)).collides && !getBlock(this.dim.getBlock(bx, by, bz)).collides && !getBlock(this.dim.getBlock(bx, by + 1, bz)).collides) {
          this.player.setPosition(bx + 0.5, by, bz + 0.5);
          return;
        }
      }
    }
    this.player.setPosition(x + 0.5, y + 1, z + 0.5);
  }

  // =========================================================================
  // Respawn / death
  // =========================================================================
  private handleDeath(): void {
    const p = this.player;
    this.state = 'dead';
    if (!p.creative) {
      for (const s of p.inventory.slots) if (s) this.dropStack(this.dim, p.x, p.y + 1, p.z, s, 40);
      for (const s of p.inventory.armor.slots) if (s) this.dropStack(this.dim, p.x, p.y + 1, p.z, s, 40);
      p.inventory.clear();
      p.inventory.armor.clear();
      const xp = Math.min(100, p.xpLevel * 7);
      if (xp > 0) this.dropXp(this.dim, p.x, p.y + 0.5, p.z, xp);
    }
    const msg = deathMessage(p.displayName, p.lastDamageSource ?? { type: 'generic' });
    this.ui.close();
    this.input.exitLock();
    this.callbacks.onDeath(msg, p.score);
  }

  respawn(): void {
    const p = this.player;
    p.dead = false;
    p.deathTime = 0;
    p.health = p.maxHealth;
    p.foodLevel = 20;
    p.saturation = 5;
    p.exhaustion = 0;
    p.air = 300;
    p.fireTicks = 0;
    p.fallDistance = 0;
    p.effects.clear();
    p.xpLevel = 0; p.xpProgress = 0; p.xpTotal = 0; p.score = 0;
    p.motionX = 0; p.motionY = 0; p.motionZ = 0;
    p.removed = false;
    if (this.world.meta.gameMode === 'hardcore') return;
    const bed = p.bedSpawn;
    if (this.dim.id !== Dim.OVERWORLD) {
      this.changeDimension(Dim.OVERWORLD, 'exit');
      return;
    }
    if (bed) {
      p.setPosition(bed.x + 0.5, bed.y + 1, bed.z + 0.5);
      this.startLoading('Respawning', () => {
        if (!this.chunkReadyAround(p.x, p.z, 1)) return false;
        if (this.dim.getBlock(bed.x, bed.y, bed.z) !== BlockId.BED) {
          p.bedSpawn = null;
          this.message('Your home bed was missing or obstructed');
          return this.placeAtSpawn(false);
        }
        this.placeNear(bed.x, bed.y, bed.z);
        return true;
      });
    } else {
      p.setPosition(this.world.spawnX + 0.5, this.world.spawnY, this.world.spawnZ + 0.5);
      this.startLoading('Respawning', () => this.placeAtSpawn(false));
    }
  }

  // =========================================================================
  // Main loop
  // =========================================================================
  frame(now: number): void {
    if (!this.chunkManager) return;
    const dt = this.lastFrame ? Math.min(250, now - this.lastFrame) : 16;
    this.lastFrame = now;
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 240) this.frameTimes.shift();
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 500) {
      this.fps = Math.round((this.fpsFrames * 1000) / this.fpsTime);
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
    const rd = this.settings.renderDistance;
    this.renderer.setRenderDistance(rd);
    const p = this.player;

    if (this.state === 'loading') {
      this.chunkManager.update(p.x, p.z, Math.min(rd, 4), 12);
      this.loadingTimer++;
      const target = this.loadingTarget;
      const cx = Math.floor(p.x) >> 4;
      const cz = Math.floor(p.z) >> 4;
      let ready = 0;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (this.chunkManager.isReady(cx + dx, cz + dz)) ready++;
      this.callbacks.onLoadingProgress(target?.title ?? 'Loading', ready / 25);
      if (target && target.placeFn()) {
        this.loadingTarget = null;
        this.state = 'playing';
        p.savePrev();
        this.callbacks.onLoaded();
      }
      this.renderScene(dt, 1);
      return;
    }

    if (!this.paused && !this.ui.screen) this.handleLook();
    if (!this.paused) {
      this.acc += dt;
      let n = 0;
      while (this.acc >= TICK_MS && n < 5) {
        this.acc -= TICK_MS;
        this.tick();
        n++;
      }
      if (this.acc > TICK_MS * 5) this.acc = 0;
    }
    const budget = this.fps > 50 || this.fps === 0 ? 5 : 3;
    this.chunkManager.update(p.x, p.z, rd, budget);
    this.chunkManager.flushNearbyDirty(p.x, p.z);
    this.audio.updateMusic(dt / 1000, this.dim.id);
    this.renderScene(dt, this.paused ? 1 : this.acc / TICK_MS);
  }

  private handleLook(): void {
    const [dx, dy] = this.input.consumeMouse();
    const p = this.player;
    if (p.sleeping || p.dead) return;
    const sens = 0.0006 + this.settings.sensitivity * 0.004;
    p.yaw -= dx * sens;
    p.pitch -= dy * sens * (this.settings.invertMouse ? -1 : 1);
    p.pitch = Math.max(-Math.PI / 2 + 0.001, Math.min(Math.PI / 2 - 0.001, p.pitch));
    const w = this.input.consumeWheel();
    if (w !== 0) p.inventory.selected = (((p.inventory.selected + w) % 9) + 9) % 9;
  }

  private readInput(): void {
    const p = this.player;
    const i = this.input;
    const active = this.state === 'playing' && !this.ui.screen && !this.paused && i.locked;
    const f = active ? (i.isDown('forward') ? 1 : 0) - (i.isDown('back') ? 1 : 0) : 0;
    const s = active ? (i.isDown('right') ? 1 : 0) - (i.isDown('left') ? 1 : 0) : 0;
    p.input.forward = f;
    p.input.strafe = s;
    p.input.jump = active && i.isDown('jump');
    p.input.sneak = active && i.isDown('sneak');
    const sprintKey = active && i.isDown('sprint');
    if (i.sprintTap && f > 0) p.input.sprint = true;
    else if (f <= 0) p.input.sprint = false;
    if (sprintKey && f > 0) p.input.sprint = true;
    if (!sprintKey && !i.sprintTap && !p.sprinting) p.input.sprint = false;
    if (!active) i.releaseAll();
  }

  private tick(): void {
    this.tickCount++;
    const w = this.world;
    const p = this.player;
    w.totalTime++;
    w.dayTime = (w.dayTime + 1) % 24000;
    this.tickWeather();
    const dim = this.dim;
    dim.currentTick = w.totalTime;
    dim.runScheduledTicks();
    this.randomTicks();

    this.readInput();
    p.savePrev();
    p.tick(this);
    this.tickSleep();
    this.interaction.tick();
    this.entities.tick(this, dim);
    this.pickups();
    this.tickTiles();
    this.mobs.tick(dim);
    this.redstone.tick(dim);
    this.particleSystem.tick();
    this.tickPortals();
    this.ambientSounds();
    this.footsteps();
    if (p.dead && this.state === 'playing' && p.deathTime >= 18) this.handleDeath();
    if (++this.autosave >= AUTOSAVE_TICKS) {
      this.autosave = 0;
      void this.save();
    }
  }

  private tickWeather(): void {
    const w = this.world;
    if (--w.rainTime <= 0) {
      w.raining = !w.raining;
      w.rainTime = w.raining ? 12000 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 168000);
    }
    const target = w.raining ? 1 : 0;
    w.rainStrength += Math.sign(target - w.rainStrength) * Math.min(Math.abs(target - w.rainStrength), 0.01);
  }

  /** Classic random block ticks: 3 random positions per 16x16x16 section. */
  private randomTicks(): void {
    const dim = this.dim;
    const p = this.player;
    const pcx = Math.floor(p.x) >> 4;
    const pcz = Math.floor(p.z) >> 4;
    const R = 7;
    for (let dx = -R; dx <= R; dx++) {
      for (let dz = -R; dz <= R; dz++) {
        const c = dim.getChunk(pcx + dx, pcz + dz);
        if (!c || !c.lit) continue;
        for (let s = 0; s < 8; s++) {
          if (!(c.sectionMask & (1 << s))) continue;
          for (let k = 0; k < 3; k++) {
            const r = (Math.random() * 4096) | 0;
            const lx = r & 15; const lz = (r >> 4) & 15; const ly = (s << 4) | (r >> 8);
            const i = blockIndex(lx, ly, lz);
            const id = c.blocks[i];
            if (RANDOM_TICK[id]) this.behaviors.randomTick(dim, c.cx * 16 + lx, ly, c.cz * 16 + lz, id, c.meta[i]);
          }
        }
        // Weather: snow/ice accumulation.
        if (this.world.raining && dim.id === Dim.OVERWORLD && Math.random() < 1 / 16) {
          this.behaviors.weatherTick(dim, c.cx * 16 + ((Math.random() * 16) | 0), c.cz * 16 + ((Math.random() * 16) | 0));
        }
      }
    }
  }

  private tickTiles(): void {
    for (const t of this.dim.tiles.values()) {
      if (t.kind === 'furnace') {
        if (Math.abs(t.x - this.player.x) > 160 || Math.abs(t.z - this.player.z) > 160) continue;
        tickFurnace(this.dim, t);
      } else if (t.kind === 'brewing') {
        if (tickBrewing(t)) this.playSound('random.pop', t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.5, 1.2);
      } else if (t.kind === 'spawner') {
        this.mobs.tickSpawner(this.dim, t);
      }
    }
  }

  private pickups(): void {
    const p = this.player;
    if (p.dead) return;
    const box = p.box.grow(1, 0.5, 1);
    for (const e of this.entities.list(this.dim)) {
      if (e.removed) continue;
      if (!box.intersects(e.box)) continue;
      if (e instanceof ItemEntity && e.pickupDelay === 0) {
        const before = e.stack.count;
        const left = p.inventory.addItem(e.stack);
        if (!left) e.removed = true;
        else e.stack = left;
        if (!left || left.count < before) {
          this.audio.play2d('random.pop', 0.2, ((Math.random() - Math.random()) * 0.7 + 1) * 2);
        }
      } else if (e instanceof XpOrb) {
        if (e.age < 2) continue;
        p.addXp(e.value);
        e.removed = true;
        this.audio.play2d('random.orb', 0.1, 0.5 * ((Math.random() - Math.random()) * 0.7 + 1.8));
      } else if (e instanceof Arrow) {
        e.tryPickup(p, this);
      }
    }
  }

  private tickSleep(): void {
    const p = this.player;
    if (!p.sleeping) return;
    p.sleepTimer++;
    const b = p.sleeping;
    if (this.dim.getBlock(b.x, b.y, b.z) !== BlockId.BED) {
      p.wakeUp();
      return;
    }
    if (p.sleepTimer >= 100) {
      const w = this.world;
      w.dayTime = 0;
      w.raining = false;
      w.rainTime = 12000 + Math.floor(Math.random() * 168000);
      p.wakeUp();
      this.placeNear(b.x, b.y, b.z);
    }
  }

  private tickPortals(): void {
    const p = this.player;
    if (p.dead) return;
    const bx = Math.floor(p.x); const by = Math.floor(p.y + 0.1); const bz = Math.floor(p.z);
    const feet = this.dim.getBlock(bx, by, bz);
    const head = this.dim.getBlock(bx, by + 1, bz);
    if (feet === BlockId.END_PORTAL || this.dim.getBlock(bx, Math.floor(p.y - 0.2), bz) === BlockId.END_PORTAL && p.y - Math.floor(p.y) < 0.8) {
      if (p.portalCooldown > 0) return;
      if (this.dim.id === Dim.END) {
        this.world.endingSeen = true;
        this.state = 'ending';
        this.input.exitLock();
        this.callbacks.onEnding();
      } else {
        this.changeDimension(Dim.END, 'end_portal');
      }
      return;
    }
    const inPortal = feet === BlockId.NETHER_PORTAL || head === BlockId.NETHER_PORTAL;
    p.inPortal = inPortal;
    if (inPortal) {
      if (p.portalCooldown > 0) { p.portalCooldown = 20; return; }
      p.portalTime++;
      if (this.portalSound-- <= 0) {
        this.portalSound = 40;
        this.playSound(p.portalTime < 5 ? 'portal.trigger' : 'portal.ambient', p.x, p.y, p.z, 0.6, 1);
      }
      if (p.portalTime >= (p.creative ? 1 : 80)) {
        this.playSound('portal.travel', p.x, p.y, p.z, 0.5, 1);
        this.changeDimension(this.dim.id === Dim.NETHER ? Dim.OVERWORLD : Dim.NETHER, 'portal');
      }
    } else {
      p.portalTime = Math.max(0, p.portalTime - 4);
    }
  }

  private footsteps(): void {
    const p = this.player;
    if (!p.onGround || p.sneaking) return;
    const moved = Math.sqrt((p.x - p.prevX) ** 2 + (p.z - p.prevZ) ** 2);
    this.stepAcc += moved;
    if (this.stepAcc > 1.7) {
      this.stepAcc = 0;
      const id = this.dim.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
      if (id !== 0) this.audio.play2d(`step.${soundGroup(getBlock(id))}`, 0.3, 1);
    }
  }

  private ambientSounds(): void {
    const p = this.player;
    // Water/lava ambience and cave moods.
    if (this.tickCount % 20 === 0) {
      for (let i = 0; i < 4; i++) {
        const x = Math.floor(p.x + (Math.random() - 0.5) * 16);
        const y = Math.floor(p.y + (Math.random() - 0.5) * 8);
        const z = Math.floor(p.z + (Math.random() - 0.5) * 16);
        const id = this.dim.getBlock(x, y, z);
        if (id === BlockId.LAVA && this.dim.getBlock(x, y + 1, z) === 0 && Math.random() < 0.3) {
          this.playSound('liquid.lavapop', x + 0.5, y + 1, z + 0.5, 0.4, 1);
          this.particles_emit('lava', this.dim, x + 0.5, y + 1, z + 0.5, 1);
        } else if (id === BlockId.WATER_FLOWING && Math.random() < 0.2) {
          this.playSound('liquid.water', x + 0.5, y + 0.5, z + 0.5, 0.3, 1);
        } else if (id === BlockId.FIRE && Math.random() < 0.5) {
          this.playSound('fire.crackle', x + 0.5, y + 0.5, z + 0.5, 0.6, 1);
        } else if (id === BlockId.TORCH && Math.random() < 0.5) {
          this.particles_emit('smoke', this.dim, x + 0.5, y + 0.8, z + 0.5, 1, { spread: 0.02 });
          this.particles_emit('flame', this.dim, x + 0.5, y + 0.75, z + 0.5, 1, { spread: 0.02 });
        } else if (id === BlockId.NETHER_PORTAL && Math.random() < 0.5) {
          this.particles_emit('portal', this.dim, x + 0.5, y + 0.5, z + 0.5, 3);
        }
      }
    }
    if (this.ambientTimer-- <= 0) {
      this.ambientTimer = 1200 + Math.floor(Math.random() * 6000);
      const light = this.dim.getLightLevel(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z), this.skyDarken());
      if (light < 4 && this.dim.getSkyLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) < 4) {
        this.playSound('ambient.cave', p.x + (Math.random() - 0.5) * 10, p.y, p.z + (Math.random() - 0.5) * 10, 0.7, 0.8 + Math.random() * 0.2);
      }
    }
    if (this.world.rainStrength > 0.3 && this.dim.id === Dim.OVERWORLD && this.tickCount % 24 === 0) {
      const b = biomeDef(this.dim.getChunkAt(Math.floor(p.x), Math.floor(p.z))?.biomes[(Math.floor(p.x) & 15) | ((Math.floor(p.z) & 15) << 4)] ?? 1);
      if (b.rain && !b.snowy && this.dim.getSkyLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) > 6) {
        this.audio.play2d('ambient.rain', 0.4 * this.world.rainStrength, 1);
      }
    }
  }

  // =========================================================================
  // Rendering
  // =========================================================================
  /** Brightness 0..1 at a world position (for entities and particles). */
  brightness(x: number, y: number, z: number): number {
    const bx = Math.floor(x); const by = Math.floor(y); const bz = Math.floor(z);
    const [s, b] = this.dim.light.getLight(bx, Math.max(0, Math.min(WORLD_HEIGHT - 1, by)), bz);
    const day = this.dim.id === Dim.OVERWORLD ? daylightFactor(this.world.dayTime, this.world.rainStrength) : 0;
    const sky = s - (1 - day) * 11;
    const l = Math.max(sky, b, 0);
    const min = this.dim.id === Dim.NETHER ? 0.12 : this.dim.id === Dim.END ? 0.25 : 0.03;
    return Math.max(min, Math.pow(0.8, 15 - l));
  }

  private renderScene(dt: number, alpha: number): void {
    const p = this.player;
    const x = p.prevX + (p.x - p.prevX) * alpha;
    const y = p.prevY + (p.y - p.prevY) * alpha;
    const z = p.prevZ + (p.z - p.prevZ) * alpha;
    let eyeY = y + p.eyeHeight;
    if (p.sleeping) eyeY = y + 0.3;
    if (p.dead) eyeY = y + 0.3;

    // View bobbing.
    this.prevBob = this.bobPhase;
    const walked = p.prevDistanceWalked + (p.distanceWalked - p.prevDistanceWalked) * alpha;
    const speed = Math.min(0.1, Math.sqrt((p.x - p.prevX) ** 2 + (p.z - p.prevZ) ** 2));
    this.bobAmount += ((p.onGround && !p.flying ? speed : 0) - this.bobAmount) * 0.4;
    const bob = this.settings.viewBobbing ? this.bobAmount : 0;
    const phase = walked * Math.PI;
    const bobX = Math.sin(phase) * bob * 0.5;
    const bobY = -Math.abs(Math.cos(phase) * bob);
    let roll = Math.sin(phase) * bob * 0.05;
    if (p.hurtTime > 0) roll += Math.sin(((p.hurtTime - alpha) / 10) * Math.PI) * 0.12;
    if (p.dead) roll = Math.min(p.deathTime / 20, 1) * 0.6;
    const targetFov = (p.sprinting ? 1.12 : 1) * (this.interaction.bowPull > 0 ? 1 - this.interaction.bowPull * 0.15 : 1);
    this.fovMod += (targetFov - this.fovMod) * Math.min(1, dt / 100);

    if (this.state === 'playing' && !this.ui.screen) {
      this.interaction.updateTarget(x, eyeY, z);
    }
    const t = this.interaction.target;
    if (t && !this.hideGui && this.state === 'playing') {
      const box = selectionBox(t.id, t.meta, (dx, dy, dz) => this.dim.getBlock(t.x + dx, t.y + dy, t.z + dz));
      this.renderer.setSelection(t.x, t.y, t.z, box);
      const m = this.interaction.mining;
      this.renderer.setCrack(t.x, t.y, t.z, m && m.x === t.x && m.y === t.y && m.z === t.z ? m.progress : 0, box);
    } else {
      this.renderer.setSelection(0, 0, 0, null);
      this.renderer.setCrack(0, 0, 0, 0, null);
    }

    const rc = { alpha, time: performance.now() / 1000, light: (lx: number, ly: number, lz: number) => this.brightness(lx, ly, lz) };
    this.entityRenderer.sync(this.entities.list(this.dim), rc, this.thirdPerson ? null : p, x, z, this.settings.renderDistance * 16);
    this.particleSystem.setViewportHeight(this.renderer.gl.domElement.height);
    this.particleSystem.sync();

    const underwater = p.isEyeInWater();
    const cam: CameraState = {
      x: x + (this.thirdPerson ? 0 : bobX * Math.cos(p.yaw)), y: eyeY + bobY, z: z - (this.thirdPerson ? 0 : bobX * Math.sin(p.yaw)),
      yaw: p.yaw, pitch: p.pitch, roll, fov: this.settings.fov * this.fovMod * (underwater ? 0.9 : 1),
      underwater, inLava: p.isEyeInLava(), thirdPerson: this.thirdPerson,
    };
    const held = p.inventory.held;
    const hand: HandState = {
      item: held, swing: p.swinging ? Math.min(1, p.swingProgress + alpha / 6) : 0, equip: this.interaction.equip,
      bobX: bobX * 0.6, bobY: bobY * 0.6, light: this.brightness(x, eyeY, z),
      using: this.interaction.useTicks, eating: !!this.interaction.useItem && this.interaction.useItem.id !== 261,
    };
    const showHand = !this.hideGui && !p.sleeping && !p.dead;
    this.renderer.render(cam, showHand ? hand : null, this.dim.id, this.world.dayTime, this.world.rainStrength, dt, 1);
    if (p.inPortal && p.portalTime > 0) this.renderer.renderScreenTint(0.5, 0.1, 0.8, Math.min(0.6, p.portalTime / 80));
    this.audio.listener = { x, y: eyeY, z, yaw: p.yaw };

    // HUD.
    const hudVisible = this.state === 'playing' && !this.hideGui;
    this.ui.setHudVisible(hudVisible || this.state === 'dead');
    if (hudVisible) {
      this.ui.hud.update(p, this.boss, !this.ui.screen && !this.thirdPerson);
      this.ui.hud.hurt.style.opacity = p.hurtTime > 0 ? String((p.hurtTime / 10) * 0.8) : '0';
      this.ui.hud.sleep.style.opacity = p.sleeping ? String(Math.min(1, p.sleepTimer / 100)) : '0';
    }
    this.ui.hud.debug.style.display = this.showDebug || this.settings.showFps ? '' : 'none';
    if (this.showDebug) this.ui.hud.debug.textContent = this.debugText(x, y, z);
    else if (this.settings.showFps) this.ui.hud.debug.textContent = `${this.fps} fps`;
  }

  private debugText(x: number, y: number, z: number): string {
    const st = this.chunkManager.stats();
    const r = this.renderer.frameInfo;
    const bx = Math.floor(x); const bz = Math.floor(z);
    const c = this.dim.getChunkAt(bx, bz);
    const biome = c ? biomeDef(c.biomes[(bx & 15) | ((bz & 15) << 4)]).name : '?';
    const [sl, bl] = this.dim.light.getLight(bx, Math.floor(y + 0.5), bz);
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const dirNames = ['south', 'west', 'north', 'east'];
    const q = Math.round(((((-this.player.yaw) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2) + 2) & 3;
    return [
      `BLOCKWORLD 1.0 (${this.fps} fps, p95 ${p95.toFixed(1)} ms)`,
      `Draw calls: ${r.calls}  Triangles: ${r.triangles}`,
      `Chunks: ${st.loaded} loaded, ${st.meshed} meshed, ${st.pendingGen} pending`,
      `Gen ${(this.pool.totalMs / Math.max(1, this.pool.totalChunks)).toFixed(1)}ms  Pop ${st.popMsAvg.toFixed(1)}ms  Light ${st.lightMsAvg.toFixed(1)}ms  Mesh ${st.meshMsAvg.toFixed(1)}ms`,
      `Entities: ${this.entities.count(this.dim)}  Particles: ${this.particleSystem.count}  Ticks queued: ${this.dim.pendingTickCount}`,
      mem ? `Memory: ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB` : '',
      '',
      `x: ${x.toFixed(2)}  y: ${y.toFixed(2)}  z: ${z.toFixed(2)}`,
      `Facing: ${dirNames[q]}  Chunk: ${bx >> 4}, ${bz >> 4}`,
      `Biome: ${biome}  Light: sky ${sl} block ${bl}`,
      `Day ${Math.floor(this.world.totalTime / 24000)}  Time ${this.world.dayTime}  ${this.world.raining ? 'Raining' : 'Clear'}`,
    ].join('\n');
  }

  // =========================================================================
  // Keys (called by the app while in game)
  // =========================================================================
  onKey(code: string): boolean {
    const k = this.settings.keys;
    const p = this.player;
    if (this.state !== 'playing') return false;
    if (code === k.debug) { this.showDebug = !this.showDebug; return true; }
    if (code === k.hideGui) { this.hideGui = !this.hideGui; return true; }
    if (code === k.perspective) { this.thirdPerson = !this.thirdPerson; return true; }
    if (this.ui.screen) {
      if (code === k.inventory && this.ui.screen.closable && !(this.ui.screen instanceof SignScreen)) { this.ui.close(); return true; }
      return this.ui.onKey(code);
    }
    if (code === k.inventory) {
      if (p.sleeping) return true;
      this.ui.open(new InventoryScreen());
      return true;
    }
    if (code.startsWith('Digit')) {
      const n = Number(code.slice(5));
      if (n >= 1 && n <= 9) { p.inventory.selected = n - 1; return true; }
    }
    if (code === k.drop) {
      const held = p.inventory.held;
      if (held) {
        const all = this.input.isCodeDown('ControlLeft') || this.input.isCodeDown('MetaLeft');
        const drop = cloneStack(held)!;
        drop.count = all ? held.count : 1;
        p.inventory.consumeHeld(drop.count);
        this.dropItem(drop);
        p.swing();
      }
      return true;
    }
    if (code === 'KeyC' && this.input.isCodeDown('F3')) return true;
    return false;
  }
}

function serializeTileSafe(t: import('../world/tileentity').TileEntity): import('../world/tileentity').SerializedTile {
  // Local import avoids a circular module graph at load time.
  return serializeTileImpl(t);
}
import { serializeTile as serializeTileImpl } from '../world/tileentity';
export { THREE, createStack };

/**
 * Block behaviours: neighbour updates, scheduled ticks and random ticks.
 * This is where plants grow, sand falls, fire spreads, leaves decay, fluids
 * flow and unsupported blocks pop off.
 */

import { BlockId, WoodType } from '../blocks/ids';
import { getBlock, OPAQUE_LIGHT, resolveDrops } from '../blocks/registry';
import { BED_HEAD, DOOR_UPPER, LEAVES_NO_DECAY } from '../blocks/meta';
import { Random } from '../core/rng';
import type { GameContext } from '../game/context';
import { FallingBlock, PrimedTnt } from '../entity/items';
import { biomeDef } from '../worldgen/biomes';
import { bigOak, hugeMushroom, pineTree, smallTree, spruceTree, type FeatureAccess } from '../worldgen/features';
import { Dim } from './constants';
import type { BlockHooks, Dimension } from './dimension';
import { isLava, isWater, onFluidNeighborChanged, tickFluid, type FluidHost } from './fluids';
import { canStay } from './placement';
import { checkPortalIntegrity } from './portals';
import type { Redstone } from './redstone';

const FLAMMABILITY: Record<number, [number, number]> = {
  // id: [encouragement to catch, chance to burn away]
  [BlockId.PLANKS]: [5, 20], [BlockId.LOG]: [5, 5], [BlockId.LEAVES]: [30, 60], [BlockId.BOOKSHELF]: [30, 20],
  [BlockId.TNT]: [15, 100], [BlockId.TALL_GRASS]: [60, 100], [BlockId.WOOL]: [30, 60], [BlockId.FENCE]: [5, 20],
  [BlockId.OAK_STAIRS]: [5, 20], [BlockId.DEAD_BUSH]: [60, 100], [BlockId.DANDELION]: [60, 100], [BlockId.ROSE]: [60, 100],
};

const HORIZONTAL: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export class BlockBehaviors implements BlockHooks, FluidHost {
  redstone: Redstone | null = null;
  private readonly rng = new Random((Math.random() * 0xffffffff) >>> 0);

  constructor(private readonly ctx: GameContext) {}

  random(): number {
    return this.rng.next();
  }

  // --- FluidHost -------------------------------------------------------------
  washAway(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): void {
    this.dropBlock(dim, x, y, z, id, meta);
  }

  fizz(dim: Dimension, x: number, y: number, z: number): void {
    this.ctx.playSound('fire.fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6);
    this.ctx.particles('smoke', dim, x + 0.5, y + 1, z + 0.5, 6);
  }

  /** Drop a block's items without tool bonuses (washed away, unsupported). */
  dropBlock(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): void {
    const def = getBlock(id);
    if (def.requiresTool && def.toolCategory !== null) return;
    for (const d of resolveDrops(id, meta, 0, null, 0, false, this.rng)) {
      this.ctx.dropStack(dim, x + 0.5, y + 0.5, z + 0.5, { id: d.item, count: d.count, meta: d.meta, damage: 0 });
    }
  }

  /** Break a block as if it popped off (drops + particles). */
  popBlock(dim: Dimension, x: number, y: number, z: number): void {
    const id = dim.getBlock(x, y, z);
    const meta = dim.getMeta(x, y, z);
    if (id === 0) return;
    dim.setBlock(x, y, z, 0, 0);
    this.dropBlock(dim, x, y, z, id, meta);
  }

  // --- BlockHooks --------------------------------------------------------------
  blockChanged(dim: Dimension, x: number, y: number, z: number, oldId: number, newId: number): void {
    this.redstone?.onBlockChanged(dim, x, y, z, oldId, newId);
    if (newId === BlockId.TNT && this.redstone?.isPowered(dim, x, y, z)) this.igniteTnt(dim, x, y, z);
    if (isLava(newId) || isWater(newId)) dim.scheduleTick(x, y, z, 2);
    if (getBlock(newId).gravity) dim.scheduleTick(x, y, z, 2);
    if (newId === BlockId.FIRE) dim.scheduleTick(x, y, z, 30 + this.rng.int(10));
  }

  neighborChanged(dim: Dimension, x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
    const id = dim.getBlock(x, y, z);
    if (id === 0) return;
    const meta = dim.getMeta(x, y, z);
    const def = getBlock(id);
    if (def.fluid !== 'none') {
      onFluidNeighborChanged(dim, this, x, y, z);
      return;
    }
    if (def.gravity) dim.scheduleTick(x, y, z, 2);
    if (def.needsSupport || id === BlockId.CACTUS || id === BlockId.SUGAR_CANE || id === BlockId.BED ||
        id === BlockId.WOODEN_DOOR || id === BlockId.IRON_DOOR || id === BlockId.SIGN || id === BlockId.CAKE) {
      if (!canStay(dim, id, meta, x, y, z)) {
        if ((id === BlockId.WOODEN_DOOR || id === BlockId.IRON_DOOR) && (meta & DOOR_UPPER)) {
          dim.setBlock(x, y, z, 0, 0);
        } else if (id === BlockId.BED && (meta & BED_HEAD)) {
          dim.setBlock(x, y, z, 0, 0);
        } else {
          this.popBlock(dim, x, y, z);
        }
        return;
      }
    }
    if (id === BlockId.NETHER_PORTAL) {
      checkPortalIntegrity(dim, x, y, z);
      return;
    }
    if (id === BlockId.FIRE) {
      if (!this.fireCanStay(dim, x, y, z)) dim.setBlock(x, y, z, 0, 0);
      return;
    }
    if (id === BlockId.FARMLAND) {
      const above = dim.getBlock(x, y + 1, z);
      if (above !== 0 && getBlock(above).solid) dim.setBlock(x, y, z, BlockId.DIRT, 0);
      return;
    }
    if (id === BlockId.TNT && this.redstone?.isPowered(dim, x, y, z)) {
      this.igniteTnt(dim, x, y, z);
      return;
    }
    if (id === BlockId.ICE && this.hasWaterBelow(dim, x, y, z)) return;
    this.redstone?.onNeighborChanged(dim, x, y, z, id, meta, fx, fy, fz);
  }

  private hasWaterBelow(dim: Dimension, x: number, y: number, z: number): boolean {
    return isWater(dim.getBlock(x, y - 1, z));
  }

  igniteTnt(dim: Dimension, x: number, y: number, z: number, shortFuse = false): void {
    dim.setBlock(x, y, z, 0, 0);
    const tnt = new PrimedTnt();
    tnt.dim = dim;
    tnt.setPosition(x + 0.5, y, z + 0.5);
    if (shortFuse) tnt.fuse = 10 + this.rng.int(20);
    this.ctx.spawn(tnt, dim);
    this.ctx.playSound('tnt.fuse', x + 0.5, y + 0.5, z + 0.5, 1, 1);
  }

  scheduledTick(dim: Dimension, x: number, y: number, z: number, id: number): void {
    const def = getBlock(id);
    if (def.fluid !== 'none') {
      tickFluid(dim, this, x, y, z);
      return;
    }
    if (def.gravity) {
      this.tryFall(dim, x, y, z, id);
      return;
    }
    if (id === BlockId.FIRE) {
      this.fireTick(dim, x, y, z);
      return;
    }
    this.redstone?.scheduledTick(dim, x, y, z, id);
  }

  private tryFall(dim: Dimension, x: number, y: number, z: number, id: number): void {
    const below = dim.getBlock(x, y - 1, z);
    const canFall = y > 0 && (below === 0 || below === BlockId.FIRE || getBlock(below).fluid !== 'none' || getBlock(below).replaceable);
    if (!canFall) return;
    if (!dim.isLoaded(x, z)) return;
    const meta = dim.getMeta(x, y, z);
    const fb = new FallingBlock(id, meta);
    fb.dim = dim;
    fb.setPosition(x + 0.5, y, z + 0.5);
    dim.setBlock(x, y, z, 0, 0);
    this.ctx.spawn(fb, dim);
  }

  // --- Random ticks ------------------------------------------------------------
  randomTick(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): void {
    const r = this.rng;
    switch (id) {
      case BlockId.GRASS: {
        const lightAbove = dim.getLightLevel(x, y + 1, z, this.ctx.skyDarken());
        const above = dim.getBlock(x, y + 1, z);
        if (lightAbove < 4 && OPAQUE_LIGHT[above] > 2) {
          dim.setBlock(x, y, z, BlockId.DIRT, 0);
        } else if (lightAbove >= 9) {
          for (let i = 0; i < 4; i++) {
            const tx = x + r.int(3) - 1; const ty = y + r.int(5) - 3; const tz = z + r.int(3) - 1;
            if (dim.getBlock(tx, ty, tz) !== BlockId.DIRT) continue;
            const a = dim.getBlock(tx, ty + 1, tz);
            if (dim.getLightLevel(tx, ty + 1, tz, this.ctx.skyDarken()) >= 4 && OPAQUE_LIGHT[a] <= 2) {
              dim.setBlock(tx, ty, tz, BlockId.GRASS, 0);
            }
          }
        }
        return;
      }
      case BlockId.MYCELIUM: {
        const tx = x + r.int(3) - 1; const ty = y + r.int(5) - 3; const tz = z + r.int(3) - 1;
        if (dim.getBlock(tx, ty, tz) === BlockId.DIRT && OPAQUE_LIGHT[dim.getBlock(tx, ty + 1, tz)] <= 2) dim.setBlock(tx, ty, tz, BlockId.MYCELIUM, 0);
        return;
      }
      case BlockId.WHEAT_CROP: {
        if (meta >= 7) return;
        if (dim.getLightLevel(x, y + 1, z, this.ctx.skyDarken()) < 9) return;
        const moist = dim.getMeta(x, y - 1, z) > 0 ? 3 : 1;
        if (r.int(Math.floor(25 / moist) + 1) === 0) dim.setMeta(x, y, z, meta + 1);
        return;
      }
      case BlockId.NETHER_WART:
        if (meta < 3 && r.int(10) === 0) dim.setMeta(x, y, z, meta + 1);
        return;
      case BlockId.PUMPKIN_STEM:
      case BlockId.MELON_STEM: {
        if (dim.getLightLevel(x, y + 1, z, this.ctx.skyDarken()) < 9) return;
        if (r.int(10) !== 0) return;
        if (meta < 7) {
          dim.setMeta(x, y, z, meta + 1);
          return;
        }
        const fruit = id === BlockId.PUMPKIN_STEM ? BlockId.PUMPKIN : BlockId.MELON_BLOCK;
        for (const [dx, dz] of HORIZONTAL) if (dim.getBlock(x + dx, y, z + dz) === fruit) return;
        const [dx, dz] = HORIZONTAL[r.int(4)];
        const ground = dim.getBlock(x + dx, y - 1, z + dz);
        if (dim.getBlock(x + dx, y, z + dz) === 0 && (ground === BlockId.DIRT || ground === BlockId.GRASS || ground === BlockId.FARMLAND)) {
          dim.setBlock(x + dx, y, z + dz, fruit, fruit === BlockId.PUMPKIN ? r.int(4) : 0);
        }
        return;
      }
      case BlockId.CACTUS:
      case BlockId.SUGAR_CANE: {
        if (dim.getBlock(x, y + 1, z) !== 0) return;
        let h = 1;
        while (dim.getBlock(x, y - h, z) === id) h++;
        if (h >= 3) return;
        if (meta >= 15) {
          dim.setBlock(x, y + 1, z, id, 0);
          dim.setMeta(x, y, z, 0);
        } else {
          dim.setMeta(x, y, z, meta + 1, false);
        }
        return;
      }
      case BlockId.SAPLING: {
        if (dim.getLightLevel(x, y + 1, z, this.ctx.skyDarken()) < 9 || r.int(7) !== 0) return;
        if ((meta & 8) === 0) dim.setMeta(x, y, z, meta | 8, false);
        else this.growTree(dim, x, y, z, meta & 3);
        return;
      }
      case BlockId.BROWN_MUSHROOM:
      case BlockId.RED_MUSHROOM: {
        if (r.int(25) !== 0) return;
        const tx = x + r.int(3) - 1; const ty = y + r.int(2) - r.int(2); const tz = z + r.int(3) - 1;
        if (dim.getBlock(tx, ty, tz) === 0 && dim.getLightLevel(tx, ty, tz, 0) < 13 && canStay(dim, id, 0, tx, ty, tz)) {
          dim.setBlock(tx, ty, tz, id, 0);
        }
        return;
      }
      case BlockId.LEAVES:
        if ((meta & LEAVES_NO_DECAY) === 0 && !this.logNearby(dim, x, y, z)) {
          this.popBlock(dim, x, y, z);
        }
        return;
      case BlockId.FARMLAND: {
        const wet = this.waterNearby(dim, x, y, z) || this.ctx.world.raining && dim.getSkyLight(x, y + 1, z) >= 15;
        if (wet) {
          if (meta < 7) dim.setMeta(x, y, z, 7);
        } else if (meta > 0) {
          dim.setMeta(x, y, z, meta - 1);
        } else {
          const above = dim.getBlock(x, y + 1, z);
          if (above !== BlockId.WHEAT_CROP && above !== BlockId.PUMPKIN_STEM && above !== BlockId.MELON_STEM) dim.setBlock(x, y, z, BlockId.DIRT, 0);
        }
        return;
      }
      case BlockId.ICE:
        if (dim.getBlockLight(x, y + 1, z) > 11 || dim.getBlockLight(x, y, z) > 11) dim.setBlock(x, y, z, BlockId.WATER, 0);
        return;
      case BlockId.SNOW_LAYER:
        if (dim.getBlockLight(x, y, z) > 11) dim.setBlock(x, y, z, 0, 0);
        return;
      case BlockId.LIT_REDSTONE_ORE:
        dim.setBlock(x, y, z, BlockId.REDSTONE_ORE, 0);
        return;
      case BlockId.FIRE:
        this.fireTick(dim, x, y, z);
        return;
      case BlockId.LAVA:
        this.lavaIgnite(dim, x, y, z);
        return;
      default:
        return;
    }
  }

  /** Called by the world weather code: snow and ice accumulate in cold biomes. */
  weatherTick(dim: Dimension, x: number, z: number): void {
    if (dim.id !== Dim.OVERWORLD) return;
    const c = dim.getChunkAt(x, z);
    if (!c) return;
    const b = biomeDef(c.biomes[(x & 15) | ((z & 15) << 4)]);
    if (!b.snowy) return;
    const top = c.topBlockY(x & 15, z & 15);
    if (top < 0 || top >= 127) return;
    const id = dim.getBlock(x, top, z);
    if (isWater(id) && dim.getMeta(x, top, z) === 0 && dim.getBlockLight(x, top + 1, z) < 10) {
      dim.setBlock(x, top, z, BlockId.ICE, 0);
    } else if (this.ctx.world.raining && id !== BlockId.SNOW_LAYER && dim.getBlock(x, top + 1, z) === 0 &&
      canStay(dim, BlockId.SNOW_LAYER, 0, x, top + 1, z) && dim.getBlockLight(x, top + 1, z) < 10 && getBlock(id).solid) {
      dim.setBlock(x, top + 1, z, BlockId.SNOW_LAYER, 0);
    }
  }

  private logNearby(dim: Dimension, x: number, y: number, z: number): boolean {
    // Breadth-first search through leaves up to 4 blocks for a log.
    const seen = new Set<string>();
    let frontier: [number, number, number][] = [[x, y, z]];
    for (let depth = 0; depth <= 4 && frontier.length > 0; depth++) {
      const next: [number, number, number][] = [];
      for (const [cx, cy, cz] of frontier) {
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = cx + dx; const ny = cy + dy; const nz = cz + dz;
          const key = `${nx},${ny},${nz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const id = dim.getBlock(nx, ny, nz);
          if (id === BlockId.LOG) return true;
          if (id === BlockId.LEAVES) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
    }
    // Unloaded neighbourhood counts as "has a log" to avoid decaying at chunk edges.
    return !dim.isLoaded(x + 5, z + 5) || !dim.isLoaded(x - 5, z - 5);
  }

  private waterNearby(dim: Dimension, x: number, y: number, z: number): boolean {
    for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) for (let dy = 0; dy <= 1; dy++) {
      if (isWater(dim.getBlock(x + dx, y + dy, z + dz))) return true;
    }
    return false;
  }

  /** Grow a sapling into a tree. */
  growTree(dim: Dimension, x: number, y: number, z: number, type: number): boolean {
    const access = this.featureAccess(dim);
    const r = this.rng;
    dim.setBlock(x, y, z, 0, 0, false);
    let ok: boolean;
    if (type === WoodType.SPRUCE) ok = r.int(3) === 0 ? pineTree(access, r, x, y, z) : spruceTree(access, r, x, y, z);
    else if (type === WoodType.BIRCH) ok = smallTree(access, r, x, y, z, WoodType.BIRCH);
    else ok = r.int(10) === 0 ? bigOak(access, r, x, y, z) : smallTree(access, r, x, y, z, WoodType.OAK);
    if (!ok) dim.setBlock(x, y, z, BlockId.SAPLING, type, false);
    return ok;
  }

  growMushroom(dim: Dimension, x: number, y: number, z: number, red: boolean): boolean {
    dim.setBlock(x, y, z, 0, 0, false);
    const ok = hugeMushroom(this.featureAccess(dim), this.rng, x, y, z, red);
    if (!ok) dim.setBlock(x, y, z, red ? BlockId.RED_MUSHROOM : BlockId.BROWN_MUSHROOM, 0, false);
    return ok;
  }

  featureAccess(dim: Dimension): FeatureAccess {
    return {
      getBlock: (x, y, z) => dim.getBlock(x, y, z),
      getMeta: (x, y, z) => dim.getMeta(x, y, z),
      setBlock: (x, y, z, id, meta = 0) => { dim.setBlock(x, y, z, id, meta); },
      addTile: (t) => dim.addSerializedTile(t),
      biomeAt: (x, z) => dim.getChunkAt(x, z)?.biomes[(x & 15) | ((z & 15) << 4)] ?? 1,
      topY: (x, z) => dim.getChunkAt(x, z)?.topBlockY(x & 15, z & 15) ?? -1,
    };
  }

  // --- Fire ------------------------------------------------------------------
  private fireCanStay(dim: Dimension, x: number, y: number, z: number): boolean {
    const below = dim.getBlock(x, y - 1, z);
    if (below !== 0 && getBlock(below).solid) return true;
    return this.flammableAround(dim, x, y, z);
  }

  private flammableAround(dim: Dimension, x: number, y: number, z: number): boolean {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      if (FLAMMABILITY[dim.getBlock(x + dx, y + dy, z + dz)]) return true;
    }
    return false;
  }

  private fireTick(dim: Dimension, x: number, y: number, z: number): void {
    const r = this.rng;
    const below = dim.getBlock(x, y - 1, z);
    const eternal = below === BlockId.NETHERRACK;
    if (!this.fireCanStay(dim, x, y, z)) {
      dim.setBlock(x, y, z, 0, 0);
      return;
    }
    if (!eternal && this.ctx.world.raining && dim.id === Dim.OVERWORLD && dim.getSkyLight(x, y, z) >= 14) {
      dim.setBlock(x, y, z, 0, 0);
      return;
    }
    let age = dim.getMeta(x, y, z);
    if (age < 15) {
      age = Math.min(15, age + r.int(3) / 2 + (r.int(2)));
      dim.setMeta(x, y, z, Math.floor(age), false);
    }
    dim.scheduleTick(x, y, z, 30 + r.int(10));
    if (!eternal && !this.flammableAround(dim, x, y, z)) {
      if (!getBlock(below).solid || age > 3) dim.setBlock(x, y, z, 0, 0);
      return;
    }
    if (!eternal && !FLAMMABILITY[below] && age >= 15 && r.int(4) === 0) {
      dim.setBlock(x, y, z, 0, 0);
      return;
    }
    // Burn neighbouring blocks.
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const nx = x + dx; const ny = y + dy; const nz = z + dz;
      const nid = dim.getBlock(nx, ny, nz);
      const f = FLAMMABILITY[nid];
      if (!f) continue;
      if (r.int(dy !== 0 ? 250 : 300) < f[1]) {
        if (nid === BlockId.TNT) this.igniteTnt(dim, nx, ny, nz);
        else if (r.int(age + 10) < 5) dim.setBlock(nx, ny, nz, BlockId.FIRE, 0);
        else dim.setBlock(nx, ny, nz, 0, 0);
      }
    }
    // Spread into air next to flammable blocks.
    for (let i = 0; i < 2; i++) {
      const nx = x + r.int(3) - 1; const ny = y + r.int(5) - 1; const nz = z + r.int(3) - 1;
      if (dim.getBlock(nx, ny, nz) !== 0) continue;
      let enc = 0;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const ff = FLAMMABILITY[dim.getBlock(nx + dx, ny + dy, nz + dz)];
        if (ff) enc = Math.max(enc, ff[0]);
      }
      if (enc > 0 && r.int(100) < enc) dim.setBlock(nx, ny, nz, BlockId.FIRE, 0);
    }
  }

  private lavaIgnite(dim: Dimension, x: number, y: number, z: number): void {
    const r = this.rng;
    let tx = x; let ty = y; let tz = z;
    for (let i = 0; i < r.int(3); i++) {
      tx += r.int(3) - 1; ty += 1; tz += r.int(3) - 1;
      const id = dim.getBlock(tx, ty, tz);
      if (id === 0) {
        if (this.flammableAround(dim, tx, ty, tz)) {
          dim.setBlock(tx, ty, tz, BlockId.FIRE, 0);
          return;
        }
      } else if (getBlock(id).solid) {
        return;
      }
    }
  }
}

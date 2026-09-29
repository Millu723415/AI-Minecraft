/**
 * Block placement rules: whether a block can exist at a position (support),
 * and which metadata a placed block gets from the player's facing.
 */

import { BlockId } from '../blocks/ids';
import { getBlock, SOLID } from '../blocks/registry';
import { Attach, ATTACH_DIR, BED_HEAD, DOOR_UPPER, SLAB_TOP, facingAwayFromPlayer, facingTowardPlayer } from '../blocks/meta';
import type { Dimension } from './dimension';

type Reader = Pick<Dimension, 'getBlock' | 'getMeta'>;

/** Full solid cube that can support torches, ladders, buttons etc. */
export function isSolidSide(d: Reader, x: number, y: number, z: number): boolean {
  const id = d.getBlock(x, y, z);
  return SOLID[id] === 1;
}

/** Top surface that can support things standing on it (floor torches, rails...). */
export function isSolidTop(d: Reader, x: number, y: number, z: number): boolean {
  const id = d.getBlock(x, y, z);
  if (SOLID[id]) return true;
  if (id === BlockId.SLAB) return (d.getMeta(x, y, z) & SLAB_TOP) !== 0;
  if (id === BlockId.OAK_STAIRS || id === BlockId.COBBLESTONE_STAIRS || id === BlockId.BRICK_STAIRS ||
      id === BlockId.STONE_BRICK_STAIRS || id === BlockId.NETHER_BRICK_STAIRS || id === BlockId.SANDSTONE_STAIRS) {
    return (d.getMeta(x, y, z) & 4) !== 0;
  }
  if (id === BlockId.GLASS || id === BlockId.LEAVES || id === BlockId.FENCE || id === BlockId.NETHER_BRICK_FENCE || id === BlockId.GLOWSTONE) return true;
  return false;
}

const SOIL_PLANTS = new Set<number>([BlockId.SAPLING, BlockId.TALL_GRASS, BlockId.DANDELION, BlockId.ROSE]);

/** Can the block stay at (x,y,z) given its neighbours? */
export function canStay(d: Reader, id: number, meta: number, x: number, y: number, z: number): boolean {
  const below = d.getBlock(x, y - 1, z);
  switch (id) {
    case BlockId.SAPLING:
    case BlockId.TALL_GRASS:
    case BlockId.DANDELION:
    case BlockId.ROSE:
      return below === BlockId.GRASS || below === BlockId.DIRT || below === BlockId.FARMLAND;
    case BlockId.DEAD_BUSH:
      return below === BlockId.SAND;
    case BlockId.BROWN_MUSHROOM:
    case BlockId.RED_MUSHROOM:
      return below === BlockId.MYCELIUM || (isSolidTop(d, x, y - 1, z) && below !== BlockId.GLASS);
    case BlockId.WHEAT_CROP:
    case BlockId.PUMPKIN_STEM:
    case BlockId.MELON_STEM:
      return below === BlockId.FARMLAND;
    case BlockId.NETHER_WART:
      return below === BlockId.SOUL_SAND;
    case BlockId.CACTUS: {
      if (below !== BlockId.CACTUS && below !== BlockId.SAND) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = d.getBlock(x + dx, y, z + dz);
        if (n !== 0 && getBlock(n).collides) return false;
      }
      return true;
    }
    case BlockId.SUGAR_CANE: {
      if (below === BlockId.SUGAR_CANE) return true;
      if (below !== BlockId.GRASS && below !== BlockId.DIRT && below !== BlockId.SAND) return false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = d.getBlock(x + dx, y - 1, z + dz);
        if (n === BlockId.WATER || n === BlockId.WATER_FLOWING) return true;
      }
      return false;
    }
    case BlockId.LILY_PAD:
      return below === BlockId.WATER || (below === BlockId.WATER_FLOWING && d.getMeta(x, y - 1, z) === 0);
    case BlockId.SNOW_LAYER:
      return isSolidTop(d, x, y - 1, z) && below !== BlockId.ICE;
    case BlockId.TORCH:
    case BlockId.REDSTONE_TORCH:
    case BlockId.REDSTONE_TORCH_OFF: {
      if (meta === Attach.FLOOR || meta > 4) return isSolidTop(d, x, y - 1, z);
      const [dx, dy, dz] = ATTACH_DIR[meta];
      return isSolidSide(d, x + dx, y + dy, z + dz);
    }
    case BlockId.LADDER:
    case BlockId.WALL_SIGN: {
      const m = meta >= 1 && meta <= 4 ? meta : Attach.NORTH;
      const [dx, dy, dz] = ATTACH_DIR[m];
      return isSolidSide(d, x + dx, y + dy, z + dz);
    }
    case BlockId.STONE_BUTTON:
    case BlockId.WOODEN_BUTTON:
    case BlockId.LEVER: {
      const m = meta & 7;
      if (m === Attach.FLOOR || m === Attach.FLOOR_LEVER) return isSolidTop(d, x, y - 1, z);
      const [dx, dy, dz] = ATTACH_DIR[m];
      return isSolidSide(d, x + dx, y + dy, z + dz);
    }
    case BlockId.SIGN:
    case BlockId.RAIL:
    case BlockId.POWERED_RAIL:
    case BlockId.DETECTOR_RAIL:
    case BlockId.STONE_PRESSURE_PLATE:
    case BlockId.WOODEN_PRESSURE_PLATE:
    case BlockId.REDSTONE_WIRE:
    case BlockId.REPEATER_OFF:
    case BlockId.REPEATER_ON:
      return isSolidTop(d, x, y - 1, z) || (id === BlockId.SIGN && below !== 0);
    case BlockId.WOODEN_DOOR:
    case BlockId.IRON_DOOR: {
      if (meta & DOOR_UPPER) return d.getBlock(x, y - 1, z) === id;
      return isSolidTop(d, x, y - 1, z) && d.getBlock(x, y + 1, z) === id;
    }
    case BlockId.BED: {
      const dir = meta & 3;
      const [fx, fz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][dir];
      const other = meta & BED_HEAD ? [x - fx, z - fz] : [x + fx, z + fz];
      return d.getBlock(other[0], y, other[1]) === BlockId.BED;
    }
    case BlockId.CAKE:
      return below !== 0 && getBlock(below).collides;
    case BlockId.FIRE:
      return true;
    default:
      return true;
  }
}

export function isPlant(id: number): boolean {
  return SOIL_PLANTS.has(id);
}

export interface PlaceContext {
  yaw: number;
  pitch: number;
  /** Face index of the clicked block that the new block is placed against. */
  face: number;
  /** Hit position within the clicked block face (0..1). */
  hitY: number;
}

/** Metadata for a block placed by a player. */
export function placementMeta(id: number, itemMeta: number, ctx: PlaceContext): number {
  switch (id) {
    case BlockId.TORCH:
    case BlockId.REDSTONE_TORCH:
    case BlockId.LADDER:
      return ctx.face === 2 || ctx.face === 3 ? Attach.FLOOR : attachFromFace(ctx.face);
    case BlockId.STONE_BUTTON:
    case BlockId.WOODEN_BUTTON:
      return attachFromFace(ctx.face);
    case BlockId.LEVER:
      return ctx.face === 2 ? Attach.FLOOR_LEVER : attachFromFace(ctx.face);
    case BlockId.FURNACE:
    case BlockId.CHEST:
    case BlockId.PUMPKIN:
    case BlockId.JACK_O_LANTERN:
      return facingTowardPlayer(ctx.yaw);
    case BlockId.REPEATER_OFF:
      return facingAwayFromPlayer(ctx.yaw);
    case BlockId.OAK_STAIRS:
    case BlockId.COBBLESTONE_STAIRS:
    case BlockId.BRICK_STAIRS:
    case BlockId.STONE_BRICK_STAIRS:
    case BlockId.NETHER_BRICK_STAIRS:
    case BlockId.SANDSTONE_STAIRS: {
      // Ascend away from the player; upside down when placed on a ceiling.
      const f = facingAwayFromPlayer(ctx.yaw);
      const dir = [2, 1, 3, 0][f];
      const upside = ctx.face === 3 || (ctx.face !== 2 && ctx.hitY > 0.5);
      return dir | (upside ? 4 : 0);
    }
    case BlockId.SLAB: {
      const top = ctx.face === 3 || (ctx.face !== 2 && ctx.hitY > 0.5);
      return (itemMeta & 7) | (top ? SLAB_TOP : 0);
    }
    case BlockId.LOG:
    case BlockId.PLANKS:
    case BlockId.SAPLING:
    case BlockId.WOOL:
    case BlockId.STONE_BRICKS:
    case BlockId.TALL_GRASS:
      return itemMeta;
    case BlockId.LEAVES:
      return (itemMeta & 3) | 4; // player placed: never decays
    case BlockId.RAIL:
    case BlockId.POWERED_RAIL:
    case BlockId.DETECTOR_RAIL: {
      const f = facingTowardPlayer(ctx.yaw);
      return f === 1 || f === 3 ? 1 : 0;
    }
    case BlockId.PISTON:
    case BlockId.STICKY_PISTON: {
      if (ctx.pitch > 0.8) return 3; // looking up -> faces down
      if (ctx.pitch < -0.8) return 2;
      const f = facingTowardPlayer(ctx.yaw);
      return [4, 1, 5, 0][f];
    }
    case BlockId.TRAPDOOR: {
      const f = attachFromFace(ctx.face);
      return f === Attach.EAST ? 2 : f === Attach.WEST ? 3 : f === Attach.SOUTH ? 0 : 1;
    }
    case BlockId.FENCE_GATE: {
      const f = facingTowardPlayer(ctx.yaw);
      return f === 1 || f === 3 ? 1 : 0;
    }
    case BlockId.END_PORTAL_FRAME:
      return facingTowardPlayer(ctx.yaw);
    case BlockId.SIGN:
      return Math.floor(((((-ctx.yaw) / (Math.PI * 2)) * 16) + 8.5)) & 15;
    default:
      return 0;
  }
}

function attachFromFace(face: number): number {
  switch (face) {
    case 0: return Attach.WEST;
    case 1: return Attach.EAST;
    case 4: return Attach.NORTH;
    case 5: return Attach.SOUTH;
    default: return Attach.FLOOR;
  }
}

/** Door facing (closed edge) from player yaw, so the door is on the far side of the block. */
export function doorMeta(yaw: number): number {
  const f = facingAwayFromPlayer(yaw); // direction the player looks
  // Looking south (+Z) -> door on the north edge? Classic doors sit on the edge nearest the player.
  return [1, 2, 3, 0][f];
}

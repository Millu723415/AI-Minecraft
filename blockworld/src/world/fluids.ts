/**
 * Water and lava flow, modelled on the classic level-based algorithm:
 * sources (level 0) spread outward with increasing levels, falling liquid
 * (level >= 8) pours straight down, flow prefers the nearest drop-off, and
 * two adjacent water sources over solid ground create a new source.
 */

import { BlockId } from '../blocks/ids';
import { getBlock, IS_FLUID } from '../blocks/registry';
import { Dim } from './constants';
import type { Dimension } from './dimension';

export interface FluidHost {
  /** Called when flowing liquid washes away a block (drop its items). */
  washAway(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): void;
  fizz(dim: Dimension, x: number, y: number, z: number): void;
  random(): number;
}

const DIRS: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function isWater(id: number): boolean {
  return id === BlockId.WATER || id === BlockId.WATER_FLOWING;
}
export function isLava(id: number): boolean {
  return id === BlockId.LAVA || id === BlockId.LAVA_FLOWING;
}

function sameFluid(id: number, kind: number): boolean {
  return IS_FLUID[id] === kind;
}

export function fluidTickRate(kind: number, dim: Dimension): number {
  if (kind === 1) return 5;
  return dim.id === Dim.NETHER ? 10 : 30;
}

/** Can liquid flow into (displace) this block? */
function canDisplace(id: number): boolean {
  if (id === 0) return true;
  if (IS_FLUID[id]) return false;
  const def = getBlock(id);
  if (id === BlockId.WOODEN_DOOR || id === BlockId.IRON_DOOR || id === BlockId.SIGN || id === BlockId.WALL_SIGN ||
      id === BlockId.LADDER || id === BlockId.SUGAR_CANE) return false;
  if (id === BlockId.NETHER_PORTAL || id === BlockId.END_PORTAL) return false;
  return !def.collides && !def.solid;
}

function level(dim: Dimension, x: number, y: number, z: number, kind: number): number {
  const id = dim.getBlock(x, y, z);
  if (!sameFluid(id, kind)) return -1;
  return dim.getMeta(x, y, z);
}

function flowBlock(kind: number): number {
  return kind === 1 ? BlockId.WATER_FLOWING : BlockId.LAVA_FLOWING;
}
function sourceBlock(kind: number): number {
  return kind === 1 ? BlockId.WATER : BlockId.LAVA;
}

/**
 * When lava touches water: lava sources become obsidian, flowing lava becomes
 * cobblestone. Returns true if the block hardened.
 */
export function checkHarden(dim: Dimension, host: FluidHost, x: number, y: number, z: number): boolean {
  const id = dim.getBlock(x, y, z);
  if (!isLava(id)) return false;
  let touching = false;
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    if (isWater(dim.getBlock(x + dx, y + dy, z + dz))) touching = true;
  }
  if (!touching) return false;
  const meta = dim.getMeta(x, y, z);
  if (meta === 0) dim.setBlock(x, y, z, BlockId.OBSIDIAN, 0);
  else if (meta <= 4) dim.setBlock(x, y, z, BlockId.COBBLESTONE, 0);
  else return false;
  host.fizz(dim, x, y, z);
  return true;
}

/** Distance-limited search for the directions leading to the nearest drop. */
function flowDirections(dim: Dimension, x: number, y: number, z: number, kind: number): boolean[] {
  const costs = [1000, 1000, 1000, 1000];
  const blocked = (bx: number, by: number, bz: number) => {
    const id = dim.getBlock(bx, by, bz);
    return !(canDisplace(id) || sameFluid(id, kind)) || (sameFluid(id, kind) && dim.getMeta(bx, by, bz) === 0);
  };
  const search = (bx: number, bz: number, depth: number, from: number): number => {
    let best = 1000;
    for (let d = 0; d < 4; d++) {
      if ((d === 0 && from === 1) || (d === 1 && from === 0) || (d === 2 && from === 3) || (d === 3 && from === 2)) continue;
      const nx = bx + DIRS[d][0];
      const nz = bz + DIRS[d][1];
      if (blocked(nx, y, nz)) continue;
      if (!blocked(nx, y - 1, nz)) return depth;
      if (depth < 4) {
        const c = search(nx, nz, depth + 1, d);
        if (c < best) best = c;
      }
    }
    return best;
  };
  for (let d = 0; d < 4; d++) {
    const nx = x + DIRS[d][0];
    const nz = z + DIRS[d][1];
    if (blocked(nx, y, nz)) continue;
    costs[d] = !blocked(nx, y - 1, nz) ? 0 : search(nx, nz, 1, d);
  }
  const min = Math.min(...costs);
  return costs.map((c) => c === min && c < 1000);
}

function flowInto(dim: Dimension, host: FluidHost, x: number, y: number, z: number, kind: number, lvl: number): void {
  const id = dim.getBlock(x, y, z);
  if (!canDisplace(id)) return;
  if (id !== 0) {
    if (kind === 2) host.fizz(dim, x, y, z);
    else host.washAway(dim, x, y, z, id, dim.getMeta(x, y, z));
  }
  dim.setBlock(x, y, z, flowBlock(kind), lvl);
  dim.scheduleTick(x, y, z, fluidTickRate(kind, dim));
}

/** Scheduled update of a liquid block. */
export function tickFluid(dim: Dimension, host: FluidHost, x: number, y: number, z: number): void {
  const id = dim.getBlock(x, y, z);
  const kind = IS_FLUID[id];
  if (!kind) return;
  if (kind === 2 && checkHarden(dim, host, x, y, z)) return;
  const decay = kind === 2 && dim.id !== Dim.NETHER ? 2 : 1;
  let meta = dim.getMeta(x, y, z);

  if (meta > 0) {
    // Recompute this flowing block's level from its neighbours.
    let minLevel = 100;
    let sources = 0;
    for (const [dx, dz] of DIRS) {
      const l = level(dim, x + dx, y, z + dz, kind);
      if (l < 0) continue;
      if (l === 0) sources++;
      const eff = l >= 8 ? 0 : l;
      if (eff < minLevel) minLevel = eff;
    }
    let newLevel = minLevel + decay;
    if (newLevel >= 8 || minLevel === 100) newLevel = -1;
    const above = level(dim, x, y + 1, z, kind);
    if (above >= 0) newLevel = above >= 8 ? above : above + 8;
    if (kind === 1 && sources >= 2) {
      const below = dim.getBlock(x, y - 1, z);
      if (getBlock(below).solid || (isWater(below) && dim.getMeta(x, y - 1, z) === 0)) newLevel = 0;
    }
    if (kind === 2 && meta < 8 && newLevel < 8 && newLevel > meta && host.random() < 0.25) newLevel = meta;
    if (newLevel !== meta) {
      if (newLevel < 0) {
        dim.setBlock(x, y, z, 0, 0);
        return;
      }
      meta = newLevel;
      dim.setBlock(x, y, z, newLevel === 0 ? sourceBlock(kind) : flowBlock(kind), newLevel);
      dim.scheduleTick(x, y, z, fluidTickRate(kind, dim));
    }
  }

  // Flow downward first.
  const belowId = dim.getBlock(x, y - 1, z);
  if (y > 0 && canDisplace(belowId)) {
    flowInto(dim, host, x, y - 1, z, kind, meta >= 8 ? meta : meta + 8);
    return;
  }
  if (kind === 2 && isWater(belowId)) {
    dim.setBlock(x, y - 1, z, BlockId.STONE, 0);
    host.fizz(dim, x, y - 1, z);
    return;
  }
  if (y > 0 && sameFluid(belowId, kind)) return;

  // Spread sideways.
  const spread = meta >= 8 ? decay : meta + decay;
  if (spread >= 8) return;
  const dirs = flowDirections(dim, x, y, z, kind);
  for (let d = 0; d < 4; d++) {
    if (!dirs[d]) continue;
    const nx = x + DIRS[d][0];
    const nz = z + DIRS[d][1];
    const nid = dim.getBlock(nx, y, nz);
    if (sameFluid(nid, kind)) {
      const nl = dim.getMeta(nx, y, nz);
      if (nl !== 0 && (nl >= 8 || nl > spread)) {
        dim.setBlock(nx, y, nz, flowBlock(kind), spread);
        dim.scheduleTick(nx, y, nz, fluidTickRate(kind, dim));
      }
      continue;
    }
    if (kind === 1 && isLava(nid)) {
      // Water flowing against lava hardens it.
      checkHarden(dim, host, nx, y, nz);
      continue;
    }
    flowInto(dim, host, nx, y, nz, kind, spread);
  }
}

/** Any neighbour change near a liquid: re-evaluate it soon. */
export function onFluidNeighborChanged(dim: Dimension, host: FluidHost, x: number, y: number, z: number): void {
  const id = dim.getBlock(x, y, z);
  const kind = IS_FLUID[id];
  if (!kind) return;
  if (kind === 2 && checkHarden(dim, host, x, y, z)) return;
  dim.scheduleTick(x, y, z, fluidTickRate(kind, dim));
}

/**
 * Lightweight voxel A* for walking mobs. Nodes are block positions where a
 * mob of the given height can stand. Moves: flat steps, one-block step ups,
 * drops of up to three blocks. Search is capped to keep CPU cost bounded.
 */

import { BlockId } from '../../blocks/ids';
import { getBlock, IS_FLUID } from '../../blocks/registry';
import type { Dimension } from '../../world/dimension';

export interface PathNode { x: number; y: number; z: number }

const MAX_NODES = 400;

function passable(dim: Dimension, x: number, y: number, z: number, canOpenDoors: boolean): boolean {
  const id = dim.getBlock(x, y, z);
  if (id === 0) return true;
  if (id === BlockId.WOODEN_DOOR && canOpenDoors) return true;
  const def = getBlock(id);
  if (def.fluid === 'lava' || id === BlockId.FIRE || id === BlockId.CACTUS) return false;
  return !def.collides;
}

function standable(dim: Dimension, x: number, y: number, z: number, height: number, canOpenDoors: boolean, avoidWater: boolean): boolean {
  for (let h = 0; h < height; h++) if (!passable(dim, x, y + h, z, canOpenDoors)) return false;
  const below = dim.getBlock(x, y - 1, z);
  if (below === BlockId.LAVA || below === BlockId.LAVA_FLOWING || below === BlockId.FIRE || below === BlockId.CACTUS) return false;
  const inWater = IS_FLUID[dim.getBlock(x, y, z)] === 1;
  if (inWater) return !avoidWater;
  if (IS_FLUID[below] === 1) return !avoidWater;
  const def = getBlock(below);
  if (below === BlockId.FENCE || below === BlockId.NETHER_BRICK_FENCE || below === BlockId.FENCE_GATE) return false;
  return def.collides;
}

export interface PathOptions {
  height: number;
  canOpenDoors?: boolean;
  avoidWater?: boolean;
  maxDrop?: number;
}

export function findPath(dim: Dimension, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number, opts: PathOptions, maxDist = 32): PathNode[] | null {
  const h = Math.ceil(opts.height);
  const doors = !!opts.canOpenDoors;
  const avoidWater = !!opts.avoidWater;
  const maxDrop = opts.maxDrop ?? 3;
  const key = (x: number, y: number, z: number) => ((x - sx + 512) * 1024 + (z - sz + 512)) * 256 + y;
  const open: { k: number; x: number; y: number; z: number; g: number; f: number }[] = [];
  const came = new Map<number, number>();
  const gScore = new Map<number, number>();
  const nodes = new Map<number, PathNode>();
  const hFn = (x: number, y: number, z: number) => Math.abs(x - tx) + Math.abs(y - ty) + Math.abs(z - tz);
  const startK = key(sx, sy, sz);
  nodes.set(startK, { x: sx, y: sy, z: sz });
  gScore.set(startK, 0);
  open.push({ k: startK, x: sx, y: sy, z: sz, g: 0, f: hFn(sx, sy, sz) });
  let best = open[0];
  let bestH = hFn(sx, sy, sz);
  let expanded = 0;
  while (open.length > 0 && expanded < MAX_NODES) {
    // Pop lowest f (small open sets, linear scan is fine).
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
    const cur = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    expanded++;
    const hh = hFn(cur.x, cur.y, cur.z);
    if (hh < bestH) { bestH = hh; best = cur; }
    if (cur.x === tx && cur.z === tz && Math.abs(cur.y - ty) <= 1) { best = cur; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const nz = cur.z + dz;
      if (Math.abs(nx - sx) > maxDist || Math.abs(nz - sz) > maxDist) continue;
      let ny = -1;
      if (standable(dim, nx, cur.y, nz, h, doors, avoidWater)) ny = cur.y;
      else if (standable(dim, nx, cur.y + 1, nz, h, doors, avoidWater) && passable(dim, cur.x, cur.y + h, cur.z, doors)) ny = cur.y + 1;
      else {
        // Walk off an edge: fall up to maxDrop blocks.
        let clear = true;
        for (let k = 0; k < h; k++) if (!passable(dim, nx, cur.y + k, nz, doors)) clear = false;
        if (clear) {
          for (let d = 1; d <= maxDrop; d++) {
            if (!passable(dim, nx, cur.y - d, nz, doors)) break;
            if (standable(dim, nx, cur.y - d, nz, h, doors, avoidWater)) { ny = cur.y - d; break; }
          }
        }
      }
      if (ny < 0) continue;
      const nk = key(nx, ny, nz);
      const water = IS_FLUID[dim.getBlock(nx, ny, nz)] === 1 ? 2 : 0;
      const g = cur.g + 1 + water + (ny !== cur.y ? 0.5 : 0);
      if (g >= (gScore.get(nk) ?? Infinity)) continue;
      gScore.set(nk, g);
      came.set(nk, cur.k);
      nodes.set(nk, { x: nx, y: ny, z: nz });
      open.push({ k: nk, x: nx, y: ny, z: nz, g, f: g + hFn(nx, ny, nz) * 1.2 });
    }
  }
  if (best.k === startK) return null;
  const path: PathNode[] = [];
  let k: number | undefined = best.k;
  while (k !== undefined && k !== startK) {
    path.push(nodes.get(k)!);
    k = came.get(k);
  }
  path.reverse();
  return path;
}

/** Pick a random reachable-looking standing spot near (x, y, z). */
export function randomStandingSpot(dim: Dimension, x: number, y: number, z: number, range: number, vRange: number, height: number, rnd: () => number, avoidWater = true): PathNode | null {
  for (let i = 0; i < 10; i++) {
    const tx = Math.floor(x + (rnd() * 2 - 1) * range);
    const tz = Math.floor(z + (rnd() * 2 - 1) * range);
    const ty = Math.floor(y + (rnd() * 2 - 1) * vRange);
    for (let dy = 0; dy <= vRange * 2; dy++) {
      const yy = ty - dy + vRange;
      if (yy < 1 || yy > 126) continue;
      if (standable(dim, tx, yy, tz, Math.ceil(height), false, avoidWater)) return { x: tx, y: yy, z: tz };
    }
  }
  return null;
}

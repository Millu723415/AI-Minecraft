/**
 * Pure redstone connectivity rules shared by the simulation (redstone.ts) and
 * the mesher (which draws dust with its connections).
 */

import { BlockId } from '../blocks/ids';
import { SOLID, getBlock, isBlockDefined } from '../blocks/registry';

/** Solid opaque full cubes conduct power ("normal cubes"). */
export const CONDUCTOR = new Uint8Array(256);
for (let id = 1; id < 256; id++) {
  if (!isBlockDefined(id)) continue;
  const d = getBlock(id);
  if (SOLID[id] && d.shape === 'cube' && id !== BlockId.LEAVES && id !== BlockId.GLASS) CONDUCTOR[id] = 1;
}

/** Horizontal directions in the order +X, -X, +Z, -Z (bit i of a connection mask). */
export const HDIRS: ReadonlyArray<readonly [number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export type Reader = (dx: number, dy: number, dz: number) => number;

/** Does a wire connect to block `id` (meta `meta`) lying in horizontal direction (dx, dz)? */
export function connectsSideways(id: number, meta: number, dx: number, dz: number): boolean {
  switch (id) {
    case BlockId.REDSTONE_WIRE:
    case BlockId.REDSTONE_TORCH:
    case BlockId.REDSTONE_TORCH_OFF:
    case BlockId.LEVER:
    case BlockId.STONE_BUTTON:
    case BlockId.WOODEN_BUTTON:
    case BlockId.STONE_PRESSURE_PLATE:
    case BlockId.WOODEN_PRESSURE_PLATE:
    case BlockId.DETECTOR_RAIL:
      return true;
    case BlockId.REPEATER_OFF:
    case BlockId.REPEATER_ON: {
      // Only along the repeater's axis (Facing4 in the low bits: 0 +Z, 1 -X, 2 -Z, 3 +X).
      const f = meta & 3;
      const alongZ = f === 0 || f === 2;
      return alongZ ? dx === 0 : dz === 0;
    }
    default:
      return false;
  }
}

export interface WireShape {
  /** Bit i set: connected toward HDIRS[i] (same level, stepping down or up). */
  mask: number;
  /** Bit i set: the connection climbs the face of the block toward HDIRS[i]. */
  up: number;
}

/**
 * Connection shape of the wire at the origin of `get`/`meta` readers
 * (offsets relative to the wire).
 */
export function wireShape(get: Reader, meta: Reader): WireShape {
  let mask = 0;
  let up = 0;
  const aboveConducts = CONDUCTOR[get(0, 1, 0)] === 1;
  for (let i = 0; i < 4; i++) {
    const [dx, dz] = HDIRS[i];
    const n = get(dx, 0, dz);
    if (connectsSideways(n, meta(dx, 0, dz), dx, dz)) { mask |= 1 << i; continue; }
    if (!aboveConducts && get(dx, 1, dz) === BlockId.REDSTONE_WIRE) { mask |= 1 << i; up |= 1 << i; continue; }
    if (!CONDUCTOR[n] && get(dx, -1, dz) === BlockId.REDSTONE_WIRE) mask |= 1 << i;
  }
  return { mask, up };
}

/**
 * Which horizontal neighbours a powered wire points into: a dot points
 * everywhere; a straight line (or single arm) points along its axis; bends
 * and junctions point nowhere sideways.
 */
export function wirePointsMask(mask: number): number {
  if (mask === 0) return 0b1111;
  const x = mask & 0b0011;
  const z = mask & 0b1100;
  if (x && !z) return 0b0011;
  if (z && !x) return 0b1100;
  return 0;
}

/** Vertex colour of dust at a power level (dim red when off, bright when on). */
export function wireColor(power: number): [number, number, number] {
  if (power <= 0) return [77, 0, 0];
  const p = power / 15;
  const r = p * 0.6 + 0.4;
  const g = Math.max(0, p * p * 0.7 - 0.5);
  const b = Math.max(0, p * p * 0.6 - 0.7);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

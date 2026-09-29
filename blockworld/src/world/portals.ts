/**
 * Nether portals (2x3 obsidian frames lit by fire) and End portals (a ring of
 * twelve frames, each holding an Eye of Ender).
 */

import { BlockId } from '../blocks/ids';
import { FRAME_EYE } from '../blocks/meta';
import type { Dimension } from './dimension';
import { WORLD_HEIGHT } from './constants';

type Reader = Pick<Dimension, 'getBlock' | 'getMeta'>;

/**
 * Try to light a nether portal whose interior contains (x, y, z).
 * Returns true if portal blocks were created.
 */
export function tryCreateNetherPortal(dim: Dimension, x: number, y: number, z: number): boolean {
  for (const axis of [0, 1] as const) {
    const dx = axis === 0 ? 1 : 0;
    const dz = axis === 0 ? 0 : 1;
    // Find the lower-left interior corner by sliding within the 2-wide gap.
    for (let shift = 0; shift <= 1; shift++) {
      const ox = x - dx * shift;
      const oz = z - dz * shift;
      for (let base = y - 2; base <= y; base++) {
        if (validFrame(dim, ox, base, oz, dx, dz)) {
          fill(dim, ox, base, oz, dx, dz, axis);
          return true;
        }
      }
    }
  }
  return false;
}

function isInterior(id: number): boolean {
  return id === 0 || id === BlockId.FIRE;
}

/** Interior lower-left at (x, y, z), 2 wide along (dx,dz) and 3 tall. */
function validFrame(d: Reader, x: number, y: number, z: number, dx: number, dz: number): boolean {
  if (y < 1 || y + 3 >= WORLD_HEIGHT) return false;
  for (let i = -1; i <= 2; i++) {
    for (let j = -1; j <= 3; j++) {
      const corner = (i === -1 || i === 2) && (j === -1 || j === 3);
      if (corner) continue;
      const bx = x + dx * i;
      const bz = z + dz * i;
      const id = d.getBlock(bx, y + j, bz);
      const frame = i === -1 || i === 2 || j === -1 || j === 3;
      if (frame) {
        if (id !== BlockId.OBSIDIAN) return false;
      } else if (!isInterior(id)) {
        return false;
      }
    }
  }
  return true;
}

function fill(dim: Dimension, x: number, y: number, z: number, dx: number, dz: number, axis: number): void {
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 3; j++) {
      dim.setBlock(x + dx * i, y + j, z + dz * i, BlockId.NETHER_PORTAL, axis, false);
    }
  }
}

/** Remove the whole portal if its frame was broken. */
export function checkPortalIntegrity(dim: Dimension, x: number, y: number, z: number): void {
  const axis = dim.getMeta(x, y, z);
  const dx = axis === 0 ? 1 : 0;
  const dz = axis === 0 ? 0 : 1;
  const ok = (bx: number, by: number, bz: number) => {
    const id = dim.getBlock(bx, by, bz);
    return id === BlockId.NETHER_PORTAL || id === BlockId.OBSIDIAN;
  };
  if (ok(x, y + 1, z) && ok(x, y - 1, z) && ok(x + dx, y, z + dz) && ok(x - dx, y, z - dz)) return;
  // Collapse all connected portal blocks.
  const stack: [number, number, number][] = [[x, y, z]];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const [cx, cy, cz] = stack.pop()!;
    const key = `${cx},${cy},${cz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (dim.getBlock(cx, cy, cz) !== BlockId.NETHER_PORTAL) continue;
    dim.setBlock(cx, cy, cz, 0, 0, false);
    dim.markBlockDirty(cx, cy, cz);
    stack.push([cx, cy + 1, cz], [cx, cy - 1, cz], [cx + dx, cy, cz + dz], [cx - dx, cy, cz - dz]);
  }
}

/** Find the nearest existing portal block in loaded chunks. */
export function findPortal(dim: Dimension, x: number, z: number, radius: number): [number, number, number] | null {
  let best: [number, number, number] | null = null;
  let bestD = Infinity;
  for (let bx = x - radius; bx <= x + radius; bx++) {
    for (let bz = z - radius; bz <= z + radius; bz++) {
      if (!dim.isLoaded(bx, bz)) continue;
      for (let y = WORLD_HEIGHT - 1; y >= 0; y--) {
        if (dim.getBlock(bx, y, bz) !== BlockId.NETHER_PORTAL) continue;
        // Use the bottom portal block of the column.
        let by = y;
        while (dim.getBlock(bx, by - 1, bz) === BlockId.NETHER_PORTAL) by--;
        const d = (bx - x) ** 2 + (bz - z) ** 2 + (by - 64) ** 2 * 0.01;
        if (d < bestD) {
          bestD = d;
          best = [bx, by, bz];
        }
        break;
      }
    }
  }
  return best;
}

/**
 * Build a new portal near (x, z): prefer a spot with solid ground and air
 * above, otherwise build a floating obsidian platform. Returns the bottom
 * interior block position.
 */
export function createPortalNear(dim: Dimension, x: number, z: number, minY: number, maxY: number): [number, number, number] {
  let best: [number, number, number, number] | null = null;
  const radius = 16;
  for (let bx = x - radius; bx <= x + radius; bx++) {
    for (let bz = z - radius; bz <= z + radius; bz++) {
      if (!dim.isLoaded(bx, bz) || !dim.isLoaded(bx + 3, bz + 3)) continue;
      for (let y = maxY; y >= minY; y--) {
        if (!fitsPortal(dim, bx, y, bz)) continue;
        const d = (bx - x) ** 2 + (bz - z) ** 2;
        if (!best || d < best[3]) best = [bx, y, bz, d];
        break;
      }
    }
  }
  let px: number; let py: number; let pz: number;
  if (best) {
    [px, py, pz] = best;
  } else {
    px = x; pz = z;
    py = Math.max(minY + 2, Math.min(maxY - 6, 70));
    // Floating platform with cleared space.
    for (let i = -1; i <= 2; i++) for (let k = -1; k <= 1; k++) {
      dim.setBlock(px + i, py - 1, pz + k, BlockId.OBSIDIAN, 0, false);
      for (let j = 0; j < 4; j++) dim.setBlock(px + i, py + j, pz + k, 0, 0, false);
    }
  }
  // Frame along X with interior at (px..px+1, py..py+2, pz).
  for (let i = -1; i <= 2; i++) {
    for (let j = -1; j <= 3; j++) {
      const frame = i === -1 || i === 2 || j === -1 || j === 3;
      dim.setBlock(px + i, py + j, pz, frame ? BlockId.OBSIDIAN : BlockId.NETHER_PORTAL, frame ? 0 : 0, false);
    }
  }
  // Clear walking room on both sides.
  for (let i = 0; i <= 1; i++) for (let j = 0; j <= 2; j++) {
    for (const k of [-1, 1]) {
      const id = dim.getBlock(px + i, py + j, pz + k);
      if (id !== 0 && id !== BlockId.OBSIDIAN) dim.setBlock(px + i, py + j, pz + k, 0, 0, false);
    }
    if (!solid(dim, px + i, py - 1, pz - 1)) dim.setBlock(px + i, py - 1, pz - 1, BlockId.OBSIDIAN, 0, false);
    if (!solid(dim, px + i, py - 1, pz + 1)) dim.setBlock(px + i, py - 1, pz + 1, BlockId.OBSIDIAN, 0, false);
  }
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) dim.markBlockDirty(px + i, py + j, pz);
  return [px, py, pz];
}

function solid(dim: Dimension, x: number, y: number, z: number): boolean {
  const id = dim.getBlock(x, y, z);
  return id !== 0 && id !== BlockId.LAVA && id !== BlockId.WATER && id !== BlockId.LAVA_FLOWING && id !== BlockId.WATER_FLOWING && id !== BlockId.FIRE;
}

function fitsPortal(dim: Dimension, x: number, y: number, z: number): boolean {
  // Needs solid ground under a 4x3 footprint and 4x5x3 of air above it.
  for (let i = -1; i <= 2; i++) {
    for (let k = -1; k <= 1; k++) {
      if (!solid(dim, x + i, y - 1, z + k)) return false;
      for (let j = 0; j <= 3; j++) if (dim.getBlock(x + i, y + j, z + k) !== 0) return false;
    }
  }
  return true;
}

/** After inserting an eye, activate the End portal if a complete ring exists. */
export function tryActivateEndPortal(dim: Dimension, x: number, y: number, z: number): boolean {
  for (let cx = x - 4; cx <= x + 4; cx++) {
    for (let cz = z - 4; cz <= z + 4; cz++) {
      if (ringComplete(dim, cx, y, cz)) {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
          dim.setBlock(cx + dx, y, cz + dz, BlockId.END_PORTAL, 0);
        }
        return true;
      }
    }
  }
  return false;
}

/** The 12 frame positions around a 3x3 interior centred at (cx, cz). */
export function ringPositions(cx: number, cz: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = -1; i <= 1; i++) {
    out.push([cx + i, cz - 2], [cx + i, cz + 2], [cx - 2, cz + i], [cx + 2, cz + i]);
  }
  return out;
}

function ringComplete(dim: Reader, cx: number, y: number, cz: number): boolean {
  for (const [fx, fz] of ringPositions(cx, cz)) {
    if (dim.getBlock(fx, y, fz) !== BlockId.END_PORTAL_FRAME) return false;
    if ((dim.getMeta(fx, y, fz) & FRAME_EYE) === 0) return false;
  }
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
    const id = dim.getBlock(cx + dx, y, cz + dz);
    if (id === BlockId.END_PORTAL_FRAME) return false;
  }
  return true;
}

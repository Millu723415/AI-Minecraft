/** Voxel ray casting against block selection boxes. */

import { AABB } from '../core/aabb';
import { BlockId } from '../blocks/ids';
import { IS_FLUID } from '../blocks/registry';
import { selectionBox } from '../render/shapes';
import type { Dimension } from './dimension';

export interface BlockHit {
  x: number; y: number; z: number;
  face: number;
  /** Exact hit point. */
  px: number; py: number; pz: number;
  distance: number;
  id: number;
  meta: number;
}

/** Walk voxels along the ray (Amanatides & Woo) testing precise block boxes. */
export function raycastBlocks(
  dim: Dimension, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number,
  maxDist: number, hitFluids = false,
): BlockHit | null {
  let x = Math.floor(ox); let y = Math.floor(oy); let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1; const stepY = dy > 0 ? 1 : -1; const stepZ = dz > 0 ? 1 : -1;
  const tDeltaX = Math.abs(1 / (dx || 1e-9));
  const tDeltaY = Math.abs(1 / (dy || 1e-9));
  const tDeltaZ = Math.abs(1 / (dz || 1e-9));
  let tMaxX = (dx > 0 ? x + 1 - ox : ox - x) * tDeltaX;
  let tMaxY = (dy > 0 ? y + 1 - oy : oy - y) * tDeltaY;
  let tMaxZ = (dz > 0 ? z + 1 - oz : oz - z) * tDeltaZ;
  for (let i = 0; i < 256; i++) {
    const id = dim.getBlock(x, y, z);
    if (id !== BlockId.AIR && (hitFluids || !IS_FLUID[id])) {
      const meta = dim.getMeta(x, y, z);
      let box;
      if (IS_FLUID[id]) {
        box = { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: meta >= 8 ? 1 : 1 - (meta + 1) / 9, maxZ: 1 };
        if (hitFluids && meta !== 0) {
          // Only source blocks are targetable with buckets.
          box = null;
        }
      } else {
        box = selectionBox(id, meta, (ddx, ddy, ddz) => dim.getBlock(x + ddx, y + ddy, z + ddz));
      }
      if (box) {
        const aabb = new AABB(x + box.minX, y + box.minY, z + box.minZ, x + box.maxX, y + box.maxY, z + box.maxZ);
        const hit = aabb.raycast(ox, oy, oz, dx, dy, dz, maxDist);
        if (hit) {
          return { x, y, z, face: hit.face, px: ox + dx * hit.t, py: oy + dy * hit.t, pz: oz + dz * hit.t, distance: hit.t, id, meta };
        }
      }
    }
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      if (tMaxX > maxDist) break;
      x += stepX; tMaxX += tDeltaX;
    } else if (tMaxY < tMaxZ) {
      if (tMaxY > maxDist) break;
      y += stepY; tMaxY += tDeltaY;
    } else {
      if (tMaxZ > maxDist) break;
      z += stepZ; tMaxZ += tDeltaZ;
    }
  }
  return null;
}

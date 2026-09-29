/** World collision queries shared by entities and the player. */

import { AABB } from '../core/aabb';
import { COLLIDES, getBlock } from '../blocks/registry';
import { collisionBoxes } from '../render/shapes';
import type { Dimension } from './dimension';
import { WORLD_HEIGHT } from './constants';

/**
 * Collision boxes intersecting `area`. Unloaded chunks count as solid so an
 * entity can never fall through terrain that has not been generated yet.
 */
export function gatherCollisions(dim: Dimension, area: AABB, out: AABB[] = []): AABB[] {
  out.length = 0;
  const x0 = Math.floor(area.minX);
  const x1 = Math.floor(area.maxX);
  const y0 = Math.max(0, Math.floor(area.minY) - 1);
  const y1 = Math.min(WORLD_HEIGHT - 1, Math.floor(area.maxY));
  const z0 = Math.floor(area.minZ);
  const z1 = Math.floor(area.maxZ);
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!dim.isLoaded(x, z)) {
        out.push(new AABB(x, 0, z, x + 1, WORLD_HEIGHT + 8, z + 1));
        continue;
      }
      for (let y = y0; y <= y1; y++) {
        const id = dim.getBlock(x, y, z);
        if (id === 0 || !COLLIDES[id]) continue;
        const meta = dim.getMeta(x, y, z);
        const def = getBlock(id);
        if (def.shape === 'cube' && !def.collisionBoxes) {
          out.push(new AABB(x, y, z, x + 1, y + 1, z + 1));
          continue;
        }
        const boxes = collisionBoxes(id, meta, (dx, dy, dz) => dim.getBlock(x + dx, y + dy, z + dz));
        for (const b of boxes) out.push(new AABB(x + b.minX, y + b.minY, z + b.minZ, x + b.maxX, y + b.maxY, z + b.maxZ));
      }
    }
  }
  return out;
}

/** Does any solid collision box intersect the given box? */
export function collidesAny(dim: Dimension, box: AABB): boolean {
  const list = gatherCollisions(dim, box);
  for (const b of list) if (b.intersects(box)) return true;
  return false;
}

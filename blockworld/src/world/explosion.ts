/**
 * Shared explosion system used by creepers, TNT, ghast fireballs and End
 * crystals: ray-marched block destruction by blast resistance, entity damage
 * scaled by distance and exposure, knockback, fire and drops.
 */

import { BlockId } from '../blocks/ids';
import { getBlock, IS_FLUID, resolveDrops } from '../blocks/registry';
import { Random } from '../core/rng';
import type { GameContext } from '../game/context';
import type { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { raycastBlocks } from './raycast';
import type { Dimension } from './dimension';
import { WORLD_HEIGHT } from './constants';

export interface ExplosionResult {
  destroyed: [number, number, number][];
}

export function explode(
  ctx: GameContext, dim: Dimension, x: number, y: number, z: number, power: number,
  fire: boolean, source: Entity | null, breakBlocks: boolean, igniteTnt: (x: number, y: number, z: number) => void,
): ExplosionResult {
  const r = new Random((Math.random() * 0xffffffff) >>> 0);
  const destroyed = new Map<string, [number, number, number]>();
  if (breakBlocks && power > 0) {
    const N = 16;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < N; k++) {
          if (i !== 0 && i !== N - 1 && j !== 0 && j !== N - 1 && k !== 0 && k !== N - 1) continue;
          let dx = (i / (N - 1)) * 2 - 1;
          let dy = (j / (N - 1)) * 2 - 1;
          let dz = (k / (N - 1)) * 2 - 1;
          const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
          dx /= len; dy /= len; dz /= len;
          let intensity = power * (0.7 + r.next() * 0.6);
          let px = x; let py = y; let pz = z;
          const step = 0.3;
          while (intensity > 0) {
            const bx = Math.floor(px); const by = Math.floor(py); const bz = Math.floor(pz);
            if (by < 0 || by >= WORLD_HEIGHT) break;
            const id = dim.getBlock(bx, by, bz);
            if (id !== 0) {
              const def = getBlock(id);
              const resistance = def.hardness < 0 ? 3600000 : def.resistance;
              intensity -= (resistance / 5 + 0.3) * step;
            }
            if (intensity > 0 && id !== 0) destroyed.set(`${bx},${by},${bz}`, [bx, by, bz]);
            px += dx * step; py += dy * step; pz += dz * step;
            intensity -= step * 0.75;
          }
        }
      }
    }
  }

  // Entities.
  const radius = power * 2;
  for (const e of ctx.entitiesIn(dim)) {
    if (e.removed) continue;
    const dist = Math.sqrt(e.distanceSqTo(x, y, z)) / radius;
    if (dist > 1) continue;
    let dx = e.x - x; let dy = e.y + e.eyeHeight - y; let dz = e.z - z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx /= d; dy /= d; dz /= d;
    const exposure = exposureOf(dim, x, y, z, e);
    const impact = (1 - dist) * exposure;
    const damage = Math.floor(((impact * impact + impact) / 2) * 8 * power + 1);
    if (e !== source || source?.type === 'tnt') {
      e.damage(ctx, damage, { type: 'explosion', attacker: source && (source as { shooter?: Entity }).shooter ? (source as { shooter?: Entity }).shooter : source, isExplosion: true });
    }
    const kb = impact;
    e.motionX += dx * kb;
    e.motionY += dy * kb;
    e.motionZ += dz * kb;
    if (e instanceof LivingEntity) e.fallDistance = 0;
  }

  // Blocks.
  const list = Array.from(destroyed.values());
  for (const [bx, by, bz] of list) {
    const id = dim.getBlock(bx, by, bz);
    if (id === 0) continue;
    if (id === BlockId.TNT) {
      igniteTnt(bx, by, bz);
      continue;
    }
    const meta = dim.getMeta(bx, by, bz);
    if (r.next() < 0.3 && !IS_FLUID[id]) {
      for (const drop of resolveDrops(id, meta, 3, getBlock(id).toolCategory, 0, false, r)) {
        ctx.dropStack(dim, bx + 0.5, by + 0.5, bz + 0.5, { id: drop.item, count: drop.count, meta: drop.meta, damage: 0 });
      }
    }
    dim.setBlock(bx, by, bz, 0, 0);
  }
  if (fire) {
    for (const [bx, by, bz] of list) {
      if (dim.getBlock(bx, by, bz) === 0 && r.int(3) === 0) {
        const below = dim.getBlock(bx, by - 1, bz);
        if (below !== 0 && getBlock(below).solid) dim.setBlock(bx, by, bz, BlockId.FIRE, 0);
      }
    }
  }
  ctx.playSound('random.explode', x, y, z, 4, (1 + (r.next() - r.next()) * 0.2) * 0.7);
  ctx.particles(power >= 2 ? 'largeexplode' : 'explosion', dim, x, y, z, power >= 2 ? 3 : 1);
  ctx.particles('explosion', dim, x, y, z, Math.min(40, list.length + 8), { spread: power });
  return { destroyed: list };
}

/** Fraction of rays from the entity's box to the centre that are unobstructed. */
function exposureOf(dim: Dimension, x: number, y: number, z: number, e: Entity): number {
  const b = e.box;
  let seen = 0;
  let total = 0;
  for (let fx = 0; fx <= 1; fx += 0.5) {
    for (let fy = 0; fy <= 1; fy += 0.5) {
      for (let fz = 0; fz <= 1; fz += 0.5) {
        const px = b.minX + (b.maxX - b.minX) * fx;
        const py = b.minY + (b.maxY - b.minY) * fy;
        const pz = b.minZ + (b.maxZ - b.minZ) * fz;
        const dx = x - px; const dy = y - py; const dz = z - pz;
        const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
        total++;
        if (len < 0.01) { seen++; continue; }
        const hit = raycastBlocks(dim, px, py, pz, dx / len, dy / len, dz / len, len, false);
        if (!hit) seen++;
      }
    }
  }
  return seen / total;
}

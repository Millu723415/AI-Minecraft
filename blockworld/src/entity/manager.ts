/** Tracks every entity per dimension, ticks them and answers spatial queries. */

import type { GameContext } from '../game/context';
import type { Dimension } from '../world/dimension';
import type { DimId } from '../world/constants';
import { Entity } from './entity';
import { LivingEntity } from './living';

export class EntityManager {
  private readonly byDim = new Map<DimId, Entity[]>();

  list(dim: Dimension | DimId): Entity[] {
    const id = typeof dim === 'number' ? dim : dim.id;
    let l = this.byDim.get(id);
    if (!l) {
      l = [];
      this.byDim.set(id, l);
    }
    return l;
  }

  add(e: Entity, dim: Dimension): void {
    e.dim = dim;
    this.list(dim).push(e);
  }

  /** Move an entity to another dimension's list. */
  transfer(e: Entity, to: Dimension): void {
    const from = this.list(e.dim);
    const i = from.indexOf(e);
    if (i >= 0) from.splice(i, 1);
    e.dim = to;
    this.list(to).push(e);
  }

  count(dim: Dimension): number {
    return this.list(dim).length;
  }

  /** Tick all entities in loaded chunks of the dimension, then prune removed ones. */
  tick(ctx: GameContext, dim: Dimension): void {
    const list = this.list(dim);
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.removed) continue;
      if (e === ctx.player) continue;
      if (!dim.isLoaded(Math.floor(e.x), Math.floor(e.z))) continue;
      e.tick(ctx);
    }
    this.pushApart(dim);
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e.removed) list[w++] = e;
      else if (e.rider) e.rider.vehicle = null;
    }
    list.length = w;
  }

  /** Living entities gently push each other apart (classic collision). */
  private pushApart(dim: Dimension): void {
    const list = this.list(dim);
    const living = list.filter((e) => e instanceof LivingEntity && !(e as LivingEntity).dead && !e.vehicle) as LivingEntity[];
    if (living.length > 400) return;
    for (let i = 0; i < living.length; i++) {
      const a = living[i];
      for (let j = i + 1; j < living.length; j++) {
        const b = living[j];
        let dx = b.x - a.x;
        let dz = b.z - a.z;
        const minD = (a.width + b.width) / 2;
        if (Math.abs(dx) >= minD || Math.abs(dz) >= minD) continue;
        if (Math.abs(b.y - a.y) > Math.max(a.height, b.height)) continue;
        let d = Math.max(Math.abs(dx), Math.abs(dz));
        if (d < 0.01) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; d = 0.5; }
        dx /= d; dz /= d;
        const f = Math.min(1, 1 / d) * 0.05;
        if (a.type !== 'player' && a.type !== 'ender_dragon') { a.motionX -= dx * f; a.motionZ -= dz * f; }
        if (b.type !== 'player' && b.type !== 'ender_dragon') { b.motionX += dx * f; b.motionZ += dz * f; }
      }
    }
  }

  /** Remove every non-player entity of a dimension (used when leaving a world). */
  clear(): void {
    this.byDim.clear();
  }

  all(): IterableIterator<[DimId, Entity[]]> {
    return this.byDim.entries();
  }
}

/**
 * Reusable AI goals. Each mob composes its behaviour from these, with
 * priorities and mutex flags (MOVE / LOOK / JUMP) deciding which goals run.
 */

import type { Mob } from '../mob';
import type { LivingEntity } from '../living';
import type { Entity } from '../entity';
import { randomStandingSpot } from './pathfinder';

export const MUTEX_MOVE = 1;
export const MUTEX_LOOK = 2;
export const MUTEX_JUMP = 4;

export abstract class Goal {
  mutex = 0;
  running = false;
  constructor(readonly mob: Mob) {}
  abstract canStart(): boolean;
  canContinue(): boolean {
    return this.canStart();
  }
  start(): void {}
  stop(): void {}
  tick(): void {}
  /** Lower priority goals may be interrupted by this one. */
  interruptible = true;
}

export class GoalSelector {
  private goals: { priority: number; goal: Goal }[] = [];

  add(priority: number, goal: Goal): void {
    this.goals.push({ priority, goal });
    this.goals.sort((a, b) => a.priority - b.priority);
  }

  clear(): void {
    for (const g of this.goals) if (g.goal.running) { g.goal.running = false; g.goal.stop(); }
    this.goals = [];
  }

  tick(): void {
    // Stop goals that should no longer run.
    for (const e of this.goals) {
      if (e.goal.running && !e.goal.canContinue()) {
        e.goal.running = false;
        e.goal.stop();
      }
    }
    // Start new goals if their mutex is free of higher-priority runners.
    let used = 0;
    for (const e of this.goals) {
      if (e.goal.running) {
        used |= e.goal.mutex;
        continue;
      }
      if ((used & e.goal.mutex) !== 0) continue;
      if (e.goal.canStart()) {
        // Interrupt lower-priority conflicting goals.
        for (const other of this.goals) {
          if (other.priority > e.priority && other.goal.running && (other.goal.mutex & e.goal.mutex) !== 0) {
            other.goal.running = false;
            other.goal.stop();
          }
        }
        e.goal.running = true;
        e.goal.start();
        used |= e.goal.mutex;
      }
    }
    for (const e of this.goals) if (e.goal.running) e.goal.tick();
  }

  running(): Goal[] {
    return this.goals.filter((g) => g.goal.running).map((g) => g.goal);
  }
}

// ---------------------------------------------------------------------------
// Common goals
// ---------------------------------------------------------------------------
export class SwimGoal extends Goal {
  constructor(mob: Mob) { super(mob); this.mutex = MUTEX_JUMP; }
  canStart(): boolean { return this.mob.inWater || this.mob.inLava; }
  tick(): void { if (Math.random() < 0.8) this.mob.jumping = true; }
}

export class WanderGoal extends Goal {
  private chance: number;
  constructor(mob: Mob, readonly speed: number, chance = 120) {
    super(mob);
    this.mutex = MUTEX_MOVE;
    this.chance = chance;
  }
  canStart(): boolean {
    if (this.mob.nav.busy) return false;
    if (Math.random() * this.chance >= 1) return false;
    const m = this.mob;
    const spot = randomStandingSpot(m.dim, m.x, m.y, m.z, 10, 3, m.height, Math.random, !m.canSwim);
    if (!spot) return false;
    this.target = spot;
    return true;
  }
  private target: { x: number; y: number; z: number } | null = null;
  canContinue(): boolean { return this.mob.nav.busy; }
  start(): void {
    if (this.target) this.mob.nav.moveTo(this.target.x + 0.5, this.target.y, this.target.z + 0.5, this.speed);
  }
}

export class LookAtPlayerGoal extends Goal {
  private ticks = 0;
  private target: Entity | null = null;
  constructor(mob: Mob, readonly range = 8) { super(mob); this.mutex = MUTEX_LOOK; }
  canStart(): boolean {
    if (Math.random() >= 0.02) return false;
    const p = this.mob.ctx?.player;
    if (!p || p.dim !== this.mob.dim || p.dead) return false;
    if (this.mob.distanceTo(p) > this.range) return false;
    this.target = p;
    return true;
  }
  canContinue(): boolean { return this.ticks > 0 && !!this.target && this.mob.distanceTo(this.target) <= this.range; }
  start(): void { this.ticks = 40 + Math.floor(Math.random() * 40); }
  tick(): void {
    this.ticks--;
    if (this.target) this.mob.look.lookAt(this.target, 10, 40);
  }
}

export class LookIdleGoal extends Goal {
  private ticks = 0;
  private dx = 0; private dz = 0;
  constructor(mob: Mob) { super(mob); this.mutex = MUTEX_LOOK | MUTEX_MOVE; }
  canStart(): boolean { return Math.random() < 0.02; }
  canContinue(): boolean { return this.ticks >= 0; }
  start(): void {
    const a = Math.random() * Math.PI * 2;
    this.dx = Math.cos(a); this.dz = Math.sin(a);
    this.ticks = 20 + Math.floor(Math.random() * 20);
  }
  tick(): void {
    this.ticks--;
    const m = this.mob;
    m.look.lookAtPos(m.x + this.dx, m.y + m.eyeHeight, m.z + this.dz, 10, 40);
  }
}

export class PanicGoal extends Goal {
  constructor(mob: Mob, readonly speed: number) { super(mob); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    const m = this.mob;
    return m.panicTicks > 0;
  }
  canContinue(): boolean { return this.mob.panicTicks > 0; }
  tick(): void {
    const m = this.mob;
    if (!m.nav.busy) {
      const spot = randomStandingSpot(m.dim, m.x, m.y, m.z, 5, 4, m.height, Math.random, false);
      if (spot) m.nav.moveTo(spot.x + 0.5, spot.y, spot.z + 0.5, this.speed);
    }
  }
}

/** Walk toward and hit the attack target. */
export class MeleeAttackGoal extends Goal {
  private repath = 0;
  constructor(mob: Mob, readonly speed: number, readonly reach = 1.2) { super(mob); this.mutex = MUTEX_MOVE | MUTEX_LOOK; }
  canStart(): boolean {
    const t = this.mob.target;
    return !!t && !t.dead && t.dim === this.mob.dim;
  }
  start(): void { this.repath = 0; }
  stop(): void { this.mob.nav.stop(); }
  tick(): void {
    const m = this.mob;
    const t = m.target!;
    m.look.lookAt(t, 30, 30);
    if (--this.repath <= 0) {
      this.repath = 4 + Math.floor(Math.random() * 7);
      m.nav.moveTo(t.x, t.y, t.z, this.speed);
    }
    const reach = m.width * 2 * this.reach + t.width;
    const dx = t.x - m.x; const dz = t.z - m.z;
    const within = dx * dx + dz * dz <= reach * reach && Math.abs(t.y - m.y) < 2;
    if (m.attackCooldown <= 0 && within && m.canSee(t)) {
      m.attackCooldown = 20;
      m.attackEntity(t);
    }
  }
}

/** Choose the nearest player as target (hostile mobs). */
export class TargetPlayerGoal extends Goal {
  constructor(mob: Mob, readonly range: number, readonly needSight = true) { super(mob); }
  canStart(): boolean {
    const m = this.mob;
    if (m.target) return false;
    const p = m.ctx?.player;
    if (!p || p.dead || p.creative || p.dim !== m.dim) return false;
    if (m.ctx!.difficulty === 0) return false;
    let range = this.range;
    if (p.sneaking) range *= 0.8;
    if (m.distanceTo(p) > range) return false;
    if (this.needSight && !m.canSee(p)) return false;
    if (Math.random() > 0.1) return false;
    m.target = p;
    return true;
  }
  canContinue(): boolean {
    const m = this.mob;
    const t = m.target;
    if (!t || t.dead || t.dim !== m.dim) { m.target = null; return false; }
    if ((t as { creative?: boolean }).creative) { m.target = null; return false; }
    if (m.distanceTo(t) > this.range * 1.5) { m.target = null; return false; }
    return true;
  }
}

/** Retaliate against whatever hurt us. */
export class HurtByTargetGoal extends Goal {
  constructor(mob: Mob, readonly alertOthers: string | null = null) { super(mob); }
  canStart(): boolean {
    const m = this.mob;
    const a = m.lastAttacker as LivingEntity | null;
    if (!a || a.dead || !m.ctx || m.ctx.tickCount - m.lastAttackerTime > 100) return false;
    if (a === m.target) return false;
    if ((a as { creative?: boolean }).creative) return false;
    return true;
  }
  start(): void {
    const m = this.mob;
    m.target = m.lastAttacker as LivingEntity;
    if (this.alertOthers && m.ctx) {
      for (const e of m.ctx.entitiesIn(m.dim)) {
        if (e.type === this.alertOthers && e !== m && m.distanceTo(e) < 32) {
          (e as Mob).becomeAngryAt?.(m.target);
        }
      }
    }
  }
  canContinue(): boolean { return false; }
}

/** Seek shade when burning in daylight. */
export class FleeSunGoal extends Goal {
  constructor(mob: Mob, readonly speed: number) { super(mob); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    const m = this.mob;
    if (m.fireTicks <= 0 || !m.isInDaylight()) return false;
    for (let i = 0; i < 10; i++) {
      const x = Math.floor(m.x + Math.random() * 20 - 10);
      const z = Math.floor(m.z + Math.random() * 20 - 10);
      const y = Math.floor(m.y + Math.random() * 6 - 3);
      if (m.dim.getSkyLight(x, y, z) < 12 && m.dim.getBlock(x, y, z) === 0) {
        m.nav.moveTo(x + 0.5, y, z + 0.5, this.speed);
        return true;
      }
    }
    return false;
  }
  canContinue(): boolean { return this.mob.nav.busy; }
}

/** Jump at the target when close (spiders, wolves). */
export class LeapAtTargetGoal extends Goal {
  constructor(mob: Mob, readonly power: number) { super(mob); this.mutex = MUTEX_JUMP | MUTEX_MOVE; }
  canStart(): boolean {
    const m = this.mob;
    const t = m.target;
    if (!t || !m.onGround) return false;
    const d = m.distanceTo(t);
    return d >= 2 && d <= 4 && Math.random() < 0.2;
  }
  canContinue(): boolean { return !this.mob.onGround; }
  start(): void {
    const m = this.mob;
    const t = m.target!;
    const dx = t.x - m.x; const dz = t.z - m.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    m.motionX = (dx / d) * 0.5 * 0.8 + m.motionX * 0.2;
    m.motionZ = (dz / d) * 0.5 * 0.8 + m.motionZ * 0.2;
    m.motionY = this.power;
  }
}

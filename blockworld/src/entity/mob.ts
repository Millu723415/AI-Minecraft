/**
 * Base class for all mobs: goal-driven AI, path navigation, head look control,
 * melee attacks, daylight burning, drops, XP and despawning rules.
 */

import { getBlock } from '../blocks/registry';
import { createStack } from '../items/stack';
import type { GameContext } from '../game/context';
import { raycastBlocks } from '../world/raycast';
import { Dim } from '../world/constants';
import { daylightFactor } from '../render/sky';
import type { DamageSource } from './damage';
import { Effect } from './effects';
import type { EntityData } from './entity';
import { LivingEntity } from './living';
import { GoalSelector } from './ai/goals';
import { findPath, type PathNode } from './ai/pathfinder';

export type MobCategory = 'hostile' | 'passive' | 'water' | 'ambient' | 'boss' | 'neutral';

export interface DropDef {
  item: number;
  meta?: number;
  min: number;
  max: number;
  /** Only when killed by a player (rare drops). */
  playerOnly?: boolean;
  chance?: number;
}

/** Path following for walking mobs. */
export class Navigator {
  path: PathNode[] | null = null;
  index = 0;
  speed = 1;
  private target: [number, number, number] | null = null;
  private stuck = 0;
  private lastX = 0;
  private lastZ = 0;

  constructor(private readonly mob: Mob) {}

  get busy(): boolean {
    return this.path !== null;
  }

  moveTo(x: number, y: number, z: number, speed: number): boolean {
    const m = this.mob;
    const sx = Math.floor(m.x); const sy = Math.floor(m.y + 0.01); const sz = Math.floor(m.z);
    const tx = Math.floor(x); const ty = Math.floor(y); const tz = Math.floor(z);
    if (this.target && this.path && this.target[0] === tx && this.target[1] === ty && this.target[2] === tz) {
      this.speed = speed;
      return true;
    }
    const path = findPath(m.dim, sx, sy, sz, tx, ty, tz, { height: m.height, canOpenDoors: m.canOpenDoors, avoidWater: !m.canSwim }, 24);
    if (!path || path.length === 0) {
      this.path = null;
      return false;
    }
    this.path = path;
    this.index = 0;
    this.speed = speed;
    this.target = [tx, ty, tz];
    this.stuck = 0;
    return true;
  }

  stop(): void {
    this.path = null;
    this.target = null;
    this.mob.moveForward = 0;
  }

  tick(): void {
    const m = this.mob;
    if (!this.path) return;
    if (this.index >= this.path.length) {
      this.stop();
      return;
    }
    const node = this.path[this.index];
    const tx = node.x + 0.5; const tz = node.z + 0.5;
    const dx = tx - m.x; const dz = tz - m.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < 0.25 + m.width * 0.25 && Math.abs(m.y - node.y) < 1.2) {
      this.index++;
      return;
    }
    const targetYaw = Math.atan2(-dx, -dz);
    m.turnTowards(targetYaw, 0.5);
    m.moveForward = this.speed;
    if (node.y > Math.floor(m.y + 0.01) || m.collidedH) m.jumping = true;
    // Give up if we are not making progress.
    if (m.age % 20 === 0) {
      const moved = Math.abs(m.x - this.lastX) + Math.abs(m.z - this.lastZ);
      this.lastX = m.x; this.lastZ = m.z;
      if (moved < 0.3) {
        if (++this.stuck >= 3) this.stop();
      } else {
        this.stuck = 0;
      }
    }
  }
}

/** Smoothly turns the head (pitch/yaw) toward a point. */
export class LookControl {
  private tx = 0; private ty = 0; private tz = 0;
  private active = false;
  private yawSpeed = 10;
  private pitchSpeed = 40;
  headYaw = 0;

  constructor(private readonly mob: Mob) {}

  lookAt(e: { x: number; y: number; z: number; eyeHeight: number }, yawSpeed: number, pitchSpeed: number): void {
    this.lookAtPos(e.x, e.y + e.eyeHeight, e.z, yawSpeed, pitchSpeed);
  }

  lookAtPos(x: number, y: number, z: number, yawSpeed: number, pitchSpeed: number): void {
    this.tx = x; this.ty = y; this.tz = z;
    this.yawSpeed = yawSpeed; this.pitchSpeed = pitchSpeed;
    this.active = true;
  }

  tick(): void {
    const m = this.mob;
    if (this.active) {
      this.active = false;
      const dx = this.tx - m.x; const dy = this.ty - (m.y + m.eyeHeight); const dz = this.tz - m.z;
      const h = Math.sqrt(dx * dx + dz * dz);
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, h);
      this.headYaw = approachAngle(this.headYaw, yaw, (this.yawSpeed * Math.PI) / 180);
      m.pitch = approachAngle(m.pitch, pitch, (this.pitchSpeed * Math.PI) / 180);
    } else {
      this.headYaw = approachAngle(this.headYaw, m.yaw, (10 * Math.PI) / 180);
      m.pitch *= 0.9;
    }
    // Keep the head within 75 degrees of the body.
    let d = wrap(this.headYaw - m.yaw);
    const lim = (75 * Math.PI) / 180;
    if (d > lim) d = lim;
    if (d < -lim) d = -lim;
    this.headYaw = m.yaw + d;
  }
}

function wrap(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function approachAngle(cur: number, target: number, step: number): number {
  const d = wrap(target - cur);
  if (Math.abs(d) <= step) return target;
  return cur + Math.sign(d) * step;
}

export abstract class Mob extends LivingEntity {
  abstract readonly category: MobCategory;
  readonly goals = new GoalSelector();
  readonly targets = new GoalSelector();
  readonly nav = new Navigator(this);
  readonly look = new LookControl(this);
  ctx: GameContext | null = null;
  target: LivingEntity | null = null;
  attackCooldown = 0;
  attackDamage = 2;
  drops: DropDef[] = [];
  canOpenDoors = false;
  canSwim = true;
  burnsInDaylight = false;
  panicTicks = 0;
  /** Ticks with no player nearby (for despawning). */
  idleTicks = 0;
  private goalsBuilt = false;
  baby = false;
  growingAge = 0;
  ambientSound: string | null = null;
  hurtSound: string | null = null;
  deathSound: string | null = null;
  private ambientTimer = 0;

  constructor() {
    super();
    this.persistent = true;
  }

  /** Subclasses register their AI goals here. */
  protected abstract initGoals(): void;

  get headYaw(): number {
    return this.look.headYaw;
  }

  turnTowards(yaw: number, maxStep: number): void {
    this.yaw = approachAngle(this.yaw, yaw, maxStep);
  }

  canSee(e: { x: number; y: number; z: number; eyeHeight: number }): boolean {
    const ox = this.x; const oy = this.y + this.eyeHeight; const oz = this.z;
    const dx = e.x - ox; const dy = e.y + e.eyeHeight - oy; const dz = e.z - oz;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return true;
    const hit = raycastBlocks(this.dim, ox, oy, oz, dx / len, dy / len, dz / len, len, false);
    if (!hit) return true;
    return !getBlock(hit.id).solid;
  }

  isInDaylight(): boolean {
    if (this.dim.id !== Dim.OVERWORLD || !this.ctx) return false;
    const day = daylightFactor(this.ctx.world.dayTime, this.ctx.world.rainStrength);
    if (day < 0.8) return false;
    const bx = Math.floor(this.x); const by = Math.floor(this.y + this.eyeHeight); const bz = Math.floor(this.z);
    return this.dim.getSkyLight(bx, by, bz) >= 15 && !this.inWater && !this.ctx.world.raining;
  }

  /** Deal melee damage to a target. */
  attackEntity(t: LivingEntity): boolean {
    let dmg = this.attackDamage;
    const s = this.effects.get(Effect.STRENGTH);
    if (s) dmg += 3 << s.amplifier;
    this.swing();
    return t.damage(this.ctx!, dmg, { type: 'mob', attacker: this });
  }

  becomeAngryAt?(e: LivingEntity | null): void;

  tick(ctx: GameContext): void {
    this.ctx = ctx;
    this.savePrev();
    if (!this.goalsBuilt) {
      this.goalsBuilt = true;
      this.initGoals();
    }
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.panicTicks > 0) this.panicTicks--;
    if (this.baby) {
      this.growingAge++;
      if (this.growingAge >= 0) this.baby = false;
    } else if (this.growingAge > 0) {
      this.growingAge--;
    }
    if (this.burnsInDaylight && this.isInDaylight() && !this.dead) this.setFire(8);
    this.livingTick(ctx);
    if (!this.dead && this.ambientSound && --this.ambientTimer <= 0) {
      this.ambientTimer = 80 + Math.floor(Math.random() * 160);
      ctx.playSound(this.ambientSound, this.x, this.y + this.eyeHeight, this.z, 1, this.baby ? 1.5 : 1);
    }
    this.checkDespawn(ctx);
  }

  protected aiStep(ctx: GameContext): void {
    this.moveForward = 0;
    this.moveStrafe = 0;
    this.jumping = false;
    this.targets.tick();
    this.goals.tick();
    this.nav.tick();
    this.look.tick();
    this.bodyYaw = this.yaw;
    void ctx;
  }

  protected checkDespawn(ctx: GameContext): void {
    if (!this.canDespawn()) return;
    const p = ctx.player;
    const d = p.dim === this.dim ? this.distanceTo(p) : 1e9;
    if (d > 128) {
      this.removed = true;
      return;
    }
    if (d > 32) {
      this.idleTicks++;
      if (this.idleTicks > 600 && Math.random() < 1 / 800) this.removed = true;
    } else {
      this.idleTicks = 0;
    }
  }

  canDespawn(): boolean {
    return this.category === 'hostile' || this.category === 'water' || this.category === 'ambient';
  }

  protected override onHurt(ctx: GameContext, source: DamageSource): void {
    if (this.hurtSound) ctx.playSound(this.hurtSound, this.x, this.y + this.eyeHeight, this.z, 1, this.baby ? 1.5 : 1);
    if (this.category === 'passive') this.panicTicks = 60;
    void source;
  }

  protected override onDeath(ctx: GameContext, source: DamageSource): void {
    if (this.deathSound) ctx.playSound(this.deathSound, this.x, this.y + this.eyeHeight, this.z, 1, this.baby ? 1.5 : 1);
    const byPlayer = this.recentlyHitByPlayer > 0 || source.attacker?.type === 'player';
    if (!this.baby) {
      const looting = source.attacker?.type === 'player' ? this.lootingOf(ctx) : 0;
      for (const d of this.drops) {
        if (d.playerOnly && !byPlayer) continue;
        if (d.chance !== undefined && Math.random() >= d.chance + looting * 0.01) continue;
        const count = d.min + Math.floor(Math.random() * (d.max - d.min + 1 + looting));
        if (count > 0) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(d.item, count, d.meta ?? 0));
      }
      this.extraDrops(ctx, byPlayer);
    }
    if (byPlayer && this.xpReward > 0 && !this.baby) ctx.dropXp(this.dim, this.x, this.y + 0.5, this.z, this.xpReward);
  }

  private lootingOf(ctx: GameContext): number {
    const held = ctx.player.inventory.held;
    return held?.ench?.find((e) => e.id === 21)?.level ?? 0;
  }

  /** Hook for special drops. */
  protected extraDrops(_ctx: GameContext, _byPlayer: boolean): void {}

  override serialize(): EntityData {
    return { ...super.serialize(), baby: this.baby, age2: this.growingAge };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.baby = !!d.baby;
    this.growingAge = (d.age2 as number) ?? 0;
  }
}

export { wrap, approachAngle };

/** Hostile and neutral mobs of the release era. */

import { BlockId } from '../../blocks/ids';
import { getBlock } from '../../blocks/registry';
import { ItemId } from '../../items/ids';
import { createStack } from '../../items/stack';
import type { GameContext } from '../../game/context';
import type { Player } from '../player';
import type { EntityData } from '../entity';
import type { LivingEntity } from '../living';
import type { DamageSource } from '../damage';
import { Effect } from '../effects';
import { Mob, type MobCategory } from '../mob';
import { Arrow, Fireball } from '../projectiles';
import {
  FleeSunGoal, Goal, HurtByTargetGoal, LeapAtTargetGoal, LookAtPlayerGoal, LookIdleGoal, MeleeAttackGoal,
  MUTEX_LOOK, MUTEX_MOVE, SwimGoal, TargetPlayerGoal, WanderGoal,
} from '../ai/goals';

export abstract class Monster extends Mob {
  readonly category: MobCategory = 'hostile';
  constructor() {
    super();
    this.xpReward = 5;
  }
}

export class Zombie extends Monster {
  readonly type: string = 'zombie';
  override displayName = 'Zombie';
  constructor() {
    super();
    this.width = 0.6; this.height = 1.8;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 4;
    this.undead = true;
    this.burnsInDaylight = true;
    this.canOpenDoors = false;
    this.ambientSound = 'mob.zombie'; this.hurtSound = 'mob.zombie.hurt'; this.deathSound = 'mob.zombie.death';
    this.drops = [{ item: ItemId.ROTTEN_FLESH, min: 0, max: 2 }];
  }
  protected initGoals(): void {
    this.goals.add(0, new SwimGoal(this));
    this.goals.add(2, new MeleeAttackGoal(this, 0.95));
    this.goals.add(3, new FleeSunGoal(this, 1.0));
    this.goals.add(5, new WanderGoal(this, 0.5));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(7, new LookIdleGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this));
    this.targets.add(2, new TargetPlayerGoal(this, 16, true));
  }
}

export class Skeleton extends Monster {
  readonly type = 'skeleton';
  override displayName = 'Skeleton';
  aimTicks = 0;
  constructor() {
    super();
    this.width = 0.6; this.height = 1.8;
    this.maxHealth = 20; this.health = 20;
    this.undead = true;
    this.burnsInDaylight = true;
    this.ambientSound = 'mob.skeleton'; this.hurtSound = 'mob.skeleton.hurt'; this.deathSound = 'mob.skeleton.hurt';
    this.drops = [{ item: ItemId.ARROW, min: 0, max: 2 }, { item: ItemId.BONE, min: 0, max: 2 }];
  }
  protected initGoals(): void {
    this.goals.add(0, new SwimGoal(this));
    this.goals.add(2, new RangedAttackGoal(this, 60, 12, (t) => this.shootAt(t)));
    this.goals.add(3, new FleeSunGoal(this, 1.0));
    this.goals.add(5, new WanderGoal(this, 0.5));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(7, new LookIdleGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this));
    this.targets.add(2, new TargetPlayerGoal(this, 16, true));
  }
  shootAt(t: LivingEntity): void {
    const ctx = this.ctx!;
    const a = new Arrow();
    a.dim = this.dim;
    a.shooter = this;
    a.setPosition(this.x, this.y + this.eyeHeight - 0.1, this.z);
    const dx = t.x - this.x;
    const dz = t.z - this.z;
    const dy = t.y + t.eyeHeight - 0.7 - a.y;
    const h = Math.sqrt(dx * dx + dz * dz);
    a.shoot(dx, dy + h * 0.2, dz, 1.6, 12 - ctx.difficulty * 4);
    a.damageBase = 2;
    if (this.fireTicks > 0) a.onFire = true;
    ctx.spawn(a, this.dim);
    ctx.playSound('random.bow', this.x, this.y, this.z, 1, 1 / (Math.random() * 0.4 + 0.8));
    this.swing();
  }
}

/** Keep some distance and shoot periodically when the target is visible. */
class RangedAttackGoal extends Goal {
  private cooldown = 0;
  private seeTime = 0;
  constructor(mob: Mob, readonly interval: number, readonly range: number, readonly fire: (t: LivingEntity) => void) {
    super(mob);
    this.mutex = MUTEX_MOVE | MUTEX_LOOK;
  }
  canStart(): boolean {
    const t = this.mob.target;
    return !!t && !t.dead && t.dim === this.mob.dim;
  }
  stop(): void { this.mob.nav.stop(); this.seeTime = 0; }
  tick(): void {
    const m = this.mob;
    const t = m.target!;
    const d = m.distanceTo(t);
    const sees = m.canSee(t);
    this.seeTime = sees ? this.seeTime + 1 : 0;
    m.look.lookAt(t, 30, 30);
    if (d > this.range * 0.75 || !sees) {
      if (m.age % 10 === 0) m.nav.moveTo(t.x, t.y, t.z, 0.9);
    } else {
      m.nav.stop();
    }
    if (--this.cooldown <= 0 && sees && d < this.range && this.seeTime > 10) {
      this.cooldown = this.interval;
      this.fire(t);
    }
  }
}

export class Creeper extends Monster {
  readonly type = 'creeper';
  override displayName = 'Creeper';
  fuse = 0;
  prevFuse = 0;
  readonly maxFuse = 30;
  powered = false;
  swellDir = -1;
  constructor() {
    super();
    this.width = 0.6; this.height = 1.7;
    this.maxHealth = 20; this.health = 20;
    this.hurtSound = 'mob.creeper.hurt'; this.deathSound = 'mob.creeper.hurt';
    this.drops = [{ item: ItemId.GUNPOWDER, min: 0, max: 2 }];
  }
  protected initGoals(): void {
    this.goals.add(0, new SwimGoal(this));
    this.goals.add(1, new CreeperSwellGoal(this));
    this.goals.add(3, new MeleeAttackGoal(this, 0.95));
    this.goals.add(5, new WanderGoal(this, 0.5));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(7, new LookIdleGoal(this));
    this.targets.add(1, new TargetPlayerGoal(this, 16, true));
    this.targets.add(2, new HurtByTargetGoal(this));
  }
  override attackEntity(): boolean {
    return false; // creepers never melee; they explode
  }
  override tick(ctx: GameContext): void {
    this.prevFuse = this.fuse;
    if (this.swellDir > 0 && this.fuse === 0) ctx.playSound('random.fuse', this.x, this.y, this.z, 1, 0.5);
    this.fuse = Math.max(0, this.fuse + this.swellDir);
    if (this.fuse >= this.maxFuse && !this.dead) {
      this.removed = true;
      this.dead = true;
      ctx.explode(this.dim, this.x, this.y + 0.8, this.z, this.powered ? 6 : 3, false, this, true);
      return;
    }
    super.tick(ctx);
  }
  override serialize(): EntityData {
    return { ...super.serialize(), powered: this.powered };
  }
}

class CreeperSwellGoal extends Goal {
  constructor(readonly creeper: Creeper) { super(creeper); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    const c = this.creeper;
    const t = c.target;
    return c.fuse > 0 || (!!t && c.distanceTo(t) < 3);
  }
  start(): void { this.creeper.nav.stop(); }
  stop(): void { this.creeper.swellDir = -1; }
  tick(): void {
    const c = this.creeper;
    const t = c.target;
    if (!t || c.distanceTo(t) > 7 || !c.canSee(t)) c.swellDir = -1;
    else c.swellDir = 1;
    if (t) c.look.lookAt(t, 30, 30);
  }
}

export class Spider extends Monster {
  readonly type: string = 'spider';
  override displayName = 'Spider';
  constructor() {
    super();
    this.width = 1.4; this.height = 0.9;
    this.maxHealth = 16; this.health = 16;
    this.attackDamage = 2;
    this.ambientSound = 'mob.spider'; this.hurtSound = 'mob.spider.hurt'; this.deathSound = 'mob.spider.hurt';
    this.drops = [{ item: ItemId.STRING, min: 0, max: 2 }, { item: ItemId.SPIDER_EYE, min: 1, max: 1, playerOnly: true, chance: 1 / 3 }];
  }
  override get eyeHeight(): number {
    return 0.65;
  }
  protected initGoals(): void {
    this.goals.add(1, new SwimGoal(this));
    this.goals.add(3, new LeapAtTargetGoal(this, 0.4));
    this.goals.add(4, new MeleeAttackGoal(this, 1.2, 0.8));
    this.goals.add(6, new WanderGoal(this, 0.6));
    this.goals.add(7, new LookAtPlayerGoal(this, 8));
    this.goals.add(8, new LookIdleGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this));
    this.targets.add(2, new SpiderTargetGoal(this));
  }
  override tick(ctx: GameContext): void {
    super.tick(ctx);
    // Wall climbing.
    if (this.collidedH && !this.dead) {
      this.motionY = 0.2;
      this.fallDistance = 0;
    }
  }
  override isOnLadder(): boolean {
    return this.collidedH;
  }
}

/** Spiders are only hostile in darkness (they stay neutral in bright light). */
class SpiderTargetGoal extends TargetPlayerGoal {
  constructor(mob: Mob) { super(mob, 16, true); }
  canStart(): boolean {
    const m = this.mob;
    if (!m.ctx) return false;
    const light = m.dim.getLightLevel(Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z), m.ctx.skyDarken());
    if (light > 7 && Math.random() < 0.99) return false;
    return super.canStart();
  }
  canContinue(): boolean {
    const m = this.mob;
    if (m.ctx && m.dim.getLightLevel(Math.floor(m.x), Math.floor(m.y + 0.5), Math.floor(m.z), m.ctx.skyDarken()) > 11 && Math.random() < 0.01) {
      m.target = null;
      return false;
    }
    return super.canContinue();
  }
}

export class CaveSpider extends Spider {
  override readonly type = 'cave_spider';
  override displayName = 'Cave Spider';
  constructor() {
    super();
    this.width = 0.7; this.height = 0.5;
    this.maxHealth = 12; this.health = 12;
  }
  override get eyeHeight(): number {
    return 0.45;
  }
  override attackEntity(t: LivingEntity): boolean {
    const ok = super.attackEntity(t);
    if (ok && this.ctx && this.ctx.difficulty >= 2) {
      t.addEffect({ id: Effect.POISON, duration: this.ctx.difficulty === 3 ? 300 : 140, amplifier: 0 });
    }
    return ok;
  }
}

export class Slime extends Monster {
  readonly type: string = 'slime';
  override displayName = 'Slime';
  size = 1;
  jumpDelay = 0;
  squish = 0;
  prevSquish = 0;
  constructor(size = 1 << Math.floor(Math.random() * 3)) {
    super();
    this.setSize(size);
    this.hurtSound = 'mob.slime'; this.deathSound = 'mob.slime';
  }
  setSize(size: number): void {
    this.size = size;
    this.width = 0.6 * size;
    this.height = 0.6 * size;
    this.maxHealth = size * size;
    this.health = this.maxHealth;
    this.xpReward = size;
  }
  protected initGoals(): void {}
  protected aiStep(ctx: GameContext): void {
    this.moveForward = 0;
    this.jumping = false;
    const p = ctx.player;
    let target: Player | null = null;
    if (!p.dead && !p.creative && p.dim === this.dim && this.distanceTo(p) < 16 && ctx.difficulty > 0) target = p;
    if (target) {
      const dx = target.x - this.x; const dz = target.z - this.z;
      this.yaw = Math.atan2(-dx, -dz);
    }
    if (this.onGround && this.jumpDelay-- <= 0) {
      this.jumpDelay = Math.floor(Math.random() * 20) + 10;
      if (target) this.jumpDelay = Math.floor(this.jumpDelay / 3);
      this.jumping = true;
      this.moveForward = 1;
      if (this.size > 1) ctx.playSound('mob.slime', this.x, this.y, this.z, 0.4 * this.size, 1 / this.size);
      this.squish = 1;
    } else if (this.onGround) {
      this.moveForward = 0;
      this.motionX *= 0.5; this.motionZ *= 0.5;
    } else {
      this.moveForward = 1;
    }
    this.prevSquish = this.squish;
    this.squish *= 0.6;
    if (target && this.size > 1 && this.attackCooldown <= 0 && this.box.grow(0.2).intersects(target.box) && this.canSee(target)) {
      this.attackCooldown = 20;
      target.damage(ctx, this.attackStrength(), { type: 'mob', attacker: this });
    }
  }
  protected jumpVelocity(): number {
    return 0.42;
  }
  attackStrength(): number {
    return this.size;
  }
  protected override onDeath(ctx: GameContext, source: DamageSource): void {
    super.onDeath(ctx, source);
    if (this.size > 1) {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const child = this.split();
        child.setPosition(this.x + ((i % 2) - 0.5) * this.size / 4, this.y + 0.5, this.z + ((Math.floor(i / 2) % 2) - 0.5) * this.size / 4);
        child.yaw = Math.random() * Math.PI * 2;
        ctx.spawn(child, this.dim);
      }
    }
  }
  protected split(): Slime {
    return new Slime(this.size / 2);
  }
  protected extraDrops(ctx: GameContext): void {
    if (this.size === 1) {
      const n = Math.floor(Math.random() * 3);
      if (n > 0) ctx.dropStack(this.dim, this.x, this.y + 0.3, this.z, createStack(ItemId.SLIMEBALL, n));
    }
  }
  override serialize(): EntityData {
    return { ...super.serialize(), size: this.size };
  }
  override deserialize(d: EntityData): void {
    const s = (d.size as number) ?? 1;
    this.setSize(s);
    super.deserialize(d);
  }
}

export class MagmaCube extends Slime {
  override readonly type = 'magma_cube';
  override displayName = 'Magma Cube';
  constructor(size = 1 << Math.floor(Math.random() * 3)) {
    super(size);
    this.fireImmune = true;
    this.hurtSound = 'mob.magmacube'; this.deathSound = 'mob.magmacube';
  }
  override armorValue(): number {
    return this.size * 3;
  }
  override attackStrength(): number {
    return this.size + 2;
  }
  protected override jumpVelocity(): number {
    return 0.42 + this.size * 0.1;
  }
  protected override split(): Slime {
    return new MagmaCube(this.size / 2);
  }
  protected override extraDrops(ctx: GameContext): void {
    if (this.size > 1 && Math.random() < 0.25) ctx.dropStack(this.dim, this.x, this.y + 0.3, this.z, createStack(ItemId.MAGMA_CREAM, 1));
  }
}

export class Enderman extends Monster {
  readonly type = 'enderman';
  override displayName = 'Enderman';
  carried = 0;
  carriedMeta = 0;
  angry = false;
  private stareTicks = 0;
  private teleportDelay = 0;
  constructor() {
    super();
    this.width = 0.6; this.height = 2.9;
    this.maxHealth = 40; this.health = 40;
    this.attackDamage = 7;
    this.ambientSound = 'mob.enderman'; this.hurtSound = 'mob.enderman'; this.deathSound = 'mob.enderman.scream';
    this.drops = [{ item: ItemId.ENDER_PEARL, min: 0, max: 1 }];
  }
  override get eyeHeight(): number {
    return 2.55;
  }
  protected initGoals(): void {
    this.goals.add(0, new SwimGoal(this));
    this.goals.add(2, new MeleeAttackGoal(this, 1.3));
    this.goals.add(7, new WanderGoal(this, 0.5));
    this.goals.add(8, new LookAtPlayerGoal(this, 8));
    this.goals.add(9, new LookIdleGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this));
  }
  override tick(ctx: GameContext): void {
    super.tick(ctx);
    if (this.dead) return;
    // Water hurts endermen; they teleport away from it and from rain.
    if (this.inWater || (ctx.world.raining && this.dim.getSkyLight(Math.floor(this.x), Math.floor(this.y + 2), Math.floor(this.z)) >= 15 && this.dim.id === 0)) {
      this.damage(ctx, 1, { type: 'drown', bypassArmor: true });
      this.teleportRandomly(ctx);
    }
    this.checkStare(ctx);
    this.angry = !!this.target;
    if (this.target && this.target.dim === this.dim) {
      if (this.distanceTo(this.target) > 16 && --this.teleportDelay <= 0) {
        this.teleportDelay = 30;
        this.teleportToward(ctx, this.target);
      }
    }
    // Block moving (classic behaviour): pick up grass, dirt, sand, gravel, flowers, mushrooms, TNT, cactus, clay, pumpkins, melons.
    if (Math.random() < 0.05 * 0.025 && this.dim.id === 0) this.fiddleWithBlocks(ctx);
    if (this.age % 5 === 0) ctx.particles('portal', this.dim, this.x, this.y + Math.random() * this.height, this.z, 1, { spread: 0.4 });
  }
  private fiddleWithBlocks(ctx: GameContext): void {
    const PICKABLE: number[] = [BlockId.GRASS, BlockId.DIRT, BlockId.SAND, BlockId.GRAVEL, BlockId.DANDELION, BlockId.ROSE, BlockId.BROWN_MUSHROOM,
      BlockId.RED_MUSHROOM, BlockId.TNT, BlockId.CACTUS, BlockId.CLAY, BlockId.PUMPKIN, BlockId.MELON_BLOCK, BlockId.MYCELIUM];
    const x = Math.floor(this.x - 2 + Math.random() * 4);
    const y = Math.floor(this.y + Math.random() * 3);
    const z = Math.floor(this.z - 2 + Math.random() * 4);
    if (this.carried === 0) {
      const id = this.dim.getBlock(x, y, z);
      if (PICKABLE.includes(id)) {
        this.carried = id;
        this.carriedMeta = this.dim.getMeta(x, y, z);
        this.dim.setBlock(x, y, z, 0, 0);
      }
    } else if (this.dim.getBlock(x, y, z) === 0 && getBlock(this.dim.getBlock(x, y - 1, z)).solid) {
      this.dim.setBlock(x, y, z, this.carried, this.carriedMeta);
      this.carried = 0;
    }
    void ctx;
  }
  private checkStare(ctx: GameContext): void {
    const p = ctx.player;
    if (this.target || p.dead || p.creative || p.dim !== this.dim || this.distanceTo(p) > 64) return;
    // Pumpkin heads protect from the stare.
    if (p.inventory.armor.get(0)?.id === BlockId.PUMPKIN) return;
    const [lx, ly, lz] = p.lookVector();
    const dx = this.x - p.x; const dy = this.y + this.eyeHeight - (p.y + p.eyeHeight); const dz = this.z - p.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const dot = (lx * dx + ly * dy + lz * dz) / d;
    if (dot > 1 - 0.025 / d && this.canSee(p)) {
      if (++this.stareTicks > 5) {
        this.target = p;
        ctx.playSound('mob.enderman.scream', this.x, this.y + 2, this.z, 1, 1);
        this.stareTicks = 0;
      }
    } else {
      this.stareTicks = 0;
    }
  }
  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    // Endermen dodge projectiles.
    if (source.type === 'arrow' || source.type === 'fireball') {
      for (let i = 0; i < 16; i++) if (this.teleportRandomly(ctx)) break;
      return false;
    }
    const ok = super.damage(ctx, amount, source);
    if (ok && Math.random() < 0.3) this.teleportRandomly(ctx);
    return ok;
  }
  teleportRandomly(ctx: GameContext): boolean {
    return this.teleportTo(ctx, this.x + (Math.random() - 0.5) * 64, this.y + Math.floor(Math.random() * 64) - 32, this.z + (Math.random() - 0.5) * 64);
  }
  private teleportToward(ctx: GameContext, t: LivingEntity): boolean {
    const dx = this.x - t.x; const dz = this.z - t.z;
    const d = Math.sqrt(dx * dx + dz * dz) || 1;
    return this.teleportTo(ctx, this.x + (Math.random() - 0.5) * 8 - (dx / d) * 16, this.y + Math.floor(Math.random() * 16) - 8, this.z + (Math.random() - 0.5) * 8 - (dz / d) * 16);
  }
  private teleportTo(ctx: GameContext, x: number, y: number, z: number): boolean {
    const bx = Math.floor(x); const bz = Math.floor(z);
    let by = Math.floor(y);
    if (!this.dim.isLoaded(bx, bz)) return false;
    while (by > 1 && !getBlock(this.dim.getBlock(bx, by - 1, bz)).collides) by--;
    if (by <= 1) return false;
    for (let h = 0; h < 3; h++) {
      const id = this.dim.getBlock(bx, by + h, bz);
      if (id !== 0 && (getBlock(id).collides || getBlock(id).fluid !== 'none')) return false;
    }
    const below = this.dim.getBlock(bx, by - 1, bz);
    if (getBlock(below).fluid !== 'none') return false;
    ctx.particles('portal', this.dim, this.x, this.y + 1, this.z, 32, { spread: 0.6 });
    ctx.playSound('mob.endermen.portal', this.x, this.y, this.z, 1, 1);
    this.setPosition(bx + 0.5, by, bz + 0.5);
    this.nav.stop();
    ctx.playSound('mob.endermen.portal', this.x, this.y, this.z, 1, 1);
    return true;
  }
  protected override extraDrops(ctx: GameContext): void {
    if (this.carried) ctx.dropStack(this.dim, this.x, this.y + 1, this.z, createStack(this.carried, 1, this.carriedMeta));
  }
  override serialize(): EntityData {
    return { ...super.serialize(), carried: this.carried, cmeta: this.carriedMeta };
  }
  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.carried = (d.carried as number) ?? 0;
    this.carriedMeta = (d.cmeta as number) ?? 0;
  }
}

export class ZombiePigman extends Zombie {
  override readonly type = 'zombie_pigman';
  override displayName = 'Zombie Pigman';
  anger = 0;
  constructor() {
    super();
    this.fireImmune = true;
    this.burnsInDaylight = false;
    this.attackDamage = 5;
    this.ambientSound = 'mob.pigman'; this.hurtSound = 'mob.pigman'; this.deathSound = 'mob.pigman';
    this.drops = [{ item: ItemId.ROTTEN_FLESH, min: 0, max: 1 }, { item: ItemId.GOLD_NUGGET, min: 0, max: 1 }];
  }
  override readonly category: MobCategory = 'neutral';
  protected override initGoals(): void {
    this.goals.add(0, new SwimGoal(this));
    this.goals.add(2, new MeleeAttackGoal(this, 1.1));
    this.goals.add(5, new WanderGoal(this, 0.5));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(7, new LookIdleGoal(this));
    this.targets.add(1, new HurtByTargetGoal(this, 'zombie_pigman'));
  }
  becomeAngryAt = (e: LivingEntity | null): void => {
    if (!e) return;
    this.target = e;
    this.anger = 400 + Math.floor(Math.random() * 400);
  };
  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    const ok = super.damage(ctx, amount, source);
    if (ok && source.attacker && source.attacker.type === 'player') {
      this.becomeAngryAt(source.attacker as LivingEntity);
      ctx.playSound('mob.pigman.angry', this.x, this.y + 1.5, this.z, 1, 1);
      for (const e of ctx.entitiesIn(this.dim)) {
        if (e.type === 'zombie_pigman' && e !== this && this.distanceTo(e) < 32) (e as ZombiePigman).becomeAngryAt(source.attacker as LivingEntity);
      }
    }
    return ok;
  }
  override tick(ctx: GameContext): void {
    if (this.anger > 0 && --this.anger === 0) this.target = null;
    super.tick(ctx);
  }
  override canDespawn(): boolean {
    return this.anger <= 0;
  }
  protected override extraDrops(ctx: GameContext, byPlayer: boolean): void {
    if (byPlayer && Math.random() < 0.025) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(Math.random() < 0.5 ? ItemId.GOLD_INGOT : ItemId.GOLD_SWORD, 1));
  }
}

export class Silverfish extends Monster {
  readonly type = 'silverfish';
  override displayName = 'Silverfish';
  private summonCooldown = 0;
  constructor() {
    super();
    this.width = 0.3; this.height = 0.7;
    this.maxHealth = 8; this.health = 8;
    this.attackDamage = 1;
    this.ambientSound = 'mob.silverfish'; this.hurtSound = 'mob.silverfish'; this.deathSound = 'mob.silverfish';
  }
  override get eyeHeight(): number {
    return 0.1;
  }
  protected initGoals(): void {
    this.goals.add(1, new SwimGoal(this));
    this.goals.add(3, new MeleeAttackGoal(this, 1.1, 1.5));
    this.goals.add(5, new WanderGoal(this, 0.6));
    this.targets.add(1, new HurtByTargetGoal(this));
    this.targets.add(2, new TargetPlayerGoal(this, 8, false));
  }
  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    const ok = super.damage(ctx, amount, source);
    if (ok && source.attacker && this.summonCooldown <= 0) {
      this.summonCooldown = 20;
      // Wake up silverfish hiding in nearby infested blocks.
      for (let dx = -5; dx <= 5; dx++) for (let dy = -5; dy <= 5; dy++) for (let dz = -5; dz <= 5; dz++) {
        const x = Math.floor(this.x) + dx; const y = Math.floor(this.y) + dy; const z = Math.floor(this.z) + dz;
        if (this.dim.getBlock(x, y, z) === BlockId.MONSTER_EGG && Math.random() < 0.5) {
          const m = this.dim.getMeta(x, y, z);
          this.dim.setBlock(x, y, z, m === 1 ? BlockId.COBBLESTONE : m === 2 ? BlockId.STONE_BRICKS : BlockId.STONE, 0);
          const s = new Silverfish();
          s.setPosition(x + 0.5, y, z + 0.5);
          ctx.spawn(s, this.dim);
        }
      }
    }
    return ok;
  }
  override tick(ctx: GameContext): void {
    if (this.summonCooldown > 0) this.summonCooldown--;
    super.tick(ctx);
  }
}

export class Ghast extends Monster {
  readonly type = 'ghast';
  override displayName = 'Ghast';
  shooting = 0;
  private attackCounter = 0;
  private wx = 0; private wy = 0; private wz = 0;
  private courseTimer = 0;
  constructor() {
    super();
    this.width = 4; this.height = 4;
    this.maxHealth = 10; this.health = 10;
    this.fireImmune = true;
    this.noGravity = true;
    this.ambientSound = 'mob.ghast'; this.hurtSound = 'mob.ghast.scream'; this.deathSound = 'mob.ghast.scream';
    this.drops = [{ item: ItemId.GHAST_TEAR, min: 0, max: 1 }, { item: ItemId.GUNPOWDER, min: 0, max: 2 }];
  }
  protected override flyingMob(): boolean {
    return true;
  }
  protected initGoals(): void {}
  protected aiStep(ctx: GameContext): void {
    // Wander by picking random waypoints and flying straight at them.
    const dx = this.wx - this.x; const dy = this.wy - this.y; const dz = this.wz - this.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 1 || d > 60) {
      this.wx = this.x + (Math.random() * 2 - 1) * 16;
      this.wy = this.y + (Math.random() * 2 - 1) * 16;
      this.wz = this.z + (Math.random() * 2 - 1) * 16;
    }
    if (this.courseTimer-- <= 0) {
      this.courseTimer = 2 + Math.floor(Math.random() * 5);
      if (d > 0.1 && this.pathClear(dx / d, dy / d, dz / d, d)) {
        this.motionX += (dx / d) * 0.1; this.motionY += (dy / d) * 0.1; this.motionZ += (dz / d) * 0.1;
      } else {
        this.wx = this.x; this.wy = this.y; this.wz = this.z;
      }
    }
    const p = ctx.player;
    const target = !p.dead && !p.creative && p.dim === this.dim && this.distanceTo(p) < 64 && ctx.difficulty > 0 ? p : null;
    if (target) {
      const tx = target.x - this.x; const tz = target.z - this.z;
      this.yaw = Math.atan2(-tx, -tz);
      if (this.canSee(target)) {
        if (this.attackCounter === 10) ctx.playSound('mob.ghast', this.x, this.y, this.z, 3, 1);
        this.attackCounter++;
        if (this.attackCounter === 20) {
          ctx.playSound('mob.ghast.fireball', this.x, this.y, this.z, 3, 1);
          const fb = new Fireball(false);
          fb.dim = this.dim;
          fb.shooter = this;
          const [lx, , lz] = [-Math.sin(this.yaw), 0, -Math.cos(this.yaw)];
          fb.setPosition(this.x + lx * 2, this.y + this.height / 2, this.z + lz * 2);
          fb.aim(target.x - fb.x, target.y + target.height / 2 - (fb.y + 0.5), target.z - fb.z, 0.4);
          ctx.spawn(fb, this.dim);
          this.attackCounter = -40;
        }
      } else if (this.attackCounter > 0) {
        this.attackCounter--;
      }
    } else if (this.attackCounter > 0) {
      this.attackCounter--;
    }
    this.shooting = this.attackCounter > 10 ? 1 : 0;
  }
  private pathClear(dx: number, dy: number, dz: number, d: number): boolean {
    const b = this.box;
    for (let i = 1; i < d; i++) {
      const bb = b.clone().offset(dx * i, dy * i, dz * i);
      for (let x = Math.floor(bb.minX); x <= Math.floor(bb.maxX); x++) {
        for (let y = Math.floor(bb.minY); y <= Math.floor(bb.maxY); y++) {
          for (let z = Math.floor(bb.minZ); z <= Math.floor(bb.maxZ); z++) {
            if (getBlock(this.dim.getBlock(x, y, z)).collides) return false;
          }
        }
      }
    }
    return true;
  }
  override travel(): void {
    this.move(this.motionX, this.motionY, this.motionZ);
    this.motionX *= 0.91; this.motionY *= 0.91; this.motionZ *= 0.91;
  }
}

export class Blaze extends Monster {
  readonly type = 'blaze';
  override displayName = 'Blaze';
  private heightOffset = 0.5;
  private heightTimer = 0;
  private attackTimer = 0;
  private burst = 0;
  onFireVisual = false;
  constructor() {
    super();
    this.width = 0.6; this.height = 1.8;
    this.maxHealth = 20; this.health = 20;
    this.attackDamage = 6;
    this.fireImmune = true;
    this.xpReward = 10;
    this.ambientSound = 'mob.blaze'; this.hurtSound = 'mob.blaze'; this.deathSound = 'mob.blaze';
  }
  protected initGoals(): void {}
  protected override flyingMob(): boolean {
    return false;
  }
  protected aiStep(ctx: GameContext): void {
    this.moveForward = 0;
    this.jumping = false;
    if (this.inWater && this.age % 5 === 0) this.damage(ctx, 1, { type: 'drown', bypassArmor: true });
    const p = ctx.player;
    const target = !p.dead && !p.creative && p.dim === this.dim && this.distanceTo(p) < 48 && ctx.difficulty > 0 ? p : this.target;
    if (this.heightTimer-- <= 0) {
      this.heightTimer = 100;
      this.heightOffset = 0.5 + Math.random() * 3;
    }
    if (target && !target.dead) {
      this.target = target;
      const dx = target.x - this.x; const dz = target.z - this.z;
      this.yaw = Math.atan2(-dx, -dz);
      this.look.lookAt(target, 30, 30);
      if (target.y + target.eyeHeight > this.y + this.eyeHeight + this.heightOffset) {
        this.motionY += (0.3 - this.motionY) * 0.3;
      }
      const d = this.distanceTo(target);
      if (d < 2 && this.attackCooldown <= 0 && target.box.maxY > this.box.minY && target.box.minY < this.box.maxY) {
        this.attackCooldown = 20;
        this.attackEntity(target);
      } else if (d < 30 && this.canSee(target)) {
        this.attackTimer--;
        if (this.attackTimer <= 0) {
          this.burst++;
          if (this.burst === 1) {
            this.attackTimer = 60;
            this.onFireVisual = true;
          } else if (this.burst <= 4) {
            this.attackTimer = 6;
          } else {
            this.attackTimer = 100;
            this.burst = 0;
            this.onFireVisual = false;
          }
          if (this.burst > 1) {
            const spread = Math.sqrt(d) * 0.5;
            ctx.playSound('mob.blaze.shoot', this.x, this.y, this.z, 1, 1);
            for (let i = 0; i < 1; i++) {
              const fb = new Fireball(true);
              fb.dim = this.dim;
              fb.shooter = this;
              fb.setPosition(this.x, this.y + this.height / 2 + 0.5, this.z);
              fb.aim(target.x - this.x + (Math.random() - 0.5) * spread, target.y + target.height / 2 - (this.y + this.height / 2 + 0.5), target.z - this.z + (Math.random() - 0.5) * spread);
              ctx.spawn(fb, this.dim);
            }
          }
        }
        // Keep a little distance while shooting.
        if (d < 6) { this.moveForward = -0.3; } else if (d > 12) this.moveForward = 0.6;
      } else if (d >= 30) {
        this.moveForward = 0.6;
      }
    } else {
      this.onFireVisual = false;
    }
    if (!this.onGround && this.motionY < 0) this.motionY *= 0.6;
    if (Math.random() < 0.1) ctx.particles('smoke', this.dim, this.x, this.y + Math.random() * this.height, this.z, 1, { spread: 0.3 });
  }
  protected override updateFall(): void {
    this.fallDistance = 0;
  }
  protected override extraDrops(ctx: GameContext, byPlayer: boolean): void {
    if (byPlayer) {
      const n = Math.floor(Math.random() * 2);
      if (n > 0) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(ItemId.BLAZE_ROD, n));
    }
  }
}

export class Villager extends Mob {
  readonly type = 'villager';
  readonly category: MobCategory = 'passive';
  override displayName = 'Villager';
  profession = Math.floor(Math.random() * 5);
  constructor() {
    super();
    this.width = 0.6; this.height = 1.8;
    this.maxHealth = 20; this.health = 20;
    this.canOpenDoors = true;
  }
  protected initGoals(): void {
    this.goals.add(0, new SwimGoal(this));
    this.goals.add(1, new AvoidZombieGoal(this));
    this.goals.add(5, new WanderGoal(this, 0.45, 80));
    this.goals.add(6, new LookAtPlayerGoal(this, 8));
    this.goals.add(7, new LookIdleGoal(this));
  }
  override canDespawn(): boolean {
    return false;
  }
  override serialize(): EntityData {
    return { ...super.serialize(), prof: this.profession };
  }
  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.profession = (d.prof as number) ?? 0;
  }
}

class AvoidZombieGoal extends Goal {
  constructor(mob: Mob) { super(mob); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    const m = this.mob;
    if (!m.ctx) return false;
    for (const e of m.ctx.entitiesIn(m.dim)) {
      if (e.type === 'zombie' && m.distanceTo(e) < 8) {
        const dx = m.x - e.x; const dz = m.z - e.z;
        const d = Math.sqrt(dx * dx + dz * dz) || 1;
        return m.nav.moveTo(m.x + (dx / d) * 8, m.y, m.z + (dz / d) * 8, 1.2);
      }
    }
    return false;
  }
  canContinue(): boolean { return this.mob.nav.busy; }
}

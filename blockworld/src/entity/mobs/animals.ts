/** Passive and utility animals of the release era, with breeding. */

import { BlockId, DYE_COLOR_RGB } from '../../blocks/ids';
import { ItemId } from '../../items/ids';
import { createStack } from '../../items/stack';
import { getItem } from '../../items/registry';
import type { GameContext } from '../../game/context';
import type { Player } from '../player';
import type { EntityData } from '../entity';
import type { LivingEntity } from '../living';
import type { DamageSource } from '../damage';
import { Mob, type MobCategory } from '../mob';
import {
  Goal, HurtByTargetGoal, LeapAtTargetGoal, LookAtPlayerGoal, LookIdleGoal, MeleeAttackGoal, MUTEX_JUMP, MUTEX_MOVE,
  PanicGoal, SwimGoal, WanderGoal,
} from '../ai/goals';

/** Animals that can be bred with wheat. */
export abstract class Animal extends Mob {
  readonly category: MobCategory = 'passive';
  inLove = 0;
  breedItem = ItemId.WHEAT;

  protected initGoals(): void {
    this.goals.add(0, new SwimGoal(this));
    this.goals.add(1, new PanicGoal(this, 1.3));
    this.goals.add(2, new MateGoal(this));
    this.goals.add(3, new TemptGoal(this, 0.9));
    this.goals.add(4, new FollowParentGoal(this));
    this.goals.add(5, new WanderGoal(this, 0.5));
    this.goals.add(6, new LookAtPlayerGoal(this, 6));
    this.goals.add(7, new LookIdleGoal(this));
  }

  abstract createChild(): Animal;

  override interact(ctx: GameContext, player: Player): boolean {
    const held = player.inventory.held;
    if (held && held.id === this.breedItem && !this.baby && this.growingAge === 0 && this.inLove <= 0) {
      if (!player.creative) player.inventory.consumeHeld(1);
      this.inLove = 600;
      ctx.particles('heart', this.dim, this.x, this.y + this.height, this.z, 5, { spread: 0.4 });
      return true;
    }
    return false;
  }

  override tick(ctx: GameContext): void {
    super.tick(ctx);
    if (this.inLove > 0) {
      this.inLove--;
      if (this.age % 10 === 0) ctx.particles('heart', this.dim, this.x, this.y + this.height, this.z, 1, { spread: 0.3 });
    }
  }

  override serialize(): EntityData {
    return { ...super.serialize(), love: this.inLove };
  }
}

class TemptGoal extends Goal {
  private player: Player | null = null;
  private cooldown = 0;
  constructor(mob: Animal, readonly speed: number) { super(mob); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    if (this.cooldown > 0) { this.cooldown--; return false; }
    const p = this.mob.ctx?.player;
    if (!p || p.dim !== this.mob.dim || this.mob.distanceTo(p) > 10) return false;
    const held = p.inventory.held;
    if (!held || held.id !== (this.mob as Animal).breedItem) return false;
    this.player = p;
    return true;
  }
  canContinue(): boolean { return this.canStart(); }
  stop(): void { this.mob.nav.stop(); this.cooldown = 60; }
  tick(): void {
    const p = this.player!;
    this.mob.look.lookAt(p, 30, 40);
    if (this.mob.distanceTo(p) < 2.5) this.mob.nav.stop();
    else this.mob.nav.moveTo(p.x, p.y, p.z, this.speed);
  }
}

class MateGoal extends Goal {
  private partner: Animal | null = null;
  private timer = 0;
  constructor(mob: Animal) { super(mob); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    const m = this.mob as Animal;
    if (m.inLove <= 0 || !m.ctx) return false;
    for (const e of m.ctx.entitiesIn(m.dim)) {
      if (e !== m && e.type === m.type && (e as Animal).inLove > 0 && m.distanceTo(e) < 8) {
        this.partner = e as Animal;
        return true;
      }
    }
    return false;
  }
  canContinue(): boolean { return !!this.partner && this.partner.inLove > 0 && (this.mob as Animal).inLove > 0 && this.timer < 60; }
  start(): void { this.timer = 0; }
  stop(): void { this.partner = null; this.timer = 0; }
  tick(): void {
    const m = this.mob as Animal;
    const p = this.partner!;
    m.look.lookAt(p, 10, 40);
    m.nav.moveTo(p.x, p.y, p.z, 0.5);
    if (m.distanceTo(p) < 3) this.timer++;
    if (this.timer >= 60 && m.ctx && m.id < p.id) {
      const child = m.createChild();
      child.baby = true;
      child.growingAge = -24000;
      child.setPosition(m.x, m.y, m.z);
      m.ctx.spawn(child, m.dim);
      m.inLove = 0; p.inLove = 0;
      m.growingAge = 6000; p.growingAge = 6000;
      m.ctx.particles('heart', m.dim, m.x, m.y + m.height, m.z, 7, { spread: 0.5 });
      m.ctx.dropXp(m.dim, m.x, m.y + 0.5, m.z, 1 + Math.floor(Math.random() * 7));
    }
  }
}

class FollowParentGoal extends Goal {
  private parent: Animal | null = null;
  constructor(mob: Animal) { super(mob); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    const m = this.mob;
    if (!m.baby || !m.ctx) return false;
    let best: Animal | null = null;
    let bestD = 64;
    for (const e of m.ctx.entitiesIn(m.dim)) {
      if (e === m || e.type !== m.type || (e as Animal).baby) continue;
      const d = m.distanceSqTo(e.x, e.y, e.z);
      if (d < bestD) { bestD = d; best = e as Animal; }
    }
    if (!best || bestD < 9) return false;
    this.parent = best;
    return true;
  }
  canContinue(): boolean { return !!this.parent && !this.parent.dead && this.mob.distanceTo(this.parent) > 3 && this.mob.distanceTo(this.parent) < 16; }
  tick(): void { if (this.parent && this.mob.age % 10 === 0) this.mob.nav.moveTo(this.parent.x, this.parent.y, this.parent.z, 0.6); }
}

export class Pig extends Animal {
  readonly type = 'pig';
  override displayName = 'Pig';
  saddled = false;
  constructor() {
    super();
    this.width = 0.9; this.height = 0.9; this.maxHealth = 10; this.health = 10;
    this.ambientSound = 'mob.pig'; this.hurtSound = 'mob.pig'; this.deathSound = 'mob.pig';
    this.xpReward = 2;
  }
  createChild(): Animal { return new Pig(); }
  protected extraDrops(ctx: GameContext): void {
    const n = Math.floor(Math.random() * 3);
    if (n > 0) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(this.fireTicks > 0 ? ItemId.COOKED_PORKCHOP : ItemId.RAW_PORKCHOP, n));
  }
}

export class Cow extends Animal {
  readonly type: string = 'cow';
  override displayName = 'Cow';
  constructor() {
    super();
    this.width = 0.9; this.height = 1.3; this.maxHealth = 10; this.health = 10;
    this.ambientSound = 'mob.cow'; this.hurtSound = 'mob.animal.hurt'; this.deathSound = 'mob.cow';
    this.drops = [{ item: ItemId.LEATHER, min: 0, max: 2 }];
    this.xpReward = 2;
  }
  createChild(): Animal { return new Cow(); }
  protected extraDrops(ctx: GameContext): void {
    const n = 1 + Math.floor(Math.random() * 3);
    ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(this.fireTicks > 0 ? ItemId.COOKED_BEEF : ItemId.RAW_BEEF, n));
  }
  override interact(ctx: GameContext, player: Player): boolean {
    const held = player.inventory.held;
    if (held?.id === ItemId.BUCKET && !this.baby) {
      if (held.count > 1) {
        held.count--;
        const left = player.inventory.addItem(createStack(ItemId.MILK_BUCKET));
        if (left) ctx.dropStack(this.dim, player.x, player.y + 1, player.z, left);
      } else {
        player.inventory.held = createStack(ItemId.MILK_BUCKET);
      }
      player.inventory.changed();
      return true;
    }
    return super.interact(ctx, player);
  }
}

export class Mooshroom extends Cow {
  override readonly type = 'mooshroom';
  override displayName = 'Mooshroom';
  override createChild(): Animal { return new Mooshroom(); }
  override interact(ctx: GameContext, player: Player): boolean {
    const held = player.inventory.held;
    if (held?.id === ItemId.BOWL && !this.baby) {
      if (held.count > 1) {
        held.count--;
        const left = player.inventory.addItem(createStack(ItemId.MUSHROOM_STEW));
        if (left) ctx.dropStack(this.dim, player.x, player.y + 1, player.z, left);
      } else player.inventory.held = createStack(ItemId.MUSHROOM_STEW);
      player.inventory.changed();
      return true;
    }
    if (held?.id === ItemId.SHEARS && !this.baby) {
      this.removed = true;
      const cow = new Cow();
      cow.setPosition(this.x, this.y, this.z);
      cow.yaw = this.yaw;
      cow.health = this.health;
      ctx.spawn(cow, this.dim);
      ctx.particles('largeexplode', this.dim, this.x, this.y + this.height / 2, this.z, 1);
      for (let i = 0; i < 5; i++) ctx.dropStack(this.dim, this.x, this.y + this.height, this.z, createStack(BlockId.RED_MUSHROOM));
      return true;
    }
    return super.interact(ctx, player);
  }
}

export class Sheep extends Animal {
  readonly type = 'sheep';
  override displayName = 'Sheep';
  color = 0;
  sheared = false;
  eatTimer = 0;
  constructor() {
    super();
    this.width = 0.9; this.height = 1.3; this.maxHealth = 8; this.health = 8;
    this.ambientSound = 'mob.sheep'; this.hurtSound = 'mob.sheep'; this.deathSound = 'mob.sheep';
    this.xpReward = 2;
    // Natural fleece colours: mostly white, some greys/black/brown, rare pink.
    const r = Math.random() * 100;
    this.color = r < 5 ? 15 : r < 10 ? 7 : r < 15 ? 8 : r < 18 ? 12 : Math.random() < 1 / 500 ? 6 : 0;
  }
  protected initGoals(): void {
    super.initGoals();
    this.goals.add(5, new EatGrassGoal(this));
  }
  createChild(): Animal {
    const s = new Sheep();
    s.color = this.color;
    return s;
  }
  protected extraDrops(ctx: GameContext): void {
    if (!this.sheared) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(BlockId.WOOL, 1, this.color));
  }
  override interact(ctx: GameContext, player: Player): boolean {
    const held = player.inventory.held;
    if (held?.id === ItemId.SHEARS && !this.sheared && !this.baby) {
      this.sheared = true;
      const n = 1 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        ctx.dropStack(this.dim, this.x, this.y + 1, this.z, createStack(BlockId.WOOL, 1, this.color));
      }
      const def = getItem(held.id)!;
      held.damage++;
      if (held.damage >= def.durability) player.inventory.held = null;
      player.inventory.changed();
      return true;
    }
    if (held?.id === ItemId.DYE && !this.sheared) {
      const wool = 15 - (held.meta & 15);
      if (wool !== this.color) {
        this.color = wool;
        if (!player.creative) player.inventory.consumeHeld(1);
        return true;
      }
    }
    return super.interact(ctx, player);
  }
  get woolRgb(): readonly [number, number, number] {
    return DYE_COLOR_RGB[this.color] as [number, number, number];
  }
  override serialize(): EntityData {
    return { ...super.serialize(), color: this.color, sheared: this.sheared };
  }
  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.color = (d.color as number) ?? 0;
    this.sheared = !!d.sheared;
  }
}

class EatGrassGoal extends Goal {
  private timer = 0;
  constructor(readonly sheep: Sheep) { super(sheep); this.mutex = MUTEX_MOVE | MUTEX_JUMP; }
  canStart(): boolean {
    const s = this.sheep;
    if (Math.random() * (s.baby ? 50 : 1000) >= 1) return false;
    const bx = Math.floor(s.x); const by = Math.floor(s.y); const bz = Math.floor(s.z);
    return s.dim.getBlock(bx, by, bz) === BlockId.TALL_GRASS || s.dim.getBlock(bx, by - 1, bz) === BlockId.GRASS;
  }
  canContinue(): boolean { return this.timer > 0; }
  start(): void { this.timer = 40; this.sheep.nav.stop(); this.sheep.eatTimer = 40; }
  tick(): void {
    const s = this.sheep;
    this.timer--;
    s.eatTimer = this.timer;
    if (this.timer === 4) {
      const bx = Math.floor(s.x); const by = Math.floor(s.y); const bz = Math.floor(s.z);
      if (s.dim.getBlock(bx, by, bz) === BlockId.TALL_GRASS) s.dim.setBlock(bx, by, bz, 0, 0);
      else if (s.dim.getBlock(bx, by - 1, bz) === BlockId.GRASS) s.dim.setBlock(bx, by - 1, bz, BlockId.DIRT, 0);
      s.sheared = false;
      if (s.baby) s.growingAge = Math.min(0, s.growingAge + 60);
    }
  }
}

export class Chicken extends Animal {
  readonly type = 'chicken';
  override displayName = 'Chicken';
  eggTimer = 6000 + Math.floor(Math.random() * 6000);
  flap = 0;
  constructor() {
    super();
    this.width = 0.3; this.height = 0.7; this.maxHealth = 4; this.health = 4;
    this.ambientSound = 'mob.chicken'; this.hurtSound = 'mob.chicken'; this.deathSound = 'mob.chicken';
    this.drops = [{ item: ItemId.FEATHER, min: 0, max: 2 }];
    this.xpReward = 1;
  }
  createChild(): Animal { return new Chicken(); }
  override tick(ctx: GameContext): void {
    super.tick(ctx);
    // Chickens flutter down slowly.
    if (!this.onGround && this.motionY < 0) this.motionY *= 0.6;
    this.flap += this.onGround ? 0 : 1;
    this.fallDistance = 0;
    if (!this.baby && --this.eggTimer <= 0) {
      this.eggTimer = 6000 + Math.floor(Math.random() * 6000);
      ctx.playSound('random.pop', this.x, this.y, this.z, 1, 1.5);
      ctx.dropStack(this.dim, this.x, this.y + 0.2, this.z, createStack(ItemId.EGG), 10, false);
    }
  }
  protected extraDrops(ctx: GameContext): void {
    ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(this.fireTicks > 0 ? ItemId.COOKED_CHICKEN : ItemId.RAW_CHICKEN, 1));
  }
}

export class Squid extends Mob {
  readonly type = 'squid';
  readonly category: MobCategory = 'water';
  override displayName = 'Squid';
  tentacleAngle = 0;
  private swimDir: [number, number, number] = [0, 0, 0];
  private swimTimer = 0;
  constructor() {
    super();
    this.width = 0.95; this.height = 0.95; this.maxHealth = 10; this.health = 10;
    this.canBreatheUnderwater = true;
    this.drops = [{ item: ItemId.DYE, meta: 0, min: 1, max: 3 }];
    this.xpReward = 1;
    this.noGravity = false;
  }
  protected initGoals(): void {}
  protected aiStep(): void {
    this.moveForward = 0;
    if (--this.swimTimer <= 0) {
      this.swimTimer = 40 + Math.floor(Math.random() * 60);
      const a = Math.random() * Math.PI * 2;
      this.swimDir = [Math.cos(a) * 0.15, (Math.random() - 0.5) * 0.1, Math.sin(a) * 0.15];
    }
  }
  override travel(): void {
    this.tentacleAngle += 0.2;
    if (this.inWater) {
      const pulse = Math.max(0, Math.sin(this.tentacleAngle));
      this.motionX += this.swimDir[0] * pulse * 0.2;
      this.motionY += this.swimDir[1] * pulse * 0.2;
      this.motionZ += this.swimDir[2] * pulse * 0.2;
      this.move(this.motionX, this.motionY, this.motionZ);
      this.motionX *= 0.9; this.motionY *= 0.9; this.motionZ *= 0.9;
      if (Math.abs(this.motionX) + Math.abs(this.motionZ) > 0.01) this.yaw = Math.atan2(-this.motionX, -this.motionZ);
      this.air = 300;
    } else {
      this.motionY -= 0.08;
      this.move(0, this.motionY, 0);
      this.motionY *= 0.98;
      this.air -= 1;
      if (this.air < -20 && this.ctx) { this.air = 0; this.damage(this.ctx, 2, { type: 'drown', bypassArmor: true }); }
    }
  }
}

export class Wolf extends Mob {
  readonly type = 'wolf';
  readonly category: MobCategory = 'passive';
  override displayName = 'Wolf';
  angry = false;
  tamed = false;
  sitting = false;
  owner: Player | null = null;
  ownerTag = '';
  constructor() {
    super();
    this.width = 0.6; this.height = 0.8; this.maxHealth = 8; this.health = 8;
    this.attackDamage = 2;
    this.ambientSound = null; this.hurtSound = 'mob.wolf'; this.deathSound = 'mob.wolf.whine';
    this.xpReward = 1;
  }
  protected initGoals(): void {
    this.goals.add(1, new SwimGoal(this));
    this.goals.add(2, new SitGoal(this));
    this.goals.add(3, new LeapAtTargetGoal(this, 0.4));
    this.goals.add(4, new MeleeAttackGoal(this, 1.2));
    this.goals.add(5, new FollowOwnerGoal(this));
    this.goals.add(7, new WanderGoal(this, 0.5));
    this.goals.add(8, new LookAtPlayerGoal(this, 8));
    this.goals.add(9, new LookIdleGoal(this));
    this.targets.add(1, new OwnerDefenseGoal(this));
    this.targets.add(2, new HurtByTargetGoal(this));
  }
  override tick(ctx: GameContext): void {
    if (this.tamed && !this.owner && ctx.player) this.owner = ctx.player;
    this.maxHealth = this.tamed ? 20 : 8;
    if (this.target && this.target.dead) this.target = null;
    this.angry = !!this.target && !this.tamed;
    super.tick(ctx);
    if (this.tamed && this.health < this.maxHealth && this.age % 1200 === 0) this.heal(1);
  }
  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    this.sitting = false;
    if (source.attacker && source.attacker.type === 'player' && this.tamed) {
      // Tamed wolves forgive their owner.
      return super.damage(ctx, amount, { ...source, attacker: null });
    }
    return super.damage(ctx, amount, source);
  }
  override attackEntity(t: LivingEntity): boolean {
    this.attackDamage = this.tamed ? 4 : 2;
    return super.attackEntity(t);
  }
  override interact(ctx: GameContext, player: Player): boolean {
    const held = player.inventory.held;
    if (!this.tamed) {
      if (held?.id === ItemId.BONE && !this.angry) {
        if (!player.creative) player.inventory.consumeHeld(1);
        if (Math.random() < 1 / 3) {
          this.tamed = true;
          this.owner = player;
          this.sitting = true;
          this.health = 20;
          this.target = null;
          this.nav.stop();
          ctx.particles('heart', this.dim, this.x, this.y + this.height, this.z, 7, { spread: 0.4 });
        } else {
          ctx.particles('smoke', this.dim, this.x, this.y + this.height, this.z, 7, { spread: 0.4 });
        }
        return true;
      }
      return false;
    }
    const food = held ? getItem(held.id)?.food : null;
    if (held && food && (held.id === ItemId.RAW_PORKCHOP || held.id === ItemId.COOKED_PORKCHOP || held.id === ItemId.RAW_BEEF ||
      held.id === ItemId.COOKED_BEEF || held.id === ItemId.RAW_CHICKEN || held.id === ItemId.COOKED_CHICKEN || held.id === ItemId.ROTTEN_FLESH) &&
      this.health < this.maxHealth) {
      if (!player.creative) player.inventory.consumeHeld(1);
      this.heal(food.hunger);
      return true;
    }
    this.sitting = !this.sitting;
    this.jumping = false;
    this.nav.stop();
    this.target = null;
    return true;
  }
  override canDespawn(): boolean {
    return false;
  }
  override serialize(): EntityData {
    return { ...super.serialize(), tamed: this.tamed, sitting: this.sitting, angry: this.angry };
  }
  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.tamed = !!d.tamed;
    this.sitting = !!d.sitting;
  }
}

class SitGoal extends Goal {
  constructor(readonly wolf: Wolf) { super(wolf); this.mutex = MUTEX_MOVE | MUTEX_JUMP; }
  canStart(): boolean { return this.wolf.tamed && this.wolf.sitting && !this.wolf.inWater; }
  start(): void { this.wolf.nav.stop(); }
}

class FollowOwnerGoal extends Goal {
  constructor(readonly wolf: Wolf) { super(wolf); this.mutex = MUTEX_MOVE; }
  canStart(): boolean {
    const w = this.wolf;
    const o = w.owner;
    if (!w.tamed || w.sitting || !o || o.dim !== w.dim || o.dead) return false;
    return w.distanceTo(o) > 10;
  }
  canContinue(): boolean {
    const w = this.wolf;
    return !!w.owner && !w.sitting && w.distanceTo(w.owner) > 2 && w.owner.dim === w.dim;
  }
  tick(): void {
    const w = this.wolf;
    const o = w.owner!;
    w.look.lookAt(o, 10, 40);
    if (w.age % 10 !== 0) return;
    if (w.distanceTo(o) > 12) {
      // Teleport next to the owner when left far behind.
      for (let i = 0; i < 10; i++) {
        const x = Math.floor(o.x) + Math.floor(Math.random() * 5) - 2;
        const z = Math.floor(o.z) + Math.floor(Math.random() * 5) - 2;
        const y = Math.floor(o.y);
        if (w.dim.getBlock(x, y, z) === 0 && w.dim.getBlock(x, y + 1, z) === 0 && w.dim.getBlock(x, y - 1, z) !== 0) {
          w.setPosition(x + 0.5, y, z + 0.5);
          w.nav.stop();
          return;
        }
      }
    }
    w.nav.moveTo(o.x, o.y, o.z, 1.0);
  }
}

class OwnerDefenseGoal extends Goal {
  constructor(readonly wolf: Wolf) { super(wolf); }
  canStart(): boolean {
    const w = this.wolf;
    const o = w.owner;
    if (!w.tamed || !o || w.sitting) return false;
    const attacker = o.lastAttacker as LivingEntity | null;
    if (attacker && attacker !== w && !attacker.dead && w.ctx && w.ctx.tickCount - o.lastAttackerTime < 100 && attacker.type !== 'player') {
      w.target = attacker;
      return true;
    }
    return false;
  }
  canContinue(): boolean { return false; }
}

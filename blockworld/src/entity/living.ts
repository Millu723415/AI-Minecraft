/** Living entities: health, damage, armor, knockback, status effects, drowning. */

import { BlockId } from '../blocks/ids';
import { getBlock } from '../blocks/registry';
import type { GameContext } from '../game/context';
import { DAMAGE, type DamageSource } from './damage';
import { Effect, type ActiveEffect } from './effects';
import { Entity, type EntityData } from './entity';

export abstract class LivingEntity extends Entity {
  health = 20;
  maxHealth = 20;
  hurtTime = 0;
  /** Ticks during which new damage is ignored unless it exceeds lastDamage. */
  invulnerable = 0;
  lastDamage = 0;
  deathTime = 0;
  dead = false;
  air = 300;
  readonly effects = new Map<number, ActiveEffect>();
  moveForward = 0;
  moveStrafe = 0;
  jumping = false;
  sprinting = false;
  sneaking = false;
  jumpCooldown = 0;
  /** Base walking speed (player 0.1). */
  moveSpeed = 0.1;
  /** Where the attack came from, for knockback & panic AI. */
  lastAttacker: Entity | null = null;
  lastAttackerTime = 0;
  /** Swing animation progress for rendering (0..1). */
  swingProgress = 0;
  swinging = false;
  /** Suppresses natural despawn (named/tamed/persistent). */
  noDespawn = false;
  /** Does it drown / breathe underwater? */
  canBreatheUnderwater = false;
  undead = false;
  xpReward = 0;
  /** Recently hit by a player (drops rare items / XP only then). */
  recentlyHitByPlayer = 0;
  lastDamageSource: DamageSource | null = null;
  limbSwing = 0;
  limbSwingAmount = 0;
  prevLimbSwingAmount = 0;

  override stepHeight = 0.5;

  armorValue(): number {
    return 0;
  }

  /** Called when armor absorbed damage so pieces can lose durability. */
  protected damageArmor(_amount: number): void {}

  heal(amount: number): void {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + amount);
  }

  hasEffect(id: number): boolean {
    return this.effects.has(id);
  }

  addEffect(e: ActiveEffect): void {
    if (e.id === Effect.INSTANT_HEALTH) {
      if (this.undead) this.damageRaw(6 << e.amplifier, DAMAGE.magic);
      else this.heal(6 << e.amplifier);
      return;
    }
    if (e.id === Effect.INSTANT_DAMAGE) {
      if (this.undead) this.heal(6 << e.amplifier);
      else this.damageRaw(6 << e.amplifier, DAMAGE.magic);
      return;
    }
    const cur = this.effects.get(e.id);
    if (!cur || e.amplifier > cur.amplifier || (e.amplifier === cur.amplifier && e.duration > cur.duration)) {
      this.effects.set(e.id, { ...e });
    }
  }

  /** Apply damage directly (after all reductions). */
  protected damageRaw(amount: number, source: DamageSource): void {
    this.health -= amount;
    this.hurtTime = 10;
    this.lastDamageSource = source;
  }

  override canBeHit(): boolean {
    return !this.dead && !this.removed;
  }

  /** Main damage entry point, including invulnerability frames and armor. */
  override damage(ctx: GameContext, amountIn: number, source: DamageSource): boolean {
    if (this.dead || this.removed) return false;
    if (source.isFire && (this.fireImmune || this.hasEffect(Effect.FIRE_RESISTANCE))) return false;
    let amount = amountIn;
    let fresh = true;
    if (this.invulnerable > 10) {
      if (amount <= this.lastDamage) return false;
      const extra = amount - this.lastDamage;
      this.lastDamage = amount;
      amount = extra;
      fresh = false;
    } else {
      this.lastDamage = amount;
      this.invulnerable = 20;
      this.hurtTime = 10;
    }
    if (!source.bypassArmor) {
      const armor = this.armorValue();
      if (armor > 0) {
        this.damageArmor(amount);
        amount = (amount * (25 - armor)) / 25;
      }
    }
    amount = this.modifyDamage(amount, source);
    if (amount <= 0 && fresh) return false;
    this.health -= amount;
    this.lastDamageSource = source;
    const attacker = source.attacker ?? null;
    if (attacker) {
      this.lastAttacker = attacker;
      this.lastAttackerTime = ctx.tickCount;
      if (attacker.type === 'player') this.recentlyHitByPlayer = 60;
    }
    if (fresh) {
      const kb = source.projectile ?? attacker;
      if (kb && source.type !== 'fireball') {
        this.knockBack(kb.x - this.x, kb.z - this.z, 0.4);
      }
      this.onHurt(ctx, source);
    }
    if (this.health <= 0) {
      this.health = 0;
      this.die(ctx, source);
    }
    return true;
  }

  /** Hook for enchantment/effect based damage modification. */
  protected modifyDamage(amount: number, _source: DamageSource): number {
    return amount;
  }

  protected onHurt(_ctx: GameContext, _source: DamageSource): void {}

  knockBack(dx: number, dz: number, strength: number): void {
    const len = Math.sqrt(dx * dx + dz * dz) || 1;
    this.motionX /= 2;
    this.motionY /= 2;
    this.motionZ /= 2;
    this.motionX -= (dx / len) * strength;
    this.motionY += strength;
    this.motionZ -= (dz / len) * strength;
    if (this.motionY > 0.4) this.motionY = 0.4;
  }

  die(ctx: GameContext, source: DamageSource): void {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    this.onDeath(ctx, source);
  }

  protected onDeath(_ctx: GameContext, _source: DamageSource): void {}

  /** Jump velocity (mobs may override). */
  protected jumpVelocity(): number {
    return 0.42;
  }

  protected jump(): void {
    this.motionY = this.jumpVelocity();
    if (this.sprinting) {
      this.motionX -= Math.sin(this.yaw) * 0.2;
      this.motionZ -= Math.cos(this.yaw) * 0.2;
    }
  }

  /** Accelerate relative to yaw. */
  protected moveRelative(strafe: number, forward: number, accel: number): void {
    let d = strafe * strafe + forward * forward;
    if (d < 1e-4) return;
    d = Math.sqrt(d);
    if (d < 1) d = 1;
    d = accel / d;
    strafe *= d;
    forward *= d;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    this.motionX += -s * forward + c * strafe;
    this.motionZ += -c * forward - s * strafe;
  }

  protected speedMultiplier(): number {
    let m = 1;
    const speed = this.effects.get(Effect.SPEED);
    if (speed) m *= 1 + 0.2 * (speed.amplifier + 1);
    const slow = this.effects.get(Effect.SLOWNESS);
    if (slow) m *= Math.max(0, 1 - 0.15 * (slow.amplifier + 1));
    return m;
  }

  /** Classic movement: water, lava, ladders, ground friction, gravity. */
  travel(strafe: number, forward: number): void {
    if (this.inWater && !this.flyingMob()) {
      const y0 = this.y;
      this.moveRelative(strafe, forward, 0.02);
      this.move(this.motionX, this.motionY, this.motionZ);
      this.motionX *= 0.8; this.motionY *= 0.8; this.motionZ *= 0.8;
      this.motionY -= 0.02;
      if (this.collidedH && this.isFreeAt(this.motionX, this.motionY + 0.6 - this.y + y0, this.motionZ)) this.motionY = 0.3;
      return;
    }
    if (this.inLava && !this.flyingMob()) {
      const y0 = this.y;
      this.moveRelative(strafe, forward, 0.02);
      this.move(this.motionX, this.motionY, this.motionZ);
      this.motionX *= 0.5; this.motionY *= 0.5; this.motionZ *= 0.5;
      this.motionY -= 0.02;
      if (this.collidedH && this.isFreeAt(this.motionX, this.motionY + 0.6 - this.y + y0, this.motionZ)) this.motionY = 0.3;
      return;
    }
    let friction = 0.91;
    if (this.onGround) friction = this.groundSlipperiness() * 0.91;
    const accel = this.onGround
      ? this.moveSpeed * this.speedMultiplier() * (this.sprinting ? 1.3 : 1) * (0.16277136 / (friction * friction * friction))
      : this.sprinting ? 0.026 : 0.02;
    this.moveRelative(strafe, forward, accel);
    friction = 0.91;
    if (this.onGround) friction = this.groundSlipperiness() * 0.91;
    const ladder = this.isOnLadder();
    if (ladder) {
      const cap = 0.15;
      this.motionX = Math.max(-cap, Math.min(cap, this.motionX));
      this.motionZ = Math.max(-cap, Math.min(cap, this.motionZ));
      this.fallDistance = 0;
      if (this.motionY < -0.15) this.motionY = -0.15;
      if (this.sneaking && this.motionY < 0) this.motionY = 0;
    }
    this.move(this.motionX, this.motionY, this.motionZ);
    if (this.collidedH && ladder) this.motionY = 0.2;
    if (!this.noGravity) this.motionY -= 0.08;
    this.motionY *= 0.98;
    this.motionX *= friction;
    this.motionZ *= friction;
  }

  protected flyingMob(): boolean {
    return false;
  }

  /** Would the entity fit if offset by (dx,dy,dz)? (Liquid climbing check.) */
  protected isFreeAt(dx: number, dy: number, dz: number): boolean {
    const b = this.box.offset(dx, dy, dz);
    const x0 = Math.floor(b.minX); const x1 = Math.floor(b.maxX);
    const y0 = Math.floor(b.minY); const y1 = Math.floor(b.maxY);
    const z0 = Math.floor(b.minZ); const z1 = Math.floor(b.maxZ);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) {
      const id = this.dim.getBlock(x, y, z);
      if (id !== 0 && getBlock(id).collides) return false;
      if (id === BlockId.WATER || id === BlockId.LAVA || id === BlockId.WATER_FLOWING || id === BlockId.LAVA_FLOWING) return false;
    }
    return true;
  }

  protected override onLanded(distance: number): void {
    // Classic fall damage: 1 point per block beyond 3.
    const dmg = Math.ceil(distance - 3);
    if (dmg > 0 && this.pendingCtx) {
      this.damage(this.pendingCtx, dmg, DAMAGE.fall);
      this.pendingCtx.playSound(dmg > 4 ? 'fall.big' : 'fall.small', this.x, this.y, this.z, 1, 1);
    }
  }

  /** Context captured during the current tick (for callbacks from move()). */
  protected pendingCtx: GameContext | null = null;

  /** Shared per-tick living update; subclasses call from tick(). */
  protected livingTick(ctx: GameContext): void {
    this.pendingCtx = ctx;
    this.age++;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.recentlyHitByPlayer > 0) this.recentlyHitByPlayer--;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.portalCooldown > 0) this.portalCooldown--;
    if (this.dead) {
      this.deathTime++;
      this.motionX *= 0.5; this.motionZ *= 0.5;
      if (!this.noGravity) this.motionY -= 0.08;
      this.move(this.motionX, this.motionY, this.motionZ);
      if (this.deathTime >= 20) this.removed = true;
      this.pendingCtx = null;
      return;
    }
    this.updateEnvironment();
    this.environmentDamage(ctx);
    this.tickEffects(ctx);
    if (this.dead) { this.pendingCtx = null; return; }

    this.aiStep(ctx);

    if (this.jumping) {
      if (this.inWater || this.inLava) this.motionY += 0.04;
      else if (this.onGround && this.jumpCooldown === 0) {
        this.jump();
        this.jumpCooldown = 10;
      }
    } else {
      this.jumpCooldown = 0;
    }
    const x0 = this.x; const z0 = this.z;
    let forward = this.moveForward;
    let strafe = this.moveStrafe;
    if (this.sneaking) { forward *= 0.3; strafe *= 0.3; }
    if (this.vehicle && !this.vehicle.removed) {
      this.motionX = 0; this.motionY = 0; this.motionZ = 0;
      this.fallDistance = 0;
    } else {
      if (this.vehicle) this.vehicle = null;
      this.travel(strafe * 0.98, forward * 0.98);
    }
    // Limb swing for walk animation.
    this.prevLimbSwingAmount = this.limbSwingAmount;
    const moved = Math.min(1, Math.sqrt((this.x - x0) ** 2 + (this.z - z0) ** 2) * 4);
    this.limbSwingAmount += (moved - this.limbSwingAmount) * 0.4;
    this.limbSwing += this.limbSwingAmount;
    if (this.swinging) {
      this.swingProgress += 1 / 6;
      if (this.swingProgress >= 1) { this.swingProgress = 0; this.swinging = false; }
    }
    this.pendingCtx = null;
  }

  swing(): void {
    if (!this.swinging || this.swingProgress > 0.5) {
      this.swingProgress = 0;
      this.swinging = true;
    }
  }

  /** AI or player input sets moveForward/moveStrafe/jumping/yaw here. */
  protected abstract aiStep(ctx: GameContext): void;

  protected environmentDamage(ctx: GameContext): void {
    if (this.y < -64) this.damage(ctx, 4, DAMAGE.void);
    // Fire and lava.
    if (this.inLava) {
      this.damage(ctx, 4, DAMAGE.lava);
      this.setFire(15);
    }
    if (this.fireTicks > 0) {
      if (this.fireImmune || this.hasEffect(Effect.FIRE_RESISTANCE)) {
        this.fireTicks = Math.max(0, this.fireTicks - 4);
      } else {
        if (this.fireTicks % 20 === 0) this.damage(ctx, 1, DAMAGE.onFire);
        this.fireTicks--;
      }
    }
    // Contact with fire / cactus blocks.
    const b = this.box.grow(-0.001);
    let inFire = false;
    let cactus = false;
    for (let x = Math.floor(b.minX); x <= Math.floor(b.maxX); x++) {
      for (let y = Math.floor(b.minY); y <= Math.floor(b.maxY); y++) {
        for (let z = Math.floor(b.minZ); z <= Math.floor(b.maxZ); z++) {
          const id = this.dim.getBlock(x, y, z);
          if (id === BlockId.FIRE) inFire = true;
        }
      }
    }
    const g = this.box.grow(0.01);
    for (let x = Math.floor(g.minX); x <= Math.floor(g.maxX); x++) {
      for (let y = Math.floor(g.minY); y <= Math.floor(g.maxY); y++) {
        for (let z = Math.floor(g.minZ); z <= Math.floor(g.maxZ); z++) {
          if (this.dim.getBlock(x, y, z) === BlockId.CACTUS) {
            const cb = { minX: x + 0.0625, maxX: x + 0.9375, minZ: z + 0.0625, maxZ: z + 0.9375 };
            if (g.maxX > cb.minX && g.minX < cb.maxX && g.maxZ > cb.minZ && g.minZ < cb.maxZ) cactus = true;
          }
        }
      }
    }
    if (inFire) {
      this.damage(ctx, 1, DAMAGE.fire);
      if (this.fireTicks < 160) this.setFire(8);
    }
    if (cactus) this.damage(ctx, 1, DAMAGE.cactus);
    // Suffocation.
    if (this.isInsideOpaque()) this.damage(ctx, 1, DAMAGE.suffocation);
    // Drowning.
    if (!this.canBreatheUnderwater && this.isEyeInWater()) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(ctx, 2, DAMAGE.drown);
        ctx.particles('bubble', this.dim, this.x, this.y + this.eyeHeight, this.z, 6);
      }
    } else {
      this.air = 300;
    }
  }

  protected tickEffects(ctx: GameContext): void {
    for (const [id, e] of Array.from(this.effects)) {
      if (id === Effect.REGENERATION) {
        const period = 25 >> e.amplifier;
        if (period <= 0 || e.duration % period === 0) this.heal(1);
      } else if (id === Effect.POISON) {
        const period = 25 >> e.amplifier;
        if ((period <= 0 || e.duration % period === 0) && this.health > 1) this.damageRaw(1, DAMAGE.magic);
      }
      e.duration--;
      if (e.duration <= 0) this.effects.delete(id);
    }
    if (this.effects.size > 0 && this.age % 5 === 0) {
      ctx.particles('spell', this.dim, this.x, this.y + this.height * 0.6, this.z, 1);
    }
  }

  override serialize(): EntityData {
    return {
      ...super.serialize(),
      health: this.health,
      air: this.air,
      effects: Array.from(this.effects.values()).map((e) => ({ ...e })),
    };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    if (typeof d.health === 'number') this.health = d.health;
    if (typeof d.air === 'number') this.air = d.air;
    this.effects.clear();
    for (const e of (d.effects as ActiveEffect[] | undefined) ?? []) this.effects.set(e.id, { ...e });
  }
}

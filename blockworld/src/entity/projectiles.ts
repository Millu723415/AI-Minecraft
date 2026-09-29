/** Arrows, thrown items, Eyes of Ender and fireballs. */

import { AABB } from '../core/aabb';
import { BlockId } from '../blocks/ids';
import { ItemId } from '../items/ids';
import { createStack } from '../items/stack';
import { POTION_EXTENDED, POTION_LEVEL2, PotionKind } from '../items/registry';
import type { GameContext } from '../game/context';
import { raycastBlocks, type BlockHit } from '../world/raycast';
import { Entity, type EntityData } from './entity';
import { LivingEntity } from './living';
import { Effect } from './effects';
import type { Player } from './player';

/** Common ray-swept collision for fast projectiles. */
function sweep(e: Entity, ctx: GameContext, shooter: Entity | null, grow = 0.3): { block: BlockHit | null; entity: Entity | null } {
  const len = Math.sqrt(e.motionX ** 2 + e.motionY ** 2 + e.motionZ ** 2);
  if (len < 1e-6) return { block: null, entity: null };
  const dx = e.motionX / len; const dy = e.motionY / len; const dz = e.motionZ / len;
  const block = raycastBlocks(e.dim, e.x, e.y, e.z, dx, dy, dz, len, false);
  const maxT = block ? block.distance : len;
  let hitEntity: Entity | null = null;
  let best = maxT;
  for (const other of ctx.entitiesIn(e.dim)) {
    if (other === e || other.removed || !other.canBeHit()) continue;
    if (other === shooter && e.age < 5) continue;
    for (const hb of other.hitBoxes()) {
      const h = hb.grow(grow).raycast(e.x, e.y, e.z, dx, dy, dz, best);
      if (h && h.t <= best) {
        best = h.t;
        hitEntity = other;
      }
    }
  }
  return { block: hitEntity ? null : block, entity: hitEntity };
}

export class Arrow extends Entity {
  readonly type = 'arrow';
  shooter: Entity | null = null;
  damageBase = 2;
  critical = false;
  inGround = false;
  groundTicks = 0;
  pickupable = false;
  knockbackStrength = 0;
  onFire = false;
  shake = 0;

  constructor() {
    super();
    this.width = 0.5;
    this.height = 0.5;
  }

  override get eyeHeight(): number {
    return 0;
  }

  /** Aim along a direction with speed and inaccuracy (classic setArrowHeading). */
  shoot(dx: number, dy: number, dz: number, speed: number, inaccuracy: number): void {
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    dx = dx / len + (Math.random() - 0.5) * 0.015 * inaccuracy;
    dy = dy / len + (Math.random() - 0.5) * 0.015 * inaccuracy;
    dz = dz / len + (Math.random() - 0.5) * 0.015 * inaccuracy;
    this.motionX = dx * speed;
    this.motionY = dy * speed;
    this.motionZ = dz * speed;
    this.updateRotation();
  }

  private updateRotation(): void {
    const h = Math.sqrt(this.motionX ** 2 + this.motionZ ** 2);
    this.yaw = Math.atan2(-this.motionX, -this.motionZ);
    this.pitch = Math.atan2(this.motionY, h);
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    if (this.shake > 0) this.shake--;
    if (this.inGround) {
      this.groundTicks++;
      const bx = Math.floor(this.x); const by = Math.floor(this.y); const bz = Math.floor(this.z);
      if (this.dim.getBlock(bx, by, bz) === 0) {
        this.inGround = false;
        this.motionX *= Math.random() * 0.2; this.motionY *= Math.random() * 0.2; this.motionZ *= Math.random() * 0.2;
      }
      if (this.groundTicks >= 1200) this.removed = true;
      return;
    }
    const { block, entity } = sweep(this, ctx, this.shooter);
    if (entity) {
      const speed = Math.sqrt(this.motionX ** 2 + this.motionY ** 2 + this.motionZ ** 2);
      let dmg = Math.ceil(speed * this.damageBase);
      if (this.critical) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
      const hit = entity.damage(ctx, dmg, { type: 'arrow', attacker: this.shooter, projectile: this });
      if (hit) {
        if (this.onFire) entity.setFire(5);
        if (entity instanceof LivingEntity && this.knockbackStrength > 0) {
          const h = Math.sqrt(this.motionX ** 2 + this.motionZ ** 2) || 1;
          entity.motionX += (this.motionX * this.knockbackStrength * 0.6) / h;
          entity.motionY += 0.1;
          entity.motionZ += (this.motionZ * this.knockbackStrength * 0.6) / h;
        }
        ctx.playSound('arrow.hit', this.x, this.y, this.z, 1, 1.2);
        this.removed = true;
      } else {
        this.motionX *= -0.1; this.motionY *= -0.1; this.motionZ *= -0.1;
        this.yaw += Math.PI;
      }
    } else if (block) {
      this.x = block.px - this.motionX * 0.05;
      this.y = block.py - this.motionY * 0.05;
      this.z = block.pz - this.motionZ * 0.05;
      this.inGround = true;
      this.shake = 7;
      this.critical = false;
      ctx.playSound('arrow.hit', this.x, this.y, this.z, 1, 1.2);
      // Stick slightly inside the block.
      this.x += this.motionX * 0.05 / Math.max(0.01, Math.abs(this.motionX) + Math.abs(this.motionY) + Math.abs(this.motionZ));
      if (block.id === BlockId.TNT && this.onFire) {
        ctx.explode(this.dim, block.x + 0.5, block.y + 0.5, block.z + 0.5, 0, false, null, false);
      }
      return;
    }
    if (!this.inGround) {
      this.x += this.motionX; this.y += this.motionY; this.z += this.motionZ;
      this.updateRotation();
      this.updateEnvironment();
      const drag = this.inWater ? 0.8 : 0.99;
      if (this.inWater) ctx.particles('bubble', this.dim, this.x, this.y, this.z, 2);
      this.motionX *= drag; this.motionY *= drag; this.motionZ *= drag;
      this.motionY -= 0.05;
      if (this.critical && this.age % 2 === 0) ctx.particles('crit', this.dim, this.x, this.y, this.z, 1);
    }
    if (this.y < -64 || this.age > 1200) this.removed = true;
  }

  /** Player walks over a stuck arrow. */
  tryPickup(player: Player, ctx: GameContext): boolean {
    if (!this.inGround || !this.pickupable || this.shake > 0) return false;
    const left = player.inventory.addItem(createStack(ItemId.ARROW, 1));
    if (left) return false;
    ctx.playSound('random.pop', this.x, this.y, this.z, 0.2, 1.5);
    this.removed = true;
    return true;
  }

  override serialize(): EntityData {
    return { ...super.serialize(), inGround: this.inGround, pick: this.pickupable, ticks: this.groundTicks };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.inGround = !!d.inGround;
    this.pickupable = !!d.pick;
    this.groundTicks = (d.ticks as number) ?? 0;
  }
}

/** Snowballs, eggs, ender pearls and splash potions. */
export class Throwable extends Entity {
  readonly type = 'throwable';
  kind: 'snowball' | 'egg' | 'ender_pearl' | 'potion';
  potionMeta = 0;
  thrower: Entity | null = null;

  constructor(kind: Throwable['kind']) {
    super();
    this.kind = kind;
    this.width = 0.25;
    this.height = 0.25;
    this.persistent = false;
  }

  throwFrom(e: LivingEntity, speed = 1.5, pitchOffset = 0): void {
    this.thrower = e;
    const [lx, ly, lz] = e.lookVector();
    this.setPosition(e.x + lx * 0.3, e.y + e.eyeHeight - 0.1, e.z + lz * 0.3);
    const pitch = Math.asin(ly) + pitchOffset;
    const cp = Math.cos(pitch);
    this.motionX = -Math.sin(e.yaw) * cp * speed + (Math.random() - 0.5) * 0.01;
    this.motionY = Math.sin(pitch) * speed;
    this.motionZ = -Math.cos(e.yaw) * cp * speed + (Math.random() - 0.5) * 0.01;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    const { block, entity } = sweep(this, ctx, this.thrower, 0.3);
    if (block || entity) {
      if (block) { this.x = block.px; this.y = block.py; this.z = block.pz; }
      this.impact(ctx, entity, block);
      this.removed = true;
      return;
    }
    this.x += this.motionX; this.y += this.motionY; this.z += this.motionZ;
    this.updateEnvironment();
    const drag = this.inWater ? 0.8 : 0.99;
    this.motionX *= drag; this.motionY *= drag; this.motionZ *= drag;
    this.motionY -= this.kind === 'potion' ? 0.05 : 0.03;
    if (this.kind === 'ender_pearl' && this.age % 2 === 0) ctx.particles('portal', this.dim, this.x, this.y, this.z, 1);
    if (this.y < -64 || this.age > 600) this.removed = true;
  }

  private impact(ctx: GameContext, entity: Entity | null, block: BlockHit | null): void {
    switch (this.kind) {
      case 'snowball':
        if (entity) entity.damage(ctx, entity.type === 'blaze' ? 3 : 0, { type: 'arrow', attacker: this.thrower, projectile: this });
        ctx.particles('snowball', this.dim, this.x, this.y, this.z, 8);
        break;
      case 'egg':
        if (entity) entity.damage(ctx, 0, { type: 'arrow', attacker: this.thrower, projectile: this });
        ctx.particles('snowball', this.dim, this.x, this.y, this.z, 8);
        if (Math.random() < 0.125) {
          const count = Math.random() < 1 / 32 ? 4 : 1;
          for (let i = 0; i < count; i++) ctx.world && (ctx as unknown as { spawnMobByName(n: string, d: unknown, x: number, y: number, z: number, baby: boolean): void }).spawnMobByName?.('chicken', this.dim, this.x, this.y, this.z, true);
        }
        break;
      case 'ender_pearl': {
        ctx.particles('portal', this.dim, this.x, this.y, this.z, 32);
        const t = this.thrower;
        if (t && t.dim === this.dim && t instanceof LivingEntity && !t.dead) {
          let ty = this.y;
          if (block && block.face === 3) ty -= t.height;
          t.setPosition(this.x, ty, this.z);
          t.fallDistance = 0;
          t.damage(ctx, 5, { type: 'fall', bypassArmor: true });
          ctx.playSound('mob.endermen.portal', this.x, this.y, this.z, 1, 1);
        }
        break;
      }
      case 'potion':
        splashPotion(ctx, this, this.potionMeta, entity);
        break;
    }
  }

  override serialize(): EntityData {
    return { ...super.serialize(), kind: this.kind, potion: this.potionMeta };
  }
}

/** Effects of a potion by kind (duration ticks, amplifier). */
export function potionEffects(meta: number): { id: number; duration: number; amplifier: number }[] {
  const kind = meta & 15;
  const lvl2 = (meta & POTION_LEVEL2) !== 0;
  const ext = (meta & POTION_EXTENDED) !== 0;
  const dur = (base: number) => Math.floor(base * (ext ? 8 / 3 : 1) * (lvl2 ? 0.5 : 1));
  const amp = lvl2 ? 1 : 0;
  switch (kind) {
    case PotionKind.REGENERATION: return [{ id: Effect.REGENERATION, duration: dur(900), amplifier: amp }];
    case PotionKind.SWIFTNESS: return [{ id: Effect.SPEED, duration: dur(3600), amplifier: amp }];
    case PotionKind.FIRE_RESISTANCE: return [{ id: Effect.FIRE_RESISTANCE, duration: dur(3600), amplifier: 0 }];
    case PotionKind.POISON: return [{ id: Effect.POISON, duration: dur(900), amplifier: amp }];
    case PotionKind.HEALING: return [{ id: Effect.INSTANT_HEALTH, duration: 1, amplifier: amp }];
    case PotionKind.WEAKNESS: return [{ id: Effect.WEAKNESS, duration: dur(1800), amplifier: 0 }];
    case PotionKind.STRENGTH: return [{ id: Effect.STRENGTH, duration: dur(3600), amplifier: amp }];
    case PotionKind.SLOWNESS: return [{ id: Effect.SLOWNESS, duration: dur(1800), amplifier: 0 }];
    case PotionKind.HARMING: return [{ id: Effect.INSTANT_DAMAGE, duration: 1, amplifier: amp }];
    default: return [];
  }
}

function splashPotion(ctx: GameContext, e: Entity, meta: number, direct: Entity | null): void {
  ctx.playSound('random.glass', e.x, e.y, e.z, 1, 1);
  ctx.particles('potion', e.dim, e.x, e.y, e.z, 30, { color: [0.5, 0.3, 0.8] });
  const effects = potionEffects(meta);
  const area = new AABB(e.x - 4, e.y - 2, e.z - 4, e.x + 4, e.y + 2, e.z + 4);
  for (const other of ctx.entitiesIn(e.dim)) {
    if (!(other instanceof LivingEntity) || other.dead) continue;
    if (!area.intersects(other.box)) continue;
    const d = Math.sqrt(other.distanceSqTo(e.x, e.y, e.z));
    if (d >= 4) continue;
    let scale = 1 - d / 4;
    if (other === direct) scale = 1;
    for (const eff of effects) {
      const duration = Math.floor(eff.duration * scale);
      if (eff.id === Effect.INSTANT_HEALTH || eff.id === Effect.INSTANT_DAMAGE) {
        other.addEffect({ id: eff.id, duration: 1, amplifier: eff.amplifier });
      } else if (duration > 20) {
        other.addEffect({ id: eff.id, duration, amplifier: eff.amplifier });
      }
    }
  }
}

/** The floating Eye of Ender that points toward the nearest stronghold. */
export class EyeOfEnderSignal extends Entity {
  readonly type = 'eye_signal';
  targetX = 0;
  targetY = 0;
  targetZ = 0;
  lifetime = 0;
  shatter = false;

  constructor() {
    super();
    this.width = 0.25;
    this.height = 0.25;
    this.persistent = false;
  }

  /** Aim at a stronghold: fly up to 12 blocks toward it, rising above the ground. */
  moveTowards(tx: number, tz: number, fromY: number): void {
    const dx = tx - this.x;
    const dz = tz - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d > 12) {
      this.targetX = this.x + (dx / d) * 12;
      this.targetZ = this.z + (dz / d) * 12;
      this.targetY = fromY + 8;
    } else {
      this.targetX = tx;
      this.targetZ = tz;
      this.targetY = fromY;
    }
    this.shatter = Math.random() < 0.2;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.lifetime++;
    const dx = this.targetX - this.x;
    const dz = this.targetZ - this.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    const ang = Math.atan2(dz, dx);
    let speed = Math.sqrt(this.motionX ** 2 + this.motionZ ** 2);
    speed += (h - speed) * 0.0025;
    if (h < 1) {
      speed *= 0.8;
      this.motionY *= 0.8;
    }
    this.motionX = Math.cos(ang) * speed;
    this.motionZ = Math.sin(ang) * speed;
    if (this.y < this.targetY) this.motionY += (1 - this.motionY) * 0.015;
    else this.motionY += (-1 - this.motionY) * 0.015;
    this.x += this.motionX; this.y += this.motionY; this.z += this.motionZ;
    ctx.particles('portal', this.dim, this.x, this.y, this.z, 2);
    if (this.lifetime > 80) {
      this.removed = true;
      if (this.shatter) {
        ctx.playSound('random.glass', this.x, this.y, this.z, 1, 1);
        ctx.particles('potion', this.dim, this.x, this.y, this.z, 16, { color: [0.2, 0.8, 0.6] });
      } else {
        ctx.dropStack(this.dim, this.x, this.y, this.z, createStack(ItemId.EYE_OF_ENDER, 1), 10, false);
      }
    }
  }
}

/** Ghast fireball (explosive) and blaze fireball (small, sets fire). */
export class Fireball extends Entity {
  readonly type = 'fireball';
  shooter: Entity | null = null;
  accelX = 0; accelY = 0; accelZ = 0;
  small: boolean;
  deflected = false;

  constructor(small: boolean) {
    super();
    this.small = small;
    this.width = small ? 0.3125 : 1;
    this.height = small ? 0.3125 : 1;
    this.fireImmune = true;
    this.persistent = false;
  }

  aim(dx: number, dy: number, dz: number, spread = 0): void {
    dx += (Math.random() - 0.5) * spread;
    dy += (Math.random() - 0.5) * spread;
    dz += (Math.random() - 0.5) * spread;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
    this.accelX = (dx / d) * 0.1;
    this.accelY = (dy / d) * 0.1;
    this.accelZ = (dz / d) * 0.1;
  }

  override get eyeHeight(): number {
    return this.height / 2;
  }

  override canBeHit(): boolean {
    return !this.small;
  }

  /** Punching a ghast fireball sends it back. */
  override damage(_ctx: GameContext, _amount: number, source: import('./damage').DamageSource): boolean {
    if (!source.attacker || this.small) return false;
    const a = source.attacker;
    const [lx, ly, lz] = a.lookVector();
    this.motionX = lx; this.motionY = ly; this.motionZ = lz;
    this.accelX = lx * 0.1; this.accelY = ly * 0.1; this.accelZ = lz * 0.1;
    this.shooter = a;
    this.deflected = true;
    return true;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    const center = new Entity0(this);
    const { block, entity } = sweep(center, ctx, this.shooter, 0.3);
    if (block || entity) {
      if (entity) {
        entity.damage(ctx, this.small ? 5 : 6, { type: 'fireball', attacker: this.shooter, projectile: this, isFire: true });
        if (this.small) entity.setFire(5);
      }
      if (this.small) {
        if (block) {
          const fx = block.x + [1, -1, 0, 0, 0, 0][block.face];
          const fy = block.y + [0, 0, 1, -1, 0, 0][block.face];
          const fz = block.z + [0, 0, 0, 0, 1, -1][block.face];
          if (this.dim.getBlock(fx, fy, fz) === 0) this.dim.setBlock(fx, fy, fz, BlockId.FIRE, 0);
        }
      } else {
        ctx.explode(this.dim, this.x, this.y + this.height / 2, this.z, 1, true, this, true);
      }
      this.removed = true;
      return;
    }
    this.x += this.motionX; this.y += this.motionY; this.z += this.motionZ;
    this.motionX += this.accelX; this.motionY += this.accelY; this.motionZ += this.accelZ;
    this.motionX *= 0.95; this.motionY *= 0.95; this.motionZ *= 0.95;
    ctx.particles('smoke', this.dim, this.x, this.y + this.height / 2, this.z, 1);
    if (this.age > 200) this.removed = true;
  }
}

/** Adapter so sweep() can test from the fireball centre. */
class Entity0 extends Entity {
  readonly type = 'probe';
  constructor(src: Entity) {
    super();
    this.dim = src.dim;
    this.x = src.x; this.y = src.y + src.height / 2; this.z = src.z;
    this.motionX = src.motionX; this.motionY = src.motionY; this.motionZ = src.motionZ;
    this.age = src.age;
  }
  tick(): void {}
}

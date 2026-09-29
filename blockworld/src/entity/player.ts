/** The player: survival stats, inventory, experience and movement input. */

import { BlockId } from '../blocks/ids';
import { getItem } from '../items/registry';
import { PlayerInventory } from '../items/container';
import { hasEnchant, type ItemStack } from '../items/stack';
import type { GameContext } from '../game/context';
import { DAMAGE, type DamageSource } from './damage';
import { Effect } from './effects';
import type { EntityData } from './entity';
import { LivingEntity } from './living';
import { Enchantment } from '../items/enchantments';
import type { DimId } from '../world/constants';
import { SLAB_TOP } from '../blocks/meta';

export interface PlayerInput {
  forward: number;
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export interface SpawnPoint { x: number; y: number; z: number; dim: DimId }

/** Experience required to go from `level` to `level + 1` (release-era formula). */
export function xpBarCap(level: number): number {
  return 7 + ((level * 7) >> 1);
}

export class Player extends LivingEntity {
  readonly type = 'player';
  override displayName = 'Player';
  readonly inventory = new PlayerInventory();
  foodLevel = 20;
  saturation = 5;
  exhaustion = 0;
  private foodTimer = 0;
  xpLevel = 0;
  xpProgress = 0;
  xpTotal = 0;
  bedSpawn: SpawnPoint | null = null;
  creative = false;
  flying = false;
  input: PlayerInput = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
  /** Ticks spent standing in a nether portal. */
  portalTime = 0;
  inPortal = false;
  /** Sleeping in a bed at this position. */
  sleeping: { x: number; y: number; z: number } | null = null;
  sleepTimer = 0;
  /** Camera shake after taking damage. */
  hurtShake = 0;
  /** Bow draw progress in ticks while using. */
  itemUseTicks = 0;
  usingItem = false;
  /** Count of consecutive ticks eating. */
  eatTicks = 0;
  score = 0;

  constructor() {
    super();
    this.width = 0.6;
    this.height = 1.8;
    this.moveSpeed = 0.1;
    this.persistent = false;
  }

  override get eyeHeight(): number {
    return this.sneaking ? 1.54 : 1.62;
  }

  protected override preventEdgeFall(): boolean {
    return this.sneaking && !this.flying;
  }

  protected override flyingMob(): boolean {
    return this.flying;
  }

  override armorValue(): number {
    let total = 0;
    for (const s of this.inventory.armor.slots) if (s) total += getItem(s.id)?.armorPoints ?? 0;
    return total;
  }

  protected override damageArmor(amount: number): void {
    const wear = Math.max(1, Math.floor(amount / 4));
    for (let i = 0; i < 4; i++) {
      const s = this.inventory.armor.slots[i];
      if (!s) continue;
      const def = getItem(s.id);
      if (!def || def.durability <= 0) continue;
      const unbreaking = hasEnchant(s, Enchantment.UNBREAKING);
      if (unbreaking > 0 && Math.random() < 1 - 1 / (unbreaking + 1)) continue;
      s.damage += wear;
      if (s.damage >= def.durability) this.inventory.armor.slots[i] = null;
    }
    this.inventory.armor.changed();
  }

  protected override modifyDamage(amount: number, source: DamageSource): number {
    // Protection enchantments (simplified classic formula).
    let epf = 0;
    for (const s of this.inventory.armor.slots) {
      if (!s) continue;
      epf += hasEnchant(s, Enchantment.PROTECTION);
      if (source.isFire) epf += hasEnchant(s, Enchantment.FIRE_PROTECTION) * 2;
      if (source.type === 'fall') epf += hasEnchant(s, Enchantment.FEATHER_FALLING) * 3;
      if (source.isExplosion) epf += hasEnchant(s, Enchantment.BLAST_PROTECTION) * 2;
      if (source.type === 'arrow') epf += hasEnchant(s, Enchantment.PROJECTILE_PROTECTION) * 2;
    }
    epf = Math.min(20, epf);
    if (epf > 0) amount = amount * (1 - epf / 25);
    return amount;
  }

  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    if (this.creative && source.type !== 'void') return false;
    if (ctx.difficulty === 0 && (source.type === 'mob' || source.type === 'arrow')) return false;
    if (source.type === 'mob' || source.type === 'arrow' || source.type === 'fireball') {
      // Mob damage scales with difficulty.
      if (ctx.difficulty === 1) amount = amount / 2 + 1;
      if (ctx.difficulty === 3) amount = (amount * 3) / 2;
    }
    if (this.sleeping) this.wakeUp();
    const ok = super.damage(ctx, amount, source);
    if (ok) {
      this.exhaust(0.3);
      this.hurtShake = 10;
      ctx.playSound('player.hurt', this.x, this.y, this.z, 1, 1);
    }
    return ok;
  }

  exhaust(amount: number): void {
    if (this.creative) return;
    this.exhaustion = Math.min(40, this.exhaustion + amount);
  }

  addXp(amount: number): void {
    this.score += amount;
    this.xpTotal += amount;
    this.xpProgress += amount / xpBarCap(this.xpLevel);
    while (this.xpProgress >= 1) {
      this.xpProgress = (this.xpProgress - 1) * xpBarCap(this.xpLevel);
      this.xpLevel++;
      this.xpProgress /= xpBarCap(this.xpLevel);
    }
  }

  removeLevels(levels: number): void {
    this.xpLevel = Math.max(0, this.xpLevel - levels);
    this.xpProgress = 0;
  }

  canEat(alwaysEdible = false): boolean {
    return this.creative || alwaysEdible || this.foodLevel < 20;
  }

  eat(hunger: number, saturation: number): void {
    this.foodLevel = Math.min(20, this.foodLevel + hunger);
    this.saturation = Math.min(this.foodLevel, this.saturation + saturation);
  }

  wakeUp(): void {
    this.sleeping = null;
    this.sleepTimer = 0;
  }

  protected aiStep(_ctx: GameContext): void {
    if (this.sleeping) {
      this.moveForward = 0; this.moveStrafe = 0; this.jumping = false;
      return;
    }
    const inp = this.input;
    this.moveForward = inp.forward;
    this.moveStrafe = inp.strafe;
    this.sneaking = inp.sneak && !this.flying;
    this.jumping = inp.jump;
    const canSprint = (this.foodLevel > 6 || this.creative) && inp.forward > 0.8 && !this.sneaking && !this.usingItem;
    if (inp.sprint && canSprint) this.sprinting = true;
    if (!canSprint || this.collidedH) this.sprinting = false;
    if (this.flying) {
      this.motionY = 0;
      if (inp.jump) this.motionY = 0.35;
      if (inp.sneak) this.motionY = -0.35;
    }
    if (this.usingItem) {
      this.moveForward *= 0.2;
      this.moveStrafe *= 0.2;
    }
  }

  override travel(strafe: number, forward: number): void {
    if (this.flying) {
      const speed = this.sprinting ? 0.1 : 0.05;
      this.moveRelative(strafe, forward, speed);
      this.move(this.motionX, this.motionY, this.motionZ);
      this.motionX *= 0.91; this.motionZ *= 0.91;
      this.motionY *= 0.6;
      this.fallDistance = 0;
      return;
    }
    super.travel(strafe, forward);
  }

  tick(ctx: GameContext): void {
    if (this.hurtShake > 0) this.hurtShake--;
    const x0 = this.x; const y0 = this.y; const z0 = this.z;
    const wasOnGround = this.onGround;
    this.livingTick(ctx);
    if (this.dead) return;
    if (this.onGround && this.flying && !this.creative) this.flying = false;
    // Hunger from movement.
    const dist = Math.sqrt((this.x - x0) ** 2 + (this.z - z0) ** 2);
    if (this.inWater) this.exhaust(0.015 * dist);
    else if (this.sprinting) this.exhaust(0.1 * dist);
    else this.exhaust(0.01 * dist);
    if (wasOnGround && !this.onGround && this.y > y0 && this.jumping) this.exhaust(this.sprinting ? 0.8 : 0.2);
    this.tickFood(ctx);
  }

  private tickFood(ctx: GameContext): void {
    if (this.creative) {
      this.foodLevel = 20;
      return;
    }
    const hunger = this.effects.get(Effect.HUNGER);
    if (hunger) this.exhaust(0.025 * (hunger.amplifier + 1));
    if (this.exhaustion > 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (ctx.difficulty > 0) this.foodLevel = Math.max(0, this.foodLevel - 1);
    }
    this.foodTimer++;
    if (ctx.difficulty === 0 && this.foodTimer % 20 === 0 && this.health < this.maxHealth) this.heal(1);
    if (this.foodTimer >= 80) {
      this.foodTimer = 0;
      if (this.foodLevel >= 18 && this.health < this.maxHealth) {
        this.heal(1);
        this.exhaust(3);
      } else if (this.foodLevel <= 0) {
        const floor = ctx.difficulty === 1 ? 10 : ctx.difficulty === 2 ? 1 : 0;
        if (this.health > floor || ctx.difficulty === 3) this.damage(ctx, 1, DAMAGE.starve);
      }
    }
  }

  /** Mining speed multiplier for the held tool against a block. */
  heldItem(): ItemStack | null {
    return this.inventory.held;
  }

  /** Is the player standing inside a bed/slab etc (unused hook). */
  isOnTopSlab(): boolean {
    const id = this.dim.getBlock(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z));
    return id === BlockId.SLAB && (this.dim.getMeta(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z)) & SLAB_TOP) === 0;
  }

  override serialize(): EntityData {
    return {
      ...super.serialize(),
      inventory: this.inventory.toJSON(),
      armor: this.inventory.armor.toJSON(),
      selected: this.inventory.selected,
      food: this.foodLevel,
      saturation: this.saturation,
      exhaustion: this.exhaustion,
      xpLevel: this.xpLevel,
      xpProgress: this.xpProgress,
      xpTotal: this.xpTotal,
      bedSpawn: this.bedSpawn,
      flying: this.flying,
      score: this.score,
    };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.inventory.load(d.inventory as (ItemStack | null)[]);
    this.inventory.armor.load(d.armor as (ItemStack | null)[]);
    this.inventory.selected = (d.selected as number) ?? 0;
    this.foodLevel = (d.food as number) ?? 20;
    this.saturation = (d.saturation as number) ?? 5;
    this.exhaustion = (d.exhaustion as number) ?? 0;
    this.xpLevel = (d.xpLevel as number) ?? 0;
    this.xpProgress = (d.xpProgress as number) ?? 0;
    this.xpTotal = (d.xpTotal as number) ?? 0;
    this.bedSpawn = (d.bedSpawn as SpawnPoint | null) ?? null;
    this.flying = !!d.flying;
    this.score = (d.score as number) ?? 0;
  }
}

/** Dropped items, experience orbs, falling blocks and primed TNT. */

import { BlockId } from '../blocks/ids';
import { getBlock, IS_FLUID, REPLACEABLE } from '../blocks/registry';
import { canMerge, cloneStack, maxStackSize, type ItemStack } from '../items/stack';
import type { GameContext } from '../game/context';
import { Entity, type EntityData } from './entity';
import type { DamageSource } from './damage';

export class ItemEntity extends Entity {
  readonly type = 'item';
  stack: ItemStack;
  pickupDelay = 10;
  health = 5;
  /** Random phase for the bobbing animation. */
  readonly bobOffset = Math.random() * Math.PI * 2;

  constructor(stack: ItemStack) {
    super();
    this.stack = cloneStack(stack)!;
    this.width = 0.25;
    this.height = 0.25;
  }

  override get eyeHeight(): number {
    return this.height / 2;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.updateEnvironment();
    if (this.inLava) {
      this.motionY = 0.2;
      this.motionX = (Math.random() - 0.5) * 0.2;
      this.motionZ = (Math.random() - 0.5) * 0.2;
      ctx.playSound('fire.fizz', this.x, this.y, this.z, 0.4, 2);
      this.removed = true;
      return;
    }
    if (this.inWater) {
      this.motionY += 0.01;
      this.motionX *= 0.95; this.motionZ *= 0.95;
    } else {
      this.motionY -= 0.04;
    }
    // Push out of solid blocks.
    if (this.isInsideOpaque()) this.motionY = 0.2;
    this.move(this.motionX, this.motionY, this.motionZ);
    let friction = 0.98;
    if (this.onGround) friction = this.groundSlipperiness() * 0.98;
    this.motionX *= friction;
    this.motionY *= 0.98;
    this.motionZ *= friction;
    if (this.onGround) this.motionY *= -0.5;
    if (this.fireTicks > 0) {
      this.fireTicks--;
      this.health -= 0.05;
    }
    if (this.age % 20 === 0) this.tryMerge(ctx);
    if (this.age >= 6000 || this.health <= 0) this.removed = true;
  }

  private tryMerge(ctx: GameContext): void {
    for (const e of ctx.entitiesIn(this.dim)) {
      if (e === this || !(e instanceof ItemEntity) || e.removed) continue;
      if (Math.abs(e.x - this.x) > 0.6 || Math.abs(e.y - this.y) > 0.3 || Math.abs(e.z - this.z) > 0.6) continue;
      if (!canMerge(e.stack, this.stack)) continue;
      const max = maxStackSize(this.stack);
      if (e.stack.count + this.stack.count > max) continue;
      this.stack.count += e.stack.count;
      this.pickupDelay = Math.max(this.pickupDelay, e.pickupDelay);
      this.age = Math.min(this.age, e.age);
      e.removed = true;
    }
  }

  override damage(_ctx: GameContext, amount: number, source: DamageSource): boolean {
    if (source.isExplosion || source.isFire) {
      this.health -= amount;
      if (this.health <= 0) this.removed = true;
      return true;
    }
    return false;
  }

  override serialize(): EntityData {
    return { ...super.serialize(), stack: this.stack, age: this.age, pickup: this.pickupDelay };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.stack = d.stack as ItemStack;
    this.age = (d.age as number) ?? 0;
    this.pickupDelay = (d.pickup as number) ?? 0;
  }
}

export class XpOrb extends Entity {
  readonly type = 'xp';
  value: number;
  health = 5;
  target: Entity | null = null;

  constructor(value: number) {
    super();
    this.value = value;
    this.width = 0.5;
    this.height = 0.5;
  }

  /** Visual size class 0..10 from the value (bigger orbs for more XP). */
  get sizeClass(): number {
    const v = this.value;
    return v >= 2477 ? 10 : v >= 1237 ? 9 : v >= 617 ? 8 : v >= 307 ? 7 : v >= 149 ? 6 : v >= 73 ? 5 : v >= 37 ? 4 : v >= 17 ? 3 : v >= 7 ? 2 : v >= 3 ? 1 : 0;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    this.updateEnvironment();
    this.motionY -= 0.03;
    if (this.inLava) {
      this.motionY = 0.2;
      this.removed = true;
      return;
    }
    const p = ctx.player;
    if (!p.dead && p.dim === this.dim) {
      const dx = p.x - this.x; const dy = p.y + p.eyeHeight / 2 - this.y; const dz = p.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) / 8;
      if (d < 1) {
        const pull = (1 - d) * (1 - d);
        this.motionX += (dx / d / 8) * pull * 0.1 / 8;
        this.motionY += (dy / d / 8) * pull * 0.1 / 8;
        this.motionZ += (dz / d / 8) * pull * 0.1 / 8;
      }
    }
    this.move(this.motionX, this.motionY, this.motionZ);
    let friction = 0.98;
    if (this.onGround) friction = this.groundSlipperiness() * 0.98;
    this.motionX *= friction; this.motionY *= 0.98; this.motionZ *= friction;
    if (this.onGround) this.motionY *= -0.9;
    if (this.age >= 6000) this.removed = true;
  }

  override serialize(): EntityData {
    return { ...super.serialize(), value: this.value, age: this.age };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.value = (d.value as number) ?? 1;
    this.age = (d.age as number) ?? 0;
  }
}

/** Split an XP amount into orb values like the classic game. */
export function splitXp(amount: number): number[] {
  const out: number[] = [];
  const sizes = [2477, 1237, 617, 307, 149, 73, 37, 17, 7, 3, 1];
  let left = Math.floor(amount);
  while (left > 0) {
    const v = sizes.find((s) => s <= left) ?? 1;
    out.push(v);
    left -= v;
  }
  return out;
}

export class FallingBlock extends Entity {
  readonly type = 'falling_block';
  blockId: number;
  blockMeta: number;

  constructor(blockId: number, blockMeta: number) {
    super();
    this.blockId = blockId;
    this.blockMeta = blockMeta;
    this.width = 0.98;
    this.height = 0.98;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    this.motionY -= 0.04;
    this.move(this.motionX, this.motionY, this.motionZ);
    this.motionX *= 0.98; this.motionY *= 0.98; this.motionZ *= 0.98;
    const bx = Math.floor(this.x); const by = Math.floor(this.y + 0.01); const bz = Math.floor(this.z);
    if (this.age === 1 && this.dim.getBlock(bx, by, bz) === this.blockId) this.dim.setBlock(bx, by, bz, 0, 0);
    if (this.onGround) {
      this.removed = true;
      const cur = this.dim.getBlock(bx, by, bz);
      if (cur === 0 || REPLACEABLE[cur] || IS_FLUID[cur]) {
        this.dim.setBlock(bx, by, bz, this.blockId, this.blockMeta);
      } else {
        ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, { id: getBlock(this.blockId).itemId, count: 1, meta: 0, damage: 0 });
      }
    } else if (this.age > 600 || this.y < -10) {
      this.removed = true;
    }
  }

  override serialize(): EntityData {
    return { ...super.serialize(), block: this.blockId, bmeta: this.blockMeta, age: this.age };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.blockId = (d.block as number) ?? BlockId.SAND;
    this.blockMeta = (d.bmeta as number) ?? 0;
  }
}

export class PrimedTnt extends Entity {
  readonly type = 'tnt';
  fuse = 80;

  constructor() {
    super();
    this.width = 0.98;
    this.height = 0.98;
    const a = Math.random() * Math.PI * 2;
    this.motionX = -Math.sin(a) * 0.02;
    this.motionY = 0.2;
    this.motionZ = -Math.cos(a) * 0.02;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.motionY -= 0.04;
    this.move(this.motionX, this.motionY, this.motionZ);
    this.motionX *= 0.98; this.motionY *= 0.98; this.motionZ *= 0.98;
    if (this.onGround) {
      this.motionX *= 0.7; this.motionZ *= 0.7; this.motionY *= -0.5;
    }
    if (this.fuse-- <= 0) {
      this.removed = true;
      ctx.explode(this.dim, this.x, this.y + this.height / 2, this.z, 4, false, this, true);
    } else if (this.fuse % 4 === 0) {
      ctx.particles('smoke', this.dim, this.x, this.y + 1, this.z, 1);
    }
  }

  override serialize(): EntityData {
    return { ...super.serialize(), fuse: this.fuse };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.fuse = (d.fuse as number) ?? 80;
  }
}

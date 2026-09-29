/** Fishing bobber: cast, wait for a bite, reel in a fish. */

import { IS_FLUID } from '../blocks/registry';
import { ItemId } from '../items/ids';
import { createStack } from '../items/stack';
import type { GameContext } from '../game/context';
import { Entity } from './entity';
import { ItemEntity } from './items';
import type { Player } from './player';

export class FishingHook extends Entity {
  readonly type = 'fishing_hook';
  angler: Player;
  private waitTicks = 0;
  biteTicks = 0;
  inWaterNow = false;

  constructor(angler: Player) {
    super();
    this.angler = angler;
    this.width = 0.25;
    this.height = 0.25;
    this.persistent = false;
    const [lx, ly, lz] = angler.lookVector();
    this.setPosition(angler.x + lx * 0.3, angler.y + angler.eyeHeight - 0.1, angler.z + lz * 0.3);
    this.motionX = lx * 1.1;
    this.motionY = ly * 1.1 + 0.1;
    this.motionZ = lz * 1.1;
    this.waitTicks = 100 + Math.floor(Math.random() * 500);
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    const p = this.angler;
    const held = p.inventory.held;
    if (p.dead || p.dim !== this.dim || this.distanceTo(p) > 32 || !held || held.id !== ItemId.FISHING_ROD) {
      this.removed = true;
      return;
    }
    const id = this.dim.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    this.inWaterNow = IS_FLUID[id] === 1;
    if (this.inWaterNow) {
      this.motionY += 0.04;
      this.motionX *= 0.8; this.motionZ *= 0.8; this.motionY *= 0.8;
      if (this.biteTicks > 0) {
        this.biteTicks--;
        this.motionY -= 0.2 * Math.random();
      } else if (--this.waitTicks <= 0) {
        this.biteTicks = 20 + Math.floor(Math.random() * 20);
        this.waitTicks = 100 + Math.floor(Math.random() * (ctx.world.raining ? 300 : 500));
        ctx.playSound('liquid.splash', this.x, this.y, this.z, 0.25, 1.4);
        ctx.particles('splash', this.dim, this.x, this.y + 0.2, this.z, 12, { spread: 0.3 });
        ctx.particles('bubble', this.dim, this.x, this.y, this.z, 6, { spread: 0.3 });
      }
    } else {
      this.motionY -= 0.04;
    }
    this.move(this.motionX, this.motionY, this.motionZ);
    if (!this.inWaterNow) {
      this.motionX *= 0.92; this.motionZ *= 0.92; this.motionY *= 0.98;
      if (this.onGround) { this.motionX *= 0.5; this.motionZ *= 0.5; }
    }
  }

  /** Reel in: returns durability cost. */
  retrieve(ctx: GameContext): number {
    let cost = 0;
    if (this.biteTicks > 0) {
      const fish = new ItemEntity(createStack(ItemId.RAW_FISH));
      fish.setPosition(this.x, this.y, this.z);
      const p = this.angler;
      const dx = p.x - this.x; const dy = p.y - this.y; const dz = p.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      fish.motionX = dx * 0.1;
      fish.motionY = dy * 0.1 + Math.sqrt(d) * 0.08;
      fish.motionZ = dz * 0.1;
      fish.pickupDelay = 0;
      ctx.spawn(fish, this.dim);
      ctx.dropXp(this.dim, p.x, p.y + 0.5, p.z, 1 + Math.floor(Math.random() * 6));
      cost = 1;
    } else if (this.onGround) {
      cost = 2;
    }
    this.removed = true;
    return cost;
  }
}

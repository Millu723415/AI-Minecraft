/** Boats and minecarts. */

import { BlockId } from '../blocks/ids';
import { IS_FLUID, getBlock } from '../blocks/registry';
import { ItemId } from '../items/ids';
import { createStack } from '../items/stack';
import type { GameContext } from '../game/context';
import type { DamageSource } from './damage';
import { Entity } from './entity';
import type { Player } from './player';
import { RAIL_POWERED } from '../blocks/meta';

function mount(rider: Entity, vehicle: Entity): void {
  rider.vehicle = vehicle;
  vehicle.rider = rider;
}

export function dismount(rider: Entity): void {
  const v = rider.vehicle;
  if (!v) return;
  v.rider = null;
  rider.vehicle = null;
  rider.setPosition(v.x, v.y + v.height + 0.1, v.z);
}

export class Boat extends Entity {
  readonly type = 'boat';
  override displayName = 'Boat';
  health = 40;
  hurtWobble = 0;

  constructor() {
    super();
    this.width = 1.5;
    this.height = 0.6;
  }

  override canBeHit(): boolean {
    return !this.removed;
  }

  override interact(_ctx: GameContext, player: Player): boolean {
    if (this.rider && this.rider !== player) return false;
    if (player.vehicle === this) dismount(player);
    else mount(player, this);
    return true;
  }

  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    if (!source.attacker && !source.isExplosion) return false;
    this.hurtWobble = 10;
    this.health -= amount * 10;
    if (this.health <= 0 || (source.attacker as Player | undefined)?.creative) {
      if (this.rider) dismount(this.rider);
      this.removed = true;
      if (!(source.attacker as Player | undefined)?.creative) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(ItemId.BOAT));
    }
    return true;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    if (this.hurtWobble > 0) this.hurtWobble--;
    // Buoyancy: sample water level across the hull.
    let submerged = 0;
    const b = this.box;
    for (let i = 0; i < 5; i++) {
      const y = b.minY + ((b.maxY - b.minY) * i) / 5 - 0.125;
      if (IS_FLUID[this.dim.getBlock(Math.floor(this.x), Math.floor(y), Math.floor(this.z))] === 1) submerged += 0.2;
    }
    if (submerged < 1) this.motionY += 0.04 * (submerged * 2 - 1);
    else {
      if (this.motionY < 0) this.motionY /= 2;
      this.motionY += 0.007;
    }
    const rider = this.rider as Player | null;
    if (rider && rider.type === 'player') {
      const f = rider.input.forward;
      if (f !== 0) {
        this.motionX += -Math.sin(rider.yaw) * f * 0.015;
        this.motionZ += -Math.cos(rider.yaw) * f * 0.015;
      }
      if (rider.input.sneak) dismount(rider);
    }
    const speed = Math.sqrt(this.motionX ** 2 + this.motionZ ** 2);
    const max = submerged > 0 ? 0.4 : 0.1;
    if (speed > max) { this.motionX *= max / speed; this.motionZ *= max / speed; }
    const prevSpeed = speed;
    this.move(this.motionX, this.motionY, this.motionZ);
    if (this.collidedH && prevSpeed > 0.2) {
      // Crash: the boat breaks into planks and sticks (classic).
      if (this.rider) dismount(this.rider);
      this.removed = true;
      for (let i = 0; i < 3; i++) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(BlockId.PLANKS));
      for (let i = 0; i < 2; i++) ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(ItemId.STICK));
      return;
    }
    const drag = submerged > 0 ? 0.99 : this.onGround ? 0.5 : 0.95;
    this.motionX *= drag; this.motionZ *= drag; this.motionY *= 0.95;
    if (speed > 0.01) this.yaw = Math.atan2(-this.motionX, -this.motionZ);
    if (rider && this.rider === rider) {
      rider.setPosition(this.x, this.y + 0.1, this.z);
      rider.fallDistance = 0;
      rider.onGround = true;
    }
    // Break lily pads we drive through.
    const id = this.dim.getBlock(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
    if (id === BlockId.LILY_PAD) this.dim.setBlock(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z), 0, 0);
  }
}

const RAIL_IDS = new Set<number>([BlockId.RAIL, BlockId.POWERED_RAIL, BlockId.DETECTOR_RAIL]);

/** Rail shape -> pair of connection directions [dx, dz]. */
const RAIL_DIRS: [[number, number], [number, number]][] = [
  [[0, -1], [0, 1]], [[-1, 0], [1, 0]], [[-1, 0], [1, 0]], [[-1, 0], [1, 0]], [[0, -1], [0, 1]], [[0, -1], [0, 1]],
  [[0, 1], [1, 0]], [[0, 1], [-1, 0]], [[0, -1], [-1, 0]], [[0, -1], [1, 0]],
];

export class Minecart extends Entity {
  readonly type = 'minecart';
  override displayName = 'Minecart';
  health = 40;
  hurtWobble = 0;
  onRail = false;

  constructor() {
    super();
    this.width = 0.98;
    this.height = 0.7;
  }

  override canBeHit(): boolean {
    return !this.removed;
  }

  override interact(_ctx: GameContext, player: Player): boolean {
    if (this.rider && this.rider !== player) return false;
    if (player.vehicle === this) dismount(player);
    else mount(player, this);
    return true;
  }

  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    if (!source.attacker && !source.isExplosion) return false;
    this.hurtWobble = 10;
    this.health -= amount * 10;
    if (this.health <= 0) {
      if (this.rider) dismount(this.rider);
      this.removed = true;
      ctx.dropStack(this.dim, this.x, this.y + 0.5, this.z, createStack(ItemId.MINECART));
    }
    return true;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    if (this.hurtWobble > 0) this.hurtWobble--;
    const bx = Math.floor(this.x);
    let by = Math.floor(this.y);
    const bz = Math.floor(this.z);
    if (RAIL_IDS.has(this.dim.getBlock(bx, by - 1, bz))) by--;
    const id = this.dim.getBlock(bx, by, bz);
    this.onRail = RAIL_IDS.has(id);
    const rider = this.rider as Player | null;
    if (this.onRail) {
      const meta = this.dim.getMeta(bx, by, bz);
      const shape = id === BlockId.RAIL ? meta : meta & 7;
      const [[ax, az], [bx2, bz2]] = RAIL_DIRS[shape] ?? RAIL_DIRS[0];
      // Slopes accelerate the cart downhill.
      const slope = 0.0078125;
      if (shape === 2) this.motionX -= slope; if (shape === 3) this.motionX += slope;
      if (shape === 4) this.motionZ += slope; if (shape === 5) this.motionZ -= slope;
      // Project velocity onto the rail direction.
      let dx = bx2 - ax; let dz = bz2 - az;
      const len = Math.sqrt(dx * dx + dz * dz);
      dx /= len; dz /= len;
      let v = this.motionX * dx + this.motionZ * dz;
      if (rider && Math.abs(v) < 0.01 && rider.input.forward > 0) {
        const push = -Math.sin(rider.yaw) * dx - Math.cos(rider.yaw) * dz;
        v += Math.sign(push || 1) * 0.02;
      }
      if (id === BlockId.POWERED_RAIL) {
        if (meta & RAIL_POWERED) {
          const s = Math.abs(v);
          if (s > 0.01) v += Math.sign(v) * 0.06;
          else v = 0.02;
        } else {
          v *= 0.5;
          if (Math.abs(v) < 0.03) v = 0;
        }
      }
      v = Math.max(-0.4, Math.min(0.4, v));
      this.motionX = dx * v;
      this.motionZ = dz * v;
      // Snap to the rail centre line.
      if (dx === 0) this.x = bx + 0.5;
      if (dz === 0) this.z = bz + 0.5;
      let targetY = by + 0.0625;
      if (shape >= 2 && shape <= 5) {
        const fx = this.x - bx; const fz = this.z - bz;
        const t = shape === 2 ? fx : shape === 3 ? 1 - fx : shape === 4 ? 1 - fz : fz;
        targetY = by + 0.0625 + t;
      }
      this.y = targetY;
      this.motionY = 0;
      this.x += this.motionX;
      this.z += this.motionZ;
      // Leaving a curve: turn the velocity toward the next rail.
      const nx = Math.floor(this.x); const nz = Math.floor(this.z);
      if ((nx !== bx || nz !== bz) && shape >= 6) {
        const ndx = nx - bx; const ndz = nz - bz;
        const sp = Math.abs(v);
        this.motionX = ndx * sp; this.motionZ = ndz * sp;
      }
      this.motionX *= rider ? 0.997 : 0.96;
      this.motionZ *= rider ? 0.997 : 0.96;
      if (Math.abs(v) > 0.05 && this.age % 10 === 0) ctx.playSound('minecart.roll', this.x, this.y, this.z, Math.min(1, Math.abs(v) * 3), 1);
      if (id === BlockId.DETECTOR_RAIL && !(meta & RAIL_POWERED)) this.dim.setMeta(bx, by, bz, meta | RAIL_POWERED);
    } else {
      this.motionY -= 0.04;
      this.move(this.motionX, this.motionY, this.motionZ);
      this.motionX *= this.onGround ? 0.5 : 0.95;
      this.motionZ *= this.onGround ? 0.5 : 0.95;
      this.motionY *= 0.98;
    }
    if (Math.abs(this.motionX) + Math.abs(this.motionZ) > 0.001) this.yaw = Math.atan2(-this.motionX, -this.motionZ);
    if (rider && this.rider === rider) {
      if (rider.input.sneak) dismount(rider);
      else {
        rider.setPosition(this.x, this.y + 0.3, this.z);
        rider.fallDistance = 0;
        rider.onGround = true;
      }
    }
    void getBlock;
  }
}

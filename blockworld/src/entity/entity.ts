/**
 * Base entity with the shared movement/collision model. Physics runs at the
 * fixed 20 Hz game tick, and renderers interpolate between prev* and current.
 */

import { AABB } from '../core/aabb';
import { BlockId } from '../blocks/ids';
import { getBlock, IS_FLUID } from '../blocks/registry';
import { gatherCollisions } from '../world/collision';
import type { Dimension } from '../world/dimension';
import type { GameContext } from '../game/context';

let nextEntityId = 1;

export interface EntityData {
  type: string;
  x: number; y: number; z: number;
  mx: number; my: number; mz: number;
  yaw: number; pitch: number;
  fire: number;
  fall: number;
  [key: string]: unknown;
}

const tmpBoxes: AABB[] = [];

export abstract class Entity {
  readonly id = nextEntityId++;
  abstract readonly type: string;
  displayName = 'Entity';
  dim!: Dimension;

  x = 0; y = 0; z = 0;
  prevX = 0; prevY = 0; prevZ = 0;
  motionX = 0; motionY = 0; motionZ = 0;
  yaw = 0; pitch = 0;
  prevYaw = 0; prevPitch = 0;
  /** Body yaw for rendering living models. */
  bodyYaw = 0; prevBodyYaw = 0;
  width = 0.6;
  height = 1.8;
  stepHeight = 0;
  onGround = false;
  collidedH = false;
  collidedV = false;
  inWater = false;
  inLava = false;
  inWeb = false;
  fallDistance = 0;
  fireTicks = 0;
  fireImmune = false;
  age = 0;
  removed = false;
  noClip = false;
  noGravity = false;
  /** Horizontal distance walked, for walk animations and footsteps. */
  distanceWalked = 0;
  prevDistanceWalked = 0;
  /** The riding/ridden relationship (minecarts, boats). */
  vehicle: Entity | null = null;
  rider: Entity | null = null;
  /** Portal cooldown so entities do not bounce between dimensions. */
  portalCooldown = 0;
  /** Persisted with the chunk/world. */
  persistent = true;

  get box(): AABB {
    return AABB.fromCenter(this.x, this.y, this.z, this.width, this.height);
  }

  setPosition(x: number, y: number, z: number): void {
    this.x = x; this.y = y; this.z = z;
    this.prevX = x; this.prevY = y; this.prevZ = z;
  }

  /** Remember the last position/rotation for render interpolation. */
  savePrev(): void {
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.prevBodyYaw = this.bodyYaw;
    this.prevDistanceWalked = this.distanceWalked;
  }

  get eyeHeight(): number {
    return this.height * 0.85;
  }

  distanceTo(o: Entity): number {
    const dx = this.x - o.x; const dy = this.y - o.y; const dz = this.z - o.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceSqTo(x: number, y: number, z: number): number {
    const dx = this.x - x; const dy = this.y - y; const dz = this.z - z;
    return dx * dx + dy * dy + dz * dz;
  }

  lookVector(): [number, number, number] {
    const cp = Math.cos(this.pitch);
    return [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
  }

  /** Sneaking players do not walk off edges. */
  protected preventEdgeFall(): boolean {
    return false;
  }

  /** Move with collision (MC-style: Y, then X, then Z, with step-up). */
  move(dxIn: number, dyIn: number, dzIn: number): void {
    if (this.noClip) {
      this.x += dxIn; this.y += dyIn; this.z += dzIn;
      return;
    }
    let dx = dxIn; let dy = dyIn; let dz = dzIn;
    if (this.inWeb) {
      this.inWeb = false;
      dx *= 0.25; dy *= 0.05; dz *= 0.25;
      this.motionX = 0; this.motionY = 0; this.motionZ = 0;
    }
    const origDx = dx; const origDy = dy; const origDz = dz;
    let box = this.box;

    if (this.onGround && this.preventEdgeFall()) {
      const step = 0.05;
      const below = (ox: number, oz: number) => {
        const b = box.clone().offset(ox, -1, oz);
        const cols = gatherCollisions(this.dim, b, tmpBoxes);
        return cols.some((c) => c.intersects(b));
      };
      while (dx !== 0 && !below(dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      while (dz !== 0 && !below(0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      while (dx !== 0 && dz !== 0 && !below(dx, dz)) {
        dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
        dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      }
    }
    const safeDx = dx; const safeDz = dz;

    const cols = gatherCollisions(this.dim, box.expandTowards(dx, dy, dz), tmpBoxes).slice();
    for (const c of cols) dy = c.clipY(box, dy);
    box.offset(0, dy, 0);
    const landed = origDy !== dy && origDy < 0;
    for (const c of cols) dx = c.clipX(box, dx);
    box.offset(dx, 0, 0);
    for (const c of cols) dz = c.clipZ(box, dz);
    box.offset(0, 0, dz);

    // Step up small ledges (slabs, stairs) when blocked horizontally.
    if (this.stepHeight > 0 && (landed || this.onGround) && (safeDx !== dx || safeDz !== dz)) {
      let sx = safeDx; let sy = this.stepHeight; let sz = safeDz;
      const start = this.box;
      const stepCols = gatherCollisions(this.dim, start.expandTowards(sx, sy, sz), tmpBoxes).slice();
      const sb = start.clone();
      for (const c of stepCols) sy = c.clipY(sb, sy);
      sb.offset(0, sy, 0);
      for (const c of stepCols) sx = c.clipX(sb, sx);
      sb.offset(sx, 0, 0);
      for (const c of stepCols) sz = c.clipZ(sb, sz);
      sb.offset(0, 0, sz);
      let down = -sy;
      for (const c of stepCols) down = c.clipY(sb, down);
      sb.offset(0, down, 0);
      if (sx * sx + sz * sz > dx * dx + dz * dz) {
        dx = sx; dz = sz; dy = sy + down;
        box = sb;
      }
    }

    this.x = (box.minX + box.maxX) / 2;
    this.y = box.minY;
    this.z = (box.minZ + box.maxZ) / 2;
    this.collidedH = safeDx !== dx || safeDz !== dz;
    this.collidedV = origDy !== dy;
    const wasOnGround = this.onGround;
    this.onGround = this.collidedV && origDy < 0;
    if (safeDx !== dx) this.motionX = 0;
    if (safeDz !== dz) this.motionZ = 0;
    if (origDy !== dy) this.motionY = 0;
    this.updateFall(dy, this.onGround, wasOnGround);
    const walked = Math.sqrt(dx * dx + dz * dz);
    this.distanceWalked += walked * 0.6;
  }

  protected updateFall(dy: number, onGround: boolean, _wasOnGround: boolean): void {
    if (onGround) {
      if (this.fallDistance > 0) {
        this.onLanded(this.fallDistance);
        this.fallDistance = 0;
      }
    } else if (dy < 0) {
      this.fallDistance -= dy;
    }
  }

  /** Called with the accumulated fall distance on landing. */
  protected onLanded(_distance: number): void {}

  /** Update inWater / inLava / web flags from the blocks the entity overlaps. */
  updateEnvironment(): void {
    const b = this.box;
    const x0 = Math.floor(b.minX + 0.001); const x1 = Math.floor(b.maxX - 0.001);
    const y0 = Math.floor(b.minY + 0.4); const y1 = Math.floor(b.maxY - 0.4);
    const z0 = Math.floor(b.minZ + 0.001); const z1 = Math.floor(b.maxZ - 0.001);
    let water = false; let lava = false; let web = false;
    for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
      for (let y = Math.floor(b.minY); y <= Math.floor(b.maxY); y++) {
        const id = this.dim.getBlock(x, y, z);
        if (id === BlockId.COBWEB) web = true;
        const f = IS_FLUID[id];
        if (f === 0) continue;
        if (y >= y0 && y <= y1 || f === 2) {
          const meta = this.dim.getMeta(x, y, z);
          const surface = y + 1 - (meta >= 8 ? 0 : (meta + 1) / 9);
          if (f === 1 && b.minY + 0.4 < surface) water = true;
          if (f === 2 && b.minY < surface - 0.1 && b.maxY > y) lava = true;
        }
      }
    }
    this.inWater = water;
    this.inLava = lava;
    this.inWeb = web;
    if (water) {
      this.fallDistance = 0;
      if (this.fireTicks > 0) this.fireTicks = 0;
    }
  }

  isEyeInWater(): boolean {
    const ey = this.y + this.eyeHeight;
    const bx = Math.floor(this.x); const by = Math.floor(ey); const bz = Math.floor(this.z);
    const id = this.dim.getBlock(bx, by, bz);
    if (IS_FLUID[id] !== 1) return false;
    const meta = this.dim.getMeta(bx, by, bz);
    const surface = by + 1 - (meta >= 8 ? 0 : (meta + 1) / 9) - 0.11;
    return ey < surface;
  }

  isEyeInLava(): boolean {
    const ey = this.y + this.eyeHeight;
    return IS_FLUID[this.dim.getBlock(Math.floor(this.x), Math.floor(ey), Math.floor(this.z))] === 2;
  }

  /** Is the entity's head inside an opaque block (suffocation)? */
  isInsideOpaque(): boolean {
    const ey = this.y + this.eyeHeight;
    for (const [ox, oz] of [[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]]) {
      const id = this.dim.getBlock(Math.floor(this.x + ox * this.width), Math.floor(ey), Math.floor(this.z + oz * this.width));
      const def = getBlock(id);
      if (def.solid && def.shape === 'cube' && def.collides) return true;
    }
    return false;
  }

  isOnLadder(): boolean {
    const id = this.dim.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    return id === BlockId.LADDER;
  }

  /** Friction of the block under the entity. */
  groundSlipperiness(): number {
    const id = this.dim.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
    return id === 0 ? 0.6 : getBlock(id).slipperiness;
  }

  setFire(seconds: number): void {
    if (this.fireImmune) return;
    this.fireTicks = Math.max(this.fireTicks, seconds * 20);
  }

  /** Per-tick update. */
  abstract tick(ctx: GameContext): void;

  /** Called when a player right-clicks the entity. Return true if handled. */
  interact(_ctx: GameContext, _player: import('./player').Player): boolean {
    return false;
  }

  /** Attack by an entity or environment; returns true if damage was applied. */
  damage(_ctx: GameContext, _amount: number, _source: import('./damage').DamageSource): boolean {
    return false;
  }

  /** Can this entity be hit by the player's crosshair? */
  canBeHit(): boolean {
    return false;
  }

  /** Boxes used for aiming and projectile hits (multi-part mobs override). */
  hitBoxes(): AABB[] {
    return [this.box];
  }

  serialize(): EntityData {
    return {
      type: this.type, x: this.x, y: this.y, z: this.z, mx: this.motionX, my: this.motionY, mz: this.motionZ,
      yaw: this.yaw, pitch: this.pitch, fire: this.fireTicks, fall: this.fallDistance,
    };
  }

  deserialize(d: EntityData): void {
    this.setPosition(d.x, d.y, d.z);
    this.motionX = d.mx ?? 0; this.motionY = d.my ?? 0; this.motionZ = d.mz ?? 0;
    this.yaw = d.yaw ?? 0; this.pitch = d.pitch ?? 0;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.bodyYaw = this.yaw; this.prevBodyYaw = this.yaw;
    this.fireTicks = d.fire ?? 0;
    this.fallDistance = d.fall ?? 0;
  }
}

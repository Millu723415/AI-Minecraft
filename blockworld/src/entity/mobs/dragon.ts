/**
 * The Ender Dragon and End crystals.
 *
 * The dragon does not home in on the player like a missile: it follows a
 * state machine of wide circles around the island, occasional attack runs,
 * sweeping turns, repositioning, and healing near intact crystals.
 */

import { AABB } from '../../core/aabb';
import { BlockId } from '../../blocks/ids';
import { getBlock } from '../../blocks/registry';
import type { GameContext } from '../../game/context';
import type { DamageSource } from '../damage';
import { Entity, type EntityData } from '../entity';
import { LivingEntity } from '../living';
import { Mob, type MobCategory } from '../mob';

export type DragonPhase = 'CIRCLING' | 'APPROACH' | 'ATTACK_RUN' | 'TURN' | 'REPOSITION' | 'CRYSTAL_HEAL' | 'DEATH';

const IMMUNE_BLOCKS = new Set<number>([BlockId.OBSIDIAN, BlockId.END_STONE, BlockId.BEDROCK, BlockId.END_PORTAL, BlockId.END_PORTAL_FRAME, BlockId.IRON_BARS]);

export class EnderCrystal extends Entity {
  readonly type = 'ender_crystal';
  override displayName = 'End Crystal';
  spin = Math.random() * 100;

  constructor() {
    super();
    this.width = 2;
    this.height = 2;
  }

  override canBeHit(): boolean {
    return !this.removed;
  }

  tick(ctx: GameContext): void {
    this.savePrev();
    this.age++;
    this.spin++;
    // Keep the fire burning under the crystal.
    const bx = Math.floor(this.x); const by = Math.floor(this.y); const bz = Math.floor(this.z);
    if (this.dim.getBlock(bx, by, bz) === 0) this.dim.setBlock(bx, by, bz, BlockId.FIRE, 0);
    void ctx;
  }

  override damage(ctx: GameContext, _amount: number, _source: DamageSource): boolean {
    if (this.removed) return false;
    this.removed = true;
    ctx.explode(this.dim, this.x, this.y, this.z, 6, false, this, true);
    return true;
  }
}

export class EnderDragon extends Mob {
  readonly type = 'ender_dragon';
  readonly category: MobCategory = 'boss';
  override displayName = 'Ender Dragon';
  phase: DragonPhase = 'CIRCLING';
  tx = 0; ty = 80; tz = 0;
  speed = 0;
  wingPhase = 0;
  prevWingPhase = 0;
  healingCrystal: EnderCrystal | null = null;
  private phaseTimer = 0;
  private circleAngle = 0;
  private circleDir = 1;
  private attackCooldown2 = 0;
  deathTicks = 0;
  portalCreated = false;
  /** Short history of positions for the tail/neck animation. */
  readonly trail: [number, number, number][] = [];
  hitFlash = 0;

  constructor() {
    super();
    this.width = 8;
    this.height = 5;
    this.maxHealth = 200;
    this.health = 200;
    this.noGravity = true;
    this.fireImmune = true;
    this.noClip = true;
    this.xpReward = 0;
    this.persistent = true;
  }

  protected initGoals(): void {}

  override canDespawn(): boolean {
    return false;
  }

  override get eyeHeight(): number {
    return 2.5;
  }

  /** Separate hit boxes: head, body and tail (used for targeting). */
  partBoxes(): { box: AABB; part: 'head' | 'body' | 'tail' }[] {
    const fx = -Math.sin(this.yaw); const fz = -Math.cos(this.yaw);
    const out: { box: AABB; part: 'head' | 'body' | 'tail' }[] = [];
    out.push({ part: 'body', box: AABB.fromCenter(this.x, this.y, this.z, 5, 3) });
    out.push({ part: 'head', box: AABB.fromCenter(this.x + fx * 6.5, this.y + 1, this.z + fz * 6.5, 2, 2) });
    out.push({ part: 'tail', box: AABB.fromCenter(this.x - fx * 6, this.y + 0.5, this.z - fz * 6, 2, 2) });
    out.push({ part: 'body', box: AABB.fromCenter(this.x - Math.cos(this.yaw) * 4, this.y + 1.5, this.z + Math.sin(this.yaw) * 4, 4, 1) });
    out.push({ part: 'body', box: AABB.fromCenter(this.x + Math.cos(this.yaw) * 4, this.y + 1.5, this.z - Math.sin(this.yaw) * 4, 4, 1) });
    return out;
  }

  override hitBoxes(): AABB[] {
    return this.partBoxes().map((p) => p.box);
  }

  override damage(ctx: GameContext, amount: number, source: DamageSource): boolean {
    if (this.phase === 'DEATH') return false;
    // Only direct attacks (player melee, arrows, explosions) hurt; body hits deal reduced damage.
    let dmg = amount;
    if (source.type === 'player' || source.type === 'arrow') {
      const hitHead = source.attacker && this.isHeadHit(source.attacker);
      if (!hitHead) dmg = dmg / 4 + 1;
    } else if (!source.isExplosion) {
      return false;
    }
    this.invulnerable = 0;
    const ok = super.damage(ctx, dmg, { ...source, bypassArmor: true });
    if (ok) {
      this.hitFlash = 10;
      ctx.playSound('mob.dragon.hurt', this.x, this.y, this.z, 5, 0.8 + Math.random() * 0.3);
      // Taking damage makes it break off and reposition.
      if (this.phase === 'ATTACK_RUN' || this.phase === 'APPROACH' || this.phase === 'CRYSTAL_HEAL') this.setPhase('REPOSITION');
    }
    return ok;
  }

  private isHeadHit(attacker: Entity): boolean {
    const head = this.partBoxes().find((p) => p.part === 'head')!.box.grow(1.5);
    const [lx, ly, lz] = attacker.lookVector();
    return !!head.raycast(attacker.x, attacker.y + attacker.eyeHeight, attacker.z, lx, ly, lz, 64);
  }

  override knockBack(): void {}

  die(ctx: GameContext, source: DamageSource): void {
    if (this.phase === 'DEATH') return;
    this.health = 0;
    this.setPhase('DEATH');
    this.dead = false; // stay alive for the death animation; removed at the end
    this.deathTicks = 0;
    ctx.playSound('mob.dragon.end', this.x, this.y, this.z, 10, 1);
    void source;
  }

  private setPhase(p: DragonPhase): void {
    this.phase = p;
    this.phaseTimer = 0;
    if (p === 'CIRCLING' || p === 'REPOSITION') {
      this.circleDir = Math.random() < 0.5 ? 1 : -1;
      this.circleAngle = Math.atan2(this.z, this.x);
    }
  }

  tick(ctx: GameContext): void {
    this.ctx = ctx;
    this.savePrev();
    this.age++;
    this.prevWingPhase = this.wingPhase;
    if (this.hitFlash > 0) this.hitFlash--;
    this.trail.unshift([this.x, this.y, this.z]);
    if (this.trail.length > 64) this.trail.pop();
    if (this.phase === 'DEATH') {
      this.tickDeath(ctx);
      return;
    }
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.hurtTime > 0) this.hurtTime--;
    this.wingPhase += 0.2 + (this.motionY < 0 ? 0 : 0.1);
    if (Math.floor(this.prevWingPhase / (Math.PI * 2)) !== Math.floor(this.wingPhase / (Math.PI * 2))) {
      ctx.playSound('mob.dragon.wings', this.x, this.y, this.z, 5, 0.8 + Math.random() * 0.3);
    }
    if (this.age % 400 === 0) ctx.playSound('mob.dragon.growl', this.x, this.y, this.z, 6, 0.8 + Math.random() * 0.3);
    this.updateCrystalHealing(ctx);
    this.think(ctx);
    this.fly();
    this.collideWithEntities(ctx);
    this.destroyBlocks(ctx);
  }

  private think(ctx: GameContext): void {
    const p = ctx.player;
    const playerHere = !p.dead && p.dim === this.dim && !p.creative;
    this.phaseTimer++;
    if (this.attackCooldown2 > 0) this.attackCooldown2--;
    switch (this.phase) {
      case 'CIRCLING': {
        this.circleAngle += this.circleDir * 0.012;
        const r = 50 + Math.sin(this.age * 0.01) * 15;
        this.tx = Math.cos(this.circleAngle) * r;
        this.tz = Math.sin(this.circleAngle) * r;
        this.ty = 78 + Math.sin(this.age * 0.02) * 12;
        if (this.health < this.maxHealth * 0.9 && this.healingCrystal) this.setPhase('CRYSTAL_HEAL');
        else if (playerHere && this.attackCooldown2 <= 0 && this.phaseTimer > 100 && Math.random() < 0.01) this.setPhase('APPROACH');
        break;
      }
      case 'APPROACH': {
        if (!playerHere) { this.setPhase('CIRCLING'); break; }
        // Line up from a distance above the player, then dive.
        this.tx = p.x;
        this.tz = p.z;
        this.ty = Math.max(p.y + 12, 70);
        const dx = p.x - this.x; const dz = p.z - this.z;
        if (Math.sqrt(dx * dx + dz * dz) < 40 && this.phaseTimer > 40) this.setPhase('ATTACK_RUN');
        if (this.phaseTimer > 300) this.setPhase('CIRCLING');
        break;
      }
      case 'ATTACK_RUN': {
        if (!playerHere) { this.setPhase('CIRCLING'); break; }
        this.tx = p.x;
        this.ty = p.y + 1.5;
        this.tz = p.z;
        const d = Math.sqrt((p.x - this.x) ** 2 + (p.z - this.z) ** 2);
        if (d < 6 || this.phaseTimer > 160) this.setPhase('TURN');
        break;
      }
      case 'TURN': {
        // Overshoot in the current heading and climb.
        const fx = -Math.sin(this.yaw); const fz = -Math.cos(this.yaw);
        this.tx = this.x + fx * 40;
        this.tz = this.z + fz * 40;
        this.ty = 85;
        if (this.phaseTimer > 50) {
          this.attackCooldown2 = 100 + Math.floor(Math.random() * 200);
          this.setPhase(Math.random() < 0.3 ? 'APPROACH' : 'REPOSITION');
        }
        break;
      }
      case 'REPOSITION': {
        const a = this.circleAngle + this.circleDir * 1.2;
        this.tx = Math.cos(a) * 60;
        this.tz = Math.sin(a) * 60;
        this.ty = 90;
        const d = Math.sqrt((this.tx - this.x) ** 2 + (this.tz - this.z) ** 2);
        if (d < 12 || this.phaseTimer > 200) this.setPhase('CIRCLING');
        break;
      }
      case 'CRYSTAL_HEAL': {
        const c = this.healingCrystal ?? this.nearestCrystal(ctx);
        if (!c || this.health >= this.maxHealth) { this.setPhase('CIRCLING'); break; }
        // Hover near the crystal.
        const a = this.age * 0.03;
        this.tx = c.x + Math.cos(a) * 14;
        this.tz = c.z + Math.sin(a) * 14;
        this.ty = c.y + 8;
        if (this.phaseTimer > 300) this.setPhase('CIRCLING');
        break;
      }
    }
  }

  private fly(): void {
    const dx = this.tx - this.x; const dy = this.ty - this.y; const dz = this.tz - this.z;
    const h = Math.sqrt(dx * dx + dz * dz);
    const targetYaw = Math.atan2(-dx, -dz);
    let dyaw = targetYaw - this.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    const turn = this.phase === 'ATTACK_RUN' ? 0.07 : 0.045;
    this.yaw += Math.max(-turn, Math.min(turn, dyaw));
    const wantSpeed = this.phase === 'ATTACK_RUN' ? 0.75 : this.phase === 'CRYSTAL_HEAL' ? 0.3 : 0.55;
    const align = Math.max(0, Math.cos(dyaw));
    this.speed += (wantSpeed * (0.4 + 0.6 * align) - this.speed) * 0.05;
    const fx = -Math.sin(this.yaw); const fz = -Math.cos(this.yaw);
    this.motionX = fx * this.speed;
    this.motionZ = fz * this.speed;
    this.motionY += (Math.max(-0.6, Math.min(0.6, dy / Math.max(8, h) * 0.9)) - this.motionY) * 0.1;
    this.x += this.motionX; this.y += this.motionY; this.z += this.motionZ;
    this.pitch = Math.atan2(this.motionY, Math.max(0.01, this.speed)) * 0.6;
    this.bodyYaw = this.yaw;
    if (this.y < 20) this.y = 20;
  }

  private collideWithEntities(ctx: GameContext): void {
    const parts = this.partBoxes();
    for (const e of ctx.entitiesIn(this.dim)) {
      if (!(e instanceof LivingEntity) || e === this || e.dead) continue;
      for (const p of parts) {
        if (!p.box.grow(0.5).intersects(e.box)) continue;
        if (p.part === 'head') {
          e.damage(ctx, 10, { type: 'mob', attacker: this });
        }
        // Wings and body knock everything aside.
        const kx = e.x - this.x; const kz = e.z - this.z;
        const d = Math.max(0.1, Math.sqrt(kx * kx + kz * kz));
        e.motionX += (kx / d) * 1.2;
        e.motionZ += (kz / d) * 1.2;
        e.motionY += 0.3;
        if (p.part === 'body' && e.invulnerable === 0) e.damage(ctx, 5, { type: 'mob', attacker: this });
        break;
      }
    }
  }

  private destroyBlocks(ctx: GameContext): void {
    if (this.age % 2 !== 0) return;
    const box = AABB.fromCenter(this.x, this.y - 0.5, this.z, 6, 4);
    let broke = false;
    for (let x = Math.floor(box.minX); x <= Math.floor(box.maxX); x++) {
      for (let y = Math.floor(box.minY); y <= Math.floor(box.maxY); y++) {
        for (let z = Math.floor(box.minZ); z <= Math.floor(box.maxZ); z++) {
          const id = this.dim.getBlock(x, y, z);
          if (id === 0 || IMMUNE_BLOCKS.has(id) || id === BlockId.FIRE) continue;
          if (!getBlock(id).collides && id !== BlockId.TORCH) continue;
          this.dim.setBlock(x, y, z, 0, 0);
          broke = true;
        }
      }
    }
    if (broke) ctx.particles('explosion', this.dim, this.x, this.y, this.z, 2, { spread: 2 });
  }

  private nearestCrystal(ctx: GameContext): EnderCrystal | null {
    let best: EnderCrystal | null = null;
    let bestD = 64 * 64;
    for (const e of ctx.entitiesIn(this.dim)) {
      if (e instanceof EnderCrystal && !e.removed) {
        const d = e.distanceSqTo(this.x, this.y, this.z);
        if (d < bestD) { bestD = d; best = e; }
      }
    }
    return best;
  }

  private updateCrystalHealing(ctx: GameContext): void {
    if (this.healingCrystal && this.healingCrystal.removed) {
      // Destroying the crystal that is healing it hurts the dragon.
      this.healingCrystal = null;
      super.damage(ctx, 10, { type: 'explosion', isExplosion: true, bypassArmor: true });
      this.hitFlash = 10;
    }
    if (this.age % 10 === 0 && this.health < this.maxHealth) {
      const c = this.nearestCrystal(ctx);
      if (c && c.distanceSqTo(this.x, this.y, this.z) < 32 * 32) {
        this.healingCrystal = c;
        this.health = Math.min(this.maxHealth, this.health + 1);
      } else {
        this.healingCrystal = null;
      }
    }
  }

  private tickDeath(ctx: GameContext): void {
    this.deathTicks++;
    this.motionX = 0; this.motionZ = 0;
    this.y += 0.1;
    this.yaw += 0.02 * (this.deathTicks / 20);
    if (this.deathTicks >= 180 && this.deathTicks <= 200) {
      ctx.particles('largeexplode', this.dim, this.x + (Math.random() - 0.5) * 8, this.y + 2 + (Math.random() - 0.5) * 4, this.z + (Math.random() - 0.5) * 8, 1);
    }
    if (this.deathTicks % 5 === 0) ctx.particles('dragonbreath', this.dim, this.x, this.y + 2, this.z, 12, { spread: 3 });
    if (this.deathTicks > 150 && this.deathTicks % 5 === 0) ctx.dropXp(this.dim, this.x, this.y, this.z, 1000);
    if (this.deathTicks === 1) ctx.dropXp(this.dim, this.x, this.y, this.z, 2000);
    if (this.deathTicks >= 200 && !this.portalCreated) {
      this.portalCreated = true;
      ctx.dropXp(this.dim, this.x, this.y, this.z, 2000);
      createExitPortal(this, ctx);
      this.removed = true;
      this.dead = true;
      ctx.world.dragonKilled = true;
    }
  }

  override serialize(): EntityData {
    return { ...super.serialize(), phase: this.phase, deathTicks: this.deathTicks };
  }

  override deserialize(d: EntityData): void {
    super.deserialize(d);
    this.phase = (d.phase as DragonPhase) ?? 'CIRCLING';
    if (this.phase === 'DEATH') this.deathTicks = (d.deathTicks as number) ?? 0;
  }
}

/** Build the bedrock exit portal (with a torch-lit pillar and the egg) at the island centre. */
export function createExitPortal(e: Entity, ctx: GameContext): void {
  const dim = e.dim;
  let top = 64;
  for (let y = 127; y > 0; y--) {
    const id = dim.getBlock(0, y, 0);
    if (id !== 0 && id !== BlockId.FIRE && id !== BlockId.END_PORTAL) { top = y; break; }
  }
  const baseY = top + 1;
  for (let dx = -4; dx <= 4; dx++) {
    for (let dz = -4; dz <= 4; dz++) {
      const d = Math.sqrt(dx * dx + dz * dz);
      if (d > 3.5) continue;
      for (let y = baseY - 1; y <= baseY + 3; y++) {
        if (y === baseY - 1) dim.setBlock(dx, y, dz, BlockId.BEDROCK, 0);
        else if (y === baseY) dim.setBlock(dx, y, dz, d > 2.5 ? BlockId.BEDROCK : BlockId.END_PORTAL, 0);
        else dim.setBlock(dx, y, dz, 0, 0);
      }
    }
  }
  for (let y = baseY; y <= baseY + 3; y++) dim.setBlock(0, y, 0, BlockId.BEDROCK, 0);
  dim.setBlock(1, baseY + 2, 0, BlockId.TORCH, 2);
  dim.setBlock(-1, baseY + 2, 0, BlockId.TORCH, 1);
  dim.setBlock(0, baseY + 2, 1, BlockId.TORCH, 4);
  dim.setBlock(0, baseY + 2, -1, BlockId.TORCH, 3);
  dim.setBlock(0, baseY + 4, 0, BlockId.DRAGON_EGG, 0);
  ctx.playSound('portal.activate', 0, baseY, 0, 4, 1);
  ctx.message('The exit portal has opened at the centre of the island.');
}

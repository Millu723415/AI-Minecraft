/**
 * Player interaction: targeting, mining, block placement, attacking and the
 * right-click "use" behaviour of every item and interactive block.
 */

import { BlockId } from '../blocks/ids';
import { canHarvest, getBlock, IS_FLUID, REPLACEABLE, resolveDrops } from '../blocks/registry';
import type { BlockDefinition } from '../blocks/types';
import { BED_HEAD, DOOR_OPEN, DOOR_UPPER, FRAME_EYE, SLAB_TOP, facingAwayFromPlayer } from '../blocks/meta';
import { AABB } from '../core/aabb';
import { ItemId, DyeMeta } from '../items/ids';
import { getItem, POTION_SPLASH, PotionKind } from '../items/registry';
import { createStack, hasEnchant, type ItemStack } from '../items/stack';
import { Enchantment } from '../items/enchantments';
import { Entity } from '../entity/entity';
import { LivingEntity } from '../entity/living';
import { Effect } from '../entity/effects';
import type { Player } from '../entity/player';
import { Arrow, EyeOfEnderSignal, Throwable, potionEffects } from '../entity/projectiles';
import { collisionBoxes } from '../render/shapes';
import { raycastBlocks, type BlockHit } from '../world/raycast';
import { canStay, doorMeta, placementMeta } from '../world/placement';
import { tryActivateEndPortal, tryCreateNetherPortal } from '../world/portals';
import { Dim, FACE_DIRS } from '../world/constants';
import type { Dimension } from '../world/dimension';
import type { GameContext } from './context';
import type { Input } from './input';
import type { BlockBehaviors } from '../world/behaviors';

export type ScreenRequest =
  | { kind: 'crafting'; x: number; y: number; z: number }
  | { kind: 'furnace'; x: number; y: number; z: number }
  | { kind: 'chest'; x: number; y: number; z: number }
  | { kind: 'enchant'; x: number; y: number; z: number }
  | { kind: 'brewing'; x: number; y: number; z: number }
  | { kind: 'sign'; x: number; y: number; z: number };

export interface InteractionHost {
  readonly ctx: GameContext;
  readonly behaviors: BlockBehaviors;
  openScreen(req: ScreenRequest): void;
  /** Nearest stronghold position for Eyes of Ender, or null. */
  nearestStronghold(x: number, z: number): [number, number] | null;
  trySleep(x: number, y: number, z: number): void;
  interactEntity(e: Entity): boolean;
  /** Optional special handling of left-clicking an entity (returns true if consumed). */
  interactEntityLeft?(e: Entity): boolean;
  onBlockBroken(id: number): void;
  spawnVehicle(kind: 'boat' | 'minecart', x: number, y: number, z: number): void;
  castFishingRod(): void;
}

export interface MiningState {
  x: number; y: number; z: number;
  progress: number;
  id: number;
}

const REACH = 4.5;

export class Interaction {
  target: BlockHit | null = null;
  targetEntity: Entity | null = null;
  mining: MiningState | null = null;
  private attackCooldown = 0;
  private placeCooldown = 0;
  private stepSoundTick = 0;
  /** Item being used (eating / drinking / bow draw). */
  useTicks = 0;
  useItem: ItemStack | null = null;
  /** Equip animation (0 = raised) when the held item changes. */
  equip = 0;
  private lastHeldKey = '';
  fishingHook: Entity | null = null;

  constructor(private readonly host: InteractionHost, private readonly input: Input) {}

  private get ctx(): GameContext {
    return this.host.ctx;
  }

  private get player(): Player {
    return this.ctx.player;
  }

  /** Update the block / entity under the crosshair. */
  updateTarget(eyeX: number, eyeY: number, eyeZ: number): void {
    const p = this.player;
    const [dx, dy, dz] = p.lookVector();
    const reach = p.creative ? 5 : REACH;
    const hit = raycastBlocks(p.dim, eyeX, eyeY, eyeZ, dx, dy, dz, reach, false);
    let best = hit ? hit.distance : reach;
    let ent: Entity | null = null;
    for (const e of this.ctx.entitiesIn(p.dim)) {
      if (e === p || e.removed || !e.canBeHit()) continue;
      if (e.distanceSqTo(eyeX, eyeY, eyeZ) > (e.width > 4 ? 400 : 64)) continue;
      for (const hb of e.hitBoxes()) {
        const h = hb.grow(0.1).raycast(eyeX, eyeY, eyeZ, dx, dy, dz, best);
        if (h && h.t < best) {
          best = h.t;
          ent = e;
        }
      }
    }
    this.targetEntity = ent;
    this.target = ent ? null : hit;
  }

  /** Called every game tick. */
  tick(): void {
    const p = this.player;
    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.placeCooldown > 0) this.placeCooldown--;
    const held = p.inventory.held;
    const key = held ? `${held.id}:${held.meta}` : '';
    if (key !== this.lastHeldKey) {
      this.lastHeldKey = key;
      this.equip = 1;
      this.stopUsing(false);
    }
    this.equip = Math.max(0, this.equip - 0.25);
    if (p.dead || p.sleeping) {
      this.mining = null;
      return;
    }

    // --- Left button: attack / mine -------------------------------------
    if (this.input.leftPressed) {
      this.input.leftPressed = false;
      if (this.targetEntity) {
        this.attack(this.targetEntity);
      } else if (!this.target) {
        p.swing();
      }
    }
    if (this.input.leftDown && this.target && !this.useItem) {
      this.mineTick(this.target);
    } else {
      this.mining = null;
    }

    // --- Right button: use ----------------------------------------------
    if (this.useItem) {
      if (!this.input.rightDown) this.stopUsing(true);
      else this.continueUsing();
    } else if (this.input.rightPressed || (this.input.rightDown && this.placeCooldown === 0)) {
      this.input.rightPressed = false;
      if (this.placeCooldown === 0) {
        this.placeCooldown = 4;
        this.use();
      }
    }
    if (!this.input.rightDown) this.placeCooldown = 0;

    // Middle click: pick block (creative-style convenience only in creative).
    if (this.input.middlePressed) {
      this.input.middlePressed = false;
      if (p.creative && this.target) {
        const def = getBlock(this.target.id);
        p.inventory.held = createStack(def.itemId || this.target.id, 1, this.target.meta);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Mining
  // -------------------------------------------------------------------------
  breakSpeed(def: BlockDefinition): number {
    const p = this.player;
    if (def.hardness < 0) return 0;
    if (def.hardness === 0) return 1;
    const held = p.inventory.held;
    const item = held ? getItem(held.id) : undefined;
    let speed = 1;
    let category = item?.toolCategory ?? null;
    if (item && category) {
      if (category === def.toolCategory) speed = item.toolSpeed;
      else if (category === 'sword') speed = def.id === BlockId.COBWEB ? 15 : 1.5;
      else if (category === 'shears') speed = def.id === BlockId.LEAVES || def.id === BlockId.COBWEB ? 15 : def.id === BlockId.WOOL ? 5 : 1;
      if (speed > 1) {
        const eff = hasEnchant(held, Enchantment.EFFICIENCY);
        if (eff > 0) speed += eff * eff + 1;
      }
    } else {
      category = null;
    }
    if (p.isEyeInWater() && !hasEnchant(p.inventory.armor.slots[0], Enchantment.AQUA_AFFINITY)) speed /= 5;
    if (!p.onGround && !p.flying) speed /= 5;
    const harvest = canHarvest(def, category, item?.toolTier ?? 0) || !def.requiresTool;
    return speed / def.hardness / (harvest ? 30 : 100);
  }

  private mineTick(t: BlockHit): void {
    const p = this.player;
    const dim = p.dim;
    const id = dim.getBlock(t.x, t.y, t.z);
    if (id === 0) {
      this.mining = null;
      return;
    }
    if (!this.mining || this.mining.x !== t.x || this.mining.y !== t.y || this.mining.z !== t.z || this.mining.id !== id) {
      this.mining = { x: t.x, y: t.y, z: t.z, progress: 0, id };
      // Punching fire extinguishes it.
      const fx = t.x + FACE_DIRS[t.face][0]; const fy = t.y + FACE_DIRS[t.face][1]; const fz = t.z + FACE_DIRS[t.face][2];
      if (dim.getBlock(fx, fy, fz) === BlockId.FIRE) {
        dim.setBlock(fx, fy, fz, 0, 0);
        this.ctx.playSound('fire.fizz', fx + 0.5, fy + 0.5, fz + 0.5, 0.5, 2);
      }
      if (id === BlockId.REDSTONE_ORE) dim.setBlock(t.x, t.y, t.z, BlockId.LIT_REDSTONE_ORE, 0);
      if (id === BlockId.DRAGON_EGG) {
        this.teleportDragonEgg(dim, t.x, t.y, t.z);
        this.mining = null;
        return;
      }
      if (id === BlockId.NOTE_BLOCK) this.playNote(dim, t.x, t.y, t.z);
    }
    const def = getBlock(id);
    p.swing();
    if (p.creative) {
      if (this.attackCooldown === 0) {
        this.breakBlock(t.x, t.y, t.z);
        this.attackCooldown = 5;
      }
      return;
    }
    this.mining.progress += this.breakSpeed(def);
    if (this.stepSoundTick++ % 4 === 0) {
      this.ctx.playSound(`step.${soundGroup(def)}`, t.x + 0.5, t.y + 0.5, t.z + 0.5, 0.25, 0.5);
      this.ctx.particles('block', dim, t.px, t.py, t.pz, 2, { blockId: id, blockMeta: t.meta, spread: 0.1 });
    }
    if (this.mining.progress >= 1) {
      this.breakBlock(t.x, t.y, t.z);
      this.mining = null;
      this.attackCooldown = 5;
    }
  }

  /** Remove a block as the player, handling drops, tools and multi-block structures. */
  breakBlock(x: number, y: number, z: number): void {
    const p = this.player;
    const dim = p.dim;
    const id = dim.getBlock(x, y, z);
    const meta = dim.getMeta(x, y, z);
    if (id === 0) return;
    const def = getBlock(id);
    if (def.hardness < 0 && !p.creative) return;
    const held = p.inventory.held;
    const item = held ? getItem(held.id) : undefined;
    this.ctx.particles('block', dim, x + 0.5, y + 0.5, z + 0.5, 24, { blockId: id, blockMeta: meta, spread: 0.5 });
    this.ctx.playSound(`dig.${soundGroup(def)}`, x + 0.5, y + 0.5, z + 0.5, 1, 0.8);

    // Container contents spill out.
    const tile = dim.getTile(x, y, z);
    if (tile && 'items' in tile) {
      for (const s of tile.items.slots) if (s) this.ctx.dropStack(dim, x + 0.5, y + 0.5, z + 0.5, s);
    }
    // Multi-block partners.
    if (id === BlockId.WOODEN_DOOR || id === BlockId.IRON_DOOR) {
      const oy = meta & DOOR_UPPER ? y - 1 : y + 1;
      if (dim.getBlock(x, oy, z) === id) dim.setBlock(x, oy, z, 0, 0, false);
    }
    if (id === BlockId.BED) {
      const [fx, fz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][meta & 3];
      const ox = meta & BED_HEAD ? x - fx : x + fx;
      const oz = meta & BED_HEAD ? z - fz : z + fz;
      if (dim.getBlock(ox, y, oz) === BlockId.BED) dim.setBlock(ox, y, oz, 0, 0, false);
    }
    const replaceWithWater = id === BlockId.ICE && !p.creative && dim.id !== Dim.NETHER && dim.getBlock(x, y - 1, z) !== 0;
    dim.setBlock(x, y, z, replaceWithWater ? BlockId.WATER : 0, 0);
    this.host.onBlockBroken(id);
    if (p.creative) return;
    p.exhaust(0.025);
    // Drops.
    const category = item?.toolCategory ?? null;
    const tier = item?.toolTier ?? 0;
    const harvest = canHarvest(def, category, tier);
    const fortune = hasEnchant(held, Enchantment.FORTUNE);
    const silk = hasEnchant(held, Enchantment.SILK_TOUCH) > 0;
    if (harvest) {
      for (const d of resolveDrops(id, meta, tier, category, fortune, silk, randomLike(this.ctx))) {
        this.ctx.dropStack(dim, x + 0.5, y + 0.5, z + 0.5, { id: d.item, count: d.count, meta: d.meta, damage: 0 });
      }
      if (def.xp && !silk) {
        const [lo, hi] = def.xp;
        const xp = lo + Math.floor(this.ctx.random() * (hi - lo + 1));
        if (xp > 0) this.ctx.dropXp(dim, x + 0.5, y + 0.5, z + 0.5, xp);
      }
    }
    // Tool wear.
    if (held && item && item.durability > 0 && def.hardness > 0) {
      this.damageHeld(item.toolCategory === 'sword' ? 2 : 1);
    }
  }

  damageHeld(amount: number): void {
    const p = this.player;
    const held = p.inventory.held;
    if (!held || p.creative) return;
    const def = getItem(held.id);
    if (!def || def.durability <= 0) return;
    const unbreaking = hasEnchant(held, Enchantment.UNBREAKING);
    for (let i = 0; i < amount; i++) {
      if (unbreaking > 0 && this.ctx.random() < 1 - 1 / (unbreaking + 1)) continue;
      held.damage++;
    }
    if (held.damage >= def.durability) {
      p.inventory.held = null;
      this.ctx.playSound('random.break', p.x, p.y, p.z, 0.8, 0.9);
    } else {
      p.inventory.changed();
    }
  }

  // -------------------------------------------------------------------------
  // Combat
  // -------------------------------------------------------------------------
  attack(target: Entity): void {
    const p = this.player;
    p.swing();
    if (this.host.interactEntityLeft?.(target)) return;
    const held = p.inventory.held;
    const def = held ? getItem(held.id) : undefined;
    let dmg = def && def.toolCategory ? def.attackDamage : 1;
    const strength = p.effects.get(Effect.STRENGTH);
    if (strength) dmg += 3 << strength.amplifier;
    const weakness = p.effects.get(Effect.WEAKNESS);
    if (weakness) dmg -= 2 << weakness.amplifier;
    let bonus = 0;
    if (target instanceof LivingEntity) {
      bonus += hasEnchant(held, Enchantment.SHARPNESS) * 1.25 * 2;
      if (target.undead) bonus += hasEnchant(held, Enchantment.SMITE) * 2.5 * 2;
      if (target.type === 'spider' || target.type === 'cave_spider' || target.type === 'silverfish') bonus += hasEnchant(held, Enchantment.BANE_OF_ARTHROPODS) * 2.5 * 2;
    }
    let knock = hasEnchant(held, Enchantment.KNOCKBACK);
    if (p.sprinting) knock++;
    const critical = p.fallDistance > 0 && !p.onGround && !p.isOnLadder() && !p.inWater && !p.vehicle;
    if (critical && dmg > 0) dmg += Math.floor(this.ctx.random() * (dmg / 2 + 2));
    dmg += Math.floor(bonus / 2);
    const ok = target.damage(this.ctx, Math.max(0, dmg), { type: 'player', attacker: p });
    if (ok) {
      if (knock > 0) {
        target.motionX += -Math.sin(p.yaw) * knock * 0.5;
        target.motionY += 0.1;
        target.motionZ += -Math.cos(p.yaw) * knock * 0.5;
        p.motionX *= 0.6; p.motionZ *= 0.6;
        p.sprinting = false;
      }
      if (critical) this.ctx.particles('crit', p.dim, target.x, target.y + target.height * 0.6, target.z, 12);
      const fire = hasEnchant(held, Enchantment.FIRE_ASPECT);
      if (fire > 0) target.setFire(fire * 4);
      if (def && def.durability > 0) this.damageHeld(def.toolCategory === 'sword' ? 1 : 2);
      p.exhaust(0.3);
    }
  }

  // -------------------------------------------------------------------------
  // Right click
  // -------------------------------------------------------------------------
  private use(): void {
    const p = this.player;
    const held = p.inventory.held;
    if (this.targetEntity) {
      p.swing();
      if (this.targetEntity.interact(this.ctx, p) || this.host.interactEntity(this.targetEntity)) return;
    }
    const t = this.target;
    if (t) {
      const id = p.dim.getBlock(t.x, t.y, t.z);
      if (!p.sneaking || !held) {
        if (this.activateBlock(t, id)) {
          p.swing();
          return;
        }
      }
      if (held && this.useItemOnBlock(held, t)) {
        p.swing();
        return;
      }
    }
    if (held) this.useItemInAir(held);
  }

  /** Right-click behaviour of interactive blocks. Returns true if handled. */
  private activateBlock(t: BlockHit, id: number): boolean {
    const dim = this.player.dim;
    const { x, y, z } = t;
    const meta = dim.getMeta(x, y, z);
    switch (id) {
      case BlockId.CRAFTING_TABLE: this.host.openScreen({ kind: 'crafting', x, y, z }); return true;
      case BlockId.FURNACE:
      case BlockId.LIT_FURNACE: this.host.openScreen({ kind: 'furnace', x, y, z }); return true;
      case BlockId.CHEST: {
        if (dim.getBlock(x, y + 1, z) !== 0 && getBlock(dim.getBlock(x, y + 1, z)).solid) return true;
        this.host.openScreen({ kind: 'chest', x, y, z });
        return true;
      }
      case BlockId.ENCHANTING_TABLE: this.host.openScreen({ kind: 'enchant', x, y, z }); return true;
      case BlockId.BREWING_STAND: this.host.openScreen({ kind: 'brewing', x, y, z }); return true;
      case BlockId.WOODEN_DOOR: {
        const lowerY = meta & DOOR_UPPER ? y - 1 : y;
        const lm = dim.getMeta(x, lowerY, z) ^ DOOR_OPEN;
        dim.setMeta(x, lowerY, z, lm);
        if (dim.getBlock(x, lowerY + 1, z) === id) dim.setMeta(x, lowerY + 1, z, (lm & 7) | DOOR_UPPER);
        this.ctx.playSound(lm & DOOR_OPEN ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        return true;
      }
      case BlockId.TRAPDOOR:
        dim.setMeta(x, y, z, meta ^ 4);
        this.ctx.playSound(meta & 4 ? 'door.close' : 'door.open', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        return true;
      case BlockId.FENCE_GATE: {
        let m = meta ^ 4;
        if (m & 4) {
          // Open away from the player.
          const f = facingAwayFromPlayer(this.player.yaw);
          m = (m & 4) | ((m & 1) === (f & 1) ? f : (m & 3));
        }
        dim.setMeta(x, y, z, m);
        this.ctx.playSound(m & 4 ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        return true;
      }
      case BlockId.LEVER:
      case BlockId.STONE_BUTTON:
      case BlockId.WOODEN_BUTTON:
        if (id !== BlockId.LEVER && (meta & 8)) return true;
        dim.setMeta(x, y, z, meta ^ 8);
        this.ctx.playSound('random.click', x + 0.5, y + 0.5, z + 0.5, 0.3, meta & 8 ? 0.5 : 0.6);
        if (id !== BlockId.LEVER) dim.scheduleTick(x, y, z, id === BlockId.WOODEN_BUTTON ? 30 : 20);
        return true;
      case BlockId.REPEATER_OFF:
      case BlockId.REPEATER_ON:
        dim.setMeta(x, y, z, (meta & 3) | ((((meta >> 2) + 1) & 3) << 2));
        return true;
      case BlockId.BED: {
        this.host.trySleep(x, y, z);
        return true;
      }
      case BlockId.NOTE_BLOCK: {
        const tile = dim.getOrCreateTile('note', x, y, z);
        if (tile.kind === 'note') tile.pitch = (tile.pitch + 1) % 25;
        this.playNote(dim, x, y, z);
        return true;
      }
      case BlockId.CAKE: {
        const p = this.player;
        if (!p.canEat()) return false;
        p.eat(2, 0.4);
        if (meta + 1 >= 6) dim.setBlock(x, y, z, 0, 0);
        else dim.setMeta(x, y, z, meta + 1);
        this.ctx.playSound('random.eat', p.x, p.y, p.z, 0.5, 1);
        return true;
      }
      case BlockId.DRAGON_EGG:
        this.teleportDragonEgg(dim, x, y, z);
        return true;
      case BlockId.TNT: {
        const held = this.player.inventory.held;
        if (held?.id === ItemId.FLINT_AND_STEEL) {
          this.host.behaviors.igniteTnt(dim, x, y, z);
          this.damageHeld(1);
          return true;
        }
        return false;
      }
      case BlockId.CAULDRON: return this.useCauldron(dim, x, y, z, meta);
      case BlockId.REDSTONE_ORE:
        dim.setBlock(x, y, z, BlockId.LIT_REDSTONE_ORE, 0);
        return false;
      default:
        return false;
    }
  }

  private useCauldron(dim: Dimension, x: number, y: number, z: number, meta: number): boolean {
    const p = this.player;
    const held = p.inventory.held;
    if (!held) return false;
    if (held.id === ItemId.WATER_BUCKET) {
      dim.setMeta(x, y, z, 3);
      if (!p.creative) p.inventory.held = createStack(ItemId.BUCKET);
      return true;
    }
    if (held.id === ItemId.GLASS_BOTTLE && meta > 0) {
      dim.setMeta(x, y, z, meta - 1);
      this.giveOrReplace(createStack(ItemId.POTION, 1, 0));
      return true;
    }
    return false;
  }

  private giveOrReplace(stack: ItemStack): void {
    const p = this.player;
    const held = p.inventory.held;
    if (held && held.count > 1) {
      held.count--;
      const left = p.inventory.addItem(stack);
      if (left) this.ctx.dropStack(p.dim, p.x, p.y + 1, p.z, left);
    } else {
      p.inventory.held = stack;
    }
    p.inventory.changed();
  }

  private playNote(dim: Dimension, x: number, y: number, z: number): void {
    if (dim.getBlock(x, y + 1, z) !== 0) return;
    const tile = dim.getOrCreateTile('note', x, y, z);
    const pitch = tile.kind === 'note' ? tile.pitch : 0;
    const below = getBlock(dim.getBlock(x, y - 1, z));
    const inst = below.toolCategory === 'pickaxe' ? 'bd' : below.id === BlockId.SAND || below.id === BlockId.GRAVEL ? 'snare' : below.id === BlockId.GLASS ? 'hat' : below.toolCategory === 'axe' ? 'bassattack' : 'harp';
    this.ctx.playSound(`note.${inst}`, x + 0.5, y + 0.5, z + 0.5, 3, Math.pow(2, (pitch - 12) / 12));
    this.ctx.particles('note', dim, x + 0.5, y + 1.2, z + 0.5, 1, { color: [pitch / 24, 1 - pitch / 24, 0.5] });
  }

  private teleportDragonEgg(dim: Dimension, x: number, y: number, z: number): void {
    for (let i = 0; i < 1000; i++) {
      const tx = x + Math.floor(this.ctx.random() * 16) - Math.floor(this.ctx.random() * 16);
      const ty = y + Math.floor(this.ctx.random() * 8) - Math.floor(this.ctx.random() * 8);
      const tz = z + Math.floor(this.ctx.random() * 16) - Math.floor(this.ctx.random() * 16);
      if (dim.getBlock(tx, ty, tz) === 0 && dim.getBlock(tx, ty - 1, tz) !== 0) {
        dim.setBlock(tx, ty, tz, BlockId.DRAGON_EGG, 0);
        dim.setBlock(x, y, z, 0, 0);
        this.ctx.particles('portal', dim, x + 0.5, y + 0.5, z + 0.5, 64);
        return;
      }
    }
  }

  /** Using the held item against a block (placing, tilling, buckets...). */
  private useItemOnBlock(held: ItemStack, t: BlockHit): boolean {
    const p = this.player;
    const dim = p.dim;
    const id = dim.getBlock(t.x, t.y, t.z);
    const meta = dim.getMeta(t.x, t.y, t.z);
    const [nx, ny, nz] = FACE_DIRS[t.face];
    const def = getItem(held.id);
    if (!def) return false;

    switch (held.id) {
      case ItemId.WOODEN_HOE: case ItemId.STONE_HOE: case ItemId.IRON_HOE: case ItemId.DIAMOND_HOE: case ItemId.GOLD_HOE:
        if ((id === BlockId.GRASS || id === BlockId.DIRT) && t.face !== 3 && dim.getBlock(t.x, t.y + 1, t.z) === 0) {
          dim.setBlock(t.x, t.y, t.z, BlockId.FARMLAND, 0);
          this.ctx.playSound('step.gravel', t.x + 0.5, t.y + 0.5, t.z + 0.5, 1, 0.8);
          this.damageHeld(1);
          if (id === BlockId.GRASS && this.ctx.random() < 0.125) this.ctx.dropStack(dim, t.x + 0.5, t.y + 1.2, t.z + 0.5, createStack(ItemId.SEEDS));
          return true;
        }
        return false;
      case ItemId.FLINT_AND_STEEL: {
        const fx = t.x + nx; const fy = t.y + ny; const fz = t.z + nz;
        if (id === BlockId.OBSIDIAN && dim.getBlock(fx, fy, fz) === 0 && tryCreateNetherPortal(dim, fx, fy, fz)) {
          this.ctx.playSound('fire.ignite', fx + 0.5, fy + 0.5, fz + 0.5, 1, 1);
          this.damageHeld(1);
          return true;
        }
        if (dim.getBlock(fx, fy, fz) === 0) {
          dim.setBlock(fx, fy, fz, BlockId.FIRE, 0);
          if (dim.getBlock(fx, fy - 1, fz) === BlockId.OBSIDIAN) tryCreateNetherPortal(dim, fx, fy, fz);
          this.ctx.playSound('fire.ignite', fx + 0.5, fy + 0.5, fz + 0.5, 1, 1);
          this.damageHeld(1);
          return true;
        }
        return false;
      }
      case ItemId.DYE:
        if (held.meta === DyeMeta.BONE_MEAL) return this.boneMeal(dim, t.x, t.y, t.z, id, meta);
        return false;
      case ItemId.EYE_OF_ENDER:
        if (id === BlockId.END_PORTAL_FRAME && (meta & FRAME_EYE) === 0) {
          dim.setMeta(t.x, t.y, t.z, meta | FRAME_EYE);
          this.consume();
          this.ctx.particles('portal', dim, t.x + 0.5, t.y + 1, t.z + 0.5, 16);
          if (tryActivateEndPortal(dim, t.x, t.y, t.z)) this.ctx.playSound('portal.activate', t.x, t.y, t.z, 1, 1);
          return true;
        }
        return false;
      case ItemId.WATER_BUCKET:
      case ItemId.LAVA_BUCKET: {
        let px = t.x; let py = t.y; let pz = t.z;
        if (!REPLACEABLE[id]) { px += nx; py += ny; pz += nz; }
        const cur = dim.getBlock(px, py, pz);
        if (cur !== 0 && !REPLACEABLE[cur] && !IS_FLUID[cur]) return false;
        if (held.id === ItemId.WATER_BUCKET && dim.id === Dim.NETHER) {
          this.ctx.playSound('fire.fizz', px + 0.5, py + 0.5, pz + 0.5, 0.5, 2.6);
          this.ctx.particles('smoke', dim, px + 0.5, py + 0.5, pz + 0.5, 8);
        } else {
          if (cur !== 0 && !IS_FLUID[cur]) this.host.behaviors.dropBlock(dim, px, py, pz, cur, dim.getMeta(px, py, pz));
          dim.setBlock(px, py, pz, held.id === ItemId.WATER_BUCKET ? BlockId.WATER : BlockId.LAVA, 0);
          dim.scheduleTick(px, py, pz, 5);
          this.ctx.playSound('liquid.splash', px + 0.5, py + 0.5, pz + 0.5, 0.5, 1);
        }
        if (!p.creative) p.inventory.held = createStack(ItemId.BUCKET);
        return true;
      }
      case ItemId.MINECART:
        if (id === BlockId.RAIL || id === BlockId.POWERED_RAIL || id === BlockId.DETECTOR_RAIL) {
          this.host.spawnVehicle('minecart', t.x + 0.5, t.y + 0.1, t.z + 0.5);
          this.consume();
          return true;
        }
        return false;
      case ItemId.SIGN: {
        if (t.face === 3) return false;
        const px = t.x + nx; const py = t.y + ny; const pz = t.z + nz;
        if (dim.getBlock(px, py, pz) !== 0 && !REPLACEABLE[dim.getBlock(px, py, pz)]) return false;
        if (t.face === 2) dim.setBlock(px, py, pz, BlockId.SIGN, placementMeta(BlockId.SIGN, 0, { yaw: p.yaw, pitch: p.pitch, face: t.face, hitY: 0 }));
        else dim.setBlock(px, py, pz, BlockId.WALL_SIGN, placementMeta(BlockId.LADDER, 0, { yaw: p.yaw, pitch: p.pitch, face: t.face, hitY: 0 }));
        dim.getOrCreateTile('sign', px, py, pz);
        this.consume();
        this.host.openScreen({ kind: 'sign', x: px, y: py, z: pz });
        return true;
      }
      case ItemId.WOODEN_DOOR_ITEM:
      case ItemId.IRON_DOOR_ITEM: {
        if (t.face !== 2) return false;
        const px = t.x; const py = t.y + 1; const pz = t.z;
        const block = held.id === ItemId.WOODEN_DOOR_ITEM ? BlockId.WOODEN_DOOR : BlockId.IRON_DOOR;
        if (!isFree(dim, px, py, pz) || !isFree(dim, px, py + 1, pz)) return false;
        if (this.entityBlocks(px, py, pz, 2)) return false;
        const m = doorMeta(p.yaw);
        dim.setBlock(px, py, pz, block, m, false);
        dim.setBlock(px, py + 1, pz, block, m | DOOR_UPPER);
        dim.notifyNeighbors(px, py, pz);
        this.placeSound(block, px, py, pz);
        this.consume();
        return true;
      }
      case ItemId.BED_ITEM: {
        if (t.face !== 2) return false;
        const px = t.x; const py = t.y + 1; const pz = t.z;
        const dir = facingAwayFromPlayer(p.yaw);
        const [fx, fz] = [[0, 1], [-1, 0], [0, -1], [1, 0]][dir];
        if (!isFree(dim, px, py, pz) || !isFree(dim, px + fx, py, pz + fz)) return false;
        if (!getBlock(dim.getBlock(px + fx, py - 1, pz + fz)).solid) return false;
        dim.setBlock(px, py, pz, BlockId.BED, dir, false);
        dim.setBlock(px + fx, py, pz + fz, BlockId.BED, dir | BED_HEAD);
        this.placeSound(BlockId.PLANKS, px, py, pz);
        this.consume();
        return true;
      }
      default:
        break;
    }
    const block = def.placeBlock;
    if (block) return this.placeBlock(held, block, t);
    return false;
  }

  private boneMeal(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): boolean {
    let used = false;
    if (id === BlockId.SAPLING) {
      used = true;
      this.host.behaviors.growTree(dim, x, y, z, meta & 3);
    } else if (id === BlockId.WHEAT_CROP && meta < 7) {
      used = true;
      dim.setMeta(x, y, z, 7);
    } else if ((id === BlockId.PUMPKIN_STEM || id === BlockId.MELON_STEM) && meta < 7) {
      used = true;
      dim.setMeta(x, y, z, 7);
    } else if (id === BlockId.BROWN_MUSHROOM || id === BlockId.RED_MUSHROOM) {
      used = true;
      if (this.ctx.random() < 0.4) this.host.behaviors.growMushroom(dim, x, y, z, id === BlockId.RED_MUSHROOM);
    } else if (id === BlockId.GRASS) {
      used = true;
      for (let i = 0; i < 64; i++) {
        let tx = x; let ty = y + 1; let tz = z;
        let ok = true;
        for (let j = 0; j < i / 16; j++) {
          tx += Math.floor(this.ctx.random() * 3) - 1;
          ty += Math.floor((Math.floor(this.ctx.random() * 3) - 1) * Math.floor(this.ctx.random() * 3) / 2);
          tz += Math.floor(this.ctx.random() * 3) - 1;
          if (dim.getBlock(tx, ty - 1, tz) !== BlockId.GRASS || getBlock(dim.getBlock(tx, ty, tz)).solid) { ok = false; break; }
        }
        if (!ok || dim.getBlock(tx, ty, tz) !== 0) continue;
        const r = this.ctx.random();
        if (r < 0.1) dim.setBlock(tx, ty, tz, this.ctx.random() < 0.25 ? BlockId.ROSE : BlockId.DANDELION, 0);
        else dim.setBlock(tx, ty, tz, BlockId.TALL_GRASS, 1);
      }
    }
    if (used) {
      this.consume();
      this.ctx.particles('heart', dim, x + 0.5, y + 1, z + 0.5, 0);
      this.ctx.particles('spell', dim, x + 0.5, y + 0.8, z + 0.5, 6, { color: [0.4, 1, 0.4] });
    }
    return used;
  }

  /** Is a colliding entity occupying the given block cells? */
  private entityBlocks(x: number, y: number, z: number, height = 1): boolean {
    const box = new AABB(x, y, z, x + 1, y + height, z + 1);
    for (const e of this.ctx.entitiesIn(this.player.dim)) {
      if (e.removed || e.type === 'item' || e.type === 'xp' || e.type === 'arrow' || e.type === 'throwable') continue;
      if ((e as LivingEntity).dead) continue;
      if (e.box.intersects(box)) return true;
    }
    return false;
  }

  private placeBlock(held: ItemStack, block: number, t: BlockHit): boolean {
    const p = this.player;
    const dim = p.dim;
    const hitId = dim.getBlock(t.x, t.y, t.z);
    const hitMeta = dim.getMeta(t.x, t.y, t.z);
    const [nx, ny, nz] = FACE_DIRS[t.face];
    // Slab onto matching slab -> double slab.
    if (block === BlockId.SLAB && hitId === BlockId.SLAB && (hitMeta & 7) === (held.meta & 7)) {
      const top = (hitMeta & SLAB_TOP) !== 0;
      if ((t.face === 2 && !top) || (t.face === 3 && top)) {
        if (this.entityBlocks(t.x, t.y, t.z)) return false;
        dim.setBlock(t.x, t.y, t.z, BlockId.DOUBLE_SLAB, held.meta & 7);
        this.placeSound(block, t.x, t.y, t.z);
        this.consume();
        return true;
      }
    }
    let px = t.x; let py = t.y; let pz = t.z;
    let face = t.face;
    if (!REPLACEABLE[hitId] || hitId === block) {
      px += nx; py += ny; pz += nz;
    } else {
      face = 2;
    }
    if (py < 0 || py >= 128) return false;
    const cur = dim.getBlock(px, py, pz);
    if (block === BlockId.SLAB && cur === BlockId.SLAB && (dim.getMeta(px, py, pz) & 7) === (held.meta & 7)) {
      dim.setBlock(px, py, pz, BlockId.DOUBLE_SLAB, held.meta & 7);
      this.placeSound(block, px, py, pz);
      this.consume();
      return true;
    }
    if (cur !== 0 && !REPLACEABLE[cur]) return false;
    if (block === BlockId.LILY_PAD) {
      // Lily pads go on top of water, targeted through the surface.
      return false;
    }
    const hitY = t.py - t.y;
    const meta = placementMeta(block, held.meta, { yaw: p.yaw, pitch: p.pitch, face, hitY });
    if (!canStay(dim, block, meta, px, py, pz)) return false;
    const def = getBlock(block);
    if (def.collides) {
      const boxes = collisionBoxes(block, meta);
      for (const b of boxes) {
        const box = new AABB(px + b.minX, py + b.minY, pz + b.minZ, px + b.maxX, py + b.maxY, pz + b.maxZ);
        for (const e of this.ctx.entitiesIn(dim)) {
          if (e.removed || e.type === 'item' || e.type === 'xp' || e.type === 'arrow' || (e as LivingEntity).dead) continue;
          if (e.box.intersects(box)) return false;
        }
      }
    }
    if (cur !== 0 && IS_FLUID[cur] === 0 && cur !== BlockId.SNOW_LAYER) this.host.behaviors.dropBlock(dim, px, py, pz, cur, dim.getMeta(px, py, pz));
    dim.setBlock(px, py, pz, block, meta);
    // Tile entities for containers.
    if (block === BlockId.CHEST) dim.getOrCreateTile('chest', px, py, pz);
    if (block === BlockId.FURNACE) dim.getOrCreateTile('furnace', px, py, pz);
    if (block === BlockId.BREWING_STAND) dim.getOrCreateTile('brewing', px, py, pz);
    if (block === BlockId.NOTE_BLOCK) dim.getOrCreateTile('note', px, py, pz);
    // Pumpkin + snow golems / iron golems are later-era features and are omitted.
    this.placeSound(block, px, py, pz);
    this.consume();
    return true;
  }

  private placeSound(block: number, x: number, y: number, z: number): void {
    this.ctx.playSound(`dig.${soundGroup(getBlock(block))}`, x + 0.5, y + 0.5, z + 0.5, 1, 0.8);
  }

  private consume(): void {
    const p = this.player;
    if (!p.creative) p.inventory.consumeHeld(1);
  }

  /** Using the held item without a block target (or when the block ignored it). */
  private useItemInAir(held: ItemStack): void {
    const p = this.player;
    const def = getItem(held.id);
    if (!def) return;
    if (def.food && p.canEat(def.food.alwaysEdible)) {
      this.startUsing(held);
      return;
    }
    switch (held.id) {
      case ItemId.BOW:
        if (p.creative || p.inventory.count(ItemId.ARROW) > 0 || hasEnchant(held, Enchantment.INFINITY)) this.startUsing(held);
        return;
      case ItemId.POTION:
        if (held.meta & POTION_SPLASH) {
          const t = new Throwable('potion');
          t.potionMeta = held.meta;
          t.throwFrom(p, 0.5, -0.35);
          this.ctx.spawn(t, p.dim);
          this.ctx.playSound('random.bow', p.x, p.y, p.z, 0.5, 0.4);
          this.consume();
        } else {
          this.startUsing(held);
        }
        return;
      case ItemId.MILK_BUCKET:
        this.startUsing(held);
        return;
      case ItemId.SNOWBALL:
      case ItemId.EGG:
      case ItemId.ENDER_PEARL: {
        if (held.id === ItemId.ENDER_PEARL && p.creative) return;
        const kind = held.id === ItemId.SNOWBALL ? 'snowball' : held.id === ItemId.EGG ? 'egg' : 'ender_pearl';
        const t = new Throwable(kind);
        t.throwFrom(p, 1.5);
        this.ctx.spawn(t, p.dim);
        this.ctx.playSound('random.bow', p.x, p.y, p.z, 0.5, 0.4);
        p.swing();
        this.consume();
        return;
      }
      case ItemId.EYE_OF_ENDER: {
        if (p.dim.id !== Dim.OVERWORLD) return;
        const target = this.host.nearestStronghold(p.x, p.z);
        if (!target) return;
        const eye = new EyeOfEnderSignal();
        eye.dim = p.dim;
        eye.setPosition(p.x, p.y + p.eyeHeight - 0.2, p.z);
        eye.moveTowards(target[0], target[1], p.y + p.eyeHeight);
        this.ctx.spawn(eye, p.dim);
        this.ctx.playSound('random.bow', p.x, p.y, p.z, 0.5, 0.4);
        p.swing();
        this.consume();
        return;
      }
      case ItemId.BUCKET: {
        const [dx, dy, dz] = p.lookVector();
        const hit = raycastBlocks(p.dim, p.x, p.y + p.eyeHeight, p.z, dx, dy, dz, 5, true);
        if (!hit || !IS_FLUID[hit.id] || hit.meta !== 0) return;
        const water = IS_FLUID[hit.id] === 1;
        p.dim.setBlock(hit.x, hit.y, hit.z, 0, 0);
        this.giveOrReplace(createStack(water ? ItemId.WATER_BUCKET : ItemId.LAVA_BUCKET));
        this.ctx.playSound('liquid.splash', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0.5, 1);
        return;
      }
      case BlockId.LILY_PAD: {
        const [dx, dy, dz] = p.lookVector();
        const hit = raycastBlocks(p.dim, p.x, p.y + p.eyeHeight, p.z, dx, dy, dz, 5, true);
        if (!hit || IS_FLUID[hit.id] !== 1 || hit.meta !== 0) return;
        if (p.dim.getBlock(hit.x, hit.y + 1, hit.z) !== 0) return;
        p.dim.setBlock(hit.x, hit.y + 1, hit.z, BlockId.LILY_PAD, 0);
        this.consume();
        return;
      }
      case ItemId.BOAT: {
        const [dx, dy, dz] = p.lookVector();
        const hit = raycastBlocks(p.dim, p.x, p.y + p.eyeHeight, p.z, dx, dy, dz, 5, true);
        if (!hit) return;
        const onWater = IS_FLUID[hit.id] === 1;
        this.host.spawnVehicle('boat', hit.x + 0.5, hit.y + (onWater ? 0.9 : 1), hit.z + 0.5);
        this.consume();
        return;
      }
      case ItemId.FISHING_ROD:
        this.host.castFishingRod();
        p.swing();
        return;
      default:
        return;
    }
  }

  // -------------------------------------------------------------------------
  // Continuous use (food, potions, bow)
  // -------------------------------------------------------------------------
  private startUsing(held: ItemStack): void {
    this.useItem = held;
    this.useTicks = 0;
    this.player.usingItem = true;
  }

  private continueUsing(): void {
    const p = this.player;
    const held = p.inventory.held;
    if (!held || !this.useItem || held.id !== this.useItem.id) {
      this.stopUsing(false);
      return;
    }
    this.useTicks++;
    p.itemUseTicks = this.useTicks;
    const def = getItem(held.id);
    const isBow = held.id === ItemId.BOW;
    if (!isBow && this.useTicks % 4 === 0) {
      this.ctx.playSound(held.id === ItemId.POTION || held.id === ItemId.MILK_BUCKET ? 'random.drink' : 'random.eat', p.x, p.y, p.z, 0.5, 1 + (this.ctx.random() - 0.5) * 0.2);
      if (def?.food) this.ctx.particles('block', p.dim, p.x - Math.sin(p.yaw) * 0.4, p.y + p.eyeHeight - 0.2, p.z - Math.cos(p.yaw) * 0.4, 3, { blockId: BlockId.DIRT, spread: 0.05 });
    }
    if (!isBow && this.useTicks >= 32) this.finishUsing();
  }

  private finishUsing(): void {
    const p = this.player;
    const held = p.inventory.held;
    if (!held) return;
    const def = getItem(held.id);
    if (def?.food) {
      p.eat(def.food.hunger, def.food.saturation);
      const eff = def.food.effect;
      if (eff && this.ctx.random() < eff[3]) p.addEffect({ id: eff[0], duration: eff[1] * 20, amplifier: eff[2] });
      this.ctx.playSound('random.burp', p.x, p.y, p.z, 0.5, 1);
      if (def.food.remainder) {
        this.consume();
        const left = p.inventory.addItem(createStack(def.food.remainder));
        if (left) this.ctx.dropStack(p.dim, p.x, p.y + 1, p.z, left);
      } else {
        this.consume();
      }
    } else if (held.id === ItemId.POTION) {
      for (const e of potionEffects(held.meta)) p.addEffect({ id: e.id, duration: e.duration, amplifier: e.amplifier });
      if (!p.creative) p.inventory.held = createStack(ItemId.GLASS_BOTTLE);
      void PotionKind;
    } else if (held.id === ItemId.MILK_BUCKET) {
      p.effects.clear();
      if (!p.creative) p.inventory.held = createStack(ItemId.BUCKET);
    }
    this.useItem = null;
    this.useTicks = 0;
    p.usingItem = false;
  }

  private stopUsing(release: boolean): void {
    const p = this.player;
    if (release && this.useItem?.id === ItemId.BOW) this.releaseBow();
    this.useItem = null;
    this.useTicks = 0;
    p.usingItem = false;
    p.itemUseTicks = 0;
  }

  /** Classic bow charge curve and arrow launch. */
  private releaseBow(): void {
    const p = this.player;
    const bow = p.inventory.held;
    if (!bow || bow.id !== ItemId.BOW) return;
    let f = this.useTicks / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    if (f > 1) f = 1;
    const infinite = p.creative || hasEnchant(bow, Enchantment.INFINITY) > 0;
    if (!infinite && p.inventory.count(ItemId.ARROW) <= 0) return;
    const arrow = new Arrow();
    arrow.dim = p.dim;
    arrow.shooter = p;
    arrow.setPosition(p.x - Math.cos(p.yaw) * 0.16, p.y + p.eyeHeight - 0.1, p.z + Math.sin(p.yaw) * 0.16);
    const [lx, ly, lz] = p.lookVector();
    arrow.shoot(lx, ly, lz, f * 3, 1);
    if (f >= 1) arrow.critical = true;
    const power = hasEnchant(bow, Enchantment.POWER);
    if (power > 0) arrow.damageBase += power * 0.5 + 0.5;
    arrow.knockbackStrength = hasEnchant(bow, Enchantment.PUNCH);
    if (hasEnchant(bow, Enchantment.FLAME) > 0) { arrow.onFire = true; arrow.setFire(100); }
    arrow.pickupable = !infinite;
    this.ctx.spawn(arrow, p.dim);
    this.ctx.playSound('random.bow', p.x, p.y, p.z, 1, 1 / (0.8 + this.ctx.random() * 0.4) + f * 0.5);
    if (!infinite) p.inventory.remove(ItemId.ARROW, 1);
    this.damageHeld(1);
  }

  /** Bow draw fraction for rendering. */
  get bowPull(): number {
    if (this.useItem?.id !== ItemId.BOW) return 0;
    return Math.min(1, this.useTicks / 20);
  }
}

function isFree(dim: Dimension, x: number, y: number, z: number): boolean {
  const id = dim.getBlock(x, y, z);
  return id === 0 || REPLACEABLE[id] === 1;
}

/** Material sound group for footsteps and digging. */
export function soundGroup(def: BlockDefinition): string {
  switch (def.id) {
    case BlockId.GRASS: case BlockId.LEAVES: case BlockId.TALL_GRASS: case BlockId.SAPLING: case BlockId.MYCELIUM:
    case BlockId.DANDELION: case BlockId.ROSE: case BlockId.WHEAT_CROP: case BlockId.SUGAR_CANE: case BlockId.TNT:
    case BlockId.LILY_PAD: case BlockId.CACTUS:
      return 'grass';
    case BlockId.DIRT: case BlockId.GRAVEL: case BlockId.FARMLAND: case BlockId.CLAY:
      return 'gravel';
    case BlockId.SAND: case BlockId.SOUL_SAND:
      return 'sand';
    case BlockId.SNOW_BLOCK: case BlockId.SNOW_LAYER:
      return 'snow';
    case BlockId.WOOL: case BlockId.CAKE: case BlockId.SPONGE:
      return 'cloth';
    case BlockId.GLASS: case BlockId.GLASS_PANE: case BlockId.ICE: case BlockId.GLOWSTONE:
      return 'glass';
    case BlockId.LADDER:
      return 'wood';
    default:
      if (def.toolCategory === 'axe') return 'wood';
      return 'stone';
  }
}

function randomLike(ctx: GameContext): import('../core/rng').Random {
  return { next: () => ctx.random(), int: (n: number) => Math.floor(ctx.random() * n), range: (a: number, b: number) => a + Math.floor(ctx.random() * (b - a + 1)), chance: (p: number) => ctx.random() < p } as unknown as import('../core/rng').Random;
}

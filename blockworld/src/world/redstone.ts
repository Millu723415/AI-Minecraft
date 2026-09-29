/**
 * Redstone simulation in the spirit of the 2011 rules.
 *
 * Power sources: levers, buttons, pressure plates, redstone torches,
 * repeaters and detector rails. Dust carries power 15 -> 0 with one step of
 * loss per block, climbs and descends block sides, powers the block beneath
 * it and the block it points into. Solid opaque cubes conduct: "strongly"
 * powered blocks (by a torch below, an attached lever/button, a plate on top
 * or a repeater) also power neighbouring dust, while dust-powered blocks only
 * power mechanisms. Consumers: dust, torches (invert their support block),
 * repeaters, doors, trapdoors, pistons, TNT, note blocks and powered rails.
 */

import { BlockId } from '../blocks/ids';
import { ATTACH_DIR, DOOR_OPEN, DOOR_UPPER, FACING4_DIR, PISTON_EXTENDED, RAIL_POWERED } from '../blocks/meta';
import { COLLIDES, IS_FLUID, getBlock } from '../blocks/registry';
import type { GameContext } from '../game/context';
import { LivingEntity } from '../entity/living';
import type { Entity } from '../entity/entity';
import type { Dimension } from './dimension';
import { CONDUCTOR, HDIRS, wirePointsMask, wireShape } from './redstonelogic';

const DIRS6: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];
/** Piston face index -> direction (0 +X, 1 -X, 2 +Y, 3 -Y, 4 +Z, 5 -Z). */
const FACE_VEC = DIRS6;

const WIRE = BlockId.REDSTONE_WIRE;
const MAX_PUSH = 12;

const SOURCES = new Set<number>([
  BlockId.LEVER, BlockId.STONE_BUTTON, BlockId.WOODEN_BUTTON, BlockId.STONE_PRESSURE_PLATE,
  BlockId.WOODEN_PRESSURE_PLATE, BlockId.DETECTOR_RAIL, BlockId.REDSTONE_TORCH, BlockId.REDSTONE_TORCH_OFF,
  BlockId.REPEATER_ON, BlockId.REPEATER_OFF,
]);

const IMMOVABLE = new Set<number>([
  BlockId.OBSIDIAN, BlockId.BEDROCK, BlockId.PISTON_HEAD, BlockId.CHEST, BlockId.FURNACE, BlockId.LIT_FURNACE,
  BlockId.SPAWNER, BlockId.BREWING_STAND, BlockId.ENCHANTING_TABLE, BlockId.NOTE_BLOCK, BlockId.JUKEBOX,
  BlockId.SIGN, BlockId.WALL_SIGN, BlockId.END_PORTAL_FRAME, BlockId.END_PORTAL, BlockId.NETHER_PORTAL,
]);

const BREAK_ON_PUSH = new Set<number>([
  BlockId.CACTUS, BlockId.COBWEB, BlockId.BED, BlockId.CAKE, BlockId.LADDER, BlockId.WOODEN_DOOR, BlockId.IRON_DOOR,
  BlockId.SUGAR_CANE, BlockId.FIRE, BlockId.SNOW_LAYER, BlockId.LILY_PAD, BlockId.PUMPKIN_STEM, BlockId.MELON_STEM,
  BlockId.DRAGON_EGG,
]);

type PushMode = 'air' | 'break' | 'move' | 'block';

function key(dim: Dimension, x: number, y: number, z: number): string {
  return `${dim.id}:${x},${y},${z}`;
}

export class Redstone {
  private wireQueue: [Dimension, number, number, number][] = [];
  private processing = false;
  /** Last seen power state of edge-triggered mechanisms (doors, note blocks...). */
  private lastPowered = new Map<string, boolean>();
  /** Recent toggle times of each torch (burn-out protection). */
  private torchToggles = new Map<string, number[]>();
  private burnedOut = new Map<string, number>();
  /** Suppresses head/base clean-up while a piston moves its own parts. */
  private movingPiston = false;
  /** Optional hook for note blocks (set by the game). */
  playNote: ((dim: Dimension, x: number, y: number, z: number) => void) | null = null;
  /** Drops for blocks destroyed by pistons (set by the game). */
  dropBlock: ((dim: Dimension, x: number, y: number, z: number, id: number, meta: number) => void) | null = null;

  constructor(readonly ctx: GameContext) {}

  // ===========================================================================
  // Power queries
  // ===========================================================================

  /** Power (0..15) that the component at s provides directly into the adjacent position t. */
  emitsInto(dim: Dimension, sx: number, sy: number, sz: number, tx: number, ty: number, tz: number): number {
    const id = dim.getBlock(sx, sy, sz);
    switch (id) {
      case BlockId.LEVER:
      case BlockId.STONE_BUTTON:
      case BlockId.WOODEN_BUTTON:
        return dim.getMeta(sx, sy, sz) & 8 ? 15 : 0;
      case BlockId.STONE_PRESSURE_PLATE:
      case BlockId.WOODEN_PRESSURE_PLATE:
        return dim.getMeta(sx, sy, sz) & 1 ? 15 : 0;
      case BlockId.DETECTOR_RAIL:
        return dim.getMeta(sx, sy, sz) & RAIL_POWERED ? 15 : 0;
      case BlockId.REDSTONE_TORCH: {
        const [ax, ay, az] = ATTACH_DIR[dim.getMeta(sx, sy, sz) & 7];
        return sx + ax === tx && sy + ay === ty && sz + az === tz ? 0 : 15;
      }
      case BlockId.REPEATER_ON: {
        const [fx, fz] = FACING4_DIR[dim.getMeta(sx, sy, sz) & 3];
        return sx + fx === tx && sy === ty && sz + fz === tz ? 15 : 0;
      }
      case WIRE: {
        const p = dim.getMeta(sx, sy, sz) & 15;
        if (p === 0) return 0;
        if (ty === sy - 1 && tx === sx && tz === sz) return p;
        if (ty !== sy) return 0;
        const shape = this.shapeAt(dim, sx, sy, sz);
        const points = wirePointsMask(shape.mask);
        for (let i = 0; i < 4; i++) {
          if (!(points & (1 << i))) continue;
          if (sx + HDIRS[i][0] === tx && sz + HDIRS[i][1] === tz) return p;
        }
        return 0;
      }
      default:
        return 0;
    }
  }

  shapeAt(dim: Dimension, x: number, y: number, z: number): { mask: number; up: number } {
    return wireShape((dx, dy, dz) => dim.getBlock(x + dx, y + dy, z + dz), (dx, dy, dz) => dim.getMeta(x + dx, y + dy, z + dz));
  }

  /** Power a conductor receives from strong sources (these also drive adjacent dust). */
  strongPower(dim: Dimension, bx: number, by: number, bz: number): number {
    for (const [dx, dy, dz] of DIRS6) {
      const sx = bx + dx; const sy = by + dy; const sz = bz + dz;
      const id = dim.getBlock(sx, sy, sz);
      if (!SOURCES.has(id)) continue;
      const m = dim.getMeta(sx, sy, sz);
      switch (id) {
        case BlockId.REDSTONE_TORCH:
          if (dy === -1) return 15; // a torch strongly powers the block above it
          break;
        case BlockId.LEVER:
        case BlockId.STONE_BUTTON:
        case BlockId.WOODEN_BUTTON: {
          if (!(m & 8)) break;
          const [ax, ay, az] = ATTACH_DIR[m & 7];
          if (sx + ax === bx && sy + ay === by && sz + az === bz) return 15;
          break;
        }
        case BlockId.STONE_PRESSURE_PLATE:
        case BlockId.WOODEN_PRESSURE_PLATE:
          if (dy === 1 && (m & 1)) return 15;
          break;
        case BlockId.DETECTOR_RAIL:
          if (dy === 1 && (m & RAIL_POWERED)) return 15;
          break;
        case BlockId.REPEATER_ON: {
          const [fx, fz] = FACING4_DIR[m & 3];
          if (sx + fx === bx && sy === by && sz + fz === bz) return 15;
          break;
        }
        default:
          break;
      }
    }
    return 0;
  }

  /** Power a conductor receives from dust lying on it or pointing into it. */
  wirePowerInto(dim: Dimension, bx: number, by: number, bz: number): number {
    let best = 0;
    if (dim.getBlock(bx, by + 1, bz) === WIRE) best = dim.getMeta(bx, by + 1, bz) & 15;
    for (const [dx, dz] of HDIRS) {
      if (dim.getBlock(bx + dx, by, bz + dz) !== WIRE) continue;
      best = Math.max(best, this.emitsInto(dim, bx + dx, by, bz + dz, bx, by, bz));
    }
    return best;
  }

  blockPowered(dim: Dimension, x: number, y: number, z: number, includeWire: boolean): boolean {
    if (!CONDUCTOR[dim.getBlock(x, y, z)]) return false;
    return this.strongPower(dim, x, y, z) > 0 || (includeWire && this.wirePowerInto(dim, x, y, z) > 0);
  }

  /** Is a mechanism at (x, y, z) receiving power from any side? */
  isPoweredAt(dim: Dimension, x: number, y: number, z: number, skipFace = -1): boolean {
    for (let f = 0; f < 6; f++) {
      if (f === skipFace) continue;
      const [dx, dy, dz] = DIRS6[f];
      const nx = x + dx; const ny = y + dy; const nz = z + dz;
      if (this.emitsInto(dim, nx, ny, nz, x, y, z) > 0) return true;
      if (this.blockPowered(dim, nx, ny, nz, true)) return true;
    }
    return false;
  }

  isPowered(dim: Dimension, x: number, y: number, z: number): boolean {
    return this.isPoweredAt(dim, x, y, z);
  }

  // ===========================================================================
  // Dust
  // ===========================================================================

  private wireTarget(dim: Dimension, x: number, y: number, z: number): number {
    for (const [dx, dy, dz] of DIRS6) {
      const nx = x + dx; const ny = y + dy; const nz = z + dz;
      const id = dim.getBlock(nx, ny, nz);
      if (id === WIRE) continue;
      if (SOURCES.has(id) && this.emitsInto(dim, nx, ny, nz, x, y, z) > 0) return 15;
      if (CONDUCTOR[id] && this.strongPower(dim, nx, ny, nz) > 0) return 15;
    }
    let best = 0;
    const aboveConducts = CONDUCTOR[dim.getBlock(x, y + 1, z)] === 1;
    for (const [dx, dz] of HDIRS) {
      const nx = x + dx; const nz = z + dz;
      const n = dim.getBlock(nx, y, nz);
      if (n === WIRE) best = Math.max(best, (dim.getMeta(nx, y, nz) & 15) - 1);
      else if (!CONDUCTOR[n] && dim.getBlock(nx, y - 1, nz) === WIRE) best = Math.max(best, (dim.getMeta(nx, y - 1, nz) & 15) - 1);
      if (!aboveConducts && dim.getBlock(nx, y + 1, nz) === WIRE) best = Math.max(best, (dim.getMeta(nx, y + 1, nz) & 15) - 1);
    }
    return Math.max(0, best);
  }

  private enqueueWire(dim: Dimension, x: number, y: number, z: number): void {
    if (dim.getBlock(x, y, z) === WIRE) this.wireQueue.push([dim, x, y, z]);
  }

  /** Queue the dust connected to (x, y, z): same level and one step up/down. */
  private enqueueWireNeighbors(dim: Dimension, x: number, y: number, z: number): void {
    for (const [dx, dz] of HDIRS) {
      for (let dy = -1; dy <= 1; dy++) this.enqueueWire(dim, x + dx, y + dy, z + dz);
    }
    this.enqueueWire(dim, x, y + 1, z);
    this.enqueueWire(dim, x, y - 1, z);
  }

  private processWires(): void {
    if (this.processing) return;
    this.processing = true;
    try {
      let guard = 0;
      while (this.wireQueue.length > 0 && guard < 50) {
        guard++;
        const changed: [Dimension, number, number, number][] = [];
        const seen = new Set<string>();
        let steps = 0;
        for (let qi = 0; qi < this.wireQueue.length && steps < 30000; qi++, steps++) {
          const [dim, x, y, z] = this.wireQueue[qi];
          if (dim.getBlock(x, y, z) !== WIRE) continue;
          const cur = dim.getMeta(x, y, z) & 15;
          const target = this.wireTarget(dim, x, y, z);
          if (target === cur) continue;
          dim.setBlock(x, y, z, WIRE, target, false);
          const k = key(dim, x, y, z);
          if (!seen.has(k)) { seen.add(k); changed.push([dim, x, y, z]); }
          this.enqueueWireNeighbors(dim, x, y, z);
        }
        this.wireQueue = [];
        // Let mechanisms near every changed wire react (two blocks out, through conductors).
        for (const [dim, x, y, z] of changed) this.notifyExtended(dim, x, y, z);
      }
    } finally {
      this.processing = false;
    }
  }

  /** Notify neighbours and the neighbours of adjacent conductors. */
  private notifyExtended(dim: Dimension, x: number, y: number, z: number): void {
    dim.notifyNeighbors(x, y, z);
    for (const [dx, dy, dz] of DIRS6) {
      if (CONDUCTOR[dim.getBlock(x + dx, y + dy, z + dz)]) dim.notifyNeighbors(x + dx, y + dy, z + dz);
    }
  }

  // ===========================================================================
  // Hooks from block behaviours
  // ===========================================================================

  onBlockChanged(dim: Dimension, x: number, y: number, z: number, oldId: number, newId: number): void {
    if (newId === WIRE || oldId === WIRE) {
      this.enqueueWire(dim, x, y, z);
      this.enqueueWireNeighbors(dim, x, y, z);
      // Shape changes alter what nearby dust points into.
      for (const [dx, dz] of HDIRS) {
        for (let dy = -1; dy <= 1; dy++) {
          if (dim.getBlock(x + dx, y + dy, z + dz) === WIRE) this.notifyExtended(dim, x + dx, y + dy, z + dz);
        }
      }
      if (oldId === WIRE && newId !== WIRE) this.notifyExtended(dim, x, y, z);
      this.processWires();
      return;
    }
    if (CONDUCTOR[oldId] !== CONDUCTOR[newId]) {
      // Diagonal dust connections depend on whether blocks conduct.
      this.enqueueWireNeighbors(dim, x, y, z);
      this.processWires();
    }
    if (SOURCES.has(newId) || SOURCES.has(oldId)) {
      this.notifyExtended(dim, x, y, z);
      if (newId === BlockId.REDSTONE_TORCH || newId === BlockId.REDSTONE_TORCH_OFF) dim.scheduleTick(x, y, z, 2);
      if (newId === BlockId.REPEATER_OFF || newId === BlockId.REPEATER_ON) this.checkRepeater(dim, x, y, z, newId);
      if (newId === BlockId.DETECTOR_RAIL && (dim.getMeta(x, y, z) & RAIL_POWERED)) dim.scheduleTick(x, y, z, 20);
      this.processWires();
    }
    if (newId === BlockId.PISTON || newId === BlockId.STICKY_PISTON) {
      if (oldId !== newId) this.updatePiston(dim, x, y, z);
    }
    if (!this.movingPiston) {
      if (oldId === BlockId.PISTON_HEAD && newId !== BlockId.PISTON_HEAD) this.headRemoved(dim, x, y, z);
      if ((oldId === BlockId.PISTON || oldId === BlockId.STICKY_PISTON) && newId !== oldId) this.baseRemoved(dim, x, y, z);
    }
    if (newId === BlockId.POWERED_RAIL && oldId !== newId) this.updatePoweredRail(dim, x, y, z);
  }

  onNeighborChanged(dim: Dimension, x: number, y: number, z: number, id: number, meta: number, _fx: number, _fy: number, _fz: number): void {
    switch (id) {
      case WIRE:
        this.enqueueWire(dim, x, y, z);
        this.processWires();
        return;
      case BlockId.REDSTONE_TORCH:
      case BlockId.REDSTONE_TORCH_OFF:
        dim.scheduleTick(x, y, z, 2);
        return;
      case BlockId.REPEATER_OFF:
      case BlockId.REPEATER_ON:
        this.checkRepeater(dim, x, y, z, id);
        return;
      case BlockId.WOODEN_DOOR:
      case BlockId.IRON_DOOR: {
        const lowerY = meta & DOOR_UPPER ? y - 1 : y;
        const powered = this.isPoweredAt(dim, x, lowerY, z) || this.isPoweredAt(dim, x, lowerY + 1, z);
        if (!this.edge(dim, x, lowerY, z, powered)) return;
        const lm = dim.getMeta(x, lowerY, z);
        const open = (lm & DOOR_OPEN) !== 0;
        if (open === powered) return;
        const nm = powered ? lm | DOOR_OPEN : lm & ~DOOR_OPEN;
        dim.setMeta(x, lowerY, z, nm);
        if (dim.getBlock(x, lowerY + 1, z) === id) dim.setMeta(x, lowerY + 1, z, (nm & 7) | DOOR_UPPER);
        this.ctx.playSound(powered ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        return;
      }
      case BlockId.TRAPDOOR: {
        const powered = this.isPoweredAt(dim, x, y, z);
        if (!this.edge(dim, x, y, z, powered)) return;
        if (((meta & 4) !== 0) === powered) return;
        dim.setMeta(x, y, z, powered ? meta | 4 : meta & ~4);
        this.ctx.playSound(powered ? 'door.open' : 'door.close', x + 0.5, y + 0.5, z + 0.5, 1, 1);
        return;
      }
      case BlockId.NOTE_BLOCK: {
        const powered = this.isPoweredAt(dim, x, y, z);
        if (this.edge(dim, x, y, z, powered) && powered) this.playNote?.(dim, x, y, z);
        return;
      }
      case BlockId.PISTON:
      case BlockId.STICKY_PISTON:
        this.updatePiston(dim, x, y, z);
        return;
      case BlockId.POWERED_RAIL:
        this.updatePoweredRail(dim, x, y, z);
        return;
      default:
        return;
    }
  }

  /** Record a mechanism's power state; true when it changed. */
  private edge(dim: Dimension, x: number, y: number, z: number, powered: boolean): boolean {
    const k = key(dim, x, y, z);
    const prev = this.lastPowered.get(k) ?? false;
    if (prev === powered) return false;
    if (powered) this.lastPowered.set(k, true); else this.lastPowered.delete(k);
    return true;
  }

  scheduledTick(dim: Dimension, x: number, y: number, z: number, id: number): void {
    const meta = dim.getMeta(x, y, z);
    switch (id) {
      case BlockId.REDSTONE_TORCH:
      case BlockId.REDSTONE_TORCH_OFF:
        this.tickTorch(dim, x, y, z, id, meta);
        return;
      case BlockId.REPEATER_OFF:
      case BlockId.REPEATER_ON:
        this.tickRepeater(dim, x, y, z, id, meta);
        return;
      case BlockId.STONE_BUTTON:
      case BlockId.WOODEN_BUTTON:
        if (meta & 8) {
          dim.setMeta(x, y, z, meta & 7);
          this.ctx.playSound('random.click', x + 0.5, y + 0.5, z + 0.5, 0.3, 0.5);
        }
        return;
      case BlockId.STONE_PRESSURE_PLATE:
      case BlockId.WOODEN_PRESSURE_PLATE:
        if (!(meta & 1)) return;
        if (this.plateOccupied(dim, x, y, z, id)) dim.scheduleTick(x, y, z, 20);
        else {
          dim.setMeta(x, y, z, 0);
          this.ctx.playSound('random.click', x + 0.5, y + 0.1, z + 0.5, 0.3, 0.5);
        }
        return;
      case BlockId.DETECTOR_RAIL:
        if (!(meta & RAIL_POWERED)) return;
        if (this.entitiesIn(dim, x, y, z, 0.2, (e) => e.type === 'minecart')) dim.scheduleTick(x, y, z, 20);
        else dim.setMeta(x, y, z, meta & ~RAIL_POWERED);
        return;
      default:
        return;
    }
  }

  /** Per-tick work: pressure plates notice entities standing on them. */
  tick(dim: Dimension): void {
    for (const e of this.ctx.entitiesIn(dim)) {
      if (e.removed) continue;
      const bx = Math.floor(e.x); const by = Math.floor(e.y + 0.01); const bz = Math.floor(e.z);
      const id = dim.getBlock(bx, by, bz);
      if (id !== BlockId.STONE_PRESSURE_PLATE && id !== BlockId.WOODEN_PRESSURE_PLATE) continue;
      if (id === BlockId.STONE_PRESSURE_PLATE && !(e instanceof LivingEntity)) continue;
      const meta = dim.getMeta(bx, by, bz);
      if (meta & 1) continue;
      dim.setMeta(bx, by, bz, 1);
      this.ctx.playSound('random.click', bx + 0.5, by + 0.1, bz + 0.5, 0.3, 0.6);
      dim.scheduleTick(bx, by, bz, 20);
    }
  }

  private plateOccupied(dim: Dimension, x: number, y: number, z: number, id: number): boolean {
    return this.entitiesIn(dim, x, y, z, 0.25, (e) => id === BlockId.WOODEN_PRESSURE_PLATE || e instanceof LivingEntity);
  }

  private entitiesIn(dim: Dimension, x: number, y: number, z: number, height: number, pred: (e: Entity) => boolean): boolean {
    for (const e of this.ctx.entitiesIn(dim)) {
      if (e.removed || !pred(e)) continue;
      const b = e.box;
      if (b.maxX > x && b.minX < x + 1 && b.maxZ > z && b.minZ < z + 1 && b.maxY > y && b.minY < y + height + 0.01) return true;
    }
    return false;
  }

  // ===========================================================================
  // Torches
  // ===========================================================================

  private tickTorch(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): void {
    const [ax, ay, az] = ATTACH_DIR[meta & 7];
    const powered = this.blockPowered(dim, x + ax, y + ay, z + az, true);
    const k = key(dim, x, y, z);
    const now = this.ctx.tickCount;
    const burnt = this.burnedOut.get(k);
    if (burnt !== undefined) {
      if (now < burnt) { dim.scheduleTick(x, y, z, burnt - now); return; }
      this.burnedOut.delete(k);
    }
    if (id === BlockId.REDSTONE_TORCH && powered) {
      const list = (this.torchToggles.get(k) ?? []).filter((t) => now - t < 60);
      list.push(now);
      this.torchToggles.set(k, list);
      dim.setBlock(x, y, z, BlockId.REDSTONE_TORCH_OFF, meta);
      if (list.length > 8) {
        // Burn out: a torch toggled too quickly stays dark for a while.
        this.burnedOut.set(k, now + 160);
        this.torchToggles.delete(k);
        this.ctx.playSound('fire.fizz', x + 0.5, y + 0.5, z + 0.5, 0.5, 2.6);
        this.ctx.particles('smoke', dim, x + 0.5, y + 0.7, z + 0.5, 5);
      }
    } else if (id === BlockId.REDSTONE_TORCH_OFF && !powered) {
      dim.setBlock(x, y, z, BlockId.REDSTONE_TORCH, meta);
    }
  }

  // ===========================================================================
  // Repeaters
  // ===========================================================================

  private repeaterInput(dim: Dimension, x: number, y: number, z: number, meta: number): boolean {
    const [fx, fz] = FACING4_DIR[meta & 3];
    const bx = x - fx; const bz = z - fz;
    const id = dim.getBlock(bx, y, bz);
    if (id === WIRE) return (dim.getMeta(bx, y, bz) & 15) > 0;
    if (this.emitsInto(dim, bx, y, bz, x, y, z) > 0) return true;
    return this.blockPowered(dim, bx, y, bz, true);
  }

  private repeaterDelay(meta: number): number {
    return (((meta >> 2) & 3) + 1) * 2;
  }

  private checkRepeater(dim: Dimension, x: number, y: number, z: number, id: number): void {
    const meta = dim.getMeta(x, y, z);
    const input = this.repeaterInput(dim, x, y, z, meta);
    if (input !== (id === BlockId.REPEATER_ON)) dim.scheduleTick(x, y, z, this.repeaterDelay(meta));
  }

  private tickRepeater(dim: Dimension, x: number, y: number, z: number, id: number, meta: number): void {
    const input = this.repeaterInput(dim, x, y, z, meta);
    if (id === BlockId.REPEATER_ON && !input) {
      dim.setBlock(x, y, z, BlockId.REPEATER_OFF, meta);
    } else if (id === BlockId.REPEATER_OFF) {
      dim.setBlock(x, y, z, BlockId.REPEATER_ON, meta);
      // A short pulse still lasts one full delay, then switches off.
      if (!input) dim.scheduleTick(x, y, z, this.repeaterDelay(meta));
    }
  }

  // ===========================================================================
  // Powered rails
  // ===========================================================================

  private railAxis(meta: number): 'x' | 'z' | null {
    const s = meta & 7;
    if (s === 0 || s === 4 || s === 5) return 'z';
    if (s === 1 || s === 2 || s === 3) return 'x';
    return null;
  }

  private railDirect(dim: Dimension, x: number, y: number, z: number): boolean {
    return this.isPoweredAt(dim, x, y, z) || this.isPoweredAt(dim, x, y + 1, z);
  }

  private updatePoweredRail(dim: Dimension, x: number, y: number, z: number): void {
    const meta = dim.getMeta(x, y, z);
    const axis = this.railAxis(meta);
    let powered = this.railDirect(dim, x, y, z);
    if (!powered && axis) {
      const [ax, az] = axis === 'x' ? [1, 0] : [0, 1];
      for (const s of [1, -1]) {
        let cx = x; let cy = y; let cz = z;
        for (let k = 1; k <= 8 && !powered; k++) {
          cx += ax * s; cz += az * s;
          let found = false;
          for (const dy of [0, 1, -1]) {
            if (dim.getBlock(cx, cy + dy, cz) !== BlockId.POWERED_RAIL) continue;
            if (this.railAxis(dim.getMeta(cx, cy + dy, cz)) !== axis) continue;
            cy += dy; found = true; break;
          }
          if (!found) break;
          if (this.railDirect(dim, cx, cy, cz)) powered = true;
        }
      }
    }
    const now = (meta & RAIL_POWERED) !== 0;
    if (now !== powered) dim.setMeta(x, y, z, powered ? meta | RAIL_POWERED : meta & ~RAIL_POWERED);
  }

  // ===========================================================================
  // Pistons
  // ===========================================================================

  private pistonPowered(dim: Dimension, x: number, y: number, z: number, face: number): boolean {
    if (this.isPoweredAt(dim, x, y, z, face)) return true;
    // Classic quirk: the position above the piston also counts.
    return face !== 2 && this.isPoweredAt(dim, x, y + 1, z);
  }

  private pushMode(dim: Dimension, x: number, y: number, z: number): PushMode {
    if (y < 0 || y >= 128) return 'block';
    const id = dim.getBlock(x, y, z);
    if (id === 0 || IS_FLUID[id]) return 'air';
    if (IMMOVABLE.has(id)) return 'block';
    const def = getBlock(id);
    if (def.hardness < 0) return 'block';
    if ((id === BlockId.PISTON || id === BlockId.STICKY_PISTON) && (dim.getMeta(x, y, z) & PISTON_EXTENDED)) return 'block';
    if (!COLLIDES[id] || def.needsSupport || BREAK_ON_PUSH.has(id) || def.replaceable) return 'break';
    return 'move';
  }

  private updatePiston(dim: Dimension, x: number, y: number, z: number): void {
    const id = dim.getBlock(x, y, z);
    if (id !== BlockId.PISTON && id !== BlockId.STICKY_PISTON) return;
    const meta = dim.getMeta(x, y, z);
    const face = meta & 7;
    if (face > 5) return;
    const powered = this.pistonPowered(dim, x, y, z, face);
    const extended = (meta & PISTON_EXTENDED) !== 0;
    if (powered && !extended) this.extend(dim, x, y, z, face, id === BlockId.STICKY_PISTON);
    else if (!powered && extended) this.retract(dim, x, y, z, face, id === BlockId.STICKY_PISTON);
  }

  private extend(dim: Dimension, x: number, y: number, z: number, face: number, sticky: boolean): boolean {
    const [dx, dy, dz] = FACE_VEC[face];
    const line: [number, number, number][] = [];
    let cx = x + dx; let cy = y + dy; let cz = z + dz;
    let breakAt: [number, number, number] | null = null;
    for (;;) {
      const mode = this.pushMode(dim, cx, cy, cz);
      if (mode === 'block') return false;
      if (mode === 'air') break;
      if (mode === 'break') { breakAt = [cx, cy, cz]; break; }
      if (line.length >= MAX_PUSH) return false;
      line.push([cx, cy, cz]);
      cx += dx; cy += dy; cz += dz;
    }
    this.movingPiston = true;
    try {
      if (breakAt) this.popForPiston(dim, ...breakAt);
      // Move blocks from the far end back toward the piston.
      for (let i = line.length - 1; i >= 0; i--) {
        const [bx, by, bz] = line[i];
        dim.setBlock(bx + dx, by + dy, bz + dz, dim.getBlock(bx, by, bz), dim.getMeta(bx, by, bz));
      }
      dim.setBlock(x + dx, y + dy, z + dz, BlockId.PISTON_HEAD, face | (sticky ? 8 : 0));
      dim.setMeta(x, y, z, face | PISTON_EXTENDED);
    } finally {
      this.movingPiston = false;
    }
    this.pushEntities(dim, x + dx, y + dy, z + dz, line.length + 1, dx, dy, dz);
    this.ctx.playSound('tile.piston.out', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.7 + this.ctx.random() * 0.2);
    return true;
  }

  private retract(dim: Dimension, x: number, y: number, z: number, face: number, sticky: boolean): void {
    const [dx, dy, dz] = FACE_VEC[face];
    this.movingPiston = true;
    try {
      if (dim.getBlock(x + dx, y + dy, z + dz) === BlockId.PISTON_HEAD) dim.setBlock(x + dx, y + dy, z + dz, 0, 0);
      dim.setMeta(x, y, z, face);
      if (sticky) {
        const px = x + dx * 2; const py = y + dy * 2; const pz = z + dz * 2;
        if (this.pushMode(dim, px, py, pz) === 'move') {
          const id = dim.getBlock(px, py, pz); const meta = dim.getMeta(px, py, pz);
          dim.setBlock(px, py, pz, 0, 0);
          dim.setBlock(x + dx, y + dy, z + dz, id, meta);
        }
      }
    } finally {
      this.movingPiston = false;
    }
    this.ctx.playSound('tile.piston.in', x + 0.5, y + 0.5, z + 0.5, 0.5, 0.6 + this.ctx.random() * 0.15);
  }

  private popForPiston(dim: Dimension, x: number, y: number, z: number): void {
    const id = dim.getBlock(x, y, z);
    const meta = dim.getMeta(x, y, z);
    dim.setBlock(x, y, z, 0, 0);
    if (id !== BlockId.FIRE) this.dropBlock?.(dim, x, y, z, id, meta);
  }

  private pushEntities(dim: Dimension, x: number, y: number, z: number, len: number, dx: number, dy: number, dz: number): void {
    const x0 = Math.min(x, x + dx * (len - 1)); const x1 = Math.max(x, x + dx * (len - 1)) + 1;
    const y0 = Math.min(y, y + dy * (len - 1)); const y1 = Math.max(y, y + dy * (len - 1)) + 1;
    const z0 = Math.min(z, z + dz * (len - 1)); const z1 = Math.max(z, z + dz * (len - 1)) + 1;
    for (const e of this.ctx.entitiesIn(dim)) {
      const b = e.box;
      if (b.maxX <= x0 || b.minX >= x1 || b.maxY <= y0 || b.minY >= y1 || b.maxZ <= z0 || b.minZ >= z1) continue;
      e.setPosition(e.x + dx, e.y + dy + (dy > 0 ? 0.01 : 0), e.z + dz);
      if (dy > 0) e.motionY = Math.max(e.motionY, 0);
    }
  }

  /** A player broke the head: the piston base goes with it. */
  private headRemoved(dim: Dimension, x: number, y: number, z: number): void {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_VEC[f];
      const bx = x - dx; const by = y - dy; const bz = z - dz;
      const id = dim.getBlock(bx, by, bz);
      if (id !== BlockId.PISTON && id !== BlockId.STICKY_PISTON) continue;
      const m = dim.getMeta(bx, by, bz);
      if ((m & 7) !== f || !(m & PISTON_EXTENDED)) continue;
      this.movingPiston = true;
      try {
        dim.setBlock(bx, by, bz, 0, 0);
      } finally {
        this.movingPiston = false;
      }
      this.ctx.dropStack(dim, bx + 0.5, by + 0.5, bz + 0.5, { id, count: 1, meta: 0, damage: 0 });
      return;
    }
  }

  /** The base was removed: its head disappears too. */
  private baseRemoved(dim: Dimension, x: number, y: number, z: number): void {
    for (let f = 0; f < 6; f++) {
      const [dx, dy, dz] = FACE_VEC[f];
      const hx = x + dx; const hy = y + dy; const hz = z + dz;
      if (dim.getBlock(hx, hy, hz) !== BlockId.PISTON_HEAD) continue;
      if ((dim.getMeta(hx, hy, hz) & 7) !== f) continue;
      this.movingPiston = true;
      try {
        dim.setBlock(hx, hy, hz, 0, 0);
      } finally {
        this.movingPiston = false;
      }
    }
  }
}

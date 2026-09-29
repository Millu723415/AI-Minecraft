/**
 * Block geometry as axis-aligned boxes. The mesher, the item-icon renderer,
 * the selection outline and collision all derive from this one description.
 */

import { BlockId } from '../blocks/ids';
import { getBlock } from '../blocks/registry';
import type { Box } from '../blocks/types';
import { Attach, BED_HEAD, DOOR_OPEN, DOOR_UPPER, FRAME_EYE, PISTON_EXTENDED, SLAB_TOP, STAIRS_UPSIDE } from '../blocks/meta';
import { tileOf } from './tiles';

export interface RenderBox extends Box {
  /** Optional per-face tile overrides (east, west, up, down, south, north). */
  tiles?: (number | undefined)[];
  /** Bitmask of faces to emit; default all six. */
  faces?: number;
  /** Rotate the top-face UVs by quarter turns. */
  topRotation?: number;
}

/** Neighbour lookup used for connecting shapes (fences, panes). */
export type NeighborFn = (dx: number, dy: number, dz: number) => number;

const P = 1 / 16;
const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, extra: Partial<RenderBox> = {}): RenderBox =>
  ({ minX: x0, minY: y0, minZ: z0, maxX: x1, maxY: y1, maxZ: z1, ...extra });

const FULL = box(0, 0, 0, 1, 1, 1);

function connectsFence(id: number, other: number): boolean {
  if (other === 0) return false;
  if (other === id) return true;
  if (id === BlockId.FENCE && other === BlockId.FENCE_GATE) return true;
  if (id === BlockId.FENCE_GATE && other === BlockId.FENCE) return true;
  const def = getBlock(other);
  return def.solid && def.shape === 'cube';
}

function connectsPane(other: number): boolean {
  if (other === BlockId.GLASS_PANE || other === BlockId.IRON_BARS || other === BlockId.GLASS) return true;
  const def = getBlock(other);
  return def.solid && def.shape === 'cube';
}

let tiles: Record<string, number> | null = null;
function T(): Record<string, number> {
  if (!tiles) {
    tiles = {
      endEye: tileOf('end_portal_frame_eye'),
      stone: tileOf('stone'),
      planks: tileOf('planks_oak'),
      bedFoot: tileOf('bed_foot'),
      bedTop: tileOf('bed_top'),
      cakeInner: tileOf('cake_side'),
      water: tileOf('water'),
      cobble: tileOf('cobblestone'),
      torch: tileOf('torch'),
      brewBase: tileOf('brewing_stand_base'),
      pistonTop: tileOf('piston_top'),
      pistonSide: tileOf('piston_side'),
      slabTop: tileOf('slab_stone_top'),
      redTorch: tileOf('redstone_torch_on'),
      redTorchOff: tileOf('redstone_torch_off'),
      eggDark: tileOf('dragon_egg'),
    };
  }
  return tiles;
}

/** Boxes for a block. `neighbor` may be omitted (icons), giving an isolated look. */
export function blockBoxes(id: number, meta: number, neighbor?: NeighborFn): RenderBox[] {
  const def = getBlock(id);
  switch (def.shape) {
    case 'cube':
      return [FULL];
    case 'slab':
      return meta & SLAB_TOP ? [box(0, 0.5, 0, 1, 1, 1)] : [box(0, 0, 0, 1, 0.5, 1)];
    case 'stairs': {
      const up = (meta & STAIRS_UPSIDE) !== 0;
      const base = up ? box(0, 0.5, 0, 1, 1, 1) : box(0, 0, 0, 1, 0.5, 1);
      const y0 = up ? 0 : 0.5;
      const y1 = up ? 0.5 : 1;
      let step: RenderBox;
      switch (meta & 3) {
        case 0: step = box(0.5, y0, 0, 1, y1, 1); break;
        case 1: step = box(0, y0, 0, 0.5, y1, 1); break;
        case 2: step = box(0, y0, 0.5, 1, y1, 1); break;
        default: step = box(0, y0, 0, 1, y1, 0.5); break;
      }
      return [base, step];
    }
    case 'fence': {
      if (id === BlockId.FENCE_GATE) return fenceGateBoxes(meta);
      const out: RenderBox[] = [box(6 * P, 0, 6 * P, 10 * P, 1, 10 * P)];
      const n = neighbor ?? (() => 0);
      const conn = [connectsFence(id, n(1, 0, 0)), connectsFence(id, n(-1, 0, 0)), connectsFence(id, n(0, 0, 1)), connectsFence(id, n(0, 0, -1))];
      if (!neighbor) { conn[0] = true; conn[1] = true; }
      for (const [y0, y1] of [[6 * P, 9 * P], [12 * P, 15 * P]]) {
        if (conn[0]) out.push(box(10 * P, y0, 7 * P, 1, y1, 9 * P));
        if (conn[1]) out.push(box(0, y0, 7 * P, 6 * P, y1, 9 * P));
        if (conn[2]) out.push(box(7 * P, y0, 10 * P, 9 * P, y1, 1));
        if (conn[3]) out.push(box(7 * P, y0, 0, 9 * P, y1, 6 * P));
      }
      return out;
    }
    case 'pane': {
      const n = neighbor ?? (() => 0);
      const e = connectsPane(n(1, 0, 0));
      const w = connectsPane(n(-1, 0, 0));
      const s = connectsPane(n(0, 0, 1));
      const nn = connectsPane(n(0, 0, -1));
      const out: RenderBox[] = [];
      const t0 = 7 * P;
      const t1 = 9 * P;
      if (!e && !w && !s && !nn) {
        out.push(box(0, 0, t0, 1, 1, t1));
        out.push(box(t0, 0, 0, t1, 1, 1));
        return out;
      }
      if (e || w) out.push(box(w ? 0 : t0, 0, t0, e ? 1 : t1, 1, t1));
      if (s || nn) out.push(box(t0, 0, nn ? 0 : t0, t1, 1, s ? 1 : t1));
      return out;
    }
    case 'torch': {
      if (id === BlockId.SIGN) return [box(7 * P, 0, 7 * P, 9 * P, 9 * P, 9 * P, { tiles: [T().planks, T().planks, T().planks, T().planks, T().planks, T().planks] }), box(0, 9 * P, 7 * P, 1, 1, 9 * P)];
      const tex = id === BlockId.TORCH ? T().torch : id === BlockId.REDSTONE_TORCH ? T().redTorch : T().redTorchOff;
      const w = 1 * P;
      switch (meta) {
        case Attach.EAST: return [box(1 - 2 * w - 2 * P, 3 * P, 0.5 - w, 1 - 2 * P, 13 * P, 0.5 + w, { tiles: [tex, tex, tex, tex, tex, tex] })];
        case Attach.WEST: return [box(2 * P, 3 * P, 0.5 - w, 2 * P + 2 * w, 13 * P, 0.5 + w)];
        case Attach.SOUTH: return [box(0.5 - w, 3 * P, 1 - 2 * P - 2 * w, 0.5 + w, 13 * P, 1 - 2 * P)];
        case Attach.NORTH: return [box(0.5 - w, 3 * P, 2 * P, 0.5 + w, 13 * P, 2 * P + 2 * w)];
        default: return [box(0.5 - w, 0, 0.5 - w, 0.5 + w, 10 * P, 0.5 + w)];
      }
    }
    case 'ladder': {
      const d = id === BlockId.WALL_SIGN ? 2 * P : P;
      const y0 = id === BlockId.WALL_SIGN ? 4.5 * P : 0;
      const y1 = id === BlockId.WALL_SIGN ? 12.5 * P : 1;
      switch (meta) {
        case Attach.EAST: return [box(1 - d, y0, 0, 1, y1, 1)];
        case Attach.WEST: return [box(0, y0, 0, d, y1, 1)];
        case Attach.SOUTH: return [box(0, y0, 1 - d, 1, y1, 1)];
        default: return [box(0, y0, 0, 1, y1, d)];
      }
    }
    case 'flat': {
      if (id === BlockId.SNOW_LAYER) return [box(0, 0, 0, 1, 2 * P, 1)];
      if (id === BlockId.STONE_PRESSURE_PLATE || id === BlockId.WOODEN_PRESSURE_PLATE) {
        return [box(P, 0, P, 15 * P, meta & 1 ? 0.5 * P : P, 15 * P)];
      }
      return [box(0, 0, 0, 1, P, 1, { faces: 1 << 2 })];
    }
    case 'door': {
      const open = (meta & DOOR_OPEN) !== 0;
      const edge = ((meta & 3) + (open ? 1 : 0)) & 3;
      const d = 3 * P;
      switch (edge) {
        case 0: return [box(0, 0, 0, d, 1, 1)];
        case 1: return [box(0, 0, 0, 1, 1, d)];
        case 2: return [box(1 - d, 0, 0, 1, 1, 1)];
        default: return [box(0, 0, 1 - d, 1, 1, 1)];
      }
    }
    case 'trapdoor': {
      const d = 3 * P;
      if (!(meta & 4)) return [box(0, 0, 0, 1, d, 1)];
      switch (meta & 3) {
        case 0: return [box(0, 0, 1 - d, 1, 1, 1)];
        case 1: return [box(0, 0, 0, 1, 1, d)];
        case 2: return [box(1 - d, 0, 0, 1, 1, 1)];
        default: return [box(0, 0, 0, d, 1, 1)];
      }
    }
    case 'cactus':
      return [box(P, 0, P, 15 * P, 1, 15 * P)];
    case 'chest':
      return [box(P, 0, P, 15 * P, 14 * P, 15 * P)];
    case 'frame': {
      const base = box(0, 0, 0, 1, 13 * P, 1);
      if (meta & FRAME_EYE) {
        const e = T().endEye;
        return [base, box(4 * P, 13 * P, 4 * P, 12 * P, 1, 12 * P, { tiles: [e, e, e, e, e, e] })];
      }
      return [base];
    }
    case 'brewing': {
      const b = T().brewBase;
      return [
        box(P, 0, P, 15 * P, 2 * P, 15 * P, { tiles: [b, b, b, b, b, b] }),
        box(7 * P, 0, 7 * P, 9 * P, 14 * P, 9 * P),
      ];
    }
    case 'cauldron': {
      const out = [
        box(0, 3 * P, 0, 1, 4 * P, 1),
        box(0, 0, 0, 2 * P, 1, 1), box(14 * P, 0, 0, 1, 1, 1),
        box(2 * P, 0, 0, 14 * P, 1, 2 * P), box(2 * P, 0, 14 * P, 14 * P, 1, 1),
      ];
      if (meta > 0) {
        const w = T().water;
        const h = (4 + meta * 3.5) * P;
        out.push(box(2 * P, h - P, 2 * P, 14 * P, h, 14 * P, { tiles: [w, w, w, w, w, w], faces: 1 << 2 }));
      }
      return out;
    }
    case 'enchant':
      return [box(0, 0, 0, 1, 12 * P, 1)];
    case 'bed': {
      const head = (meta & BED_HEAD) !== 0;
      const top = head ? T().bedTop : T().bedFoot;
      const dir = meta & 3;
      // Rotate so the pillow sits at the head end.
      const rot = [2, 1, 0, 3][dir];
      return [box(0, 3 * P, 0, 1, 9 * P, 1, { tiles: [undefined, undefined, top, T().planks, undefined, undefined], topRotation: rot })];
    }
    case 'cake': {
      const eaten = Math.min(6, meta);
      const x0 = (1 + eaten * 2) * P;
      return [box(x0, 0, P, 15 * P, 8 * P, 15 * P)];
    }
    case 'button': {
      const pressed = (meta & 8) !== 0;
      const d = pressed ? P : 2 * P;
      switch (meta & 7) {
        case Attach.EAST: return [box(1 - d, 6 * P, 5 * P, 1, 10 * P, 11 * P)];
        case Attach.WEST: return [box(0, 6 * P, 5 * P, d, 10 * P, 11 * P)];
        case Attach.SOUTH: return [box(5 * P, 6 * P, 1 - d, 11 * P, 10 * P, 1)];
        default: return [box(5 * P, 6 * P, 0, 11 * P, 10 * P, d)];
      }
    }
    case 'lever': {
      const on = (meta & 8) !== 0;
      const c = T().cobble;
      const ct = [c, c, c, c, c, c];
      const lean = on ? 3 * P : -3 * P;
      switch (meta & 7) {
        case Attach.EAST: return [box(13 * P, 4 * P, 5 * P, 1, 12 * P, 11 * P, { tiles: ct }), box(9 * P, 7 * P + lean, 7 * P, 13 * P, 9 * P + lean, 9 * P)];
        case Attach.WEST: return [box(0, 4 * P, 5 * P, 3 * P, 12 * P, 11 * P, { tiles: ct }), box(3 * P, 7 * P + lean, 7 * P, 7 * P, 9 * P + lean, 9 * P)];
        case Attach.SOUTH: return [box(5 * P, 4 * P, 13 * P, 11 * P, 12 * P, 1, { tiles: ct }), box(7 * P, 7 * P + lean, 9 * P, 9 * P, 9 * P + lean, 13 * P)];
        case Attach.NORTH: return [box(5 * P, 4 * P, 0, 11 * P, 12 * P, 3 * P, { tiles: ct }), box(7 * P, 7 * P + lean, 3 * P, 9 * P, 9 * P + lean, 7 * P)];
        default: return [box(4 * P, 0, 5 * P, 12 * P, 3 * P, 11 * P, { tiles: ct }), box(7 * P + lean, 3 * P, 7 * P, 9 * P + lean, 10 * P, 9 * P)];
      }
    }
    case 'repeater': {
      const t = id === BlockId.REPEATER_ON ? T().redTorch : T().redTorchOff;
      const tt = [t, t, t, t, t, t];
      const facing = meta & 3;
      const delay = (meta >> 2) & 3;
      const along = (pos: number): [number, number] => {
        // pos in 0..1 along the output axis
        switch (facing) {
          case 0: return [0.5, pos];
          case 1: return [1 - pos, 0.5];
          case 2: return [0.5, 1 - pos];
          default: return [pos, 0.5];
        }
      };
      const [ax, az] = along(0.25 + delay * 0.08);
      const [bx, bz] = along(0.8);
      return [
        box(0, 0, 0, 1, 2 * P, 1, { topRotation: facing }),
        box(ax - P, 2 * P, az - P, ax + P, 7 * P, az + P, { tiles: tt }),
        box(bx - P, 2 * P, bz - P, bx + P, 7 * P, bz + P, { tiles: tt }),
      ];
    }
    case 'piston': {
      if (!(meta & PISTON_EXTENDED)) return [FULL];
      const f = meta & 7;
      const s = 12 * P;
      switch (f) {
        case 0: return [box(0, 0, 0, s, 1, 1)];
        case 1: return [box(1 - s, 0, 0, 1, 1, 1)];
        case 2: return [box(0, 0, 0, 1, s, 1)];
        case 3: return [box(0, 1 - s, 0, 1, 1, 1)];
        case 4: return [box(0, 0, 0, 1, 1, s)];
        default: return [box(0, 0, 1 - s, 1, 1, 1)];
      }
    }
    case 'pistonhead': {
      const f = meta & 7;
      const s = 4 * P;
      const plate = [box(1 - s, 0, 0, 1, 1, 1), box(0, 0, 0, s, 1, 1), box(0, 1 - s, 0, 1, 1, 1), box(0, 0, 0, 1, s, 1), box(0, 0, 1 - s, 1, 1, 1), box(0, 0, 0, 1, 1, s)][f];
      const rod = [box(-4 * P, 6 * P, 6 * P, 12 * P, 10 * P, 10 * P), box(4 * P, 6 * P, 6 * P, 20 * P, 10 * P, 10 * P),
        box(6 * P, -4 * P, 6 * P, 10 * P, 12 * P, 10 * P), box(6 * P, 4 * P, 6 * P, 10 * P, 20 * P, 10 * P),
        box(6 * P, 6 * P, -4 * P, 10 * P, 10 * P, 12 * P), box(6 * P, 6 * P, 4 * P, 10 * P, 10 * P, 20 * P)][f];
      rod.tiles = [T().pistonSide, T().pistonSide, T().pistonSide, T().pistonSide, T().pistonSide, T().pistonSide];
      return [plate, rod];
    }
    case 'farmland':
      return [box(0, 0, 0, 1, 15 * P, 1)];
    case 'endportal':
      return [box(0, 0, 0, 1, 12 * P, 1, { faces: 1 << 2 })];
    case 'dragonegg':
      return [
        box(6 * P, 15 * P, 6 * P, 10 * P, 1, 10 * P), box(5 * P, 14 * P, 5 * P, 11 * P, 15 * P, 11 * P),
        box(4 * P, 11 * P, 4 * P, 12 * P, 14 * P, 12 * P), box(3 * P, 7 * P, 3 * P, 13 * P, 11 * P, 13 * P),
        box(2 * P, 2 * P, 2 * P, 14 * P, 7 * P, 14 * P), box(4 * P, 0, 4 * P, 12 * P, 2 * P, 12 * P),
      ];
    default:
      return [FULL];
  }
}

function fenceGateBoxes(meta: number): RenderBox[] {
  const open = (meta & 4) !== 0;
  const alongX = (meta & 1) === 0;
  const out: RenderBox[] = [];
  if (alongX) {
    out.push(box(0, 5 * P, 7 * P, 2 * P, 1, 9 * P), box(14 * P, 5 * P, 7 * P, 1, 1, 9 * P));
    if (!open) out.push(box(2 * P, 6 * P, 7 * P, 14 * P, 9 * P, 9 * P), box(2 * P, 12 * P, 7 * P, 14 * P, 15 * P, 9 * P));
    else out.push(box(0, 6 * P, 9 * P, 2 * P, 15 * P, 15 * P), box(14 * P, 6 * P, 9 * P, 1, 15 * P, 15 * P));
  } else {
    out.push(box(7 * P, 5 * P, 0, 9 * P, 1, 2 * P), box(7 * P, 5 * P, 14 * P, 9 * P, 1, 1));
    if (!open) out.push(box(7 * P, 6 * P, 2 * P, 9 * P, 9 * P, 14 * P), box(7 * P, 12 * P, 2 * P, 9 * P, 15 * P, 14 * P));
    else out.push(box(9 * P, 6 * P, 0, 15 * P, 15 * P, 2 * P), box(9 * P, 6 * P, 14 * P, 15 * P, 15 * P, 1));
  }
  return out;
}

/**
 * Collision boxes for physics. Plants, torches etc. have none; fences are
 * 1.5 blocks tall so animals cannot jump them.
 */
export function collisionBoxes(id: number, meta: number, neighbor?: NeighborFn): Box[] {
  const def = getBlock(id);
  if (!def.collides) return [];
  if (def.collisionBoxes) return def.collisionBoxes(meta);
  switch (def.shape) {
    case 'cube':
      return [FULL];
    case 'fence': {
      if (id === BlockId.FENCE_GATE) {
        if (meta & 4) return [];
        return (meta & 1) === 0 ? [box(0, 0, 6 * P, 1, 1.5, 10 * P)] : [box(6 * P, 0, 0, 10 * P, 1.5, 1)];
      }
      return blockBoxes(id, meta, neighbor).map((b) => ({ ...b, minY: 0, maxY: 1.5 }));
    }
    case 'pane':
    case 'slab':
    case 'stairs':
    case 'door':
    case 'trapdoor':
    case 'ladder':
    case 'cake':
    case 'piston':
    case 'pistonhead':
    case 'repeater':
    case 'frame':
    case 'bed':
    case 'chest':
    case 'enchant':
    case 'farmland':
    case 'dragonegg':
      return blockBoxes(id, meta, neighbor).map((b) => ({ minX: b.minX, minY: b.minY, minZ: b.minZ, maxX: b.maxX, maxY: b.maxY, maxZ: b.maxZ }));
    default:
      return [FULL];
  }
}

/** Selection outline box (union of the block's render boxes). */
export function selectionBox(id: number, meta: number, neighbor?: NeighborFn): Box {
  const def = getBlock(id);
  if (def.shape === 'cross' || def.shape === 'crop' || def.shape === 'fire' || def.shape === 'stem') {
    return box(2 * P, 0, 2 * P, 14 * P, id === BlockId.WHEAT_CROP ? 4 * P : 13 * P, 14 * P);
  }
  if (def.shape === 'fluid' || def.shape === 'none') return FULL;
  if (def.shape === 'lily' || def.shape === 'wire') return box(0, 0, 0, 1, P, 1);
  if (def.shape === 'portal') return meta === 0 ? box(0, 0, 6 * P, 1, 1, 10 * P) : box(6 * P, 0, 0, 10 * P, 1, 1);
  const boxes = blockBoxes(id, meta, neighbor);
  const out = { ...boxes[0] };
  for (const b of boxes) {
    out.minX = Math.min(out.minX, b.minX); out.minY = Math.min(out.minY, b.minY); out.minZ = Math.min(out.minZ, b.minZ);
    out.maxX = Math.max(out.maxX, b.maxX); out.maxY = Math.max(out.maxY, b.maxY); out.maxZ = Math.max(out.maxZ, b.maxZ);
  }
  return { minX: Math.max(0, out.minX), minY: Math.max(0, out.minY), minZ: Math.max(0, out.minZ), maxX: Math.min(1, out.maxX), maxY: Math.min(1, out.maxY), maxZ: Math.min(1, out.maxZ) };
}

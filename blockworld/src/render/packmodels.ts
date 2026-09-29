/**
 * Mob models for resource-pack skins.
 *
 * Pack skins follow the standard box layouts, so when a pack is active the
 * models below replace (or re-texture) the built-in ones. They keep the part
 * names of the built-in models so the same animations drive both.
 *
 * Geometry is written in pack model space (Y down, origin 24 px above the
 * feet, +X on the model's left) and converted to ours (Y up, +X right):
 * x -> -x, y -> 24 - y, rotations (x, y, z) -> (-x, -y, z) applied Z, Y, X.
 */

import * as THREE from 'three';
import type { Entity } from '../entity/entity';
import type { BoxSpec } from './skin';
import { packImage } from './pack';

type V3 = [number, number, number];

export interface PackPart { name: string; pivot: V3; boxes: BoxSpec[]; scale?: number }

export type PackParts = Record<string, { group: THREE.Group }>;

export interface PackAnim {
  limbSwing: number;
  limbAmount: number;
  headYaw: number;
  pitch: number;
  age: number;
}

export interface PackModel {
  /** Texture layers, bottom first (pack paths without `.png`). */
  layers: string[];
  /** Texture size the UVs are expressed in (high-resolution files scale). */
  texW: number;
  texH: number;
  /** Replacement parts; the built-in parts are kept (re-textured) when absent. */
  parts?: PackPart[];
  /** Sheep coat: layer and boxes per part name (relative to that part). */
  wool?: { layer: string; boxes: Record<string, BoxSpec[]> };
  /** Replacement animation. */
  animate?: (e: Entity, p: PackParts, t: PackAnim) => void;
}

interface Cube { u: number; v: number; x: number; y: number; z: number; w: number; h: number; d: number; inflate?: number; mirror?: boolean }

/** A cube in pack model space: texture offset, origin and size. */
const C = (u: number, v: number, x: number, y: number, z: number, w: number, h: number, d: number, inflate = 0, mirror = false): Cube =>
  ({ u, v, x, y, z, w, h, d, inflate, mirror });

const HALF_PI = Math.PI / 2;

/** Rotation (pack angles) converted to our axes. */
function rotation(rot: V3): THREE.Matrix4 {
  return new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-rot[0], -rot[1], rot[2], 'ZYX'));
}

/** Transform placing a sub-pivot at a pack-space offset from the part pivot. */
function place(off: V3, rot?: V3): THREE.Matrix4 {
  const m = rot ? rotation(rot) : new THREE.Matrix4();
  m.setPosition(-off[0], -off[1], off[2]);
  return m;
}

function boxes(cubes: Cube[], mat?: THREE.Matrix4): BoxSpec[] {
  return cubes.map((c) => ({
    x: -(c.x + c.w), y: -(c.y + c.h), z: c.z, w: c.w, h: c.h, d: c.d, u: c.u, v: c.v,
    inflate: c.inflate || undefined, mirror: c.mirror || undefined, mat,
  }));
}

/** A part with its pivot in pack space and an optional static rotation. */
function part(name: string, pivot: V3, cubes: Cube[], rot?: V3, extra: BoxSpec[] = []): PackPart {
  return { name, pivot: [-pivot[0], 24 - pivot[1], pivot[2]], boxes: [...boxes(cubes, rot ? rotation(rot) : undefined), ...extra] };
}

/** Pose a part from pack-space position and rotation (for pack animations). */
function pose(p: { group: THREE.Group }, pos: V3, rot: V3): void {
  p.group.position.set(-pos[0], 24 - pos[1], pos[2]);
  p.group.rotation.set(-rot[0], -rot[1], rot[2], 'ZYX');
}

// ---------------------------------------------------------------------------
// Shared shapes
// ---------------------------------------------------------------------------

/** Four legs named like the built-in quadrupeds: 0/1 front right/left, 2/3 hind. */
function legs(cube: Cube, x: number, y: number, front: number, hind: number): PackPart[] {
  return [
    part('leg0', [-x, y, front], [cube]),
    part('leg1', [x, y, front], [cube]),
    part('leg2', [-x, y, hind], [cube]),
    part('leg3', [x, y, hind], [cube]),
  ];
}

/** Humanoid with the built-in part names; `wide` uses the 64x64 player layout with overlays. */
function humanoid(opts: { armW?: number; wide?: boolean; hat?: boolean; head?: Cube[]; headExtra?: BoxSpec[] }): PackPart[] {
  const a = opts.armW ?? 4;
  const head = opts.head ?? [C(0, 0, -4, -8, -4, 8, 8, 8)];
  if (opts.hat) head.push(C(32, 0, -4, -8, -4, 8, 8, 8, 0.5));
  const wide = !!opts.wide;
  const ov = (c: Cube[]) => (wide ? c : []);
  return [
    part('head', [0, 0, 0], head, undefined, opts.headExtra),
    part('body', [0, 0, 0], [C(16, 16, -4, 0, -2, 8, 12, 4), ...ov([C(16, 32, -4, 0, -2, 8, 12, 4, 0.25)])]),
    part('rarm', [-5, 2, 0], [C(40, 16, a === 4 ? -3 : -1, -2, -a / 2, a, 12, a), ...ov([C(40, 32, -3, -2, -2, 4, 12, 4, 0.25)])]),
    part('larm', [5, 2, 0], wide
      ? [C(32, 48, -1, -2, -2, 4, 12, 4), C(48, 48, -1, -2, -2, 4, 12, 4, 0.25)]
      : [C(40, 16, -1, -2, -a / 2, a, 12, a, 0, true)]),
    part('rleg', [-2, 12, 0], [C(0, 16, -a / 2, 0, -a / 2, a, 12, a), ...ov([C(0, 32, -2, 0, -2, 4, 12, 4, 0.25)])]),
    part('lleg', [2, 12, 0], wide
      ? [C(16, 48, -2, 0, -2, 4, 12, 4), C(0, 48, -2, 0, -2, 4, 12, 4, 0.25)]
      : [C(0, 16, -a / 2, 0, -a / 2, a, 12, a, 0, true)]),
  ];
}

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

function cow(layer: string): PackModel {
  return {
    layers: [layer], texW: 64, texH: 64,
    parts: [
      part('head', [0, 4, -8], [
        C(0, 0, -4, -4, -6, 8, 8, 6), C(1, 33, -3, 1, -7, 6, 3, 1),
        C(22, 0, -5, -5, -4, 1, 3, 1), C(22, 0, 4, -5, -4, 1, 3, 1),
      ]),
      part('body', [0, 5, 2], [C(18, 4, -6, -10, -7, 12, 18, 10), C(52, 0, -2, 2, -8, 4, 6, 1)], [HALF_PI, 0, 0]),
      ...legs(C(0, 16, -2, 0, -2, 4, 12, 4), 4, 12, -6, 7),
    ],
  };
}

function wolf(e: Entity): PackModel {
  const w = e as unknown as { tamed: boolean; angry: boolean };
  const layer = w.angry ? 'entity/wolf/wolf_angry' : w.tamed ? 'entity/wolf/wolf_tame' : 'entity/wolf/wolf';
  const leg = C(0, 18, 0, 0, -1, 2, 8, 2);
  return {
    layers: [layer], texW: 64, texH: 32,
    parts: [
      part('head', [-1, 13.5, -7], [
        C(0, 0, -2, -3, -2, 6, 6, 4), C(16, 14, -2, -5, 0, 2, 2, 1), C(16, 14, 2, -5, 0, 2, 2, 1),
        C(0, 10, -0.5, -0.001, -5, 3, 3, 4),
      ]),
      part('body', [0, 14, 2], [C(18, 14, -3, -2, -3, 6, 9, 6)]),
      part('mane', [-1, 14, -3], [C(21, 0, -3, -3, -3, 8, 6, 7)]),
      part('leg0', [-2.5, 16, -4], [leg]),
      part('leg1', [0.5, 16, -4], [leg]),
      part('leg2', [-2.5, 16, 7], [leg]),
      part('leg3', [0.5, 16, 7], [leg]),
      part('tail', [-1, 12, 8], [C(9, 18, 0, 0, -1, 2, 8, 2)]),
    ],
    animate: (en, p, t) => {
      const wo = en as unknown as { sitting: boolean; tamed: boolean; angry: boolean; health: number; maxHealth: number };
      const swing = (phase: number) => Math.cos(t.limbSwing * 0.6662 + phase) * 1.4 * t.limbAmount;
      const tail = wo.angry ? 1.5393804 : wo.tamed ? (0.55 - (wo.maxHealth - wo.health) * 0.02) * Math.PI : Math.PI / 5;
      if (wo.sitting) {
        pose(p.mane, [-1, 16, -3], [(2 * Math.PI) / 5, 0, 0]);
        pose(p.body, [0, 18, 0], [Math.PI / 4, 0, 0]);
        pose(p.tail, [-1, 21, 6], [tail, 0, 0]);
        pose(p.leg2, [-2.5, 22.7, 2], [1.5 * Math.PI, 0, 0]);
        pose(p.leg3, [0.5, 22.7, 2], [1.5 * Math.PI, 0, 0]);
        pose(p.leg0, [-2.49, 17, -4], [5.811947, 0, 0]);
        pose(p.leg1, [0.51, 17, -4], [5.811947, 0, 0]);
      } else {
        pose(p.body, [0, 14, 2], [HALF_PI, 0, 0]);
        pose(p.mane, [-1, 14, -3], [HALF_PI, 0, 0]);
        pose(p.tail, [-1, 12, 8], [tail, swing(0), 0]);
        pose(p.leg2, [-2.5, 16, 7], [swing(0), 0, 0]);
        pose(p.leg3, [0.5, 16, 7], [swing(Math.PI), 0, 0]);
        pose(p.leg0, [-2.5, 16, -4], [swing(Math.PI), 0, 0]);
        pose(p.leg1, [0.5, 16, -4], [swing(0), 0, 0]);
      }
      p.head.group.rotation.set(t.pitch, t.headYaw, 0, 'YXZ');
    },
  };
}

function silverfish(): PackModel {
  const sizes: V3[] = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
  const texs = [[0, 0], [0, 4], [0, 9], [0, 16], [0, 22], [11, 0], [13, 4]];
  const zs: number[] = [];
  let z = -3.5;
  for (let i = 0; i < 7; i++) {
    zs.push(z);
    if (i < 6) z += (sizes[i][2] + sizes[i + 1][2]) * 0.5;
  }
  // Bristle layers ride on segments 2, 4 and 1.
  const layers: Record<number, BoxSpec[]> = {
    2: boxes([C(20, 0, -5, 0, -1.5, 10, 8, 3)], place([0, -4, 0])),
    4: boxes([C(20, 11, -3, 0, -1.5, 6, 4, 3)], place([0, -2, 0])),
    1: boxes([C(20, 18, -3, 0, -1, 6, 5, 2)], place([0, -2, 0])),
  };
  const parts = sizes.map(([w, h, d], i) =>
    part(`s${i}`, [0, 24 - h, zs[i]], [C(texs[i][0], texs[i][1], -w / 2, 0, -d / 2, w, h, d)], undefined, layers[i] ?? []));
  return { layers: ['entity/silverfish/silverfish'], texW: 64, texH: 32, parts };
}

function magmaCube(): PackModel {
  const parts: PackPart[] = [];
  for (let j = 0; j < 8; j++) {
    // Pack segment i counts from the top.
    const i = 7 - j;
    const u = i < 4 ? 0 : 32;
    const v = (i % 4) * 9;
    parts.push({ name: `s${j}`, pivot: [0, j, 0], boxes: [{ x: -4, y: 0, z: -4, w: 8, h: 1, d: 8, u, v }] });
  }
  parts.push({ name: 'core', pivot: [0, 0, 0], boxes: [{ x: -2, y: 2, z: -2, w: 4, h: 4, d: 4, u: 24, v: 40 }] });
  return { layers: ['entity/slime/magmacube'], texW: 64, texH: 64, parts };
}

function crystal(): PackModel {
  const cube = (u: number, v: number): BoxSpec => ({ x: -4, y: -4, z: -4, w: 8, h: 8, d: 8, u, v });
  return {
    layers: ['entity/end_crystal/end_crystal'], texW: 64, texH: 32,
    parts: [
      { name: 'base', pivot: [0, 0, 0], boxes: [{ x: -6, y: 0, z: -6, w: 12, h: 4, d: 12, u: 0, v: 16 }] },
      { name: 'glass', pivot: [0, 16, 0], boxes: [cube(0, 0)] },
      { name: 'glass2', pivot: [0, 16, 0], boxes: [cube(0, 0)], scale: 0.875 },
      { name: 'core', pivot: [0, 16, 0], boxes: [cube(32, 0)], scale: 0.875 * 0.875 },
    ],
  };
}

function minecart(): PackModel {
  // Pack cart is long along X; ours runs along Z, so turn it a quarter.
  const turn = new THREE.Matrix4().makeRotationY(HALF_PI);
  const wall = C(0, 0, -8, -9, -1, 16, 8, 2);
  const at = (off: V3, rot: V3 | undefined, c: Cube) => boxes([c], turn.clone().multiply(place(off, rot)));
  // Offsets are relative to the part pivot, which sits 2 px above the rails.
  return {
    layers: ['entity/minecart/minecart'], texW: 64, texH: 32,
    parts: [{
      name: 'cart', pivot: [0, 2, 0], boxes: [
        ...at([0, -1, 0], [HALF_PI, 0, 0], C(0, 10, -10, -8, -1, 20, 16, 2)),
        ...at([-9, -1, 0], [0, 1.5 * Math.PI, 0], wall),
        ...at([9, -1, 0], [0, HALF_PI, 0], wall),
        ...at([0, -1, -7], [0, Math.PI, 0], wall),
        ...at([0, -1, 7], undefined, wall),
      ],
    }],
  };
}

function boat(): PackModel {
  // Hull only: the oars came later.
  const at = (off: V3, rot: V3 | undefined, c: Cube) => boxes([c], place(off, rot));
  return {
    layers: ['entity/boat/oak'], texW: 128, texH: 64,
    parts: [{
      name: 'hull', pivot: [0, 0, 0], boxes: [
        ...at([0, -3, 1], [HALF_PI, 0, 0], C(0, 0, -14, -9, -3, 28, 16, 3)),
        ...at([-15, -2, 4], [0, 1.5 * Math.PI, 0], C(0, 19, -13, -7, -1, 18, 6, 2)),
        ...at([15, -2, 0], [0, HALF_PI, 0], C(0, 27, -8, -7, -1, 16, 6, 2)),
        ...at([0, -2, -9], [0, Math.PI, 0], C(0, 35, -14, -7, -1, 28, 6, 2)),
        ...at([0, -2, 9], undefined, C(0, 43, -14, -7, -1, 28, 6, 2)),
      ],
    }],
  };
}

const PROFESSIONS = ['farmer', 'librarian', 'cleric', 'weaponsmith', 'butcher'];

const PACK_MODELS: Record<string, (e: Entity) => PackModel> = {
  pig: () => ({
    layers: ['entity/pig/pig_temperate'], texW: 64, texH: 64,
    parts: [
      part('head', [0, 12, -6], [C(0, 0, -4, -4, -8, 8, 8, 8), C(16, 16, -2, 0, -9, 4, 3, 1)]),
      part('body', [0, 11, 2], [C(28, 8, -5, -10, -7, 10, 16, 8)], [HALF_PI, 0, 0]),
      ...legs(C(0, 16, -2, 0, -2, 4, 6, 4), 3, 18, -5, 7),
    ],
  }),
  cow: () => cow('entity/cow/cow_temperate'),
  mooshroom: () => cow('entity/cow/mooshroom_red'),
  sheep: () => ({
    layers: ['entity/sheep/sheep'], texW: 64, texH: 32,
    parts: [
      part('head', [0, 6, -8], [C(0, 0, -3, -4, -6, 6, 6, 8)]),
      part('body', [0, 5, 2], [C(28, 8, -4, -10, -7, 8, 16, 6)], [HALF_PI, 0, 0]),
      ...legs(C(0, 16, -2, 0, -2, 4, 12, 4), 3, 12, -5, 7),
    ],
    wool: {
      layer: 'entity/sheep/sheep_wool',
      boxes: {
        head: boxes([C(0, 0, -3, -4, -4, 6, 6, 6, 0.6)]),
        body: boxes([C(28, 8, -4, -10, -7, 8, 16, 6, 1.75)], rotation([HALF_PI, 0, 0])),
        leg0: boxes([C(0, 16, -2, 0, -2, 4, 6, 4, 0.5)]),
        leg1: boxes([C(0, 16, -2, 0, -2, 4, 6, 4, 0.5)]),
        leg2: boxes([C(0, 16, -2, 0, -2, 4, 6, 4, 0.5)]),
        leg3: boxes([C(0, 16, -2, 0, -2, 4, 6, 4, 0.5)]),
      },
    },
  }),
  chicken: () => ({
    layers: ['entity/chicken/chicken_temperate'], texW: 64, texH: 32,
    parts: [
      part('head', [0, 15, -4], [C(0, 0, -2, -6, -2, 4, 6, 3), C(14, 0, -2, -4, -4, 4, 2, 2), C(14, 4, -1, -2, -3, 2, 2, 2)]),
      part('body', [0, 16, 0], [C(0, 9, -3, -4, -3, 6, 8, 6)], [HALF_PI, 0, 0]),
      part('rwing', [-4, 13, 0], [C(24, 13, 0, 0, -3, 1, 4, 6)]),
      part('lwing', [4, 13, 0], [C(24, 13, -1, 0, -3, 1, 4, 6)]),
      part('leg0', [-2, 19, 1], [C(26, 0, -1, 0, -3, 3, 5, 3)]),
      part('leg1', [1, 19, 1], [C(26, 0, -1, 0, -3, 3, 5, 3)]),
    ],
  }),
  squid: () => ({ layers: ['entity/squid/squid'], texW: 64, texH: 32 }),
  wolf,
  zombie: () => ({ layers: ['entity/zombie/zombie'], texW: 64, texH: 64, parts: humanoid({ hat: true }) }),
  zombie_pigman: () => ({
    layers: ['entity/piglin/zombified_piglin'], texW: 64, texH: 64,
    parts: humanoid({
      wide: true,
      head: [C(0, 0, -5, -8, -4, 10, 8, 8), C(31, 1, -2, -4, -5, 4, 4, 1), C(2, 4, 2, -2, -5, 1, 2, 1), C(2, 0, -3, -2, -5, 1, 2, 1)],
      headExtra: [
        ...boxes([C(51, 6, 0, 0, -2, 1, 5, 4)], place([4.5, -6, 0], [0, 0, -Math.PI / 6])),
        ...boxes([C(39, 6, -1, 0, -2, 1, 5, 4)], place([-4.5, -6, 0], [0, 0, Math.PI / 6])),
      ],
    }),
  }),
  skeleton: () => ({ layers: ['entity/skeleton/skeleton'], texW: 64, texH: 32 }),
  creeper: () => ({ layers: ['entity/creeper/creeper'], texW: 64, texH: 32 }),
  spider: () => ({ layers: ['entity/spider/spider'], texW: 64, texH: 32 }),
  cave_spider: () => ({ layers: ['entity/spider/cave_spider'], texW: 64, texH: 32 }),
  slime: () => ({
    layers: ['entity/slime/slime'], texW: 64, texH: 32,
    parts: [
      part('inner', [0, 24, 0], [C(0, 16, -3, -7, -3, 6, 6, 6), C(32, 0, -3.25, -6, -3.5, 2, 2, 2), C(32, 4, 1.25, -6, -3.5, 2, 2, 2), C(32, 8, 0, -3, -3.5, 1, 1, 1)]),
      part('outer', [0, 24, 0], [C(0, 0, -4, -8, -4, 8, 8, 8)]),
    ],
  }),
  magma_cube: magmaCube,
  enderman: () => ({ layers: ['entity/enderman/enderman'], texW: 64, texH: 32 }),
  silverfish,
  ghast: (e) => ({
    layers: [(e as unknown as { shooting: number }).shooting > 0 ? 'entity/ghast/ghast_shooting' : 'entity/ghast/ghast'],
    texW: 64, texH: 32,
  }),
  blaze: () => ({ layers: ['entity/blaze/blaze'], texW: 64, texH: 32 }),
  villager: (e) => ({
    layers: ['entity/villager/villager', 'entity/villager/type/plains',
      `entity/villager/profession/${PROFESSIONS[(e as unknown as { profession: number }).profession % 5]}`],
    texW: 64, texH: 64,
  }),
  player: () => ({ layers: ['entity/player/wide/steve'], texW: 64, texH: 64, parts: humanoid({ wide: true, hat: true }) }),
  boat,
  minecart,
  ender_crystal: crystal,
};

/** Pack model for a mob type, or null when no pack skin is available. */
export function packModelFor(type: string, e: Entity): PackModel | null {
  const f = PACK_MODELS[type];
  if (!f) return null;
  const m = f(e);
  return packImage(m.layers[0]) ? m : null;
}

const layerCache = new Map<string, THREE.Texture>();

/** Texture of a pack model's layers composited bottom to top. */
export function packModelTexture(m: PackModel): THREE.Texture {
  const key = m.layers.join('+');
  let t = layerCache.get(key);
  if (t) return t;
  const base = packImage(m.layers[0])!;
  const c = document.createElement('canvas');
  c.width = base.w; c.height = base.h;
  const g = c.getContext('2d')!;
  for (const l of m.layers) {
    const img = packImage(l);
    if (!img) continue;
    const tmp = document.createElement('canvas');
    tmp.width = img.w; tmp.height = img.h;
    tmp.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
    g.drawImage(tmp, 0, 0, c.width, c.height);
  }
  t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.colorSpace = THREE.SRGBColorSpace;
  layerCache.set(key, t);
  return t;
}

/** Key identifying the texture a pack model needs (changes with mob state). */
export function packModelKey(m: PackModel): string {
  return `pack:${m.layers.join('+')}`;
}

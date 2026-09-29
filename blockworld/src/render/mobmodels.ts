/**
 * Mob models and their original pixel skins. Every model is built from
 * pivoted boxes; animation is driven by entity state each frame.
 */

import * as THREE from 'three';
import type { Entity } from '../entity/entity';
import type { LivingEntity } from '../entity/living';
import type { Mob } from '../entity/mob';
import { MODEL_FACTORIES, interpPos, lerpAngle, type EntityVisual, type RenderContext } from './entityrenderer';
import { Part, SkinCanvas, type BoxSpec, type RGB } from './skin';
import { itemGeometry } from './itemmesh';
import { ItemId } from '../items/ids';
import { BlockId } from '../blocks/ids';
import { packActive, packImage } from './pack';
import { packModelFor, packModelKey, packModelTexture, type PackModel } from './packmodels';

type PartMap = Record<string, Part>;

interface ModelDef {
  texW: number;
  texH: number;
  skin: () => SkinCanvas;
  parts: { name: string; pivot: [number, number, number]; boxes: BoxSpec[]; parent?: string }[];
  scale?: number;
  transparent?: boolean;
  animate: (e: Entity, rc: RenderContext, p: PartMap, t: AnimInfo) => void;
  /** Extra objects (held items etc.). */
  extras?: (p: PartMap, e: Entity) => void;
  /** Vertical offset of the model in pixels. */
  yOffset?: number;
}

export interface AnimInfo {
  limbSwing: number;
  limbAmount: number;
  headYaw: number; // relative to body
  pitch: number;
  age: number;
  swing: number;
}

const skinCache = new Map<string, THREE.Texture>();

function textureFor(key: string, def: ModelDef): THREE.Texture {
  let t = skinCache.get(key);
  if (!t) {
    t = def.skin().texture();
    skinCache.set(key, t);
  }
  return t;
}

const B = (x: number, y: number, z: number, w: number, h: number, d: number, u: number, v: number, extra: Partial<BoxSpec> = {}): BoxSpec =>
  ({ x, y, z, w, h, d, u, v, ...extra });

// ---------------------------------------------------------------------------
// Skin painters
// ---------------------------------------------------------------------------
function eyes(s: SkinCanvas, fx: number, fy: number, w: number, eyeY: number, white: RGB, pupil: RGB, gap = 2): void {
  const cx = fx + w / 2;
  s.rect(cx - gap - 2, fy + eyeY, 2, 1, white); s.px(cx - gap - 1, fy + eyeY, pupil);
  s.rect(cx + gap, fy + eyeY, 2, 1, white); s.px(cx + gap, fy + eyeY, pupil);
}

const PINK: RGB = [240, 160, 160];

function pigSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 64, 'pig');
  s.box(0, 0, 8, 8, 8, PINK, 8);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.rect(fx + 1, fy + 3, 2, 1, [255, 255, 255]); s.px(fx + 1, fy + 3, [20, 20, 20]);
  s.rect(fx + 5, fy + 3, 2, 1, [255, 255, 255]); s.px(fx + 6, fy + 3, [20, 20, 20]);
  s.box(16, 16, 4, 3, 1, [230, 130, 140], 6); // snout
  const [sx, sy] = s.front(16, 16, 4, 3, 1);
  s.px(sx + 1, sy + 1, [120, 50, 60]); s.px(sx + 2, sy + 1, [120, 50, 60]);
  s.box(0, 32, 10, 8, 16, PINK, 8); // body
  s.box(0, 16, 4, 6, 4, [220, 140, 140], 8); // leg
  s.rect(0, 16 + 4 + 5, 16, 1, [120, 80, 70]);
  return s;
}

function cowSkin(red: boolean): SkinCanvas {
  const s = new SkinCanvas(64, 64, red ? 'mooshroom' : 'cow');
  const base: RGB = red ? [168, 30, 30] : [70, 52, 40];
  const patch: RGB = red ? [230, 220, 210] : [235, 235, 230];
  s.box(0, 0, 8, 8, 6, base, 10);
  const [fx, fy] = s.front(0, 0, 8, 8, 6);
  s.rect(fx + 1, fy + 2, 6, 3, patch);
  s.rect(fx + 1, fy + 3, 2, 1, [20, 20, 20]); s.rect(fx + 5, fy + 3, 2, 1, [20, 20, 20]);
  s.rect(fx + 2, fy + 6, 4, 2, [220, 190, 170]);
  s.px(fx + 2, fy + 7, [60, 40, 40]); s.px(fx + 5, fy + 7, [60, 40, 40]);
  s.box(22, 0, 1, 3, 1, [220, 220, 200], 6); // horn
  s.box(0, 32, 12, 10, 18, base, 10); // body
  for (let i = 0; i < 9; i++) {
    const x = s.rng.int(56); const y = 32 + s.rng.int(25);
    s.noise(x, y, 3 + s.rng.int(5), 2 + s.rng.int(4), patch, 6);
  }
  s.box(0, 16, 4, 12, 4, base, 10);
  s.noise(0, 16 + 4 + 6, 16, 4, patch, 6);
  s.rect(0, 16 + 4 + 11, 16, 1, [40, 30, 20]);
  return s;
}

function sheepSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 64, 'sheep');
  s.box(0, 0, 6, 6, 8, [210, 190, 170], 8); // face
  const [fx, fy] = s.front(0, 0, 6, 6, 8);
  s.rect(fx + 1, fy + 2, 1, 1, [20, 20, 20]); s.rect(fx + 4, fy + 2, 1, 1, [20, 20, 20]);
  s.rect(fx + 2, fy + 4, 2, 1, [200, 150, 150]);
  s.box(0, 32, 8, 6, 16, [200, 180, 160], 8);
  s.box(0, 16, 4, 12, 4, [200, 180, 160], 8);
  s.rect(0, 16 + 4 + 11, 16, 1, [60, 50, 40]);
  return s;
}

function woolSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 64, 'wool');
  s.box(0, 0, 6, 6, 6, [235, 235, 235], 14);
  s.box(0, 32, 8, 6, 16, [235, 235, 235], 14);
  s.box(0, 16, 4, 6, 4, [235, 235, 235], 14);
  return s;
}

function chickenSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'chicken');
  s.box(0, 0, 4, 6, 3, [245, 245, 245], 6);
  const [fx, fy] = s.front(0, 0, 4, 6, 3);
  s.px(fx, fy + 1, [20, 20, 20]); s.px(fx + 3, fy + 1, [20, 20, 20]);
  s.box(14, 0, 4, 2, 2, [240, 170, 40], 8); // beak
  s.box(14, 4, 2, 2, 2, [220, 40, 40], 8); // wattle
  s.box(0, 9, 6, 8, 6, [240, 240, 240], 8); // body
  s.box(24, 13, 1, 4, 6, [225, 225, 225], 8); // wing
  s.box(26, 0, 3, 5, 3, [240, 170, 40], 8); // leg
  return s;
}

function squidSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'squid');
  s.box(0, 0, 12, 16, 12, [40, 60, 110], 12);
  const [fx, fy] = s.front(0, 0, 12, 16, 12);
  s.rect(fx + 2, fy + 10, 3, 2, [230, 230, 230]); s.rect(fx + 7, fy + 10, 3, 2, [230, 230, 230]);
  s.px(fx + 3, fy + 11, [10, 10, 10]); s.px(fx + 8, fy + 11, [10, 10, 10]);
  s.box(48, 0, 2, 18, 2, [50, 70, 120], 10);
  return s;
}

function wolfSkin(tamed: boolean, angry: boolean): SkinCanvas {
  const s = new SkinCanvas(64, 32, `wolf${tamed}${angry}`);
  const fur: RGB = [215, 212, 208];
  s.box(0, 0, 6, 6, 4, fur, 8);
  const [fx, fy] = s.front(0, 0, 6, 6, 4);
  if (angry) {
    s.rect(fx + 1, fy + 2, 1, 1, [200, 30, 30]); s.rect(fx + 4, fy + 2, 1, 1, [200, 30, 30]);
    s.rect(fx + 1, fy + 1, 2, 1, [60, 60, 60]); s.rect(fx + 3, fy + 1, 2, 1, [60, 60, 60]);
  } else {
    s.rect(fx + 1, fy + 2, 1, 1, [20, 20, 20]); s.rect(fx + 4, fy + 2, 1, 1, [20, 20, 20]);
  }
  s.box(16, 14, 2, 2, 1, fur, 6); // ear
  s.box(0, 10, 3, 3, 4, [200, 196, 190], 6); // snout
  const [nx, ny] = s.front(0, 10, 3, 3, 4);
  s.rect(nx, ny, 3, 1, [30, 30, 30]);
  s.box(18, 14, 6, 6, 9, fur, 8); // body
  s.box(21, 0, 8, 7, 6, fur, 10); // mane
  if (tamed) {
    const [mx, my] = s.front(21, 0, 8, 7, 6);
    s.rect(mx, my + 5, 8, 2, [200, 30, 30]);
  }
  s.box(0, 18, 2, 8, 2, fur, 8); // leg
  s.box(9, 18, 2, 8, 2, fur, 8); // tail
  return s;
}

function zombieSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'zombie');
  const skin: RGB = [90, 150, 80];
  s.box(0, 0, 8, 8, 8, skin, 12);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.rect(fx + 1, fy + 3, 2, 2, [20, 30, 20]); s.rect(fx + 5, fy + 3, 2, 2, [20, 30, 20]);
  s.rect(fx + 2, fy + 6, 4, 1, [40, 70, 40]);
  s.rect(fx, fy, 8, 1, [60, 110, 60]);
  s.box(16, 16, 8, 12, 4, [40, 150, 160], 10); // shirt
  const [bx, by] = s.front(16, 16, 8, 12, 4);
  s.rect(bx, by, 8, 2, skin);
  s.box(40, 16, 4, 12, 4, [40, 150, 160], 10); // arm
  s.noise(40, 16 + 4 + 8, 16, 4, skin, 10);
  s.box(0, 16, 4, 12, 4, [70, 60, 150], 10); // leg
  s.noise(0, 16 + 4 + 10, 16, 2, [60, 60, 60], 6);
  return s;
}

function pigmanSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'pigman');
  const skin: RGB = [230, 150, 150];
  const rot: RGB = [110, 150, 90];
  s.box(0, 0, 8, 8, 8, skin, 12);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.noise(fx + 4, fy, 4, 4, rot, 8);
  s.rect(fx + 1, fy + 3, 2, 1, [255, 255, 255]); s.px(fx + 2, fy + 3, [200, 20, 20]);
  s.rect(fx + 5, fy + 3, 2, 1, [255, 255, 255]); s.px(fx + 5, fy + 3, [200, 20, 20]);
  s.rect(fx + 2, fy + 5, 4, 2, [210, 120, 120]); s.px(fx + 3, fy + 6, [90, 40, 40]); s.px(fx + 4, fy + 6, [90, 40, 40]);
  s.box(16, 16, 8, 12, 4, skin, 12);
  const [bx, by] = s.front(16, 16, 8, 12, 4);
  s.noise(bx + 2, by + 3, 4, 6, rot, 8);
  s.rect(bx + 3, by + 5, 2, 3, [240, 230, 220]);
  s.box(40, 16, 4, 12, 4, skin, 12);
  s.noise(40, 16 + 4 + 2, 6, 4, rot, 8);
  s.box(0, 16, 4, 12, 4, [120, 90, 70], 10);
  return s;
}

function skeletonSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'skeleton');
  const bone: RGB = [200, 200, 196];
  s.box(0, 0, 8, 8, 8, bone, 10);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.rect(fx + 1, fy + 3, 2, 2, [30, 30, 30]); s.rect(fx + 5, fy + 3, 2, 2, [30, 30, 30]);
  s.px(fx + 3, fy + 5, [60, 60, 60]); s.px(fx + 4, fy + 5, [60, 60, 60]);
  s.rect(fx + 1, fy + 6, 6, 1, [70, 70, 70]);
  for (let i = 0; i < 4; i++) s.px(fx + 2 + i, fy + 6, [220, 220, 220]);
  s.box(16, 16, 8, 12, 4, bone, 10);
  const [bx, by] = s.front(16, 16, 8, 12, 4);
  s.rect(bx + 3, by, 2, 12, [150, 150, 146]);
  for (let r = 0; r < 4; r++) s.rect(bx + 1, by + 2 + r * 2, 6, 1, [30, 30, 30]);
  s.box(40, 16, 2, 12, 2, bone, 10);
  return s;
}

function creeperSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'creeper');
  const g: RGB = [80, 180, 70];
  const camo = (x: number, y: number, w: number, h: number) => {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) {
      const r = s.rng.next();
      s.px(xx, yy, r < 0.2 ? [140, 220, 120] : r < 0.45 ? [60, 140, 55] : r < 0.55 ? [200, 230, 190] : g);
    }
  };
  camo(0, 0, 32, 16);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.rect(fx + 1, fy + 2, 2, 2, [10, 10, 10]); s.rect(fx + 5, fy + 2, 2, 2, [10, 10, 10]);
  s.rect(fx + 3, fy + 4, 2, 3, [10, 10, 10]); s.rect(fx + 2, fy + 5, 1, 3, [10, 10, 10]); s.rect(fx + 5, fy + 5, 1, 3, [10, 10, 10]);
  camo(16, 16, 24, 16);
  camo(0, 16, 16, 10);
  return s;
}

function spiderSkin(cave: boolean): SkinCanvas {
  const s = new SkinCanvas(64, 32, cave ? 'cavespider' : 'spider');
  const body: RGB = cave ? [30, 60, 70] : [50, 42, 38];
  s.box(32, 4, 8, 8, 8, body, 10); // head
  const [fx, fy] = s.front(32, 4, 8, 8, 8);
  const red: RGB = [220, 20, 20];
  s.rect(fx + 1, fy + 3, 2, 1, red); s.rect(fx + 5, fy + 3, 2, 1, red);
  s.px(fx + 2, fy + 2, red); s.px(fx + 5, fy + 2, red); s.px(fx + 3, fy + 4, red); s.px(fx + 4, fy + 4, red);
  s.box(0, 0, 6, 6, 6, body, 10); // thorax
  s.box(0, 12, 10, 8, 12, body, 12); // abdomen
  const [ax, ay] = s.top(0, 12, 10, 8, 12);
  for (let i = 0; i < 5; i++) s.rect(ax + 2 + s.rng.int(6), ay + 2 + s.rng.int(8), 2, 1, cave ? [60, 110, 120] : [90, 70, 60]);
  s.box(18, 0, 16, 2, 2, cave ? [20, 45, 50] : [40, 32, 28], 8); // leg
  return s;
}

function slimeSkin(magma: boolean): SkinCanvas {
  const s = new SkinCanvas(64, 32, magma ? 'magma' : 'slime');
  if (magma) {
    s.box(0, 0, 8, 1, 8, [60, 20, 10], 10);
    for (let x = 0; x < 32; x++) if (s.rng.chance(0.35)) s.px(x, 8, [250, 170, 40]);
    s.box(0, 10, 8, 1, 8, [70, 25, 12], 10);
    s.box(32, 0, 4, 4, 4, [255, 180, 60], 20); // core
    s.box(24, 20, 2, 1, 2, [255, 240, 120], 0); // eyes
  } else {
    s.box(0, 0, 8, 8, 8, [110, 200, 90], 18, 0.55);
    s.box(0, 16, 6, 6, 6, [90, 180, 70], 10);
    s.box(32, 0, 2, 2, 2, [20, 40, 20], 0);
    s.box(32, 4, 1, 1, 1, [20, 40, 20], 0);
  }
  return s;
}

function endermanSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'enderman');
  const black: RGB = [16, 12, 20];
  s.box(0, 0, 8, 8, 8, black, 4);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.rect(fx, fy + 4, 3, 1, [220, 100, 255]); s.rect(fx + 5, fy + 4, 3, 1, [220, 100, 255]);
  s.px(fx + 1, fy + 4, [255, 200, 255]); s.px(fx + 6, fy + 4, [255, 200, 255]);
  s.box(0, 16, 8, 8, 8, black, 4); // jaw
  s.box(32, 16, 8, 12, 4, black, 4);
  s.box(56, 0, 2, 30, 2, black, 4);
  return s;
}

function silverfishSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'silverfish');
  s.box(0, 0, 8, 8, 8, [140, 140, 150], 18);
  for (let x = 0; x < 64; x += 3) s.rect(x, 0, 1, 32, [110, 110, 120], 0.4);
  return s;
}

function ghastSkin(shooting: boolean): SkinCanvas {
  const s = new SkinCanvas(64, 32, shooting ? 'ghast2' : 'ghast');
  s.box(0, 0, 16, 16, 16, [236, 236, 236], 6);
  const [fx, fy] = s.front(0, 0, 16, 16, 16);
  if (shooting) {
    s.rect(fx + 3, fy + 4, 3, 3, [30, 30, 30]); s.rect(fx + 10, fy + 4, 3, 3, [30, 30, 30]);
    s.rect(fx + 4, fy + 5, 1, 2, [220, 30, 30]); s.rect(fx + 11, fy + 5, 1, 2, [220, 30, 30]);
    s.rect(fx + 6, fy + 10, 4, 4, [30, 30, 30]);
  } else {
    s.rect(fx + 3, fy + 5, 3, 1, [60, 60, 60]); s.rect(fx + 10, fy + 5, 3, 1, [60, 60, 60]);
    s.rect(fx + 6, fy + 11, 4, 1, [60, 60, 60]);
  }
  s.rect(fx + 3, fy + 6, 3, 1, [150, 150, 170]); s.rect(fx + 10, fy + 6, 3, 1, [150, 150, 170]);
  s.box(0, 0, 2, 9, 2, [230, 230, 230], 6);
  return s;
}

function blazeSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'blaze');
  s.box(0, 0, 8, 8, 8, [230, 170, 40], 20);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.rect(fx + 1, fy + 3, 2, 1, [60, 20, 0]); s.rect(fx + 5, fy + 3, 2, 1, [60, 20, 0]);
  s.rect(fx + 2, fy + 5, 4, 1, [140, 40, 0]);
  s.rect(fx, fy, 8, 1, [255, 230, 120]);
  s.box(0, 16, 2, 8, 2, [250, 200, 60], 20);
  return s;
}

function villagerSkin(prof: number): SkinCanvas {
  const s = new SkinCanvas(64, 64, `villager${prof}`);
  const robe: RGB = ([[140, 90, 60], [240, 240, 240], [120, 60, 150], [60, 60, 60], [230, 230, 210]] as RGB[])[prof % 5];
  const skin: RGB = [190, 140, 110];
  s.box(0, 0, 8, 10, 8, skin, 8);
  const [fx, fy] = s.front(0, 0, 8, 10, 8);
  s.rect(fx, fy, 8, 2, [90, 60, 40]);
  s.rect(fx + 1, fy + 4, 2, 1, [255, 255, 255]); s.px(fx + 2, fy + 4, [40, 100, 40]);
  s.rect(fx + 5, fy + 4, 2, 1, [255, 255, 255]); s.px(fx + 5, fy + 4, [40, 100, 40]);
  s.rect(fx + 1, fy + 3, 6, 1, [70, 50, 30]);
  s.box(24, 0, 2, 4, 2, [170, 120, 95], 6); // nose
  s.box(16, 20, 8, 12, 6, robe, 10); // body
  s.box(0, 38, 8, 18, 6, robe, 10); // robe
  s.box(44, 22, 4, 8, 4, robe, 10); // arms
  s.box(40, 38, 8, 4, 4, skin, 6);
  s.box(0, 22, 4, 12, 4, [70, 50, 40], 8); // legs
  return s;
}

function dragonSkin(): SkinCanvas {
  const s = new SkinCanvas(256, 256, 'dragon');
  const scale: RGB = [26, 22, 30];
  s.noise(0, 0, 256, 256, scale, 8);
  for (let i = 0; i < 500; i++) s.px(s.rng.int(256), s.rng.int(256), [50, 42, 58]);
  // Head (16x16x16 at 112,30).
  const [hx, hy] = s.front(112, 30, 16, 16, 16);
  s.rect(hx + 1, hy + 5, 5, 2, [200, 80, 230]); s.rect(hx + 10, hy + 5, 5, 2, [200, 80, 230]);
  s.rect(hx + 2, hy + 5, 2, 1, [255, 200, 255]); s.rect(hx + 12, hy + 5, 2, 1, [255, 200, 255]);
  // Belly lighter plates (body at 0,0 24x24x64).
  const [bx, by] = s.front(0, 0, 24, 24, 64);
  s.noise(bx + 4, by, 16, 24, [44, 36, 50], 6);
  // Spine plates.
  s.box(48, 0, 2, 4, 6, [70, 60, 80], 8);
  // Wing membrane (at 0,88 region) slightly purple.
  s.noise(0, 88, 112, 56, [34, 24, 44], 10);
  for (let x = 0; x < 112; x += 7) s.rect(x, 88, 1, 56, [48, 36, 60]);
  return s;
}

function crystalSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'crystal');
  s.box(0, 0, 8, 8, 8, [200, 160, 255], 30, 0.45);
  for (let x = 0; x < 32; x++) { s.px(x, 8, [255, 255, 255], 0.7); s.px(x, 15, [255, 255, 255], 0.7); }
  s.box(32, 0, 8, 8, 8, [255, 120, 220], 40);
  s.box(0, 16, 12, 4, 12, [80, 80, 80], 20);
  return s;
}

function boatSkin(): SkinCanvas {
  const s = new SkinCanvas(128, 64, 'boat');
  s.noise(0, 0, 128, 64, [150, 118, 72], 10);
  for (let y = 0; y < 64; y += 4) s.rect(0, y + 3, 128, 1, [110, 84, 50]);
  return s;
}

function minecartSkin(): SkinCanvas {
  const s = new SkinCanvas(128, 64, 'minecart');
  s.noise(0, 0, 128, 64, [120, 120, 124], 10);
  for (let y = 0; y < 64; y += 8) s.rect(0, y, 128, 1, [80, 80, 84]);
  return s;
}

function playerSkin(): SkinCanvas {
  const s = new SkinCanvas(64, 32, 'player');
  const skin: RGB = [184, 138, 104];
  s.box(0, 0, 8, 8, 8, skin, 8);
  const [fx, fy] = s.front(0, 0, 8, 8, 8);
  s.rect(fx, fy, 8, 2, [74, 48, 32]);
  s.rect(fx + 1, fy + 4, 2, 1, [255, 255, 255]); s.px(fx + 2, fy + 4, [58, 74, 154]);
  s.rect(fx + 5, fy + 4, 2, 1, [255, 255, 255]); s.px(fx + 5, fy + 4, [58, 74, 154]);
  s.rect(fx + 3, fy + 6, 2, 1, [120, 74, 58]);
  const [tx, ty] = s.top(0, 0, 8, 8, 8);
  s.rect(tx, ty, 8, 8, [74, 48, 32]);
  s.box(16, 16, 8, 12, 4, [42, 160, 168], 8);
  s.box(40, 16, 4, 12, 4, [42, 160, 168], 8);
  s.noise(40, 16 + 4 + 8, 16, 4, skin, 6);
  s.box(0, 16, 4, 12, 4, [58, 58, 138], 8);
  s.noise(0, 16 + 4 + 10, 16, 2, [80, 80, 80], 6);
  return s;
}

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------
function walkLegs(p: PartMap, names: string[], t: AnimInfo, amp = 1.4): void {
  names.forEach((n, i) => {
    const part = p[n];
    if (!part) return;
    part.group.rotation.x = Math.cos(t.limbSwing * 0.6662 + (i % 2 === 0 ? 0 : Math.PI) + (i >= 2 ? Math.PI : 0)) * amp * t.limbAmount;
  });
}

function lookHead(p: PartMap, t: AnimInfo, name = 'head'): void {
  const h = p[name];
  if (!h) return;
  h.group.rotation.y = t.headYaw;
  h.group.rotation.x = t.pitch;
}

function biped(e: Entity, p: PartMap, t: AnimInfo, armsForward: boolean): void {
  lookHead(p, t);
  const s = Math.cos(t.limbSwing * 0.6662) * 1.2 * t.limbAmount;
  p.rleg.group.rotation.x = s;
  p.lleg.group.rotation.x = -s;
  if (armsForward) {
    const bob = Math.sin(t.age * 0.067) * 0.05;
    p.rarm.group.rotation.x = -Math.PI / 2 + bob - Math.sin(t.swing * Math.PI) * 0.6;
    p.larm.group.rotation.x = -Math.PI / 2 - bob - Math.sin(t.swing * Math.PI) * 0.6;
  } else {
    p.rarm.group.rotation.x = -s * 0.8 - Math.sin(t.swing * Math.PI) * 1.2;
    p.larm.group.rotation.x = s * 0.8;
  }
  p.rarm.group.rotation.z = Math.sin(t.age * 0.09) * 0.05 + 0.05;
  p.larm.group.rotation.z = -Math.sin(t.age * 0.09) * 0.05 - 0.05;
  void e;
}

function humanoidParts(u: { head: [number, number]; body: [number, number]; arm: [number, number]; leg: [number, number] }, armW = 4, legW = 4): ModelDef['parts'] {
  return [
    { name: 'head', pivot: [0, 24, 0], boxes: [B(-4, 0, -4, 8, 8, 8, u.head[0], u.head[1])] },
    { name: 'body', pivot: [0, 24, 0], boxes: [B(-4, -12, -2, 8, 12, 4, u.body[0], u.body[1])] },
    { name: 'rarm', pivot: [4 + armW / 2, 22, 0], boxes: [B(-armW / 2, -10, -armW / 2, armW, 12, armW, u.arm[0], u.arm[1])] },
    { name: 'larm', pivot: [-4 - armW / 2, 22, 0], boxes: [B(-armW / 2, -10, -armW / 2, armW, 12, armW, u.arm[0], u.arm[1], { mirror: true })] },
    { name: 'rleg', pivot: [legW === 4 ? 2 : 2, 12, 0], boxes: [B(-legW / 2, -12, -legW / 2, legW, 12, legW, u.leg[0], u.leg[1])] },
    { name: 'lleg', pivot: [-2, 12, 0], boxes: [B(-legW / 2, -12, -legW / 2, legW, 12, legW, u.leg[0], u.leg[1], { mirror: true })] },
  ];
}

const HUMAN_UV = { head: [0, 0] as [number, number], body: [16, 16] as [number, number], arm: [40, 16] as [number, number], leg: [0, 16] as [number, number] };

// ---------------------------------------------------------------------------
// Model definitions
// ---------------------------------------------------------------------------
export const MODEL_DEFS: Record<string, (e: Entity) => ModelDef> = {
  pig: () => ({
    texW: 64, texH: 64, skin: pigSkin,
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [B(-5, 6, -8, 10, 8, 16, 0, 32)] },
      { name: 'head', pivot: [0, 12, -7], boxes: [B(-4, -4, -8, 8, 8, 8, 0, 0), B(-2, -4, -9, 4, 3, 1, 16, 16)] },
      { name: 'leg0', pivot: [3, 6, -5], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
      { name: 'leg1', pivot: [-3, 6, -5], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
      { name: 'leg2', pivot: [3, 6, 5], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
      { name: 'leg3', pivot: [-3, 6, 5], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
    ],
    animate: (_e, _rc, p, t) => { lookHead(p, t); walkLegs(p, ['leg0', 'leg1', 'leg2', 'leg3'], t); },
  }),
  cow: () => cowDef(false),
  mooshroom: () => cowDef(true),
  sheep: (e) => ({
    texW: 64, texH: 64, skin: sheepSkin,
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [B(-4, 12, -8, 8, 6, 16, 0, 32)] },
      { name: 'head', pivot: [0, 18, -8], boxes: [B(-3, -4, -6, 6, 6, 8, 0, 0)] },
      { name: 'leg0', pivot: [3, 12, -5], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
      { name: 'leg1', pivot: [-3, 12, -5], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
      { name: 'leg2', pivot: [3, 12, 6], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
      { name: 'leg3', pivot: [-3, 12, 6], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
    ],
    animate: (en, _rc, p, t) => {
      lookHead(p, t);
      walkLegs(p, ['leg0', 'leg1', 'leg2', 'leg3'], t);
      const sh = en as unknown as { eatTimer: number };
      if (sh.eatTimer > 0) p.head.group.rotation.x = 0.8;
    },
    extras: (p, en) => addWool(p, en),
  }),
  chicken: () => ({
    texW: 64, texH: 32, skin: chickenSkin,
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [B(-3, 5, -3, 6, 6, 8, 0, 9)] },
      { name: 'head', pivot: [0, 9, -3], boxes: [B(-2, 0, -3, 4, 6, 3, 0, 0), B(-2, 2, -5, 4, 2, 2, 14, 0), B(-1, 0, -4, 2, 2, 2, 14, 4)] },
      { name: 'rwing', pivot: [3, 11, 0], boxes: [B(0, -4, -3, 1, 4, 6, 24, 13)] },
      { name: 'lwing', pivot: [-3, 11, 0], boxes: [B(-1, -4, -3, 1, 4, 6, 24, 13, { mirror: true })] },
      { name: 'leg0', pivot: [1.5, 5, 1], boxes: [B(-1.5, -5, -1.5, 3, 5, 3, 26, 0)] },
      { name: 'leg1', pivot: [-1.5, 5, 1], boxes: [B(-1.5, -5, -1.5, 3, 5, 3, 26, 0)] },
    ],
    animate: (en, rc, p, t) => {
      lookHead(p, t);
      walkLegs(p, ['leg0', 'leg1'], t);
      const flying = !en.onGround;
      const f = flying ? Math.sin(rc.time * 30) * 0.8 + 0.8 : 0;
      p.rwing.group.rotation.z = f;
      p.lwing.group.rotation.z = -f;
    },
  }),
  squid: () => {
    const parts: ModelDef['parts'] = [{ name: 'body', pivot: [0, 8, 0], boxes: [B(-6, 0, -6, 12, 16, 12, 0, 0)] }];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      parts.push({ name: `t${i}`, pivot: [Math.cos(a) * 5, 8, Math.sin(a) * 5], boxes: [B(-1, -18, -1, 2, 18, 2, 48, 0)] });
    }
    return {
      texW: 64, texH: 32, skin: squidSkin, parts,
      animate: (en, _rc, p) => {
        const sq = en as unknown as { tentacleAngle: number };
        const spread = Math.max(0, Math.sin(sq.tentacleAngle)) * 0.6 + 0.1;
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          p[`t${i}`].group.rotation.set(Math.sin(a) * spread, 0, -Math.cos(a) * spread);
        }
      },
      yOffset: 0,
    };
  },
  wolf: (e) => {
    const w = e as unknown as { tamed: boolean; angry: boolean };
    return {
      texW: 64, texH: 32, skin: () => wolfSkin(w.tamed, w.angry),
      parts: [
        { name: 'body', pivot: [0, 10, 2], boxes: [B(-3, -3, -2, 6, 6, 9, 18, 14)] },
        { name: 'mane', pivot: [0, 10, -1], boxes: [B(-4, -3.5, -3, 8, 7, 6, 21, 0)] },
        { name: 'head', pivot: [0, 13.5, -4], boxes: [B(-3, -3, -4, 6, 6, 4, 0, 0), B(-1.5, -3, -7, 3, 3, 4, 0, 10), B(-3, 3, -2, 2, 2, 1, 16, 14), B(1, 3, -2, 2, 2, 1, 16, 14)] },
        { name: 'leg0', pivot: [1.5, 8, 6.5], boxes: [B(-1, -8, -1, 2, 8, 2, 0, 18)] },
        { name: 'leg1', pivot: [-1.5, 8, 6.5], boxes: [B(-1, -8, -1, 2, 8, 2, 0, 18)] },
        { name: 'leg2', pivot: [1.5, 8, -2], boxes: [B(-1, -8, -1, 2, 8, 2, 0, 18)] },
        { name: 'leg3', pivot: [-1.5, 8, -2], boxes: [B(-1, -8, -1, 2, 8, 2, 0, 18)] },
        { name: 'tail', pivot: [0, 12, 8], boxes: [B(-1, -8, -1, 2, 8, 2, 9, 18)] },
      ],
      animate: (en, rc, p, t) => {
        lookHead(p, t);
        const wo = en as unknown as { sitting: boolean; tamed: boolean; angry: boolean; health: number; maxHealth: number };
        if (wo.sitting) {
          p.body.group.rotation.x = -0.6; p.body.group.position.y = 8;
          p.leg0.group.rotation.x = -1.4; p.leg1.group.rotation.x = -1.4;
          p.leg0.group.position.y = 4; p.leg1.group.position.y = 4;
          p.tail.group.rotation.x = 1.2; p.tail.group.position.y = 5;
        } else {
          p.body.group.rotation.x = 0; p.body.group.position.y = 10;
          p.leg0.group.position.y = 8; p.leg1.group.position.y = 8;
          p.tail.group.position.y = 12;
          walkLegs(p, ['leg0', 'leg1', 'leg2', 'leg3'], t);
          p.tail.group.rotation.x = wo.angry ? 1.5 : wo.tamed ? 0.6 + (1 - wo.health / wo.maxHealth) * 0.8 : 0.6;
          p.tail.group.rotation.z = Math.cos(t.limbSwing * 0.6662) * 0.6 * t.limbAmount;
        }
        void rc;
      },
    };
  },
  zombie: () => ({ texW: 64, texH: 32, skin: zombieSkin, parts: humanoidParts(HUMAN_UV), animate: (e, _rc, p, t) => biped(e, p, t, true) }),
  zombie_pigman: () => ({
    texW: 64, texH: 32, skin: pigmanSkin, parts: humanoidParts(HUMAN_UV),
    animate: (e, _rc, p, t) => biped(e, p, t, !!(e as Mob).target),
    extras: (p) => holdItem(p.rarm, ItemId.GOLD_SWORD),
  }),
  skeleton: () => ({
    texW: 64, texH: 32, skin: skeletonSkin, parts: humanoidParts(HUMAN_UV, 2, 2),
    animate: (e, _rc, p, t) => {
      biped(e, p, t, false);
      if ((e as Mob).target) {
        p.rarm.group.rotation.x = -Math.PI / 2 + t.pitch;
        p.larm.group.rotation.x = -Math.PI / 2 + t.pitch;
        p.rarm.group.rotation.y = -0.1 + t.headYaw;
        p.larm.group.rotation.y = 0.5 + t.headYaw;
      }
    },
    extras: (p) => holdItem(p.rarm, ItemId.BOW),
  }),
  creeper: () => ({
    texW: 64, texH: 32, skin: creeperSkin,
    parts: [
      { name: 'head', pivot: [0, 18, 0], boxes: [B(-4, 0, -4, 8, 8, 8, 0, 0)] },
      { name: 'body', pivot: [0, 6, 0], boxes: [B(-4, 0, -2, 8, 12, 4, 16, 16)] },
      { name: 'leg0', pivot: [2, 6, -4], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
      { name: 'leg1', pivot: [-2, 6, -4], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
      { name: 'leg2', pivot: [2, 6, 4], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
      { name: 'leg3', pivot: [-2, 6, 4], boxes: [B(-2, -6, -2, 4, 6, 4, 0, 16)] },
    ],
    animate: (_e, _rc, p, t) => { lookHead(p, t); walkLegs(p, ['leg0', 'leg1', 'leg2', 'leg3'], t); },
  }),
  spider: () => spiderDef(false),
  cave_spider: () => spiderDef(true),
  slime: () => ({
    texW: 64, texH: 32, skin: () => slimeSkin(false), transparent: true,
    parts: [
      { name: 'inner', pivot: [0, 0, 0], boxes: [B(-3, 1, -3, 6, 6, 6, 0, 16), B(-3.3, 4, -3.5, 2, 2, 2, 32, 0), B(1.3, 4, -3.5, 2, 2, 2, 32, 0), B(0, 2, -3.5, 1, 1, 1, 32, 4)] },
      { name: 'outer', pivot: [0, 0, 0], boxes: [B(-4, 0, -4, 8, 8, 8, 0, 0)] },
    ],
    animate: (en, rc, p) => slimeSquish(en, rc, p),
  }),
  magma_cube: () => {
    const parts: ModelDef['parts'] = [{ name: 'core', pivot: [0, 0, 0], boxes: [B(-2, 2, -2, 4, 4, 4, 32, 0), B(-3, 5, -4.1, 2, 1, 1, 24, 20), B(1, 5, -4.1, 2, 1, 1, 24, 20)] }];
    for (let i = 0; i < 8; i++) parts.push({ name: `s${i}`, pivot: [0, i, 0], boxes: [B(-4, 0, -4, 8, 1, 8, 0, i % 2 ? 10 : 0)] });
    return {
      texW: 64, texH: 32, skin: () => slimeSkin(true), parts,
      animate: (en, rc, p) => {
        const sl = en as unknown as { squish: number; prevSquish: number };
        const sq = sl.prevSquish + (sl.squish - sl.prevSquish) * rc.alpha;
        for (let i = 0; i < 8; i++) p[`s${i}`].group.position.y = i * (1 + sq * 1.5);
      },
    };
  },
  enderman: () => ({
    texW: 64, texH: 32, skin: endermanSkin,
    parts: [
      { name: 'head', pivot: [0, 38, 0], boxes: [B(-4, 0, -4, 8, 8, 8, 0, 0)] },
      { name: 'jaw', pivot: [0, 38, 0], boxes: [B(-4, -0.5, -4, 8, 8, 8, 0, 16, { inflate: -0.5 })] },
      { name: 'body', pivot: [0, 26, 0], boxes: [B(-4, 0, -2, 8, 12, 4, 32, 16)] },
      { name: 'rarm', pivot: [5, 36, 0], boxes: [B(-1, -30, -1, 2, 30, 2, 56, 0)] },
      { name: 'larm', pivot: [-5, 36, 0], boxes: [B(-1, -30, -1, 2, 30, 2, 56, 0, { mirror: true })] },
      { name: 'rleg', pivot: [2, 26, 0], boxes: [B(-1, -26, -1, 2, 26, 2, 56, 0)] },
      { name: 'lleg', pivot: [-2, 26, 0], boxes: [B(-1, -26, -1, 2, 26, 2, 56, 0, { mirror: true })] },
    ],
    animate: (en, _rc, p, t) => {
      lookHead(p, t, 'head');
      p.jaw.group.rotation.copy(p.head.group.rotation);
      const angry = (en as unknown as { angry: boolean }).angry;
      p.head.group.position.y = angry ? 43 : 38;
      const s = Math.cos(t.limbSwing * 0.6662) * 0.7 * t.limbAmount;
      p.rleg.group.rotation.x = s; p.lleg.group.rotation.x = -s;
      p.rarm.group.rotation.x = -s * 0.6; p.larm.group.rotation.x = s * 0.6;
      const carrying = (en as unknown as { carried: number }).carried > 0;
      if (carrying) { p.rarm.group.rotation.x = -0.5; p.larm.group.rotation.x = -0.5; }
    },
    extras: (p, en) => carriedBlock(p, en),
  }),
  silverfish: () => {
    const sizes: [number, number, number][] = [[3, 2, 2], [4, 3, 2], [6, 4, 3], [3, 3, 3], [2, 2, 3], [2, 1, 2], [1, 1, 2]];
    const parts: ModelDef['parts'] = [];
    let z = -3.5;
    sizes.forEach(([w, h, d], i) => {
      parts.push({ name: `s${i}`, pivot: [0, 0, z + d / 2], boxes: [B(-w / 2, 0, -d / 2, w, h, d, i * 8 % 64, 0)] });
      z += d;
    });
    return {
      texW: 64, texH: 32, skin: silverfishSkin, parts,
      animate: (_e, _rc, p, t) => {
        for (let i = 0; i < 7; i++) p[`s${i}`].group.rotation.y = Math.cos(t.age * 0.9 + i * 0.15 * Math.PI) * Math.PI * 0.05 * (1 + Math.abs(i - 2));
      },
    };
  },
  ghast: (e) => {
    const parts: ModelDef['parts'] = [{ name: 'body', pivot: [0, 8, 0], boxes: [B(-8, 0, -8, 16, 16, 16, 0, 0)] }];
    for (let i = 0; i < 9; i++) {
      const x = ((i % 3) - 1) * 5 + ((Math.floor(i / 3) % 2) ? 1 : 0);
      const z = (Math.floor(i / 3) - 1) * 5;
      const len = 9 + ((i * 7) % 5);
      parts.push({ name: `t${i}`, pivot: [x, 9, z], boxes: [B(-1, -len, -1, 2, len, 2, 0, 0)] });
    }
    return {
      texW: 64, texH: 32, skin: () => ghastSkin((e as unknown as { shooting: number }).shooting > 0), parts,
      scale: 4.5 / 1, yOffset: 0,
      animate: (_e, _rc, p, t) => {
        for (let i = 0; i < 9; i++) p[`t${i}`].group.rotation.x = 0.2 * Math.sin(t.age * 0.3 + i) + 0.4;
      },
    };
  },
  blaze: () => {
    const parts: ModelDef['parts'] = [{ name: 'head', pivot: [0, 22, 0], boxes: [B(-4, 0, -4, 8, 8, 8, 0, 0)] }];
    for (let i = 0; i < 12; i++) parts.push({ name: `r${i}`, pivot: [0, 0, 0], boxes: [B(-1, 0, -1, 2, 8, 2, 0, 16)] });
    return {
      texW: 64, texH: 32, skin: blazeSkin, parts,
      animate: (_e, rc, p, t) => {
        lookHead(p, t);
        const a = rc.time * 1.2;
        for (let i = 0; i < 12; i++) {
          const ring = Math.floor(i / 4);
          const ang = a * (ring === 1 ? -1 : 1) + (i % 4) * (Math.PI / 2) + ring * 0.4;
          const r = ring === 0 ? 9 : ring === 1 ? 7 : 5;
          const y = ring === 0 ? 14 : ring === 1 ? 8 : 2;
          p[`r${i}`].group.position.set(Math.cos(ang) * r, y + Math.cos((i * 2 + t.age) * 0.25) * 1.5, Math.sin(ang) * r);
        }
      },
    };
  },
  villager: (e) => ({
    texW: 64, texH: 64, skin: () => villagerSkin((e as unknown as { profession: number }).profession),
    parts: [
      { name: 'head', pivot: [0, 24, 0], boxes: [B(-4, 0, -4, 8, 10, 8, 0, 0), B(-1, 1, -6, 2, 4, 2, 24, 0)] },
      { name: 'body', pivot: [0, 24, 0], boxes: [B(-4, -12, -3, 8, 12, 6, 16, 20), B(-4, -18, -3, 8, 18, 6, 0, 38, { inflate: 0.5 })] },
      { name: 'arms', pivot: [0, 21, -1], boxes: [B(-8, -6, -2, 4, 8, 4, 44, 22), B(4, -6, -2, 4, 8, 4, 44, 22), B(-4, -2, -2, 8, 4, 4, 40, 38)] },
      { name: 'rleg', pivot: [2, 12, 0], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 22)] },
      { name: 'lleg', pivot: [-2, 12, 0], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 22, { mirror: true })] },
    ],
    animate: (_e, _rc, p, t) => {
      lookHead(p, t);
      p.arms.group.rotation.x = -0.75;
      const s = Math.cos(t.limbSwing * 0.6662) * 1.0 * t.limbAmount;
      p.rleg.group.rotation.x = s; p.lleg.group.rotation.x = -s;
    },
  }),
  player: () => ({
    texW: 64, texH: 32, skin: playerSkin, parts: humanoidParts(HUMAN_UV),
    animate: (e, _rc, p, t) => {
      biped(e, p, t, false);
      const pl = e as unknown as { sneaking: boolean };
      if (pl.sneaking) { p.body.group.rotation.x = 0.4; p.head.group.position.y = 23; }
      else { p.body.group.rotation.x = 0; p.head.group.position.y = 24; }
    },
  }),
  boat: () => ({
    texW: 128, texH: 64, skin: boatSkin,
    parts: [{
      name: 'hull', pivot: [0, 0, 0], boxes: [
        B(-12, 0, -8, 24, 2, 16, 0, 8), B(-12, 2, -9, 24, 6, 2, 0, 0), B(-12, 2, 7, 24, 6, 2, 0, 0),
        B(-13, 2, -8, 2, 6, 16, 0, 0), B(11, 2, -8, 2, 6, 16, 0, 0),
      ],
    }],
    animate: (en, rc, p) => {
      const b = en as unknown as { hurtWobble: number };
      p.hull.group.rotation.x = b.hurtWobble > 0 ? Math.sin((b.hurtWobble - rc.alpha) * 1.5) * 0.08 : 0;
    },
  }),
  minecart: () => ({
    texW: 128, texH: 64, skin: minecartSkin,
    parts: [{
      name: 'cart', pivot: [0, 2, 0], boxes: [
        B(-8, 0, -10, 16, 2, 20, 0, 10), B(-8, 2, -10, 16, 8, 2, 0, 0), B(-8, 2, 8, 16, 8, 2, 0, 0),
        B(-10, 2, -10, 2, 8, 20, 0, 0), B(8, 2, -10, 2, 8, 20, 0, 0),
      ],
    }],
    animate: (en, rc, p) => {
      const m = en as unknown as { hurtWobble: number };
      p.cart.group.rotation.z = m.hurtWobble > 0 ? Math.sin((m.hurtWobble - rc.alpha) * 1.5) * 0.08 : 0;
    },
  }),
  ender_crystal: () => ({
    texW: 64, texH: 32, skin: crystalSkin, transparent: true,
    parts: [
      { name: 'base', pivot: [0, 0, 0], boxes: [B(-6, 0, -6, 12, 4, 12, 0, 16)] },
      { name: 'glass', pivot: [0, 16, 0], boxes: [B(-4, -4, -4, 8, 8, 8, 0, 0)] },
      { name: 'glass2', pivot: [0, 16, 0], boxes: [B(-3.5, -3.5, -3.5, 7, 7, 7, 0, 0)] },
      { name: 'core', pivot: [0, 16, 0], boxes: [B(-2.5, -2.5, -2.5, 5, 5, 5, 32, 0)] },
    ],
    animate: (en, rc, p) => {
      const t = ((en as unknown as { spin: number }).spin + rc.alpha) * 3 * (Math.PI / 180);
      const bob = Math.sin(t * 2) * 3 + 2;
      for (const n of ['glass', 'glass2', 'core']) p[n].group.position.y = 16 + bob;
      p.glass.group.rotation.set(t, t * 1.3, Math.PI / 4);
      p.glass2.group.rotation.set(-t * 1.2, t, 0.3);
      p.core.group.rotation.set(t * 2, -t * 1.5, t);
    },
    scale: 2,
  }),
};

function cowDef(red: boolean): ModelDef {
  return {
    texW: 64, texH: 64, skin: () => cowSkin(red),
    parts: [
      { name: 'body', pivot: [0, 0, 0], boxes: [B(-6, 10, -8, 12, 10, 18, 0, 32)] },
      { name: 'head', pivot: [0, 20, -8], boxes: [B(-4, -4, -6, 8, 8, 6, 0, 0), B(-5, 3, -4, 1, 3, 1, 22, 0), B(4, 3, -4, 1, 3, 1, 22, 0)] },
      { name: 'leg0', pivot: [4, 12, -6], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
      { name: 'leg1', pivot: [-4, 12, -6], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
      { name: 'leg2', pivot: [4, 12, 7], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
      { name: 'leg3', pivot: [-4, 12, 7], boxes: [B(-2, -12, -2, 4, 12, 4, 0, 16)] },
    ],
    animate: (_e, _rc, p, t) => { lookHead(p, t); walkLegs(p, ['leg0', 'leg1', 'leg2', 'leg3'], t); },
    extras: red ? (p) => mushroomsOnBack(p) : undefined,
  };
}

function spiderDef(cave: boolean): ModelDef {
  const parts: ModelDef['parts'] = [
    { name: 'thorax', pivot: [0, 9, 0], boxes: [B(-3, -3, -3, 6, 6, 6, 0, 0)] },
    { name: 'head', pivot: [0, 9, -3], boxes: [B(-4, -4, -8, 8, 8, 8, 32, 4)] },
    { name: 'abdomen', pivot: [0, 9, 3], boxes: [B(-5, -4, 0, 10, 8, 12, 0, 12)] },
  ];
  for (let i = 0; i < 8; i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const z = -1.5 + Math.floor(i / 2) * 1;
    parts.push({ name: `leg${i}`, pivot: [side * 3, 9, z], boxes: [B(side > 0 ? 0 : -16, -1, -1, 16, 2, 2, 18, 0)] });
  }
  return {
    texW: 64, texH: 32, skin: () => spiderSkin(cave), parts,
    scale: cave ? 0.7 : 1,
    animate: (_e, _rc, p, t) => {
      lookHead(p, t);
      for (let i = 0; i < 8; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const pair = Math.floor(i / 2);
        const baseY = [0.785, 0.39, -0.39, -0.785][pair];
        const phase = pair % 2 === 0 ? 0 : Math.PI;
        const swingY = -Math.cos(t.limbSwing * 0.6662 * 2 + phase) * 0.4 * t.limbAmount;
        const swingZ = Math.abs(Math.sin(t.limbSwing * 0.6662 + phase)) * 0.4 * t.limbAmount;
        const g = p[`leg${i}`].group;
        const tilt = [0.785, 0.58, 0.58, 0.785][pair] - swingZ;
        // Y is up: a negative Z rotation lowers the tip of a +X leg.
        g.rotation.set(0, side * (baseY + swingY), -side * tilt);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Extras
// ---------------------------------------------------------------------------
const extraMats = new Map<string, THREE.MeshBasicMaterial>();

function holdItem(part: Part, itemId: number): void {
  const { geometry, blockAtlas } = itemGeometry(itemId, 0);
  const key = blockAtlas ? 'block' : 'sprite';
  let mat = extraMats.get(key);
  if (!mat) {
    const shared = (window as unknown as { __itemMats?: Record<string, THREE.MeshBasicMaterial> }).__itemMats;
    mat = shared?.[key]?.clone() ?? new THREE.MeshBasicMaterial({ alphaTest: 0.5, side: THREE.DoubleSide, vertexColors: true });
    extraMats.set(key, mat);
  }
  const m = new THREE.Mesh(geometry, mat);
  m.scale.setScalar(10);
  m.position.set(0, -10, -3);
  m.rotation.set(-Math.PI / 2 + 0.3, Math.PI / 2, 0);
  m.userData.isItem = true;
  part.group.add(m);
}

function mushroomsOnBack(p: PartMap): void {
  const mat = new THREE.MeshBasicMaterial({ color: 0xc02020 });
  const stem = new THREE.MeshBasicMaterial({ color: 0xe8dcc8 });
  // Positions are in model space; the body part may have its pivot elsewhere.
  const o = p.body.group.position;
  for (const [x, z] of [[-2, -3], [3, 2], [-1, 6]]) {
    const cap = new THREE.Mesh(new THREE.BoxGeometry(5, 2, 5), mat);
    cap.position.set(x - o.x, 23 - o.y, z - o.z);
    const st = new THREE.Mesh(new THREE.BoxGeometry(1.5, 3, 1.5), stem);
    st.position.set(x - o.x, 21 - o.y, z - o.z);
    p.body.group.add(cap, st);
  }
}

/** Sheep coat from a resource pack: boxes attached to the matching parts. */
function packWool(p: PartMap, wool: NonNullable<PackModel['wool']>): void {
  const mat = new THREE.MeshBasicMaterial({ map: packModelTexture({ layers: [wool.layer], texW: 64, texH: 32 }), alphaTest: 0.1, side: THREE.DoubleSide });
  const parts: Part[] = [];
  for (const [name, boxes] of Object.entries(wool.boxes)) {
    if (!p[name]) continue;
    const w = new Part(boxes, mat, 64, 32, [0, 0, 0]);
    w.group.userData.wool = true;
    p[name].group.add(w.group);
    parts.push(w);
  }
  (p as Record<string, unknown>).__woolMat = mat;
  (p as Record<string, unknown>).__woolParts = parts;
}

function addWool(p: PartMap, e: Entity): void {
  const woolTex = (() => {
    const key = 'wool';
    let t = skinCache.get(key);
    if (!t) { t = woolSkin().texture(); skinCache.set(key, t); }
    return t;
  })();
  const mat = new THREE.MeshBasicMaterial({ map: woolTex });
  const body = new Part([B(-4, 12, -8, 8, 6, 16, 0, 32, { inflate: 1.75 })], mat, 64, 64, [0, 0, 0]);
  const head = new Part([B(-3, -4, -4, 6, 6, 6, 0, 0, { inflate: 0.6 })], mat, 64, 64, [0, 0, 0]);
  body.group.userData.wool = true;
  head.group.userData.wool = true;
  p.body.group.add(body.group);
  p.head.group.add(head.group);
  const legs = ['leg0', 'leg1', 'leg2', 'leg3'].map((n) => {
    const l = new Part([B(-2, -6, -2, 4, 6, 4, 0, 16, { inflate: 0.5 })], mat, 64, 64, [0, 0, 0]);
    l.group.userData.wool = true;
    p[n].group.add(l.group);
    return l;
  });
  (p as Record<string, unknown>).__woolMat = mat;
  (p as Record<string, unknown>).__woolParts = [body, head, ...legs];
  void e;
}

function carriedBlock(p: PartMap, _e: Entity): void {
  const holder = new THREE.Group();
  holder.position.set(0, 20, -8);
  holder.userData.carried = true;
  p.body.group.add(holder);
  (p as Record<string, unknown>).__carried = holder;
}

function slimeSquish(e: Entity, rc: RenderContext, p: PartMap): void {
  const sl = e as unknown as { squish: number; prevSquish: number };
  const sq = sl.prevSquish + (sl.squish - sl.prevSquish) * rc.alpha;
  const s = 1 / (sq / 2 + 1);
  p.outer.group.scale.set(s, 1 / s, s);
  p.inner.group.scale.set(s, 1 / s, s);
}

// ---------------------------------------------------------------------------
// Model instance
// ---------------------------------------------------------------------------
class MobModel implements EntityVisual {
  readonly object = new THREE.Group();
  private readonly inner = new THREE.Group();
  private readonly parts: PartMap = {};
  private readonly material: THREE.MeshBasicMaterial;
  private skinKey: string;
  private carriedMesh: THREE.Mesh | null = null;
  private carriedId = 0;
  /** Resource-pack model when a pack skin exists for this mob. */
  private pack: PackModel | null;

  constructor(readonly type: string, private def: ModelDef, private readonly entity: Entity) {
    this.pack = packActive() ? packModelFor(type, entity) : null;
    this.skinKey = this.computeSkinKey(entity);
    const tex = this.pack ? packModelTexture(this.pack) : textureFor(this.skinKey, def);
    this.material = new THREE.MeshBasicMaterial({
      map: tex, alphaTest: def.transparent ? 0 : 0.1, transparent: !!def.transparent, side: THREE.DoubleSide,
      depthWrite: !def.transparent,
    });
    const texW = this.pack?.texW ?? def.texW;
    const texH = this.pack?.texH ?? def.texH;
    for (const pd of this.pack?.parts ?? def.parts) {
      const part = new Part(pd.boxes, this.material, texW, texH, pd.pivot);
      if ('scale' in pd && pd.scale) part.group.scale.setScalar(pd.scale);
      this.parts[pd.name] = part;
      const parent = 'parent' in pd && pd.parent ? this.parts[pd.parent].group : this.inner;
      parent.add(part.group);
    }
    if (this.pack?.wool) packWool(this.parts, this.pack.wool);
    else def.extras?.(this.parts, entity);
    this.object.add(this.inner);
  }

  private computeSkinKey(e: Entity): string {
    if (this.pack) {
      const m = packModelFor(this.type, e);
      if (m) return packModelKey(m);
    }
    if (e.type === 'wolf') { const w = e as unknown as { tamed: boolean; angry: boolean }; return `wolf:${w.tamed}:${w.angry}`; }
    if (e.type === 'ghast') return `ghast:${(e as unknown as { shooting: number }).shooting > 0}`;
    if (e.type === 'villager') return `villager:${(e as unknown as { profession: number }).profession}`;
    return e.type;
  }

  update(e: Entity, rc: RenderContext): void {
    // Swap skins for state-dependent textures (angry wolves, shooting ghasts).
    const key = this.computeSkinKey(e);
    if (key !== this.skinKey) {
      this.skinKey = key;
      this.def = MODEL_DEFS[this.type](e);
      const pack = this.pack ? packModelFor(this.type, e) : null;
      if (pack) this.pack = pack;
      this.material.map = pack ? packModelTexture(pack) : textureFor(key, this.def);
      this.material.needsUpdate = true;
    }
    const [x, y, z] = interpPos(e, rc.alpha);
    const living = e as LivingEntity;
    const bodyYaw = lerpAngle(e.prevBodyYaw ?? e.prevYaw, e.bodyYaw ?? e.yaw, rc.alpha);
    this.object.position.set(x, y, z);
    this.object.rotation.set(0, bodyYaw + Math.PI, 0);
    this.object.rotation.y = bodyYaw;
    let scale = (this.def.scale ?? 1) / 16;
    const mob = e as Mob;
    if (mob.baby) scale *= 0.5;
    if (e.type === 'slime' || e.type === 'magma_cube') scale *= (e as unknown as { size: number }).size;
    this.inner.scale.setScalar(scale);
    this.inner.position.y = ((this.def.yOffset ?? 0) / 16);
    // Death: tip over sideways.
    if (living.dead && typeof living.deathTime === 'number') {
      const f = Math.min(1, Math.sqrt((living.deathTime + rc.alpha) / 20 * 1.6));
      this.inner.rotation.z = f * (Math.PI / 2);
    } else {
      this.inner.rotation.z = 0;
    }
    // Creeper swelling and flashing.
    let flash = 0;
    if (e.type === 'creeper') {
      const c = e as unknown as { fuse: number; prevFuse: number; maxFuse: number };
      const f = (c.prevFuse + (c.fuse - c.prevFuse) * rc.alpha) / c.maxFuse;
      const s = 1 + Math.sin(f * 100) * f * 0.01;
      const sw = Math.min(1, Math.max(0, f)) ** 3;
      this.inner.scale.set(scale * (1 + sw * 0.4) * s, scale * (1 + sw * 0.1) / s, scale * (1 + sw * 0.4) * s);
      if (Math.floor(f * 10) % 2 === 1 && f > 0) flash = 1;
    }
    const light = rc.light(x, y + e.height / 2, z);
    const bright = e.type === 'blaze' || e.type === 'magma_cube' || e.type === 'ender_crystal' ? 1 : light;
    const hurt = living.hurtTime > 0 || living.dead;
    if (flash) this.material.color.setRGB(2.5, 2.5, 2.5);
    else if (hurt) this.material.color.setRGB(bright * 1.2, bright * 0.45, bright * 0.45);
    else this.material.color.setRGB(bright, bright, bright);
    const t: AnimInfo = {
      limbSwing: (living.limbSwing ?? 0) + (living.limbSwingAmount ?? 0) * rc.alpha,
      limbAmount: Math.min(1, (living.prevLimbSwingAmount ?? 0) + ((living.limbSwingAmount ?? 0) - (living.prevLimbSwingAmount ?? 0)) * rc.alpha),
      headYaw: -((mob.headYaw ?? e.yaw) - (e.bodyYaw ?? e.yaw)),
      pitch: e.pitch,
      age: e.age + rc.alpha,
      swing: living.swinging ? living.swingProgress : 0,
    };
    t.headYaw = normalizeAngle((mob.headYaw ?? e.yaw) - bodyYaw);
    if (this.pack?.animate) this.pack.animate(e, this.parts, t);
    else this.def.animate(e, rc, this.parts, t);
    // Sheep wool.
    if (e.type === 'sheep') {
      const sh = e as unknown as { sheared: boolean; woolRgb: readonly [number, number, number] };
      const wp = (this.parts as Record<string, unknown>).__woolParts as Part[] | undefined;
      const wm = (this.parts as Record<string, unknown>).__woolMat as THREE.MeshBasicMaterial | undefined;
      if (wp) for (const w of wp) w.group.visible = !sh.sheared;
      if (wm) {
        const [r, g, b] = sh.woolRgb;
        wm.color.setRGB((r / 255) * bright * 1.1, (g / 255) * bright * 1.1, (b / 255) * bright * 1.1);
        if (hurt) wm.color.multiply(new THREE.Color(1.2, 0.45, 0.45));
      }
    }
    // Enderman carried block.
    if (e.type === 'enderman') {
      const holder = (this.parts as Record<string, unknown>).__carried as THREE.Group | undefined;
      const carried = (e as unknown as { carried: number }).carried;
      if (holder && carried !== this.carriedId) {
        this.carriedId = carried;
        if (this.carriedMesh) { holder.remove(this.carriedMesh); this.carriedMesh = null; }
        if (carried) {
          const { geometry } = itemGeometry(carried, 0);
          const shared = (window as unknown as { __itemMats?: Record<string, THREE.MeshBasicMaterial> }).__itemMats;
          this.carriedMesh = new THREE.Mesh(geometry, shared?.block ?? this.material);
          this.carriedMesh.scale.setScalar(10);
          holder.add(this.carriedMesh);
        }
      }
    }
    // Held items follow lighting.
    this.inner.traverse((o) => {
      if (o.userData.isItem) ((o as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setScalar(bright);
    });
  }

  dispose(): void {
    this.material.dispose();
  }
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Player skin texture (pack skin when available) and its size, for the first-person arm. */
export function playerSkinTexture(): { texture: THREE.Texture; texW: number; texH: number } {
  const pack = packActive() && packImage('entity/player/wide/steve');
  if (pack) return { texture: packModelTexture({ layers: ['entity/player/wide/steve'], texW: 64, texH: 64 }), texW: 64, texH: 64 };
  const def = MODEL_DEFS.player({} as Entity);
  return { texture: textureFor('player', def), texW: def.texW, texH: def.texH };
}

/** Register all mob model factories with the entity renderer. */
export function registerMobModels(): void {
  for (const type of Object.keys(MODEL_DEFS)) {
    MODEL_FACTORIES.set(type, (e) => new MobModel(type, MODEL_DEFS[type](e), e));
  }
  MODEL_FACTORIES.set('ender_dragon', (e) => new DragonModel(e));
  MODEL_FACTORIES.set('fishing_hook', (e) => new BobberModel(e));
  void BlockId;
}

// ---------------------------------------------------------------------------
// Ender Dragon (large articulated model)
// ---------------------------------------------------------------------------
class DragonModel implements EntityVisual {
  readonly object = new THREE.Group();
  private readonly mat: THREE.MeshBasicMaterial;
  private readonly body: Part;
  private readonly head: Part;
  private readonly jaw: Part;
  private readonly neck: Part[] = [];
  private readonly tail: Part[] = [];
  private readonly wings: { arm: Part; tip: Part }[] = [];
  private readonly legs: Part[] = [];
  private readonly beam: THREE.Mesh;
  private readonly deathRays: THREE.Group;
  private readonly root = new THREE.Group();

  constructor(e: Entity) {
    const skinDef: ModelDef = { texW: 256, texH: 256, skin: dragonSkin, parts: [], animate: () => undefined };
    // A resource-pack dragon skin uses the standard layout: spikes, nostrils,
    // wing membranes and the heavier hind legs have their own regions.
    const pack = packActive() && !!packImage('entity/enderdragon/dragon');
    const tex = pack
      ? packModelTexture({ layers: ['entity/enderdragon/dragon'], texW: 256, texH: 256 })
      : textureFor('ender_dragon', skinDef);
    this.mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, alphaTest: 0.1 });
    const T = 256;
    const [su, sv] = pack ? [220, 53] : [48, 0];
    this.body = new Part([B(-12, -12, -32, 24, 24, 64, 0, 0), B(-1, 12, -22, 2, 6, 12, su, sv), B(-1, 12, -2, 2, 6, 12, su, sv), B(-1, 12, 18, 2, 6, 12, su, sv)], this.mat, T, T, [0, 0, 0]);
    this.root.add(this.body.group);
    for (let i = 0; i < 5; i++) {
      const n = new Part([B(-5, -5, -10, 10, 10, 10, 192, 104), B(-1, 5, -8, 2, 4, 6, 48, 0)], this.mat, T, T, [0, 4, -32 - i * 10]);
      this.neck.push(n);
      this.root.add(n.group);
    }
    const nostrils = pack ? [B(3, 1, -30, 2, 2, 4, 112, 0, { mirror: true }), B(-5, 1, -30, 2, 2, 4, 112, 0)] : [];
    this.head = new Part([B(-8, -4, -16, 16, 16, 16, 112, 30), B(-6, -4, -32, 12, 5, 16, 176, 44), B(-5, 7, -12, 2, 4, 6, 0, 0), B(3, 7, -12, 2, 4, 6, 0, 0), ...nostrils], this.mat, T, T, [0, 4, -82]);
    this.jaw = new Part([B(-6, -4, -16, 12, 4, 16, 176, 65)], this.mat, T, T, [0, 0, -16]);
    this.head.group.add(this.jaw.group);
    this.root.add(this.head.group);
    for (let i = 0; i < 12; i++) {
      const t = new Part([B(-5, -5, 0, 10, 10, 10, 192, 104), B(-1, 5, 2, 2, 4, 6, 48, 0)], this.mat, T, T, [0, 2, 32 + i * 10]);
      this.tail.push(t);
      this.root.add(t.group);
    }
    // Pack membranes are flat sheets whose top face region starts at u = 0.
    const [mu, mh] = pack ? [-56, 0] : [0, 0.5];
    for (const side of [1, -1]) {
      const arm = new Part([B(side > 0 ? 0 : -56, -4, -4, 56, 8, 8, 112, 88), B(side > 0 ? 0 : -56, 0, 2, 56, mh, 56, mu, 88)], this.mat, T, T, [side * 12, 5, -18]);
      const tip = new Part([B(side > 0 ? 0 : -56, -2, -2, 56, 4, 4, 112, 136), B(side > 0 ? 0 : -56, 0, 2, 56, mh, 56, mu, 144)], this.mat, T, T, [side * 56, 0, 0]);
      arm.group.add(tip.group);
      this.wings.push({ arm, tip });
      this.root.add(arm.group);
    }
    for (const [x, z, h] of [[12, -20, 24], [-12, -20, 24], [16, 22, 32], [-16, 22, 32]]) {
      const hind = pack && h === 32;
      const boxes = hind
        ? [B(-8, -h, -8, 16, h, 16, 0, 0), B(-6, -h - 16, -6, 12, 16, 12, 196, 0), B(-9, -h - 22, -16, 18, 6, 24, 112, 0)]
        : [B(-4, -h, -4, 8, h, 8, 112, 104), B(-3, -h - 16, -3, 6, 16, 6, 226, 138), B(-4, -h - 20, -12, 8, 4, 16, 144, 104)];
      const leg = new Part(boxes, this.mat, T, T, [x, -8, z]);
      this.legs.push(leg);
      this.root.add(leg.group);
    }
    this.root.scale.setScalar(1 / 16);
    this.object.add(this.root);
    // Healing beam from a crystal.
    this.beam = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 1), new THREE.MeshBasicMaterial({ color: 0xff80ff, transparent: true, opacity: 0.8 }));
    this.beam.visible = false;
    this.object.add(this.beam);
    this.deathRays = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const ray = new THREE.Mesh(new THREE.ConeGeometry(0.6, 20, 4), new THREE.MeshBasicMaterial({ color: 0xffe8ff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      ray.rotation.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
      ray.geometry.translate(0, 10, 0);
      this.deathRays.add(ray);
    }
    this.deathRays.visible = false;
    this.object.add(this.deathRays);
    void e;
  }

  update(e: Entity, rc: RenderContext): void {
    const d = e as unknown as { yaw: number; pitch: number; wingPhase: number; prevWingPhase: number; hitFlash: number; phase: string; deathTicks: number; healingCrystal: Entity | null; trail: [number, number, number][] };
    const [x, y, z] = interpPos(e, rc.alpha);
    this.object.position.set(x, y + 1.5, z);
    const yaw = lerpAngle(e.prevYaw, e.yaw, rc.alpha);
    this.root.rotation.set(0, 0, 0);
    this.root.rotation.order = 'YXZ';
    this.root.rotation.y = yaw;
    this.root.rotation.x = -d.pitch * 0.5;
    const wing = d.prevWingPhase + (d.wingPhase - d.prevWingPhase) * rc.alpha;
    const flap = Math.sin(wing);
    this.wings.forEach(({ arm, tip }, i) => {
      const s = i === 0 ? 1 : -1;
      arm.group.rotation.z = s * (flap * 0.6 + 0.1);
      arm.group.rotation.x = 0.125 - Math.cos(wing) * 0.2;
      tip.group.rotation.z = -s * (Math.sin(wing + 2) + 0.5) * 0.75;
    });
    // Neck and tail undulate.
    this.neck.forEach((n, i) => {
      n.group.position.y = 4 + Math.sin(wing * 0.5 - i * 0.4) * 3;
      n.group.rotation.x = Math.sin(wing * 0.5 - i * 0.4) * 0.05;
    });
    this.head.group.position.y = 4 + Math.sin(wing * 0.5 - 2) * 3;
    this.jaw.group.rotation.x = Math.max(0, Math.sin(wing) * 0.2) + (d.phase === 'ATTACK_RUN' ? 0.4 : 0);
    this.tail.forEach((t, i) => {
      t.group.position.y = 2 + Math.sin(wing * 0.5 + i * 0.45) * 4;
      t.group.position.x = Math.sin(wing * 0.3 + i * 0.3) * i * 0.8;
    });
    this.legs.forEach((l, i) => { l.group.rotation.x = 0.8 + Math.sin(wing * 0.5 + i) * 0.1; });
    const light = 1;
    if (d.hitFlash > 0) this.mat.color.setRGB(1.3, 0.5, 0.5);
    else this.mat.color.setScalar(light);
    // Crystal beam.
    const c = d.healingCrystal;
    if (c && !c.removed) {
      const from = new THREE.Vector3(c.x, c.y + 1.2, c.z);
      const to = new THREE.Vector3(x, y + 1.5, z);
      const mid = from.clone().add(to).multiplyScalar(0.5);
      this.beam.visible = true;
      this.beam.position.copy(mid.sub(this.object.position));
      this.beam.scale.set(1, 1, from.distanceTo(to));
      this.beam.lookAt(to);
    } else {
      this.beam.visible = false;
    }
    if (d.phase === 'DEATH') {
      this.deathRays.visible = true;
      const f = d.deathTicks / 200;
      this.deathRays.children.forEach((r, i) => {
        r.scale.setScalar(Math.min(1, f * 2) * (0.5 + (i % 3) * 0.3));
        r.rotation.y += 0.02;
        ((r as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.8;
      });
      this.root.visible = f < 0.95;
      this.mat.color.setRGB(1 + f, 1 + f, 1 + f);
    } else {
      this.deathRays.visible = false;
      this.root.visible = true;
    }
  }

  dispose(): void {
    this.mat.dispose();
  }
}

class BobberModel implements EntityVisual {
  readonly object = new THREE.Group();
  private readonly line: THREE.Line;
  constructor(_e: Entity) {
    const bob = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.15, 0.15), new THREE.MeshBasicMaterial({ color: 0xe03030 }));
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.1), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    top.position.y = 0.1;
    this.object.add(bob, top);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x202020 }));
    this.line.frustumCulled = false;
  }
  update(e: Entity, rc: RenderContext): void {
    const [x, y, z] = interpPos(e, rc.alpha);
    this.object.position.set(x, y, z);
    const a = (e as unknown as { angler: Entity }).angler;
    if (!this.line.parent && this.object.parent) this.object.parent.add(this.line);
    const pos = this.line.geometry.getAttribute('position') as THREE.BufferAttribute;
    pos.setXYZ(0, x, y + 0.05, z);
    pos.setXYZ(1, a.x - Math.cos(a.yaw) * 0.35, a.y + a.eyeHeight - 0.3, a.z + Math.sin(a.yaw) * 0.35);
    pos.needsUpdate = true;
  }
  dispose(): void {
    this.line.parent?.remove(this.line);
  }
}

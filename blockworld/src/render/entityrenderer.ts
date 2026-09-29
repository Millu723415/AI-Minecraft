/**
 * Draws entities: dropped items, XP orbs, falling blocks, TNT, projectiles
 * and (via the model registry) every mob. Positions are interpolated between
 * game ticks for smooth motion at any frame rate.
 */

import * as THREE from 'three';
import type { Entity } from '../entity/entity';
import { ItemEntity, XpOrb, FallingBlock, PrimedTnt } from '../entity/items';
import { Arrow, Throwable, EyeOfEnderSignal, Fireball } from '../entity/projectiles';
import { itemGeometry } from './itemmesh';
import { ItemId } from '../items/ids';

export interface RenderContext {
  alpha: number;
  time: number;
  light(x: number, y: number, z: number): number;
}

export interface EntityVisual {
  object: THREE.Object3D;
  update(e: Entity, rc: RenderContext): void;
  dispose?(): void;
}

export type ModelFactory = (e: Entity) => EntityVisual;

/** Registry for mob models (filled by render/mobmodels.ts). */
export const MODEL_FACTORIES = new Map<string, ModelFactory>();

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function interpPos(e: Entity, alpha: number): [number, number, number] {
  return [lerp(e.prevX, e.x, alpha), lerp(e.prevY, e.y, alpha), lerp(e.prevZ, e.z, alpha)];
}

export { lerpAngle };

export class EntityRenderer {
  readonly group = new THREE.Group();
  private visuals = new Map<number, EntityVisual>();
  private readonly spriteTexCache = new Map<string, THREE.Texture>();

  constructor(private readonly blockMat: THREE.MeshBasicMaterial, private readonly spriteMat: THREE.MeshBasicMaterial) {
    this.group.name = 'entities';
  }

  private create(e: Entity): EntityVisual | null {
    const factory = MODEL_FACTORIES.get(e.type);
    if (factory) return factory(e);
    if (e instanceof ItemEntity) return this.itemVisual(e);
    if (e instanceof XpOrb) return this.xpVisual(e);
    if (e instanceof FallingBlock) return this.blockVisual(e.blockId, e.blockMeta, false);
    if (e instanceof PrimedTnt) return this.blockVisual(46, 0, true);
    if (e instanceof Arrow) return this.arrowVisual();
    if (e instanceof Throwable) {
      const id = e.kind === 'snowball' ? ItemId.SNOWBALL : e.kind === 'egg' ? ItemId.EGG : e.kind === 'ender_pearl' ? ItemId.ENDER_PEARL : ItemId.POTION;
      return this.spriteVisual(id, e.kind === 'potion' ? e.potionMeta : 0, 0.4);
    }
    if (e instanceof EyeOfEnderSignal) return this.spriteVisual(ItemId.EYE_OF_ENDER, 0, 0.45);
    if (e instanceof Fireball) return this.fireballVisual(e.small);
    return null;
  }

  private itemVisual(e: ItemEntity): EntityVisual {
    const g = new THREE.Group();
    const { geometry, blockAtlas, cube } = itemGeometry(e.stack.id, e.stack.meta);
    const mat = (blockAtlas ? this.blockMat : this.spriteMat).clone();
    const copies = e.stack.count > 20 ? 4 : e.stack.count > 5 ? 3 : e.stack.count > 1 ? 2 : 1;
    for (let i = 0; i < copies; i++) {
      const m = new THREE.Mesh(geometry, mat);
      m.scale.setScalar(cube ? 0.25 : 0.4);
      m.position.set(i * 0.05, i * 0.04, i * 0.03);
      g.add(m);
    }
    return {
      object: g,
      update: (ent, rc) => {
        const it = ent as ItemEntity;
        const [x, y, z] = interpPos(ent, rc.alpha);
        const bob = Math.sin((it.age + rc.alpha) / 10 + it.bobOffset) * 0.1 + 0.1;
        g.position.set(x, y + bob + (cube ? 0.125 : 0.2), z);
        g.rotation.y = ((it.age + rc.alpha) / 20 + it.bobOffset) % (Math.PI * 2);
        mat.color.setScalar(rc.light(x, y + 0.25, z));
      },
      dispose: () => mat.dispose(),
    };
  }

  private xpVisual(_e: XpOrb): EntityVisual {
    const mat = new THREE.SpriteMaterial({ color: 0xb6ff3c, transparent: true, depthWrite: false });
    const canvas = document.createElement('canvas');
    canvas.width = 8; canvas.height = 8;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e8ff90'; ctx.fillRect(2, 1, 4, 6); ctx.fillRect(1, 2, 6, 4);
    ctx.fillStyle = '#60c020'; ctx.fillRect(3, 3, 2, 2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    mat.map = tex;
    const s = new THREE.Sprite(mat);
    return {
      object: s,
      update: (ent, rc) => {
        const orb = ent as XpOrb;
        const [x, y, z] = interpPos(ent, rc.alpha);
        s.position.set(x, y + 0.2, z);
        const size = 0.15 + orb.sizeClass * 0.03;
        s.scale.setScalar(size);
        const t = (orb.age + rc.alpha) / 2;
        mat.color.setRGB((Math.sin(t) + 1) * 0.5, 1, (Math.sin(t + 4.18) + 1) * 0.1);
      },
      dispose: () => { tex.dispose(); mat.dispose(); },
    };
  }

  private blockVisual(id: number, meta: number, tnt: boolean): EntityVisual {
    const { geometry } = itemGeometry(id, meta);
    const mat = this.blockMat.clone();
    const m = new THREE.Mesh(geometry, mat);
    m.scale.setScalar(tnt ? 1 : 0.98);
    return {
      object: m,
      update: (ent, rc) => {
        const [x, y, z] = interpPos(ent, rc.alpha);
        m.position.set(x, y + 0.49, z);
        let b = rc.light(x, y + 0.5, z);
        if (tnt) {
          const fuse = (ent as PrimedTnt).fuse - rc.alpha + 1;
          if (fuse < 10) m.scale.setScalar(1 + (1 - fuse / 10) * 0.3);
          if (Math.floor(fuse / 5) % 2 === 0) b = 2.2;
        }
        mat.color.setScalar(b);
      },
      dispose: () => mat.dispose(),
    };
  }

  private arrowVisual(): EntityVisual {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.5), new THREE.MeshBasicMaterial({ color: 0x8a6a3a }));
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.1), new THREE.MeshBasicMaterial({ color: 0x9a9a9a }));
    head.position.z = -0.27;
    const fl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.12), new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
    fl.position.z = 0.2;
    const fl2 = fl.clone();
    fl2.rotation.z = Math.PI / 2;
    g.add(shaft, head, fl, fl2);
    const inner = new THREE.Group();
    inner.add(g);
    return {
      object: inner,
      update: (ent, rc) => {
        const a = ent as Arrow;
        const [x, y, z] = interpPos(ent, rc.alpha);
        inner.position.set(x, y, z);
        inner.rotation.set(0, 0, 0);
        inner.rotation.order = 'YXZ';
        inner.rotation.y = a.yaw;
        inner.rotation.x = a.pitch;
        if (a.shake > 0) inner.rotation.x += Math.sin(a.shake * 3) * 0.05 * a.shake;
        const b = rc.light(x, y, z);
        for (const c of g.children) ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.multiplyScalar(1);
        g.children.forEach((c, i) => ((c as THREE.Mesh).material as THREE.MeshBasicMaterial).color.setHex([0x8a6a3a, 0x9a9a9a, 0xeeeeee, 0xeeeeee][i]).multiplyScalar(b));
      },
    };
  }

  private spriteVisual(id: number, meta: number, size: number): EntityVisual {
    const { geometry, blockAtlas } = itemGeometry(id, meta);
    const mat = (blockAtlas ? this.blockMat : this.spriteMat).clone();
    const m = new THREE.Mesh(geometry, mat);
    m.scale.setScalar(size);
    return {
      object: m,
      update: (ent, rc) => {
        const [x, y, z] = interpPos(ent, rc.alpha);
        m.position.set(x, y + 0.1, z);
        m.rotation.y = rc.time * 3;
        mat.color.setScalar(ent.type === 'eye_signal' ? 1 : rc.light(x, y, z));
      },
      dispose: () => mat.dispose(),
    };
  }

  private fireballVisual(small: boolean): EntityVisual {
    const mat = new THREE.MeshBasicMaterial({ color: small ? 0xff8020 : 0xff5010 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshBasicMaterial({ color: 0xffe060 }));
    m.add(inner);
    m.scale.setScalar(small ? 0.3 : 0.9);
    return {
      object: m,
      update: (ent, rc) => {
        const [x, y, z] = interpPos(ent, rc.alpha);
        m.position.set(x, y + ent.height / 2, z);
        m.rotation.set(rc.time * 5, rc.time * 4, 0);
      },
    };
  }

  /** Create/update/remove visuals to match the entity list. */
  sync(entities: readonly Entity[], rc: RenderContext, skip: Entity | null, camX: number, camZ: number, maxDist: number): void {
    const seen = new Set<number>();
    const maxSq = maxDist * maxDist;
    for (const e of entities) {
      if (e === skip || e.removed) continue;
      const dx = e.x - camX; const dz = e.z - camZ;
      if (dx * dx + dz * dz > maxSq) continue;
      let v = this.visuals.get(e.id);
      if (!v) {
        const created = this.create(e);
        if (!created) continue;
        v = created;
        this.visuals.set(e.id, v);
        this.group.add(v.object);
      }
      seen.add(e.id);
      v.update(e, rc);
    }
    for (const [id, v] of this.visuals) {
      if (!seen.has(id)) {
        this.group.remove(v.object);
        v.dispose?.();
        this.visuals.delete(id);
      }
    }
  }

  clear(): void {
    for (const v of this.visuals.values()) {
      this.group.remove(v.object);
      v.dispose?.();
    }
    this.visuals.clear();
  }

  get count(): number {
    return this.visuals.size;
  }
}

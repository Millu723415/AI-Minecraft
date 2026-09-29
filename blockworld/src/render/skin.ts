/**
 * Box-model geometry and procedural skin painting.
 *
 * Boxes use the classic skin layout: for a box of size (w, h, d) at texture
 * offset (u, v) the faces are right [u, v+d], front [u+d, v+d], left
 * [u+d+w, v+d], back [u+2d+w, v+d], top [u+d, v] and bottom [u+d+w, v].
 * Models face -Z; +X is the model's right side.
 */

import * as THREE from 'three';
import { Random, hashString } from '../core/rng';

export type RGB = [number, number, number];

export class SkinCanvas {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  readonly rng: Random;

  constructor(readonly width: number, readonly height: number, seedName: string) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.rng = new Random(hashString(seedName));
  }

  px(x: number, y: number, c: RGB, a = 1): void {
    this.ctx.fillStyle = a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    this.ctx.fillRect(x, y, 1, 1);
  }

  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    this.ctx.fillStyle = a >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
    this.ctx.fillRect(x, y, w, h);
  }

  noise(x: number, y: number, w: number, h: number, c: RGB, v: number, a = 1): void {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const d = (this.rng.next() - 0.5) * 2 * v;
        this.px(xx, yy, [clamp(c[0] + d), clamp(c[1] + d), clamp(c[2] + d)], a);
      }
    }
  }

  /** Fill all six faces of a box region with noisy colour. */
  box(u: number, v: number, w: number, h: number, d: number, c: RGB, variance = 10, a = 1): void {
    this.noise(u + d, v, w * 2, d, c, variance, a);
    this.noise(u, v + d, d * 2 + w * 2, h, c, variance, a);
  }

  /** Region helpers for drawing details on specific faces. */
  front(u: number, v: number, _w: number, _h: number, d: number): [number, number] { return [u + d, v + d]; }
  back(u: number, v: number, w: number, _h: number, d: number): [number, number] { return [u + 2 * d + w, v + d]; }
  top(u: number, v: number, _w: number, _h: number, d: number): [number, number] { return [u + d, v]; }
  right(u: number, v: number, _w: number, _h: number, d: number): [number, number] { return [u, v + d]; }
  left(u: number, v: number, w: number, _h: number, d: number): [number, number] { return [u + d + w, v + d]; }

  texture(): THREE.CanvasTexture {
    const t = new THREE.CanvasTexture(this.canvas);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
}

function clamp(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

export interface BoxSpec {
  /** Box min corner relative to the part pivot, in pixels. */
  x: number; y: number; z: number;
  w: number; h: number; d: number;
  u: number; v: number;
  /** Grow the box in every direction (armour/wool overlays). */
  inflate?: number;
  /** Mirrored texture: side faces swap regions and every face flips horizontally. */
  mirror?: boolean;
  /** Static transform applied to the box corners (relative to the part pivot). */
  mat?: THREE.Matrix4;
}

/** Build geometry for one or more boxes (pixel units) with skin UVs. */
export function boxGeometry(boxes: BoxSpec[], texW: number, texH: number): THREE.BufferGeometry {
  const tmp = new THREE.Vector3();
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (const b of boxes) {
    const g = b.inflate ?? 0;
    const x0 = b.x - g; const x1 = b.x + b.w + g;
    const y0 = b.y - g; const y1 = b.y + b.h + g;
    const z0 = b.z - g; const z1 = b.z + b.d + g;
    const { u, v, w, h, d } = b;
    const rightUV: [number, number, number, number] = [u, v + d, u + d, v + d + h];
    const leftUV: [number, number, number, number] = [u + d + w, v + d, u + 2 * d + w, v + d + h];
    // Each face: 4 corners (bl, br, tr, tl as seen from outside) + uv rect [u0,v0,u1,v1].
    const faces: [number[][], [number, number, number, number]][] = [
      // front (-Z): viewer left = +X
      [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [u + d, v + d, u + d + w, v + d + h]],
      // back (+Z): viewer left = -X
      [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [u + 2 * d + w, v + d, u + 2 * d + 2 * w, v + d + h]],
      // right (+X): viewer left = +Z
      [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], b.mirror ? leftUV : rightUV],
      // left (-X): viewer left = -Z
      [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], b.mirror ? rightUV : leftUV],
      // top: bottom edge of the region adjoins the front face
      [[[x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1]], [u + d, v + d, u + d + w, v]],
      // bottom
      [[[x1, y0, z1], [x0, y0, z1], [x0, y0, z0], [x1, y0, z0]], [u + d + w, v, u + d + 2 * w, v + d]],
    ];
    for (const [corners, [a0, b0, a1, b1]] of faces) {
      const base = pos.length / 3;
      let ua = a0 / texW; let ub = a1 / texW;
      if (b.mirror) [ua, ub] = [ub, ua];
      const va = b0 / texH; const vb = b1 / texH;
      const uvs = [[ua, vb], [ub, vb], [ub, va], [ua, va]];
      for (let i = 0; i < 4; i++) {
        if (b.mat) {
          tmp.set(corners[i][0], corners[i][1], corners[i][2]).applyMatrix4(b.mat);
          pos.push(tmp.x, tmp.y, tmp.z);
        } else {
          pos.push(corners[i][0], corners[i][1], corners[i][2]);
        }
        uv.push(uvs[i][0], 1 - uvs[i][1]);
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  return geo;
}

/** A named, pivoted model part. */
export class Part {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh;

  constructor(boxes: BoxSpec[], material: THREE.Material, texW: number, texH: number, pivot: [number, number, number]) {
    this.mesh = new THREE.Mesh(boxGeometry(boxes, texW, texH), material);
    this.group.add(this.mesh);
    this.group.position.set(pivot[0], pivot[1], pivot[2]);
  }
}

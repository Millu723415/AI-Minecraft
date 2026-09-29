/**
 * Precipitation: short-range sheets of pixel rain or snow drawn per column
 * around the camera, stopping at the first light-blocking block. Deserts get
 * none; cold biomes get slow, drifting snow.
 */

import * as THREE from 'three';
import { packActive, packCanvas } from './pack';

export const Precip = { NONE: 0, RAIN: 1, SNOW: 2 } as const;
export type PrecipKind = (typeof Precip)[keyof typeof Precip];

export interface ColumnSample {
  /** First y above the highest light-blocking block (rain stops here). */
  top: number;
  kind: PrecipKind;
  /** Brightness 0..1 near the column top. */
  light: number;
}

function streakTexture(snow: boolean): THREE.CanvasTexture {
  const packed = packActive() ? packCanvas(snow ? 'environment/snow' : 'environment/rain') : null;
  if (packed) return wrapTexture(packed);
  const c = document.createElement('canvas');
  c.width = 16; c.height = 64;
  const g = c.getContext('2d')!;
  let seed = snow ? 99 : 7;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  if (snow) {
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rnd() * 15); const y = Math.floor(rnd() * 63);
      g.fillStyle = `rgba(255,255,255,${0.75 + rnd() * 0.25})`;
      g.fillRect(x, y, rnd() < 0.4 ? 2 : 1, rnd() < 0.4 ? 2 : 1);
    }
  } else {
    for (let i = 0; i < 18; i++) {
      const x = Math.floor(rnd() * 16); const y = Math.floor(rnd() * 64); const len = 3 + Math.floor(rnd() * 5);
      g.fillStyle = `rgba(160,180,220,${0.45 + rnd() * 0.35})`;
      for (let k = 0; k < len; k++) g.fillRect(x, (y + k) % 64, 1, 1);
    }
  }
  return wrapTexture(c);
}

function wrapTexture(c: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

class Layer {
  readonly mesh: THREE.Mesh;
  readonly tex: THREE.CanvasTexture;
  private pos = new Float32Array(0);
  private uv = new Float32Array(0);
  private col = new Float32Array(0);
  private idx = new Uint32Array(0);
  private geo = new THREE.BufferGeometry();
  n = 0;

  constructor(snow: boolean) {
    this.tex = streakTexture(snow);
    const mat = new THREE.MeshBasicMaterial({
      map: this.tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexColors: true, fog: true,
    });
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  begin(maxQuads: number): void {
    if (this.pos.length < maxQuads * 12) {
      this.pos = new Float32Array(maxQuads * 12);
      this.uv = new Float32Array(maxQuads * 8);
      this.col = new Float32Array(maxQuads * 16);
      this.idx = new Uint32Array(maxQuads * 6);
      for (let q = 0; q < maxQuads; q++) {
        const b = q * 4;
        this.idx.set([b, b + 1, b + 2, b, b + 2, b + 3], q * 6);
      }
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      this.geo.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
      this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4));
      this.geo.setIndex(new THREE.BufferAttribute(this.idx, 1));
    }
    this.n = 0;
  }

  quad(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, v0: number, light: number, alpha: number): void {
    const q = this.n++;
    const p = q * 12;
    this.pos.set([x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0], p);
    const vs = (y1 - y0) / 4;
    this.uv.set([0, v0, 1, v0, 1, v0 + vs, 0, v0 + vs], q * 8);
    for (let k = 0; k < 4; k++) this.col.set([light, light, light, alpha], q * 16 + k * 4);
  }

  end(): void {
    this.geo.setDrawRange(0, this.n * 6);
    for (const name of ['position', 'uv', 'color']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
}

export class WeatherRenderer {
  readonly group = new THREE.Group();
  private rain = new Layer(false);
  private snow = new Layer(true);

  constructor() {
    this.group.add(this.rain.mesh, this.snow.mesh);
  }

  update(camX: number, camY: number, camZ: number, strength: number, time: number, fancy: boolean,
    sample: (x: number, z: number) => ColumnSample | null): void {
    if (strength <= 0.01) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    const r = fancy ? 10 : 5;
    const maxQuads = (r * 2 + 1) * (r * 2 + 1);
    this.rain.begin(maxQuads);
    this.snow.begin(maxQuads);
    const bx = Math.floor(camX); const bz = Math.floor(camZ);
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        const x = bx + dx; const z = bz + dz;
        const s = sample(x, z);
        if (!s || s.kind === Precip.NONE) continue;
        const y0 = Math.max(s.top, Math.floor(camY) - r);
        const y1 = Math.floor(camY) + r;
        if (y0 >= y1) continue;
        // Face the camera: the sheet is perpendicular to the view direction.
        const cx = x + 0.5; const cz = z + 0.5;
        let ox = cz - camZ; let oz = -(cx - camX);
        const len = Math.hypot(ox, oz) || 1;
        ox = (ox / len) * 0.5; oz = (oz / len) * 0.5;
        const hash = ((x * 3129871) ^ (z * 116129781)) & 0xffff;
        const fade = (1 - Math.sqrt(d2) / (r + 1)) * strength;
        if (s.kind === Precip.SNOW) {
          const v0 = y0 / 4 + time * 0.12 + (hash & 255) / 97;
          this.snow.quad(cx - ox, cz - oz, cx + ox, cz + oz, y0, y1, v0, s.light, fade * 0.9);
        } else {
          const v0 = y0 / 4 + time * (1.6 + (hash & 7) * 0.05) + (hash & 255) / 61;
          this.rain.quad(cx - ox, cz - oz, cx + ox, cz + oz, y0, y1, v0, s.light, fade * 0.75);
        }
      }
    }
    this.snow.tex.offset.x = Math.sin(time * 0.7) * 0.15;
    this.rain.end();
    this.snow.end();
  }
}

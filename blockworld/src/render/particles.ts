/**
 * Lightweight pixel particles rendered as GPU point sprites. Block debris
 * samples a random 4x4 texel patch of the block's own texture.
 */

import * as THREE from 'three';
import { buildBlockAtlas, tileUV } from './tiles';
import type { ParticleKind, ParticleOptions } from '../game/context';

const MAX = 3000;

interface P {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number; maxLife: number;
  size: number;
  r: number; g: number; b: number;
  u: number; v: number; uvs: number;
  gravity: number;
  drag: number;
  grow: number;
  collide: boolean;
  kind: ParticleKind;
  ox?: number; oy?: number; oz?: number;
}

const VERT = /* glsl */ `
  attribute float aSize;
  attribute vec3 aColor;
  attribute vec3 aUV;
  varying vec3 vColor;
  varying vec3 vUV;
  varying float vFog;
  uniform float scale;
  void main() {
    vColor = aColor;
    vUV = aUV;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFog = length(mv.xyz);
    gl_PointSize = aSize * scale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec3 vColor;
  varying vec3 vUV;
  varying float vFog;
  void main() {
    vec3 col = vColor;
    if (vUV.z > 0.0) {
      vec2 uv = vUV.xy + vec2(gl_PointCoord.x, gl_PointCoord.y) * vUV.z;
      vec4 t = texture2D(map, uv);
      if (t.a < 0.5) discard;
      col *= t.rgb;
    }
    float f = smoothstep(fogNear, fogFar, vFog);
    gl_FragColor = vec4(mix(col, fogColor, f), 1.0);
  }
`;

export class ParticleSystem {
  readonly points: THREE.Points;
  private readonly parts: P[] = [];
  private readonly pos = new Float32Array(MAX * 3);
  private readonly col = new Float32Array(MAX * 3);
  private readonly uv = new Float32Array(MAX * 3);
  private readonly size = new Float32Array(MAX);
  private readonly geo: THREE.BufferGeometry;
  readonly material: THREE.ShaderMaterial;
  private faceTiles = buildBlockAtlas().faceTiles;
  /** 0 all, 1 decreased, 2 minimal. */
  level = 0;
  /** Returns the solid-ness of a block for particle collisions. */
  solidAt: ((x: number, y: number, z: number) => boolean) | null = null;
  brightnessAt: ((x: number, y: number, z: number) => number) | null = null;

  constructor(atlas: THREE.Texture, fog: { fogColor: THREE.IUniform; fogNear: THREE.IUniform; fogFar: THREE.IUniform }) {
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aUV', new THREE.BufferAttribute(this.uv, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({
      uniforms: { map: { value: atlas }, scale: { value: 600 }, fogColor: fog.fogColor, fogNear: fog.fogNear, fogFar: fog.fogFar },
      vertexShader: VERT,
      fragmentShader: FRAG,
    });
    this.points = new THREE.Points(this.geo, this.material);
    this.points.frustumCulled = false;
  }

  setViewportHeight(px: number): void {
    this.material.uniforms.scale.value = px / 2;
  }

  clear(): void {
    this.parts.length = 0;
  }

  emit(kind: ParticleKind, x: number, y: number, z: number, count: number, o: ParticleOptions = {}): void {
    const scale = this.level === 0 ? 1 : this.level === 1 ? 0.4 : 0.1;
    let n = Math.ceil(count * scale);
    if (kind === 'heart' && count === 0) n = 1 + Math.floor(Math.random() * 3);
    const spread = o.spread ?? 0.3;
    for (let i = 0; i < n; i++) {
      if (this.parts.length >= MAX) this.parts.shift();
      const p: P = {
        x: x + (Math.random() - 0.5) * 2 * spread, y: y + (Math.random() - 0.5) * 2 * spread, z: z + (Math.random() - 0.5) * 2 * spread,
        vx: (Math.random() - 0.5) * 0.1, vy: Math.random() * 0.1, vz: (Math.random() - 0.5) * 0.1,
        life: 0, maxLife: 20, size: 0.12, r: 1, g: 1, b: 1, u: 0, v: 0, uvs: 0, gravity: 0, drag: 0.98, grow: 0, collide: false, kind,
      };
      if (o.vx !== undefined) { p.vx = o.vx; p.vy = o.vy ?? 0; p.vz = o.vz ?? 0; }
      this.configure(p, kind, o);
      this.parts.push(p);
    }
  }

  private configure(p: P, kind: ParticleKind, o: ParticleOptions): void {
    const rnd = Math.random;
    switch (kind) {
      case 'block': {
        const tile = this.faceTiles[(((o.blockId ?? 1) << 4) | ((o.blockMeta ?? 0) & 15)) * 6 + 4];
        const [u0, v0, u1] = tileUV(tile);
        const ts = u1 - u0;
        p.u = u0 + Math.floor(rnd() * 12) / 16 * ts;
        p.v = v0 + Math.floor(rnd() * 12) / 16 * ts;
        p.uvs = ts / 4;
        p.size = 0.08 + rnd() * 0.06;
        p.gravity = 0.04; p.maxLife = 12 + rnd() * 12; p.collide = true;
        p.vx = (rnd() - 0.5) * 0.2; p.vy = rnd() * 0.2; p.vz = (rnd() - 0.5) * 0.2;
        p.r = p.g = p.b = 0.9;
        break;
      }
      case 'smoke': {
        const c = 0.2 + rnd() * 0.3;
        p.r = p.g = p.b = c; p.size = 0.1; p.grow = 0.005; p.vy = 0.02 + rnd() * 0.03; p.maxLife = 20 + rnd() * 20;
        p.vx *= 0.3; p.vz *= 0.3;
        break;
      }
      case 'flame':
        p.r = 1; p.g = 0.6 + rnd() * 0.3; p.b = 0.1; p.size = 0.08; p.maxLife = 10 + rnd() * 10; p.vx *= 0.1; p.vy = 0.01; p.vz *= 0.1; p.grow = -0.004;
        break;
      case 'lava':
        p.r = 1; p.g = 0.4; p.b = 0; p.size = 0.1; p.gravity = 0.04; p.vy = 0.2 + rnd() * 0.2; p.maxLife = 30; p.collide = true;
        break;
      case 'explosion':
      case 'largeexplode': {
        const c = 0.7 + rnd() * 0.3;
        p.r = p.g = p.b = c; p.size = kind === 'largeexplode' ? 1.2 : 0.4 + rnd() * 0.3; p.maxLife = 8 + rnd() * 10;
        p.vx = (rnd() - 0.5) * 0.4; p.vy = (rnd() - 0.5) * 0.4; p.vz = (rnd() - 0.5) * 0.4; p.grow = 0.02;
        break;
      }
      case 'splash':
        p.r = 0.6; p.g = 0.7; p.b = 1; p.size = 0.07; p.gravity = 0.04; p.vy = 0.1 + rnd() * 0.15; p.maxLife = 20; p.collide = true;
        break;
      case 'bubble':
        p.r = 0.7; p.g = 0.8; p.b = 1; p.size = 0.06; p.vy = 0.05; p.maxLife = 15;
        break;
      case 'heart':
        p.r = 1; p.g = 0.15; p.b = 0.2; p.size = 0.2; p.vy = 0.03; p.maxLife = 30; p.vx *= 0.2; p.vz *= 0.2;
        break;
      case 'portal':
        p.r = 0.6 + rnd() * 0.3; p.g = 0.2; p.b = 0.9; p.size = 0.08; p.maxLife = 30 + rnd() * 20;
        p.ox = p.x; p.oy = p.y; p.oz = p.z;
        p.vx = (rnd() - 0.5) * 1.2; p.vy = (rnd() - 0.5) * 1.2; p.vz = (rnd() - 0.5) * 1.2;
        break;
      case 'crit':
        p.r = 0.9; p.g = 0.9; p.b = 0.6; p.size = 0.08; p.maxLife = 10; p.vx *= 4; p.vy = rnd() * 0.3; p.vz *= 4; p.gravity = 0.02;
        break;
      case 'potion':
      case 'spell': {
        const c = o.color ?? [0.5 + rnd() * 0.5, 0.3 + rnd() * 0.5, 0.8];
        p.r = c[0]; p.g = c[1]; p.b = c[2]; p.size = 0.1; p.maxLife = 20 + rnd() * 10; p.vy = 0.02 + rnd() * 0.05;
        if (kind === 'potion') { p.vx = (rnd() - 0.5) * 0.3; p.vy = rnd() * 0.3; p.vz = (rnd() - 0.5) * 0.3; p.gravity = 0.02; }
        break;
      }
      case 'reddust':
        p.r = 0.9; p.g = 0.1; p.b = 0.1; p.size = 0.07; p.maxLife = 10; p.vx = 0; p.vy = 0.01; p.vz = 0;
        break;
      case 'snowball':
        p.r = p.g = p.b = 0.95; p.size = 0.08; p.gravity = 0.04; p.maxLife = 15; p.collide = true;
        break;
      case 'note': {
        const c = o.color ?? [0.3, 1, 0.3];
        p.r = c[0]; p.g = c[1]; p.b = c[2]; p.size = 0.2; p.vy = 0.05; p.maxLife = 20; p.vx = 0; p.vz = 0;
        break;
      }
      case 'enchant':
        p.r = 0.8; p.g = 0.8; p.b = 1; p.size = 0.07; p.maxLife = 25; p.vy = -0.05; p.vx *= 0.3; p.vz *= 0.3;
        break;
      case 'dragonbreath':
        p.r = 0.8; p.g = 0.2; p.b = 1; p.size = 0.15; p.maxLife = 25; p.grow = 0.01;
        break;
      case 'angry':
        p.r = 0.4; p.g = 0.05; p.b = 0.05; p.size = 0.15; p.maxLife = 15; p.vy = 0.05;
        break;
      case 'dripWater':
        p.r = 0.3; p.g = 0.4; p.b = 1; p.size = 0.05; p.gravity = 0.03; p.maxLife = 40; p.vx = 0; p.vy = 0; p.vz = 0; p.collide = true;
        break;
      case 'dripLava':
        p.r = 1; p.g = 0.4; p.b = 0; p.size = 0.05; p.gravity = 0.03; p.maxLife = 40; p.vx = 0; p.vy = 0; p.vz = 0; p.collide = true;
        break;
    }
    if (o.speed !== undefined) { p.vx *= o.speed; p.vy *= o.speed; p.vz *= o.speed; }
  }

  /** Advance simulation by one game tick. */
  tick(): void {
    const list = this.parts;
    let w = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      p.life++;
      if (p.life >= p.maxLife) continue;
      if (p.kind === 'portal' && p.ox !== undefined) {
        // Portal particles spiral back toward their origin.
        const t = p.life / p.maxLife;
        p.x = p.ox + p.vx * (1 - t) * 0.5;
        p.y = p.oy! + p.vy * (1 - t) * 0.5 + (1 - t * t) * 0.3;
        p.z = p.oz! + p.vz * (1 - t) * 0.5;
      } else {
        p.vy -= p.gravity;
        let nx = p.x + p.vx; let ny = p.y + p.vy; let nz = p.z + p.vz;
        if (p.collide && this.solidAt) {
          if (this.solidAt(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))) { ny = p.y; p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; }
          if (this.solidAt(Math.floor(nx), Math.floor(ny), Math.floor(p.z))) { nx = p.x; p.vx = 0; }
          if (this.solidAt(Math.floor(nx), Math.floor(ny), Math.floor(nz))) { nz = p.z; p.vz = 0; }
        }
        p.x = nx; p.y = ny; p.z = nz;
        p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
      }
      p.size = Math.max(0.01, p.size + p.grow);
      list[w++] = p;
    }
    list.length = w;
  }

  /** Upload particle data for rendering. */
  sync(): void {
    const n = Math.min(this.parts.length, MAX);
    for (let i = 0; i < n; i++) {
      const p = this.parts[i];
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const br = this.brightnessAt && p.kind !== 'flame' && p.kind !== 'lava' && p.kind !== 'portal' && p.kind !== 'reddust' ? this.brightnessAt(p.x, p.y, p.z) : 1;
      this.col[i * 3] = p.r * br; this.col[i * 3 + 1] = p.g * br; this.col[i * 3 + 2] = p.b * br;
      this.uv[i * 3] = p.u; this.uv[i * 3 + 1] = p.v; this.uv[i * 3 + 2] = p.uvs;
      this.size[i] = p.size;
    }
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'aColor', 'aUV', 'aSize']) (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
  }

  get count(): number {
    return this.parts.length;
  }
}

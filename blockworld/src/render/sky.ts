/**
 * Sky: background colour, sun, moon, stars and a flat pixel cloud layer.
 * Deliberately simple, like the fast sky of an early-2010s voxel game.
 */

import * as THREE from 'three';
import { packActive, packCanvas } from './pack';
import { Random } from '../core/rng';
import { Dim, type DimId } from '../world/constants';

export interface SkyState {
  daylight: number;
  fogColor: THREE.Color;
  skyColor: THREE.Color;
  celestialAngle: number;
}

/** Resource-pack moon phases, in the order they occur from full moon. */
const MOON_PHASES = ['full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent', 'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous'];

/** Pack texture for a sky element, or null without a pack. */
function packSky(path: string): THREE.Texture | null {
  const c = packActive() ? packCanvas(path) : null;
  return c ? canvasTexture(c) : null;
}

/** Classic celestial angle curve for a world time (0 = sunrise). */
export function celestialAngle(time: number): number {
  let f = ((time % 24000) + 24000) % 24000 / 24000 - 0.25;
  if (f < 0) f += 1;
  if (f > 1) f -= 1;
  const g = f;
  f = 1 - (Math.cos(f * Math.PI) + 1) / 2;
  return g + (f - g) / 3;
}

/** 0 (night) .. 1 (day) sky brightness used for lighting. */
export function daylightFactor(time: number, rain: number): number {
  const a = celestialAngle(time);
  let b = Math.cos(a * Math.PI * 2) * 2 + 0.5;
  b = Math.max(0, Math.min(1, b));
  return b * (1 - rain * 0.3125);
}

function pixelTexture(size: number, paint: (ctx: CanvasRenderingContext2D) => void): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  paint(ctx);
  return canvasTexture(canvas);
}

function canvasTexture(canvas: HTMLCanvasElement): THREE.Texture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SkyRenderer {
  /** Near sky (clouds): drawn with the world so terrain can hide it. */
  readonly group = new THREE.Group();
  /** Far sky (sun, moon, stars, End sky): drawn first, beyond the world's far plane. */
  readonly farGroup = new THREE.Group();
  private readonly celestial = new THREE.Group();
  private readonly sun: THREE.Mesh;
  private readonly moon: THREE.Mesh;
  private readonly stars: THREE.Points;
  private readonly clouds: THREE.Mesh;
  private readonly cloudTex: THREE.Texture;
  private readonly endSky: THREE.Mesh;
  private readonly sunGlow: THREE.Mesh;
  /** Pack moon phase textures (one per phase) when a pack provides them. */
  private readonly moonPhases: (THREE.Texture | null)[] = [];
  private moonPhase = -1;
  /** World blocks covered by one repeat of the cloud texture. */
  private readonly cloudPeriod: number;
  cloudsEnabled = true;

  constructor() {
    this.group.name = 'sky';
    const sunTex = pixelTexture(16, (ctx) => {
      ctx.fillStyle = '#ffffa0';
      ctx.fillRect(2, 2, 12, 12);
      ctx.fillStyle = '#ffff60';
      ctx.fillRect(4, 4, 8, 8);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(6, 6, 4, 4);
    });
    const moonTex = pixelTexture(16, (ctx) => {
      ctx.fillStyle = '#d8dce8';
      ctx.fillRect(3, 3, 10, 10);
      ctx.fillStyle = '#b0b4c4';
      ctx.fillRect(5, 5, 2, 2);
      ctx.fillRect(9, 8, 3, 2);
      ctx.fillRect(6, 10, 2, 1);
    });
    const mat = (t: THREE.Texture) => new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    // Pack sun and moon textures include their glow, so they are drawn larger.
    const packSun = packSky('environment/celestial/sun');
    for (const phase of MOON_PHASES) this.moonPhases.push(packSky(`environment/celestial/moon/${phase}`));
    const packMoon = this.moonPhases[0];
    this.sun = new THREE.Mesh(new THREE.PlaneGeometry(packSun ? 180 : 60, packSun ? 180 : 60), mat(packSun ?? sunTex));
    this.sun.position.set(0, 300, 0);
    this.sun.rotation.x = Math.PI / 2;
    this.moon = new THREE.Mesh(new THREE.PlaneGeometry(packMoon ? 120 : 40, packMoon ? 120 : 40), mat(packMoon ?? moonTex));
    this.moon.position.set(0, -300, 0);
    this.moon.rotation.x = -Math.PI / 2;
    this.celestial.add(this.sun, this.moon);

    // Stars: a fixed random set of points on a sphere.
    const r = new Random(10842);
    const pts: number[] = [];
    for (let i = 0; i < 1500; i++) {
      const u = r.next() * 2 - 1;
      const t = r.next() * Math.PI * 2;
      const s = Math.sqrt(1 - u * u);
      pts.push(Math.cos(t) * s * 350, u * 350, Math.sin(t) * s * 350);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    this.celestial.add(this.stars);

    const glowMat = new THREE.MeshBasicMaterial({ color: 0xff9040, transparent: true, opacity: 0, depthWrite: false, fog: false, side: THREE.DoubleSide });
    this.sunGlow = new THREE.Mesh(new THREE.CircleGeometry(160, 16), glowMat);
    this.farGroup.add(this.sunGlow);
    this.farGroup.add(this.celestial);

    // Cloud layer: a thresholded noise map scrolled across a large plane
    // (a pack's cloud map uses 12-block cells).
    const packClouds = packSky('environment/clouds');
    this.cloudPeriod = packClouds ? 256 * 12 : 128;
    this.cloudTex = packClouds ?? pixelTexture(64, (ctx) => {
      const rr = new Random(4242);
      const cells = new Uint8Array(64 * 64);
      for (let i = 0; i < 64 * 64; i++) cells[i] = rr.next() < 0.45 ? 1 : 0;
      // A few smoothing passes produce blobby clouds.
      for (let pass = 0; pass < 4; pass++) {
        const next = new Uint8Array(cells.length);
        for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) n += cells[((y + dy) & 63) * 64 + ((x + dx) & 63)];
          next[y * 64 + x] = n >= 5 ? 1 : 0;
        }
        cells.set(next);
      }
      ctx.clearRect(0, 0, 64, 64);
      ctx.fillStyle = '#ffffff';
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) if (cells[y * 64 + x]) ctx.fillRect(x, y, 1, 1);
    });
    this.cloudTex.wrapS = THREE.RepeatWrapping;
    this.cloudTex.wrapT = THREE.RepeatWrapping;
    this.cloudTex.repeat.set(768 / this.cloudPeriod, 768 / this.cloudPeriod);
    const cloudMat = new THREE.MeshBasicMaterial({ map: this.cloudTex, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide, fog: true });
    this.clouds = new THREE.Mesh(new THREE.PlaneGeometry(768, 768), cloudMat);
    this.clouds.rotation.x = -Math.PI / 2;
    this.clouds.renderOrder = 5;
    this.group.add(this.clouds);

    // The End has a dark, speckled sky box.
    const packEnd = packSky('environment/end_sky');
    const endTex = packEnd ?? pixelTexture(32, (ctx) => {
      ctx.fillStyle = '#140c1c';
      ctx.fillRect(0, 0, 32, 32);
      const rr = new Random(99);
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = rr.chance(0.5) ? '#2a1a36' : '#0a0610';
        ctx.fillRect(rr.int(32), rr.int(32), 1 + rr.int(2), 1);
      }
    });
    endTex.wrapS = THREE.RepeatWrapping;
    endTex.wrapT = THREE.RepeatWrapping;
    endTex.repeat.set(packEnd ? 16 : 8, packEnd ? 16 : 8);
    this.endSky = new THREE.Mesh(new THREE.BoxGeometry(600, 600, 600), new THREE.MeshBasicMaterial({
      map: endTex, side: THREE.BackSide, fog: false, depthWrite: false, color: packEnd ? 0x282828 : 0xffffff,
    }));
    this.endSky.visible = false;
    this.farGroup.add(this.endSky);
  }

  update(time: number, dim: DimId, camPos: THREE.Vector3, rain: number, renderDistance: number, dt: number): SkyState {
    this.group.position.copy(camPos);
    this.farGroup.position.copy(camPos);
    const angle = celestialAngle(time);
    if (dim === Dim.NETHER) {
      this.setVisible(false, false);
      const fog = new THREE.Color(0.2, 0.03, 0.03);
      return { daylight: 0, fogColor: fog, skyColor: fog.clone(), celestialAngle: angle };
    }
    if (dim === Dim.END) {
      this.setVisible(false, true);
      const fog = new THREE.Color(0.09, 0.06, 0.12);
      return { daylight: 0, fogColor: fog, skyColor: new THREE.Color(0.08, 0.05, 0.1), celestialAngle: angle };
    }
    this.setVisible(true, false);
    const daylight = daylightFactor(time, rain);
    this.celestial.rotation.set(0, 0, 0);
    this.celestial.rotation.x = angle * Math.PI * 2;
    // Rotate around the east-west axis: the sun rises in the east.
    this.celestial.rotation.order = 'YXZ';
    this.celestial.rotation.y = -Math.PI / 2;
    const phase = Math.floor(time / 24000) % 8;
    if (phase !== this.moonPhase && this.moonPhases[phase]) {
      this.moonPhase = phase;
      const mm = this.moon.material as THREE.MeshBasicMaterial;
      mm.map = this.moonPhases[phase];
      mm.needsUpdate = true;
    }
    const starOpacity = Math.max(0, 1 - daylight * 2.2) * (1 - rain);
    (this.stars.material as THREE.PointsMaterial).opacity = starOpacity;
    this.stars.visible = starOpacity > 0.01;

    const day = new THREE.Color(0.47, 0.65, 1.0);
    const skyColor = day.clone().multiplyScalar(Math.max(0.02, daylight));
    const fog = new THREE.Color(0.75, 0.85, 1.0).multiplyScalar(Math.max(0.03, daylight * 0.94 + 0.06 * daylight));
    if (rain > 0) {
      const gray = (skyColor.r + skyColor.g + skyColor.b) / 3;
      skyColor.lerp(new THREE.Color(gray, gray, gray), rain * 0.6);
      fog.lerp(new THREE.Color(gray, gray, gray), rain * 0.5);
    }
    // Sunrise / sunset glow near the horizon.
    const c = Math.cos(angle * Math.PI * 2);
    const glow = Math.max(0, 1 - Math.abs(c) / 0.4);
    const glowMat = this.sunGlow.material as THREE.MeshBasicMaterial;
    glowMat.opacity = glow * 0.55 * (1 - rain);
    const sunSide = Math.sin(angle * Math.PI * 2) > 0 ? -1 : 1;
    this.sunGlow.position.set(sunSide * 280, 0, 0);
    this.sunGlow.lookAt(camPos.clone().add(new THREE.Vector3(0, 0, 0)));
    this.sunGlow.rotation.set(0, sunSide * Math.PI / 2, 0);
    if (glow > 0) fog.lerp(new THREE.Color(0.9, 0.55, 0.3), glow * 0.35);

    // Clouds drift slowly eastward and follow the camera.
    if (this.clouds.visible) {
      const cloudY = 108;
      this.clouds.position.set(0, cloudY - camPos.y, 0);
      const period = this.cloudPeriod;
      this.cloudTex.offset.set((camPos.x + time * 0.03) / period, -camPos.z / period);
      const cm = this.clouds.material as THREE.MeshBasicMaterial;
      cm.color.setScalar(Math.max(0.15, daylight * 0.95 + 0.05));
      cm.opacity = 0.8 * (1 - rain * 0.3);
    }
    void renderDistance; void dt;
    return { daylight, fogColor: fog, skyColor, celestialAngle: angle };
  }

  private setVisible(overworld: boolean, end: boolean): void {
    this.celestial.visible = overworld;
    this.sunGlow.visible = overworld;
    this.clouds.visible = overworld && this.cloudsEnabled;
    this.endSky.visible = end;
  }
}

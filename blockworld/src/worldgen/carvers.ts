/**
 * Old-style cave and ravine carvers: long winding tunnels ("worms") started
 * from nearby chunks and carved only where they pass through the current one.
 * This keeps generation a pure function of (seed, chunk).
 */

import { BlockId } from '../blocks/ids';
import { Random, hashCombine } from '../core/rng';
import { blockIndex } from '../world/constants';
import type { ChunkWriter } from './chunkwriter';

const RANGE = 8;

const CARVABLE = new Uint8Array(256);
for (const id of [BlockId.STONE, BlockId.DIRT, BlockId.GRASS, BlockId.SAND, BlockId.GRAVEL, BlockId.SANDSTONE,
  BlockId.NETHERRACK, BlockId.SOUL_SAND, BlockId.MYCELIUM, BlockId.COAL_ORE, BlockId.IRON_ORE, BlockId.CLAY]) CARVABLE[id] = 1;

export interface CarverConfig {
  /** Fill carved space below this y with lava (overworld 10). */
  lavaLevel: number;
  /** Nether uses denser caves. */
  nether: boolean;
}

export function carveCaves(w: ChunkWriter, seed: number, cfg: CarverConfig): void {
  for (let ocx = w.cx - RANGE; ocx <= w.cx + RANGE; ocx++) {
    for (let ocz = w.cz - RANGE; ocz <= w.cz + RANGE; ocz++) {
      const r = new Random(hashCombine(seed, ocx, ocz, 0xca7e));
      // Classic distribution: most chunks start no caves, a few start many.
      let count = r.int(r.int(r.int(cfg.nether ? 10 : 40) + 1) + 1);
      if (!cfg.nether && r.int(15) !== 0) count = 0;
      for (let i = 0; i < count; i++) {
        const x = ocx * 16 + r.int(16);
        const y = cfg.nether ? r.int(128) : r.int(r.int(120) + 8);
        const z = ocz * 16 + r.int(16);
        let tunnels = 1;
        if (r.int(4) === 0) {
          carveTunnel(w, r.nextUint(), x, y, z, 1 + r.next() * 6, 0, 0, -1, -1, 0.5, cfg);
          tunnels += r.int(4);
        }
        for (let t = 0; t < tunnels; t++) {
          const yaw = r.next() * Math.PI * 2;
          const pitch = ((r.next() - 0.5) * 2) / 8;
          let width = r.next() * 2 + r.next();
          if (r.int(10) === 0) width *= r.next() * r.next() * 3 + 1;
          if (cfg.nether) width *= 2;
          carveTunnel(w, r.nextUint(), x, y, z, width, yaw, pitch, 0, 0, 1, cfg);
        }
      }
    }
  }
}

function carveTunnel(
  w: ChunkWriter, seed: number, sx: number, sy: number, sz: number, width: number,
  yawIn: number, pitchIn: number, startStep: number, lengthIn: number, heightScale: number, cfg: CarverConfig,
): void {
  const r = new Random(seed);
  const centerX = w.minX + 8;
  const centerZ = w.minZ + 8;
  let x = sx; let y = sy; let z = sz;
  let yaw = yawIn; let pitch = pitchIn;
  let yawDrift = 0; let pitchDrift = 0;
  const maxLen = RANGE * 16 - 16;
  let length = lengthIn <= 0 ? maxLen - r.int(maxLen / 4) : lengthIn;
  let step = startStep;
  let isRoom = false;
  if (step === -1) {
    step = length / 2;
    isRoom = true;
  }
  const branchAt = r.int(Math.max(1, length / 2)) + length / 4;
  const steep = r.int(6) === 0;
  for (; step < length; step++) {
    const radiusH = 1.5 + Math.sin((step * Math.PI) / length) * width;
    const radiusV = radiusH * heightScale;
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp;
    y += Math.sin(pitch);
    z += Math.sin(yaw) * cp;
    pitch *= steep ? 0.92 : 0.7;
    pitch += pitchDrift * 0.1;
    yaw += yawDrift * 0.1;
    pitchDrift *= 0.9;
    yawDrift *= 0.75;
    pitchDrift += (r.next() - r.next()) * r.next() * 2;
    yawDrift += (r.next() - r.next()) * r.next() * 4;
    if (!isRoom && step === Math.floor(branchAt) && width > 1 && length > 0) {
      carveTunnel(w, r.nextUint(), x, y, z, r.next() * 0.5 + 0.5, yaw - Math.PI / 2, pitch / 3, step, length, 1, cfg);
      carveTunnel(w, r.nextUint(), x, y, z, r.next() * 0.5 + 0.5, yaw + Math.PI / 2, pitch / 3, step, length, 1, cfg);
      return;
    }
    if (!isRoom && r.int(4) === 0) continue;
    const dx = x - centerX;
    const dz = z - centerZ;
    const remaining = length - step;
    const reach = width + 18;
    if (dx * dx + dz * dz - remaining * remaining > reach * reach) return;
    if (x < centerX - 16 - radiusH * 2 || z < centerZ - 16 - radiusH * 2 || x > centerX + 16 + radiusH * 2 || z > centerZ + 16 + radiusH * 2) continue;
    carveEllipsoid(w, x, y, z, radiusH, radiusV, cfg);
    if (isRoom) break;
  }
}

function carveEllipsoid(w: ChunkWriter, x: number, y: number, z: number, rh: number, rv: number, cfg: CarverConfig): void {
  const x0 = Math.max(Math.floor(x - rh) - w.minX - 1, 0);
  const x1 = Math.min(Math.floor(x + rh) - w.minX + 1, 16);
  const y0 = Math.max(Math.floor(y - rv) - 1, 1);
  const y1 = Math.min(Math.floor(y + rv) + 1, 120);
  const z0 = Math.max(Math.floor(z - rh) - w.minZ - 1, 0);
  const z1 = Math.min(Math.floor(z + rh) - w.minZ + 1, 16);
  if (x0 >= x1 || z0 >= z1) return;
  // Abort near water so caves do not drain oceans (classic behaviour).
  for (let lx = x0; lx < x1; lx++) {
    for (let lz = z0; lz < z1; lz++) {
      for (let ly = y1 + 1; ly >= y0 - 1; ly--) {
        if (ly < 0 || ly >= 128) continue;
        const id = w.blocks[blockIndex(lx, ly, lz)];
        if (id === BlockId.WATER || id === BlockId.WATER_FLOWING) return;
        if (ly !== y0 - 1 && lx !== x0 && lx !== x1 - 1 && lz !== z0 && lz !== z1 - 1) ly = y0;
      }
    }
  }
  for (let lx = x0; lx < x1; lx++) {
    const nx = (lx + w.minX + 0.5 - x) / rh;
    for (let lz = z0; lz < z1; lz++) {
      const nz = (lz + w.minZ + 0.5 - z) / rh;
      if (nx * nx + nz * nz >= 1) continue;
      let hadGrass = false;
      for (let ly = y1 - 1; ly >= y0; ly--) {
        const ny = (ly + 0.5 - y) / rv;
        if (ny > -0.7 && nx * nx + ny * ny + nz * nz < 1) {
          const i = blockIndex(lx, ly, lz);
          const id = w.blocks[i];
          if (id === BlockId.GRASS || id === BlockId.MYCELIUM) hadGrass = true;
          if (!CARVABLE[id]) continue;
          if (ly < cfg.lavaLevel) {
            w.blocks[i] = cfg.nether ? 0 : BlockId.LAVA;
            w.meta[i] = 0;
          } else {
            w.blocks[i] = 0;
            w.meta[i] = 0;
            if (hadGrass && ly > 0) {
              const below = blockIndex(lx, ly - 1, lz);
              if (w.blocks[below] === BlockId.DIRT) w.blocks[below] = BlockId.GRASS;
            }
          }
        }
      }
    }
  }
}

/** Ravines: rare, very tall and narrow canyons. */
export function carveRavines(w: ChunkWriter, seed: number): void {
  for (let ocx = w.cx - RANGE; ocx <= w.cx + RANGE; ocx++) {
    for (let ocz = w.cz - RANGE; ocz <= w.cz + RANGE; ocz++) {
      const r = new Random(hashCombine(seed, ocx, ocz, 0x2a71e));
      if (r.int(50) !== 0) continue;
      const x = ocx * 16 + r.int(16);
      const y = r.int(r.int(40) + 8) + 20;
      const z = ocz * 16 + r.int(16);
      const yaw = r.next() * Math.PI * 2;
      const pitch = ((r.next() - 0.5) * 2) / 8;
      const width = (r.next() * 2 + r.next()) * 2;
      carveRavine(w, r.nextUint(), x, y, z, width, yaw, pitch, 3);
    }
  }
}

function carveRavine(w: ChunkWriter, seed: number, sx: number, sy: number, sz: number, width: number, yawIn: number, pitchIn: number, heightScale: number): void {
  const r = new Random(seed);
  const centerX = w.minX + 8;
  const centerZ = w.minZ + 8;
  let x = sx; let y = sy; let z = sz;
  let yaw = yawIn; let pitch = pitchIn;
  let yawDrift = 0; let pitchDrift = 0;
  const length = RANGE * 16 - 16 - r.int(28);
  const widthProfile: number[] = [];
  let f = 1;
  for (let i = 0; i < 128; i++) {
    if (i === 0 || r.int(3) === 0) f = 1 + r.next() * r.next();
    widthProfile.push(f * f);
  }
  for (let step = 0; step < length; step++) {
    const radiusH = 1.5 + Math.sin((step * Math.PI) / length) * width;
    const radiusV = radiusH * heightScale;
    const cp = Math.cos(pitch);
    x += Math.cos(yaw) * cp;
    y += Math.sin(pitch);
    z += Math.sin(yaw) * cp;
    pitch *= 0.7;
    pitch += pitchDrift * 0.05;
    yaw += yawDrift * 0.05;
    pitchDrift *= 0.8;
    yawDrift *= 0.5;
    pitchDrift += (r.next() - r.next()) * r.next() * 2;
    yawDrift += (r.next() - r.next()) * r.next() * 4;
    if (r.int(4) === 0) continue;
    if (x < centerX - 16 - radiusH * 2 || z < centerZ - 16 - radiusH * 2 || x > centerX + 16 + radiusH * 2 || z > centerZ + 16 + radiusH * 2) continue;
    const x0 = Math.max(Math.floor(x - radiusH) - w.minX - 1, 0);
    const x1 = Math.min(Math.floor(x + radiusH) - w.minX + 1, 16);
    const y0 = Math.max(Math.floor(y - radiusV) - 1, 1);
    const y1 = Math.min(Math.floor(y + radiusV) + 1, 120);
    const z0 = Math.max(Math.floor(z - radiusH) - w.minZ - 1, 0);
    const z1 = Math.min(Math.floor(z + radiusH) - w.minZ + 1, 16);
    let blocked = false;
    for (let lx = x0; lx < x1 && !blocked; lx++) for (let lz = z0; lz < z1 && !blocked; lz++) for (let ly = y0; ly <= y1 && !blocked; ly++) {
      const id = w.blocks[blockIndex(lx, Math.min(127, ly), lz)];
      if (id === BlockId.WATER || id === BlockId.WATER_FLOWING) blocked = true;
    }
    if (blocked) continue;
    for (let lx = x0; lx < x1; lx++) {
      const nx = (lx + w.minX + 0.5 - x) / radiusH;
      for (let lz = z0; lz < z1; lz++) {
        const nz = (lz + w.minZ + 0.5 - z) / radiusH;
        if (nx * nx + nz * nz >= 1) continue;
        for (let ly = y1 - 1; ly >= y0; ly--) {
          const ny = (ly + 0.5 - y) / radiusV;
          if ((nx * nx + nz * nz) * widthProfile[ly] + (ny * ny) / 6 < 1) {
            const i = blockIndex(lx, ly, lz);
            if (!CARVABLE[w.blocks[i]]) continue;
            w.blocks[i] = ly < 10 ? BlockId.LAVA : 0;
            w.meta[i] = 0;
          }
        }
      }
    }
  }
}

/**
 * Overworld structure placement: villages, abandoned mineshafts and the three
 * strongholds. Plans are pure functions of the world seed, cached per worker,
 * and rasterised into each chunk as it is generated.
 */

import { Random, hashCombine } from '../../core/rng';
import { SEA_LEVEL } from '../../world/constants';
import { Biome } from '../biomes';
import type { ChunkWriter } from '../chunkwriter';
import type { OverworldGenerator } from '../overworld';
import { Mineshaft } from './mineshaft';
import { bbox, boxesIntersect, rasterizePieces, type BBox } from './piece';
import { Stronghold } from './stronghold';
import { Village } from './village';

const VILLAGE_REGION = 28; // chunks
const MINESHAFT_REGION = 10; // chunks

export class OverworldStructures {
  private villages = new Map<string, Village | null>();
  private mineshafts = new Map<string, Mineshaft | null>();
  private strongholdCache: Stronghold[] | null = null;

  constructor(readonly gen: OverworldGenerator) {}

  // ---------------------------------------------------------------------------
  // Strongholds
  // ---------------------------------------------------------------------------
  /** Chunk-aligned start positions of the three strongholds. */
  strongholdStarts(): [number, number][] {
    const r = new Random(hashCombine(this.gen.seed, 0x5709));
    let angle = r.next() * Math.PI * 2;
    const out: [number, number][] = [];
    for (let i = 0; i < 3; i++) {
      const dist = (1.25 + r.next()) * 32; // chunks: 40..72, i.e. 640..1152 blocks
      const cx = Math.round(Math.cos(angle) * dist);
      const cz = Math.round(Math.sin(angle) * dist);
      out.push([cx * 16 + 8, cz * 16 + 8]);
      angle += (Math.PI * 2) / 3;
    }
    return out;
  }

  strongholds(): Stronghold[] {
    if (!this.strongholdCache) {
      this.strongholdCache = this.strongholdStarts().map(([x, z]) => {
        const surface = this.gen.surfaceHeight(x, z);
        const y = Math.max(30, Math.min(44, surface - 18));
        return new Stronghold(this.gen.seed, x, y, z);
      });
    }
    return this.strongholdCache;
  }

  /** Positions Eyes of Ender fly toward. */
  strongholdPositions(): [number, number][] {
    return this.strongholdStarts();
  }

  // ---------------------------------------------------------------------------
  // Villages
  // ---------------------------------------------------------------------------
  private villageIn(rx: number, rz: number): Village | null {
    const key = `${rx},${rz}`;
    if (this.villages.has(key)) return this.villages.get(key)!;
    let v: Village | null = null;
    const r = new Random(hashCombine(this.gen.seed, rx, rz, 0x7111));
    const cx = rx * VILLAGE_REGION + r.int(VILLAGE_REGION - 8);
    const cz = rz * VILLAGE_REGION + r.int(VILLAGE_REGION - 8);
    const x = cx * 16 + 8; const z = cz * 16 + 8;
    const biome = this.gen.biomeAt(x, z);
    if ((biome === Biome.PLAINS || biome === Biome.DESERT) && this.gen.surfaceHeight(x, z) >= SEA_LEVEL) {
      const cand = new Village(this.gen.seed, x, z, biome === Biome.DESERT, (px, pz) => this.gen.surfaceHeight(px, pz));
      // A village needs at least a few buildings to count.
      if (cand.pieces.filter((p) => p.kind !== 'road' && p.kind !== 'lamp').length >= 4) v = cand;
    }
    if (this.villages.size > 64) this.villages.clear();
    this.villages.set(key, v);
    return v;
  }

  private villagesNear(cx: number, cz: number): Village[] {
    const out: Village[] = [];
    const rx = Math.floor(cx / VILLAGE_REGION); const rz = Math.floor(cz / VILLAGE_REGION);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const v = this.villageIn(rx + dx, rz + dz);
        if (v && boxesIntersect(v.box, chunkBox(cx, cz))) out.push(v);
      }
    }
    return out;
  }

  villagersIn(cx: number, cz: number): [number, number, number][] {
    return this.villagesNear(cx, cz).flatMap((v) => v.villagersIn(cx, cz));
  }

  /** Trees and other decorations keep clear of village buildings. */
  inVillage(x: number, z: number): boolean {
    for (const v of this.villagesNear(x >> 4, z >> 4)) if (v.occupies(x, z)) return true;
    return false;
  }

  /** Nearest village centre (for tests and debugging). */
  findVillage(x: number, z: number, radiusRegions = 4): [number, number] | null {
    const rx0 = Math.floor((x >> 4) / VILLAGE_REGION); const rz0 = Math.floor((z >> 4) / VILLAGE_REGION);
    let best: [number, number] | null = null; let bestD = Infinity;
    for (let dx = -radiusRegions; dx <= radiusRegions; dx++) {
      for (let dz = -radiusRegions; dz <= radiusRegions; dz++) {
        const v = this.villageIn(rx0 + dx, rz0 + dz);
        if (!v) continue;
        const d = (v.x - x) ** 2 + (v.z - z) ** 2;
        if (d < bestD) { bestD = d; best = [v.x, v.z]; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  // Mineshafts
  // ---------------------------------------------------------------------------
  private mineshaftIn(rx: number, rz: number): Mineshaft | null {
    const key = `${rx},${rz}`;
    if (this.mineshafts.has(key)) return this.mineshafts.get(key)!;
    let m: Mineshaft | null = null;
    const r = new Random(hashCombine(this.gen.seed, rx, rz, 0x3113));
    const cx = rx * MINESHAFT_REGION + r.int(MINESHAFT_REGION);
    const cz = rz * MINESHAFT_REGION + r.int(MINESHAFT_REGION);
    const far = Math.max(Math.abs(cx), Math.abs(cz)) > 24;
    if (r.next() < (far ? 0.6 : 0.35)) {
      const x = cx * 16 + r.int(16); const z = cz * 16 + r.int(16);
      const top = this.gen.surfaceHeight(x, z);
      const y = Math.min(top - 16, 20 + r.int(24));
      if (y >= 12) m = new Mineshaft(this.gen.seed, x, y, z);
    }
    if (this.mineshafts.size > 128) this.mineshafts.clear();
    this.mineshafts.set(key, m);
    return m;
  }

  findMineshaft(x: number, z: number, radiusRegions = 3): [number, number, number] | null {
    const rx0 = Math.floor((x >> 4) / MINESHAFT_REGION); const rz0 = Math.floor((z >> 4) / MINESHAFT_REGION);
    let best: [number, number, number] | null = null; let bestD = Infinity;
    for (let dx = -radiusRegions; dx <= radiusRegions; dx++) {
      for (let dz = -radiusRegions; dz <= radiusRegions; dz++) {
        const m = this.mineshaftIn(rx0 + dx, rz0 + dz);
        if (!m) continue;
        const d = (m.x - x) ** 2 + (m.z - z) ** 2;
        if (d < bestD) { bestD = d; best = [m.x, m.y, m.z]; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------------------
  rasterize(w: ChunkWriter): void {
    const cb = chunkBox(w.cx, w.cz);
    const rx = Math.floor(w.cx / MINESHAFT_REGION); const rz = Math.floor(w.cz / MINESHAFT_REGION);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const m = this.mineshaftIn(rx + dx, rz + dz);
        if (m && boxesIntersect(m.box, cb)) rasterizePieces(m.pieces, w);
      }
    }
    for (const s of this.strongholds()) if (boxesIntersect(s.box, cb)) rasterizePieces(s.pieces, w);
    for (const v of this.villagesNear(w.cx, w.cz)) rasterizePieces(v.pieces, w);
  }
}

function chunkBox(cx: number, cz: number): BBox {
  return bbox(cx * 16, 0, cz * 16, cx * 16 + 15, 127, cz * 16 + 15);
}

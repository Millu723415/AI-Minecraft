/**
 * Chunk mesher: turns a chunk's voxel data into vertex buffers.
 *
 * - Hidden faces between opaque blocks are culled.
 * - Full cubes get smooth lighting with ambient occlusion.
 * - Non-cube shapes are emitted from their box lists (shapes.ts).
 * - Output is split into render passes (opaque / cutout / translucent / water / lava)
 *   so each can use the right material and blending.
 */

import { BlockId } from '../blocks/ids';
import { getBlock, SOLID, IS_FLUID } from '../blocks/registry';
import type { BlockDefinition } from '../blocks/types';
import { Chunk } from '../world/chunk';
import { WORLD_HEIGHT, blockIndex } from '../world/constants';
import type { Dimension } from '../world/dimension';
import { FOLIAGE_RGB, GRASS_RGB } from '../worldgen/biomes';
import { blockBoxes, type RenderBox } from './shapes';
import { buildBlockAtlas, tileOf, tileUV } from './tiles';

// ---------------------------------------------------------------------------
// Output buffers
// ---------------------------------------------------------------------------
export class MeshBuffer {
  pos: Float32Array;
  uv: Float32Array;
  light: Uint8Array; // sky, block, shade, unused
  tint: Uint8Array; // r, g, b, unused
  idx: Uint32Array;
  vcount = 0;
  icount = 0;

  constructor(initialQuads = 1024) {
    this.pos = new Float32Array(initialQuads * 12);
    this.uv = new Float32Array(initialQuads * 8);
    this.light = new Uint8Array(initialQuads * 16);
    this.tint = new Uint8Array(initialQuads * 16);
    this.idx = new Uint32Array(initialQuads * 6);
  }

  reset(): void {
    this.vcount = 0;
    this.icount = 0;
  }

  private grow(): void {
    const q = (this.pos.length / 12) * 2;
    const pos = new Float32Array(q * 12); pos.set(this.pos); this.pos = pos;
    const uv = new Float32Array(q * 8); uv.set(this.uv); this.uv = uv;
    const light = new Uint8Array(q * 16); light.set(this.light); this.light = light;
    const tint = new Uint8Array(q * 16); tint.set(this.tint); this.tint = tint;
    const idx = new Uint32Array(q * 6); idx.set(this.idx); this.idx = idx;
  }

  vertex(x: number, y: number, z: number, u: number, v: number, sky: number, block: number, shade: number, r: number, g: number, b: number): void {
    if (this.vcount * 3 + 3 > this.pos.length) this.grow();
    const vi = this.vcount;
    this.pos[vi * 3] = x;
    this.pos[vi * 3 + 1] = y;
    this.pos[vi * 3 + 2] = z;
    this.uv[vi * 2] = u;
    this.uv[vi * 2 + 1] = v;
    this.light[vi * 4] = sky;
    this.light[vi * 4 + 1] = block;
    this.light[vi * 4 + 2] = shade;
    this.tint[vi * 4] = r;
    this.tint[vi * 4 + 1] = g;
    this.tint[vi * 4 + 2] = b;
    this.vcount++;
  }

  /** Add the two triangles of the last four vertices. */
  quad(flip: boolean): void {
    if (this.icount + 6 > this.idx.length) this.grow();
    const b = this.vcount - 4;
    const i = this.idx;
    let n = this.icount;
    if (!flip) {
      i[n++] = b; i[n++] = b + 1; i[n++] = b + 2;
      i[n++] = b; i[n++] = b + 2; i[n++] = b + 3;
    } else {
      i[n++] = b + 1; i[n++] = b + 2; i[n++] = b + 3;
      i[n++] = b + 1; i[n++] = b + 3; i[n++] = b;
    }
    this.icount = n;
  }

  /** Copy out trimmed arrays (the buffer itself is reused between chunks). */
  export(): MeshArrays | null {
    if (this.icount === 0) return null;
    return {
      pos: this.pos.slice(0, this.vcount * 3),
      uv: this.uv.slice(0, this.vcount * 2),
      light: this.light.slice(0, this.vcount * 4),
      tint: this.tint.slice(0, this.vcount * 4),
      idx: this.vcount > 65535 ? this.idx.slice(0, this.icount) : Uint16Array.from(this.idx.subarray(0, this.icount)),
      vertexCount: this.vcount,
    };
  }
}

export interface MeshArrays {
  pos: Float32Array;
  uv: Float32Array;
  light: Uint8Array;
  tint: Uint8Array;
  idx: Uint32Array | Uint16Array;
  vertexCount: number;
}

export interface ChunkMeshData {
  opaque: MeshArrays | null;
  cutout: MeshArrays | null;
  translucent: MeshArrays | null;
  water: MeshArrays | null;
  lava: MeshArrays | null;
  faces: number;
}

export interface MesherOptions {
  fancyLeaves: boolean;
  smoothLighting: boolean;
}

// ---------------------------------------------------------------------------
// Padded neighbourhood copy
// ---------------------------------------------------------------------------
const PW = 18;
const PH = WORLD_HEIGHT + 2;
const SX = 1;
const SZ = PW;
const SY = PW * PW;
const pBlocks = new Uint8Array(PW * PW * PH);
const pMeta = new Uint8Array(PW * PW * PH);
const pLight = new Uint8Array(PW * PW * PH);
const pBiome = new Uint8Array(PW * PW);

const pidx = (x: number, y: number, z: number) => (y + 1) * SY + (z + 1) * SZ + (x + 1);

function gatherNeighborhood(dim: Dimension, chunk: Chunk): void {
  const skyDefault = dim.hasSky ? 0xf0 : 0;
  pBlocks.fill(0);
  pMeta.fill(0);
  pLight.fill(skyDefault);
  // Bottom padding is treated as solid so y=0 bottoms are culled.
  for (let i = 0; i < SY; i++) pBlocks[i] = BlockId.BEDROCK;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const c = dx === 0 && dz === 0 ? chunk : dim.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!c) continue;
      const x0 = dx < 0 ? 15 : 0;
      const x1 = dx > 0 ? 0 : 15;
      const z0 = dz < 0 ? 15 : 0;
      const z1 = dz > 0 ? 0 : 15;
      const ox = dx * 16;
      const oz = dz * 16;
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) pBiome[(ox + x + 1) + (oz + z + 1) * SZ] = c.biomes[x | (z << 4)];
        for (let y = 0; y < WORLD_HEIGHT; y++) {
          const src = blockIndex(x0, y, z);
          const dst = pidx(ox + x0, y, oz + z);
          const len = x1 - x0 + 1;
          if (len === 16) {
            pBlocks.set(c.blocks.subarray(src, src + 16), dst);
            pMeta.set(c.meta.subarray(src, src + 16), dst);
            pLight.set(c.light.subarray(src, src + 16), dst);
          } else {
            pBlocks[dst] = c.blocks[src];
            pMeta[dst] = c.meta[src];
            pLight[dst] = c.light[src];
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Face tables
// ---------------------------------------------------------------------------
// Corner positions for each face in (bl, br, tr, tl) order, CCW from outside.
const FACE_CORNERS: number[][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], // east
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], // west
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], // up
  [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]], // down
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], // south
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], // north
];
const FACE_NORMAL: number[][] = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];
const AO_CURVE = [0.5, 0.68, 0.84, 1.0];

/** Texture-space (u, v) of a local point on a face, v = 0 at the top. */
function faceUV(face: number, x: number, y: number, z: number): [number, number] {
  switch (face) {
    case 0: return [1 - z, 1 - y];
    case 1: return [z, 1 - y];
    case 2: return [x, z];
    case 3: return [1 - x, z];
    case 4: return [x, 1 - y];
    default: return [1 - x, 1 - y];
  }
}

// Precomputed padded-index offsets for smooth lighting: [face][corner] -> [side1, side2, corner].
const AO_OFFSETS: Int32Array[] = [];
{
  const stride = [SX, SY, SZ];
  for (let f = 0; f < 6; f++) {
    const n = FACE_NORMAL[f];
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const others = [0, 1, 2].filter((a) => a !== axis);
    const arr = new Int32Array(12);
    for (let c = 0; c < 4; c++) {
      const p = FACE_CORNERS[f][c];
      const dA = p[others[0]] === 1 ? 1 : -1;
      const dB = p[others[1]] === 1 ? 1 : -1;
      const s1 = dA * stride[others[0]];
      const s2 = dB * stride[others[1]];
      arr[c * 3] = s1;
      arr[c * 3 + 1] = s2;
      arr[c * 3 + 2] = s1 + s2;
    }
    AO_OFFSETS.push(arr);
  }
}
const NORMAL_OFFSET = [SX, -SX, SY, -SY, SZ, -SZ];

// ---------------------------------------------------------------------------
// Culling
// ---------------------------------------------------------------------------
const SELF_CULL = new Uint8Array(256);
for (const id of [BlockId.GLASS, BlockId.ICE, BlockId.NETHER_PORTAL, BlockId.WATER, BlockId.WATER_FLOWING, BlockId.LAVA, BlockId.LAVA_FLOWING]) SELF_CULL[id] = 1;

function faceVisible(id: number, neighbor: number, fancyLeaves: boolean): boolean {
  if (SOLID[neighbor]) return false;
  if (neighbor === id && SELF_CULL[id]) return false;
  if (neighbor === id && id === BlockId.LEAVES && !fancyLeaves) return false;
  if (!fancyLeaves && id === BlockId.LEAVES && neighbor === BlockId.LEAVES) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Mesher
// ---------------------------------------------------------------------------
export class ChunkMesher {
  private readonly opaque = new MeshBuffer(4096);
  private readonly cutout = new MeshBuffer(1024);
  private readonly translucent = new MeshBuffer(256);
  private readonly water = new MeshBuffer(1024);
  private readonly lava = new MeshBuffer(256);
  private faceTiles: Uint16Array;
  private leafOpaqueTiles: number[];
  private leafTiles: number[];
  private grassSideTile: number;
  private grassSnowTile: number;
  private options: MesherOptions = { fancyLeaves: true, smoothLighting: true };
  faces = 0;

  constructor() {
    const atlas = buildBlockAtlas();
    this.faceTiles = atlas.faceTiles;
    this.leafOpaqueTiles = ['oak', 'spruce', 'birch'].map((k) => tileOf(`leaves_${k}_opaque`));
    this.leafTiles = ['oak', 'spruce', 'birch'].map((k) => tileOf(`leaves_${k}`));
    this.grassSideTile = tileOf('grass_side');
    this.grassSnowTile = tileOf('grass_side_snow');
  }

  setOptions(o: MesherOptions): void {
    this.options = o;
  }

  build(dim: Dimension, chunk: Chunk): ChunkMeshData {
    gatherNeighborhood(dim, chunk);
    this.opaque.reset();
    this.cutout.reset();
    this.translucent.reset();
    this.water.reset();
    this.lava.reset();
    this.faces = 0;
    const mask = chunk.sectionMask;
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      if (!(mask & (1 << (y >> 4)))) {
        y = ((y >> 4) << 4) + 15;
        continue;
      }
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const i = pidx(x, y, z);
          const id = pBlocks[i];
          if (id === 0) continue;
          this.emitBlock(id, pMeta[i], x, y, z, i);
        }
      }
    }
    return {
      opaque: this.opaque.export(),
      cutout: this.cutout.export(),
      translucent: this.translucent.export(),
      water: this.water.export(),
      lava: this.lava.export(),
      faces: this.faces,
    };
  }

  private tint(def: BlockDefinition, id: number, meta: number, x: number, z: number): [number, number, number] {
    switch (def.tint) {
      case 'grass': return this.biomeColor(GRASS_RGB, x, z);
      case 'foliage':
        if (id === BlockId.LEAVES) {
          const kind = meta & 3;
          if (kind === 1) return [97, 153, 97];
          if (kind === 2) return [128, 167, 85];
        }
        if (id === BlockId.LILY_PAD) return [32, 128, 48];
        return this.biomeColor(FOLIAGE_RGB, x, z);
      default: return [255, 255, 255];
    }
  }

  /** 3x3 averaged biome colour for smooth transitions. */
  private biomeColor(table: Uint8Array, x: number, z: number): [number, number, number] {
    let r = 0; let g = 0; let b = 0;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const bio = pBiome[(x + dx + 1) + (z + dz + 1) * SZ] * 3;
        r += table[bio]; g += table[bio + 1]; b += table[bio + 2];
      }
    }
    return [r / 9, g / 9, b / 9];
  }

  private bufferFor(def: BlockDefinition, id: number): MeshBuffer {
    if (id === BlockId.LEAVES) return this.options.fancyLeaves ? this.cutout : this.opaque;
    if (def.pass === 'cutout') return this.cutout;
    if (def.pass === 'translucent') return this.translucent;
    return this.opaque;
  }

  private emitBlock(id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const def = getBlock(id);
    switch (def.shape) {
      case 'none':
        return;
      case 'cube':
        this.emitCube(def, id, meta, x, y, z, i);
        return;
      case 'cross':
        this.emitCross(def, id, meta, x, y, z, i, 1);
        return;
      case 'crop':
        this.emitCrop(def, id, meta, x, y, z, i);
        return;
      case 'fire':
        this.emitFire(id, meta, x, y, z, i);
        return;
      case 'stem':
        this.emitCross(def, id, meta, x, y, z, i, Math.min(1, (meta + 1) / 8));
        return;
      case 'fluid':
        this.emitFluid(def, id, meta, x, y, z, i);
        return;
      case 'flat':
        if (id === BlockId.RAIL || id === BlockId.POWERED_RAIL || id === BlockId.DETECTOR_RAIL) {
          this.emitRail(def, id, meta, x, y, z, i);
          return;
        }
        break;
      case 'wire':
        this.emitWire(id, meta, x, y, z, i);
        return;
      case 'lily':
        this.emitLily(def, id, meta, x, y, z, i);
        return;
      case 'portal':
        this.emitPortal(id, meta, x, y, z, i);
        return;
      default:
        break;
    }
    const neighbor = (dx: number, dy: number, dz: number) => pBlocks[i + dx * SX + dy * SY + dz * SZ];
    const boxes = blockBoxes(id, meta, neighbor);
    for (const b of boxes) this.emitBox(def, id, meta, x, y, z, i, b);
  }

  // --- Full cubes with smooth lighting + AO ----------------------------------
  private emitCube(def: BlockDefinition, id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const fancy = this.options.fancyLeaves;
    const buf = this.bufferFor(def, id);
    const tileBase = ((id << 4) | (meta & 15)) * 6;
    let tint: [number, number, number] | null = null;
    for (let f = 0; f < 6; f++) {
      const ni = i + NORMAL_OFFSET[f];
      const nb = pBlocks[ni];
      if (!faceVisible(id, nb, fancy)) continue;
      let tile = this.faceTiles[tileBase + f];
      if (id === BlockId.LEAVES) tile = fancy ? this.leafTiles[meta & 3] : this.leafOpaqueTiles[meta & 3];
      let r = 255; let g = 255; let bl = 255;
      if (def.tint !== 'none') {
        if (id === BlockId.GRASS && f !== 2 && f !== 3) {
          const up = pBlocks[i + SY];
          if (up === BlockId.SNOW_LAYER || up === BlockId.SNOW_BLOCK) tile = this.grassSnowTile;
        }
        if (!tint) tint = this.tint(def, id, meta, x, z);
        [r, g, bl] = tint;
      }
      this.emitCubeFace(buf, f, x, y, z, ni, tile, r, g, bl);
    }
  }

  private emitCubeFace(buf: MeshBuffer, f: number, x: number, y: number, z: number, ni: number, tile: number, r: number, g: number, b: number): void {
    const [u0, v0, u1, v1] = tileUV(tile);
    const corners = FACE_CORNERS[f];
    const offs = AO_OFFSETS[f];
    const smooth = this.options.smoothLighting;
    const faceShade = FACE_SHADE[f];
    const baseLight = pLight[ni];
    let ao0 = 3; let ao1 = 3; let ao2 = 3; let ao3 = 3;
    for (let c = 0; c < 4; c++) {
      const p = corners[c];
      let sky = baseLight >> 4;
      let blk = baseLight & 15;
      let ao = 3;
      if (smooth) {
        const s1 = ni + offs[c * 3];
        const s2 = ni + offs[c * 3 + 1];
        const cc = ni + offs[c * 3 + 2];
        const o1 = SOLID[pBlocks[s1]];
        const o2 = SOLID[pBlocks[s2]];
        const oc = SOLID[pBlocks[cc]];
        ao = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
        let n = 1;
        if (!o1) { sky += pLight[s1] >> 4; blk += pLight[s1] & 15; n++; }
        if (!o2) { sky += pLight[s2] >> 4; blk += pLight[s2] & 15; n++; }
        if (!oc && !(o1 && o2)) { sky += pLight[cc] >> 4; blk += pLight[cc] & 15; n++; }
        sky /= n;
        blk /= n;
      }
      if (c === 0) ao0 = ao; else if (c === 1) ao1 = ao; else if (c === 2) ao2 = ao; else ao3 = ao;
      const [tu, tv] = faceUV(f, p[0], p[1], p[2]);
      buf.vertex(
        x + p[0], y + p[1], z + p[2],
        u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv,
        Math.round(sky * 17), Math.round(blk * 17), Math.round(faceShade * AO_CURVE[ao] * 255),
        r, g, b,
      );
    }
    buf.quad(ao0 + ao2 < ao1 + ao3);
    this.faces++;
  }

  // --- Generic boxes -------------------------------------------------------
  private emitBox(def: BlockDefinition, id: number, meta: number, x: number, y: number, z: number, i: number, b: RenderBox): void {
    const buf = this.bufferFor(def, id);
    const tileBase = ((id << 4) | (meta & 15)) * 6;
    const tint = def.tint !== 'none' ? this.tint(def, id, meta, x, z) : null;
    const own = pLight[i];
    for (let f = 0; f < 6; f++) {
      if (b.faces !== undefined && !(b.faces & (1 << f))) continue;
      // Cull faces flush with the block boundary against solid neighbours.
      const onBoundary =
        (f === 0 && b.maxX >= 1) || (f === 1 && b.minX <= 0) || (f === 2 && b.maxY >= 1) ||
        (f === 3 && b.minY <= 0) || (f === 4 && b.maxZ >= 1) || (f === 5 && b.minZ <= 0);
      let lightVal = own;
      if (onBoundary) {
        const nb = pBlocks[i + NORMAL_OFFSET[f]];
        if (SOLID[nb]) continue;
        lightVal = pLight[i + NORMAL_OFFSET[f]];
      }
      if (SOLID[pBlocks[i]] === 0 && (lightVal >> 4) === 0 && (lightVal & 15) === 0) lightVal = own;
      const tile = b.tiles?.[f] ?? this.faceTiles[tileBase + f];
      const [u0, v0, u1, v1] = tileUV(tile);
      const corners = FACE_CORNERS[f];
      const shade = Math.round(FACE_SHADE[f] * 255);
      const r = tint ? tint[0] : 255;
      const g = tint ? tint[1] : 255;
      const bl = tint ? tint[2] : 255;
      for (let c = 0; c < 4; c++) {
        const p = corners[c];
        const px = p[0] ? b.maxX : b.minX;
        const py = p[1] ? b.maxY : b.minY;
        const pz = p[2] ? b.maxZ : b.minZ;
        let [tu, tv] = faceUV(f, px, py, pz);
        if (f === 2 && b.topRotation) [tu, tv] = rotateUV(tu, tv, b.topRotation);
        tu = tu < 0 ? 0 : tu > 1 ? 1 : tu;
        tv = tv < 0 ? 0 : tv > 1 ? 1 : tv;
        buf.vertex(x + px, y + py, z + pz, u0 + (u1 - u0) * tu, v0 + (v1 - v0) * tv,
          (lightVal >> 4) * 17, (lightVal & 15) * 17, shade, r, g, bl);
      }
      buf.quad(false);
      this.faces++;
    }
  }

  // --- Plants ----------------------------------------------------------------
  private emitCross(def: BlockDefinition, id: number, meta: number, x: number, y: number, z: number, i: number, height: number): void {
    const buf = this.cutout;
    const tile = this.faceTiles[((id << 4) | (meta & 15)) * 6];
    const [u0, v0, u1, v1] = tileUV(tile);
    let [r, g, b] = def.tint !== 'none' ? this.tint(def, id, meta, x, z) : [255, 255, 255];
    if (def.shape === 'stem') {
      const t = Math.min(1, meta / 7);
      r = 80 + 140 * t; g = 180 - 40 * t; b = 40;
    }
    const l = pLight[i];
    const sky = (l >> 4) * 17;
    const blk = (l & 15) * 17;
    // Slight deterministic jitter so fields of grass are not perfectly aligned.
    const h = ((x * 3129871) ^ (z * 116129781) ^ y) & 0xff;
    const jx = def.shape === 'cross' && id !== BlockId.SAPLING ? ((h & 15) / 15 - 0.5) * 0.3 : 0;
    const jz = def.shape === 'cross' && id !== BlockId.SAPLING ? (((h >> 4) & 15) / 15 - 0.5) * 0.3 : 0;
    const vTop = v0 + (v1 - v0) * (1 - height);
    const quads: [number, number, number, number][] = [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]];
    for (const [ax, az, bx, bz] of quads) {
      buf.vertex(x + ax + jx, y, z + az + jz, u0, v1, sky, blk, 230, r, g, b);
      buf.vertex(x + bx + jx, y, z + bz + jz, u1, v1, sky, blk, 230, r, g, b);
      buf.vertex(x + bx + jx, y + height, z + bz + jz, u1, vTop, sky, blk, 230, r, g, b);
      buf.vertex(x + ax + jx, y + height, z + az + jz, u0, vTop, sky, blk, 230, r, g, b);
      buf.quad(false);
      this.faces++;
    }
  }

  private emitCrop(def: BlockDefinition, id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const buf = this.cutout;
    const tile = this.faceTiles[((id << 4) | (meta & 15)) * 6];
    const [u0, v0, u1, v1] = tileUV(tile);
    const l = pLight[i];
    const sky = (l >> 4) * 17;
    const blk = (l & 15) * 17;
    const yb = y - 1 / 16;
    for (const off of [0.25, 0.75]) {
      // Two quads along X and two along Z (the classic '#' pattern).
      buf.vertex(x, yb, z + off, u0, v1, sky, blk, 220, 255, 255, 255);
      buf.vertex(x + 1, yb, z + off, u1, v1, sky, blk, 220, 255, 255, 255);
      buf.vertex(x + 1, yb + 1, z + off, u1, v0, sky, blk, 220, 255, 255, 255);
      buf.vertex(x, yb + 1, z + off, u0, v0, sky, blk, 220, 255, 255, 255);
      buf.quad(false);
      buf.vertex(x + off, yb, z + 1, u0, v1, sky, blk, 220, 255, 255, 255);
      buf.vertex(x + off, yb, z, u1, v1, sky, blk, 220, 255, 255, 255);
      buf.vertex(x + off, yb + 1, z, u1, v0, sky, blk, 220, 255, 255, 255);
      buf.vertex(x + off, yb + 1, z + 1, u0, v0, sky, blk, 220, 255, 255, 255);
      buf.quad(false);
      this.faces += 2;
    }
  }

  private emitFire(id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const buf = this.cutout;
    const tile = this.faceTiles[(id << 4) * 6];
    const [u0, v0, u1, v1] = tileUV(tile);
    const sky = 255;
    const blk = 255;
    const h = 1.4;
    // Four slanted planes leaning inward, like a campfire tent of flames.
    const planes: [number, number, number, number, number, number, number, number][] = [
      [0.1, 0, 0.1, 1, 0.3, 0, 0.3, 1], [0.9, 0, 0.9, 1, 0.7, 0, 0.7, 1],
      [0, 0.1, 1, 0.1, 0, 0.3, 1, 0.3], [0, 0.9, 1, 0.9, 0, 0.7, 1, 0.7],
    ];
    for (const [ax, az, bx, bz, tx0, tz0, tx1, tz1] of planes) {
      buf.vertex(x + ax, y, z + az, u0, v1, sky, blk, 255, 255, 255, 255);
      buf.vertex(x + bx, y, z + bz, u1, v1, sky, blk, 255, 255, 255, 255);
      buf.vertex(x + tx1, y + h, z + tz1, u1, v0, sky, blk, 255, 255, 255, 255);
      buf.vertex(x + tx0, y + h, z + tz0, u0, v0, sky, blk, 255, 255, 255, 255);
      buf.quad(false);
      this.faces++;
    }
    void meta; void i;
  }

  private emitLily(def: BlockDefinition, id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const tile = this.faceTiles[(id << 4) * 6 + 2];
    const [u0, v0, u1, v1] = tileUV(tile);
    const l = pLight[i];
    const [r, g, b] = this.tint(def, id, meta, x, z);
    const rot = ((x * 31 + z * 17) & 3);
    const uvs: [number, number][] = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    const yy = y + 0.015;
    const pts: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
    for (let c = 0; c < 4; c++) {
      const [uu, vv] = uvs[(c + rot) & 3];
      this.cutout.vertex(x + pts[c][0], yy, z + pts[c][1], uu, vv, (l >> 4) * 17, (l & 15) * 17, 255, r, g, b);
    }
    this.cutout.quad(false);
    this.faces++;
  }

  private emitWire(id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const tile = this.faceTiles[(id << 4) * 6 + 2];
    const [u0, v0, u1, v1] = tileUV(tile);
    const l = pLight[i];
    const power = meta & 15;
    const r = 80 + power * 11;
    const yy = y + 0.02;
    const pts: [number, number, number, number][] = [[0, 1, u0, v1], [1, 1, u1, v1], [1, 0, u1, v0], [0, 0, u0, v0]];
    for (const [px, pz, uu, vv] of pts) this.cutout.vertex(x + px, yy, z + pz, uu, vv, (l >> 4) * 17, Math.max(l & 15, power > 0 ? 5 : 0) * 17, 255, r, 30, 30);
    this.cutout.quad(false);
    this.faces++;
  }

  private emitRail(def: BlockDefinition, id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const shapeMeta = id === BlockId.RAIL ? meta : meta & 7;
    const tile = this.faceTiles[((id << 4) | (meta & 15)) * 6 + 2];
    const [u0, v0, u1, v1] = tileUV(tile);
    const l = pLight[i];
    const sky = (l >> 4) * 17;
    const blk = (l & 15) * 17;
    // Heights of the four corners (sw, se, ne, nw) for ascending rails.
    let hs = [0, 0, 0, 0];
    let rot = 0;
    switch (shapeMeta) {
      case 1: rot = 1; break;
      case 2: hs = [0, 1, 1, 0]; rot = 1; break; // ascending +X
      case 3: hs = [1, 0, 0, 1]; rot = 1; break;
      case 4: hs = [0, 0, 1, 1]; break; // ascending -Z
      case 5: hs = [1, 1, 0, 0]; break;
      case 6: rot = 0; break;
      case 7: rot = 1; break;
      case 8: rot = 2; break;
      case 9: rot = 3; break;
      default: break;
    }
    const yy = y + 1 / 16;
    const pts: [number, number][] = [[0, 1], [1, 1], [1, 0], [0, 0]];
    const uvs: [number, number][] = [[u0, v1], [u1, v1], [u1, v0], [u0, v0]];
    for (let c = 0; c < 4; c++) {
      const [uu, vv] = uvs[(c + rot) & 3];
      this.cutout.vertex(x + pts[c][0], yy + hs[c], z + pts[c][1], uu, vv, sky, blk, 255, 255, 255, 255);
    }
    this.cutout.quad(false);
    this.faces++;
    void def;
  }

  private emitPortal(id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const b: RenderBox = meta === 0
      ? { minX: 0, minY: 0, minZ: 0.375, maxX: 1, maxY: 1, maxZ: 0.625 }
      : { minX: 0.375, minY: 0, minZ: 0, maxX: 0.625, maxY: 1, maxZ: 1 };
    // Skip faces touching neighbouring portal blocks.
    let faces = 63;
    if (pBlocks[i + SX] === id) faces &= ~1;
    if (pBlocks[i - SX] === id) faces &= ~2;
    if (pBlocks[i + SY] === id) faces &= ~4;
    if (pBlocks[i - SY] === id) faces &= ~8;
    if (pBlocks[i + SZ] === id) faces &= ~16;
    if (pBlocks[i - SZ] === id) faces &= ~32;
    b.faces = faces;
    this.emitBox(getBlock(id), id, meta, x, y, z, i, b);
  }

  // --- Fluids ------------------------------------------------------------------
  private fluidHeight(i: number, kind: number): number {
    const id = pBlocks[i];
    if (IS_FLUID[id] !== kind) return -1;
    if (IS_FLUID[pBlocks[i + SY]] === kind) return 1;
    const m = pMeta[i];
    if (m >= 8) return 1;
    return 1 - (m + 1) / 9;
  }

  private cornerHeight(i: number, kind: number, dx: number, dz: number): number {
    // Average of the four columns sharing this corner.
    let sum = 0;
    let n = 0;
    for (const [ox, oz] of [[0, 0], [dx, 0], [0, dz], [dx, dz]]) {
      const j = i + ox * SX + oz * SZ;
      if (IS_FLUID[pBlocks[j + SY]] === kind) return 1;
      const h = this.fluidHeight(j, kind);
      if (h >= 0) { sum += h; n++; } else if (!SOLID[pBlocks[j]]) { n++; }
    }
    return n > 0 ? sum / n : 0;
  }

  private emitFluid(def: BlockDefinition, id: number, meta: number, x: number, y: number, z: number, i: number): void {
    const kind = IS_FLUID[id];
    const buf = kind === 1 ? this.water : this.lava;
    const above = pBlocks[i + SY];
    const coveredTop = IS_FLUID[above] === kind;
    const hSW = coveredTop ? 1 : this.cornerHeight(i, kind, -1, 1);
    const hSE = coveredTop ? 1 : this.cornerHeight(i, kind, 1, 1);
    const hNE = coveredTop ? 1 : this.cornerHeight(i, kind, 1, -1);
    const hNW = coveredTop ? 1 : this.cornerHeight(i, kind, -1, -1);
    const l = kind === 2 ? 0xff : pLight[i + SY];
    const sky = (l >> 4) * 17;
    const blk = (l & 15) * 17;
    const [r, g, b] = [255, 255, 255];
    // Top
    if (!coveredTop && !SOLID[above]) {
      const lt = pLight[i + SY];
      const s2 = (lt >> 4) * 17;
      const b2 = kind === 2 ? 255 : (lt & 15) * 17;
      buf.vertex(x, y + hSW, z + 1, x, z + 1, s2, b2, 255, r, g, b);
      buf.vertex(x + 1, y + hSE, z + 1, x + 1, z + 1, s2, b2, 255, r, g, b);
      buf.vertex(x + 1, y + hNE, z, x + 1, z, s2, b2, 255, r, g, b);
      buf.vertex(x, y + hNW, z, x, z, s2, b2, 255, r, g, b);
      buf.quad(false);
      // Underside of the surface so it is visible from below the water.
      if (kind === 1) {
        buf.vertex(x, y + hNW, z, x, z, s2, b2, 200, r, g, b);
        buf.vertex(x + 1, y + hNE, z, x + 1, z, s2, b2, 200, r, g, b);
        buf.vertex(x + 1, y + hSE, z + 1, x + 1, z + 1, s2, b2, 200, r, g, b);
        buf.vertex(x, y + hSW, z + 1, x, z + 1, s2, b2, 200, r, g, b);
        buf.quad(false);
      }
      this.faces++;
    }
    // Bottom
    const below = pBlocks[i - SY];
    if (IS_FLUID[below] !== kind && !SOLID[below]) {
      buf.vertex(x + 1, y, z + 1, x + 1, z + 1, sky, blk, 128, r, g, b);
      buf.vertex(x, y, z + 1, x, z + 1, sky, blk, 128, r, g, b);
      buf.vertex(x, y, z, x, z, sky, blk, 128, r, g, b);
      buf.vertex(x + 1, y, z, x + 1, z, sky, blk, 128, r, g, b);
      buf.quad(false);
      this.faces++;
    }
    // Sides: (face, neighbour offset, corner heights bl->br order)
    const sides: [number, number, number[], number, number][] = [
      [0, SX, [1, 1, 1, 0], hSE, hNE],
      [1, -SX, [0, 0, 0, 1], hNW, hSW],
      [4, SZ, [0, 1, 1, 1], hSW, hSE],
      [5, -SZ, [1, 0, 0, 0], hNE, hNW],
    ];
    for (const [f, off, _c, hA, hB] of sides) {
      const nb = pBlocks[i + off];
      if (IS_FLUID[nb] === kind || SOLID[nb]) continue;
      const ln = pLight[i + off];
      const s3 = (ln >> 4) * 17;
      const b3 = kind === 2 ? 255 : (ln & 15) * 17;
      const shade = Math.round(FACE_SHADE[f] * 255);
      const corners = FACE_CORNERS[f];
      const heights = [0, 0, hB, hA];
      // corner order bl, br, tr, tl; top heights depend on which corner.
      for (let c = 0; c < 4; c++) {
        const p = corners[c];
        const py = p[1] ? heights[c] : 0;
        const along = f === 0 || f === 1 ? p[2] : p[0];
        buf.vertex(x + p[0], y + py, z + p[2], along + (f === 0 || f === 1 ? x : z), y + py, s3, b3, shade, r, g, b);
      }
      buf.quad(false);
      this.faces++;
    }
    void def; void meta;
  }
}

function rotateUV(u: number, v: number, quarterTurns: number): [number, number] {
  switch (quarterTurns & 3) {
    case 1: return [1 - v, u];
    case 2: return [1 - u, 1 - v];
    case 3: return [v, 1 - u];
    default: return [u, v];
  }
}

/**
 * 3D geometry for items: extruded pixel sprites (like classic held items) and
 * miniature blocks. Geometry is cached per icon.
 */

import * as THREE from 'three';
import { buildBlockAtlas, tileUV } from './tiles';
import { blockBoxes } from './shapes';
import { getBlock } from '../blocks/registry';
import { BlockId } from '../blocks/ids';
import { iconFor, itemAtlas, ITEM_ATLAS_TILES } from './itematlas';
import type { PixelTile } from './pixel';
import { paintBlockTexture } from './blocktextures';

const cache = new Map<string, THREE.BufferGeometry>();

const FACE_SHADE = [0.6, 0.6, 1.0, 0.5, 0.8, 0.8];

/** Extrude a 16x16 sprite into a 1/16-thick slab with per-pixel side walls. */
function extrudeSprite(tile: PixelTile, u0: number, v0: number, du: number, dv: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const t = 1 / 16;
  const quad = (p: number[][], uvs: number[][], shade: number) => {
    const b = pos.length / 3;
    for (let i = 0; i < 4; i++) {
      pos.push(p[i][0], p[i][1], p[i][2]);
      uv.push(uvs[i][0], uvs[i][1]);
      col.push(shade, shade, shade);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  // Front and back faces cover the whole sprite; alpha test cuts the shape.
  const U = (x: number) => u0 + (x / 16) * du;
  const V = (y: number) => v0 + (y / 16) * dv;
  quad([[0, 0, t / 2], [1, 0, t / 2], [1, 1, t / 2], [0, 1, t / 2]], [[U(0), V(16)], [U(16), V(16)], [U(16), V(0)], [U(0), V(0)]], 1);
  quad([[1, 0, -t / 2], [0, 0, -t / 2], [0, 1, -t / 2], [1, 1, -t / 2]], [[U(16), V(16)], [U(0), V(16)], [U(0), V(0)], [U(16), V(0)]], 0.8);
  const opaque = (x: number, y: number) => x >= 0 && y >= 0 && x < 16 && y < 16 && tile.alpha(x, y) > 0;
  for (let py = 0; py < 16; py++) {
    for (let px = 0; px < 16; px++) {
      if (!opaque(px, py)) continue;
      const x0 = px / 16; const x1 = (px + 1) / 16;
      const y0 = 1 - (py + 1) / 16; const y1 = 1 - py / 16;
      const cu = U(px + 0.5); const cv = V(py + 0.5);
      const c = [[cu, cv], [cu, cv], [cu, cv], [cu, cv]];
      if (!opaque(px - 1, py)) quad([[x0, y0, -t / 2], [x0, y0, t / 2], [x0, y1, t / 2], [x0, y1, -t / 2]], c, 0.7);
      if (!opaque(px + 1, py)) quad([[x1, y0, t / 2], [x1, y0, -t / 2], [x1, y1, -t / 2], [x1, y1, t / 2]], c, 0.7);
      if (!opaque(px, py - 1)) quad([[x0, y1, t / 2], [x1, y1, t / 2], [x1, y1, -t / 2], [x0, y1, -t / 2]], c, 0.9);
      if (!opaque(px, py + 1)) quad([[x0, y0, -t / 2], [x1, y0, -t / 2], [x1, y0, t / 2], [x0, y0, t / 2]], c, 0.55);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.translate(-0.5, -0.5, 0);
  return g;
}

/** Mini block geometry from the block's render boxes, centred on the origin. */
function blockGeometry(id: number, meta: number): THREE.BufferGeometry {
  const atlas = buildBlockAtlas();
  const def = getBlock(id);
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const corners = [
    [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
    [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], [[1, 0, 1], [0, 0, 1], [0, 0, 0], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  ];
  const faceUV = (f: number, x: number, y: number, z: number): [number, number] => {
    switch (f) {
      case 0: return [1 - z, 1 - y]; case 1: return [z, 1 - y]; case 2: return [x, z];
      case 3: return [1 - x, z]; case 4: return [x, 1 - y]; default: return [1 - x, 1 - y];
    }
  };
  let tint: [number, number, number] = [1, 1, 1];
  if (def.tint === 'grass') tint = [0.55, 0.78, 0.35];
  if (def.tint === 'foliage') tint = [0.4, 0.7, 0.25];
  const boxes = def.shape === 'cube' ? [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }] : blockBoxes(id, meta);
  for (const b of boxes) {
    for (let f = 0; f < 6; f++) {
      const bf = (b as { faces?: number }).faces;
      if (bf !== undefined && !(bf & (1 << f))) continue;
      const tiles = (b as { tiles?: (number | undefined)[] }).tiles;
      const tile = tiles?.[f] ?? atlas.faceTiles[((id << 4) | (meta & 15)) * 6 + f];
      const [u0, v0, u1, v1] = tileUV(tile);
      const base = pos.length / 3;
      for (const p of corners[f]) {
        const px = p[0] ? b.maxX : b.minX;
        const py = p[1] ? b.maxY : b.minY;
        const pz = p[2] ? b.maxZ : b.minZ;
        pos.push(px - 0.5, py - 0.5, pz - 0.5);
        const [tu, tv] = faceUV(f, px, py, pz);
        uv.push(u0 + (u1 - u0) * Math.max(0, Math.min(1, tu)), v0 + (v1 - v0) * Math.max(0, Math.min(1, tv)));
        // Only tint the top of grass (the sides are masked in the terrain shader).
        const tintFace = def.tint !== 'none' && !(id === BlockId.GRASS && f !== 2);
        const s = FACE_SHADE[f];
        col.push(s * (tintFace ? tint[0] : 1), s * (tintFace ? tint[1] : 1), s * (tintFace ? tint[2] : 1));
      }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

/** Geometry for an item plus whether it uses the block atlas. */
export function itemGeometry(id: number, meta: number): { geometry: THREE.BufferGeometry; blockAtlas: boolean; cube: boolean } {
  const icon = iconFor(id, meta);
  if (icon.kind === 'block') {
    const key = `b:${icon.id}:${icon.meta & 15}`;
    let g = cache.get(key);
    if (!g) { g = blockGeometry(icon.id, icon.meta & 15); cache.set(key, g); }
    return { geometry: g, blockAtlas: true, cube: true };
  }
  if (icon.kind === 'blockflat') {
    const key = `f:${icon.id}:${icon.meta & 15}`;
    let g = cache.get(key);
    if (!g) {
      const atlasData = buildBlockAtlas();
      const tile = atlasData.faceTiles[((icon.id << 4) | (icon.meta & 15)) * 6 + 4];
      const [u0, v0, u1, v1] = tileUV(tile);
      const name = Array.from(atlasData.tileIndex.entries()).find(([, v]) => v === tile)?.[0] ?? 'missing';
      g = extrudeSprite(paintBlockTexture(name), u0, v0, u1 - u0, v1 - v0);
      cache.set(key, g);
    }
    return { geometry: g, blockAtlas: true, cube: false };
  }
  const key = `s:${icon.name}`;
  let g = cache.get(key);
  if (!g) {
    const a = itemAtlas();
    const i = a.index.get(icon.name) ?? 0;
    const tile = a.tiles.get(icon.name)!;
    const u0 = (i % ITEM_ATLAS_TILES) / ITEM_ATLAS_TILES;
    const v0 = Math.floor(i / ITEM_ATLAS_TILES) / ITEM_ATLAS_TILES;
    g = extrudeSprite(tile, u0, v0, 1 / ITEM_ATLAS_TILES, 1 / ITEM_ATLAS_TILES);
    cache.set(key, g);
  }
  return { geometry: g, blockAtlas: false, cube: false };
}

/**
 * Item icons for the DOM UI: isometric block renders and flat sprites, drawn
 * once into small canvases (32x32) and cached by item id + metadata.
 */

import { BlockId } from '../blocks/ids';
import { getBlock } from '../blocks/registry';
import { paintBlockTexture } from '../render/blocktextures';
import { paintItemSprite } from '../render/itemtextures';
import { iconFor } from '../render/itematlas';
import { buildBlockAtlas } from '../render/tiles';
import { blockBoxes } from '../render/shapes';
import type { PixelTile } from '../render/pixel';

const ICON = 32;
const cache = new Map<string, HTMLCanvasElement>();
const tileCanvases = new Map<string, HTMLCanvasElement>();
let tileNameByIndex: string[] | null = null;

function tileName(index: number): string {
  if (!tileNameByIndex) {
    tileNameByIndex = [];
    for (const [name, i] of buildBlockAtlas().tileIndex) tileNameByIndex[i] = name;
  }
  return tileNameByIndex[index] ?? 'missing';
}

function tileToCanvas(t: PixelTile, tint: [number, number, number] | null, shade: number, fullTint = false): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext('2d')!;
  const img = ctx.createImageData(16, 16);
  for (let i = 0; i < 256; i++) {
    const a = t.data[i * 4 + 3];
    const tinted = tint && (a === 128 || (fullTint && a > 0));
    const m = tinted ? tint! : [1, 1, 1];
    img.data[i * 4] = t.data[i * 4] * m[0] * shade;
    img.data[i * 4 + 1] = t.data[i * 4 + 1] * m[1] * shade;
    img.data[i * 4 + 2] = t.data[i * 4 + 2] * m[2] * shade;
    img.data[i * 4 + 3] = a === 128 ? 255 : a;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function faceCanvas(tile: number, tint: [number, number, number] | null, fullTint: boolean, shade: number): HTMLCanvasElement {
  const name = tileName(tile);
  const key = `${name}|${tint?.join(',') ?? ''}|${fullTint}|${shade}`;
  let c = tileCanvases.get(key);
  if (!c) {
    const t = paintBlockTexture(name);
    c = tileToCanvas(t, tint, shade, fullTint);
    tileCanvases.set(key, c);
  }
  return c;
}

const GRASS_TINT: [number, number, number] = [0.55, 0.78, 0.35];
const LEAF_TINT: [number, number, number] = [0.4, 0.68, 0.25];

function drawBlockIcon(ctx: CanvasRenderingContext2D, id: number, meta: number): void {
  const atlas = buildBlockAtlas();
  const def = getBlock(id);
  const tint = def.tint === 'grass' ? GRASS_TINT : def.tint === 'foliage' ? LEAF_TINT : null;
  const full = def.tint === 'foliage' || (def.tint === 'grass' && id !== BlockId.GRASS);
  const boxes = def.shape === 'cube' ? [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 }] : blockBoxes(id, meta);
  // Isometric projection of a unit cube into the 32px icon.
  const S = 13.5;
  const cx = 16;
  const cy = 16;
  const proj = (x: number, y: number, z: number): [number, number] => [
    cx + (x - z) * S * 0.866 * 1.06,
    cy + (x + z) * S * 0.5 * 1.06 - y * S * 1.13 - 0.5,
  ];
  // Draw boxes back to front.
  const sorted = [...boxes].sort((a, b) => (a.minX + a.minZ + a.minY) - (b.minX + b.minZ + b.minY));
  for (const b0 of sorted) {
    const b = { minX: b0.minX - 0.5, maxX: b0.maxX - 0.5, minY: b0.minY - 0.5, maxY: b0.maxY - 0.5, minZ: b0.minZ - 0.5, maxZ: b0.maxZ - 0.5 };
    const tiles = (b0 as { tiles?: (number | undefined)[] }).tiles;
    const tileFor = (f: number) => tiles?.[f] ?? atlas.faceTiles[((id << 4) | (meta & 15)) * 6 + f];
    // Faces visible from the icon view: top (+Y), south (+Z, left), east (+X, right).
    const faces: [number, number][] = [[4, 0.8], [0, 0.6], [2, 1.0]];
    for (const [f, shade] of faces) {
      const faceTint = f === 2 || full ? tint : (id === BlockId.GRASS ? tint : tint);
      const img = faceCanvas(tileFor(f), faceTint, full, shade);
      let o: [number, number]; let u: [number, number]; let v: [number, number];
      let sx = 0; let sy = 0; let sw = 16; let sh = 16;
      if (f === 2) {
        o = proj(b.minX, b.maxY, b.minZ); u = proj(b.maxX, b.maxY, b.minZ); v = proj(b.minX, b.maxY, b.maxZ);
        sx = (b.minX + 0.5) * 16; sy = (b.minZ + 0.5) * 16; sw = (b.maxX - b.minX) * 16; sh = (b.maxZ - b.minZ) * 16;
      } else if (f === 4) {
        o = proj(b.minX, b.maxY, b.maxZ); u = proj(b.maxX, b.maxY, b.maxZ); v = proj(b.minX, b.minY, b.maxZ);
        sx = (b.minX + 0.5) * 16; sy = (0.5 - b.maxY) * 16; sw = (b.maxX - b.minX) * 16; sh = (b.maxY - b.minY) * 16;
      } else {
        o = proj(b.maxX, b.maxY, b.maxZ); u = proj(b.maxX, b.maxY, b.minZ); v = proj(b.maxX, b.minY, b.maxZ);
        sx = (0.5 - b.maxZ) * 16; sy = (0.5 - b.maxY) * 16; sw = (b.maxZ - b.minZ) * 16; sh = (b.maxY - b.minY) * 16;
      }
      if (sw <= 0 || sh <= 0) continue;
      ctx.save();
      ctx.setTransform((u[0] - o[0]) / sw, (u[1] - o[1]) / sw, (v[0] - o[0]) / sh, (v[1] - o[1]) / sh, o[0], o[1]);
      ctx.drawImage(img, Math.max(0, sx), Math.max(0, sy), Math.min(16, sw), Math.min(16, sh), 0, 0, sw, sh);
      ctx.restore();
    }
  }
}

function drawSprite(ctx: CanvasRenderingContext2D, t: PixelTile, tint: [number, number, number] | null = null): void {
  const c = tileToCanvas(t, tint, 1);
  ctx.drawImage(c, 0, 0, 16, 16, 0, 0, ICON, ICON);
}

export function iconCanvas(id: number, meta: number): HTMLCanvasElement {
  const icon = iconFor(id, meta);
  const key = icon.kind === 'sprite' ? `s:${icon.name}` : `${icon.kind}:${icon.id}:${icon.meta & 15}`;
  let c = cache.get(key);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = ICON;
  c.height = ICON;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  if (icon.kind === 'sprite') {
    const t = paintItemSprite(icon.name) ?? paintItemSprite('stick')!;
    drawSprite(ctx, t);
  } else if (icon.kind === 'blockflat') {
    const atlas = buildBlockAtlas();
    const tile = atlas.faceTiles[((icon.id << 4) | (icon.meta & 15)) * 6 + 4];
    const def = getBlock(icon.id);
    const tint = def.tint === 'grass' ? GRASS_TINT : def.tint === 'foliage' ? LEAF_TINT : null;
    const t = paintBlockTexture(tileName(tile));
    drawSprite(ctx, t, tint);
    if (tint) {
      // Cutout plants are fully tinted.
      const img = ctx.getImageData(0, 0, ICON, ICON);
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] *= tint[0]; img.data[i + 1] *= tint[1]; img.data[i + 2] *= tint[2];
      }
      ctx.putImageData(img, 0, 0);
    }
  } else {
    drawBlockIcon(ctx, icon.id, icon.meta & 15);
  }
  cache.set(key, c);
  return c;
}

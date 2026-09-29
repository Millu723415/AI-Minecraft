/**
 * Texture atlas layout. Builds the raw RGBA pixel data for the block atlas and
 * the lookup table mapping (block id, meta, face) to an atlas tile. Pure data:
 * no DOM or WebGL so it can be unit tested and used by preview tooling.
 */

import { allBlocks } from '../blocks/registry';
import type { FaceTextures } from '../blocks/types';
import { blockTextureNames, paintBlockTexture } from './blocktextures';

export const ATLAS_TILES = 32; // tiles per row
export const TILE_PX = 16;
export const ATLAS_PX = ATLAS_TILES * TILE_PX; // 512

export interface BlockAtlas {
  pixels: Uint8Array;
  tileIndex: Map<string, number>;
  /** ((id << 4) | meta) * 6 + face -> tile index. */
  faceTiles: Uint16Array;
}

const FACE_KEYS: (keyof FaceTextures)[] = ['east', 'west', 'top', 'bottom', 'south', 'north'];

function resolveFace(tex: FaceTextures, face: number): string {
  const specific = tex[FACE_KEYS[face]];
  if (specific) return specific;
  if (face === 2 && tex.top) return tex.top;
  if (face === 3 && tex.bottom) return tex.bottom;
  if (face !== 2 && face !== 3 && tex.side) return tex.side;
  return tex.all ?? tex.side ?? tex.top ?? 'missing';
}

let cached: BlockAtlas | null = null;

export function buildBlockAtlas(): BlockAtlas {
  if (cached) return cached;
  const pixels = new Uint8Array(ATLAS_PX * ATLAS_PX * 4);
  const tileIndex = new Map<string, number>();
  const names = blockTextureNames();
  names.forEach((name, i) => {
    tileIndex.set(name, i);
    const tile = paintBlockTexture(name);
    const tx = (i % ATLAS_TILES) * TILE_PX;
    const ty = Math.floor(i / ATLAS_TILES) * TILE_PX;
    for (let y = 0; y < TILE_PX; y++) {
      for (let x = 0; x < TILE_PX; x++) {
        const si = (y * TILE_PX + x) * 4;
        const di = ((ty + y) * ATLAS_PX + tx + x) * 4;
        pixels[di] = tile.data[si];
        pixels[di + 1] = tile.data[si + 1];
        pixels[di + 2] = tile.data[si + 2];
        pixels[di + 3] = tile.data[si + 3];
      }
    }
  });
  const missing = tileIndex.get('missing') ?? 0;
  const faceTiles = new Uint16Array(256 * 16 * 6).fill(missing);
  for (const block of allBlocks()) {
    for (let meta = 0; meta < 16; meta++) {
      const tex = block.textures(meta);
      for (let face = 0; face < 6; face++) {
        const name = resolveFace(tex, face);
        faceTiles[((block.id << 4) | meta) * 6 + face] = tileIndex.get(name) ?? missing;
      }
    }
  }
  cached = { pixels, tileIndex, faceTiles };
  return cached;
}

export function tileOf(name: string): number {
  const atlas = buildBlockAtlas();
  return atlas.tileIndex.get(name) ?? atlas.tileIndex.get('missing') ?? 0;
}

/** Texture names referenced by blocks but not painted (used by tests). */
export function missingTextureNames(): string[] {
  const known = new Set(blockTextureNames());
  const missing = new Set<string>();
  for (const block of allBlocks()) {
    for (let meta = 0; meta < 16; meta++) {
      const tex = block.textures(meta);
      for (let face = 0; face < 6; face++) {
        const name = resolveFace(tex, face);
        if (!known.has(name)) missing.add(`${block.name}:${name}`);
      }
    }
  }
  return Array.from(missing);
}

/** UV rectangle for a tile: [u0, v0, u1, v1] where v0 is the top of the tile. */
export function tileUV(tile: number): [number, number, number, number] {
  const tx = tile % ATLAS_TILES;
  const ty = Math.floor(tile / ATLAS_TILES);
  return [tx / ATLAS_TILES, ty / ATLAS_TILES, (tx + 1) / ATLAS_TILES, (ty + 1) / ATLAS_TILES];
}

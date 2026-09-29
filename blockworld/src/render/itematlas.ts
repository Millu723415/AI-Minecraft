/**
 * Item sprite atlas (for 3D held/dropped items) and icon resolution for
 * every (item id, meta) pair.
 */

import * as THREE from 'three';
import { BlockId } from '../blocks/ids';
import { getBlock } from '../blocks/registry';
import { ItemId } from '../items/ids';
import { getItem } from '../items/registry';
import { itemSpriteNames, paintItemSprite } from './itemtextures';
import type { PixelTile } from './pixel';

export const ITEM_ATLAS_TILES = 16;
export const ITEM_ATLAS_PX = ITEM_ATLAS_TILES * 16;

export type IconRef =
  | { kind: 'sprite'; name: string }
  | { kind: 'block'; id: number; meta: number }
  | { kind: 'blockflat'; id: number; meta: number };

/** Resolve how an item should be drawn. */
export function iconFor(id: number, meta: number): IconRef {
  const def = getItem(id);
  if (!def) return { kind: 'sprite', name: 'stick' };
  if (id === ItemId.DYE) return { kind: 'sprite', name: `dye_${meta & 15}` };
  if (id === ItemId.POTION) return { kind: 'sprite', name: `potion_${Math.min(12, meta & 15)}${meta & 16384 ? '_splash' : ''}` };
  if (def.icon.startsWith('block:')) return { kind: 'block', id: Number(def.icon.slice(6)), meta };
  if (def.icon.startsWith('blockflat:')) return { kind: 'blockflat', id: Number(def.icon.slice(10)), meta };
  if (id === BlockId.FENCE || id === BlockId.NETHER_BRICK_FENCE) return { kind: 'block', id, meta };
  return { kind: 'sprite', name: def.icon };
}

let atlas: { tex: THREE.DataTexture; index: Map<string, number>; tiles: Map<string, PixelTile> } | null = null;

export function itemAtlas(): { tex: THREE.DataTexture; index: Map<string, number>; tiles: Map<string, PixelTile> } {
  if (atlas) return atlas;
  const pixels = new Uint8Array(ITEM_ATLAS_PX * ITEM_ATLAS_PX * 4);
  const index = new Map<string, number>();
  const tiles = new Map<string, PixelTile>();
  itemSpriteNames().forEach((name, i) => {
    const t = paintItemSprite(name)!;
    tiles.set(name, t);
    index.set(name, i);
    const tx = (i % ITEM_ATLAS_TILES) * 16;
    const ty = Math.floor(i / ITEM_ATLAS_TILES) * 16;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const si = (y * 16 + x) * 4;
      const di = ((ty + y) * ITEM_ATLAS_PX + tx + x) * 4;
      pixels[di] = t.data[si]; pixels[di + 1] = t.data[si + 1]; pixels[di + 2] = t.data[si + 2]; pixels[di + 3] = t.data[si + 3];
    }
  });
  const tex = new THREE.DataTexture(pixels, ITEM_ATLAS_PX, ITEM_ATLAS_PX, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.needsUpdate = true;
  atlas = { tex, index, tiles };
  return atlas;
}

/** Whether a block item should be shown as a 3D cube (held / dropped). */
export function renderAsCube(id: number): boolean {
  if (id >= 256) return false;
  const shape = getBlock(id).shape;
  return shape !== 'cross' && shape !== 'torch' && shape !== 'flat' && shape !== 'ladder' && shape !== 'pane' && shape !== 'lily' && shape !== 'wire';
}

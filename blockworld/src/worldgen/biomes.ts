/**
 * Biomes of the 2011 release era. Later biomes (jungle, badlands, savanna,
 * dark forest, beaches, hills variants...) are deliberately absent.
 */

import { BlockId } from '../blocks/ids';

export const Biome = {
  OCEAN: 0,
  PLAINS: 1,
  DESERT: 2,
  EXTREME_HILLS: 3,
  FOREST: 4,
  TAIGA: 5,
  SWAMPLAND: 6,
  RIVER: 7,
  HELL: 8,
  SKY: 9,
  FROZEN_OCEAN: 10,
  FROZEN_RIVER: 11,
  ICE_PLAINS: 12,
  ICE_MOUNTAINS: 13,
  MUSHROOM_ISLAND: 14,
  MUSHROOM_SHORE: 15,
} as const;

export interface BiomeDef {
  id: number;
  name: string;
  temperature: number;
  rainfall: number;
  /** Base terrain height offset relative to sea level (blocks). */
  baseHeight: number;
  /** Amplitude of terrain variation (blocks). */
  variation: number;
  top: number;
  filler: number;
  grass: [number, number, number];
  foliage: [number, number, number];
  water: [number, number, number];
  /** Trees per chunk (average). */
  trees: number;
  flowers: number;
  grassTufts: number;
  snowy: boolean;
  /** Surface water freezes into ice. */
  freezes: boolean;
  rain: boolean;
}

const B = (id: number, name: string, o: Omit<BiomeDef, 'id' | 'name'>): BiomeDef => ({ id, name, ...o });

const GREEN_WATER: [number, number, number] = [255, 255, 255];

export const BIOMES: BiomeDef[] = [];
const add = (b: BiomeDef): void => { BIOMES[b.id] = b; };

add(B(Biome.OCEAN, 'Ocean', { temperature: 0.5, rainfall: 0.5, baseHeight: -20, variation: 4, top: BlockId.GRAVEL, filler: BlockId.GRAVEL, grass: [142, 185, 113], foliage: [113, 167, 77], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: false, freezes: false, rain: true }));
add(B(Biome.PLAINS, 'Plains', { temperature: 0.8, rainfall: 0.4, baseHeight: 3, variation: 4, top: BlockId.GRASS, filler: BlockId.DIRT, grass: [145, 189, 89], foliage: [119, 171, 47], water: GREEN_WATER, trees: 0.05, flowers: 4, grassTufts: 12, snowy: false, freezes: false, rain: true }));
add(B(Biome.DESERT, 'Desert', { temperature: 2, rainfall: 0, baseHeight: 3, variation: 3, top: BlockId.SAND, filler: BlockId.SAND, grass: [191, 183, 85], foliage: [174, 164, 42], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: false, freezes: false, rain: false }));
add(B(Biome.EXTREME_HILLS, 'Extreme Hills', { temperature: 0.2, rainfall: 0.3, baseHeight: 14, variation: 30, top: BlockId.GRASS, filler: BlockId.DIRT, grass: [138, 182, 137], foliage: [109, 163, 107], water: GREEN_WATER, trees: 0.6, flowers: 1, grassTufts: 2, snowy: false, freezes: false, rain: true }));
add(B(Biome.FOREST, 'Forest', { temperature: 0.7, rainfall: 0.8, baseHeight: 4, variation: 7, top: BlockId.GRASS, filler: BlockId.DIRT, grass: [121, 192, 90], foliage: [89, 174, 48], water: GREEN_WATER, trees: 10, flowers: 2, grassTufts: 2, snowy: false, freezes: false, rain: true }));
add(B(Biome.TAIGA, 'Taiga', { temperature: 0.05, rainfall: 0.8, baseHeight: 4, variation: 8, top: BlockId.GRASS, filler: BlockId.DIRT, grass: [134, 183, 131], foliage: [104, 164, 100], water: GREEN_WATER, trees: 10, flowers: 0, grassTufts: 1, snowy: true, freezes: true, rain: true }));
add(B(Biome.SWAMPLAND, 'Swampland', { temperature: 0.8, rainfall: 0.9, baseHeight: -1, variation: 1.5, top: BlockId.GRASS, filler: BlockId.DIRT, grass: [106, 112, 57], foliage: [106, 112, 57], water: [200, 255, 170], trees: 2, flowers: 0, grassTufts: 3, snowy: false, freezes: false, rain: true }));
add(B(Biome.RIVER, 'River', { temperature: 0.5, rainfall: 0.5, baseHeight: -6, variation: 1, top: BlockId.SAND, filler: BlockId.DIRT, grass: [142, 185, 113], foliage: [113, 167, 77], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: false, freezes: false, rain: true }));
add(B(Biome.HELL, 'Hell', { temperature: 2, rainfall: 0, baseHeight: 0, variation: 0, top: BlockId.NETHERRACK, filler: BlockId.NETHERRACK, grass: [191, 183, 85], foliage: [174, 164, 42], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: false, freezes: false, rain: false }));
add(B(Biome.SKY, 'Sky', { temperature: 0.5, rainfall: 0, baseHeight: 0, variation: 0, top: BlockId.END_STONE, filler: BlockId.END_STONE, grass: [142, 185, 113], foliage: [113, 167, 77], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: false, freezes: false, rain: false }));
add(B(Biome.FROZEN_OCEAN, 'Frozen Ocean', { temperature: 0, rainfall: 0.5, baseHeight: -20, variation: 4, top: BlockId.GRAVEL, filler: BlockId.GRAVEL, grass: [128, 180, 151], foliage: [96, 161, 123], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: true, freezes: true, rain: true }));
add(B(Biome.FROZEN_RIVER, 'Frozen River', { temperature: 0, rainfall: 0.5, baseHeight: -6, variation: 1, top: BlockId.SAND, filler: BlockId.DIRT, grass: [128, 180, 151], foliage: [96, 161, 123], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: true, freezes: true, rain: true }));
add(B(Biome.ICE_PLAINS, 'Ice Plains', { temperature: 0, rainfall: 0.5, baseHeight: 3, variation: 4, top: BlockId.GRASS, filler: BlockId.DIRT, grass: [128, 180, 151], foliage: [96, 161, 123], water: GREEN_WATER, trees: 0.1, flowers: 0, grassTufts: 0, snowy: true, freezes: true, rain: true }));
add(B(Biome.ICE_MOUNTAINS, 'Ice Mountains', { temperature: 0, rainfall: 0.5, baseHeight: 12, variation: 22, top: BlockId.GRASS, filler: BlockId.DIRT, grass: [128, 180, 151], foliage: [96, 161, 123], water: GREEN_WATER, trees: 0.2, flowers: 0, grassTufts: 0, snowy: true, freezes: true, rain: true }));
add(B(Biome.MUSHROOM_ISLAND, 'Mushroom Island', { temperature: 0.9, rainfall: 1, baseHeight: 4, variation: 6, top: BlockId.MYCELIUM, filler: BlockId.DIRT, grass: [85, 201, 63], foliage: [43, 187, 15], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: false, freezes: false, rain: true }));
add(B(Biome.MUSHROOM_SHORE, 'Mushroom Island Shore', { temperature: 0.9, rainfall: 1, baseHeight: 0, variation: 1, top: BlockId.MYCELIUM, filler: BlockId.DIRT, grass: [85, 201, 63], foliage: [43, 187, 15], water: GREEN_WATER, trees: 0, flowers: 0, grassTufts: 0, snowy: false, freezes: false, rain: true }));

export function biomeDef(id: number): BiomeDef {
  return BIOMES[id] ?? BIOMES[Biome.PLAINS];
}

/** Precomputed RGB tables for fast mesher lookups. */
export const GRASS_RGB = new Uint8Array(256 * 3);
export const FOLIAGE_RGB = new Uint8Array(256 * 3);
for (let i = 0; i < 256; i++) {
  const b = biomeDef(i);
  GRASS_RGB.set(b.grass, i * 3);
  FOLIAGE_RGB.set(b.foliage, i * 3);
}

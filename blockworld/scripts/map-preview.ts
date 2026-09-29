/** Renders a top-down biome/height map of the overworld generator to PNG. */
import { OverworldGenerator } from '../src/worldgen/overworld';
import { Biome } from '../src/worldgen/biomes';
import { writePng } from './png';

const seed = Number(process.argv[3] ?? 12345);
const gen = new OverworldGenerator(seed);
const SIZE = 512;
const STEP = Number(process.argv[4] ?? 8);
const img = new Uint8Array(SIZE * SIZE * 4);
const colors: Record<number, [number, number, number]> = {
  [Biome.OCEAN]: [30, 60, 170], [Biome.PLAINS]: [140, 190, 90], [Biome.DESERT]: [230, 210, 140],
  [Biome.EXTREME_HILLS]: [120, 120, 120], [Biome.FOREST]: [40, 120, 40], [Biome.TAIGA]: [60, 110, 90],
  [Biome.SWAMPLAND]: [80, 100, 60], [Biome.RIVER]: [60, 100, 220], [Biome.FROZEN_OCEAN]: [150, 160, 220],
  [Biome.FROZEN_RIVER]: [170, 190, 240], [Biome.ICE_PLAINS]: [240, 240, 250], [Biome.ICE_MOUNTAINS]: [200, 200, 210],
  [Biome.MUSHROOM_ISLAND]: [190, 60, 190], [Biome.MUSHROOM_SHORE]: [160, 90, 160],
};
const counts: Record<number, number> = {};
const t0 = performance.now();
for (let py = 0; py < SIZE; py++) {
  for (let px = 0; px < SIZE; px++) {
    const x = (px - SIZE / 2) * STEP;
    const z = (py - SIZE / 2) * STEP;
    const c = gen.climate(x, z);
    const b = gen.biomeFromClimate(c);
    counts[b] = (counts[b] ?? 0) + 1;
    const h = gen.heightFromClimate(c).height;
    const base = colors[b] ?? [255, 0, 255];
    const shade = 0.6 + Math.min(1, Math.max(0, (h - 40) / 60)) * 0.6;
    const i = (py * SIZE + px) * 4;
    img[i] = Math.min(255, base[0] * shade); img[i + 1] = Math.min(255, base[1] * shade); img[i + 2] = Math.min(255, base[2] * shade); img[i + 3] = 255;
    if (Math.abs(x) < STEP && Math.abs(z) < STEP) { img[i] = 255; img[i + 1] = 0; img[i + 2] = 0; }
  }
}
console.log('climate+height per column us:', ((performance.now() - t0) * 1000 / (SIZE * SIZE)).toFixed(2));
const names = Object.fromEntries(Object.entries(Biome).map(([k, v]) => [v, k]));
for (const [b, n] of Object.entries(counts)) console.log(names[Number(b)], ((n / (SIZE * SIZE)) * 100).toFixed(1) + '%');
console.log('spawn', gen.findSpawn());
writePng(process.argv[2], SIZE, SIZE, img);
const t1 = performance.now();
let n = 0;
for (let cx = -4; cx < 4; cx++) for (let cz = -4; cz < 4; cz++) { gen.generateTerrain(cx, cz); n++; }
console.log('terrain ms/chunk', ((performance.now() - t1) / n).toFixed(2));

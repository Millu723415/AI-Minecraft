/**
 * CPU benchmark of the chunk pipeline (run with: npx vite-node scripts/bench.ts [seed] [radius]).
 * Generates a square of chunks, populates, lights and meshes them the same
 * way the game does, and prints per-stage timings plus mesh sizes.
 */
import { Dimension } from '../src/world/dimension';
import { ChunkState } from '../src/world/chunk';
import { createGenerator } from '../src/worldgen/index';
import { ChunkMesher } from '../src/render/mesher';
import { Dim } from '../src/world/constants';

const seed = Number(process.argv[2] ?? 12345);
const R = Number(process.argv[3] ?? 6);
const gen = createGenerator(Dim.OVERWORLD, seed);
const dim = new Dimension(Dim.OVERWORLD, gen, true);
const t = (f: () => void) => { const s = performance.now(); f(); return performance.now() - s; };

let genMs = 0; let n = 0;
for (let cx = -R - 1; cx <= R + 1; cx++) for (let cz = -R - 1; cz <= R + 1; cz++) {
  genMs += t(() => dim.addGeneratedChunk(gen.generateTerrain(cx, cz)));
  n++;
}
let popMs = 0; let pops = 0;
for (let cx = -R - 1; cx <= R; cx++) for (let cz = -R - 1; cz <= R; cz++) { popMs += t(() => dim.populate(cx, cz)); pops++; }
let lightMs = 0; let lights = 0;
for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) {
  const c = dim.getChunk(cx, cz)!;
  if (c.state < ChunkState.POPULATED) continue;
  lightMs += t(() => { dim.light.initChunk(c); c.lit = true; }); lights++;
}
const mesher = new ChunkMesher();
let meshMs = 0; let meshes = 0; let tris = 0;
for (let cx = -R + 1; cx < R; cx++) for (let cz = -R + 1; cz < R; cz++) {
  const c = dim.getChunk(cx, cz)!;
  let data: ReturnType<ChunkMesher['build']> | null = null;
  meshMs += t(() => { data = mesher.build(dim, c); });
  meshes++;
  for (const part of Object.values(data as unknown as Record<string, { idx?: Uint32Array } | null>)) {
    if (part && typeof part === 'object' && 'idx' in part && part.idx) tris += part.idx.length / 3;
  }
}
console.log(`seed ${seed}, ${n} chunks generated`);
console.log(`terrain generation : ${(genMs / n).toFixed(2)} ms/chunk (runs in web workers in the game)`);
console.log(`population         : ${(popMs / pops).toFixed(2)} ms/chunk`);
console.log(`lighting           : ${(lightMs / lights).toFixed(2)} ms/chunk`);
console.log(`meshing            : ${(meshMs / meshes).toFixed(2)} ms/chunk, ${(tris / meshes).toFixed(0)} triangles/chunk`);

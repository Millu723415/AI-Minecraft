/**
 * The title-screen background: a real generated world seen from a slowly
 * turning camera, rendered with the in-game renderer.
 */

import { ChunkMesher } from './render/mesher';
import type { Renderer } from './render/renderer';
import { World } from './world/world';
import { ChunkManager } from './world/chunkmanager';
import { GenerationPool } from './world/genpool';
import { createGenerator } from './worldgen/index';
import { Dim, type DimId } from './world/constants';
import { BlockBehaviors } from './world/behaviors';

const PANORAMA_SEED = 20111118;

export class Panorama {
  private world: World;
  private manager: ChunkManager;
  private pool: GenerationPool;
  private mesher = new ChunkMesher();
  private angle = 0;
  private running = true;
  private x = 0;
  private z = 0;
  private y = 90;

  constructor(private readonly renderer: Renderer) {
    this.world = new World({ id: 'panorama', name: 'panorama', seed: PANORAMA_SEED, seedText: '', gameMode: 'survival', difficulty: 0, generatorVersion: 1, created: 0, lastPlayed: 0 });
    this.world.dayTime = 3000;
    this.pool = new GenerationPool(PANORAMA_SEED, (d: DimId) => createGenerator(d, PANORAMA_SEED));
    const dim = this.world.getDimension(Dim.OVERWORLD);
    dim.hooks = new BlockBehaviors({} as never);
    const gen = createGenerator(Dim.OVERWORLD, PANORAMA_SEED) as unknown as { findSpawn(): { x: number; z: number }; surfaceHeight(x: number, z: number): number };
    const s = gen.findSpawn();
    this.x = s.x; this.z = s.z;
    this.y = Math.max(80, gen.surfaceHeight(s.x, s.z) + 22);
    this.manager = new ChunkManager(dim, this.pool, {
      loadSaved: async () => null,
      mesh: (chunk) => this.renderer.chunks.update(chunk.cx, chunk.cz, this.mesher.build(dim, chunk)),
      unmesh: (cx, cz) => this.renderer.chunks.remove(cx, cz),
      saveUnloaded: () => undefined,
    });
  }

  stop(): void {
    this.running = false;
    this.manager.unloadAll();
    this.renderer.chunks.clear();
  }

  start(): void {
    this.running = true;
    this.renderer.chunks.clear();
  }

  render(dt: number): void {
    if (!this.running) return;
    this.angle += dt * 0.00004;
    this.renderer.setRenderDistance(5);
    this.manager.update(this.x, this.z, 5, 8);
    this.renderer.setSelection(0, 0, 0, null);
    this.renderer.setCrack(0, 0, 0, 0, null);
    this.renderer.render({
      x: this.x + 0.5, y: this.y, z: this.z + 0.5, yaw: this.angle * Math.PI * 2, pitch: -0.32, roll: 0, fov: 85,
      underwater: false, inLava: false, thirdPerson: false,
    }, null, Dim.OVERWORLD, this.world.dayTime, 0, dt / 1000);
  }
}

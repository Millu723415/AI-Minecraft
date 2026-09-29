/** A tiny flat test world with real block behaviours and redstone, no rendering. */
import { Dimension } from '../../src/world/dimension';
import { BlockBehaviors } from '../../src/world/behaviors';
import { Redstone } from '../../src/world/redstone';
import { ChunkState } from '../../src/world/chunk';
import type { DimensionGenerator, GeneratedChunk } from '../../src/world/generator';
import { CHUNK_VOLUME, blockIndex } from '../../src/world/constants';
import type { GameContext } from '../../src/game/context';
import type { Entity } from '../../src/entity/entity';
import { BlockId } from '../../src/blocks/ids';

class FlatGen implements DimensionGenerator {
  readonly generatorVersion = 1;
  generateTerrain(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) {
      blocks[blockIndex(x, 0, z)] = BlockId.BEDROCK;
      for (let y = 1; y < 4; y++) blocks[blockIndex(x, y, z)] = BlockId.STONE;
    }
    return { cx, cz, blocks, meta: new Uint8Array(CHUNK_VOLUME), biomes: new Uint8Array(256), tiles: [] };
  }
  populate(): void {}
}

export interface TestWorld {
  dim: Dimension;
  ctx: GameContext & { entities: Entity[]; sounds: string[]; tick: () => void };
  redstone: Redstone;
  behaviors: BlockBehaviors;
  /** Advance n game ticks (scheduled block updates + redstone tick). */
  run(n: number): void;
}

export function createTestWorld(radius = 2): TestWorld {
  const dim = new Dimension(0, new FlatGen(), true);
  const entities: Entity[] = [];
  const sounds: string[] = [];
  let tickCount = 0;
  const ctx = {
    entities, sounds,
    get tickCount() { return tickCount; },
    difficulty: 2,
    random: () => Math.random(),
    playSound: (name: string) => { sounds.push(name); },
    particles: () => {},
    explode: () => {},
    dropStack: () => {},
    dropXp: () => {},
    spawn: (e: Entity) => { e.dim = dim; entities.push(e); },
    entitiesIn: () => entities,
    skyDarken: () => 0,
    travelTo: () => {},
    message: () => {},
    tick: () => {},
    world: { dragonKilled: false, endInitialized: true, dayTime: 6000, rainStrength: 0 },
    player: { inventory: { held: null }, type: 'player' },
  } as unknown as TestWorld['ctx'];
  const behaviors = new BlockBehaviors(ctx);
  const redstone = new Redstone(ctx);
  behaviors.redstone = redstone;
  dim.hooks = behaviors;
  for (let cx = -radius; cx <= radius; cx++) for (let cz = -radius; cz <= radius; cz++) {
    const c = dim.addGeneratedChunk(new FlatGen().generateTerrain(cx, cz));
    c.state = ChunkState.POPULATED;
  }
  for (const c of dim.chunks.values()) { dim.light.initChunk(c); c.lit = true; }
  const run = (n: number) => {
    for (let i = 0; i < n; i++) {
      tickCount++;
      dim.currentTick++;
      dim.runScheduledTicks();
      redstone.tick(dim);
    }
  };
  return { dim, ctx, redstone, behaviors, run };
}

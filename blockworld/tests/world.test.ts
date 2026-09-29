import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks/ids';
import { FRAME_EYE } from '../src/blocks/meta';
import { ItemId } from '../src/items/ids';
import { createStack } from '../src/items/stack';
import { PlayerInventory } from '../src/items/container';
import { clickSlot } from '../src/items/slotlogic';
import { rleDecode, rleEncode } from '../src/save/codec';
import { CHUNK_VOLUME, blockIndex } from '../src/world/constants';
import { ringPositions, tryActivateEndPortal, tryCreateNetherPortal } from '../src/world/portals';
import { tickFurnace } from '../src/game/furnace';
import { OverworldGenerator } from '../src/worldgen/overworld';
import { EnderDragon } from '../src/entity/mobs/dragon';
import { createTestWorld } from './helpers/testworld';

const Y = 4;

describe('chunk storage', () => {
  it('block indices are unique and cover the chunk volume', () => {
    const seen = new Uint8Array(CHUNK_VOLUME);
    for (let y = 0; y < 128; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
      const i = blockIndex(x, y, z);
      expect(seen[i]).toBe(0);
      seen[i] = 1;
    }
    expect(seen.every((v) => v === 1)).toBe(true);
  });

  it('RLE round-trips terrain and random data', () => {
    const gen = new OverworldGenerator(99);
    const c = gen.generateTerrain(1, -3);
    const enc = rleEncode(c.blocks);
    expect(enc.length).toBeLessThan(c.blocks.length / 4);
    expect(Array.from(rleDecode(enc, c.blocks.length))).toEqual(Array.from(c.blocks));
    const noise = new Uint8Array(5000).map(() => Math.floor(Math.random() * 256));
    expect(Array.from(rleDecode(rleEncode(noise), noise.length))).toEqual(Array.from(noise));
  });

  it('generation is deterministic per seed and differs between seeds', () => {
    const a = new OverworldGenerator(1234).generateTerrain(5, 7).blocks;
    const b = new OverworldGenerator(1234).generateTerrain(5, 7).blocks;
    const c = new OverworldGenerator(4321).generateTerrain(5, 7).blocks;
    expect(a.every((v, i) => v === b[i])).toBe(true);
    expect(a.some((v, i) => v !== c[i])).toBe(true);
  });
});

describe('inventory', () => {
  it('stacks merge up to 64 and tools do not stack', () => {
    const inv = new PlayerInventory();
    expect(inv.addItem(createStack(BlockId.COBBLESTONE, 40))).toBeNull();
    expect(inv.addItem(createStack(BlockId.COBBLESTONE, 40))).toBeNull();
    expect(inv.get(0)?.count).toBe(64);
    expect(inv.get(1)?.count).toBe(16);
    inv.addItem(createStack(ItemId.IRON_PICKAXE));
    inv.addItem(createStack(ItemId.IRON_PICKAXE));
    expect(inv.count(ItemId.IRON_PICKAXE)).toBe(2);
    expect(inv.slots.filter((s) => s?.id === ItemId.IRON_PICKAXE).length).toBe(2);
    inv.addItem(createStack(ItemId.ENDER_PEARL, 20));
    expect(inv.slots.find((s) => s?.id === ItemId.ENDER_PEARL)?.count).toBe(16);
  });

  it('clicking slots picks up, places, splits and merges', () => {
    const slot = createStack(BlockId.DIRT, 10);
    let r = clickSlot(slot, null, 'right');
    expect(r.cursor?.count).toBe(5);
    expect(r.slot?.count).toBe(5);
    r = clickSlot(r.slot, r.cursor, 'left');
    expect(r.slot?.count).toBe(10);
    expect(r.cursor).toBeNull();
  });
});

describe('portals', () => {
  it('a 4x5 obsidian frame lights into a nether portal', () => {
    const { dim } = createTestWorld();
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
      const edge = i === -1 || i === 2 || j === -1 || j === 3;
      if (edge) dim.setBlock(i, Y + 1 + j, 0, BlockId.OBSIDIAN, 0);
    }
    expect(tryCreateNetherPortal(dim, 0, Y + 1, 0)).toBe(true);
    for (let i = 0; i <= 1; i++) for (let j = 0; j <= 2; j++) expect(dim.getBlock(i, Y + 1 + j, 0)).toBe(BlockId.NETHER_PORTAL);
  });

  it('an incomplete frame does not light', () => {
    const { dim } = createTestWorld();
    for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
      const edge = i === -1 || i === 2 || j === -1 || j === 3;
      if (edge && !(i === 2 && j === 1)) dim.setBlock(i, Y + 1 + j, 0, BlockId.OBSIDIAN, 0);
    }
    expect(tryCreateNetherPortal(dim, 0, Y + 1, 0)).toBe(false);
  });

  it('the End portal activates only when all twelve frames hold eyes', () => {
    const { dim } = createTestWorld();
    const ring = ringPositions(0, 0);
    ring.forEach(([x, z], i) => dim.setBlock(x, Y, z, BlockId.END_PORTAL_FRAME, i === 0 ? 0 : FRAME_EYE));
    expect(tryActivateEndPortal(dim, ring[0][0], Y, ring[0][1])).toBe(false);
    dim.setMeta(ring[0][0], Y, ring[0][1], FRAME_EYE);
    expect(tryActivateEndPortal(dim, ring[0][0], Y, ring[0][1])).toBe(true);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) expect(dim.getBlock(dx, Y, dz)).toBe(BlockId.END_PORTAL);
  });
});

describe('furnace', () => {
  it('smelts eight iron ore with one coal in 1600 ticks', () => {
    const { dim } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.FURNACE, 0);
    const t = dim.getOrCreateTile('furnace', 0, Y, 0);
    if (t.kind !== 'furnace') throw new Error('no furnace tile');
    t.items.set(0, createStack(BlockId.IRON_ORE, 8));
    t.items.set(1, createStack(ItemId.COAL, 1));
    for (let i = 0; i < 1600; i++) tickFurnace(dim, t);
    expect(t.items.get(2)).toMatchObject({ id: ItemId.IRON_INGOT, count: 8 });
    expect(t.items.get(0)).toBeNull();
    expect(t.items.get(1)).toBeNull();
  });
});

describe('the dragon', () => {
  it('dies into an exit portal with the egg and marks the world', () => {
    const { dim, ctx } = createTestWorld(1);
    const dragon = new EnderDragon();
    dragon.dim = dim;
    dragon.setPosition(0, 40, 0);
    ctx.spawn(dragon, dim);
    dragon.die(ctx, { type: 'player' } as never);
    expect(dragon.phase).toBe('DEATH');
    for (let i = 0; i < 210 && !dragon.removed; i++) dragon.tick(ctx);
    expect(dragon.removed).toBe(true);
    expect((ctx as unknown as { world: { dragonKilled: boolean } }).world.dragonKilled).toBe(true);
    let portal = 0; let egg = false;
    for (let y = 0; y < 20; y++) for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
      const id = dim.getBlock(x, y, z);
      if (id === BlockId.END_PORTAL) portal++;
      if (id === BlockId.DRAGON_EGG) egg = true;
    }
    expect(portal).toBeGreaterThan(8);
    expect(egg).toBe(true);
  });
});

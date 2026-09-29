import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks/ids';
import { DOOR_OPEN, DOOR_UPPER, PISTON_EXTENDED } from '../src/blocks/meta';
import { createTestWorld } from './helpers/testworld';

const Y = 4; // first air layer above the flat stone floor

describe('redstone', () => {
  it('dust loses one level per block and powers a door it points into', () => {
    const { dim, run } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.LEVER, 5);
    for (let x = 1; x <= 6; x++) dim.setBlock(x, Y, 0, BlockId.REDSTONE_WIRE, 0);
    dim.setBlock(7, Y, 0, BlockId.WOODEN_DOOR, 0);
    dim.setBlock(7, Y + 1, 0, BlockId.WOODEN_DOOR, DOOR_UPPER);
    dim.setMeta(0, Y, 0, 5 | 8);
    run(2);
    expect([1, 2, 3, 4, 5, 6].map((x) => dim.getMeta(x, Y, 0))).toEqual([15, 14, 13, 12, 11, 10]);
    expect(dim.getMeta(7, Y, 0) & DOOR_OPEN).toBeTruthy();
    dim.setMeta(0, Y, 0, 5);
    run(2);
    expect([1, 2, 3, 4, 5, 6].map((x) => dim.getMeta(x, Y, 0))).toEqual([0, 0, 0, 0, 0, 0]);
    expect(dim.getMeta(7, Y, 0) & DOOR_OPEN).toBe(0);
  });

  it('a signal fades out after fifteen blocks of dust', () => {
    const { dim, run } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.LEVER, 5 | 8);
    for (let x = 1; x <= 17; x++) dim.setBlock(x, Y, 0, BlockId.REDSTONE_WIRE, 0);
    run(2);
    expect(dim.getMeta(15, Y, 0)).toBe(1);
    expect(dim.getMeta(16, Y, 0)).toBe(0);
  });

  it('a torch inverts the power of the block it is attached to', () => {
    const { dim, run } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.STONE, 0);
    dim.setBlock(0, Y, -1, BlockId.REDSTONE_TORCH, 3); // on the north face, support at +Z
    dim.setBlock(0, Y + 1, 0, BlockId.LEVER, 5);
    run(4);
    expect(dim.getBlock(0, Y, -1)).toBe(BlockId.REDSTONE_TORCH);
    dim.setMeta(0, Y + 1, 0, 5 | 8);
    run(4);
    expect(dim.getBlock(0, Y, -1)).toBe(BlockId.REDSTONE_TORCH_OFF);
    dim.setMeta(0, Y + 1, 0, 5);
    run(4);
    expect(dim.getBlock(0, Y, -1)).toBe(BlockId.REDSTONE_TORCH);
  });

  it('a repeater delays and refreshes the signal', () => {
    const { dim, run } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.LEVER, 5);
    dim.setBlock(1, Y, 0, BlockId.REDSTONE_WIRE, 0);
    dim.setBlock(2, Y, 0, BlockId.REPEATER_OFF, 3 | (3 << 2)); // facing +X, 4-tick delay (8 game ticks)
    dim.setBlock(3, Y, 0, BlockId.REDSTONE_WIRE, 0);
    dim.setMeta(0, Y, 0, 5 | 8);
    run(4);
    expect(dim.getBlock(2, Y, 0)).toBe(BlockId.REPEATER_OFF);
    run(6);
    expect(dim.getBlock(2, Y, 0)).toBe(BlockId.REPEATER_ON);
    expect(dim.getMeta(3, Y, 0)).toBe(15);
  });

  it('sticky pistons push and pull blocks; normal pistons leave them', () => {
    const { dim, run } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.STICKY_PISTON, 0); // facing +X
    dim.setBlock(1, Y, 0, BlockId.PLANKS, 0);
    dim.setBlock(2, Y, 0, BlockId.COBBLESTONE, 0);
    dim.setBlock(-1, Y, 0, BlockId.LEVER, 5);
    dim.setMeta(-1, Y, 0, 5 | 8);
    run(1);
    expect(dim.getMeta(0, Y, 0) & PISTON_EXTENDED).toBeTruthy();
    expect(dim.getBlock(1, Y, 0)).toBe(BlockId.PISTON_HEAD);
    expect(dim.getBlock(2, Y, 0)).toBe(BlockId.PLANKS);
    expect(dim.getBlock(3, Y, 0)).toBe(BlockId.COBBLESTONE);
    dim.setMeta(-1, Y, 0, 5);
    run(1);
    expect(dim.getBlock(1, Y, 0)).toBe(BlockId.PLANKS);
    expect(dim.getBlock(2, Y, 0)).toBe(0);

    dim.setBlock(0, Y, 5, BlockId.PISTON, 0);
    dim.setBlock(1, Y, 5, BlockId.PLANKS, 0);
    dim.setBlock(-1, Y, 5, BlockId.LEVER, 5 | 8);
    run(1);
    expect(dim.getBlock(2, Y, 5)).toBe(BlockId.PLANKS);
    dim.setMeta(-1, Y, 5, 5);
    run(1);
    expect(dim.getBlock(1, Y, 5)).toBe(0);
    expect(dim.getBlock(2, Y, 5)).toBe(BlockId.PLANKS);
  });

  it('pistons refuse to push obsidian', () => {
    const { dim, run } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.PISTON, 0);
    dim.setBlock(1, Y, 0, BlockId.OBSIDIAN, 0);
    dim.setBlock(-1, Y, 0, BlockId.LEVER, 5 | 8);
    run(1);
    expect(dim.getMeta(0, Y, 0) & PISTON_EXTENDED).toBe(0);
    expect(dim.getBlock(1, Y, 0)).toBe(BlockId.OBSIDIAN);
  });

  it('buttons release after a second', () => {
    const { dim, run } = createTestWorld();
    dim.setBlock(0, Y, 0, BlockId.STONE, 0);
    dim.setBlock(1, Y, 0, BlockId.STONE_BUTTON, 2 | 8); // attached to the block at -X
    dim.scheduleTick(1, Y, 0, 20);
    dim.setBlock(-1, Y, 0, BlockId.REDSTONE_WIRE, 0);
    run(1);
    expect(dim.getMeta(-1, Y, 0)).toBe(15);
    run(21);
    expect(dim.getMeta(1, Y, 0) & 8).toBe(0);
    expect(dim.getMeta(-1, Y, 0)).toBe(0);
  });
});

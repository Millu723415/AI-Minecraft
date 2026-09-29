/**
 * The survival progression chain, checked system by system: every recipe,
 * smelt, tool tier and drop the path from punching trees to the End needs.
 */
import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks/ids';
import { canHarvest, getBlock, resolveDrops } from '../src/blocks/registry';
import { ItemId } from '../src/items/ids';
import { PotionKind, getItem } from '../src/items/registry';
import { createStack, type ItemStack } from '../src/items/stack';
import { craftingResult, findSmelting, fuelTicks } from '../src/recipes/crafting';
import { brewResult } from '../src/game/brewing';
import { Random } from '../src/core/rng';

type Key = Record<string, number | [number, number]>;

/** Build a crafting grid from pattern rows. */
function grid(rows: string[], key: Key, size = 3): (ItemStack | null)[] {
  const g: (ItemStack | null)[] = new Array(size * size).fill(null);
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === ' ' || ch === '.') return;
      const k = key[ch];
      g[y * size + x] = Array.isArray(k) ? createStack(k[0], 1, k[1]) : createStack(k, 1);
    });
  });
  return g;
}

function craft(rows: string[], key: Key, size = 3): ItemStack | null {
  return craftingResult(grid(rows, key, size), size);
}

describe('crafting chain', () => {
  it('log -> planks -> sticks -> crafting table (2x2 grid)', () => {
    expect(craft(['L'], { L: BlockId.LOG }, 2)).toMatchObject({ id: BlockId.PLANKS, count: 4 });
    expect(craft(['P', 'P'], { P: BlockId.PLANKS }, 2)).toMatchObject({ id: ItemId.STICK, count: 4 });
    expect(craft(['PP', 'PP'], { P: BlockId.PLANKS }, 2)).toMatchObject({ id: BlockId.CRAFTING_TABLE, count: 1 });
  });

  it('shaped recipes match anywhere in the grid and mirrored', () => {
    const k = { P: BlockId.PLANKS, S: ItemId.STICK };
    expect(craft(['PP.', 'PS.', '.S.'], k)?.id).toBe(ItemId.WOODEN_AXE);
    expect(craft(['.PP', '.SP', '.S.'], k)?.id).toBe(ItemId.WOODEN_AXE);
    expect(craft(['..P', '..S', '..S'], k)?.id).toBe(ItemId.WOODEN_SHOVEL);
  });

  it('the full pickaxe ladder', () => {
    const S = ItemId.STICK;
    const pick = (m: number) => craft(['MMM', '.S.', '.S.'], { M: m, S })?.id;
    expect(pick(BlockId.PLANKS)).toBe(ItemId.WOODEN_PICKAXE);
    expect(pick(BlockId.COBBLESTONE)).toBe(ItemId.STONE_PICKAXE);
    expect(pick(ItemId.IRON_INGOT)).toBe(ItemId.IRON_PICKAXE);
    expect(pick(ItemId.DIAMOND)).toBe(ItemId.DIAMOND_PICKAXE);
    expect(craft(['.M.', '.M.', '.S.'], { M: ItemId.IRON_INGOT, S })?.id).toBe(ItemId.IRON_SWORD);
  });

  it('survival essentials: furnace, torches, chest, bucket, flint and steel, bed', () => {
    expect(craft(['CCC', 'C.C', 'CCC'], { C: BlockId.COBBLESTONE })?.id).toBe(BlockId.FURNACE);
    expect(craft(['C', 'S'], { C: ItemId.COAL, S: ItemId.STICK }, 2)).toMatchObject({ id: BlockId.TORCH, count: 4 });
    expect(craft(['C', 'S'], { C: ItemId.CHARCOAL, S: ItemId.STICK }, 2)).toMatchObject({ id: BlockId.TORCH, count: 4 });
    expect(craft(['PPP', 'P.P', 'PPP'], { P: BlockId.PLANKS })?.id).toBe(BlockId.CHEST);
    expect(craft(['I.I', '.I.'], { I: ItemId.IRON_INGOT })?.id).toBe(ItemId.BUCKET);
    expect(craft(['I.', '.F'], { I: ItemId.IRON_INGOT, F: ItemId.FLINT }, 2)?.id).toBe(ItemId.FLINT_AND_STEEL);
    expect(craft(['WWW', 'PPP'], { W: BlockId.WOOL, P: BlockId.PLANKS })?.id).toBe(ItemId.BED_ITEM);
  });

  it('bow and arrows', () => {
    expect(craft(['.ST', 'S.T', '.ST'], { S: ItemId.STICK, T: ItemId.STRING })?.id).toBe(ItemId.BOW);
    expect(craft(['F', 'S', 'E'], { F: ItemId.FLINT, S: ItemId.STICK, E: ItemId.FEATHER })).toMatchObject({ id: ItemId.ARROW, count: 4 });
  });

  it('end-game items: blaze powder, eyes of ender, brewing stand, enchanting table', () => {
    expect(craft(['R'], { R: ItemId.BLAZE_ROD }, 2)).toMatchObject({ id: ItemId.BLAZE_POWDER, count: 2 });
    expect(craft(['PB'], { P: ItemId.ENDER_PEARL, B: ItemId.BLAZE_POWDER }, 2)?.id).toBe(ItemId.EYE_OF_ENDER);
    expect(craft(['B', 'P'], { P: ItemId.ENDER_PEARL, B: ItemId.BLAZE_POWDER }, 2)?.id).toBe(ItemId.EYE_OF_ENDER);
    expect(craft(['.R.', 'CCC'], { R: ItemId.BLAZE_ROD, C: BlockId.COBBLESTONE })?.id).toBe(ItemId.BREWING_STAND_ITEM);
    expect(craft(['.B.', 'DOD', 'OOO'], { B: ItemId.BOOK, D: ItemId.DIAMOND, O: BlockId.OBSIDIAN })?.id).toBe(BlockId.ENCHANTING_TABLE);
  });

  it('rejects nonsense', () => {
    expect(craft(['DD', 'DD'], { D: BlockId.DIRT }, 2)).toBeNull();
  });
});

describe('smelting', () => {
  const out = (id: number, meta = 0) => findSmelting(createStack(id, 1, meta))?.result.id;
  it('ores, food and materials', () => {
    expect(out(BlockId.IRON_ORE)).toBe(ItemId.IRON_INGOT);
    expect(out(BlockId.GOLD_ORE)).toBe(ItemId.GOLD_INGOT);
    expect(out(BlockId.COBBLESTONE)).toBe(BlockId.STONE);
    expect(out(BlockId.SAND)).toBe(BlockId.GLASS);
    expect(out(ItemId.RAW_PORKCHOP)).toBe(ItemId.COOKED_PORKCHOP);
    expect(out(ItemId.RAW_BEEF)).toBe(ItemId.COOKED_BEEF);
    expect(out(ItemId.RAW_CHICKEN)).toBe(ItemId.COOKED_CHICKEN);
    expect(out(ItemId.RAW_FISH)).toBe(ItemId.COOKED_FISH);
    expect(out(BlockId.LOG)).toBe(ItemId.CHARCOAL);
  });
  it('fuels burn for classic durations', () => {
    expect(fuelTicks(createStack(ItemId.COAL))).toBe(1600);
    expect(fuelTicks(createStack(BlockId.PLANKS))).toBe(300);
    expect(fuelTicks(createStack(ItemId.LAVA_BUCKET))).toBe(20000);
    expect(fuelTicks(createStack(ItemId.BLAZE_ROD))).toBe(2400);
    expect(fuelTicks(createStack(BlockId.DIRT))).toBe(0);
  });
});

describe('tool tiers', () => {
  const tier = (id: number) => getItem(id)!.toolTier;
  const harvest = (block: number, tool: number | null) =>
    canHarvest(getBlock(block), tool === null ? null : getItem(tool)!.toolCategory, tool === null ? -1 : tier(tool));
  it('stone needs a pickaxe; ores need the right tier', () => {
    expect(harvest(BlockId.STONE, null)).toBe(false);
    expect(harvest(BlockId.STONE, ItemId.WOODEN_PICKAXE)).toBe(true);
    expect(harvest(BlockId.IRON_ORE, ItemId.WOODEN_PICKAXE)).toBe(false);
    expect(harvest(BlockId.IRON_ORE, ItemId.STONE_PICKAXE)).toBe(true);
    expect(harvest(BlockId.DIAMOND_ORE, ItemId.STONE_PICKAXE)).toBe(false);
    expect(harvest(BlockId.DIAMOND_ORE, ItemId.IRON_PICKAXE)).toBe(true);
    expect(harvest(BlockId.OBSIDIAN, ItemId.IRON_PICKAXE)).toBe(false);
    expect(harvest(BlockId.OBSIDIAN, ItemId.DIAMOND_PICKAXE)).toBe(true);
    expect(harvest(BlockId.LOG, null)).toBe(true);
  });
  it('stone drops cobblestone and diamond ore drops diamonds', () => {
    const r = new Random(1);
    expect(resolveDrops(BlockId.STONE, 0, 0, 'pickaxe', 0, false, r)[0].item).toBe(BlockId.COBBLESTONE);
    expect(resolveDrops(BlockId.DIAMOND_ORE, 0, 2, 'pickaxe', 0, false, r)[0].item).toBe(ItemId.DIAMOND);
    expect(resolveDrops(BlockId.DIAMOND_ORE, 0, 1, 'pickaxe', 0, false, r)).toEqual([]);
    expect(resolveDrops(BlockId.COAL_ORE, 0, 0, 'pickaxe', 0, false, r)[0].item).toBe(ItemId.COAL);
    expect(resolveDrops(BlockId.OBSIDIAN, 0, 3, 'pickaxe', 0, false, r)[0].item).toBe(BlockId.OBSIDIAN);
  });
});

describe('brewing', () => {
  it('water -> awkward -> fire resistance, splash with gunpowder', () => {
    const awkward = brewResult(PotionKind.WATER, ItemId.NETHER_WART_ITEM);
    expect(awkward & 15).toBe(PotionKind.AWKWARD);
    const fire = brewResult(awkward, ItemId.MAGMA_CREAM);
    expect(fire & 15).toBe(PotionKind.FIRE_RESISTANCE);
    expect(brewResult(fire, ItemId.GUNPOWDER)).not.toBe(-1);
    expect(brewResult(PotionKind.WATER, ItemId.MAGMA_CREAM)).not.toBe(PotionKind.FIRE_RESISTANCE);
  });
});

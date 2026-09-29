/** Structure chest loot tables (era-appropriate, rolled lazily from a seed). */

import { BlockId } from '../blocks/ids';
import { ItemId, DyeMeta } from '../items/ids';
import { Random } from '../core/rng';
import { createStack, type ItemStack } from '../items/stack';

interface LootEntry { id: number; meta?: number; min: number; max: number; weight: number }
interface LootTable { rolls: [number, number]; entries: LootEntry[] }

export const LOOT_TABLES: Record<string, LootTable> = {
  dungeon: {
    rolls: [3, 8],
    entries: [
      { id: ItemId.STRING, min: 1, max: 4, weight: 10 },
      { id: ItemId.IRON_INGOT, min: 1, max: 4, weight: 10 },
      { id: ItemId.BREAD, min: 1, max: 1, weight: 10 },
      { id: ItemId.WHEAT, min: 1, max: 4, weight: 10 },
      { id: ItemId.GUNPOWDER, min: 1, max: 4, weight: 10 },
      { id: ItemId.BUCKET, min: 1, max: 1, weight: 10 },
      { id: ItemId.GOLDEN_APPLE, min: 1, max: 1, weight: 1 },
      { id: ItemId.REDSTONE, min: 1, max: 4, weight: 5 },
      { id: ItemId.DYE, meta: DyeMeta.COCOA_BEANS, min: 1, max: 1, weight: 5 },
      { id: ItemId.BONE, min: 1, max: 4, weight: 5 },
    ],
  },
  mineshaft: {
    rolls: [3, 6],
    entries: [
      { id: ItemId.IRON_INGOT, min: 1, max: 5, weight: 10 },
      { id: ItemId.GOLD_INGOT, min: 1, max: 3, weight: 5 },
      { id: ItemId.REDSTONE, min: 4, max: 9, weight: 5 },
      { id: ItemId.DYE, meta: DyeMeta.LAPIS_LAZULI, min: 4, max: 9, weight: 5 },
      { id: ItemId.DIAMOND, min: 1, max: 2, weight: 3 },
      { id: ItemId.COAL, min: 3, max: 8, weight: 10 },
      { id: ItemId.BREAD, min: 1, max: 3, weight: 15 },
      { id: ItemId.IRON_PICKAXE, min: 1, max: 1, weight: 1 },
      { id: BlockId.RAIL, min: 4, max: 8, weight: 1 },
      { id: ItemId.MELON_SEEDS, min: 2, max: 4, weight: 10 },
      { id: ItemId.PUMPKIN_SEEDS, min: 2, max: 4, weight: 10 },
    ],
  },
  stronghold_corridor: {
    rolls: [2, 4],
    entries: [
      { id: ItemId.ENDER_PEARL, min: 1, max: 1, weight: 10 },
      { id: ItemId.DIAMOND, min: 1, max: 3, weight: 3 },
      { id: ItemId.IRON_INGOT, min: 1, max: 5, weight: 10 },
      { id: ItemId.GOLD_INGOT, min: 1, max: 3, weight: 5 },
      { id: ItemId.REDSTONE, min: 4, max: 9, weight: 5 },
      { id: ItemId.BREAD, min: 1, max: 3, weight: 15 },
      { id: ItemId.APPLE, min: 1, max: 3, weight: 15 },
      { id: ItemId.IRON_PICKAXE, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_SWORD, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_CHESTPLATE, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_HELMET, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_LEGGINGS, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_BOOTS, min: 1, max: 1, weight: 5 },
      { id: ItemId.GOLDEN_APPLE, min: 1, max: 1, weight: 1 },
    ],
  },
  stronghold_library: {
    rolls: [1, 5],
    entries: [
      { id: ItemId.BOOK, min: 1, max: 3, weight: 20 },
      { id: ItemId.PAPER, min: 2, max: 7, weight: 20 },
      { id: ItemId.MAP, min: 1, max: 1, weight: 1 },
      { id: ItemId.COMPASS, min: 1, max: 1, weight: 1 },
    ],
  },
  stronghold_crossing: {
    rolls: [1, 4],
    entries: [
      { id: ItemId.IRON_INGOT, min: 1, max: 5, weight: 10 },
      { id: ItemId.GOLD_INGOT, min: 1, max: 3, weight: 5 },
      { id: ItemId.REDSTONE, min: 4, max: 9, weight: 5 },
      { id: ItemId.COAL, min: 3, max: 8, weight: 10 },
      { id: ItemId.BREAD, min: 1, max: 3, weight: 15 },
      { id: ItemId.APPLE, min: 1, max: 3, weight: 15 },
      { id: ItemId.IRON_PICKAXE, min: 1, max: 1, weight: 1 },
    ],
  },
  village_blacksmith: {
    rolls: [3, 8],
    entries: [
      { id: ItemId.DIAMOND, min: 1, max: 3, weight: 3 },
      { id: ItemId.IRON_INGOT, min: 1, max: 5, weight: 10 },
      { id: ItemId.GOLD_INGOT, min: 1, max: 3, weight: 5 },
      { id: ItemId.BREAD, min: 1, max: 3, weight: 15 },
      { id: ItemId.APPLE, min: 1, max: 3, weight: 15 },
      { id: ItemId.IRON_PICKAXE, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_SWORD, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_CHESTPLATE, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_HELMET, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_LEGGINGS, min: 1, max: 1, weight: 5 },
      { id: ItemId.IRON_BOOTS, min: 1, max: 1, weight: 5 },
      { id: BlockId.OBSIDIAN, min: 3, max: 7, weight: 5 },
      { id: BlockId.SAPLING, min: 3, max: 7, weight: 5 },
    ],
  },
};

/** Roll a loot table into 27 chest slots. */
export function rollLoot(table: string, seed: number): (ItemStack | null)[] {
  const slots: (ItemStack | null)[] = new Array(27).fill(null);
  const t = LOOT_TABLES[table];
  if (!t) return slots;
  const r = new Random(seed);
  const total = t.entries.reduce((s, e) => s + e.weight, 0);
  const rolls = r.range(t.rolls[0], t.rolls[1]);
  for (let i = 0; i < rolls; i++) {
    let pick = r.int(total);
    let entry = t.entries[0];
    for (const e of t.entries) {
      pick -= e.weight;
      if (pick < 0) { entry = e; break; }
    }
    const slot = r.int(27);
    slots[slot] = createStack(entry.id, r.range(entry.min, entry.max), entry.meta ?? 0);
  }
  return slots;
}

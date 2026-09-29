import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks/ids';
import { ItemId } from '../src/items/ids';
import { createStack } from '../src/items/stack';
import { ENCHANTMENTS, Enchantment, countBookshelves, enchantCosts, isEnchantable, selectEnchantments } from '../src/items/enchantments';

const defOf = (id: number) => ENCHANTMENTS.find((d) => d.id === id)!;

describe('enchanting table', () => {
  it('costs grow with bookshelves up to level 50', () => {
    let maxBare = 0; let maxFull = 0; let minFull = 99;
    for (let seed = 1; seed < 400; seed++) {
      const bare = enchantCosts(seed, 0);
      const full = enchantCosts(seed, 30);
      maxBare = Math.max(maxBare, ...bare);
      maxFull = Math.max(maxFull, ...full);
      minFull = Math.min(minFull, full[2]);
      // Each slot draws its own roll; the top slots are scaled-down versions.
      expect(full[0]).toBeLessThanOrEqual(26);
      expect(full[1]).toBeLessThanOrEqual(34);
      expect(bare.every((c) => c >= 1)).toBe(true);
    }
    expect(maxBare).toBeLessThanOrEqual(5);
    expect(maxFull).toBeGreaterThanOrEqual(45);
    expect(maxFull).toBeLessThanOrEqual(50);
    expect(minFull).toBeGreaterThanOrEqual(16);
    // More than 30 shelves does not help.
    expect(enchantCosts(7, 64)).toEqual(enchantCosts(7, 30));
  });

  it('counts shelves on two layers around the table with air between', () => {
    const blocks = new Map<string, number>();
    const get = (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? 0;
    // A full two-high ring of bookshelves two blocks out.
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== 2) continue;
      for (let dy = 0; dy <= 1; dy++) blocks.set(`${dx},${dy},${dz}`, BlockId.BOOKSHELF);
    }
    const full = countBookshelves(get, 0, 0, 0, BlockId.BOOKSHELF);
    expect(full).toBeGreaterThanOrEqual(30);
    // Something in the gap blocks the shelves behind it.
    blocks.set('1,0,0', BlockId.STONE);
    expect(countBookshelves(get, 0, 0, 0, BlockId.BOOKSHELF)).toBeLessThan(full);
  });

  it('only tools, weapons and armour can be enchanted', () => {
    expect(isEnchantable(createStack(ItemId.DIAMOND_PICKAXE))).toBe(true);
    expect(isEnchantable(createStack(ItemId.DIAMOND_SWORD))).toBe(true);
    expect(isEnchantable(createStack(ItemId.IRON_HELMET))).toBe(true);
    expect(isEnchantable(createStack(ItemId.BOW))).toBe(false); // not until later versions
    expect(isEnchantable(createStack(BlockId.STONE))).toBe(false);
    const done = createStack(ItemId.DIAMOND_SWORD);
    done.ench = [{ id: Enchantment.SHARPNESS, level: 1 }];
    expect(isEnchantable(done)).toBe(false);
  });

  it('picks enchantments that fit the item, without conflicts', () => {
    for (let seed = 1; seed < 200; seed++) {
      for (const cost of [1, 10, 30, 50]) {
        const pick = selectEnchantments(createStack(ItemId.DIAMOND_PICKAXE), cost, seed);
        expect(pick.length).toBeGreaterThan(0);
        for (const e of pick) expect(defOf(e.id).target).toBe('tool');
        expect(pick.some((e) => e.id === Enchantment.SILK_TOUCH) && pick.some((e) => e.id === Enchantment.FORTUNE)).toBe(false);

        const sword = selectEnchantments(createStack(ItemId.DIAMOND_SWORD), cost, seed);
        for (const e of sword) expect(defOf(e.id).target).toBe('weapon');
        expect(sword.filter((e) => defOf(e.id).exclusive === 'dmg').length).toBeLessThanOrEqual(1);

        const helmet = selectEnchantments(createStack(ItemId.IRON_HELMET), cost, seed);
        for (const e of helmet) expect(['armor', 'helmet']).toContain(defOf(e.id).target);
        expect(helmet.filter((e) => defOf(e.id).exclusive === 'prot').length).toBeLessThanOrEqual(1);
        for (const e of [...pick, ...sword, ...helmet]) {
          expect(e.level).toBeGreaterThanOrEqual(1);
          expect(e.level).toBeLessThanOrEqual(defOf(e.id).maxLevel);
        }
      }
    }
  });

  it('expensive enchantments are stronger', () => {
    let low = 0; let high = 0;
    for (let seed = 1; seed < 200; seed++) {
      const eff = (cost: number) => selectEnchantments(createStack(ItemId.DIAMOND_PICKAXE), cost, seed).find((e) => e.id === Enchantment.EFFICIENCY)?.level ?? 0;
      low += eff(3); high += eff(50);
    }
    expect(high).toBeGreaterThan(low * 2);
  });
});

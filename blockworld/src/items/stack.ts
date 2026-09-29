/** Item stacks and the pure helper functions used by every container. */

import { getItem } from './registry';

export interface Enchant {
  id: number;
  level: number;
}

export interface ItemStack {
  id: number;
  count: number;
  /** Variant data (wool colour, wood type, potion kind...). */
  meta: number;
  /** Used durability for tools and armor. */
  damage: number;
  ench?: Enchant[];
}

export function createStack(id: number, count = 1, meta = 0): ItemStack {
  return { id, count, meta, damage: 0 };
}

export function cloneStack(stack: ItemStack | null): ItemStack | null {
  if (!stack) return null;
  return {
    id: stack.id,
    count: stack.count,
    meta: stack.meta,
    damage: stack.damage,
    ench: stack.ench ? stack.ench.map((e) => ({ ...e })) : undefined,
  };
}

export function maxStackSize(stack: ItemStack | null): number {
  if (!stack) return 64;
  const def = getItem(stack.id);
  if (!def) return 64;
  if (stack.ench && stack.ench.length > 0) return 1;
  return def.maxStack;
}

/** Items stack when id, meta and enchantments match and they are stackable. */
export function canMerge(a: ItemStack | null, b: ItemStack | null): boolean {
  if (!a || !b) return false;
  if (a.id !== b.id) return false;
  if (maxStackSize(a) <= 1) return false;
  const def = getItem(a.id);
  const metaMatters = !def || def.durability === 0;
  if (metaMatters && a.meta !== b.meta) return false;
  if ((a.ench?.length ?? 0) > 0 || (b.ench?.length ?? 0) > 0) return false;
  return true;
}

/** Same item type ignoring count (used by the crafting output rules). */
export function sameItem(a: ItemStack | null, b: ItemStack | null): boolean {
  return canMerge(a, b);
}

export function isEmpty(stack: ItemStack | null | undefined): stack is null | undefined {
  return !stack || stack.count <= 0 || stack.id === 0;
}

/** Normalises empty stacks to null. */
export function normalize(stack: ItemStack | null): ItemStack | null {
  return isEmpty(stack) ? null : stack;
}

export function stacksEqual(a: ItemStack | null, b: ItemStack | null): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (!a || !b) return false;
  return a.id === b.id && a.count === b.count && a.meta === b.meta && a.damage === b.damage;
}

export function hasEnchant(stack: ItemStack | null, enchantId: number): number {
  if (!stack?.ench) return 0;
  for (const e of stack.ench) if (e.id === enchantId) return e.level;
  return 0;
}

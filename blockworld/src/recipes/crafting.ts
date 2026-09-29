/** Recipe matcher for 2x2 and 3x3 crafting grids. */

import { getItem } from '../items/registry';
import { createStack, type ItemStack } from '../items/stack';
import { CRAFTING_RECIPES, SMELTING_RECIPES } from './data';
import type { Ingredient, Recipe, ShapedRecipe, SmeltingRecipe } from './types';

function matches(ing: Ingredient | undefined, stack: ItemStack | null): boolean {
  if (!ing) return !stack;
  if (!stack) return false;
  if (stack.id !== ing.id) return false;
  if (ing.meta !== undefined && stack.meta !== ing.meta) return false;
  return true;
}

function patternSize(r: ShapedRecipe): [number, number] {
  const h = r.pattern.length;
  let w = 0;
  for (const row of r.pattern) w = Math.max(w, row.length);
  return [w, h];
}

function matchShapedAt(
  r: ShapedRecipe, grid: (ItemStack | null)[], size: number, ox: number, oy: number, mirror: boolean,
): boolean {
  const [w, h] = patternSize(r);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x - ox;
      const py = y - oy;
      let ing: Ingredient | undefined;
      if (px >= 0 && py >= 0 && px < w && py < h) {
        const ch = r.pattern[py][mirror ? w - 1 - px : px] ?? ' ';
        ing = ch === ' ' ? undefined : r.key[ch];
      }
      if (!matches(ing, grid[y * size + x])) return false;
    }
  }
  return true;
}

function matchShaped(r: ShapedRecipe, grid: (ItemStack | null)[], size: number): boolean {
  const [w, h] = patternSize(r);
  if (w > size || h > size) return false;
  for (let oy = 0; oy <= size - h; oy++) {
    for (let ox = 0; ox <= size - w; ox++) {
      if (matchShapedAt(r, grid, size, ox, oy, false)) return true;
      if (matchShapedAt(r, grid, size, ox, oy, true)) return true;
    }
  }
  return false;
}

function matchShapeless(ingredients: Ingredient[], grid: (ItemStack | null)[]): boolean {
  const present = grid.filter((s): s is ItemStack => !!s);
  if (present.length !== ingredients.length) return false;
  const used = new Array(present.length).fill(false);
  for (const ing of ingredients) {
    let found = false;
    for (let i = 0; i < present.length; i++) {
      if (!used[i] && matches(ing, present[i])) {
        used[i] = true;
        found = true;
        break;
      }
    }
    if (!found) return false;
  }
  return true;
}

/** Find the recipe that matches a square grid (size 2 or 3). */
export function findRecipe(grid: (ItemStack | null)[], size: number): Recipe | null {
  const normalized = grid.map((s) => (s && s.count > 0 ? s : null));
  if (normalized.every((s) => !s)) return null;
  for (const r of CRAFTING_RECIPES) {
    if (r.type === 'shaped') {
      if (matchShaped(r, normalized, size)) return r;
    } else if (matchShapeless(r.ingredients, normalized)) {
      return r;
    }
  }
  return null;
}

/** Special case: repairing two damaged tools of the same kind (classic 1.0). */
function repairResult(grid: (ItemStack | null)[]): ItemStack | null {
  const present = grid.filter((s): s is ItemStack => !!s && s.count > 0);
  if (present.length !== 2) return null;
  const [a, b] = present;
  if (a.id !== b.id) return null;
  const def = getItem(a.id);
  if (!def || def.durability <= 0 || def.maxStack !== 1) return null;
  const remainA = def.durability - a.damage;
  const remainB = def.durability - b.damage;
  const total = remainA + remainB + Math.floor(def.durability * 0.1);
  const out = createStack(a.id);
  out.damage = Math.max(0, def.durability - total);
  return out;
}

export function craftingResult(grid: (ItemStack | null)[], size: number): ItemStack | null {
  const recipe = findRecipe(grid, size);
  if (recipe) return createStack(recipe.result.id, recipe.result.count, recipe.result.meta ?? 0);
  return repairResult(grid);
}

/**
 * Consume one of each ingredient from the grid after the result was taken.
 * Containers such as buckets leave their empty version behind.
 */
export function consumeIngredients(grid: (ItemStack | null)[]): (ItemStack | null)[] {
  return grid.map((s) => {
    if (!s) return null;
    const def = getItem(s.id);
    if (def && def.craftRemainder) return createStack(def.craftRemainder);
    if (s.count <= 1) return null;
    return { ...s, count: s.count - 1 };
  });
}

export function findSmelting(stack: ItemStack | null): SmeltingRecipe | null {
  if (!stack) return null;
  for (const r of SMELTING_RECIPES) {
    if (r.input.id === stack.id && (r.input.meta === undefined || r.input.meta === stack.meta)) return r;
  }
  return null;
}

export function fuelTicks(stack: ItemStack | null): number {
  if (!stack) return 0;
  return getItem(stack.id)?.fuelTicks ?? 0;
}

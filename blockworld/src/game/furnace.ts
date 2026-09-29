/** Furnace simulation: fuel burning, smelting progress and output. */

import { BlockId } from '../blocks/ids';
import { canMerge, createStack } from '../items/stack';
import { findSmelting, fuelTicks } from '../recipes/crafting';
import { getItem } from '../items/registry';
import type { Dimension } from '../world/dimension';
import type { FurnaceTile } from '../world/tileentity';

const COOK_TIME = 200;

function canSmelt(t: FurnaceTile): boolean {
  const input = t.items.get(0);
  const recipe = findSmelting(input);
  if (!recipe) return false;
  const out = t.items.get(2);
  if (!out) return true;
  const res = createStack(recipe.result.id, recipe.result.count, recipe.result.meta ?? 0);
  if (!canMerge(out, res)) return false;
  return out.count + res.count <= (getItem(out.id)?.maxStack ?? 64);
}

/** One game tick of a furnace. Also swaps the block between lit and unlit. */
export function tickFurnace(dim: Dimension, t: FurnaceTile): void {
  const wasBurning = t.burnTime > 0;
  let changed = false;
  if (t.burnTime > 0) t.burnTime--;
  if (t.burnTime === 0 && canSmelt(t)) {
    const fuel = t.items.get(1);
    const ticks = fuelTicks(fuel);
    if (ticks > 0 && fuel) {
      t.burnTime = ticks;
      t.burnTotal = ticks;
      const def = getItem(fuel.id);
      if (def?.craftRemainder) t.items.set(1, createStack(def.craftRemainder));
      else {
        fuel.count--;
        t.items.set(1, fuel.count > 0 ? fuel : null);
      }
      changed = true;
    }
  }
  if (t.burnTime > 0 && canSmelt(t)) {
    t.cookTime++;
    if (t.cookTime >= COOK_TIME) {
      t.cookTime = 0;
      const input = t.items.get(0)!;
      const recipe = findSmelting(input)!;
      const out = t.items.get(2);
      if (out) {
        out.count += recipe.result.count;
        t.items.set(2, out);
      } else {
        t.items.set(2, createStack(recipe.result.id, recipe.result.count, recipe.result.meta ?? 0));
      }
      t.storedXp += recipe.xp;
      input.count--;
      t.items.set(0, input.count > 0 ? input : null);
      changed = true;
    }
  } else {
    t.cookTime = 0;
  }
  const burning = t.burnTime > 0;
  if (burning !== wasBurning) {
    const id = dim.getBlock(t.x, t.y, t.z);
    if (id === BlockId.FURNACE || id === BlockId.LIT_FURNACE) {
      const meta = dim.getMeta(t.x, t.y, t.z);
      // Swapping between lit/unlit keeps the tile entity (see Dimension.setBlock).
      dim.setBlock(t.x, t.y, t.z, burning ? BlockId.LIT_FURNACE : BlockId.FURNACE, meta);
    }
  }
  if (changed) {
    const c = dim.getChunkAt(t.x, t.z);
    if (c) c.modified = true;
  }
}


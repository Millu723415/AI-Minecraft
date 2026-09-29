/**
 * Release-era brewing: water bottles + Nether Wart -> Awkward base, then
 * ingredients select an effect; redstone extends, glowstone strengthens,
 * fermented spider eye corrupts and gunpowder makes a splash potion.
 */

import { ItemId } from '../items/ids';
import { POTION_EXTENDED, POTION_LEVEL2, POTION_SPLASH, PotionKind } from '../items/registry';
import { createStack, type ItemStack } from '../items/stack';
import type { BrewingTile } from '../world/tileentity';

const INGREDIENTS = new Set<number>([
  ItemId.NETHER_WART_ITEM, ItemId.GLOWSTONE_DUST, ItemId.REDSTONE, ItemId.GHAST_TEAR, ItemId.SUGAR,
  ItemId.SPIDER_EYE, ItemId.FERMENTED_SPIDER_EYE, ItemId.BLAZE_POWDER, ItemId.MAGMA_CREAM,
  ItemId.GLISTERING_MELON, ItemId.GUNPOWDER,
]);

export function isBrewingIngredient(id: number): boolean {
  return INGREDIENTS.has(id);
}

/** Result potion meta of brewing `ingredient` into potion `meta`, or -1 if no reaction. */
export function brewResult(meta: number, ingredient: number): number {
  const kind = meta & 15;
  const flags = meta & (POTION_LEVEL2 | POTION_EXTENDED | POTION_SPLASH);
  const effectKinds = new Set<number>([PotionKind.REGENERATION, PotionKind.SWIFTNESS, PotionKind.FIRE_RESISTANCE, PotionKind.POISON,
    PotionKind.HEALING, PotionKind.WEAKNESS, PotionKind.STRENGTH, PotionKind.SLOWNESS, PotionKind.HARMING]);
  switch (ingredient) {
    case ItemId.GUNPOWDER:
      return meta & POTION_SPLASH ? -1 : meta | POTION_SPLASH;
    case ItemId.NETHER_WART_ITEM:
      return kind === PotionKind.WATER ? PotionKind.AWKWARD | flags : -1;
    case ItemId.GLOWSTONE_DUST:
      if (kind === PotionKind.WATER) return PotionKind.THICK | flags;
      if (effectKinds.has(kind) && kind !== PotionKind.FIRE_RESISTANCE && kind !== PotionKind.WEAKNESS && kind !== PotionKind.SLOWNESS) {
        return ((meta | POTION_LEVEL2) & ~POTION_EXTENDED);
      }
      return -1;
    case ItemId.REDSTONE:
      if (kind === PotionKind.WATER) return PotionKind.MUNDANE | POTION_EXTENDED | flags;
      if (effectKinds.has(kind) && kind !== PotionKind.HEALING && kind !== PotionKind.HARMING) return ((meta | POTION_EXTENDED) & ~POTION_LEVEL2);
      return -1;
    case ItemId.FERMENTED_SPIDER_EYE:
      switch (kind) {
        case PotionKind.WATER: case PotionKind.AWKWARD: case PotionKind.THICK: case PotionKind.MUNDANE:
          return PotionKind.WEAKNESS | (meta & POTION_SPLASH);
        case PotionKind.REGENERATION: case PotionKind.STRENGTH: return PotionKind.WEAKNESS | flags;
        case PotionKind.SWIFTNESS: case PotionKind.FIRE_RESISTANCE: return PotionKind.SLOWNESS | flags;
        case PotionKind.POISON: case PotionKind.HEALING: return PotionKind.HARMING | flags;
        default: return -1;
      }
    default: {
      const effect: Record<number, number> = {
        [ItemId.GHAST_TEAR]: PotionKind.REGENERATION,
        [ItemId.SUGAR]: PotionKind.SWIFTNESS,
        [ItemId.MAGMA_CREAM]: PotionKind.FIRE_RESISTANCE,
        [ItemId.SPIDER_EYE]: PotionKind.POISON,
        [ItemId.GLISTERING_MELON]: PotionKind.HEALING,
        [ItemId.BLAZE_POWDER]: PotionKind.STRENGTH,
      };
      const e = effect[ingredient];
      if (e === undefined) return -1;
      if (kind === PotionKind.AWKWARD) return e | flags;
      if (kind === PotionKind.WATER) return PotionKind.MUNDANE | flags;
      return -1;
    }
  }
}

function canBrew(t: BrewingTile): boolean {
  const ing = t.items.get(3);
  if (!ing || !isBrewingIngredient(ing.id)) return false;
  for (let i = 0; i < 3; i++) {
    const b = t.items.get(i);
    if (b && b.id === ItemId.POTION && brewResult(b.meta, ing.id) >= 0) return true;
  }
  return false;
}

/** Advance a brewing stand by one tick. Returns true when a brew completed. */
export function tickBrewing(t: BrewingTile): boolean {
  if (t.brewTime > 0) {
    if (!canBrew(t)) {
      t.brewTime = 0;
      return false;
    }
    t.brewTime--;
    if (t.brewTime === 0) {
      const ing = t.items.get(3)!;
      for (let i = 0; i < 3; i++) {
        const b = t.items.get(i);
        if (!b || b.id !== ItemId.POTION) continue;
        const r = brewResult(b.meta, ing.id);
        if (r >= 0) t.items.set(i, createStack(ItemId.POTION, 1, r));
      }
      ing.count--;
      t.items.set(3, ing.count > 0 ? ing : null);
      return true;
    }
    return false;
  }
  if (canBrew(t)) t.brewTime = 400;
  return false;
}

export function isPotion(s: ItemStack | null): boolean {
  return !!s && s.id === ItemId.POTION;
}

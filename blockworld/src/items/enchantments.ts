/**
 * Enchantments available in the release-era enchanting table. The selection
 * logic is a simplified but real system: enchantability, levels and random
 * weighted choices seeded by the player's enchant seed.
 */

import { getItem } from './registry';
import type { Enchant, ItemStack } from './stack';
import { Random } from '../core/rng';

export const Enchantment = {
  PROTECTION: 0,
  FIRE_PROTECTION: 1,
  FEATHER_FALLING: 2,
  BLAST_PROTECTION: 3,
  PROJECTILE_PROTECTION: 4,
  RESPIRATION: 5,
  AQUA_AFFINITY: 6,
  SHARPNESS: 16,
  SMITE: 17,
  BANE_OF_ARTHROPODS: 18,
  KNOCKBACK: 19,
  FIRE_ASPECT: 20,
  LOOTING: 21,
  EFFICIENCY: 32,
  SILK_TOUCH: 33,
  UNBREAKING: 34,
  FORTUNE: 35,
  POWER: 48,
  PUNCH: 49,
  FLAME: 50,
  INFINITY: 51,
} as const;

type Target = 'armor' | 'helmet' | 'boots' | 'weapon' | 'tool' | 'bow' | 'all';

interface EnchantDef {
  id: number;
  name: string;
  maxLevel: number;
  weight: number;
  target: Target;
  minCost: (lvl: number) => number;
  maxCost: (lvl: number) => number;
  exclusive?: string;
}

export const ENCHANTMENTS: EnchantDef[] = [
  { id: 0, name: 'Protection', maxLevel: 4, weight: 10, target: 'armor', minCost: (l) => 1 + (l - 1) * 11, maxCost: (l) => 1 + (l - 1) * 11 + 20, exclusive: 'prot' },
  { id: 1, name: 'Fire Protection', maxLevel: 4, weight: 5, target: 'armor', minCost: (l) => 10 + (l - 1) * 8, maxCost: (l) => 10 + (l - 1) * 8 + 12, exclusive: 'prot' },
  { id: 2, name: 'Feather Falling', maxLevel: 4, weight: 5, target: 'boots', minCost: (l) => 5 + (l - 1) * 6, maxCost: (l) => 5 + (l - 1) * 6 + 10 },
  { id: 3, name: 'Blast Protection', maxLevel: 4, weight: 2, target: 'armor', minCost: (l) => 5 + (l - 1) * 8, maxCost: (l) => 5 + (l - 1) * 8 + 12, exclusive: 'prot' },
  { id: 4, name: 'Projectile Protection', maxLevel: 4, weight: 5, target: 'armor', minCost: (l) => 3 + (l - 1) * 6, maxCost: (l) => 3 + (l - 1) * 6 + 15, exclusive: 'prot' },
  { id: 5, name: 'Respiration', maxLevel: 3, weight: 2, target: 'helmet', minCost: (l) => 10 * l, maxCost: (l) => 10 * l + 30 },
  { id: 6, name: 'Aqua Affinity', maxLevel: 1, weight: 2, target: 'helmet', minCost: () => 1, maxCost: () => 41 },
  { id: 16, name: 'Sharpness', maxLevel: 5, weight: 10, target: 'weapon', minCost: (l) => 1 + (l - 1) * 11, maxCost: (l) => 1 + (l - 1) * 11 + 20, exclusive: 'dmg' },
  { id: 17, name: 'Smite', maxLevel: 5, weight: 5, target: 'weapon', minCost: (l) => 5 + (l - 1) * 8, maxCost: (l) => 5 + (l - 1) * 8 + 20, exclusive: 'dmg' },
  { id: 18, name: 'Bane of Arthropods', maxLevel: 5, weight: 5, target: 'weapon', minCost: (l) => 5 + (l - 1) * 8, maxCost: (l) => 5 + (l - 1) * 8 + 20, exclusive: 'dmg' },
  { id: 19, name: 'Knockback', maxLevel: 2, weight: 5, target: 'weapon', minCost: (l) => 5 + (l - 1) * 20, maxCost: (l) => 5 + (l - 1) * 20 + 50 },
  { id: 20, name: 'Fire Aspect', maxLevel: 2, weight: 2, target: 'weapon', minCost: (l) => 10 + (l - 1) * 20, maxCost: (l) => 10 + (l - 1) * 20 + 50 },
  { id: 21, name: 'Looting', maxLevel: 3, weight: 2, target: 'weapon', minCost: (l) => 15 + (l - 1) * 9, maxCost: (l) => 15 + (l - 1) * 9 + 50 },
  { id: 32, name: 'Efficiency', maxLevel: 5, weight: 10, target: 'tool', minCost: (l) => 1 + (l - 1) * 10, maxCost: (l) => 1 + (l - 1) * 10 + 50 },
  { id: 33, name: 'Silk Touch', maxLevel: 1, weight: 1, target: 'tool', minCost: () => 15, maxCost: () => 65, exclusive: 'loot' },
  { id: 34, name: 'Unbreaking', maxLevel: 3, weight: 5, target: 'tool', minCost: (l) => 5 + (l - 1) * 8, maxCost: (l) => 5 + (l - 1) * 8 + 50 },
  { id: 35, name: 'Fortune', maxLevel: 3, weight: 2, target: 'tool', minCost: (l) => 15 + (l - 1) * 9, maxCost: (l) => 15 + (l - 1) * 9 + 50, exclusive: 'loot' },
  { id: 48, name: 'Power', maxLevel: 5, weight: 10, target: 'bow', minCost: (l) => 1 + (l - 1) * 10, maxCost: (l) => 1 + (l - 1) * 10 + 15 },
  { id: 49, name: 'Punch', maxLevel: 2, weight: 2, target: 'bow', minCost: (l) => 12 + (l - 1) * 20, maxCost: (l) => 12 + (l - 1) * 20 + 25 },
  { id: 50, name: 'Flame', maxLevel: 1, weight: 2, target: 'bow', minCost: () => 20, maxCost: () => 50 },
  { id: 51, name: 'Infinity', maxLevel: 1, weight: 1, target: 'bow', minCost: () => 20, maxCost: () => 50 },
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

export function enchantName(e: Enchant): string {
  const def = ENCHANTMENTS.find((d) => d.id === e.id);
  return `${def?.name ?? 'Unknown'} ${ROMAN[e.level] ?? e.level}`;
}

function targetsOf(itemId: number): Target[] {
  const def = getItem(itemId);
  if (!def) return [];
  if (def.armorSlot >= 0) {
    const t: Target[] = ['armor'];
    if (def.armorSlot === 0) t.push('helmet');
    if (def.armorSlot === 3) t.push('boots');
    return t;
  }
  if (def.toolCategory === 'sword') return ['weapon'];
  if (def.toolCategory === 'pickaxe' || def.toolCategory === 'axe' || def.toolCategory === 'shovel') return ['tool'];
  // Bows could not be enchanted on the table in this era.
  return [];
}

export function isEnchantable(stack: ItemStack | null): boolean {
  if (!stack || (stack.ench && stack.ench.length > 0)) return false;
  const def = getItem(stack.id);
  return !!def && def.enchantability > 0 && targetsOf(stack.id).length > 0;
}

/**
 * Level requirements of the three table slots for a bookshelf count. The
 * release-era table counts shelves on two layers (up to 30 matter) and its
 * bottom slot reaches level 50.
 */
export function enchantCosts(seed: number, bookshelves: number): [number, number, number] {
  const r = new Random(seed);
  const shelves = Math.min(30, bookshelves);
  const slot = (i: number): number => {
    const b = 1 + (shelves >> 1) + r.int(shelves + 1);
    const v = r.int(5) + b;
    return i === 0 ? (v >> 1) + 1 : i === 1 ? Math.floor((v * 2) / 3) + 1 : v;
  };
  return [slot(0), slot(1), slot(2)];
}

/**
 * Bookshelves boosting an enchanting table at (x, y, z): shelves two blocks
 * away on the table's level and the one above, with air in between.
 */
export function countBookshelves(getBlock: (x: number, y: number, z: number) => number, x: number, y: number, z: number, shelfId: number): number {
  let n = 0;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      if ((dx === 0 && dz === 0) || getBlock(x + dx, y, z + dz) !== 0 || getBlock(x + dx, y + 1, z + dz) !== 0) continue;
      for (let dy = 0; dy <= 1; dy++) {
        if (getBlock(x + dx * 2, y + dy, z + dz * 2) === shelfId) n++;
        if (dx !== 0 && dz !== 0) {
          if (getBlock(x + dx * 2, y + dy, z + dz) === shelfId) n++;
          if (getBlock(x + dx, y + dy, z + dz * 2) === shelfId) n++;
        }
      }
    }
  }
  return n;
}

/** Choose enchantments for an item at a given level cost. */
export function selectEnchantments(stack: ItemStack, cost: number, seed: number): Enchant[] {
  const def = getItem(stack.id);
  if (!def) return [];
  const r = new Random(seed ^ (stack.id * 7919) ^ (cost * 131));
  const ench = Math.max(1, def.enchantability);
  let level = cost + 1 + r.int(Math.floor(ench / 4) + 1) + r.int(Math.floor(ench / 4) + 1);
  const bonus = (r.next() + r.next() - 1) * 0.15;
  level = Math.max(1, Math.round(level + level * bonus));
  const targets = targetsOf(stack.id);
  const available = (lvl: number, taken: Enchant[]) => {
    const out: { def: EnchantDef; level: number }[] = [];
    for (const d of ENCHANTMENTS) {
      if (!targets.includes(d.target) && !(d.target === 'armor' && targets.includes('armor'))) continue;
      if (taken.some((t) => t.id === d.id)) continue;
      if (d.exclusive && taken.some((t) => ENCHANTMENTS.find((x) => x.id === t.id)?.exclusive === d.exclusive)) continue;
      for (let l = d.maxLevel; l >= 1; l--) {
        if (lvl >= d.minCost(l) && lvl <= d.maxCost(l)) {
          out.push({ def: d, level: l });
          break;
        }
      }
    }
    return out;
  };
  const result: Enchant[] = [];
  let pool = available(level, result);
  while (pool.length > 0) {
    const total = pool.reduce((s, p) => s + p.def.weight, 0);
    let pick = r.int(total);
    let chosen = pool[0];
    for (const p of pool) {
      pick -= p.def.weight;
      if (pick < 0) { chosen = p; break; }
    }
    result.push({ id: chosen.def.id, level: chosen.level });
    if (r.int(50) > level) break;
    level = Math.floor(level / 2);
    pool = available(level, result);
  }
  return result;
}

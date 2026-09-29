/**
 * The item registry. Block items are generated from the block registry; all
 * other items (tools, armor, food, materials) are declared here as data.
 */

import { BlockId, DYE_COLOR_NAMES } from '../blocks/ids';
import { allBlocks, getBlock, slabDisplayName, stoneBrickDisplayName } from '../blocks/registry';
import type { ToolCategory } from '../blocks/types';
import { ItemId } from './ids';

export type ArmorSlot = 0 | 1 | 2 | 3; // helmet, chestplate, leggings, boots

export interface FoodData {
  hunger: number;
  saturation: number;
  /** Status effect applied when eaten: [effectId, seconds, amplifier, probability]. */
  effect?: [number, number, number, number];
  alwaysEdible?: boolean;
  /** Item returned after eating (bowl for stew). */
  remainder?: number;
}

export interface ItemDefinition {
  id: number;
  name: string;
  displayName: string;
  /** Icon texture name, or `block:<id>` to render the block as an icon. */
  icon: string;
  maxStack: number;
  durability: number;
  toolCategory: ToolCategory;
  toolTier: number;
  toolSpeed: number;
  attackDamage: number;
  armorSlot: ArmorSlot | -1;
  armorPoints: number;
  food: FoodData | null;
  /** Block placed when using the item, if any. */
  placeBlock: number;
  enchantability: number;
  /** Furnace burn time in ticks (20 ticks per second). */
  fuelTicks: number;
  /** Number of metadata values that behave as different items. */
  subtypes: number;
  /** Rendered as a tool in hand (angled). */
  handheld: boolean;
  /** Item left over in a crafting grid after crafting (buckets). */
  craftRemainder: number;
}

const items = new Map<number, ItemDefinition>();

function base(id: number, name: string, displayName: string): ItemDefinition {
  return {
    id, name, displayName, icon: name, maxStack: 64, durability: 0, toolCategory: null, toolTier: 0,
    toolSpeed: 1, attackDamage: 1, armorSlot: -1, armorPoints: 0, food: null, placeBlock: 0,
    enchantability: 0, fuelTicks: 0, subtypes: 1, handheld: false, craftRemainder: 0,
  };
}

function item(id: number, name: string, displayName: string, extra: Partial<ItemDefinition> = {}): ItemDefinition {
  const def = { ...base(id, name, displayName), ...extra };
  items.set(id, def);
  return def;
}

// ---------------------------------------------------------------------------
// Block items (one per block that can exist in an inventory).
// ---------------------------------------------------------------------------
const FLAT_ICON_BLOCKS = new Set<number>([
  BlockId.SAPLING, BlockId.COBWEB, BlockId.TALL_GRASS, BlockId.DEAD_BUSH, BlockId.DANDELION,
  BlockId.ROSE, BlockId.BROWN_MUSHROOM, BlockId.RED_MUSHROOM, BlockId.TORCH, BlockId.LADDER,
  BlockId.RAIL, BlockId.POWERED_RAIL, BlockId.DETECTOR_RAIL, BlockId.LEVER, BlockId.REDSTONE_TORCH,
  BlockId.IRON_BARS, BlockId.GLASS_PANE, BlockId.LILY_PAD, BlockId.TRAPDOOR,
]);

const WOOD_DISPLAY = ['Oak', 'Spruce', 'Birch'];

for (const block of allBlocks()) {
  if (block.id === BlockId.AIR) continue;
  if (block.itemId !== block.id) continue; // uses a dedicated item
  const flat = FLAT_ICON_BLOCKS.has(block.id);
  let subtypes = 1;
  if (block.id === BlockId.WOOL) subtypes = 16;
  else if (block.id === BlockId.LOG || block.id === BlockId.PLANKS || block.id === BlockId.SAPLING || block.id === BlockId.LEAVES) subtypes = 3;
  else if (block.id === BlockId.SLAB) subtypes = 6;
  else if (block.id === BlockId.STONE_BRICKS) subtypes = 4;
  else if (block.id === BlockId.TALL_GRASS) subtypes = 3;
  let fuel = 0;
  if (block.toolCategory === 'axe' && block.flammable > 0) fuel = 300;
  if (block.id === BlockId.SAPLING) fuel = 100;
  if (block.id === BlockId.LOG || block.id === BlockId.PLANKS) fuel = 300;
  item(block.id, block.name, block.displayName, {
    icon: flat ? `blockflat:${block.id}` : `block:${block.id}`,
    placeBlock: block.id,
    maxStack: block.maxStack,
    subtypes,
    fuelTicks: fuel,
  });
}

// ---------------------------------------------------------------------------
// Tools and weapons.
// ---------------------------------------------------------------------------
interface Material { name: string; display: string; tier: number; durability: number; speed: number; bonus: number; ench: number }
const WOOD: Material = { name: 'wooden', display: 'Wooden', tier: 0, durability: 59, speed: 2, bonus: 0, ench: 15 };
const STONE: Material = { name: 'stone', display: 'Stone', tier: 1, durability: 131, speed: 4, bonus: 1, ench: 5 };
const IRON: Material = { name: 'iron', display: 'Iron', tier: 2, durability: 250, speed: 6, bonus: 2, ench: 14 };
const DIAMOND: Material = { name: 'diamond', display: 'Diamond', tier: 3, durability: 1561, speed: 8, bonus: 3, ench: 10 };
const GOLD: Material = { name: 'gold', display: 'Golden', tier: 0, durability: 32, speed: 12, bonus: 0, ench: 22 };

function toolSet(m: Material, ids: { sword: number; shovel: number; pickaxe: number; axe: number; hoe: number }): void {
  const common = { maxStack: 1, durability: m.durability, toolTier: m.tier, enchantability: m.ench, handheld: true };
  const woodFuel = m === WOOD ? 200 : 0;
  item(ids.sword, `${m.name}_sword`, `${m.display} Sword`, { ...common, toolCategory: 'sword', attackDamage: 4 + m.bonus, toolSpeed: 1.5, fuelTicks: woodFuel });
  item(ids.shovel, `${m.name}_shovel`, `${m.display} Shovel`, { ...common, toolCategory: 'shovel', attackDamage: 1 + m.bonus, toolSpeed: m.speed, fuelTicks: woodFuel });
  item(ids.pickaxe, `${m.name}_pickaxe`, `${m.display} Pickaxe`, { ...common, toolCategory: 'pickaxe', attackDamage: 2 + m.bonus, toolSpeed: m.speed, fuelTicks: woodFuel });
  item(ids.axe, `${m.name}_axe`, `${m.display} Axe`, { ...common, toolCategory: 'axe', attackDamage: 3 + m.bonus, toolSpeed: m.speed, fuelTicks: woodFuel });
  item(ids.hoe, `${m.name}_hoe`, `${m.display} Hoe`, { ...common, toolCategory: 'hoe', attackDamage: 1, toolSpeed: 1, fuelTicks: woodFuel });
}
toolSet(WOOD, { sword: ItemId.WOODEN_SWORD, shovel: ItemId.WOODEN_SHOVEL, pickaxe: ItemId.WOODEN_PICKAXE, axe: ItemId.WOODEN_AXE, hoe: ItemId.WOODEN_HOE });
toolSet(STONE, { sword: ItemId.STONE_SWORD, shovel: ItemId.STONE_SHOVEL, pickaxe: ItemId.STONE_PICKAXE, axe: ItemId.STONE_AXE, hoe: ItemId.STONE_HOE });
toolSet(IRON, { sword: ItemId.IRON_SWORD, shovel: ItemId.IRON_SHOVEL, pickaxe: ItemId.IRON_PICKAXE, axe: ItemId.IRON_AXE, hoe: ItemId.IRON_HOE });
toolSet(DIAMOND, { sword: ItemId.DIAMOND_SWORD, shovel: ItemId.DIAMOND_SHOVEL, pickaxe: ItemId.DIAMOND_PICKAXE, axe: ItemId.DIAMOND_AXE, hoe: ItemId.DIAMOND_HOE });
toolSet(GOLD, { sword: ItemId.GOLD_SWORD, shovel: ItemId.GOLD_SHOVEL, pickaxe: ItemId.GOLD_PICKAXE, axe: ItemId.GOLD_AXE, hoe: ItemId.GOLD_HOE });

item(ItemId.SHEARS, 'shears', 'Shears', { maxStack: 1, durability: 238, toolCategory: 'shears', toolSpeed: 5, handheld: false });
item(ItemId.FLINT_AND_STEEL, 'flint_and_steel', 'Flint and Steel', { maxStack: 1, durability: 64 });
item(ItemId.BOW, 'bow', 'Bow', { maxStack: 1, durability: 384, enchantability: 1, handheld: true });
item(ItemId.FISHING_ROD, 'fishing_rod', 'Fishing Rod', { maxStack: 1, durability: 64, handheld: true, fuelTicks: 0 });

// ---------------------------------------------------------------------------
// Armor.
// ---------------------------------------------------------------------------
interface ArmorMaterial { name: string; display: string; base: number; points: [number, number, number, number]; ench: number }
const ARMOR_MULT = [11, 16, 15, 13];
const PIECES = [['helmet', 'Cap'], ['chestplate', 'Tunic'], ['leggings', 'Pants'], ['boots', 'Boots']] as const;
const PIECES_METAL = [['helmet', 'Helmet'], ['chestplate', 'Chestplate'], ['leggings', 'Leggings'], ['boots', 'Boots']] as const;
function armorSet(m: ArmorMaterial, ids: number[], leather: boolean): void {
  for (let slot = 0; slot < 4; slot++) {
    const [suffix, pieceName] = (leather ? PIECES : PIECES_METAL)[slot];
    item(ids[slot], `${m.name}_${suffix}`, `${m.display} ${pieceName}`, {
      maxStack: 1, durability: m.base * ARMOR_MULT[slot], armorSlot: slot as ArmorSlot,
      armorPoints: m.points[slot], enchantability: m.ench,
    });
  }
}
armorSet({ name: 'leather', display: 'Leather', base: 5, points: [1, 3, 2, 1], ench: 15 },
  [ItemId.LEATHER_HELMET, ItemId.LEATHER_CHESTPLATE, ItemId.LEATHER_LEGGINGS, ItemId.LEATHER_BOOTS], true);
armorSet({ name: 'gold', display: 'Golden', base: 7, points: [2, 5, 3, 1], ench: 25 },
  [ItemId.GOLD_HELMET, ItemId.GOLD_CHESTPLATE, ItemId.GOLD_LEGGINGS, ItemId.GOLD_BOOTS], false);
armorSet({ name: 'iron', display: 'Iron', base: 15, points: [2, 6, 5, 2], ench: 9 },
  [ItemId.IRON_HELMET, ItemId.IRON_CHESTPLATE, ItemId.IRON_LEGGINGS, ItemId.IRON_BOOTS], false);
armorSet({ name: 'diamond', display: 'Diamond', base: 33, points: [3, 8, 6, 3], ench: 10 },
  [ItemId.DIAMOND_HELMET, ItemId.DIAMOND_CHESTPLATE, ItemId.DIAMOND_LEGGINGS, ItemId.DIAMOND_BOOTS], false);

// ---------------------------------------------------------------------------
// Food. Status effect ids come from effects/effects.ts (kept numeric here to
// avoid a circular import): 17 hunger, 19 poison, 10 regeneration.
// ---------------------------------------------------------------------------
const food = (hunger: number, satMod: number, extra: Partial<FoodData> = {}): FoodData =>
  ({ hunger, saturation: hunger * satMod * 2, ...extra });

item(ItemId.APPLE, 'apple', 'Apple', { food: food(4, 0.3) });
item(ItemId.BREAD, 'bread', 'Bread', { food: food(5, 0.6) });
item(ItemId.RAW_PORKCHOP, 'porkchop', 'Raw Porkchop', { food: food(3, 0.3) });
item(ItemId.COOKED_PORKCHOP, 'cooked_porkchop', 'Cooked Porkchop', { food: food(8, 0.8) });
item(ItemId.RAW_BEEF, 'beef', 'Raw Beef', { food: food(3, 0.3) });
item(ItemId.COOKED_BEEF, 'cooked_beef', 'Steak', { food: food(8, 0.8) });
item(ItemId.RAW_CHICKEN, 'chicken', 'Raw Chicken', { food: food(2, 0.3, { effect: [17, 30, 0, 0.3] }) });
item(ItemId.COOKED_CHICKEN, 'cooked_chicken', 'Cooked Chicken', { food: food(6, 0.6) });
item(ItemId.RAW_FISH, 'fish', 'Raw Fish', { food: food(2, 0.3) });
item(ItemId.COOKED_FISH, 'cooked_fish', 'Cooked Fish', { food: food(5, 0.6) });
item(ItemId.MUSHROOM_STEW, 'mushroom_stew', 'Mushroom Stew', { maxStack: 1, food: food(6, 0.6, { remainder: ItemId.BOWL }) });
item(ItemId.COOKIE, 'cookie', 'Cookie', { maxStack: 8, food: food(2, 0.1) });
item(ItemId.MELON_SLICE, 'melon', 'Melon', { food: food(2, 0.3) });
item(ItemId.ROTTEN_FLESH, 'rotten_flesh', 'Rotten Flesh', { food: food(4, 0.1, { effect: [17, 30, 0, 0.8] }) });
item(ItemId.SPIDER_EYE, 'spider_eye', 'Spider Eye', { food: food(2, 0.8, { effect: [19, 5, 0, 1] }) });
item(ItemId.GOLDEN_APPLE, 'golden_apple', 'Golden Apple', { food: food(10, 1.2, { effect: [10, 30, 0, 1], alwaysEdible: true }) });

// ---------------------------------------------------------------------------
// Materials and miscellaneous items.
// ---------------------------------------------------------------------------
item(ItemId.ARROW, 'arrow', 'Arrow');
item(ItemId.COAL, 'coal', 'Coal', { fuelTicks: 1600 });
item(ItemId.CHARCOAL, 'charcoal', 'Charcoal', { fuelTicks: 1600 });
item(ItemId.DIAMOND, 'diamond', 'Diamond');
item(ItemId.IRON_INGOT, 'iron_ingot', 'Iron Ingot');
item(ItemId.GOLD_INGOT, 'gold_ingot', 'Gold Ingot');
item(ItemId.STICK, 'stick', 'Stick', { fuelTicks: 100, handheld: true });
item(ItemId.BOWL, 'bowl', 'Bowl');
item(ItemId.STRING, 'string', 'String', { placeBlock: 0 });
item(ItemId.FEATHER, 'feather', 'Feather');
item(ItemId.GUNPOWDER, 'gunpowder', 'Gunpowder');
item(ItemId.SEEDS, 'seeds', 'Seeds', { placeBlock: BlockId.WHEAT_CROP });
item(ItemId.WHEAT, 'wheat', 'Wheat');
item(ItemId.FLINT, 'flint', 'Flint');
item(ItemId.SIGN, 'sign', 'Sign', { maxStack: 16, placeBlock: BlockId.SIGN, fuelTicks: 0 });
item(ItemId.WOODEN_DOOR_ITEM, 'wooden_door', 'Wooden Door', { maxStack: 1, placeBlock: BlockId.WOODEN_DOOR });
item(ItemId.IRON_DOOR_ITEM, 'iron_door', 'Iron Door', { maxStack: 1, placeBlock: BlockId.IRON_DOOR });
item(ItemId.BUCKET, 'bucket', 'Bucket', { maxStack: 16 });
item(ItemId.WATER_BUCKET, 'water_bucket', 'Water Bucket', { maxStack: 1, craftRemainder: ItemId.BUCKET });
item(ItemId.LAVA_BUCKET, 'lava_bucket', 'Lava Bucket', { maxStack: 1, fuelTicks: 20000, craftRemainder: ItemId.BUCKET });
item(ItemId.MILK_BUCKET, 'milk_bucket', 'Milk', { maxStack: 1, craftRemainder: ItemId.BUCKET });
item(ItemId.MINECART, 'minecart', 'Minecart', { maxStack: 1 });
item(ItemId.BOAT, 'boat', 'Boat', { maxStack: 1 });
item(ItemId.REDSTONE, 'redstone', 'Redstone', { placeBlock: BlockId.REDSTONE_WIRE });
item(ItemId.SNOWBALL, 'snowball', 'Snowball', { maxStack: 16 });
item(ItemId.LEATHER, 'leather', 'Leather');
item(ItemId.BRICK, 'brick', 'Brick');
item(ItemId.CLAY_BALL, 'clay_ball', 'Clay');
item(ItemId.SUGAR_CANE_ITEM, 'reeds', 'Sugar Canes', { placeBlock: BlockId.SUGAR_CANE });
item(ItemId.PAPER, 'paper', 'Paper');
item(ItemId.BOOK, 'book', 'Book');
item(ItemId.SLIMEBALL, 'slime_ball', 'Slimeball');
item(ItemId.EGG, 'egg', 'Egg', { maxStack: 16 });
item(ItemId.COMPASS, 'compass', 'Compass', { maxStack: 1 });
item(ItemId.CLOCK, 'clock', 'Clock', { maxStack: 1 });
item(ItemId.MAP, 'map', 'Map', { maxStack: 1 });
item(ItemId.GLOWSTONE_DUST, 'glowstone_dust', 'Glowstone Dust');
item(ItemId.DYE, 'dye', 'Dye', { subtypes: 16 });
item(ItemId.BONE, 'bone', 'Bone', { handheld: true });
item(ItemId.SUGAR, 'sugar', 'Sugar');
item(ItemId.CAKE_ITEM, 'cake', 'Cake', { maxStack: 1, placeBlock: BlockId.CAKE });
item(ItemId.BED_ITEM, 'bed', 'Bed', { maxStack: 1, placeBlock: BlockId.BED });
item(ItemId.REPEATER_ITEM, 'repeater', 'Redstone Repeater', { placeBlock: BlockId.REPEATER_OFF });
item(ItemId.PUMPKIN_SEEDS, 'pumpkin_seeds', 'Pumpkin Seeds', { placeBlock: BlockId.PUMPKIN_STEM });
item(ItemId.MELON_SEEDS, 'melon_seeds', 'Melon Seeds', { placeBlock: BlockId.MELON_STEM });
item(ItemId.ENDER_PEARL, 'ender_pearl', 'Ender Pearl', { maxStack: 16 });
item(ItemId.BLAZE_ROD, 'blaze_rod', 'Blaze Rod', { fuelTicks: 2400, handheld: true });
item(ItemId.GHAST_TEAR, 'ghast_tear', 'Ghast Tear');
item(ItemId.GOLD_NUGGET, 'gold_nugget', 'Gold Nugget');
item(ItemId.NETHER_WART_ITEM, 'nether_wart', 'Nether Wart', { placeBlock: BlockId.NETHER_WART });
item(ItemId.POTION, 'potion', 'Potion', { maxStack: 1, subtypes: 32768 });
item(ItemId.GLASS_BOTTLE, 'glass_bottle', 'Glass Bottle');
item(ItemId.FERMENTED_SPIDER_EYE, 'fermented_spider_eye', 'Fermented Spider Eye');
item(ItemId.BLAZE_POWDER, 'blaze_powder', 'Blaze Powder');
item(ItemId.MAGMA_CREAM, 'magma_cream', 'Magma Cream');
item(ItemId.BREWING_STAND_ITEM, 'brewing_stand', 'Brewing Stand', { placeBlock: BlockId.BREWING_STAND });
item(ItemId.CAULDRON_ITEM, 'cauldron', 'Cauldron', { placeBlock: BlockId.CAULDRON });
item(ItemId.EYE_OF_ENDER, 'ender_eye', 'Eye of Ender');
item(ItemId.GLISTERING_MELON, 'speckled_melon', 'Glistering Melon');

// ---------------------------------------------------------------------------
// Queries.
// ---------------------------------------------------------------------------
export function getItem(id: number): ItemDefinition | undefined {
  return items.get(id);
}

export function requireItem(id: number): ItemDefinition {
  const def = items.get(id);
  if (!def) throw new Error(`Unknown item id ${id}`);
  return def;
}

export function allItems(): ItemDefinition[] {
  return Array.from(items.values());
}

const DYE_NAMES = [
  'Ink Sac', 'Rose Red', 'Cactus Green', 'Cocoa Beans', 'Lapis Lazuli', 'Purple Dye', 'Cyan Dye',
  'Light Gray Dye', 'Gray Dye', 'Pink Dye', 'Lime Dye', 'Dandelion Yellow', 'Light Blue Dye',
  'Magenta Dye', 'Orange Dye', 'Bone Meal',
];

/** Human readable name for an item including its metadata variant. */
export function itemDisplayName(id: number, meta: number): string {
  const def = items.get(id);
  if (!def) return `Unknown (${id})`;
  switch (id) {
    case BlockId.WOOL: return `${DYE_COLOR_NAMES[meta & 15]} Wool`;
    case BlockId.LOG: return `${WOOD_DISPLAY[meta % 3]} Wood`;
    case BlockId.PLANKS: return `${WOOD_DISPLAY[meta % 3]} Planks`;
    case BlockId.SAPLING: return `${WOOD_DISPLAY[meta % 3]} Sapling`;
    case BlockId.LEAVES: return `${WOOD_DISPLAY[meta % 3]} Leaves`;
    case BlockId.SLAB: return slabDisplayName(meta);
    case BlockId.STONE_BRICKS: return stoneBrickDisplayName(meta);
    case BlockId.TALL_GRASS: return meta === 2 ? 'Fern' : meta === 0 ? 'Shrub' : 'Tall Grass';
    case ItemId.DYE: return DYE_NAMES[meta & 15];
    case ItemId.POTION: return potionName(meta);
    default: return def.displayName;
  }
}

/** Potion metadata layout (original scheme, not the historical bit soup):
 *  bits 0-3 potion kind, bit 5 = level II, bit 6 = extended, bit 14 = splash. */
export const PotionKind = {
  WATER: 0, AWKWARD: 1, THICK: 2, MUNDANE: 3, REGENERATION: 4, SWIFTNESS: 5, FIRE_RESISTANCE: 6,
  POISON: 7, HEALING: 8, WEAKNESS: 9, STRENGTH: 10, SLOWNESS: 11, HARMING: 12,
} as const;
export const POTION_LEVEL2 = 32;
export const POTION_EXTENDED = 64;
export const POTION_SPLASH = 16384;

const POTION_NAMES = [
  'Water Bottle', 'Awkward Potion', 'Thick Potion', 'Mundane Potion', 'Potion of Regeneration',
  'Potion of Swiftness', 'Potion of Fire Resistance', 'Potion of Poison', 'Potion of Healing',
  'Potion of Weakness', 'Potion of Strength', 'Potion of Slowness', 'Potion of Harming',
];

export function potionName(meta: number): string {
  const kind = meta & 15;
  let name = POTION_NAMES[kind] ?? 'Potion';
  if (meta & POTION_SPLASH) name = kind === 0 ? 'Splash Water Bottle' : `Splash ${name}`;
  if (meta & POTION_LEVEL2) name += ' II';
  return name;
}

/** Whether the item is a block that can be placed. */
export function placedBlockOf(id: number): number {
  return items.get(id)?.placeBlock ?? 0;
}

export function isArmor(id: number): boolean {
  return (items.get(id)?.armorSlot ?? -1) >= 0;
}

export function blockItemName(id: number): string {
  return getBlock(id).displayName;
}

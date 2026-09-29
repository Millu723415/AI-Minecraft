/**
 * All crafting and smelting recipes of the game, expressed as data.
 * The set follows the late-2011 release era; later recipes are left out.
 */

import { BlockId, SlabType } from '../blocks/ids';
import { ItemId, DyeMeta, DYE_TO_WOOL } from '../items/ids';
import type { Ingredient, Recipe, SmeltingRecipe } from './types';

const I = (id: number, meta?: number): Ingredient => ({ id, meta });
const recipes: Recipe[] = [];

function shaped(pattern: string[], key: Record<string, Ingredient>, id: number, count = 1, meta?: number): void {
  recipes.push({ type: 'shaped', pattern, key, result: { id, count, meta } });
}
function shapeless(ingredients: Ingredient[], id: number, count = 1, meta?: number): void {
  recipes.push({ type: 'shapeless', ingredients, result: { id, count, meta } });
}

const PLANKS = I(BlockId.PLANKS);
const STICK = I(ItemId.STICK);
const COBBLE = I(BlockId.COBBLESTONE);
const IRON = I(ItemId.IRON_INGOT);
const GOLD = I(ItemId.GOLD_INGOT);
const DIAMOND = I(ItemId.DIAMOND);
const REDSTONE = I(ItemId.REDSTONE);
const STRING = I(ItemId.STRING);

// --- Wood basics --------------------------------------------------------
for (let w = 0; w < 3; w++) shapeless([I(BlockId.LOG, w)], BlockId.PLANKS, 4, w);
shaped(['#', '#'], { '#': PLANKS }, ItemId.STICK, 4);
shaped(['##', '##'], { '#': PLANKS }, BlockId.CRAFTING_TABLE);
shaped(['###', '# #', '###'], { '#': PLANKS }, BlockId.CHEST);
shaped(['###', '# #', '###'], { '#': COBBLE }, BlockId.FURNACE);
shaped(['C', 'S'], { C: I(ItemId.COAL), S: STICK }, BlockId.TORCH, 4);
shaped(['C', 'S'], { C: I(ItemId.CHARCOAL), S: STICK }, BlockId.TORCH, 4);

// --- Tools ---------------------------------------------------------------
const toolMaterials: [Ingredient, number[]][] = [
  [PLANKS, [ItemId.WOODEN_PICKAXE, ItemId.WOODEN_AXE, ItemId.WOODEN_SHOVEL, ItemId.WOODEN_SWORD, ItemId.WOODEN_HOE]],
  [COBBLE, [ItemId.STONE_PICKAXE, ItemId.STONE_AXE, ItemId.STONE_SHOVEL, ItemId.STONE_SWORD, ItemId.STONE_HOE]],
  [IRON, [ItemId.IRON_PICKAXE, ItemId.IRON_AXE, ItemId.IRON_SHOVEL, ItemId.IRON_SWORD, ItemId.IRON_HOE]],
  [GOLD, [ItemId.GOLD_PICKAXE, ItemId.GOLD_AXE, ItemId.GOLD_SHOVEL, ItemId.GOLD_SWORD, ItemId.GOLD_HOE]],
  [DIAMOND, [ItemId.DIAMOND_PICKAXE, ItemId.DIAMOND_AXE, ItemId.DIAMOND_SHOVEL, ItemId.DIAMOND_SWORD, ItemId.DIAMOND_HOE]],
];
for (const [mat, [pick, axe, shovel, sword, hoe]] of toolMaterials) {
  shaped(['XXX', ' # ', ' # '], { X: mat, '#': STICK }, pick);
  shaped(['XX', 'X#', ' #'], { X: mat, '#': STICK }, axe);
  shaped(['X', '#', '#'], { X: mat, '#': STICK }, shovel);
  shaped(['X', 'X', '#'], { X: mat, '#': STICK }, sword);
  shaped(['XX', ' #', ' #'], { X: mat, '#': STICK }, hoe);
}
shaped([' #', '# '], { '#': IRON }, ItemId.SHEARS);
shapeless([IRON, I(ItemId.FLINT)], ItemId.FLINT_AND_STEEL);
shaped([' #S', '# S', ' #S'], { '#': STICK, S: STRING }, ItemId.BOW);
shaped(['F', '#', 'E'], { F: I(ItemId.FLINT), '#': STICK, E: I(ItemId.FEATHER) }, ItemId.ARROW, 4);
shaped(['  #', ' #S', '# S'], { '#': STICK, S: STRING }, ItemId.FISHING_ROD);
shaped(['# #', ' # '], { '#': IRON }, ItemId.BUCKET);
shaped([' # ', '#R#', ' # '], { '#': IRON, R: REDSTONE }, ItemId.COMPASS);
shaped([' # ', '#R#', ' # '], { '#': GOLD, R: REDSTONE }, ItemId.CLOCK);
shaped(['###', '#C#', '###'], { '#': I(ItemId.PAPER), C: I(ItemId.COMPASS) }, ItemId.MAP);

// --- Armor ---------------------------------------------------------------
const armorMaterials: [Ingredient, number[]][] = [
  [I(ItemId.LEATHER), [ItemId.LEATHER_HELMET, ItemId.LEATHER_CHESTPLATE, ItemId.LEATHER_LEGGINGS, ItemId.LEATHER_BOOTS]],
  [IRON, [ItemId.IRON_HELMET, ItemId.IRON_CHESTPLATE, ItemId.IRON_LEGGINGS, ItemId.IRON_BOOTS]],
  [GOLD, [ItemId.GOLD_HELMET, ItemId.GOLD_CHESTPLATE, ItemId.GOLD_LEGGINGS, ItemId.GOLD_BOOTS]],
  [DIAMOND, [ItemId.DIAMOND_HELMET, ItemId.DIAMOND_CHESTPLATE, ItemId.DIAMOND_LEGGINGS, ItemId.DIAMOND_BOOTS]],
];
for (const [mat, [helmet, chest, legs, boots]] of armorMaterials) {
  shaped(['XXX', 'X X'], { X: mat }, helmet);
  shaped(['X X', 'XXX', 'XXX'], { X: mat }, chest);
  shaped(['XXX', 'X X', 'X X'], { X: mat }, legs);
  shaped(['X X', 'X X'], { X: mat }, boots);
}

// --- Building blocks -----------------------------------------------------
shaped(['##', '##'], { '#': I(BlockId.SAND) }, BlockId.SANDSTONE);
shaped(['##', '##'], { '#': I(BlockId.STONE) }, BlockId.STONE_BRICKS, 4);
shaped(['##', '##'], { '#': I(ItemId.BRICK) }, BlockId.BRICKS);
shaped(['##', '##'], { '#': I(ItemId.CLAY_BALL) }, BlockId.CLAY);
shaped(['##', '##'], { '#': I(ItemId.SNOWBALL) }, BlockId.SNOW_BLOCK);
shaped(['##', '##'], { '#': STRING }, BlockId.WOOL, 1, 0);
shaped(['###', '###'], { '#': I(BlockId.GLASS) }, BlockId.GLASS_PANE, 16);
shaped(['###', '###'], { '#': IRON }, BlockId.IRON_BARS, 16);
shaped(['###', '###'], { '#': I(BlockId.NETHER_BRICK) }, BlockId.NETHER_BRICK_FENCE, 6);
shaped(['###', 'BBB', '###'], { '#': PLANKS, B: I(ItemId.BOOK) }, BlockId.BOOKSHELF);
shaped(['GSG', 'SGS', 'GSG'], { G: I(ItemId.GUNPOWDER), S: I(BlockId.SAND) }, BlockId.TNT);
shaped(['###', '###', '###'], { '#': I(ItemId.MELON_SLICE) }, BlockId.MELON_BLOCK);
shaped(['P', 'T'], { P: I(BlockId.PUMPKIN), T: I(BlockId.TORCH) }, BlockId.JACK_O_LANTERN);
shaped(['###', '#D#', '###'], { '#': PLANKS, D: DIAMOND }, BlockId.JUKEBOX);
shaped(['###', '#R#', '###'], { '#': PLANKS, R: REDSTONE }, BlockId.NOTE_BLOCK);

const storage: [number, Ingredient, number][] = [
  [BlockId.IRON_BLOCK, IRON, ItemId.IRON_INGOT],
  [BlockId.GOLD_BLOCK, GOLD, ItemId.GOLD_INGOT],
  [BlockId.DIAMOND_BLOCK, DIAMOND, ItemId.DIAMOND],
  [BlockId.LAPIS_BLOCK, I(ItemId.DYE, DyeMeta.LAPIS_LAZULI), ItemId.DYE],
];
for (const [block, ing, back] of storage) {
  shaped(['###', '###', '###'], { '#': ing }, block);
  shapeless([I(block)], back, 9, back === ItemId.DYE ? DyeMeta.LAPIS_LAZULI : undefined);
}
shaped(['###', '###', '###'], { '#': I(ItemId.GOLD_NUGGET) }, ItemId.GOLD_INGOT);

// Stairs (4 per craft) and slabs (3 per craft).
const stairs: [Ingredient, number][] = [
  [PLANKS, BlockId.OAK_STAIRS], [COBBLE, BlockId.COBBLESTONE_STAIRS], [I(BlockId.BRICKS), BlockId.BRICK_STAIRS],
  [I(BlockId.STONE_BRICKS), BlockId.STONE_BRICK_STAIRS], [I(BlockId.NETHER_BRICK), BlockId.NETHER_BRICK_STAIRS],
];
for (const [mat, out] of stairs) shaped(['#  ', '## ', '###'], { '#': mat }, out, 4);
const slabs: [Ingredient, number][] = [
  [I(BlockId.STONE), SlabType.STONE], [I(BlockId.SANDSTONE), SlabType.SANDSTONE], [PLANKS, SlabType.WOOD],
  [COBBLE, SlabType.COBBLESTONE], [I(BlockId.BRICKS), SlabType.BRICK], [I(BlockId.STONE_BRICKS), SlabType.STONE_BRICK],
];
for (const [mat, meta] of slabs) shaped(['###'], { '#': mat }, BlockId.SLAB, 3, meta);

// --- Doors, fences, ladders, signs --------------------------------------
shaped(['##', '##', '##'], { '#': PLANKS }, ItemId.WOODEN_DOOR_ITEM);
shaped(['##', '##', '##'], { '#': IRON }, ItemId.IRON_DOOR_ITEM);
shaped(['###', '###'], { '#': PLANKS }, BlockId.TRAPDOOR, 2);
shaped(['###', '###'], { '#': STICK }, BlockId.FENCE, 2);
shaped(['#W#', '#W#'], { '#': STICK, W: PLANKS }, BlockId.FENCE_GATE);
shaped(['# #', '###', '# #'], { '#': STICK }, BlockId.LADDER, 2);
shaped(['###', '###', ' S '], { '#': PLANKS, S: STICK }, ItemId.SIGN);
shaped(['WWW', 'PPP'], { W: I(BlockId.WOOL), P: PLANKS }, ItemId.BED_ITEM);

// --- Transport ------------------------------------------------------------
shaped(['# #', '#S#', '# #'], { '#': IRON, S: STICK }, BlockId.RAIL, 16);
shaped(['# #', '#S#', '#R#'], { '#': GOLD, S: STICK, R: REDSTONE }, BlockId.POWERED_RAIL, 6);
shaped(['# #', '#P#', '#R#'], { '#': IRON, P: I(BlockId.STONE_PRESSURE_PLATE), R: REDSTONE }, BlockId.DETECTOR_RAIL, 6);
shaped(['# #', '###'], { '#': IRON }, ItemId.MINECART);
shaped(['# #', '###'], { '#': PLANKS }, ItemId.BOAT);

// --- Redstone ---------------------------------------------------------------
shaped(['R', 'S'], { R: REDSTONE, S: STICK }, BlockId.REDSTONE_TORCH);
shaped(['S', 'C'], { S: STICK, C: COBBLE }, BlockId.LEVER);
shaped(['#', '#'], { '#': I(BlockId.STONE) }, BlockId.STONE_BUTTON);
shaped(['##'], { '#': I(BlockId.STONE) }, BlockId.STONE_PRESSURE_PLATE);
shaped(['##'], { '#': PLANKS }, BlockId.WOODEN_PRESSURE_PLATE);
shaped(['TRT', 'SSS'], { T: I(BlockId.REDSTONE_TORCH), R: REDSTONE, S: I(BlockId.STONE) }, ItemId.REPEATER_ITEM);
shaped(['PPP', 'CIC', 'CRC'], { P: PLANKS, C: COBBLE, I: IRON, R: REDSTONE }, BlockId.PISTON);
shaped(['S', 'P'], { S: I(ItemId.SLIMEBALL), P: I(BlockId.PISTON) }, BlockId.STICKY_PISTON);

// --- Food -------------------------------------------------------------------
shaped(['###'], { '#': I(ItemId.WHEAT) }, ItemId.BREAD);
shaped(['# #', ' # '], { '#': PLANKS }, ItemId.BOWL, 4);
shapeless([I(BlockId.BROWN_MUSHROOM), I(BlockId.RED_MUSHROOM), I(ItemId.BOWL)], ItemId.MUSHROOM_STEW);
shaped(['MMM', 'SES', 'WWW'], { M: I(ItemId.MILK_BUCKET), S: I(ItemId.SUGAR), E: I(ItemId.EGG), W: I(ItemId.WHEAT) }, ItemId.CAKE_ITEM);
shaped(['WCW'], { W: I(ItemId.WHEAT), C: I(ItemId.DYE, DyeMeta.COCOA_BEANS) }, ItemId.COOKIE, 8);
shaped(['###', '#A#', '###'], { '#': I(BlockId.GOLD_BLOCK), A: I(ItemId.APPLE) }, ItemId.GOLDEN_APPLE);
shapeless([I(ItemId.SUGAR_CANE_ITEM)], ItemId.SUGAR);
shaped(['###'], { '#': I(ItemId.SUGAR_CANE_ITEM) }, ItemId.PAPER, 3);
shaped(['#', '#', '#'], { '#': I(ItemId.PAPER) }, ItemId.BOOK);
shapeless([I(ItemId.MELON_SLICE)], ItemId.MELON_SEEDS);
shapeless([I(BlockId.PUMPKIN)], ItemId.PUMPKIN_SEEDS, 4);

// --- Brewing / Ender progression ----------------------------------------
shaped([' B ', '###'], { B: I(ItemId.BLAZE_ROD), '#': COBBLE }, ItemId.BREWING_STAND_ITEM);
shaped(['# #', '# #', '###'], { '#': IRON }, ItemId.CAULDRON_ITEM);
shaped(['# #', ' # '], { '#': I(BlockId.GLASS) }, ItemId.GLASS_BOTTLE, 3);
shaped([' B ', 'D#D', '###'], { B: I(ItemId.BOOK), D: DIAMOND, '#': I(BlockId.OBSIDIAN) }, BlockId.ENCHANTING_TABLE);
shapeless([I(ItemId.BLAZE_ROD)], ItemId.BLAZE_POWDER, 2);
shapeless([I(ItemId.ENDER_PEARL), I(ItemId.BLAZE_POWDER)], ItemId.EYE_OF_ENDER);
shapeless([I(ItemId.SLIMEBALL), I(ItemId.BLAZE_POWDER)], ItemId.MAGMA_CREAM);
shapeless([I(ItemId.SPIDER_EYE), I(BlockId.BROWN_MUSHROOM), I(ItemId.SUGAR)], ItemId.FERMENTED_SPIDER_EYE);
shapeless([I(ItemId.MELON_SLICE), I(ItemId.GOLD_NUGGET)], ItemId.GLISTERING_MELON);

// --- Dyes -----------------------------------------------------------------
shapeless([I(BlockId.ROSE)], ItemId.DYE, 2, DyeMeta.RED);
shapeless([I(BlockId.DANDELION)], ItemId.DYE, 2, DyeMeta.YELLOW);
shapeless([I(ItemId.BONE)], ItemId.DYE, 3, DyeMeta.BONE_MEAL);
const D = (m: number) => I(ItemId.DYE, m);
shapeless([D(DyeMeta.RED), D(DyeMeta.YELLOW)], ItemId.DYE, 2, DyeMeta.ORANGE);
shapeless([D(DyeMeta.RED), D(DyeMeta.BONE_MEAL)], ItemId.DYE, 2, DyeMeta.PINK);
shapeless([D(DyeMeta.GREEN), D(DyeMeta.BONE_MEAL)], ItemId.DYE, 2, DyeMeta.LIME);
shapeless([D(DyeMeta.LAPIS_LAZULI), D(DyeMeta.BONE_MEAL)], ItemId.DYE, 2, DyeMeta.LIGHT_BLUE);
shapeless([D(DyeMeta.LAPIS_LAZULI), D(DyeMeta.RED)], ItemId.DYE, 2, DyeMeta.PURPLE);
shapeless([D(DyeMeta.LAPIS_LAZULI), D(DyeMeta.GREEN)], ItemId.DYE, 2, DyeMeta.CYAN);
shapeless([D(DyeMeta.INK_SAC), D(DyeMeta.BONE_MEAL)], ItemId.DYE, 2, DyeMeta.GRAY);
shapeless([D(DyeMeta.GRAY), D(DyeMeta.BONE_MEAL)], ItemId.DYE, 2, DyeMeta.LIGHT_GRAY);
shapeless([D(DyeMeta.INK_SAC), D(DyeMeta.BONE_MEAL), D(DyeMeta.BONE_MEAL)], ItemId.DYE, 3, DyeMeta.LIGHT_GRAY);
shapeless([D(DyeMeta.PURPLE), D(DyeMeta.PINK)], ItemId.DYE, 2, DyeMeta.MAGENTA);
shapeless([D(DyeMeta.LAPIS_LAZULI), D(DyeMeta.RED), D(DyeMeta.PINK)], ItemId.DYE, 3, DyeMeta.MAGENTA);
// Dyed wool: any wool + a dye.
for (let dye = 0; dye < 16; dye++) {
  shapeless([D(dye), I(BlockId.WOOL)], BlockId.WOOL, 1, DYE_TO_WOOL[dye]);
}

export const CRAFTING_RECIPES: readonly Recipe[] = recipes;

// --- Smelting -------------------------------------------------------------
export const SMELTING_RECIPES: readonly SmeltingRecipe[] = [
  { input: I(BlockId.IRON_ORE), result: { id: ItemId.IRON_INGOT, count: 1 }, xp: 0.7 },
  { input: I(BlockId.GOLD_ORE), result: { id: ItemId.GOLD_INGOT, count: 1 }, xp: 1 },
  { input: I(BlockId.DIAMOND_ORE), result: { id: ItemId.DIAMOND, count: 1 }, xp: 1 },
  { input: I(BlockId.COAL_ORE), result: { id: ItemId.COAL, count: 1 }, xp: 0.1 },
  { input: I(BlockId.SAND), result: { id: BlockId.GLASS, count: 1 }, xp: 0.1 },
  { input: I(BlockId.COBBLESTONE), result: { id: BlockId.STONE, count: 1 }, xp: 0.1 },
  { input: I(ItemId.CLAY_BALL), result: { id: ItemId.BRICK, count: 1 }, xp: 0.3 },
  { input: I(BlockId.LOG), result: { id: ItemId.CHARCOAL, count: 1 }, xp: 0.15 },
  { input: I(BlockId.CACTUS), result: { id: ItemId.DYE, count: 1, meta: DyeMeta.GREEN }, xp: 0.2 },
  { input: I(ItemId.RAW_PORKCHOP), result: { id: ItemId.COOKED_PORKCHOP, count: 1 }, xp: 0.35 },
  { input: I(ItemId.RAW_BEEF), result: { id: ItemId.COOKED_BEEF, count: 1 }, xp: 0.35 },
  { input: I(ItemId.RAW_CHICKEN), result: { id: ItemId.COOKED_CHICKEN, count: 1 }, xp: 0.35 },
  { input: I(ItemId.RAW_FISH), result: { id: ItemId.COOKED_FISH, count: 1 }, xp: 0.35 },
];

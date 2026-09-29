/**
 * The block registry: every block of the game is described here as data.
 *
 * Engine systems (mesher, lighting, physics, mining, explosions) read these
 * definitions instead of hard-coding per-block behaviour wherever possible.
 */

import { BlockId, SlabType, StoneBrickType, WoodType } from './ids';
import { ItemId, DyeMeta } from '../items/ids';
import type {
  BlockDefinition, BlockOptions, DropSpec, DropResolver, FaceTextures, ToolCategory,
} from './types';
import type { Random } from '../core/rng';

export const MAX_BLOCK_ID = 256;

const blocks: (BlockDefinition | undefined)[] = new Array(MAX_BLOCK_ID);
const dropResolvers = new Map<number, DropResolver>();

function defaults(id: number): Omit<BlockDefinition, 'id' | 'name' | 'displayName'> {
  return {
    shape: 'cube',
    pass: 'opaque',
    solid: true,
    collides: true,
    lightOpacity: 15,
    lightEmission: 0,
    hardness: 1,
    resistance: 5,
    toolCategory: null,
    harvestLevel: 0,
    requiresTool: false,
    drops: null,
    xp: null,
    tint: 'none',
    replaceable: false,
    gravity: false,
    flammable: 0,
    slipperiness: 0.6,
    variants: 1,
    textures: () => ({ all: 'missing' }),
    itemId: id,
    maxStack: 64,
    needsSupport: false,
    randomTick: false,
    fluid: 'none',
    contactDamage: 0,
    interactive: false,
  };
}

function define(id: number, name: string, displayName: string, options: BlockOptions): BlockDefinition {
  const def: BlockDefinition = { ...defaults(id), ...options, id, name, displayName };
  blocks[id] = def;
  return def;
}

/** Non-solid, non-colliding decorative plant. */
function plant(extra: BlockOptions = {}): BlockOptions {
  return {
    shape: 'cross', pass: 'cutout', solid: false, collides: false, lightOpacity: 0,
    hardness: 0, resistance: 0, needsSupport: true, replaceable: false, ...extra,
  };
}

const tex = (all: string): (() => FaceTextures) => () => ({ all });
const texTSB = (top: string, side: string, bottom = top): (() => FaceTextures) =>
  () => ({ top, side, bottom });

const WOOD_NAMES = ['oak', 'spruce', 'birch'];

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------
define(BlockId.AIR, 'air', 'Air', {
  shape: 'none', solid: false, collides: false, lightOpacity: 0, hardness: 0, replaceable: true, itemId: 0,
});
define(BlockId.STONE, 'stone', 'Stone', {
  hardness: 1.5, resistance: 30, toolCategory: 'pickaxe', requiresTool: true,
  drops: [{ item: BlockId.COBBLESTONE }], textures: tex('stone'),
});
define(BlockId.GRASS, 'grass', 'Grass Block', {
  hardness: 0.6, resistance: 3, toolCategory: 'shovel', drops: [{ item: BlockId.DIRT }],
  tint: 'grass', randomTick: true,
  textures: () => ({ top: 'grass_top', side: 'grass_side', bottom: 'dirt' }),
});
define(BlockId.DIRT, 'dirt', 'Dirt', {
  hardness: 0.5, resistance: 2.5, toolCategory: 'shovel', textures: tex('dirt'),
});
define(BlockId.COBBLESTONE, 'cobblestone', 'Cobblestone', {
  hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true, textures: tex('cobblestone'),
});
define(BlockId.PLANKS, 'planks', 'Wooden Planks', {
  hardness: 2, resistance: 15, toolCategory: 'axe', flammable: 20, variants: 3,
  textures: (m) => ({ all: `planks_${WOOD_NAMES[m % 3]}` }),
});
define(BlockId.SAPLING, 'sapling', 'Sapling', plant({
  variants: 3, randomTick: true, textures: (m) => ({ all: `sapling_${WOOD_NAMES[m % 3]}` }),
}));
define(BlockId.BEDROCK, 'bedrock', 'Bedrock', {
  hardness: -1, resistance: 18000000, textures: tex('bedrock'),
});
define(BlockId.WATER_FLOWING, 'flowing_water', 'Water', {
  shape: 'fluid', pass: 'translucent', solid: false, collides: false, lightOpacity: 2,
  hardness: 100, resistance: 500, replaceable: true, drops: [], fluid: 'water', tint: 'water',
  textures: tex('water'), itemId: 0,
});
define(BlockId.WATER, 'water', 'Water', {
  shape: 'fluid', pass: 'translucent', solid: false, collides: false, lightOpacity: 2,
  hardness: 100, resistance: 500, replaceable: true, drops: [], fluid: 'water', tint: 'water',
  textures: tex('water'), itemId: 0,
});
define(BlockId.LAVA_FLOWING, 'flowing_lava', 'Lava', {
  shape: 'fluid', pass: 'opaque', solid: false, collides: false, lightOpacity: 0, lightEmission: 15,
  hardness: 100, resistance: 500, replaceable: true, drops: [], fluid: 'lava', contactDamage: 4,
  textures: tex('lava'), itemId: 0,
});
define(BlockId.LAVA, 'lava', 'Lava', {
  shape: 'fluid', pass: 'opaque', solid: false, collides: false, lightOpacity: 0, lightEmission: 15,
  hardness: 100, resistance: 500, replaceable: true, drops: [], fluid: 'lava', contactDamage: 4,
  randomTick: true, textures: tex('lava'), itemId: 0,
});
define(BlockId.SAND, 'sand', 'Sand', {
  hardness: 0.5, resistance: 2.5, toolCategory: 'shovel', gravity: true, textures: tex('sand'),
});
define(BlockId.GRAVEL, 'gravel', 'Gravel', {
  hardness: 0.6, resistance: 3, toolCategory: 'shovel', gravity: true, textures: tex('gravel'),
});
define(BlockId.GOLD_ORE, 'gold_ore', 'Gold Ore', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', harvestLevel: 2, requiresTool: true,
  textures: tex('gold_ore'),
});
define(BlockId.IRON_ORE, 'iron_ore', 'Iron Ore', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', harvestLevel: 1, requiresTool: true,
  textures: tex('iron_ore'),
});
define(BlockId.COAL_ORE, 'coal_ore', 'Coal Ore', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', requiresTool: true,
  drops: [{ item: ItemId.COAL }], xp: [0, 2], textures: tex('coal_ore'),
});
define(BlockId.LOG, 'log', 'Wood', {
  hardness: 2, resistance: 10, toolCategory: 'axe', flammable: 5, variants: 3,
  textures: (m) => ({ top: `log_${WOOD_NAMES[m % 3]}_top`, bottom: `log_${WOOD_NAMES[m % 3]}_top`, side: `log_${WOOD_NAMES[m % 3]}` }),
});
define(BlockId.LEAVES, 'leaves', 'Leaves', {
  pass: 'cutout', solid: false, lightOpacity: 1, hardness: 0.2, resistance: 1,
  toolCategory: 'shears', flammable: 60, variants: 3, randomTick: true, tint: 'foliage',
  textures: (m) => ({ all: `leaves_${WOOD_NAMES[m % 3]}` }),
});
define(BlockId.SPONGE, 'sponge', 'Sponge', { hardness: 0.6, resistance: 3, textures: tex('sponge') });
define(BlockId.GLASS, 'glass', 'Glass', {
  pass: 'cutout', solid: false, lightOpacity: 0, hardness: 0.3, resistance: 1.5, drops: [],
  textures: tex('glass'),
});
define(BlockId.LAPIS_ORE, 'lapis_ore', 'Lapis Lazuli Ore', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', harvestLevel: 1, requiresTool: true,
  xp: [2, 5], textures: tex('lapis_ore'),
});
define(BlockId.LAPIS_BLOCK, 'lapis_block', 'Lapis Lazuli Block', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', harvestLevel: 1, requiresTool: true,
  textures: tex('lapis_block'),
});
define(BlockId.SANDSTONE, 'sandstone', 'Sandstone', {
  hardness: 0.8, resistance: 4, toolCategory: 'pickaxe', requiresTool: true,
  textures: () => ({ top: 'sandstone_top', side: 'sandstone_side', bottom: 'sandstone_bottom' }),
});
define(BlockId.NOTE_BLOCK, 'note_block', 'Note Block', {
  hardness: 0.8, resistance: 4, toolCategory: 'axe', interactive: true, flammable: 5,
  textures: tex('noteblock'),
});
define(BlockId.BED, 'bed', 'Bed', {
  shape: 'bed', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 0.2, resistance: 1,
  interactive: true, itemId: ItemId.BED_ITEM, drops: [], maxStack: 1, variants: 16,
  textures: () => ({ top: 'bed_top', side: 'bed_side', bottom: 'planks_oak' }),
  collisionBoxes: () => [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.5625, maxZ: 1 }],
});
define(BlockId.POWERED_RAIL, 'powered_rail', 'Powered Rail', {
  shape: 'flat', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0.7,
  resistance: 3.5, toolCategory: 'pickaxe', needsSupport: true, variants: 16,
  textures: (m) => ({ all: m & 8 ? 'rail_powered_on' : 'rail_powered' }),
});
define(BlockId.DETECTOR_RAIL, 'detector_rail', 'Detector Rail', {
  shape: 'flat', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0.7,
  resistance: 3.5, toolCategory: 'pickaxe', needsSupport: true, variants: 16,
  textures: () => ({ all: 'rail_detector' }),
});
define(BlockId.STICKY_PISTON, 'sticky_piston', 'Sticky Piston', {
  shape: 'piston', hardness: 0.5, resistance: 2.5, toolCategory: 'pickaxe', variants: 16,
  solid: false, lightOpacity: 15,
  textures: () => ({ top: 'piston_top_sticky', side: 'piston_side', bottom: 'piston_bottom' }),
});
define(BlockId.COBWEB, 'cobweb', 'Cobweb', plant({
  hardness: 4, resistance: 20, toolCategory: 'sword', needsSupport: false,
  drops: [{ item: ItemId.STRING }], textures: tex('cobweb'),
}));
define(BlockId.TALL_GRASS, 'tall_grass', 'Tall Grass', plant({
  replaceable: true, tint: 'grass', variants: 3, flammable: 60, drops: [],
  textures: (m) => ({ all: m === 2 ? 'fern' : m === 0 ? 'dead_bush' : 'tall_grass' }),
}));
define(BlockId.DEAD_BUSH, 'dead_bush', 'Dead Bush', plant({
  replaceable: true, drops: [], flammable: 60, textures: tex('dead_bush'),
}));
define(BlockId.PISTON, 'piston', 'Piston', {
  shape: 'piston', hardness: 0.5, resistance: 2.5, toolCategory: 'pickaxe', variants: 16,
  solid: false, lightOpacity: 15,
  textures: () => ({ top: 'piston_top', side: 'piston_side', bottom: 'piston_bottom' }),
});
define(BlockId.PISTON_HEAD, 'piston_head', 'Piston Head', {
  shape: 'pistonhead', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 0.5, resistance: 2.5,
  drops: [], variants: 16, itemId: 0,
  textures: (m) => ({ top: m & 8 ? 'piston_top_sticky' : 'piston_top', side: 'piston_side', bottom: 'piston_top' }),
});
define(BlockId.WOOL, 'wool', 'Wool', {
  hardness: 0.8, resistance: 4, toolCategory: 'shears', flammable: 30, variants: 16,
  textures: (m) => ({ all: `wool_${m & 15}` }),
});
define(BlockId.DANDELION, 'dandelion', 'Dandelion', plant({ textures: tex('dandelion') }));
define(BlockId.ROSE, 'rose', 'Rose', plant({ textures: tex('rose') }));
define(BlockId.BROWN_MUSHROOM, 'brown_mushroom', 'Mushroom', plant({
  randomTick: true, lightEmission: 1, textures: tex('mushroom_brown'),
}));
define(BlockId.RED_MUSHROOM, 'red_mushroom', 'Mushroom', plant({
  randomTick: true, textures: tex('mushroom_red'),
}));
define(BlockId.GOLD_BLOCK, 'gold_block', 'Block of Gold', {
  hardness: 3, resistance: 30, toolCategory: 'pickaxe', harvestLevel: 2, requiresTool: true,
  textures: tex('gold_block'),
});
define(BlockId.IRON_BLOCK, 'iron_block', 'Block of Iron', {
  hardness: 5, resistance: 30, toolCategory: 'pickaxe', harvestLevel: 1, requiresTool: true,
  textures: tex('iron_block'),
});

const SLAB_TEX: ReadonlyArray<FaceTextures> = [
  { top: 'slab_stone_top', bottom: 'slab_stone_top', side: 'slab_stone_side' },
  { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' },
  { all: 'planks_oak' },
  { all: 'cobblestone' },
  { all: 'bricks' },
  { all: 'stone_bricks' },
];
const SLAB_NAMES = ['Stone', 'Sandstone', 'Wooden', 'Cobblestone', 'Brick', 'Stone Brick'];
export const slabDisplayName = (meta: number): string => `${SLAB_NAMES[meta & 7] ?? 'Stone'} Slab`;

define(BlockId.DOUBLE_SLAB, 'double_slab', 'Double Slab', {
  hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true, variants: 6,
  textures: (m) => SLAB_TEX[m % 6], itemId: BlockId.SLAB,
});
define(BlockId.SLAB, 'slab', 'Slab', {
  shape: 'slab', solid: false, lightOpacity: 0, hardness: 2, resistance: 30,
  toolCategory: 'pickaxe', requiresTool: true, variants: 16,
  textures: (m) => SLAB_TEX[(m & 7) % 6],
});
define(BlockId.BRICKS, 'bricks', 'Bricks', {
  hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true, textures: tex('bricks'),
});
define(BlockId.TNT, 'tnt', 'TNT', {
  hardness: 0, resistance: 0, interactive: true, flammable: 15,
  textures: () => ({ top: 'tnt_top', side: 'tnt_side', bottom: 'tnt_bottom' }),
});
define(BlockId.BOOKSHELF, 'bookshelf', 'Bookshelf', {
  hardness: 1.5, resistance: 7.5, toolCategory: 'axe', flammable: 30,
  drops: [{ item: ItemId.BOOK, min: 3, max: 3 }],
  textures: () => ({ top: 'planks_oak', bottom: 'planks_oak', side: 'bookshelf' }),
});
define(BlockId.MOSSY_COBBLESTONE, 'mossy_cobblestone', 'Moss Stone', {
  hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true,
  textures: tex('mossy_cobblestone'),
});
define(BlockId.OBSIDIAN, 'obsidian', 'Obsidian', {
  hardness: 50, resistance: 6000, toolCategory: 'pickaxe', harvestLevel: 3, requiresTool: true,
  textures: tex('obsidian'),
});
define(BlockId.TORCH, 'torch', 'Torch', {
  shape: 'torch', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, lightEmission: 14,
  hardness: 0, resistance: 0, needsSupport: true, variants: 6, textures: tex('torch'),
});
define(BlockId.FIRE, 'fire', 'Fire', {
  shape: 'fire', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, lightEmission: 15,
  hardness: 0, resistance: 0, replaceable: true, drops: [], randomTick: true, contactDamage: 1,
  variants: 16, textures: tex('fire'), itemId: 0,
});
define(BlockId.SPAWNER, 'spawner', 'Monster Spawner', {
  pass: 'cutout', solid: false, lightOpacity: 0, hardness: 5, resistance: 25,
  toolCategory: 'pickaxe', requiresTool: true, drops: [], xp: [15, 43], textures: tex('spawner'),
});

function stairs(id: number, name: string, display: string, texture: FaceTextures, opts: BlockOptions): void {
  define(id, name, display, {
    shape: 'stairs', solid: false, lightOpacity: 0, variants: 8, textures: () => texture, ...opts,
  });
}
stairs(BlockId.OAK_STAIRS, 'oak_stairs', 'Wooden Stairs', { all: 'planks_oak' },
  { hardness: 2, resistance: 15, toolCategory: 'axe', flammable: 20 });
stairs(BlockId.COBBLESTONE_STAIRS, 'cobblestone_stairs', 'Stone Stairs', { all: 'cobblestone' },
  { hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true });
stairs(BlockId.BRICK_STAIRS, 'brick_stairs', 'Brick Stairs', { all: 'bricks' },
  { hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true });
stairs(BlockId.STONE_BRICK_STAIRS, 'stone_brick_stairs', 'Stone Brick Stairs', { all: 'stone_bricks' },
  { hardness: 1.5, resistance: 30, toolCategory: 'pickaxe', requiresTool: true });
stairs(BlockId.NETHER_BRICK_STAIRS, 'nether_brick_stairs', 'Nether Brick Stairs', { all: 'nether_brick' },
  { hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true });
stairs(BlockId.SANDSTONE_STAIRS, 'sandstone_stairs', 'Sandstone Stairs',
  { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' },
  { hardness: 0.8, resistance: 4, toolCategory: 'pickaxe', requiresTool: true });

define(BlockId.CHEST, 'chest', 'Chest', {
  shape: 'chest', solid: false, lightOpacity: 0, hardness: 2.5, resistance: 12.5, toolCategory: 'axe',
  interactive: true, variants: 4, flammable: 5,
  textures: () => ({ top: 'chest_top', bottom: 'chest_top', side: 'chest_side', south: 'chest_front' }),
  collisionBoxes: () => [{ minX: 0.0625, minY: 0, minZ: 0.0625, maxX: 0.9375, maxY: 0.875, maxZ: 0.9375 }],
});
define(BlockId.REDSTONE_WIRE, 'redstone_wire', 'Redstone Dust', {
  shape: 'wire', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0,
  resistance: 0, needsSupport: true, drops: [{ item: ItemId.REDSTONE }], itemId: ItemId.REDSTONE,
  variants: 16, textures: tex('redstone_dust'),
});
define(BlockId.DIAMOND_ORE, 'diamond_ore', 'Diamond Ore', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', harvestLevel: 2, requiresTool: true,
  drops: [{ item: ItemId.DIAMOND }], xp: [3, 7], textures: tex('diamond_ore'),
});
define(BlockId.DIAMOND_BLOCK, 'diamond_block', 'Block of Diamond', {
  hardness: 5, resistance: 30, toolCategory: 'pickaxe', harvestLevel: 2, requiresTool: true,
  textures: tex('diamond_block'),
});
define(BlockId.CRAFTING_TABLE, 'crafting_table', 'Crafting Table', {
  hardness: 2.5, resistance: 12.5, toolCategory: 'axe', interactive: true, flammable: 5,
  textures: () => ({
    top: 'crafting_table_top', bottom: 'planks_oak', side: 'crafting_table_side',
    north: 'crafting_table_front', south: 'crafting_table_front',
  }),
});
define(BlockId.WHEAT_CROP, 'wheat', 'Crops', {
  shape: 'crop', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0,
  resistance: 0, needsSupport: true, randomTick: true, variants: 8, itemId: ItemId.SEEDS,
  textures: (m) => ({ all: `wheat_${m & 7}` }),
});
define(BlockId.FARMLAND, 'farmland', 'Farmland', {
  shape: 'farmland', solid: false, lightOpacity: 15, hardness: 0.6, resistance: 3, toolCategory: 'shovel',
  drops: [{ item: BlockId.DIRT }], randomTick: true, variants: 8, itemId: BlockId.DIRT,
  textures: (m) => ({ top: m > 0 ? 'farmland_wet' : 'farmland_dry', side: 'dirt', bottom: 'dirt' }),
  collisionBoxes: () => [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.9375, maxZ: 1 }],
});
define(BlockId.FURNACE, 'furnace', 'Furnace', {
  hardness: 3.5, resistance: 17.5, toolCategory: 'pickaxe', requiresTool: true, interactive: true,
  variants: 4,
  textures: (m) => furnaceTextures(m, false),
});
define(BlockId.LIT_FURNACE, 'lit_furnace', 'Furnace', {
  hardness: 3.5, resistance: 17.5, toolCategory: 'pickaxe', requiresTool: true, interactive: true,
  lightEmission: 13, variants: 4, drops: [{ item: BlockId.FURNACE }], itemId: BlockId.FURNACE,
  textures: (m) => furnaceTextures(m, true),
});
function furnaceTextures(meta: number, lit: boolean): FaceTextures {
  const front = lit ? 'furnace_front_lit' : 'furnace_front';
  const faces: FaceTextures = { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side' };
  // meta: 0 = faces south, 1 = west, 2 = north, 3 = east
  const key = (['south', 'west', 'north', 'east'] as const)[meta & 3];
  faces[key] = front;
  return faces;
}
define(BlockId.SIGN, 'sign', 'Sign', {
  shape: 'torch', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 1,
  resistance: 5, toolCategory: 'axe', itemId: ItemId.SIGN, drops: [{ item: ItemId.SIGN }], maxStack: 16,
  variants: 16, textures: tex('planks_oak'), interactive: false,
});
define(BlockId.WALL_SIGN, 'wall_sign', 'Sign', {
  shape: 'ladder', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 1,
  resistance: 5, toolCategory: 'axe', itemId: ItemId.SIGN, drops: [{ item: ItemId.SIGN }],
  variants: 6, textures: tex('planks_oak'),
});
define(BlockId.WOODEN_DOOR, 'wooden_door', 'Wooden Door', {
  shape: 'door', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 3, resistance: 15,
  toolCategory: 'axe', interactive: true, itemId: ItemId.WOODEN_DOOR_ITEM, drops: [],
  variants: 16, textures: (m) => ({ all: m & 8 ? 'door_wood_upper' : 'door_wood_lower' }),
});
define(BlockId.IRON_DOOR, 'iron_door', 'Iron Door', {
  shape: 'door', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 5, resistance: 25,
  toolCategory: 'pickaxe', requiresTool: true, itemId: ItemId.IRON_DOOR_ITEM, drops: [],
  variants: 16, textures: (m) => ({ all: m & 8 ? 'door_iron_upper' : 'door_iron_lower' }),
});
define(BlockId.LADDER, 'ladder', 'Ladder', {
  shape: 'ladder', pass: 'cutout', solid: false, collides: true, lightOpacity: 0, hardness: 0.4,
  resistance: 2, toolCategory: 'axe', needsSupport: true, variants: 6, textures: tex('ladder'),
});
define(BlockId.RAIL, 'rail', 'Rail', {
  shape: 'flat', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0.7,
  resistance: 3.5, toolCategory: 'pickaxe', needsSupport: true, variants: 10,
  textures: (m) => ({ all: m >= 6 ? 'rail_turn' : 'rail' }),
});
define(BlockId.LEVER, 'lever', 'Lever', {
  shape: 'lever', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0.5,
  resistance: 2.5, needsSupport: true, interactive: true, variants: 16, textures: tex('lever'),
});
define(BlockId.STONE_PRESSURE_PLATE, 'stone_pressure_plate', 'Stone Pressure Plate', {
  shape: 'flat', pass: 'opaque', solid: false, collides: false, lightOpacity: 0, hardness: 0.5,
  resistance: 2.5, toolCategory: 'pickaxe', requiresTool: true, needsSupport: true, variants: 2,
  textures: tex('stone'),
});
define(BlockId.WOODEN_PRESSURE_PLATE, 'wooden_pressure_plate', 'Wooden Pressure Plate', {
  shape: 'flat', pass: 'opaque', solid: false, collides: false, lightOpacity: 0, hardness: 0.5,
  resistance: 2.5, toolCategory: 'axe', needsSupport: true, variants: 2, textures: tex('planks_oak'),
});
define(BlockId.REDSTONE_ORE, 'redstone_ore', 'Redstone Ore', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', harvestLevel: 2, requiresTool: true,
  xp: [1, 5], interactive: false, textures: tex('redstone_ore'),
});
define(BlockId.LIT_REDSTONE_ORE, 'lit_redstone_ore', 'Redstone Ore', {
  hardness: 3, resistance: 15, toolCategory: 'pickaxe', harvestLevel: 2, requiresTool: true,
  xp: [1, 5], lightEmission: 9, randomTick: true, itemId: BlockId.REDSTONE_ORE, textures: tex('redstone_ore_lit'),
});
define(BlockId.REDSTONE_TORCH_OFF, 'unlit_redstone_torch', 'Redstone Torch', {
  shape: 'torch', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0,
  resistance: 0, needsSupport: true, variants: 6, itemId: BlockId.REDSTONE_TORCH,
  drops: [{ item: BlockId.REDSTONE_TORCH }], textures: tex('redstone_torch_off'),
});
define(BlockId.REDSTONE_TORCH, 'redstone_torch', 'Redstone Torch', {
  shape: 'torch', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, lightEmission: 7,
  hardness: 0, resistance: 0, needsSupport: true, variants: 6, textures: tex('redstone_torch_on'),
});
define(BlockId.STONE_BUTTON, 'stone_button', 'Button', {
  shape: 'button', pass: 'opaque', solid: false, collides: false, lightOpacity: 0, hardness: 0.5,
  resistance: 2.5, toolCategory: 'pickaxe', needsSupport: true, interactive: true, variants: 16,
  textures: tex('stone'),
});
define(BlockId.WOODEN_BUTTON, 'wooden_button', 'Wooden Button', {
  shape: 'button', pass: 'opaque', solid: false, collides: false, lightOpacity: 0, hardness: 0.5,
  resistance: 2.5, toolCategory: 'axe', needsSupport: true, interactive: true, variants: 16,
  textures: tex('planks_oak'),
});
define(BlockId.SNOW_LAYER, 'snow_layer', 'Snow', {
  shape: 'flat', solid: false, collides: false, lightOpacity: 0, hardness: 0.1, resistance: 0.5,
  toolCategory: 'shovel', requiresTool: true, replaceable: true, needsSupport: true,
  drops: [{ item: ItemId.SNOWBALL }], textures: tex('snow'),
});
define(BlockId.ICE, 'ice', 'Ice', {
  pass: 'translucent', solid: false, lightOpacity: 3, hardness: 0.5, resistance: 2.5,
  toolCategory: 'pickaxe', slipperiness: 0.98, drops: [], textures: tex('ice'),
});
define(BlockId.SNOW_BLOCK, 'snow', 'Snow Block', {
  hardness: 0.2, resistance: 1, toolCategory: 'shovel', requiresTool: true,
  drops: [{ item: ItemId.SNOWBALL, min: 4, max: 4 }], textures: tex('snow'),
});
define(BlockId.CACTUS, 'cactus', 'Cactus', {
  shape: 'cactus', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 0.4, resistance: 2,
  needsSupport: true, randomTick: true, contactDamage: 1,
  textures: () => ({ top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }),
  collisionBoxes: () => [{ minX: 0.0625, minY: 0, minZ: 0.0625, maxX: 0.9375, maxY: 0.9375, maxZ: 0.9375 }],
});
define(BlockId.CLAY, 'clay', 'Clay', {
  hardness: 0.6, resistance: 3, toolCategory: 'shovel',
  drops: [{ item: ItemId.CLAY_BALL, min: 4, max: 4 }], textures: tex('clay'),
});
define(BlockId.SUGAR_CANE, 'reeds', 'Sugar Canes', plant({
  randomTick: true, itemId: ItemId.SUGAR_CANE_ITEM, drops: [{ item: ItemId.SUGAR_CANE_ITEM }],
  tint: 'grass', textures: tex('sugar_cane'),
}));
define(BlockId.JUKEBOX, 'jukebox', 'Jukebox', {
  hardness: 2, resistance: 30, toolCategory: 'axe', interactive: true,
  textures: () => ({ top: 'jukebox_top', side: 'jukebox_side', bottom: 'jukebox_side' }),
});
define(BlockId.FENCE, 'fence', 'Fence', {
  shape: 'fence', pass: 'opaque', solid: false, lightOpacity: 0, hardness: 2, resistance: 15,
  toolCategory: 'axe', flammable: 20, textures: tex('planks_oak'),
});
define(BlockId.PUMPKIN, 'pumpkin', 'Pumpkin', {
  hardness: 1, resistance: 5, toolCategory: 'axe', variants: 4,
  textures: (m) => pumpkinTextures(m, 'pumpkin_face'),
});
function pumpkinTextures(meta: number, face: string): FaceTextures {
  const faces: FaceTextures = { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side' };
  const key = (['south', 'west', 'north', 'east'] as const)[meta & 3];
  faces[key] = face;
  return faces;
}
define(BlockId.NETHERRACK, 'netherrack', 'Netherrack', {
  hardness: 0.4, resistance: 2, toolCategory: 'pickaxe', requiresTool: true, textures: tex('netherrack'),
});
define(BlockId.SOUL_SAND, 'soul_sand', 'Soul Sand', {
  hardness: 0.5, resistance: 2.5, toolCategory: 'shovel', textures: tex('soul_sand'),
  collisionBoxes: () => [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.875, maxZ: 1 }],
});
define(BlockId.GLOWSTONE, 'glowstone', 'Glowstone', {
  lightEmission: 15, hardness: 0.3, resistance: 1.5, lightOpacity: 15, textures: tex('glowstone'),
});
define(BlockId.NETHER_PORTAL, 'portal', 'Portal', {
  shape: 'portal', pass: 'translucent', solid: false, collides: false, lightOpacity: 0,
  lightEmission: 11, hardness: -1, resistance: 0, drops: [], variants: 2, textures: tex('portal'), itemId: 0,
});
define(BlockId.JACK_O_LANTERN, 'lit_pumpkin', 'Jack \'o\' Lantern', {
  hardness: 1, resistance: 5, toolCategory: 'axe', lightEmission: 15, variants: 4,
  textures: (m) => pumpkinTextures(m, 'pumpkin_face_lit'),
});
define(BlockId.CAKE, 'cake', 'Cake', {
  shape: 'cake', solid: false, lightOpacity: 0, hardness: 0.5, resistance: 2.5, interactive: true,
  drops: [], itemId: ItemId.CAKE_ITEM, variants: 7, maxStack: 1,
  textures: () => ({ top: 'cake_top', side: 'cake_side', bottom: 'cake_bottom', west: 'cake_side' }),
});
define(BlockId.REPEATER_OFF, 'unpowered_repeater', 'Redstone Repeater', {
  shape: 'repeater', solid: false, lightOpacity: 0, hardness: 0, resistance: 0, needsSupport: true,
  interactive: true, itemId: ItemId.REPEATER_ITEM, drops: [{ item: ItemId.REPEATER_ITEM }], variants: 16,
  textures: () => ({ top: 'repeater_off', side: 'slab_stone_side', bottom: 'slab_stone_top' }),
});
define(BlockId.REPEATER_ON, 'powered_repeater', 'Redstone Repeater', {
  shape: 'repeater', solid: false, lightOpacity: 0, hardness: 0, resistance: 0, needsSupport: true,
  interactive: true, lightEmission: 7, itemId: ItemId.REPEATER_ITEM, drops: [{ item: ItemId.REPEATER_ITEM }],
  variants: 16, textures: () => ({ top: 'repeater_on', side: 'slab_stone_side', bottom: 'slab_stone_top' }),
});
define(BlockId.TRAPDOOR, 'trapdoor', 'Trapdoor', {
  shape: 'trapdoor', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 3, resistance: 15,
  toolCategory: 'axe', interactive: true, variants: 16, textures: tex('trapdoor'),
});
define(BlockId.MONSTER_EGG, 'monster_egg', 'Stone', {
  hardness: 0.75, resistance: 3.75, drops: [], variants: 3,
  textures: (m) => ({ all: m === 1 ? 'cobblestone' : m === 2 ? 'stone_bricks' : 'stone' }),
});
define(BlockId.STONE_BRICKS, 'stone_bricks', 'Stone Bricks', {
  hardness: 1.5, resistance: 30, toolCategory: 'pickaxe', requiresTool: true, variants: 4,
  textures: (m) => ({ all: ['stone_bricks', 'stone_bricks_mossy', 'stone_bricks_cracked', 'stone_bricks_chiseled'][m & 3] }),
});
export const stoneBrickDisplayName = (meta: number): string =>
  ['Stone Bricks', 'Mossy Stone Bricks', 'Cracked Stone Bricks', 'Chiseled Stone Bricks'][meta & 3];

define(BlockId.BROWN_MUSHROOM_BLOCK, 'brown_mushroom_block', 'Mushroom', {
  hardness: 0.2, resistance: 1, toolCategory: 'axe', variants: 2,
  drops: [{ item: BlockId.BROWN_MUSHROOM, min: 0, max: 2 }],
  textures: (m) => (m === 1
    ? { top: 'mushroom_block_inside', bottom: 'mushroom_block_inside', side: 'mushroom_block_stem' }
    : { top: 'mushroom_block_brown', side: 'mushroom_block_brown', bottom: 'mushroom_block_inside' }),
});
define(BlockId.RED_MUSHROOM_BLOCK, 'red_mushroom_block', 'Mushroom', {
  hardness: 0.2, resistance: 1, toolCategory: 'axe', variants: 2,
  drops: [{ item: BlockId.RED_MUSHROOM, min: 0, max: 2 }],
  textures: (m) => (m === 1
    ? { top: 'mushroom_block_inside', bottom: 'mushroom_block_inside', side: 'mushroom_block_stem' }
    : { top: 'mushroom_block_red', side: 'mushroom_block_red', bottom: 'mushroom_block_inside' }),
});
define(BlockId.IRON_BARS, 'iron_bars', 'Iron Bars', {
  shape: 'pane', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 5, resistance: 30,
  toolCategory: 'pickaxe', requiresTool: true, textures: tex('iron_bars'),
});
define(BlockId.GLASS_PANE, 'glass_pane', 'Glass Pane', {
  shape: 'pane', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 0.3, resistance: 1.5,
  drops: [], textures: tex('glass'),
});
define(BlockId.MELON_BLOCK, 'melon', 'Melon', {
  hardness: 1, resistance: 5, toolCategory: 'axe',
  textures: () => ({ top: 'melon_top', bottom: 'melon_top', side: 'melon_side' }),
});
define(BlockId.PUMPKIN_STEM, 'pumpkin_stem', 'Pumpkin Stem', {
  shape: 'stem', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0,
  resistance: 0, needsSupport: true, randomTick: true, variants: 8, itemId: ItemId.PUMPKIN_SEEDS,
  drops: [], textures: tex('stem'),
});
define(BlockId.MELON_STEM, 'melon_stem', 'Melon Stem', {
  shape: 'stem', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0,
  resistance: 0, needsSupport: true, randomTick: true, variants: 8, itemId: ItemId.MELON_SEEDS,
  drops: [], textures: tex('stem'),
});
define(BlockId.FENCE_GATE, 'fence_gate', 'Fence Gate', {
  shape: 'fence', pass: 'opaque', solid: false, lightOpacity: 0, hardness: 2, resistance: 15,
  toolCategory: 'axe', interactive: true, variants: 8, textures: tex('planks_oak'),
});
define(BlockId.MYCELIUM, 'mycelium', 'Mycelium', {
  hardness: 0.6, resistance: 3, toolCategory: 'shovel', drops: [{ item: BlockId.DIRT }], randomTick: true,
  textures: () => ({ top: 'mycelium_top', side: 'mycelium_side', bottom: 'dirt' }),
});
define(BlockId.LILY_PAD, 'waterlily', 'Lily Pad', {
  shape: 'lily', pass: 'cutout', solid: false, collides: true, lightOpacity: 0, hardness: 0,
  resistance: 0, needsSupport: true, tint: 'foliage', textures: tex('lily_pad'),
  collisionBoxes: () => [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.015625, maxZ: 1 }],
});
define(BlockId.NETHER_BRICK, 'nether_brick', 'Nether Brick', {
  hardness: 2, resistance: 30, toolCategory: 'pickaxe', requiresTool: true, textures: tex('nether_brick'),
});
define(BlockId.NETHER_BRICK_FENCE, 'nether_brick_fence', 'Nether Brick Fence', {
  shape: 'fence', solid: false, lightOpacity: 0, hardness: 2, resistance: 30,
  toolCategory: 'pickaxe', requiresTool: true, textures: tex('nether_brick'),
});
define(BlockId.NETHER_WART, 'nether_wart', 'Nether Wart', {
  shape: 'crop', pass: 'cutout', solid: false, collides: false, lightOpacity: 0, hardness: 0,
  resistance: 0, needsSupport: true, randomTick: true, variants: 4, itemId: ItemId.NETHER_WART_ITEM,
  textures: (m) => ({ all: `nether_wart_${m >= 3 ? 2 : m >= 1 ? 1 : 0}` }),
});
define(BlockId.ENCHANTING_TABLE, 'enchanting_table', 'Enchantment Table', {
  shape: 'enchant', solid: false, lightOpacity: 0, hardness: 5, resistance: 6000, lightEmission: 0,
  toolCategory: 'pickaxe', requiresTool: true, interactive: true,
  textures: () => ({ top: 'enchanting_table_top', side: 'enchanting_table_side', bottom: 'enchanting_table_bottom' }),
  collisionBoxes: () => [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.75, maxZ: 1 }],
});
define(BlockId.BREWING_STAND, 'brewing_stand', 'Brewing Stand', {
  shape: 'brewing', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 0.5, resistance: 2.5,
  lightEmission: 1, toolCategory: 'pickaxe', requiresTool: true, interactive: true,
  itemId: ItemId.BREWING_STAND_ITEM, drops: [{ item: ItemId.BREWING_STAND_ITEM }],
  textures: () => ({ top: 'brewing_stand', side: 'brewing_stand', bottom: 'brewing_stand_base' }),
  collisionBoxes: () => [
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.125, maxZ: 1 },
    { minX: 0.4375, minY: 0, minZ: 0.4375, maxX: 0.5625, maxY: 0.875, maxZ: 0.5625 },
  ],
});
define(BlockId.CAULDRON, 'cauldron', 'Cauldron', {
  shape: 'cauldron', pass: 'cutout', solid: false, lightOpacity: 0, hardness: 2, resistance: 10,
  toolCategory: 'pickaxe', requiresTool: true, interactive: true, variants: 4,
  itemId: ItemId.CAULDRON_ITEM, drops: [{ item: ItemId.CAULDRON_ITEM }],
  textures: () => ({ top: 'cauldron_top', side: 'cauldron_side', bottom: 'cauldron_bottom' }),
  collisionBoxes: () => [
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.3125, maxZ: 1 },
    { minX: 0, minY: 0, minZ: 0, maxX: 0.125, maxY: 1, maxZ: 1 },
    { minX: 0.875, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1 },
    { minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 0.125 },
    { minX: 0, minY: 0, minZ: 0.875, maxX: 1, maxY: 1, maxZ: 1 },
  ],
});
define(BlockId.END_PORTAL, 'end_portal', 'End Portal', {
  shape: 'endportal', pass: 'opaque', solid: false, collides: false, lightOpacity: 0,
  lightEmission: 15, hardness: -1, resistance: 18000000, drops: [], textures: tex('end_portal'), itemId: 0,
});
define(BlockId.END_PORTAL_FRAME, 'end_portal_frame', 'End Portal Frame', {
  shape: 'frame', solid: false, lightOpacity: 0, lightEmission: 1, hardness: -1, resistance: 18000000,
  interactive: true, drops: [], variants: 8,
  textures: () => ({ top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'end_stone' }),
  collisionBoxes: (m) => (m & 4
    ? [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.8125, maxZ: 1 },
      { minX: 0.3125, minY: 0.8125, minZ: 0.3125, maxX: 0.6875, maxY: 1, maxZ: 0.6875 }]
    : [{ minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 0.8125, maxZ: 1 }]),
});
define(BlockId.END_STONE, 'end_stone', 'End Stone', {
  hardness: 3, resistance: 45, toolCategory: 'pickaxe', requiresTool: true, textures: tex('end_stone'),
});
define(BlockId.DRAGON_EGG, 'dragon_egg', 'Dragon Egg', {
  shape: 'dragonegg', pass: 'cutout', solid: false, lightOpacity: 0, lightEmission: 1, hardness: 3,
  resistance: 45, interactive: true, gravity: true, textures: tex('dragon_egg'),
  collisionBoxes: () => [{ minX: 0.0625, minY: 0, minZ: 0.0625, maxX: 0.9375, maxY: 1, maxZ: 0.9375 }],
});

// ---------------------------------------------------------------------------
// Special drop behaviour. Data-driven `drops` cover the simple cases; the few
// blocks whose drops depend on chance, tools or metadata are listed here.
// ---------------------------------------------------------------------------
dropResolvers.set(BlockId.GRAVEL, (_m, _t, _c, fortune, silk, r) =>
  (!silk && r.chance(fortune >= 3 ? 1 : 0.1 + fortune * 0.05)) ? [{ item: ItemId.FLINT }] : [{ item: BlockId.GRAVEL }]);
dropResolvers.set(BlockId.LEAVES, (meta, _t, cat, _f, _s, r) => {
  if (cat === 'shears') return [{ item: BlockId.LEAVES, meta: meta & 3 }];
  const out: DropSpec[] = [];
  if (r.chance(meta % 3 === WoodType.SPRUCE ? 0.04 : 0.05)) out.push({ item: BlockId.SAPLING, meta: meta & 3 });
  if ((meta & 3) === WoodType.OAK && r.chance(0.005)) out.push({ item: ItemId.APPLE });
  return out;
});
dropResolvers.set(BlockId.TALL_GRASS, (meta, _t, cat, _f, _s, r) => {
  if (cat === 'shears') return [{ item: BlockId.TALL_GRASS, meta }];
  return r.chance(0.125) ? [{ item: ItemId.SEEDS }] : [];
});
dropResolvers.set(BlockId.DEAD_BUSH, (_m, _t, cat) => (cat === 'shears' ? [{ item: BlockId.DEAD_BUSH }] : []));
dropResolvers.set(BlockId.LAPIS_ORE, (_m, _t, _c, fortune, silk, r) =>
  silk ? [{ item: BlockId.LAPIS_ORE }] : [{ item: ItemId.DYE, meta: DyeMeta.LAPIS_LAZULI, min: 4 + fortune, max: 8 + fortune * 2 }]);
const redstoneOreDrops: DropResolver = (_m, _t, _c, fortune, silk) =>
  silk ? [{ item: BlockId.REDSTONE_ORE }] : [{ item: ItemId.REDSTONE, min: 4, max: 5 + fortune }];
dropResolvers.set(BlockId.REDSTONE_ORE, redstoneOreDrops);
dropResolvers.set(BlockId.LIT_REDSTONE_ORE, redstoneOreDrops);
dropResolvers.set(BlockId.COAL_ORE, (_m, _t, _c, fortune, silk, r) =>
  silk ? [{ item: BlockId.COAL_ORE }] : [{ item: ItemId.COAL, min: 1, max: 1 + (fortune > 0 ? r.int(fortune + 1) : 0) }]);
dropResolvers.set(BlockId.DIAMOND_ORE, (_m, _t, _c, fortune, silk, r) =>
  silk ? [{ item: BlockId.DIAMOND_ORE }] : [{ item: ItemId.DIAMOND, min: 1, max: 1 + (fortune > 0 ? r.int(fortune + 1) : 0) }]);
dropResolvers.set(BlockId.GLOWSTONE, (_m, _t, _c, fortune) =>
  [{ item: ItemId.GLOWSTONE_DUST, min: 2, max: Math.min(4, 4 + fortune) }]);
dropResolvers.set(BlockId.MELON_BLOCK, (_m, _t, _c, fortune) =>
  [{ item: ItemId.MELON_SLICE, min: 3, max: Math.min(9, 7 + fortune) }]);
dropResolvers.set(BlockId.STONE, (_m, _t, _c, _f, silk) => [{ item: silk ? BlockId.STONE : BlockId.COBBLESTONE }]);
dropResolvers.set(BlockId.GRASS, (_m, _t, _c, _f, silk) => [{ item: silk ? BlockId.GRASS : BlockId.DIRT }]);
dropResolvers.set(BlockId.GLASS, (_m, _t, _c, _f, silk) => (silk ? [{ item: BlockId.GLASS }] : []));
dropResolvers.set(BlockId.ICE, (_m, _t, _c, _f, silk) => (silk ? [{ item: BlockId.ICE }] : []));
dropResolvers.set(BlockId.BOOKSHELF, (_m, _t, _c, _f, silk) =>
  (silk ? [{ item: BlockId.BOOKSHELF }] : [{ item: ItemId.BOOK, min: 3, max: 3 }]));
dropResolvers.set(BlockId.WHEAT_CROP, (meta, _t, _c, _f, _s, r) => {
  if ((meta & 7) >= 7) return [{ item: ItemId.WHEAT }, { item: ItemId.SEEDS, min: 0, max: 3 }];
  return [{ item: ItemId.SEEDS }];
});
dropResolvers.set(BlockId.NETHER_WART, (meta) =>
  [{ item: ItemId.NETHER_WART_ITEM, min: meta >= 3 ? 2 : 1, max: meta >= 3 ? 4 : 1 }]);
dropResolvers.set(BlockId.DOUBLE_SLAB, (meta) => [{ item: BlockId.SLAB, meta: meta % 6, min: 2, max: 2 }]);
dropResolvers.set(BlockId.SLAB, (meta) => [{ item: BlockId.SLAB, meta: meta & 7 }]);
dropResolvers.set(BlockId.WOODEN_DOOR, (meta) => (meta & 8 ? [] : [{ item: ItemId.WOODEN_DOOR_ITEM }]));
dropResolvers.set(BlockId.IRON_DOOR, (meta) => (meta & 8 ? [] : [{ item: ItemId.IRON_DOOR_ITEM }]));
dropResolvers.set(BlockId.BED, (meta) => (meta & 8 ? [] : [{ item: ItemId.BED_ITEM }]));
dropResolvers.set(BlockId.PUMPKIN_STEM, (meta) => (meta >= 7 ? [{ item: ItemId.PUMPKIN_SEEDS, min: 1, max: 3 }] : [{ item: ItemId.PUMPKIN_SEEDS }]));
dropResolvers.set(BlockId.MELON_STEM, (meta) => (meta >= 7 ? [{ item: ItemId.MELON_SEEDS, min: 1, max: 3 }] : [{ item: ItemId.MELON_SEEDS }]));
dropResolvers.set(BlockId.WOOL, (meta) => [{ item: BlockId.WOOL, meta: meta & 15 }]);
dropResolvers.set(BlockId.LOG, (meta) => [{ item: BlockId.LOG, meta: meta & 3 }]);
dropResolvers.set(BlockId.PLANKS, (meta) => [{ item: BlockId.PLANKS, meta: meta % 3 }]);
dropResolvers.set(BlockId.SAPLING, (meta) => [{ item: BlockId.SAPLING, meta: meta & 3 }]);
dropResolvers.set(BlockId.STONE_BRICKS, (meta) => [{ item: BlockId.STONE_BRICKS, meta: meta & 3 }]);
// Blocks with orientation metadata drop a plain (meta 0) item.
for (const id of [
  BlockId.TORCH, BlockId.REDSTONE_TORCH, BlockId.LADDER, BlockId.FURNACE, BlockId.CHEST, BlockId.PUMPKIN,
  BlockId.JACK_O_LANTERN, BlockId.OAK_STAIRS, BlockId.COBBLESTONE_STAIRS, BlockId.BRICK_STAIRS,
  BlockId.STONE_BRICK_STAIRS, BlockId.NETHER_BRICK_STAIRS, BlockId.SANDSTONE_STAIRS, BlockId.LEVER,
  BlockId.STONE_BUTTON, BlockId.WOODEN_BUTTON, BlockId.TRAPDOOR, BlockId.FENCE_GATE, BlockId.RAIL,
  BlockId.POWERED_RAIL, BlockId.DETECTOR_RAIL, BlockId.PISTON, BlockId.STICKY_PISTON,
  BlockId.STONE_PRESSURE_PLATE, BlockId.WOODEN_PRESSURE_PLATE, BlockId.FARMLAND,
]) {
  if (!dropResolvers.has(id)) {
    dropResolvers.set(id, () => {
      const def = blocks[id]!;
      return def.drops ? def.drops : [{ item: def.itemId }];
    });
  }
}

// ---------------------------------------------------------------------------
// Lookup tables built once for hot paths (meshing, lighting, collision).
// ---------------------------------------------------------------------------
export const SOLID = new Uint8Array(MAX_BLOCK_ID);
export const OPAQUE_LIGHT = new Uint8Array(MAX_BLOCK_ID);
export const LIGHT_EMISSION = new Uint8Array(MAX_BLOCK_ID);
export const COLLIDES = new Uint8Array(MAX_BLOCK_ID);
export const IS_FLUID = new Uint8Array(MAX_BLOCK_ID);
export const REPLACEABLE = new Uint8Array(MAX_BLOCK_ID);
export const RANDOM_TICK = new Uint8Array(MAX_BLOCK_ID);

for (let i = 0; i < MAX_BLOCK_ID; i++) {
  const def = blocks[i];
  if (!def) continue;
  SOLID[i] = def.solid ? 1 : 0;
  OPAQUE_LIGHT[i] = def.lightOpacity;
  LIGHT_EMISSION[i] = def.lightEmission;
  COLLIDES[i] = def.collides ? 1 : 0;
  IS_FLUID[i] = def.fluid === 'water' ? 1 : def.fluid === 'lava' ? 2 : 0;
  REPLACEABLE[i] = def.replaceable ? 1 : 0;
  RANDOM_TICK[i] = def.randomTick ? 1 : 0;
}

export function getBlock(id: number): BlockDefinition {
  return blocks[id] ?? blocks[BlockId.STONE]!;
}

export function isBlockDefined(id: number): boolean {
  return id >= 0 && id < MAX_BLOCK_ID && blocks[id] !== undefined;
}

export function allBlocks(): BlockDefinition[] {
  return blocks.filter((b): b is BlockDefinition => b !== undefined);
}

/** Resolve the list of item drops for breaking a block. */
export function resolveDrops(
  id: number,
  meta: number,
  toolTier: number,
  toolCategory: ToolCategory,
  fortune: number,
  silkTouch: boolean,
  random: Random,
): { item: number; meta: number; count: number }[] {
  const def = getBlock(id);
  if (def.requiresTool && !canHarvest(def, toolCategory, toolTier)) return [];
  let specs: DropSpec[];
  const resolver = dropResolvers.get(id);
  if (silkTouch && def.itemId === id && !resolver) specs = [{ item: id, meta }];
  else if (resolver) specs = resolver(meta, toolTier, toolCategory, fortune, silkTouch, random);
  else if (def.drops) specs = def.drops;
  else specs = [{ item: def.itemId, meta: 0 }];
  const out: { item: number; meta: number; count: number }[] = [];
  for (const s of specs) {
    if (s.item === 0) continue;
    if (s.chance !== undefined && !random.chance(s.chance)) continue;
    const min = s.min ?? 1;
    const max = s.max ?? min;
    const count = random.range(min, max);
    if (count > 0) out.push({ item: s.item, meta: s.meta ?? 0, count });
  }
  return out;
}

/** Whether a tool can harvest (get drops from) a block. */
export function canHarvest(def: BlockDefinition, category: ToolCategory, tier: number): boolean {
  if (!def.requiresTool) return true;
  if (def.toolCategory === 'shears' || def.toolCategory === 'sword') return category === def.toolCategory;
  if (def.toolCategory !== category) {
    // Cobwebs and wool can also be broken by swords/shears.
    return false;
  }
  return tier >= def.harvestLevel;
}

export { WoodType, SlabType, StoneBrickType };

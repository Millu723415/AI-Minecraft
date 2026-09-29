/** Shared type definitions for the block registry. */

import type { Random } from '../core/rng';

/** Which tool class mines a block efficiently. */
export type ToolCategory = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'shears' | 'sword' | null;

/** How a block is turned into geometry by the chunk mesher. */
export type RenderShape =
  | 'none'        // invisible (air, end portal frame interior helpers)
  | 'cube'        // full 1x1x1 block
  | 'cross'       // two diagonal quads (flowers, saplings, tall grass)
  | 'fluid'       // water / lava with a level-dependent top surface
  | 'torch'       // thin post, may be attached to a wall
  | 'slab'        // half block (top or bottom depending on meta)
  | 'stairs'      // two boxes
  | 'fence'       // post plus connecting arms
  | 'pane'        // thin cross-connected pane (glass pane, iron bars)
  | 'ladder'      // thin plate on a wall
  | 'flat'        // thin plate on the ground (rails, pressure plates, snow)
  | 'door'        // thin plate rotated by facing and open state
  | 'trapdoor'
  | 'cactus'      // slightly inset cube
  | 'chest'
  | 'crop'        // four vertical quads at growth-dependent texture
  | 'fire'
  | 'portal'      // nether portal plane
  | 'frame'       // end portal frame (base + optional eye)
  | 'brewing'
  | 'cauldron'
  | 'enchant'
  | 'bed'
  | 'cake'
  | 'lily'
  | 'button'
  | 'lever'
  | 'wire'        // redstone dust
  | 'repeater'
  | 'piston'
  | 'pistonhead'
  | 'farmland'
  | 'stem'
  | 'endportal'
  | 'dragonegg';

/** Which render pass a block belongs to. */
export type RenderPass = 'opaque' | 'cutout' | 'translucent';

/** Biome-dependent colour multiplier applied at mesh time. */
export type TintSource = 'none' | 'grass' | 'foliage' | 'water' | 'spruce' | 'birch';

export interface DropSpec {
  item: number;
  meta?: number;
  min?: number;
  max?: number;
  /** Probability that this drop happens at all (0..1, default 1). */
  chance?: number;
}

/** Axis-aligned box in block-local units (0..1). */
export interface Box {
  minX: number; minY: number; minZ: number;
  maxX: number; maxY: number; maxZ: number;
}

/** Per-face texture names; `all` is expanded to every face. */
export interface FaceTextures {
  all?: string;
  top?: string;
  bottom?: string;
  side?: string;
  north?: string;
  south?: string;
  east?: string;
  west?: string;
}

export interface BlockDefinition {
  id: number;
  name: string;
  /** Display name shown in the UI. */
  displayName: string;
  shape: RenderShape;
  pass: RenderPass;
  /** Full opaque cube: neighbouring faces can be culled against it. */
  solid: boolean;
  /** Entities collide with it. */
  collides: boolean;
  /** How much light this block removes when propagating skylight (0 = clear). */
  lightOpacity: number;
  /** Light emitted by the block (0..15). */
  lightEmission: number;
  /** Seconds-scale mining hardness; -1 means unbreakable. */
  hardness: number;
  /** Blast resistance used by the explosion system. */
  resistance: number;
  toolCategory: ToolCategory;
  /** Minimum tool tier required to get drops (0 = wood/gold, 3 = diamond). */
  harvestLevel: number;
  /** Requires the right tool to drop anything at all. */
  requiresTool: boolean;
  drops: DropSpec[] | null;
  /** XP dropped when broken by a player, [min, max]. */
  xp: [number, number] | null;
  tint: TintSource;
  /** Can be overwritten when placing another block (tall grass, water, snow). */
  replaceable: boolean;
  /** Falls when unsupported (sand, gravel). */
  gravity: boolean;
  /** Can catch fire from a neighbouring flame. */
  flammable: number;
  /** Surface friction; 1 is normal, ice is higher. */
  slipperiness: number;
  /** Number of distinct metadata values that change appearance. */
  variants: number;
  /** Texture resolver, evaluated once per variant at registry build time. */
  textures: (meta: number) => FaceTextures;
  /** Item produced when the block is picked up / placed from inventory. */
  itemId: number;
  /** Item stack size when in inventory. */
  maxStack: number;
  /** Custom collision boxes; when absent the shape's default is used. */
  collisionBoxes?: (meta: number) => Box[];
  /** Blocks that need a supporting block below/behind them. */
  needsSupport: boolean;
  /** Receives random ticks (crops, grass spread, fire, leaf decay...). */
  randomTick: boolean;
  /** Fluid level helper: 0 for source blocks, >0 for flowing. */
  fluid: 'none' | 'water' | 'lava';
  /** Entity damage per second when touching this block. */
  contactDamage: number;
  /** Player can interact (right-click) with it. */
  interactive: boolean;
}

export type BlockOptions = Partial<Omit<BlockDefinition, 'id' | 'name' | 'displayName'>>;

/** Signature of the special drop handlers registered for a few blocks. */
export type DropResolver = (
  meta: number,
  toolTier: number,
  toolCategory: ToolCategory,
  fortune: number,
  silkTouch: boolean,
  random: Random,
) => DropSpec[];

/**
 * Optional resource pack.
 *
 * When `pack/manifest.json` exists next to the page (created by
 * `npm run import-pack -- <zip>`), the listed PNGs are loaded before the game
 * starts and used instead of the procedurally painted textures for the blocks,
 * items, HUD icons, container screens, mobs and sky already in the game. Only
 * files for existing content are imported; anything missing falls back to the
 * built-in original textures.
 */

import { PixelTile, TINT_ALPHA, type RGB } from './pixel';

export interface PackImage { w: number; h: number; data: Uint8ClampedArray }

const images = new Map<string, PackImage>();
let loaded = false;

/** Is a resource pack active? */
export function packActive(): boolean {
  return loaded && images.size > 0;
}

/** Pixel data of a pack file, e.g. `block/stone` or `entity/pig/pig_temperate`. */
export function packImage(path: string): PackImage | undefined {
  return images.get(path);
}

/** Pack file as a canvas (for DOM/HUD use and Three.js textures). */
export function packCanvas(path: string): HTMLCanvasElement | null {
  const img = images.get(path);
  if (!img) return null;
  const c = document.createElement('canvas');
  c.width = img.w; c.height = img.h;
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.w, img.h), 0, 0);
  return c;
}

async function loadImage(url: string): Promise<PackImage> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  const bmp = await createImageBitmap(await res.blob());
  const c = document.createElement('canvas');
  c.width = bmp.width; c.height = bmp.height;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  return { w: bmp.width, h: bmp.height, data: d.data };
}

/** Load the pack if one was imported. Never throws; returns the number of images. */
export async function loadResourcePack(base = 'pack/'): Promise<number> {
  try {
    const res = await fetch(`${base}manifest.json`, { cache: 'no-cache' });
    if (!res.ok) return 0;
    const manifest = (await res.json()) as { files: string[] };
    await Promise.all(manifest.files.map(async (f) => {
      try {
        images.set(f.replace(/\.png$/, ''), await loadImage(`${base}${f}`));
      } catch (err) {
        console.warn('pack image failed', f, err);
      }
    }));
    loaded = true;
    return images.size;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Tile builders
// ---------------------------------------------------------------------------

/** Copy the first 16x16 frame (animated strips are stacked vertically). */
function frame(img: PackImage, tile: PixelTile, fx = 0, fy = 0): void {
  const s = Math.max(1, Math.floor(img.w / 16));
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const si = ((fy + y * s) * img.w + fx + x * s) * 4;
      const di = (y * 16 + x) * 4;
      tile.data[di] = img.data[si]; tile.data[di + 1] = img.data[si + 1];
      tile.data[di + 2] = img.data[si + 2]; tile.data[di + 3] = img.data[si + 3];
    }
  }
}

function plain(path: string): (t: PixelTile) => boolean {
  return (t) => {
    const img = images.get(path);
    if (!img) return false;
    frame(img, t);
    return true;
  };
}

/** Opaque texture whose every pixel takes the biome tint (tint mask alpha). */
function tintMask(path: string): (t: PixelTile) => boolean {
  return (t) => {
    if (!plain(path)(t)) return false;
    for (let i = 3; i < t.data.length; i += 4) if (t.data[i] > 0) t.data[i] = TINT_ALPHA;
    return true;
  };
}

/** Multiply by a fixed colour (for textures the engine does not tint). */
function tinted(path: string, c: RGB): (t: PixelTile) => boolean {
  return (t) => {
    if (!plain(path)(t)) return false;
    for (let i = 0; i < t.data.length; i += 4) {
      t.data[i] = (t.data[i] * c[0]) / 255; t.data[i + 1] = (t.data[i + 1] * c[1]) / 255; t.data[i + 2] = (t.data[i + 2] * c[2]) / 255;
    }
    return true;
  };
}

/** Grass side: dirt base with the grey overlay marked for biome tint. */
function grassSide(t: PixelTile): boolean {
  const base = images.get('block/grass_block_side');
  const over = images.get('block/grass_block_side_overlay');
  if (!base || !over) return false;
  frame(base, t);
  for (let i = 0; i < 256; i++) {
    const a = over.data[i * 4 + 3];
    if (a < 128) continue;
    t.data[i * 4] = over.data[i * 4]; t.data[i * 4 + 1] = over.data[i * 4 + 1]; t.data[i * 4 + 2] = over.data[i * 4 + 2];
    t.data[i * 4 + 3] = TINT_ALPHA;
  }
  return true;
}

/** Leaves: leaf pixels take the foliage tint; `opaque` fills the holes (fast graphics). */
function leaves(path: string, opaque: boolean): (t: PixelTile) => boolean {
  return (t) => {
    if (!plain(path)(t)) return false;
    for (let i = 0; i < 256; i++) {
      if (t.data[i * 4 + 3] > 0) t.data[i * 4 + 3] = TINT_ALPHA;
      else if (opaque) { t.data[i * 4] = 38; t.data[i * 4 + 1] = 38; t.data[i * 4 + 2] = 38; t.data[i * 4 + 3] = 255; }
    }
    return true;
  };
}

/** Lever handle box: the stick column of the lever texture, repeated. */
function leverHandle(t: PixelTile): boolean {
  const img = images.get('block/lever');
  if (!img) return false;
  let top = 0; let bottom = 15;
  while (top < 15 && img.data[(top * 16 + 7) * 4 + 3] === 0) top++;
  while (bottom > top && img.data[(bottom * 16 + 7) * 4 + 3] === 0) bottom--;
  for (let y = 0; y < 16; y++) {
    const sy = top + Math.floor((y / 16) * (bottom - top + 1));
    for (let x = 0; x < 16; x++) {
      const si = (sy * 16 + 7 + (x & 1)) * 4;
      t.set(x, y, [img.data[si], img.data[si + 1], img.data[si + 2]], 255);
    }
  }
  return true;
}

/** Copy a rectangle of an image into the tile, optionally flipped vertically. */
function blit(img: PackImage, t: PixelTile, sx: number, sy: number, w: number, h: number, dx: number, dy: number, flipY = false): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const yy = flipY ? sy + h - 1 - y : sy + y;
      const si = (yy * img.w + sx + x) * 4;
      if (img.data[si + 3] === 0) continue;
      t.set(dx + x, dy + y, [img.data[si], img.data[si + 1], img.data[si + 2]], img.data[si + 3]);
    }
  }
}

/**
 * Chest faces from the chest entity texture. The chest block is a 14x14x14
 * box (inset one pixel), so faces use tile columns 1..14 and rows 2..15. The
 * entity texture stores the model upside down, hence the vertical flips.
 */
function chestFace(face: 'top' | 'side' | 'front'): (t: PixelTile) => boolean {
  return (t) => {
    const img = images.get('entity/chest/normal');
    if (!img) return false;
    t.clear();
    if (face === 'top') {
      blit(img, t, 28, 0, 14, 14, 1, 1, true);
      return true;
    }
    const col = face === 'front' ? 42 : 0;
    blit(img, t, col, 33, 14, 10, 1, 6, true); // base, model y 0..10
    blit(img, t, col, 14, 14, 5, 1, 2, true); // lid, model y 9..14
    if (face === 'front') blit(img, t, 1, 1, 2, 4, 7, 5, true); // latch
    return true;
  };
}

const WOOL = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const DYES = ['ink_sac', 'red_dye', 'green_dye', 'cocoa_beans', 'lapis_lazuli', 'purple_dye', 'cyan_dye', 'light_gray_dye', 'gray_dye', 'pink_dye', 'lime_dye', 'yellow_dye', 'light_blue_dye', 'magenta_dye', 'orange_dye', 'bone_meal'];

/** Our block texture name -> how to build it from the pack. */
const BLOCKS: Record<string, (t: PixelTile) => boolean> = {};
const b = (name: string, f: string | ((t: PixelTile) => boolean)) => { BLOCKS[name] = typeof f === 'string' ? plain(`block/${f}`) : f; };
for (const n of ['stone', 'dirt', 'cobblestone', 'mossy_cobblestone', 'bedrock', 'sand', 'gravel', 'clay', 'snow', 'ice',
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'redstone_ore', 'lapis_ore', 'dead_bush', 'dandelion', 'cactus_side',
  'cactus_top', 'cactus_bottom', 'pumpkin_top', 'pumpkin_side', 'melon_side', 'melon_top', 'mycelium_top', 'mycelium_side',
  'mushroom_block_inside', 'glass', 'bricks', 'stone_bricks', 'sandstone_top', 'sandstone_bottom', 'obsidian', 'gold_block',
  'iron_block', 'diamond_block', 'lapis_block', 'sponge', 'bookshelf', 'tnt_side', 'tnt_top', 'tnt_bottom',
  'crafting_table_top', 'crafting_table_side', 'crafting_table_front', 'furnace_side', 'furnace_top', 'furnace_front',
  'jukebox_side', 'jukebox_top', 'cake_top', 'cake_side', 'cake_bottom', 'torch', 'redstone_torch_off', 'ladder', 'rail',
  'lever', 'repeater_on', 'piston_side', 'piston_top', 'piston_top_sticky', 'piston_bottom', 'iron_bars', 'spawner',
  'cobweb', 'end_stone', 'end_portal_frame_top', 'end_portal_frame_side', 'end_portal_frame_eye', 'dragon_egg',
  'netherrack', 'soul_sand', 'glowstone', 'enchanting_table_top', 'enchanting_table_side', 'enchanting_table_bottom',
  'brewing_stand', 'brewing_stand_base', 'cauldron_side', 'cauldron_top', 'cauldron_bottom']) b(n, n);
b('grass_top', tintMask('block/grass_block_top'));
b('grass_side', grassSide);
b('grass_side_snow', 'grass_block_snow');
b('water', tinted('block/water_still', [63, 118, 228]));
b('lava', 'lava_still');
b('redstone_ore_lit', 'redstone_ore');
for (const w of ['oak', 'spruce', 'birch']) {
  b(`log_${w}`, `${w}_log`);
  b(`log_${w}_top`, `${w}_log_top`);
  b(`planks_${w}`, `${w}_planks`);
  b(`leaves_${w}`, leaves(`block/${w}_leaves`, false));
  b(`leaves_${w}_opaque`, leaves(`block/${w}_leaves`, true));
  b(`sapling_${w}`, `${w}_sapling`);
}
b('tall_grass', 'short_grass');
b('fern', 'fern');
b('rose', 'poppy');
b('mushroom_brown', 'brown_mushroom');
b('mushroom_red', 'red_mushroom');
b('sugar_cane', 'sugar_cane');
b('pumpkin_face', 'carved_pumpkin');
b('pumpkin_face_lit', 'jack_o_lantern');
b('stem', tinted('block/melon_stem', [120, 190, 50]));
b('lily_pad', 'lily_pad');
b('mushroom_block_brown', 'brown_mushroom_block');
b('mushroom_block_red', 'red_mushroom_block');
b('mushroom_block_stem', 'mushroom_stem');
for (let i = 0; i < 8; i++) b(`wheat_${i}`, `wheat_stage${i}`);
for (let i = 0; i < 3; i++) b(`nether_wart_${i}`, `nether_wart_stage${i}`);
b('farmland_dry', 'farmland');
b('farmland_wet', 'farmland_moist');
WOOL.forEach((c, i) => b(`wool_${i}`, `${c}_wool`));
b('stone_bricks_mossy', 'mossy_stone_bricks');
b('stone_bricks_cracked', 'cracked_stone_bricks');
b('stone_bricks_chiseled', 'chiseled_stone_bricks');
b('slab_stone_top', 'smooth_stone');
b('slab_stone_side', 'smooth_stone_slab_side');
b('sandstone_side', 'sandstone');
b('furnace_front_lit', 'furnace_front_on');
b('chest_top', chestFace('top'));
b('chest_side', chestFace('side'));
b('chest_front', chestFace('front'));
b('noteblock', 'note_block');
b('redstone_torch_on', 'redstone_torch');
b('rail_turn', 'rail_corner');
b('rail_powered', 'powered_rail');
b('rail_powered_on', 'powered_rail_on');
b('rail_detector', 'detector_rail');
b('redstone_dust', 'redstone_dust_dot');
b('redstone_dust_dot', 'redstone_dust_dot');
b('redstone_dust_line', 'redstone_dust_line0');
b('lever_handle', leverHandle);
b('repeater_off', 'repeater');
b('trapdoor', 'oak_trapdoor');
b('door_wood_upper', 'oak_door_top');
b('door_wood_lower', 'oak_door_bottom');
b('door_iron_upper', 'iron_door_top');
b('door_iron_lower', 'iron_door_bottom');
b('fire', 'fire_0');
b('portal', 'nether_portal');
b('nether_brick', 'nether_bricks');
for (let i = 0; i < 10; i++) b(`destroy_${i}`, `destroy_stage_${i}`);

/** Build a block tile from the pack; false when the pack lacks it. */
export function packBlockTile(name: string, tile: PixelTile): boolean {
  if (!packActive()) return false;
  const f = BLOCKS[name];
  return f ? f(tile) : false;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const ITEMS: Record<string, (t: PixelTile) => boolean> = {};
const it = (name: string, f: string | ((t: PixelTile) => boolean)) => { ITEMS[name] = typeof f === 'string' ? plain(`item/${f}`) : f; };

/** Grey base multiplied by a colour with an untinted overlay on top. */
function dyedWithOverlay(base: string, overlay: string, c: RGB): (t: PixelTile) => boolean {
  return (t) => {
    const o = images.get(`item/${overlay}`);
    if (!tinted(`item/${base}`, c)(t)) return false;
    if (o) blit(o, t, 0, 0, 16, 16, 0, 0);
    return true;
  };
}

/** Potion bottle with the liquid overlay coloured by the potion kind. */
function potion(splash: boolean, c: RGB): (t: PixelTile) => boolean {
  return (t) => {
    const bottle = images.get(`item/${splash ? 'splash_potion' : 'potion'}`);
    const liquid = images.get('item/potion_overlay');
    if (!bottle || !liquid) return false;
    t.clear();
    for (let i = 0; i < 256; i++) {
      if (liquid.data[i * 4 + 3] === 0) continue;
      t.set(i & 15, i >> 4, [(liquid.data[i * 4] * c[0]) / 255, (liquid.data[i * 4 + 1] * c[1]) / 255, (liquid.data[i * 4 + 2] * c[2]) / 255], liquid.data[i * 4 + 3]);
    }
    blit(bottle, t, 0, 0, 16, 16, 0, 0);
    return true;
  };
}

for (const tool of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
  for (const m of ['wooden', 'stone', 'iron', 'diamond']) it(`${m}_${tool}`, `${m}_${tool}`);
  it(`gold_${tool}`, `golden_${tool}`);
}
for (const piece of ['helmet', 'chestplate', 'leggings', 'boots']) {
  for (const m of ['iron', 'diamond']) it(`${m}_${piece}`, `${m}_${piece}`);
  it(`gold_${piece}`, `golden_${piece}`);
  it(`leather_${piece}`, dyedWithOverlay(`leather_${piece}`, `leather_${piece}_overlay`, [160, 101, 64]));
}
for (const n of ['stick', 'blaze_rod', 'bone', 'coal', 'charcoal', 'diamond', 'iron_ingot', 'gold_ingot', 'brick', 'gold_nugget',
  'flint', 'apple', 'golden_apple', 'bread', 'porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'rotten_flesh', 'chicken',
  'cooked_chicken', 'bowl', 'mushroom_stew', 'cookie', 'spider_eye', 'fermented_spider_eye', 'bow', 'arrow', 'bucket',
  'water_bucket', 'lava_bucket', 'milk_bucket', 'flint_and_steel', 'shears', 'fishing_rod', 'string', 'feather', 'gunpowder',
  'glowstone_dust', 'sugar', 'blaze_powder', 'pumpkin_seeds', 'melon_seeds', 'wheat', 'iron_door', 'minecart', 'redstone',
  'snowball', 'slime_ball', 'magma_cream', 'ender_pearl', 'ender_eye', 'ghast_tear', 'leather', 'clay_ball', 'egg', 'paper',
  'book', 'map', 'cake', 'repeater', 'nether_wart', 'glass_bottle', 'brewing_stand', 'cauldron']) it(n, n);
it('fish', 'cod');
it('cooked_fish', 'cooked_cod');
it('melon', 'melon_slice');
it('seeds', 'wheat_seeds');
it('reeds', 'sugar_cane');
it('sign', 'oak_sign');
it('wooden_door', 'oak_door');
it('boat', 'oak_boat');
it('compass', 'compass_00');
it('clock', 'clock_00');
it('speckled_melon', 'glistering_melon_slice');
DYES.forEach((d, i) => it(`dye_${i}`, d));

/** Potion kinds use these liquid colours (index = potion kind). */
export const PACK_POTION_COLORS: RGB[] = [
  [56, 93, 198], [56, 93, 198], [56, 93, 198], [56, 93, 198], [205, 92, 171], [124, 175, 198], [228, 154, 58],
  [78, 147, 49], [248, 36, 35], [72, 77, 72], [147, 36, 35], [90, 108, 129], [67, 10, 9],
];
PACK_POTION_COLORS.forEach((c, kind) => {
  it(`potion_${kind}`, potion(false, c));
  it(`potion_${kind}_splash`, potion(true, c));
});

export function packItemTile(name: string, tile: PixelTile): boolean {
  if (!packActive()) return false;
  const f = ITEMS[name];
  return f ? f(tile) : false;
}

// ---------------------------------------------------------------------------
// Files to import from a pack zip (paths under assets/minecraft/textures/)
// ---------------------------------------------------------------------------

/** Every pack file the game can use, so the importer copies nothing else. */
export function wantedPackFiles(): string[] {
  const out = new Set<string>();
  // Collect by running the builders against a recording image map.
  const record = (p: string) => out.add(`${p}.png`);
  const realGet = images.get.bind(images);
  images.get = ((key: string) => { record(key); return undefined; }) as typeof images.get;
  const t = new PixelTile('probe');
  for (const f of Object.values(BLOCKS)) f(t);
  for (const f of Object.values(ITEMS)) f(t);
  images.get = realGet;
  for (const p of EXTRA_FILES) out.add(`${p}.png`);
  for (const p of ENTITY_FILES) out.add(`${p}.png`);
  return Array.from(out).sort();
}

/** Mob and vehicle skins (see render/mobmodels.ts). */
export const ENTITY_FILES: string[] = [
  'entity/pig/pig_temperate', 'entity/cow/cow_temperate', 'entity/cow/mooshroom_red', 'entity/sheep/sheep',
  'entity/sheep/sheep_wool', 'entity/chicken/chicken_temperate', 'entity/squid/squid', 'entity/wolf/wolf',
  'entity/wolf/wolf_tame', 'entity/wolf/wolf_angry', 'entity/zombie/zombie', 'entity/skeleton/skeleton',
  'entity/creeper/creeper', 'entity/spider/spider', 'entity/spider/cave_spider', 'entity/slime/slime',
  'entity/slime/magmacube', 'entity/enderman/enderman', 'entity/enderman/enderman_eyes', 'entity/silverfish/silverfish',
  'entity/ghast/ghast', 'entity/ghast/ghast_shooting', 'entity/blaze/blaze', 'entity/enderdragon/dragon',
  'entity/villager/villager', 'entity/end_crystal/end_crystal', 'entity/minecart/minecart', 'entity/boat/oak',
  'entity/player/wide/steve', 'entity/fishing/fishing_hook', 'entity/experience/experience_orb',
  'entity/piglin/zombified_piglin', 'entity/end_crystal/end_crystal_beam', 'entity/villager/type/plains',
  'entity/villager/profession/farmer', 'entity/villager/profession/librarian', 'entity/villager/profession/cleric',
  'entity/villager/profession/weaponsmith', 'entity/villager/profession/butcher',
];

/** Non-tile files used by the HUD, screens, mobs and sky. */
export const EXTRA_FILES: string[] = [
  'entity/chest/normal',
  // HUD
  'gui/sprites/hud/heart/container', 'gui/sprites/hud/heart/container_blinking', 'gui/sprites/hud/heart/full',
  'gui/sprites/hud/heart/half', 'gui/sprites/hud/heart/full_blinking', 'gui/sprites/hud/heart/half_blinking',
  'gui/sprites/hud/heart/poisoned_full', 'gui/sprites/hud/heart/poisoned_half', 'gui/sprites/hud/heart/hardcore_full',
  'gui/sprites/hud/heart/hardcore_half', 'gui/sprites/hud/heart/container_hardcore',
  'gui/sprites/hud/food_empty', 'gui/sprites/hud/food_full', 'gui/sprites/hud/food_half', 'gui/sprites/hud/food_empty_hunger',
  'gui/sprites/hud/food_full_hunger', 'gui/sprites/hud/food_half_hunger', 'gui/sprites/hud/armor_empty',
  'gui/sprites/hud/armor_full', 'gui/sprites/hud/armor_half', 'gui/sprites/hud/air', 'gui/sprites/hud/air_bursting',
  'gui/sprites/hud/hotbar', 'gui/sprites/hud/hotbar_selection', 'gui/sprites/hud/crosshair',
  'gui/sprites/hud/experience_bar_background', 'gui/sprites/hud/experience_bar_progress',
  'gui/sprites/boss_bar/pink_background', 'gui/sprites/boss_bar/pink_progress',
  // Screens
  'gui/container/inventory', 'gui/container/crafting_table', 'gui/container/furnace', 'gui/container/generic_54',
  'gui/container/brewing_stand', 'gui/container/enchanting_table',
  'gui/sprites/container/furnace/burn_progress', 'gui/sprites/container/furnace/lit_progress',
  'gui/sprites/container/brewing_stand/brew_progress', 'gui/sprites/container/brewing_stand/bubbles',
  'gui/sprites/widget/button', 'gui/sprites/widget/button_highlighted', 'gui/sprites/widget/button_disabled',
  'gui/menu_background', 'font/ascii',
  // Sky and weather
  'environment/celestial/sun', 'environment/celestial/moon/full_moon', 'environment/celestial/moon/waning_gibbous',
  'environment/celestial/moon/third_quarter', 'environment/celestial/moon/waning_crescent',
  'environment/celestial/moon/new_moon', 'environment/celestial/moon/waxing_crescent',
  'environment/celestial/moon/first_quarter', 'environment/celestial/moon/waxing_gibbous', 'environment/clouds', 'environment/rain',
  'environment/snow', 'environment/end_sky', 'misc/underwater', 'misc/vignette', 'misc/enchanted_glint_item',
];

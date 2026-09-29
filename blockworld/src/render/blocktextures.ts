/**
 * Original 16x16 block textures, painted procedurally. Every texture name the
 * block registry references is produced here. The goal is the readable, noisy,
 * hard-edged look of an early-2010s PC voxel game - not photorealism.
 */

import { packBlockTile } from './pack';
import { DYE_COLOR_RGB } from '../blocks/ids';
import { PixelTile, TINT_ALPHA, hex, mix, shade, type RGB } from './pixel';

type Painter = (t: PixelTile) => void;
const painters = new Map<string, Painter>();
const paint = (name: string, fn: Painter): void => {
  painters.set(name, fn);
};

// ---------------------------------------------------------------------------
// Shared building blocks
// ---------------------------------------------------------------------------
const STONE: RGB = [122, 122, 122];
const DIRT: RGB = [134, 96, 67];

function stoneBase(t: PixelTile, base: RGB = STONE): void {
  t.noise(base, 9);
  // Soft darker streaks and highlights for the classic "rough rock" look.
  for (let i = 0; i < 7; i++) {
    const x = t.rng.int(16);
    const y = t.rng.int(16);
    const len = t.rng.range(2, 5);
    for (let k = 0; k < len; k++) t.set((x + k) & 15, y, shade(base, -22 + t.rng.int(8)));
  }
  for (let i = 0; i < 6; i++) t.set(t.rng.int(16), t.rng.int(16), shade(base, 16));
}

function dirtBase(t: PixelTile): void {
  t.noise(DIRT, 12);
  t.blobs(10, [108, 76, 52], 1, 3, 6, 0);
  t.blobs(6, [156, 114, 80], 1, 2, 6, 0);
  t.blobs(3, [118, 118, 118], 1, 1, 8, 0);
}

function ore(t: PixelTile, color: RGB, highlight: RGB, clusters = 5): void {
  stoneBase(t);
  for (let c = 0; c < clusters; c++) {
    const cx = t.rng.range(2, 13);
    const cy = t.rng.range(2, 13);
    const pts: [number, number][] = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]];
    const n = t.rng.range(3, 5);
    for (let k = 0; k < n; k++) {
      const [dx, dy] = pts[k];
      t.set(cx + dx, cy + dy, shade(color, t.rng.range(-18, 8)));
    }
    t.set(cx, cy, highlight);
    t.set(cx + 1, cy + 1, shade(color, -40));
  }
}

function planks(t: PixelTile, base: RGB): void {
  t.noise(base, 6);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      // Horizontal grain.
      if (t.rng.chance(0.18)) t.set(x, y, shade(base, -14));
    }
    if (y % 4 === 3) for (let x = 0; x < 16; x++) t.set(x, y, shade(base, -38));
  }
  // Staggered board joints.
  const joints = [[3, 0], [11, 1], [6, 2], [14, 3]];
  for (const [x, row] of joints) {
    for (let y = row * 4; y < row * 4 + 3; y++) t.set(x, y, shade(base, -34));
  }
  for (let row = 0; row < 4; row++) t.set(t.rng.int(16), row * 4 + 1, shade(base, 12));
}

function logSide(t: PixelTile, base: RGB, dark: RGB): void {
  t.noise(base, 8);
  for (let x = 0; x < 16; x++) {
    if (t.rng.chance(0.45)) {
      const start = t.rng.int(16);
      const len = t.rng.range(4, 12);
      for (let k = 0; k < len; k++) t.set(x, (start + k) & 15, shade(dark, t.rng.range(-6, 6)));
    }
  }
}

function logTop(t: PixelTile, bark: RGB, inner: RGB, ring: RGB): void {
  t.noise(inner, 6);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.5) t.set(x, y, shade(bark, t.rng.range(-8, 8)));
      else if (Math.round(d) % 2 === 0 && d > 1) t.set(x, y, shade(ring, t.rng.range(-5, 5)));
    }
  }
}

function leaves(t: PixelTile, holes: number): void {
  t.clear();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      if (t.rng.chance(holes)) continue;
      const v = 150 + t.rng.range(-40, 40);
      t.set(x, y, [v, v, v]);
    }
  }
}

function bricksPattern(t: PixelTile, brick: RGB, mortar: RGB, rowH: number, brickW: number): void {
  t.noise(brick, 10);
  for (let y = 0; y < 16; y++) {
    const row = Math.floor(y / rowH);
    const offset = row % 2 === 0 ? 0 : brickW / 2;
    for (let x = 0; x < 16; x++) {
      if (y % rowH === rowH - 1 || (x + offset) % brickW === 0) t.set(x, y, shade(mortar, t.rng.range(-8, 8)));
    }
  }
}

function metalBlock(t: PixelTile, base: RGB, light: RGB, dark: RGB): void {
  t.noise(base, 5);
  t.rect(0, 0, 16, 1, light).rect(0, 0, 1, 16, light);
  t.rect(0, 15, 16, 1, dark).rect(15, 0, 1, 16, dark);
  t.rect(3, 3, 10, 1, light).rect(3, 12, 10, 1, dark);
  for (let i = 0; i < 8; i++) t.set(t.rng.range(2, 13), t.rng.range(2, 13), shade(light, 10));
}

function crossPlant(t: PixelTile, rows: string[], palette: Record<string, RGB | null>): void {
  t.clear();
  t.art(rows, palette);
}

// ---------------------------------------------------------------------------
// Natural terrain
// ---------------------------------------------------------------------------
paint('missing', (t) => t.map((x, y) => [((x >> 3) + (y >> 3)) % 2 ? [248, 0, 248] : [0, 0, 0], 255]));
paint('stone', (t) => stoneBase(t));
paint('dirt', (t) => dirtBase(t));
paint('grass_top', (t) => {
  t.noise([168, 168, 168], 22, TINT_ALPHA);
  for (let i = 0; i < 26; i++) {
    const v = 120 + t.rng.int(25);
    t.set(t.rng.int(16), t.rng.int(16), [v, v, v], TINT_ALPHA);
  }
});
paint('grass_side', (t) => {
  dirtBase(t);
  for (let x = 0; x < 16; x++) {
    const depth = 3 + (t.rng.chance(0.5) ? 1 : 0) + (t.rng.chance(0.25) ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      const v = 150 + t.rng.range(-26, 26);
      t.set(x, y, [v, v, v], TINT_ALPHA);
    }
  }
});
paint('grass_side_snow', (t) => {
  dirtBase(t);
  for (let x = 0; x < 16; x++) {
    const depth = 3 + t.rng.int(2);
    for (let y = 0; y < depth; y++) t.set(x, y, shade([240, 250, 250], t.rng.range(-8, 4)));
  }
});
paint('cobblestone', (t) => {
  t.fill([90, 90, 90]);
  // Irregular rounded stones via jittered cell centres.
  const centers: [number, number, number][] = [];
  for (let i = 0; i < 9; i++) centers.push([t.rng.range(0, 15), t.rng.range(0, 15), t.rng.range(95, 150)]);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let best = 1e9;
      let second = 1e9;
      let shadeV = 120;
      for (const [cx, cy, v] of centers) {
        for (const ox of [-16, 0, 16]) for (const oy of [-16, 0, 16]) {
          const d = (x - cx - ox) ** 2 + (y - cy - oy) ** 2;
          if (d < best) { second = best; best = d; shadeV = v; } else if (d < second) second = d;
        }
      }
      if (Math.sqrt(second) - Math.sqrt(best) < 1.1) t.set(x, y, shade([70, 70, 70], t.rng.range(-8, 8)));
      else t.set(x, y, shade([shadeV, shadeV, shadeV], t.rng.range(-10, 10) + (best < 3 ? 10 : 0)));
    }
  }
});
paint('mossy_cobblestone', (t) => {
  painters.get('cobblestone')!(t);
  t.blobs(9, [72, 110, 58], 2, 7, 12, 0);
});
paint('bedrock', (t) => {
  t.noise([60, 60, 60], 30);
  t.blobs(10, [25, 25, 25], 2, 6, 8, 0);
  t.blobs(6, [110, 110, 110], 1, 3, 10, 0);
});
paint('sand', (t) => {
  t.noise([219, 207, 160], 8);
  t.blobs(8, [200, 186, 138], 1, 2, 4, 0);
  t.blobs(5, [234, 224, 184], 1, 2, 4, 0);
});
paint('gravel', (t) => {
  t.noise([128, 122, 120], 10);
  for (let i = 0; i < 22; i++) {
    const c: RGB = t.rng.pick([[96, 90, 88], [152, 146, 142], [110, 100, 92], [170, 160, 150]] as RGB[]);
    const x = t.rng.int(15);
    const y = t.rng.int(15);
    t.set(x, y, c).set(x + 1, y, shade(c, -8)).set(x, y + 1, shade(c, -16));
  }
});
paint('clay', (t) => {
  t.noise([160, 166, 180], 7);
  t.blobs(6, [146, 152, 166], 2, 4, 5, 0);
});
paint('snow', (t) => {
  t.noise([240, 250, 252], 5);
  t.blobs(6, [220, 232, 238], 1, 3, 3, 0);
});
paint('ice', (t) => {
  t.noise([120, 170, 245], 10, 170);
  for (let i = 0; i < 5; i++) {
    const x = t.rng.int(16);
    const y = t.rng.int(16);
    for (let k = 0; k < 4; k++) t.set((x + k) & 15, (y - k) & 15, [190, 220, 255], 190);
  }
});
paint('water', (t) => {
  t.noise([46, 74, 210], 10, 175);
  for (let y = 0; y < 16; y += 4) {
    const off = t.rng.int(16);
    for (let k = 0; k < 5; k++) t.set((off + k) & 15, y + t.rng.int(2), [90, 120, 240], 180);
  }
});
paint('lava', (t) => {
  t.noise([214, 90, 18], 20);
  t.blobs(10, [252, 180, 40], 2, 6, 14, 0);
  t.blobs(6, [160, 40, 10], 2, 4, 10, 0);
});
paint('coal_ore', (t) => ore(t, [36, 36, 36], [70, 70, 70]));
paint('iron_ore', (t) => ore(t, [200, 160, 132], [236, 204, 180]));
paint('gold_ore', (t) => ore(t, [240, 214, 60], [255, 250, 160]));
paint('diamond_ore', (t) => ore(t, [80, 220, 230], [210, 255, 255], 4));
paint('redstone_ore', (t) => ore(t, [160, 10, 10], [240, 60, 60]));
paint('redstone_ore_lit', (t) => ore(t, [230, 40, 40], [255, 150, 150]));
paint('lapis_ore', (t) => ore(t, [30, 70, 190], [90, 130, 240]));

// ---------------------------------------------------------------------------
// Wood & plants
// ---------------------------------------------------------------------------
paint('log_oak', (t) => logSide(t, [104, 83, 50], [74, 58, 34]));
paint('log_spruce', (t) => logSide(t, [60, 40, 20], [42, 27, 12]));
paint('log_birch', (t) => {
  t.noise([214, 214, 204], 6);
  for (let i = 0; i < 9; i++) {
    const x = t.rng.int(14);
    const y = t.rng.int(16);
    const w = t.rng.range(1, 3);
    t.rect(x, y, w, 1, [40, 40, 36]);
  }
});
paint('log_oak_top', (t) => logTop(t, [104, 83, 50], [170, 138, 86], [140, 112, 68]));
paint('log_spruce_top', (t) => logTop(t, [60, 40, 20], [120, 90, 54], [96, 70, 40]));
paint('log_birch_top', (t) => logTop(t, [214, 214, 204], [196, 178, 124], [168, 150, 100]));
paint('planks_oak', (t) => planks(t, [160, 130, 80]));
paint('planks_spruce', (t) => planks(t, [104, 78, 46]));
paint('planks_birch', (t) => planks(t, [196, 180, 124]));
paint('leaves_oak', (t) => leaves(t, 0.22));
paint('leaves_spruce', (t) => leaves(t, 0.18));
paint('leaves_birch', (t) => leaves(t, 0.24));
for (const kind of ['oak', 'spruce', 'birch']) {
  // "Fast graphics" leaves: holes filled so the block can be drawn opaque.
  paint(`leaves_${kind}_opaque`, (t) => {
    painters.get(`leaves_${kind}`)!(t);
    t.map((_x, _y, _c, a) => (a === 0 ? [[64, 64, 64], 255] : null));
  });
}
const SAPLING_ROWS = [
  '................',
  '.......gg.......',
  '.....gGggGg.....',
  '....gGgGGgGg....',
  '...gGGgggGGgg...',
  '....ggGGgGgg....',
  '.....gGgGgg.....',
  '......gbGg......',
  '.......b........',
  '.......b........',
  '......bb........',
  '.......b........',
  '.......b........',
  '.......b........',
  '.......b........',
  '................',
];
paint('sapling_oak', (t) => crossPlant(t, SAPLING_ROWS, { g: [60, 130, 40], G: [90, 170, 60], b: [100, 76, 42] }));
paint('sapling_spruce', (t) => crossPlant(t, SAPLING_ROWS, { g: [40, 80, 50], G: [60, 110, 70], b: [70, 50, 26] }));
paint('sapling_birch', (t) => crossPlant(t, SAPLING_ROWS, { g: [100, 150, 60], G: [140, 190, 90], b: [210, 210, 200] }));
paint('tall_grass', (t) => {
  t.clear();
  for (let i = 0; i < 9; i++) {
    const x = t.rng.range(1, 14);
    const h = t.rng.range(6, 14);
    const lean = t.rng.pick([-1, 0, 1]);
    for (let k = 0; k < h; k++) {
      const v = 130 + t.rng.range(-30, 40);
      t.set(x + Math.floor((k * lean) / 5), 15 - k, [v, v, v]);
    }
  }
});
paint('fern', (t) => {
  t.clear();
  for (let k = 0; k < 13; k++) {
    const v = 140 + t.rng.range(-20, 30);
    t.set(7, 15 - k, [v, v, v]);
    if (k > 2 && k % 2 === 0) {
      const w = Math.max(1, 6 - Math.floor(k / 3));
      for (let j = 1; j <= w; j++) {
        t.set(7 - j, 15 - k - (j > 2 ? 1 : 0), [v - 15, v - 15, v - 15]);
        t.set(7 + j, 15 - k - (j > 2 ? 1 : 0), [v - 15, v - 15, v - 15]);
      }
    }
  }
});
paint('dead_bush', (t) => crossPlant(t, [
  '................',
  '..b.........b...',
  '...b...b...b....',
  '....b..b..b..b..',
  '.b...b.b.b..b...',
  '..b...bbb..b....',
  '...bb..b..b.....',
  '.....b.b.b......',
  '......bbb.......',
  '.......b........',
  '.......b........',
  '.......b........',
  '......bb........',
  '.......b........',
  '.......b........',
  '................',
], { b: [124, 84, 40] }));
paint('dandelion', (t) => crossPlant(t, [
  '................', '................', '................', '................',
  '................', '................', '......yyy.......', '.....yYYYy......',
  '.....yYoYy......', '.....yYYYy......', '......yyy.......', '.......g........',
  '......gg.g......', '.......gg.......', '.......g........', '.......g........',
], { y: [230, 200, 20], Y: [255, 240, 60], o: [240, 150, 20], g: [60, 140, 30] }));
paint('rose', (t) => crossPlant(t, [
  '................', '................', '................', '................',
  '......rr........', '.....rRRr.......', '....rRrRRr......', '....rRRrRr......',
  '.....rRRr.......', '......rr........', '.......g..g.....', '.......g.gg.....',
  '.....gg.g.......', '......ggg.......', '.......g........', '.......g........',
], { r: [150, 10, 10], R: [220, 30, 30], g: [50, 120, 30] }));
paint('mushroom_brown', (t) => crossPlant(t, [
  '................', '................', '................', '................',
  '................', '................', '................', '................',
  '.....bbbbb......', '....bBBBBBb.....', '....bBBBBBb.....', '......www.......',
  '......www.......', '......www.......', '......www.......', '................',
], { b: [110, 80, 60], B: [150, 112, 86], w: [210, 200, 180] }));
paint('mushroom_red', (t) => crossPlant(t, [
  '................', '................', '................', '................',
  '................', '................', '................', '......rrr.......',
  '.....rWrrr......', '....rrrrWrr.....', '....rWrrrrr.....', '......www.......',
  '......www.......', '......www.......', '......www.......', '................',
], { r: [200, 30, 30], W: [255, 255, 255], w: [220, 210, 190] }));
paint('cactus_side', (t) => {
  t.clear();
  t.noiseRect(1, 0, 14, 16, [16, 120, 30], 10);
  for (let y = 0; y < 16; y++) {
    t.set(1, y, [10, 90, 20]);
    t.set(14, y, [10, 90, 20]);
    if (y % 4 === 1) { t.set(0, y, [220, 220, 180]); t.set(15, y + 2, [220, 220, 180]); }
  }
  for (const x of [4, 8, 11]) for (let y = 0; y < 16; y++) if (t.rng.chance(0.7)) t.set(x, y, [40, 150, 50]);
});
paint('cactus_top', (t) => {
  t.clear();
  t.noiseRect(1, 1, 14, 14, [30, 140, 40], 10);
  t.rect(3, 3, 10, 10, [60, 170, 70]);
  t.rect(7, 7, 2, 2, [200, 220, 150]);
});
paint('cactus_bottom', (t) => { t.clear(); t.noiseRect(1, 1, 14, 14, [20, 110, 30], 8); });
paint('sugar_cane', (t) => {
  t.clear();
  for (const x of [2, 7, 12]) {
    for (let y = 0; y < 16; y++) {
      const v = 160 + t.rng.range(-20, 20);
      t.set(x, y, [v, v, v]);
      t.set(x + 1, y, [v - 20, v - 20, v - 20]);
      if ((y + x) % 5 === 0) { t.set(x, y, [230, 230, 230]); t.set(x + 1, y, [200, 200, 200]); }
    }
    t.set(x + 2, (x * 3) % 13, [120, 120, 120]);
    t.set(x + 3, (x * 3) % 13 - 1, [120, 120, 120]);
  }
});
paint('pumpkin_top', (t) => {
  t.noise([196, 118, 24], 8);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    if (Math.round(d) % 4 === 0) t.set(x, y, [168, 96, 16]);
  }
  t.rect(7, 6, 2, 3, [90, 110, 40]);
});
paint('pumpkin_side', (t) => {
  t.noise([206, 122, 26], 8);
  for (const x of [0, 4, 8, 12]) for (let y = 0; y < 16; y++) t.set(x, y, shade([170, 96, 16], t.rng.range(-6, 6)));
  t.rect(0, 0, 16, 1, [180, 110, 20]);
});
const PUMPKIN_FACE = [
  '................', '................', '................', '................',
  '...XX......XX...', '..XXXX....XXXX..', '..XXXX....XXXX..', '................',
  '................', '..X..........X..', '..XXXXXXXXXXXX..', '...XXXXXXXXXX...',
  '....XX.XX.XX....', '................', '................', '................',
];
paint('pumpkin_face', (t) => { painters.get('pumpkin_side')!(t); t.art(PUMPKIN_FACE, { X: [50, 26, 6] }); });
paint('pumpkin_face_lit', (t) => { painters.get('pumpkin_side')!(t); t.art(PUMPKIN_FACE, { X: [255, 220, 60] }); });
paint('melon_side', (t) => {
  t.noise([118, 168, 32], 10);
  for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) t.set(x + (y % 5 === 0 ? 1 : 0), y, shade([80, 124, 20], t.rng.range(-6, 6)));
});
paint('melon_top', (t) => {
  t.noise([112, 160, 30], 10);
  t.rect(6, 6, 4, 4, [140, 190, 50]);
  for (let i = 0; i < 16; i += 3) { t.set(i, 7, [80, 124, 20]); t.set(7, i, [80, 124, 20]); }
});
paint('stem', (t) => {
  t.clear();
  for (let y = 4; y < 16; y++) {
    const x = 7 + (y % 4 === 0 ? 1 : 0);
    t.set(x, y, [150, 150, 150]);
    if (y % 3 === 0) t.set(x - 1, y - 1, [120, 120, 120]);
  }
});
paint('lily_pad', (t) => {
  t.clear();
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const d = Math.hypot(x - 7.5, y - 7.5);
    const notch = x >= 7 && x <= 8 && y > 7;
    if (d < 7.2 && !notch) {
      const v = 150 + t.rng.range(-20, 20) + (d > 6 ? -30 : 0);
      t.set(x, y, [v, v, v]);
    }
  }
});
paint('mycelium_top', (t) => {
  t.noise([112, 96, 110], 12);
  t.blobs(10, [140, 120, 136], 1, 3, 6, 0);
  t.blobs(6, [90, 80, 90], 1, 2, 6, 0);
});
paint('mycelium_side', (t) => {
  dirtBase(t);
  for (let x = 0; x < 16; x++) {
    const depth = 2 + t.rng.int(3);
    for (let y = 0; y < depth; y++) t.set(x, y, shade([112, 96, 110], t.rng.range(-12, 12)));
  }
});
paint('mushroom_block_brown', (t) => { t.noise([142, 106, 80], 10); t.border([122, 90, 66]); });
paint('mushroom_block_red', (t) => {
  t.noise([182, 28, 26], 10);
  t.blobs(5, [236, 230, 220], 2, 4, 6, 1);
});
paint('mushroom_block_stem', (t) => {
  t.noise([206, 200, 176], 6);
  for (let x = 0; x < 16; x += 3) for (let y = 0; y < 16; y++) if (t.rng.chance(0.5)) t.set(x, y, [186, 180, 156]);
});
paint('mushroom_block_inside', (t) => { t.noise([202, 170, 120], 8); t.blobs(8, [180, 150, 100], 1, 2, 4, 0); });
paint('wheat_0', (t) => wheat(t, 0));
for (let s = 0; s < 8; s++) paint(`wheat_${s}`, (t) => wheat(t, s));
function wheat(t: PixelTile, stage: number): void {
  t.clear();
  const h = 2 + Math.floor(stage * 1.7);
  const ripe = stage >= 7;
  const green: RGB = mix([60, 150, 30], [180, 160, 50], stage / 7);
  for (const x of [1, 4, 7, 10, 13]) {
    for (let k = 0; k < h; k++) t.set(x + (k > h - 3 && x % 2 ? 1 : 0), 15 - k, shade(green, t.rng.range(-15, 10)));
    if (stage >= 5) {
      for (let k = 0; k < 3; k++) t.set(x + 1, 15 - h + k, ripe ? [200, 170, 70] : [150, 150, 60]);
    }
  }
}
for (let s = 0; s < 3; s++) {
  paint(`nether_wart_${s}`, (t) => {
    t.clear();
    const h = 4 + s * 4;
    for (const x of [3, 7, 11]) {
      for (let k = 0; k < h; k++) t.set(x + (k % 3 === 2 ? 1 : 0), 15 - k, shade([150, 20, 30], t.rng.range(-20, 20)));
      t.rect(x - 1, 15 - h, 3, 2, s === 2 ? [190, 40, 50] : [120, 20, 30]);
    }
  });
}
paint('farmland_dry', (t) => {
  t.noise([120, 84, 56], 8);
  for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, y, shade([92, 62, 40], t.rng.range(-6, 6)));
});
paint('farmland_wet', (t) => {
  t.noise([74, 48, 30], 6);
  for (let y = 1; y < 16; y += 4) for (let x = 0; x < 16; x++) t.set(x, y, shade([52, 32, 20], t.rng.range(-5, 5)));
});

// ---------------------------------------------------------------------------
// Crafted / building blocks
// ---------------------------------------------------------------------------
paint('glass', (t) => {
  t.clear();
  t.border([220, 236, 240]);
  t.rect(1, 1, 14, 1, [200, 220, 228]);
  for (let k = 0; k < 4; k++) t.set(3 + k, 4 + k, [235, 245, 250]);
  for (let k = 0; k < 2; k++) t.set(4 + k, 3 + k, [235, 245, 250]);
  t.set(12, 11, [235, 245, 250]).set(11, 12, [235, 245, 250]);
});
for (let c = 0; c < 16; c++) {
  paint(`wool_${c}`, (t) => {
    const base = DYE_COLOR_RGB[c] as RGB;
    t.noise(base, 7);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      if ((x + y * 2) % 4 === 0) t.set(x, y, shade(base, -14));
      else if ((x * 3 + y) % 7 === 0) t.set(x, y, shade(base, 10));
    }
  });
}
paint('bricks', (t) => bricksPattern(t, [150, 74, 58], [180, 172, 164], 4, 8));
paint('stone_bricks', (t) => {
  t.noise([122, 122, 122], 7);
  for (let x = 0; x < 16; x++) { t.set(x, 7, [72, 72, 72]); t.set(x, 15, [72, 72, 72]); t.set(x, 0, [150, 150, 150]); t.set(x, 8, [150, 150, 150]); }
  for (let y = 0; y < 8; y++) { t.set(0, y, [150, 150, 150]); t.set(15, y, [72, 72, 72]); }
  for (let y = 8; y < 16; y++) { t.set(7, y, [72, 72, 72]); t.set(8, y, [150, 150, 150]); }
});
paint('stone_bricks_mossy', (t) => { painters.get('stone_bricks')!(t); t.blobs(8, [80, 112, 60], 2, 6, 12, 0); });
paint('stone_bricks_cracked', (t) => {
  painters.get('stone_bricks')!(t);
  let x = 3; let y = 1;
  for (let k = 0; k < 14; k++) {
    t.set(x, y, [60, 60, 60]);
    y++; x += t.rng.pick([-1, 0, 1]);
    x = Math.max(1, Math.min(14, x));
  }
});
paint('stone_bricks_chiseled', (t) => {
  t.noise([126, 126, 126], 6);
  t.border([80, 80, 80]);
  t.rect(3, 3, 10, 10, [100, 100, 100]);
  t.rect(4, 4, 8, 8, [136, 136, 136]);
  t.rect(6, 6, 4, 4, [96, 96, 96]);
});
paint('slab_stone_top', (t) => { t.noise([160, 160, 160], 5); t.border([130, 130, 130]); });
paint('slab_stone_side', (t) => {
  t.noise([160, 160, 160], 5);
  t.rect(0, 7, 16, 2, [120, 120, 120]).rect(0, 0, 16, 1, [180, 180, 180]).rect(0, 15, 16, 1, [120, 120, 120]);
});
paint('sandstone_top', (t) => { t.noise([220, 208, 164], 6); });
paint('sandstone_bottom', (t) => { t.noise([214, 200, 154], 8); t.blobs(6, [196, 182, 136], 1, 3, 4, 0); });
paint('sandstone_side', (t) => {
  t.noise([218, 205, 160], 6);
  t.rect(0, 0, 16, 3, [228, 216, 172]);
  t.rect(0, 3, 16, 1, [190, 176, 130]);
  for (let y = 7; y < 16; y += 4) for (let x = 0; x < 16; x++) if (t.rng.chance(0.6)) t.set(x, y, [200, 186, 140]);
});
paint('obsidian', (t) => {
  t.noise([22, 18, 34], 6);
  t.blobs(7, [58, 38, 92], 2, 5, 10, 0);
  t.blobs(4, [8, 6, 14], 2, 4, 3, 0);
});
paint('gold_block', (t) => metalBlock(t, [246, 208, 62], [255, 250, 160], [196, 150, 30]));
paint('iron_block', (t) => metalBlock(t, [214, 214, 214], [250, 250, 250], [160, 160, 160]));
paint('diamond_block', (t) => metalBlock(t, [98, 222, 216], [200, 255, 255], [40, 160, 160]));
paint('lapis_block', (t) => { metalBlock(t, [36, 68, 160], [90, 130, 220], [20, 40, 110]); t.blobs(6, [210, 180, 60], 1, 1, 6, 2); });
paint('sponge', (t) => { t.noise([200, 196, 70], 12); t.blobs(12, [150, 140, 40], 1, 2, 8, 0); });
paint('bookshelf', (t) => {
  planks(t, [160, 130, 80]);
  const colors: RGB[] = [[140, 30, 30], [40, 60, 140], [40, 110, 40], [150, 120, 40], [100, 40, 110], [60, 50, 40]];
  for (const rowY of [2, 9]) {
    t.rect(0, rowY - 1, 16, 6, [60, 42, 20]);
    let x = 1;
    while (x < 15) {
      const w = t.rng.range(1, 2);
      const c = t.rng.pick(colors);
      const h = t.rng.range(4, 5);
      t.rect(x, rowY + 5 - h, w, h, c);
      t.set(x, rowY + 5 - h + 1, shade(c, 50));
      x += w + (t.rng.chance(0.2) ? 1 : 0);
    }
  }
});
paint('tnt_side', (t) => {
  t.noise([190, 40, 30], 10);
  for (let x = 0; x < 16; x += 4) for (let y = 0; y < 16; y++) t.set(x, y, [150, 28, 20]);
  t.rect(0, 5, 16, 6, [226, 226, 216]);
  t.art(['XXX.X..X.XXX', '.X..XX.X..X.', '.X..X.XX..X.', '.X..X..X..X.'], { X: [30, 30, 30] }, 2, 6);
});
paint('tnt_top', (t) => {
  t.noise([190, 40, 30], 8);
  t.rect(4, 4, 8, 8, [226, 226, 216]);
  t.rect(7, 7, 2, 2, [40, 40, 40]);
});
paint('tnt_bottom', (t) => { t.noise([180, 36, 28], 8); t.rect(4, 4, 8, 8, [150, 28, 20]); });
paint('crafting_table_top', (t) => {
  planks(t, [150, 118, 72]);
  t.border([96, 70, 40]);
  t.rect(2, 2, 12, 1, [110, 84, 50]).rect(2, 7, 12, 1, [110, 84, 50]).rect(2, 12, 12, 1, [110, 84, 50]);
  t.rect(2, 2, 1, 11, [110, 84, 50]).rect(7, 2, 1, 11, [110, 84, 50]).rect(13, 2, 1, 11, [110, 84, 50]);
});
paint('crafting_table_side', (t) => {
  planks(t, [150, 118, 72]);
  t.rect(0, 0, 16, 3, [110, 84, 50]);
  // Saw and hammer silhouettes.
  t.rect(2, 5, 6, 2, [180, 180, 180]).rect(8, 5, 2, 2, [90, 60, 30]);
  t.rect(11, 5, 3, 2, [120, 120, 120]).rect(12, 7, 1, 6, [90, 60, 30]);
});
paint('crafting_table_front', (t) => {
  planks(t, [150, 118, 72]);
  t.rect(0, 0, 16, 3, [110, 84, 50]);
  t.rect(3, 5, 2, 8, [90, 60, 30]).rect(2, 5, 4, 2, [150, 150, 150]);
  t.rect(9, 6, 5, 5, [120, 90, 50]).border([96, 70, 40]);
});
paint('furnace_side', (t) => { stoneBase(t, [118, 118, 118]); t.rect(0, 0, 16, 2, [96, 96, 96]); });
paint('furnace_top', (t) => { stoneBase(t, [118, 118, 118]); t.border([96, 96, 96]); });
function furnaceFront(t: PixelTile, lit: boolean): void {
  painters.get('furnace_side')!(t);
  t.rect(3, 3, 10, 4, [70, 70, 70]).rect(4, 4, 8, 2, [96, 96, 96]);
  t.rect(3, 9, 10, 5, [40, 40, 40]);
  if (lit) {
    t.rect(4, 10, 8, 4, [220, 110, 20]);
    t.blobs(4, [255, 220, 80], 1, 3, 10, 0);
    t.rect(3, 9, 10, 1, [40, 40, 40]);
  } else {
    t.rect(4, 10, 8, 4, [16, 16, 16]);
  }
}
paint('furnace_front', (t) => furnaceFront(t, false));
paint('furnace_front_lit', (t) => furnaceFront(t, true));
paint('chest_top', (t) => { planks(t, [168, 120, 56]); t.border([80, 52, 20]); });
paint('chest_side', (t) => {
  planks(t, [168, 120, 56]);
  t.border([80, 52, 20]);
  t.rect(0, 5, 16, 1, [80, 52, 20]);
});
paint('chest_front', (t) => {
  painters.get('chest_side')!(t);
  t.rect(7, 4, 2, 4, [200, 200, 200]).rect(7, 7, 2, 1, [110, 110, 110]);
});
paint('noteblock', (t) => {
  planks(t, [120, 80, 50]);
  t.border([80, 50, 30]);
  t.art(['..XX', '..X.', '..X.', 'XXX.', 'XXX.'], { X: [40, 30, 20] }, 6, 5);
});
paint('jukebox_side', (t) => { planks(t, [120, 80, 50]); t.border([80, 50, 30]); });
paint('jukebox_top', (t) => { planks(t, [120, 80, 50]); t.border([80, 50, 30]); t.rect(3, 7, 10, 2, [30, 30, 30]); });
paint('bed_top', (t) => {
  t.noise([170, 30, 30], 8);
  t.rect(0, 0, 16, 5, [230, 230, 230]).rect(0, 4, 16, 1, [200, 200, 200]);
  t.rect(0, 5, 16, 1, [120, 20, 20]);
});
paint('bed_foot', (t) => {
  t.noise([170, 30, 30], 8);
  t.rect(0, 15, 16, 1, [120, 20, 20]);
});
paint('bed_side', (t) => {
  t.clear();
  t.noiseRect(0, 7, 16, 3, [170, 30, 30], 6);
  t.rect(0, 10, 16, 3, [140, 110, 70]).rect(0, 13, 2, 3, [140, 110, 70]).rect(14, 13, 2, 3, [140, 110, 70]);
});
paint('cake_top', (t) => { t.clear(); t.noiseRect(1, 1, 14, 14, [240, 236, 230], 5); t.blobs(5, [210, 30, 30], 1, 1, 0, 2); });
paint('cake_side', (t) => {
  t.clear();
  t.noiseRect(1, 8, 14, 8, [170, 110, 60], 8);
  t.noiseRect(1, 8, 14, 2, [240, 236, 230], 5);
  for (let x = 1; x < 15; x += 3) t.set(x, 10, [240, 236, 230]);
});
paint('cake_bottom', (t) => { t.clear(); t.noiseRect(1, 1, 14, 14, [160, 100, 56], 6); });

// ---------------------------------------------------------------------------
// Technical blocks
// ---------------------------------------------------------------------------
paint('torch', (t) => {
  t.clear();
  t.rect(7, 8, 2, 8, [110, 80, 40]);
  t.rect(7, 8, 1, 8, [130, 96, 50]);
  t.rect(7, 6, 2, 2, [255, 220, 80]);
  t.set(7, 6, [255, 255, 200]).set(8, 7, [255, 160, 40]);
});
paint('redstone_torch_on', (t) => {
  t.clear();
  t.rect(7, 8, 2, 8, [110, 80, 40]);
  t.rect(7, 6, 2, 2, [255, 40, 40]);
  t.set(7, 6, [255, 160, 160]);
});
paint('redstone_torch_off', (t) => {
  t.clear();
  t.rect(7, 8, 2, 8, [110, 80, 40]);
  t.rect(7, 6, 2, 2, [80, 20, 20]);
});
paint('ladder', (t) => {
  t.clear();
  t.rect(2, 0, 2, 16, [140, 104, 60]).rect(12, 0, 2, 16, [140, 104, 60]);
  t.rect(2, 0, 1, 16, [110, 80, 44]).rect(12, 0, 1, 16, [110, 80, 44]);
  for (const y of [2, 6, 10, 14]) t.rect(2, y, 12, 1, [160, 124, 76]).rect(4, y + 1, 8, 1, [100, 72, 40]);
});
function rail(t: PixelTile, railColor: RGB, extra?: RGB): void {
  t.clear();
  for (let y = 0; y < 16; y += 2) t.rect(2, y, 12, 1, [110, 80, 44]);
  t.rect(3, 0, 1, 16, railColor).rect(12, 0, 1, 16, railColor);
  t.rect(4, 0, 1, 16, shade(railColor, -40)).rect(11, 0, 1, 16, shade(railColor, -40));
  if (extra) for (let y = 1; y < 16; y += 2) t.rect(6, y, 4, 1, extra);
}
paint('rail', (t) => rail(t, [180, 180, 180]));
paint('rail_turn', (t) => {
  t.clear();
  for (let y = 0; y < 16; y += 2) t.rect(2, y, 12, 1, [110, 80, 44]);
  for (let k = 0; k < 16; k++) {
    const r1 = Math.round(Math.sqrt(Math.max(0, 12.5 ** 2 - k * k)));
    const r2 = Math.round(Math.sqrt(Math.max(0, 3.5 ** 2 - k * k)));
    t.set(16 - r1, k, [180, 180, 180]);
    if (k < 4) t.set(16 - r2, k, [180, 180, 180]);
  }
});
paint('rail_powered', (t) => rail(t, [230, 200, 60], [90, 20, 20]));
paint('rail_powered_on', (t) => rail(t, [230, 200, 60], [240, 40, 30]));
paint('rail_detector', (t) => rail(t, [170, 170, 170], [140, 30, 30]));
paint('redstone_dust', (t) => {
  t.clear();
  for (let i = 0; i < 16; i++) {
    t.set(i, 7, [200, 20, 20]).set(i, 8, [150, 10, 10]);
    t.set(7, i, [200, 20, 20]).set(8, i, [150, 10, 10]);
  }
  t.rect(6, 6, 4, 4, [230, 40, 40]);
});
// Dust pieces are painted light grey and tinted by power in the mesher.
paint('redstone_dust_dot', (t) => {
  t.clear();
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      if (d > 4.2 + t.rng.next() * 0.8) continue;
      const v = 200 + t.rng.int(56);
      t.set(x, y, [v, v, v]);
    }
  }
});
paint('redstone_dust_line', (t) => {
  t.clear();
  for (let y = 0; y < 16; y++) {
    for (let x = 5; x <= 10; x++) {
      if ((x === 5 || x === 10) && t.rng.next() < 0.5) continue;
      const v = 200 + t.rng.int(56);
      t.set(x, y, [v, v, v]);
    }
  }
});
paint('lever_handle', (t) => {
  t.noise([118, 88, 50], 10);
  for (let y = 0; y < 16; y += 4) t.rect(0, y, 16, 1, [96, 70, 40]);
});
paint('lever', (t) => {
  t.clear();
  t.rect(5, 11, 6, 4, [110, 110, 110]).rect(7, 3, 2, 9, [120, 90, 50]).rect(7, 3, 2, 1, [150, 110, 60]);
});
paint('repeater_off', (t) => {
  painters.get('slab_stone_top')!(t);
  t.rect(7, 1, 2, 14, [120, 30, 30]);
  t.rect(7, 3, 2, 2, [90, 20, 20]).rect(7, 10, 2, 2, [90, 20, 20]);
});
paint('repeater_on', (t) => {
  painters.get('slab_stone_top')!(t);
  t.rect(7, 1, 2, 14, [240, 40, 40]);
  t.rect(7, 3, 2, 2, [255, 120, 120]).rect(7, 10, 2, 2, [255, 120, 120]);
});
paint('piston_side', (t) => {
  stoneBase(t, [110, 110, 110]);
  t.noiseRect(0, 0, 16, 4, [160, 130, 80], 6);
  t.rect(0, 4, 16, 1, [80, 60, 40]);
  t.rect(6, 5, 4, 8, [150, 150, 150]).rect(7, 5, 2, 8, [180, 180, 180]);
});
paint('piston_top', (t) => { planks(t, [160, 130, 80]); t.border([90, 70, 40]); t.rect(6, 6, 4, 4, [150, 150, 150]); });
paint('piston_top_sticky', (t) => { planks(t, [160, 130, 80]); t.border([90, 70, 40]); t.noiseRect(3, 3, 10, 10, [110, 190, 90], 12); });
paint('piston_bottom', (t) => { stoneBase(t, [110, 110, 110]); t.border([80, 80, 80]); t.rect(6, 6, 4, 4, [70, 70, 70]); });
paint('trapdoor', (t) => {
  t.clear();
  planks(t, [150, 118, 72]);
  t.border([96, 70, 40]);
  for (const [x, y] of [[3, 3], [9, 3], [3, 9], [9, 9]]) t.rect(x, y, 4, 4, [0, 0, 0], 0);
});
paint('door_wood_upper', (t) => {
  planks(t, [150, 118, 72]);
  t.border([96, 70, 40]);
  t.rect(3, 3, 4, 5, [0, 0, 0], 0).rect(9, 3, 4, 5, [0, 0, 0], 0);
});
paint('door_wood_lower', (t) => {
  planks(t, [150, 118, 72]);
  t.border([96, 70, 40]);
  t.rect(3, 2, 10, 5, [128, 98, 58]).rect(3, 9, 10, 5, [128, 98, 58]);
  t.set(12, 1, [60, 60, 60]).set(12, 0, [60, 60, 60]);
});
paint('door_iron_upper', (t) => {
  t.noise([200, 200, 200], 6);
  t.border([140, 140, 140]);
  t.rect(4, 3, 3, 5, [0, 0, 0], 0).rect(9, 3, 3, 5, [0, 0, 0], 0);
});
paint('door_iron_lower', (t) => {
  t.noise([200, 200, 200], 6);
  t.border([140, 140, 140]);
  t.rect(3, 3, 10, 10, [180, 180, 180]).rect(3, 3, 10, 1, [220, 220, 220]);
  t.set(12, 0, [100, 100, 100]);
});
paint('iron_bars', (t) => {
  t.clear();
  for (const x of [1, 5, 9, 13]) t.rect(x, 0, 2, 16, [140, 140, 140]).rect(x, 0, 1, 16, [180, 180, 180]);
  t.rect(0, 1, 16, 1, [120, 120, 120]).rect(0, 14, 16, 1, [120, 120, 120]);
});
paint('fire', (t) => {
  t.clear();
  for (let x = 0; x < 16; x++) {
    const h = 6 + t.rng.int(9);
    for (let k = 0; k < h; k++) {
      const f = k / h;
      const c: RGB = f < 0.3 ? [255, 240, 120] : f < 0.65 ? [250, 160, 30] : [220, 80, 10];
      t.set(x, 15 - k, c);
    }
  }
});
paint('spawner', (t) => {
  t.clear();
  t.border([40, 50, 60]);
  for (let i = 0; i < 16; i += 4) { t.rect(i, 0, 1, 16, [30, 40, 50]); t.rect(0, i, 16, 1, [30, 40, 50]); }
  t.rect(5, 5, 6, 6, [20, 26, 34], 180);
});
paint('cobweb', (t) => {
  t.clear();
  const c: RGB = [230, 230, 230];
  for (let i = 0; i < 16; i++) { t.set(i, i, c); t.set(15 - i, i, c); t.set(7, i, c); t.set(i, 8, c); }
  for (const r of [3, 6]) {
    for (let a = 0; a < 32; a++) {
      const ang = (a / 32) * Math.PI * 2;
      t.set(Math.round(7.5 + Math.cos(ang) * r), Math.round(7.5 + Math.sin(ang) * r), [210, 210, 210]);
    }
  }
});
paint('portal', (t) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = Math.sin((x + y * 0.6) * 0.9) + Math.cos((y - x * 0.4) * 0.7);
    const c: RGB = v > 0.8 ? [190, 110, 250] : v > -0.2 ? [120, 40, 200] : [80, 10, 150];
    t.set(x, y, shade(c, t.rng.range(-10, 10)), 190);
  }
});
paint('end_portal', (t) => {
  t.fill([10, 16, 20]);
  for (let i = 0; i < 18; i++) t.set(t.rng.int(16), t.rng.int(16), t.rng.pick([[40, 110, 100], [90, 180, 160], [200, 240, 230]] as RGB[]));
});
paint('end_stone', (t) => {
  t.noise([222, 224, 166], 6);
  t.blobs(10, [200, 202, 142], 1, 3, 5, 0);
  t.blobs(4, [236, 238, 186], 1, 2, 4, 0);
});
paint('end_portal_frame_top', (t) => {
  t.noise([56, 118, 104], 8);
  t.border([30, 80, 70]);
  t.rect(3, 3, 10, 10, [232, 226, 170]).rect(4, 4, 8, 8, [16, 44, 40]);
  for (const [x, y] of [[1, 1], [14, 1], [1, 14], [14, 14], [7, 1], [1, 7]]) t.set(x, y, [200, 230, 200]);
});
paint('end_portal_frame_side', (t) => {
  painters.get('end_stone')!(t);
  t.noiseRect(0, 0, 16, 4, [56, 118, 104], 8);
  t.rect(0, 4, 16, 1, [30, 80, 70]);
  t.rect(2, 6, 12, 1, [60, 100, 90]);
});
paint('end_portal_frame_eye', (t) => {
  t.noise([34, 80, 70], 8);
  t.rect(5, 5, 6, 6, [110, 190, 120]).rect(7, 7, 2, 2, [20, 30, 20]);
});
paint('dragon_egg', (t) => { t.noise([14, 8, 20], 5); t.blobs(10, [70, 30, 100], 1, 2, 10, 0); });
paint('netherrack', (t) => {
  t.noise([112, 52, 50], 14);
  t.blobs(10, [84, 30, 30], 2, 5, 8, 0);
  t.blobs(6, [140, 72, 70], 1, 3, 8, 0);
});
paint('soul_sand', (t) => {
  t.noise([86, 66, 52], 9);
  for (let i = 0; i < 5; i++) {
    const x = t.rng.range(1, 12);
    const y = t.rng.range(1, 12);
    t.set(x, y, [44, 32, 26]).set(x + 2, y, [44, 32, 26]).rect(x, y + 2, 3, 1, [52, 38, 30]);
  }
});
paint('glowstone', (t) => {
  t.noise([150, 110, 60], 10);
  t.blobs(12, [255, 220, 120], 2, 5, 14, 0);
  t.blobs(5, [255, 250, 200], 1, 2, 6, 0);
});
paint('nether_brick', (t) => bricksPattern(t, [48, 22, 26], [26, 12, 16], 4, 8));
paint('enchanting_table_top', (t) => {
  t.noise([140, 30, 30], 8);
  t.border([30, 20, 40]);
  for (const [x, y] of [[2, 2], [12, 2], [2, 12], [12, 12]]) t.rect(x, y, 2, 2, [90, 230, 220]);
  t.rect(5, 6, 6, 4, [220, 210, 180]).rect(8, 6, 1, 4, [120, 90, 60]);
});
paint('enchanting_table_side', (t) => {
  t.clear();
  t.noiseRect(0, 4, 16, 12, [22, 18, 34], 6);
  t.noiseRect(0, 4, 16, 3, [140, 30, 30], 8);
  t.rect(3, 8, 2, 2, [90, 230, 220]).rect(11, 8, 2, 2, [90, 230, 220]);
});
paint('enchanting_table_bottom', (t) => t.noise([22, 18, 34], 6));
paint('brewing_stand', (t) => {
  t.clear();
  t.rect(7, 2, 2, 14, [200, 190, 60]).rect(7, 1, 2, 1, [240, 230, 110]);
  t.rect(1, 9, 5, 1, [120, 120, 120]).rect(10, 9, 5, 1, [120, 120, 120]);
});
paint('brewing_stand_base', (t) => { t.noise([110, 110, 110], 8); });
paint('cauldron_side', (t) => {
  t.noise([60, 60, 60], 8);
  t.rect(0, 0, 16, 2, [80, 80, 80]);
  t.rect(3, 13, 10, 3, [0, 0, 0], 0);
});
paint('cauldron_top', (t) => { t.noise([70, 70, 70], 6); t.rect(2, 2, 12, 12, [0, 0, 0], 0); });
paint('cauldron_bottom', (t) => { t.noise([50, 50, 50], 6); });

// ---------------------------------------------------------------------------
// Break-animation overlay stages (drawn over the targeted block).
// ---------------------------------------------------------------------------
for (let stage = 0; stage < 10; stage++) {
  paint(`destroy_${stage}`, (t) => {
    t.clear();
    const cracks = 1 + Math.ceil(stage * 0.8);
    for (let c = 0; c < cracks; c++) {
      let x = 7 + t.rng.range(-1, 1);
      let y = 7 + t.rng.range(-1, 1);
      const len = 3 + stage;
      const dirX = t.rng.pick([-1, 1]);
      const dirY = t.rng.pick([-1, 1]);
      for (let k = 0; k < len; k++) {
        t.set(x, y, [0, 0, 0], 150);
        if (t.rng.chance(0.5)) x += dirX; else y += dirY;
        if (t.rng.chance(0.15)) x -= dirX;
      }
    }
  });
}

/** All texture names this module can produce. */
export function blockTextureNames(): string[] {
  return Array.from(painters.keys());
}

export function paintBlockTexture(name: string): PixelTile {
  const tile = new PixelTile(name);
  if (packBlockTile(name, tile)) return tile;
  const painter = painters.get(name) ?? painters.get('missing')!;
  painter(tile);
  return tile;
}

export function hasBlockTexture(name: string): boolean {
  return painters.has(name);
}

export { hex };

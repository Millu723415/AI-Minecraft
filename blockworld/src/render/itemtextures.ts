/**
 * Original 16x16 item sprites. Tools are drawn programmatically so the five
 * materials share silhouettes; everything else is hand-authored ASCII art.
 */

import { DYE_COLOR_RGB } from '../blocks/ids';
import { PixelTile, mix, shade, type RGB } from './pixel';

type Sprite = (t: PixelTile) => void;
const sprites = new Map<string, Sprite>();
const sprite = (name: string, fn: Sprite): void => {
  sprites.set(name, fn);
};

const STICK: RGB = [120, 88, 44];
const STICK_DARK: RGB = [74, 52, 24];

interface MaterialColors { base: RGB; light: RGB; dark: RGB }
const MATERIALS: Record<string, MaterialColors> = {
  wooden: { base: [150, 116, 66], light: [186, 150, 96], dark: [92, 68, 34] },
  stone: { base: [128, 128, 128], light: [170, 170, 170], dark: [74, 74, 74] },
  iron: { base: [210, 210, 210], light: [250, 250, 250], dark: [120, 120, 120] },
  gold: { base: [236, 200, 50], light: [255, 250, 150], dark: [160, 110, 20] },
  diamond: { base: [80, 220, 210], light: [200, 255, 250], dark: [30, 130, 130] },
  leather: { base: [150, 90, 50], light: [190, 124, 76], dark: [96, 56, 28] },
};

/** Bevel: darken pixels whose lower-right neighbour is empty, lighten upper-left edges. */
function bevel(t: PixelTile): void {
  const s = t.size;
  const snapshot = new Uint8ClampedArray(t.data);
  const alphaAt = (x: number, y: number) => (x < 0 || y < 0 || x >= s || y >= s ? 0 : snapshot[(y * s + x) * 4 + 3]);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      if (alphaAt(x, y) === 0) continue;
      const c = t.get(x, y);
      if (alphaAt(x + 1, y) === 0 || alphaAt(x, y + 1) === 0) t.set(x, y, shade(c, -45));
      else if (alphaAt(x - 1, y) === 0 || alphaAt(x, y - 1) === 0) t.set(x, y, shade(c, 25));
    }
  }
}

function handle(t: PixelTile, x0: number, y0: number, len: number): void {
  for (let i = 0; i < len; i++) {
    t.set(x0 + i, y0 - i, STICK);
    t.set(x0 + i, y0 - i + 1, STICK_DARK);
  }
}

function pickaxe(t: PixelTile, m: MaterialColors): void {
  handle(t, 2, 13, 9);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 4.5, y - 10.5);
      const ang = Math.atan2(y - 10.5, x - 4.5);
      if (d >= 7.4 && d <= 9.2 && ang <= -0.05 && ang >= -1.55) {
        t.set(x, y, d > 8.4 ? m.light : m.base);
      }
    }
  }
  bevel(t);
}

function axe(t: PixelTile, m: MaterialColors): void {
  handle(t, 3, 13, 10);
  const head = [
    '..LL....',
    '.LLhh...',
    'LLhhhh..',
    'Lhhhhhh.',
    '.hhhhh..',
    '..hhh...',
    '...h....',
  ];
  t.art(head, { h: m.base, L: m.light }, 6, 0);
  bevel(t);
}

function shovel(t: PixelTile, m: MaterialColors): void {
  handle(t, 2, 13, 8);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const dx = x - 11.5;
    const dy = y - 3.5;
    const along = dx - dy;
    const across = dx + dy;
    if (Math.abs(along) <= 4.6 && Math.abs(across) <= 2.6 && !(along > 3.2 && Math.abs(across) > 1.5)) {
      t.set(x, y, across < -0.5 ? m.light : m.base);
    }
  }
  bevel(t);
}

function sword(t: PixelTile, m: MaterialColors): void {
  for (let i = 0; i < 10; i++) {
    t.set(4 + i, 11 - i, m.light);
    t.set(5 + i, 11 - i, m.base);
    t.set(4 + i, 12 - i, m.base);
  }
  t.set(14, 1, m.light).set(15, 0, m.light);
  // Guard
  for (const [x, y] of [[2, 9], [3, 10], [4, 11], [5, 12], [6, 13], [3, 9], [6, 12]]) t.set(x, y, m === MATERIALS.wooden ? STICK_DARK : m.dark);
  // Grip
  t.set(3, 12, STICK).set(2, 13, STICK).set(1, 14, STICK_DARK).set(0, 15, STICK_DARK).set(2, 12, STICK_DARK);
  bevel(t);
}

function hoe(t: PixelTile, m: MaterialColors): void {
  handle(t, 2, 13, 9);
  t.art(['hhhhh', 'Hhhhh', '...hh'], { h: m.base, H: m.light }, 7, 2);
  bevel(t);
}

const HELMET = [
  '................', '................', '................', '....hhhhhhhh....', '...hHHHHHHHHh...',
  '...hHhhhhhhhh...', '...hh......hh...', '...hh......hh...', '...hh......hh...', '................',
];
const CHESTPLATE = [
  '................', '..hhh......hhh..', '..hHhh....hhHh..', '..hHhhhhhhhhhh..', '..hhHhhhhhhhhh..',
  '...hhHhhhhhhh...', '....hHhhhhhh....', '....hHhhhhhh....', '....hHhhhhhh....', '....hHhhhhhh....',
  '....hhhhhhhh....', '....hhhhhhhh....', '................',
];
const LEGGINGS = [
  '................', '....hhhhhhhh....', '....hHHHHHHh....', '....hHhhhhhh....', '....hHh..hhh....',
  '....hHh..hhh....', '....hHh..hhh....', '....hhh..hhh....', '....hhh..hhh....', '....hhh..hhh....',
  '....hhh..hhh....', '................',
];
const BOOTS = [
  '................', '................', '................', '................', '................',
  '................', '................', '................', '...hh.....hh....', '...hH.....hH....',
  '...hh.....hh....', '..hhh....hhh....', '.hhhh...hhhh....', '.hhhh...hhhh....', '................',
];
function armor(rows: string[], m: MaterialColors): Sprite {
  return (t) => {
    t.art(rows, { h: m.base, H: m.light });
    bevel(t);
  };
}

for (const [name, m] of Object.entries(MATERIALS)) {
  if (name !== 'leather') {
    sprite(`${name}_pickaxe`, (t) => pickaxe(t, m));
    sprite(`${name}_axe`, (t) => axe(t, m));
    sprite(`${name}_shovel`, (t) => shovel(t, m));
    sprite(`${name}_sword`, (t) => sword(t, m));
    sprite(`${name}_hoe`, (t) => hoe(t, m));
  }
  if (name !== 'wooden' && name !== 'stone') {
    sprite(`${name}_helmet`, armor(HELMET, m));
    sprite(`${name}_chestplate`, armor(CHESTPLATE, m));
    sprite(`${name}_leggings`, armor(LEGGINGS, m));
    sprite(`${name}_boots`, armor(BOOTS, m));
  }
}

// ---------------------------------------------------------------------------
// Hand-drawn sprites
// ---------------------------------------------------------------------------
function art(name: string, rows: string[], palette: Record<string, RGB | null>, doBevel = true): void {
  sprite(name, (t) => {
    t.art(rows, palette);
    if (doBevel) bevel(t);
  });
}

sprite('stick', (t) => { handle(t, 3, 12, 10); });
sprite('blaze_rod', (t) => {
  for (let i = 0; i < 11; i++) {
    t.set(2 + i, 13 - i, [255, 220, 60]);
    t.set(3 + i, 13 - i, [230, 150, 20]);
    t.set(2 + i, 14 - i, [180, 100, 10]);
  }
});
sprite('bone', (t) => {
  for (let i = 0; i < 9; i++) { t.set(4 + i, 11 - i, [236, 232, 214]); t.set(4 + i, 12 - i, [200, 196, 176]); }
  t.rect(2, 11, 3, 3, [236, 232, 214]).rect(11, 2, 3, 3, [236, 232, 214]);
  bevel(t);
});
art('coal', [
  '................', '................', '................', '.....cccc.......', '....cCCcccc.....',
  '...cCcccccccc...', '...cCccccccccc..', '..ccccccccccc...', '..cccccccccccc..', '...cccccccccc...',
  '....ccccccccc...', '.....ccccccc....', '.......ccc......',
], { c: [40, 40, 40], C: [90, 90, 90] });
art('charcoal', [
  '................', '................', '................', '.....cccc.......', '....cCCcccc.....',
  '...cCcccccccc...', '...cCccccccccc..', '..ccccccccccc...', '..cccccccccccc..', '...cccccccccc...',
  '....ccccccccc...', '.....ccccccc....', '.......ccc......',
], { c: [60, 50, 40], C: [110, 96, 80] });
const GEM = [
  '................', '................', '................', '.....gggggg.....', '....gGGGggGg....',
  '...gGGgggggGg...', '...gggggggggg...', '....gggggggg....', '.....gggggg.....', '......gggg......',
  '.......gg.......',
];
art('diamond', GEM, { g: [80, 220, 210], G: [210, 255, 250] });
const INGOT = [
  '................', '................', '................', '................', '................',
  '......iiiiiii...', '.....iIIIIIii...', '....iIiiiiiii...', '...iiiiiiiiii...', '..iiiiiiiiii....',
  '..iiiiiiiiii....', '................',
];
art('iron_ingot', INGOT, { i: [200, 200, 200], I: [250, 250, 250] });
art('gold_ingot', INGOT, { i: [240, 200, 50], I: [255, 250, 150] });
art('brick', INGOT, { i: [150, 70, 50], I: [190, 110, 90] });
art('gold_nugget', [
  '................', '................', '................', '................', '................',
  '................', '......gg........', '.....gGgg.......', '.....ggggg......', '......gggg......',
  '.......gg.......',
], { g: [240, 200, 50], G: [255, 250, 180] });
art('flint', [
  '................', '................', '.......ff.......', '......fFff......', '.....fFffff.....',
  '....fFffffff....', '....ffffffff....', '...ffffffffff...', '...fffffffff....', '....fffffff.....',
  '.....fffff......', '......fff.......',
], { f: [60, 60, 64], F: [120, 120, 130] });
art('apple', [
  '................', '........b.......', '.......b.l......', '....rrrbrrl.....', '...rRRrrrrrr....',
  '..rRRrrrrrrrr...', '..rRrrrrrrrrr...', '..rrrrrrrrrrr...', '..rrrrrrrrrrr...', '...rrrrrrrrr....',
  '....rrrrrrr.....', '.....rr.rr......',
], { r: [210, 30, 30], R: [250, 140, 140], b: [100, 70, 30], l: [60, 160, 40] });
art('golden_apple', [
  '................', '........b.......', '.......b.l......', '....gggbggl.....', '...gGGggggggg...',
  '..gGGggggggggg..', '..gGggggggggg...', '..ggggggggggg...', '..ggggggggggg...', '...ggggggggg....',
  '....ggggggg.....', '.....gg.gg......',
], { g: [240, 200, 50], G: [255, 255, 200], b: [100, 70, 30], l: [60, 160, 40] });
art('bread', [
  '................', '................', '................', '................', '.......bbbbb....',
  '.....bbBbBbBb...', '...bbBbBbBbbbb..', '..bbbbbbbbbbbb..', '..bbbbbbbbbbb...', '...bbbbbbbbb....',
  '................',
], { b: [180, 124, 50], B: [230, 190, 110] });
const MEAT = [
  '................', '................', '................', '.....mmmmm......', '...mmMMmmmmm....',
  '..mMMmmmmmmmw...', '..mmmmmmmmmmww..', '..mmmmmmmmmmw...', '...mmmmmmmmm....', '....mmmmmmm.....',
  '......mmm.......',
];
art('porkchop', MEAT, { m: [230, 120, 120], M: [250, 180, 180], w: [250, 230, 220] });
art('cooked_porkchop', MEAT, { m: [180, 110, 60], M: [220, 170, 110], w: [240, 220, 180] });
art('beef', MEAT, { m: [200, 50, 40], M: [240, 110, 100], w: [250, 230, 220] });
art('cooked_beef', MEAT, { m: [110, 60, 30], M: [160, 100, 60], w: [200, 180, 150] });
art('rotten_flesh', MEAT, { m: [130, 100, 60], M: [110, 140, 60], w: [80, 110, 50] });
const DRUMSTICK = [
  '................', '................', '....mmmmm.......', '...mMMmmmm......', '..mMmmmmmmm.....',
  '..mmmmmmmmm.....', '..mmmmmmmmm.....', '...mmmmmmmm.....', '....mmmmmmww....', '.....mmmm..ww...',
  '...........wW...', '............WW..',
];
art('chicken', DRUMSTICK, { m: [240, 190, 170], M: [255, 225, 210], w: [240, 236, 220], W: [250, 250, 240] });
art('cooked_chicken', DRUMSTICK, { m: [200, 130, 60], M: [230, 180, 110], w: [240, 236, 220], W: [250, 250, 240] });
const FISH = [
  '................', '................', '................', '................', '..t.......ffff..',
  '..tt....ffFFFff.', '..ttffffffffoff.', '...tffffffffffff', '..ttfffffffffff.', '..t....ffffff...',
  '................',
];
art('fish', FISH, { f: [110, 150, 180], F: [170, 200, 220], t: [90, 120, 150], o: [20, 20, 20] });
art('cooked_fish', FISH, { f: [180, 130, 80], F: [220, 180, 120], t: [150, 100, 60], o: [40, 30, 20] });
const BOWL = [
  '................', '................', '................', '................', '................',
  '................', '................', '..bbbbbbbbbbbb..', '..bBBBBBBBBBBb..', '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...', '....bbbbbbbb....', '.....bbbbbb.....',
];
art('bowl', BOWL, { b: [120, 90, 50], B: [80, 60, 30] });
art('mushroom_stew', BOWL, { b: [120, 90, 50], B: [190, 150, 110] });
art('cookie', [
  '................', '................', '................', '.....cccccc.....', '....cccDccccc...',
  '...ccDcccccDcc..', '...cccccccccc...', '...cccDcccDccc..', '...cccccccccc...', '....ccccDccc....',
  '.....cccccc.....',
], { c: [200, 140, 70], D: [80, 40, 20] });
art('melon', [
  '................', '................', '................', '................', '..g.............',
  '..gr............', '..grrr..........', '..grrsrr........', '..grrrrrsr......', '..grrsrrrrrr....',
  '..ggggggggggggg.',
], { g: [60, 140, 30], r: [220, 50, 40], s: [30, 20, 20] });
art('spider_eye', [
  '................', '................', '................', '................', '......rrrr......',
  '....rrRRrrrr....', '...rrRrrrrrrr...', '...rrrrbbrrrr...', '...rrrrbbrrrr...', '....rrrrrrrr....',
  '......rrrr......',
], { r: [150, 30, 50], R: [220, 110, 130], b: [30, 10, 10] });
art('fermented_spider_eye', [
  '................', '................', '................', '.......bb.......', '......rbbr......',
  '....rrRRrrrr....', '...rrRrrrrrrr...', '...rrrrbbrrrr...', '...rrrrbbrrrr...', '....rrrrrrrr....',
  '......rrrr......',
], { r: [170, 90, 110], R: [220, 170, 180], b: [120, 80, 50] });
sprite('bow', (t) => {
  for (let i = 0; i < 12; i++) {
    const ang = -Math.PI / 4 + (i / 11 - 0.5) * 2.4;
    const x = Math.round(5 + Math.cos(ang - Math.PI / 4) * 8);
    const y = Math.round(10 + Math.sin(ang - Math.PI / 4) * 8);
    t.set(x, y, [130, 90, 40]).set(x + 1, y, [90, 60, 26]);
  }
  for (let i = 0; i < 12; i++) t.set(2 + i, 13 - i, [220, 220, 220]);
});
art('arrow', [
  '............hHH.', '...........hhHH.', '............hh..', '...........s.h..', '..........s.....',
  '.........s......', '........s.......', '.......s........', '......s.........', '.....s..........',
  '....s...........', '.ffs............', '.fff............', '..f.............',
], { h: [110, 110, 110], H: [180, 180, 180], s: [120, 88, 44], f: [240, 240, 240] }, false);
const BUCKET = [
  '................', '................', '................', '....bbbbbbbb....', '...bLLLLLLLLb...',
  '...bLLLLLLLLb...', '...bbbbbbbbbb...', '....bbbbbbbb....', '....bbbbbbbb....', '....bbbbbbbb....',
  '.....bbbbbb.....', '.....bbbbbb.....',
];
art('bucket', BUCKET, { b: [180, 180, 180], L: [60, 60, 60] });
art('water_bucket', BUCKET, { b: [180, 180, 180], L: [50, 80, 220] });
art('lava_bucket', BUCKET, { b: [180, 180, 180], L: [240, 120, 20] });
art('milk_bucket', BUCKET, { b: [180, 180, 180], L: [250, 250, 250] });
art('flint_and_steel', [
  '................', '................', '..sssss.........', '..s...s.........', '..s...s.........',
  '...s..s.........', '......s.........', '................', '........ff......', '.......ffFf.....',
  '......fffFff....', '.......ffff.....', '........ff......',
], { s: [190, 190, 190], f: [60, 60, 64], F: [120, 120, 130] });
art('shears', [
  '................', '................', '.........s......', '........sSs.....', '.......sSs......',
  '......sSs.......', '.....sSsS.......', '....rrs.Ss......', '...rr.r..Ss.....', '...r..r...s.....',
  '...rrr..........',
], { s: [200, 200, 200], S: [150, 150, 150], r: [160, 40, 40] });
sprite('fishing_rod', (t) => {
  handle(t, 2, 13, 11);
  for (let y = 2; y < 12; y++) t.set(13, y, [220, 220, 220]);
  t.set(12, 12, [150, 150, 150]).set(13, 12, [150, 150, 150]);
});
art('string', [
  '................', '................', '.........ww.....', '........w..w....', '.......w....w...',
  '......w.....w...', '.....w......w...', '....w......w....', '....w.....w.....', '.....w...w......',
  '......www.......',
], { w: [240, 240, 240] }, false);
art('feather', [
  '................', '...........ff...', '..........fFf...', '.........fFff...', '........fFff....',
  '.......fFff.....', '......fFff......', '.....fFff.......', '....fFff........', '...fff..........',
  '..s.............', '.s..............',
], { f: [236, 236, 236], F: [200, 200, 200], s: [180, 180, 180] });
art('gunpowder', [
  '................', '................', '................', '................', '................',
  '......g.g.......', '.....ggGgg......', '....gGgggGgg....', '...gggGggggGg...', '..gggggggggggg..',
  '..gggggggggggg..',
], { g: [80, 80, 80], G: [140, 140, 140] });
function powder(color: RGB): string[] { return ['x']; }
void powder;
art('glowstone_dust', [
  '................', '................', '................', '................', '................',
  '......g.g.......', '.....ggGgg......', '....gGgggGgg....', '...gggGggggGg...', '..gggggggggggg..',
  '..gggggggggggg..',
], { g: [220, 180, 60], G: [255, 250, 180] });
art('sugar', [
  '................', '................', '................', '................', '................',
  '......g.g.......', '.....ggGgg......', '....gGgggGgg....', '...gggGggggGg...', '..gggggggggggg..',
  '..gggggggggggg..',
], { g: [230, 230, 236], G: [255, 255, 255] });
art('blaze_powder', [
  '................', '................', '................', '................', '................',
  '......g.g.......', '.....ggGgg......', '....gGgggGgg....', '...gggGggggGg...', '..gggggggggggg..',
  '..gggggggggggg..',
], { g: [240, 150, 20], G: [255, 230, 80] });
const SEEDS = [
  '................', '................', '................', '................', '......s...s.....',
  '...s.....s......', '.....s.s....s...', '..s.......s.....', '....s..s.....s..', '......s...s.....',
  '...s......s.....',
];
art('seeds', SEEDS, { s: [60, 160, 40] }, false);
art('pumpkin_seeds', SEEDS, { s: [220, 210, 150] }, false);
art('melon_seeds', SEEDS, { s: [40, 30, 20] }, false);
art('wheat', [
  '..........ww....', '.........wWw....', '........wWww....', '.......wWww.....', '......wWww......',
  '.....wWww.......', '....sww.........', '...s............', '..s.............', '.s..............',
], { w: [200, 170, 70], W: [240, 220, 130], s: [150, 140, 60] });
art('reeds', [
  '............gg..', '...........gG...', '..........gg....', '.........gG.....', '........gg..l...',
  '.......gG..l....', '......gg.l......', '.....gG..........', '....gg...........', '...gG............',
  '..gg............',
], { g: [130, 190, 90], G: [80, 150, 60], l: [100, 170, 70] });
art('sign', [
  '................', '................', '.pppppppppppppp.', '.pPPPPPPPPPPPPp.', '.pPkkkkPkkkkPPp.',
  '.pPPPPPPPPPPPPp.', '.pPkkkPkkkkkPPp.', '.pPPPPPPPPPPPPp.', '.pppppppppppppp.', '.......ss.......',
  '.......ss.......', '.......ss.......', '.......ss.......', '.......ss.......',
], { p: [120, 90, 50], P: [170, 136, 86], k: [90, 70, 40], s: [110, 80, 40] }, false);
const DOOR = [
  '....dddddddd....', '....dDDDDDDd....', '....dD.DD.Dd....', '....dD.DD.Dd....', '....dDDDDDDd....',
  '....dDDDDDDd....', '....dDDDDDDd....', '....dDDDDDhd....', '....dDDDDDDd....', '....dDDDDDDd....',
  '....dDDDDDDd....', '....dDDDDDDd....', '....dDDDDDDd....', '....dddddddd....',
];
art('wooden_door', DOOR, { d: [100, 74, 40], D: [150, 118, 72], h: [60, 60, 60] }, false);
art('iron_door', DOOR, { d: [130, 130, 130], D: [200, 200, 200], h: [80, 80, 80] }, false);
art('minecart', [
  '................', '................', '................', '................', '................',
  '.mmmmmmmmmmmmmm.', '.mMMMMMMMMMMMMm.', '.mm..........mm.', '.mm..........mm.', '.mmmmmmmmmmmmmm.',
  '..mmmmmmmmmmmm..', '..ww......ww....', '..ww......ww....',
], { m: [140, 140, 140], M: [190, 190, 190], w: [60, 60, 60] });
art('boat', [
  '................', '................', '................', '................', '................',
  '................', '.b............b.', '.bb..........bb.', '.bBbbbbbbbbbbBb.', '.bBBBBBBBBBBBBb.',
  '..bBBBBBBBBBBb..', '...bbbbbbbbbb...',
], { b: [110, 80, 44], B: [150, 118, 72] });
art('redstone', [
  '................', '................', '................', '................', '................',
  '......r.r.......', '.....rrRrr......', '....rRrrrRrr....', '...rrrRrrrrRr...', '..rrrrrrrrrrrr..',
  '..rrrrrrrrrrrr..',
], { r: [180, 20, 20], R: [250, 90, 90] });
art('snowball', [
  '................', '................', '................', '................', '......wwww......',
  '.....wWWwww.....', '....wWwwwwww....', '....wwwwwwww....', '....wwwwwwww....', '.....wwwwww.....',
  '......wwww......',
], { w: [236, 244, 250], W: [255, 255, 255] });
art('slime_ball', [
  '................', '................', '................', '................', '......ssss......',
  '.....sSSsss.....', '....sSsssssss...', '....sssssssss...', '....sssssssss...', '.....sssssss.....',
  '......ssss......',
], { s: [100, 190, 80], S: [180, 240, 170] });
art('magma_cream', [
  '................', '................', '................', '................', '......ssss......',
  '.....sSSsos.....', '....sSosssss....', '....ssssssos....', '....sosssssss...', '.....sssoss.....',
  '......ssss......',
], { s: [200, 110, 40], S: [250, 200, 80], o: [250, 230, 60] });
art('ender_pearl', [
  '................', '................', '................', '................', '......pppp......',
  '.....pPPppp.....', '....pPpppppp....', '....ppppGppp....', '....pppGGppp....', '.....pppppp.....',
  '......pppp......',
], { p: [20, 90, 80], P: [80, 180, 160], G: [40, 140, 120] });
art('ender_eye', [
  '................', '................', '................', '................', '......pppp......',
  '.....pPPppp.....', '....pPggggpp....', '....pgGkkGgp....', '....pgGkkGgp....', '.....pggggp.....',
  '......pppp......',
], { p: [30, 100, 80], P: [80, 180, 160], g: [120, 200, 90], G: [190, 240, 150], k: [10, 20, 10] });
art('ghast_tear', [
  '................', '................', '................', '.......t........', '......tTt.......',
  '.....tTttt......', '.....tTttt......', '....tttttt......', '....ttttttt.....', '.....ttttt......',
  '......ttt.......',
], { t: [200, 230, 240], T: [255, 255, 255] });
art('leather', [
  '................', '................', '................', '...lllllllll....', '..lLLllllllll...',
  '..lLlllllllll...', '...llllllllll...', '...lllllllllll..', '..llllllllll....', '...lllllllll....',
  '....llllll......',
], { l: [150, 90, 50], L: [190, 130, 80] });
art('clay_ball', [
  '................', '................', '................', '................', '......cccc......',
  '.....cCCccc.....', '....cCcccccc....', '....cccccccc....', '....cccccccc....', '.....cccccc.....',
  '......cccc......',
], { c: [160, 166, 180], C: [200, 206, 216] });
art('egg', [
  '................', '................', '.......ee.......', '......eEee......', '.....eEeeee.....',
  '.....eEeeee.....', '....eeeeeeee....', '....eeeeeeee....', '....eeeeeeee....', '.....eeeeee.....',
  '......eeee......',
], { e: [230, 214, 170], E: [250, 244, 220] });
art('paper', [
  '................', '................', '..pppppppppp....', '..pPPPPPPPPp....', '..pPPPPPPPPpp...',
  '..pPPPPPPPPPp...', '...pPPPPPPPPp...', '...pPPPPPPPPp...', '...pPPPPPPPPpp..', '...pPPPPPPPPPp..',
  '....pppppppppp..',
], { p: [200, 200, 190], P: [244, 244, 236] }, false);
art('book', [
  '................', '................', '...bbbbbbbbbb...', '..bBBBBBBBBBpb...', '..bBBBBBBBBBpb...',
  '..bBBBBBBBBBpb...', '..bBBBBBBBBBpb...', '..bBBBBBBBBBpb...', '..bBBBBBBBBBpb...', '..bBBBBBBBBBpb...',
  '..bbbbbbbbbbbb..',
], { b: [90, 50, 30], B: [140, 80, 50], p: [236, 236, 226] }, false);
art('compass', [
  '................', '................', '.....cccccc.....', '....cWWWWWWc....', '...cWWWrWWWWc...',
  '...cWWWrWWWWc...', '...cWWWkWWWWc...', '...cWWWkWWWWc...', '...cWWWWWWWWc...', '....cWWWWWWc....',
  '.....cccccc.....',
], { c: [140, 140, 140], W: [210, 210, 210], r: [220, 30, 30], k: [60, 60, 60] }, false);
art('clock', [
  '................', '................', '.....gggggg.....', '....gYYYYYYg....', '...gYYYkYYYYg...',
  '...gYYYkYYYYg...', '...gYYYkkkYYg...', '...gYYYYYYYYg...', '...gYYYYYYYYg...', '....gYYYYYYg....',
  '.....gggggg.....',
], { g: [200, 160, 30], Y: [250, 230, 150], k: [60, 50, 30] }, false);
art('map', [
  '................', '..pppppppppppp..', '..pGGGGBBBGGGp..', '..pGGGBBBBGGGp..', '..pGGGGBBGGGGp..',
  '..pGgGGGGGGGGp..', '..pGGGGGGgGGGp..', '..pBBGGGGGGGGp..', '..pBBBGGGrGGGp..', '..pBBGGGGGGGGp..',
  '..pppppppppppp..',
], { p: [200, 190, 160], G: [150, 180, 110], B: [90, 120, 200], g: [60, 110, 50], r: [200, 30, 30] }, false);
art('cake', [
  '................', '................', '................', '................', '....wwwwwwww....',
  '...wWrWWWrWWw...', '..wWWWWWWWWWWw..', '..bbbbbbbbbbbb..', '..bbwbbbbwbbbb..', '..bbbbbbbbbbbb..',
  '...bbbbbbbbbb...',
], { w: [240, 236, 230], W: [255, 255, 250], r: [220, 30, 30], b: [180, 120, 70] });
art('bed', [
  '................', '................', '................', '................', '................',
  '................', '..wwwrrrrrrrrr..', '..wWWrRRRRRRRr..', '..pppppppppppp..', '..p..........p..',
], { w: [230, 230, 230], W: [250, 250, 250], r: [170, 30, 30], R: [210, 60, 60], p: [140, 110, 70] });
art('repeater', [
  '................', '................', '................', '................', '................',
  '.......r...r....', '......rRr.rRr...', '.......s...s....', '..ssssssssssss..', '..sSSSSSSSSSSs..',
  '..ssssssssssss..',
], { s: [150, 150, 150], S: [190, 190, 190], r: [220, 30, 30], R: [255, 120, 120] });
art('nether_wart', [
  '................', '................', '................', '.......ww.......', '......wWww......',
  '.....wwwwww.....', '.....wwwwww.....', '....wwwwwwww....', '.....wwwwww.....', '......wwww......',
], { w: [150, 30, 40], W: [210, 90, 90] });
art('glass_bottle', [
  '................', '......cc........', '......gg........', '......gg........', '.....g..g.......',
  '....g....g......', '...g......g.....', '...g......g.....', '...g......g.....', '...g......g.....',
  '....gggggg......',
], { g: [200, 220, 240], c: [140, 100, 60] }, false);
art('speckled_melon', [
  '................', '................', '................', '................', '..g.............',
  '..gr............', '..gyrr..........', '..grrsyr........', '..grryrrsr......', '..grrsrryrrr....',
  '..ggggggggggggg.',
], { g: [220, 200, 60], r: [220, 50, 40], s: [30, 20, 20], y: [255, 240, 120] });
art('brewing_stand', [
  '................', '.......yy.......', '.......yy.......', '.......yy.......', '.......yy.......',
  '..g....yy....g..', '..gg...yy...gg..', '..gg...yy...gg..', '.......yy.......', '....ssssssss....',
  '...ssssssssss...',
], { y: [220, 200, 60], g: [200, 220, 240], s: [110, 110, 110] }, false);
art('cauldron', [
  '................', '................', '..cc........cc..', '..cc........cc..', '..cCccccccccCc..',
  '..cCcccccccccc..', '..cccccccccccc..', '..cccccccccccc..', '...cccccccccc...', '...cc......cc...',
], { c: [60, 60, 60], C: [100, 100, 100] });

// Dyes: a little pile of powder in each colour.
const DYE_TO_RGB: RGB[] = [];
for (let meta = 0; meta < 16; meta++) DYE_TO_RGB[meta] = DYE_COLOR_RGB[15 - meta] as RGB;
for (let meta = 0; meta < 16; meta++) {
  sprite(`dye_${meta}`, (t) => {
    const c = meta === 4 ? [36, 70, 190] as RGB : meta === 3 ? [100, 60, 30] as RGB : DYE_TO_RGB[meta];
    if (meta === 0) {
      t.art(['.....kkkk.......', '....kKkkkk......', '...kKkkkkkk.....', '...kkkkkkkkk....', '....kkkkkkkk....', '.....kkkkkk.....'],
        { k: [30, 30, 40], K: [80, 80, 100] }, 0, 5);
    } else if (meta === 15) {
      t.art(['......g.g.......', '.....ggGgg......', '....gGgggGgg....', '...gggGggggGg...', '..gggggggggggg..', '..gggggggggggg..'],
        { g: [230, 230, 220], G: [255, 255, 255] }, 0, 5);
    } else {
      t.art(['......d.........', '.....dDd........', '....dDddd.......', '...ddddddd......', '..ddddddddd.....', '...ddddddddd....', '....ddddddd.....'],
        { d: c, D: shade(c, 60) }, 2, 4);
    }
    bevel(t);
  });
}

// Potions: bottle with coloured liquid. Colour chosen by potion kind.
export const POTION_COLORS: RGB[] = [
  [60, 90, 230], [80, 100, 230], [100, 110, 220], [110, 130, 200], [205, 90, 170],
  [120, 190, 230], [230, 140, 50], [80, 150, 40], [240, 50, 60], [100, 100, 110],
  [150, 40, 40], [90, 100, 130], [70, 20, 40],
];
for (let kind = 0; kind < POTION_COLORS.length; kind++) {
  for (const splash of [false, true]) {
    sprite(`potion_${kind}${splash ? '_splash' : ''}`, (t) => {
      const liquid = POTION_COLORS[kind];
      const rows = splash
        ? ['................', '......cc........', '.....gggg.......', '....gLLLLg......', '...gLLLLLLg.....', '...gLLLLLLg.....', '...gLLLLLLg.....', '....gLLLLg......', '.....gggg.......']
        : ['................', '......cc........', '......gg........', '......gg........', '.....gLLg.......', '....gLLLLg......', '...gLLLLLLg.....', '...gLLLLLLg.....', '...gLLLLLLg.....', '...gLLLLLLg.....', '....gggggg......'];
      t.art(rows, { c: [140, 100, 60], g: [200, 220, 240], L: liquid }, 2, splash ? 4 : 2);
      t.set(5, splash ? 8 : 9, mix(liquid, [255, 255, 255], 0.6));
    });
  }
}

export function itemSpriteNames(): string[] {
  return Array.from(sprites.keys());
}

export function paintItemSprite(name: string): PixelTile | null {
  const fn = sprites.get(name);
  if (!fn) return null;
  const t = new PixelTile(`item:${name}`);
  t.clear();
  fn(t);
  return t;
}

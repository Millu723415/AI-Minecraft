/** Original 9x9 HUD icons: hearts, hunger shanks, armor and air bubbles. */

type Pal = Record<string, string>;

function draw(rows: string[], pal: Pal): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 9;
  c.height = 9;
  const ctx = c.getContext('2d')!;
  for (let y = 0; y < rows.length; y++) {
    for (let x = 0; x < rows[y].length; x++) {
      const col = pal[rows[y][x]];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return c;
}

const HEART_OUTLINE = [
  '.kk...kk.',
  'kxxk.kxxk',
  'kxxxkxxxk',
  'kxxxxxxxk',
  'kxxxxxxxk',
  '.kxxxxxk.',
  '..kxxxk..',
  '...kxk...',
  '....k....',
];
const HEART_FULL = [
  '.........',
  '.rr...rr.',
  '.wRr.rrr.',
  '.Rrrrrrr.',
  '.rrrrrrr.',
  '..rrrrr..',
  '...rrr...',
  '....r....',
  '.........',
];

function heart(color: string, highlight: string, half: boolean): HTMLCanvasElement {
  const c = draw(HEART_OUTLINE, { k: '#000', x: '#3a1010' });
  const rows = HEART_FULL.map((r) => (half ? r.slice(0, 5).padEnd(9, '.') : r));
  const f = draw(rows, { r: color, R: highlight, w: '#fff' });
  c.getContext('2d')!.drawImage(f, 0, 0);
  return c;
}

const SHANK_OUTLINE = [
  '....kkk..',
  '...kxxxk.',
  '..kxxxxxk',
  '..kxxxxxk',
  '.kkxxxxk.',
  'kxkkkkk..',
  'kxk......',
  '.k.......',
  '.........',
];
const SHANK_FILL = [
  '.........',
  '....mmm..',
  '...mMmmm.',
  '...mmmmm.',
  '...mmmm..',
  '.b.......',
  '.b.......',
  '.........',
  '.........',
];

function shank(meat: string, light: string, half: boolean): HTMLCanvasElement {
  const c = draw(SHANK_OUTLINE, { k: '#1a0e05', x: '#3a2410' });
  const rows = SHANK_FILL.map((r) => (half ? '.....' + r.slice(5) : r));
  c.getContext('2d')!.drawImage(draw(rows, { m: meat, M: light, b: '#e8e0d0' }), 0, 0);
  return c;
}

const ARMOR_OUTLINE = [
  '.kkk.kkk.',
  'kxxxkxxxk',
  'kxxxxxxxk',
  '.kxxxxxk.',
  '.kxxxxxk.',
  '.kxxxxxk.',
  '.kxxxxxk.',
  '.kkkkkkk.',
  '.........',
];
const ARMOR_FILL = [
  '.........',
  '.ggg.ggg.',
  '.gGgggGg.',
  '..ggggg..',
  '..ggggg..',
  '..ggggg..',
  '..ggggg..',
  '.........',
  '.........',
];

function armor(half: boolean, empty: boolean): HTMLCanvasElement {
  const c = draw(ARMOR_OUTLINE, { k: '#000', x: empty ? '#2c2c2c' : '#2c2c2c' });
  if (!empty) {
    const rows = ARMOR_FILL.map((r) => (half ? r.slice(0, 5).padEnd(9, '.') : r));
    c.getContext('2d')!.drawImage(draw(rows, { g: '#c6c6c6', G: '#fff' }), 0, 0);
  }
  return c;
}

function bubble(popped: boolean): HTMLCanvasElement {
  return draw(popped
    ? ['.........', '.........', '..b...b..', '.........', '....b....', '.........', '..b...b..', '.........', '.........']
    : ['...bbb...', '..bwwbb..', '.bwbbbbb.', '.bwbbbbb.', '.bbbbbbb.', '.bbbbbbb.', '..bbbbb..', '...bbb...', '.........'],
    { b: '#2060e0', w: '#c0e0ff' });
}

export interface HudIcons {
  heartEmpty: HTMLCanvasElement;
  heartFull: HTMLCanvasElement;
  heartHalf: HTMLCanvasElement;
  heartPoisonFull: HTMLCanvasElement;
  heartPoisonHalf: HTMLCanvasElement;
  shankEmpty: HTMLCanvasElement;
  shankFull: HTMLCanvasElement;
  shankHalf: HTMLCanvasElement;
  shankHungerFull: HTMLCanvasElement;
  shankHungerHalf: HTMLCanvasElement;
  armorEmpty: HTMLCanvasElement;
  armorFull: HTMLCanvasElement;
  armorHalf: HTMLCanvasElement;
  bubble: HTMLCanvasElement;
  bubblePop: HTMLCanvasElement;
  heartFlash: HTMLCanvasElement;
}

let icons: HudIcons | null = null;
export function hudIcons(): HudIcons {
  if (icons) return icons;
  const empty = draw(HEART_OUTLINE, { k: '#000', x: '#3a1010' });
  const flash = draw(HEART_OUTLINE, { k: '#fff', x: '#3a1010' });
  icons = {
    heartEmpty: empty,
    heartFlash: flash,
    heartFull: heart('#e81c1c', '#ff8080', false),
    heartHalf: heart('#e81c1c', '#ff8080', true),
    heartPoisonFull: heart('#6a9a22', '#a6d860', false),
    heartPoisonHalf: heart('#6a9a22', '#a6d860', true),
    shankEmpty: draw(SHANK_OUTLINE, { k: '#1a0e05', x: '#3a2410' }),
    shankFull: shank('#c0662c', '#f0a060', false),
    shankHalf: shank('#c0662c', '#f0a060', true),
    shankHungerFull: shank('#6a8a2a', '#a0c060', false),
    shankHungerHalf: shank('#6a8a2a', '#a0c060', true),
    armorEmpty: armor(false, true),
    armorFull: armor(false, false),
    armorHalf: armor(true, false),
    bubble: bubble(false),
    bubblePop: bubble(true),
  };
  return icons;
}

/** The original BLOCKWORLD title, drawn as stone-textured pixel blocks. */

import { paintBlockTexture } from '../render/blocktextures';

// 5x7 capital letters used by the logo.
const LETTERS: Record<string, string[]> = {
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
};

export function drawLogo(text = 'BLOCKWORLD', cell = 6): HTMLCanvasElement {
  const letters = text.split('');
  const cols = letters.length * 6 - 1;
  const depth = 3;
  const c = document.createElement('canvas');
  c.width = cols * cell + depth * 2 + 4;
  c.height = 7 * cell + depth * 2 + 4;
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  const stone = paintBlockTexture('cobblestone');
  const tileCanvas = document.createElement('canvas');
  tileCanvas.width = 16;
  tileCanvas.height = 16;
  const tctx = tileCanvas.getContext('2d')!;
  const img = tctx.createImageData(16, 16);
  img.data.set(stone.data);
  tctx.putImageData(img, 0, 0);
  const cells: [number, number][] = [];
  letters.forEach((ch, li) => {
    const rows = LETTERS[ch] ?? LETTERS.O;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') cells.push([li * 6 + rx, ry]);
    });
  });
  // Extruded dark sides first, then the textured faces.
  for (let d = depth; d > 0; d--) {
    ctx.fillStyle = d === depth ? '#000' : '#2e2e2e';
    for (const [x, y] of cells) ctx.fillRect(2 + x * cell + d, 2 + y * cell + d, cell, cell);
  }
  for (const [x, y] of cells) {
    ctx.drawImage(tileCanvas, (x * 5) % 12, (y * 7) % 12, 4, 4, 2 + x * cell, 2 + y * cell, cell, cell);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(2 + x * cell, 2 + y * cell, cell, 1);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(2 + x * cell, 2 + y * cell + cell - 1, cell, 1);
  }
  return c;
}

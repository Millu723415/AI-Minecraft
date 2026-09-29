/** Renders every block texture and item sprite into a PNG contact sheet. */
import { blockTextureNames, paintBlockTexture } from '../src/render/blocktextures';
import { itemSpriteNames, paintItemSprite } from '../src/render/itemtextures';
import { writePng } from './png';

const SCALE = 4;
const COLS = 16;
const out = process.argv[2] ?? 'preview.png';

function sheet(tiles: { data: Uint8ClampedArray }[], file: string): void {
  const rows = Math.ceil(tiles.length / COLS);
  const cell = 16 * SCALE + 4;
  const w = COLS * cell;
  const h = rows * cell;
  const img = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const x = i % w; const y = Math.floor(i / w);
    const v = ((x >> 3) + (y >> 3)) % 2 ? 90 : 110;
    img[i * 4] = v; img[i * 4 + 1] = v; img[i * 4 + 2] = v + 20; img[i * 4 + 3] = 255;
  }
  tiles.forEach((t, idx) => {
    const ox = (idx % COLS) * cell + 2;
    const oy = Math.floor(idx / COLS) * cell + 2;
    for (let y = 0; y < 16 * SCALE; y++) for (let x = 0; x < 16 * SCALE; x++) {
      const si = ((y / SCALE | 0) * 16 + (x / SCALE | 0)) * 4;
      const a = t.data[si + 3];
      if (a === 0) continue;
      const di = ((oy + y) * w + ox + x) * 4;
      // Tint-masked pixels (alpha 128) are shown with a sample grass colour.
      const tint = a === 128 ? [0.55, 0.8, 0.4] : [1, 1, 1];
      img[di] = t.data[si] * tint[0]; img[di + 1] = t.data[si + 1] * tint[1]; img[di + 2] = t.data[si + 2] * tint[2];
      img[di + 3] = 255;
    }
  });
  writePng(file, w, h, img);
  console.log(`wrote ${file} (${tiles.length} tiles)`);
}

sheet(blockTextureNames().map((n) => paintBlockTexture(n)), out.replace('.png', '-blocks.png'));
sheet(itemSpriteNames().map((n) => paintItemSprite(n)!), out.replace('.png', '-items.png'));

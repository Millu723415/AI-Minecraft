/**
 * An original 5x7 pixel font, compiled at runtime into a TrueType font so all
 * DOM text renders with crisp pixel glyphs. Each glyph is 8 rows: rows 0-6
 * sit on the baseline, row 7 is the descender.
 */

// prettier-ignore
const GLYPHS: Record<string, string> = {
  ' ': '...|...|...|...|...|...|...|...',
  '!': '#|#|#|#|#|.|#|.',
  '"': '#.#|#.#|...|...|...|...|...|...',
  '#': '.#.#.|#####|.#.#.|.#.#.|#####|.#.#.|.....|.....',
  '$': '..#..|.####|#.#..|.###.|..#.#|####.|..#..|.....',
  '%': '##..#|##.#.|..#..|..#..|.#...|#..##|#..##|.....',
  '&': '.##..|#..#.|.##..|.#...|#.#.#|#..#.|.##.#|.....',
  "'": '#|#|.|.|.|.|.|.',
  '(': '..#|.#.|#..|#..|#..|.#.|..#|...',
  ')': '#..|.#.|..#|..#|..#|.#.|#..|...',
  '*': '.....|#.#.#|.###.|#####|.###.|#.#.#|.....|.....',
  '+': '.....|..#..|..#..|#####|..#..|..#..|.....|.....',
  ',': '..|..|..|..|..|.#|.#|#.',
  '-': '.....|.....|.....|#####|.....|.....|.....|.....',
  '.': '.|.|.|.|.|.|#|.',
  '/': '....#|...#.|..#..|..#..|.#...|#....|#....|.....',
  '0': '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.|.....',
  '1': '..#..|.##..|..#..|..#..|..#..|..#..|#####|.....',
  '2': '.###.|#...#|....#|..##.|.#...|#....|#####|.....',
  '3': '.###.|#...#|....#|..##.|....#|#...#|.###.|.....',
  '4': '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.|.....',
  '5': '#####|#....|####.|....#|....#|#...#|.###.|.....',
  '6': '..##.|.#...|#....|####.|#...#|#...#|.###.|.....',
  '7': '#####|#...#|....#|...#.|..#..|..#..|..#..|.....',
  '8': '.###.|#...#|#...#|.###.|#...#|#...#|.###.|.....',
  '9': '.###.|#...#|#...#|.####|....#|...#.|.##..|.....',
  ':': '.|#|#|.|.|#|#|.',
  ';': '..|.#|.#|..|..|.#|.#|#.',
  '<': '...#|..#.|.#..|#...|.#..|..#.|...#|....',
  '=': '.....|.....|#####|.....|.....|#####|.....|.....',
  '>': '#...|.#..|..#.|...#|..#.|.#..|#...|....',
  '?': '.###.|#...#|....#|...#.|..#..|.....|..#..|.....',
  '@': '.####|#...#|#.###|#.#.#|#.###|#....|.####|.....',
  'A': '.###.|#...#|#...#|#####|#...#|#...#|#...#|.....',
  'B': '####.|#...#|#...#|####.|#...#|#...#|####.|.....',
  'C': '.###.|#...#|#....|#....|#....|#...#|.###.|.....',
  'D': '####.|#...#|#...#|#...#|#...#|#...#|####.|.....',
  'E': '#####|#....|#....|####.|#....|#....|#####|.....',
  'F': '#####|#....|#....|####.|#....|#....|#....|.....',
  'G': '.####|#....|#....|#..##|#...#|#...#|.###.|.....',
  'H': '#...#|#...#|#...#|#####|#...#|#...#|#...#|.....',
  'I': '###|.#.|.#.|.#.|.#.|.#.|###|...',
  'J': '....#|....#|....#|....#|#...#|#...#|.###.|.....',
  'K': '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#|.....',
  'L': '#....|#....|#....|#....|#....|#....|#####|.....',
  'M': '#...#|##.##|#.#.#|#...#|#...#|#...#|#...#|.....',
  'N': '#...#|##..#|#.#.#|#..##|#...#|#...#|#...#|.....',
  'O': '.###.|#...#|#...#|#...#|#...#|#...#|.###.|.....',
  'P': '####.|#...#|#...#|####.|#....|#....|#....|.....',
  'Q': '.###.|#...#|#...#|#...#|#...#|#..#.|.##.#|.....',
  'R': '####.|#...#|#...#|####.|#..#.|#...#|#...#|.....',
  'S': '.####|#....|#....|.###.|....#|....#|####.|.....',
  'T': '#####|..#..|..#..|..#..|..#..|..#..|..#..|.....',
  'U': '#...#|#...#|#...#|#...#|#...#|#...#|.###.|.....',
  'V': '#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..|.....',
  'W': '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#|.....',
  'X': '#...#|.#.#.|..#..|..#..|..#..|.#.#.|#...#|.....',
  'Y': '#...#|.#.#.|..#..|..#..|..#..|..#..|..#..|.....',
  'Z': '#####|....#|...#.|..#..|.#...|#....|#####|.....',
  '[': '###|#..|#..|#..|#..|#..|###|...',
  '\\': '#....|.#...|..#..|..#..|...#.|....#|....#|.....',
  ']': '###|..#|..#|..#|..#|..#|###|...',
  '^': '..#..|.#.#.|#...#|.....|.....|.....|.....|.....',
  '_': '.....|.....|.....|.....|.....|.....|.....|#####',
  '`': '#.|.#|..|..|..|..|..|..',
  'a': '.....|.....|.###.|....#|.####|#...#|.####|.....',
  'b': '#....|#....|#.##.|##..#|#...#|#...#|####.|.....',
  'c': '.....|.....|.###.|#...#|#....|#...#|.###.|.....',
  'd': '....#|....#|.##.#|#..##|#...#|#...#|.####|.....',
  'e': '.....|.....|.###.|#...#|#####|#....|.####|.....',
  'f': '..##|.#..|####|.#..|.#..|.#..|.#..|....',
  'g': '.....|.....|.####|#...#|#...#|.####|....#|####.',
  'h': '#....|#....|#.##.|##..#|#...#|#...#|#...#|.....',
  'i': '#|.|#|#|#|#|#|.',
  'j': '...#|....|...#|...#|...#|#..#|.##.|....',
  'k': '#...|#...|#..#|#.#.|##..|#.#.|#..#|....',
  'l': '#.|#.|#.|#.|#.|#.|.#|..',
  'm': '.....|.....|##.#.|#.#.#|#.#.#|#...#|#...#|.....',
  'n': '.....|.....|####.|#...#|#...#|#...#|#...#|.....',
  'o': '.....|.....|.###.|#...#|#...#|#...#|.###.|.....',
  'p': '.....|.....|#.##.|##..#|#...#|####.|#....|#....',
  'q': '.....|.....|.##.#|#..##|#...#|.####|....#|....#',
  'r': '.....|.....|#.##.|##..#|#....|#....|#....|.....',
  's': '.....|.....|.####|#....|.###.|....#|####.|.....',
  't': '.#..|.#..|####|.#..|.#..|.#..|..##|....',
  'u': '.....|.....|#...#|#...#|#...#|#...#|.####|.....',
  'v': '.....|.....|#...#|#...#|#...#|.#.#.|..#..|.....',
  'w': '.....|.....|#...#|#...#|#.#.#|#.#.#|.####|.....',
  'x': '.....|.....|#...#|.#.#.|..#..|.#.#.|#...#|.....',
  'y': '.....|.....|#...#|#...#|#...#|.####|....#|####.',
  'z': '.....|.....|#####|...#.|..#..|.#...|#####|.....',
  '{': '..##|.#..|.#..|#...|.#..|.#..|..##|....',
  '|': '#|#|#|#|#|#|#|#',
  '}': '##..|..#.|..#.|...#|..#.|..#.|##..|....',
  '~': '.#...#|#.#.#.|#...#.|......|......|......|......|......',
};

const PX = 128; // font units per pixel
const EM = 8 * PX;

interface GlyphData { contours: [number, number][][]; advance: number; xMin: number; yMin: number; xMax: number; yMax: number }

function buildGlyph(ch: string): GlyphData {
  const rows = (GLYPHS[ch] ?? GLYPHS['?']).split('|');
  const width = Math.max(...rows.map((r) => r.length));
  const contours: [number, number][][] = [];
  // Merge horizontal runs, then stack identical runs vertically into rectangles.
  const rects: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const open = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
  for (let r = 0; r < rows.length; r++) {
    const runs: [number, number][] = [];
    let start = -1;
    for (let c = 0; c <= width; c++) {
      const on = rows[r][c] === '#';
      if (on && start < 0) start = c;
      if (!on && start >= 0) { runs.push([start, c]); start = -1; }
    }
    const nextOpen = new Map<string, { x0: number; x1: number; y0: number; y1: number }>();
    for (const [a, b] of runs) {
      const key = `${a}:${b}`;
      const prev = open.get(key);
      if (prev) { prev.y1 = r + 1; nextOpen.set(key, prev); open.delete(key); }
      else nextOpen.set(key, { x0: a, x1: b, y0: r, y1: r + 1 });
    }
    for (const rect of open.values()) rects.push(rect);
    open.clear();
    for (const [k, v] of nextOpen) open.set(k, v);
  }
  for (const rect of open.values()) rects.push(rect);
  let xMin = Infinity; let yMin = Infinity; let xMax = -Infinity; let yMax = -Infinity;
  for (const r of rects) {
    // Row 0 is the top; baseline sits below row 6.
    const left = r.x0 * PX; const right = r.x1 * PX;
    const top = (7 - r.y0) * PX; const bottom = (7 - r.y1) * PX;
    // Clockwise contour (TrueType outer contours are clockwise).
    contours.push([[left, bottom], [left, top], [right, top], [right, bottom]]);
    xMin = Math.min(xMin, left); xMax = Math.max(xMax, right);
    yMin = Math.min(yMin, bottom); yMax = Math.max(yMax, top);
  }
  if (!isFinite(xMin)) { xMin = 0; yMin = 0; xMax = 0; yMax = 0; }
  return { contours, advance: (width + 1) * PX, xMin, yMin, xMax, yMax };
}

class Writer {
  bytes: number[] = [];
  u8(v: number) { this.bytes.push(v & 255); }
  u16(v: number) { this.bytes.push((v >> 8) & 255, v & 255); }
  i16(v: number) { this.u16(v < 0 ? v + 65536 : v); }
  u32(v: number) { this.bytes.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); }
  tag(s: string) { for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i)); }
  pad4() { while (this.bytes.length % 4) this.u8(0); }
}

function checksum(bytes: number[]): number {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 4) {
    sum = (sum + (((bytes[i] ?? 0) << 24) | ((bytes[i + 1] ?? 0) << 16) | ((bytes[i + 2] ?? 0) << 8) | (bytes[i + 3] ?? 0))) >>> 0;
  }
  return sum >>> 0;
}

export function buildPixelFont(): ArrayBuffer {
  const chars: string[] = [];
  for (let c = 32; c <= 126; c++) chars.push(String.fromCharCode(c));
  const glyphs: GlyphData[] = [{ contours: [], advance: 4 * PX, xMin: 0, yMin: 0, xMax: 0, yMax: 0 }];
  for (const ch of chars) glyphs.push(buildGlyph(ch));
  const numGlyphs = glyphs.length;

  // glyf + loca
  const glyf = new Writer();
  const loca: number[] = [];
  let maxPoints = 0; let maxContours = 0;
  for (const g of glyphs) {
    loca.push(glyf.bytes.length);
    if (g.contours.length === 0) continue;
    glyf.i16(g.contours.length);
    glyf.i16(g.xMin); glyf.i16(g.yMin); glyf.i16(g.xMax); glyf.i16(g.yMax);
    let end = -1;
    for (const c of g.contours) { end += c.length; glyf.u16(end); }
    glyf.u16(0); // instructions
    const pts = g.contours.flat();
    maxPoints = Math.max(maxPoints, pts.length);
    maxContours = Math.max(maxContours, g.contours.length);
    for (let i = 0; i < pts.length; i++) glyf.u8(0x01);
    let px = 0;
    for (const [x] of pts) { glyf.i16(x - px); px = x; }
    let py = 0;
    for (const [, y] of pts) { glyf.i16(y - py); py = y; }
    glyf.pad4();
  }
  loca.push(glyf.bytes.length);
  const locaW = new Writer();
  for (const o of loca) locaW.u32(o);

  const advanceMax = Math.max(...glyphs.map((g) => g.advance));
  const ascent = 7 * PX;
  const descent = -1 * PX;

  const head = new Writer();
  head.u32(0x00010000); head.u32(0x00010000); head.u32(0); head.u32(0x5f0f3cf5);
  head.u16(0x000b); head.u16(EM);
  head.u32(0); head.u32(0); head.u32(0); head.u32(0); // created / modified
  head.i16(0); head.i16(descent); head.i16(advanceMax); head.i16(ascent);
  head.u16(0); head.u16(8); head.i16(2); head.i16(1); head.i16(0);

  const hhea = new Writer();
  hhea.u32(0x00010000); hhea.i16(ascent); hhea.i16(descent); hhea.i16(0);
  hhea.u16(advanceMax); hhea.i16(0); hhea.i16(0); hhea.i16(advanceMax);
  hhea.i16(1); hhea.i16(0); hhea.i16(0);
  for (let i = 0; i < 4; i++) hhea.i16(0);
  hhea.i16(0); hhea.u16(numGlyphs);

  const hmtx = new Writer();
  for (const g of glyphs) { hmtx.u16(g.advance); hmtx.i16(g.xMin); }

  const maxp = new Writer();
  maxp.u32(0x00010000); maxp.u16(numGlyphs); maxp.u16(maxPoints); maxp.u16(maxContours);
  maxp.u16(0); maxp.u16(0); maxp.u16(2); maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0);
  maxp.u16(0); maxp.u16(0); maxp.u16(0); maxp.u16(0);

  // cmap: format 4, one segment 32..126 mapping to glyphs 1..95.
  const cmap = new Writer();
  cmap.u16(0); cmap.u16(1); cmap.u16(3); cmap.u16(1); cmap.u32(12);
  const segs = 2;
  const sub = new Writer();
  sub.u16(4); sub.u16(16 + segs * 8); sub.u16(0);
  sub.u16(segs * 2); sub.u16(4); sub.u16(1); sub.u16(0);
  sub.u16(126); sub.u16(0xffff); // endCodes
  sub.u16(0); // reserved
  sub.u16(32); sub.u16(0xffff); // startCodes
  sub.i16(1 - 32); sub.i16(1); // idDelta
  sub.u16(0); sub.u16(0); // idRangeOffset
  cmap.bytes.push(...sub.bytes);

  const nameStrings: [number, string][] = [[1, 'Blockworld Pixel'], [2, 'Regular'], [3, 'BlockworldPixel-1.0'], [4, 'Blockworld Pixel'], [5, 'Version 1.0'], [6, 'BlockworldPixel']];
  const name = new Writer();
  name.u16(0); name.u16(nameStrings.length); name.u16(6 + nameStrings.length * 12);
  const strData = new Writer();
  for (const [id, text] of nameStrings) {
    name.u16(3); name.u16(1); name.u16(0x409); name.u16(id); name.u16(text.length * 2); name.u16(strData.bytes.length);
    for (const ch of text) strData.u16(ch.charCodeAt(0));
  }
  name.bytes.push(...strData.bytes);

  const post = new Writer();
  post.u32(0x00030000); post.u32(0); post.i16(-PX); post.i16(PX);
  post.u32(0); post.u32(0); post.u32(0); post.u32(0); post.u32(0);

  const os2 = new Writer();
  os2.u16(4); os2.i16(6 * PX); os2.u16(400); os2.u16(5); os2.u16(0);
  os2.i16(EM / 2); os2.i16(EM / 2); os2.i16(0); os2.i16(PX);
  os2.i16(EM / 2); os2.i16(EM / 2); os2.i16(0); os2.i16(3 * PX);
  os2.i16(PX); os2.i16(3 * PX); os2.i16(0);
  for (let i = 0; i < 10; i++) os2.u8(0);
  os2.u32(1); os2.u32(0); os2.u32(0); os2.u32(0);
  os2.tag('BWLD'); os2.u16(0x40); os2.u16(32); os2.u16(126);
  os2.i16(ascent); os2.i16(descent); os2.i16(0);
  os2.u16(ascent); os2.u16(-descent);
  os2.u32(1); os2.u32(0);
  os2.i16(5 * PX); os2.i16(7 * PX); os2.u16(0); os2.u16(32); os2.u16(1);

  const tables: [string, number[]][] = [
    ['OS/2', os2.bytes], ['cmap', cmap.bytes], ['glyf', glyf.bytes], ['head', head.bytes], ['hhea', hhea.bytes],
    ['hmtx', hmtx.bytes], ['loca', locaW.bytes], ['maxp', maxp.bytes], ['name', name.bytes], ['post', post.bytes],
  ];
  const out = new Writer();
  const n = tables.length;
  let es = 0;
  while (1 << (es + 1) <= n) es++;
  out.u32(0x00010000); out.u16(n); out.u16((1 << es) * 16); out.u16(es); out.u16(n * 16 - (1 << es) * 16);
  let offset = 12 + n * 16;
  const offsets: number[] = [];
  for (const [tag, data] of tables) {
    out.tag(tag);
    out.u32(checksum(data));
    out.u32(offset);
    out.u32(data.length);
    offsets.push(offset);
    offset += Math.ceil(data.length / 4) * 4;
  }
  for (const [, data] of tables) {
    out.bytes.push(...data);
    out.pad4();
  }
  // checkSumAdjustment
  const total = checksum(out.bytes);
  const adj = (0xb1b0afba - total) >>> 0;
  const headOffset = offsets[3] + 8;
  out.bytes[headOffset] = (adj >>> 24) & 255;
  out.bytes[headOffset + 1] = (adj >>> 16) & 255;
  out.bytes[headOffset + 2] = (adj >>> 8) & 255;
  out.bytes[headOffset + 3] = adj & 255;
  return new Uint8Array(out.bytes).buffer;
}

/** Register the font with the document. Resolves true when usable. */
export async function installPixelFont(): Promise<boolean> {
  try {
    const face = new FontFace('BlockworldPixel', buildPixelFont());
    await face.load();
    document.fonts.add(face);
    return true;
  } catch (err) {
    console.warn('Pixel font failed to load, using fallback', err);
    return false;
  }
}

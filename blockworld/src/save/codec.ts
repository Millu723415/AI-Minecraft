/** Run-length encoding for chunk arrays (pure, unit tested). */

export function rleEncode(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const v = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === v && run < 255) run++;
    out.push(v, run);
    i += run;
  }
  return Uint8Array.from(out);
}

export function rleDecode(data: Uint8Array, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let o = 0;
  for (let i = 0; i + 1 < data.length && o < length; i += 2) {
    const v = data[i];
    const run = data[i + 1];
    out.fill(v, o, Math.min(length, o + run));
    o += run;
  }
  if (o !== length) throw new Error(`RLE length mismatch: ${o} != ${length}`);
  return out;
}

/**
 * Import textures from a resource-pack zip into public/pack/ (git-ignored).
 *
 *   npm run import-pack -- path/to/pack.zip
 *
 * Only the files for blocks, items, mobs, HUD, screens and sky that already
 * exist in the game are copied (see src/render/pack.ts). A manifest.json
 * lists what was found; the game loads it at startup and falls back to its
 * own textures for anything missing. Requires the `unzip` command.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wantedPackFiles } from '../src/render/pack';

const zip = process.argv[2];
if (!zip || !fs.existsSync(zip)) {
  console.error('usage: npm run import-pack -- <resource-pack.zip>');
  process.exit(1);
}
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const outDir = path.join(root, 'public', 'pack');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bwpack-'));
const wanted = wantedPackFiles();
const prefix = 'assets/minecraft/textures/';

// List the archive, then extract just the wanted entries.
const listing = execFileSync('unzip', ['-Z1', zip], { maxBuffer: 64 * 1024 * 1024 }).toString().split('\n');
const present = new Set(listing.map((l) => l.trim()).filter((l) => l.startsWith(prefix)).map((l) => l.slice(prefix.length)));
const files = wanted.filter((f) => present.has(f));
const missing = wanted.filter((f) => !present.has(f));
if (files.length === 0) {
  console.error('No usable textures found (expected assets/minecraft/textures/... inside the zip).');
  process.exit(1);
}
for (let i = 0; i < files.length; i += 200) {
  execFileSync('unzip', ['-o', '-q', zip, ...files.slice(i, i + 200).map((f) => prefix + f), '-d', tmp]);
}
fs.rmSync(outDir, { recursive: true, force: true });
for (const f of files) {
  const dst = path.join(outDir, f);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(tmp, prefix, f), dst);
}
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify({ source: path.basename(zip), files }, null, 1));
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`Imported ${files.length} textures into public/pack/ (${missing.length} not in this pack, built-in textures used instead).`);
if (missing.length) console.log('Missing:', missing.join(', '));

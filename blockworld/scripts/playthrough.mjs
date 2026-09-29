// End-to-end progression check through the real game code paths.
// Requires the dev server (npm run dev). Usage: node scripts/playthrough.mjs [outDir] [seed]
// Drives the player through: nether portal lighting and travel, eye of ender
// throwing, stronghold portal activation, the End, crystals and the dragon,
// the exit portal and ending, then save and reload.
import { chromium } from 'playwright';

const [outDir = '.', seed = 'playthrough'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.env.GAME_URL ?? 'http://localhost:5173/');
await page.waitForTimeout(2000);
let shots = 0;
const shot = (name) => page.screenshot({ path: `${outDir}/pt-${String(shots++).padStart(2, '0')}-${name}.png` });
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };

await page.evaluate((s) => window.app.createWorld('Playthrough', s, 'survival', 2), seed);
await page.evaluate(() => {
  const T = {
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    async until(fn, ms = 90000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await T.wait(250); } return false; },
    aimAt(x, y, z) {
      const p = app.game.player; const dx = x - p.x; const dy = y - (p.y + p.eyeHeight); const dz = z - p.z;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    hold(id, count = 1, meta = 0) { const p = app.game.player; p.inventory.set(p.inventory.selected, { id, count, meta, damage: 0 }); },
    /** One right click, processed by the next game tick. */
    // Targets refresh once per rendered frame, so let the new aim settle first.
    async use() {
      const i = app.game.input;
      i.locked = true; await T.wait(500);
      i.rightPressed = true;
      await T.until(() => !i.rightPressed, 10000);
      await T.wait(300);
    },
    /** Draw the bow fully and release. */
    async shoot(holdMs = 1400) {
      const i = app.game.input;
      i.locked = true; await T.wait(400);
      i.rightDown = true; i.rightPressed = true;
      await T.wait(holdMs);
      i.rightDown = false;
      await T.wait(800);
    },
    async playing(ms = 120000) { return T.until(() => app.game && app.game.state === 'playing', ms); },
  };
  window.T = T;
});
const ev = (fn, arg) => page.evaluate(fn, arg);

check('world loads', await ev(() => T.playing()));
await shot('spawn');

// ---- Nether portal: build a frame, light it with flint and steel, travel ----
const frame = await ev(() => {
  const g = app.game; const p = g.player; const d = g.dim;
  const x0 = Math.floor(p.x) + 3; const z = Math.floor(p.z); const y0 = Math.floor(p.y);
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) {
    const edge = i === -1 || i === 2 || j === -1 || j === 3;
    d.setBlock(x0 + i, y0 + j, z, edge ? 49 : 0, 0);
  }
  return { x0, y0, z };
});
await ev(async (f) => {
  const p = app.game.player;
  p.setPosition(f.x0 + 0.5, f.y0, f.z + 2.5);
  await T.wait(300);
  T.hold(259); T.aimAt(f.x0 + 0.5, f.y0 + 0.01, f.z + 0.5); await T.use();
}, frame);
const lit = await ev((f) => app.game.dim.getBlock(f.x0, f.y0, f.z) === 90 && app.game.dim.getBlock(f.x0 + 1, f.y0 + 2, f.z) === 90, frame);
check('flint and steel lights the obsidian frame', lit);
await shot('portal-lit');
await ev((f) => { app.game.player.setPosition(f.x0 + 1, f.y0, f.z + 0.5); }, frame);
check('standing in the portal takes the player to the Nether', await ev(() => T.until(() => app.game.dim.id === 1, 30000)));
check('nether arrival finishes loading', await ev(() => T.playing(180000)));
await shot('nether');
const back = await ev(async () => {
  const g = app.game; const p = g.player; const d = g.dim;
  const bx = Math.floor(p.x); const by = Math.floor(p.y); const bz = Math.floor(p.z);
  for (let r = 0; r <= 3; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) for (let dy = -2; dy <= 3; dy++) {
    if (d.getBlock(bx + dx, by + dy, bz + dz) === 90) {
      // Arrival leaves a cooldown; a player steps out and back in after it expires.
      p.portalCooldown = 0;
      p.setPosition(bx + dx + 0.5, by + dy, bz + dz + 0.5);
      return true;
    }
  }
  return false;
});
check('a linked portal exists on the Nether side', back);
check('walking back through returns to the Overworld', await ev(() => T.until(() => app.game.dim.id === 0, 30000)));
await ev(() => T.playing(180000));

// ---- Eyes of Ender ----
const eye = await ev(async () => {
  const g = app.game; const p = g.player;
  p.inventory.set(p.inventory.selected, { id: 381, count: 3, meta: 0, damage: 0 });
  p.pitch = 0.3; await T.use();
  const e = g.entitiesIn(g.dim).find((x) => x.type === 'eye_signal');
  const s = g.nearestStronghold(p.x, p.z);
  if (!e || !s) return { ok: false, dist: JSON.stringify({ screen: g.ui.screen?.constructor?.name ?? null, paused: g.paused, state: g.state, dim: g.dim.id, held: p.inventory.held, e: !!e, s }) };
  const a = Math.atan2(e.targetZ - p.z, e.targetX - p.x); const b = Math.atan2(s[1] - p.z, s[0] - p.x);
  return { ok: Math.abs(a - b) < 0.05, dist: Math.hypot(s[0] - p.x, s[1] - p.z) | 0, left: p.inventory.held?.count };
});
check('a thrown Eye of Ender flies toward the nearest stronghold', eye.ok, `(stronghold ${eye.dist} blocks away)`);
await shot('eye');

// ---- Stronghold portal room ----
const room = await ev(async () => {
  const g = app.game; const p = g.player;
  const gen = g.world.getDimension(0).generator;
  const s = gen.structures.strongholds().map((h) => h.portal.center());
  s.sort((a, b) => Math.hypot(a[0] - p.x, a[2] - p.z) - Math.hypot(b[0] - p.x, b[2] - p.z));
  const [cx, cy, cz] = s[0];
  p.setPosition(cx + 0.5, cy + 1, cz + 3.5);
  return { cx, cy, cz };
});
check('teleported next to the portal room', await ev(() => T.until(() => app.game.state === 'playing' && app.game.chunkManager.isReady(Math.floor(app.game.player.x) >> 4, Math.floor(app.game.player.z) >> 4), 180000)));
await ev(() => T.wait(3000));
const filled = await ev(async (r) => {
  const g = app.game; const d = g.dim; const p = g.player;
  const ring = [];
  for (let i = -1; i <= 1; i++) ring.push([r.cx + i, r.cz - 2], [r.cx + i, r.cz + 2], [r.cx - 2, r.cz + i], [r.cx + 2, r.cz + i]);
  let frames = 0; let inserted = 0;
  for (const [x, z] of ring) {
    if (d.getBlock(x, r.cy, z) !== 120) continue;
    frames++;
    if (d.getMeta(x, r.cy, z) & 4) continue;
    // Stand on a neighbouring frame of the ring and look down at this one.
    const [nx, nz] = ring.find(([ax, az]) => Math.abs(ax - x) + Math.abs(az - z) === 1);
    p.setPosition(nx + 0.5, r.cy + 0.82, nz + 0.5);
    p.motionX = p.motionY = p.motionZ = 0;
    await T.wait(300);
    p.inventory.set(p.inventory.selected, { id: 381, count: 1, meta: 0, damage: 0 });
    T.aimAt(x + 0.5, r.cy + 0.75, z + 0.5);
    await T.use();
    if (d.getMeta(x, r.cy, z) & 4) inserted++;
    else if (!window.__why) {
      const t = g.interaction.target;
      window.__why = JSON.stringify({ frame: [x, r.cy, z], target: t && [t.x, t.y, t.z, t.id], pos: [p.x, p.y, p.z].map((v) => +v.toFixed(2)), held: p.inventory.held, screen: g.ui.screen && g.ui.screen.constructor.name, title: document.querySelector("#ui")?.innerText.slice(0, 60), paused: g.paused });
    }
  }
  let portal = 0;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) if (d.getBlock(r.cx + dx, r.cy, r.cz + dz) === 119) portal++;
  return { frames, inserted, portal, why: window.__why };
}, room);
check('portal room has twelve frames', filled.frames === 12, `(eyes placed by hand: ${filled.inserted}) ${filled.why ?? ''}`);
check('filling the frames activates the End portal', filled.portal === 9);
await ev((r) => { const p = app.game.player; p.setPosition(r.cx + 3.5, r.cy + 1, r.cz + 0.5); T.aimAt(r.cx + 0.5, r.cy, r.cz + 0.5); }, room);
await ev(() => T.wait(1500));
await shot('end-portal');

// ---- The End ----
await ev((r) => { app.game.player.setPosition(r.cx + 0.5, r.cy + 0.2, r.cz + 0.5); }, room);
check('stepping into the portal enters the End', await ev(() => T.until(() => app.game.dim.id === 2, 30000)));
check('End arrival finishes loading', await ev(() => T.playing(180000)));
await ev(() => T.wait(2000));
await shot('the-end');
const fight = await ev(async () => {
  const g = app.game; const p = g.player; const d = g.dim;
  p.creative = false;
  const crystals = () => g.entitiesIn(d).filter((e) => e.type === 'ender_crystal' && !e.removed);
  const before = crystals().length;
  // Shoot every crystal with a bow from a small platform at its height.
  p.inventory.set(p.inventory.selected, { id: 261, count: 1, meta: 0, damage: 0 });
  p.inventory.set(20, { id: 262, count: 64, meta: 0, damage: 0 });
  let arrows = 0;
  for (const c of crystals()) {
    const bx = Math.floor(c.x) + 9; const by = Math.floor(c.y) - 1; const bz = Math.floor(c.z);
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) d.setBlock(bx + dx, by, bz + dz, 49, 0);
    for (let tries = 0; tries < 4 && !c.removed; tries++) {
      p.setPosition(bx + 0.5, by + 1, bz + 0.5); p.motionX = p.motionY = p.motionZ = 0; p.fallDistance = 0;
      await T.wait(300);
      T.aimAt(c.x, c.y + 1.2, c.z);
      await T.shoot();
      arrows++;
    }
  }
  const after = crystals().length;
  p.inventory.set(p.inventory.selected, { id: 276, count: 1, meta: 0, damage: 0 });
  const dragon = g.entitiesIn(d).find((e) => e.type === 'ender_dragon');
  let swings = 0;
  while (dragon && dragon.phase !== 'DEATH' && swings < 600) {
    p.setPosition(dragon.x + 3, dragon.y, dragon.z + 3); p.health = 20; p.fallDistance = 0; p.motionY = 0;
    const [hx, hy, hz] = [dragon.x - Math.sin(dragon.yaw) * 6.5, dragon.y + 1, dragon.z - Math.cos(dragon.yaw) * 6.5];
    T.aimAt(hx, hy, hz);
    dragon.invulnerable = 0;
    g.interaction.attack(dragon);
    swings++;
    await T.wait(60);
  }
  return { before, after, arrows, dead: dragon?.phase === 'DEATH', swings, hp: dragon?.health, alive: !p.dead };
});
check('ender crystals are destroyed by arrows from a bow', fight.before >= 10 && fight.after === 0, `(${fight.before} -> ${fight.after}, ${fight.arrows} shots)`);
check('the dragon can be killed with a sword', fight.dead && fight.alive, `(${fight.swings} hits)`);
await ev(async () => { const p = app.game.player; p.setPosition(0.5, 90, 20); p.creative = true; p.flying = true; T.aimAt(0, 60, 0); });
check('death sequence leaves the exit portal and the egg', await ev(() => T.until(() => app.game.world.dragonKilled, 60000)));
await ev(() => T.wait(3000));
await shot('exit-portal');
const exitPos = await ev(() => {
  const d = app.game.dim;
  for (let y = 127; y > 0; y--) if (d.getBlock(1, y, 1) === 119 || d.getBlock(2, y, 0) === 119) return { y, egg: (() => { for (let yy = 127; yy > 0; yy--) if (d.getBlock(0, yy, 0) === 122) return yy; return -1; })() };
  return null;
});
check('exit portal blocks exist at the island centre', !!exitPos, JSON.stringify(exitPos));
check('the dragon egg sits on the exit portal', !!exitPos && exitPos.egg > 0);

// ---- Ending and return ----
await ev((e) => { const p = app.game.player; p.flying = false; p.creative = false; p.setPosition(2.5, e.y + 0.2, 0.5); p.portalCooldown = 0; }, exitPos);
check('the exit portal starts the ending', await ev(() => T.until(() => app.game.state === 'ending', 20000)));
await ev(() => T.wait(4000));
await shot('ending');
await page.keyboard.press('Space');
check('after the ending the player is home in the Overworld', await ev(() => T.until(() => app.game.dim.id === 0 && app.game.state === 'playing', 180000)));
await shot('home');

// ---- Save and reload ----
const id = await ev(() => app.game.world.meta.id);
await ev(() => { app.saveAndQuit(); });
await ev(() => T.until(() => app.game === null, 30000));
await ev((wid) => app.playWorld(wid), id);
check('the world reloads', await ev(() => T.playing(180000)));
check('dragon state persisted', await ev(() => app.game.world.dragonKilled === true && app.game.world.endingSeen === true));
await shot('reloaded');

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);

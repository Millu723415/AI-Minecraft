// Early-game progression check with real input and real UI clicks.
// Requires a running game server. Usage: GAME_URL=... node scripts/earlygame.mjs [outDir] [seed]
//
// Punch logs by hand, craft planks / crafting table / sticks in the inventory,
// place the table, craft a wooden pickaxe, dig down to stone, craft stone
// tools and a furnace, hunt an animal and cook and eat the meat. Movement
// between spots is done by repositioning the player (walking there is not
// what is being tested); every action that matters goes through the same
// input flags and UI slot clicks a player produces.
import { chromium } from 'playwright';

const [outDir = '.', seed = 'earlygame'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(process.env.GAME_URL ?? 'http://localhost:5173/');
await page.waitForTimeout(2000);
let shots = 0;
const shot = (name) => page.screenshot({ path: `${outDir}/eg-${String(shots++).padStart(2, '0')}-${name}.png` });
const results = [];
const check = (name, ok, detail = '') => { results.push({ ok }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`); };
const ev = (fn, arg) => page.evaluate(fn, arg);

await ev((s) => window.app.createWorld('Early game', s, 'survival', 1), seed);
await ev(() => {
  const T = {
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    async until(fn, ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await T.wait(200); } return false; },
    g: () => app.game,
    aimAt(x, y, z) {
      const p = app.game.player; const dx = x - p.x; const dy = y - (p.y + p.eyeHeight); const dz = z - p.z;
      p.yaw = Math.atan2(-dx, -dz); p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    },
    count(id) { return app.game.player.inventory.count(id); },
    /** Hold the attack button on a block until it breaks. */
    async mine(x, y, z, ms = 40000) {
      const g = app.game; const i = g.input;
      const before = g.dim.getBlock(x, y, z);
      T.aimAt(x + 0.5, y + 0.5, z + 0.5);
      i.locked = true;
      await T.wait(400);
      i.leftDown = true;
      const ok = await T.until(() => { T.aimAt(x + 0.5, y + 0.5, z + 0.5); return g.dim.getBlock(x, y, z) !== before; }, ms);
      i.leftDown = false;
      await T.wait(1200); // let drops be picked up
      return ok;
    },
    async use() {
      const i = app.game.input;
      i.locked = true; await T.wait(500);
      i.rightPressed = true;
      await T.until(() => !i.rightPressed, 10000);
      await T.wait(400);
    },
    /** Put the player on the ground at (x, z) next to a block. */
    standAt(x, y, z) { const p = app.game.player; p.setPosition(x, y, z); p.motionX = p.motionY = p.motionZ = 0; p.fallDistance = 0; },
    /** Stand on free ground next to a block (any side with room for the player). */
    standNear(t) {
      const d = app.game.dim;
      for (const [ox, oz] of [[-2, 0], [2, 0], [0, -2], [0, 2], [-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const x = t.x + ox; const z = t.z + oz;
        for (let y = t.y + 1; y >= t.y - 1; y--) {
          const ground = d.getBlock(x, y - 1, z);
          if (ground !== 0 && ground !== 58 && ground !== 61 && d.getBlock(x, y, z) === 0 && d.getBlock(x, y + 1, z) === 0) { T.standAt(x + 0.5, y, z + 0.5); return; }
        }
      }
      T.standAt(t.x - 1.5, t.y, t.z + 0.5);
    },
    /** Place the held block on free ground about two blocks from the player. */
    async placeNear() {
      const g = app.game; const p = g.player; const d = g.dim;
      const px = Math.floor(p.x); const pz = Math.floor(p.z); const py = Math.floor(p.y);
      for (const [ox, oz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 1], [-2, 1], [1, 2], [1, -2]]) {
        const x = px + ox; const z = pz + oz;
        for (let y = py + 1; y >= py - 2; y--) {
          if ([2, 3, 1, 4, 12, 13].includes(d.getBlock(x, y, z)) && d.getBlock(x, y + 1, z) === 0 && d.getBlock(x, y + 2, z) === 0) {
            T.aimAt(x + 0.5, y + 0.999, z + 0.5);
            await T.use();
            return { x, y: y + 1, z, id: d.getBlock(x, y + 1, z) };
          }
        }
      }
      return { id: -1, why: 'no free ground' };
    },
    screen() { return app.game.ui.screen; },
    /** What kind of container screen is open (class names are minified in production builds). */
    kind() {
      const sc = app.game.ui.screen; if (!sc || !sc.slots) return sc ? 'other' : null;
      const groups = sc.slots.map((x) => x.group);
      if (groups.includes('fuel')) return 'furnace';
      const craft = groups.filter((x) => x === 'craft').length;
      return craft === 4 ? 'inventory' : craft === 9 ? 'table' : 'other';
    },
    /** Index of the n-th slot of a group in the open screen. */
    slot(group, n = 0) {
      const s = app.game.ui.screen.slots; let k = 0;
      for (let i = 0; i < s.length; i++) if (s[i].group === group) { if (k === n) return i; k++; }
      return -1;
    },
    /** Index of the first slot of the player's inventory holding item `id`. */
    slotWith(id) {
      const s = app.game.ui.screen.slots;
      for (let i = 0; i < s.length; i++) if ((s[i].group === 'main' || s[i].group === 'hotbar') && s[i].get()?.id === id) return i;
      return -1;
    },
    emptySlot(group = 'main') {
      const s = app.game.ui.screen.slots;
      for (let i = 0; i < s.length; i++) if (s[i].group === group && !s[i].get()) return i;
      return -1;
    },
    center(i) { const r = app.game.ui.screen.slotEls[i].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; },
    cursor() { return app.game.ui.screen.cursor ?? app.game.ui.cursor ?? null; },
  };
  window.T = T;
});

/** Real mouse click on slot index `i` of the open screen. */
async function click(i, button = 'left', shift = false) {
  if (i < 0) throw new Error('slot not found');
  const c = await ev((k) => T.center(k), i);
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.click(c.x, c.y, { button });
  if (shift) await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
}
const slotOf = (group, n = 0) => ev(([g, k]) => T.slot(g, k), [group, n]);
const held = () => ev(() => app.game.ui.cursor?.id ?? 0);
/** Right-click one item of `id` into each listed slot, picking up more when the held stack runs out. */
async function placeEach(id, slots) {
  for (const k of slots) {
    if ((await held()) !== id) {
      if ((await held()) !== 0) await click(await empty('main'));
      await click(await slotWith(id));
    }
    await click(k, 'right');
  }
  if ((await held()) !== 0) await click(await empty('main')); // put the rest back
}
const slotWith = (id) => ev((k) => T.slotWith(k), id);
const empty = (group = 'main') => ev((g) => T.emptySlot(g), group);
const count = (id) => ev((k) => T.count(k), id);
const ID = { LOG: 17, PLANKS: 5, TABLE: 58, STICK: 280, WOOD_PICK: 270, STONE_PICK: 274, COBBLE: 4, FURNACE: 61, STONE: 1 };

check('world loads', await ev(() => T.until(() => app.game?.state === 'playing', 180000)));
await ev(() => { app.game.world.dayTime = 1000; });

// ---- 1. Punch a tree -------------------------------------------------------
const findTree = (skip) => ev((skipList) => {
  const g = app.game; const d = g.dim; const p = g.player;
  const px = Math.floor(p.x); const pz = Math.floor(p.z);
  for (let r = 1; r < 48; r++) {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
      const x = px + dx; const z = pz + dz;
      if (skipList.some((t) => Math.abs(t.x - x) + Math.abs(t.z - z) < 3)) continue;
      // Lowest log of a trunk standing on grass or dirt.
      for (let y = 50; y < 100; y++) {
        if (d.getBlock(x, y, z) !== 17 || d.getBlock(x, y + 1, z) !== 17) continue;
        const below = d.getBlock(x, y - 1, z);
        if (below !== 2 && below !== 3) break;
        for (const [sx, sz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (d.getBlock(x + sx, y, z + sz) === 0 && d.getBlock(x + sx, y + 1, z + sz) === 0 && [2, 3].includes(d.getBlock(x + sx, y - 1, z + sz))) {
            return { x, y, z, sx, sz };
          }
        }
        break;
      }
    }
  }
  return null;
}, skip);
// The two lowest logs of each trunk can be reached from the ground.
const trees = [];
for (let t = 0; t < 3 && (await count(ID.LOG)) < 3; t++) {
  const tree = await findTree(trees);
  if (!tree) break;
  trees.push(tree);
  await ev((tr) => T.standAt(tr.x + tr.sx * 1.3 + 0.5, tr.y, tr.z + tr.sz * 1.3 + 0.5), tree);
  await ev(() => T.wait(1500));
  for (let k = 0; k < 2; k++) await ev(([tr, k]) => T.mine(tr.x, tr.y + k, tr.z), [tree, k]);
}
check('trees are found nearby', trees.length > 0, JSON.stringify(trees[0]));
const logs = await count(ID.LOG);
check('logs punched out by hand and picked up', logs >= 3, `(${logs} logs from ${trees.length} trees)`);
await shot('logs');

// ---- 2. Inventory crafting ---------------------------------------------------
await page.keyboard.press('KeyE');
check('E opens the inventory', await ev(() => T.until(() => T.kind() === 'inventory', 5000)));
// Different trees give different log stacks: craft each stack in turn.
let logStacks = 0;
while ((await slotWith(ID.LOG)) >= 0 && logStacks < 4) {
  await click(await slotWith(ID.LOG));                 // pick up a stack of logs
  await click(await slotOf('craft', 0));               // put it in the grid
  await click(await slotOf('craftOut'), 'left', true); // shift-click: craft all
  logStacks++;
}
const planks = await count(ID.PLANKS);
check('logs become planks (shift-click crafts all)', planks === logs * 4, `(${planks} planks from ${logs} logs in ${logStacks} stacks)`);
await shot('planks');
// Crafting table: one plank in each 2x2 cell.
await placeEach(ID.PLANKS, [await slotOf('craft', 0), await slotOf('craft', 1), await slotOf('craft', 2), await slotOf('craft', 3)]);
await click(await slotOf('craftOut'));
await click(await slotOf('hotbar', 1));
check('a crafting table is crafted', (await count(ID.TABLE)) === 1);
// Sticks: two planks stacked vertically.
await placeEach(ID.PLANKS, [await slotOf('craft', 0), await slotOf('craft', 2)]);
await click(await slotOf('craftOut'));
await click(await empty('main'));
check('sticks are crafted', (await count(ID.STICK)) >= 4);
await page.keyboard.press('KeyE');
await ev(() => T.until(() => !T.screen(), 5000));

// ---- 3. Place the table and craft a pickaxe ------------------------------------
const table = await ev(async () => {
  const g = app.game; const p = g.player; const d = g.dim;
  p.inventory.selected = 1;
  void d;
  return T.placeNear();
});
check('the crafting table can be placed', table.id === ID.TABLE, JSON.stringify(table));
await ev(async (t) => { T.aimAt(t.x + 0.5, t.y + 0.5, t.z + 0.5); await T.use(); }, table);
check('right-clicking the table opens the 3x3 grid', await ev(() => T.until(() => T.kind() === 'table', 5000)));
async function craft3(pattern, key, dest = 'hotbar', destN = 2) {
  // pattern: 9 chars, key maps char -> item id; one item per cell via right-click.
  for (const [ch, id] of Object.entries(key)) {
    const cells = [];
    for (let k = 0; k < 9; k++) if (pattern[k] === ch) cells.push(await slotOf('craft', k));
    await placeEach(id, cells);
  }
  await click(await slotOf('craftOut'));
  await click(await slotOf(dest, destN));
}
await craft3('PPP.S..S.', { P: ID.PLANKS, S: ID.STICK });
check('a wooden pickaxe is crafted on the table', (await count(ID.WOOD_PICK)) === 1);
await shot('pickaxe');
await page.keyboard.press('KeyE');
await ev(() => T.until(() => !T.screen(), 5000));

// ---- 4. Dig down to stone ------------------------------------------------------
const dig = await ev(async () => {
  const g = app.game; const p = g.player; const d = g.dim;
  p.inventory.selected = 2;
  let cobble = 0;
  for (let n = 0; n < 40 && p.inventory.count(4) < 11; n++) {
    const x = Math.floor(p.x); const z = Math.floor(p.z); const y = Math.floor(p.y + 0.01) - 1;
    // Stand in the middle of the column so digging under it drops us down.
    T.standAt(x + 0.5, p.y, z + 0.5);
    const id = d.getBlock(x, y, z);
    if (id === 7 || id === 8 || id === 9 || id === 10 || id === 11) break;
    // Mine the block under our feet, then the one beside it for more stone.
    if (id !== 0) await T.mine(x, y, z, 30000);
    await T.until(() => p.onGround, 3000);
    const side = Math.floor(p.y + 0.01);
    if (d.getBlock(x + 1, side, z) === 1) await T.mine(x + 1, side, z, 30000);
    cobble = p.inventory.count(4);
  }
  const held = p.inventory.get(2);
  return { cobble, y: Math.floor(p.y), pickDamage: held?.damage ?? -1 };
});
check('the wooden pickaxe mines stone into cobblestone', dig.cobble >= 11, `(${dig.cobble} cobblestone at y=${dig.y})`);
check('mining wears the pickaxe', dig.pickDamage > 0, `(damage ${dig.pickDamage})`);
await shot('stone');

// ---- 5. Stone tools and a furnace ----------------------------------------------
await ev((t) => T.standNear(t), table);
await ev(() => T.wait(1500));
await ev(async (t) => { T.aimAt(t.x + 0.5, t.y + 0.5, t.z + 0.5); await T.use(); }, table);
check('back at the table', await ev(() => T.until(() => T.kind() === 'table', 5000)));
await craft3('CCC.S..S.', { C: ID.COBBLE, S: ID.STICK }, 'hotbar', 3);
check('a stone pickaxe is crafted', (await count(ID.STONE_PICK)) === 1);
await craft3('CCCC.CCCC', { C: ID.COBBLE }, 'hotbar', 4);
check('a furnace is crafted from eight cobblestone', (await count(ID.FURNACE)) === 1);
await page.keyboard.press('KeyE');
await ev(() => T.until(() => !T.screen(), 5000));

// ---- 6. Food ---------------------------------------------------------------------
const hunt = await ev(async () => {
  const g = app.game; const p = g.player; const d = g.dim;
  // Sheep give only wool in this era.
  const animals = g.entitiesIn(d).filter((e) => ['pig', 'cow', 'chicken'].includes(e.type) && !e.removed);
  animals.sort((a, b) => a.distanceSqTo(p.x, p.y, p.z) - b.distanceSqTo(p.x, p.y, p.z));
  const a = animals[0];
  if (!a) return { found: false };
  p.inventory.selected = 3;
  let hits = 0;
  while (!a.removed && !a.dead && hits < 40) {
    p.setPosition(a.x + 1.6, a.y, a.z); p.motionX = p.motionY = p.motionZ = 0;
    await T.wait(250);
    T.aimAt(a.x, a.y + a.height * 0.6, a.z);
    await T.wait(250);
    g.input.locked = true; g.input.leftPressed = true;
    await T.until(() => !g.input.leftPressed, 3000);
    hits++;
    await T.wait(450);
  }
  // Walk over the drops.
  await T.wait(1500);
  for (const e of g.entitiesIn(d)) if (e.type === 'item' && e.distanceSqTo(a.x, a.y, a.z) < 16) { p.setPosition(e.x, e.y, e.z); await T.wait(700); }
  const meat = [319, 363, 365].find((id) => p.inventory.count(id) > 0) ?? 0;
  return { found: true, type: a.type, hits, meat };
});
check('an animal is hunted for raw meat', hunt.found && hunt.meat > 0, JSON.stringify(hunt));

// ---- 7. Furnace: cook the meat with planks as fuel, then eat ----------------------
await ev((t) => T.standNear(t), table);
await ev(() => T.wait(1500));
const furnace = await ev(async () => {
  const g = app.game; const p = g.player; const d = g.dim;
  p.inventory.selected = 4;
  void d;
  const pos = await T.placeNear();
  if (pos.id !== 61) return pos;
  T.aimAt(pos.x + 0.5, pos.y + 0.5, pos.z + 0.5);
  await T.use();
  return pos;
});
check('the furnace is placed and opens', furnace.id === ID.FURNACE && await ev(() => T.until(() => T.kind() === 'furnace', 5000)), JSON.stringify(furnace));
if (hunt.meat) {
  await click(await slotWith(hunt.meat));
  await click(await slotOf('input'));
  await click(await slotWith(ID.PLANKS));
  await click(await slotOf('fuel'));
  await shot('furnace');
  const cooked = { 319: 320, 363: 364, 365: 366 }[hunt.meat];
  const done = await ev((c) => T.until(() => T.screen()?.slots.find((s) => s.group === 'out')?.get()?.id === c, 120000), cooked);
  await shot('cooked');
  await click(await slotOf('out'), 'left', true);
  check('raw meat cooks into cooked meat and is taken out', done && (await count(cooked)) > 0);
  await page.keyboard.press('KeyE');
  await ev(() => T.until(() => !T.screen(), 5000));
  const eat = await ev(async (c) => {
    const g = app.game; const p = g.player; const i = g.input;
    const idx = p.inventory.slots.findIndex((s) => s?.id === c);
    if (idx > 8) { const tmp = p.inventory.get(5); p.inventory.set(5, p.inventory.get(idx)); p.inventory.set(idx, tmp); p.inventory.selected = 5; } else p.inventory.selected = idx;
    p.foodLevel = 10; // as if after a long day of work
    p.pitch = 1.4; // look at the sky, nothing to click
    i.locked = true; await T.wait(400);
    i.rightDown = true; i.rightPressed = true;
    await T.until(() => p.foodLevel > 10, 15000);
    i.rightDown = false;
    const held = p.inventory.held;
    return { food: p.foodLevel, held: held?.id ?? 0, selected: p.inventory.selected, screen: !!g.ui.screen, paused: g.paused, state: g.state, target: g.interaction.target?.id ?? null };
  }, cooked);
  await shot('eat');
  check('eating cooked meat restores hunger', eat.food > 10, JSON.stringify(eat));
}

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);

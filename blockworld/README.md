# BLOCKWORLD

An independently developed browser voxel survival game in the style of the
first full release era of block-survival games (late 2011). It is written in
TypeScript with Three.js and Vite. Every texture, sprite, model skin, sound,
the pixel font, the logo and the ending text are original and generated
procedurally at startup; the project ships no third-party game assets.

You can play from punching the first tree to defeating the dragon and seeing
the ending, then keep playing in the same world:

logs → planks → crafting table → tools → stone → food → nights → iron →
smelting → diamonds → obsidian → Nether portal → Nether fortress → blaze rods →
ender pearls → Eyes of Ender → stronghold → End portal → the End → crystals →
dragon → exit portal → ending → back home.

---

## INSTALL

Requirements: **Node.js 18 or newer** (20+ recommended) and npm.

```bash
cd blockworld
npm install
```

## RUN DEVELOPMENT BUILD

```bash
npm run dev
```

Vite prints a local URL, normally **http://localhost:5173/**. Open it in
Chrome, Edge, Opera, Firefox or Safari.

## BUILD PRODUCTION VERSION

```bash
npm run build        # type-checks, then writes the static site to dist/
npm run preview      # serves dist/ at http://localhost:4173/
```

`dist/` is a plain static site. Host it with any static file server
(`npx serve dist`, nginx, GitHub Pages, ...). It must be served over
`http(s)://`; opening `dist/index.html` straight from disk (`file://`) does not
work because browsers block the module web workers used for terrain
generation.

## OPEN GAME

1. Open the URL above.
2. Click **Singleplayer → Create New World**, type a name, optionally a seed,
   choose a game mode (Survival, Creative or Hardcore) and difficulty, then
   **Create New World**.
3. Click the game view to capture the mouse. **Esc** releases it and opens the
   pause menu.

Seeds: an empty seed picks a random one, a number is used directly and any
other text is hashed deterministically. The same seed always produces the same
terrain and structures for this generator version.

---

## CONTROLS

| Action | Default |
| --- | --- |
| Move | **W A S D** |
| Jump / swim up | **Space** |
| Sneak (no falling off edges) | **Left Shift** |
| Sprint | double-tap **W**, or hold **Left Ctrl** |
| Look | mouse |
| Attack / mine | left mouse button (hold to mine) |
| Use / place / eat / draw bow | right mouse button (hold to eat, drink or draw) |
| Hotbar slot | **1 – 9** or mouse wheel |
| Inventory | **E** |
| Drop held item | **Q** |
| Pause menu / release mouse | **Esc** |
| Hide HUD | **F1** |
| Screenshot (PNG download) | **F2** |
| Debug overlay (FPS, chunks, draw calls, position) | **F3** |
| Third-person view | **F5** |

All bindings can be changed in **Options → Controls**.

Inventory screens: left-click picks up / places / swaps a stack, right-click
takes half a stack or places a single item, **Shift+click** moves a stack
between the inventory and the open container, number keys **1–9** swap the
hovered slot with a hotbar slot, and clicking outside the window drops the held
stack.

## GAMEPLAY NOTES

* **Crafting**: 2×2 grid in the inventory, 3×3 on a crafting table. Recipes
  are structured data (`src/recipes/data.ts`).
* **Smelting**: furnace input / fuel / output with burn and progress
  indicators; furnaces keep working while their chunk is loaded.
* **Nights**: hostile mobs spawn in darkness. Sleep in a bed to skip the night
  and set your respawn point.
* **Nether**: build a 4×5 obsidian frame (corners optional) and light it with
  flint and steel. Stand in the portal for a few seconds to travel. Portals
  link at 1:8 scale and are created on the other side when needed. Fortresses
  are nether-brick bridges and halls with blaze spawners and nether wart.
* **The End**: combine an ender pearl with blaze powder to make an Eye of
  Ender. Right-click in the Overworld to throw one; it flies toward the
  nearest of the three strongholds (640–1152 blocks from the world origin),
  then drops or shatters. Dig down where the eyes fall, find the portal room,
  fill the empty frames and jump in. Destroy the crystals on the obsidian
  pillars (arrows or melee), defeat the dragon, and step into the exit portal.
* **Redstone**: dust, torches, repeaters, levers, buttons, pressure plates,
  pistons (sticky and normal), doors, trapdoors, note blocks, TNT, powered and
  detector rails.

## SAVE LOCATION / BEHAVIOR

* Worlds are stored in the browser's **IndexedDB**, database `blockworld`,
  for the page's origin (for example `http://localhost:5173`). A different
  port, host or browser profile has a separate set of worlds. Clearing the
  site's data in the browser deletes the worlds.
* Only what differs from the seed is saved: modified chunks (run-length
  encoded), tile entities (chests, furnaces, brewing stands, signs, spawners,
  note blocks), persistent entities, the player (position, dimension,
  inventory, armor, health, hunger, XP, effects, bed spawn) and world state
  (time, weather, spawn point, dragon/End progress). Unmodified terrain is
  regenerated from the seed.
* Each save record carries `saveFormatVersion`, `generatorVersion` and
  `gameVersion`; older records are migrated when loaded.
* Saving happens automatically every 45 seconds, when the game is paused, when
  changing dimension and on **Save & Quit to Title**. Each save is written in a
  single IndexedDB transaction, so an interrupted write leaves the previous
  save intact.
* Settings (volume, sensitivity, FOV, render distance, graphics, key bindings)
  are stored in `localStorage` under `blockworld.settings.v1`.

---

## TESTING

```bash
npm test             # unit and integration tests (Vitest, runs in Node)
npm run typecheck    # TypeScript
```

The suites cover recipes and the whole crafting chain, smelting and fuels,
tool tiers, inventory stacking and slot clicks, chunk indexing, run-length
encoding, deterministic generation, damage/armor/difficulty, mob drops (blaze
rods, ender pearls), Eyes of Ender, player and tile serialisation, Nether
portal detection, End portal activation, the furnace, the dragon's death
creating the exit portal and egg, redstone circuits, structure generation
(strongholds with exactly one portal room, villages, mineshafts, fortresses,
the End pillars) and mob model textures.

Browser checks (require the dev server, or set `GAME_URL`, and Playwright's
Chromium):

```bash
node scripts/playthrough.mjs <outDir> [seed]   # end-to-end progression run
node scripts/play.mjs <outPrefix> [seed] '[{"eval":"...","wait":1000,"shot":true}]'
```

`playthrough.mjs` drives the real input and interaction code: it lights a
Nether portal with flint and steel, travels to the Nether and back, throws an
Eye of Ender, fills the stronghold frames, enters the End, destroys the
crystals, kills the dragon, takes the exit portal through the ending, then
saves, reloads and checks that progress persisted.

## PROJECT LAYOUT

```
src/core       seeded RNG, noise, math, AABBs
src/blocks     block ids, registry (hardness, tools, drops, light, textures)
src/items      item registry, stacks, containers, enchantments
src/recipes    crafting and smelting data + matcher
src/world      chunks, dimensions, lighting, fluids, block behaviours,
               portals, explosions, redstone, collision, raycasting
src/worldgen   Overworld/Nether/End generators, caves, ores, features,
               structures (villages, mineshafts, strongholds, fortresses)
src/entity     player, mobs, AI goals, pathfinding, projectiles, vehicles,
               the dragon, spawning
src/render     texture painting, atlases, chunk mesher, materials, sky,
               particles, entity models
src/game       game loop, input, interaction, furnace, brewing, settings
src/ui         HUD, menus, container screens, pixel font, ending
src/save       IndexedDB storage and chunk codec
src/audio      procedural sound effects and ambient music
tests/         Vitest suites
scripts/       development and verification scripts
```

## PERFORMANCE

Chunks are 16×16×128, generated in Web Workers, lit with sky and block light,
and meshed with hidden-face culling into one opaque, one cutout and one
translucent mesh per chunk; the atlas uses nearest-neighbour sampling and
chunk meshes are frustum culled. **F3** shows FPS, draw calls, triangles,
loaded/meshed chunks, entity count and average generation/mesh/light timings.
Lower **Render Distance** or switch to **Fast** graphics in Options on slower
machines.

## ERA SCOPE

The content deliberately stops at the late-2011 feature set: no modern
biomes, cave generation, Nether biomes, Netherite, shields, off-hand, attack
cooldown, trading, raids, witches, golems, the Wither, End cities, shulkers,
elytra or recipe book.

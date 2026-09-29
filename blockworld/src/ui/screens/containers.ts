/** Inventory, crafting, furnace, chest, brewing and enchanting screens. */

import { BlockId } from '../../blocks/ids';
import { ItemId } from '../../items/ids';
import { Container } from '../../items/container';
import { allItems, getItem } from '../../items/registry';
import { canMerge, cloneStack, createStack, isEmpty, maxStackSize, type ItemStack } from '../../items/stack';
import { consumeIngredients, craftingResult, findSmelting, fuelTicks } from '../../recipes/crafting';
import { countBookshelves, enchantCosts, isEnchantable, selectEnchantments } from '../../items/enchantments';
import { isBrewingIngredient } from '../../game/brewing';
import type { Dimension } from '../../world/dimension';
import type { BrewingTile, ChestTile, FurnaceTile } from '../../world/tileentity';
import { button, el } from '../dom';
import { ContainerScreen, type SlotDef } from '../screen';
import { iconCanvas } from '../icons';
import { rollLoot } from '../../worldgen/loot';
import { packCanvas } from '../../render/pack';

function ghostIcon(id: number): HTMLCanvasElement {
  return iconCanvas(id, 0);
}

/** Shared crafting-grid logic used by the inventory and the crafting table. */
abstract class CraftingScreenBase extends ContainerScreen {
  protected grid: Container;

  constructor(w: number, h: number, readonly size: number) {
    super(w, h);
    this.grid = new Container(size * size);
  }

  protected addGrid(ox: number, oy: number): void {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        const i = r * this.size + c;
        this.slots.push({ x: ox + c * 18, y: oy + r * 18, get: () => this.grid.get(i), set: (s) => this.grid.set(i, s), group: 'craft' });
      }
    }
  }

  protected addOutput(x: number, y: number): void {
    this.slots.push({
      x, y, big: true, group: 'craftOut',
      get: () => craftingResult(this.grid.slots, this.size),
      set: () => undefined,
      output: (taken, shift) => {
        this.consume();
        this.ui.host.onCrafted?.(taken);
        if (shift) {
          // Keep crafting while the same result can be made and fits.
          for (let guard = 0; guard < 64; guard++) {
            const next = craftingResult(this.grid.slots, this.size);
            if (!next || next.id !== taken.id || next.meta !== taken.meta) break;
            const copy = cloneStack(next)!;
            if (!this.moveToGroups(copy, ['main', 'hotbar'], true)) break;
            this.consume();
          }
        }
      },
    });
  }

  private consume(): void {
    const after = consumeIngredients(this.grid.slots);
    after.forEach((s, i) => this.grid.set(i, s));
  }

  override onClose(): void {
    const inv = this.ui.host.player.inventory;
    for (const s of this.grid.slots) {
      if (!s) continue;
      const left = inv.addItem(s);
      if (left) this.ui.host.dropItem(left);
    }
    this.grid.clear();
  }
}

export class InventoryScreen extends CraftingScreenBase {
  constructor() {
    super(176, 166, 2);
  }

  protected build(): void {
    const inv = this.ui.host.player.inventory;
    const armorIcons = [ItemId.IRON_HELMET, ItemId.IRON_CHESTPLATE, ItemId.IRON_LEGGINGS, ItemId.IRON_BOOTS];
    for (let i = 0; i < 4; i++) {
      this.slots.push({
        x: 8, y: 8 + i * 18, group: 'armor', rules: { armorSlot: i as 0 | 1 | 2 | 3 },
        get: () => inv.armor.get(i), set: (s) => inv.armor.set(i, s), ghost: ghostIcon(armorIcons[i]),
      });
    }
    if (this.textured) {
      // Vanilla-style layout of the pack's inventory texture.
      this.label('Crafting', 97, 8);
      this.addGrid(98, 18);
      this.addOutput(154, 28);
    } else {
      this.label('Crafting', 86, 16);
      this.addGrid(88, 26);
      this.addOutput(144, 36);
      const arrow = el('div', 'label', this.panel, '=>');
      arrow.style.left = '126px';
      arrow.style.top = '40px';
    }
    // Player figure area.
    const box = el('div', '', this.panel);
    Object.assign(box.style, { position: 'absolute', left: '26px', top: '8px', width: '52px', height: '70px', background: '#000', boxShadow: '-1px -1px 0 #373737, 1px 1px 0 #fff' });
    if (this.textured) Object.assign(box.style, { width: '49px', background: 'transparent', boxShadow: 'none' });
    const fig = el('canvas', '', box) as HTMLCanvasElement;
    fig.width = 52; fig.height = 70;
    if (!drawSkinFigure(fig)) drawFigure(fig);
    this.addPlayerInventory(8, 84);
  }

  protected override packBackground() {
    // The off-hand slot of the modern texture is painted over (no off-hand in this era).
    return { path: 'gui/container/inventory', cover: [[76, 61, 18, 18]] as [number, number, number, number][] };
  }

  protected shiftTargets(stack: ItemStack, group: string): string[] {
    const def = getItem(stack.id);
    const isArmor = !!def && def.armorSlot >= 0;
    switch (group) {
      case 'main': return isArmor ? ['armor', 'hotbar'] : ['hotbar'];
      case 'hotbar': return isArmor ? ['armor', 'main'] : ['main'];
      default: return ['main', 'hotbar'];
    }
  }
}

/** Front view of the player skin from the resource pack (if present). */
function drawSkinFigure(c: HTMLCanvasElement): boolean {
  const skin = packCanvas('entity/player/wide/steve');
  if (!skin) return false;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const part = (sx: number, sy: number, w: number, h: number, dx: number, dy: number) => g.drawImage(skin, sx, sy, w, h, dx * 2 + 2, dy * 2 + 3, w * 2, h * 2);
  part(8, 8, 8, 8, 8, 0); part(40, 8, 8, 8, 8, 0); // head + hat
  part(20, 20, 8, 12, 8, 8); // body
  part(44, 20, 4, 12, 4, 8); part(36, 52, 4, 12, 16, 8); // arms
  part(4, 20, 4, 12, 8, 20); part(20, 52, 4, 12, 12, 20); // legs
  return true;
}

/** A simple original pixel figure standing in the inventory preview box. */
function drawFigure(c: HTMLCanvasElement): void {
  const ctx = c.getContext('2d')!;
  const px = (x: number, y: number, w: number, h: number, col: string) => { ctx.fillStyle = col; ctx.fillRect(x, y, w, h); };
  px(18, 6, 16, 16, '#b88a68'); // head
  px(18, 6, 16, 5, '#4a3020'); // hair
  px(21, 13, 3, 2, '#fff'); px(28, 13, 3, 2, '#fff');
  px(22, 13, 2, 2, '#3a4a9a'); px(29, 13, 2, 2, '#3a4a9a');
  px(23, 18, 6, 1, '#7a4a3a');
  px(18, 22, 16, 22, '#2aa0a8'); // shirt
  px(10, 22, 8, 22, '#2aa0a8'); px(34, 22, 8, 22, '#2aa0a8');
  px(10, 38, 8, 6, '#b88a68'); px(34, 38, 8, 6, '#b88a68');
  px(18, 44, 16, 20, '#3a3a8a'); // legs
  px(25, 44, 2, 20, '#2a2a6a');
  px(18, 62, 16, 4, '#5a5a5a');
}

export class CraftingTableScreen extends CraftingScreenBase {
  protected override packBackground() {
    return { path: 'gui/container/crafting_table' };
  }

  constructor() {
    super(176, 166, 3);
  }

  protected build(): void {
    this.label('Crafting', 28, 6);
    this.addGrid(30, 17);
    this.addOutput(124, 35);
    const arrow = this.label('=>', 92, 39);
    if (this.textured) arrow.style.display = 'none';
    arrow.style.color = '#8b8b8b';
    this.label('Inventory', 8, 72);
    this.addPlayerInventory(8, 84);
  }

  protected shiftTargets(_stack: ItemStack, group: string): string[] {
    if (group === 'main') return ['hotbar'];
    if (group === 'hotbar') return ['main'];
    return ['main', 'hotbar'];
  }
}

export class FurnaceScreen extends ContainerScreen {
  private flame!: HTMLDivElement;
  private arrow!: HTMLDivElement;

  constructor(private readonly tile: FurnaceTile) {
    super(176, 166);
  }

  protected build(): void {
    const t = this.tile;
    this.label('Furnace', 70, 6);
    this.slots.push({ x: 56, y: 17, group: 'input', get: () => t.items.get(0), set: (s) => t.items.set(0, s) });
    this.slots.push({ x: 56, y: 53, group: 'fuel', get: () => t.items.get(1), set: (s) => t.items.set(1, s), rules: { accepts: (s) => fuelTicks(s) > 0 } });
    this.slots.push({
      x: 116, y: 35, big: true, group: 'out', get: () => t.items.get(2), set: (s) => t.items.set(2, s),
      output: (taken, shift) => {
        if (!shift) t.items.set(2, null);
        else {
          const left = t.items.get(2);
          if (left) { left.count -= taken.count; t.items.set(2, left.count > 0 ? left : null); }
        }
        this.ui.host.onSmelted?.(taken, t);
      },
    });
    if (this.textured) {
      // Sprites over the texture's empty flame and arrow.
      this.flame = el('div', '', this.panel);
      Object.assign(this.flame.style, { position: 'absolute', left: '56px', width: '14px', backgroundImage: this.sprite('gui/sprites/container/furnace/lit_progress') ?? '', backgroundRepeat: 'no-repeat' });
      this.arrow = el('div', '', this.panel);
      Object.assign(this.arrow.style, { position: 'absolute', left: '79px', top: '34px', height: '16px', backgroundImage: this.sprite('gui/sprites/container/furnace/burn_progress') ?? '', backgroundRepeat: 'no-repeat' });
      this.label('Inventory', 8, 72);
      this.addPlayerInventory(8, 84);
      return;
    }
    const flameBox = el('div', '', this.panel);
    Object.assign(flameBox.style, { position: 'absolute', left: '56px', top: '36px', width: '14px', height: '14px', background: '#8b8b8b' });
    this.flame = el('div', '', flameBox);
    Object.assign(this.flame.style, { position: 'absolute', left: '2px', bottom: '0', width: '10px', background: 'linear-gradient(#ffe070, #ff8000 60%, #c02000)' });
    const arrowBox = el('div', '', this.panel);
    Object.assign(arrowBox.style, { position: 'absolute', left: '79px', top: '34px', width: '24px', height: '17px' });
    const back = el('div', '', arrowBox);
    Object.assign(back.style, { position: 'absolute', left: '0', top: '6px', width: '18px', height: '5px', background: '#8b8b8b' });
    const head = el('div', '', arrowBox);
    Object.assign(head.style, { position: 'absolute', left: '17px', top: '1px', width: '0', height: '0', borderTop: '7px solid transparent', borderBottom: '7px solid transparent', borderLeft: '7px solid #8b8b8b' });
    this.arrow = el('div', '', arrowBox);
    Object.assign(this.arrow.style, { position: 'absolute', left: '0', top: '6px', height: '5px', background: '#fff' });
    this.label('Inventory', 8, 72);
    this.addPlayerInventory(8, 84);
  }

  protected shiftTargets(stack: ItemStack, group: string): string[] {
    if (group === 'main' || group === 'hotbar') {
      if (findSmelting(stack)) return ['input'];
      if (fuelTicks(stack) > 0) return ['fuel'];
      return group === 'main' ? ['hotbar'] : ['main'];
    }
    return ['main', 'hotbar'];
  }

  override update(dt: number): void {
    super.update(dt);
    const t = this.tile;
    const f = t.burnTotal > 0 ? t.burnTime / t.burnTotal : 0;
    if (this.textured) {
      const h = t.burnTime > 0 ? Math.ceil(f * 13) + 1 : 0;
      this.flame.style.top = `${36 + 14 - h}px`;
      this.flame.style.height = `${h}px`;
      this.flame.style.backgroundPosition = `0 ${-(14 - h)}px`;
      this.arrow.style.width = `${Math.ceil((t.cookTime / 200) * 24)}px`;
      return;
    }
    this.flame.style.height = `${Math.ceil(f * 13)}px`;
    this.arrow.style.width = `${Math.floor((t.cookTime / 200) * 22)}px`;
  }

  protected override packBackground() {
    return { path: 'gui/container/furnace' };
  }
}

export class ChestScreen extends ContainerScreen {
  constructor(private readonly tiles: ChestTile[], private readonly title: string) {
    super(176, 114 + tiles.length * 3 * 18);
  }

  protected override packBackground() {
    const rows = this.tiles.length * 3;
    return { path: 'gui/container/generic_54', parts: [[0, 0, 176, rows * 18 + 17], [0, 126, 176, 96]] as [number, number, number, number][] };
  }

  override onOpen(): void {
    for (const t of this.tiles) {
      if (t.loot) {
        t.items.load(rollLoot(t.loot, t.lootSeed ?? 1));
        t.loot = undefined;
      }
    }
    super.onOpen();
    this.ui.host.onChestOpen?.(true);
  }

  override onClose(): void {
    this.ui.host.onChestOpen?.(false);
  }

  protected build(): void {
    this.label(this.title, 8, 6);
    let row = 0;
    for (const t of this.tiles) {
      for (let r = 0; r < 3; r++, row++) {
        for (let c = 0; c < 9; c++) {
          const i = r * 9 + c;
          this.slots.push({ x: 8 + c * 18, y: 18 + row * 18, group: 'chest', get: () => t.items.get(i), set: (s) => t.items.set(i, s) });
        }
      }
    }
    const oy = 18 + row * 18 + 14;
    this.label('Inventory', 8, oy - 11);
    this.addPlayerInventory(8, oy);
  }

  protected shiftTargets(_s: ItemStack, group: string): string[] {
    return group === 'chest' ? ['hotbar', 'main'] : ['chest'];
  }
}

export class BrewingScreen extends ContainerScreen {
  private bar!: HTMLDivElement;

  constructor(private readonly tile: BrewingTile) {
    super(176, 166);
  }

  protected build(): void {
    const t = this.tile;
    this.label('Brewing Stand', 56, 6);
    const potionRule = { maxStack: 1, accepts: (s: ItemStack) => s.id === ItemId.POTION || s.id === ItemId.GLASS_BOTTLE };
    const pos = this.textured ? [[56, 51], [79, 58], [102, 51]] : [[56, 46], [79, 53], [102, 46]];
    pos.forEach(([x, y], i) => {
      this.slots.push({ x, y, group: 'bottle', rules: potionRule, get: () => t.items.get(i), set: (s) => t.items.set(i, s), ghost: iconCanvas(ItemId.GLASS_BOTTLE, 0) });
    });
    this.slots.push({ x: 79, y: 17, group: 'ingredient', rules: { accepts: (s) => isBrewingIngredient(s.id) }, get: () => t.items.get(3), set: (s) => t.items.set(3, s) });
    if (this.textured) {
      this.bar = el('div', '', this.panel);
      Object.assign(this.bar.style, { position: 'absolute', left: '97px', top: '16px', width: '9px', backgroundImage: this.sprite('gui/sprites/container/brewing_stand/brew_progress') ?? '', backgroundRepeat: 'no-repeat' });
    } else {
      const barBox = el('div', '', this.panel);
      Object.assign(barBox.style, { position: 'absolute', left: '98px', top: '16px', width: '7px', height: '28px', background: '#8b8b8b' });
      this.bar = el('div', '', barBox);
      Object.assign(this.bar.style, { position: 'absolute', left: '0', top: '0', width: '7px', background: '#fff' });
    }
    this.label('Inventory', 8, 72);
    this.addPlayerInventory(8, 84);
  }

  protected shiftTargets(stack: ItemStack, group: string): string[] {
    if (group === 'main' || group === 'hotbar') {
      if (isBrewingIngredient(stack.id)) return ['ingredient'];
      if (stack.id === ItemId.POTION || stack.id === ItemId.GLASS_BOTTLE) return ['bottle'];
      return group === 'main' ? ['hotbar'] : ['main'];
    }
    return ['main', 'hotbar'];
  }

  override update(dt: number): void {
    super.update(dt);
    const f = this.tile.brewTime > 0 ? 1 - this.tile.brewTime / 400 : 0;
    this.bar.style.height = `${Math.floor(f * 28)}px`;
  }

  protected override packBackground() {
    // Blaze-powder fuel arrived after this era: its slot and gauge are blanked.
    return { path: 'gui/container/brewing_stand', cover: [[16, 16, 18, 18], [59, 43, 20, 6]] as [number, number, number, number][] };
  }
}

const RUNES = 'abcdefghijklmnopqrstuvwxyz';

export class EnchantScreen extends ContainerScreen {
  private item = new Container(1);
  private options: HTMLDivElement[] = [];
  private costs: [number, number, number] = [0, 0, 0];
  private lastKey = '';

  constructor(private readonly dim: Dimension, private readonly x: number, private readonly y: number, private readonly z: number) {
    super(176, 166);
  }

  protected override packBackground() {
    // Enchanting used only experience levels in this era: the lapis slot is blanked.
    return { path: 'gui/container/enchanting_table', cover: [[34, 46, 18, 18]] as [number, number, number, number][] };
  }

  override onOpen(): void {
    super.onOpen();
    if (!this.textured) return;
    const css = (n: string) => this.sprite(`gui/sprites/container/enchanting_table/${n}`) ?? '';
    const r = document.documentElement.style;
    r.setProperty('--ench-slot', css('enchantment_slot'));
    r.setProperty('--ench-slot-hi', css('enchantment_slot_highlighted'));
    r.setProperty('--ench-slot-off', css('enchantment_slot_disabled'));
  }

  protected build(): void {
    this.label('Enchant', 12, 6);
    this.slots.push({ x: this.textured ? 15 : 25, y: 47, group: 'item', rules: { maxStack: 1 }, get: () => this.item.get(0), set: (s) => this.item.set(0, s) });
    this.options = [];
    for (let i = 0; i < 3; i++) {
      const o = el('div', 'enchant-option', this.panel);
      o.style.left = '60px';
      o.style.top = `${14 + i * 19}px`;
      o.addEventListener('mousedown', (e) => { e.stopPropagation(); this.choose(i); });
      if (this.textured) o.classList.add('packed');
      this.options.push(o);
    }
    this.label('Inventory', 8, 72);
    this.addPlayerInventory(8, 84);
  }

  private bookshelves(): number {
    const d = this.dim;
    return countBookshelves((x, y, z) => d.getBlock(x, y, z), this.x, this.y, this.z, BlockId.BOOKSHELF);
  }

  private choose(i: number): void {
    const stack = this.item.get(0);
    const p = this.ui.host.player;
    const cost = this.costs[i];
    if (!stack || !isEnchantable(stack) || cost <= 0) return;
    if (p.xpLevel < cost && !p.creative) return;
    const seed = this.ui.host.enchantSeed?.() ?? 1;
    const ench = selectEnchantments(stack, cost, seed + i);
    if (ench.length === 0) return;
    const out = cloneStack(stack)!;
    out.ench = ench;
    this.item.set(0, out);
    if (!p.creative) p.removeLevels(cost);
    this.ui.host.onEnchanted?.();
    this.lastKey = '';
  }

  override update(dt: number): void {
    super.update(dt);
    const stack = this.item.get(0);
    const p = this.ui.host.player;
    const key = stack ? `${stack.id}:${stack.ench?.length ?? 0}:${p.xpLevel}:${this.ui.host.enchantSeed?.()}` : 'none';
    if (key === this.lastKey) return;
    this.lastKey = key;
    const enchantable = isEnchantable(stack);
    this.costs = enchantable ? enchantCosts(this.ui.host.enchantSeed?.() ?? 1, this.bookshelves()) : [0, 0, 0];
    this.options.forEach((o, i) => {
      o.textContent = '';
      const cost = this.costs[i];
      const ok = enchantable && cost > 0 && (p.xpLevel >= cost || p.creative);
      o.className = `enchant-option${ok ? ' ok' : enchantable ? ' disabled' : ''}${this.textured ? ' packed' : ''}`;
      if (!enchantable) return;
      let runes = '';
      let seed = (cost * 131 + i * 17) >>> 0;
      for (let k = 0; k < 10; k++) { seed = (seed * 1103515245 + 12345) >>> 0; runes += RUNES[seed % RUNES.length]; if (k % 4 === 3) runes += ' '; }
      el('div', 'runes', o, runes).style.fontStyle = 'italic';
      el('div', 'cost', o, String(cost));
    });
  }

  protected shiftTargets(_s: ItemStack, group: string): string[] {
    if (group === 'item') return ['main', 'hotbar'];
    return ['item'];
  }

  override onClose(): void {
    const s = this.item.get(0);
    if (s) {
      const left = this.ui.host.player.inventory.addItem(s);
      if (left) this.ui.host.dropItem(left);
      this.item.clear();
    }
  }
}

export { isEmpty, canMerge };


/** Blocks and items the creative palette hides (technical or from later eras). */
const CREATIVE_HIDDEN = new Set<number>([
  BlockId.BEDROCK, BlockId.SPAWNER, BlockId.MONSTER_EGG, BlockId.DRAGON_EGG, BlockId.WOODEN_BUTTON,
  BlockId.SANDSTONE_STAIRS, ItemId.CHARCOAL,
]);
const CREATIVE_VARIANTS: Record<number, number[]> = {
  [BlockId.WOOL]: Array.from({ length: 16 }, (_, i) => i),
  [ItemId.DYE]: Array.from({ length: 16 }, (_, i) => i),
  [BlockId.LOG]: [0, 1, 2],
  [BlockId.LEAVES]: [0, 1, 2],
  [BlockId.SAPLING]: [0, 1, 2],
  [BlockId.SLAB]: [0, 1, 2, 3, 4, 5],
  [BlockId.STONE_BRICKS]: [0, 1, 2],
  [ItemId.POTION]: [0, 1, 4, 5, 6, 8, 10],
};

function creativePalette(): ItemStack[] {
  const out: ItemStack[] = [];
  const defs = allItems().filter((d) => !CREATIVE_HIDDEN.has(d.id));
  defs.sort((a, b) => (a.id < 256 ? 0 : 1) - (b.id < 256 ? 0 : 1) || a.id - b.id);
  for (const d of defs) {
    for (const meta of CREATIVE_VARIANTS[d.id] ?? [0]) out.push(createStack(d.id, 1, meta));
  }
  return out;
}

/** Creative mode: take any item from a paged palette into the hotbar. */
export class CreativeScreen extends ContainerScreen {
  private page = 0;
  private readonly palette = creativePalette();
  private pageLabel!: HTMLDivElement;
  private static readonly PER_PAGE = 45;

  constructor() {
    super(176, 152);
  }

  protected build(): void {
    const inv = this.ui.host.player.inventory;
    this.label('Creative Inventory', 8, 5);
    for (let k = 0; k < CreativeScreen.PER_PAGE; k++) {
      const col = k % 9; const row = Math.floor(k / 9);
      this.slots.push({
        x: 8 + col * 18, y: 17 + row * 18, group: 'palette',
        get: () => this.palette[this.page * CreativeScreen.PER_PAGE + k] ?? null,
        set: () => undefined,
        click: (btn, shift) => {
          const ui = this.ui;
          // Clicking the palette while holding something throws it away.
          if (ui.cursor) { ui.cursor = null; return true; }
          const item = this.palette[this.page * CreativeScreen.PER_PAGE + k];
          if (!item) return true;
          const stack = cloneStack(item)!;
          stack.count = btn === 'right' ? 1 : maxStackSize(stack);
          if (shift) inv.addItem(stack); else ui.cursor = stack;
          return true;
        },
      });
    }
    for (let col = 0; col < 9; col++) {
      this.slots.push({ x: 8 + col * 18, y: 128, get: () => inv.get(col), set: (st) => inv.set(col, st), group: 'hotbar' });
    }
    const pages = Math.ceil(this.palette.length / CreativeScreen.PER_PAGE);
    const nav = el('div', '', this.panel);
    Object.assign(nav.style, { position: 'absolute', left: '8px', top: '108px', width: '160px', height: '14px' });
    const prev = button(nav, '<', () => { this.page = (this.page + pages - 1) % pages; this.updatePage(pages); }, 20);
    Object.assign(prev.style, { position: 'absolute', left: '0', top: '0', height: '14px', lineHeight: '12px' });
    const next = button(nav, '>', () => { this.page = (this.page + 1) % pages; this.updatePage(pages); }, 20);
    Object.assign(next.style, { position: 'absolute', right: '0', top: '0', height: '14px', lineHeight: '12px' });
    this.pageLabel = el('div', 'label', nav);
    Object.assign(this.pageLabel.style, { left: '56px', top: '2px' });
    this.updatePage(pages);
  }

  private updatePage(pages: number): void {
    if (this.pageLabel) this.pageLabel.textContent = `Page ${this.page + 1} / ${pages}`;
    this.refresh();
  }

  protected shiftTargets(_stack: ItemStack, group: string): string[] {
    return group === 'hotbar' ? [] : ['hotbar'];
  }
}

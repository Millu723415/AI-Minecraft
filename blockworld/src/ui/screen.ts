/** Base classes for UI screens and slot-based container screens. */

import { clickSlot, takeFromOutput, slotAccepts, type ClickButton, type SlotRules } from '../items/slotlogic';
import { canMerge, cloneStack, isEmpty, maxStackSize, type ItemStack } from '../items/stack';
import { el } from './dom';
import { packActive, packCanvas, packImage } from '../render/pack';
import { ItemView, renderTooltip } from './itemview';
import type { UIManager } from './manager';

export abstract class Screen {
  readonly root: HTMLDivElement;
  /** Single-player time stops while this screen is open. */
  pausesGame = false;
  /** ESC (or the inventory key for containers) closes it. */
  closable = true;
  /** Needs the mouse (pointer lock released). */
  wantsCursor = true;
  ui!: UIManager;

  constructor(cls = 'screen') {
    this.root = document.createElement('div');
    this.root.className = cls;
  }

  onOpen(): void {}
  onClose(): void {}
  update(_dt: number): void {}
  /** Return true if the key was consumed. */
  onKey(_code: string): boolean {
    return false;
  }
}

export interface SlotDef {
  x: number;
  y: number;
  get(): ItemStack | null;
  set(s: ItemStack | null): void;
  rules?: SlotRules;
  /** Output slots use take-only semantics and a callback when taken. */
  output?: (taken: ItemStack, shift: boolean) => void;
  group: string;
  big?: boolean;
  /** Faint background icon when empty (armor slots). */
  ghost?: HTMLCanvasElement;
  /** Custom click behaviour (creative palette); return true when handled. */
  click?: (button: ClickButton, shift: boolean) => boolean;
}

export abstract class ContainerScreen extends Screen {
  protected panel!: HTMLDivElement;
  protected slots: SlotDef[] = [];
  private views: ItemView[] = [];
  private slotEls: HTMLDivElement[] = [];
  private hoverIndex = -1;
  private tooltip!: HTMLDivElement;

  constructor(readonly panelWidth: number, readonly panelHeight: number) {
    super('screen dim');
    this.wantsCursor = true;
  }

  /** Subclasses add slots and decorations here. */
  protected abstract build(): void;

  /**
   * Resource-pack GUI texture for this screen: file, rectangles of the
   * texture to stack vertically ([sx, sy, w, h]) and areas to blank out
   * (slots of features that do not exist in this game).
   */
  protected packBackground(): { path: string; parts?: [number, number, number, number][]; cover?: [number, number, number, number][] } | null {
    return null;
  }

  /** True when the screen is drawn on a resource-pack GUI texture. */
  protected get textured(): boolean {
    return packActive() && !!this.packBackground() && !!packImage(this.packBackground()!.path);
  }

  /** CSS background for a sprite from the pack. */
  protected sprite(path: string): string | null {
    const c = packCanvas(path);
    return c ? `url(${c.toDataURL()})` : null;
  }

  private applyPackBackground(): void {
    const bg = this.packBackground();
    const img = bg ? packImage(bg.path) : undefined;
    if (!bg || !img || !packActive()) return;
    const c = document.createElement('canvas');
    c.width = this.panelWidth; c.height = this.panelHeight;
    const g = c.getContext('2d')!;
    const src = packCanvas(bg.path)!;
    let y = 0;
    for (const [sx, sy, w, h] of bg.parts ?? [[0, 0, this.panelWidth, this.panelHeight]]) {
      g.drawImage(src, sx, sy, w, h, 0, y, w, h);
      y += h;
    }
    g.fillStyle = 'rgb(198,198,198)';
    for (const [x, yy, w, h] of bg.cover ?? []) g.fillRect(x, yy, w, h);
    this.panel.classList.add('textured');
    this.panel.style.backgroundImage = `url(${c.toDataURL()})`;
  }

  /** Groups to try, in order, when shift-clicking a slot of `group`. */
  protected abstract shiftTargets(stack: ItemStack, group: string): string[];

  override onOpen(): void {
    this.root.textContent = '';
    const wrap = el('div', '', this.root);
    wrap.style.position = 'absolute';
    wrap.style.left = '50%';
    wrap.style.top = '50%';
    wrap.style.marginLeft = `${-this.panelWidth / 2}px`;
    wrap.style.marginTop = `${-this.panelHeight / 2}px`;
    this.panel = el('div', 'panel', wrap);
    this.panel.style.width = `${this.panelWidth}px`;
    this.panel.style.height = `${this.panelHeight}px`;
    this.slots = [];
    this.applyPackBackground();
    this.build();
    this.views = [];
    this.slotEls = [];
    this.slots.forEach((s, i) => {
      const se = el('div', `slot${s.big ? ' big' : ''}`, this.panel);
      se.style.left = `${s.x - (s.big ? 4 : 0)}px`;
      se.style.top = `${s.y - (s.big ? 4 : 0)}px`;
      if (s.ghost) {
        const g = el('canvas', 'ghost', se) as HTMLCanvasElement;
        g.width = 16; g.height = 16;
        g.getContext('2d')!.drawImage(s.ghost, 0, 0, 16, 16);
        if (s.big) { g.style.left = '4px'; g.style.top = '4px'; }
      }
      const v = new ItemView(se);
      se.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.onSlotClick(i, e.button === 2 ? 'right' : 'left', e.shiftKey);
      });
      se.addEventListener('mouseenter', () => { this.hoverIndex = i; });
      se.addEventListener('mouseleave', () => { if (this.hoverIndex === i) this.hoverIndex = -1; });
      se.addEventListener('contextmenu', (e) => e.preventDefault());
      this.views.push(v);
      this.slotEls.push(se);
    });
    // Clicking outside the panel drops the cursor stack.
    this.root.addEventListener('mousedown', (e) => {
      if (e.target !== this.root) return;
      this.dropCursor(e.button === 2);
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.tooltip = el('div', 'tooltip', this.root);
    this.tooltip.style.display = 'none';
    this.refresh();
  }

  protected label(text: string, x: number, y: number): HTMLDivElement {
    const l = el('div', 'label', this.panel, text);
    l.style.left = `${x}px`;
    l.style.top = `${y}px`;
    return l;
  }

  /** Standard 27 + 9 player inventory at the given offset. */
  protected addPlayerInventory(ox: number, oy: number): void {
    const inv = this.ui.host.player.inventory;
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 9; col++) {
        const idx = 9 + row * 9 + col;
        this.slots.push({ x: ox + col * 18, y: oy + row * 18, get: () => inv.get(idx), set: (s) => inv.set(idx, s), group: 'main' });
      }
    }
    for (let col = 0; col < 9; col++) {
      this.slots.push({ x: ox + col * 18, y: oy + 58, get: () => inv.get(col), set: (s) => inv.set(col, s), group: 'hotbar' });
    }
  }

  private onSlotClick(i: number, button: ClickButton, shift: boolean): void {
    const s = this.slots[i];
    const ui = this.ui;
    if (s.click && s.click(button, shift)) {
      this.refresh();
      return;
    }
    if (s.output) {
      const out = s.get();
      if (isEmpty(out)) return;
      if (shift) {
        const stack = cloneStack(out)!;
        if (!this.moveToGroups(stack, this.shiftTargets(stack, s.group), true)) return;
        s.output(stack, true);
      } else {
        const merged = takeFromOutput(out, ui.cursor);
        if (!merged) return;
        ui.cursor = merged;
        s.output(cloneStack(out)!, false);
      }
      this.refresh();
      return;
    }
    if (shift) {
      const stack = s.get();
      if (isEmpty(stack)) return;
      const copy = cloneStack(stack)!;
      this.moveToGroups(copy, this.shiftTargets(copy, s.group), false);
      s.set(copy.count > 0 ? copy : null);
      this.onSlotsChanged();
      this.refresh();
      return;
    }
    const r = clickSlot(s.get(), ui.cursor, button, s.rules);
    s.set(r.slot);
    ui.cursor = r.cursor;
    this.onSlotsChanged();
    this.refresh();
  }

  /**
   * Move `stack` into slots of the given groups (merging first). Mutates the
   * stack count. With `all` it must fit completely or nothing moves.
   */
  protected moveToGroups(stack: ItemStack, groups: string[], all: boolean): boolean {
    const targets = groups.flatMap((g) => this.slots.filter((s) => s.group === g && !s.output));
    if (all) {
      // Check capacity first.
      let room = 0;
      for (const t of targets) {
        if (!slotAccepts(t.rules, stack)) continue;
        const cur = t.get();
        const limit = Math.min(maxStackSize(stack), t.rules?.maxStack ?? 64);
        if (isEmpty(cur)) room += limit;
        else if (canMerge(cur, stack)) room += Math.max(0, limit - cur!.count);
      }
      if (room < stack.count) return false;
    }
    for (const pass of [0, 1]) {
      for (const t of targets) {
        if (stack.count <= 0) break;
        if (!slotAccepts(t.rules, stack)) continue;
        const cur = t.get();
        const limit = Math.min(maxStackSize(stack), t.rules?.armorSlot !== undefined ? 1 : t.rules?.maxStack ?? 64);
        if (pass === 0 && !isEmpty(cur) && canMerge(cur, stack) && cur!.count < limit) {
          const move = Math.min(limit - cur!.count, stack.count);
          cur!.count += move;
          stack.count -= move;
          t.set(cur);
        } else if (pass === 1 && isEmpty(cur)) {
          const move = Math.min(limit, stack.count);
          const placed = cloneStack(stack)!;
          placed.count = move;
          stack.count -= move;
          t.set(placed);
        }
      }
    }
    return stack.count <= 0;
  }

  private dropCursor(one: boolean): void {
    const ui = this.ui;
    if (!ui.cursor) return;
    if (one) {
      const drop = { ...ui.cursor, count: 1 };
      ui.cursor.count--;
      if (ui.cursor.count <= 0) ui.cursor = null;
      ui.host.dropItem(drop);
    } else {
      ui.host.dropItem(ui.cursor);
      ui.cursor = null;
    }
    this.refresh();
  }

  /** Called after slot contents changed (e.g. to recompute crafting output). */
  protected onSlotsChanged(): void {}

  refresh(): void {
    this.slots.forEach((s, i) => this.views[i]?.set(s.get()));
    this.ui.updateCursorView();
  }

  override update(_dt: number): void {
    this.refresh();
    const hi = this.hoverIndex;
    const stack = hi >= 0 ? this.slots[hi]?.get() : null;
    if (stack && !this.ui.cursor) {
      renderTooltip(this.tooltip, stack);
      this.tooltip.style.display = '';
      this.tooltip.style.left = `${this.ui.mouseX + 10}px`;
      this.tooltip.style.top = `${this.ui.mouseY - 14}px`;
    } else {
      this.tooltip.style.display = 'none';
    }
  }

  override onKey(code: string): boolean {
    // Number keys swap the hovered slot with a hotbar slot.
    if (code.startsWith('Digit') && this.hoverIndex >= 0) {
      const n = Number(code.slice(5)) - 1;
      if (n < 0 || n > 8) return false;
      const s = this.slots[this.hoverIndex];
      if (s.output) return true;
      const inv = this.ui.host.player.inventory;
      const a = s.get();
      const b = inv.get(n);
      if (b && !slotAccepts(s.rules, b)) return true;
      s.set(b);
      inv.set(n, a);
      this.onSlotsChanged();
      this.refresh();
      return true;
    }
    return false;
  }
}

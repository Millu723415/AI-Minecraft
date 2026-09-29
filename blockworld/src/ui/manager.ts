/**
 * UI manager: owns the scaled GUI root, the HUD, the active screen and the
 * cursor-held item stack shared by all container screens.
 */

import type { Player } from '../entity/player';
import type { ItemStack } from '../items/stack';
import type { Settings } from '../game/settings';
import { el } from './dom';
import { HUD } from './hud';
import { ItemView } from './itemview';
import type { Screen } from './screen';

export interface UIHost {
  readonly player: Player;
  readonly settings: Settings;
  /** Drop an item stack from the player into the world. */
  dropItem(stack: ItemStack): void;
  /** Called when the last screen closes (resume play, re-lock pointer). */
  onScreenClosed(): void;
  onScreenOpened(): void;
  onCrafted?(stack: ItemStack): void;
  onSmelted?(stack: ItemStack, tile: import('../world/tileentity').FurnaceTile): void;
  onChestOpen?(open: boolean): void;
  enchantSeed?(): number;
  onEnchanted?(): void;
}

export class UIManager {
  readonly gui: HTMLDivElement;
  readonly hudLayer: HTMLDivElement;
  readonly screenLayer: HTMLDivElement;
  readonly hud: HUD;
  scale = 2;
  screen: Screen | null = null;
  cursor: ItemStack | null = null;
  private cursorView: ItemView;
  private cursorEl: HTMLDivElement;
  mouseX = 0;
  mouseY = 0;
  host!: UIHost;
  width = 320;
  height = 240;

  constructor(readonly root: HTMLElement, private settings: () => Settings) {
    this.gui = el('div', 'gui', root);
    this.hudLayer = el('div', 'layer', this.gui);
    this.screenLayer = el('div', 'layer', this.gui);
    this.hud = new HUD(this.hudLayer);
    this.cursorEl = el('div', 'cursor-item', this.gui);
    this.cursorView = new ItemView(this.cursorEl);
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX / this.scale;
      this.mouseY = e.clientY / this.scale;
      this.cursorEl.style.left = `${this.mouseX - 8}px`;
      this.cursorEl.style.top = `${this.mouseY - 8}px`;
    });
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pref = this.settings().guiScale;
    let s = 1;
    while (s < 6 && w / (s + 1) >= 320 && h / (s + 1) >= 240) s++;
    if (pref > 0) s = Math.min(s, pref);
    this.scale = s;
    this.width = Math.floor(w / s);
    this.height = Math.floor(h / s);
    this.gui.style.width = `${this.width}px`;
    this.gui.style.height = `${this.height}px`;
    this.gui.style.transform = `scale(${s})`;
    this.hud.layout(this.width, this.height);
  }

  setHudVisible(v: boolean): void {
    this.hudLayer.style.display = v ? '' : 'none';
  }

  open(screen: Screen): void {
    if (this.screen) this.closeCurrent(false);
    screen.ui = this;
    this.screen = screen;
    this.screenLayer.appendChild(screen.root);
    screen.onOpen();
    this.host?.onScreenOpened();
  }

  /** Close the active screen. */
  close(): void {
    this.closeCurrent(true);
  }

  private closeCurrent(notify: boolean): void {
    const s = this.screen;
    if (!s) return;
    s.onClose();
    s.root.remove();
    this.screen = null;
    // The cursor stack goes back into the inventory (or is dropped).
    if (this.cursor && this.host) {
      const left = this.host.player.inventory.addItem(this.cursor);
      if (left) this.host.dropItem(left);
      this.cursor = null;
    }
    this.updateCursorView();
    if (notify) this.host?.onScreenClosed();
  }

  updateCursorView(): void {
    this.cursorView.set(this.cursor);
  }

  update(dt: number): void {
    this.screen?.update(dt);
  }

  /** Route a key press to the screen. Returns true if consumed. */
  onKey(code: string): boolean {
    return this.screen ? this.screen.onKey(code) : false;
  }
}

/** In-game heads-up display: hotbar, hearts, hunger, armor, XP, boss bar. */

import { itemDisplayName } from '../items/registry';
import { EFFECT_NAMES, Effect } from '../entity/effects';
import type { Player } from '../entity/player';
import { el } from './dom';
import { hudIcons } from './hudicons';
import { ItemView } from './itemview';
import { fireCanvas } from '../render/firetex';

export interface BossInfo { name: string; health: number; maxHealth: number }

function icon(parent: HTMLElement, x: number, y: number): HTMLCanvasElement {
  const c = el('canvas', 'icon9', parent) as HTMLCanvasElement;
  c.width = 9;
  c.height = 9;
  c.style.left = `${x}px`;
  c.style.top = `${y}px`;
  return c;
}

function paint(c: HTMLCanvasElement, ...layers: (HTMLCanvasElement | null)[]): void {
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 9, 9);
  for (const l of layers) if (l) ctx.drawImage(l, 0, 0);
}

export class HUD {
  readonly root: HTMLDivElement;
  private crosshair: HTMLDivElement;
  private hotbar: HTMLDivElement;
  private hotbarViews: ItemView[] = [];
  private select: HTMLDivElement;
  private hearts: HTMLCanvasElement[] = [];
  private shanks: HTMLCanvasElement[] = [];
  private armor: HTMLCanvasElement[] = [];
  private bubbles: HTMLCanvasElement[] = [];
  private heartsRow: HTMLDivElement;
  private foodRow: HTMLDivElement;
  private armorRow: HTMLDivElement;
  private airRow: HTMLDivElement;
  private xpBar: HTMLDivElement;
  private xpFill: HTMLDivElement;
  private xpLevel: HTMLDivElement;
  private heldName: HTMLDivElement;
  private heldTimer = 0;
  private lastHeldKey = '';
  private boss: HTMLDivElement;
  private bossFill: HTMLDivElement;
  private bossName: HTMLDivElement;
  private messages: HTMLDivElement;
  private msgList: { el: HTMLDivElement; time: number }[] = [];
  readonly debug: HTMLDivElement;
  private effects: HTMLDivElement;
  readonly hurt: HTMLDivElement;
  readonly portal: HTMLDivElement;
  readonly sleep: HTMLDivElement;
  private burn: HTMLDivElement;
  private lastHealth = 20;
  private flashTicks = 0;
  private tick = 0;
  width = 320;
  height = 240;

  constructor(parent: HTMLElement) {
    this.root = el('div', 'hud', parent);
    el('div', 'vignette', this.root);
    this.hurt = el('div', 'hurt-flash', this.root);
    this.portal = el('div', 'portal-overlay', this.root);
    this.sleep = el('div', 'sleep-overlay', this.root);
    this.burn = el('div', 'burn-overlay', this.root);
    this.burn.style.backgroundImage = `url(${fireCanvas().toDataURL()})`;
    this.crosshair = el('div', 'crosshair', this.root);
    this.hotbar = el('div', 'hotbar', this.root);
    for (let i = 0; i < 9; i++) {
      const s = el('div', 'hslot', this.hotbar);
      s.style.left = `${2 + i * 20}px`;
      this.hotbarViews.push(new ItemView(s));
    }
    this.select = el('div', 'hotbar-select', this.hotbar);
    this.heartsRow = el('div', 'statrow', this.root);
    this.foodRow = el('div', 'statrow', this.root);
    this.armorRow = el('div', 'statrow', this.root);
    this.airRow = el('div', 'statrow', this.root);
    for (let i = 0; i < 10; i++) {
      this.hearts.push(icon(this.heartsRow, i * 8, 0));
      this.shanks.push(icon(this.foodRow, 81 - 9 - i * 8, 0));
      this.armor.push(icon(this.armorRow, i * 8, 0));
      this.bubbles.push(icon(this.airRow, 81 - 9 - i * 8, 0));
    }
    this.xpBar = el('div', 'xpbar', this.root);
    this.xpFill = el('div', '', this.xpBar);
    this.xpLevel = el('div', 'xplevel', this.root);
    this.heldName = el('div', 'helditem-name', this.root);
    this.boss = el('div', 'bossbar', this.root);
    this.bossFill = el('div', '', this.boss);
    this.bossName = el('div', 'bossname', this.root);
    this.messages = el('div', 'messages', this.root);
    this.debug = el('div', 'debug-overlay', this.root);
    this.effects = el('div', 'effects', this.root);
  }

  layout(w: number, h: number): void {
    this.width = w;
    this.height = h;
    const cx = Math.floor(w / 2);
    this.crosshair.style.left = `${cx - 4}px`;
    this.crosshair.style.top = `${Math.floor(h / 2) - 4}px`;
    this.hotbar.style.left = `${cx - 91}px`;
    this.hotbar.style.top = `${h - 22}px`;
    this.xpBar.style.left = `${cx - 91}px`;
    this.xpBar.style.top = `${h - 29}px`;
    this.heartsRow.style.left = `${cx - 91}px`;
    this.heartsRow.style.top = `${h - 39}px`;
    this.armorRow.style.left = `${cx - 91}px`;
    this.armorRow.style.top = `${h - 49}px`;
    this.foodRow.style.left = `${cx + 91 - 81}px`;
    this.foodRow.style.top = `${h - 39}px`;
    this.airRow.style.left = `${cx + 91 - 81}px`;
    this.airRow.style.top = `${h - 49}px`;
    this.heldName.style.left = `${cx - 150}px`;
    this.heldName.style.top = `${h - 59}px`;
    this.boss.style.left = `${cx - 91}px`;
    this.boss.style.top = '14px';
    this.bossName.style.left = `${cx - 91}px`;
    this.bossName.style.top = '4px';
    this.messages.style.bottom = '48px';
  }

  message(text: string): void {
    const d = el('div', '', this.messages, text);
    this.msgList.unshift({ el: d, time: performance.now() });
    if (this.msgList.length > 10) this.msgList.pop()!.el.remove();
  }

  update(p: Player, boss: BossInfo | null, showCrosshair: boolean): void {
    this.tick++;
    const icons = hudIcons();
    const creative = p.creative;
    const burning = p.fireTicks > 0 && !creative && !p.hasEffect(Effect.FIRE_RESISTANCE);
    this.burn.style.display = burning ? '' : 'none';
    if (burning) this.burn.style.backgroundPositionX = `${(this.tick >> 2) % 2 ? 0 : 50}%`;
    this.crosshair.style.display = showCrosshair ? '' : 'none';
    // Hotbar.
    for (let i = 0; i < 9; i++) this.hotbarViews[i].set(p.inventory.get(i));
    this.select.style.left = `${-1 + p.inventory.selected * 20}px`;
    // Held item name fades after a couple of seconds.
    const held = p.inventory.held;
    const key = held ? `${held.id}:${held.meta}:${p.inventory.selected}` : `none:${p.inventory.selected}`;
    if (key !== this.lastHeldKey) {
      this.lastHeldKey = key;
      this.heldTimer = held ? 120 : 0;
      this.heldName.textContent = held ? itemDisplayName(held.id, held.meta) : '';
    }
    if (this.heldTimer > 0) this.heldTimer--;
    this.heldName.style.opacity = String(Math.min(1, this.heldTimer / 20));

    const survivalVisible = !creative;
    this.heartsRow.style.display = survivalVisible ? '' : 'none';
    this.foodRow.style.display = survivalVisible ? '' : 'none';
    this.xpBar.style.display = survivalVisible ? '' : 'none';
    this.xpLevel.style.display = survivalVisible && p.xpLevel > 0 ? '' : 'none';

    // Hearts with damage flash and low-health jitter.
    const hp = Math.ceil(p.health);
    if (hp < this.lastHealth) this.flashTicks = 10;
    this.lastHealth = hp;
    if (this.flashTicks > 0) this.flashTicks--;
    const poisoned = p.hasEffect(Effect.POISON);
    for (let i = 0; i < 10; i++) {
      const c = this.hearts[i];
      const v = hp - i * 2;
      const full = poisoned ? icons.heartPoisonFull : icons.heartFull;
      const half = poisoned ? icons.heartPoisonHalf : icons.heartHalf;
      paint(c, this.flashTicks > 0 && Math.floor(this.flashTicks / 3) % 2 === 0 ? icons.heartFlash : icons.heartEmpty, v >= 2 ? full : v === 1 ? half : null);
      const jitter = hp <= 4 && this.tick % 2 === 0 ? ((i * 7 + this.tick) % 3) - 1 : 0;
      c.style.top = `${jitter}px`;
    }
    // Food.
    const hunger = p.hasEffect(Effect.HUNGER);
    for (let i = 0; i < 10; i++) {
      const v = p.foodLevel - i * 2;
      const jitter = p.saturation <= 0 && this.tick % (p.foodLevel * 3 + 1) === 0 ? (i % 2 ? 1 : -1) : 0;
      paint(this.shanks[i], icons.shankEmpty, v >= 2 ? (hunger ? icons.shankHungerFull : icons.shankFull) : v === 1 ? (hunger ? icons.shankHungerHalf : icons.shankHalf) : null);
      this.shanks[i].style.top = `${jitter}px`;
    }
    // Armor.
    const armor = p.armorValue();
    this.armorRow.style.display = armor > 0 && survivalVisible ? '' : 'none';
    for (let i = 0; i < 10; i++) {
      const v = armor - i * 2;
      paint(this.armor[i], v >= 2 ? icons.armorFull : v === 1 ? icons.armorHalf : icons.armorEmpty);
    }
    // Air.
    const underwater = p.isEyeInWater();
    this.airRow.style.display = underwater && survivalVisible ? '' : 'none';
    if (underwater) {
      const full = Math.ceil(((p.air - 2) * 10) / 300);
      const partial = Math.ceil((p.air * 10) / 300) - full;
      for (let i = 0; i < 10; i++) {
        paint(this.bubbles[i], i < full ? icons.bubble : i < full + partial ? icons.bubblePop : null);
      }
    }
    // XP.
    this.xpFill.style.width = `${Math.floor(p.xpProgress * 180)}px`;
    this.xpLevel.textContent = String(p.xpLevel);
    const lw = String(p.xpLevel).length * 6;
    this.xpLevel.style.left = `${Math.floor(this.width / 2 - lw / 2)}px`;
    this.xpLevel.style.top = `${this.height - 35}px`;
    // Boss.
    this.boss.style.display = boss ? '' : 'none';
    this.bossName.style.display = boss ? '' : 'none';
    if (boss) {
      this.bossFill.style.width = `${Math.max(0, Math.floor((boss.health / boss.maxHealth) * 182))}px`;
      this.bossName.textContent = boss.name;
    }
    // Messages fade.
    const now = performance.now();
    for (const m of this.msgList) {
      const age = (now - m.time) / 1000;
      m.el.style.opacity = String(age < 8 ? 1 : Math.max(0, 1 - (age - 8)));
    }
    // Effects.
    const effectText = Array.from(p.effects.values()).map((e) => {
      const secs = Math.floor(e.duration / 20);
      return `${EFFECT_NAMES[e.id] ?? 'Effect'}${e.amplifier > 0 ? ' II' : ''} ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
    });
    if (this.effects.childElementCount !== effectText.length) {
      this.effects.textContent = '';
      for (const t of effectText) el('div', '', this.effects, t);
    } else {
      effectText.forEach((t, i) => { (this.effects.children[i] as HTMLElement).textContent = t; });
    }
  }
}

/** DOM rendering of an item stack (icon, count, durability, glint) and tooltips. */

import { getItem, itemDisplayName } from '../items/registry';
import { enchantName } from '../items/enchantments';
import type { ItemStack } from '../items/stack';
import { iconCanvas } from './icons';
import { el } from './dom';
import { ItemId } from '../items/ids';
import { potionEffects } from '../entity/projectiles';
import { EFFECT_NAMES } from '../entity/effects';

export class ItemView {
  readonly root: HTMLDivElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly count: HTMLDivElement;
  private readonly dur: HTMLDivElement;
  private readonly durFill: HTMLDivElement;
  private key = '';

  constructor(parent: HTMLElement) {
    this.root = el('div', 'item', parent);
    this.canvas = el('canvas', '', this.root);
    this.canvas.width = 32;
    this.canvas.height = 32;
    this.count = el('div', 'count', this.root);
    this.dur = el('div', 'dur', this.root);
    this.durFill = el('div', '', this.dur);
    this.set(null);
  }

  set(stack: ItemStack | null): void {
    const key = stack ? `${stack.id}:${stack.meta}:${stack.count}:${stack.damage}:${stack.ench?.length ?? 0}` : '';
    if (key === this.key) return;
    this.key = key;
    const ctx = this.canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 32, 32);
    if (!stack) {
      this.root.style.display = 'none';
      return;
    }
    this.root.style.display = '';
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(iconCanvas(stack.id, stack.meta), 0, 0);
    this.count.textContent = stack.count > 1 ? String(stack.count) : '';
    const def = getItem(stack.id);
    if (def && def.durability > 0 && stack.damage > 0) {
      const f = 1 - stack.damage / def.durability;
      this.dur.style.display = '';
      this.durFill.style.width = `${Math.round(f * 13)}px`;
      const r = Math.round(255 * (1 - f));
      const g = Math.round(255 * f);
      this.durFill.style.background = `rgb(${r},${g},0)`;
    } else {
      this.dur.style.display = 'none';
    }
    this.root.classList.toggle('glint', !!stack.ench && stack.ench.length > 0 || (stack.id === ItemId.GOLDEN_APPLE));
  }
}

/** Multi-line tooltip text for an item. */
export function tooltipText(stack: ItemStack): string {
  const lines = [itemDisplayName(stack.id, stack.meta)];
  if (stack.ench) for (const e of stack.ench) lines.push(`\u0000${enchantName(e)}`);
  if (stack.id === ItemId.POTION) {
    for (const e of potionEffects(stack.meta)) {
      const secs = Math.floor(e.duration / 20);
      const time = e.duration > 20 ? ` (${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')})` : '';
      lines.push(`\u0001${EFFECT_NAMES[e.id]}${e.amplifier > 0 ? ' II' : ''}${time}`);
    }
  }
  const def = getItem(stack.id);
  if (def && def.durability > 0 && stack.damage > 0) lines.push(`\u0002Durability: ${def.durability - stack.damage} / ${def.durability}`);
  return lines.join('\n');
}

export function renderTooltip(target: HTMLElement, stack: ItemStack): void {
  target.textContent = '';
  const lines = tooltipText(stack).split('\n');
  lines.forEach((line, i) => {
    const d = el('div', '', target);
    if (line.startsWith('\u0000')) { d.style.color = '#a8a8a8'; d.textContent = line.slice(1); }
    else if (line.startsWith('\u0001')) { d.style.color = '#5555ff'; d.textContent = line.slice(1); }
    else if (line.startsWith('\u0002')) { d.style.color = '#a8a8a8'; d.textContent = line.slice(1); }
    else { d.textContent = line; if (i === 0 && stack.ench?.length) d.style.color = '#55ffff'; }
  });
}

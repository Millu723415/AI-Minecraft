/**
 * Containers are fixed-size arrays of item stacks. Player inventories, chests,
 * furnaces, crafting grids and brewing stands all use this one abstraction so
 * the slot interaction logic only has to be written once.
 */

import { canMerge, cloneStack, isEmpty, maxStackSize, type ItemStack } from './stack';

export class Container {
  readonly slots: (ItemStack | null)[];
  private listeners: (() => void)[] = [];

  constructor(readonly size: number) {
    this.slots = new Array(size).fill(null);
  }

  get(index: number): ItemStack | null {
    return this.slots[index] ?? null;
  }

  set(index: number, stack: ItemStack | null): void {
    this.slots[index] = isEmpty(stack) ? null : stack;
    this.changed();
  }

  onChange(listener: () => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }

  changed(): void {
    for (const l of this.listeners) l();
  }

  clear(): void {
    this.slots.fill(null);
    this.changed();
  }

  isEmpty(): boolean {
    return this.slots.every((s) => isEmpty(s));
  }

  /**
   * Insert a stack into the given slot range, merging first then using empty
   * slots. Returns the leftover (or null if everything fit). The input stack
   * is not mutated.
   */
  insert(stack: ItemStack, from = 0, to = this.size): ItemStack | null {
    const remaining = cloneStack(stack)!;
    const max = maxStackSize(remaining);
    // Pass 1: merge into partial stacks.
    for (let i = from; i < to && remaining.count > 0; i++) {
      const slot = this.slots[i];
      if (slot && canMerge(slot, remaining) && slot.count < max) {
        const move = Math.min(max - slot.count, remaining.count);
        slot.count += move;
        remaining.count -= move;
      }
    }
    // Pass 2: fill empty slots.
    for (let i = from; i < to && remaining.count > 0; i++) {
      if (isEmpty(this.slots[i])) {
        const move = Math.min(max, remaining.count);
        const placed = cloneStack(remaining)!;
        placed.count = move;
        this.slots[i] = placed;
        remaining.count -= move;
      }
    }
    this.changed();
    return remaining.count > 0 ? remaining : null;
  }

  /** Count items matching id (and meta when given). */
  count(id: number, meta?: number): number {
    let total = 0;
    for (const s of this.slots) {
      if (s && s.id === id && (meta === undefined || s.meta === meta)) total += s.count;
    }
    return total;
  }

  /** Remove up to `amount` of an item. Returns the amount removed. */
  remove(id: number, amount: number, meta?: number): number {
    let removed = 0;
    for (let i = 0; i < this.size && removed < amount; i++) {
      const s = this.slots[i];
      if (s && s.id === id && (meta === undefined || s.meta === meta)) {
        const take = Math.min(s.count, amount - removed);
        s.count -= take;
        removed += take;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    if (removed > 0) this.changed();
    return removed;
  }

  toJSON(): (ItemStack | null)[] {
    return this.slots.map((s) => cloneStack(s));
  }

  load(data: (ItemStack | null)[] | undefined): void {
    this.slots.fill(null);
    if (data) {
      for (let i = 0; i < Math.min(this.size, data.length); i++) {
        const s = data[i];
        this.slots[i] = s && s.count > 0 ? { id: s.id, count: s.count, meta: s.meta ?? 0, damage: s.damage ?? 0, ench: s.ench } : null;
      }
    }
    this.changed();
  }
}

/** Player inventory: 0-8 hotbar, 9-35 main storage, plus 4 armor slots. */
export class PlayerInventory extends Container {
  static readonly HOTBAR = 9;
  static readonly MAIN = 36;
  readonly armor = new Container(4); // 0 helmet .. 3 boots
  selected = 0;

  constructor() {
    super(36);
  }

  get held(): ItemStack | null {
    return this.get(this.selected);
  }

  set held(stack: ItemStack | null) {
    this.set(this.selected, stack);
  }

  /** Picking up: hotbar first, then main inventory (classic behaviour). */
  addItem(stack: ItemStack): ItemStack | null {
    const copy = cloneStack(stack)!;
    // Merge anywhere first so partial stacks fill up before new slots.
    const max = maxStackSize(copy);
    for (let i = 0; i < 36 && copy.count > 0; i++) {
      const slot = this.slots[i];
      if (slot && canMerge(slot, copy) && slot.count < max) {
        const move = Math.min(max - slot.count, copy.count);
        slot.count += move;
        copy.count -= move;
      }
    }
    for (let i = 0; i < 36 && copy.count > 0; i++) {
      if (isEmpty(this.slots[i])) {
        const move = Math.min(max, copy.count);
        const placed = cloneStack(copy)!;
        placed.count = move;
        this.slots[i] = placed;
        copy.count -= move;
      }
    }
    this.changed();
    return copy.count > 0 ? copy : null;
  }

  canFit(stack: ItemStack): boolean {
    const max = maxStackSize(stack);
    let room = 0;
    for (let i = 0; i < 36; i++) {
      const s = this.slots[i];
      if (isEmpty(s)) room += max;
      else if (canMerge(s, stack)) room += max - s!.count;
      if (room >= stack.count) return true;
    }
    return room >= stack.count;
  }

  /** Consume one of the held item (non-creative placement / eating). */
  consumeHeld(amount = 1): void {
    const h = this.held;
    if (!h) return;
    h.count -= amount;
    if (h.count <= 0) this.slots[this.selected] = null;
    this.changed();
  }

  /** Total armor points (half-icons) from equipped pieces. */
  armorPoints(armorOf: (id: number) => number): number {
    let total = 0;
    for (const s of this.armor.slots) if (s) total += armorOf(s.id);
    return total;
  }

  override toJSON(): (ItemStack | null)[] {
    return super.toJSON();
  }
}

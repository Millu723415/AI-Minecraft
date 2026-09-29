/**
 * Classic inventory click semantics, written as pure functions over a
 * (slot, cursor) pair so they can be unit tested without any UI.
 */

import { getItem, type ArmorSlot } from './registry';
import { canMerge, cloneStack, isEmpty, maxStackSize, type ItemStack } from './stack';

export type ClickButton = 'left' | 'right';

export interface SlotRules {
  /** Output slots can only be taken from, never placed into. */
  outputOnly?: boolean;
  /** Only accept armor for the given slot. */
  armorSlot?: ArmorSlot;
  /** Custom acceptance filter. */
  accepts?: (stack: ItemStack) => boolean;
  /** Maximum stack size for this slot (brewing bottles = 1). */
  maxStack?: number;
}

export interface ClickResult {
  slot: ItemStack | null;
  cursor: ItemStack | null;
}

export function slotAccepts(rules: SlotRules | undefined, stack: ItemStack): boolean {
  if (!rules) return true;
  if (rules.outputOnly) return false;
  if (rules.armorSlot !== undefined) {
    const def = getItem(stack.id);
    if (!def || def.armorSlot !== rules.armorSlot) {
      // Pumpkins may be worn on the head in the classic game.
      if (!(rules.armorSlot === 0 && stack.id === 86)) return false;
    }
  }
  if (rules.accepts && !rules.accepts(stack)) return false;
  return true;
}

function limitFor(rules: SlotRules | undefined, stack: ItemStack): number {
  const itemMax = maxStackSize(stack);
  const slotMax = rules?.armorSlot !== undefined ? 1 : rules?.maxStack ?? 64;
  return Math.min(itemMax, slotMax);
}

/** Apply a normal (non-output) slot click and return the new slot and cursor. */
export function clickSlot(
  slotIn: ItemStack | null,
  cursorIn: ItemStack | null,
  button: ClickButton,
  rules?: SlotRules,
): ClickResult {
  const slot = cloneStack(isEmpty(slotIn) ? null : slotIn);
  const cursor = cloneStack(isEmpty(cursorIn) ? null : cursorIn);

  if (!cursor) {
    if (!slot) return { slot: null, cursor: null };
    if (button === 'left') return { slot: null, cursor: slot };
    // Right click on a stack with an empty cursor picks up half (rounded up).
    const take = Math.ceil(slot.count / 2);
    const picked = { ...slot, count: take };
    const rest = slot.count - take;
    return { slot: rest > 0 ? { ...slot, count: rest } : null, cursor: picked };
  }

  if (!slotAccepts(rules, cursor)) {
    return { slot, cursor };
  }
  const limit = limitFor(rules, cursor);

  if (!slot) {
    if (button === 'left') {
      const move = Math.min(limit, cursor.count);
      const placed = { ...cursor, count: move };
      const left = cursor.count - move;
      return { slot: placed, cursor: left > 0 ? { ...cursor, count: left } : null };
    }
    const placed = { ...cursor, count: 1 };
    const left = cursor.count - 1;
    return { slot: placed, cursor: left > 0 ? { ...cursor, count: left } : null };
  }

  if (canMerge(slot, cursor)) {
    if (button === 'left') {
      const move = Math.min(limit - slot.count, cursor.count);
      if (move <= 0) return { slot, cursor };
      slot.count += move;
      cursor.count -= move;
      return { slot, cursor: cursor.count > 0 ? cursor : null };
    }
    if (slot.count >= limit) return { slot, cursor };
    slot.count += 1;
    cursor.count -= 1;
    return { slot, cursor: cursor.count > 0 ? cursor : null };
  }

  // Different items: swap (only if the cursor stack fits the slot limit).
  if (cursor.count <= limit) return { slot: cursor, cursor: slot };
  return { slot, cursor };
}

/**
 * Taking from an output slot (crafting result / furnace output). The whole
 * result is taken; if the cursor already holds the same item it is added when
 * there is room. Returns null when nothing could be taken.
 */
export function takeFromOutput(output: ItemStack | null, cursorIn: ItemStack | null): ItemStack | null {
  if (isEmpty(output)) return null;
  const cursor = cloneStack(isEmpty(cursorIn) ? null : cursorIn);
  if (!cursor) return cloneStack(output);
  if (!canMerge(cursor, output)) return null;
  if (cursor.count + output!.count > maxStackSize(cursor)) return null;
  cursor.count += output!.count;
  return cursor;
}

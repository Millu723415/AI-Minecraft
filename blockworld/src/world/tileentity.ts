/** Block entities: per-position state for chests, furnaces, spawners, etc. */

import { Container } from '../items/container';
import type { ItemStack } from '../items/stack';

export type TileKind = 'chest' | 'furnace' | 'brewing' | 'spawner' | 'sign' | 'note' | 'frame';

export interface TileBase {
  kind: TileKind;
  x: number;
  y: number;
  z: number;
}

export interface ChestTile extends TileBase {
  kind: 'chest';
  items: Container;
  /** Loot table id; loot is rolled lazily the first time the chest is opened. */
  loot?: string;
  lootSeed?: number;
}

export interface FurnaceTile extends TileBase {
  kind: 'furnace';
  items: Container; // 0 input, 1 fuel, 2 output
  burnTime: number;
  burnTotal: number;
  cookTime: number;
  storedXp: number;
}

export interface BrewingTile extends TileBase {
  kind: 'brewing';
  items: Container; // 0-2 bottles, 3 ingredient
  brewTime: number;
}

export interface SpawnerTile extends TileBase {
  kind: 'spawner';
  mob: string;
  delay: number;
}

export interface SignTile extends TileBase {
  kind: 'sign';
  lines: string[];
}

export interface NoteTile extends TileBase {
  kind: 'note';
  pitch: number;
}

export type TileEntity = ChestTile | FurnaceTile | BrewingTile | SpawnerTile | SignTile | NoteTile;

export function posKey(x: number, y: number, z: number): number {
  return ((x + 1048576) * 2097152 + (z + 1048576)) * 128 + y;
}

export function createTile(kind: TileKind, x: number, y: number, z: number): TileEntity {
  switch (kind) {
    case 'chest': return { kind, x, y, z, items: new Container(27) };
    case 'furnace': return { kind, x, y, z, items: new Container(3), burnTime: 0, burnTotal: 0, cookTime: 0, storedXp: 0 };
    case 'brewing': return { kind, x, y, z, items: new Container(4), brewTime: 0 };
    case 'spawner': return { kind, x, y, z, mob: 'zombie', delay: 200 };
    case 'sign': return { kind, x, y, z, lines: ['', '', '', ''] };
    case 'note': return { kind, x, y, z, pitch: 0 };
    default: throw new Error(`bad tile kind ${kind}`);
  }
}

export interface SerializedTile {
  kind: TileKind;
  x: number; y: number; z: number;
  items?: (ItemStack | null)[];
  [key: string]: unknown;
}

export function serializeTile(t: TileEntity): SerializedTile {
  const base: SerializedTile = { kind: t.kind, x: t.x, y: t.y, z: t.z };
  switch (t.kind) {
    case 'chest': return { ...base, items: t.items.toJSON(), loot: t.loot, lootSeed: t.lootSeed };
    case 'furnace': return { ...base, items: t.items.toJSON(), burnTime: t.burnTime, burnTotal: t.burnTotal, cookTime: t.cookTime, storedXp: t.storedXp };
    case 'brewing': return { ...base, items: t.items.toJSON(), brewTime: t.brewTime };
    case 'spawner': return { ...base, mob: t.mob, delay: t.delay };
    case 'sign': return { ...base, lines: t.lines.slice() };
    case 'note': return { ...base, pitch: t.pitch };
  }
}

export function deserializeTile(s: SerializedTile): TileEntity {
  const t = createTile(s.kind, s.x, s.y, s.z);
  switch (t.kind) {
    case 'chest':
      t.items.load(s.items);
      t.loot = s.loot as string | undefined;
      t.lootSeed = s.lootSeed as number | undefined;
      break;
    case 'furnace':
      t.items.load(s.items);
      t.burnTime = (s.burnTime as number) ?? 0;
      t.burnTotal = (s.burnTotal as number) ?? 0;
      t.cookTime = (s.cookTime as number) ?? 0;
      t.storedXp = (s.storedXp as number) ?? 0;
      break;
    case 'brewing':
      t.items.load(s.items);
      t.brewTime = (s.brewTime as number) ?? 0;
      break;
    case 'spawner':
      t.mob = (s.mob as string) ?? 'zombie';
      t.delay = (s.delay as number) ?? 200;
      break;
    case 'sign':
      t.lines = ((s.lines as string[]) ?? ['', '', '', '']).slice(0, 4);
      break;
    case 'note':
      t.pitch = (s.pitch as number) ?? 0;
      break;
  }
  return t;
}

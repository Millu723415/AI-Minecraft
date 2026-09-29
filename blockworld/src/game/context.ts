/**
 * The services entities and block behaviours may use. Implemented by Game;
 * keeping it an interface avoids import cycles and makes testing simpler.
 */

import type { Dimension } from '../world/dimension';
import type { ItemStack } from '../items/stack';
import type { Entity } from '../entity/entity';
import type { Player } from '../entity/player';
import type { World } from '../world/world';

export type ParticleKind =
  | 'block' | 'smoke' | 'flame' | 'explosion' | 'largeexplode' | 'splash' | 'bubble' | 'heart'
  | 'portal' | 'crit' | 'potion' | 'lava' | 'dripWater' | 'dripLava' | 'reddust' | 'snowball'
  | 'enchant' | 'note' | 'dragonbreath' | 'angry' | 'spell';

export interface ParticleOptions {
  blockId?: number;
  blockMeta?: number;
  color?: [number, number, number];
  spread?: number;
  speed?: number;
  vx?: number; vy?: number; vz?: number;
}

export interface GameContext {
  readonly world: World;
  readonly player: Player;
  /** 0 peaceful, 1 easy, 2 normal, 3 hard. */
  readonly difficulty: number;
  readonly tickCount: number;
  random(): number;
  playSound(name: string, x: number, y: number, z: number, volume?: number, pitch?: number): void;
  particles(kind: ParticleKind, dim: Dimension, x: number, y: number, z: number, count: number, opts?: ParticleOptions): void;
  explode(dim: Dimension, x: number, y: number, z: number, power: number, fire: boolean, source: Entity | null, breakBlocks?: boolean): void;
  dropStack(dim: Dimension, x: number, y: number, z: number, stack: ItemStack, pickupDelay?: number, scatter?: boolean): void;
  dropXp(dim: Dimension, x: number, y: number, z: number, amount: number): void;
  spawn(entity: Entity, dim: Dimension): void;
  entitiesIn(dim: Dimension): readonly Entity[];
  /** Skylight reduction at the current time (0 day .. 11 night). */
  skyDarken(): number;
  /** Change the dimension of an entity (portals). */
  travelTo(entity: Entity, dim: number): void;
  message(text: string): void;
}

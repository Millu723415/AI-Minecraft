/** Placeholder; the full redstone simulation is implemented later. */
import type { Dimension } from './dimension';
import type { GameContext } from '../game/context';

export class Redstone {
  constructor(readonly ctx: GameContext) {}
  tick(_d: Dimension): void {}
  onBlockChanged(_d: Dimension, _x: number, _y: number, _z: number, _o: number, _n: number): void {}
  onNeighborChanged(_d: Dimension, _x: number, _y: number, _z: number, _id: number, _m: number, _fx: number, _fy: number, _fz: number): void {}
  scheduledTick(_d: Dimension, _x: number, _y: number, _z: number, _id: number): void {}
  isPowered(_d: Dimension, _x: number, _y: number, _z: number): boolean { return false; }
}

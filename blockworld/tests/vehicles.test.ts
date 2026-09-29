import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks/ids';
import { RAIL_POWERED } from '../src/blocks/meta';
import { Player } from '../src/entity/player';
import { Boat, Minecart } from '../src/entity/vehicles';
import { createTestWorld } from './helpers/testworld';

// The test world is stone from y=1 to y=3 with its surface at y=4.

describe('boats', () => {
  it('float on water and follow the rider', () => {
    const { dim, ctx } = createTestWorld(1);
    for (let x = -6; x <= 6; x++) for (let z = -8; z <= 6; z++) {
      dim.setBlock(x, 3, z, BlockId.WATER, 0);
      dim.setBlock(x, 2, z, BlockId.WATER, 0);
    }
    const boat = new Boat();
    boat.dim = dim;
    boat.setPosition(0.5, 4.5, 0.5);
    for (let i = 0; i < 80; i++) boat.tick(ctx);
    // Rides on the surface of the pool (top of water at y=4).
    expect(boat.y).toBeGreaterThan(3.2);
    expect(boat.y).toBeLessThan(4.6);

    const p = new Player();
    p.dim = dim;
    p.setPosition(1.5, 4, 0.5);
    expect(boat.interact(ctx, p)).toBe(true);
    expect(p.vehicle).toBe(boat);
    p.yaw = 0; // facing -Z
    p.input.forward = 1;
    const z0 = boat.z;
    for (let i = 0; i < 40; i++) boat.tick(ctx);
    expect(boat.z).toBeLessThan(z0 - 1);
    expect(Math.abs(p.x - boat.x)).toBeLessThan(0.01);
    // Sneaking gets out.
    p.input.forward = 0;
    p.input.sneak = true;
    boat.tick(ctx);
    expect(p.vehicle).toBeNull();
    expect(boat.rider).toBeNull();
  });
});

describe('minecarts', () => {
  const track = (length: number) => {
    const w = createTestWorld(2);
    for (let x = 0; x < length; x++) w.dim.setBlock(x, 4, 0, BlockId.RAIL, 1); // east-west
    return w;
  };

  it('roll along straight rails and slow down', () => {
    const { dim, ctx } = track(24);
    const cart = new Minecart();
    cart.dim = dim;
    cart.setPosition(1.5, 4.0625, 0.5);
    cart.motionX = 0.3;
    for (let i = 0; i < 20; i++) cart.tick(ctx);
    expect(cart.onRail).toBe(true);
    expect(cart.x).toBeGreaterThan(5);
    expect(cart.z).toBeCloseTo(0.5, 5); // kept on the rail centre line
    for (let i = 0; i < 400; i++) cart.tick(ctx);
    expect(Math.abs(cart.motionX)).toBeLessThan(0.01); // friction stops an empty cart
  });

  it('are boosted by powered rails and stopped by unpowered ones', () => {
    const { dim, ctx, run } = track(30);
    dim.setBlock(2, 4, 0, BlockId.POWERED_RAIL, 1);
    dim.setBlock(2, 4, 1, BlockId.REDSTONE_TORCH, 5); // standing torch beside the rail
    run(10);
    expect(dim.getMeta(2, 4, 0) & RAIL_POWERED).toBe(RAIL_POWERED);
    const cart = new Minecart();
    cart.dim = dim;
    cart.setPosition(1.5, 4.0625, 0.5);
    cart.motionX = 0.05;
    let top = 0;
    for (let i = 0; i < 40; i++) { cart.tick(ctx); top = Math.max(top, cart.motionX); }
    expect(top).toBeGreaterThan(0.15);
    expect(cart.x).toBeGreaterThan(4);

    const brake = track(12);
    brake.dim.setBlock(4, 4, 0, BlockId.POWERED_RAIL, 1);
    const c2 = new Minecart();
    c2.dim = brake.dim;
    c2.setPosition(1.5, 4.0625, 0.5);
    c2.motionX = 0.1;
    for (let i = 0; i < 80; i++) c2.tick(brake.ctx);
    expect(c2.x).toBeLessThan(5.2);
  });

  it('climb an ascending rail onto a higher track', () => {
    const { dim, ctx } = track(6);
    dim.setBlock(6, 4, 0, BlockId.RAIL, 2); // ascending east
    for (let x = 7; x < 14; x++) {
      dim.setBlock(x, 4, 0, BlockId.STONE, 0);
      dim.setBlock(x, 5, 0, BlockId.RAIL, 1);
    }
    const cart = new Minecart();
    cart.dim = dim;
    cart.setPosition(1.5, 4.0625, 0.5);
    cart.motionX = 0.4;
    for (let i = 0; i < 40; i++) cart.tick(ctx);
    expect(cart.x).toBeGreaterThan(7.5);
    expect(cart.y).toBeCloseTo(5.0625, 3);
  });
});

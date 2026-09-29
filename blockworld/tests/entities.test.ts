import { describe, expect, it } from 'vitest';
import { BlockId } from '../src/blocks/ids';
import { ItemId } from '../src/items/ids';
import { createStack } from '../src/items/stack';
import { Player } from '../src/entity/player';
import { Zombie, Blaze, Enderman } from '../src/entity/mobs/monsters';
import { EyeOfEnderSignal } from '../src/entity/projectiles';
import { Effect } from '../src/entity/effects';
import { deserializeTile, serializeTile, createTile } from '../src/world/tileentity';
import { createTestWorld } from './helpers/testworld';

function freshPlayer() {
  const w = createTestWorld(1);
  const p = new Player();
  p.dim = w.dim;
  p.setPosition(0.5, 4, 0.5);
  return { ...w, p };
}

describe('damage', () => {
  it('armour reduces damage and invulnerability frames block repeats', () => {
    const { p, ctx } = freshPlayer();
    p.damage(ctx, 4, { type: 'generic' });
    expect(p.health).toBe(16);
    expect(p.damage(ctx, 4, { type: 'generic' })).toBe(false);
    expect(p.health).toBe(16);
    const q = freshPlayer().p;
    q.inventory.armor.set(1, createStack(ItemId.DIAMOND_CHESTPLATE));
    q.inventory.armor.set(2, createStack(ItemId.DIAMOND_LEGGINGS));
    q.damage(ctx, 10, { type: 'generic' });
    expect(q.health).toBeGreaterThan(14);
  });

  it('fire resistance blocks fire damage; difficulty scales mob damage', () => {
    const { p, ctx } = freshPlayer();
    p.addEffect({ id: Effect.FIRE_RESISTANCE, amplifier: 0, duration: 200 });
    expect(p.damage(ctx, 4, { type: 'lava', isFire: true })).toBe(false);
    const zombie = new Zombie();
    const easy = { ...ctx, difficulty: 1 } as typeof ctx;
    const hard = { ...ctx, difficulty: 3 } as typeof ctx;
    const a = freshPlayer().p; a.damage(easy, 4, { type: 'mob', attacker: zombie });
    const b = freshPlayer().p; b.damage(hard, 4, { type: 'mob', attacker: zombie });
    expect(20 - a.health).toBeLessThan(20 - b.health);
  });
});

describe('progression drops', () => {
  it('blazes drop rods only to players; endermen drop pearls', () => {
    const { ctx, dim } = createTestWorld(1);
    const drops: number[] = [];
    (ctx as unknown as { dropStack: (d: unknown, x: number, y: number, z: number, s: { id: number }) => void }).dropStack = (_d, _x, _y, _z, s) => drops.push(s.id);
    let rods = 0; let pearls = 0;
    for (let i = 0; i < 200; i++) {
      const b = new Blaze(); b.dim = dim; b.setPosition(0, 10, 0);
      drops.length = 0;
      b.die(ctx, { type: 'player', attacker: ctx.player as never });
      rods += drops.filter((d) => d === ItemId.BLAZE_ROD).length;
      const e = new Enderman(); e.dim = dim; e.setPosition(0, 10, 0);
      drops.length = 0;
      e.die(ctx, { type: 'player', attacker: ctx.player as never });
      pearls += drops.filter((d) => d === ItemId.ENDER_PEARL).length;
    }
    expect(rods).toBeGreaterThan(50);
    expect(pearls).toBeGreaterThan(50);
  });
});

describe('eyes of ender', () => {
  it('fly toward the target, at most twelve blocks per throw', () => {
    const eye = new EyeOfEnderSignal();
    eye.setPosition(0, 64, 0);
    eye.moveTowards(800, -600, 64);
    const d = Math.hypot(eye.targetX, eye.targetZ);
    expect(d).toBeCloseTo(12, 1);
    expect(eye.targetX / d).toBeCloseTo(0.8, 2);
    expect(eye.targetZ / d).toBeCloseTo(-0.6, 2);
  });
});

describe('serialisation', () => {
  it('players round-trip inventory, health, xp and effects', () => {
    const { p } = freshPlayer();
    p.inventory.set(3, createStack(ItemId.DIAMOND_SWORD));
    p.inventory.set(10, createStack(BlockId.OBSIDIAN, 12));
    p.inventory.armor.set(0, createStack(ItemId.IRON_HELMET));
    p.health = 11; p.foodLevel = 7; p.xpLevel = 5;
    p.addEffect({ id: Effect.SPEED, amplifier: 1, duration: 300 });
    const q = new Player();
    q.deserialize(JSON.parse(JSON.stringify(p.serialize())));
    expect(q.inventory.get(3)?.id).toBe(ItemId.DIAMOND_SWORD);
    expect(q.inventory.get(10)).toMatchObject({ id: BlockId.OBSIDIAN, count: 12 });
    expect(q.inventory.armor.get(0)?.id).toBe(ItemId.IRON_HELMET);
    expect([q.health, q.foodLevel, q.xpLevel]).toEqual([11, 7, 5]);
    expect(q.hasEffect(Effect.SPEED)).toBe(true);
  });

  it('chest tile entities round-trip', () => {
    const t = createTile('chest', 1, 2, 3);
    if (t.kind !== 'chest') throw new Error();
    t.items.set(5, createStack(ItemId.DIAMOND, 3));
    const u = deserializeTile(JSON.parse(JSON.stringify(serializeTile(t))));
    expect(u.kind).toBe('chest');
    if (u.kind === 'chest') expect(u.items.get(5)).toMatchObject({ id: ItemId.DIAMOND, count: 3 });
  });
});

describe('creative flight', () => {
  it('double-tapping jump toggles flight, landing ends it', () => {
    const { p, ctx } = freshPlayer();
    p.creative = true;
    const press = (jump: boolean) => { p.input.jump = jump; p.tick(ctx); };
    for (let i = 0; i < 5; i++) press(false);
    expect(p.onGround).toBe(true);
    press(true); press(false); press(true);
    expect(p.flying).toBe(true);
    // Hovering: no gravity while flying.
    for (let i = 0; i < 5; i++) press(false);
    const y = p.y;
    for (let i = 0; i < 10; i++) press(false);
    expect(Math.abs(p.y - y)).toBeLessThan(0.01);
    // Survival players cannot toggle it.
    const s = freshPlayer();
    s.p.input.jump = true; s.p.tick(s.ctx); s.p.input.jump = false; s.p.tick(s.ctx); s.p.input.jump = true; s.p.tick(s.ctx);
    expect(s.p.flying).toBe(false);
    // Descending onto the ground lands.
    p.input.sneak = true;
    for (let i = 0; i < 40 && p.flying; i++) p.tick(ctx);
    expect(p.flying).toBe(false);
  });
});

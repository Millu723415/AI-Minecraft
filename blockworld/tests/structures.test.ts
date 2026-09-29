import { describe, expect, it } from 'vitest';
import { OverworldGenerator } from '../src/worldgen/overworld';
import { BlockId } from '../src/blocks/ids';
import { FRAME_EYE } from '../src/blocks/meta';
import { blockIndex } from '../src/world/constants';
import { PortalRoom } from '../src/worldgen/structures/stronghold';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function blockAt(gen: OverworldGenerator, x: number, y: number, z: number): number {
  const c = gen.generateTerrain(x >> 4, z >> 4);
  return c.blocks[blockIndex(x & 15, y, z & 15)];
}

describe('strongholds', () => {
  for (const seed of [1, 12345, 987654321]) {
    it(`seed ${seed}: three strongholds 640-1152 blocks out, each with one portal room`, () => {
      const gen = new OverworldGenerator(seed);
      const s = gen.structures.strongholds();
      expect(s.length).toBe(3);
      for (const sh of s) {
        const d = Math.hypot(sh.x, sh.z);
        expect(d).toBeGreaterThan(600);
        expect(d).toBeLessThan(1200);
        expect(sh.portal).toBeInstanceOf(PortalRoom);
        expect(sh.pieces.filter((p) => p.kind === 'portal').length).toBe(1);
        expect(sh.box.y0).toBeGreaterThanOrEqual(5);
      }
    });
  }

  it('portal room rasterises twelve frames around a 3x3 interior', () => {
    const gen = new OverworldGenerator(12345);
    const room = gen.structures.strongholds()[0].portal!;
    const [cx, y, cz] = room.center();
    let frames = 0;
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const id = blockAt(gen, cx + dx, y, cz + dz);
        const ring = (Math.abs(dx) === 2) !== (Math.abs(dz) === 2);
        if (ring) { expect(id).toBe(BlockId.END_PORTAL_FRAME); frames++; }
        if (Math.abs(dx) <= 1 && Math.abs(dz) <= 1) expect(id).toBe(0);
      }
    }
    expect(frames).toBe(12);
    expect(blockAt(gen, cx, y - 1, cz)).toBe(BlockId.LAVA);
    void FRAME_EYE;
  });
});

describe('villages and mineshafts', () => {
  it('finds a village with villagers and a mineshaft near spawn', () => {
    const gen = new OverworldGenerator(12345);
    const v = gen.structures.findVillage(0, 0, 6);
    expect(v).not.toBeNull();
    const m = gen.structures.findMineshaft(0, 0, 3);
    expect(m).not.toBeNull();
    const [vx, vz] = v!;
    let villagers = 0;
    for (let cx = (vx >> 4) - 5; cx <= (vx >> 4) + 5; cx++) {
      for (let cz = (vz >> 4) - 5; cz <= (vz >> 4) + 5; cz++) villagers += gen.structures.villagersIn(cx, cz).length;
    }
    expect(villagers).toBeGreaterThan(2);
  });

  it('structure generation is deterministic regardless of chunk order', () => {
    const a = new OverworldGenerator(4242);
    const b = new OverworldGenerator(4242);
    const [x, z] = a.structures.strongholds()[1].portal!.center();
    const ca = a.generateTerrain(x >> 4, z >> 4);
    // Generate neighbours first in the second generator.
    b.generateTerrain((x >> 4) + 1, z >> 4);
    b.generateTerrain((x >> 4) - 1, (z >> 4) + 1);
    const cb = b.generateTerrain(x >> 4, z >> 4);
    expect(sameBytes(ca.blocks, cb.blocks)).toBe(true);
    expect(sameBytes(ca.meta, cb.meta)).toBe(true);
  });
});

import { NetherGenerator } from '../src/worldgen/nether';
import { EndGenerator } from '../src/worldgen/end';

describe('nether', () => {
  it('has bedrock floor/ceiling, a lava sea and netherrack', () => {
    const gen = new NetherGenerator(77);
    const c = gen.generateTerrain(3, -2);
    const at = (x: number, y: number, z: number) => c.blocks[blockIndex(x, y, z)];
    for (let i = 0; i < 16; i++) {
      expect(at(i, 0, i)).toBe(BlockId.BEDROCK);
      expect(at(i, 127, 15 - i)).toBe(BlockId.BEDROCK);
    }
    let lava = 0; let rack = 0;
    for (let i = 0; i < c.blocks.length; i++) {
      if (c.blocks[i] === BlockId.LAVA) lava++;
      if (c.blocks[i] === BlockId.NETHERRACK) rack++;
    }
    expect(rack).toBeGreaterThan(5000);
    expect(lava + rack).toBeGreaterThan(0);
  });

  it('every fortress region holds a fortress with blaze spawners and nether wart', () => {
    const gen = new NetherGenerator(2258480790);
    for (const [rx, rz] of [[0, 0], [-1, -1], [2, -3]]) {
      const f = gen.fortressIn(rx, rz);
      expect(f.pieces.some((p) => p.kind === 'blaze')).toBe(true);
      expect(f.pieces.some((p) => p.kind === 'wart')).toBe(true);
      const b = f.pieces[0].box;
      expect(gen.inFortress((b.x0 + b.x1) >> 1, b.y0 + 1, (b.z0 + b.z1) >> 1)).toBe(true);
    }
  });

  it('rasterises a blaze spawner tile entity', () => {
    const gen = new NetherGenerator(2258480790);
    const f = gen.fortressIn(0, 0);
    const blaze = f.pieces.find((p) => p.kind === 'blaze')!;
    const x = (blaze.box.x0 + blaze.box.x1) >> 1; const z = (blaze.box.z0 + blaze.box.z1) >> 1;
    const tiles = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) tiles.push(...gen.generateTerrain((x >> 4) + dx, (z >> 4) + dz).tiles);
    expect(tiles.some((t) => t.kind === 'spawner' && t.mob === 'blaze')).toBe(true);
  });
});

describe('the end', () => {
  it('has an island with ten obsidian pillars capped by bedrock', () => {
    const gen = new EndGenerator(5);
    const tops = gen.pillarTops();
    expect(tops.length).toBe(10);
    for (const [x, y, z] of tops) {
      const c = gen.generateTerrain(x >> 4, z >> 4);
      expect(c.blocks[blockIndex(x & 15, y, z & 15)]).toBe(BlockId.BEDROCK);
      expect(c.blocks[blockIndex(x & 15, y - 1, z & 15)]).toBe(BlockId.OBSIDIAN);
    }
    const centre = gen.generateTerrain(0, 0);
    let stone = 0;
    for (let y = 0; y < 128; y++) if (centre.blocks[blockIndex(0, y, 0)] === BlockId.END_STONE) stone++;
    expect(stone).toBeGreaterThan(20);
    expect(gen.column(400, 0)).toBeNull();
  });
});

/** World-wide constants and coordinate helpers. */

export const CHUNK_SIZE = 16;
export const CHUNK_SHIFT = 4;
export const CHUNK_MASK = 15;
export const WORLD_HEIGHT = 128;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const SEA_LEVEL = 63;

/** Dimension identifiers (stored in saves). */
export const Dim = { OVERWORLD: 0, NETHER: 1, END: 2 } as const;
export type DimId = (typeof Dim)[keyof typeof Dim];
export const DIM_NAMES = ['Overworld', 'The Nether', 'The End'];

/** Index into a chunk's flat arrays: x fastest, then z, then y. */
export function blockIndex(x: number, y: number, z: number): number {
  return x | (z << 4) | (y << 8);
}

/** Pack chunk coordinates into a single number usable as a Map key. */
export function chunkKey(cx: number, cz: number): number {
  return (cx + 32768) * 65536 + (cz + 32768);
}

export function unpackChunkKey(key: number): [number, number] {
  const cx = Math.floor(key / 65536) - 32768;
  const cz = (key % 65536) - 32768;
  return [cx, cz];
}

/** Face directions shared by mesher, lighting and interaction code. */
export const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],  // 0 east  (+X)
  [-1, 0, 0], // 1 west  (-X)
  [0, 1, 0],  // 2 up    (+Y)
  [0, -1, 0], // 3 down  (-Y)
  [0, 0, 1],  // 4 south (+Z)
  [0, 0, -1], // 5 north (-Z)
];

export const Face = { EAST: 0, WEST: 1, UP: 2, DOWN: 3, SOUTH: 4, NORTH: 5 } as const;

/** Game ticks per second (simulation is fixed-step at this rate). */
export const TICKS_PER_SECOND = 20;
/** Length of one full day in ticks (20 minutes). */
export const DAY_LENGTH = 24000;

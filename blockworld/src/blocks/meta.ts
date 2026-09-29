/**
 * Metadata conventions shared by placement, rendering, collision and block
 * behaviour code. Keeping them in one place avoids subtle disagreements.
 */

/** Horizontal facing used by furnaces, chests, pumpkins, repeaters (front direction). */
export const Facing4 = { SOUTH: 0, WEST: 1, NORTH: 2, EAST: 3 } as const;
/** Unit vectors for Facing4. */
export const FACING4_DIR: ReadonlyArray<readonly [number, number]> = [[0, 1], [-1, 0], [0, -1], [1, 0]];

/** Facing4 from a yaw angle, so the block front faces the player. */
export function facingTowardPlayer(yaw: number): number {
  // yaw 0 = looking toward -Z (north). The front should face back at the player.
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const q = Math.round(a / (Math.PI / 2)) & 3;
  // q: 0 looking north -> front south, 1 looking west -> front east, 2 south -> north, 3 east -> west
  return [Facing4.SOUTH, Facing4.EAST, Facing4.NORTH, Facing4.WEST][q];
}

/** Facing4 in the direction the player looks (for beds, stairs, doors). */
export function facingAwayFromPlayer(yaw: number): number {
  return (facingTowardPlayer(yaw) + 2) & 3;
}

/**
 * Wall attachment metas for torches, ladders, wall signs, buttons, levers:
 * 0 = floor, 1 = support block at +X, 2 = at -X, 3 = at +Z, 4 = at -Z, 5 = floor (lever).
 */
export const Attach = { FLOOR: 0, EAST: 1, WEST: 2, SOUTH: 3, NORTH: 4, FLOOR_LEVER: 5 } as const;
export const ATTACH_DIR: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0],
];

/** Attachment meta for placing against a clicked face (face index of the clicked block side). */
export function attachFromClickedFace(face: number): number {
  // Clicking the east (+X) face of a block puts the torch on its east side,
  // so the supporting block is to the torch's west (-X).
  switch (face) {
    case 0: return Attach.WEST;
    case 1: return Attach.EAST;
    case 4: return Attach.NORTH;
    case 5: return Attach.SOUTH;
    default: return Attach.FLOOR;
  }
}

/** Stairs: low 2 bits = ascending direction (0 +X, 1 -X, 2 +Z, 3 -Z); bit 2 = upside down. */
export const STAIRS_UPSIDE = 4;

/** Slabs: bit 3 = top half. */
export const SLAB_TOP = 8;

/** Doors: low 2 bits = closed edge (0 -X, 1 -Z, 2 +X, 3 +Z); bit 2 open; bit 3 upper half. */
export const DOOR_OPEN = 4;
export const DOOR_UPPER = 8;

/** Beds: low 2 bits = Facing4 from foot to head; bit 3 = head half. */
export const BED_HEAD = 8;

/** Rails: 0 N-S, 1 E-W, 2-5 ascending (+X, -X, -Z, +Z), 6-9 curves. Bit 3 = powered (special rails). */
export const RAIL_POWERED = 8;

/** Pistons: low 3 bits = face index (0..5), bit 3 = extended / sticky for heads. */
export const PISTON_EXTENDED = 8;

/** End portal frame: bit 2 = holds an Eye of Ender. */
export const FRAME_EYE = 4;

/** Leaves: low 2 bits = wood type; bit 2 = placed by a player (never decays). */
export const LEAVES_NO_DECAY = 4;

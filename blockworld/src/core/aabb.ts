/** Axis-aligned bounding box with the swept-offset helpers used by physics. */

export class AABB {
  constructor(
    public minX: number, public minY: number, public minZ: number,
    public maxX: number, public maxY: number, public maxZ: number,
  ) {}

  static fromCenter(x: number, y: number, z: number, width: number, height: number): AABB {
    const h = width / 2;
    return new AABB(x - h, y, z - h, x + h, y + height, z + h);
  }

  clone(): AABB {
    return new AABB(this.minX, this.minY, this.minZ, this.maxX, this.maxY, this.maxZ);
  }

  offset(dx: number, dy: number, dz: number): this {
    this.minX += dx; this.maxX += dx;
    this.minY += dy; this.maxY += dy;
    this.minZ += dz; this.maxZ += dz;
    return this;
  }

  /** Grow in the direction of motion (for broad-phase collision gathering). */
  expandTowards(dx: number, dy: number, dz: number): AABB {
    const b = this.clone();
    if (dx < 0) b.minX += dx; else b.maxX += dx;
    if (dy < 0) b.minY += dy; else b.maxY += dy;
    if (dz < 0) b.minZ += dz; else b.maxZ += dz;
    return b;
  }

  grow(x: number, y = x, z = x): AABB {
    return new AABB(this.minX - x, this.minY - y, this.minZ - z, this.maxX + x, this.maxY + y, this.maxZ + z);
  }

  intersects(o: AABB): boolean {
    return o.maxX > this.minX && o.minX < this.maxX && o.maxY > this.minY && o.minY < this.maxY && o.maxZ > this.minZ && o.minZ < this.maxZ;
  }

  containsPoint(x: number, y: number, z: number): boolean {
    return x > this.minX && x < this.maxX && y > this.minY && y < this.maxY && z > this.minZ && z < this.maxZ;
  }

  /** Clip movement dx of `other` against this box. */
  clipX(other: AABB, dx: number): number {
    if (other.maxY <= this.minY || other.minY >= this.maxY || other.maxZ <= this.minZ || other.minZ >= this.maxZ) return dx;
    if (dx > 0 && other.maxX <= this.minX) {
      const d = this.minX - other.maxX;
      if (d < dx) dx = d;
    } else if (dx < 0 && other.minX >= this.maxX) {
      const d = this.maxX - other.minX;
      if (d > dx) dx = d;
    }
    return dx;
  }

  clipY(other: AABB, dy: number): number {
    if (other.maxX <= this.minX || other.minX >= this.maxX || other.maxZ <= this.minZ || other.minZ >= this.maxZ) return dy;
    if (dy > 0 && other.maxY <= this.minY) {
      const d = this.minY - other.maxY;
      if (d < dy) dy = d;
    } else if (dy < 0 && other.minY >= this.maxY) {
      const d = this.maxY - other.minY;
      if (d > dy) dy = d;
    }
    return dy;
  }

  clipZ(other: AABB, dz: number): number {
    if (other.maxX <= this.minX || other.minX >= this.maxX || other.maxY <= this.minY || other.minY >= this.maxY) return dz;
    if (dz > 0 && other.maxZ <= this.minZ) {
      const d = this.minZ - other.maxZ;
      if (d < dz) dz = d;
    } else if (dz < 0 && other.minZ >= this.maxZ) {
      const d = this.maxZ - other.minZ;
      if (d > dz) dz = d;
    }
    return dz;
  }

  /** Ray intersection; returns distance t (0..maxT) and hit face, or null. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): { t: number; face: number } | null {
    let tmin = 0;
    let tmax = maxT;
    let face = -1;
    const axes: [number, number, number, number, number, number][] = [
      [ox, dx, this.minX, this.maxX, 1, 0],
      [oy, dy, this.minY, this.maxY, 3, 2],
      [oz, dz, this.minZ, this.maxZ, 5, 4],
    ];
    for (const [o, d, mn, mx, faceMin, faceMax] of axes) {
      if (Math.abs(d) < 1e-9) {
        if (o < mn || o > mx) return null;
        continue;
      }
      let t1 = (mn - o) / d;
      let t2 = (mx - o) / d;
      let f1 = faceMin;
      let f2 = faceMax;
      if (t1 > t2) { [t1, t2] = [t2, t1]; [f1, f2] = [f2, f1]; }
      if (t1 > tmin) { tmin = t1; face = f1; }
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    if (face < 0) return null;
    return { t: tmin, face };
  }
}

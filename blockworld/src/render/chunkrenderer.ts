/** Owns the GPU meshes for every visible chunk of the current dimension. */

import * as THREE from 'three';
import type { ChunkMeshData, MeshArrays } from './mesher';
import type { TerrainMaterials } from './materials';
import { chunkKey } from '../world/constants';

type PassName = 'opaque' | 'cutout' | 'translucent' | 'water' | 'lava';
const PASSES: PassName[] = ['opaque', 'cutout', 'lava', 'translucent', 'water'];
const RENDER_ORDER: Record<PassName, number> = { opaque: 0, cutout: 1, lava: 2, translucent: 3, water: 4 };

interface ChunkMeshes {
  cx: number;
  cz: number;
  meshes: Partial<Record<PassName, THREE.Mesh>>;
  faces: number;
}

const CHUNK_BOX = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(16, 128, 16));
const CHUNK_SPHERE = new THREE.Sphere(new THREE.Vector3(8, 64, 8), Math.sqrt(8 * 8 * 2 + 64 * 64));

export class ChunkRenderer {
  readonly group = new THREE.Group();
  private chunks = new Map<number, ChunkMeshes>();
  totalFaces = 0;

  constructor(private readonly materials: TerrainMaterials) {
    this.group.name = 'terrain';
  }

  private makeGeometry(a: MeshArrays): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(a.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(a.uv, 2));
    g.setAttribute('aLight', new THREE.BufferAttribute(a.light, 4, true));
    g.setAttribute('aTint', new THREE.BufferAttribute(a.tint, 4, true));
    g.setIndex(new THREE.BufferAttribute(a.idx, 1));
    g.boundingBox = CHUNK_BOX.clone();
    g.boundingSphere = CHUNK_SPHERE.clone();
    return g;
  }

  /** Replace the meshes of a chunk with freshly built data. */
  update(cx: number, cz: number, data: ChunkMeshData): void {
    const key = chunkKey(cx, cz);
    let entry = this.chunks.get(key);
    if (!entry) {
      entry = { cx, cz, meshes: {}, faces: 0 };
      this.chunks.set(key, entry);
    }
    this.totalFaces += data.faces - entry.faces;
    entry.faces = data.faces;
    for (const pass of PASSES) {
      const arrays = data[pass];
      const old = entry.meshes[pass];
      if (old) {
        this.group.remove(old);
        old.geometry.dispose();
        delete entry.meshes[pass];
      }
      if (!arrays) continue;
      const mesh = new THREE.Mesh(this.makeGeometry(arrays), this.materials[pass]);
      mesh.position.set(cx * 16, 0, cz * 16);
      mesh.renderOrder = RENDER_ORDER[pass];
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      entry.meshes[pass] = mesh;
    }
  }

  remove(cx: number, cz: number): void {
    const key = chunkKey(cx, cz);
    const entry = this.chunks.get(key);
    if (!entry) return;
    for (const pass of PASSES) {
      const m = entry.meshes[pass];
      if (m) {
        this.group.remove(m);
        m.geometry.dispose();
      }
    }
    this.totalFaces -= entry.faces;
    this.chunks.delete(key);
  }

  has(cx: number, cz: number): boolean {
    return this.chunks.has(chunkKey(cx, cz));
  }

  clear(): void {
    for (const e of Array.from(this.chunks.values())) this.remove(e.cx, e.cz);
    this.totalFaces = 0;
  }

  get chunkCount(): number {
    return this.chunks.size;
  }

  keys(): IterableIterator<number> {
    return this.chunks.keys();
  }
}

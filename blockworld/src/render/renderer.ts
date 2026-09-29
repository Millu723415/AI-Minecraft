/**
 * Top-level renderer: owns the WebGL context, scene graph, camera, terrain,
 * sky, block selection, crack overlay and the first-person held item.
 */

import * as THREE from 'three';
import { ChunkRenderer } from './chunkrenderer';
import { TerrainMaterials } from './materials';
import { SkyRenderer } from './sky';
import { tileOf, tileUV } from './tiles';
import { itemGeometry } from './itemmesh';
import { itemAtlas } from './itematlas';
import { boxGeometry } from './skin';
import { playerSkinTexture } from './mobmodels';
import type { Box } from '../blocks/types';
import type { ItemStack } from '../items/stack';
import type { DimId } from '../world/constants';

export interface CameraState {
  x: number; y: number; z: number;
  yaw: number; pitch: number;
  roll: number;
  fov: number;
  underwater: boolean;
  inLava: boolean;
  thirdPerson: boolean;
}

export interface HandState {
  item: ItemStack | null;
  swing: number; // 0..1
  equip: number; // 0..1 (lowered when switching)
  bobX: number;
  bobY: number;
  light: number; // 0..1 brightness at the player
  using: number; // bow draw / eating 0..1
  eating: boolean;
}

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  private readonly skyScene = new THREE.Scene();
  private readonly skyCamera = new THREE.PerspectiveCamera(70, 1, 1, 1200);
  readonly camera: THREE.PerspectiveCamera;
  readonly materials: TerrainMaterials;
  readonly chunks: ChunkRenderer;
  readonly sky: SkyRenderer;
  readonly entityGroup = new THREE.Group();
  readonly particleGroup = new THREE.Group();
  readonly overlayGroup = new THREE.Group();
  private readonly selection: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private readonly crackTiles: number[] = [];
  private readonly handScene = new THREE.Scene();
  private readonly handCamera: THREE.PerspectiveCamera;
  private readonly handGroup = new THREE.Group();
  private handMesh: THREE.Mesh | null = null;
  private handKey = '';
  private readonly armMesh: THREE.Mesh;
  readonly blockItemMaterial: THREE.MeshBasicMaterial;
  readonly spriteItemMaterial: THREE.MeshBasicMaterial;
  private readonly handBlockMat: THREE.MeshBasicMaterial;
  private readonly handSpriteMat: THREE.MeshBasicMaterial;
  private readonly overlayQuad: THREE.Mesh;
  private readonly overlayCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly overlayScene = new THREE.Scene();
  pixelRatio = 1;
  renderDistance = 8;
  frameInfo = { calls: 0, triangles: 0 };

  constructor(readonly canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    this.gl.autoClear = false;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    this.gl.setPixelRatio(this.pixelRatio);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
    this.camera.rotation.order = 'YXZ';
    this.materials = new TerrainMaterials();
    this.chunks = new ChunkRenderer(this.materials);
    this.sky = new SkyRenderer();
    this.scene.add(this.sky.group, this.chunks.group, this.entityGroup, this.particleGroup, this.overlayGroup);
    this.skyScene.add(this.sky.farGroup);
    this.scene.fog = new THREE.Fog(0xb0c8ff, 60, 120);

    // Selection outline.
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selection = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.5, depthWrite: false }));
    this.selection.visible = false;
    this.overlayGroup.add(this.selection);

    // Crack overlay uses the destroy_* tiles of the block atlas.
    for (let i = 0; i < 10; i++) this.crackTiles.push(tileOf(`destroy_${i}`));
    const crackMat = new THREE.MeshBasicMaterial({
      map: this.materials.atlas, transparent: true, depthWrite: false, polygonOffset: true,
      polygonOffsetFactor: -1, polygonOffsetUnits: -1, fog: false,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), crackMat);
    this.crack.visible = false;
    this.overlayGroup.add(this.crack);

    // Item materials (block atlas / item atlas), shared by dropped items.
    this.blockItemMaterial = new THREE.MeshBasicMaterial({ map: this.materials.atlas, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    this.spriteItemMaterial = new THREE.MeshBasicMaterial({ map: itemAtlas().tex, vertexColors: true, alphaTest: 0.5, side: THREE.DoubleSide });
    this.handBlockMat = this.blockItemMaterial.clone();
    this.handSpriteMat = this.spriteItemMaterial.clone();

    // First-person hand.
    this.handCamera = new THREE.PerspectiveCamera(70, 1, 0.01, 10);
    this.handScene.add(this.handGroup);
    // Right arm of the player skin, laid along -Z with the hand away from the eye.
    const skin = playerSkinTexture();
    const armMat = new THREE.MeshBasicMaterial({ map: skin.texture, alphaTest: 0.1 });
    const armGeo = boxGeometry([{ x: -2, y: -10, z: -2, w: 4, h: 12, d: 4, u: 40, v: 16 }], skin.texW, skin.texH);
    armGeo.rotateX(Math.PI / 2);
    armGeo.translate(0, 0, 4);
    armGeo.scale(0.8 / 12, 0.8 / 12, 0.8 / 12);
    this.armMesh = new THREE.Mesh(armGeo, armMat);
    this.handGroup.add(this.armMesh);

    // Full-screen tint quad for underwater / lava / portal effects.
    this.overlayQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
    this.overlayScene.add(this.overlayQuad);

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.handCamera.aspect = w / h;
    this.handCamera.updateProjectionMatrix();
  }

  setRenderDistance(chunks: number): void {
    this.renderDistance = chunks;
  }

  setSelection(x: number, y: number, z: number, box: Box | null): void {
    if (!box) {
      this.selection.visible = false;
      return;
    }
    const e = 0.002;
    this.selection.visible = true;
    this.selection.position.set(x + (box.minX + box.maxX) / 2, y + (box.minY + box.maxY) / 2, z + (box.minZ + box.maxZ) / 2);
    this.selection.scale.set(box.maxX - box.minX + e * 2, box.maxY - box.minY + e * 2, box.maxZ - box.minZ + e * 2);
  }

  setCrack(x: number, y: number, z: number, progress: number, box: Box | null): void {
    if (progress <= 0 || !box) {
      this.crack.visible = false;
      return;
    }
    const stage = Math.min(9, Math.floor(progress * 10));
    const [u0, v0, u1, v1] = tileUV(this.crackTiles[stage]);
    const uv = this.crack.geometry.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const cu = i % 2 === 0 ? u0 : u1;
      const cv = Math.floor(i / 2) % 2 === 0 ? v0 : v1;
      uv.setXY(i, cu, cv);
    }
    uv.needsUpdate = true;
    this.crack.visible = true;
    this.crack.position.set(x + (box.minX + box.maxX) / 2, y + (box.minY + box.maxY) / 2, z + (box.minZ + box.maxZ) / 2);
    this.crack.scale.set(box.maxX - box.minX + 0.004, box.maxY - box.minY + 0.004, box.maxZ - box.minZ + 0.004);
  }

  private updateHand(state: HandState): void {
    const key = state.item ? `${state.item.id}:${state.item.meta}` : '';
    if (key !== this.handKey) {
      this.handKey = key;
      if (this.handMesh) {
        this.handGroup.remove(this.handMesh);
        this.handMesh = null;
      }
      if (state.item) {
        const { geometry, blockAtlas, cube } = itemGeometry(state.item.id, state.item.meta);
        this.handMesh = new THREE.Mesh(geometry, blockAtlas ? this.handBlockMat : this.handSpriteMat);
        this.handMesh.userData.cube = cube;
        this.handGroup.add(this.handMesh);
      }
    }
    const light = Math.max(0.25, state.light);
    this.handBlockMat.color.setScalar(light);
    this.handSpriteMat.color.setScalar(light);
    (this.armMesh.material as THREE.MeshBasicMaterial).color.setScalar(light);

    // Classic swing: arc down and in, with a small twist.
    const s = state.swing;
    const swingArc = Math.sin(s * Math.PI);
    const swingSqrt = Math.sin(Math.sqrt(s) * Math.PI);
    const eq = state.equip;
    this.handGroup.position.set(0.56 - swingSqrt * 0.2 + state.bobX, -0.52 - eq * 0.6 + swingArc * 0.1 + state.bobY, -0.72 - swingArc * 0.15);
    this.handGroup.rotation.set(0, 0, 0);
    this.handGroup.rotation.y = -swingSqrt * 0.35;
    this.handGroup.rotation.x = -swingArc * 0.6;
    if (state.eating) {
      this.handGroup.position.x -= 0.25;
      this.handGroup.position.y += 0.15 + Math.abs(Math.sin(state.using * 20)) * 0.04;
    }
    if (this.handMesh) {
      this.armMesh.visible = false;
      const cube = this.handMesh.userData.cube as boolean;
      if (cube) {
        this.handMesh.scale.setScalar(0.4);
        this.handMesh.rotation.set(0.1, Math.PI / 4 + 0.2, 0);
        this.handMesh.position.set(0, 0.02, 0);
      } else {
        this.handMesh.scale.setScalar(0.62);
        this.handMesh.rotation.set(0, -Math.PI / 2 + 0.4, 0.15);
        this.handMesh.rotateZ(state.using > 0 && !state.eating ? 0.3 : -0.2);
        this.handMesh.position.set(0, 0.15, 0);
      }
    } else {
      this.armMesh.visible = true;
      this.armMesh.rotation.set(0.35, -0.3, 0);
      this.armMesh.position.set(0.05, -0.05, 0.1);
    }
  }

  render(cam: CameraState, hand: HandState | null, dim: DimId, time: number, rain: number, dt: number, fogScale = 1): void {
    const c = this.camera;
    c.fov = cam.fov;
    c.far = this.renderDistance * 16 + 64;
    c.updateProjectionMatrix();
    c.position.set(cam.x, cam.y, cam.z);
    c.rotation.set(cam.pitch, cam.yaw, cam.roll);
    if (cam.thirdPerson) {
      const back = 4;
      const cp = Math.cos(cam.pitch);
      c.position.x += Math.sin(cam.yaw) * cp * back;
      c.position.y += -Math.sin(cam.pitch) * back;
      c.position.z += Math.cos(cam.yaw) * cp * back;
    }
    c.updateMatrixWorld();

    const skyState = this.sky.update(time, dim, c.position, rain, this.renderDistance, dt);
    const u = this.materials.uniforms;
    u.daylight.value = skyState.daylight;
    u.time.value = performance.now() / 1000;
    let fogColor = skyState.fogColor;
    let far = this.renderDistance * 16 * fogScale;
    let near = far * 0.55;
    if (dim === 1) { near = far * 0.1; far = Math.min(far, 96); }
    if (dim === 2) { near = far * 0.5; }
    u.minLight.value = dim === 1 ? 0.1 : dim === 2 ? 0.2 : 0.0;
    if (cam.underwater) {
      fogColor = new THREE.Color(0.05, 0.08, 0.3).multiplyScalar(Math.max(0.3, skyState.daylight));
      near = 0; far = 24;
    } else if (cam.inLava) {
      fogColor = new THREE.Color(0.6, 0.1, 0);
      near = 0; far = 2;
    }
    u.fogColor.value.copy(fogColor);
    u.fogNear.value = near;
    u.fogFar.value = far;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(fogColor);
    fog.near = near;
    fog.far = far;

    this.gl.setClearColor(cam.underwater || cam.inLava ? fogColor : skyState.skyColor, 1);
    this.gl.clear();
    if (!cam.underwater && !cam.inLava) {
      // Far sky with its own depth range, then the world on top.
      const sc = this.skyCamera;
      sc.fov = c.fov; sc.aspect = c.aspect;
      sc.updateProjectionMatrix();
      sc.position.copy(c.position);
      sc.quaternion.copy(c.quaternion);
      sc.updateMatrixWorld();
      this.gl.render(this.skyScene, sc);
      this.gl.clearDepth();
    }
    this.gl.render(this.scene, c);
    this.frameInfo.calls = this.gl.info.render.calls;
    this.frameInfo.triangles = this.gl.info.render.triangles;

    // Screen tint overlays.
    const om = this.overlayQuad.material as THREE.MeshBasicMaterial;
    if (cam.underwater) { om.color.setRGB(0.1, 0.2, 0.6); om.opacity = 0.2; }
    else if (cam.inLava) { om.color.setRGB(0.9, 0.3, 0); om.opacity = 0.6; }
    else om.opacity = 0;
    if (om.opacity > 0) {
      this.gl.clearDepth();
      this.gl.render(this.overlayScene, this.overlayCamera);
    }

    if (hand && !cam.thirdPerson) {
      this.updateHand(hand);
      this.handCamera.fov = 70;
      this.handCamera.updateProjectionMatrix();
      this.gl.clearDepth();
      this.gl.render(this.handScene, this.handCamera);
    }
  }

  /** Brief full-screen colour overlay (portal swirl / damage) drawn after the hand. */
  renderScreenTint(r: number, g: number, b: number, a: number): void {
    if (a <= 0) return;
    const om = this.overlayQuad.material as THREE.MeshBasicMaterial;
    om.color.setRGB(r, g, b);
    om.opacity = a;
    this.gl.clearDepth();
    this.gl.render(this.overlayScene, this.overlayCamera);
  }
}

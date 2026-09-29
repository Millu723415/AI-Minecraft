/** Shared canvas/texture of the (original) fire block tile for overlays. */
import * as THREE from 'three';
import { paintBlockTexture } from './blocktextures';

let canvas: HTMLCanvasElement | null = null;
let texture: THREE.Texture | null = null;

export function fireCanvas(): HTMLCanvasElement {
  if (canvas) return canvas;
  const t = paintBlockTexture('fire');
  canvas = document.createElement('canvas');
  canvas.width = t.size; canvas.height = t.size;
  const img = new ImageData(new Uint8ClampedArray(t.data), t.size, t.size);
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

export function fireTexture(): THREE.Texture {
  if (texture) return texture;
  const t = new THREE.CanvasTexture(fireCanvas());
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  texture = t;
  return t;
}

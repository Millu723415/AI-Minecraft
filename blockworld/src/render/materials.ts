/**
 * Terrain shaders. Light is stored per vertex as separate sky and block
 * channels so the day/night cycle only changes a uniform (no re-meshing).
 * Brightness follows the classic exponential light curve (0.8^(15-level)).
 */

import * as THREE from 'three';
import { buildBlockAtlas, ATLAS_PX } from './tiles';
import { paintBlockTexture } from './blocktextures';

export interface TerrainUniforms {
  [key: string]: THREE.IUniform;
  map: THREE.IUniform<THREE.Texture>;
  daylight: THREE.IUniform<number>;
  fogColor: THREE.IUniform<THREE.Color>;
  fogNear: THREE.IUniform<number>;
  fogFar: THREE.IUniform<number>;
  minLight: THREE.IUniform<number>;
  brightness: THREE.IUniform<number>;
  time: THREE.IUniform<number>;
}

const VERT = /* glsl */ `
  attribute vec4 aLight;
  attribute vec4 aTint;
  varying vec2 vUv;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying vec3 vTint;
  varying float vFogDepth;
  varying vec3 vLocal;
  void main() {
    vUv = uv;
    vSky = aLight.x * 15.0;
    vBlock = aLight.y * 15.0;
    vShade = aLight.z;
    vTint = aTint.rgb;
    vLocal = position;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vFogDepth = length(mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_COMMON = /* glsl */ `
  uniform sampler2D map;
  uniform float daylight;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  uniform float minLight;
  uniform float brightness;
  uniform float time;
  varying vec2 vUv;
  varying float vSky;
  varying float vBlock;
  varying float vShade;
  varying vec3 vTint;
  varying float vFogDepth;
  varying vec3 vLocal;
  float lightLevel() {
    float sky = vSky - (1.0 - daylight) * 11.0;
    float l = max(max(sky, vBlock), 0.0);
    float b = pow(0.8, 15.0 - l);
    // Dimension ambient (the Nether and the End are never pitch black).
    b = minLight + (1.0 - minLight) * b;
    // Brightness option lifts dark values like the old gamma slider.
    return mix(b, 1.0 - pow(1.0 - b, 3.0), brightness);
  }
  vec3 applyFog(vec3 col) {
    float f = smoothstep(fogNear, fogFar, vFogDepth);
    return mix(col, fogColor, f);
  }
`;

function makeMaterial(frag: string, uniforms: TerrainUniforms, opts: THREE.ShaderMaterialParameters = {}): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG_COMMON + frag,
    ...opts,
  });
}

function dataTexture(pixels: Uint8Array | Uint8ClampedArray, w: number, h: number, repeat: boolean): THREE.DataTexture {
  const tex = new THREE.DataTexture(new Uint8Array(pixels), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
  }
  tex.needsUpdate = true;
  return tex;
}

export class TerrainMaterials {
  readonly uniforms: TerrainUniforms;
  readonly atlas: THREE.DataTexture;
  readonly opaque: THREE.ShaderMaterial;
  readonly cutout: THREE.ShaderMaterial;
  readonly translucent: THREE.ShaderMaterial;
  readonly water: THREE.ShaderMaterial;
  readonly lava: THREE.ShaderMaterial;

  constructor() {
    const atlas = buildBlockAtlas();
    this.atlas = dataTexture(atlas.pixels, ATLAS_PX, ATLAS_PX, false);
    this.uniforms = {
      map: { value: this.atlas },
      daylight: { value: 1 },
      fogColor: { value: new THREE.Color(0.7, 0.8, 1) },
      fogNear: { value: 60 },
      fogFar: { value: 120 },
      minLight: { value: 0.02 },
      brightness: { value: 0.3 },
      time: { value: 0 },
    };
    const u = this.uniforms;

    this.opaque = makeMaterial(/* glsl */ `
      void main() {
        vec4 tex = texture2D(map, vUv);
        vec3 tint = mix(vec3(1.0), vTint, step(tex.a, 0.75));
        vec3 col = tex.rgb * tint * lightLevel() * vShade;
        gl_FragColor = vec4(applyFog(col), 1.0);
      }
    `, u);

    this.cutout = makeMaterial(/* glsl */ `
      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < 0.5) discard;
        vec3 col = tex.rgb * vTint * lightLevel() * vShade;
        gl_FragColor = vec4(applyFog(col), 1.0);
      }
    `, u, { side: THREE.DoubleSide });

    this.translucent = makeMaterial(/* glsl */ `
      void main() {
        vec4 tex = texture2D(map, vUv);
        if (tex.a < 0.02) discard;
        vec3 col = tex.rgb * vTint * lightLevel() * vShade;
        gl_FragColor = vec4(applyFog(col), tex.a);
      }
    `, u, { transparent: true, depthWrite: false, side: THREE.DoubleSide });

    const waterTile = paintBlockTexture('water');
    const waterTex = dataTexture(waterTile.data, 16, 16, true);
    this.water = makeMaterial(/* glsl */ `
      uniform sampler2D waterMap;
      void main() {
        vec2 uv = vUv + vec2(time * 0.03, time * 0.05) + vec2(sin(vUv.y * 3.0 + time) * 0.03, 0.0);
        vec4 tex = texture2D(waterMap, uv);
        vec3 col = tex.rgb * lightLevel() * vShade;
        gl_FragColor = vec4(applyFog(col), 0.72);
      }
    `, { ...u, waterMap: { value: waterTex } } as TerrainUniforms, { transparent: true, depthWrite: false, side: THREE.DoubleSide });

    const lavaTile = paintBlockTexture('lava');
    const lavaTex = dataTexture(lavaTile.data, 16, 16, true);
    this.lava = makeMaterial(/* glsl */ `
      uniform sampler2D lavaMap;
      void main() {
        vec2 uv = vUv * 0.5 + vec2(sin(vUv.y * 2.0 + time * 0.6) * 0.08, cos(vUv.x * 2.0 + time * 0.5) * 0.08) + vec2(0.0, time * 0.02);
        vec4 tex = texture2D(lavaMap, uv);
        vec3 col = tex.rgb * (0.85 + 0.15 * vShade);
        gl_FragColor = vec4(applyFog(col), 1.0);
      }
    `, { ...u, lavaMap: { value: lavaTex } } as TerrainUniforms);
  }
}

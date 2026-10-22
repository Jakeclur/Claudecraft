// Rendering: voxel shader (sun + sky + block light, AO, shadows, height fog), chunk meshes,
// sun shadow map, and an optional ray-marched volumetric light pass.
import * as THREE from '../vendor/three.module.js';
import { CHUNK } from './consts.js';

const CHUNK_VERT = /* glsl */`
  attribute vec4 light;
  uniform mat4 shadowMatrix;
  uniform float uTime;
  uniform float uWave;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec4 vShadow;
  vec3 faceNormal(float k) {
    int i = int(k * 255.0 / 40.0 + 0.5);
    if (i == 0) return vec3(1.0, 0.0, 0.0);
    if (i == 1) return vec3(-1.0, 0.0, 0.0);
    if (i == 2) return vec3(0.0, 0.0, 1.0);
    if (i == 3) return vec3(0.0, 0.0, -1.0);
    if (i == 4) return vec3(0.0, 1.0, 0.0);
    if (i == 5) return vec3(0.0, -1.0, 0.0);
    return vec3(0.0);
  }
  void main() {
    vUv = uv;
    vLight = light.xyz;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    if (uWave > 0.0) wp.y += sin(uTime * 1.7 + wp.x * 0.9 + wp.z * 0.7) * 0.04 - 0.04;
    vec3 n = faceNormal(light.w);
    vNormal = n;
    vWorld = wp.xyz;
    vec3 off = dot(n, n) < 0.5 ? vec3(0.0, 0.08, 0.0) : n * 0.06;
    vShadow = shadowMatrix * vec4(wp.xyz + off, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const CHUNK_FRAG = /* glsl */`
  uniform sampler2D map;
  uniform sampler2D shadowMap;
  uniform float uShadows;
  uniform float uShadowTexel;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunInt;
  uniform float uDay;
  uniform vec3 uSkyTint;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform float uHeightFog;
  uniform float uSea;
  uniform float uFlash;
  uniform float uOpacity;
  varying vec2 vUv;
  varying vec3 vLight;
  varying vec3 vWorld;
  varying vec3 vNormal;
  varying vec4 vShadow;

  float shadowAt(vec4 sc) {
    vec3 p = sc.xyz / sc.w * 0.5 + 0.5;
    if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
    float s = 0.0;
    for (int i = -1; i <= 1; i++) for (int j = -1; j <= 1; j++) {
      float d = texture2D(shadowMap, p.xy + vec2(float(i), float(j)) * uShadowTexel).r;
      s += p.z - 0.0012 <= d ? 1.0 : 0.0;
    }
    return s / 9.0;
  }

  void main() {
    vec4 t = texture2D(map, vUv);
    if (t.a < 0.5) discard;
    float sky = vLight.x, blk = vLight.y, ao = vLight.z;
    bool plant = dot(vNormal, vNormal) < 0.5;
    float ndl = plant ? 0.55 : dot(vNormal, uSunDir);
    float sh = 1.0;
    if (uShadows > 0.5 && ndl > 0.0 && sky > 0.2) sh = shadowAt(vShadow);
    vec3 amb = uSkyTint * sky * mix(0.2, 0.62, uDay);
    vec3 direct = uSunColor * uSunInt * max(ndl, 0.0) * sh * sky * sky;
    vec3 torch = vec3(1.0, 0.8, 0.56) * pow(blk, 0.7) * 1.05;
    vec3 lc = max(amb + direct, torch) + vec3(0.03, 0.03, 0.05) + vec3(0.75, 0.8, 1.0) * uFlash * sky;
    vec3 c = t.rgb * lc * ao;

    vec3 v = vWorld - cameraPosition;
    float dist = length(v);
    vec3 vd = v / max(dist, 0.001);
    float fd = dist * uFogDensity;
    float f = 1.0 - exp(-fd * fd);
    // fog pools in valleys and over water
    f += uHeightFog * exp(-max(0.0, vWorld.y - uSea) / 14.0) * (1.0 - exp(-dist * 0.025));
    f = clamp(f, 0.0, 1.0);
    float scatter = pow(max(dot(vd, uSunDir), 0.0), 8.0) * uSunInt;
    vec3 fogc = mix(uFogColor, uSunColor, scatter * 0.45);
    // in caves fog falls off into darkness instead of sky colour
    float cave = 1.0 - smoothstep(0.0, 0.45, sky);
    fogc = mix(fogc, uFogColor * 0.1, cave * 0.9);
    gl_FragColor = vec4(mix(c, fogc, f), uOpacity);
  }
`;

const DEPTH_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const DEPTH_FRAG = `uniform sampler2D map; varying vec2 vUv; void main() { if (texture2D(map, vUv).a < 0.5) discard; gl_FragColor = vec4(1.0); }`;

const POST_VERT = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const POST_FRAG = /* glsl */`
  uniform sampler2D tColor;
  uniform sampler2D tDepth;
  uniform sampler2D shadowMap;
  uniform mat4 projInv;
  uniform mat4 camWorld;
  uniform mat4 shadowMatrix;
  uniform vec3 camPos;
  uniform vec3 sunDir;
  uniform vec3 sunColor;
  uniform float sunInt;
  uniform float density;
  uniform float maxDist;
  uniform float underwater;
  varying vec2 vUv;
  vec3 worldAt(vec2 uv, float d) {
    vec4 v = projInv * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
    v /= v.w;
    return (camWorld * v).xyz;
  }
  void main() {
    vec4 col = texture2D(tColor, vUv);
    float d = texture2D(tDepth, vUv).r;
    vec3 wp = worldAt(vUv, d);
    vec3 rd = wp - camPos;
    float len = min(length(rd), maxDist);
    rd = normalize(rd);
    float jitter = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    const int N = 14;
    float stepL = len / float(N);
    float acc = 0.0;
    for (int i = 0; i < N; i++) {
      vec3 p = camPos + rd * (float(i) + jitter) * stepL;
      vec4 sc = shadowMatrix * vec4(p, 1.0);
      vec3 s = sc.xyz / sc.w * 0.5 + 0.5;
      float lit = 1.0;
      if (s.x > 0.0 && s.x < 1.0 && s.y > 0.0 && s.y < 1.0 && s.z < 1.0) lit = s.z - 0.002 <= texture2D(shadowMap, s.xy).r ? 1.0 : 0.0;
      acc += lit;
    }
    acc /= float(N);
    float phase = 0.22 + pow(max(dot(rd, sunDir), 0.0), 6.0) * 1.7;
    float amount = (1.0 - exp(-len * density)) * phase * sunInt;
    vec3 tint = mix(sunColor, vec3(0.3, 0.7, 0.9), underwater);
    col.rgb += tint * acc * amount * (0.55 + underwater);
    gl_FragColor = col;
  }
`;

export function makeMaterials(atlasCanvas) {
  const tex = new THREE.CanvasTexture(atlasCanvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  const shared = {
    map: { value: tex }, uTime: { value: 0 }, uDay: { value: 1 },
    uSkyTint: { value: new THREE.Vector3(1, 1, 1) }, uFogColor: { value: new THREE.Vector3(0.56, 0.83, 1) },
    uFogDensity: { value: 0.008 }, uHeightFog: { value: 0.15 }, uSea: { value: 48 }, uFlash: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0.3, 0.9, 0.2).normalize() }, uSunColor: { value: new THREE.Vector3(1, 0.95, 0.85) },
    uSunInt: { value: 0.6 }, uShadows: { value: 0 }, uShadowTexel: { value: 1 / 2048 },
    shadowMap: { value: null }, shadowMatrix: { value: new THREE.Matrix4() },
  };
  const solid = new THREE.ShaderMaterial({ uniforms: { ...shared, uOpacity: { value: 1 }, uWave: { value: 0 } }, vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG });
  const water = new THREE.ShaderMaterial({
    uniforms: { ...shared, uOpacity: { value: 0.74 }, uWave: { value: 1 } }, vertexShader: CHUNK_VERT, fragmentShader: CHUNK_FRAG,
    transparent: true, depthWrite: false,
  });
  const depth = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: DEPTH_VERT, fragmentShader: DEPTH_FRAG });
  return { solid, water, depth, shared, tex };
}

/* ------------------------------------------------------------------ */
/* Chunk meshes                                                        */
/* ------------------------------------------------------------------ */
function geometryFrom(d) {
  if (!d) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(d.uv, 2, true));
  g.setAttribute('light', new THREE.BufferAttribute(d.light, 4, true));
  g.setIndex(new THREE.BufferAttribute(d.index, 1));
  g.computeBoundingSphere();
  return g;
}

export class ChunkMeshes {
  constructor(scene, mats) { this.scene = scene; this.mats = mats; this.map = new Map(); }
  set(chunk, data) {
    this.remove(chunk);
    const meshes = [];
    const add = (g, mat, order) => {
      if (!g) return;
      const m = new THREE.Mesh(g, mat);
      m.position.set(chunk.cx * CHUNK, 0, chunk.cz * CHUNK);
      m.scale.setScalar(1 / 16);
      m.updateMatrix(); m.matrixAutoUpdate = false;
      m.renderOrder = order;
      m.layers.enable(1);
      if (mat === this.mats.water) m.layers.disable(1);
      this.scene.add(m);
      meshes.push(m);
    };
    add(geometryFrom(data.solid), this.mats.solid, 0);
    add(geometryFrom(data.water), this.mats.water, 1);
    this.map.set(chunk.key, meshes);
  }
  remove(chunk) {
    const old = this.map.get(chunk.key);
    if (!old) return;
    for (const m of old) { this.scene.remove(m); m.geometry.dispose(); }
    this.map.delete(chunk.key);
  }
  clear() { for (const ms of this.map.values()) for (const m of ms) { this.scene.remove(m); m.geometry.dispose(); } this.map.clear(); }
  count() { return this.map.size; }
}

/* ------------------------------------------------------------------ */
/* Sun shadows                                                         */
/* ------------------------------------------------------------------ */
export class Shadows {
  constructor(mats) {
    this.mats = mats;
    this.size = 0;
    this.extent = 72;
    this.cam = new THREE.OrthographicCamera(-72, 72, 72, -72, 1, 420);
    this.matrix = new THREE.Matrix4();
    this.entityMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  }
  configure(size, extent) {
    if (size === this.size && extent === this.extent) return;
    this.rt?.dispose();
    this.size = size; this.extent = extent;
    if (!size) { this.rt = null; this.mats.shared.shadowMap.value = null; return; }
    this.rt = new THREE.WebGLRenderTarget(size, size, { depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(size, size);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.cam.left = -extent; this.cam.right = extent; this.cam.top = extent; this.cam.bottom = -extent;
    this.cam.updateProjectionMatrix();
    this.mats.shared.shadowMap.value = this.rt.depthTexture;
    this.mats.shared.uShadowTexel.value = 1 / size;
  }
  render(renderer, scene, centre, sunDir) {
    if (!this.rt) return;
    const cam = this.cam;
    cam.position.copy(centre).addScaledVector(sunDir, 200);
    cam.up.set(0, 1, 0);
    if (Math.abs(sunDir.y) > 0.99) cam.up.set(0, 0, 1);
    cam.lookAt(centre);
    cam.updateMatrixWorld();
    // snap to whole shadow texels so edges don't shimmer as you walk
    const texel = (this.extent * 2) / this.size;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const cx = centre.dot(right), cy = centre.dot(up);
    cam.position.addScaledVector(right, Math.round(cx / texel) * texel - cx).addScaledVector(up, Math.round(cy / texel) * texel - cy);
    cam.updateMatrixWorld();
    this.matrix.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    this.mats.shared.shadowMatrix.value.copy(this.matrix);

    const prevOverride = scene.overrideMaterial, prevBg = scene.background;
    scene.background = null;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    cam.layers.set(1); scene.overrideMaterial = this.mats.depth;
    renderer.render(scene, cam);
    renderer.autoClear = false;
    cam.layers.set(2); scene.overrideMaterial = this.entityMat;
    renderer.render(scene, cam);
    renderer.autoClear = true;
    scene.overrideMaterial = prevOverride; scene.background = prevBg;
    renderer.setRenderTarget(null);
  }
}

/* ------------------------------------------------------------------ */
/* Volumetric light (god rays through fog)                             */
/* ------------------------------------------------------------------ */
export class Volumetric {
  constructor() {
    this.rt = null;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, shadowMap: { value: null },
        projInv: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, shadowMatrix: { value: new THREE.Matrix4() },
        camPos: { value: new THREE.Vector3() }, sunDir: { value: new THREE.Vector3() }, sunColor: { value: new THREE.Vector3() },
        sunInt: { value: 0 }, density: { value: 0.02 }, maxDist: { value: 90 }, underwater: { value: 0 },
      },
      vertexShader: POST_VERT, fragmentShader: POST_FRAG, depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene(); this.scene.add(this.quad);
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  ensure(w, h) {
    if (this.rt && this.rt.width === w && this.rt.height === h) return;
    this.rt?.dispose();
    this.rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    this.rt.depthTexture = new THREE.DepthTexture(w, h);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
  }
  begin(renderer) {
    const s = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.ensure(s.x, s.y);
    renderer.setRenderTarget(this.rt);
  }
  finish(renderer, camera, shared, underwater) {
    renderer.setRenderTarget(null);
    const u = this.mat.uniforms;
    u.tColor.value = this.rt.texture; u.tDepth.value = this.rt.depthTexture;
    u.shadowMap.value = shared.shadowMap.value;
    u.projInv.value.copy(camera.projectionMatrixInverse);
    u.camWorld.value.copy(camera.matrixWorld);
    u.shadowMatrix.value.copy(shared.shadowMatrix.value);
    u.camPos.value.copy(camera.position);
    u.sunDir.value.copy(shared.uSunDir.value);
    u.sunColor.value.copy(shared.uSunColor.value);
    u.sunInt.value = shared.uSunInt.value * (shared.shadowMap.value ? 1 : 0);
    u.density.value = 0.012 + shared.uHeightFog.value * 0.05 + (underwater ? 0.05 : 0);
    u.underwater.value = underwater ? 1 : 0;
    renderer.render(this.scene, this.cam);
  }
}

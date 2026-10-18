// Volumetric raymarched fire. Burning log segments are splatted into a small 3D flame field each frame,
// then the raymarcher erodes that field with advected noise into licking tongues.
import * as THREE from 'three';
import { GLSL_COMMON, fbm1 } from './noise.js';

export const MAXS = 14;
const NX = 64, NY = 48, NZ = 64, TX = 8, TY = 8;

const VERT = /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}
`;

const QUAD_VERT = /* glsl */`
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FIELD_FRAG = /* glsl */`
#define MAXS ${MAXS}
uniform vec3 boxMin; uniform vec3 boxMax;
uniform vec4 segA[MAXS]; uniform vec4 segB[MAXS]; uniform vec4 segP[MAXS];
uniform int segCount;
uniform vec4 plume; uniform vec4 plumeP;
uniform vec3 wind; uniform float baseY;

vec2 field(vec3 p, float pad) {
  float f = 0.0; float hmax = 0.0;
  float hb = max(p.y - baseY, 0.0);
  vec2 pxz = p.xz - wind.xz * hb * (0.5 + 0.3 * hb);
  for (int i = 0; i < MAXS; i++) {
    if (i >= segCount) break;
    vec3 a = segA[i].xyz, b = segB[i].xyz;
    vec2 ab = b.xz - a.xz;
    float l2 = dot(ab, ab);
    float t = l2 > 1e-5 ? clamp(dot(pxz - a.xz, ab) / l2, 0.0, 1.0) : 0.5;
    vec3 c = mix(a, b, t);
    float heat = mix(segA[i].w, segB[i].w, t);
    heat *= heat;
    if (heat <= 0.001) continue;
    float H = segP[i].y * (0.35 + 0.65 * heat) * segP[i].w;
    float h = p.y - c.y - segP[i].x * 0.55;
    float hn = h / H;
    if (hn < -0.18 || hn > 1.2) continue;
    float w = segP[i].z * (0.55 + 0.45 * heat) * pow(clamp(1.0 - hn, 0.0, 1.0), 0.55) * smoothstep(-0.14, 0.1, hn) + pad;
    float d = length(pxz - c.xz);
    float ends = smoothstep(0.0, 0.12, t * (1.0 - t) * 4.0 + 0.05);
    float k = heat * smoothstep(w, w * 0.15, d) * ends;
    f += k;
    hmax = max(hmax, k * clamp(hn, 0.0, 1.0));
  }
  if (plume.w > 0.001) {
    float hn = (p.y - plume.y) / plumeP.x;
    if (hn > -0.25 && hn < 1.2) {
      float w = plumeP.y * pow(clamp(1.0 - hn, 0.0, 1.0), 0.6) * smoothstep(-0.2, 0.15, hn) + pad;
      float k = plume.w * smoothstep(w, w * 0.1, length(pxz - plume.xz));
      f += k;
      hmax = max(hmax, k * clamp(hn, 0.0, 1.0));
    }
  }
  return vec2(f, hmax);
}

void main() {
  vec2 px = gl_FragCoord.xy - 0.5;
  vec2 tile = floor(px / vec2(${NX}.0, ${NY}.0));
  vec2 inT = px - tile * vec2(${NX}.0, ${NY}.0);
  float z = tile.y * ${TX}.0 + tile.x;
  vec3 u = vec3((inT + 0.5) / vec2(${NX}.0, ${NY}.0), (z + 0.5) / ${NZ}.0);
  vec3 p = boxMin + u * (boxMax - boxMin);
  vec2 f0 = field(p, 0.0);
  float fc = field(p, 0.1).x;
  gl_FragColor = vec4(f0, fc, 1.0);
}
`;

const FRAG = /* glsl */`
precision highp sampler3D;
uniform sampler3D tNoise;
uniform sampler2D tField;
uniform sampler2D tDepth;
uniform vec2 resolution;
uniform float cNear; uniform float cFar;
uniform vec3 boxMin; uniform vec3 boxMax;
uniform vec3 camFwd;
uniform float time; uniform float baseY; uniform float steps; uniform float brightness; uniform float topY;
varying vec3 vWorld;
${GLSL_COMMON}

float viewDist(float d) { float z = d * 2.0 - 1.0; return 2.0 * cNear * cFar / (cFar + cNear - z * (cFar - cNear)); }

const vec2 TILE = vec2(${NX}.0, ${NY}.0);
const vec2 TILES = vec2(${TX}.0, ${TY}.0);
vec4 fieldAt(vec3 p) {
  vec3 bs = boxMax - boxMin;
  vec3 ur = (p - boxMin) / bs;
  vec3 dm = min(ur, 1.0 - ur) * bs;
  float edge = smoothstep(0.0, 0.12, min(min(dm.x, dm.z), dm.y + 0.12));
  vec3 u = clamp(ur, 0.0, 1.0);
  float zf = u.z * ${NZ}.0 - 0.5;
  float z0 = clamp(floor(zf), 0.0, ${NZ - 1}.0);
  float z1 = min(z0 + 1.0, ${NZ - 1}.0);
  float fz = clamp(zf - z0, 0.0, 1.0);
  vec2 inT = clamp(u.xy * TILE, vec2(0.5), TILE - 0.5);
  vec2 t0 = vec2(mod(z0, TILES.x), floor(z0 / TILES.x));
  vec2 t1 = vec2(mod(z1, TILES.x), floor(z1 / TILES.x));
  vec2 inv = 1.0 / (TILE * TILES);
  return mix(texture2D(tField, (t0 * TILE + inT) * inv), texture2D(tField, (t1 * TILE + inT) * inv), fz) * edge;
}

void main() {
  vec3 ro = cameraPosition;
  vec3 rd = normalize(vWorld - ro);
  vec3 inv = 1.0 / rd;
  vec3 t0 = (boxMin - ro) * inv, t1 = (boxMax - ro) * inv;
  vec3 tmn = min(t0, t1), tmx = max(t0, t1);
  float tn = max(max(max(tmn.x, tmn.y), tmn.z), 0.0);
  float tf = min(min(tmx.x, tmx.y), tmx.z);
  vec2 suv = gl_FragCoord.xy / resolution;
  float sd = viewDist(texture2D(tDepth, suv).r);
  float tScene = sd / max(dot(rd, camFwd), 1e-3);
  tf = min(tf, tScene);
  if (tf <= tn) discard;
  float len = tf - tn;
  float n = min(steps, ceil(len / 0.012));
  float dt = len / n;
  float jit = ign(gl_FragCoord.xy + fract(time * 13.7) * 41.0);
  float t = tn + dt * jit;
  vec3 col = vec3(0.0);
  float trans = 1.0;
  float flameTop = max(topY - baseY, 0.2);
  for (int i = 0; i < 128; i++) {
    if (float(i) >= n * 1.0 || t > tf) break;
    vec3 p = ro + rd * t;
    float coarse = fieldAt(p).b;
    if (coarse > 0.003) {
      float hr = clamp((p.y - baseY) / flameTop, 0.0, 1.2);
      vec3 q = p * 1.35;
      vec3 w1 = texture(tNoise, vec3(q.x * 0.5, q.y * 0.32 - time * 0.45, q.z * 0.5 + time * 0.02)).rgb - 0.5;
      vec3 w2 = texture(tNoise, vec3(q.x * 1.5, q.y * 0.9 - time * 1.7, q.z * 1.5) + w1 * 0.6).rgb - 0.5;
      vec3 pw = p + (w1 * (0.07 + 0.2 * hr) + w2 * (0.02 + 0.07 * hr)) * vec3(1.0, 0.55, 1.0);
      vec2 F = fieldAt(pw).rg;
      if (F.x > 0.002) {
        float body = 1.0 - exp(-F.x * 1.6);
        vec4 c4 = texture(tNoise, vec3(q.x * 1.2, q.y * 0.8 - time * 2.1, q.z * 1.2) + w2 * 0.9);
        float cell = c4.a * 0.7 + c4.g * 0.3;
        float hh = hr * hr * 0.6 + hr * 0.6;
        float gap = smoothstep(0.45, 0.75, texture(tNoise, vec3(q.x * 2.2, q.y * 1.1 - time * 2.6, q.z * 2.2) + w1).a);
        float lick = smoothstep(0.35, 0.7, texture(tNoise, vec3(q.x * 3.2, q.y * 0.9 - time * 1.9, q.z * 3.2) + w2 * 0.5).r);
        float edge = body - (cell * 0.7 + 0.12) * hh * 1.25 - 0.1 - (1.0 - cell) * 0.08 - gap * (0.12 + 0.25 * hr) - lick * 0.22 * (1.0 - hr);
        float dens = smoothstep(0.0, 0.06, edge);
        if (dens > 0.001) {
          float core = clamp(edge * 2.4, 0.0, 1.0);
          float temp = (core * (1.08 - 0.62 * hr) + 0.16 * (1.0 - hr)) * mix(0.55, 1.0, smoothstep(0.15, 0.65, body));
          float e = (0.06 + pow(clamp(temp, 0.0, 1.2), 2.4) * 1.6) * brightness;
          vec3 c = blackbody(temp);
          float baseBlue = smoothstep(0.1, 0.0, F.y) * smoothstep(0.25, 0.7, body) * (1.0 - hr) * 0.35;
          c = mix(c, vec3(0.25, 0.4, 1.0), baseBlue);
          col += c * e * dens * dt * trans * 16.0;
          trans *= exp(-dens * dt * 3.0);
          if (trans < 0.03) break;
        }
      }
      t += dt;
    } else {
      t += dt * 2.0;
    }
  }
  gl_FragColor = vec4(col, 0.0);
}
`;

export class Fire {
  constructor(noiseTex, depthTex) {
    const segA = [], segB = [], segP = [];
    for (let i = 0; i < MAXS; i++) { segA.push(new THREE.Vector4()); segB.push(new THREE.Vector4()); segP.push(new THREE.Vector4()); }
    this.fieldRT = new THREE.WebGLRenderTarget(NX * TX, NY * TY, { type: THREE.HalfFloatType, depthBuffer: false });
    const ft = this.fieldRT.texture;
    ft.minFilter = ft.magFilter = THREE.LinearFilter;
    ft.generateMipmaps = false;
    const shared = {
      boxMin: { value: new THREE.Vector3(-1, 0, -1) }, boxMax: { value: new THREE.Vector3(1, 1.5, 1) },
      baseY: { value: 0 },
    };
    this.fieldUniforms = {
      ...shared,
      segA: { value: segA }, segB: { value: segB }, segP: { value: segP }, segCount: { value: 0 },
      plume: { value: new THREE.Vector4() }, plumeP: { value: new THREE.Vector4(0.8, 0.25, 0, 0) },
      wind: { value: new THREE.Vector3() },
    };
    this.uniforms = {
      ...shared,
      tNoise: { value: noiseTex }, tDepth: { value: depthTex }, tField: { value: ft },
      resolution: { value: new THREE.Vector2(1, 1) }, cNear: { value: 0.05 }, cFar: { value: 200 },
      camFwd: { value: new THREE.Vector3(0, 0, -1) }, time: { value: 0 }, steps: { value: 80 },
      brightness: { value: 1.0 }, topY: { value: 1.0 },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      side: THREE.BackSide, depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
    this.fieldScene = new THREE.Scene();
    this.fieldCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const q = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: FIELD_FRAG, uniforms: this.fieldUniforms, depthTest: false, depthWrite: false,
    }));
    q.frustumCulled = false;
    this.fieldScene.add(q);
    this.top = 0.5;
  }

  renderField(renderer) {
    if (!this.mesh.visible) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.fieldRT);
    renderer.render(this.fieldScene, this.fieldCam);
    renderer.setRenderTarget(prev);
  }

  setSources(sources, plume, wind, time) {
    const u = this.fieldUniforms;
    sources = sources.filter((s) => Math.max(s.ha, s.hb) > 0.02);
    sources.sort((a, b) => Math.max(b.ha, b.hb) - Math.max(a.ha, a.hb));
    const n = Math.min(sources.length, MAXS);
    const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9);
    let top = 0;
    for (let i = 0; i < n; i++) {
      const s = sources[i];
      u.segA.value[i].set(s.a.x, s.a.y, s.a.z, s.ha);
      u.segB.value[i].set(s.b.x, s.b.y, s.b.z, s.hb);
      const hv = 0.55 + 0.9 * (0.5 + 0.5 * fbm1(time * 0.55 + i * 3.7 + s.a.x * 2.0));
      u.segP.value[i].set(s.r, s.H, s.w, hv);
      const pad = s.w + 0.3;
      for (const p of [s.a, s.b]) {
        mn.x = Math.min(mn.x, p.x - pad); mn.z = Math.min(mn.z, p.z - pad); mn.y = Math.min(mn.y, p.y - s.r - 0.05);
        mx.x = Math.max(mx.x, p.x + pad); mx.z = Math.max(mx.z, p.z + pad);
        top = Math.max(top, p.y + s.H * 1.5);
      }
    }
    u.segCount.value = n;
    if (plume && plume.w > 0.001) {
      u.plume.value.copy(plume);
      u.plumeP.value.set(plume.H * (0.75 + 0.5 * (0.5 + 0.5 * fbm1(time * 0.45 + 17.0))), plume.R, 0, 0);
      mn.x = Math.min(mn.x, plume.x - plume.R - 0.35); mx.x = Math.max(mx.x, plume.x + plume.R + 0.35);
      mn.z = Math.min(mn.z, plume.z - plume.R - 0.35); mx.z = Math.max(mx.z, plume.z + plume.R + 0.35);
      mn.y = Math.min(mn.y, plume.y - 0.05); top = Math.max(top, plume.y + plume.H * 1.35);
    } else u.plume.value.set(0, 0, 0, 0);
    const any = n > 0 || (plume && plume.w > 0.001);
    this.mesh.visible = any;
    if (!any) return;
    const hgt = Math.max(top - mn.y, 0);
    const lean = Math.hypot(wind.x, wind.z) * hgt * (0.5 + 0.3 * hgt) + 0.08;
    mn.x -= lean; mn.z -= lean; mx.x += lean; mx.z += lean;
    mx.y = top + 0.25;
    mn.y = Math.max(mn.y, -0.05);
    u.boxMin.value.copy(mn); u.boxMax.value.copy(mx);
    this.uniforms.topY.value = top;
    u.baseY.value = mn.y;
    this.top = top;
    this.mesh.position.set((mn.x + mx.x) / 2, (mn.y + mx.y) / 2, (mn.z + mx.z) / 2);
    this.mesh.scale.set(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z);
    this.mesh.updateMatrixWorld();
    u.wind.value.copy(wind);
    this.uniforms.time.value = time;
  }
}

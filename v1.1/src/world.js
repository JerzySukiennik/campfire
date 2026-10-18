// The clearing: sky, forest floor with ash bed and coals, stone ring, forest, grass, props and lights.
import * as THREE from 'three';
import { mergeVertices, mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { GLSL_COMMON, mulberry32, noise3 } from './noise.js';
import { buildRoundLog, buildSplitLog, makeLogMaterial } from './logs.js';

export const MOON_DIR = new THREE.Vector3(-0.42, 0.3, -0.86).normalize();
export const FOG_COLOR = new THREE.Color(0.014, 0.018, 0.03);

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }
`;
const SKY_FRAG = /* glsl */`
precision highp sampler3D;
uniform sampler3D tNoise; uniform vec3 moonDir; uniform float time;
varying vec3 vDir;
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
vec3 stars(vec3 d, float scale, float thr, float gain) {
  vec3 sd = d * scale; vec3 cell = floor(sd); vec3 f = fract(sd);
  float r = h13(cell);
  if (r < thr) return vec3(0.0);
  vec3 c = vec3(h13(cell + 1.3), h13(cell + 2.7), h13(cell + 5.1)) * 0.5 + 0.25;
  float dist = length(f - c);
  float b = pow((r - thr) / (1.0 - thr), 2.5);
  float tw = 0.65 + 0.35 * sin(time * (1.5 + r * 7.0) + r * 91.0);
  float temp = h13(cell + 9.9);
  vec3 sc = mix(vec3(0.75, 0.82, 1.0), vec3(1.0, 0.85, 0.65), temp);
  return sc * smoothstep(0.16, 0.0, dist) * b * gain * tw;
}
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 horizon = vec3(0.020, 0.026, 0.044);
  vec3 zenith = vec3(0.0025, 0.0045, 0.012);
  vec3 col = mix(horizon, zenith, smoothstep(-0.02, 0.55, h));
  col += vec3(0.010, 0.006, 0.003) * exp(-max(h, 0.0) * 9.0) * smoothstep(0.0, 1.0, dot(normalize(d.xz + 1e-4), normalize(vec2(0.8, 0.6))));
  vec3 mwN = normalize(vec3(0.35, 0.55, 0.75));
  float mwd = dot(d, mwN);
  float mw = exp(-mwd * mwd / 0.035);
  float mwn = texture(tNoise, d * 1.3).r * 0.6 + texture(tNoise, d * 3.7).a * 0.4;
  float mwDust = smoothstep(0.35, 0.65, texture(tNoise, d * 2.4 + 0.3).g);
  col += vec3(0.010, 0.011, 0.016) * mw * smoothstep(0.3, 0.8, mwn) * (1.0 - mwDust * 0.7) * smoothstep(0.0, 0.25, h);
  if (h > -0.03) {
    col += stars(d, 260.0, 0.982 - mw * 0.01, 3.2);
    col += stars(d, 520.0, 0.975 - mw * 0.02, 1.4);
  }
  float md = dot(d, moonDir);
  float disc = smoothstep(0.999935, 0.99996, md);
  vec3 mp = d - moonDir * md;
  float maria = texture(tNoise, mp * 90.0 + 0.5).r;
  col = mix(col, vec3(1.0, 0.96, 0.88) * (1.2 + (maria - 0.5) * 0.9), disc);
  col += vec3(0.6, 0.65, 0.8) * (pow(max(md, 0.0), 2500.0) * 0.08 + pow(max(md, 0.0), 60.0) * 0.006);
  col *= smoothstep(-0.12, 0.0, h) * 0.85 + 0.15;
  gl_FragColor = vec4(col, 1.0);
}
`;

function stoneGeometry(seed) {
  let g = new THREE.IcosahedronGeometry(1, 4);
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g);
  const p = g.attributes.position;
  const so = seed * 13.1;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).normalize();
    const ridge = 1 - Math.abs(noise3(v.x * 5 + so, v.y * 5, v.z * 5));
    let d = 1 + noise3(v.x * 1.4 + so, v.y * 1.4, v.z * 1.4) * 0.3 + noise3(v.x * 3.5, v.y * 3.5 + so, v.z * 3.5) * 0.1 + ridge * ridge * 0.05 + noise3(v.x * 11 + so, v.y * 11, v.z * 11) * 0.03 + noise3(v.x * 24, v.y * 24 + so, v.z * 24) * 0.012;
    v.multiplyScalar(d);
    if (v.y < -0.35) v.y = -0.35 + (v.y + 0.35) * 0.3;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function radialGround() {
  const rings = [0, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.1, 1.3, 1.55, 1.8, 2.1, 2.5, 3, 3.6, 4.3, 5.2, 6.3, 7.6, 9.2, 11, 13.5, 16.5, 20, 25, 31, 38, 48, 60];
  const seg = 128;
  const pos = [], uv = [], idx = [];
  for (let r = 0; r < rings.length; r++) {
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      const R = rings[r];
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      const k = THREE.MathUtils.smoothstep(R, 4, 14);
      const y = k * (noise3(x * 0.12, 0, z * 0.12) * 1.6 + noise3(x * 0.4, 3, z * 0.4) * 0.3) + THREE.MathUtils.smoothstep(R, 1.6, 4) * noise3(x * 1.3, 7, z * 1.3) * 0.04;
      pos.push(x, y, z); uv.push(x / 2.5, z / 2.5);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) for (let s = 0; s < seg; s++) {
    const a = r * (seg + 1) + s, b = a + 1, c = a + seg + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function groundHeight(x, z) {
  const R = Math.hypot(x, z);
  const k = THREE.MathUtils.smoothstep(R, 4, 14);
  return k * (noise3(x * 0.12, 0, z * 0.12) * 1.6 + noise3(x * 0.4, 3, z * 0.4) * 0.3) + THREE.MathUtils.smoothstep(R, 1.6, 4) * noise3(x * 1.3, 7, z * 1.3) * 0.04;
}

function pineCanopy(seed) {
  const rnd = mulberry32(seed);
  const parts = [];
  const whorls = 10;
  for (let w = 0; w < whorls; w++) {
    const t = w / (whorls - 1);
    const R = Math.pow(1 - t, 0.85) * 1.0 + 0.06;
    const hh = 0.16 + (1 - t) * 0.1;
    const c = new THREE.ConeGeometry(R, hh, 18, 2, true);
    const p = c.attributes.position;
    const off = rnd() * 10;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      if (y < 0) {
        const j = 0.7 + 0.6 * Math.abs(Math.sin(a * 4.5 + off)) * (0.6 + rnd() * 0.4);
        p.setXYZ(i, x * j, y - j * 0.05 - rnd() * 0.03, z * j);
      } else if (y < hh / 2 - 1e-4) {
        const j = 0.85 + rnd() * 0.3;
        p.setXYZ(i, x * j, y, z * j);
      }
    }
    c.translate(0, t * 0.9 + hh / 2, 0);
    c.deleteAttribute('uv');
    parts.push(c);
  }
  const g = mergeGeometries(parts);
  g.computeVertexNormals();
  return g;
}

export class World {
  constructor({ scene, physics, noiseTex, atlases, tex, quality }) {
    this.scene = scene;
    this.tex = tex;
    this.noiseTex = noiseTex;
    this.time = { value: 0 };
    this.coalHeat = { value: 0.8 };
    this.windU = { value: new THREE.Vector3() };
    this.pickables = {};
    this.buildLights(quality);
    this.buildSky();
    this.buildGround();
    this.buildStones(physics);
    this.buildCoals();
    this.buildForest(quality);
    this.buildGrass(quality);
    this.buildProps(physics, atlases);
    scene.fog = new THREE.FogExp2(FOG_COLOR, 0.04);
  }

  buildLights(q) {
    const fl = new THREE.PointLight(0xff8a3c, 20, 0, 2);
    fl.color.setRGB(1.0, 0.40, 0.12);
    fl.castShadow = true;
    fl.shadow.mapSize.set(q.shadow, q.shadow);
    fl.shadow.camera.near = 0.04; fl.shadow.camera.far = 40;
    fl.shadow.bias = -0.0025; fl.shadow.normalBias = 0.025; fl.shadow.radius = 3;
    fl.position.set(0, 0.45, 0);
    this.scene.add(fl);
    this.fireLight = fl;
    const cl = new THREE.PointLight(0xff5020, 2, 0, 2);
    cl.color.setRGB(1.0, 0.25, 0.06);
    cl.position.set(0, 0.06, 0);
    this.scene.add(cl);
    this.coalLight = cl;
    const moon = new THREE.DirectionalLight(0x9fb4ff, 0.12);
    moon.position.copy(MOON_DIR).multiplyScalar(30);
    this.scene.add(moon);
    this.moon = moon;
    const hemi = new THREE.HemisphereLight(0x2a3a66, 0x0c0a08, 0.1);
    this.scene.add(hemi);
  }

  buildSky() {
    const m = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      uniforms: { tNoise: { value: this.noiseTex }, moonDir: { value: MOON_DIR }, time: this.time },
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(100, 48, 24), m);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -1;
    this.scene.add(this.sky);
  }

  buildGround() {
    const ff = this.tex.floor;
    const ash = this.tex.ash;
    const mat = new THREE.MeshStandardMaterial({ map: ff.map, normalMap: ff.normalMap, roughness: 0.95, metalness: 0 });
    mat.normalScale.set(1.4, 1.4);
    const u = { tAsh: { value: ash.map }, tAshN: { value: ash.normalMap }, tNoise: { value: this.noiseTex }, uCoalHeat: this.coalHeat, uTime: this.time, uCoalR: { value: 0.4 } };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vGW;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
precision highp sampler3D;
uniform sampler2D tAsh; uniform sampler2D tAshN; uniform sampler3D tNoise; uniform float uCoalHeat; uniform float uTime; uniform float uCoalR;
varying vec3 vGW;
${GLSL_COMMON}
float gAshM; float gR; float gN;`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  gR = length(vGW.xz);
  gN = texture(tNoise, vec3(vGW.xz * 0.9, 0.3)).r;
  float n2 = texture(tNoise, vec3(vGW.xz * 3.1, 0.7)).a;
  vec3 ash = texture2D(tAsh, vGW.xz * 1.4).rgb;
  gAshM = 1.0 - smoothstep(0.40, 0.72, gR + (gN - 0.5) * 0.22);
  float scorch = 1.0 - smoothstep(0.55, 1.35, gR + (gN - 0.5) * 0.45 + (n2 - 0.5) * 0.15);
  diffuseColor.rgb *= mix(1.0, 0.35, scorch);
  diffuseColor.rgb = mix(diffuseColor.rgb, ash * 0.9, gAshM);
}`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mix(normal, nonPerturbedNormal, gAshM * 0.75));`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float coalM = 1.0 - smoothstep(uCoalR * 0.45, uCoalR * 1.05, gR + (gN - 0.5) * 0.12);
  if (coalM > 0.0 && uCoalHeat > 0.01) {
    vec2 wp = vGW.xz + (texture(tNoise, vec3(vGW.xz * 3.0, 0.5)).rg - 0.5) * 0.05;
    vec2 vo = voronoiEdge(wp / 0.022);
    vec2 vo2 = voronoiEdge(wp / 0.0085 + 7.0);
    float lump = smoothstep(0.0, 0.35, vo.x) * smoothstep(0.18, 0.32, vo.y) * (0.3 + 0.7 * vo.y);
    lump *= 0.55 + 0.45 * smoothstep(0.0, 0.22, vo2.x);
    float br = texture(tNoise, vec3(vGW.xz * 2.0, uTime * 0.05)).b;
    float br2 = texture(tNoise, vec3(vGW.xz * 4.5 + 3.0, uTime * 0.12)).g;
    float hot = smoothstep(0.42, 0.85, br * 0.6 + br2 * 0.5 + (1.0 - gR / uCoalR) * 0.3);
    float temp = uCoalHeat * coalM * mix(0.35, 1.0, lump) * hot;
    totalEmissiveRadiance += blackbody(temp) * pow(temp, 2.4) * 4.5;
  }
}`);
    };
    const g = new THREE.Mesh(radialGround(), mat);
    g.receiveShadow = true;
    this.scene.add(g);
    this.ground = g;
  }

  buildStones(physics) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.tNoise = { value: this.noiseTex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vSW; varying vec3 vSN;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSW = (modelMatrix * vec4(transformed, 1.0)).xyz;')
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvSN = normalize(mat3(modelMatrix) * objectNormal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nprecision highp sampler3D;\nuniform sampler3D tNoise;\nvarying vec3 vSW; varying vec3 vSN;')
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{
  float bh = texture(tNoise, vSW * 9.0).a * 0.55 + texture(tNoise, vSW * 26.0 + 0.4).r * 0.3 + texture(tNoise, vSW * 70.0).g * 0.15;
  vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
  vec2 dh = vec2(dFdx(bh), dFdy(bh)) * 0.006;
  vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
  float det = dot(sx, r1) * faceDirection;
  vec3 grad = sign(det) * (dh.x * r1 + dh.y * r2);
  normal = normalize(abs(det) * normal - grad);
}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float n1 = texture(tNoise, vSW * 4.0).r;
  float n2 = texture(tNoise, vSW * 14.0 + 0.3).a;
  float n3 = texture(tNoise, vSW * 41.0 + 0.7).g;
  vec3 base = mix(vec3(0.07, 0.068, 0.066), vec3(0.2, 0.19, 0.175), smoothstep(0.25, 0.8, n1));
  base *= 0.75 + 0.5 * n2;
  base = mix(base, vec3(0.02), smoothstep(0.58, 0.68, n3) * 0.8);
  base = mix(base, vec3(0.34, 0.32, 0.29), smoothstep(0.7, 0.78, n2) * 0.45);
  vec3 toC = normalize(vec3(-vSW.x, 0.0, -vSW.z));
  float inward = dot(vSN, toC);
  float soot = smoothstep(-0.1, 0.7, inward + (n1 - 0.5) * 0.6) * smoothstep(0.75, 0.45, length(vSW.xz));
  base = mix(base, vec3(0.018, 0.016, 0.015), soot * 0.92);
  float moss = smoothstep(0.55, 0.75, vSN.y + (n2 - 0.5) * 0.8) * (1.0 - soot) * smoothstep(0.4, 0.7, n1);
  base = mix(base, vec3(0.05, 0.07, 0.025), moss * 0.6);
  diffuseColor.rgb = base;
}`);
    };
    const rnd = mulberry32(42);
    const N = 13;
    this.stones = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.18;
      const d = 0.6 + (rnd() - 0.5) * 0.06;
      const sx = 0.1 + rnd() * 0.06, sy = 0.075 + rnd() * 0.05, sz = 0.085 + rnd() * 0.04;
      const geo = stoneGeometry(i + 3);
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(sx, sy, sz);
      m.position.set(Math.cos(a) * d, sy * 0.38, Math.sin(a) * d);
      m.rotation.y = -a + (rnd() - 0.5) * 0.6;
      m.rotation.z = (rnd() - 0.5) * 0.2;
      m.castShadow = true; m.receiveShadow = true;
      m.updateMatrixWorld();
      this.scene.add(m);
      this.stones.push(m);
      const p = geo.attributes.position;
      const pts = new Float32Array(p.count * 3);
      const v = new THREE.Vector3();
      for (let k = 0; k < p.count; k++) { v.fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld); pts[k * 3] = v.x; pts[k * 3 + 1] = v.y; pts[k * 3 + 2] = v.z; }
      physics.fixedHull(pts);
    }
  }

  buildCoals() {
    let g = new THREE.IcosahedronGeometry(1, 2);
    g.deleteAttribute('normal'); g.deleteAttribute('uv');
    g = mergeVertices(g);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const d = 1 + noise3(x * 2.1, y * 2.1, z * 2.1) * 0.45 + noise3(x * 6, y * 6 + 3, z * 6) * 0.12;
      p.setXYZ(i, x * d * 1.3, y * d * 0.55, z * d * 0.8);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ color: 0x0a0909, roughness: 0.95 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, { tNoise: { value: this.noiseTex }, uCoalHeat: this.coalHeat, uTime: this.time });
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vInst; varying vec3 vObj; varying float vUp;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvInst = instanceMatrix[3].xyz; vObj = position; vUp = normal.y;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
precision highp sampler3D;
uniform sampler3D tNoise; uniform float uCoalHeat; uniform float uTime;
varying vec3 vInst; varying vec3 vObj; varying float vUp;
${GLSL_COMMON}`)
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float n = texture(tNoise, vObj * 0.7 + vInst * 9.0).a;
  diffuseColor.rgb = mix(vec3(0.018, 0.016, 0.015), vec3(0.32, 0.31, 0.29), smoothstep(0.55, 0.8, n) * smoothstep(0.0, 0.8, vUp));
}`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float r = length(vInst.xz) / 0.38;
  float hot = uCoalHeat * smoothstep(1.1, 0.25, r);
  float br = texture(tNoise, vec3(vInst.xz * 3.0, uTime * 0.07) + vObj * 0.6).b;
  vec2 vo = voronoiEdge(vObj.xz * 2.2 + vInst.xz * 61.0);
  float crack = 1.0 - smoothstep(0.0, 0.18, vo.x);
  float ash = smoothstep(0.55, 0.8, texture(tNoise, vObj * 0.7 + vInst * 9.0).a) * smoothstep(0.0, 0.8, vUp);
  float temp = hot * clamp(0.15 + 1.4 * br - 0.35, 0.0, 1.4) * (0.35 + crack * 0.9) * (1.0 - ash * 0.7) * (0.75 + 0.25 * (1.0 - vUp));
  totalEmissiveRadiance += blackbody(temp) * pow(temp, 2.0) * 6.5;
}`);
    };
    const N = 90;
    const mesh = new THREE.InstancedMesh(g, mat, N);
    const rnd = mulberry32(8);
    const M = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    for (let i = 0; i < N; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.37;
      const s = 0.012 + rnd() * rnd() * 0.03;
      e.set((rnd() - 0.5) * 0.6, rnd() * 6.3, (rnd() - 0.5) * 0.6);
      q.setFromEuler(e);
      M.compose(new THREE.Vector3(Math.cos(a) * r, s * 0.25, Math.sin(a) * r), q, new THREE.Vector3(s * (0.8 + rnd() * 0.6), s, s * (0.8 + rnd() * 0.6)));
      mesh.setMatrixAt(i, M);
    }
    mesh.castShadow = false; mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.coals = mesh;
  }

  buildForest(q) {
    const bark = { map: this.tex.bark.map.clone(), normalMap: this.tex.bark.normalMap.clone() };
    bark.map.repeat.set(3, 10); bark.normalMap.repeat.set(3, 10);
    const tmat = new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.92 });
    let tg = new THREE.CylinderGeometry(0.55, 1, 1, 14, 12, true);
    tg.translate(0, 0.5, 0);
    const p = tg.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const a = Math.atan2(z, x);
      const flare = 1 + 0.9 * Math.exp(-y * 28) + noise3(Math.cos(a) * 2, y * 8, Math.sin(a) * 2) * 0.08;
      p.setXYZ(i, x * flare, y, z * flare);
    }
    tg.computeVertexNormals();
    const cmat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.022, 0.04, 0.025), roughness: 0.95, side: THREE.DoubleSide });
    const canopy = pineCanopy(5);
    const rnd = mulberry32(11);
    const trees = [];
    const tryAdd = (rmin, rmax, minD, n, kind) => {
      let tries = 0;
      while (n > 0 && tries++ < 6000) {
        const a = rnd() * Math.PI * 2, r = rmin + Math.sqrt(rnd()) * (rmax - rmin);
        const x = Math.cos(a) * r, z = Math.sin(a) * r;
        if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < minD)) continue;
        trees.push({ x, z, kind, r });
        n--;
      }
    };
    tryAdd(4.6, 6.5, 2.2, 5, 'big');
    tryAdd(6.5, 34, 2.3, q.trees, 'tree');
    tryAdd(5.0, 9, 1.4, 22, 'young');
    const trunks = trees.filter((t) => t.kind !== 'young');
    const tMesh = new THREE.InstancedMesh(tg, tmat, trunks.length);
    const cMesh = new THREE.InstancedMesh(canopy, cmat, trees.length);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    let ti = 0, ci = 0;
    for (const t of trees) {
      const y0 = groundHeight(t.x, t.z) - 0.05;
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      if (t.kind === 'young') {
        const H = 1.2 + rnd() * 2.2;
        M.compose(P.set(t.x, y0 + 0.1, t.z), Q, S.set(H * 0.38, H, H * 0.38));
        cMesh.setMatrixAt(ci++, M);
        continue;
      }
      const H = 13 + rnd() * 9;
      const rad = t.kind === 'big' ? 0.2 + rnd() * 0.08 : 0.13 + rnd() * 0.14;
      const lean = new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.05, 0, (rnd() - 0.5) * 0.05));
      M.compose(P.set(t.x, y0, t.z), lean.multiply(Q), S.set(rad, H, rad));
      tMesh.setMatrixAt(ti++, M);
      const ch = H * (0.5 + rnd() * 0.15);
      M.compose(P.set(t.x, y0 + H - ch * 0.98, t.z), Q, S.set(ch * 0.26, ch, ch * 0.26));
      cMesh.setMatrixAt(ci++, M);
    }
    tMesh.castShadow = true; tMesh.receiveShadow = true;
    cMesh.castShadow = false; cMesh.receiveShadow = true;
    this.scene.add(tMesh, cMesh);
    this.trees = trees;
  }

  buildGrass(q) {
    const tex = this.tex.grass;
    const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
    const b = a.clone().rotateY(Math.PI / 2);
    const c = a.clone().rotateY(Math.PI / 4);
    const g = mergeGeometries([a, b, c]);
    const n = g.attributes.normal;
    for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
    const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.95 });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = this.time; sh.uniforms.uWind = this.windU;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime; uniform vec3 uWind;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
{
  vec3 ip = instanceMatrix[3].xyz;
  float k = transformed.y * transformed.y;
  float s = sin(uTime * 1.7 + ip.x * 1.3 + ip.z * 0.7) * 0.05 + sin(uTime * 3.1 + ip.z * 2.0) * 0.02;
  transformed.x += k * (s + uWind.x * 0.25);
  transformed.z += k * (s * 0.6 + uWind.z * 0.25);
}`);
    };
    const N = q.grass;
    const mesh = new THREE.InstancedMesh(g, mat, N);
    const rnd = mulberry32(19);
    const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), P = new THREE.Vector3();
    let placed = 0, tries = 0;
    while (placed < N && tries++ < N * 10) {
      const a = rnd() * Math.PI * 2, r = 1.6 + Math.pow(rnd(), 0.7) * 13;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const clump = noise3(x * 0.5, 1, z * 0.5);
      if (clump < -0.05 && r < 6) continue;
      const s = (0.18 + rnd() * 0.3) * THREE.MathUtils.smoothstep(r, 1.6, 3.2) + 0.05;
      Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI);
      M.compose(P.set(x, groundHeight(x, z) - 0.01, z), Q, S.set(s * 1.1, s, s * 1.1));
      mesh.setMatrixAt(placed++, M);
    }
    mesh.count = placed;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
  }

  buildProps(physics, atlases) {
    const bark = { map: this.tex.bark.map.clone(), normalMap: this.tex.bark.normalMap.clone() };
    bark.map.repeat.set(2, 3); bark.normalMap.repeat.set(2, 3);
    const seat = buildRoundLog(1.8, 0.17, 77);
    const sg = seat.geometry;
    const sideVerts = 23 * 11, sideIdx = 22 * 10 * 6;
    const uv = sg.attributes.uv;
    for (let i = 0; i < sideVerts; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i));
    sg.clearGroups(); sg.addGroup(0, sideIdx, 0); sg.addGroup(sideIdx, sg.index.count - sideIdx, 1);
    const seatMat = [new THREE.MeshStandardMaterial({ map: bark.map, normalMap: bark.normalMap, roughness: 0.9 }), makeLogMaterial(atlases.oak, this.noiseTex, false)];
    const seatM = new THREE.Mesh(sg, seatMat);
    seatM.rotation.z = Math.PI / 2;
    seatM.rotation.y = 0.25;
    seatM.position.set(0.15, 0.15, -2.15);
    seatM.castShadow = seatM.receiveShadow = true;
    this.scene.add(seatM);
    seatM.updateMatrixWorld();
    physics.fixedCylinder(seatM.position, 0.9, 0.17, seatM.quaternion);

    const pile = new THREE.Group();
    const rnd = mulberry32(3);
    const mats = { oak: makeLogMaterial(atlases.oak, this.noiseTex, false), birch: makeLogMaterial(atlases.birch, this.noiseTex, false) };
    for (let layer = 0; layer < 3; layer++) {
      const n = 4 - layer;
      for (let i = 0; i < n; i++) {
        const wood = rnd() < 0.35 ? 'birch' : 'oak';
        const g = buildSplitLog(0.48 + rnd() * 0.08, 0.075, Math.floor(rnd() * 1e5));
        const m = new THREE.Mesh(g.geometry, mats[wood]);
        m.rotation.set(0, 0, Math.PI / 2);
        m.rotateY(rnd() * Math.PI * 2);
        m.position.set((rnd() - 0.5) * 0.04, 0.05 + layer * 0.095, (i - (n - 1) / 2) * 0.12);
        m.castShadow = m.receiveShadow = true;
        pile.add(m);
      }
    }
    pile.position.set(1.85, 0, -0.55);
    pile.rotation.y = 0.5;
    this.scene.add(pile);
    pile.updateMatrixWorld(true);
    physics.fixedBox(new THREE.Vector3(1.85, 0.15, -0.55), new THREE.Vector3(0.27, 0.15, 0.25), pile.quaternion);
    this.woodpile = pile;
    this.pickables.woodpile = pile;

    const prof = [];
    const pts = [[0, 0.004], [0.118, 0.004], [0.124, 0.012], [0.148, 0.27], [0.153, 0.278], [0.156, 0.282], [0.152, 0.285], [0.147, 0.28], [0.143, 0.27], [0.12, 0.016], [0, 0.016]];
    for (const [x, y] of pts) prof.push(new THREE.Vector2(x, y));
    const bmat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.42, 0.43, 0.45), metalness: 0.85, roughness: 0.42 });
    bmat.onBeforeCompile = (sh) => {
      sh.uniforms.tNoise = { value: this.noiseTex };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vBP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvBP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nprecision highp sampler3D;\nuniform sampler3D tNoise;\nvarying vec3 vBP;')
        .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float bn = texture(tNoise, vBP * 14.0).a; float bn2 = texture(tNoise, vBP * 40.0).r;
roughnessFactor = clamp(roughnessFactor + (bn - 0.5) * 0.5 + (bn2 - 0.5) * 0.2, 0.15, 1.0);
diffuseColor.rgb *= 0.75 + bn * 0.4;`);
    };
    const bucket = new THREE.Group();
    const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), bmat);
    body.castShadow = body.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.004, 6, 40), bmat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.09;
    const ring2 = ring.clone(); ring2.position.y = 0.2; ring2.scale.setScalar(1.06);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.0035, 6, 30, Math.PI), new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.35 }));
    handle.position.y = 0.27; handle.rotation.z = -0.35; handle.rotation.y = 0.4;
    handle.castShadow = true;
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.143, 40), new THREE.MeshStandardMaterial({ color: new THREE.Color(0.01, 0.014, 0.016), roughness: 0.04, metalness: 0.1 }));
    water.rotation.x = -Math.PI / 2; water.position.y = 0.225;
    bucket.add(body, ring, ring2, handle, water);
    bucket.position.set(-1.45, 0, 0.55);
    this.scene.add(bucket);
    physics.fixedCylinder(new THREE.Vector3(-1.45, 0.14, 0.55), 0.14, 0.15);
    this.bucket = bucket;
    this.bucketWater = water;
    this.pickables.bucket = bucket;
  }

  update(time, coalHeat, wind) {
    this.time.value = time;
    this.coalHeat.value = coalHeat;
    this.windU.value.copy(wind);
  }
}

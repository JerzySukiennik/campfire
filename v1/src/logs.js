// Firewood: procedural log geometry, charring/ember material, physics bodies and the burn simulation.
import * as THREE from 'three';
import { GLSL_COMMON, mulberry32, noise3 } from './noise.js';

const IGNITE = 0.3;
const FLAME_ON = 0.42;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function finishGeometry(pos, uv, idx, groupsOff) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function grid(pos, uv, idx, cols, rows, fn) {
  const base = pos.length / 3;
  for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
    const [p, t] = fn(i / cols, j / rows);
    pos.push(p[0], p[1], p[2]); uv.push(t[0], t[1]);
  }
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const a = base + j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
}

function fan(pos, uv, idx, ring, center, cuv, flip) {
  const base = pos.length / 3;
  pos.push(center[0], center[1], center[2]); uv.push(cuv[0], cuv[1]);
  for (const r of ring) { pos.push(r.p[0], r.p[1], r.p[2]); uv.push(r.uv[0], r.uv[1]); }
  const n = ring.length;
  for (let i = 0; i < n - 1; i++) {
    if (flip) idx.push(base, base + 2 + i, base + 1 + i); else idx.push(base, base + 1 + i, base + 2 + i);
  }
}

export function buildRoundLog(len, R, seed) {
  const rnd = mulberry32(seed);
  const h = len / 2, Rs = 22, Ls = 10;
  const bend = (rnd() - 0.5) * R * 0.5;
  const taper = (rnd() - 0.5) * 0.12;
  const knots = Array.from({ length: 3 }, () => ({ a: rnd() * Math.PI * 2, y: (rnd() * 2 - 1) * h * 0.8, s: 0.08 + rnd() * 0.1 }));
  const so = rnd() * 100;
  const rad = (th, y) => {
    let r = R * (1 + noise3(Math.cos(th) * 2 + so, Math.sin(th) * 2, y * 6) * 0.07 + noise3(Math.cos(th) * 6, Math.sin(th) * 6 + so, y * 20) * 0.025);
    for (const k of knots) {
      const da = Math.atan2(Math.sin(th - k.a), Math.cos(th - k.a));
      r += R * k.s * Math.exp(-(da * da) / 0.05 - ((y - k.y) ** 2) / 0.0015);
    }
    return r * (1 - taper * (y / h));
  };
  const pos = [], uv = [], idx = [];
  const P = (th, y, r) => [Math.cos(th) * r + bend * (1 - (y / h) ** 2), y, Math.sin(th) * r];
  grid(pos, uv, idx, Rs, Ls, (u, v) => {
    const th = u * Math.PI * 2, y = -h + v * len;
    return [P(th, y, rad(th, y)), [u * 0.5, v]];
  });
  for (const s of [-1, 1]) {
    const y = s * h;
    const tilt = (rnd() - 0.5) * 0.15;
    const ring = [];
    for (let i = 0; i <= Rs; i++) {
      const th = (i / Rs) * Math.PI * 2;
      const r = rad(th, y);
      const p = P(th, y, r); p[1] += Math.cos(th) * r * tilt;
      ring.push({ p, uv: [0.5 + 0.25 * (0.5 + 0.5 * Math.cos(th) * 0.97), 0.5 + 0.5 * (0.5 + 0.5 * Math.sin(th) * 0.97)] });
    }
    fan(pos, uv, idx, ring, [0, y, 0], [0.625, 0.75], s > 0);
  }
  return { geometry: finishGeometry(pos, uv, idx), radius: R, halfLen: h };
}

export function buildSplitLog(len, R, seed) {
  const rnd = mulberry32(seed);
  const h = len / 2, Ls = 8;
  const phi = (0.42 + rnd() * 0.25) * Math.PI;
  const th0 = -phi / 2 + (rnd() - 0.5) * 0.3;
  const K = 12, M = 5;
  const so = rnd() * 50;
  const arcR = (th, y) => R * (1 + noise3(Math.cos(th) * 3 + so, Math.sin(th) * 3, y * 5) * 0.06);
  const rough = (s, y, k) => (noise3(s * 6 + k * 10 + so, y * 7, k) * 0.012 + noise3(s * 20, y * 25, k + 3) * 0.004);
  const profile = (y) => {
    const pts = [];
    const apex = [R * 0.06, 0];
    for (let m = 0; m <= M; m++) {
      const s = m / M; const r = s * arcR(th0, y);
      const nx = -Math.sin(th0), nz = Math.cos(th0);
      const o = m > 0 && m < M ? rough(s, y, 1) : 0;
      pts.push({ x: apex[0] * (1 - s) + Math.cos(th0) * r + nx * o, z: apex[1] * (1 - s) + Math.sin(th0) * r + nz * o, f: 0, s });
    }
    for (let k = 1; k < K; k++) {
      const th = th0 + phi * k / K, r = arcR(th, y);
      pts.push({ x: Math.cos(th) * r, z: Math.sin(th) * r, f: 1, s: k / K });
    }
    const th1 = th0 + phi;
    for (let m = M; m >= 0; m--) {
      const s = m / M; const r = s * arcR(th1, y);
      const nx = Math.sin(th1), nz = -Math.cos(th1);
      const o = m > 0 && m < M ? rough(s, y, 2) : 0;
      pts.push({ x: apex[0] * (1 - s) + Math.cos(th1) * r + nx * o, z: apex[1] * (1 - s) + Math.sin(th1) * r + nz * o, f: 2, s });
    }
    return pts;
  };
  const ref = profile(0);
  let cx = 0, cz = 0;
  for (const p of ref) { cx += p.x; cz += p.z; }
  cx /= ref.length; cz /= ref.length;
  const rings = [];
  for (let j = 0; j <= Ls; j++) { const y = -h + len * j / Ls; rings.push({ y, pts: profile(y) }); }
  const pos = [], uv = [], idx = [];
  const faces = [[0, M], [M, M + K], [M + K, M + K + M]];
  const arcLen = phi / (Math.PI * 2);
  for (let f = 0; f < 3; f++) {
    const [s0, s1] = faces[f];
    const cols = s1 - s0;
    grid(pos, uv, idx, cols, Ls, (u, v) => {
      const j = Math.round(v * Ls), i = s0 + Math.round(u * cols);
      const p = rings[j].pts[i] ?? rings[j].pts[0];
      const vv = v;
      let tu;
      if (f === 1) tu = (u * arcLen + 0.1) * 0.5;
      else if (f === 0) tu = 0.75 + 0.25 * (p.s * 0.9 + 0.05) * 0.5;
      else tu = 0.75 + 0.25 * (0.5 + p.s * 0.45);
      return [[p.x - cx, rings[j].y, p.z - cz], [tu, vv]];
    });
  }
  const last = (M + K + M);
  for (const s of [-1, 1]) {
    const r = s < 0 ? rings[0] : rings[Ls];
    const ring = [];
    for (let i = 0; i <= last; i++) {
      const p = r.pts[i % (last + 1)];
      ring.push({ p: [p.x - cx, r.y, p.z - cz], uv: [0.5 + 0.25 * (0.5 + 0.5 * p.x / R * 0.97), 0.5 + 0.5 * (0.5 + 0.5 * p.z / R * 0.97)] });
    }
    ring.push(ring[0]);
    fan(pos, uv, idx, ring, [0, r.y, 0], [0.5 + 0.25 * (0.5 + 0.5 * cx / R), 0.5 + 0.5 * (0.5 + 0.5 * cz / R)], s > 0);
  }
  const hull = [];
  for (const r of [rings[0], rings[Ls]]) for (let i = 0; i < r.pts.length; i += 2) hull.push(r.pts[i].x - cx, r.y, r.pts[i].z - cz);
  let rmax = 0;
  for (const p of ref) rmax = Math.max(rmax, Math.hypot(p.x - cx, p.z - cz));
  return { geometry: finishGeometry(pos, uv, idx), hull: new Float32Array(hull), radius: rmax * 0.62, halfLen: h };
}

export function makeLogMaterial(atlas, noiseTex, burnable = true) {
  const mat = new THREE.MeshStandardMaterial({ map: atlas.map, normalMap: atlas.normalMap, roughness: 0.9, metalness: 0 });
  mat.normalScale.set(1.2, 1.2);
  const u = {
    tNoise: { value: noiseTex }, uHeat: { value: new THREE.Vector2() }, uChar: { value: new THREE.Vector2() },
    uHalfLen: { value: 0.25 }, uTime: { value: 0 }, uWet: { value: 0 }, uSeed: { value: Math.random() * 10 }, uRadius: { value: 0.05 },
  };
  mat.userData.u = u;
  if (!burnable) return mat;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; varying vec3 vLocalN; varying vec3 vWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = position; vLocalN = normal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
precision highp sampler3D;
uniform sampler3D tNoise; uniform vec2 uHeat; uniform vec2 uChar; uniform float uHalfLen; uniform float uTime; uniform float uWet; uniform float uSeed; uniform float uRadius;
varying vec3 vLocal; varying vec3 vLocalN; varying vec3 vWN;
${GLSL_COMMON}
float gHeat; float gChar; float gCrack; float gCharMask; float gAsh; float nA;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  float tAx = clamp(vLocal.y / uHalfLen * 0.5 + 0.5, 0.0, 1.0);
  gHeat = mix(uHeat.x, uHeat.y, tAx);
  gChar = mix(uChar.x, uChar.y, tAx);
  vec2 cp;
  if (abs(vLocalN.y) > 0.75) cp = vLocal.xz / 0.011;
  else cp = vec2(atan(vLocal.z, vLocal.x) * uRadius / 0.013, vLocal.y / 0.019);
  vec2 vo = voronoiEdge(cp + uSeed * 7.0);
  gCrack = 1.0 - smoothstep(0.0, (0.035 + 0.035 * vo.y) * (1.0 + gHeat * 0.8), vo.x);
  nA = texture(tNoise, vLocal * 2.2 + uSeed).r;
  float nB = texture(tNoise, vLocal * 8.0 + uSeed * 1.7).a;
  float charAmt = gChar * 1.2 + (nA - 0.5) * 0.8 + (nB - 0.5) * 0.3;
  gCharMask = smoothstep(0.38, 0.62, charAmt);
  float brown = smoothstep(0.1, 0.45, charAmt) * (1.0 - gCharMask);
  diffuseColor.rgb *= mix(1.0, 0.35, brown);
  vec3 charCol = vec3(0.020, 0.018, 0.017) * (0.6 + vo.y * 0.8);
  diffuseColor.rgb = mix(diffuseColor.rgb, charCol, gCharMask);
  diffuseColor.rgb *= 1.0 - gCrack * gCharMask * 0.8;
  gAsh = smoothstep(0.8, 1.15, charAmt + (nB - 0.5) * 0.5) * (1.0 - gCrack) * gCharMask;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.30, 0.29, 0.27) * (0.7 + nB * 0.5), gAsh * 0.8);
  diffuseColor.rgb *= mix(1.0, 0.5, uWet);
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.98, gCharMask);
roughnessFactor = mix(roughnessFactor, 0.32, uWet);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float glowT = smoothstep(0.22, 1.0, gHeat) * gCharMask;
  float br = texture(tNoise, vLocal * 4.0 + vec3(uSeed, uTime * 0.10, uTime * 0.06)).b;
  float br2 = texture(tNoise, vLocal * 11.0 + vec3(0.0, uTime * 0.31, uSeed)).g;
  float breathe = clamp(0.25 + 1.6 * br * br2 * 2.0 - 0.5, 0.0, 1.6);
  float down = 0.25 + 0.75 * clamp(-vWN.y * 0.7 + 0.35, 0.0, 1.0);
  float cellGlow = smoothstep(0.35, 0.8, br2 + (nA - 0.5) * 0.5);
  float temp = glowT * (gCrack * 1.0 + (0.18 + 0.45 * cellGlow) * (1.0 - gAsh)) * breathe * down;
  temp *= 1.0 - uWet;
  totalEmissiveRadiance += blackbody(temp) * pow(temp, 2.2) * 9.0;
}`);
  };
  mat.customProgramCacheKey = () => 'burnlog';
  return mat;
}

const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion();

export class Log {
  constructor(sys, o) {
    this.sys = sys;
    this.id = sys.nextId++;
    this.kind = o.kind; this.wood = o.wood;
    this.len = o.len; this.R0 = o.radius;
    const g = o.kind === 'round' ? buildRoundLog(o.len, o.radius, o.seed) : buildSplitLog(o.len, o.radius * 1.5, o.seed);
    this.geo = g;
    this.halfLen = g.halfLen;
    this.radius = g.radius;
    this.material = makeLogMaterial(sys.atlases[o.wood], sys.noiseTex);
    this.u = this.material.userData.u;
    this.u.uHalfLen.value = g.halfLen;
    this.u.uRadius.value = g.radius;
    this.mesh = new THREE.Mesh(g.geometry, this.material);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.userData.log = this;
    sys.scene.add(this.mesh);
    this.heatA = o.heatA ?? 0; this.heatB = o.heatB ?? 0;
    this.charA = o.charA ?? 0; this.charB = o.charB ?? 0;
    this.fuel = o.fuel ?? 1; this.wet = 0;
    this.scaleApplied = 1;
    this.a = new THREE.Vector3(); this.b = new THREE.Vector3(); this.c = new THREE.Vector3();
    const R = sys.physics.R;
    const bd = R.RigidBodyDesc.dynamic().setTranslation(o.pos.x, o.pos.y, o.pos.z)
      .setRotation({ x: o.quat.x, y: o.quat.y, z: o.quat.z, w: o.quat.w })
      .setLinearDamping(0.08).setAngularDamping(0.35).setCcdEnabled(true);
    this.body = sys.physics.world.createRigidBody(bd);
    this.makeCollider(1);
    this.prevVel = new THREE.Vector3();
    this.sync();
  }

  makeCollider(s) {
    const R = this.sys.physics.R, w = this.sys.physics.world;
    if (this.collider) w.removeCollider(this.collider, true);
    let cd;
    if (this.kind === 'round') cd = R.ColliderDesc.roundCylinder(this.halfLen * (0.8 + 0.2 * s) - this.radius * s * 0.2, this.radius * s * 0.8, this.radius * s * 0.2);
    else {
      const pts = new Float32Array(this.geo.hull.length);
      for (let i = 0; i < pts.length; i += 3) { pts[i] = this.geo.hull[i] * s; pts[i + 1] = this.geo.hull[i + 1] * (0.8 + 0.2 * s); pts[i + 2] = this.geo.hull[i + 2] * s; }
      cd = R.ColliderDesc.convexHull(pts) ?? R.ColliderDesc.cylinder(this.halfLen, this.radius * s);
    }
    cd.setDensity(620).setFriction(0.85).setRestitution(0.08);
    this.collider = w.createCollider(cd, this.body);
  }

  sync() {
    const t = this.body.translation(), r = this.body.rotation();
    this.mesh.position.set(t.x, t.y, t.z);
    this.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    const s = this.scaleApplied;
    this.mesh.scale.set(s, 0.8 + 0.2 * s, s);
    this.mesh.updateMatrixWorld();
    const hl = this.halfLen * (0.8 + 0.2 * s);
    this.a.set(0, -hl, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
    this.b.set(0, hl, 0).applyQuaternion(this.mesh.quaternion).add(this.mesh.position);
    this.c.copy(this.mesh.position);
  }

  get maxHeat() { return Math.max(this.heatA, this.heatB); }

  heatAtParam(t) { return this.heatA + (this.heatB - this.heatA) * t; }

  dispose() {
    this.sys.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.sys.physics.world.removeRigidBody(this.body);
  }
}

function closestOnSeg(p, a, b, out) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 1e-8 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2 : 0.5;
  t = Math.min(1, Math.max(0, t));
  out.set(a.x + abx * t, a.y + aby * t, a.z + abz * t);
  return t;
}

export class LogSystem {
  constructor({ scene, physics, noiseTex, atlases }) {
    this.scene = scene; this.physics = physics; this.noiseTex = noiseTex; this.atlases = atlases;
    this.logs = [];
    this.nextId = 1;
    this.coal = { heat: 0.85, fuel: 0.7, wet: 0, center: new THREE.Vector3(0, 0, 0), radius: 0.36 };
    this.intensity = 0;
    this.centroid = new THREE.Vector3(0, 0.15, 0);
    this.events = [];
    this.crackleAcc = 0;
    this.smokeSources = [];
    this.maxLogs = 16;
  }

  spawn(o) {
    const log = new Log(this, o);
    this.logs.push(log);
    return log;
  }

  randomLogSpec(rnd = Math.random) {
    const round = rnd() < 0.4;
    return {
      kind: round ? 'round' : 'split',
      wood: rnd() < (round ? 0.55 : 0.3) ? 'birch' : 'oak',
      len: 0.42 + rnd() * 0.16,
      radius: round ? 0.035 + rnd() * 0.022 : 0.05 + rnd() * 0.02,
      seed: Math.floor(rnd() * 1e6),
    };
  }

  remove(log) {
    const i = this.logs.indexOf(log);
    if (i >= 0) this.logs.splice(i, 1);
    log.dispose();
  }

  envHeat(p, self) {
    const c = this.coal;
    const dxz = Math.hypot(p.x - c.center.x, p.z - c.center.z);
    let e = c.heat * (1 - c.wet) * sstep(c.radius + 0.18, c.radius * 0.35, dxz) * sstep(0.4, 0.06, p.y);
    for (const o of this.logs) {
      if (o === self) continue;
      const t = closestOnSeg(p, o.a, o.b, tmpV);
      const h = o.heatAtParam(t);
      if (h < IGNITE) continue;
      const dy = p.y - tmpV.y;
      const d2 = (p.x - tmpV.x) ** 2 + (p.z - tmpV.z) ** 2 + (dy > 0 ? (dy * 0.6) ** 2 : (dy * 1.8) ** 2);
      e += ((h - IGNITE) / (1 - IGNITE)) * 0.85 * Math.exp(-d2 / 0.03);
    }
    return Math.min(e, 1.6);
  }

  update(dt, time, air, ambientWet = 0) {
    this.events.length = 0;
    const c = this.coal;
    let I = 0;
    const cen = new THREE.Vector3(); let cw = 0;
    for (const log of this.logs) {
      log.sync();
      if (log.mesh.position.y < -3 || log.mesh.position.length() > 40) { log.dead = true; continue; }
      const envA = this.envHeat(log.a, log), envB = this.envHeat(log.b, log);
      const sizeF = Math.pow(log.R0 / 0.05, 1.1);
      const step = (h, env, other) => {
        if (log.wet > 0.02) return Math.max(0, h - (0.5 * log.wet + 0.04) * dt);
        if (h >= IGNITE) {
          let target = env < 0.12 && other < 0.5 ? 0.2 : 0.3 + 0.62 * env + 0.28 * air + (other > 0.6 ? 0.08 : 0);
          if (log.fuel < 0.3) target *= 0.45 + 0.55 * log.fuel / 0.3;
          return h + Math.min(Math.max(target - h, -0.04 * dt), 0.11 * dt);
        }
        const target = env * 0.85 + air * 0.1 * env;
        return h + (target - h) * (target > h ? 0.09 : 0.035) * dt;
      };
      const nA = step(log.heatA, envA, log.heatB), nB = step(log.heatB, envB, log.heatA);
      log.heatA = Math.min(1.05, nA); log.heatB = Math.min(1.05, nB);
      if (Math.max(log.heatA, log.heatB) >= IGNITE && log.wet < 0.1) {
        const k = 0.012 * dt;
        const d = (log.heatB - log.heatA) * k;
        log.heatA += d; log.heatB -= d * 0.5;
      }
      log.wet = Math.max(0, log.wet - dt * (0.05 + 0.06 * Math.max(envA, envB)));
      log.charA = Math.min(1, log.charA + log.heatA * 0.02 * dt);
      log.charB = Math.min(1, log.charB + log.heatB * 0.02 * dt);
      const hm = (log.heatA + log.heatB) * 0.5;
      if (hm > 0.25) log.fuel -= dt * Math.pow(hm, 1.5) * (1 + air * 0.6) / (115 * sizeF);
      const s = 0.42 + 0.58 * Math.pow(Math.max(log.fuel, 0), 0.6);
      if (Math.abs(s - log.scaleApplied) > 0.05) { log.scaleApplied = s; log.makeCollider(s); }
      if (log.fuel < 0.1) {
        log.dead = true;
        c.fuel = Math.min(1.5, c.fuel + 0.25 * sizeF);
        this.events.push({ type: 'break', pos: log.c.clone(), heat: hm });
      }
      const u = log.u;
      u.uHeat.value.set(log.heatA, log.heatB);
      u.uChar.value.set(log.charA, log.charB);
      u.uTime.value = time;
      u.uWet.value = Math.min(1, log.wet * 1.5);
      const fa = sstep(FLAME_ON, 0.95, log.heatA), fb = sstep(FLAME_ON, 0.95, log.heatB);
      const li = (fa + fb) * 0.5 * Math.min(1, log.len / 0.4);
      I += li;
      if (fa > 0) { cen.addScaledVector(log.a, fa); cw += fa; }
      if (fb > 0) { cen.addScaledVector(log.b, fb); cw += fb; }
    }
    for (const log of this.logs.filter((l) => l.dead)) this.remove(log);

    let nearHeat = 0;
    for (const log of this.logs) {
      const d = Math.hypot(log.c.x - c.center.x, log.c.z - c.center.z);
      if (d < 0.55 && log.c.y < 0.35) nearHeat += log.maxHeat;
    }
    const target = Math.min(1.1, nearHeat * 0.28 + c.fuel * 0.75 + air * 0.35) * (1 - c.wet);
    c.heat += Math.min(Math.max(target - c.heat, -0.025 * dt), 0.08 * dt);
    if (c.wet > 0) c.heat = Math.max(0, c.heat - c.wet * 0.6 * dt);
    c.fuel = Math.max(0, c.fuel - dt * c.heat * 0.0035);
    c.wet = Math.max(0, c.wet - dt * 0.045);

    this.intensity = I;
    if (cw > 0) this.centroid.lerp(cen.multiplyScalar(1 / cw), Math.min(1, dt * 2));
    else this.centroid.lerp(new THREE.Vector3(c.center.x, 0.08, c.center.z), Math.min(1, dt));

    const rate = 0.5 + 2.6 * I + c.heat * 0.6;
    this.crackleAcc += dt * rate;
    while (this.crackleAcc > 1) {
      this.crackleAcc -= Math.random() * 2;
      const p = this.randomHotPoint();
      if (p) this.events.push({ type: 'crackle', pos: p, strength: Math.random() ** 2.5 });
    }
  }

  randomHotPoint(minHeat = IGNITE) {
    let tot = 0;
    for (const l of this.logs) tot += Math.max(0, l.maxHeat - minHeat);
    const ch = Math.max(0, this.coal.heat - 0.2) * 0.6;
    tot += ch;
    if (tot <= 0) return null;
    let r = Math.random() * tot;
    for (const l of this.logs) {
      const w = Math.max(0, l.maxHeat - minHeat);
      if (r < w) {
        let t = Math.random();
        if (l.heatA > l.heatB) t = t * t; else t = 1 - t * t;
        const p = l.a.clone().lerp(l.b, t);
        p.y += l.radius * l.scaleApplied * 0.8;
        return p;
      }
      r -= w;
    }
    const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * this.coal.radius * 0.8;
    return new THREE.Vector3(Math.cos(a) * rr, 0.04, Math.sin(a) * rr);
  }

  flameSources(air, windSpeed = 0) {
    const out = [];
    const I = this.intensity;
    const H = (0.2 + 0.2 * Math.min(1, I / 3) + 0.1 * air) * (1 - 0.3 * Math.min(1, windSpeed));
    for (const l of this.logs) {
      const fa = sstep(FLAME_ON, 0.95, l.heatA) * (1 - l.wet), fb = sstep(FLAME_ON, 0.95, l.heatB) * (1 - l.wet);
      if (fa <= 0 && fb <= 0) continue;
      const r = l.radius * l.scaleApplied;
      out.push({ a: l.a.clone(), b: l.b.clone(), ha: fa, hb: fb, r, H: H * (0.75 + 0.5 * Math.min(1, l.R0 / 0.06)), w: 0.035 + r * 1.05 });
    }
    const c = this.coal;
    const cf = sstep(0.55, 1.05, c.heat) * (1 - c.wet);
    if (cf > 0) {
      out.push({ a: new THREE.Vector3(-0.14, 0.02, 0.03), b: new THREE.Vector3(0.14, 0.02, -0.03), ha: cf * 0.5, hb: cf * 0.45, r: 0.02, H: 0.12 + 0.06 * air, w: 0.13 });
    }
    let plume = null;
    const pw = sstep(1.0, 3.5, I) * 0.6;
    if (pw > 0.001) {
      const cen = this.centroid;
      plume = { x: cen.x, y: Math.max(0.02, cen.y - 0.02), z: cen.z, w: pw, H: 0.34 + 0.3 * Math.min(1, I / 4) + air * 0.12, R: 0.085 + 0.05 * Math.min(1, I / 4) };
    }
    return { sources: out, plume, H };
  }

  heatAtPoint(p) {
    let h = 0;
    const c = this.coal;
    const dxz = Math.hypot(p.x - c.center.x, p.z - c.center.z);
    h += c.heat * (1 - c.wet) * sstep(c.radius + 0.3, 0, dxz) * Math.exp(-Math.max(0, p.y) / 0.35) * 0.5;
    for (const l of this.logs) {
      const t = closestOnSeg(p, l.a, l.b, tmpV);
      const hh = sstep(IGNITE, 1, l.heatAtParam(t)) * (1 - l.wet);
      if (hh <= 0) continue;
      const dy = p.y - tmpV.y;
      const dxz2 = (p.x - tmpV.x) ** 2 + (p.z - tmpV.z) ** 2;
      const above = dy > 0 ? Math.exp(-dxz2 / 0.02) * Math.exp(-dy / (0.55 + this.intensity * 0.08)) : Math.exp(-(dxz2 + dy * dy) / 0.01);
      h += hh * (above * 1.1 + 0.25 * Math.exp(-(dxz2 + dy * dy) / 0.08));
    }
    return h;
  }

  douse(point, radius, amount) {
    let removed = 0;
    for (const l of this.logs) {
      for (const end of ['a', 'b']) {
        const p = l[end];
        const d = Math.hypot(p.x - point.x, p.z - point.z);
        const k = sstep(radius, radius * 0.3, d) * amount;
        if (k <= 0) continue;
        const key = end === 'a' ? 'heatA' : 'heatB';
        const before = l[key];
        l[key] = Math.max(0, l[key] - k * 0.9);
        removed += before - l[key];
        l.wet = Math.min(1.2, l.wet + k * 0.6);
      }
    }
    const c = this.coal;
    const d = Math.hypot(point.x - c.center.x, point.z - c.center.z);
    const k = sstep(c.radius + radius, c.radius * 0.5, d) * amount;
    if (k > 0) {
      removed += c.heat * k * 0.5;
      c.heat = Math.max(0, c.heat - k * 0.5);
      c.wet = Math.min(1, c.wet + k * 0.35);
    }
    return removed;
  }

  ignite(point, radius = 0.12) {
    let lit = false;
    for (const l of this.logs) {
      const t = closestOnSeg(point, l.a, l.b, tmpV);
      if (tmpV.distanceTo(point) > radius + l.radius) continue;
      if (l.wet > 0.35) return 'wet';
      if (t < 0.5) l.heatA = Math.max(l.heatA, 0.62); else l.heatB = Math.max(l.heatB, 0.62);
      lit = true;
    }
    const c = this.coal;
    if (Math.hypot(point.x - c.center.x, point.z - c.center.z) < c.radius + 0.05 && point.y < 0.2) {
      if (c.wet > 0.4) return 'wet';
      c.heat = Math.max(c.heat, 0.5); c.fuel = Math.max(c.fuel, 0.15); lit = true;
    }
    return lit;
  }
}

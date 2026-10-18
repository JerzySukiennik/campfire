// Particles: motion-blurred sparks, water drops, and soft fire-lit smoke / steam.
import * as THREE from 'three';
import { GLSL_COMMON } from './noise.js';

const DEPTH = /* glsl */`
uniform sampler2D tDepth; uniform vec2 uRes; uniform float cNear; uniform float cFar;
float viewDist(float d) { float z = d * 2.0 - 1.0; return 2.0 * cNear * cFar / (cFar + cNear - z * (cFar - cNear)); }
`;

const STREAK_VERT = /* glsl */`
attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iData;
uniform float uShutter; uniform vec2 uRes;
varying float vA; varying float vB; varying float vL; varying float vTemp; varying float vEnergy; varying float vViewZ; varying float vSeed;
void main() {
  vec4 v0 = viewMatrix * vec4(iPos, 1.0);
  vec4 v1 = viewMatrix * vec4(iPos - iVel * uShutter, 1.0);
  v1.z = min(v1.z, -0.02);
  vec4 c0 = projectionMatrix * v0, c1 = projectionMatrix * v1;
  vec2 asp = vec2(uRes.x / uRes.y, 1.0);
  vec2 s0 = c0.xy / c0.w * asp, s1 = c1.xy / c1.w * asp;
  vec2 d = s1 - s0;
  float len = length(d);
  len = min(len, 0.5);
  vec2 dir = len > 1e-6 ? d / max(length(d), 1e-6) : vec2(1.0, 0.0);
  vec2 perp = vec2(-dir.y, dir.x);
  float wTrue = iData.y * projectionMatrix[1][1] / max(-v0.z, 0.01);
  float wMin = 1.2 / uRes.y;
  float w = max(wTrue, wMin);
  float along = mix(-w, len + w, position.x * 0.5 + 0.5);
  vec2 p = s0 + dir * along + perp * (position.y * w);
  vA = along / w; vB = position.y; vL = len / w;
  float area = clamp(wTrue / w, 0.0, 1.0);
  vEnergy = area * area / (1.0 + vL * 0.35);
  vTemp = iData.x; vSeed = iData.w;
  vViewZ = -v0.z;
  gl_Position = vec4(p / asp * c0.w, c0.z, c0.w);
  if (iData.z <= 0.0 || -v0.z < 0.03) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const SPARK_FRAG = /* glsl */`
uniform float uTime; uniform float uBright;
varying float vA; varying float vB; varying float vL; varying float vTemp; varying float vEnergy; varying float vViewZ; varying float vSeed;
${DEPTH}
${GLSL_COMMON}
void main() {
  float sd = viewDist(texture2D(tDepth, gl_FragCoord.xy / uRes).r);
  if (vViewZ > sd + 0.01) discard;
  float d = length(vec2(max(-vA, 0.0) + max(vA - vL, 0.0), vB));
  float a = exp(-d * d * 2.2);
  float tw = vSeed > 0.6 ? 0.55 + 0.45 * sin(uTime * (18.0 + vSeed * 30.0) + vSeed * 50.0) : 1.0;
  float t = vTemp;
  vec3 c = blackbody(t) * pow(t, 2.2) * uBright * a * vEnergy * tw;
  gl_FragColor = vec4(c, 0.0);
}
`;

const WATER_FRAG = /* glsl */`
uniform vec3 uLight;
varying float vA; varying float vB; varying float vL; varying float vTemp; varying float vEnergy; varying float vViewZ; varying float vSeed;
${DEPTH}
void main() {
  float sd = viewDist(texture2D(tDepth, gl_FragCoord.xy / uRes).r);
  if (vViewZ > sd + 0.01) discard;
  float d = length(vec2(max(-vA, 0.0) + max(vA - vL, 0.0), vB));
  float a = exp(-d * d * 2.2) * clamp(vEnergy * 3.0, 0.0, 1.0) * 0.5 * smoothstep(0.6, 1.2, vViewZ);
  vec3 c = (vec3(0.5, 0.6, 0.7) * 0.02 + uLight * (0.25 + 0.5 * vSeed)) * a;
  gl_FragColor = vec4(c, a);
}
`;

class Streaks {
  constructor(max, frag, uniforms, blending) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.data = new Float32Array(max * 4);
    this.life = new Float32Array(max);
    this.cool = new Float32Array(max);
    this.count = 0;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iVel', this.aVel); g.setAttribute('iData', this.aData);
    g.instanceCount = 0;
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT, fragmentShader: frag, uniforms,
      depthTest: false, depthWrite: false, transparent: true, ...blending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
  }

  spawn(x, y, z, vx, vy, vz, temp, size, life, cool) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.data[i * 4] = temp; this.data[i * 4 + 1] = size; this.data[i * 4 + 2] = 1; this.data[i * 4 + 3] = Math.random();
    this.life[i] = life; this.cool[i] = cool;
  }

  kill(i) {
    const j = --this.count;
    if (i !== j) {
      this.pos.copyWithin(i * 3, j * 3, j * 3 + 3);
      this.vel.copyWithin(i * 3, j * 3, j * 3 + 3);
      this.data.copyWithin(i * 4, j * 4, j * 4 + 4);
      this.life[i] = this.life[j]; this.cool[i] = this.cool[j];
    }
  }

  upload() {
    this.geo.instanceCount = this.count;
    for (const a of [this.aPos, this.aVel, this.aData]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, this.count * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

const SMOKE_VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iData; attribute vec4 iData2;
varying vec2 vUv; varying vec4 vD; varying vec4 vD2; varying float vViewZ; varying vec3 vWorld;
void main() {
  vec4 mv = viewMatrix * vec4(iPos, 1.0);
  float c = cos(iData.z), s = sin(iData.z);
  vec2 q = mat2(c, s, -s, c) * position.xy;
  mv.xy += q * iData.x;
  vUv = position.xy * 0.5 + 0.5;
  vD = iData; vD2 = iData2;
  vViewZ = -mv.z;
  vWorld = iPos;
  gl_Position = projectionMatrix * mv;
  if (iData.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
}
`;

const SMOKE_FRAG = /* glsl */`
precision highp sampler3D;
uniform sampler3D tNoise; uniform vec3 uFirePos; uniform vec3 uFireCol; uniform vec3 uAmbient; uniform float uTime;
varying vec2 vUv; varying vec4 vD; varying vec4 vD2; varying float vViewZ; varying vec3 vWorld;
${DEPTH}
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float seed = vD.w, age = vD2.x, kind = vD2.y;
  vec3 nq = vec3(p * 0.45 + seed * 7.0, age * 0.35 + seed * 3.0 + uTime * 0.02);
  float n = texture(tNoise, nq).r * 0.6 + texture(tNoise, nq * 2.3).a * 0.4;
  float n3 = texture(tNoise, nq * 0.6 + vec3(0.0, 0.0, age * 0.2)).g;
  float puff = smoothstep(1.0, 0.0, r) * smoothstep(0.35, 0.85, n * 0.7 + n3 * 0.5 + (1.0 - r) * 0.25);
  float sd = viewDist(texture2D(tDepth, gl_FragCoord.xy / uRes).r);
  float soft = clamp((sd - vViewZ) / max(vD.x * 0.6, 0.02), 0.0, 1.0);
  float near = clamp((vViewZ - 0.15) / 0.5, 0.0, 1.0);
  float a = puff * vD.y * soft * near;
  if (a < 0.002) discard;
  vec3 toF = vWorld - uFirePos;
  float d2 = dot(toF, toF);
  float below = clamp(0.5 - toF.y * 0.4, 0.15, 1.0);
  vec3 lit = uFireCol / (1.0 + d2 * 6.0) * below * (0.6 + n * 0.6);
  vec3 base = mix(vec3(0.55, 0.55, 0.57), vec3(0.85, 0.87, 0.9), kind);
  vec3 col = base * (uAmbient + lit * 0.035);
  gl_FragColor = vec4(col * a, a);
}
`;

class Smoke {
  constructor(max, uniforms) {
    this.max = max;
    this.p = [];
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    this.pos = new Float32Array(max * 3);
    this.d1 = new Float32Array(max * 4);
    this.d2 = new Float32Array(max * 4);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aD1 = new THREE.InstancedBufferAttribute(this.d1, 4).setUsage(THREE.DynamicDrawUsage);
    this.aD2 = new THREE.InstancedBufferAttribute(this.d2, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iData', this.aD1); g.setAttribute('iData2', this.aD2);
    g.instanceCount = 0;
    this.geo = g;
    this.material = new THREE.ShaderMaterial({
      vertexShader: SMOKE_VERT, fragmentShader: SMOKE_FRAG, uniforms,
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
  }

  emit(x, y, z, o = {}) {
    if (this.p.length >= this.max) return;
    this.p.push({
      x, y, z, vx: (o.vx ?? 0) + (Math.random() - 0.5) * 0.1, vy: o.vy ?? 0.5 + Math.random() * 0.3, vz: (o.vz ?? 0) + (Math.random() - 0.5) * 0.1,
      size: o.size ?? 0.12, grow: o.grow ?? 0.35, alpha: o.alpha ?? 0.12, life: o.life ?? 6, age: 0,
      rot: Math.random() * 6.28, spin: (Math.random() - 0.5) * 0.5, seed: Math.random(), kind: o.kind ?? 0,
    });
  }

  update(dt, wind, camera, time) {
    const arr = this.p;
    for (let i = arr.length - 1; i >= 0; i--) {
      const s = arr[i];
      s.age += dt;
      if (s.age >= s.life) { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
      const k = s.age / s.life;
      const hb = Math.max(0, s.y);
      s.vy += dt * (s.kind ? 0.25 : 0.12) - s.vy * dt * 0.25;
      s.vx += (wind.x * (0.4 + hb * 0.5) - s.vx) * dt * 0.6;
      s.vz += (wind.z * (0.4 + hb * 0.5) - s.vz) * dt * 0.6;
      s.vx += Math.sin(time * 0.7 + s.seed * 40 + s.y * 2.0) * dt * 0.12;
      s.vz += Math.cos(time * 0.6 + s.seed * 30 + s.y * 1.7) * dt * 0.12;
      s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
      s.size += s.grow * dt;
      s.rot += s.spin * dt;
    }
    const cp = camera.position;
    for (const s of arr) s.d = (s.x - cp.x) ** 2 + (s.y - cp.y) ** 2 + (s.z - cp.z) ** 2;
    arr.sort((a, b) => b.d - a.d);
    for (let i = 0; i < arr.length; i++) {
      const s = arr[i];
      const k = s.age / s.life;
      const a = s.alpha * Math.min(1, s.age / 0.6) * Math.pow(1 - k, 1.6);
      this.pos[i * 3] = s.x; this.pos[i * 3 + 1] = s.y; this.pos[i * 3 + 2] = s.z;
      this.d1[i * 4] = s.size; this.d1[i * 4 + 1] = a; this.d1[i * 4 + 2] = s.rot; this.d1[i * 4 + 3] = s.seed;
      this.d2[i * 4] = s.age; this.d2[i * 4 + 1] = s.kind;
    }
    this.geo.instanceCount = arr.length;
    for (const a of [this.aPos, this.aD1, this.aD2]) {
      a.clearUpdateRanges();
      a.addUpdateRange(0, arr.length * a.itemSize);
      a.needsUpdate = true;
    }
  }
}

export class Particles {
  constructor(noiseTex) {
    this.depthU = { tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, cNear: { value: 0.05 }, cFar: { value: 200 } };
    this.time = { value: 0 };
    const add = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor };
    const pre = { blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor };
    this.sparks = new Streaks(900, SPARK_FRAG, { ...this.depthU, uShutter: { value: 0.012 }, uTime: this.time, uBright: { value: 4.0 } }, add);
    this.sparks.mesh.renderOrder = 20;
    this.lightCol = new THREE.Vector3();
    this.water = new Streaks(500, WATER_FRAG, { ...this.depthU, uShutter: { value: 0.014 }, uLight: { value: this.lightCol } }, pre);
    this.water.mesh.renderOrder = 15;
    this.firePos = new THREE.Vector3();
    this.fireCol = new THREE.Vector3();
    this.smoke = new Smoke(260, { ...this.depthU, tNoise: { value: noiseTex }, uFirePos: { value: this.firePos }, uFireCol: { value: this.fireCol }, uAmbient: { value: new THREE.Vector3(0.012, 0.015, 0.024) }, uTime: this.time });
    this.group = new THREE.Group();
    this.group.add(this.smoke.mesh, this.water.mesh, this.sparks.mesh);
    this.splashes = [];
  }

  setDepth(tex, w, h, camera) {
    this.depthU.tDepth.value = tex;
    this.depthU.uRes.value.set(w, h);
    this.depthU.cNear.value = camera.near; this.depthU.cFar.value = camera.far;
  }

  burst(p, n, o = {}) {
    const sp = o.speed ?? 1.5, up = o.up ?? 1.5;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() ** 0.5 * sp;
      const v = up * (0.4 + Math.random() * 0.9);
      this.sparks.spawn(
        p.x + (Math.random() - 0.5) * 0.04, p.y + Math.random() * 0.03, p.z + (Math.random() - 0.5) * 0.04,
        Math.cos(a) * r, v + r * 0.3, Math.sin(a) * r,
        0.7 + Math.random() * 0.35, 0.0009 + Math.random() ** 3 * 0.0026, 0.7 + Math.random() * (o.life ?? 2.2), 0.25 + Math.random() * 0.5,
      );
    }
  }

  ember(p) {
    this.sparks.spawn(
      p.x + (Math.random() - 0.5) * 0.06, p.y, p.z + (Math.random() - 0.5) * 0.06,
      (Math.random() - 0.5) * 0.3, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * 0.3,
      0.65 + Math.random() * 0.35, 0.0008 + Math.random() ** 4 * 0.0028, 1.5 + Math.random() * 3.5, 0.18 + Math.random() * 0.3,
    );
  }

  pour(from, to, n) {
    for (let i = 0; i < n; i++) {
      const sx = (Math.random() - 0.5) * 0.06, sz = (Math.random() - 0.5) * 0.06;
      const vx = (to.x - from.x) * 0.9 + (Math.random() - 0.5) * 0.25, vz = (to.z - from.z) * 0.9 + (Math.random() - 0.5) * 0.25;
      this.water.spawn(from.x + sx, from.y, from.z + sz, vx, -0.4 - Math.random() * 0.6, vz, 1, 0.004 + Math.random() * 0.006, 2, 0);
    }
  }

  update(dt, time, wind, camera, ctx) {
    this.time.value = time;
    const s = this.sparks;
    const c = ctx.centroid, I = ctx.intensity;
    for (let i = s.count - 1; i >= 0; i--) {
      s.life[i] -= dt;
      let t = s.data[i * 4] - dt * s.cool[i];
      if (s.life[i] <= 0 || t < 0.05) { s.kill(i); continue; }
      s.data[i * 4] = t;
      const ix = i * 3;
      let x = s.pos[ix], y = s.pos[ix + 1], z = s.pos[ix + 2];
      let vx = s.vel[ix], vy = s.vel[ix + 1], vz = s.vel[ix + 2];
      const dxz = Math.hypot(x - c.x, z - c.z);
      const plume = Math.exp(-dxz * dxz / 0.08) * Math.max(0, 1 - y / 2.2) * Math.min(1.5, I * 0.5);
      vy += dt * (t * t * 2.4 + plume * 2.6 - 2.0);
      const sn = s.data[i * 4 + 3] * 40;
      vx += dt * (Math.sin(time * 2.3 + y * 5.0 + sn) * 2.2 + (wind.x - vx) * 1.2);
      vz += dt * (Math.cos(time * 2.1 + y * 4.3 + sn * 1.3) * 2.2 + (wind.z - vz) * 1.2);
      const drag = Math.exp(-dt * 1.4);
      vx *= drag; vy *= drag; vz *= drag;
      x += vx * dt; y += vy * dt; z += vz * dt;
      if (y < 0.004) { y = 0.004; vy = Math.abs(vy) * 0.15; vx *= 0.4; vz *= 0.4; s.data[i * 4] = t * 0.97; s.cool[i] *= 1.02; }
      s.pos[ix] = x; s.pos[ix + 1] = y; s.pos[ix + 2] = z;
      s.vel[ix] = vx; s.vel[ix + 1] = vy; s.vel[ix + 2] = vz;
    }
    s.upload();

    const w = this.water;
    this.splashes.length = 0;
    for (let i = w.count - 1; i >= 0; i--) {
      w.life[i] -= dt;
      if (w.life[i] <= 0) { w.kill(i); continue; }
      const ix = i * 3;
      w.vel[ix + 1] -= 9.81 * dt;
      w.pos[ix] += w.vel[ix] * dt; w.pos[ix + 1] += w.vel[ix + 1] * dt; w.pos[ix + 2] += w.vel[ix + 2] * dt;
      const floor = ctx.floorAt ? ctx.floorAt(w.pos[ix], w.pos[ix + 2]) : 0.01;
      if (w.pos[ix + 1] < floor) {
        if (w.data[i * 4] > 0.5 && Math.random() < 0.6) {
          this.splashes.push(new THREE.Vector3(w.pos[ix], floor, w.pos[ix + 2]));
          for (let k = 0; k < 2; k++) {
            const a = Math.random() * 6.28, r = 0.3 + Math.random() * 0.8;
            w.spawn(w.pos[ix], floor + 0.005, w.pos[ix + 2], Math.cos(a) * r, 0.6 + Math.random() * 0.8, Math.sin(a) * r, 0.2, 0.0025, 0.35, 0);
          }
        }
        w.kill(i);
      }
    }
    w.upload();
    this.smoke.update(dt, wind, camera, time);
  }
}

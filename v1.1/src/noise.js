// Noise: tileable 3D noise volume for shaders + cheap CPU noise helpers.
import * as THREE from 'three';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PERM = new Uint8Array(512);
{
  const r = mulberry32(1337);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
}
const VAL = new Float32Array(256);
{ const r = mulberry32(99); for (let i = 0; i < 256; i++) VAL[i] = r() * 2 - 1; }

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

export function noise1(x) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return VAL[PERM[i & 255]] * (1 - u) + VAL[PERM[(i + 1) & 255]] * u;
}

export function fbm1(x, oct = 3) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { s += noise1(x) * a; n += a; x *= 2.03; a *= 0.5; }
  return s / n;
}

export function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const h = (a, b, c) => VAL[PERM[(PERM[(PERM[a & 255] + b) & 255] + c) & 255]];
  const l = (a, b, t) => a + (b - a) * t;
  return l(
    l(l(h(xi, yi, zi), h(xi + 1, yi, zi), u), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u), v),
    l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u), v),
    w
  );
}

export function noise2p(x, y, px, py) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const X0 = ((xi % px) + px) % px, X1 = (X0 + 1) % px;
  const Y0 = ((yi % py) + py) % py, Y1 = (Y0 + 1) % py;
  const h = (a, b) => VAL[PERM[(PERM[a & 255] + b) & 255]];
  const a = h(X0, Y0), b = h(X1, Y0), c = h(X0, Y1), d = h(X1, Y1);
  return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v;
}

export function fbm2p(x, y, px, py, oct = 4, gain = 0.5) {
  let s = 0, a = 1, n = 0, f = 1;
  for (let o = 0; o < oct; o++) {
    s += noise2p(x * f, y * f, px * f, py * f) * a;
    n += a; a *= gain; f *= 2;
  }
  return s / n;
}

function makeGradients(P, rnd) {
  const g = new Float32Array(P * P * P * 3);
  for (let i = 0; i < P * P * P; i++) {
    const z = rnd() * 2 - 1, t = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    g[i * 3] = r * Math.cos(t); g[i * 3 + 1] = r * Math.sin(t); g[i * 3 + 2] = z;
  }
  return g;
}

function addPerlinOctave(out, N, P, amp, rnd) {
  const g = makeGradients(P, rnd);
  const s = P / N;
  const idx = (x, y, z) => ((z % P) * P * P + (y % P) * P + (x % P)) * 3;
  let o = 0;
  for (let z = 0; z < N; z++) {
    const pz = z * s, zi = Math.floor(pz), zf = pz - zi, w = fade(zf);
    for (let y = 0; y < N; y++) {
      const py = y * s, yi = Math.floor(py), yf = py - yi, v = fade(yf);
      for (let x = 0; x < N; x++, o++) {
        const px = x * s, xi = Math.floor(px), xf = px - xi, u = fade(xf);
        let acc = 0;
        let n000, n100, n010, n110, n001, n101, n011, n111, k;
        k = idx(xi, yi, zi); n000 = g[k] * xf + g[k + 1] * yf + g[k + 2] * zf;
        k = idx(xi + 1, yi, zi); n100 = g[k] * (xf - 1) + g[k + 1] * yf + g[k + 2] * zf;
        k = idx(xi, yi + 1, zi); n010 = g[k] * xf + g[k + 1] * (yf - 1) + g[k + 2] * zf;
        k = idx(xi + 1, yi + 1, zi); n110 = g[k] * (xf - 1) + g[k + 1] * (yf - 1) + g[k + 2] * zf;
        k = idx(xi, yi, zi + 1); n001 = g[k] * xf + g[k + 1] * yf + g[k + 2] * (zf - 1);
        k = idx(xi + 1, yi, zi + 1); n101 = g[k] * (xf - 1) + g[k + 1] * yf + g[k + 2] * (zf - 1);
        k = idx(xi, yi + 1, zi + 1); n011 = g[k] * xf + g[k + 1] * (yf - 1) + g[k + 2] * (zf - 1);
        k = idx(xi + 1, yi + 1, zi + 1); n111 = g[k] * (xf - 1) + g[k + 1] * (yf - 1) + g[k + 2] * (zf - 1);
        const x00 = n000 + (n100 - n000) * u, x10 = n010 + (n110 - n010) * u;
        const x01 = n001 + (n101 - n001) * u, x11 = n011 + (n111 - n011) * u;
        const y0 = x00 + (x10 - x00) * v, y1 = x01 + (x11 - x01) * v;
        acc = y0 + (y1 - y0) * w;
        out[o] += acc * amp;
      }
    }
  }
}

function worley(out, N, P, rnd) {
  const pts = new Float32Array(P * P * P * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rnd();
  const s = P / N;
  let o = 0;
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++, o++) {
    const px = x * s, py = y * s, pz = z * s;
    const cx = Math.floor(px), cy = Math.floor(py), cz = Math.floor(pz);
    let d1 = 9;
    for (let k = -1; k <= 1; k++) for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const X = cx + i, Y = cy + j, Z = cz + k;
      const q = ((((Z % P) + P) % P) * P * P + (((Y % P) + P) % P) * P + (((X % P) + P) % P)) * 3;
      const dx = X + pts[q] - px, dy = Y + pts[q + 1] - py, dz = Z + pts[q + 2] - pz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < d1) d1 = d;
    }
    out[o] = Math.sqrt(d1);
  }
}

export function createNoiseVolume(N = 64) {
  const rnd = mulberry32(2024);
  const total = N * N * N;
  const ch = [0, 1, 2].map(() => new Float32Array(total));
  for (const c of ch) {
    addPerlinOctave(c, N, 4, 1.0, rnd);
    addPerlinOctave(c, N, 8, 0.5, rnd);
    addPerlinOctave(c, N, 16, 0.25, rnd);
  }
  const wr = new Float32Array(total);
  worley(wr, N, 6, rnd);
  const det = new Float32Array(total);
  addPerlinOctave(det, N, 16, 1.0, rnd);
  addPerlinOctave(det, N, 32, 0.5, rnd);

  const data = new Uint8Array(total * 4);
  const norm = (v, k) => Math.max(0, Math.min(255, Math.round((v * k * 0.5 + 0.5) * 255)));
  for (let i = 0; i < total; i++) {
    data[i * 4] = norm(ch[0][i], 1.15);
    data[i * 4 + 1] = norm(ch[1][i], 1.15);
    data[i * 4 + 2] = norm(ch[2][i], 1.15);
    const cell = 1 - Math.min(1, wr[i] * 1.25);
    const a = cell * 0.7 + (det[i] * 0.55 + 0.5) * 0.3;
    data[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.unpackAlignment = 1;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const GLSL_COMMON = /* glsl */`
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float ign(vec2 p) { return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
vec3 blackbody(float t) {
  t = max(t, 0.0);
  vec3 c = mix(vec3(1.0, 0.07, 0.0), vec3(1.0, 0.28, 0.02), smoothstep(0.15, 0.45, t));
  c = mix(c, vec3(1.0, 0.52, 0.10), smoothstep(0.45, 0.75, t));
  c = mix(c, vec3(1.0, 0.76, 0.36), smoothstep(0.75, 1.05, t));
  c = mix(c, vec3(1.0, 0.92, 0.75), smoothstep(1.05, 1.5, t));
  return c;
}
vec2 voronoiEdge(vec2 x) {
  vec2 n = floor(x), f = fract(x);
  vec2 mg, mr; float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < md) { md = d; mr = r; mg = g; }
  }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
    vec2 g = mg + vec2(float(i), float(j));
    vec2 o = hash22(n + g);
    vec2 r = g + o - f;
    if (dot(mr - r, mr - r) > 0.00001) md = min(md, dot(0.5 * (mr + r), normalize(r - mr)));
  }
  return vec2(md, hash12(n + mg));
}
`;

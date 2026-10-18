// Procedural canvas textures: wood atlases (bark / end grain / split face), forest floor, ash.
import * as THREE from 'three';
import { fbm2p, noise2p, mulberry32 } from './noise.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

function toSRGB8(c) {
  c = clamp01(c);
  return Math.round((c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055) * 255);
}

function normalFromHeight(H, W, Ht, strength, wrap = true) {
  const out = new Uint8ClampedArray(W * Ht * 4);
  const at = (x, y) => {
    if (wrap) { x = (x + W) % W; y = (y + Ht) % Ht; } else { x = Math.max(0, Math.min(W - 1, x)); y = Math.max(0, Math.min(Ht - 1, y)); }
    return H[y * W + x];
  };
  for (let y = 0; y < Ht; y++) for (let x = 0; x < W; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y - 1) - at(x, y + 1)) * strength;
    const l = Math.hypot(dx, dy, 1);
    const i = (y * W + x) * 4;
    out[i] = Math.round((-dx / l * 0.5 + 0.5) * 255);
    out[i + 1] = Math.round((-dy / l * 0.5 + 0.5) * 255);
    out[i + 2] = Math.round((1 / l * 0.5 + 0.5) * 255);
    out[i + 3] = 255;
  }
  return out;
}

function canvasTex(data, W, H, srgb, repeat = false) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  img.data.set(data);
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

const WOOD = {
  oak: {
    barkDark: [0.045, 0.035, 0.028], barkLight: [0.30, 0.27, 0.235], lichen: [0.28, 0.31, 0.22],
    woodA: [0.50, 0.37, 0.23], woodB: [0.36, 0.25, 0.15], rings: 26,
  },
  birch: {
    barkDark: [0.04, 0.035, 0.03], barkLight: [0.80, 0.78, 0.72], lichen: [0.62, 0.45, 0.30],
    woodA: [0.74, 0.63, 0.47], woodB: [0.60, 0.48, 0.33], rings: 18,
  },
};

export function makeWoodAtlas(kind, seed = 1) {
  const W = 1024, H = 512;
  const P = WOOD[kind];
  const col = new Uint8ClampedArray(W * H * 4);
  const hgt = new Float32Array(W * H);
  const rnd = mulberry32(seed * 7919 + (kind === 'birch' ? 3 : 0));
  const checks = Array.from({ length: 5 }, () => ({ a: rnd() * Math.PI * 2, w: 0.012 + rnd() * 0.02, len: 0.35 + rnd() * 0.5 }));
  const so = rnd() * 50;

  for (let py = 0; py < H; py++) {
    for (let px = 0; px < W; px++) {
      const u = (px + 0.5) / W, v = 1 - (py + 0.5) / H;
      let r, g, b, h;
      if (u < 0.5) {
        const bu = u / 0.5, bv = v;
        if (kind === 'oak') {
          const warp = fbm2p(bu * 6 + so, bv * 3, 6, 3, 3) * 0.6;
          const ridge = 1 - Math.abs(fbm2p(bu * 14 + warp, bv * 2.2 + so, 14, 2, 4) * 2.2);
          const fiss = smooth(0.25, 0.85, ridge);
          const cross = smooth(0.62, 0.75, Math.abs(noise2p(bu * 20, bv * 9 + so, 20, 9)));
          const n2 = fbm2p(bu * 40, bv * 30, 40, 30, 3) * 0.5 + 0.5;
          h = fiss * (1 - cross * 0.6) * 0.8 + n2 * 0.2;
          const lich = smooth(0.25, 0.5, fbm2p(bu * 5 + 9, bv * 4, 5, 4, 3)) * fiss;
          const t = clamp01(h * 0.85 + (n2 - 0.5) * 0.25);
          r = P.barkDark[0] + (P.barkLight[0] - P.barkDark[0]) * t;
          g = P.barkDark[1] + (P.barkLight[1] - P.barkDark[1]) * t;
          b = P.barkDark[2] + (P.barkLight[2] - P.barkDark[2]) * t;
          r += (P.lichen[0] - r) * lich * 0.35; g += (P.lichen[1] - g) * lich * 0.35; b += (P.lichen[2] - b) * lich * 0.35;
        } else {
          const n = fbm2p(bu * 8 + so, bv * 6, 8, 6, 4) * 0.5 + 0.5;
          const lent = Math.abs(noise2p(bu * 9, bv * 70 + so, 9, 70));
          const lmask = smooth(0.82, 0.95, 1 - lent) * smooth(0.3, 0.6, noise2p(bu * 30, bv * 70, 30, 70) * 0.5 + 0.5);
          const patch = smooth(0.42, 0.58, fbm2p(bu * 4 + 3, bv * 5 + so, 4, 5, 4) * 0.5 + 0.5 + (n - 0.5) * 0.4);
          const peel = smooth(0.6, 0.7, fbm2p(bu * 3 + 11, bv * 6, 3, 6, 3) * 0.5 + 0.5);
          const fine = fbm2p(bu * 60, bv * 20, 60, 20, 2) * 0.5 + 0.5;
          const dark = Math.max(lmask * 0.9, patch * 0.95);
          r = P.barkLight[0] * (0.88 + fine * 0.12); g = P.barkLight[1] * (0.88 + fine * 0.12); b = P.barkLight[2] * (0.86 + fine * 0.12);
          r += (P.lichen[0] - r) * peel * 0.6; g += (P.lichen[1] - g) * peel * 0.6; b += (P.lichen[2] - b) * peel * 0.6;
          r += (P.barkDark[0] - r) * dark; g += (P.barkDark[1] - g) * dark; b += (P.barkDark[2] - b) * dark;
          h = 0.6 + fine * 0.15 - lmask * 0.35 - patch * 0.25 + peel * 0.1;
        }
      } else if (u >= 0.75) {
        const su = (u - 0.75) / 0.25, sv = v;
        const fib = fbm2p(su * 60 + so, sv * 3, 60, 3, 4) * 0.5 + 0.5;
        const streak = fbm2p(su * 9, sv * 1.5 + so, 9, 2, 3) * 0.5 + 0.5;
        const spl = smooth(0.7, 0.9, fbm2p(su * 25, sv * 2, 25, 2, 2) * 0.5 + 0.5);
        const t = clamp01(fib * 0.6 + streak * 0.4);
        r = P.woodB[0] + (P.woodA[0] - P.woodB[0]) * t;
        g = P.woodB[1] + (P.woodA[1] - P.woodB[1]) * t;
        b = P.woodB[2] + (P.woodA[2] - P.woodB[2]) * t;
        r *= 1 - spl * 0.35; g *= 1 - spl * 0.35; b *= 1 - spl * 0.35;
        h = fib * 0.5 + streak * 0.3 + spl * 0.3;
      } else {
        const eu = (u - 0.5) / 0.25 * 2 - 1;
        const ev = (v < 0.5 ? v / 0.5 : (v - 0.5) / 0.5) * 2 - 1;
        const rr = Math.hypot(eu, ev);
        const ang = Math.atan2(ev, eu);
        const warp = fbm2p(ang / Math.PI * 4 + 4, rr * 3, 8, 64, 3) * 0.05;
        const rw = rr + warp;
        const ringF = (rw * P.rings) % 1;
        const late = smooth(0.7, 0.95, ringF) * (1 - smooth(0.95, 1.0, ringF));
        const noiseT = fbm2p(eu * 20 + 40, ev * 20, 64, 64, 3) * 0.5 + 0.5;
        let crack = 0;
        for (const c of checks) {
          let da = Math.abs(((ang - c.a + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
          const wid = c.w * (1 - rr / (c.len + 0.3));
          if (rr > 1 - c.len && rr < 0.96) crack = Math.max(crack, smooth(wid, 0, da * rr));
        }
        const pith = smooth(0.06, 0.0, rr);
        let t = clamp01(0.6 + noiseT * 0.3 - late * 0.45);
        r = P.woodB[0] + (P.woodA[0] - P.woodB[0]) * t;
        g = P.woodB[1] + (P.woodA[1] - P.woodB[1]) * t;
        b = P.woodB[2] + (P.woodA[2] - P.woodB[2]) * t;
        const sap = smooth(0.82, 0.9, rr);
        r *= 1 + sap * 0.12; g *= 1 + sap * 0.12; b *= 1 + sap * 0.1;
        const bark = smooth(0.9, 0.95, rr);
        const bc = kind === 'birch' ? [0.55, 0.52, 0.48] : [0.08, 0.06, 0.05];
        r += (bc[0] - r) * bark; g += (bc[1] - g) * bark; b += (bc[2] - b) * bark;
        r *= 1 - crack * 0.85 - pith * 0.4; g *= 1 - crack * 0.85 - pith * 0.4; b *= 1 - crack * 0.85 - pith * 0.4;
        h = 0.5 - late * 0.15 + noiseT * 0.15 - crack * 0.6;
      }
      const i = (py * W + px) * 4;
      col[i] = toSRGB8(r); col[i + 1] = toSRGB8(g); col[i + 2] = toSRGB8(b); col[i + 3] = 255;
      hgt[py * W + px] = h;
    }
  }
  const nrm = normalFromHeight(hgt, W, H, 5.0, false);
  return { map: canvasTex(col, W, H, true), normalMap: canvasTex(nrm, W, H, false) };
}

function wrapDraw(size, x, y, fn) {
  for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
    if (Math.abs(x + ox - size / 2) < size * 0.5 + 80 && Math.abs(y + oy - size / 2) < size * 0.5 + 80) fn(x + ox, y + oy);
  }
}

export function makeForestFloor() {
  const S = 1024;
  const rnd = mulberry32(77);
  const base = new Uint8ClampedArray(S * S * 4);
  const baseH = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const n = fbm2p(u * 8, v * 8, 8, 8, 5) * 0.5 + 0.5;
    const m = smooth(0.52, 0.7, fbm2p(u * 3 + 5, v * 3, 3, 3, 4) * 0.5 + 0.5);
    const g = fbm2p(u * 64, v * 64, 64, 64, 2) * 0.5 + 0.5;
    let r = 0.05 + n * 0.05, gg = 0.04 + n * 0.035, b = 0.03 + n * 0.022;
    r += (0.06 - r) * m * 0.7; gg += (0.085 - gg) * m * 0.7; b += (0.035 - b) * m * 0.7;
    r *= 0.85 + g * 0.3; gg *= 0.85 + g * 0.3; b *= 0.85 + g * 0.3;
    const i = (y * S + x) * 4;
    base[i] = toSRGB8(r); base[i + 1] = toSRGB8(gg); base[i + 2] = toSRGB8(b); base[i + 3] = 255;
    baseH[y * S + x] = n * 0.3 + g * 0.15 + m * 0.1;
  }
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S); img.data.set(base); ctx.putImageData(img, 0, 0);
  const hc = document.createElement('canvas'); hc.width = hc.height = S;
  const hctx = hc.getContext('2d');
  const himg = hctx.createImageData(S, S);
  for (let i = 0; i < S * S; i++) { const v = Math.round(baseH[i] * 255); himg.data[i * 4] = himg.data[i * 4 + 1] = himg.data[i * 4 + 2] = v; himg.data[i * 4 + 3] = 255; }
  hctx.putImageData(himg, 0, 0);
  ctx.lineCap = hctx.lineCap = 'round';

  for (let k = 0; k < 55; k++) {
    const x = rnd() * S, y = rnd() * S, len = 50 + rnd() * 110, a = rnd() * Math.PI, w = 2 + rnd() * 4;
    const bend = (rnd() - 0.5) * 30;
    const shade = 14 + rnd() * 14;
    wrapDraw(S, x, y, (X, Y) => {
      const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
      for (const [cx, cs, cw, cc] of [[ctx, `rgb(${shade + 10},${shade},${shade - 6})`, w, 0], [hctx, 'rgb(230,230,230)', w, 1]]) {
        cx.strokeStyle = cs; cx.lineWidth = cw;
        cx.beginPath(); cx.moveTo(X - dx, Y - dy); cx.quadraticCurveTo(X + bend, Y - bend, X + dx, Y + dy); cx.stroke();
      }
    });
  }
  for (let k = 0; k < 150; k++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, rw = 6 + rnd() * 9, rh = rw * (0.45 + rnd() * 0.25);
    const hue = rnd();
    const R = Math.round(34 + hue * 26 + rnd() * 10), G = Math.round(24 + hue * 14 + rnd() * 6), B = Math.round(14 + rnd() * 6);
    wrapDraw(S, x, y, (X, Y) => {
      ctx.fillStyle = `rgb(${R},${G},${B})`;
      ctx.beginPath(); ctx.ellipse(X, Y, rw, rh, a, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(20,12,6,0.6)`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(X - Math.cos(a) * rw, Y - Math.sin(a) * rw); ctx.lineTo(X + Math.cos(a) * rw, Y + Math.sin(a) * rw); ctx.stroke();
      hctx.fillStyle = 'rgba(200,200,200,0.9)';
      hctx.beginPath(); hctx.ellipse(X, Y, rw, rh, a, 0, Math.PI * 2); hctx.fill();
    });
  }
  for (let k = 0; k < 7500; k++) {
    const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI * 2, len = 9 + rnd() * 13;
    const dry = rnd();
    const R = Math.round(40 + dry * 40), G = Math.round(30 + dry * 26), B = Math.round(21 + dry * 16);
    const lw = 0.8 + rnd() * 0.7;
    wrapDraw(S, x, y, (X, Y) => {
      const dx = Math.cos(a) * len / 2, dy = Math.sin(a) * len / 2;
      ctx.strokeStyle = `rgba(${R},${G},${B},0.45)`; ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(X - dx, Y - dy); ctx.lineTo(X + dx, Y + dy); ctx.stroke();
      hctx.strokeStyle = `rgba(255,255,255,0.3)`; hctx.lineWidth = lw;
      hctx.beginPath(); hctx.moveTo(X - dx, Y - dy); hctx.lineTo(X + dx, Y + dy); hctx.stroke();
    });
  }
  for (let k = 0; k < 160; k++) {
    const x = rnd() * S, y = rnd() * S, r0 = 2 + rnd() * 5, gv = Math.round(55 + rnd() * 50);
    wrapDraw(S, x, y, (X, Y) => {
      ctx.fillStyle = `rgb(${gv},${gv - 4},${gv - 10})`;
      ctx.beginPath(); ctx.ellipse(X, Y, r0, r0 * 0.8, rnd() * 3, 0, Math.PI * 2); ctx.fill();
      hctx.fillStyle = 'rgb(255,255,255)';
      hctx.beginPath(); hctx.ellipse(X, Y, r0, r0 * 0.8, 0, 0, Math.PI * 2); hctx.fill();
    });
  }
  const hd = hctx.getImageData(0, 0, S, S).data;
  const H = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) H[i] = hd[i * 4] / 255;
  const nrm = normalFromHeight(H, S, S, 2.2, true);
  const map = new THREE.CanvasTexture(c);
  map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping; map.anisotropy = 8;
  const normalMap = canvasTex(nrm, S, S, false, true); normalMap.anisotropy = 8;
  return { map, normalMap };
}

export function makeAsh() {
  const S = 512;
  const rnd = mulberry32(5);
  const col = new Uint8ClampedArray(S * S * 4);
  const H = new Float32Array(S * S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = x / S, v = y / S;
    const n = fbm2p(u * 10, v * 10, 10, 10, 5) * 0.5 + 0.5;
    const chunks = smooth(0.55, 0.62, fbm2p(u * 24 + 3, v * 24, 24, 24, 3) * 0.5 + 0.5);
    const white = smooth(0.6, 0.75, fbm2p(u * 6 + 8, v * 6, 6, 6, 4) * 0.5 + 0.5);
    let l = 0.05 + n * 0.08 + white * 0.22;
    l *= 1 - chunks * 0.8;
    const i = (y * S + x) * 4;
    col[i] = toSRGB8(l * 1.02); col[i + 1] = toSRGB8(l); col[i + 2] = toSRGB8(l * 0.95); col[i + 3] = 255;
    H[y * S + x] = n * 0.4 + chunks * 0.5;
  }
  for (let k = 0; k < 2500; k++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    const i = (y * S + x) * 4;
    const w = rnd() < 0.5;
    const l = w ? 200 + rnd() * 50 : 8;
    col[i] = col[i + 1] = col[i + 2] = l;
  }
  const nrm = normalFromHeight(H, S, S, 4.0, true);
  return { map: canvasTex(col, S, S, true, true), normalMap: canvasTex(nrm, S, S, false, true) };
}

export function makeTrunkBark() {
  const W = 512, H = 512;
  const col = new Uint8ClampedArray(W * H * 4);
  const hgt = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H;
    const warp = fbm2p(u * 5, v * 2, 5, 2, 3) * 0.5;
    const ridge = 1 - Math.abs(fbm2p(u * 10 + warp, v * 1.5, 10, 2, 4) * 2.3);
    const fiss = smooth(0.2, 0.8, ridge);
    const cross = smooth(0.6, 0.78, Math.abs(noise2p(u * 14, v * 7, 14, 7)));
    const n2 = fbm2p(u * 48, v * 24, 48, 24, 3) * 0.5 + 0.5;
    const tone = fbm2p(u * 3 + 7, v * 2, 3, 2, 3) * 0.5 + 0.5;
    const h = fiss * (1 - cross * 0.5) * 0.8 + n2 * 0.2;
    const t = clamp01(h * 0.9 + (n2 - 0.5) * 0.2);
    const r = 0.035 + t * (0.16 + tone * 0.05), g = 0.028 + t * (0.12 + tone * 0.03), b = 0.022 + t * (0.095 + tone * 0.02);
    const i = (y * W + x) * 4;
    col[i] = toSRGB8(r); col[i + 1] = toSRGB8(g); col[i + 2] = toSRGB8(b); col[i + 3] = 255;
    hgt[y * W + x] = h;
  }
  const nrm = normalFromHeight(hgt, W, H, 5.0, true);
  return { map: canvasTex(col, W, H, true, true), normalMap: canvasTex(nrm, W, H, false, true) };
}

export function makeGrassCard() {
  const W = 256, H = 256;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  const rnd = mulberry32(31);
  ctx.lineCap = 'round';
  for (let k = 0; k < 46; k++) {
    const x0 = W * (0.2 + rnd() * 0.6), len = H * (0.35 + rnd() * 0.6), lean = (rnd() - 0.5) * W * 0.5;
    const dry = rnd();
    const R = Math.round(40 + dry * 90), G = Math.round(55 + dry * 50), B = Math.round(20 + dry * 15);
    const w0 = 2.5 + rnd() * 3;
    const steps = 10;
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps, t1 = (s + 1) / steps;
      const xa = x0 + lean * t0 * t0, ya = H - len * t0;
      const xb = x0 + lean * t1 * t1, yb = H - len * t1;
      const sh = 0.55 + 0.45 * t1;
      ctx.strokeStyle = `rgb(${Math.round(R * sh)},${Math.round(G * sh)},${Math.round(B * sh)})`;
      ctx.lineWidth = w0 * (1 - t0 * 0.85);
      ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(xb, yb); ctx.stroke();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

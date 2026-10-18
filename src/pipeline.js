// Render pipeline: HDR scene + depth, FX layer (fire/smoke/sparks), dual-filter bloom, heat haze, ACES grade.
import * as THREE from 'three';
import { GLSL_COMMON } from './noise.js';

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DOWN_FIRST = /* glsl */`
uniform sampler2D tScene; uniform sampler2D tFX; uniform vec2 texel;
varying vec2 vUv;
vec3 S(vec2 uv) { vec4 f = texture2D(tFX, uv); vec3 c = texture2D(tScene, uv).rgb * (1.0 - f.a) + f.rgb; return min(c, vec3(60.0)); }
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 K(vec3 a, vec3 b, vec3 c, vec3 d) { vec3 s = (a + b + c + d) * 0.25; return s / (1.0 + lum(s) * 0.25); }
void main() {
  vec2 t = texel;
  vec3 a = S(vUv + t * vec2(-2, 2)), b = S(vUv + t * vec2(0, 2)), c = S(vUv + t * vec2(2, 2));
  vec3 d = S(vUv + t * vec2(-2, 0)), e = S(vUv), f = S(vUv + t * vec2(2, 0));
  vec3 g = S(vUv + t * vec2(-2, -2)), h = S(vUv + t * vec2(0, -2)), i = S(vUv + t * vec2(2, -2));
  vec3 j = S(vUv + t * vec2(-1, 1)), k = S(vUv + t * vec2(1, 1)), l = S(vUv + t * vec2(-1, -1)), m = S(vUv + t * vec2(1, -1));
  vec3 o = K(j, k, l, m) * 0.5 + K(a, b, d, e) * 0.125 + K(b, c, e, f) * 0.125 + K(d, e, g, h) * 0.125 + K(e, f, h, i) * 0.125;
  gl_FragColor = vec4(o, 1.0);
}
`;

const DOWN = /* glsl */`
uniform sampler2D tSrc; uniform vec2 texel;
varying vec2 vUv;
vec3 S(vec2 uv) { return texture2D(tSrc, uv).rgb; }
void main() {
  vec2 t = texel;
  vec3 a = S(vUv + t * vec2(-2, 2)), b = S(vUv + t * vec2(0, 2)), c = S(vUv + t * vec2(2, 2));
  vec3 d = S(vUv + t * vec2(-2, 0)), e = S(vUv), f = S(vUv + t * vec2(2, 0));
  vec3 g = S(vUv + t * vec2(-2, -2)), h = S(vUv + t * vec2(0, -2)), i = S(vUv + t * vec2(2, -2));
  vec3 j = S(vUv + t * vec2(-1, 1)), k = S(vUv + t * vec2(1, 1)), l = S(vUv + t * vec2(-1, -1)), m = S(vUv + t * vec2(1, -1));
  vec3 o = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  gl_FragColor = vec4(o, 1.0);
}
`;

const UP = /* glsl */`
uniform sampler2D tSrc; uniform vec2 texel; uniform float radius; uniform float weight;
varying vec2 vUv;
vec3 S(vec2 uv) { return texture2D(tSrc, uv).rgb; }
void main() {
  vec2 t = texel * radius;
  vec3 o = S(vUv) * 4.0;
  o += (S(vUv + vec2(-t.x, 0)) + S(vUv + vec2(t.x, 0)) + S(vUv + vec2(0, -t.y)) + S(vUv + vec2(0, t.y))) * 2.0;
  o += S(vUv + vec2(-t.x, -t.y)) + S(vUv + vec2(t.x, -t.y)) + S(vUv + vec2(-t.x, t.y)) + S(vUv + vec2(t.x, t.y));
  gl_FragColor = vec4(o / 16.0 * weight, 1.0);
}
`;

const ACCUM = /* glsl */`
uniform sampler2D tCur; uniform sampler2D tPrev; uniform float alpha;
varying vec2 vUv;
void main() { gl_FragColor = mix(texture2D(tPrev, vUv), texture2D(tCur, vUv), alpha); }
`;

const LUM = /* glsl */`
uniform sampler2D tSrc; uniform float alpha;
varying vec2 vUv;
void main() {
  float acc = 0.0, wsum = 0.0;
  for (int j = 0; j < 6; j++) for (int i = 0; i < 6; i++) {
    vec2 uv = (vec2(float(i), float(j)) + 0.5) / 6.0;
    vec2 d = uv - 0.5;
    float w = exp(-dot(d, d) * 5.0);
    vec3 c = texture2D(tSrc, uv).rgb;
    acc += log(dot(c, vec3(0.2126, 0.7152, 0.0722)) + 0.002) * w;
    wsum += w;
  }
  gl_FragColor = vec4(vec3(exp(acc / wsum)), alpha);
}
`;

const FINAL = /* glsl */`
precision highp sampler3D;
uniform sampler2D tScene; uniform sampler2D tFX; uniform sampler2D tBloom; uniform sampler2D tDepth; uniform sampler2D tLum;
uniform sampler3D tNoise; uniform float uKey; uniform float uMinE; uniform float uMaxE;
uniform vec2 resolution; uniform float time; uniform float exposure; uniform float bloomStrength;
uniform vec2 hazeBase; uniform vec2 hazeTop; uniform float hazeWidth; uniform float hazeStrength; uniform float hazeDist;
uniform float cNear; uniform float cFar; uniform float fade; uniform float fxScale;
varying vec2 vUv;
${GLSL_COMMON}
vec3 aces(vec3 x) {
  const mat3 I = mat3(0.59719, 0.07600, 0.02840, 0.35458, 0.90834, 0.13383, 0.04823, 0.01566, 0.83777);
  const mat3 O = mat3(1.60475, -0.10208, -0.00327, -0.53108, 1.10813, -0.07276, -0.07367, -0.00605, 1.07602);
  x = I * x;
  vec3 a = x * (x + 0.0245786) - 0.000090537;
  vec3 b = x * (0.983729 * x + 0.4329510) + 0.238081;
  return clamp(O * (a / b), 0.0, 1.0);
}
float viewDist(float d) { float z = d * 2.0 - 1.0; return 2.0 * cNear * cFar / (cFar + cNear - z * (cFar - cNear)); }
vec3 toSRGB(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec2 uv = vUv;
  float aspect = resolution.x / resolution.y;
  vec2 ax = hazeTop - hazeBase;
  vec2 rel = (uv - hazeBase) * vec2(aspect, 1.0);
  vec2 axa = ax * vec2(aspect, 1.0);
  float L = max(length(axa), 1e-4);
  float s = dot(rel, axa) / (L * L);
  float lat = length(rel - axa * clamp(s, 0.0, 1.0));
  float mask = smoothstep(hazeWidth * (1.0 + s * 0.8), 0.0, lat) * smoothstep(-0.05, 0.25, s) * smoothstep(1.15, 0.55, s);
  vec2 off = vec2(0.0);
  if (mask > 0.001) {
    float dd = viewDist(texture2D(tDepth, uv).r);
    mask *= smoothstep(hazeDist - 0.6, hazeDist - 0.1, dd);
    vec3 nq = vec3(uv.x * aspect * 7.0, uv.y * 5.0 - time * 1.3, time * 0.25);
    vec2 n = texture(tNoise, nq).rg - 0.5;
    vec2 n2 = texture(tNoise, nq * 2.3 + vec3(0.0, -time * 0.9, 0.0)).ba - 0.5;
    off = (n + n2 * 0.5) * hazeStrength * mask;
  }
  vec2 ft = 0.75 / (resolution * fxScale);
  vec2 fuv = uv + off * 0.5;
  vec4 fx = texture2D(tFX, fuv) * 0.4 + (texture2D(tFX, fuv + vec2(ft.x, ft.y)) + texture2D(tFX, fuv + vec2(-ft.x, ft.y)) + texture2D(tFX, fuv + vec2(ft.x, -ft.y)) + texture2D(tFX, fuv + vec2(-ft.x, -ft.y))) * 0.15;
  vec3 scene = texture2D(tScene, uv + off).rgb;
  vec3 col = scene * (1.0 - fx.a) + fx.rgb;
  vec3 bloom = texture2D(tBloom, uv).rgb;
  col = col + bloom * bloomStrength;
  float aL = texture2D(tLum, vec2(0.5)).r;
  col *= exposure * clamp(pow(uKey / max(aL, 1e-4), 0.6), uMinE, uMaxE);
  vec2 vq = (uv - 0.5) * vec2(aspect, 1.0);
  col *= 1.0 - smoothstep(0.35, 1.25, length(vq)) * 0.55;
  col = aces(col);
  col = toSRGB(col);
  float g = ign(gl_FragCoord.xy + fract(time * 7.13) * 97.0);
  col += (g - 0.5) * (1.5 / 255.0);
  float grain = hash12(gl_FragCoord.xy * 0.73 + fract(time) * 431.0) - 0.5;
  col += grain * 0.012 * (1.0 - col);
  gl_FragColor = vec4(col * fade, 1.0);
}
`;

export class Pipeline {
  constructor(renderer, noiseTex) {
    this.renderer = renderer;
    this.noiseTex = noiseTex;
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const mk = (fs, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: fs, uniforms, depthTest: false, depthWrite: false, ...extra });
    this.mDownFirst = mk(DOWN_FIRST, { tScene: { value: null }, tFX: { value: null }, texel: { value: new THREE.Vector2() } });
    this.mDown = mk(DOWN, { tSrc: { value: null }, texel: { value: new THREE.Vector2() } });
    this.mUp = mk(UP, { tSrc: { value: null }, texel: { value: new THREE.Vector2() }, radius: { value: 1.0 }, weight: { value: 1.0 } }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    });
    this.mFinal = mk(FINAL, {
      tScene: { value: null }, tFX: { value: null }, tBloom: { value: null }, tDepth: { value: null }, tNoise: { value: noiseTex },
      resolution: { value: new THREE.Vector2() }, time: { value: 0 }, exposure: { value: 1.0 }, bloomStrength: { value: 0.06 },
      hazeBase: { value: new THREE.Vector2(0.5, 0.4) }, hazeTop: { value: new THREE.Vector2(0.5, 0.8) }, hazeWidth: { value: 0.1 },
      hazeStrength: { value: 0.006 }, hazeDist: { value: 3 }, cNear: { value: 0.05 }, cFar: { value: 200 }, fade: { value: 0 }, fxScale: { value: 1 },
      tLum: { value: null }, uKey: { value: 0.075 }, uMinE: { value: 0.4 }, uMaxE: { value: 3.2 },
    });
    this.mLum = mk(LUM, { tSrc: { value: null }, alpha: { value: 1 } }, {
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.SrcAlphaFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.lumRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.mAccum = mk(ACCUM, { tCur: { value: null }, tPrev: { value: null }, alpha: { value: 1 } });
    this.hist = [];
    this.histIdx = 0;
    this.histValid = false;
    this.motion = 1;
    this.lumInit = false;
    this.levels = 6;
    this.mips = [];
    this.msaa = 0;
  }

  setSize(w, h, msaa, fxScale) {
    this.w = w; this.h = h; this.fxScale = fxScale;
    const recreate = !this.sceneRT || this.msaa !== msaa;
    this.msaa = msaa;
    if (recreate) {
      if (this.sceneRT) { this.sceneRT.dispose(); this.sceneRT.depthTexture.dispose(); }
      const dt = new THREE.DepthTexture(w, h);
      dt.type = THREE.UnsignedIntType;
      this.sceneRT = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, samples: msaa, depthTexture: dt, depthBuffer: true });
      this.sceneRT.texture.minFilter = this.sceneRT.texture.magFilter = THREE.LinearFilter;
    } else {
      this.sceneRT.setSize(w, h);
    }
    const fw = Math.max(1, Math.round(w * fxScale)), fh = Math.max(1, Math.round(h * fxScale));
    if (!this.fxRT) {
      this.fxRT = new THREE.WebGLRenderTarget(fw, fh, { type: THREE.HalfFloatType, depthBuffer: false });
      this.fxRT.texture.minFilter = this.fxRT.texture.magFilter = THREE.LinearFilter;
      for (let i = 0; i < 2; i++) {
        this.hist[i] = new THREE.WebGLRenderTarget(fw, fh, { type: THREE.HalfFloatType, depthBuffer: false });
        this.hist[i].texture.minFilter = this.hist[i].texture.magFilter = THREE.LinearFilter;
      }
    } else { this.fxRT.setSize(fw, fh); for (const h of this.hist) h.setSize(fw, fh); }
    this.histValid = false;
    let mw = w, mh = h;
    for (let i = 0; i < this.levels; i++) {
      mw = Math.max(1, Math.floor(mw / 2)); mh = Math.max(1, Math.floor(mh / 2));
      if (!this.mips[i]) {
        this.mips[i] = new THREE.WebGLRenderTarget(mw, mh, { type: THREE.HalfFloatType, depthBuffer: false });
        this.mips[i].texture.minFilter = this.mips[i].texture.magFilter = THREE.LinearFilter;
      } else this.mips[i].setSize(mw, mh);
    }
    this.mFinal.uniforms.resolution.value.set(w, h);
    this.mFinal.uniforms.fxScale.value = fw / w;
  }

  pass(mat, target, clear = true) {
    this.quad.material = mat;
    this.renderer.setRenderTarget(target);
    if (clear) this.renderer.clear(true, false, false);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  render(scene, fxScene, camera, time) {
    const r = this.renderer;
    r.autoClear = false;
    r.setClearColor(0x000000, 1);
    r.setRenderTarget(this.sceneRT);
    r.clear(true, true, true);
    r.render(scene, camera);

    r.setClearColor(0x000000, 0);
    r.setRenderTarget(this.fxRT);
    r.clear(true, false, false);
    const sm = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.render(fxScene, camera);
    r.shadowMap.autoUpdate = sm;
    r.setClearColor(0x000000, 1);

    const prev = this.hist[this.histIdx], next = this.hist[1 - this.histIdx];
    const ma = this.mAccum.uniforms;
    ma.tCur.value = this.fxRT.texture; ma.tPrev.value = prev.texture;
    ma.alpha.value = this.histValid ? Math.min(1, 1 - Math.pow(0.55, 60 * Math.min(this.dt ?? 0.016, 0.1)) + 0.55 * Math.min(1, this.motion)) : 1;
    this.pass(this.mAccum, next);
    this.histIdx = 1 - this.histIdx;
    this.histValid = true;
    const fxTex = next.texture;
    const md = this.mDownFirst.uniforms;
    md.tScene.value = this.sceneRT.texture; md.tFX.value = fxTex;
    md.texel.value.set(1 / this.w, 1 / this.h);
    this.pass(this.mDownFirst, this.mips[0]);
    for (let i = 1; i < this.levels; i++) {
      this.mDown.uniforms.tSrc.value = this.mips[i - 1].texture;
      this.mDown.uniforms.texel.value.set(1 / this.mips[i - 1].width, 1 / this.mips[i - 1].height);
      this.pass(this.mDown, this.mips[i]);
    }
    for (let i = this.levels - 1; i > 0; i--) {
      this.mUp.uniforms.tSrc.value = this.mips[i].texture;
      this.mUp.uniforms.texel.value.set(1 / this.mips[i].width, 1 / this.mips[i].height);
      this.mUp.uniforms.weight.value = 1.0;
      this.pass(this.mUp, this.mips[i - 1], false);
    }
    this.mLum.uniforms.tSrc.value = this.mips[3].texture;
    this.mLum.uniforms.alpha.value = this.lumInit ? 1 - Math.exp(-(this.dt ?? 0.016) * 1.1) : 1;
    this.lumInit = true;
    this.pass(this.mLum, this.lumRT, false);
    const f = this.mFinal.uniforms;
    f.tLum.value = this.lumRT.texture;
    f.tScene.value = this.sceneRT.texture; f.tFX.value = fxTex; f.tBloom.value = this.mips[0].texture;
    f.tDepth.value = this.sceneRT.depthTexture; f.time.value = time;
    f.cNear.value = camera.near; f.cFar.value = camera.far;
    f.bloomStrength.value = this.bloomStrength ?? 0.06;
    this.pass(this.mFinal, null);
  }
}

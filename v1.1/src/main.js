// Campfire: bootstrap, simulation loop, lighting flicker, adaptive quality.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fbm1 } from './noise.js';
import { loadAssets } from './assets.js';
import { Pipeline } from './pipeline.js';
import { Fire } from './fire.js';
import { Physics } from './physics.js';
import { World } from './world.js';
import { LogSystem } from './logs.js';
import { Particles } from './particles.js';
import { AudioEngine } from './audio.js';
import { Interaction } from './interaction.js';

THREE.ShaderChunk.lights_pars_begin = THREE.ShaderChunk.lights_pars_begin.replace('max( pow( lightDistance, decayExponent ), 0.01 )', '( pow( lightDistance, decayExponent ) + 0.1 )');

const $ = (s) => document.querySelector(s);
const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const gpuName = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const d = gl.getExtension('WEBGL_debug_renderer_info');
    return d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : '';
  } catch { return ''; }
})();
const weakGpu = /Intel|Mali|Adreno|PowerVR|SwiftShader|llvmpipe/i.test(gpuName);
const params = new URLSearchParams(location.search);
const Q = isMobile
  ? { pr: Math.min(devicePixelRatio, 1.5), fx: 0.5, msaa: 0, shadow: 512, trees: 70, grass: 420, steps: 44 }
  : weakGpu
    ? { pr: Math.min(devicePixelRatio, 1.0), fx: 0.5, msaa: 0, shadow: 768, trees: 100, grass: 700, steps: 56 }
    : { pr: Math.min(devicePixelRatio, 1.5), fx: 0.7, msaa: 4, shadow: 1024, trees: 120, grass: 900, steps: 80 };
if (params.has('low')) Object.assign(Q, { pr: 0.85, fx: 0.5, msaa: 0, shadow: 512, steps: 40 });
if (params.has('high')) Object.assign(Q, { pr: Math.min(devicePixelRatio, 2), fx: 0.75, msaa: 4, shadow: 1024, steps: 88 });

const ui = {
  hintEl: $('#hint'), statusEl: $('#status'), flashEl: $('#flash'),
  setHint(t) { this.hintEl.textContent = t; },
  setStatus(t, alert = false) {
    this.statusEl.textContent = t;
    this.statusEl.classList.toggle('show', !!t);
    this.statusEl.classList.toggle('alert', alert);
  },
  setTool(t) {
    document.querySelectorAll('[data-tool]').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
    $('#eat').classList.toggle('show', t === 'marshmallow');
  },
  flash(t) {
    this.flashEl.textContent = t;
    this.flashEl.classList.add('show');
    clearTimeout(this._ft);
    this._ft = setTimeout(() => this.flashEl.classList.remove('show'), 2600);
  },
};

const progress = (p, label) => {
  $('#bar').style.width = `${Math.round(p * 100)}%`;
  if (label) $('#loadlabel').textContent = label;
  return new Promise((r) => setTimeout(r, 0));
};

async function main() {
  const canvas = $('#c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  if (!renderer.capabilities.isWebGL2) { $('#loadlabel').textContent = 'WebGL2 is required.'; return; }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;

  await progress(0.02, 'Gathering firewood…');
  const [tex, physics] = await Promise.all([loadAssets((k) => progress(0.05 + k * 0.5)), Physics.create()]);
  const { noiseTex, atlases } = tex;
  await progress(0.6, 'Growing the forest…');

  const scene = new THREE.Scene();
  const fxScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.05, 200);
  camera.position.set(0.0, 1.0, 2.55);

  const world = new World({ scene, physics, noiseTex, atlases, tex, quality: Q });
  await progress(0.8, 'Building the fire…');

  const pipeline = new Pipeline(renderer, noiseTex);
  const fire = new Fire(noiseTex, null);
  fire.uniforms.steps.value = Q.steps;
  fxScene.add(fire.mesh);
  const particles = new Particles(noiseTex);
  fxScene.add(particles.group);

  const logs = new LogSystem({ scene, physics, noiseTex, atlases });
  buildInitialFire(logs);
  for (let i = 0; i < 180; i++) physics.world.step();
  for (const l of logs.logs) l.sync();

  const audio = new AudioEngine();
  const interaction = new Interaction({ camera, dom: canvas, controls: null, scene, logs, physics, particles, audio, world, fire, ui, noiseTex });
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.22, 0);
  controls.enableDamping = true; controls.dampingFactor = 0.07;
  controls.rotateSpeed = 0.55; controls.zoomSpeed = 0.7;
  controls.enablePan = false;
  controls.minDistance = 1.0; controls.maxDistance = 7.5;
  controls.minPolarAngle = 0.35; controls.maxPolarAngle = 1.47;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  controls.update();
  interaction.controls = controls;
  interaction.setTool('hand');

  let pr = Q.pr, fxScale = Q.fx;
  const resize = () => {
    const w = innerWidth, h = innerHeight;
    renderer.setPixelRatio(pr);
    renderer.setSize(w, h, false);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    pipeline.setSize(db.x, db.y, Q.msaa, fxScale);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fire.uniforms.resolution.value.set(pipeline.fxRT.width, pipeline.fxRT.height);
    fire.uniforms.tDepth.value = pipeline.sceneRT.depthTexture;
    particles.setDepth(pipeline.sceneRT.depthTexture, pipeline.fxRT.width, pipeline.fxRT.height, camera);
  };
  resize();
  addEventListener('resize', resize);

  await progress(0.95, 'Lighting the fire…');
  renderer.compile(scene, camera);
  renderer.compile(fxScene, camera);
  await progress(1, '');

  let wind = 0.15;
  const windVec = new THREE.Vector3();
  const windDir = new THREE.Vector3(1, 0, 0.3).normalize();
  const timer = new THREE.Timer();
  timer.connect(document);
  let time = 0;
  let fade = 0, started = false;
  let emberAcc = 0, smokeAcc = 0, wasOut = false;
  let frameAcc = 0, frameN = 0, adaptT = 0;
  let dbg = null;
  if (params.has('debug')) { dbg = document.createElement('div'); dbg.style.cssText = 'position:fixed;left:10px;top:10px;font:11px monospace;color:#9f9;z-index:99;text-shadow:0 0 3px #000'; document.body.appendChild(dbg); }
  const firePosSmooth = new THREE.Vector3(0, 0.3, 0);
  const prj = new THREE.Vector3();
  const prevCamPos = new THREE.Vector3(), prevCamQ = new THREE.Quaternion();

  $('#loader').classList.add('done');
  $('#intro').classList.add('show');
  const start = () => {
    if (started) return;
    started = true;
    $('#intro').classList.remove('show');
    $('#ui').classList.add('show');
    audio.start();
  };
  if (params.has('auto')) { start(); fade = 1; }
  $('#intro').addEventListener('click', start);
  $('#intro').addEventListener('touchend', (e) => { e.preventDefault(); start(); });

  document.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => interaction.setTool(b.dataset.tool)));
  $('#eat').addEventListener('click', () => interaction.eat());
  const windEl = $('#wind');
  windEl.addEventListener('input', () => { wind = windEl.value / 100; });
  wind = windEl.value / 100;
  const soundBtn = $('#sound');
  soundBtn.addEventListener('click', () => { audio.setMuted(!audio.muted); soundBtn.classList.toggle('off', audio.muted); });
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const map = { 1: 'hand', 2: 'log', 3: 'water', 4: 'match', 5: 'marshmallow' };
    if (map[k] && started) interaction.setTool(map[k]);
    if (k === 'e' && interaction.tool === 'marshmallow') interaction.eat();
    if (k === 'm') soundBtn.click();
  });
  document.addEventListener('visibilitychange', () => {
    if (!audio.ctx) return;
    if (document.hidden) audio.ctx.suspend(); else audio.ctx.resume();
  });

  renderer.setAnimationLoop(() => {
    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    time += dt;
    frameAcc += dt; frameN++;

    const gust = 0.75 + 0.35 * fbm1(time * 0.35) + 0.25 * fbm1(time * 1.3 + 9);
    windDir.set(Math.cos(0.3 + fbm1(time * 0.05 + 4) * 0.8), 0, Math.sin(0.3 + fbm1(time * 0.05 + 4) * 0.8));
    windVec.copy(windDir).multiplyScalar(wind * wind * 1.2 * gust);
    const windAir = wind * wind * 0.25 * gust;

    physics.step(dt, (h) => interaction.physicsStep(h));
    for (const l of logs.logs) {
      const v = l.body.linvel();
      const dv = Math.hypot(v.x - l.prevVel.x, v.y - l.prevVel.y, v.z - l.prevVel.z);
      const was = l.prevVel.length();
      if (dv > 0.9 && was > 0.8 && (l.thudT ?? 0) < time - 0.12) {
        l.thudT = time;
        audio.thud(Math.min(1, dv / 4), l.c, false);
        if (l.c.length() < 0.6 && logs.coal.heat > 0.3) particles.burst(l.c, Math.floor(dv * 18), { speed: dv * 0.4, up: 1.4 + dv * 0.3, life: 1.8 });
      }
      l.prevVel.set(v.x, v.y, v.z);
    }

    const air = Math.min(1.3, interaction.air + interaction.flare * 0.6 + windAir);
    logs.update(dt, time, air);
    for (const ev of logs.events) {
      if (ev.type === 'crackle') {
        audio.crackle(ev.strength, ev.pos);
        if (ev.strength > 0.3) particles.burst(ev.pos, 2 + Math.floor(ev.strength * 18), { speed: 0.6 + ev.strength * 1.6, up: 1.6 + ev.strength, life: 1.6 });
      } else if (ev.type === 'break') {
        particles.burst(ev.pos, 60, { speed: 1.2, up: 1.8, life: 2 });
        audio.crackle(1, ev.pos);
        audio.thud(0.5, ev.pos);
      }
    }
    interaction.update(dt, time);
    const out = logs.intensity < 0.05 && logs.coal.heat < 0.08 && !logs.logs.some((l) => l.maxHeat > 0.3);
    if (out && !wasOut && started) ui.flash(logs.logs.some((l) => l.wet > 0.3) ? 'The fire is out. Let the wood dry, then strike a match.' : 'The fire is out. Strike a match to relight it.');
    wasOut = out;

    const I = logs.intensity, coal = logs.coal;
    const { sources, plume } = logs.flameSources(air, windVec.length());
    for (const s of interaction.extraSources()) sources.push(s);
    fire.setSources(sources, plume, windVec, time);
    fire.uniforms.brightness.value = 1.0 + interaction.flare * 0.25 + interaction.air * 0.2;
    camera.getWorldDirection(fire.uniforms.camFwd.value);
    fire.uniforms.cNear.value = camera.near; fire.uniforms.cFar.value = camera.far;

    const flick = 1 + 0.16 * fbm1(time * 6.5) + 0.09 * fbm1(time * 14.3 + 3) + 0.05 * fbm1(time * 29 + 7);
    const cen = logs.centroid;
    const fl = world.fireLight;
    const Iw = Math.min(1, I / 3);
    fl.position.set(
      cen.x + fbm1(time * 3.1 + 11) * 0.05 * Iw + windVec.x * 0.12,
      Math.max(0.14, cen.y + 0.22 + 0.18 * Iw + fbm1(time * 4.3 + 5) * 0.04),
      cen.z + fbm1(time * 2.7 + 21) * 0.05 * Iw + windVec.z * 0.12,
    );
    let tempLight = 0;
    for (const s of interaction.extraSources()) tempLight += s.ha * 0.6;
    fl.intensity = (0.15 + 6.0 * Math.sqrt(I / 4) + coal.heat * (1 - coal.wet) * 0.9 + tempLight) * flick * (1 + interaction.flare * 0.25 + interaction.air * 0.35);
    world.coalLight.intensity = coal.heat * (1 - coal.wet) * 1.6 * (0.85 + 0.15 * fbm1(time * 1.7)) * (1 + interaction.air * 0.6);
    firePosSmooth.lerp(fl.position, Math.min(1, dt * 4));
    particles.firePos.copy(fl.position);
    particles.fireCol.set(fl.color.r, fl.color.g, fl.color.b).multiplyScalar(fl.intensity);
    particles.lightCol.set(fl.color.r, fl.color.g, fl.color.b).multiplyScalar(fl.intensity * 0.03);

    emberAcc += dt * (0.3 + I * 0.9 + coal.heat * 0.4 + interaction.air * 12 + interaction.flare * 5);
    while (emberAcc > 1) {
      emberAcc -= 1;
      const p = logs.randomHotPoint(0.35);
      if (p) particles.ember(p);
    }
    smokeAcc += dt;
    if (smokeAcc > 0.08) {
      const k = smokeAcc; smokeAcc = 0;
      if (I > 0.05 && Math.random() < k * (0.8 + I * 1.2)) {
        particles.smoke.emit(cen.x + (Math.random() - 0.5) * 0.15, fire.top * 0.75 + 0.15, cen.z + (Math.random() - 0.5) * 0.15, { size: 0.18, grow: 0.4, alpha: 0.035 + Math.random() * 0.03, vy: 0.7 + I * 0.15, life: 5 + Math.random() * 3 });
      }
      for (const l of logs.logs) {
        const h = l.maxHeat;
        const smoulder = (h > 0.1 && h < 0.5 ? 1 : 0) * (1 - Math.min(1, I / 2)) + (l.wet > 0.05 && h > 0.02 ? l.wet * 2 : 0);
        if (smoulder > 0 && Math.random() < k * smoulder * 1.4) {
          const p = l.a.clone().lerp(l.b, Math.random());
          particles.smoke.emit(p.x, p.y + 0.04, p.z, { size: 0.06, grow: 0.28, alpha: 0.07 + l.wet * 0.08, vy: 0.3 + Math.random() * 0.2, life: 6 + Math.random() * 3, kind: l.wet > 0.3 ? 0.6 : 0 });
        }
      }
      const cs = (coal.heat > 0.05 && coal.heat < 0.6 ? 0.8 : 0) * (1 - Math.min(1, I)) + coal.wet * 1.5 * (coal.heat > 0.02 ? 1 : 0.2);
      if (Math.random() < k * cs) {
        const a = Math.random() * 6.28, r = Math.random() * 0.3;
        particles.smoke.emit(Math.cos(a) * r, 0.04, Math.sin(a) * r, { size: 0.08, grow: 0.3, alpha: 0.06 + coal.wet * 0.06, vy: 0.35, life: 7, kind: coal.wet > 0.3 ? 0.7 : 0 });
      }
    }
    particles.update(dt, time, windVec, camera, { centroid: cen, intensity: I, floorAt: floorAt(logs) });

    world.update(time, coal.heat * (1 - coal.wet), windVec);
    world.sky.position.copy(camera.position);

    controls.update();
    camera.updateMatrixWorld();

    const f = pipeline.mFinal.uniforms;
    const hazeOn = Math.min(1, I / 2) * 0.9 + coal.heat * 0.15;
    prj.set(cen.x, Math.max(0.05, cen.y), cen.z).project(camera);
    f.hazeBase.value.set(prj.x * 0.5 + 0.5, prj.y * 0.5 + 0.5);
    prj.set(cen.x, fire.top + 0.55, cen.z).project(camera);
    f.hazeTop.value.set(prj.x * 0.5 + 0.5, prj.y * 0.5 + 0.5);
    const dist = camera.position.distanceTo(cen);
    f.hazeWidth.value = 0.42 / dist / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.5;
    f.hazeStrength.value = 0.0045 * hazeOn;
    f.hazeDist.value = dist;
    fade = Math.min(1, fade + dt * (started ? 0.5 : 0.35));
    f.fade.value = fade * fade;
    f.exposure.value = 1.0;
    pipeline.bloomStrength = 0.075;

    const camMove = prevCamPos.distanceTo(camera.position) / Math.max(dt, 1e-3) * 0.6 + prevCamQ.angleTo(camera.quaternion) / Math.max(dt, 1e-3) * 1.2;
    prevCamPos.copy(camera.position); prevCamQ.copy(camera.quaternion);
    pipeline.motion = camMove;
    fire.renderField(renderer);
    pipeline.dt = dt;
    pipeline.render(scene, fxScene, camera, time);

    audio.update(dt, {
      intensity: I, coal: coal.heat * (1 - coal.wet), air: interaction.air + interaction.flare * 0.3, wind,
      steam: interaction.steam, pouring: interaction.pouring, blowing: interaction.blowing, firePos: firePosSmooth,
    }, camera);

    adaptT += dt;
    if (adaptT > 2.0) {
      const avg = frameAcc / frameN;
      if (dbg) dbg.textContent = `${(1 / avg).toFixed(0)} fps · ${gpuName.replace(/ANGLE \(|, ANGLE.*$/g, '')} · msaa ${Q.msaa} · ${pipeline.w}×${pipeline.h} · fx ${pipeline.fxRT.width}×${pipeline.fxRT.height} · steps ${fire.uniforms.steps.value} · logs ${logs.logs.length} · I ${I.toFixed(2)}`;
      frameAcc = 0; frameN = 0; adaptT = 0;
      if (time > 4 && !params.has('fixed') && avg > 1 / 48) {
        if (Q.msaa > 0) { Q.msaa = 0; resize(); }
        else if (fxScale > 0.5) { fxScale = 0.5; resize(); }
        else if (pr > 0.8) { pr = Math.max(0.8, pr - 0.2); resize(); }
        else if (fire.uniforms.steps.value > 40) fire.uniforms.steps.value -= 8;
        else if (world.fireLight.shadow.mapSize.x > 512) { world.fireLight.shadow.mapSize.set(512, 512); world.fireLight.shadow.map?.dispose(); world.fireLight.shadow.map = null; }
      }
    }
  });
  window.__campfire = { readLum: () => { const b = new Uint16Array(4); renderer.readRenderTargetPixels(pipeline.lumRT, 0, 0, 1, 1, b); return THREE.DataUtils.fromHalfFloat(b[0]); }, logs, fire, camera, controls, interaction, world, pipeline, renderer, Q, setPR: (v) => { pr = v; resize(); } };
}

function floorAt(logs) {
  return (x, z) => {
    let y = 0.01;
    for (const l of logs.logs) {
      const ax = l.a.x, az = l.a.z, bx = l.b.x, bz = l.b.z;
      const abx = bx - ax, abz = bz - az;
      const t = Math.max(0, Math.min(1, ((x - ax) * abx + (z - az) * abz) / (abx * abx + abz * abz + 1e-6)));
      const px = ax + abx * t, pz = az + abz * t;
      const r = l.radius * l.scaleApplied;
      const d = Math.hypot(x - px, z - pz);
      if (d < r) y = Math.max(y, l.a.y + (l.b.y - l.a.y) * t + Math.sqrt(r * r - d * d));
    }
    return y;
  };
}

function buildInitialFire(logs) {
  const place = (spec, x, y, z, yaw, pitch = 0) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, Math.PI / 2 + pitch, 'YXZ'));
    return logs.spawn({ ...spec, pos: new THREE.Vector3(x, y, z), quat: q });
  };
  const rnd = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const base = [0.35, 1.9, 3.5, 5.0];
  for (let i = 0; i < base.length; i++) {
    const a = base[i] + (rnd() - 0.5) * 0.3;
    const spec = logs.randomLogSpec(rnd);
    const r = 0.11 + spec.len / 2;
    place(spec, Math.cos(a) * r, 0.07, Math.sin(a) * r, -a, 0);
  }
  const top = [[0.8, 0.22], [2.5, 0.3], [4.2, 0.38]];
  for (const [yaw, y] of top) {
    const spec = logs.randomLogSpec(rnd);
    place(spec, (rnd() - 0.5) * 0.06, y, (rnd() - 0.5) * 0.06, yaw, (rnd() - 0.5) * 0.25);
  }
  for (const l of logs.logs) {
    l.sync();
    const aIn = l.a.length() < l.b.length();
    const hin = 0.9 + rnd() * 0.12, hout = 0.45 + rnd() * 0.3;
    l.heatA = aIn ? hin : hout; l.heatB = aIn ? hout : hin;
    l.charA = aIn ? 1.0 : 0.25; l.charB = aIn ? 0.25 : 1.0;
    l.fuel = 0.7 + rnd() * 0.25;
  }
}

main().catch((e) => { console.error(e); const el = document.querySelector('#loadlabel'); if (el) el.textContent = 'Something went wrong: ' + e.message; });

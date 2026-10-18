// Tools: hand (grab / stir / blow), add log, water, match, marshmallow on a stick.
import * as THREE from 'three';

const HINTS = {
  hand: 'Drag logs around · click the fire to stir it · press and hold on the embers to blow',
  log: 'Click to take a log from the pile · drag to place it · release to drop',
  water: 'Hold to throw water on the fire',
  match: 'Click a log or the embers to light it',
  marshmallow: 'Hold the marshmallow near the flames · scroll to raise or lower it',
};

const TOAST = [
  [0.0, 'Raw. Get it closer to the heat.'],
  [0.08, 'Warming up…'],
  [0.2, 'Lightly toasted'],
  [0.34, 'Golden brown. Perfect, eat it!'],
  [0.52, 'Getting dark…'],
  [0.7, 'Burnt'],
];

function toastColor(t, out) {
  const stops = [
    [0.0, [0.92, 0.9, 0.86]], [0.2, [0.9, 0.78, 0.55]], [0.38, [0.78, 0.5, 0.2]],
    [0.55, [0.42, 0.22, 0.08]], [0.75, [0.08, 0.05, 0.03]], [1.0, [0.02, 0.02, 0.02]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const k = (t - a) / (b - a);
      return out.setRGB(ca[0] + (cb[0] - ca[0]) * k, ca[1] + (cb[1] - ca[1]) * k, ca[2] + (cb[2] - ca[2]) * k);
    }
  }
  return out.setRGB(0.02, 0.02, 0.02);
}

export class Interaction {
  constructor(o) {
    Object.assign(this, o);
    this.tool = 'hand';
    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.hasPointer = false;
    this.grab = null;
    this.down = null;
    this.blowing = false;
    this.pouring = false;
    this.pourTarget = new THREE.Vector3();
    this.steam = 0;
    this.air = 0;
    this.flare = 0;
    this.tempSources = [];
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.tmp = new THREE.Vector3();
    this.buildMarshmallow();
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => this.onDown(e), { capture: true });
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    d.addEventListener('wheel', (e) => this.onWheel(e), { capture: true, passive: false });
    d.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setTool(t) {
    this.tool = t;
    this.stick.visible = t === 'marshmallow';
    this.ui.setHint(HINTS[t]);
    this.ui.setTool(t);
    this.ui.setStatus(t === 'marshmallow' ? this.toastText() : '');
    this.dom.style.cursor = t === 'hand' ? 'grab' : t === 'marshmallow' ? 'none' : 'crosshair';
    if (t === 'marshmallow') { this.controls.enabled = true; this.camPull = true; }
  }

  setNdc(e) {
    const r = this.dom.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.hasPointer = true;
  }

  cast() { this.ray.setFromCamera(this.ndc, this.camera); return this.ray; }

  hitLogs() {
    const h = this.cast().intersectObjects(this.logs.logs.map((l) => l.mesh), false);
    return h[0] ?? null;
  }

  hitGround(y = 0) {
    this.plane.constant = -y;
    const p = new THREE.Vector3();
    return this.cast().ray.intersectPlane(this.plane, p) ? p : null;
  }

  fireHit() {
    const r = this.cast().ray;
    const lh = this.hitLogs();
    if (lh && Math.hypot(lh.point.x, lh.point.z) < 0.6) return lh.point.clone();
    const top = Math.max(0.3, this.fire.top);
    const seg0 = new THREE.Vector3(0, 0.02, 0), seg1 = new THREE.Vector3(0, top, 0);
    const onRay = new THREE.Vector3(), onSeg = new THREE.Vector3();
    r.distanceSqToSegment(seg0, seg1, onRay, onSeg);
    if (onRay.distanceTo(onSeg) < 0.32 && onRay.distanceTo(r.origin) < 8) return onSeg.clone().setY(Math.min(onSeg.y, 0.25));
    const g = this.hitGround(0.02);
    if (g && Math.hypot(g.x, g.z) < 0.48) return g;
    return null;
  }

  onDown(e) {
    if (e.target !== this.dom) return;
    this.setNdc(e);
    if (e.button !== 0) return;
    const now = performance.now();
    if (this.tool === 'marshmallow') {
      this.controls.enabled = false;
      this.stickDrag = true;
      if (this.mm.onFire) { this.mm.onFire = false; this.audio.puff(); this.particles.burst(this.mm.tip, 6, { speed: 0.5, up: 0.4, life: 0.6 }); }
      return;
    }
    if (this.tool === 'hand') {
      const lh = this.hitLogs();
      if (lh) { this.startGrab(lh.object.userData.log, lh.point, now); return; }
      const pile = this.cast().intersectObject(this.world.woodpile, true)[0];
      if (pile) { this.takeLog(pile.point, now); return; }
      const bucket = this.cast().intersectObject(this.world.bucket, true)[0];
      if (bucket) { this.setTool('water'); return; }
      this.down = { x: e.clientX, y: e.clientY, t: now, moved: false, fire: this.fireHit() };
      return;
    }
    if (this.tool === 'log') {
      const pile = this.cast().intersectObject(this.world.woodpile, true)[0];
      const g = pile ? pile.point : this.hitGround(0);
      if (g) this.takeLog(g, now);
      return;
    }
    if (this.tool === 'water') {
      this.controls.enabled = false;
      this.pouring = true;
      this.updatePourTarget();
      return;
    }
    if (this.tool === 'match') {
      const lh = this.hitLogs();
      const p = lh ? lh.point : this.fireHit() ?? this.hitGround(0.02);
      if (!p) return;
      this.audio.oneShot('match', 0.9, p);
      const res = this.logs.ignite(p, 0.1);
      this.tempSources.push({ p: p.clone(), t: 0, life: 1.6 });
      this.particles.burst(p, 8, { speed: 0.3, up: 0.6, life: 0.8 });
      if (res === 'wet') this.ui.flash('Too wet to light. Give it time to dry.');
      else if (!res) this.ui.flash('Nothing to light there');
    }
  }

  takeLog(at, now) {
    if (this.logs.logs.length >= this.logs.maxLogs) { this.ui.flash('That is plenty of wood for now'); return; }
    const spec = this.logs.randomLogSpec();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 + (Math.random() - 0.5) * 0.3, Math.random() * Math.PI * 2, 0, 'YXZ'));
    const p = at.clone(); p.y = Math.max(p.y + 0.2, 0.35);
    const log = this.logs.spawn({ ...spec, pos: p, quat: q, heatA: 0, heatB: 0, fuel: 1 });
    log.sync();
    this.audio.thud(0.25, p, true);
    this.startGrab(log, p.clone(), now, true);
  }

  startGrab(log, point, now, fresh = false) {
    const b = log.body;
    const t = b.translation(), r = b.rotation();
    const qi = new THREE.Quaternion(r.x, r.y, r.z, r.w).invert();
    const local = point.clone().sub(new THREE.Vector3(t.x, t.y, t.z)).applyQuaternion(qi);
    this.grab = {
      log, local, height: fresh ? Math.max(point.y, 0.3) : point.y, lift: fresh ? 0 : Math.max(point.y + 0.22, 0.3), target: point.clone(), t: now, fresh,
      x0: this.ndc.x, y0: this.ndc.y, moved: false, point: point.clone(), inFire: Math.hypot(point.x, point.z) < 0.55,
    };
    b.setAngularDamping(3.0); b.setLinearDamping(1.2);
    b.wakeUp();
    this.controls.enabled = false;
    this.dom.style.cursor = 'grabbing';
    this.updateGrabTarget();
  }

  updateGrabTarget() {
    const g = this.grab;
    const p = this.hitGround(g.height);
    if (!p) return;
    const d = Math.hypot(p.x, p.z);
    if (d > 4) p.multiplyScalar(4 / d);
    p.y = g.height;
    g.target.copy(p);
  }

  updatePourTarget() {
    const p = this.fireHit() ?? this.hitGround(0.02);
    if (p) this.pourTarget.copy(p);
  }

  onMove(e) {
    this.setNdc(e);
    if (this.grab) {
      const g = this.grab;
      if (!g.moved && Math.hypot(this.ndc.x - g.x0, this.ndc.y - g.y0) > 0.015) {
        g.moved = true;
        if (g.lift) g.height = g.lift;
      }
      if (g.moved) this.updateGrabTarget();
    }
    if (this.down && Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) {
      this.down.moved = true;
      if (this.blowing) { this.blowing = false; }
    }
    if (this.pouring) this.updatePourTarget();
    if (this.tool === 'hand' && !this.grab && !this.down && e.pointerType === 'mouse' && e.target === this.dom) {
      this.hoverCheck = true;
    }
  }

  onUp(e) {
    const now = performance.now();
    if (this.grab) {
      const g = this.grab;
      g.log.body.setAngularDamping(0.35); g.log.body.setLinearDamping(0.08);
      if (!g.moved && !g.fresh && now - g.t < 300) this.poke(g.point);
      this.grab = null;
      this.controls.enabled = true;
      this.dom.style.cursor = this.tool === 'hand' ? 'grab' : 'crosshair';
    }
    if (this.down) {
      if (!this.down.moved && !this.down.fromGrab && now - this.down.t < 300 && this.down.fire) this.poke(this.down.fire);
      this.down = null;
      if (this.blowing) { this.blowing = false; }
      this.controls.enabled = true;
    }
    if (this.pouring) { this.pouring = false; this.controls.enabled = true; }
    if (this.stickDrag) { this.stickDrag = false; this.controls.enabled = true; }
  }

  onWheel(e) {
    if (this.grab) {
      e.preventDefault(); e.stopImmediatePropagation();
      this.grab.height = THREE.MathUtils.clamp(this.grab.height - e.deltaY * 0.0012, 0.12, 1.4);
      this.updateGrabTarget();
    } else if (this.tool === 'marshmallow') {
      e.preventDefault(); e.stopImmediatePropagation();
      this.mm.height = THREE.MathUtils.clamp(this.mm.height - e.deltaY * 0.0008, 0.12, 1.1);
    }
  }

  poke(p) {
    this.particles.burst(p, 70 + Math.floor(Math.random() * 60), { speed: 1.6, up: 2.2, life: 2.4 });
    this.audio.crackle(0.9, p);
    setTimeout(() => this.audio.crackle(0.5, p), 60 + Math.random() * 80);
    this.flare = Math.min(1.2, this.flare + 0.8);
    for (const l of this.logs.logs) {
      const d = l.c.distanceTo(p);
      if (d < 0.35) {
        const k = (1 - d / 0.35) * l.body.mass() * 0.9;
        l.body.applyImpulse({ x: (Math.random() - 0.5) * k, y: k * 0.6, z: (Math.random() - 0.5) * k }, true);
        l.body.applyTorqueImpulse({ x: (Math.random() - 0.5) * k * 0.03, y: 0, z: (Math.random() - 0.5) * k * 0.03 }, true);
      }
    }
    const c = this.logs.coal;
    if (Math.hypot(p.x, p.z) < c.radius + 0.1) c.heat = Math.min(1.15, c.heat + 0.08);
  }

  physicsStep(dt) {
    const g = this.grab;
    if (!g) return;
    if (g.log.dead || !this.logs.logs.includes(g.log)) { this.grab = null; this.controls.enabled = true; return; }
    const b = g.log.body;
    const t = b.translation(), r = b.rotation();
    const q = new THREE.Quaternion(r.x, r.y, r.z, r.w);
    const anchor = g.local.clone().applyQuaternion(q).add(new THREE.Vector3(t.x, t.y, t.z));
    const lv = b.linvel(), av = b.angvel();
    const rr = anchor.clone().sub(new THREE.Vector3(t.x, t.y, t.z));
    const va = new THREE.Vector3(lv.x, lv.y, lv.z).add(new THREE.Vector3(av.x, av.y, av.z).cross(rr));
    const k = 220, c = 26;
    const F = g.target.clone().sub(anchor).multiplyScalar(k).sub(va.multiplyScalar(c));
    const maxF = 80;
    if (F.length() > maxF) F.setLength(maxF);
    F.y += 9.81;
    const m = b.mass();
    b.applyImpulseAtPoint({ x: F.x * m * dt, y: F.y * m * dt, z: F.z * m * dt }, { x: anchor.x, y: anchor.y, z: anchor.z }, true);
  }

  buildMarshmallow() {
    const stick = new THREE.Group();
    const sg = new THREE.CylinderGeometry(0.0035, 0.007, 1, 8, 8);
    sg.translate(0, 0.5, 0); sg.rotateX(Math.PI / 2);
    const p = sg.attributes.position;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); p.setX(i, p.getX(i) + Math.sin(z * 9) * 0.004); p.setY(i, p.getY(i) + Math.sin(z * 5 + 1) * 0.005); }
    sg.computeVertexNormals();
    const wood = new THREE.MeshStandardMaterial({ color: new THREE.Color(0.2, 0.13, 0.07), roughness: 0.8 });
    this.stickMesh = new THREE.Mesh(sg, wood);
    this.stickMesh.castShadow = true;
    const R = 0.017, L = 0.03;
    const pts = [new THREE.Vector2(0, -L / 2), new THREE.Vector2(R - 0.004, -L / 2), new THREE.Vector2(R, -L / 2 + 0.004), new THREE.Vector2(R + 0.0008, 0), new THREE.Vector2(R, L / 2 - 0.004), new THREE.Vector2(R - 0.004, L / 2), new THREE.Vector2(0, L / 2)];
    const mg = new THREE.LatheGeometry(pts, 24);
    mg.rotateX(Math.PI / 2);
    this.mmMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75, emissive: 0x000000 });
    this.mmMat.onBeforeCompile = (sh) => {
      sh.uniforms.tNoise = { value: this.noiseTex };
      sh.uniforms.uToast = this.mmToastU = { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMP;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvMP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nprecision highp sampler3D;\nuniform sampler3D tNoise; uniform float uToast;\nvarying vec3 vMP;')
        .replace('#include <map_fragment>', `#include <map_fragment>
{
  float n = texture(tNoise, vMP * 40.0).r;
  float blist = smoothstep(0.55, 0.75, texture(tNoise, vMP * 90.0).a);
  diffuseColor.rgb *= 0.85 + n * 0.3 - blist * uToast * 0.5;
}`);
    };
    this.mmMesh = new THREE.Mesh(mg, this.mmMat);
    this.mmMesh.castShadow = true;
    stick.add(this.stickMesh, this.mmMesh);
    stick.visible = false;
    this.scene.add(stick);
    this.stick = stick;
    this.mm = { toast: 0, onFire: false, height: 0.42, tip: new THREE.Vector3(0, 0.42, 0.6), heat: 0, eaten: 0 };
  }

  toastText() {
    const m = this.mm;
    if (m.onFire) return 'It caught fire! Click to blow it out';
    let s = TOAST[0][1];
    for (const [t, txt] of TOAST) if (m.toast >= t) s = txt;
    return s;
  }

  eat() {
    const t = this.mm.toast;
    const verdict = t < 0.08 ? 'Raw marshmallow. Chewy.' : t < 0.2 ? 'Barely toasted. Warm and gooey.' : t < 0.34 ? 'Nicely toasted!' : t < 0.52 ? 'Perfect golden marshmallow!' : t < 0.7 ? 'A bit dark, still good.' : 'Pure charcoal. Crunchy.';
    this.mm.eaten++;
    this.ui.flash(verdict);
    this.mm.toast = 0; this.mm.onFire = false;
  }

  updateMarshmallow(dt) {
    const m = this.mm;
    const cam = this.camera;
    const handle = new THREE.Vector3(0.22, -0.26, -0.3).applyMatrix4(cam.matrixWorld);
    if (this.hasPointer) {
      const p = this.hitGround(m.height);
      if (p) {
        const dir = p.clone().sub(handle);
        if (dir.length() > 1.25) dir.setLength(1.25);
        const target = handle.clone().add(dir);
        m.tip.lerp(target, Math.min(1, dt * 10));
      }
    }
    const dir = m.tip.clone().sub(handle);
    const len = Math.max(0.2, dir.length());
    const tipFull = handle.clone().add(dir.clone().setLength(len + 0.04));
    this.stickMesh.position.copy(handle);
    this.stickMesh.scale.set(1, 1, len + 0.06);
    this.stickMesh.lookAt(tipFull);
    this.mmMesh.position.copy(m.tip);
    this.mmMesh.lookAt(tipFull);
    const heat = this.logs.heatAtPoint(m.tip);
    m.heat = heat;
    m.toast = Math.min(1, m.toast + Math.max(0, heat - 0.08) * dt * 0.11);
    if (!m.onFire && (heat > 1.25 || (m.toast > 0.62 && heat > 0.5 && Math.random() < dt * 0.6))) m.onFire = true;
    if (m.onFire) m.toast = Math.min(1, m.toast + dt * 0.12);
    toastColor(m.toast, this.mmMat.color);
    const glow = m.onFire ? 0.6 : Math.max(0, heat - 0.9) * 0.4;
    const sss = Math.min(1, heat) * 0.12 * (1 - m.toast * 0.8);
    this.mmMat.emissive.setRGB(glow + this.mmMat.color.r * sss, glow * 0.3 + this.mmMat.color.g * sss * 0.6, glow * 0.05 + this.mmMat.color.b * sss * 0.3);
    if (this.mmToastU) this.mmToastU.value = m.toast;
    this.ui.setStatus(this.toastText(), m.onFire);
  }

  update(dt, time) {
    const now = performance.now();
    if (this.down && !this.down.moved && this.down.fire && now - this.down.t > 320) {
      if (!this.blowing) { this.blowing = true; this.controls.enabled = false; }
    }
    const g = this.grab;
    if (g && !g.moved && !g.fresh && g.inFire && now - g.t > 320) {
      g.log.body.setAngularDamping(0.35); g.log.body.setLinearDamping(0.08);
      this.grab = null;
      this.down = { x: 0, y: 0, t: g.t, moved: false, fire: g.point, fromGrab: true, nx: this.ndc.x, ny: this.ndc.y };
      this.blowing = true;
      this.dom.style.cursor = 'grab';
    }
    if (this.down?.fromGrab && Math.hypot(this.ndc.x - this.down.nx, this.ndc.y - this.down.ny) > 0.03) { this.down.moved = true; this.blowing = false; }
    if (this.tool === 'marshmallow' && this.camPull) {
      const off = this.camera.position.clone().sub(this.controls.target);
      const d = off.length();
      if (d > 1.6) { off.setLength(d + (1.55 - d) * Math.min(1, dt * 4)); this.camera.position.copy(this.controls.target).add(off); }
      else this.camPull = false;
    }
    const targetAir = this.blowing ? 1 : 0;
    this.air += (targetAir - this.air) * Math.min(1, dt * (this.blowing ? 2.5 : 1.5));
    this.flare = Math.max(0, this.flare - dt * 0.6);
    if (this.pouring) {
      const cam = this.camera;
      const from = new THREE.Vector3(0.1, -0.28, -0.85).applyMatrix4(cam.matrixWorld);
      const T = Math.max(0.35, from.distanceTo(this.pourTarget) / 4.2);
      const n = Math.ceil(dt * 420);
      for (let i = 0; i < n; i++) {
        const tt = this.pourTarget.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.22, 0, (Math.random() - 0.5) * 0.22));
        const v = tt.sub(from).multiplyScalar(1 / T);
        v.y += 0.5 * 9.81 * T;
        this.particles.water.spawn(from.x + (Math.random() - 0.5) * 0.05, from.y, from.z + (Math.random() - 0.5) * 0.05, v.x + (Math.random() - 0.5) * 0.15, v.y + (Math.random() - 0.5) * 0.2, v.z + (Math.random() - 0.5) * 0.15, 1, 0.003 + Math.random() * 0.005, 3, 0);
      }
    }
    for (const s of this.particles.splashes) {
      const removed = this.logs.douse(s, 0.22, 0.0045);
      this.steam += removed * 3.0;
      if (removed > 0.002 && Math.random() < 0.18) this.particles.smoke.emit(s.x, s.y + 0.05, s.z, { kind: 1, size: 0.15, grow: 0.5, alpha: 0.22, vy: 1.0 + Math.random() * 0.6, life: 3 + Math.random() * 2 });
    }
    if (this.steam > 0.05 && Math.random() < this.steam * dt * 30) {
      const p = this.pourTarget;
      this.particles.smoke.emit(p.x + (Math.random() - 0.5) * 0.3, p.y + 0.08, p.z + (Math.random() - 0.5) * 0.3, { kind: 1, size: 0.2, grow: 0.75, alpha: 0.12 + this.steam * 0.15, vy: 1.1 + Math.random() * 0.7, life: 3.5 + Math.random() * 2 });
    }
    this.steam = Math.max(0, this.steam - dt * 0.9);
    this.steam = Math.min(this.steam, 1.2);
    for (const t of this.tempSources) t.t += dt;
    this.tempSources = this.tempSources.filter((t) => t.t < t.life);
    if (this.tool === 'marshmallow') this.updateMarshmallow(dt);
    if (this.tool === 'hand' && this.hoverCheck && !this.grab) {
      this.hoverCheck = false;
      const lh = this.hitLogs();
      const pile = !lh && this.cast().intersectObject(this.world.woodpile, true)[0];
      this.dom.style.cursor = lh || pile ? 'grab' : 'default';
    }
  }

  extraSources() {
    const out = [];
    for (const t of this.tempSources) {
      const k = Math.sin(Math.min(1, t.t / t.life) * Math.PI) * 0.8;
      out.push({ a: t.p.clone().add(new THREE.Vector3(-0.005, 0, 0)), b: t.p.clone().add(new THREE.Vector3(0.005, 0, 0)), ha: k, hb: k, r: 0.004, H: 0.07, w: 0.018 });
    }
    if (this.tool === 'marshmallow' && this.mm.onFire) {
      const p = this.mm.tip;
      out.push({ a: p.clone().add(new THREE.Vector3(-0.012, -0.01, 0)), b: p.clone().add(new THREE.Vector3(0.012, -0.01, 0)), ha: 0.85, hb: 0.85, r: 0.012, H: 0.12, w: 0.03 });
    }
    return out;
  }
}

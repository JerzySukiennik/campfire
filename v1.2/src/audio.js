// Audio: recorded fire/night beds with crossfade looping, spatialised fire, procedural crackles, thuds, wind and breath.
const FILES = ['fire_close', 'fire_pops', 'night', 'sizzle1', 'sizzle2', 'pour', 'match'];

class Looper {
  constructor(ctx, buffer, out, fade = 2) {
    this.ctx = ctx; this.buffer = buffer; this.out = out; this.fade = Math.min(fade, buffer.duration / 4);
    this.next = ctx.currentTime + 0.05;
    this.first = true;
    this.tick();
  }
  tick() {
    const ctx = this.ctx;
    while (this.next < ctx.currentTime + 1.5) {
      const src = ctx.createBufferSource();
      src.buffer = this.buffer;
      const g = ctx.createGain();
      src.connect(g).connect(this.out);
      const off = this.first ? Math.random() * this.buffer.duration * 0.6 : 0;
      const dur = this.buffer.duration - off;
      const t = this.next, f = this.fade;
      g.gain.setValueAtTime(this.first ? 1 : 0, t);
      if (!this.first) g.gain.linearRampToValueAtTime(1, t + f);
      g.gain.setValueAtTime(1, t + dur - f);
      g.gain.linearRampToValueAtTime(0, t + dur);
      src.start(t, off);
      src.stop(t + dur + 0.05);
      this.next = t + dur - f;
      this.first = false;
    }
  }
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.buffers = {};
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return this.loading; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.005; comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.panner = ctx.createPanner();
    this.panner.panningModel = 'HRTF';
    this.panner.distanceModel = 'inverse';
    this.panner.refDistance = 2.0; this.panner.rolloffFactor = 1.1;
    this.setPos(this.panner, 0, 0.3, 0);
    this.panner.connect(this.master);
    this.fireTone = ctx.createBiquadFilter();
    this.fireTone.type = 'lowpass'; this.fireTone.frequency.value = 12000;
    this.fireTone.connect(this.panner);
    this.noiseBuf = this.makeNoise(4, 'white');
    this.brownBuf = this.makeNoise(6, 'brown');
    this.loading = this.load();
    return this.loading;
  }

  makeNoise(sec, kind) {
    const ctx = this.ctx;
    const b = ctx.createBuffer(1, ctx.sampleRate * sec, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    return b;
  }

  async load() {
    const ctx = this.ctx;
    await Promise.all(FILES.map(async (f) => {
      try {
        const r = await fetch(`audio/${f}.mp3`);
        const ab = await r.arrayBuffer();
        this.buffers[f] = await new Promise((res, rej) => ctx.decodeAudioData(ab, res, rej));
      } catch (e) { console.warn('audio', f, e); }
    }));
    const g = (v, to) => { const n = ctx.createGain(); n.gain.value = v; n.connect(to); return n; };
    this.fireGain = g(0, this.fireTone);
    this.popsGain = g(0, this.fireTone);
    this.nightGain = g(0.0, this.master);
    this.roarGain = g(0, this.panner);
    this.windGain = g(0, this.master);
    this.sizzleGain = g(0, this.panner);
    this.pourGain = g(0, this.panner);
    this.blowGain = g(0, this.master);
    this.loops = [];
    if (this.buffers.fire_close) this.loops.push(new Looper(ctx, this.buffers.fire_close, this.fireGain, 2.5));
    if (this.buffers.fire_pops) this.loops.push(new Looper(ctx, this.buffers.fire_pops, this.popsGain, 2.5));
    if (this.buffers.night) this.loops.push(new Looper(ctx, this.buffers.night, this.nightGain, 3));
    if (this.buffers.sizzle1) this.loops.push(new Looper(ctx, this.buffers.sizzle1, this.sizzleGain, 1.2));
    if (this.buffers.sizzle2) { const d = ctx.createDelay(1); d.delayTime.value = 0.37; d.connect(this.sizzleGain); this.loops.push(new Looper(ctx, this.buffers.sizzle2, d, 1.2)); }
    if (this.buffers.pour) this.loops.push(new Looper(ctx, this.buffers.pour, this.pourGain, 0.8));
    const roar = ctx.createBufferSource(); roar.buffer = this.brownBuf; roar.loop = true;
    const rf = ctx.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 260; rf.Q.value = 0.4;
    roar.connect(rf).connect(this.roarGain); roar.start();
    this.roarFilter = rf;
    const wind = ctx.createBufferSource(); wind.buffer = this.brownBuf; wind.loop = true; wind.playbackRate.value = 1.7;
    const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 500; wf.Q.value = 0.6;
    wind.connect(wf).connect(this.windGain); wind.start();
    this.windFilter = wf;
    const blow = ctx.createBufferSource(); blow.buffer = this.noiseBuf; blow.loop = true;
    const bf = ctx.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 1100; bf.Q.value = 0.7;
    blow.connect(bf).connect(this.blowGain); blow.start();
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, ctx.currentTime, 1.2);
    this.ready = true;
  }

  setPos(node, x, y, z) {
    if (node.positionX) { node.positionX.value = x; node.positionY.value = y; node.positionZ.value = z; } else node.setPosition(x, y, z);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 1, this.ctx.currentTime, 0.3);
  }

  crackle(strength, pos) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + Math.random() * 0.02;
    const out = ctx.createPanner();
    out.panningModel = 'equalpower'; out.distanceModel = 'inverse'; out.refDistance = 2; out.rolloffFactor = 1.1;
    this.setPos(out, pos.x, pos.y, pos.z);
    out.connect(this.master);
    const n = 1 + Math.floor(Math.random() * (2 + strength * 5));
    for (let k = 0; k < n; k++) {
      const tk = t + k * (0.004 + Math.random() * 0.03);
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1500 + Math.random() * 5000; bp.Q.value = 0.8 + Math.random() * 2;
      const g = ctx.createGain();
      const amp = (0.08 + strength * 0.5) * (k === 0 ? 1 : 0.3 + Math.random() * 0.5);
      const dur = 0.004 + Math.random() * 0.02 + strength * 0.02;
      g.gain.setValueAtTime(0, tk); g.gain.linearRampToValueAtTime(amp, tk + 0.0008); g.gain.exponentialRampToValueAtTime(0.0001, tk + dur);
      src.connect(bp).connect(g).connect(out);
      src.start(tk, Math.random() * 3); src.stop(tk + dur + 0.02);
    }
    if (strength > 0.45) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(140 + Math.random() * 80, t); o.frequency.exponentialRampToValueAtTime(50, t + 0.06);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(strength * 0.25, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.1);
    }
    setTimeout(() => out.disconnect(), 400);
  }

  thud(strength, pos, hollow = false) {
    if (!this.ready || this.muted || strength < 0.02) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createPanner();
    out.panningModel = 'equalpower'; out.refDistance = 1.5;
    this.setPos(out, pos.x, pos.y, pos.z);
    out.connect(this.master);
    const s = Math.min(1, strength);
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500 + s * 1400;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(s * 0.5, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09 + s * 0.08);
    src.connect(lp).connect(g).connect(out); src.start(t, Math.random() * 3); src.stop(t + 0.25);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime((hollow ? 210 : 95) + Math.random() * 30, t); o.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const og = ctx.createGain(); og.gain.setValueAtTime(0, t); og.gain.linearRampToValueAtTime(s * 0.45, t + 0.003); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(og).connect(out); o.start(t); o.stop(t + 0.2);
    setTimeout(() => out.disconnect(), 500);
  }

  oneShot(name, gain = 1, pos = null) {
    if (!this.ready || this.muted || !this.buffers[name]) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource(); src.buffer = this.buffers[name];
    const g = ctx.createGain(); g.gain.value = gain;
    let out = this.master;
    if (pos) { const p = ctx.createPanner(); p.panningModel = 'equalpower'; p.refDistance = 1.5; this.setPos(p, pos.x, pos.y, pos.z); p.connect(this.master); out = p; }
    src.connect(g).connect(out); src.start();
  }

  puff() {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 0.5;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.35, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    src.connect(bp).connect(g).connect(this.master); src.start(t, Math.random()); src.stop(t + 0.4);
  }

  update(dt, s, camera) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (const l of this.loops) l.tick();
    const L = ctx.listener;
    const p = camera.position;
    const f = camera.getWorldDirection(this._f || (this._f = new camera.position.constructor()));
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
    this.setPos(this.panner, s.firePos.x, s.firePos.y, s.firePos.z);
    const I = s.intensity, coal = s.coal;
    const level = Math.min(1, I / 2.8);
    const tc = 0.25;
    this.fireGain.gain.setTargetAtTime(Math.min(1.1, 0.12 * coal + 0.85 * Math.sqrt(level)), t, tc);
    this.popsGain.gain.setTargetAtTime(0.7 * level + 0.15 * coal, t, tc);
    this.fireTone.frequency.setTargetAtTime(1500 + 11000 * Math.min(1, level + coal * 0.2), t, 0.5);
    this.roarGain.gain.setTargetAtTime((0.12 * level * level + s.air * 0.35 * (0.3 + coal)) * 0.9, t, 0.15);
    this.roarFilter.frequency.setTargetAtTime(200 + s.air * 300 + level * 120, t, 0.2);
    this.nightGain.gain.setTargetAtTime(0.55, t, 1.0);
    this.windGain.gain.setTargetAtTime(s.wind * s.wind * 0.35 * (0.7 + 0.3 * Math.sin(t * 0.6) * Math.sin(t * 0.23)), t, 0.4);
    this.windFilter.frequency.setTargetAtTime(350 + s.wind * 500 + Math.sin(t * 0.4) * 120, t, 0.5);
    this.sizzleGain.gain.setTargetAtTime(Math.min(1.4, s.steam * 1.6), t, 0.08);
    this.pourGain.gain.setTargetAtTime(s.pouring ? 0.9 : 0, t, 0.06);
    this.blowGain.gain.setTargetAtTime(s.blowing ? 0.22 : 0, t, 0.08);
  }
}

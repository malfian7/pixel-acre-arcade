// Iron Rift — synthesized audio: layered weapon SFX, wet-harbor ambience and three music cues.
// Buses: music, world (SFX + ambience), ui (menu feedback) and sting (end-of-run cues).
// Pause silences music + world but keeps ui; game over cuts music, ambience and world SFX but keeps stings + ui.

const A = { ctx: null, ready: false, vol: { master: 0.9, music: 0.6, sfx: 0.85 } };
let noiseBuf = null, brownBuf = null;

export function audioInit() {
  if (A.ctx) { if (A.ctx.state === "suspended") A.ctx.resume(); return A.ctx; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
  const c = A.ctx = new AC();
  A.master = c.createGain();
  const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = 0.003; comp.release.value = 0.2;
  A.master.connect(comp); comp.connect(c.destination);
  for (const k of ["music", "world", "ui", "sting"]) { A[k] = c.createGain(); A[k].connect(A.master); }
  A.amb = c.createGain(); A.amb.connect(A.world);
  // short room/harbour reverb for weapon tails
  A.verb = c.createConvolver(); A.verb.buffer = impulse(c, 1.6, 2.6); A.verbSend = c.createGain(); A.verbSend.gain.value = 0.22;
  A.verbSend.connect(A.verb); A.verb.connect(A.world);
  const len = c.sampleRate * 2; noiseBuf = c.createBuffer(1, len, c.sampleRate); brownBuf = c.createBuffer(1, len, c.sampleRate);
  const d = noiseBuf.getChannelData(0), b = brownBuf.getChannelData(0); let last = 0;
  for (let i = 0; i < len; i++) { d[i] = Math.random() * 2 - 1; last = (last + 0.02 * d[i]) / 1.02; b[i] = last * 3.5; }
  A.dist = c.createWaveShaper(); A.dist.curve = shaper(28); A.dist.oversample = "2x";
  A.ready = true; applyVolumes(); startAmbience();
  return c;
}
function impulse(c, dur, decay) {
  const n = Math.floor(c.sampleRate * dur), buf = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay); }
  return buf;
}
function shaper(k) { const n = 1024, cu = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / n) * 2 - 1; cu[i] = ((3 + k) * x * 20 * Math.PI / 180) / (Math.PI + k * Math.abs(x)); } return cu; }
export function setVolumes(v) { Object.assign(A.vol, v); applyVolumes(); }
let paused = false, ended = false;
function applyVolumes() {
  if (!A.ready) return;
  const t = A.ctx.currentTime;
  A.master.gain.setTargetAtTime(A.vol.master, t, 0.05);
  A.music.gain.setTargetAtTime(paused || ended ? 0 : A.vol.music * 0.42, t, 0.08);
  A.world.gain.setTargetAtTime(paused || ended ? 0 : A.vol.sfx, t, 0.04);
  A.ui.gain.setTargetAtTime(A.vol.sfx * 0.7, t, 0.03);
  A.sting.gain.setTargetAtTime(Math.max(A.vol.sfx, A.vol.music) * 0.8, t, 0.03);
}
// Esc pause: music and the world go quiet, menu feedback stays.
export function audioPause(on) { paused = on; applyVolumes(); }
// Game over: stop music, ambience and world SFX; stings and ui still play.
export function audioEnd(on = true) { ended = on; if (on) musicMode("off"); applyVolumes(); }

/* ---------------------------------------------------------------- building blocks */
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function osc(type, f, t, dur, peak, dest, f2 = null, a = 0.004) {
  const c = A.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(18, f2), t + dur);
  env(g, t, a, peak, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05); return o;
}
function nz(t, dur, peak, type, f, dest, f2 = null, q = 0.8, buf = noiseBuf, a = 0.002) {
  const c = A.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = buf; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q; if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, a, peak, dur); s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random() * 1.5); s.stop(t + a + dur + 0.05); return g;
}
// a positioned destination: gain by distance, stereo pan, and a reverb send
function spot(pan = 0, gain = 1, verb = 1, bus = null) {
  const c = A.ctx, g = c.createGain(), p = c.createStereoPanner();
  g.gain.value = gain; p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(bus || A.world);
  if (verb > 0) { const s = c.createGain(); s.gain.value = verb; g.connect(s); s.connect(A.verbSend); }
  return g;
}

/* ---------------------------------------------------------------- sound effects */
const S = {
  // weapons: crack (transient) + body (low thump) + mechanism + tail into the reverb
  rifle: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 1);
    nz(t, 0.05, 0.9, "highpass", 2600, d); nz(t, 0.14, 0.75, "lowpass", 1400, d, 260); osc("sine", 140, t, 0.12, 0.7, d, 48);
    nz(t + 0.02, 0.32, 0.18, "bandpass", 900, d, 300, 0.6); osc("square", 2400, t + 0.03, 0.02, 0.04, d); },
  shotgun: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 1.3);
    nz(t, 0.08, 1, "highpass", 1800, d); nz(t, 0.3, 1, "lowpass", 900, d, 120); osc("sine", 110, t, 0.22, 0.95, d, 34);
    nz(t + 0.03, 0.55, 0.22, "bandpass", 600, d, 160, 0.5); nz(t + 0.16, 0.05, 0.1, "bandpass", 3200, d, null, 3); osc("square", 900, t + 0.18, 0.03, 0.05, d); },
  rocketFire: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 1);
    nz(t, 0.12, 0.8, "lowpass", 2400, d, 400); osc("sawtooth", 90, t, 0.3, 0.3, d, 40); nz(t + 0.05, 0.9, 0.35, "bandpass", 700, d, 2000, 0.7, noiseBuf, 0.08); },
  explosion: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 1.6), big = o.big ? 1.3 : 1;
    nz(t, 0.06, 1, "highpass", 1200, d); osc("sine", 90 * big, t, 0.9, 1, d, 24); nz(t, 1.1, 1, "lowpass", 900, d, 60, 0.7, brownBuf);
    nz(t + 0.04, 1.6 * big, 0.4, "lowpass", 2400, d, 200, 0.4); for (let i = 0; i < 5; i++) nz(t + 0.25 + Math.random() * 0.6, 0.05, 0.08, "bandpass", 2500 + Math.random() * 2000, d, null, 4); },
  grenadeThrow: (o) => { const t = A.ctx.currentTime, d = spot(0, 0.6, 0); nz(t, 0.18, 0.4, "bandpass", 1600, d, 500, 1); osc("square", 1800, t, 0.015, 0.06, d); },
  bounce: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 0.4); osc("triangle", 900 + Math.random() * 400, t, 0.06, 0.18, d, 500); nz(t, 0.05, 0.2, "bandpass", 2400, d, null, 3); },
  swing: () => { const t = A.ctx.currentTime, d = spot(0, 0.7, 0); nz(t, 0.16, 0.5, "bandpass", 900, d, 2600, 1.5); },
  meleeHit: (o) => { const t = A.ctx.currentTime, d = spot(0, 0.9, 0.5); nz(t, 0.1, 0.9, "lowpass", 1800, d, 300); osc("sine", 120, t, 0.12, 0.8, d, 40); },
  reload: (o) => { const t = A.ctx.currentTime, d = spot(0, 0.55, 0.2), k = o.kind;
    if (k === "shell") { nz(t, 0.05, 0.4, "bandpass", 2800, d, null, 4); osc("square", 520, t + 0.02, 0.03, 0.08, d); return; }
    nz(t, 0.05, 0.5, "bandpass", 2200, d, null, 3); nz(t + 0.4, 0.06, 0.6, "bandpass", 1700, d, null, 3); osc("square", 380, t + 0.42, 0.03, 0.08, d);
    if (k === "rifle") { nz(t + 0.85, 0.04, 0.7, "bandpass", 3000, d, null, 5); nz(t + 0.92, 0.05, 0.7, "bandpass", 2400, d, null, 5); } },
  swap: () => { const t = A.ctx.currentTime, d = spot(0, 0.5, 0); nz(t, 0.08, 0.35, "bandpass", 1900, d, 900, 2); nz(t + 0.09, 0.04, 0.4, "bandpass", 3200, d, null, 5); },
  empty: () => { const t = A.ctx.currentTime, d = spot(0, 0.5, 0); osc("square", 1600, t, 0.015, 0.12, d); nz(t, 0.03, 0.2, "bandpass", 3000, d, null, 6); },
  hitFlesh: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 0.2); nz(t, 0.07, 0.6, "lowpass", 1200, d, 300); },
  hitMetal: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 0.3); osc("triangle", 1800 + Math.random() * 900, t, 0.12, 0.25, d, 1200); nz(t, 0.05, 0.4, "highpass", 3000, d); },
  hitMarker: (o) => { const t = A.ctx.currentTime, d = A.ui; osc("square", o.head ? 2100 : 1500, t, 0.03, o.head ? 0.12 : 0.07, d); if (o.head) osc("sine", 3100, t + 0.02, 0.12, 0.08, d); },
  kill: (o) => { const t = A.ctx.currentTime, d = A.ui; osc("sine", 220, t, 0.16, 0.35, d, 110); osc("triangle", 880, t, 0.06, 0.1, d); },
  impact: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain * 0.7, 0.3); nz(t, 0.05, 0.4, "bandpass", 2600 + Math.random() * 1500, d, null, 2); },
  shell: (o) => { const t = A.ctx.currentTime, d = spot(o.pan || 0.3, 0.12, 0); osc("sine", 4200 + Math.random() * 1500, t, 0.05, 0.4, d); osc("sine", 6100 + Math.random() * 900, t + 0.06, 0.04, 0.25, d); },
  hurt: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, 0.9, 0); nz(t, 0.12, 0.6, "lowpass", 900, d, 200); osc("sine", 70, t, 0.18, 0.6, d, 40); },
  armorHit: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, 0.7, 0); osc("triangle", 1300, t, 0.08, 0.2, d, 700); nz(t, 0.06, 0.4, "bandpass", 2600, d, null, 2); },
  armorBreak: () => { const t = A.ctx.currentTime, d = A.ui; nz(t, 0.4, 0.8, "highpass", 2400, d, 900); for (let i = 0; i < 6; i++) osc("triangle", 2400 + Math.random() * 2600, t + i * 0.025, 0.12, 0.12, d); osc("sine", 180, t, 0.4, 0.5, d, 50); },
  armorCharge: () => { const t = A.ctx.currentTime, d = A.ui; osc("sine", 300, t, 0.5, 0.12, d, 900); osc("triangle", 600, t + 0.05, 0.45, 0.05, d, 1800); },
  armorFull: () => { const t = A.ctx.currentTime, d = A.ui; osc("sine", 1320, t, 0.18, 0.1, d); osc("sine", 1760, t + 0.07, 0.2, 0.08, d); },
  pickup: (o) => { const t = A.ctx.currentTime, d = A.ui, f = { health: 660, armor: 880, ammo: 520 }[o.kind] || 700; osc("sine", f, t, 0.08, 0.15, d); osc("sine", f * 1.5, t + 0.05, 0.12, 0.12, d); },
  step: (o) => { const t = A.ctx.currentTime, d = spot(o.pan || 0, o.gain || 0.22, 0); nz(t, 0.07, 0.6, "bandpass", 700 + Math.random() * 300, d, 300, 1.2); nz(t + 0.01, 0.09, 0.25, "highpass", 3500, d); },
  jump: () => { const t = A.ctx.currentTime, d = spot(0, 0.3, 0); nz(t, 0.1, 0.4, "lowpass", 900, d); },
  land: (o) => { const t = A.ctx.currentTime, d = spot(0, 0.4 + o.k * 0.4, 0); nz(t, 0.14, 0.7, "lowpass", 700, d, 200); nz(t, 0.12, 0.3, "highpass", 3000, d); osc("sine", 90, t, 0.1, 0.4 * o.k, d, 50); },
  slide: () => { const t = A.ctx.currentTime, d = spot(0, 0.5, 0); nz(t, 0.6, 0.45, "bandpass", 1400, d, 500, 0.7, noiseBuf, 0.03); },
  overdriveOn: () => { const t = A.ctx.currentTime, d = A.ui; osc("sawtooth", 110, t, 0.8, 0.25, d, 440); osc("square", 220, t + 0.1, 0.6, 0.12, d, 880); nz(t, 0.6, 0.4, "bandpass", 600, d, 4000, 1); },
  overdriveOff: () => { const t = A.ctx.currentTime, d = A.ui; osc("sawtooth", 440, t, 0.6, 0.15, d, 90); },
  overdriveReady: () => { const t = A.ctx.currentTime, d = A.ui; [660, 880, 1320].forEach((f, i) => osc("triangle", f, t + i * 0.07, 0.15, 0.12, d)); },
  rankUp: (o) => { const t = A.ctx.currentTime, d = A.ui, b = 440 * Math.pow(1.122, o.rank || 0); osc("square", b, t, 0.08, 0.1, d); osc("square", b * 1.5, t + 0.06, 0.12, 0.1, d); },
  rankDown: () => { const t = A.ctx.currentTime, d = A.ui; osc("square", 330, t, 0.12, 0.08, d, 200); },
  // enemies
  enemyRifle: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain * 0.8, 1); nz(t, 0.04, 0.7, "highpass", 2000, d); nz(t, 0.12, 0.5, "lowpass", 1200, d, 300); osc("sine", 160, t, 0.1, 0.4, d, 60); },
  laser: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain * 0.8, 0.6); osc("sawtooth", 1800, t, 0.16, 0.18, d, 220); osc("sine", 900, t, 0.2, 0.2, d, 120); },
  dogGun: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain * 0.7, 0.6); nz(t, 0.04, 0.5, "highpass", 2800, d); osc("square", 420, t, 0.05, 0.12, d, 200); },
  minigun: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain * 0.75, 0.8); nz(t, 0.05, 0.6, "highpass", 1800, d); nz(t, 0.09, 0.5, "lowpass", 900, d, 200); },
  servo: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain * 0.35, 0); osc("sawtooth", 180, t, 0.25, 0.12, d, 260); },
  stomp: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 1); osc("sine", 70, t, 0.5, 1, d, 28); nz(t, 0.4, 0.8, "lowpass", 500, d, 80, 0.7, brownBuf); },
  roar: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 1.2); osc("sawtooth", 70, t, 1.4, 0.5, d, 45, 0.15); osc("square", 105, t, 1.3, 0.25, d, 60, 0.2); nz(t, 1.4, 0.4, "bandpass", 400, d, 150, 0.8, noiseBuf, 0.2); },
  dogBark: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain * 0.6, 0.3); osc("square", 520, t, 0.12, 0.2, d, 260); osc("sawtooth", 260, t + 0.04, 0.1, 0.15, d, 180); },
  enemyDeath: (o) => { const t = A.ctx.currentTime, d = spot(o.pan, o.gain, 0.5); if (o.robot) { osc("sawtooth", 600, t, 0.5, 0.25, d, 60); nz(t, 0.3, 0.5, "bandpass", 2400, d, 400, 2); } else nz(t, 0.25, 0.5, "lowpass", 600, d, 200); },
  // waves and ui
  horn: () => { const t = A.ctx.currentTime, d = A.ui; osc("sawtooth", 98, t, 1.6, 0.22, d, null, 0.15); osc("sawtooth", 147, t, 1.6, 0.14, d, null, 0.15); },
  waveClear: () => { const t = A.ctx.currentTime, d = A.ui; [392, 523, 659, 784].forEach((f, i) => osc("triangle", f, t + i * 0.09, 0.4, 0.14, d)); },
  augment: () => { const t = A.ctx.currentTime, d = A.ui; [523, 784, 1046].forEach((f, i) => osc("sine", f, t + i * 0.06, 0.3, 0.14, d)); },
  uiMove: () => osc("triangle", 880, A.ctx.currentTime, 0.04, 0.08, A.ui),
  uiSelect: () => { const t = A.ctx.currentTime; osc("triangle", 660, t, 0.06, 0.12, A.ui); osc("triangle", 990, t + 0.05, 0.08, 0.12, A.ui); },
  uiBack: () => osc("triangle", 520, A.ctx.currentTime, 0.07, 0.1, A.ui, 380),
  // end-of-run stings ride the sting bus so they survive the game-over cut
  defeat: () => { const t = A.ctx.currentTime, d = A.sting; [294, 277, 233, 196].forEach((f, i) => { osc("sawtooth", f, t + i * 0.32, 0.9, 0.12, d); osc("sine", f / 2, t + i * 0.32, 1.1, 0.2, d); }); nz(t, 2.4, 0.15, "lowpass", 400, d, 80, 0.5, brownBuf, 0.2); },
  victory: () => { const t = A.ctx.currentTime, d = A.sting; [293, 349, 440, 587, 698, 880].forEach((f, i) => { osc("sawtooth", f, t + i * 0.12, 0.7, 0.09, d); osc("triangle", f, t + i * 0.12, 0.9, 0.1, d); }); osc("sine", 73, t, 2.4, 0.3, d); },
};
export function sfx(name, o = {}) {
  if (!A.ready) return;
  o.pan ??= 0; o.gain ??= 1;
  if (o.gain < 0.02) return;
  try { S[name](o); } catch {}
}

/* ---------------------------------------------------------------- ambience: drizzle, harbour wind, distant horns */
function startAmbience() {
  const c = A.ctx, loop = (type, f, q, gain, buf = noiseBuf) => {
    const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    const g = c.createGain(); g.gain.value = gain; s.connect(fl); fl.connect(g); g.connect(A.amb); s.start(); return g;
  };
  A.rain = loop("highpass", 4200, 0.4, 0.05); loop("bandpass", 1800, 0.5, 0.025); A.wind = loop("lowpass", 260, 0.6, 0.16, brownBuf);
  A.amb.gain.value = 0;
  setInterval(() => { if (A.ambOn && !paused && !ended && Math.random() < 0.35) { const t = c.currentTime, d = spot((Math.random() - 0.5) * 1.6, 0.08, 1.5, A.amb); osc("sawtooth", 82, t, 3.2, 0.3, d, null, 0.6); osc("sawtooth", 123, t, 3.2, 0.2, d, null, 0.6); } }, 9000);
}
export function ambience(on) { A.ambOn = on; if (A.ready) A.amb.gain.setTargetAtTime(on ? 1 : 0, A.ctx.currentTime, 0.5); }

/* ---------------------------------------------------------------- music: title, combat, boss (D minor) */
const M = { mode: "off", step: 0, next: 0, timer: 0, pad: null };
const NOTE = (n) => 36.71 * Math.pow(2, n / 12);   // semitones above D1
const PROG = [0, 0, -2, -4, 3, 3, 1, -2];            // bass roots per bar (Dm · Dm · C · Bb · F · F · Eb · C)
export function musicMode(mode) {
  M.want = mode;
  if (!A.ready || mode === M.mode) return;
  M.mode = mode; M.step = 0; M.next = A.ctx.currentTime + 0.1;
  if (!M.pad) {   // a dark detuned pad underneath every cue
    const c = A.ctx, g = c.createGain(); g.gain.value = 0; const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 700; f.Q.value = 1.5;
    const os = [0, 7, 12, 15].map((n, i) => { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = NOTE(n + 12); o.detune.value = (i - 1.5) * 7; o.connect(f); o.start(); return o; });
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.07; lg.gain.value = 380; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    f.connect(g); g.connect(A.music); M.pad = { g, os };
  }
  M.pad.g.gain.setTargetAtTime(mode === "off" ? 0 : mode === "title" ? 0.12 : 0.06, A.ctx.currentTime, 0.8);
  if (!M.timer) M.timer = setInterval(tick, 25);
}
function tick() {
  if (!A.ready || M.mode === "off") return;
  const c = A.ctx, bpm = M.mode === "boss" ? 148 : M.mode === "combat" ? 132 : 84, sd = 60 / bpm / 4;
  if (M.next < c.currentTime - 0.1) { const miss = Math.ceil((c.currentTime - M.next) / sd); M.step += miss; M.next += miss * sd; }
  while (M.next < c.currentTime + 0.12) {
    const t = M.next, st = M.step, s16 = st % 16, bar = Math.floor(st / 16), root = PROG[bar % 8], dm = A.music;
    if (s16 === 0) M.pad.os.forEach((o, i) => o.frequency.setTargetAtTime(NOTE(root + [12, 19, 24, 27][i]), t, 0.3));
    if (M.mode === "title") {
      if (s16 === 0) osc("sine", NOTE(root), t, sd * 14, 0.35, dm, null, 0.05);
      if (s16 % 4 === 2) osc("triangle", NOTE(root + [24, 27, 31, 34][(st >> 2) % 4]), t, sd * 3, 0.06, dm);
      if (s16 === 8 && bar % 2) nz(t, 1.2, 0.05, "bandpass", 3000, dm, 800, 0.6, noiseBuf, 0.4);
      if (s16 === 0 && bar % 4 === 0) osc("sine", 55, t, 1.2, 0.5, dm, 30);
    } else {
      const boss = M.mode === "boss";
      if (s16 % 4 === 0 || (boss && s16 === 10) || (s16 === 7 && bar % 2)) { osc("sine", 150, t, 0.25, 0.9, dm, 38, 0.002); nz(t, 0.03, 0.2, "highpass", 2000, dm); }
      if (s16 === 4 || s16 === 12) { nz(t, 0.2, 0.5, "bandpass", 1800, dm, 900, 0.7); osc("triangle", 190, t, 0.1, 0.3, dm, 120); }
      if (s16 % 2 === 1 || boss) nz(t, s16 % 4 === 2 ? 0.08 : 0.03, 0.12, "highpass", 8000, dm);
      // distorted driving bass in 16ths
      if (s16 % 2 === 0 || boss) { const o = A.ctx.createOscillator(), g = A.ctx.createGain(), f = A.ctx.createBiquadFilter(); o.type = "sawtooth"; o.frequency.value = NOTE(root + (s16 % 8 === 6 ? 12 : 0)); f.type = "lowpass"; f.frequency.setValueAtTime(boss ? 1400 : 900, t); f.frequency.exponentialRampToValueAtTime(200, t + sd); env(g, t, 0.004, 0.32, sd * 0.9); o.connect(f); f.connect(g); g.connect(dm); o.start(t); o.stop(t + sd + 0.05); }
      // arpeggio lead every other phrase
      if (bar % 4 >= 2 && s16 % 2 === 0) osc(boss ? "sawtooth" : "square", NOTE(root + [24, 27, 31, 36, 31, 27, 24, 22][(s16 / 2) % 8] + 12), t, sd * 1.4, boss ? 0.05 : 0.035, dm);
      if (boss && s16 >= 12 && bar % 4 === 3) osc("sine", [140, 120, 100, 80][s16 - 12], t, 0.2, 0.6, dm, 60);
    }
    M.step++; M.next += sd;
  }
}
export const audioReady = () => A.ready;

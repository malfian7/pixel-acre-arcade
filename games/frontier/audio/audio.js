// Frontier Crown — procedural WebAudio: muskets, cannon, steel, axes, picks, bells, horns, music.
// Buses: music (procedural fallback), track (the recorded soundtrack, audio/soundtrack.js),
// world (positional-ish: gain + pan from distance to the camera focus), ui.

let ac = null, master, bus = {}, noiseBuf = null, musicTimer = null, musicOn = false, paused = false;
const vol = { master: 0.9, music: 0.5, sfx: 0.9 };
const TRACK = 0.75, PAUSE_DUCK = 0.35; // soundtrack files are normalised to −19 LUFS

export function audioInit() {
  if (ac) { if (ac.state === "suspended") ac.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  ac = new AC();
  master = ac.createGain(); master.gain.value = vol.master;
  const comp = ac.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 4;
  master.connect(comp); comp.connect(ac.destination);
  for (const k of ["music", "world", "ui"]) { bus[k] = ac.createGain(); bus[k].connect(master); }
  // the soundtrack skips the SFX compressor (it is mastered already) but follows the master volume
  bus.trackOut = ac.createGain(); bus.trackOut.gain.value = vol.master; bus.trackOut.connect(ac.destination);
  bus.track = ac.createGain(); bus.track.gain.value = TRACK * vol.music; bus.track.connect(bus.trackOut);
  bus.music.gain.value = 0.22 * vol.music; bus.world.gain.value = 0.8 * vol.sfx; bus.ui.gain.value = 0.7 * vol.sfx;
  const len = ac.sampleRate * 1.5; noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
  const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
}
export function setVolumes(v) {
  Object.assign(vol, v);
  if (!ac) return;
  master.gain.value = vol.master; bus.trackOut.gain.value = vol.master;
  bus.track.gain.value = TRACK * vol.music * (paused ? PAUSE_DUCK : 1);
  bus.music.gain.value = paused ? 0 : 0.22 * vol.music; bus.world.gain.value = paused ? 0 : 0.8 * vol.sfx; bus.ui.gain.value = 0.7 * vol.sfx;
}
export function audioPause(on) {
  paused = on; if (!ac) return;
  const t = ac.currentTime;
  bus.music.gain.setTargetAtTime(on ? 0 : 0.22 * vol.music, t, 0.08);
  bus.track.gain.setTargetAtTime(TRACK * vol.music * (on ? PAUSE_DUCK : 1), t, 0.15); // pause menu: soundtrack ducks, keeps playing
  bus.world.gain.setTargetAtTime(on ? 0 : 0.8 * vol.sfx, t, 0.05);
}

function out(dest, gain, pan) {
  const g = ac.createGain(); g.gain.value = gain;
  if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan)); g.connect(p); p.connect(dest); }
  else g.connect(dest);
  return g;
}
function noise(dest, { t = 0.2, at = 0, hp = 200, lp = 4000, v = 0.5, a = 0.002, q = 0.7, bp = 0 }) {
  const n = ac.currentTime + at, s = ac.createBufferSource(); s.buffer = noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f1 = ac.createBiquadFilter(); f1.type = bp ? "bandpass" : "highpass"; f1.frequency.value = bp || hp; f1.Q.value = q;
  const f2 = ac.createBiquadFilter(); f2.type = "lowpass"; f2.frequency.value = lp;
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, n); g.gain.exponentialRampToValueAtTime(v, n + a); g.gain.exponentialRampToValueAtTime(0.0001, n + t);
  s.connect(f1); f1.connect(f2); f2.connect(g); g.connect(dest);
  s.start(n, Math.random() * 0.5, t + 0.05);
}
function tone(dest, { f = 440, f2 = 0, t = 0.2, at = 0, type = "sine", v = 0.3, a = 0.005 }) {
  const n = ac.currentTime + at, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, n); if (f2) o.frequency.exponentialRampToValueAtTime(f2, n + t);
  g.gain.setValueAtTime(0.0001, n); g.gain.exponentialRampToValueAtTime(v, n + a); g.gain.exponentialRampToValueAtTime(0.0001, n + t);
  o.connect(g); g.connect(dest); o.start(n); o.stop(n + t + 0.05);
}

const S = {
  musket(d) { noise(d, { t: 0.32, hp: 400, lp: 5200, v: 0.7, a: 0.001 }); noise(d, { t: 0.6, hp: 80, lp: 700, v: 0.5, at: 0.01 }); tone(d, { f: 140, f2: 50, t: 0.18, type: "triangle", v: 0.5 }); },
  pop(d) { noise(d, { t: 0.18, hp: 900, lp: 6000, v: 0.4, a: 0.001 }); tone(d, { f: 300, f2: 90, t: 0.08, type: "triangle", v: 0.25 }); },
  cannon(d) { tone(d, { f: 90, f2: 32, t: 0.7, type: "sine", v: 0.9 }); noise(d, { t: 1.2, hp: 30, lp: 900, v: 0.8, a: 0.002 }); noise(d, { t: 0.25, hp: 1200, lp: 7000, v: 0.4 }); },
  boom(d) { tone(d, { f: 70, f2: 28, t: 0.8, type: "sine", v: 0.8 }); noise(d, { t: 1.0, hp: 40, lp: 1400, v: 0.7 }); },
  clash(d) { tone(d, { f: 1800 + Math.random() * 900, t: 0.25, type: "square", v: 0.08 }); tone(d, { f: 2600 + Math.random() * 700, t: 0.18, type: "sine", v: 0.12 }); noise(d, { t: 0.06, bp: 3000, q: 2, v: 0.4 }); },
  thud(d) { tone(d, { f: 160, f2: 60, t: 0.12, type: "triangle", v: 0.4 }); noise(d, { t: 0.08, hp: 100, lp: 900, v: 0.3 }); },
  chop(d) { noise(d, { t: 0.09, bp: 900 + Math.random() * 300, q: 3, v: 0.6 }); tone(d, { f: 240, f2: 140, t: 0.06, type: "triangle", v: 0.25 }); },
  pick(d) { tone(d, { f: 2200 + Math.random() * 600, t: 0.12, type: "triangle", v: 0.18 }); noise(d, { t: 0.05, bp: 4000, q: 4, v: 0.3 }); },
  forage(d) { noise(d, { t: 0.15, bp: 2400, q: 1, v: 0.18 }); },
  hammer(d) { tone(d, { f: 520, f2: 300, t: 0.07, type: "square", v: 0.12 }); noise(d, { t: 0.05, bp: 1500, q: 3, v: 0.35 }); },
  collapse(d) { noise(d, { t: 2.2, hp: 40, lp: 900, v: 0.8, a: 0.05 }); tone(d, { f: 60, f2: 30, t: 1.4, type: "sine", v: 0.6 }); for (let k = 0; k < 6; k++) noise(d, { t: 0.2, at: 0.2 + k * 0.18, bp: 600 + k * 120, q: 2, v: 0.35 }); },
  die(d) { tone(d, { f: 220 + Math.random() * 80, f2: 110, t: 0.3, type: "sawtooth", v: 0.06 }); },
  neigh(d) { tone(d, { f: 700, f2: 420, t: 0.5, type: "sawtooth", v: 0.05 }); },
  // ui
  click(d) { tone(d, { f: 720, f2: 560, t: 0.05, type: "triangle", v: 0.18 }); },
  select(d) { tone(d, { f: 520, t: 0.06, type: "triangle", v: 0.15 }); tone(d, { f: 780, t: 0.08, at: 0.05, type: "triangle", v: 0.13 }); },
  order(d) { tone(d, { f: 440, f2: 520, t: 0.08, type: "triangle", v: 0.14 }); },
  error(d) { tone(d, { f: 200, t: 0.12, type: "square", v: 0.08 }); tone(d, { f: 160, t: 0.16, at: 0.1, type: "square", v: 0.08 }); },
  bell(d) { for (const [f, v] of [[880, 0.2], [1320, 0.1], [2210, 0.05]]) tone(d, { f, t: 1.2, type: "sine", v, a: 0.002 }); },
  built(d) { [523, 659, 784].forEach((f, i) => tone(d, { f, t: 0.35, at: i * 0.09, type: "triangle", v: 0.14 })); },
  horn(d) { for (const f of [220, 277]) { tone(d, { f, t: 1.1, type: "sawtooth", v: 0.07, a: 0.08 }); } tone(d, { f: 220, t: 0.9, at: 0.95, type: "sawtooth", v: 0.07, a: 0.06 }); },
  fanfare(d) {
    const seq = [[392, 0], [523, 0.16], [659, 0.32], [784, 0.48], [659, 0.72], [784, 0.86]];
    for (const [f, at] of seq) { tone(d, { f, t: 0.5, at, type: "sawtooth", v: 0.07, a: 0.02 }); tone(d, { f: f / 2, t: 0.5, at, type: "triangle", v: 0.1 }); }
    tone(d, { f: 1046, t: 1.4, at: 1.0, type: "sawtooth", v: 0.06, a: 0.05 }); tone(d, { f: 523, t: 1.4, at: 1.0, type: "triangle", v: 0.12 });
  },
  victory(d) { S.fanfare(d); [523, 659, 784, 1046].forEach((f, i) => tone(d, { f, t: 1.6, at: 2 + i * 0.05, type: "triangle", v: 0.1 })); },
  defeat(d) { [392, 349, 311, 262].forEach((f, i) => { tone(d, { f, t: 0.7, at: i * 0.38, type: "sawtooth", v: 0.06, a: 0.05 }); tone(d, { f: f / 2, t: 0.8, at: i * 0.38, type: "triangle", v: 0.1 }); }); },
};

// world sfx with distance attenuation (dist in tiles from the camera focus) and stereo pan
export function sfx(name, { dist = 0, pan = 0, gain = 1, ui = false } = {}) {
  if (!ac || !S[name]) return;
  if (!ui && paused) return;
  const att = ui ? 1 : Math.max(0, 1 - dist / 55) ** 1.6;
  if (att < 0.03) return;
  try { S[name](out(ui ? bus.ui : bus.world, gain * att, ui ? 0 : pan)); } catch {}
}

// ---- music: a gentle harpsichord-ish loop (I–vi–IV–V in D major / B minor feel)
const PROG = [[62, 66, 69], [59, 62, 66], [55, 59, 62], [57, 61, 64]];
const MEL = [74, 76, 78, 76, 74, 73, 71, 73, 74, 78, 81, 79, 78, 76, 74, 76];
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
export function music(on) {
  if (!ac) return;
  if (on === musicOn) return;
  musicOn = on;
  clearInterval(musicTimer); musicTimer = null;
  if (!on) return;
  let step = 0;
  const beat = 0.34;
  const tick = () => {
    const d = bus.music, ch = PROG[Math.floor(step / 8) % 4];
    if (step % 2 === 0) for (const m of ch) tone(d, { f: mtof(m - 12), t: 0.5, type: "triangle", v: 0.05, a: 0.003 });
    if (step % 8 === 0) tone(d, { f: mtof(ch[0] - 24), t: 1.4, type: "sine", v: 0.18, a: 0.02 });
    if (step % 2 === 1 || Math.random() < 0.3) { const m = MEL[(step + Math.floor(step / 16) * 3) % MEL.length]; tone(d, { f: mtof(m), t: 0.4, type: "triangle", v: 0.07, a: 0.003 }); tone(d, { f: mtof(m) * 2, t: 0.12, type: "square", v: 0.012 }); }
    step++;
  };
  musicTimer = setInterval(tick, beat * 1000);
}
export function ambience() {
  if (!ac) return;
  // birds now and then
  setInterval(() => {
    if (paused || Math.random() < 0.5) return;
    const f = 2400 + Math.random() * 1600;
    for (let k = 0; k < 3; k++) tone(bus.world, { f: f * (1 + k * 0.08), f2: f * 1.3, t: 0.09, at: k * 0.12, type: "sine", v: 0.02 });
  }, 3800);
}
export function audioReady() { return !!ac; }
export function audioContext() { return ac; }
export function trackBus() { return bus.track || null; }

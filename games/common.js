// Pixel Acre Arcade — shared helpers for every game page.
// ES module. Import with: import { PA } from "./common.js";
import { cleanerFor } from "./scene-cleaner.js";

const store = {
  get(k, d) { try { const v = localStorage.getItem("pa:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("pa:" + k, JSON.stringify(v)); } catch {} },
};

const params = new URLSearchParams(location.search);
const THUMB = params.has("thumb");                       // screenshot / attract mode
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const TOUCH = matchMedia("(pointer: coarse)").matches || "ontouchstart" in window;

/* ------------------------------------------------------------------ audio */
let actx = null, master = null, musicGain = null, sfxGain = null;
let muted = store.get("muted", false);
function ctx() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    actx = new AC();
    master = actx.createGain(); master.gain.value = muted ? 0 : 1; master.connect(actx.destination);
    sfxGain = actx.createGain(); sfxGain.gain.value = 0.55; sfxGain.connect(master);
    musicGain = actx.createGain(); musicGain.gain.value = 0.16; musicGain.connect(master);
  }
  if (actx.state === "suspended") actx.resume();
  return actx;
}
function tone({ f = 440, f2 = null, t = 0.12, type = "square", v = 0.3, at = 0, dest = null }) {
  const c = ctx(); if (!c) return;
  const now = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(f, now);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), now + t);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(v, now + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, now + t);
  o.connect(g); g.connect(dest || sfxGain);
  o.start(now); o.stop(now + t + 0.02);
}
function noise({ t = 0.2, v = 0.25, hp = 800, lp = 6000, at = 0 }) {
  const c = ctx(); if (!c) return;
  const now = c.currentTime + at;
  const len = Math.max(1, Math.floor(c.sampleRate * t));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = c.createBufferSource(); s.buffer = buf;
  const h = c.createBiquadFilter(); h.type = "highpass"; h.frequency.value = hp;
  const l = c.createBiquadFilter(); l.type = "lowpass"; l.frequency.value = lp;
  const g = c.createGain(); g.gain.value = v;
  s.connect(h); h.connect(l); l.connect(g); g.connect(sfxGain);
  s.start(now);
}
const SFX = {
  click: () => tone({ f: 660, t: 0.05, v: 0.15 }),
  select: () => { tone({ f: 520, t: 0.06, v: 0.15 }); tone({ f: 780, t: 0.08, v: 0.15, at: 0.05 }); },
  coin: () => { tone({ f: 988, t: 0.08, v: 0.2 }); tone({ f: 1319, t: 0.22, v: 0.2, at: 0.07 }); },
  pop: () => tone({ f: 300, f2: 900, t: 0.12, type: "triangle", v: 0.35 }),
  jump: () => tone({ f: 260, f2: 620, t: 0.18, type: "square", v: 0.18 }),
  land: () => tone({ f: 140, f2: 70, t: 0.1, type: "triangle", v: 0.3 }),
  hit: () => { tone({ f: 200, f2: 50, t: 0.3, type: "sawtooth", v: 0.3 }); noise({ t: 0.25, v: 0.3, hp: 200, lp: 2000 }); },
  whoosh: () => noise({ t: 0.35, v: 0.18, hp: 600, lp: 3000 }),
  splash: () => noise({ t: 0.3, v: 0.22, hp: 1200, lp: 7000 }),
  thud: () => { tone({ f: 120, f2: 60, t: 0.14, type: "triangle", v: 0.4 }); noise({ t: 0.08, v: 0.15, hp: 100, lp: 900 }); },
  paddle: () => tone({ f: 520, f2: 420, t: 0.07, type: "triangle", v: 0.35 }),
  bounce: () => tone({ f: 380, f2: 300, t: 0.06, type: "triangle", v: 0.25 }),
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, t: 0.18, v: 0.2, at: i * 0.11 })),
  fail: () => [392, 330, 262].forEach((f, i) => tone({ f, t: 0.22, v: 0.2, type: "triangle", at: i * 0.14 })),
  ring: () => { tone({ f: 880, t: 0.1, v: 0.18, type: "sine" }); tone({ f: 1320, t: 0.25, v: 0.18, type: "sine", at: 0.06 }); },
  cluck: () => { tone({ f: 900, f2: 500, t: 0.07, type: "square", v: 0.12 }); tone({ f: 800, f2: 450, t: 0.07, type: "square", v: 0.12, at: 0.09 }); },
  moo: () => tone({ f: 140, f2: 110, t: 0.7, type: "sawtooth", v: 0.12 }),
  baa: () => { tone({ f: 420, f2: 380, t: 0.18, type: "sawtooth", v: 0.08 }); tone({ f: 400, f2: 330, t: 0.32, type: "sawtooth", v: 0.08, at: 0.16 }); },
  chop: () => { tone({ f: 190, f2: 120, t: 0.09, type: "square", v: 0.22 }); noise({ t: 0.09, v: 0.25, hp: 400, lp: 2400 }); },
  crack: () => { noise({ t: 0.16, v: 0.32, hp: 1400, lp: 6000 }); tone({ f: 320, f2: 160, t: 0.08, type: "triangle", v: 0.25 }); },
  plop: () => { tone({ f: 700, f2: 240, t: 0.12, type: "sine", v: 0.25 }); noise({ t: 0.12, v: 0.1, hp: 1500, lp: 5000, at: 0.02 }); },
  bite: () => { tone({ f: 1046, t: 0.07, v: 0.2, type: "square" }); tone({ f: 1046, t: 0.07, v: 0.2, type: "square", at: 0.1 }); },
  reel: () => { for (let i = 0; i < 6; i++) tone({ f: 600 + i * 70, t: 0.04, v: 0.1, type: "square", at: i * 0.045 }); },
};
function sfx(name) { if (THUMB) return; try { SFX[name] && SFX[name](); } catch {} }

// Tiny step-sequencer for background loops. notes: array of semitone offsets or null.
let musicTimer = null;
function music({ bpm = 100, root = 220, lead = [], bass = [], wave = "triangle" } = {}) {
  stopMusic(); if (THUMB) return;
  const c = ctx(); if (!c) return;
  const step = 60 / bpm / 2; let i = 0;
  const st = (n) => root * Math.pow(2, n / 12);
  musicTimer = setInterval(() => {
    const L = lead[i % lead.length], B = bass[i % bass.length];
    if (L != null) tone({ f: st(L), t: step * 0.9, type: wave, v: 0.22, dest: musicGain });
    if (B != null) tone({ f: st(B) / 2, t: step * 1.6, type: "sine", v: 0.35, dest: musicGain });
    i++;
  }, step * 1000);
}
function stopMusic() { if (musicTimer) clearInterval(musicTimer); musicTimer = null; }
function setMuted(m) {
  muted = m; store.set("muted", m);
  if (master) master.gain.value = m ? 0 : 1;
  if (m && window.speechSynthesis) speechSynthesis.cancel();
  document.querySelectorAll("[data-pa-mute]").forEach((b) => { b.textContent = m ? "Sound off" : "Sound on"; b.setAttribute("aria-pressed", String(!m)); });
}

/* ------------------------------------------------------------- voice (JP) */
// Characters speak short Japanese lines; the English meaning is shown on screen.
let jaVoice = null;
function pickVoice() {
  if (!window.speechSynthesis) return;
  const vs = speechSynthesis.getVoices();
  jaVoice = vs.find((v) => /ja[-_]JP/i.test(v.lang)) || vs.find((v) => /^ja/i.test(v.lang)) || null;
}
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
function babble(text, pitch = 1) {
  // Fallback when no Japanese TTS voice exists: syllable blips in the rhythm of the line.
  const n = Math.min(14, Math.max(3, Math.round(text.length * 0.8)));
  for (let i = 0; i < n; i++) tone({ f: (420 + Math.random() * 260) * pitch, t: 0.06, type: "triangle", v: 0.12, at: i * 0.075 });
}
function sayJP(text, { pitch = 1, rate = 1.05 } = {}) {
  if (muted || THUMB) return;
  ctx();
  if (window.speechSynthesis && jaVoice) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = jaVoice; u.lang = jaVoice.lang; u.pitch = pitch; u.rate = rate; u.volume = 0.9;
      speechSynthesis.speak(u);
      return;
    } catch {}
  }
  babble(text, pitch);
}

/* ---------------------------------------------------------------- UI chrome */
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }

function topBar({ title, scoreLabel = "" }) {
  const bar = el(`<div class="pa-bar">
    <a class="pa-chip" href="../index.html#${location.pathname.split("/").pop().replace(".html", "")}" aria-label="Back to the gallery">← Gallery</a>
    <span class="pa-title">${title}</span>
    <span class="pa-spacer"></span>
    <span class="pa-chip pa-score" aria-live="polite" data-pa-score>${scoreLabel}</span>
    <button class="pa-chip" data-pa-mute aria-pressed="${!muted}">${muted ? "Sound off" : "Sound on"}</button>
    <button class="pa-chip" data-pa-pause aria-label="Pause">Pause</button>
  </div>`);
  bar.querySelector("[data-pa-mute]").onclick = () => { setMuted(!muted); if (!muted) sfx("click"); };
  if (THUMB) bar.style.display = "none";
  document.body.appendChild(bar);
  return {
    bar,
    setScore(t) { const s = bar.querySelector("[data-pa-score]"); s.textContent = t; s.hidden = !t; },
    onPause(fn) { bar.querySelector("[data-pa-pause]").onclick = fn; },
  };
}

let overlayEl = null;
function overlay(html, binds = {}) {
  closeOverlay();
  overlayEl = el(`<div class="pa-overlay" role="dialog" aria-modal="true"><div class="pa-card">${html}</div></div>`);
  if (THUMB) overlayEl.style.display = "none";
  document.body.appendChild(overlayEl);
  for (const [sel, fn] of Object.entries(binds)) overlayEl.querySelectorAll(sel).forEach((n) => n.addEventListener("click", (e) => { sfx("select"); fn(e); }));
  const first = overlayEl.querySelector("button, a"); if (first) setTimeout(() => first.focus({ preventScroll: true }), 30);
  return overlayEl;
}
function closeOverlay() { if (overlayEl) { overlayEl.remove(); overlayEl = null; } }
function overlayOpen() { return !!overlayEl; }

let toastT = null, toastEl = null;
function toast(msg, ms = 1800) {
  if (!toastEl) { toastEl = el(`<div class="pa-toast" role="status"></div>`); document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.classList.add("show");
  clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove("show"), ms);
}

/* ------------------------------------------------------------------- input */
// keys: live set of pressed codes. Touch stick writes to axis {x,y}; buttons map to codes.
const keys = new Set();
const axis = { x: 0, y: 0 };
addEventListener("keydown", (e) => {
  if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code) && !e.target.closest?.("input,textarea")) e.preventDefault();
  keys.add(e.code);
});
addEventListener("keyup", (e) => keys.delete(e.code));
addEventListener("blur", () => keys.clear());

function touchControls({ stick = true, buttons = [] } = {}) {
  // buttons: [{label, code, alt}] — pressing emits a synthetic key press on `code`.
  const wrap = el(`<div class="pa-touch"></div>`);
  if (TOUCH && !THUMB) wrap.classList.add("on");
  if (stick) {
    const s = el(`<div class="pa-stick" aria-hidden="true"><i></i></div>`); wrap.appendChild(s);
    const knob = s.querySelector("i"); let id = null, cx = 0, cy = 0;
    const move = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        let dx = t.clientX - cx, dy = t.clientY - cy; const m = Math.hypot(dx, dy), R = 50;
        if (m > R) { dx = dx / m * R; dy = dy / m * R; }
        knob.style.transform = `translate(${dx}px,${dy}px)`; axis.x = dx / R; axis.y = dy / R;
      }
    };
    s.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; id = t.identifier; const r = s.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; move(e); e.preventDefault(); }, { passive: false });
    s.addEventListener("touchmove", (e) => { move(e); e.preventDefault(); }, { passive: false });
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === id) { id = null; axis.x = axis.y = 0; knob.style.transform = ""; } };
    s.addEventListener("touchend", end); s.addEventListener("touchcancel", end);
  }
  const bw = el(`<div class="pa-tbtns"></div>`); wrap.appendChild(bw);
  for (const b of buttons) {
    const n = el(`<button class="pa-tbtn ${b.alt ? "alt" : ""}">${b.label}</button>`);
    const down = (e) => { e.preventDefault(); n.classList.add("down"); keys.add(b.code); dispatchEvent(new KeyboardEvent("keydown", { code: b.code, key: b.key || b.code })); };
    const up = (e) => { e.preventDefault(); n.classList.remove("down"); keys.delete(b.code); dispatchEvent(new KeyboardEvent("keyup", { code: b.code, key: b.key || b.code })); };
    n.addEventListener("touchstart", down, { passive: false }); n.addEventListener("touchend", up, { passive: false }); n.addEventListener("touchcancel", up);
    n.addEventListener("mousedown", down); n.addEventListener("mouseup", up); n.addEventListener("mouseleave", (e) => n.classList.contains("down") && up(e));
    bw.appendChild(n);
  }
  document.body.appendChild(wrap);
  return wrap;
}

/* ---------------------------------------------------------------- renderer */
async function renderer(THREE, { clear = 0x17122b, shadows = true } = {}) {
  const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: THUMB });
  r.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  r.setSize(innerWidth, innerHeight);
  r.setClearColor(clear);
  r.shadowMap.enabled = shadows;
  r.shadowMap.type = THREE.PCFSoftShadowMap;
  r.outputColorSpace = THREE.SRGBColorSpace;
  r.toneMapping = THREE.ACESFilmicToneMapping;
  r.toneMappingExposure = 1.05;
  r.domElement.className = "game";
  document.body.prepend(r.domElement);
  // GPU hygiene for every game: whatever it rendered is disposed when the player leaves the page
  // (back to the hub), the WebGL context is dropped, and a bfcache restore reloads cleanly.
  const cleaner = cleanerFor(r, { name: location.pathname.split("/").pop() });
  cleaner.onLeave(() => { for (const l of loops) l.stop(); stopMusic(); });
  cleaner.installPageLifecycle();
  PA.cleaner = cleaner;
  return r;
}
function onResize(fn) { addEventListener("resize", fn); fn(); }

// Fixed-step-friendly loop with pause support. update(dt, t) returns nothing.
const loops = [];
function loop(update) {
  let last = performance.now(), paused = false, raf = 0, stopped = false;
  const frame = (now) => {
    if (stopped) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)); last = now;
    update(paused ? 0 : dt, now / 1000, paused);
  };
  raf = requestAnimationFrame(frame);
  const api = { pause() { paused = true; }, resume() { paused = false; last = performance.now(); }, get paused() { return paused; }, stop() { stopped = true; cancelAnimationFrame(raf); } };
  loops.push(api);
  return api;
}

function best(key, score, higherIsBetter = true) {
  const prev = store.get("best:" + key, null);
  const isBest = prev == null || (higherIsBetter ? score > prev : score < prev);
  if (isBest) store.set("best:" + key, score);
  return { best: isBest ? score : prev, isNew: isBest && prev != null };
}

export const PA = { cleaner: null, store, THUMB, REDUCED, TOUCH, sfx, music, stopMusic, setMuted, get muted() { return muted; }, sayJP, ctx,
  el, topBar, overlay, closeOverlay, overlayOpen, toast, keys, axis, touchControls, renderer, onResize, loop, best, params };

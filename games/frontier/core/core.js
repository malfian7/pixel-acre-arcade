// Frontier Crown — core utilities: seeded RNG, event queue, fixed-timestep loop, app state machine.

export const TICK = 1 / 20; // simulation step: 20 Hz

// mulberry32 — the only randomness the simulation may use.
export function makeRng(seed) {
  let a = seed >>> 0;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (n) => Math.floor(r() * n);
  r.state = () => a;
  return r;
}

// Events emitted by the simulation during a tick; drained by view/audio/HUD after it.
export class EventQueue {
  constructor() { this.list = []; }
  push(type, data) { this.list.push({ type, ...data }); }
  drain() { const l = this.list; this.list = []; return l; }
}

// Fixed timestep driver. `step()` runs 0..n times per frame; `render(alpha, dt)` once.
export function fixedLoop({ step, render, maxFrame = 0.25 }) {
  let acc = 0, last = performance.now(), speed = 1, paused = false, raf = 0, running = true;
  const frame = (now) => {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min((now - last) / 1000, maxFrame)); last = Math.max(last, now);
    if (!paused) {
      acc += dt * speed;
      let n = 0;
      while (acc >= TICK && n < 12) { step(); acc -= TICK; n++; }
      if (n === 12) acc = 0;
    }
    render(paused ? 0 : acc / TICK, dt);
  };
  raf = requestAnimationFrame(frame);
  return {
    get speed() { return speed; }, set speed(v) { speed = v; },
    get paused() { return paused; }, set paused(v) { paused = v; last = performance.now(); },
    stop() { running = false; cancelAnimationFrame(raf); },
  };
}

// Minimal app state machine: states are objects with optional enter/exit/update.
export class StateMachine {
  constructor(states) { this.states = states; this.cur = null; this.name = ""; }
  go(name, arg) {
    if (this.cur && this.cur.exit) this.cur.exit(name);
    this.name = name; this.cur = this.states[name];
    if (this.cur && this.cur.enter) this.cur.enter(arg);
  }
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

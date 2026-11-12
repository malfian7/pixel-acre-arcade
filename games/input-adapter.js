// Pixel Acre Arcade — InputAdapter: one set of game intents from mouse, keyboard and touch.
//
// Games never read raw pointer events. They subscribe to intents, which mean the same thing on every
// device:
//
//   intent      desktop                               touch
//   ─────────   ───────────────────────────────────   ─────────────────────────────────────────────
//   primary     left click                            single tap
//   secondary   right click                           long press (hold 0.4 s without moving)
//   drag*       left-button drag                      one-finger drag (configurable: "box" | "pan" | "none")
//   pan*        middle-button drag                    two-finger drag (midpoint)
//   zoom        scroll wheel / trackpad pinch         two-finger pinch (around the fingers' midpoint)
//   hover       mouse move without buttons            —
//   keys        WASD (optional) + arrows → axis()     — (on-screen buttons can call press())
//
//   const input = new InputAdapter(canvas, { oneFingerDrag: "box", keys: "arrows" });
//   input.on("primary",   ({ x, y, shift, double, source }) => select(x, y));
//   input.on("secondary", ({ x, y, shift, source }) => moveUnitsTo(x, y));
//   input.on("zoom",      ({ scale, x, y }) => camera.zoomBy(scale, x, y)); // scale > 1 = closer
//   input.on("panstart" | "pan" | "panend", ({ x, y }) => camera.grab(x, y));  // keep this point under it
//   input.on("dragstart" | "drag" | "dragend" | "dragcancel", ({ x0, y0, x, y }) => box(x0, y0, x, y));
//   const [ax, az] = input.axis();                                              // keyboard pan, -1..1
//
// Device detection: a first guess from media queries (hover: none + pointer: coarse → touch), then
// whatever the player actually uses (pointerType of each pointerdown) — so a touchscreen laptop
// switches live. The current device is on <html data-input="mouse|touch"> for CSS, and a "device"
// event fires on change. Coordinates are client pixels; x/y of a two-finger gesture are its midpoint.
//
// Touch arbitration (the part that makes it feel right):
//   • a finger that moves more than tapSlop px is a drag, never a tap or a long press
//   • a second finger cancels the first finger's tap / long press / drag ("dragcancel") and starts a
//     pan + pinch gesture; lifting fingers after a gesture produces nothing until all are up
//   • a long press shows a ring filling under the finger (after 120 ms, so quick taps never flash it),
//     fires "secondary" at 0.4 s with a short vibration, and that finger's release is then ignored
//   • the browser's own gestures (scroll, double-tap zoom, text selection, the long-press menu) are
//     switched off on the element

export const INPUT = {
  longPress: 400,     // ms a finger must stay still for a secondary action
  ringDelay: 120,     // ms before the long-press ring appears
  tapSlop: 10,        // px a finger may wander and still be a tap / long press
  mouseSlop: 6,       // px before a left-button press becomes a drag
  rightSlop: 12,      // px a right-click may move and still count
  doubleMs: 320,      // ms between two primaries for "double"
  doubleSlop: 24,     // px between them
  wheelK: 0.0018,     // zoom per wheel pixel: scale = e^(−deltaY·k)
};

const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
const WASD = { KeyA: [-1, 0], KeyD: [1, 0], KeyW: [0, -1], KeyS: [0, 1] };

export class InputAdapter {
  constructor(el, { oneFingerDrag = "box", keys = "arrows", feedback = true, device = null } = {}) {
    this.el = el; this.o = { oneFingerDrag, keys, feedback };
    this.handlers = new Map();
    this.gate = () => true;            // false → intents are not emitted (menus, cut-scenes)
    this.keys = new Set();
    this.pointer = { x: innerWidth / 2, y: innerHeight / 2, inside: false, type: "mouse" };
    this.touches = new Map();          // pointerId → { x, y, sx, sy, t }
    this.gesture = null;               // two-finger state
    this.mouse = null;                 // pressed mouse button state
    this.lastPrimary = { t: -1e9, x: 0, y: 0 };
    this.device = device || (matchMedia("(hover: none) and (pointer: coarse)").matches ? "touch" : "mouse");
    this.ac = new AbortController();
    this.bind();
    this.setDevice(this.device, true);
  }

  // ---------------------------------------------------------------- events
  on(type, fn) { if (!this.handlers.has(type)) this.handlers.set(type, new Set()); this.handlers.get(type).add(fn); return () => this.off(type, fn); }
  off(type, fn) { const s = this.handlers.get(type); if (s) s.delete(fn); }
  emit(type, e) {
    if (type !== "device" && !this.gate()) return;
    const s = this.handlers.get(type);
    if (s) for (const fn of [...s]) fn({ type, device: this.device, ...e });
  }
  configure(o) { Object.assign(this.o, o); for (const k of [...this.keys]) if (!this.isAxisKey(k)) this.keys.delete(k); }
  setDevice(d, quiet = false) {
    if (d === this.device && !quiet) return;
    this.device = d;
    document.documentElement.dataset.input = d;
    if (!quiet) this.emit("device", { kind: d });
  }

  // ---------------------------------------------------------------- keyboard
  isAxisKey(code) { return code in ARROWS || (this.o.keys === "wasd" && code in WASD); }
  /** Keyboard pan direction [x, z], each −1..1 (z = up the screen is −1). */
  axis() {
    let x = 0, z = 0;
    for (const k of this.keys) { const v = ARROWS[k] || (this.o.keys === "wasd" && WASD[k]); if (v) { x += v[0]; z += v[1]; } }
    return [Math.max(-1, Math.min(1, x)), Math.max(-1, Math.min(1, z))];
  }
  isDown(code) { return this.keys.has(code); }
  /** On-screen buttons can feed the same key state. */
  press(code, down) { if (down) this.keys.add(code); else this.keys.delete(code); }

  // ---------------------------------------------------------------- DOM
  bind() {
    const el = this.el, sig = { signal: this.ac.signal };
    Object.assign(el.style, { touchAction: "none", userSelect: "none", webkitUserSelect: "none", webkitTouchCallout: "none" });
    const typing = (e) => e.target && e.target.closest && e.target.closest("input,textarea,select,[contenteditable]");
    addEventListener("keydown", (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey) return;
      if (this.isAxisKey(e.code) && !(e.altKey && e.code in WASD)) { this.keys.add(e.code); if (e.code in ARROWS) e.preventDefault(); }
    }, sig);
    addEventListener("keyup", (e) => this.keys.delete(e.code), sig);
    addEventListener("blur", () => { this.keys.clear(); this.cancelAll(); }, sig);
    el.addEventListener("contextmenu", (e) => e.preventDefault(), sig);
    el.addEventListener("pointerdown", (e) => this.down(e), sig);
    addEventListener("pointermove", (e) => this.move(e), sig);
    addEventListener("pointerup", (e) => this.up(e), sig);
    addEventListener("pointercancel", (e) => this.cancel(e), sig);
    el.addEventListener("wheel", (e) => {
      e.preventDefault();
      // pixels; lines/pages normalised. Trackpad pinch arrives as ctrl+wheel with small deltas → stronger.
      const dy = e.deltaY * (e.deltaMode === 1 ? 30 : e.deltaMode === 2 ? 600 : 1) * (e.ctrlKey ? 6 : 1);
      this.emit("zoom", { scale: Math.exp(-dy * INPUT.wheelK), x: e.clientX, y: e.clientY, source: e.ctrlKey ? "trackpad" : "wheel" });
    }, { passive: false, signal: this.ac.signal });
    document.addEventListener("mouseleave", () => (this.pointer.inside = false), sig);
    document.addEventListener("mouseenter", () => (this.pointer.inside = true), sig);
  }

  down(e) {
    const touch = e.pointerType === "touch";
    this.setDevice(touch ? "touch" : "mouse");
    this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true; this.pointer.type = e.pointerType;
    try { this.el.setPointerCapture(e.pointerId); } catch {}
    if (touch) return this.touchDown(e);
    e.preventDefault();
    if (this.mouse) return; // one button at a time
    this.mouse = { button: e.button, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, shift: e.shiftKey, drag: false };
    if (e.button === 1) this.emit("panstart", { x: e.clientX, y: e.clientY, source: "mouse" });
  }
  move(e) {
    this.pointer.x = e.clientX; this.pointer.y = e.clientY; this.pointer.inside = true; this.pointer.type = e.pointerType;
    if (e.pointerType === "touch") return this.touchMove(e);
    const m = this.mouse;
    if (!m) { this.emit("hover", { x: e.clientX, y: e.clientY }); return; }
    m.x = e.clientX; m.y = e.clientY;
    if (m.button === 1) return this.emit("pan", { x: m.x, y: m.y, source: "mouse" });
    if (m.button !== 0) return;
    if (!m.drag && Math.hypot(m.x - m.sx, m.y - m.sy) > INPUT.mouseSlop) { m.drag = true; this.emit("dragstart", { x0: m.sx, y0: m.sy, x: m.x, y: m.y, shift: m.shift, source: "mouse" }); }
    if (m.drag) this.emit("drag", { x0: m.sx, y0: m.sy, x: m.x, y: m.y, shift: m.shift, source: "mouse" });
  }
  up(e) {
    if (e.pointerType === "touch") return this.touchUp(e);
    const m = this.mouse;
    if (!m || e.button !== m.button) return;
    this.mouse = null;
    const x = e.clientX, y = e.clientY, shift = e.shiftKey || m.shift;
    if (m.button === 1) return this.emit("panend", { x, y, source: "mouse" });
    if (m.button === 2) { if (Math.hypot(x - m.sx, y - m.sy) <= INPUT.rightSlop) this.emit("secondary", { x, y, shift, source: "mouse" }); return; }
    if (m.button !== 0) return;
    if (m.drag) return this.emit("dragend", { x0: m.sx, y0: m.sy, x, y, shift, source: "mouse" });
    this.primary(x, y, shift, "mouse");
  }
  primary(x, y, shift, source) {
    const L = this.lastPrimary, now = performance.now();
    const double = now - L.t < INPUT.doubleMs && Math.hypot(x - L.x, y - L.y) < INPUT.doubleSlop;
    this.lastPrimary = { t: double ? -1e9 : now, x, y };
    this.emit("primary", { x, y, shift, double, source });
  }

  // ---------------------------------------------------------------- touch
  touchDown(e) {
    if (this.touches.size >= 2) return; // a third finger is ignored
    const t = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now(), state: "pending" };
    this.touches.set(e.pointerId, t);
    if (this.touches.size === 1) {
      this.consumed = false;
      t.timer = setTimeout(() => this.longPress(e.pointerId), INPUT.longPress);
      t.ringT = setTimeout(() => this.ring(t.x, t.y, true), INPUT.ringDelay);
      return;
    }
    // second finger: whatever the first was doing is cancelled, a pan + pinch gesture starts
    const first = [...this.touches.values()][0];
    this.clearTimers(first); this.ring(0, 0, false);
    if (first.state === "drag") this.emit(this.o.oneFingerDrag === "pan" ? "panend" : "dragcancel", { x0: first.sx, y0: first.sy, x: first.x, y: first.y, source: "touch" });
    first.state = "gesture"; t.state = "gesture";
    const [a, b] = [...this.touches.values()];
    this.gesture = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    this.consumed = true;
    this.emit("panstart", { x: this.gesture.mx, y: this.gesture.my, source: "touch" });
  }
  touchMove(e) {
    const t = this.touches.get(e.pointerId); if (!t) return;
    t.x = e.clientX; t.y = e.clientY;
    if (this.gesture && this.touches.size === 2) {
      const [a, b] = [...this.touches.values()], g = this.gesture;
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (Math.abs(d - g.d) > 0.5) { this.emit("zoom", { scale: d / g.d, x: mx, y: my, source: "pinch" }); g.d = d; }
      this.emit("pan", { x: mx, y: my, source: "touch" });
      g.mx = mx; g.my = my;
      return;
    }
    if (t.state === "pending" && Math.hypot(t.x - t.sx, t.y - t.sy) > INPUT.tapSlop) {
      this.clearTimers(t); this.ring(0, 0, false);
      const mode = this.o.oneFingerDrag;
      if (mode === "none" || this.consumed) { t.state = "dead"; return; }
      t.state = "drag";
      this.emit(mode === "pan" ? "panstart" : "dragstart", mode === "pan" ? { x: t.sx, y: t.sy, source: "touch" } : { x0: t.sx, y0: t.sy, x: t.x, y: t.y, source: "touch" });
    }
    if (t.state === "drag") this.emit(this.o.oneFingerDrag === "pan" ? "pan" : "drag", { x0: t.sx, y0: t.sy, x: t.x, y: t.y, source: "touch" });
  }
  touchUp(e) {
    const t = this.touches.get(e.pointerId); if (!t) return;
    this.touches.delete(e.pointerId); this.clearTimers(t); this.ring(0, 0, false);
    if (this.gesture) {
      if (this.touches.size < 2) { this.emit("panend", { x: this.gesture.mx, y: this.gesture.my, source: "touch" }); this.gesture = null; }
      return; // the remaining finger stays "consumed" until it lifts
    }
    if (t.state === "drag") return this.emit(this.o.oneFingerDrag === "pan" ? "panend" : "dragend", { x0: t.sx, y0: t.sy, x: t.x, y: t.y, source: "touch" });
    if (t.state === "pending" && !this.consumed) this.primary(t.x, t.y, false, "tap");
  }
  longPress(id) {
    const t = this.touches.get(id);
    if (!t || t.state !== "pending" || this.touches.size !== 1) return;
    t.state = "done"; this.ring(0, 0, false);
    if (navigator.vibrate) try { navigator.vibrate(12); } catch {}
    this.emit("secondary", { x: t.x, y: t.y, shift: false, source: "longpress" });
  }
  clearTimers(t) { clearTimeout(t.timer); clearTimeout(t.ringT); }
  cancel(e) {
    if (e.pointerType !== "touch") { if (this.mouse && this.mouse.drag) this.emit("dragcancel", {}); if (this.mouse && this.mouse.button === 1) this.emit("panend", { x: this.mouse.x, y: this.mouse.y }); this.mouse = null; return; }
    const t = this.touches.get(e.pointerId); if (!t) return;
    this.touches.delete(e.pointerId); this.clearTimers(t); this.ring(0, 0, false);
    if (t.state === "drag") this.emit(this.o.oneFingerDrag === "pan" ? "panend" : "dragcancel", {});
    if (this.gesture && this.touches.size < 2) { this.emit("panend", { x: this.gesture.mx, y: this.gesture.my }); this.gesture = null; }
  }
  cancelAll() {
    for (const t of this.touches.values()) this.clearTimers(t);
    this.touches.clear(); this.gesture = null; this.mouse = null; this.ring(0, 0, false);
  }

  // ---------------------------------------------------------------- long-press ring
  ring(x, y, on) {
    if (!this.o.feedback) return;
    if (!this.ringEl) {
      if (!on) return;
      const st = document.createElement("style");
      st.textContent = `.pa-lp{position:fixed;width:64px;height:64px;margin:-32px 0 0 -32px;border-radius:50%;pointer-events:none;z-index:60;
        background:conic-gradient(rgba(255,214,120,.85) var(--p,0turn),rgba(255,255,255,.12) 0);
        -webkit-mask:radial-gradient(circle,transparent 24px,#000 25px);mask:radial-gradient(circle,transparent 24px,#000 25px);
        opacity:0;transition:opacity .08s}.pa-lp.on{opacity:1;animation:pa-lp ${INPUT.longPress - INPUT.ringDelay}ms linear forwards}
        @property --p{syntax:'<angle>';inherits:false;initial-value:0turn}@keyframes pa-lp{to{--p:1turn}}
        @media (prefers-reduced-motion:reduce){.pa-lp.on{animation:none;--p:1turn}}`;
      document.head.appendChild(st);
      this.ringEl = document.createElement("div"); this.ringEl.className = "pa-lp"; this.ringEl.setAttribute("aria-hidden", "true");
      document.body.appendChild(this.ringEl);
    }
    const r = this.ringEl;
    if (on) { r.style.left = x + "px"; r.style.top = y + "px"; r.classList.remove("on"); void r.offsetWidth; r.classList.add("on"); }
    else r.classList.remove("on");
  }

  dispose() { this.ac.abort(); this.cancelAll(); if (this.ringEl) this.ringEl.remove(); this.handlers.clear(); }
}

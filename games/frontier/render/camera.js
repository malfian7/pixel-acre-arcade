// Frontier Crown — RTSCameraController: the classic top-down RTS camera (fixed heading, looking north).
//
// Not an orbit camera: the player never rotates it. Three things move it:
//
//   1. PANNING with inertia — every source sets a pan *velocity* that the camera eases into and,
//      once released, glides out of (exponential damping, frame-rate independent):
//        • keys: Arrows always; W A S D when the "Camera keys" setting is WASD (Alt+W/A/S/D then reach
//          the command card)
//        • middle mouse: grab the ground — the point under the cursor stays under the cursor while you
//          drag; letting go flings the camera with the drag's speed
//        • edge scrolling: the cursor within EDGE.zone px of the window edge; speed ramps up toward the
//          edge, corners scroll diagonally
//      Pan speed scales with zoom, so a screen-width takes about the same time at any height.
//   2. DYNAMIC ZOOM — the wheel changes the distance (eased) and the pitch follows: high up the camera
//      looks steeply down (~62°); close to the ground it levels out (~40°) to show the units' faces
//      and the horizon. Zooming keeps the ground point under the cursor fixed.
//   3. MAP BOUNDARIES — every frame the four corners of the visible ground (the screen minus the HUD
//      bars) are intersected with the ground plane; the look-at point is clamped so that footprint never
//      leaves the terrain by more than BOUNDS.pad tiles. Velocity into a wall is dropped, so inertia
//      never "sticks" to an edge. When zoomed out further than the map is wide, the view centres.
//
// Input comes from the arcade's InputAdapter (bindInput): wheel and two-finger pinch zoom, middle-drag
// and two-finger drag grab the ground, the keyboard axis pans, the mouse position drives edge scroll —
// the same camera on desktop and touch. The game's Controller keeps clicks, selection and orders.

const DEG = Math.PI / 180;
export const CAMERA = {
  minDist: 11, maxDist: 62,
  pitchNear: 40 * DEG,       // at minDist
  pitchFar: 62 * DEG,        // from FAR_FROM of the zoom range upward
  pitchEase: 0.6,            // the pitch changes in the closest 60% of the zoom range ("near the ground")
  panSpeed: 34,              // tiles/s at distance 30 (scales with distance)
  accel: 12,                 // 1/s — how fast the pan velocity reaches the input's
  glide: 4.5,                // 1/s — how fast it dies away after release (inertia)
  zoomDamp: 9,               // 1/s — distance easing
  wheelBase: 1.0018,         // goalDist *= wheelBase ^ deltaY
  groundClear: 2.2,          // the camera stays this high above the terrain under it
};
export const EDGE = { zone: 14, power: 1.6 };   // px from the window edge; ramp exponent
export const BOUNDS = { pad: 2 };               // tiles of dark border that may show past the map edge

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);

export class RTSCameraController {
  constructor(THREE, camera, heightAt, size = 128, opts = {}) {
    this.THREE = THREE; this.cam = camera; this.heightAt = heightAt; this.size = size;
    this.o = { ...CAMERA, ...opts };
    // look-at point on the ground (tx, ty, tz), distance along the view ray, pitch
    this.tx = size / 2; this.tz = size / 2; this.ty = 0;
    this.dist = 24; this.goalDist = 24; this.pitch = this.pitchFor(24);
    this.vx = 0; this.vz = 0;               // pan velocity (tiles/s)
    this.shake = 0;
    this.settings = { edge: true, wasd: false };
    this.insets = { top: 0, bottom: 0 };   // px of screen covered by HUD bars (excluded from the bounds)
    this.gate = () => true;                 // input allowed? (set by the game's Controller)
    this.clamped = { x: false, z: false };
    this.grab = null;                       // middle-drag state
    this.zoomAnchor = null;                 // { ndcX, ndcY, x, z } ground point the wheel zoom keeps fixed
    this.ray = new THREE.Raycaster(); this.v2 = new THREE.Vector2(); this.v3 = new THREE.Vector3();
    this.foot = { x0: -20, x1: 20, z0: -30, z1: 12 }; // footprint offsets from the look-at point
    this.place();
  }

  // ---------------------------------------------------------------- public API
  get minD() { return this.o.minDist; }
  get maxD() { return this.o.maxDist; }
  get zoomT() { return (this.dist - this.o.minDist) / (this.o.maxDist - this.o.minDist); }
  /** Pitch (radians above the horizon) for a distance: levels out only in the low part of the range. */
  pitchFor(d) {
    const t = (d - this.o.minDist) / (this.o.maxDist - this.o.minDist);
    return this.o.pitchNear + (this.o.pitchFar - this.o.pitchNear) * smooth(0, this.o.pitchEase, t);
  }
  configure(s) { Object.assign(this.settings, s); if (this.input) this.input.configure({ keys: this.settings.wasd ? "wasd" : "arrows" }); }
  setInsets(top, bottom) { this.insets.top = top; this.insets.bottom = bottom; }
  /** Jump to a ground point (minimap, alerts, hotkeys). Kills inertia. */
  focus(x, z) { this.tx = x; this.tz = z; this.vx = this.vz = 0; this.zoomAnchor = null; this.pitch = this.pitchFor(this.dist); this.place(); this.measureFootprint(); this.clamp(); }
  /** Immediate offset in screen-ish units (touch drag, scripted). Scales with zoom like key panning. */
  pan(dx, dz) { const k = this.dist / 30; this.tx += dx * k; this.tz += dz * k; this.clamp(); }
  /** Wheel-style zoom; with ndc given, the ground point under it stays put while the zoom eases in. */
  zoom(delta, ndcX, ndcY) {
    this.goalDist = Math.max(this.o.minDist, Math.min(this.o.maxDist, this.goalDist * Math.pow(this.o.wheelBase, delta)));
    if (ndcX === undefined) { this.zoomAnchor = null; return; }
    const p = this.groundPlane(ndcX, ndcY);
    this.zoomAnchor = p ? { ndcX, ndcY, x: p.x, z: p.z } : null;
  }

  // ---------------------------------------------------------------- DOM
  /** Drive the camera from the arcade's InputAdapter (games/input-adapter.js): wheel / pinch zoom,
   *  middle-drag / two-finger drag pan (grab-the-ground), keyboard axis and the pointer for edge scroll. */
  bindInput(input, canvas) {
    this.unbindInput();
    this.input = input; this.canvas = canvas || input.el;
    input.configure({ keys: this.settings.wasd ? "wasd" : "arrows" });
    this.offs = [
      input.on("zoom", (e) => { const n = this.ndc(e.x, e.y); this.zoomBy(e.scale, n[0], n[1]); }),
      input.on("panstart", (e) => this.grabStart(e.x, e.y)),
      input.on("pan", (e) => this.grabMove(e.x, e.y)),
      input.on("panend", (e) => this.grabEnd(e.x, e.y)),
    ];
  }
  unbindInput() { if (this.offs) this.offs.forEach((off) => off()); this.offs = null; this.grab = null; }
  /** Old name: the camera no longer listens to the DOM itself. */
  detach() { this.unbindInput(); }

  /** Zoom by a factor (> 1 = closer); with ndc given, that ground point stays under it. */
  zoomBy(scale, ndcX, ndcY) { this.zoom(-Math.log(scale) / Math.log(this.o.wheelBase), ndcX, ndcY); }

  // grab-the-ground: the point under (x, y) at grabStart stays under the cursor / fingers' midpoint
  grabStart(x, y) {
    const n = this.ndc(x, y), p = this.groundPlane(n[0], n[1]);
    if (!p) return;
    this.grab = { x: p.x, z: p.z, sx: x, sy: y, hist: [[performance.now(), this.tx, this.tz]] };
    this.vx = this.vz = 0; this.zoomAnchor = null;
  }
  grabMove(x, y) { if (!this.grab) return; this.grab.sx = x; this.grab.sy = y; this.applyGrab(); }
  /** Release: the camera's speed over the last ~120 ms of the drag becomes the inertia (fling). */
  grabEnd(x, y) {
    if (!this.grab) return;
    if (x !== undefined) { this.grab.sx = x; this.grab.sy = y; this.applyGrab(); }
    const now = performance.now(), h = this.grab.hist, last = h[h.length - 1];
    let vx = 0, vz = 0;
    if (now - last[0] < 100) { // still moving at release (a drag that stopped first leaves no fling)
      const ref = h.find((q) => q !== last && now - q[0] <= 150) || h[h.length - 2];
      const sec = ref ? (last[0] - ref[0]) / 1000 : 0;
      if (sec > 0.008) { vx = (last[1] - ref[1]) / sec; vz = (last[2] - ref[2]) / sec; }
    }
    const cap = this.o.panSpeed * (this.dist / 30) * 2.5, L = Math.hypot(vx, vz);
    if (L > cap) { vx *= cap / L; vz *= cap / L; }
    this.vx = vx; this.vz = vz;
    this.grab = null;
  }
  ndc(cx, cy) {
    const r = this.canvas ? this.canvas.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
    return [((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1];
  }

  // ---------------------------------------------------------------- per frame
  /** Direction from keys + edge (x, z each -1..1; edge contributes a ramp). */
  inputDir() {
    if (!this.input) return [0, 0];
    let [x, z] = this.input.axis();
    const m = this.input.pointer;
    if (this.settings.edge && this.input.device === "mouse" && m.inside && m.type !== "touch" && !this.grab && document.hasFocus() && !(this.edgeBlocked && this.edgeBlocked())) {
      const Z = EDGE.zone, w = innerWidth, h = innerHeight;
      const ramp = (d) => (d < Z ? Math.pow(1 - Math.max(0, d) / Z, EDGE.power) * 0.75 + 0.25 : 0);
      x += -ramp(m.x) + ramp(w - 1 - m.x);
      z += -ramp(m.y) + ramp(h - 1 - m.y);
    }
    const L = Math.hypot(x, z);
    if (L > 1) { x /= L; z /= L; }
    return [x, z];
  }

  update(dt) {
    const o = this.o;
    const on = this.gate();
    if (!on) this.grab = null;
    // zoom: ease the distance, pitch follows the distance
    this.dist += (this.goalDist - this.dist) * damp(o.zoomDamp, dt);
    this.pitch = this.pitchFor(this.dist);
    const zoomK = this.dist / 30;
    if (this.grab) this.applyGrab();
    else {
      const [ix, iz] = on ? this.inputDir() : [0, 0];
      if (ix || iz) {
        const s = o.panSpeed * zoomK, a = damp(o.accel, dt);
        this.vx += (ix * s - this.vx) * a; this.vz += (iz * s - this.vz) * a;
      } else {
        const g = Math.exp(-o.glide * dt);
        this.vx *= g; this.vz *= g;
        if (Math.abs(this.vx) + Math.abs(this.vz) < 0.01) this.vx = this.vz = 0;
      }
      this.tx += this.vx * dt; this.tz += this.vz * dt;
    }
    // ground height under the look-at point (eased, so hills do not jolt the view)
    const h = this.heightAt(Math.max(0, Math.min(this.size - 0.01, this.tx)), Math.max(0, Math.min(this.size - 0.01, this.tz)));
    this.ty += (h - this.ty) * damp(4, dt);
    // zoom toward the cursor: keep the anchored ground point under the same screen position
    if (this.zoomAnchor && !this.grab) {
      this.place();
      const za = this.zoomAnchor, p = this.groundPlane(za.ndcX, za.ndcY);
      if (p) { this.tx += za.x - p.x; this.tz += za.z - p.z; }
      if (Math.abs(this.goalDist - this.dist) < 0.02) this.zoomAnchor = null;
    }
    this.place();
    this.measureFootprint();
    this.clamp();
    this.shake = Math.max(0, this.shake - dt * 2.5);
    this.place(true);
  }

  /** Grab-the-ground: shift the look-at point so the grabbed ground point is back under the cursor. */
  applyGrab() {
    const g = this.grab;
    this.place();
    const n = this.ndc(g.sx, g.sy), p = this.groundPlane(n[0], n[1]);
    if (!p) return;
    const dx = g.x - p.x, dz = g.z - p.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-5) return;
    this.tx += dx; this.tz += dz; this.clamp();
    const now = performance.now();
    g.hist.push([now, this.tx, this.tz]);
    while (g.hist.length > 2 && now - g.hist[0][0] > 250) g.hist.shift();
  }

  /** Map boundaries: keep the visible ground (screen minus HUD) inside the terrain + pad. */
  clamp() {
    const f = this.foot, pad = BOUNDS.pad, S = this.size;
    const fit = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));
    const x = fit(this.tx, -pad - f.x0, S + pad - f.x1), z = fit(this.tz, -pad - f.z0, S + pad - f.z1);
    this.clamped.x = Math.abs(x - this.tx) > 1e-6; this.clamped.z = Math.abs(z - this.tz) > 1e-6;
    // velocity into the wall is dropped (no sticking / bouncing); velocity away from it is kept
    if (this.clamped.x && Math.sign(this.vx) === Math.sign(this.tx - x)) this.vx = 0;
    if (this.clamped.z && Math.sign(this.vz) === Math.sign(this.tz - z)) this.vz = 0;
    this.tx = x; this.tz = z;
  }

  /** Visible ground footprint (offsets from the look-at point) for the current distance and pitch. */
  measureFootprint() {
    const ih = innerHeight || 1;
    const top = 1 - (2 * this.insets.top) / ih, bot = -1 + (2 * this.insets.bottom) / ih;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [nx, ny] of [[-1, top], [1, top], [-1, bot], [1, bot]]) {
      const p = this.groundPlane(nx, ny, 160);
      x0 = Math.min(x0, p.x - this.tx); x1 = Math.max(x1, p.x - this.tx);
      z0 = Math.min(z0, p.z - this.tz); z1 = Math.max(z1, p.z - this.tz);
    }
    Object.assign(this.foot, { x0, x1, z0, z1 });
  }

  /** Position the three.js camera from (tx, ty, tz, dist, pitch); fx = with shake. */
  place(fx = false) {
    let sx = 0, sy = 0;
    if (fx && this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake * 0.3; sy = (Math.random() - 0.5) * this.shake * 0.3;
    }
    const cx = this.tx, cz = this.tz + this.dist * Math.cos(this.pitch);
    let cy = this.ty + this.dist * Math.sin(this.pitch);
    // never inside a hill behind the look-at point
    const under = this.heightAt(Math.max(0, Math.min(this.size - 0.01, cx)), Math.max(0, Math.min(this.size - 0.01, cz)));
    cy = Math.max(cy, under + this.o.groundClear);
    this.cam.position.set(cx + sx, cy + sy, cz);
    this.cam.lookAt(this.tx + sx, this.ty, this.tz);
    this.cam.updateMatrixWorld();
  }

  /** Ray from screen NDC to the horizontal plane y = ty (stable for dragging/zooming; no terrain pops).
   *  With `far`, a ray above the horizon returns the point `far` tiles out instead of null. */
  groundPlane(ndcX, ndcY, far = 0) {
    this.v2.set(ndcX, ndcY); this.ray.setFromCamera(this.v2, this.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    let t = d.y < -1e-4 ? (this.ty - o.y) / d.y : -1;
    if (t < 0 || (far && t > far)) { if (!far) return null; t = far; }
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }

  // Ground point under normalized device coords: exact heightfield hit via the TerrainPicker,
  // falling back to marching (for rays that leave the map, e.g. minimap viewport corners).
  ground(ndcX, ndcY) {
    this.v2.set(ndcX, ndcY); this.ray.setFromCamera(this.v2, this.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (this.picker) { const hit = this.picker.intersect(o, d); if (hit) { this.lastHit = hit; return hit; } }
    if (d.y > -0.01) return null;
    let t = (0.4 - o.y) / d.y;
    for (let k = 0; k < 6; k++) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      const h = this.heightAt(Math.max(0, Math.min(this.size, x)), Math.max(0, Math.min(this.size, z)));
      t = (h - o.y) / d.y;
    }
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  project(x, y, z, w, h) {
    this.v3.set(x, y, z).project(this.cam);
    return [(this.v3.x + 1) / 2 * w, (1 - this.v3.y) / 2 * h, this.v3.z];
  }
  /** Debug / tests. */
  state() {
    return { tx: +this.tx.toFixed(2), tz: +this.tz.toFixed(2), dist: +this.dist.toFixed(2), pitchDeg: +(this.pitch / DEG).toFixed(1), v: [+this.vx.toFixed(2), +this.vz.toFixed(2)], foot: Object.fromEntries(Object.entries(this.foot).map(([k, v]) => [k, +v.toFixed(1)])), clamped: { ...this.clamped } };
  }
}

/** Old name, kept for existing imports. */
export { RTSCameraController as RTSCamera };

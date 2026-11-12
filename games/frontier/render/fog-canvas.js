// Frontier Crown — canvas fog of war.
//
// Three hidden 2D canvases (map tiles × RES pixels):
//   explored  persistent: every sight circle ever drawn stays white (never cleared)
//   visible   redrawn each sim tick: faded toward black, then this tick's sight circles in white
//   out       what the GPU samples:  black → explored × EXPLORED (grey) → lighten(visible) (white)
// so one channel holds all three states: 0 = never explored, ~0.45 = explored but out of sight,
// 1 = in sight. `out` is a CanvasTexture shared by the terrain, every instanced material, water,
// particles and overlays; the shader chunk FOG_GLSL turns the value into black / desaturated
// grey memory / full colour. A 128×128 copy of the same canvas feeds the minimap overlay and its
// read-back (one getImageData per minimap refresh) decides which dots the minimap may show.
//
// Cost: ~2 sprite blits per own unit/building at ≤ 20 Hz, one texture upload per redraw.
// Gameplay visibility (what AI and clicks may target) stays the sim's tile grid (systems/fog.js);
// both use the same sight radii, so what you see matches what you can target.

import { DEF_LIST } from "../data/defs.js";
import { CM } from "../sim/ecs.js";

export const EXPLORED = 0.45;
const FADE = 0.45; // share of the old visibility removed per redraw (a soft trail instead of popping)

// shader side: f = fog sample (0, ~0.45, 1) → final colour
export const FOG_GLSL = /* glsl */ `
vec3 fcFog( vec3 c, float f ) {
  float seen = smoothstep( 0.5, 0.92, f );                              // in sight right now
  float known = smoothstep( 0.02, 0.3, f );                              // explored at least once
  vec3 memory = mix( vec3( dot( c, vec3( 0.299, 0.587, 0.114 ) ) ), c, 0.3 ) * 0.5; // grey, dim
  return mix( memory, c, seen ) * known;                                 // unexplored → black
}`;

export class CanvasFog {
  constructor(THREE, sim, me, { W = 128, H = 128, res = 4 } = {}) {
    this.sim = sim; this.me = me; this.res = res; this._reveal = false; this.dirty = true;
    this.W = W; this.H = H;
    const mk = (w, h, opts) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return [c, c.getContext("2d", opts)]; };
    [this.expC, this.exp] = mk(W * res, H * res);
    [this.visC, this.vis] = mk(W * res, H * res);
    [this.outC, this.out] = mk(W * res, H * res);
    [this.miniC, this.mini] = mk(W, H, { willReadFrequently: true });
    for (const c of [this.exp, this.vis, this.out]) { c.fillStyle = "#000"; c.fillRect(0, 0, W * res, H * res); }
    // a soft white disc, blitted (scaled) for every sight circle — no per-unit gradients
    const [spr, sc] = mk(128, 128), g = sc.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, "#fff"); g.addColorStop(0.82, "#fff"); g.addColorStop(1, "rgba(255,255,255,0)");
    sc.fillStyle = g; sc.fillRect(0, 0, 128, 128);
    this.sprite = spr;
    this.tex = new THREE.CanvasTexture(this.outC);
    this.tex.flipY = false;                       // row 0 = z 0, matching uv = world.xz / mapSize
    this.tex.generateMipmaps = false;
    this.tex.minFilter = THREE.LinearFilter; this.tex.magFilter = THREE.LinearFilter;
    this.tex.colorSpace = THREE.NoColorSpace;     // data, not colour
    this.lastTick = -1; this.pix = null; this.pixT = -1;
    this.redraw();
  }

  /** Sight circles of every own entity, drawn into a canvas context. */
  circles(ctx) {
    const st = this.sim.st, R = this.res, spr = this.sprite;
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e] || st.owner[e] !== this.me || !(st.mask[e] & CM.VISION)) continue;
      const d = DEF_LIST[st.def[e]];
      const r = (st.prog[e] < 1 ? 4 : d.vision + (d.size ? d.size / 2 : 0)) + 0.5;
      ctx.drawImage(spr, (st.x[e] - r) * R, (st.z[e] - r) * R, 2 * r * R, 2 * r * R);
    }
  }

  redraw() {
    const { W, H, res } = this, w = W * res, h = H * res;
    if (this.reveal) { this.out.fillStyle = "#fff"; this.out.fillRect(0, 0, w, h); }
    else {
      this.circles(this.exp);                                       // explored: accumulates forever
      this.vis.globalCompositeOperation = "source-over";
      this.vis.fillStyle = `rgba(0,0,0,${FADE})`; this.vis.fillRect(0, 0, w, h);
      this.circles(this.vis);                                       // visible: this tick
      const o = this.out;
      o.globalCompositeOperation = "source-over"; o.globalAlpha = 1;
      o.fillStyle = "#000"; o.fillRect(0, 0, w, h);
      o.globalAlpha = EXPLORED; o.drawImage(this.expC, 0, 0);       // grey where explored
      o.globalAlpha = 1; o.globalCompositeOperation = "lighten";    // per-pixel max with the visible layer
      o.drawImage(this.visC, 0, 0);
      o.globalCompositeOperation = "source-over";
    }
    this.tex.needsUpdate = true;
    this.pixT = -1; // minimap copy is stale
  }

  /** Called every frame; redraws only when the simulation advanced (≤ 20 Hz). */
  update() {
    const t = this.sim.tick;
    if (t === this.lastTick && !this.dirty) return;
    this.lastTick = t; this.dirty = false;
    this.redraw();
  }
  get reveal() { return this._reveal; }
  set reveal(v) { if (v !== this._reveal) { this._reveal = v; this.dirty = true; } }

  /** Tile-resolution copy of the fog (for the minimap) + its pixels for visibility tests. */
  miniCanvas() {
    if (this.pixT !== this.lastTick) {
      this.mini.globalCompositeOperation = "copy";
      this.mini.drawImage(this.outC, 0, 0, this.W, this.H);
      this.pix = this.mini.getImageData(0, 0, this.W, this.H).data;
      this.pixT = this.lastTick;
    }
    return this.miniC;
  }
  /** 0..255 fog value at a world point, from the minimap read-back (call miniCanvas() first). */
  at(x, z) {
    if (this.reveal) return 255;
    const i = Math.floor(x), j = Math.floor(z);
    if (!this.pix || i < 0 || j < 0 || i >= this.W || j >= this.H) return 0;
    return this.pix[(j * this.W + i) * 4];
  }
  dispose() { this.tex.dispose(); }
}

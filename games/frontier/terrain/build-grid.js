// Frontier Crown — visual build grid. A 128×128 class texture (one texel per tile) tells the terrain
// shader which tiles are buildable (green), blocked by terrain — cliff, steep slope, water (red),
// occupied by a building/resource (amber) or unexplored (dark). The shader drapes the grid on the
// heightmap, so there is no extra geometry and it follows every hill and cliff exactly.
//
//   const grid = new BuildGrid(THREE, simGrid, me);
//   grid.update(fogVersion);                 // refresh classes when the map or fog changed
//   grid.show(uniforms, { x, z, foot:[x0,z0,x1,z1], ok });   grid.hide(uniforms);

import { W, H, BC } from "../sim/map.js";

export class BuildGrid {
  constructor(THREE, grid, me = 0) {
    this.grid = grid; this.me = me;
    this.data = new Uint8Array(W * H);
    this.tex = new THREE.DataTexture(this.data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter; this.tex.minFilter = THREE.NearestFilter;
    this.tex.needsUpdate = true;
    this.stamp = "";
    this.reveal = false;
    this.alpha = 0;
  }
  // Class of tile k for this player (fog-aware).
  classOf(k) {
    if (!this.reveal && !this.grid.exp[this.me][k]) return BC.UNEXPLORED;
    return this.grid.tileClass(k);
  }
  update(fogVersion = 0) {
    const s = `${this.grid.version}:${fogVersion}:${this.reveal}`;
    if (s === this.stamp) return;
    this.stamp = s;
    for (let k = 0; k < W * H; k++) this.data[k] = this.classOf(k) * 80;
    this.tex.needsUpdate = true;
  }
  // Ease the overlay in/out; place the cursor and the footprint highlight.
  apply(uniforms, dt, state) {
    const target = state ? 1 : 0;
    this.alpha += (target - this.alpha) * Math.min(1, dt * 12);
    if (Math.abs(this.alpha - target) < 0.01) this.alpha = target;
    uniforms.uGrid.value = this.alpha;
    if (!state) return;
    uniforms.uCursor.value.set(state.x, state.z);
    uniforms.uRadius.value = state.radius || 9;
    if (state.foot) { const f = state.foot; uniforms.uFoot.value.set(f[0], f[1], f[2], f[3]); uniforms.uFootOk.value = state.ok ? 1 : 0; }
    else uniforms.uFoot.value.set(-1, -1, -1, -1);
  }
}

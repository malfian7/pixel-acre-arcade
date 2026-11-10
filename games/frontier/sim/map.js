// Frontier Crown — map data: typed-array grid layers + spatial hash for moving units.

import { MAX } from "./ecs.js";

export const W = 128, H = 128;
export const WATER_Y = -0.35;
export const BL = { WATER: 1, BLD: 2, RES: 4, CLIFF: 8 };
export const T = { GRASS: 0, MEADOW: 1, DIRT: 2, SAND: 3, SHALLOW: 4, DEEP: 5, FOREST: 6, ROCK: 7 };
// Slope = height difference across one tile (max - min of its 4 corners), in world units.
export const SLOPE_BUILD = 0.5;   // steeper than this: walkable but not buildable
export const SLOPE_CLIFF = 1.05;  // steeper than this: impassable cliff
// Buildability classes (used by the placement grid overlay)
export const BC = { OK: 0, TERRAIN: 1, OCCUPIED: 2, UNEXPLORED: 3 };

export class Grid {
  constructor() {
    this.W = W; this.H = H;
    this.hv = new Float32Array((W + 1) * (H + 1));  // vertex heights (also terrain mesh)
    this.terrain = new Uint8Array(W * H);
    this.block = new Uint8Array(W * H);
    this.occ = new Int32Array(W * H).fill(-1);
    this.slope = new Float32Array(W * H);
    this.version = 0;
    // fog per player: vis = currently seen, exp = ever explored
    this.vis = [new Uint8Array(W * H), new Uint8Array(W * H)];
    this.exp = [new Uint8Array(W * H), new Uint8Array(W * H)];
  }
  idx(i, j) { return j * W + i; }
  inb(i, j) { return i >= 0 && j >= 0 && i < W && j < H; }
  passable(i, j) { return i >= 0 && j >= 0 && i < W && j < H && this.block[j * W + i] === 0; }
  passableAt(x, z) { return this.passable(Math.floor(x), Math.floor(z)); }
  // Height on the rendered surface: same two triangles per tile as THREE.PlaneGeometry
  // (diagonal from (i, j+1) to (i+1, j)), so units, picking and the mesh agree exactly.
  heightAt(x, z) {
    x = Math.min(W - 0.0001, Math.max(0, x)); z = Math.min(H - 0.0001, Math.max(0, z));
    const i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j, s = W + 1;
    const h00 = this.hv[j * s + i], h10 = this.hv[j * s + i + 1], h01 = this.hv[(j + 1) * s + i], h11 = this.hv[(j + 1) * s + i + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  // Max-min of a tile's four corner heights.
  computeSlopes() {
    const s = W + 1;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const a = this.hv[j * s + i], b = this.hv[j * s + i + 1], c = this.hv[(j + 1) * s + i], d = this.hv[(j + 1) * s + i + 1];
      this.slope[j * W + i] = Math.max(a, b, c, d) - Math.min(a, b, c, d);
    }
  }
  isWaterTile(k) { const t = this.terrain[k]; return t === T.SHALLOW || t === T.DEEP; }
  // Buildability of a single tile for the placement grid (ignores fog).
  tileClass(k) {
    if (this.block[k] & (BL.BLD | BL.RES)) return BC.OCCUPIED;
    if (this.block[k] || this.isWaterTile(k) || this.slope[k] > SLOPE_BUILD) return BC.TERRAIN;
    return BC.OK;
  }
  // Mark a footprint (tile rect) with a block bit and an occupant id (-1 clears).
  stamp(x0, z0, size, bit, id) {
    for (let j = z0; j < z0 + size; j++) for (let i = x0; i < x0 + size; i++) {
      if (!this.inb(i, j)) continue;
      const k = j * W + i;
      if (id >= 0) { this.block[k] |= bit; this.occ[k] = id; } else { this.block[k] &= ~bit; this.occ[k] = -1; }
    }
    this.version++;
  }
  // Can a building of `size` stand with its origin tile at (x0,z0)?
  canPlace(x0, z0, size) {
    if (x0 < 1 || z0 < 1 || x0 + size > W - 1 || z0 + size > H - 1) return false;
    const s = W + 1; let lo = Infinity, hi = -Infinity;
    for (let j = z0; j < z0 + size; j++) for (let i = x0; i < x0 + size; i++) {
      const k = j * W + i;
      if (this.block[k] || this.isWaterTile(k) || this.slope[k] > SLOPE_BUILD) return false;
    }
    for (let j = z0; j <= z0 + size; j++) for (let i = x0; i <= x0 + size; i++) { const h = this.hv[j * s + i]; if (h < lo) lo = h; if (h > hi) hi = h; }
    return hi - lo <= 0.9; // the whole footprint must be reasonably level
  }
  // Nearest passable tile centre to (x,z), searching outward rings up to r tiles.
  nearestFree(x, z, r = 8) {
    const ci = Math.floor(x), cj = Math.floor(z);
    if (this.passable(ci, cj)) return [x, z];
    for (let d = 1; d <= r; d++) {
      let best = null, bd = 1e9;
      for (let j = cj - d; j <= cj + d; j++) for (let i = ci - d; i <= ci + d; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== d || !this.passable(i, j)) continue;
        const dd = (i + 0.5 - x) ** 2 + (j + 0.5 - z) ** 2;
        if (dd < bd) { bd = dd; best = [i + 0.5, j + 0.5]; }
      }
      if (best) return best;
    }
    return null;
  }
}

// Uniform-grid spatial hash rebuilt every tick for moving units (head/next linked lists, no allocation).
export class SpatialHash {
  constructor(cell = 4) {
    this.cell = cell; this.cw = Math.ceil(W / cell); this.ch = Math.ceil(H / cell);
    this.head = new Int32Array(this.cw * this.ch).fill(-1);
    this.next = new Int32Array(MAX).fill(-1);
  }
  clear() { this.head.fill(-1); }
  insert(e, x, z) {
    const ci = Math.min(this.cw - 1, Math.max(0, Math.floor(x / this.cell)));
    const cj = Math.min(this.ch - 1, Math.max(0, Math.floor(z / this.cell)));
    const c = cj * this.cw + ci;
    this.next[e] = this.head[c]; this.head[c] = e;
  }
  // Calls fn(e) for every entity in cells overlapping the circle; fn returning true stops.
  each(x, z, r, fn) {
    const c = this.cell;
    const i0 = Math.max(0, Math.floor((x - r) / c)), i1 = Math.min(this.cw - 1, Math.floor((x + r) / c));
    const j0 = Math.max(0, Math.floor((z - r) / c)), j1 = Math.min(this.ch - 1, Math.floor((z + r) / c));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      for (let e = this.head[j * this.cw + i]; e !== -1; e = this.next[e]) if (fn(e)) return;
    }
  }
}

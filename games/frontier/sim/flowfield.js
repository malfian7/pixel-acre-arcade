// Frontier Crown — flow fields for group moves. One Dijkstra from the destination serves every unit
// in the group (instead of one A* each): every tile stores its travel cost to the goal and the
// neighbour that leads downhill. Costs include terrain slope and shallow water, like the A* finder.
//
//   const ff = sim.flowField({ x0, z0, x1, z1 });   // cached per goal + map version
//   const [wx, wz] = ff.lookahead(grid, x, z);       // farthest visible point down the field

import { W, H, T } from "./map.js";
import { lineFree, stepCost } from "./path.js";

const N = W * H;
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const LEN = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

export class FlowField {
  constructor(grid, rect) {
    this.rect = rect; this.version = grid.version;
    this.dist = new Float32Array(N).fill(Infinity);
    this.next = new Int32Array(N).fill(-1);
    this.compute(grid);
  }
  compute(grid) {
    const dist = this.dist, blk = grid.block, r = this.rect;
    // binary heap of tile indices keyed by dist
    // binary heap of (key, tile) pairs; keys are frozen at push time (lazy deletion)
    const heap = new Int32Array(N * 8), key = new Float32Array(N * 8); let hn = 0;
    const push = (k, v) => { let i = hn++; while (i > 0) { const p = (i - 1) >> 1; if (key[p] <= v) break; heap[i] = heap[p]; key[i] = key[p]; i = p; } heap[i] = k; key[i] = v; };
    const pop = () => { const top = heap[0], lk = heap[--hn], lv = key[hn]; let i = 0; while (true) { let c = i * 2 + 1; if (c >= hn) break; if (c + 1 < hn && key[c + 1] < key[c]) c++; if (key[c] >= lv) break; heap[i] = heap[c]; key[i] = key[c]; i = c; } heap[i] = lk; key[i] = lv; return top; };
    for (let j = r.z0; j <= r.z1; j++) for (let i = r.x0; i <= r.x1; i++) {
      if (i < 0 || j < 0 || i >= W || j >= H) continue;
      const k = j * W + i; if (blk[k]) continue;
      dist[k] = 0; push(k, 0);
    }
    const done = new Uint8Array(N);
    let n = 0;
    while (hn > 0) {
      const k = pop(); if (done[k]) continue; done[k] = 1; n++;
      const i = k % W, j = (k / W) | 0;
      for (let d = 0; d < 8; d++) {
        const ni = i + DX[d], nj = j + DZ[d];
        if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
        const nk = nj * W + ni; if (blk[nk] || done[nk]) continue;
        if (d >= 4 && (blk[j * W + ni] || blk[nj * W + i])) continue;
        const nd = dist[k] + LEN[d] * stepCost(grid, k);
        if (nd < dist[nk]) { dist[nk] = nd; this.next[nk] = k; push(nk, nd); }
      }
    }
    this.expanded = n;
  }
  reachable(x, z) { const i = Math.floor(x), j = Math.floor(z); return i >= 0 && j >= 0 && i < W && j < H && this.dist[j * W + i] < Infinity; }
  costAt(x, z) { const i = Math.floor(x), j = Math.floor(z); return (i < 0 || j < 0 || i >= W || j >= H) ? Infinity : this.dist[j * W + i]; }
  // Follow `next` links from the unit's tile and return the farthest tile centre still in straight line of sight.
  lookahead(grid, x, z, steps = 6) {
    let k = Math.floor(z) * W + Math.floor(x);
    let best = null;
    for (let s = 0; s < steps; s++) {
      const n = this.next[k]; if (n < 0) break;
      const cx = (n % W) + 0.5, cz = ((n / W) | 0) + 0.5;
      if (s > 0 && !lineFree(grid, x, z, cx, cz)) break;
      best = [cx, cz]; k = n;
      if (this.dist[n] === 0) break;
    }
    return best;
  }
}

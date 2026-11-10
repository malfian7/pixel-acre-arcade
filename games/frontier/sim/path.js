// Frontier Crown — grid A* (octile, binary heap on typed arrays, stamp-based reset)
// with goal *rectangles* (reach a building's edge) and line-of-sight smoothing.

import { W, H } from "./map.js";

const N = W * H;
const g = new Float32Array(N), f = new Float32Array(N);
const from = new Int32Array(N);
const seen = new Uint32Array(N), closed = new Uint32Array(N);
let stamp = 0;
const heap = new Int32Array(N + 1); let hn = 0;

function push(k) {
  let i = ++hn; heap[i] = k;
  while (i > 1) { const p = i >> 1; if (f[heap[p]] <= f[k]) break; heap[i] = heap[p]; i = p; }
  heap[i] = k;
}
function pop() {
  const top = heap[1], last = heap[hn--];
  let i = 1;
  while (true) {
    let c = i << 1; if (c > hn) break;
    if (c + 1 <= hn && f[heap[c + 1]] < f[heap[c]]) c++;
    if (f[heap[c]] >= f[last]) break;
    heap[i] = heap[c]; i = c;
  }
  heap[i] = last;
  return top;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1], DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

// Distance from tile centre (i,j) to tile rect [x0..x1]x[z0..z1] (inclusive tile coords).
function rectDist(i, j, r) {
  const dx = i < r.x0 ? r.x0 - i : i > r.x1 ? i - r.x1 : 0;
  const dz = j < r.z0 ? r.z0 - j : j > r.z1 ? j - r.z1 : 0;
  return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
}

export let pathStats = { searches: 0, expanded: 0 };

/**
 * grid: Grid; (sx,sz) world start; goal = tile rect {x0,z0,x1,z1}; reach in tiles (0 = stand on it).
 * Returns flat array of world waypoints [x0,z0,x1,z1,...] (excluding start), possibly partial.
 */
export function findPath(grid, sx, sz, goal, reach = 0, limit = 9000) {
  stamp++; hn = 0; pathStats.searches++;
  const blk = grid.block;
  const si = Math.max(0, Math.min(W - 1, Math.floor(sx))), sj = Math.max(0, Math.min(H - 1, Math.floor(sz)));
  const s = sj * W + si;
  g[s] = 0; f[s] = rectDist(si, sj, goal); from[s] = -1; seen[s] = stamp; push(s);
  let best = s, bestH = f[s], found = -1, n = 0;
  const reachE = reach + 0.01;
  while (hn > 0) {
    const k = pop();
    if (closed[k] === stamp) continue;
    closed[k] = stamp;
    const i = k % W, j = (k / W) | 0;
    const h = rectDist(i, j, goal);
    if (h <= reachE && (blk[k] === 0 || k === s)) { found = k; break; }
    if (h < bestH) { bestH = h; best = k; }
    if (++n > limit) break;
    for (let d = 0; d < 8; d++) {
      const ni = i + DX[d], nj = j + DZ[d];
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nk = nj * W + ni;
      if (blk[nk]) continue;
      if (d >= 4 && (blk[j * W + ni] || blk[nj * W + i])) continue; // no corner cutting
      if (closed[nk] === stamp) continue;
      const ng = g[k] + COST[d];
      if (seen[nk] === stamp && ng >= g[nk]) continue;
      seen[nk] = stamp; g[nk] = ng; from[nk] = k;
      f[nk] = ng + rectDist(ni, nj, goal) * 1.001;
      push(nk);
    }
  }
  pathStats.expanded += n;
  const end = found >= 0 ? found : best;
  // Walk back
  const tiles = [];
  for (let k = end; k !== -1 && k !== s; k = from[k]) tiles.push(k);
  tiles.reverse();
  const pts = [];
  for (const k of tiles) pts.push((k % W) + 0.5, ((k / W) | 0) + 0.5);
  return { pts: smooth(grid, sx, sz, pts), complete: found >= 0 };
}

// Supercover line walk: true if every tile touched by the segment is passable.
export function lineFree(grid, x0, z0, x1, z1) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  const steps = Math.ceil(len / 0.3);
  for (let t = 1; t <= steps; t++) {
    const x = x0 + dx * t / steps, z = z0 + dz * t / steps;
    // test a small cross so units don't clip building corners
    if (!grid.passableAt(x, z) || !grid.passableAt(x + 0.28, z) || !grid.passableAt(x - 0.28, z) || !grid.passableAt(x, z + 0.28) || !grid.passableAt(x, z - 0.28)) return false;
  }
  return true;
}

function smooth(grid, sx, sz, pts) {
  if (pts.length <= 2) return pts;
  const out = [];
  let ax = sx, az = sz, i = 0;
  const n = pts.length / 2;
  while (i < n) {
    let far = i;
    for (let k = Math.min(n - 1, i + 24); k > i; k--) {
      if (lineFree(grid, ax, az, pts[k * 2], pts[k * 2 + 1])) { far = k; break; }
    }
    out.push(pts[far * 2], pts[far * 2 + 1]);
    ax = pts[far * 2]; az = pts[far * 2 + 1]; i = far + 1;
  }
  return out;
}

// Frontier Crown — point-symmetric skirmish maps.
//   "fords"    Twin Fords: procedural heights; a meandering river with three fords splits the map.
//   "highland" Highland Pass: relief loaded from a grayscale heightmap image; a rocky ridge with three passes.
// Both get mirrored rocky mesas (cliffs + a ramp), slope-derived cliffs, and the same resource layout rules.

import { makeRng } from "../core/core.js";
import { Grid, W, H, T, BL, WATER_Y, SLOPE_CLIFF, SLOPE_BUILD } from "./map.js";

export const MAPS = {
  fords: { name: "Twin Fords", desc: "A river splits the land; three shallow fords are the only crossings." },
  highland: { name: "Highland Pass", desc: "A rocky ridge splits the highlands; three narrow passes cut through it. Relief from a heightmap image.", image: "maps/highland-pass.png", min: -1.6, max: 3.6 },
};

const SQ2 = Math.SQRT2;
export const BASES = [[22.5, 105.5], [105.5, 22.5]];

function valueNoise(rng, cells) {
  const n = cells + 1, g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rng();
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, z) => { // x,z in 0..1
    const fx = x * cells, fz = z * cells, i = Math.min(cells - 1, Math.floor(fx)), j = Math.min(cells - 1, Math.floor(fz));
    const u = sm(fx - i), v = sm(fz - j);
    const a = g[j * n + i], b = g[j * n + i + 1], c = g[(j + 1) * n + i], d = g[(j + 1) * n + i + 1];
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
}

export function riverOffset(s) { const t = s - 64; return 7 * Math.sin(t * 0.07) + 2.6 * Math.sin(t * 0.17); }
export const FORDS = [34, 64, 94];
export function fordPoint(s) { const o = riverOffset(s); return [s + o / SQ2, s - o / SQ2]; }
// Signed distance across the river (negative = player side) and along-river coordinate.
function riverCoords(x, z) { const s = (x + z) / 2, u = (x - z) / SQ2; return { s, d: u - riverOffset(s) }; }

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, L = dx * dx + dz * dz;
  let t = L ? ((px - ax) * dx + (pz - az) * dz) / L : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - ax - dx * t, pz - az - dz * t);
}

const smooth = (e0, e1, v) => { const t = Math.max(0, Math.min(1, (v - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Rocky mesa: flat top `rise` above the ground, cliff walls, and one walkable ramp toward `toward`.
function mesaRaise(i, j, m) {
  const dx = i - m.x, dz = j - m.z, d = Math.hypot(dx, dz);
  let r = 0;
  if (d < m.r) r = 1; else if (d < m.r + 1.1) r = 1 - (d - m.r) / 1.1;
  // ramp wedge
  let da = Math.atan2(dz, dx) - m.ramp; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
  const wedge = smooth(0.42, 0.28, Math.abs(da));
  if (wedge > 0 && d > m.r - 1.5) r = Math.max(r * (1 - wedge), Math.max(r * wedge, Math.max(0, Math.min(1, 1 - (d - m.r + 1.5) / 8)) * wedge));
  return r * m.rise;
}

export function generateMap(seed, { map = "fords", heights = null } = {}) {
  const rng = makeRng(seed);
  const grid = new Grid();
  const nA = valueNoise(rng, 8), nB = valueNoise(rng, 20), nF = valueNoise(rng, 14), nM = valueNoise(rng, 10);
  const sym = (f, x, z) => 0.5 * (f(x / W, z / H) + f(1 - x / W, 1 - z / H));
  const highland = map === "highland";
  if (highland && (!heights || heights.length !== (W + 1) * (H + 1))) throw new Error("Highland Pass needs a 129×129 heightmap");

  // ---- mesas: candidates on the player half, mirrored, kept off the routes to the crossings
  const [bx0, bz0] = BASES[0];
  const crossings = FORDS.map((f) => highland ? [f - 6, f + 6] : (() => { const [fx, fz] = fordPoint(f); const o = 5 / SQ2; return [fx - o, fz + o]; })());
  const mesas = [];
  const cands = [[36, 72], [50, 94], [28, 60], [60, 108], [42, 84], [14, 84], [70, 116]];
  for (let k = 0; k < cands.length && mesas.length < 2; k++) {
    const [cx, cz] = cands[(k + Math.floor(rng() * cands.length)) % cands.length];
    if (mesas.some((m) => Math.hypot(m.x - cx, m.z - cz) < 16)) continue;
    const r = 4.2 + rng() * 1.6;
    let ok = Math.hypot(cx - bx0, cz - bz0) > 20 && Math.abs((cx - cz) / SQ2) > r + 10;
    for (const [fx, fz] of crossings) if (segDist(cx, cz, bx0, bz0, fx, fz) < r + 5) ok = false;
    if (segDist(cx, cz, crossings[0][0], crossings[0][1], crossings[2][0], crossings[2][1]) < r + 4) ok = false;
    if (!ok) continue;
    const m = { x: cx, z: cz, r, rise: 1.9 + rng() * 0.6, ramp: Math.atan2(bz0 - cz, bx0 - cx) + (rng() - 0.5) * 0.8 };
    mesas.push(m, { x: W - cx, z: H - cz, r, rise: m.rise, ramp: m.ramp + Math.PI });
  }

  // ---- heights (vertices)
  const S = W + 1;
  for (let j = 0; j <= H; j++) for (let i = 0; i <= W; i++) {
    let h;
    if (highland) h = heights[j * S + i];
    else {
      const { s, d } = riverCoords(i, j);
      h = 0.25 + sym(nA, i, j) * 1.6 + (sym(nB, i, j) - 0.5) * 0.5;
      const ford = FORDS.some((f) => Math.abs(s - f) < 4.2);
      const ad = Math.abs(d);
      const bed = ford ? -0.62 : -1.25;
      if (ad < 3.4) h = bed;
      else if (ad < 7) { const k = (ad - 3.4) / 3.6, e = k * k * (3 - 2 * k); h = bed + (h - bed) * e; }
    }
    for (const m of mesas) h += mesaRaise(i, j, m);
    // flatten bases
    for (const [bx, bz] of BASES) { const bd = Math.hypot(i - bx, j - bz); if (bd < 14) { const k = Math.max(0, (bd - 8) / 6); h = 0.55 + (h - 0.55) * k; } }
    grid.hv[j * S + i] = h;
  }
  grid.computeSlopes();

  // ---- terrain types + blocking (tiles)
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const x = i + 0.5, z = j + 0.5, k = j * W + i;
    let t = sym(nM, x, z) > 0.56 ? T.MEADOW : T.GRASS;
    if (highland) {
      const hc = (grid.hv[j * S + i] + grid.hv[j * S + i + 1] + grid.hv[(j + 1) * S + i] + grid.hv[(j + 1) * S + i + 1]) / 4;
      if (hc < WATER_Y - 0.3) t = T.DEEP; else if (hc < WATER_Y + 0.02) t = T.SHALLOW; else if (hc < WATER_Y + 0.45) t = T.SAND;
      if (hc > 2.3 && !mesas.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 9)) t = T.ROCK; // the ridge top is unreachable rock
    } else {
      const { s, d } = riverCoords(x, z), ad = Math.abs(d);
      const ford = FORDS.some((f) => Math.abs(s - f) < 3.6);
      if (ad < 2.7) t = ford ? T.SHALLOW : T.DEEP;
      else if (ad < 3.5) t = T.SHALLOW;
      else if (ad < 4.8) t = T.SAND;
    }
    for (const [bx, bz] of BASES) if (Math.hypot(x - bx, z - bz) < 7.5 + sym(nB, x, z) * 2) t = T.DIRT;
    if (grid.slope[k] > SLOPE_CLIFF && t !== T.DEEP) t = T.ROCK;
    grid.terrain[k] = t;
    if (t === T.DEEP) grid.block[k] = BL.WATER;
    if (t === T.ROCK) grid.block[k] = BL.CLIFF;
  }

  // ---- placements (player-0 half, mirrored to player 1)
  const place = []; // {def, owner, i, j} footprint origin tile, or {def, owner, x, z} for units
  const taken = new Uint8Array(W * H);
  const free = (i, j, size, pad = 0) => {
    for (let b = j - pad; b < j + size + pad; b++) for (let a = i - pad; a < i + size + pad; a++) {
      if (a < 1 || b < 1 || a >= W - 1 || b >= H - 1) return false;
      const k = b * W + a; if (taken[k] || grid.block[k] || grid.terrain[k] === T.SHALLOW || grid.slope[k] > SLOPE_BUILD) return false;
    }
    return true;
  };
  const take = (i, j, size) => { for (let b = j; b < j + size; b++) for (let a = i; a < i + size; a++) taken[b * W + a] = 1; };
  const mirrorTile = (i, j, size) => [W - i - size, H - j - size];
  const putBoth = (def, i, j, size, owners = [2, 2]) => {
    const [mi, mj] = mirrorTile(i, j, size);
    if (!free(i, j, size) || !free(mi, mj, size)) return false;
    take(i, j, size); take(mi, mj, size);
    place.push({ def, owner: owners[0], i, j }, { def, owner: owners[1], i: mi, j: mj });
    return true;
  };
  const keepClear = []; // trees stay off the approach to mines and bushes
  const near = (def, cx, cz, size, rmin, rmax, tries = 60, pad = 1) => {
    for (let t = 0; t < tries; t++) {
      const a = rng() * Math.PI * 2, r = rmin + rng() * (rmax - rmin);
      const i = Math.round(cx + Math.cos(a) * r - size / 2), j = Math.round(cz + Math.sin(a) * r - size / 2);
      if (free(i, j, size, pad) && free(...mirrorTile(i, j, size), size, pad) && putBoth(def, i, j, size)) { keepClear.push([i + size / 2, j + size / 2, size / 2 + 2.2]); return [i + size / 2, j + size / 2]; }
    }
    return null;
  };

  const [bx, bz] = BASES[0];
  // Town centers
  putBoth("towncenter", 20, 103, 5, [0, 1]);
  // keep a clear ring around the TC
  for (let j = 96; j < 115; j++) for (let i = 13; i < 32; i++) if (Math.hypot(i + 0.5 - bx, j + 0.5 - bz) < 6) { taken[j * W + i] = 1; const [mi, mj] = mirrorTile(i, j, 1); taken[mj * W + mi] = 1; }
  // Berries: a cluster toward the map centre
  { const a = rng() * 0.8 - 0.4 - Math.PI / 4, cx = bx + Math.cos(a) * 10, cz = bz + Math.sin(a) * 10;
    for (let k = 0; k < 7; k++) near("berries", cx, cz, 1, 0, 2.6, 30, 0); }
  // Home gold mine + a second mine further out
  near("goldmine", bx - 3, bz - 13, 3, 0, 3, 80);
  near("goldmine", bx + 22, bz + 6, 3, 0, 5, 80);
  // Mid-map mines (two per side)
  near("goldmine", 44, 70, 3, 0, 6, 80);
  near("goldmine", 18, 52, 3, 0, 6, 80);
  // Hunts (deer herds) — units owned by gaia
  const herd = (cx, cz, n) => {
    for (let k = 0; k < n; k++) {
      const x = cx + (rng() - 0.5) * 5, z = cz + (rng() - 0.5) * 5;
      const i = Math.floor(x), j = Math.floor(z);
      if (!free(i, j, 1)) continue;
      place.push({ def: "deer", owner: 2, x, z, rot: rng() * 6.28 }, { def: "deer", owner: 2, x: W - x, z: H - z, rot: rng() * 6.28 });
    }
  };
  herd(bx + 13, bz - 14, 6); herd(40, 92, 6); herd(16, 72, 5); herd(52, 108, 5);

  // Trees: forest blobs + a ragged border, keeping corridors to the fords open.
  const fordsP = crossings; // player-side approach to each crossing
  let trees = 0;
  for (let j = 1; j < H - 1; j++) for (let i = 1; i < W - 1; i++) {
    const x = i + 0.5, z = j + 0.5;
    if (x - z >= -0.5) continue; // player half only (diagonal belongs to the river)
    const k = j * W + i; if (taken[k]) continue;
    const t = grid.terrain[k]; if (t === T.DEEP || t === T.SHALLOW || t === T.SAND || t === T.ROCK || grid.slope[k] > SLOPE_BUILD) continue;
    if (Math.abs(highland ? (x - z) / SQ2 : riverCoords(x, z).d) < (highland ? 9 : 6.5)) continue;
    if (mesas.some((m) => Math.hypot(x - m.x, z - m.z) < m.r + 2.5)) continue;
    if (Math.hypot(x - bx, z - bz) < 12.5) continue;
    let corridor = false;
    for (const [fx, fz] of fordsP) if (segDist(x, z, bx, bz, fx, fz) < 4.5) corridor = true;
    if (segDist(x, z, fordsP[0][0], fordsP[0][1], fordsP[2][0], fordsP[2][1]) < 3.5) corridor = true;
    if (corridor) continue;
    if (keepClear.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r)) continue;
    const edge = Math.min(i, j, W - 1 - i, H - 1 - j);
    const n = sym(nF, x, z);
    let p = 0;
    if (n > 0.6) p = 0.9; else if (n > 0.55) p = 0.45;
    if (edge < 5 && n > 0.36) p = Math.max(p, 0.85 - edge * 0.1);
    if (p === 0 && rng() < 0.01) p = 1;
    if (rng() < p && trees < 1500) {
      trees++;
      const [mi, mj] = mirrorTile(i, j, 1);
      if (taken[mj * W + mi]) continue;
      taken[k] = 1; taken[mj * W + mi] = 1;
      place.push({ def: "tree", owner: 2, i, j }, { def: "tree", owner: 2, i: mi, j: mj });
      grid.terrain[k] = T.FOREST; grid.terrain[mj * W + mi] = T.FOREST;
    }
  }
  // Starting villagers
  for (let p = 0; p < 2; p++) {
    const [cx, cz] = BASES[p], dir = p === 0 ? 1 : -1;
    for (let k = 0; k < 5; k++) place.push({ def: "villager", owner: p, x: cx + dir * (3.6 + (k % 3) * 0.9), z: cz - dir * (3.4 + Math.floor(k / 3) * 1.0), rot: p === 0 ? 2.4 : -0.7 });
  }
  ensureConnected(grid, place, taken);
  return { grid, place, seed, map, mesas };
}

// Safety net: both Town Centers must be reachable by land. If trees seal a route, clear a lane.
function ensureConnected(grid, place, taken) {
  const pass = (k) => !grid.block[k] && !taken[k];
  const start = Math.floor(BASES[0][1] - 4) * W + Math.floor(BASES[0][0] + 4);
  const goal = Math.floor(BASES[1][1] + 4) * W + Math.floor(BASES[1][0] - 4);
  const reach = () => {
    const seen = new Uint8Array(W * H), q = [start]; seen[start] = 1;
    while (q.length) { const k = q.pop(); if (k === goal) return true; const i = k % W, j = (k / W) | 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= W || b >= H) continue; const n = b * W + a; if (!seen[n] && pass(n)) { seen[n] = 1; q.push(n); } } }
    return false;
  };
  if (reach()) return;
  // clear trees on a straight lane between the bases (keeps symmetry: the lane is symmetric)
  const drop = new Set();
  for (let t = 0; t <= 1; t += 0.002) {
    const x = BASES[0][0] + (BASES[1][0] - BASES[0][0]) * t, z = BASES[0][1] + (BASES[1][1] - BASES[0][1]) * t;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) drop.add(Math.floor(z + dz) * W + Math.floor(x + dx));
  }
  for (let n = place.length - 1; n >= 0; n--) { const p = place[n]; if (p.def === "tree" && drop.has(p.j * W + p.i)) { taken[p.j * W + p.i] = 0; place.splice(n, 1); } }
}

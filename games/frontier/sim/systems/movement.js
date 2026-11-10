// PathSystem + MovementSystem — budgeted A*, waypoint following, separation steering, tile collision.

import { TICK } from "../../core/core.js";
import { DEF_LIST, C } from "../../data/defs.js";
import { CM } from "../ecs.js";
import { T, W } from "../map.js";

import { pathStats } from "../path.js";
const PATHS_PER_TICK = 16, NODES_PER_TICK = 40000;

export function pathSystem(sim) {
  const st = sim.st, q = sim.pathQueue;
  let n = 0; const start = pathStats.expanded;
  while (q.length && n < PATHS_PER_TICK && pathStats.expanded - start < NODES_PER_TICK) {
    const e = q.shift();
    if (!st.alive[e]) continue;
    const p = st.path.get(e);
    if (!p || !p.pending) continue;
    sim.computePath(e); n++;
  }
}

function turn(a, b, max) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + Math.max(-max, Math.min(max, d));
}

export function movementSystem(sim) {
  const st = sim.st, grid = sim.grid, hash = sim.hash;
  hash.clear();
  for (let e = 0; e < st.top; e++) if (st.alive[e] && (st.mask[e] & CM.MOVER)) hash.insert(e, st.x[e], st.z[e]);

  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || !(st.mask[e] & CM.MOVER)) continue;
    const d = DEF_LIST[st.def[e]];
    if (d.cls === C.ANIMAL) {
      if (st.dead[e]) {
        st.vx[e] = st.vz[e] = 0;
        if (!grid.passableAt(st.x[e], st.z[e])) { const f = grid.nearestFree(st.x[e], st.z[e], 6); if (f) { st.x[e] = f[0]; st.z[e] = f[1]; } }
        continue;
      }
      wander(sim, e);
    }
    const x = st.x[e], z = st.z[e], r = d.radius;
    let dvx = 0, dvz = 0, spd = 0;
    const p = st.path.get(e);
    if (p && !p.pending && !p.done && p.i < p.pts.length) {
      const wx = p.pts[p.i], wz = p.pts[p.i + 1];
      const dx = wx - x, dz = wz - z, dist = Math.hypot(dx, dz);
      const last = p.i + 2 >= p.pts.length;
      if (dist < (last ? 0.12 : 0.4)) {
        p.i += 2;
        if (p.i >= p.pts.length) { p.done = true; st.moving[e] = 0; }
      } else {
        const tk = grid.terrain[Math.floor(z) * W + Math.floor(x)];
        spd = d.speed * (tk === T.SHALLOW ? 0.7 : 1);
        const step = Math.min(spd, dist / TICK);
        dvx = dx / dist * step; dvz = dz / dist * step;
      }
    }
    // separation from neighbours
    let pxs = 0, pzs = 0;
    const mv = st.moving[e];
    hash.each(x, z, 1.4, (o) => {
      if (o === e || st.dead[o]) return;
      const od = DEF_LIST[st.def[o]], rr = r + od.radius;
      const ox = x - st.x[o], oz = z - st.z[o], dd = ox * ox + oz * oz;
      if (dd >= rr * rr) return;
      const dist = Math.sqrt(dd) || 0.001, ov = rr - dist;
      const w = mv ? (st.moving[o] ? 0.5 : 0.2) : (st.moving[o] ? 0.8 : 0.5);
      const nx = dd > 1e-6 ? ox / dist : ((e * 7) % 10) / 10 - 0.5, nz = dd > 1e-6 ? oz / dist : ((e * 3) % 10) / 10 - 0.5;
      pxs += nx * ov * w; pzs += nz * ov * w;
    });
    const pl = Math.hypot(pxs, pzs), cap = 0.12;
    if (pl > cap) { pxs *= cap / pl; pzs *= cap / pl; }
    let nx = x + dvx * TICK + pxs, nz = z + dvz * TICK + pzs;
    // tile collision with sliding
    if (!grid.passableAt(nx, nz)) {
      if (grid.passableAt(nx, z)) nz = z;
      else if (grid.passableAt(x, nz)) nx = x;
      else { nx = x; nz = z; }
    }
    // keep the body out of blocked neighbour tiles
    const ti = Math.floor(nx), tj = Math.floor(nz), fx = nx - ti, fz = nz - tj, rr = Math.min(0.42, r);
    if (fx < rr && !grid.passable(ti - 1, tj)) nx = ti + rr;
    if (fx > 1 - rr && !grid.passable(ti + 1, tj)) nx = ti + 1 - rr;
    if (fz < rr && !grid.passable(ti, tj - 1)) nz = tj + rr;
    if (fz > 1 - rr && !grid.passable(ti, tj + 1)) nz = tj + 1 - rr;
    // standing inside a new foundation: step out
    if (!grid.passableAt(nx, nz)) { const f = grid.nearestFree(nx, nz, 6); if (f) { nx = f[0]; nz = f[1]; } }
    nx = Math.max(0.3, Math.min(W - 0.3, nx)); nz = Math.max(0.3, Math.min(W - 0.3, nz));
    st.vx[e] = (nx - x) / TICK; st.vz[e] = (nz - z) / TICK;
    st.x[e] = nx; st.z[e] = nz;
    if (spd > 0) st.rot[e] = turn(st.rot[e], Math.atan2(dvx, dvz), 9 * TICK);
    // stuck detection while following a path
    if (spd > 0) {
      const moved = Math.hypot(nx - x, nz - z);
      if (moved < spd * TICK * 0.25) {
        if (++st.stuck[e] > 30) {
          const fx2 = p.pts[p.pts.length - 2], fz2 = p.pts[p.pts.length - 1];
          if (Math.hypot(fx2 - nx, fz2 - nz) < 2.5 || st.stuck[e] > 110) { p.done = true; st.moving[e] = 0; st.stuck[e] = 0; }
          else if (st.stuck[e] % 40 === 0) { p.pending = true; sim.pathQueue.push(e); }
        }
      } else if (st.stuck[e] > 0) st.stuck[e]--;
    }
  }
}

function wander(sim, e) {
  const st = sim.st;
  if (!sim.pathDone(e)) return;
  if (sim.rng() < 0.006) {
    const a = sim.rng() * Math.PI * 2, r = 1 + sim.rng() * 3;
    const x = st.gx[e] + Math.cos(a) * r, z = st.gz[e] + Math.sin(a) * r;
    if (sim.grid.passableAt(x, z)) sim.moveToPoint(e, x, z, 300);
  }
}

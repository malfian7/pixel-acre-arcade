// PathSystem + MovementSystem — budgeted A*, flow-field following, and steering behaviours:
//   seek / arrive        head for the next waypoint, slow down on the last one
//   separation           positional push-apart so bodies never overlap
//   predictive avoidance look ~1 s ahead; sidestep (right-hand rule) before bumping
//   alignment            units of the same order match their neighbours' velocity (flocking)
//   arrival crowding     stop when the destination is already packed by settled groupmates
// Velocity is acceleration-limited (cavalry and cannon carry more inertia than infantry), and slopes
// slow units climbing and speed them a little going downhill.

import { TICK } from "../../core/core.js";
import { DEF_LIST, C } from "../../data/defs.js";
import { CM, S } from "../ecs.js";
import { T, W, H } from "../map.js";
import { pathStats, lineFree } from "../path.js";

const PATHS_PER_TICK = 16, NODES_PER_TICK = 40000;
const LOOK_R = 2.4;      // neighbour query radius
const AVOID_T = 1.1;     // seconds of look-ahead for avoidance

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
function finish(sim, e, p) {
  const st = sim.st;
  p.done = true; p.flow = null; st.moving[e] = 0;
  if (st.state[e] === S.MOVE) { st.state[e] = S.IDLE; st.gx[e] = st.x[e]; st.gz[e] = st.z[e]; } // arrived: now guards this spot
}

// Where should e head this tick? Returns [x, z, isFinal] or null.
function steerTarget(sim, e, p) {
  const st = sim.st, grid = sim.grid, x = st.x[e], z = st.z[e];
  if (p.flow) {
    const dSlot = Math.hypot(p.fx - x, p.fz - z);
    if (dSlot < 0.12) { finish(sim, e, p); return null; }
    if (--p.wt <= 0 || Number.isNaN(p.wx) || Math.hypot(p.wx - x, p.wz - z) < 0.45) {
      p.wt = 5;
      if (dSlot < 9) {
        if (lineFree(grid, x, z, p.fx, p.fz)) { p.wx = p.fx; p.wz = p.fz; }
        else { const fx = p.fx, fz = p.fz; p.flow = null; sim.moveToPoint(e, fx, fz); return null; } // slot behind an obstacle: A* the last stretch
      } else {
        const la = p.flow.lookahead(grid, x, z, 6);
        if (la && p.flow.costAt(x, z) > 0.5) { p.wx = la[0]; p.wz = la[1]; }
        else { // reached the goal area but the slot is out of sight: finish with A*
          const fx = p.fx, fz = p.fz; p.flow = null; sim.moveToPoint(e, fx, fz); return null;
        }
      }
    }
    return [p.wx, p.wz, p.wx === p.fx && p.wz === p.fz];
  }
  if (p.i >= p.pts.length) return null;
  let wx = p.pts[p.i], wz = p.pts[p.i + 1];
  const last = p.i + 2 >= p.pts.length;
  const dist = Math.hypot(wx - x, wz - z);
  // corner cutting: skip a waypoint once the next one is in sight
  if (!last && (dist < 0.5 || (dist < 1.2 && lineFree(grid, x, z, p.pts[p.i + 2], p.pts[p.i + 3])))) {
    p.i += 2; wx = p.pts[p.i]; wz = p.pts[p.i + 1];
    return [wx, wz, p.i + 2 >= p.pts.length];
  }
  if (last && dist < 0.12) { finish(sim, e, p); return null; }
  return [wx, wz, last];
}

export function movementSystem(sim) {
  const st = sim.st, grid = sim.grid, hash = sim.hash;
  hash.clear();
  for (let e = 0; e < st.top; e++) if (st.alive[e] && (st.mask[e] & CM.MOVER)) hash.insert(e, st.x[e], st.z[e]);

  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || !(st.mask[e] & CM.MOVER)) continue;
    const d = DEF_LIST[st.def[e]];
    if (st.knockT[e] > 0) { // thrown by a blast: slide with friction, no steering until it ends
      st.knockT[e] -= TICK;
      const nx = st.x[e] + st.kx[e] * TICK, nz = st.z[e] + st.kz[e] * TICK;
      if (grid.passableAt(nx, nz)) { st.x[e] = nx; st.z[e] = nz; } else { st.kx[e] = st.kz[e] = 0; }
      st.vx[e] = st.kx[e]; st.vz[e] = st.kz[e]; st.svx[e] = st.svz[e] = 0;
      st.kx[e] *= 0.8; st.kz[e] *= 0.8;
      continue;
    }
    if (d.cls === C.ANIMAL) {
      if (st.dead[e]) {
        st.vx[e] = st.vz[e] = st.svx[e] = st.svz[e] = 0;
        if (!grid.passableAt(st.x[e], st.z[e])) { const f = grid.nearestFree(st.x[e], st.z[e], 6); if (f) { st.x[e] = f[0]; st.z[e] = f[1]; } }
        continue;
      }
      wander(sim, e);
    }
    const x = st.x[e], z = st.z[e], r = d.radius;
    const heavy = d.cls & C.CAV ? 1 : d.cls & C.ART ? 2 : 0;
    const accel = d.speed * (heavy === 1 ? 3.6 : heavy === 2 ? 2.6 : 7.5);
    const turnRate = (heavy === 1 ? 6.5 : heavy === 2 ? 3.5 : 10) * TICK;

    // ---- seek / arrive
    const p = st.path.get(e);
    let tgt = null;
    if (p && !p.pending && !p.done) tgt = steerTarget(sim, e, p);
    let dvx = 0, dvz = 0, dirx = 0, dirz = 0, maxS = 0, distGoal = Infinity;
    if (tgt) {
      const dx = tgt[0] - x, dz = tgt[1] - z, dist = Math.hypot(dx, dz) || 1e-6;
      dirx = dx / dist; dirz = dz / dist;
      const k = Math.floor(z) * W + Math.floor(x);
      maxS = d.speed * (grid.terrain[k] === T.SHALLOW ? 0.7 : 1);
      // slope: climbing is slower, descending a little faster
      const ahead = grid.heightAt(x + dirx * 0.5, z + dirz * 0.5) - grid.heightAt(x, z);
      maxS *= Math.max(0.62, Math.min(1.12, 1 - ahead * 0.7));
      let spd = maxS;
      if (tgt[2]) { distGoal = dist; spd = Math.max(maxS * 0.25, Math.min(maxS, dist / 0.9 * maxS)); spd = Math.min(spd, dist / TICK); }
      dvx = dirx * spd; dvz = dirz * spd;
    }

    // ---- neighbours: separation, avoidance, alignment, arrival crowding
    let sx = 0, sz = 0, ax = 0, az = 0, alx = 0, alz = 0, aln = 0, crowded = false;
    const mv = st.moving[e], gid = st.group[e];
    const pointMove = st.state[e] === S.MOVE || st.state[e] === S.AMOVE; // crowd-stop only for plain moves
    hash.each(x, z, LOOK_R, (o) => {
      if (o === e || st.dead[o]) return;
      const od = DEF_LIST[st.def[o]], rr = r + od.radius;
      const rx = st.x[o] - x, rz = st.z[o] - z, dd = rx * rx + rz * rz;
      if (dd > LOOK_R * LOOK_R) return;
      const dist = Math.sqrt(dd) || 1e-4;
      // separation (positional, resolves overlap)
      if (dist < rr + 0.04) {
        const ov = rr + 0.04 - dist;
        const w = mv ? (st.moving[o] ? 0.5 : 0.18) : (st.moving[o] ? 0.82 : 0.5);
        const nx = dd > 1e-8 ? rx / dist : ((e * 7) % 10) / 10 - 0.5, nz = dd > 1e-8 ? rz / dist : ((e * 3) % 10) / 10 - 0.5;
        sx -= nx * ov * w; sz -= nz * ov * w;
      }
      if (!tgt) return;
      // arrival crowding: the slot area is already packed by settled units
      if (pointMove && tgt[2] && distGoal < 1.9 && !st.moving[o] && dist < rr + 0.3 && (rx * dirx + rz * dirz) > 0.3 * dist && st.owner[o] === st.owner[e] && (st.group[o] === gid || st.mask[o] & CM.ATTACKER || distGoal < 1.2)) crowded = true;
      // predictive avoidance (time to closest approach)
      if (rx * dirx + rz * dirz < -0.2 * dist) return; // only what is ahead of us
      const ovx = st.moving[o] ? st.vx[o] : 0, ovz = st.moving[o] ? st.vz[o] : 0;
      const rvx = dvx - ovx, rvz = dvz - ovz, rv2 = rvx * rvx + rvz * rvz;
      if (rv2 > 1e-4) {
        const tca = (rx * rvx + rz * rvz) / rv2;
        if (tca > 0 && tca < AVOID_T) {
          const cx = rx - rvx * tca, cz = rz - rvz * tca;
          if (cx * cx + cz * cz < (rr + 0.15) * (rr + 0.15)) {
            // pass on the side the neighbour is not on; head-on → keep right
            let side = dirx * rz - dirz * rx; // >0: neighbour on the left
            if (Math.abs(side) < 0.08 * dist) side = 1;
            const s = side > 0 ? -1 : 1, k = (1 - tca / AVOID_T) * maxS * (st.moving[o] ? 0.7 : 0.45);
            ax += -dirz * s * k; az += dirx * s * k;
          }
        }
      }
      // alignment with groupmates
      if (gid && st.group[o] === gid && st.moving[o] && dist < 2.2) { alx += st.vx[o]; alz += st.vz[o]; aln++; }
    });
    // close to the goal but circling for 4 s (slot taken, crowd churn): good enough, stop here
    if (tgt && tgt[2] && distGoal < 3) { p.near = (p.near || 0) + 1; if (p.near > 80) crowded = true; } else if (p) p.near = 0;
    if (crowded && p) { finish(sim, e, p); tgt = null; dvx = dvz = 0; }

    // ---- integrate steering velocity (acceleration-limited)
    let wx = dvx + ax, wz = dvz + az;
    if (aln && tgt) { wx += (alx / aln - dvx) * 0.12; wz += (alz / aln - dvz) * 0.12; }
    const wl = Math.hypot(wx, wz), cap = Math.max(maxS * 1.05, 0.01);
    if (wl > cap) { wx *= cap / wl; wz *= cap / wl; }
    let vx = st.svx[e], vz = st.svz[e];
    if (tgt) {
      let ddx = wx - vx, ddz = wz - vz; const dl = Math.hypot(ddx, ddz), amax = accel * TICK;
      if (dl > amax) { ddx *= amax / dl; ddz *= amax / dl; }
      vx += ddx; vz += ddz;
    } else { vx *= 0.35; vz *= 0.35; if (Math.abs(vx) + Math.abs(vz) < 0.02) vx = vz = 0; }
    st.svx[e] = vx; st.svz[e] = vz;

    const sl = Math.hypot(sx, sz), scap = 0.12;
    if (sl > scap) { sx *= scap / sl; sz *= scap / sl; }
    let nx = x + vx * TICK + sx, nz = z + vz * TICK + sz;
    // ---- tile collision with sliding
    if (!grid.passableAt(nx, nz)) {
      if (grid.passableAt(nx, z)) { nz = z; st.svz[e] = 0; }
      else if (grid.passableAt(x, nz)) { nx = x; st.svx[e] = 0; }
      else { nx = x; nz = z; st.svx[e] = st.svz[e] = 0; }
    }
    const ti = Math.floor(nx), tj = Math.floor(nz), fx = nx - ti, fz = nz - tj, rr = Math.min(0.42, r);
    if (fx < rr && !grid.passable(ti - 1, tj)) nx = ti + rr;
    if (fx > 1 - rr && !grid.passable(ti + 1, tj)) nx = ti + 1 - rr;
    if (fz < rr && !grid.passable(ti, tj - 1)) nz = tj + rr;
    if (fz > 1 - rr && !grid.passable(ti, tj + 1)) nz = tj + 1 - rr;
    if (!grid.passableAt(nx, nz)) { const f = grid.nearestFree(nx, nz, 6); if (f) { nx = f[0]; nz = f[1]; } }
    nx = Math.max(0.3, Math.min(W - 0.3, nx)); nz = Math.max(0.3, Math.min(H - 0.3, nz));
    st.vx[e] = (nx - x) / TICK; st.vz[e] = (nz - z) / TICK;
    st.x[e] = nx; st.z[e] = nz;
    // ---- face the direction of travel
    const vl = Math.hypot(vx, vz);
    if (tgt && vl > Math.max(0.15, maxS * 0.2)) st.rot[e] = turn(st.rot[e], Math.atan2(vx, vz), turnRate);
    // ---- stuck detection
    if (tgt && p && !p.done) {
      const moved = Math.hypot(nx - x, nz - z);
      if (moved < maxS * TICK * 0.2) {
        if (++st.stuck[e] > 30) {
          const gx = p.flow ? p.fx : p.pts[p.pts.length - 2], gz = p.flow ? p.fz : p.pts[p.pts.length - 1];
          if (Math.hypot(gx - nx, gz - nz) < 2.5 || st.stuck[e] > 110) { finish(sim, e, p); st.stuck[e] = 0; }
          else if (st.stuck[e] % 40 === 0) {
            if (p.flow) { const fx2 = p.fx, fz2 = p.fz; p.flow = null; sim.moveToPoint(e, fx2, fz2); }
            else { p.pending = true; sim.pathQueue.push(e); }
          }
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

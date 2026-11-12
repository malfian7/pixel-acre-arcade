// CommandSystem — the only door through which players (human or AI) change the world.

import { DEFS, DEF_LIST, AGES, BUILDABLE, C } from "../../data/defs.js";
import { sendCard } from "../economy/shipments.js";
import { startClaim } from "../treasures.js";
import { CM, S } from "../ecs.js";
import { canAfford, spend, refund, credit } from "../economy/ledger.js";
import { beginAgeUp, cancelAgeUp } from "../economy/age.js";

export function commandSystem(sim, cmds) {
  for (const c of cmds) {
    // any new order cancels a pending "fight the guardians, then open the chest" plan
    if (c.ids) for (const e of c.ids) sim.claimResume.delete(e);
    try { (H[c.t] || noop)(sim, c); } catch (err) { if (typeof console !== "undefined") console.warn("command failed", c.t, err); }
  }
}
const noop = () => {};

function ownUnits(sim, c) {
  const st = sim.st;
  return (c.ids || []).filter((e) => st.alive[e] && st.owner[e] === c.p && (st.mask[e] & CM.UNIT));
}

export function startGather(sim, e, t) {
  const st = sim.st, d = DEF_LIST[st.def[t]];
  const res = d.res != null ? d.res : 0;
  if (st.carry[e] > 0 && st.ctype[e] !== res) st.carry[e] = 0;
  st.ctype[e] = res;
  st.state[e] = S.GATHER; st.eco[e] = 1; /* ECO.SEEK — see economy/villager-fsm.js */ sim.st.setTarget(e, t);
  st.lastNode[e] = t; st.lastNodeGen[e] = st.gen[t]; st.lastType[e] = GT.indexOf(d.farm ? "mill" : d.gtype);
  sim.moveToEntity(e, t, 0.5);
}
export const GT = ["berries", "hunt", "mill", "wood", "coin", "crate"];

export function startBuild(sim, e, t) {
  const st = sim.st;
  st.state[e] = S.BUILD; st.setTarget(e, t);
  sim.moveToEntity(e, t, 0.5);
}

export function startAttack(sim, e, t, amove = 0) {
  const st = sim.st;
  st.state[e] = S.ATTACK; st.setTarget(e, t); st.amove[e] = amove; st.repath[e] = 0;
  if (amove !== 1) { st.gx[e] = st.x[e]; st.gz[e] = st.z[e]; }
  const d = sim.defOf(e);
  sim.moveToEntity(e, t, Math.max(0.4, (d.atk ? d.atk.range : 1) * 0.9));
}

// Formation slots around (x,z) facing the direction of travel.
function formation(sim, units, x, z) {
  const st = sim.st, n = units.length;
  let cx = 0, cz = 0; for (const e of units) { cx += st.x[e]; cz += st.z[e]; } cx /= n; cz /= n;
  let fx = x - cx, fz = z - cz; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
  const rx = -fz, rz = fx; // right vector
  const maxR = Math.max(...units.map((e) => sim.defOf(e).radius));
  const sp = maxR * 2 + 0.45;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * 2)));
  const slots = [];
  for (let k = 0; k < n; k++) {
    const r = Math.floor(k / cols), cc = k % cols, rowN = Math.min(cols, n - r * cols);
    const lat = (cc - (rowN - 1) / 2) * sp, back = r * sp;
    let sx = x + rx * lat - fx * back, sz = z + rz * lat - fz * back;
    const fr = sim.grid.nearestFree(sx, sz, 6) || [x, z];
    slots.push(fr);
  }
  // greedy assignment: units sorted by lateral offset match slots sorted the same way
  const lat = (px, pz) => (px - cx) * rx + (pz - cz) * rz;
  const us = [...units].sort((a, b) => lat(st.x[a], st.z[a]) - lat(st.x[b], st.z[b]));
  const rows = [];
  for (let k = 0; k < n; k += cols) rows.push(slots.slice(k, k + cols));
  const ordered = [];
  // fill front rows first with units closest to the destination
  const byDist = [...us].sort((a, b) => ((st.x[a] - x) ** 2 + (st.z[a] - z) ** 2) - ((st.x[b] - x) ** 2 + (st.z[b] - z) ** 2));
  let idx = 0;
  for (const row of rows) {
    const take = byDist.slice(idx, idx + row.length).sort((a, b) => lat(st.x[a], st.z[a]) - lat(st.x[b], st.z[b]));
    const rs = [...row].sort((a, b) => lat(a[0], a[1]) - lat(b[0], b[1]));
    take.forEach((e, k) => ordered.push([e, rs[k]]));
    idx += row.length;
  }
  return ordered;
}

const H = {
  move(sim, c) {
    const st = sim.st, units = ownUnits(sim, c);
    if (!units.length) return;
    const pairs = units.length === 1 ? [[units[0], [c.x, c.z]]] : formation(sim, units, c.x, c.z);
    const gid = (sim.orderSeq = (sim.orderSeq + 1) & 0xffff) || 1;
    for (const [e, [x, z]] of pairs) {
      st.state[e] = c.amove ? S.AMOVE : S.MOVE; st.amove[e] = c.amove ? 1 : 0;
      st.tgt[e] = -1; st.tx[e] = x; st.tz[e] = z; st.gx[e] = x; st.gz[e] = z; st.group[e] = gid;
    }
    // big groups share one flow field; small ones get individual A* paths
    if (pairs.length >= 6) sim.moveGroupFlow(pairs, c.x, c.z);
    else for (const [e, [x, z]] of pairs) sim.moveToPoint(e, x, z);
  },
  stop(sim, c) {
    const st = sim.st;
    for (const e of ownUnits(sim, c)) { st.state[e] = S.IDLE; st.tgt[e] = -1; sim.stopMoving(e); st.gx[e] = st.x[e]; st.gz[e] = st.z[e]; }
  },
  target(sim, c) {
    const st = sim.st, t = c.target;
    if (!st.alive[t]) return;
    const td = DEF_LIST[st.def[t]], to = st.owner[t];
    const units = ownUnits(sim, c);
    const movers = [];
    for (const e of units) {
      const d = DEF_LIST[st.def[e]], m = st.mask[e];
      if (td.crate && to !== c.p) { movers.push(e); continue; }   // someone else's shipment crate
      if (st.mask[t] & CM.TREASURE) { startClaim(sim, e, t); continue; } // walk to the chest and open it
      if (sim.enemies(c.p, to) && (m & CM.ATTACKER)) { startAttack(sim, e, t, 0); continue; }
      if (m & CM.GATHERER) {
        if ((st.mask[t] & CM.RESOURCE) && td.gtype) { startGather(sim, e, t); continue; }
        if (to === c.p && (st.mask[t] & CM.BUILDING) && st.prog[t] < 1) { startBuild(sim, e, t); continue; }
        if (to === c.p && td.farm && st.prog[t] >= 1) { startGather(sim, e, t); continue; }
        if (to === c.p && (st.mask[t] & CM.DROPSITE) && st.carry[e] > 0 && td.drop.includes(st.ctype[e])) {
          st.state[e] = S.RETURN; st.setTarget(e, t); sim.moveToEntity(e, t, 0.5); continue;
        }
      }
      movers.push(e);
    }
    if (movers.length) H.move(sim, { p: c.p, ids: movers, x: st.x[t], z: st.z[t] + (sim.isFoot(t) ? td.size / 2 + 1.2 : 0) });
  },
  build(sim, c) {
    const st = sim.st, pl = sim.players[c.p], d = DEFS[c.def];
    if (!d || !BUILDABLE.includes(c.def) || d.age > pl.age) return;
    if (!canAfford(pl, d.cost) || !sim.grid.canPlace(c.i, c.j, d.size)) return;
    const vills = ownUnits(sim, c).filter((e) => st.mask[e] & CM.GATHERER);
    if (!vills.length) return;
    if (!spend(pl, d.cost)) return;
    const b = sim.spawnBuilding(d.idx, c.p, c.i, c.j, false);   // a foundation: prog 0, ghost until built
    sim.events.push("placed", { e: b, p: c.p });
    for (const e of vills) startBuild(sim, e, b);
  },
  train(sim, c) {
    const st = sim.st, pl = sim.players[c.p], b = c.id, d = DEFS[c.def];
    if (!d || !st.alive[b] || st.owner[b] !== c.p || st.prog[b] < 1) return;
    const bd = DEF_LIST[st.def[b]];
    if (!bd.trains || !bd.trains.includes(c.def) || d.age > pl.age) return;
    if (d.limit && limitLeft(sim, c.p, d) <= 0) return;
    let q = st.queue.get(b); if (!q) { q = { items: [], t: 0 }; st.queue.set(b, q); }
    const n = Math.max(1, c.n || 1);
    for (let k = 0; k < n; k++) {
      if (q.items.length >= 5 || (d.limit && limitLeft(sim, c.p, d) <= 0) || !spend(pl, d.cost)) break;
      q.items.push(d.idx);
    }
  },
  cancel(sim, c) {
    const st = sim.st, pl = sim.players[c.p], b = c.id;
    if (!st.alive[b] || st.owner[b] !== c.p) return;
    const q = st.queue.get(b); if (!q || !q.items.length) return;
    const k = Math.min(q.items.length - 1, c.index ?? q.items.length - 1);
    const d = DEF_LIST[q.items[k]];
    refund(pl, d.cost); q.items.splice(k, 1); if (k === 0) q.t = 0;
  },
  age(sim, c) { beginAgeUp(sim, c.p); },
  ageCancel(sim, c) { cancelAgeUp(sim, c.p); },
  card(sim, c) { sendCard(sim, c.p, c.card); },
  rally(sim, c) {
    const st = sim.st;
    for (const b of c.ids || []) {
      if (!st.alive[b] || st.owner[b] !== c.p || !(st.mask[b] & CM.PRODUCER)) continue;
      st.rally.set(b, { x: c.x, z: c.z, tgt: c.target ?? -1, tgtGen: c.target >= 0 ? st.gen[c.target] : 0 });
    }
  },
  delete(sim, c) {
    const st = sim.st;
    for (const e of c.ids || []) {
      if (!st.alive[e] || st.owner[e] !== c.p || !(st.mask[e] & (CM.UNIT | CM.BUILDING))) continue;
      // cancelling an unfinished foundation returns the unbuilt share of its cost
      if ((st.mask[e] & CM.BUILDING) && st.prog[e] < 1) refund(sim.players[c.p], DEF_LIST[st.def[e]].cost.map((v) => Math.floor(v * (1 - st.prog[e]))));
      st.hp[e] = 0;
    }
  },
  resign(sim, c) { sim.players[c.p].resigned = true; },
};

// A free spot just outside building b, preferring the rally point (or the map centre).
/** How many more of a limited unit (Explorer: 1) the player may train: limit − alive − queued. */
export function limitLeft(sim, p, d) {
  const st = sim.st;
  let n = 0;
  for (let e = 0; e < st.top; e++) if (st.alive[e] && st.owner[e] === p && st.def[e] === d.idx) n++;
  for (const [b, q] of st.queue) if (st.owner[b] === p) n += q.items.filter((i) => i === d.idx).length;
  return d.limit - n;
}

export function exitPoint(sim, b, k = 0) {
  const st = sim.st, r = sim.tileRect(b), rl = st.rally.get(b);
  const tx = rl ? rl.x : 64, tz = rl ? rl.z : 64;
  const cand = [];
  for (let ring = 1; ring <= 3; ring++) {
    for (let j = r.z0 - ring; j <= r.z1 + ring; j++) for (let i = r.x0 - ring; i <= r.x1 + ring; i++) {
      if (i > r.x0 - ring && i < r.x1 + ring && j > r.z0 - ring && j < r.z1 + ring) continue;
      if (!sim.grid.passable(i, j)) continue;
      cand.push([i + 0.5, j + 0.5, (i + 0.5 - tx) ** 2 + (j + 0.5 - tz) ** 2]);
    }
    if (cand.length > k) break;
  }
  if (!cand.length) return null;
  cand.sort((a, b) => a[2] - b[2]);
  const p = cand[Math.min(k, cand.length - 1)];
  return [p[0] + (sim.rng() - 0.5) * 0.3, p[1] + (sim.rng() - 0.5) * 0.3];
}

export { canAfford, C };

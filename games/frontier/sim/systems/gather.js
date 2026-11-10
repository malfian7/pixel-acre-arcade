// GatherSystem — villagers gather, carry to the nearest drop site, and go back.

import { TICK } from "../../core/core.js";
import { DEF_LIST, CARRY, C } from "../../data/defs.js";
import { CM, S } from "../ecs.js";
import { BL } from "../map.js";
import { GT, startGather } from "./command.js";

export function gatherSystem(sim) {
  const st = sim.st;
  st.workers.fill(0);
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e]) continue;
    const s = st.state[e];
    if (s === S.GATHER) gather(sim, e);
    else if (s === S.RETURN) ret(sim, e);
  }
}

function findReplacement(sim, e) {
  const st = sim.st, gt = GT[st.lastType[e]];
  if (gt === "mill") {
    const o = st.owner[e];
    return sim.nearest(st.x[e], st.z[e], (b) => st.owner[b] === o && DEF_LIST[st.def[b]].farm && st.prog[b] >= 1 && st.workers[b] < 10, 16);
  }
  return sim.nearestResource(st.x[e], st.z[e], gt, 16, true, st.owner[e]);
}

function gather(sim, e) {
  const st = sim.st;
  if (!st.targetOk(e)) {
    const t2 = findReplacement(sim, e);
    if (t2 >= 0) { startGather(sim, e, t2); return; }
    if (st.carry[e] > 0) { toDrop(sim, e); return; }
    st.state[e] = S.IDLE; st.tgt[e] = -1; return;
  }
  const t = st.tgt[e], d = DEF_LIST[st.def[t]], ud = DEF_LIST[st.def[e]];
  const mill = !!d.farm;
  if (mill && (st.owner[t] !== st.owner[e] || st.prog[t] < 1)) { st.state[e] = S.IDLE; return; }
  if (st.carry[e] >= CARRY) { toDrop(sim, e); return; }
  // hunting: shoot the animal from range first
  if (d.cls === C.ANIMAL && !st.dead[t]) {
    const dd = Math.hypot(st.x[t] - st.x[e], st.z[t] - st.z[e]);
    if (dd < 5) {
      st.dead[t] = 1; sim.stopMoving(t); st.act[e] = 1;
      st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
      sim.events.push("shot", { e, t, kind: "hunt", x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t], p: st.owner[e] });
      sim.moveToEntity(e, t, 0.5);
    } else if (sim.pathDone(e) || ++st.repath[e] > 20) {
      st.repath[e] = 0;
      if (sim.pathFailed(e) && ++st.tries[e] > 3) { st.tries[e] = 0; st.unreach[t] |= 1 << st.owner[e]; const t2 = sim.nearestResource(st.x[e], st.z[e], "berries", 20); if (t2 >= 0) startGather(sim, e, t2); else st.state[e] = S.IDLE; return; }
      sim.moveToEntity(e, t, 0.5);
    }
    return;
  }
  if (!mill && d.size === 1 && st.workers[t] >= 4) { // crowded bush/tree: find another
    const t2 = sim.nearestResource(st.x[e], st.z[e], d.gtype, 8);
    if (t2 >= 0 && t2 !== t) { startGather(sim, e, t2); return; }
  }
  if (mill && st.workers[t] >= d.farm) {
    const t2 = findReplacement(sim, e);
    if (t2 >= 0 && t2 !== t) { startGather(sim, e, t2); return; }
  }
  const dist = sim.edgeDist(st.x[e], st.z[e], t);
  if (dist > 0.8) {
    if (sim.pathDone(e)) {
      if (++st.tries[e] > (sim.pathFailed(e) ? 2 : 5)) {
        if (sim.pathFailed(e)) st.unreach[t] |= 1 << st.owner[e]; st.tries[e] = 0; const t2 = findReplacement(sim, e); if (t2 >= 0 && t2 !== t) startGather(sim, e, t2); else st.state[e] = S.IDLE; return; }
      sim.moveToEntity(e, t, 0.5);
    }
    return;
  }
  if (st.moving[e]) sim.stopMoving(e);
  st.tries[e] = 0;
  st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
  st.workers[t]++;
  const gt = mill ? "mill" : d.gtype;
  const rate = ud.gather[gt] * sim.players[st.owner[e]].gatherMult;
  let amt = Math.min(rate * TICK, CARRY - st.carry[e]);
  if (!mill) amt = Math.min(amt, st.amount[t]);
  st.carry[e] += amt; st.ctype[e] = d.res;
  if (!mill) st.amount[t] -= amt;
  st.act[e] += TICK;
  if (((sim.tick + e) % 24) === 0) sim.events.push("work", { e, gt, x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t] });
  if (!mill && st.amount[t] <= 0.001) {
    sim.events.push("depleted", { e: t, def: st.def[t], x: st.x[t], z: st.z[t] });
    if (sim.isFoot(t)) { const r = sim.tileRect(t); sim.grid.stamp(r.x0, r.z0, d.size, BL.RES, -1); }
    st.destroy(t);
  }
}

function toDrop(sim, e) {
  const st = sim.st, o = st.owner[e];
  const drop = sim.nearestDrop(o, st.x[e], st.z[e], st.ctype[e]);
  if (drop < 0) { st.state[e] = S.IDLE; return; }
  st.state[e] = S.RETURN; st.setTarget(e, drop); st.tries[e] = 0;
  sim.moveToEntity(e, drop, 0.5);
}

function ret(sim, e) {
  const st = sim.st;
  if (!st.targetOk(e) || st.prog[st.tgt[e]] < 1) { toDrop(sim, e); return; }
  const t = st.tgt[e];
  const dist = sim.edgeDist(st.x[e], st.z[e], t);
  if (dist > 0.85) {
    if (sim.pathDone(e)) { if (++st.tries[e] > 5) { st.state[e] = S.IDLE; return; } sim.moveToEntity(e, t, 0.5); }
    return;
  }
  const pl = sim.players[st.owner[e]], c = st.ctype[e], amt = st.carry[e];
  pl.res[c] += amt; pl.stats.gathered[c] += amt; st.carry[e] = 0;
  sim.events.push("deposit", { e, p: st.owner[e], res: c, amt });
  const n = st.lastNode[e];
  if (n >= 0 && st.valid(n, st.lastNodeGen[e])) startGather(sim, e, n);
  else { const t2 = findReplacement(sim, e); if (t2 >= 0) startGather(sim, e, t2); else { st.state[e] = S.IDLE; st.tgt[e] = -1; } }
}

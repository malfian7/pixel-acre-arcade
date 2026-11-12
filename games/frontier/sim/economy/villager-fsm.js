// Frontier Crown — villager economy as an explicit finite-state machine.
//
//            order / auto-assign                  in reach (≤ 0.8 tiles)
//   IDLE ───────────────────────► SEEK ─────────────────────────► GATHERING
//    ▲                             ▲  node gone → nearest same type    │  every HARVEST_PULSE s:
//    │ nothing left                │                                  │  carry += rate × pulse
//    │                             │ resume last node                 │  carry full / node gone
//    │                          DEPOSIT ◄──────────────────────── HAUL ◄┘
//    │                     (DEPOSIT_TIME s, then           (walk to nearest drop site
//    └──────────────────────  stockpile += carry)            showing the load: log, sack, basket)
//
// The order-level state stays in the shared ECS `state` column (S.GATHER covers SEEK+GATHERING,
// S.RETURN covers HAUL+DEPOSIT), so movement, combat and the AI keep working unchanged; the
// economy sub-state lives in `st.eco`, the harvest/unload timer in `st.pulse`.
// The table below is the whole machine: each state has enter() and update(); update() returns
// the next state (or the same one). Nothing else in the sim writes `st.eco`.

import { TICK } from "../../core/core.js";
import { DEF_LIST, CARRY, C, HARVEST_PULSE, DEPOSIT_TIME } from "../../data/defs.js";
import { CM, S } from "../ecs.js";
import { BL } from "../map.js";
import { GT, startGather } from "../systems/command.js";
import { credit } from "./ledger.js";

export const ECO = { NONE: 0, SEEK: 1, GATHERING: 2, HAUL: 3, DEPOSIT: 4 };
export const ECO_NAME = ["Idle", "Seek", "Gathering", "Haul", "Deposit"];
const REACH = 0.8, DROP_REACH = 0.85;

// ------------------------------------------------------------------ state table
const STATES = {
  [ECO.SEEK]: { enter: (sim, e) => { sim.st.tries[e] = 0; }, update: seek },
  [ECO.GATHERING]: { enter: (sim, e) => { sim.st.pulse[e] = 0; if (sim.st.moving[e]) sim.stopMoving(e); }, update: gathering },
  [ECO.HAUL]: { enter: (sim, e) => { sim.st.tries[e] = 0; }, update: haul },
  [ECO.DEPOSIT]: { enter: (sim, e) => { sim.st.pulse[e] = 0; if (sim.st.moving[e]) sim.stopMoving(e); }, update: deposit },
};
const ORDER_OF = { [ECO.SEEK]: S.GATHER, [ECO.GATHERING]: S.GATHER, [ECO.HAUL]: S.RETURN, [ECO.DEPOSIT]: S.RETURN };

export function transition(sim, e, to) {
  const st = sim.st;
  if (to === ECO.NONE) { st.eco[e] = ECO.NONE; st.state[e] = S.IDLE; st.tgt[e] = -1; return; }
  st.eco[e] = to; st.state[e] = ORDER_OF[to];
  STATES[to].enter(sim, e);
}

export function villagerEconomySystem(sim) {
  const st = sim.st;
  st.workers.fill(0);
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || !(st.mask[e] & CM.GATHERER)) continue;
    const s = st.state[e];
    // keep the sub-state consistent with order-level changes made elsewhere (commands, retaliation)
    let k = st.eco[e];
    if (s === S.GATHER) { if (k !== ECO.SEEK && k !== ECO.GATHERING) transition(sim, e, k = ECO.SEEK); }
    else if (s === S.RETURN) { if (k !== ECO.HAUL && k !== ECO.DEPOSIT) { st.eco[e] = k = ECO.HAUL; st.tries[e] = 0; } }
    else { st.eco[e] = ECO.NONE; continue; }
    const next = STATES[k].update(sim, e);
    if (next !== k) transition(sim, e, next);
  }
}

// ------------------------------------------------------------------ helpers
function findReplacement(sim, e) {
  const st = sim.st, gt = GT[st.lastType[e]];
  if (gt === "mill") {
    const o = st.owner[e];
    return sim.nearest(st.x[e], st.z[e], (b) => st.owner[b] === o && DEF_LIST[st.def[b]].farm && st.prog[b] >= 1 && st.workers[b] < 10, 16);
  }
  return sim.nearestResource(st.x[e], st.z[e], gt, 16, true, st.owner[e]);
}
/** Switch to another node (startGather resets targets and sends us back into SEEK). */
function retarget(sim, e, t2) { startGather(sim, e, t2); sim.st.tries[e] = 0; return ECO.SEEK; }
/** Node lost: another of the same type, else haul what we carry, else stop. */
function lost(sim, e) {
  const t2 = findReplacement(sim, e);
  if (t2 >= 0) return retarget(sim, e, t2);
  if (sim.st.carry[e] > 0) return ECO.HAUL;
  return ECO.NONE;
}
function nodeInfo(sim, e) {
  const st = sim.st, t = st.tgt[e], d = DEF_LIST[st.def[t]];
  return { t, d, mill: !!d.farm };
}

// ------------------------------------------------------------------ SEEK: walk to the node (or hunt it)
function seek(sim, e) {
  const st = sim.st;
  if (!st.targetOk(e)) return lost(sim, e);
  const { t, d, mill } = nodeInfo(sim, e);
  if (mill && (st.owner[t] !== st.owner[e] || st.prog[t] < 1)) return ECO.NONE;
  if (st.carry[e] >= CARRY) return ECO.HAUL;
  // hunting: shoot the animal from range, then walk to the carcass
  if (d.cls === C.ANIMAL && !st.dead[t]) {
    const dd = Math.hypot(st.x[t] - st.x[e], st.z[t] - st.z[e]);
    if (dd < 5) {
      st.dead[t] = 1; sim.stopMoving(t); st.act[e] = 1;
      st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
      sim.events.push("shot", { e, t, kind: "hunt", x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t], p: st.owner[e] });
      sim.moveToEntity(e, t, 0.5);
    } else if (sim.pathDone(e) || ++st.repath[e] > 20) {
      st.repath[e] = 0;
      if (sim.pathFailed(e) && ++st.tries[e] > 3) {
        st.tries[e] = 0; st.unreach[t] |= 1 << st.owner[e];
        const t2 = sim.nearestResource(st.x[e], st.z[e], "berries", 20);
        return t2 >= 0 ? retarget(sim, e, t2) : ECO.NONE;
      }
      sim.moveToEntity(e, t, 0.5);
    }
    return ECO.SEEK;
  }
  // over-crowded node: spread out
  if (!mill && d.size === 1 && st.workers[t] >= 4) {
    const t2 = sim.nearestResource(st.x[e], st.z[e], d.gtype, 8);
    if (t2 >= 0 && t2 !== t) return retarget(sim, e, t2);
  }
  if (mill && st.workers[t] >= d.farm) {
    const t2 = findReplacement(sim, e);
    if (t2 >= 0 && t2 !== t) return retarget(sim, e, t2);
  }
  // proximity trigger: next to the mesh's footprint → start gathering
  if (sim.edgeDist(st.x[e], st.z[e], t) <= REACH) { st.workers[t]++; return ECO.GATHERING; }
  if (sim.pathDone(e)) {
    if (++st.tries[e] > (sim.pathFailed(e) ? 2 : 5)) {
      if (sim.pathFailed(e)) st.unreach[t] |= 1 << st.owner[e];
      st.tries[e] = 0;
      const t2 = findReplacement(sim, e);
      return t2 >= 0 && t2 !== t ? retarget(sim, e, t2) : ECO.NONE;
    }
    sim.moveToEntity(e, t, 0.5);
  }
  return ECO.SEEK;
}

// ------------------------------------------------------------------ GATHERING: harvest pulses into the carried load
function gathering(sim, e) {
  const st = sim.st;
  if (!st.targetOk(e)) return lost(sim, e);
  const { t, d, mill } = nodeInfo(sim, e);
  if (mill && (st.owner[t] !== st.owner[e] || st.prog[t] < 1)) return ECO.NONE;
  if (sim.edgeDist(st.x[e], st.z[e], t) > REACH + 0.3) return ECO.SEEK; // pushed away
  if (st.carry[e] >= CARRY) return ECO.HAUL;
  st.workers[t]++;
  st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
  st.act[e] = 1; st.tries[e] = 0;
  st.pulse[e] += TICK;
  if (st.pulse[e] + 1e-6 < HARVEST_PULSE) return ECO.GATHERING;
  // one harvest stroke
  st.pulse[e] -= HARVEST_PULSE;
  const gt = mill ? "mill" : d.gtype;
  const rate = DEF_LIST[st.def[e]].gather[gt] * sim.players[st.owner[e]].gatherMult;
  if (d.crate) { // shipment crates sit next to the Town Center: unpacked straight into the stockpile
    const a = Math.min(rate * HARVEST_PULSE, st.amount[t]);
    st.amount[t] -= a;
    credit(sim.players[st.owner[e]], d.res, a);
    sim.events.push("work", { e, gt, x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t], amt: a });
    sim.events.push("deposit", { e, p: st.owner[e], res: d.res, amt: a, x: st.x[t], z: st.z[t] });
    if (st.amount[t] <= 0.001) {
      sim.events.push("depleted", { e: t, def: st.def[t], x: st.x[t], z: st.z[t] });
      const r = sim.tileRect(t); sim.grid.stamp(r.x0, r.z0, d.size, BL.RES, -1);
      st.destroy(t);
      return lost(sim, e);
    }
    return ECO.GATHERING;
  }
  let amt = Math.min(rate * HARVEST_PULSE, CARRY - st.carry[e]);
  if (!mill) amt = Math.min(amt, st.amount[t]);
  st.carry[e] += amt; st.ctype[e] = d.res;
  if (!mill) st.amount[t] -= amt;
  sim.events.push("work", { e, gt, x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t], amt });
  if (!mill && st.amount[t] <= 0.001) {
    sim.events.push("depleted", { e: t, def: st.def[t], x: st.x[t], z: st.z[t] });
    if (sim.isFoot(t)) { const r = sim.tileRect(t); sim.grid.stamp(r.x0, r.z0, d.size, BL.RES, -1); }
    st.destroy(t);
    return st.carry[e] >= CARRY - 0.01 ? ECO.HAUL : lost(sim, e);
  }
  return st.carry[e] >= CARRY - 0.001 ? ECO.HAUL : ECO.GATHERING;
}

// ------------------------------------------------------------------ HAUL: carry the load to the nearest drop site
function haul(sim, e) {
  const st = sim.st;
  const t = st.tgt[e];
  const valid = st.targetOk(e) && (st.mask[t] & CM.DROPSITE) && st.prog[t] >= 1 && st.owner[t] === st.owner[e] && DEF_LIST[st.def[t]].drop.includes(st.ctype[e]);
  if (!valid) {
    const drop = sim.nearestDrop(st.owner[e], st.x[e], st.z[e], st.ctype[e]);
    if (drop < 0) return ECO.NONE;
    st.setTarget(e, drop); st.tries[e] = 0;
    sim.moveToEntity(e, drop, 0.5);
    return ECO.HAUL;
  }
  if (sim.edgeDist(st.x[e], st.z[e], t) <= DROP_REACH) return ECO.DEPOSIT;
  if (sim.pathDone(e)) { if (++st.tries[e] > 5) return ECO.NONE; sim.moveToEntity(e, t, 0.5); }
  return ECO.HAUL;
}

// ------------------------------------------------------------------ DEPOSIT: unload, credit the stockpile, go back
function deposit(sim, e) {
  const st = sim.st;
  if (!st.targetOk(e)) return ECO.HAUL;
  const t = st.tgt[e];
  st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
  st.pulse[e] += TICK;
  if (st.pulse[e] + 1e-6 < DEPOSIT_TIME) return ECO.DEPOSIT;
  const pl = sim.players[st.owner[e]], c = st.ctype[e], amt = st.carry[e];
  if (amt > 0) {
    credit(pl, c, amt);
    sim.events.push("deposit", { e, p: st.owner[e], res: c, amt, x: st.x[e], z: st.z[e] });
  }
  st.carry[e] = 0;
  const n = st.lastNode[e];
  if (n >= 0 && st.valid(n, st.lastNodeGen[e])) return retarget(sim, e, n);
  const t2 = findReplacement(sim, e);
  return t2 >= 0 ? retarget(sim, e, t2) : ECO.NONE;
}

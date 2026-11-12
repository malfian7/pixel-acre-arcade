// Frontier Crown — treasure Guardian AI as a finite-state machine (one record per guardian).
//
//             intruder within `aggro` tiles of the chest,          target dead → next intruder
//             or a guardian of the same pack is struck              in reach of the chest, if any
//   IDLE ───────────────────────────────────────────────► AGGRO ◄──────────────────────┐
//    ▲  (pace near the post, regenerate)                   │  chase + bite/slash ───────┘
//    │                                                     │ more than `leash` tiles from the post,
//    │ back at the post: full health                       │ or nobody left to fight
//    └──────────────────────────── LEASH ◄─────────────────┘
//                                 (walk home, ignore attacks, regenerate fast)
//
// Guardians are owned by WILD (hostile to both players); the combat system skips them, this
// system moves and fights for them through the same sim primitives (moveToEntity, damage, events).

import { TICK } from "../core/core.js";
import { DEF_LIST, WILD } from "../data/defs.js";
import { TREASURE_RULES } from "../data/treasures.js";
import { CM, S } from "./ecs.js";

export const G = { IDLE: 0, AGGRO: 1, LEASH: 2 };
export const G_NAME = ["Idle", "Aggro", "Leash"];

/** Register a guardian posted at (hx, hz) for treasure t. */
export function addGuardian(sim, e, t, hx, hz, kind) {
  sim.guards.set(e, { state: G.IDLE, hx, hz, t, kind, target: -1, targetGen: 0, wander: 40 + (e % 60), scan: e % 6 });
}

const isIntruder = (st, x) => st.alive[x] && st.owner[x] < 2 && (st.mask[x] & CM.UNIT) && st.hp[x] > 0;

/** Nearest player unit within r of (x, z), or -1. */
function nearestIntruder(sim, x, z, r) {
  const st = sim.st;
  let best = -1, bd = r * r;
  sim.hash.each(x, z, r, (u) => {
    if (!isIntruder(st, u)) return;
    const d = (st.x[u] - x) ** 2 + (st.z[u] - z) ** 2;
    if (d < bd) { bd = d; best = u; }
  });
  return best;
}

function enter(sim, e, g, state, target = -1) {
  const st = sim.st;
  if (g.state === state && (state !== G.AGGRO || g.target === target)) return;
  g.state = state;
  if (state === G.AGGRO) {
    g.target = target; g.targetGen = st.gen[target]; st.state[e] = S.ATTACK;
    sim.events.push("guardAggro", { e, t: target, x: st.x[e], z: st.z[e], post: g.t });
  } else if (state === G.LEASH) {
    g.target = -1; st.state[e] = S.MOVE;
    sim.moveToPoint(e, g.hx, g.hz);
  } else { g.target = -1; st.state[e] = S.IDLE; sim.stopMoving(e); }
}

/** The whole pack of a treasure turns on the intruder together. */
function rousePack(sim, rec, target) {
  for (const k of rec.guards) {
    const g = sim.guards.get(k);
    if (g && g.state === G.IDLE && sim.st.alive[k]) enter(sim, k, g, G.AGGRO, target);
  }
}

export function guardianSystem(sim) {
  const st = sim.st;
  for (const [e, g] of sim.guards) {
    if (!st.alive[e] || st.hp[e] <= 0) { sim.guards.delete(e); continue; }
    const d = DEF_LIST[st.def[e]], K = g.kind, rec = sim.treasures.get(g.t);
    const fromPost = Math.hypot(st.x[e] - g.hx, st.z[e] - g.hz);
    // (attack cooldown and the animation pulse decay in the combat system, shared by all attackers)

    if (g.state === G.IDLE) {
      if (st.hitT[e] > 5) st.hp[e] = Math.min(st.maxHp[e], st.hp[e] + st.maxHp[e] * 0.02 * TICK); // slow rest regen
      // struck from range (a musket outranges the aggro radius): the pack answers
      const la = st.lastAttacker[e];
      if (st.hitT[e] < 0.5 && la >= 0 && isIntruder(st, la)) { if (rec) rousePack(sim, rec, la); else enter(sim, e, g, G.AGGRO, la); continue; }
      if (--g.scan <= 0) {
        g.scan = 6;
        const cx = rec ? st.x[g.t] : g.hx, cz = rec ? st.z[g.t] : g.hz;
        const u = nearestIntruder(sim, cx, cz, K.aggro);
        if (u >= 0) { if (rec) rousePack(sim, rec, u); else enter(sim, e, g, G.AGGRO, u); continue; }
      }
      // pace around the post now and then
      if (--g.wander <= 0) {
        g.wander = 80 + Math.floor(sim.rng() * 120);
        const a = sim.rng() * Math.PI * 2, r = 0.6 + sim.rng() * 1.2;
        sim.moveToPoint(e, g.hx + Math.cos(a) * r, g.hz + Math.sin(a) * r);
      }
      continue;
    }

    if (g.state === G.LEASH) {
      st.hp[e] = Math.min(st.maxHp[e], st.hp[e] + st.maxHp[e] * TREASURE_RULES.regenLeash * TICK);
      if (fromPost < 0.8 || sim.pathDone(e)) { st.hp[e] = st.maxHp[e]; enter(sim, e, g, G.IDLE); }
      continue;
    }

    // ---- AGGRO
    if (fromPost > K.leash) { enter(sim, e, g, G.LEASH); continue; }
    let t = g.target;
    if (t < 0 || !st.valid(t, g.targetGen) || !isIntruder(st, t)) {
      const cx = rec ? st.x[g.t] : g.hx, cz = rec ? st.z[g.t] : g.hz;
      t = nearestIntruder(sim, cx, cz, K.aggro + 3);
      if (t < 0) { enter(sim, e, g, G.LEASH); continue; }
      g.target = t; g.targetGen = st.gen[t]; st.repath[e] = 0;
    }
    const dist = sim.edgeDist(st.x[e], st.z[e], t) - d.radius;
    if (dist <= d.atk.range + 0.15) {
      if (st.moving[e]) sim.stopMoving(e);
      st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
      if (st.cd[e] <= 0) {
        st.cd[e] = d.atk.rof; st.act[e] = 1;
        sim.events.push("shot", { e, t, kind: "melee", x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t], p: WILD, def: st.def[e] });
        sim.damage(e, t, d.atk.dmg, "melee");
      }
    } else if (sim.pathDone(e) || ++st.repath[e] > 10) {
      st.repath[e] = 0;
      if (dist < 2) sim.moveToPoint(e, st.x[t], st.z[t]); // close the last stretch to the exact point
      else sim.moveToEntity(e, t, 0.3);
    }
  }
}

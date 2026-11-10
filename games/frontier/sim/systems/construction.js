// ConstructionSystem — villagers raise foundations; finished buildings join the economy.

import { TICK } from "../../core/core.js";
import { DEF_LIST } from "../../data/defs.js";
import { CM, S } from "../ecs.js";
import { startGather, startBuild } from "./command.js";

const builders = new Map();

export function constructionSystem(sim) {
  const st = sim.st;
  builders.clear();
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || st.state[e] !== S.BUILD) continue;
    if (!st.targetOk(e) || st.prog[st.tgt[e]] >= 1) { nextJob(sim, e); continue; }
    const t = st.tgt[e];
    const dist = sim.edgeDist(st.x[e], st.z[e], t);
    if (dist > 0.85) {
      if (sim.pathDone(e)) { if (++st.tries[e] > 6) { st.tries[e] = 0; st.state[e] = S.IDLE; continue; } sim.moveToEntity(e, t, 0.5); }
      continue;
    }
    sim.stopMoving(e); st.tries[e] = 0;
    st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
    st.act[e] = 1;
    if (((sim.tick + e) % 16) === 0) sim.events.push("work", { e, gt: "build", x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t] });
    builders.set(t, (builders.get(t) || 0) + 1);
  }
  for (const [t, n] of builders) {
    const d = DEF_LIST[st.def[t]];
    const rate = (n === 1 ? 1 : 1 + (n - 1) * 0.75) / d.build;
    const add = Math.min(1 - st.prog[t], rate * TICK);
    st.prog[t] += add; st.hp[t] = Math.min(st.maxHp[t], st.hp[t] + add * d.hp * 0.9);
    if (st.prog[t] >= 1) {
      st.prog[t] = 1;
      const pl = sim.players[st.owner[t]]; pl.stats.built++;
      sim.events.push("built", { e: t, p: st.owner[t] });
      sim.recount();
    }
  }
}

function nextJob(sim, e) {
  const st = sim.st, t = st.tgt[e];
  if (st.targetOk(e) && DEF_LIST[st.def[t]].farm && st.prog[t] >= 1) { startGather(sim, e, t); return; }
  const o = st.owner[e];
  const site = sim.nearest(st.x[e], st.z[e], (b) => st.owner[b] === o && (st.mask[b] & CM.BUILDING) && st.prog[b] < 1, 14);
  if (site >= 0) { startBuild(sim, e, site); return; }
  // resume the last job if there was one
  if (st.lastNode[e] >= 0 && st.valid(st.lastNode[e], st.lastNodeGen[e])) { startGather(sim, e, st.lastNode[e]); return; }
  st.state[e] = S.IDLE; st.tgt[e] = -1; st.gx[e] = st.x[e]; st.gz[e] = st.z[e];
}

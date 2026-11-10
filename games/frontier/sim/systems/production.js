// ProductionSystem — training queues, Age advancement.

import { TICK } from "../../core/core.js";
import { DEF_LIST } from "../../data/defs.js";
import { CM, S } from "../ecs.js";
import { exitPoint, startGather, startBuild } from "./command.js";

export function productionSystem(sim) {
  const st = sim.st;
  for (const [b, q] of st.queue) {
    if (!st.alive[b]) { st.queue.delete(b); continue; }
    if (!q.items.length || st.prog[b] < 1) continue;
    const o = st.owner[b], pl = sim.players[o], d = DEF_LIST[q.items[0]];
    if (pl.popUsed + d.pop > pl.popCap) { q.blocked = true; continue; }
    q.blocked = false;
    q.t += TICK;
    if (q.t >= d.train) {
      const pos = exitPoint(sim, b);
      if (!pos) continue;
      q.items.shift(); q.t = 0;
      const e = sim.spawnUnit(d.idx, o, pos[0], pos[1]);
      st.rot[e] = st.prot[e] = Math.atan2(pos[0] - st.x[b], pos[1] - st.z[b]);
      pl.popUsed += d.pop; pl.stats.trained++;
      sim.events.push("trained", { e, p: o });
      applyRally(sim, b, e);
    }
  }
  for (const pl of sim.players) {
    if (!pl.aging) continue;
    if (pl.tc < 0 || !st.alive[pl.tc]) { pl.aging = null; continue; }
    pl.aging.t += TICK;
    if (pl.aging.t >= pl.aging.total) {
      pl.age = pl.aging.to; pl.aging = null; pl.pendingShip = pl.age;
      sim.events.push("age", { p: pl.id, age: pl.age });
    }
  }
}

function applyRally(sim, b, e) {
  const st = sim.st, r = st.rally.get(b);
  if (!r) { st.gx[e] = st.x[e]; st.gz[e] = st.z[e]; return; }
  const t = r.tgt;
  if (t >= 0 && st.valid(t, r.tgtGen) && (st.mask[e] & CM.GATHERER)) {
    const td = DEF_LIST[st.def[t]];
    if ((st.mask[t] & CM.RESOURCE) || (td.farm && st.owner[t] === st.owner[e] && st.prog[t] >= 1)) { startGather(sim, e, t); return; }
    if ((st.mask[t] & CM.BUILDING) && st.owner[t] === st.owner[e] && st.prog[t] < 1) { startBuild(sim, e, t); return; }
  }
  st.state[e] = S.MOVE; st.tx[e] = st.gx[e] = r.x; st.tz[e] = st.gz[e] = r.z;
  sim.moveToPoint(e, r.x + (sim.rng() - 0.5) * 1.2, r.z + (sim.rng() - 0.5) * 1.2);
}

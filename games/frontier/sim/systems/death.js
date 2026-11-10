// DeathSystem — remove destroyed entities, free their tiles, credit the killer.

import { DEF_LIST } from "../../data/defs.js";
import { CM } from "../ecs.js";
import { BL } from "../map.js";

export function deathSystem(sim) {
  const st = sim.st;
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || !(st.mask[e] & CM.HEALTH) || st.hp[e] > 0) continue;
    if (st.mask[e] & CM.RESOURCE) continue; // animals are "killed" via the dead flag
    const d = DEF_LIST[st.def[e]], o = st.owner[e];
    const k = st.lastAttacker[e], ko = k >= 0 && st.alive[k] ? st.owner[k] : -1;
    sim.events.push("died", { e, def: st.def[e], owner: o, x: st.x[e], z: st.z[e], rot: st.rot[e], building: d.kind === "building", prog: st.prog[e] });
    if (o < 2) {
      const pl = sim.players[o];
      if (d.kind === "unit") pl.stats.lost++;
      if (ko >= 0 && ko < 2 && ko !== o) { const kp = sim.players[ko]; if (d.kind === "unit") kp.stats.killed++; else kp.stats.razed++; }
      if (pl.tc === e) pl.tc = -1;
    }
    if (st.mask[e] & CM.FOOTPRINT) { const r = sim.tileRect(e); sim.grid.stamp(r.x0, r.z0, d.size, BL.BLD, -1); }
    st.destroy(e);
  }
}

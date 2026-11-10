// FogSystem — stamps every entity's sight radius into per-player visibility grids.

import { DEF_LIST } from "../../data/defs.js";
import { CM } from "../ecs.js";
import { W, H } from "../map.js";

const spans = new Map(); // radius -> half-widths per row
function spanFor(r) {
  let s = spans.get(r);
  if (!s) { s = []; for (let dj = -r; dj <= r; dj++) s.push(Math.floor(Math.sqrt(r * r - dj * dj))); spans.set(r, s); }
  return s;
}

export function fogSystem(sim, first = false) {
  const st = sim.st, g = sim.grid;
  for (let p = 0; p < 2; p++) g.vis[p].fill(0);
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || !(st.mask[e] & CM.VISION)) continue;
    const p = st.owner[e]; if (p > 1) continue;
    const d = DEF_LIST[st.def[e]];
    const r = Math.round(st.prog[e] < 1 ? 4 : d.vision + (d.size ? d.size / 2 : 0));
    const vis = g.vis[p], exp = g.exp[p], s = spanFor(r);
    const ci = Math.floor(st.x[e]), cj = Math.floor(st.z[e]);
    for (let dj = -r; dj <= r; dj++) {
      const j = cj + dj; if (j < 0 || j >= H) continue;
      const hw = s[dj + r], i0 = Math.max(0, ci - hw), i1 = Math.min(W - 1, ci + hw), row = j * W;
      for (let i = i0; i <= i1; i++) { vis[row + i] = 1; exp[row + i] = 1; }
    }
  }
  if (first) sim.fogVersion = 0;
  sim.fogVersion = (sim.fogVersion || 0) + 1;
}

export function visibleTo(sim, p, x, z) {
  const i = Math.floor(x), j = Math.floor(z);
  if (i < 0 || j < 0 || i >= W || j >= H) return false;
  return sim.grid.vis[p][j * W + i] === 1;
}

// CombatSystem — target acquisition, chasing, volleys, bayonets, cannon shells.

import { TICK } from "../../core/core.js";
import { DEF_LIST, C, bonusMult } from "../../data/defs.js";
import { CM, S } from "../ecs.js";
import { W } from "../map.js";
import { startAttack } from "./command.js";

// Best enemy near (x,z) within r: units first (closest), then buildings.
export function findEnemy(sim, e, x, z, r, unitsOnly = false) {
  const st = sim.st, o = st.owner[e];
  let best = -1, bd = r * r;
  sim.hash.each(x, z, r, (t) => {
    if (!st.alive[t] || st.owner[t] === o || st.owner[t] > 1) return;
    const dd = (st.x[t] - x) ** 2 + (st.z[t] - z) ** 2;
    if (dd < bd) { bd = dd; best = t; }
  });
  if (best >= 0 || unitsOnly) return best;
  // buildings: scan footprint occupancy in a square
  const g = sim.grid, i0 = Math.max(0, Math.floor(x - r)), i1 = Math.min(W - 1, Math.floor(x + r));
  const j0 = Math.max(0, Math.floor(z - r)), j1 = Math.min(W - 1, Math.floor(z + r));
  let bdist = r;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const t = g.occ[j * W + i];
    if (t < 0 || !st.alive[t] || !(st.mask[t] & CM.BUILDING) || st.owner[t] === o || st.owner[t] > 1) continue;
    const dd = Math.hypot(i + 0.5 - x, j + 0.5 - z);
    if (dd < bdist) { bdist = dd; best = t; }
  }
  return best;
}

function fire(sim, e, t, prof, type) {
  const st = sim.st, td = DEF_LIST[st.def[t]];
  st.act[e] = 1;
  st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
  if (type === "siege") {
    const tx = st.x[t], tz = st.z[t], dist = Math.hypot(tx - st.x[e], tz - st.z[e]);
    sim.projectiles.push({ x: st.x[e], z: st.z[e], tx, tz, t: 0, T: 0.35 + dist / 16, dmg: prof.dmg, prof, owner: st.owner[e], src: e });
    sim.events.push("shot", { e, t, kind: "cannon", x: st.x[e], z: st.z[e], tx, tz, p: st.owner[e] });
    return;
  }
  const dmg = prof.dmg * bonusMult(prof, td);
  sim.events.push("shot", { e, t, kind: type, x: st.x[e], z: st.z[e], tx: st.x[t], tz: st.z[t], p: st.owner[e], def: st.def[e] });
  sim.damage(e, t, dmg, type);
}

export function combatSystem(sim) {
  const st = sim.st;
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || !(st.mask[e] & CM.ATTACKER)) continue;
    if (st.cd[e] > 0) st.cd[e] -= TICK;
    if (st.act[e] > 0 && st.state[e] !== S.GATHER) st.act[e] = Math.max(0, st.act[e] - TICK * 2.5);
    const d = DEF_LIST[st.def[e]];
    if (st.mask[e] & CM.BUILDING) { towerFire(sim, e, d); continue; }
    const s = st.state[e];
    const military = !(d.cls & C.VIL);
    if (s === S.IDLE || s === S.MOVE) {
      // retaliate when struck, or auto-acquire (military only)
      const la = st.lastAttacker[e];
      if (s === S.IDLE && la >= 0 && st.alive[la] && st.hitT[e] < 1 && military && sim.enemies(st.owner[e], st.owner[la])) { startAttack(sim, e, la, 2); continue; }
      if (s === S.IDLE && military && --st.scan[e] <= 0) {
        st.scan[e] = 8;
        const t = findEnemy(sim, e, st.x[e], st.z[e], d.vision);
        if (t >= 0) { startAttack(sim, e, t, 2); continue; }
      }
      continue;
    }
    if (s === S.AMOVE) {
      if (--st.scan[e] <= 0) {
        st.scan[e] = 6;
        const t = findEnemy(sim, e, st.x[e], st.z[e], d.vision);
        if (t >= 0) { startAttack(sim, e, t, 1); continue; }
      }
      if (sim.pathDone(e)) { st.state[e] = S.IDLE; st.gx[e] = st.x[e]; st.gz[e] = st.z[e]; }
      continue;
    }
    if (s !== S.ATTACK) continue;
    if (!st.targetOk(e) || st.hp[st.tgt[e]] <= 0) {
      const t = military ? findEnemy(sim, e, st.x[e], st.z[e], d.vision) : -1;
      if (t >= 0) { startAttack(sim, e, t, st.amove[e]); continue; }
      if (st.amove[e] === 1) { st.state[e] = S.AMOVE; sim.moveToPoint(e, st.tx[e], st.tz[e]); }
      else { st.state[e] = S.IDLE; sim.stopMoving(e); }
      continue;
    }
    const t = st.tgt[e];
    // leash for auto-acquired targets
    if (st.amove[e] === 2 && Math.hypot(st.x[e] - st.gx[e], st.z[e] - st.gz[e]) > 18) {
      st.state[e] = S.MOVE; st.tgt[e] = -1; sim.moveToPoint(e, st.gx[e], st.gz[e]); continue;
    }
    const dist = sim.edgeDist(st.x[e], st.z[e], t) - d.radius;
    let prof = d.atk, type = d.atk.type;
    if (d.melee && dist < 1.1 && !(st.mask[t] & CM.BUILDING)) { prof = d.melee; type = "melee"; }
    // ranged units hit buildings with a torch/bayonet (melee)
    if (d.melee && (st.mask[t] & CM.BUILDING)) { prof = d.melee; type = "melee"; }
    const range = prof === d.melee ? 0.7 : prof.range;
    if (dist <= range + 0.15) {
      if (st.moving[e]) sim.stopMoving(e);
      st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
      if (st.cd[e] <= 0) { fire(sim, e, t, prof, type); st.cd[e] = prof.rof; }
    } else {
      const moving = (st.mask[t] & CM.MOVER) !== 0;
      if (sim.pathDone(e) || (moving && ++st.repath[e] > 16)) { st.repath[e] = 0; sim.moveToEntity(e, t, Math.max(0.3, range * 0.85)); }
    }
  }
}

function towerFire(sim, e, d) {
  const st = sim.st;
  if (st.prog[e] < 1 || st.cd[e] > 0) return;
  const t = findEnemy(sim, e, st.x[e], st.z[e], d.atk.range + d.size / 2, true);
  if (t < 0) return;
  st.cd[e] = d.atk.rof;
  fire(sim, e, t, d.atk, d.atk.type);
}

export function projectileSystem(sim) {
  const st = sim.st, P = sim.projectiles;
  for (let k = P.length - 1; k >= 0; k--) {
    const p = P[k];
    p.t += TICK;
    if (p.t < p.T) continue;
    P.splice(k, 1);
    const R = p.prof.splash || 1;
    sim.events.push("explode", { x: p.tx, z: p.tz, p: p.owner });
    const hit = new Set();
    sim.hash.each(p.tx, p.tz, R + 0.8, (t) => {
      if (!st.alive[t] || st.owner[t] === p.owner || st.owner[t] > 1) return;
      const dd = Math.hypot(st.x[t] - p.tx, st.z[t] - p.tz);
      if (dd > R + DEF_LIST[st.def[t]].radius) return;
      hit.add(t);
      const fall = 1 - 0.5 * Math.min(1, dd / R);
      sim.damage(p.src, t, p.dmg * fall * bonusMult(p.prof, DEF_LIST[st.def[t]]), "siege");
    });
    const g = sim.grid;
    for (let j = Math.floor(p.tz - R); j <= Math.floor(p.tz + R); j++) for (let i = Math.floor(p.tx - R); i <= Math.floor(p.tx + R); i++) {
      if (i < 0 || j < 0 || i >= W || j >= W) continue;
      const t = g.occ[j * W + i];
      if (t < 0 || hit.has(t) || !st.alive[t] || !(st.mask[t] & CM.BUILDING) || st.owner[t] === p.owner) continue;
      hit.add(t);
      sim.damage(p.src, t, p.dmg * bonusMult(p.prof, DEF_LIST[st.def[t]]), "siege");
    }
  }
}

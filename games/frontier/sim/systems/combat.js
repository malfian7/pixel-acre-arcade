// CombatSystem — target acquisition, chasing, volleys, bayonets, cannon shells.

import { TICK } from "../../core/core.js";
import { DEF_LIST, C, bonusMult } from "../../data/defs.js";
import { CM, S } from "../ecs.js";
import { W } from "../map.js";
import { startAttack } from "./command.js";
import { launchVelocity, ballisticAt, flightTime } from "../ballistics.js";

// Best enemy near (x,z) within r: units first (closest), then buildings.
export function findEnemy(sim, e, x, z, r, unitsOnly = false) {
  const st = sim.st, o = st.owner[e];
  let best = -1, bd = r * r;
  sim.hash.each(x, z, r, (t) => {
    if (!st.alive[t] || !sim.enemies(o, st.owner[t]) || st.hp[t] <= 0) return;
    // treasure guardians are never picked up automatically while they sit at their post —
    // only when they are actively fighting (Aggro). Attacking a camp is always the player's choice.
    if (st.owner[t] === 3) { const g = sim.guards.get(t); if (!g || g.state !== 1) return; }
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
    if (t < 0 || !st.alive[t] || !(st.mask[t] & CM.BUILDING) || !sim.enemies(o, st.owner[t])) continue;
    const dd = Math.hypot(i + 0.5 - x, j + 0.5 - z);
    if (dd < bdist) { bdist = dd; best = t; }
  }
  return best;
}

function fire(sim, e, t, prof, type) {
  const st = sim.st, td = DEF_LIST[st.def[t]];
  st.act[e] = 1;
  st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
  if (type === "siege" || type === "grenade") {
    // ballistic shell: solved launch velocity (sim/ballistics.js); damage lands where it hits
    const g = type === "grenade", gr = sim.grid;
    let tx = st.x[t], tz = st.z[t];
    const T = flightTime(Math.hypot(tx - st.x[e], tz - st.z[e]), g);
    if (st.mask[t] & CM.MOVER) { tx += st.vx[t] * T * 0.6; tz += st.vz[t] * T * 0.6; } // lead a walking target a little
    const dx = tx - st.x[e], dz = tz - st.z[e], L = Math.hypot(dx, dz) || 1;
    const x0 = st.x[e] + (g ? 0 : dx / L * 0.9), z0 = st.z[e] + (g ? 0 : dz / L * 0.9);  // cannon muzzle / thrower's hand
    const y0 = gr.heightAt(st.x[e], st.z[e]) + (g ? 1.5 : 0.62);
    const ty = (st.mask[t] & CM.BUILDING) ? gr.heightAt(tx, tz) + (DEF_LIST[st.def[t]].h || 2) * 0.45 : gr.heightAt(tx, tz) + 0.35;
    const [vx, vy, vz] = launchVelocity(x0, y0, z0, tx, ty, tz, T);
    sim.projectiles.push({ x0, y0, z0, vx, vy, vz, t: 0, T, x: x0, y: y0, z: z0, tx, tz, dmg: prof.dmg, prof, owner: st.owner[e], src: e, kind: g ? 1 : 0, aim: t });
    sim.events.push("shot", { e, t, kind: g ? "grenade" : "cannon", x: st.x[e], z: st.z[e], tx, tz, p: st.owner[e] });
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
    if (d.guardian) continue; // treasure guardians: sim/guardians.js
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
    // an auto-acquired guardian that gave up (Leash/Idle) is let go — don't chase it back to its den
    if (st.amove[e] === 2 && st.owner[t] === 3) { const g = sim.guards.get(t); if (!g || g.state !== 1) { st.state[e] = S.IDLE; st.tgt[e] = -1; sim.stopMoving(e); continue; } }
    // leash for auto-acquired targets
    if (st.amove[e] === 2 && Math.hypot(st.x[e] - st.gx[e], st.z[e] - st.gz[e]) > 18) {
      st.state[e] = S.MOVE; st.tgt[e] = -1; sim.moveToPoint(e, st.gx[e], st.gz[e]); continue;
    }
    const dist = sim.edgeDist(st.x[e], st.z[e], t) - d.radius;
    let prof = d.atk, type = d.atk.type;
    if (d.melee && dist < 1.1 && !(st.mask[t] & CM.BUILDING)) { prof = d.melee; type = "melee"; }
    // ranged units hit buildings with a torch/bayonet (melee)
    // (grenades are the exception: they are meant for walls)
    if (d.melee && (st.mask[t] & CM.BUILDING) && d.atk.type !== "grenade") { prof = d.melee; type = "melee"; }
    const range = prof === d.melee ? 0.7 : prof.range;
    if (dist <= range + 0.15) {
      if (st.moving[e]) sim.stopMoving(e);
      st.rot[e] = Math.atan2(st.x[t] - st.x[e], st.z[t] - st.z[e]);
      if (st.cd[e] <= 0) { fire(sim, e, t, prof, type); st.cd[e] = prof.rof; }
    } else {
      const moving = (st.mask[t] & CM.MOVER) !== 0;
      if (sim.pathDone(e) || (moving && ++st.repath[e] > 16)) {
        st.repath[e] = 0;
        // tile-level pathing calls a unit "arrived" one tile away; the last stretch to a unit goes to its exact point
        if (moving && dist < 2) sim.moveToPoint(e, st.x[t], st.z[t]); else sim.moveToEntity(e, t, Math.max(0.3, range * 0.85));
      }
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

// Shells fly on their parabola; each tick the segment is tested against terrain and building boxes,
// so a ridge or a wall in the way catches the ball. On impact: splash damage with linear falloff and
// a knockback impulse (away from the blast, scaled by distance and the victim's weight).
const PT = [0, 0, 0];
export function projectileSystem(sim) {
  const st = sim.st, P = sim.projectiles, g = sim.grid;
  for (let k = P.length - 1; k >= 0; k--) {
    const p = P[k];
    p.t += TICK;
    const t = Math.min(p.t, p.T);
    ballisticAt(p, t, PT);
    let hit = t >= p.T;
    if (!hit && p.t > 0.12) {
      const gy = g.heightAt(PT[0], PT[2]);
      if (PT[1] <= gy + 0.05) hit = true;                                   // ploughs into a hill
      else {
        const i = Math.floor(PT[0]), j = Math.floor(PT[2]);
        const b = i >= 0 && j >= 0 && i < W && j < W ? g.occ[j * W + i] : -1;
        if (b >= 0 && st.alive[b] && (st.mask[b] & CM.BUILDING) && sim.enemies(p.owner, st.owner[b]) && PT[1] <= gy + (DEF_LIST[st.def[b]].h || 2)) hit = true; // a wall in the way
      }
    }
    p.x = PT[0]; p.y = PT[1]; p.z = PT[2];
    if (!hit) continue;
    P.splice(k, 1);
    impact(sim, p, PT[0], PT[2]);
  }
}

function impact(sim, p, ix, iz) {
  const st = sim.st, R = p.prof.splash || 1;
  const power = p.kind === 1 ? 3.2 : 5.5;
  sim.events.push("explode", { x: ix, z: iz, p: p.owner, small: p.kind === 1, r: R });
  const hit = new Set();
  sim.hash.each(ix, iz, R + 0.8, (t) => {
    if (!st.alive[t] || !sim.enemies(p.owner, st.owner[t])) return;
    const dx = st.x[t] - ix, dz = st.z[t] - iz, dd = Math.hypot(dx, dz);
    const td = DEF_LIST[st.def[t]];
    if (dd > R + td.radius) return;
    hit.add(t);
    const fall = 1 - 0.5 * Math.min(1, dd / R);
    // knockback: away from the blast centre, weaker at the edge, heavy units barely move
    const heavy = td.cls & (C.CAV | C.ART) ? 0.3 : 1;
    const kp = power * fall * heavy, nx = dd > 1e-3 ? dx / dd : Math.cos(t), nz = dd > 1e-3 ? dz / dd : Math.sin(t);
    st.kx[t] = nx * kp; st.kz[t] = nz * kp; st.knockT[t] = 0.35;
    st.bx[t] = ix; st.bz[t] = iz; st.blastT[t] = sim.time;           // remembered for the ragdoll if this kills it
    sim.damage(p.src, t, p.dmg * fall * bonusMult(p.prof, td), "siege");
    sim.events.push("knock", { e: t, nx, nz, power: kp });
  });
  const g = sim.grid;
  for (let j = Math.floor(iz - R); j <= Math.floor(iz + R); j++) for (let i = Math.floor(ix - R); i <= Math.floor(ix + R); i++) {
    if (i < 0 || j < 0 || i >= W || j >= W) continue;
    const t = g.occ[j * W + i];
    if (t < 0 || hit.has(t) || !st.alive[t] || !(st.mask[t] & CM.BUILDING) || !sim.enemies(p.owner, st.owner[t])) continue;
    hit.add(t);
    st.bx[t] = ix; st.bz[t] = iz; st.blastT[t] = sim.time;
    sim.damage(p.src, t, p.dmg * bonusMult(p.prof, DEF_LIST[st.def[t]]), "siege");
  }
}

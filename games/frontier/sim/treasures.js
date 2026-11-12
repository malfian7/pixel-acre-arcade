// Frontier Crown — Treasure nodes: placement, the claim rule, rewards.
//
// Claim rule (the whole mechanic in one line):
//   a player unit may open a treasure when it stands next to the chest AND every guardian posted
//   to that chest has hp <= 0 (dead) AND the unit is allowed by the kind's `claimBy`
//   ("any" land unit, or "explorer" only).
//
// Units claim in two ways: an explicit order (right-click → state CLAIM, walk, try), or simply
// walking over an unguarded chest (checked every few ticks around each chest).
// Rewards are rolled once, when the treasure is placed, from the seeded sim RNG — deterministic
// for replays and shown in the tooltip before anyone commits an army to it.

import { DEFS, DEF_LIST, GAIA, WILD } from "../data/defs.js";
import { TREASURE_KINDS, TREASURE_RULES } from "../data/treasures.js";
import { CM, S } from "./ecs.js";
import { startAttack } from "./systems/command.js";
import { BL, W, H } from "./map.js";
import { addGuardian } from "./guardians.js";
import { credit } from "./economy/ledger.js";
import { addXP } from "./economy/shipments.js";

const RES_NAME = ["Food", "Wood", "Coin"];
const roll = (rng, [a, b]) => Math.round((a + rng() * (b - a)) / 5) * 5;
function pickWeighted(rng, list) {
  const tot = list.reduce((s, x) => s + (x.w ?? x.weight ?? 1), 0);
  let r = rng() * tot;
  for (const x of list) { r -= x.w ?? x.weight ?? 1; if (r <= 0) return x; }
  return list[list.length - 1];
}

export function rewardLabel(rw) {
  if (rw.res != null) return `${rw.amount} ${RES_NAME[rw.res]}`;
  if (rw.xp) return `${rw.xp} XP`;
  return rw.label || "Reinforcements";
}

// ------------------------------------------------------------------ placement
function openAround(g, i, j, r) {
  for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) if (!g.passable(i + di, j + dj)) return false;
  return true;
}

/** Place TREASURE_RULES.pairs mirrored pairs of treasures with their guardian packs. */
export function placeTreasures(sim) {
  const g = sim.grid, st = sim.st, rng = sim.rng;
  const tcs = sim.players.map((p) => (p.tc >= 0 ? [st.x[p.tc], st.z[p.tc]] : [64, 64]));
  const kinds = Object.entries(TREASURE_KINDS).map(([id, k]) => ({ id, ...k }));
  const spots = [];
  // starting resources near each colony (berries, gold, hunt) must stay outside every guardian ring
  const keepClear = [];
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || !(st.mask[e] & CM.RESOURCE)) continue;
    const id = DEF_LIST[st.def[e]].id;
    if (id === "tree") continue;
    if (tcs.some(([x, z]) => Math.hypot(st.x[e] - x, st.z[e] - z) < 34)) keepClear.push([st.x[e], st.z[e]]);
  }
  const ok = (i, j) => {
    if (!g.canPlace(i, j, 1) || !openAround(g, i, j, 2)) return false;
    for (const [x, z] of keepClear) if (Math.hypot(i + 0.5 - x, j + 0.5 - z) < TREASURE_RULES.clearOfResources) return false;
    for (const [x, z] of tcs) if (Math.hypot(i + 0.5 - x, j + 0.5 - z) < TREASURE_RULES.minFromTC) return false;
    for (const [a, b] of spots) if (Math.hypot(i - a, j - b) < TREASURE_RULES.minApart) return false;
    return true;
  };
  for (let n = 0, tries = 0; n < TREASURE_RULES.pairs && tries < 4000; tries++) {
    const i = 4 + Math.floor(rng() * (W - 8)), j = 4 + Math.floor(rng() * (H - 8));
    const mi = W - 1 - i, mj = H - 1 - j;
    if (Math.hypot(i - mi, j - mj) < TREASURE_RULES.minApart || !ok(i, j)) continue;
    spots.push([i, j]);
    if (!ok(mi, mj)) { spots.pop(); continue; }
    spots.push([mi, mj]);
    const kind = pickWeighted(rng, kinds);
    const reward = pickWeighted(rng, kind.rewards);
    const rw = reward.res != null ? { res: reward.res, amount: roll(rng, reward.amount) } : reward.xp ? { xp: roll(rng, reward.xp) } : { units: reward.units, label: reward.label };
    const guards = kind.guards.map(([def, a, b]) => [def, a + Math.floor(rng() * (b - a + 1))]);
    for (const [ti, tj] of [[i, j], [mi, mj]]) spawnTreasure(sim, ti, tj, kind, rw, guards);
    n++;
  }
}

function spawnTreasure(sim, i, j, kind, reward, guards) {
  const st = sim.st, t = sim.spawnResource(DEFS.treasure.idx, i, j); // stamps the tile like any node
  st.owner[t] = GAIA;
  const rec = { kind: kind.id, claimBy: kind.claimBy, reward: { ...reward }, guards: [], name: kind.name };
  sim.treasures.set(t, rec);
  let k = 0;
  const total = guards.reduce((s, [, n]) => s + n, 0);
  for (const [def, n] of guards) for (let q = 0; q < n; q++, k++) {
    const a = (k / Math.max(1, total)) * Math.PI * 2 + (i * 0.37), r = 1.8 + (k % 2) * 0.6;
    const x = i + 0.5 + Math.cos(a) * r, z = j + 0.5 + Math.sin(a) * r;
    const e = sim.spawnUnit(DEFS[def].idx, WILD, x, z);
    st.rot[e] = st.prot[e] = Math.atan2(x - (i + 0.5), z - (j + 0.5)); // face outward
    addGuardian(sim, e, t, x, z, TREASURE_KINDS[kind.id]);
    rec.guards.push(e);
  }
}

// ------------------------------------------------------------------ claiming
export function guardsLeft(sim, t) {
  const rec = sim.treasures.get(t), st = sim.st;
  if (!rec) return 0;
  let n = 0;
  for (const g of rec.guards) if (st.alive[g] && st.hp[g] > 0) n++;
  return n;
}

export function canClaim(sim, e, t) {
  const st = sim.st, rec = sim.treasures.get(t);
  if (!rec || !st.alive[t]) return { ok: false, why: "Gone" };
  const left = guardsLeft(sim, t);
  if (left > 0) return { ok: false, why: `${left} guardian${left > 1 ? "s" : ""} still protect${left > 1 ? "" : "s"} this treasure`, guarded: true };
  if (rec.claimBy === "explorer" && !DEF_LIST[st.def[e]].explorer) return { ok: false, why: "Only an Explorer can open this treasure" };
  return { ok: true };
}

export function startClaim(sim, e, t) {
  const st = sim.st;
  st.state[e] = S.CLAIM; st.setTarget(e, t); st.tries[e] = 0;
  sim.moveToEntity(e, t, 0.3);
}

function claim(sim, e, t) {
  const st = sim.st, rec = sim.treasures.get(t), p = st.owner[e], pl = sim.players[p], rw = rec.reward;
  const x = st.x[t], z = st.z[t], units = [];
  if (rw.res != null) credit(pl, rw.res, rw.amount, false);
  if (rw.xp) addXP(sim, p, rw.xp, "treasure");
  if (rw.units) {
    let k = 0;
    for (const [def, n] of rw.units) for (let q = 0; q < n; q++, k++) {
      const a = k * 2.1, u = sim.spawnUnit(DEFS[def].idx, p, x + Math.cos(a) * 1.2, z + Math.sin(a) * 1.2);
      st.gx[u] = st.x[u]; st.gz[u] = st.z[u]; units.push(u);
    }
    sim.recount();
  }
  pl.stats.treasures = (pl.stats.treasures || 0) + 1;
  sim.events.push("treasureClaimed", { p, e, t, x, z, kind: rec.kind, name: rec.name, reward: { ...rw }, label: rewardLabel(rw), units });
  const r = sim.tileRect(t); sim.grid.stamp(r.x0, r.z0, 1, BL.RES, -1);
  sim.treasures.delete(t); st.destroy(t);
}

const fighter = (st, e) => (st.mask[e] & CM.ATTACKER) && !(st.mask[e] & CM.GATHERER);
function nearestGuard(sim, e, t) {
  const st = sim.st, rec = sim.treasures.get(t);
  let best = -1, bd = 1e9;
  for (const g of rec.guards) if (st.alive[g] && st.hp[g] > 0) { const d = Math.hypot(st.x[g] - st.x[e], st.z[g] - st.z[e]); if (d < bd) { bd = d; best = g; } }
  return best;
}

function block(sim, e, t, why) {
  const st = sim.st, p = st.owner[e], key = p * 1e5 + t;
  const last = sim.claimNotes.get(key) || -99;
  if (sim.time - last > 4) { sim.claimNotes.set(key, sim.time); sim.events.push("claimBlocked", { p, e, t, x: st.x[t], z: st.z[t], why }); }
}

/** Per tick: units under a CLAIM order walk to the chest and try; any unit walking over an open chest claims it. */
export function treasureSystem(sim) {
  const st = sim.st;
  for (let e = 0; e < st.top; e++) {
    if (!st.alive[e] || st.state[e] !== S.CLAIM) continue;
    if (!st.targetOk(e) || !sim.treasures.has(st.tgt[e])) { st.state[e] = S.IDLE; st.tgt[e] = -1; continue; }
    const t = st.tgt[e];
    if (sim.edgeDist(st.x[e], st.z[e], t) <= 0.9) {
      const c = canClaim(sim, e, t);
      if (c.ok) { claim(sim, e, t); st.state[e] = S.IDLE; st.gx[e] = st.x[e]; st.gz[e] = st.z[e]; }
      else {
        block(sim, e, t, c.why); sim.stopMoving(e); st.state[e] = S.IDLE; st.tgt[e] = -1; st.gx[e] = st.x[e]; st.gz[e] = st.z[e];
        const g = c.guarded && fighter(st, e) ? nearestGuard(sim, e, t) : -1;
        if (g >= 0) { startAttack(sim, e, g, 0); sim.claimResume.set(e, t); } // fight the pack, then come back for the chest
      }
      continue;
    }
    // struck on the way by a guardian: soldiers answer, villagers keep walking
    const la = st.lastAttacker[e];
    if (st.hitT[e] < 0.3 && la >= 0 && st.alive[la] && sim.guards.has(la) && fighter(st, e)) { startAttack(sim, e, la, 0); sim.claimResume.set(e, t); continue; }
    if (sim.pathDone(e)) { if (++st.tries[e] > 4) { st.state[e] = S.IDLE; continue; } sim.moveToEntity(e, t, 0.3); }
  }
  if (sim.tick % 5) return;
  // a claim interrupted by guardians resumes once the unit is idle: next guardian, or the chest itself
  for (const [e, t] of sim.claimResume) {
    if (!st.alive[e] || !sim.treasures.has(t)) { sim.claimResume.delete(e); continue; }
    if (st.state[e] === S.ATTACK) continue;
    if (st.state[e] !== S.IDLE) { sim.claimResume.delete(e); continue; } // the player gave another order
    const g = nearestGuard(sim, e, t);
    if (g >= 0) startAttack(sim, e, g, 0);
    else { startClaim(sim, e, t); sim.claimResume.delete(e); }
  }
  for (const t of [...sim.treasures.keys()]) {
    if (!st.alive[t]) { sim.treasures.delete(t); continue; }
    if (guardsLeft(sim, t) > 0) continue;
    let who = -1;
    sim.hash.each(st.x[t], st.z[t], 1.4, (u) => {
      if (who >= 0 || !st.alive[u] || st.owner[u] > 1 || !(st.mask[u] & CM.UNIT)) return;
      if (sim.edgeDist(st.x[u], st.z[u], t) <= 0.7 && canClaim(sim, u, t).ok) who = u;
    });
    if (who >= 0) claim(sim, who, t);
  }
}

// Frontier Crown — Age advancement as a small state machine per player.
//
//   READY ──beginAgeUp()──► ADVANCING ──timer ≥ AGES[n].time──► READY (age n) + 1 shipment point
//     │  check: next age exists, TC alive,  │ cancelAgeUp(): refund      │ unlocks applied: every def with
//     │  enough completed buildings, cost   │ TC destroyed: aborted      │ age == n becomes trainable /
//     │  affordable → spend (devalue) cost  ▼                            │ buildable; HUD gets the list
//     └───────────────────────────────── READY                           ▼
//
// Nothing about "what unlocks" is hard-coded: a unit or building is gated by its `age` field in
// data/defs.js, so adding a Fortress-Age unit is one line of data. Commands (human and AI) call
// beginAgeUp/cancelAgeUp; the HUD calls ageStatus() to explain why the button is disabled.

import { TICK } from "../../core/core.js";
import { AGES, DEF_LIST } from "../../data/defs.js";
import { canAfford, spend, refund } from "./ledger.js";

export const AGE_STATE = { READY: 0, ADVANCING: 1, FINAL: 3 };

/** Everything that becomes available on reaching `age`, grouped by where it is produced. */
const unlockCache = new Map();
export function unlocksFor(age) {
  if (unlockCache.has(age)) return unlockCache.get(age);
  const out = { units: [], buildings: [], byProducer: {} };
  for (const d of DEF_LIST) {
    if (d.age !== age || d.kind === "resource" || d.res != null) continue;
    if (d.kind === "unit") {
      out.units.push(d.id);
      (out.byProducer[d.from] = out.byProducer[d.from] || []).push(d.id);
    } else out.buildings.push(d.id);
  }
  unlockCache.set(age, out);
  return out;
}

export function ageState(pl) {
  if (pl.aging) return AGE_STATE.ADVANCING;
  return pl.age >= AGES.length - 1 ? AGE_STATE.FINAL : AGE_STATE.READY;
}

/** Can player p start advancing? { ok, why, soft (only short of resources), next, cost, time, need, have } */
export function ageStatus(sim, p) {
  const pl = sim.players[p], st = sim.st, s = ageState(pl);
  const next = AGES[pl.age + 1];
  if (s === AGE_STATE.FINAL) return { ok: false, why: "Final Age reached" };
  const base = { next, cost: next.cost, time: next.time, need: next.requires?.built || 0, have: pl.built || 0, unlocks: unlocksFor(pl.age + 1) };
  if (s === AGE_STATE.ADVANCING) return { ...base, ok: false, why: "Already advancing" };
  if (pl.tc < 0 || !st.alive[pl.tc] || st.prog[pl.tc] < 1) return { ...base, ok: false, why: "Needs a Town Center" };
  if (base.have < base.need) return { ...base, ok: false, why: `Needs ${base.need} completed buildings (${base.have}/${base.need})` };
  if (!canAfford(pl, next.cost)) return { ...base, ok: false, soft: true, why: "Not enough resources" };
  return { ...base, ok: true };
}

/** Pay the Age cost (removed from the stockpile now) and start the research timer at the TC. */
export function beginAgeUp(sim, p) {
  const a = ageStatus(sim, p);
  if (!a.ok) return false;
  const pl = sim.players[p];
  if (!spend(pl, a.cost)) return false;
  pl.aging = { t: 0, total: a.time, to: pl.age + 1, cost: a.cost.slice() };
  sim.events.push("aging", { p, to: pl.aging.to, cost: a.cost });
  return true;
}

/** Abort an advance in progress: the full cost goes back to the stockpile. */
export function cancelAgeUp(sim, p) {
  const pl = sim.players[p];
  if (!pl.aging) return false;
  refund(pl, pl.aging.cost);
  sim.events.push("agecancel", { p, to: pl.aging.to });
  pl.aging = null;
  return true;
}

/** Per tick: advance research timers; on completion raise the Age and publish the unlocks. */
export function ageSystem(sim) {
  const st = sim.st;
  for (const pl of sim.players) {
    if (!pl.aging) continue;
    if (pl.tc < 0 || !st.alive[pl.tc]) { sim.events.push("agecancel", { p: pl.id, to: pl.aging.to, lost: true }); pl.aging = null; continue; }
    pl.aging.t += TICK;
    if (pl.aging.t < pl.aging.total) continue;
    const to = pl.aging.to;
    pl.age = to; pl.aging = null;
    const u = unlocksFor(to);
    pl.unlockedAt = pl.unlockedAt || {};
    for (const k of [...u.units, ...u.buildings]) pl.unlockedAt[k] = sim.time;
    sim.events.push("age", { p: pl.id, age: to, units: u.units, buildings: u.buildings, byProducer: u.byProducer });
  }
}

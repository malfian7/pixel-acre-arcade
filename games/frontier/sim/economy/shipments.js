// Frontier Crown — Crown Shipments: experience, shipment points, the deck, and deliveries.
//
//  XP sources (read from this tick's events, so no other system needs to know XP exists):
//    died  (unit/building, credited to the killer's owner) · built · deposit · age (free point)
//
//  Card lifecycle per player (one shipment on the water at a time):
//
//    LOCKED (Age too low) ──Age up──► READY ──sendCard(): −1 point──► SAILING (travel s)
//        ▲                              ▲                                   │ arrives at the Town Center:
//        │                              └──── cooldown s ◄── COOLDOWN ◄─────┤ units spawn, crates land,
//        │                                                                  │ techs apply, "shipArrived"
//        └─────────────────────────────── SPENT (uses reached) ◄────────────┘
//
//  Everything is deterministic and lives in the sim: the HUD and the AI only call cardStatus()
//  and issue {t:"card"} commands, exactly like every other order.

import { TICK } from "../../core/core.js";
import { DEFS, DEF_LIST } from "../../data/defs.js";
import { CARDS, CARDS_JSON, XP_RULES, DECK_SIZE, DEFAULT_TRAVEL } from "../../data/cards.js";
import { CM, S } from "../ecs.js";
import { BL } from "../map.js";
import { exitPoint } from "../systems/command.js";
import { credit } from "./ledger.js";

const CRATE_DEF = ["crateFood", "crateWood", "crateCoin"];
const costOf = (d) => (d.cost ? d.cost[0] + d.cost[1] + d.cost[2] : 0);

// ------------------------------------------------------------------ XP
export function xpForLevel(n) {
  const v = XP_RULES.firstShipment * Math.pow(XP_RULES.growth, n);
  return Math.min(XP_RULES.cap, Math.round(v / 5) * 5);
}

/** A legal deck: known ids, no duplicates, within DECK_SIZE; falls back to the default deck. */
export function validateDeck(ids) {
  const out = [];
  for (const id of ids || []) if (CARDS[id] && !out.includes(id)) out.push(id);
  if (out.length < DECK_SIZE.min) return CARDS_JSON.defaultDeck.slice();
  return out.slice(0, DECK_SIZE.max);
}

export function initShipments(pl, deck) {
  pl.xp = 0; pl.xpTotal = 0; pl.xpLevel = 0; pl.xpNext = xpForLevel(0);
  pl.shipPoints = 0;
  pl.deck = validateDeck(deck);
  pl.cardState = {}; for (const id of pl.deck) pl.cardState[id] = { used: 0, readyAt: 0 };
  pl.ship = null;          // { id, t, total } while a shipment is sailing
  pl.shipsArrived = 0;
}

export function addXP(sim, p, amt, why) {
  if (p < 0 || p > 1 || !(amt > 0)) return;
  const pl = sim.players[p];
  pl.xp += amt; pl.xpTotal += amt;
  while (pl.xp >= pl.xpNext) {
    pl.xp -= pl.xpNext; pl.xpLevel++; pl.xpNext = xpForLevel(pl.xpLevel);
    grantPoints(sim, p, 1, "xp");
  }
}
export function grantPoints(sim, p, n, why) {
  const pl = sim.players[p];
  pl.shipPoints += n;
  sim.events.push("shipPoint", { p, points: pl.shipPoints, why });
}

/** Per tick, after every other system: award XP from the events this tick produced. */
export function xpSystem(sim, from) {
  const L = sim.events.list;
  for (let i = from; i < L.length; i++) {
    const ev = L[i];
    if (ev.type === "died" && ev.owner === 3 && ev.by >= 0 && ev.by < 2) { // a treasure guardian
      addXP(sim, ev.by, DEF_LIST[ev.def].xp || 10, "guardian");
    } else if (ev.type === "died") {
      if (ev.by == null || ev.by < 0 || ev.by > 1 || ev.by === ev.owner || ev.owner > 1) continue;
      const d = DEF_LIST[ev.def];
      addXP(sim, ev.by, ev.building ? costOf(d) * XP_RULES.killBuilding + XP_RULES.killBuildingFlat : Math.max(5, costOf(d) * XP_RULES.killUnit), "kill");
    } else if (ev.type === "built") {
      addXP(sim, ev.p, costOf(DEF_LIST[sim.st.def[ev.e]]) * XP_RULES.build + XP_RULES.buildFlat, "build");
    } else if (ev.type === "deposit") {
      addXP(sim, ev.p, XP_RULES.deposit, "gather");
    } else if (ev.type === "age") {
      grantPoints(sim, ev.p, XP_RULES.ageUpPoints, "age");
    }
  }
}

// ------------------------------------------------------------------ cards
/** { ok, why, soft, state: "ready"|"locked"|"spent"|"cooldown"|"sailing"|"nopoint", usesLeft, cooldownLeft } */
export function cardStatus(sim, p, id) {
  const pl = sim.players[p], c = CARDS[id], cs = pl.cardState[id];
  if (!c || !cs) return { ok: false, why: "Not in your deck", state: "locked" };
  const usesLeft = c.uses == null ? Infinity : c.uses - cs.used;
  const cooldownLeft = Math.max(0, cs.readyAt - sim.time);
  const base = { usesLeft, cooldownLeft };
  if (c.age > pl.age) return { ...base, ok: false, state: "locked", why: `Available in the ${["Discovery", "Colonial", "Fortress"][c.age]} Age` };
  if (usesLeft <= 0) return { ...base, ok: false, state: "spent", why: "Already sent the maximum number of times" };
  if (pl.ship && pl.ship.id === id) return { ...base, ok: false, state: "sailing", why: "This shipment is on its way" };
  if (cooldownLeft > 0) return { ...base, ok: false, state: "cooldown", why: `Ready again in ${Math.ceil(cooldownLeft)}s` };
  if (pl.ship) return { ...base, ok: false, soft: true, state: "ready", why: "Another shipment is already sailing" };
  if (pl.tc < 0 || !sim.st.alive[pl.tc]) return { ...base, ok: false, state: "ready", why: "No Town Center to receive it" };
  if (pl.shipPoints < 1) return { ...base, ok: false, soft: true, state: "nopoint", why: "No shipment available — earn XP" };
  return { ...base, ok: true, state: "ready" };
}

export function sendCard(sim, p, id) {
  const s = cardStatus(sim, p, id);
  if (!s.ok) return false;
  const pl = sim.players[p], c = CARDS[id];
  pl.shipPoints--; pl.cardState[id].used++;
  pl.ship = { id, t: 0, total: c.travel || DEFAULT_TRAVEL };
  sim.events.push("shipSent", { p, card: id, travel: pl.ship.total });
  return true;
}

export function shipmentSystem(sim) {
  for (const pl of sim.players) {
    if (!pl.ship) continue;
    pl.ship.t += TICK;
    if (pl.ship.t < pl.ship.total) continue;
    const id = pl.ship.id; pl.ship = null;
    const c = CARDS[id];
    pl.cardState[id].readyAt = sim.time + (c.cooldown || 0);
    if (!deliver(sim, pl, c)) { pl.cardState[id].used--; grantPoints(sim, pl.id, 1, "lost"); sim.events.push("shipLost", { p: pl.id, card: id }); }
  }
}

// ------------------------------------------------------------------ delivery
function receiver(sim, pl) {
  const st = sim.st;
  if (pl.tc >= 0 && st.alive[pl.tc]) return pl.tc;
  return sim.nearest(64, 64, (b) => st.owner[b] === pl.id && (st.mask[b] & CM.DROPSITE) && st.prog[b] >= 1, 200);
}

/** Free tiles in rings around building b for crates, a checkerboard so walkers can pass between. */
function crateSpots(sim, b, n) {
  const st = sim.st, r = sim.tileRect(b), g = sim.grid, out = [];
  const tx = 64, tz = 64; // face the map centre (the open side of a base)
  for (let ring = 2; ring <= 5 && out.length < n; ring++) {
    const cand = [];
    for (let j = r.z0 - ring; j <= r.z1 + ring; j++) for (let i = r.x0 - ring; i <= r.x1 + ring; i++) {
      if (i > r.x0 - ring && i < r.x1 + ring && j > r.z0 - ring && j < r.z1 + ring) continue;
      if (((i + j) & 1) || !g.canPlace(i, j, 1)) continue;
      cand.push([i, j, (i + 0.5 - tx) ** 2 + (j + 0.5 - tz) ** 2]);
    }
    cand.sort((a, c) => a[2] - c[2]);
    for (const c of cand) { if (out.length >= n) break; out.push(c); }
  }
  return out;
}

function deliver(sim, pl, c) {
  const st = sim.st, b = receiver(sim, pl);
  if (b < 0) return false;
  const d = c.deliver || {}, units = [], crates = [];
  let k = 0;
  for (const [defId, n] of d.units || []) {
    const def = DEFS[defId];
    for (let i = 0; i < n; i++) {
      const pos = exitPoint(sim, b, k++);
      if (!pos) break;
      const e = sim.spawnUnit(def.idx, pl.id, pos[0], pos[1]);
      st.rot[e] = st.prot[e] = Math.atan2(pos[0] - st.x[b], pos[1] - st.z[b]);
      st.gx[e] = st.x[e]; st.gz[e] = st.z[e];
      units.push(e);
    }
  }
  for (const [res, amount] of d.crates || []) {
    const n = Math.ceil(amount / 100), spots = crateSpots(sim, b, n), def = DEFS[CRATE_DEF[res]];
    let left = amount;
    for (let i = 0; i < n; i++) {
      const a = Math.min(100, left); left -= a;
      if (i >= spots.length) { credit(pl, res, a + left, false); break; } // no room: straight into the stockpile
      const e = sim.spawnResource(def.idx, spots[i][0], spots[i][1]);
      st.owner[e] = pl.id; st.amount[e] = a;
      sim.events.push("spawn", { e, crate: true });
      crates.push(e);
    }
  }
  if (d.tech && d.tech.gatherMult) pl.gatherMult *= d.tech.gatherMult;
  pl.shipsArrived++;
  sim.recount();
  sim.events.push("shipArrived", { p: pl.id, card: c.id, at: b, x: st.x[b], z: st.z[b], units, crates });
  return true;
}

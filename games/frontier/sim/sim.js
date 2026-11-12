// Frontier Crown — the simulation (World = ECS store + grid + players). No Three.js, no DOM.

import { TICK, makeRng, EventQueue } from "../core/core.js";
import { DEFS, DEF_LIST, D, START_RES, POP_MAX, AGES } from "../data/defs.js";
import { Store, CM, S } from "./ecs.js";
import { SpatialHash, BL, W, H } from "./map.js";
import { generateMap } from "./mapgen.js";
import { findPath, pathStats } from "./path.js";
import { FlowField } from "./flowfield.js";
import { commandSystem } from "./systems/command.js";
import { productionSystem } from "./systems/production.js";
import { constructionSystem } from "./systems/construction.js";
import { pathSystem, movementSystem } from "./systems/movement.js";
import { villagerEconomySystem } from "./economy/villager-fsm.js";
import { ageSystem } from "./economy/age.js";
import { initLedger, ledgerTick } from "./economy/ledger.js";
import { initShipments, shipmentSystem, xpSystem } from "./economy/shipments.js";
import { placeTreasures, treasureSystem } from "./treasures.js";
import { guardianSystem } from "./guardians.js";
import { TREASURE_KINDS } from "../data/treasures.js";
import { exitPoint } from "./systems/command.js";
import { combatSystem, projectileSystem } from "./systems/combat.js";
import { deathSystem } from "./systems/death.js";
import { fogSystem } from "./systems/fog.js";
import { victorySystem } from "./systems/victory.js";

export class Sim {
  constructor({ seed = 1, difficulty = 1, map = "fords", heights = null, decks = [] } = {}) {
    this.seed = seed;
    this.rng = makeRng(seed * 7919 + 13);
    this.tick = 0;
    this.time = 0;
    this.st = new Store();
    this.events = new EventQueue();
    this.hash = new SpatialHash(4);
    this.pathQueue = [];
    this.flowCache = new Map();
    this.orderSeq = 1;
    this.projectiles = [];
    this.treasures = new Map(); // chest entity → { kind, claimBy, reward, guards[] }
    this.guards = new Map();    // guardian entity → FSM record (sim/guardians.js)
    this.claimNotes = new Map();
    this.claimResume = new Map(); // unit → treasure it was told to claim before guardians interrupted
    this.pending = [];      // commands for next tick
    this.ais = [];          // AI controllers (run inside the tick, through commands)
    this.over = null;       // { winner }
    this.difficulty = difficulty;
    const mg = generateMap(seed, { map, heights });
    this.grid = mg.grid; this.mapId = map; this.mapInfo = { mesas: mg.mesas };
    this.players = [0, 1].map((p) => ({
      id: p, res: [...START_RES], age: 0, aging: null, popUsed: 0, popCap: 0, popTraining: 0,
      tc: -1, gatherMult: 1, alive: true, lastAttackNote: -99,
      stats: { trained: 0, lost: 0, killed: 0, gathered: [0, 0, 0], built: 0, razed: 0 }, built: 0, unlockedAt: {},
    }));
    for (const pl of this.players) { initLedger(pl); initShipments(pl, decks[pl.id]); }
    for (const pl of mg.place) {
      const d = DEFS[pl.def];
      if (d.kind === "unit") { const e = this.spawnUnit(d.idx, pl.owner, pl.x, pl.z); this.st.rot[e] = this.st.prot[e] = pl.rot || 0; }
      else if (d.kind === "building") { const e = this.spawnBuilding(d.idx, pl.owner, pl.i, pl.j, true); if (pl.def === "towncenter") this.players[pl.owner].tc = e; }
      else this.spawnResource(d.idx, pl.i, pl.j);
    }
    // every colony starts with an Explorer; treasures + guardians are placed in mirrored pairs
    for (const pl of this.players) if (pl.tc >= 0) {
      const pos = exitPoint(this, pl.tc, 6);
      if (pos) { const e = this.spawnUnit(D("explorer"), pl.id, pos[0], pos[1]); this.st.rot[e] = this.st.prot[e] = Math.atan2(pos[0] - this.st.x[pl.tc], pos[1] - this.st.z[pl.tc]); }
    }
    placeTreasures(this);
    this.recount();
    for (let e = 0; e < this.st.top; e++) if (this.st.alive[e] && (this.st.mask[e] & CM.MOVER)) this.hash.insert(e, this.st.x[e], this.st.z[e]);
    fogSystem(this, true);
  }

  // ------------------------------------------------------------ spawning
  spawnUnit(defIdx, owner, x, z) {
    const e = this.st.create(defIdx, owner, x, z);
    this.events.push("spawn", { e });
    return e;
  }
  spawnBuilding(defIdx, owner, i0, j0, complete) {
    const d = DEF_LIST[defIdx];
    const e = this.st.create(defIdx, owner, i0 + d.size / 2, j0 + d.size / 2);
    this.grid.stamp(i0, j0, d.size, BL.BLD, e);
    if (!complete) { this.st.prog[e] = 0; this.st.hp[e] = Math.max(1, d.hp * 0.1); }
    this.events.push("spawn", { e });
    return e;
  }
  spawnResource(defIdx, i0, j0) {
    const d = DEF_LIST[defIdx];
    const e = this.st.create(defIdx, 2, i0 + d.size / 2, j0 + d.size / 2);
    this.grid.stamp(i0, j0, d.size, BL.RES, e);
    return e;
  }

  // ------------------------------------------------------------ geometry helpers
  defOf(e) { return DEF_LIST[this.st.def[e]]; }
  isFoot(e) { return (this.st.mask[e] & CM.FOOTPRINT) !== 0; }
  tileRect(e) {
    const d = this.defOf(e), s = d.size, i0 = Math.round(this.st.x[e] - s / 2), j0 = Math.round(this.st.z[e] - s / 2);
    return { x0: i0, z0: j0, x1: i0 + s - 1, z1: j0 + s - 1 };
  }
  // Distance from a point to the edge of e (footprint rect, or unit circle).
  edgeDist(x, z, e) {
    const st = this.st;
    if (this.isFoot(e)) {
      const s = this.defOf(e).size / 2, cx = st.x[e], cz = st.z[e];
      const dx = Math.max(0, Math.abs(x - cx) - s), dz = Math.max(0, Math.abs(z - cz) - s);
      return Math.hypot(dx, dz);
    }
    return Math.max(0, Math.hypot(st.x[e] - x, st.z[e] - z) - this.defOf(e).radius);
  }
  /** Is (x, z) inside the aggro ring (+ margin) of a treasure that still has living guardians? */
  guarded(x, z) {
    const st = this.st;
    for (const [t, rec] of this.treasures) {
      const k = TREASURE_KINDS[rec.kind], r = k.aggro + 2.5;
      if ((st.x[t] - x) ** 2 + (st.z[t] - z) ** 2 > r * r) continue;
      for (const g of rec.guards) if (st.alive[g] && st.hp[g] > 0) return true;
    }
    return false;
  }
  // hostile owners: the two players and the WILD guardians fight each other; GAIA (nature) never fights
  enemies(a, b) { return a !== b && a !== 2 && b !== 2; }

  // ------------------------------------------------------------ movement orders
  requestPath(e, rect, reach, fx, fz, limit = 16000) {
    const st = this.st;
    let p = st.path.get(e);
    if (!p) { p = { pts: [], i: 0, pending: false, rect: null, reach: 0, fx: 0, fz: 0, done: false }; st.path.set(e, p); }
    p.rect = rect; p.reach = reach; p.fx = fx; p.fz = fz; p.done = false; p.limit = limit; p.flow = null;
    if (!p.pending) { p.pending = true; this.pathQueue.push(e); }
    st.moving[e] = 1; st.stuck[e] = 0;
  }
  moveToPoint(e, x, z, limit) {
    x = Math.max(0.5, Math.min(W - 0.5, x)); z = Math.max(0.5, Math.min(H - 0.5, z));
    const i = Math.floor(x), j = Math.floor(z);
    this.requestPath(e, { x0: i, z0: j, x1: i, z1: j }, 0, x, z, limit);
  }
  moveToEntity(e, t, reach) {
    if (this.isFoot(t)) this.requestPath(e, this.tileRect(t), reach + 0.5, NaN, NaN);
    else { const i = Math.floor(this.st.x[t]), j = Math.floor(this.st.z[t]); this.requestPath(e, { x0: i, z0: j, x1: i, z1: j }, Math.max(1, reach), NaN, NaN); }
  }
  stopMoving(e) { const p = this.st.path.get(e); if (p) { p.pts.length = 0; p.i = 0; p.done = true; p.flow = null; } this.st.moving[e] = 0; }

  // One shared flow field per goal (cached per map version, LRU of 6).
  flowField(rect) {
    const key = `${rect.x0},${rect.z0},${rect.x1},${rect.z1}`;
    let ff = this.flowCache.get(key);
    if (ff && ff.version === this.grid.version) { this.flowCache.delete(key); this.flowCache.set(key, ff); return ff; }
    ff = new FlowField(this.grid, rect);
    pathStats.flows = (pathStats.flows || 0) + 1; pathStats.expanded += ff.expanded;
    this.flowCache.set(key, ff);
    while (this.flowCache.size > 6) this.flowCache.delete(this.flowCache.keys().next().value);
    return ff;
  }
  // Group move: every unit follows the same flow field, then steers into its own formation slot.
  moveGroupFlow(pairs, cx, cz) {
    const st = this.st, i = Math.floor(cx), j = Math.floor(cz);
    const ff = this.flowField({ x0: i - 1, z0: j - 1, x1: i + 1, z1: j + 1 });
    for (const [e, [x, z]] of pairs) {
      if (!ff.reachable(st.x[e], st.z[e])) { this.moveToPoint(e, x, z); continue; }
      let p = st.path.get(e);
      if (!p) { p = { pts: [], i: 0 }; st.path.set(e, p); }
      p.pts = []; p.i = 0; p.pending = false; p.done = false; p.failed = false; p.flow = ff; p.fx = x; p.fz = z; p.wx = NaN; p.wz = NaN; p.wt = 0;
      st.moving[e] = 1; st.stuck[e] = 0;
    }
  }
  pathDone(e) { const p = this.st.path.get(e); return !p || (p.done && !p.pending); }
  pathFailed(e) { const p = this.st.path.get(e); return !!(p && !p.pending && p.failed); }
  computePath(e) {
    const st = this.st, p = st.path.get(e); if (!p) return;
    const r = findPath(this.grid, st.x[e], st.z[e], p.rect, p.reach, p.limit || 16000);
    p.pts = r.pts; p.i = 0; p.pending = false; p.done = p.pts.length === 0; p.failed = !r.complete;
    if (r.complete && !Number.isNaN(p.fx) && this.grid.passableAt(p.fx, p.fz)) {
      if (p.pts.length) { p.pts[p.pts.length - 2] = p.fx; p.pts[p.pts.length - 1] = p.fz; }
      else { p.pts.push(p.fx, p.fz); p.done = false; }
    }
    if (p.done) st.moving[e] = 0;
  }

  // ------------------------------------------------------------ queries
  nearest(x, z, filter, maxR = 1e9) {
    const st = this.st; let best = -1, bd = maxR * maxR;
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e] || !filter(e)) continue;
      const d = (st.x[e] - x) ** 2 + (st.z[e] - z) ** 2;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  nearestResource(x, z, gtype, maxR, avoidCrowd = true, p = -1) {
    const st = this.st;
    return this.nearest(x, z, (e) => {
      if (!(st.mask[e] & CM.RESOURCE)) return false;
      if (p >= 0 && (st.unreach[e] & (1 << p))) return false;
      const d = DEF_LIST[st.def[e]];
      if (d.gtype !== gtype || st.amount[e] <= 0) return false;
      if (d.crate && st.owner[e] !== p) return false; // crates belong to whoever received them
      if (p >= 0 && this.guarded(st.x[e], st.z[e])) return false; // never auto-send villagers into a guardian camp
      if (d.kind === "unit" && !st.dead[e] && gtype !== "hunt") return false;
      if (avoidCrowd && d.size === 1 && st.workers[e] >= 3) return false;
      if (d.size === 1) { // a tree deep inside a forest cannot be reached
        const i = Math.floor(st.x[e]), j = Math.floor(st.z[e]), g = this.grid;
        if (!g.passable(i + 1, j) && !g.passable(i - 1, j) && !g.passable(i, j + 1) && !g.passable(i, j - 1)) return false;
      }
      return true;
    }, maxR);
  }
  nearestDrop(p, x, z, res) {
    const st = this.st;
    return this.nearest(x, z, (e) => st.owner[e] === p && (st.mask[e] & CM.DROPSITE) && st.prog[e] >= 1 && DEF_LIST[st.def[e]].drop.includes(res));
  }

  // ------------------------------------------------------------ damage
  damage(src, t, amount, type) {
    const st = this.st, d = this.defOf(t);
    if (!st.alive[t] || st.hp[t] <= 0) return;
    const arm = d.armor ? d.armor[type] || 0 : 0;
    const dmg = amount * (1 - arm);
    st.hp[t] -= dmg; st.hitT[t] = 0;
    if (src >= 0) { st.lastAttacker[t] = src; }
    const o = st.owner[t];
    if (o < 2 && (src < 0 || st.owner[src] < 2)) { // guardians defending a treasure are not a raid
      const pl = this.players[o];
      if (this.time - pl.lastAttackNote > 12) { pl.lastAttackNote = this.time; this.events.push("attacked", { p: o, x: st.x[t], z: st.z[t] }); }
    }
    if (st.hp[t] <= 0 && src >= 0) st.lastAttacker[t] = src;
  }

  // ------------------------------------------------------------ population
  recount() {
    const st = this.st;
    for (const pl of this.players) { pl.popUsed = 0; pl.popCap = 0; pl.built = 0; pl.count = {}; }
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e]) continue;
      const o = st.owner[e]; if (o > 1) continue;
      const d = DEF_LIST[st.def[e]];
      if (d.kind === "unit") { this.players[o].popUsed += d.pop; if (d.limit) this.players[o].count[d.id] = (this.players[o].count[d.id] || 0) + 1; }
      else if (d.kind === "building" && st.prog[e] >= 1) { this.players[o].popCap += d.pop; if (d.id !== "towncenter") this.players[o].built++; }
    }
    for (const pl of this.players) pl.popCap = Math.min(POP_MAX, pl.popCap);
  }

  issue(cmd) { this.pending.push(cmd); }

  // ------------------------------------------------------------ the tick
  step() {
    const st = this.st;
    // snapshot for render interpolation
    st.px.set(st.x); st.pz.set(st.z); st.prot.set(st.rot);
    this.tick++; this.time += TICK;
    if (this.over) return;
    const evMark = this.events.list.length; // XP is read from the events this tick produces
    for (const ai of this.ais) if ((this.tick + ai.p * 5) % 10 === 0) ai.think();
    commandSystem(this, this.pending); this.pending = [];
    productionSystem(this);
    ageSystem(this);
    shipmentSystem(this);
    constructionSystem(this);
    pathSystem(this);
    movementSystem(this);
    villagerEconomySystem(this);
    treasureSystem(this);
    guardianSystem(this);
    combatSystem(this);
    projectileSystem(this);
    deathSystem(this);
    if (this.tick % 4 === 0) fogSystem(this);
    if (this.tick % 10 === 0) this.recount();
    if (this.tick % 20 === 0) ledgerTick(this);
    xpSystem(this, evMark);
    victorySystem(this);
  }

  ageName(p) { return AGES[this.players[p].age].name; }
}

export { S, CM, D };

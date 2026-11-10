// Frontier Crown — the simulation (World = ECS store + grid + players). No Three.js, no DOM.

import { TICK, makeRng, EventQueue } from "../core/core.js";
import { DEFS, DEF_LIST, D, START_RES, POP_MAX, AGES } from "../data/defs.js";
import { Store, CM, S } from "./ecs.js";
import { SpatialHash, BL, W, H } from "./map.js";
import { generateMap } from "./mapgen.js";
import { findPath } from "./path.js";
import { commandSystem } from "./systems/command.js";
import { productionSystem } from "./systems/production.js";
import { constructionSystem } from "./systems/construction.js";
import { pathSystem, movementSystem } from "./systems/movement.js";
import { gatherSystem } from "./systems/gather.js";
import { combatSystem, projectileSystem } from "./systems/combat.js";
import { deathSystem } from "./systems/death.js";
import { fogSystem } from "./systems/fog.js";
import { victorySystem } from "./systems/victory.js";

export class Sim {
  constructor({ seed = 1, difficulty = 1, map = "fords", heights = null } = {}) {
    this.seed = seed;
    this.rng = makeRng(seed * 7919 + 13);
    this.tick = 0;
    this.time = 0;
    this.st = new Store();
    this.events = new EventQueue();
    this.hash = new SpatialHash(4);
    this.pathQueue = [];
    this.projectiles = [];
    this.pending = [];      // commands for next tick
    this.ais = [];          // AI controllers (run inside the tick, through commands)
    this.over = null;       // { winner }
    this.difficulty = difficulty;
    const mg = generateMap(seed, { map, heights });
    this.grid = mg.grid; this.mapId = map; this.mapInfo = { mesas: mg.mesas };
    this.players = [0, 1].map((p) => ({
      id: p, res: [...START_RES], age: 0, aging: null, pendingShip: 0, popUsed: 0, popCap: 0, popTraining: 0,
      tc: -1, gatherMult: 1, alive: true, lastAttackNote: -99,
      stats: { trained: 0, lost: 0, killed: 0, gathered: [0, 0, 0], built: 0, razed: 0 },
    }));
    for (const pl of mg.place) {
      const d = DEFS[pl.def];
      if (d.kind === "unit") { const e = this.spawnUnit(d.idx, pl.owner, pl.x, pl.z); this.st.rot[e] = this.st.prot[e] = pl.rot || 0; }
      else if (d.kind === "building") { const e = this.spawnBuilding(d.idx, pl.owner, pl.i, pl.j, true); if (pl.def === "towncenter") this.players[pl.owner].tc = e; }
      else this.spawnResource(d.idx, pl.i, pl.j);
    }
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
  enemies(a, b) { return a !== b && a < 2 && b < 2; }

  // ------------------------------------------------------------ movement orders
  requestPath(e, rect, reach, fx, fz, limit = 16000) {
    const st = this.st;
    let p = st.path.get(e);
    if (!p) { p = { pts: [], i: 0, pending: false, rect: null, reach: 0, fx: 0, fz: 0, done: false }; st.path.set(e, p); }
    p.rect = rect; p.reach = reach; p.fx = fx; p.fz = fz; p.done = false; p.limit = limit;
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
  stopMoving(e) { const p = this.st.path.get(e); if (p) { p.pts.length = 0; p.i = 0; p.done = true; } this.st.moving[e] = 0; }
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
    if (o < 2) {
      const pl = this.players[o];
      if (this.time - pl.lastAttackNote > 12) { pl.lastAttackNote = this.time; this.events.push("attacked", { p: o, x: st.x[t], z: st.z[t] }); }
    }
    if (st.hp[t] <= 0 && src >= 0) st.lastAttacker[t] = src;
  }

  // ------------------------------------------------------------ population
  recount() {
    const st = this.st;
    for (const pl of this.players) { pl.popUsed = 0; pl.popCap = 0; }
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e]) continue;
      const o = st.owner[e]; if (o > 1) continue;
      const d = DEF_LIST[st.def[e]];
      if (d.kind === "unit") this.players[o].popUsed += d.pop;
      else if (d.kind === "building" && st.prog[e] >= 1) this.players[o].popCap += d.pop;
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
    for (const ai of this.ais) if ((this.tick + ai.p * 5) % 10 === 0) ai.think();
    commandSystem(this, this.pending); this.pending = [];
    productionSystem(this);
    constructionSystem(this);
    pathSystem(this);
    movementSystem(this);
    gatherSystem(this);
    combatSystem(this);
    projectileSystem(this);
    deathSystem(this);
    if (this.tick % 4 === 0) fogSystem(this);
    if (this.tick % 10 === 0) this.recount();
    victorySystem(this);
  }

  ageName(p) { return AGES[this.players[p].age].name; }
}

export { S, CM, D };

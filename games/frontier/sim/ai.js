// Frontier Crown — computer opponent. Thinks twice a second and acts only through commands,
// exactly like the human player.

import { DEFS, DEF_LIST, AGES, C, FOOD, WOOD, COIN } from "../data/defs.js";
import { CM, S } from "./ecs.js";
import { GT } from "./systems/command.js";
import { W } from "./map.js";

const LEVELS = [
  { name: "Easy", gather: 0.85, vills: [16, 22, 26], firstAttack: 560, size: 5, grow: 2, ageVills: [14, 20], barracks2: false, outpost: false },
  { name: "Normal", gather: 1.0, vills: [20, 30, 36], firstAttack: 400, size: 8, grow: 3, ageVills: [13, 22], barracks2: false, outpost: true },
  { name: "Hard", gather: 1.15, vills: [22, 34, 42], firstAttack: 290, size: 9, grow: 4, ageVills: [12, 20], barracks2: true, outpost: true },
];
const MIX = [[0.55, 0.3, 0.15], [0.45, 0.3, 0.25], [0.38, 0.3, 0.32]];

export class AIPlayer {
  constructor(sim, p, level = 1) {
    this.sim = sim; this.p = p; this.L = LEVELS[level]; this.level = level;
    sim.players[p].gatherMult = this.L.gather;
    this.mode = "build"; this.nextAttack = this.L.firstAttack; this.wave = 0; this.sent = 0; this.attackers = new Set();
    this.n = 0; this.home = null; this.front = null;
  }
  get pl() { return this.sim.players[this.p]; }

  scan() {
    const sim = this.sim, st = sim.st, p = this.p;
    const r = { vills: [], idle: [], military: [], bld: {}, incomplete: [], assign: [0, 0, 0], builders: 0, enemyNear: [], enemyMil: { cav: 0, inf: 0, art: 0 } };
    for (const k in DEFS) r.bld[k] = [];
    const tc = this.pl.tc;
    const hx = tc >= 0 ? st.x[tc] : 64, hz = tc >= 0 ? st.z[tc] : 64;
    this.home = [hx, hz];
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e]) continue;
      const o = st.owner[e], d = DEF_LIST[st.def[e]];
      if (o === p) {
        if (d.kind === "building") { r.bld[d.id].push(e); if (st.prog[e] < 1) r.incomplete.push(e); }
        else if (d.kind === "unit") {
          if (d.cls & C.VIL) {
            r.vills.push(e);
            const s = st.state[e];
            if (s === S.IDLE || (s === S.MOVE && sim.pathDone(e))) r.idle.push(e);
            else if (s === S.GATHER || s === S.RETURN) r.assign[st.ctype[e]]++;
            else if (s === S.BUILD) r.builders++;
          } else r.military.push(e);
        }
      } else if (o < 2 && d.kind === "unit") {
        if (d.cls & C.CAV) r.enemyMil.cav++; else if (d.cls & C.ART) r.enemyMil.art++; else if (!(d.cls & C.VIL)) r.enemyMil.inf++;
        if (Math.hypot(st.x[e] - hx, st.z[e] - hz) < 26 && !(d.cls & C.VIL)) r.enemyNear.push(e);
      }
    }
    return r;
  }

  cmd(c) { this.sim.issue({ p: this.p, ...c }); }

  think() {
    const sim = this.sim, pl = this.pl;
    if (!pl.alive || sim.over) return;
    this.n++;
    const r = this.scan();
    if (pl.pendingShip) this.cmd({ t: "ship", choice: pl.pendingShip === 2 && this.level === 2 ? 0 : (sim.rng() < 0.5 ? 0 : 1) });
    this.economy(r);
    this.buildings(r);
    this.train(r);
    this.army(r);
  }

  // ---------------------------------------------------------------- economy
  economy(r) {
    const sim = this.sim, st = sim.st, pl = this.pl;
    const mix = [...MIX[pl.age]];
    const nextAge = AGES[pl.age + 1];
    if (nextAge && r.vills.length >= this.L.ageVills[pl.age] - 2) { mix[FOOD] += 0.08; if (nextAge.cost[COIN]) mix[COIN] += 0.06; mix[WOOD] -= 0.14; }
    const total = r.assign[0] + r.assign[1] + r.assign[2] + r.idle.length;
    for (let k = 0; k < 3; k++) mix[k] *= Math.max(0.25, Math.min(1.4, 1.45 - pl.res[k] / 700));
    const ms = mix[0] + mix[1] + mix[2];
    const want = mix.map((m) => m / ms * total);
    for (const e of r.idle) {
      let best = 0, bd = -1e9;
      for (let k = 0; k < 3; k++) { const def = want[k] - r.assign[k]; if (def > bd) { bd = def; best = k; } }
      if (this.sendGather(e, best, r)) r.assign[best]++;
      else if (this.sendGather(e, WOOD, r)) r.assign[WOOD]++;
    }
    // gentle rebalance every ~5 s
    if (this.n % 10 === 0 && total > 6) {
      let over = -1, under = -1, om = 1.5, um = -1.5;
      for (let k = 0; k < 3; k++) { const d = r.assign[k] - want[k]; if (d > om) { om = d; over = k; } if (d < um) { um = d; under = k; } }
      if (over >= 0 && under >= 0) {
        const e = r.vills.find((v) => st.ctype[v] === over && st.state[v] === S.GATHER && st.carry[v] < 3);
        if (e !== undefined) this.sendGather(e, under, r);
      }
    }
  }

  sendGather(e, res, r) {
    const sim = this.sim, st = sim.st, [hx, hz] = this.home;
    let t = -1;
    if (res === FOOD) {
      t = sim.nearestResource(hx, hz, "berries", 30, true, this.p);
      if (t < 0) t = sim.nearestResource(hx, hz, "hunt", 32, true, this.p);
      if (t < 0) { const mills = r.bld.mill.filter((m) => st.prog[m] >= 1 && st.workers[m] < 9); if (mills.length) t = mills[0]; }
    } else if (res === WOOD) t = sim.nearestResource(st.x[e], st.z[e], "wood", 40, true, this.p);
    else t = sim.nearestResource(hx, hz, "coin", 60, false, this.p);
    if (t < 0 && res === WOOD) t = sim.nearestResource(st.x[e], st.z[e], "wood", 90, true, this.p);
    if (t < 0) return false;
    this.cmd({ t: "target", ids: [e], target: t });
    return true;
  }

  // ---------------------------------------------------------------- placement
  findSpot(size, cx, cz, rmin, rmax, towardX, towardZ) {
    const g = this.sim.grid;
    let best = null, bs = 1e9;
    for (let k = 0; k < 140; k++) {
      const a = this.sim.rng() * Math.PI * 2, rr = rmin + this.sim.rng() * (rmax - rmin);
      const i = Math.round(cx + Math.cos(a) * rr - size / 2), j = Math.round(cz + Math.sin(a) * rr - size / 2);
      if (!g.canPlace(i - 1, j - 1, size + 2)) continue;
      let score = rr * 0.2 + this.sim.rng() * 2;
      if (towardX != null) score += Math.hypot(i + size / 2 - towardX, j + size / 2 - towardZ) * 0.15;
      if (score < bs) { bs = score; best = [i, j]; }
    }
    return best;
  }
  pickBuilders(r, n) {
    const st = this.sim.st;
    const pool = r.vills.filter((e) => st.state[e] !== S.BUILD).sort((a, b) => (st.ctype[a] === WOOD ? -1 : 0) - (st.ctype[b] === WOOD ? -1 : 0));
    return pool.slice(0, n);
  }
  build(r, def, n, near, rmin, rmax, toward) {
    const pl = this.pl, d = DEFS[def];
    if (!d.cost.every((c, i) => pl.res[i] >= c)) return false;
    const [cx, cz] = near || this.home;
    const spot = this.findSpot(d.size, cx, cz, rmin, rmax, toward && toward[0], toward && toward[1]);
    if (!spot) return false;
    const ids = this.pickBuilders(r, n);
    if (!ids.length) return false;
    this.cmd({ t: "build", ids, def, i: spot[0], j: spot[1] });
    pl.res = pl.res; // cost is paid when the command runs
    return true;
  }

  buildings(r) {
    const sim = this.sim, st = sim.st, pl = this.pl;
    const enemyTC = sim.players[1 - this.p].tc;
    const toward = enemyTC >= 0 ? [st.x[enemyTC], st.z[enemyTC]] : [64, 64];
    const building = (k) => r.bld[k].some((b) => st.prog[b] < 1);
    // finish abandoned foundations
    for (const b of r.incomplete) {
      const someone = r.vills.some((v) => st.state[v] === S.BUILD && st.tgt[v] === b);
      if (!someone) { const ids = this.pickBuilders(r, 1); if (ids.length) this.cmd({ t: "target", ids, target: b }); }
    }
    if (this.n % 2) return;
    // houses
    if (pl.popCap - pl.popUsed <= 4 + pl.age * 3 && pl.popCap < 150 && !building("house")) { this.build(r, "house", 1, null, 7, 15); return; }
    // barracks
    if (r.bld.barracks.length === 0 && r.vills.length >= 9) { this.build(r, "barracks", 2, null, 9, 16, toward); return; }
    if (this.L.barracks2 && pl.age >= 1 && r.bld.barracks.length < 2 && r.vills.length >= 22) { this.build(r, "barracks", 2, null, 9, 18, toward); return; }
    // mills when berries run dry
    const foodV = r.assign[FOOD];
    if (sim.nearestResource(this.home[0], this.home[1], "berries", 30) < 0 && r.bld.mill.length < Math.ceil(foodV / 9) + (pl.age ? 1 : 0) && !building("mill") && r.bld.mill.length < 4) {
      this.build(r, "mill", 2, null, 8, 15); return;
    }
    if (this.level > 0 && pl.age >= 1 && r.bld.barracks.length < 2 && pl.res[1] > 450 && r.vills.length >= 18) { this.build(r, "barracks", 2, null, 9, 18, toward); return; }
    if (pl.age >= 1 && r.bld.stable.length === 0) { this.build(r, "stable", 2, null, 9, 18, toward); return; }
    if (pl.age >= 1 && this.L.outpost && r.bld.outpost.length === 0 && r.vills.length > 16) {
      const [hx, hz] = this.home; this.build(r, "outpost", 1, [hx + (toward[0] - hx) * 0.22, hz + (toward[1] - hz) * 0.22], 0, 6); return;
    }
    if (pl.age >= 2 && r.bld.foundry.length === 0) { this.build(r, "foundry", 2, null, 9, 18, toward); return; }
  }

  // ---------------------------------------------------------------- training & ages
  train(r) {
    const sim = this.sim, st = sim.st, pl = this.pl;
    const tc = pl.tc;
    // Age up
    const nextAge = AGES[pl.age + 1];
    let saving = false;
    if (nextAge && !pl.aging && r.vills.length >= this.L.ageVills[pl.age]) {
      if (nextAge.cost.every((c, i) => pl.res[i] >= c)) this.cmd({ t: "age" });
      else saving = true;
    }
    if (tc >= 0) {
      const q = st.queue.get(tc);
      const ql = q ? q.items.length : 0;
      if (r.vills.length + ql < this.L.vills[pl.age] && ql < 2 && pl.res[FOOD] >= 50) this.cmd({ t: "train", id: tc, def: "villager" });
    }
    if (r.military.length > 90) return;
    const reserve = saving && r.military.length >= 4 ? nextAge.cost : [0, 0, 0];
    const afford = (d) => d.cost.every((c, i) => pl.res[i] - reserve[i] >= c);
    const em = r.enemyMil;
    for (const b of r.bld.barracks) {
      if (st.prog[b] < 1) continue;
      const q = st.queue.get(b); if (q && q.items.length >= 2) continue;
      const pikeShare = 0.3 + (em.cav > em.inf ? 0.25 : 0) - (pl.res[2] > 400 ? 0.2 : 0);
      const def = sim.rng() < pikeShare ? "pikeman" : "musketeer";
      if (afford(DEFS[def])) this.cmd({ t: "train", id: b, def });
    }
    for (const b of r.bld.stable) {
      if (st.prog[b] < 1) continue;
      const q = st.queue.get(b); if (q && q.items.length >= 1) continue;
      if (afford(DEFS.hussar)) this.cmd({ t: "train", id: b, def: "hussar" });
    }
    const falc = r.military.filter((e) => DEF_LIST[st.def[e]].id === "falconet").length;
    for (const b of r.bld.foundry) {
      if (st.prog[b] < 1 || falc >= 4) continue;
      const q = st.queue.get(b); if (q && q.items.length >= 1) continue;
      if (afford(DEFS.falconet)) this.cmd({ t: "train", id: b, def: "falconet" });
    }
    // rally military producers at the front of the base
    if (this.n % 20 === 1) {
      const enemyTC = sim.players[1 - this.p].tc, [hx, hz] = this.home;
      const tx = enemyTC >= 0 ? st.x[enemyTC] : 64, tz = enemyTC >= 0 ? st.z[enemyTC] : 64;
      const L = Math.hypot(tx - hx, tz - hz) || 1;
      this.front = [hx + (tx - hx) / L * 13, hz + (tz - hz) / L * 13];
      const ids = [...r.bld.barracks, ...r.bld.stable, ...r.bld.foundry];
      if (ids.length) this.cmd({ t: "rally", ids, x: this.front[0], z: this.front[1] });
    }
  }

  // ---------------------------------------------------------------- army
  army(r) {
    const sim = this.sim, st = sim.st;
    for (const e of [...this.attackers]) if (!st.alive[e]) this.attackers.delete(e);
    // defend the base
    if (r.enemyNear.length) {
      const t = r.enemyNear[0];
      const defenders = r.military.filter((e) => !this.attackers.has(e) && st.state[e] !== S.ATTACK);
      if (defenders.length) this.cmd({ t: "move", ids: defenders, x: st.x[t], z: st.z[t], amove: 1 });
      if (r.enemyNear.length >= 6 && this.mode === "attack" && this.attackers.size < r.enemyNear.length) this.recall(r);
    }
    if (this.mode === "build") {
      const ready = r.military.filter((e) => st.state[e] === S.IDLE || st.state[e] === S.MOVE);
      const size = this.L.size + this.wave * this.L.grow;
      const late = sim.time >= this.nextAttack + 150 && ready.length >= Math.max(4, Math.ceil(size / 2));
      if (sim.time >= this.nextAttack && (ready.length >= Math.min(size, 40) || late)) {
        this.mode = "attack"; this.wave++; this.sent = ready.length;
        ready.forEach((e) => this.attackers.add(e));
        this.pushOn([...this.attackers]);
      }
    } else {
      if (this.attackers.size < Math.max(2, this.sent * 0.3)) { this.recall(r); return; }
      const idle = [...this.attackers].filter((e) => st.state[e] === S.IDLE);
      if (idle.length) this.pushOn(idle);
    }
  }
  pushOn(ids) {
    const sim = this.sim, st = sim.st, o = 1 - this.p;
    const [hx, hz] = this.home;
    // nearest enemy building to our base, preferring the Town Center
    let t = sim.nearest(hx, hz, (b) => st.owner[b] === o && (st.mask[b] & CM.BUILDING) && DEF_LIST[st.def[b]].id !== "house");
    if (t < 0) t = sim.players[o].tc;
    if (t < 0) return;
    this.cmd({ t: "move", ids, x: st.x[t], z: st.z[t], amove: 1 });
  }
  recall(r) {
    this.mode = "build"; this.nextAttack = this.sim.time + 110;
    const ids = [...this.attackers]; this.attackers.clear();
    const f = this.front || this.home;
    if (ids.length) this.cmd({ t: "move", ids, x: f[0], z: f[1] });
  }
}

export { LEVELS };

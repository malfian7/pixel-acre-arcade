// Frontier Crown — computer opponent ("Rival Crown"), organised as a Behavior Tree.
// It thinks twice a second and acts only through commands, exactly like the human player.
//
//   Rival Crown AI (Parallel — every concern runs every think)
//   ├─ Shipments        point ready → best card for the situation
//   ├─ Treasure hunt    Explorer collects chests, idle soldiers clear small camps
//   ├─ Economy          plan demand (what the next minute costs) → assign idle villagers → rebalance
//   ├─ Base building    Selector: finish foundations › House (pop almost full) › Barracks › Mill › …
//   ├─ Production       Age up › Villagers › Explorer › Military (gradually, ≤ 2 queued) › Rally
//   └─ Army             Defend base ∥ Selector: wave in progress (press on / recall) › launch wave
//
// The tree is data-light: all numbers come from LEVELS, all state from the blackboard (scan()).
// Medium launches a wave whenever 10 soldiers are ready and attack-moves them to your Town Center.

import { ageStatus } from "./economy/age.js";
import { cardStatus } from "./economy/shipments.js";
import { CARDS } from "../data/cards.js";
import { guardsLeft, canClaim } from "./treasures.js";
import { limitLeft } from "./systems/command.js";
import { DEFS, DEF_LIST, AGES, C, FOOD, WOOD, COIN } from "../data/defs.js";
import { CM, S } from "./ecs.js";
import { GT } from "./systems/command.js";
import { W } from "./map.js";
import { sel, seq, par, when, act, every, outline } from "./ai/bt.js";

// waveSize: soldiers ready before a wave leaves · waveGrow: added per wave · firstAttack: earliest
// time (s) for wave 1 · target: "tc" marches on the Town Center, "nearest" hits the closest building
const LEVELS = [
  { name: "Easy", gather: 0.85, vills: [16, 22, 26], firstAttack: 560, waveSize: 5, waveGrow: 2, ageVills: [14, 20], barracks2: false, outpost: false, target: "nearest", houseRoom: 3 },
  { name: "Medium", gather: 1.0, vills: [20, 30, 36], firstAttack: 0, waveSize: 10, waveGrow: 0, ageVills: [13, 22], barracks2: false, outpost: true, target: "tc", houseRoom: 4 },
  { name: "Hard", gather: 1.15, vills: [22, 34, 42], firstAttack: 290, waveSize: 9, waveGrow: 4, ageVills: [12, 20], barracks2: true, outpost: true, target: "nearest", houseRoom: 5 },
];
const RATE = [0.72, 0.6, 0.65];        // villager gather speed per resource (food mixes berries/mill)
// always-on bookkeeping nodes and composite names left out of the decision log
const QUIET = new Set(["unpack crates", "plan demand", "Economy", "Production", "Army", "Waves", "Base building", "press or fall back"]);
const MIN_SHARE = [0.15, 0.2, 0.08];   // floors: no resource ever starves (wood keeps Houses coming)

export class AIPlayer {
  constructor(sim, p, level = 1) {
    this.sim = sim; this.p = p; this.L = LEVELS[level]; this.level = level;
    sim.players[p].gatherMult = this.L.gather;
    this.mode = "build"; this.nextAttack = this.L.firstAttack; this.wave = 0; this.sent = 0; this.attackers = new Set();
    this.n = 0; this.home = null; this.front = null;
    this.share = [0.5, 0.3, 0.2]; this.demand = [0, 0, 0]; this.lastTrace = []; this.recent = [];
    this.tree = this.buildTree();
  }
  get pl() { return this.sim.players[this.p]; }

  scan() {
    const sim = this.sim, st = sim.st, p = this.p;
    const r = { explorer: -1, crates: [], vills: [], idle: [], military: [], bld: {}, incomplete: [], assign: [0, 0, 0], builders: 0, enemyNear: [], enemyMil: { cav: 0, inf: 0, art: 0 } };
    for (const k in DEFS) r.bld[k] = [];
    const tc = this.pl.tc;
    const hx = tc >= 0 ? st.x[tc] : 64, hz = tc >= 0 ? st.z[tc] : 64;
    this.home = [hx, hz];
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e]) continue;
      const o = st.owner[e], d = DEF_LIST[st.def[e]];
      if (o === p) {
        if (d.crate) { r.crates.push(e); continue; }
        if (d.kind === "building") { r.bld[d.id].push(e); if (st.prog[e] < 1) r.incomplete.push(e); }
        else if (d.kind === "unit") {
          if (d.cls & C.VIL) {
            r.vills.push(e);
            const s = st.state[e];
            if (s === S.IDLE || (s === S.MOVE && sim.pathDone(e))) r.idle.push(e);
            else if (s === S.GATHER || s === S.RETURN) r.assign[st.ctype[e]]++;
            else if (s === S.BUILD) r.builders++;
          } else if (d.explorer) r.explorer = e;
          else r.military.push(e);
        }
      } else if (o < 2 && d.kind === "unit") {
        if (d.cls & C.CAV) r.enemyMil.cav++; else if (d.cls & C.ART) r.enemyMil.art++; else if (!(d.cls & C.VIL)) r.enemyMil.inf++;
        if (Math.hypot(st.x[e] - hx, st.z[e] - hz) < 26 && !(d.cls & C.VIL)) r.enemyNear.push(e);
      }
    }
    return r;
  }

  cmd(c) { this.cmdCount = (this.cmdCount || 0) + 1; this.sim.issue({ p: this.p, ...c }); }
  /** Leaf helper: SUCCESS only if fn actually issued a command. */
  did(fn) { const n0 = this.cmdCount || 0; fn(); return (this.cmdCount || 0) > n0; }

  think() {
    const sim = this.sim, pl = this.pl;
    if (!pl.alive || sim.over) return;
    this.n++;
    const bb = { ai: this, sim, st: sim.st, pl, r: this.scan(), time: sim.time, trace: [] };
    this.lastScan = bb.r;
    this.tree.tick(bb);
    this.lastTrace = bb.trace;
    // rolling log of decisions (leaf actions that did something), newest first, for the F4 overlay
    for (const name of bb.trace) {
      if (QUIET.has(name)) continue;
      if (this.recent.length && this.recent[0].name === name) { this.recent[0].t = sim.time; continue; }
      this.recent.unshift({ t: sim.time, name });
      if (this.recent.length > 7) this.recent.pop();
    }
  }

  // ---------------------------------------------------------------- the tree
  buildTree() {
    const L = this.L;
    const room = (bb) => bb.pl.popCap - bb.pl.popUsed;
    const has = (bb, k) => bb.r.bld[k].length > 0;
    const inProgress = (bb, k) => bb.r.bld[k].some((b) => bb.st.prog[b] < 1);
    const toward = (bb) => { const t = bb.sim.players[1 - this.p].tc; return t >= 0 ? [bb.st.x[t], bb.st.z[t]] : [64, 64]; };
    const ready = (bb) => bb.r.military.filter((e) => !this.attackers.has(e) && (bb.st.state[e] === S.IDLE || bb.st.state[e] === S.MOVE));
    const waveSize = () => Math.min(40, L.waveSize + this.wave * L.waveGrow);

    return par("Rival Crown AI",
      every(1, seq("Shipments", when("shipment point ready", (bb) => bb.pl.shipPoints > 0 && !bb.pl.ship), act("send best card", (bb) => this.did(() => this.shipments(bb.r))))),
      every(3, act("Treasure hunt", (bb) => this.did(() => this.treasureHunt(bb.r)))),
      seq("Economy",
        act("unpack crates", (bb) => { this.crates(bb.r); return true; }),
        act("plan demand", (bb) => { this.planDemand(bb); return true; }),
        act("assign idle villagers", (bb) => this.assignIdle(bb.r)),
        every(5, act("rebalance gatherers", (bb) => this.rebalance(bb.r)))),
      every(1, sel("Base building",
        seq("Finish foundations", when("foundation without builder", (bb) => this.abandoned(bb.r).length > 0), act("send a builder", (bb) => this.finishFoundations(bb.r))),
        seq("House", when("population almost full", (bb) => room(bb) <= L.houseRoom + bb.pl.age * 3 && bb.pl.popCap < 150), when("no house going up", (bb) => !inProgress(bb, "house")),
          act("place House near the Town Center", (bb) => this.build(bb.r, "house", 1, null, 7, 15))),
        seq("Barracks", when("no Barracks", (bb) => !has(bb, "barracks")), when("9+ villagers", (bb) => bb.r.vills.length >= 9),
          act("place Barracks toward the enemy", (bb) => this.build(bb.r, "barracks", 2, null, 9, 16, toward(bb)))),
        seq("Mill", when("berries gone, food short", (bb) => this.needMill(bb)), act("place Mill", (bb) => this.build(bb.r, "mill", 2, null, 8, 15))),
        seq("Second Barracks", when("Colonial, rich in wood", (bb) => bb.pl.age >= 1 && bb.r.bld.barracks.length < 2 && ((L.barracks2 && bb.r.vills.length >= 22) || (this.level > 0 && bb.pl.res[WOOD] > 450 && bb.r.vills.length >= 18))),
          act("place Barracks", (bb) => this.build(bb.r, "barracks", 2, null, 9, 18, toward(bb)))),
        seq("Stable", when("Colonial, no Stable", (bb) => bb.pl.age >= 1 && !has(bb, "stable")), act("place Stable", (bb) => this.build(bb.r, "stable", 2, null, 9, 18, toward(bb)))),
        seq("Outpost", when("Colonial, no Outpost", (bb) => bb.pl.age >= 1 && L.outpost && !has(bb, "outpost") && bb.r.vills.length > 16),
          act("place Outpost on the approach", (bb) => { const [hx, hz] = this.home, t = toward(bb); return this.build(bb.r, "outpost", 1, [hx + (t[0] - hx) * 0.22, hz + (t[1] - hz) * 0.22], 0, 6); })),
        seq("Foundry", when("Fortress, no Foundry", (bb) => bb.pl.age >= 2 && !has(bb, "foundry")), act("place Foundry", (bb) => this.build(bb.r, "foundry", 2, null, 9, 18, toward(bb)))))),
      par("Production",
        act("Age up", (bb) => this.ageUp(bb)),
        act("Villagers", (bb) => this.trainVillagers(bb)),
        act("Military", (bb) => this.trainMilitary(bb)),
        every(10, act("Rally at the front", (bb) => this.rally(bb.r)))),
      par("Army",
        seq("Defend base", when("enemies near base", (bb) => bb.r.enemyNear.length > 0), act("send defenders", (bb) => this.defend(bb.r))),
        sel("Waves",
          seq("Wave in progress", when("attacking", () => this.mode === "attack"),
            sel("press or fall back",
              seq("Recall", when("wave broken", (bb) => { this.prune(); return this.attackers.size < Math.max(2, this.sent * 0.3); }), act("fall back to the front", (bb) => this.recall(bb.r))),
              act("press on to the target", () => this.pressOn()))),
          seq("Launch wave", when("time for a wave", (bb) => this.mode === "build" && bb.time >= this.nextAttack),
            when(`army ≥ wave size`, (bb) => ready(bb).length >= waveSize() || (bb.time >= this.nextAttack + 150 && L.firstAttack > 0 && ready(bb).length >= Math.max(4, Math.ceil(waveSize() / 2)))),
            act("attack-move to the target", (bb) => this.launch(ready(bb)))))));
  }
  outline() { return outline(this.tree).join("\n"); }
  /** One-screen summary for the F4 overlay: mode, wave, economy plan and the branches that fired. */
  debug() {
    const st = this.sim.st, r = this.lastScan, pl = this.pl, L = this.L;
    if (!r) return "";
    const ready = r.military.filter((e) => !this.attackers.has(e) && (st.state[e] === S.IDLE || st.state[e] === S.MOVE)).length;
    const pct = (x) => Math.round(x * 100) + "%";
    return [
      `Rival Crown AI · ${L.name} · Behavior Tree`,
      `mode ${this.mode.toUpperCase()} · wave ${this.wave} · army ready ${ready}/${Math.min(40, L.waveSize + this.wave * L.waveGrow)}${this.mode === "attack" ? ` · attacking ${this.attackers.size}` : ""}`,
      `villagers ${r.vills.length} → food ${r.assign[0]} · wood ${r.assign[1]} · coin ${r.assign[2]} · idle ${r.idle.length}`,
      `plan (next min) food ${this.demand[0]} wood ${this.demand[1]} coin ${this.demand[2]} → split ${this.share.map(pct).join(" / ")}`,
      `pop ${pl.popUsed}/${pl.popCap} · ${["Discovery", "Colonial", "Fortress"][pl.age]}${pl.aging ? " (advancing)" : ""}${this.saving ? " · saving for Age" : ""}`,
      `recent decisions:`,
      ...this.recent.map((d) => `  ${String(Math.floor(d.t / 60)).padStart(2, "0")}:${String(Math.floor(d.t % 60)).padStart(2, "0")}  ${d.name}`),
    ].join("\n");
  }

  // ---------------------------------------------------------------- treasures
  // The Explorer collects unguarded chests and kills small wolf packs; idle soldiers clear guarded
  // camps near home when they clearly outnumber the guardians. Same commands as the player.
  treasureHunt(r) {
    const sim = this.sim, st = sim.st, [hx, hz] = this.home;
    const idleMil = r.military.filter((e) => st.state[e] === S.IDLE && !this.attackers.has(e));
    const list = [...sim.treasures.keys()].map((t) => ({ t, rec: sim.treasures.get(t), d: Math.hypot(st.x[t] - hx, st.z[t] - hz), g: guardsLeft(sim, t) })).sort((a, b) => a.d - b.d);
    const ex = r.explorer;
    if (ex >= 0 && (st.state[ex] === S.IDLE || (st.state[ex] === S.MOVE && sim.pathDone(ex)))) {
      const free = list.find((o) => o.g === 0 && o.d < 75 && canClaim(sim, ex, o.t).ok);
      const pack = list.find((o) => o.rec.kind === "cache" && o.g > 0 && o.g <= 2 && o.d < 50);
      if (free) this.cmd({ t: "target", ids: [ex], target: free.t });
      else if (pack && st.hp[ex] > st.maxHp[ex] * 0.85) this.cmd({ t: "target", ids: [ex], target: pack.rec.guards.find((g) => st.alive[g]) });
    }
    if (this.mode !== "build" || idleMil.length < 5) return;
    const camp = list.find((o) => o.d < 42 && o.g > 0 && o.g * 2 <= idleMil.length);
    if (camp) { this.cmd({ t: "target", ids: idleMil, target: camp.rec.guards.find((g) => st.alive[g]) }); return; }
    const open = list.find((o) => o.g === 0 && o.d < 45 && o.rec.claimBy === "any");
    if (open) this.cmd({ t: "target", ids: [idleMil[0]], target: open.t });
  }

  // ---------------------------------------------------------------- shipments
  // Spend a shipment point as soon as one is available: villagers early, crates when a resource
  // runs dry, soldiers when the base is threatened. Same cardStatus() the HUD uses.
  shipments(r) {
    const sim = this.sim, pl = this.pl;
    if (pl.shipPoints < 1 || pl.ship) return;
    let best = null, bs = -1e9;
    for (const id of pl.deck) {
      if (!cardStatus(sim, this.p, id).ok) continue;
      const c = CARDS[id], d = c.deliver;
      let sc = c.ai + sim.rng() * 2;
      const mil = (d.units || []).some(([k]) => k !== "villager");
      if (mil) sc += r.enemyNear.length >= 3 ? 8 : this.mode === "attack" ? 2 : -1;
      if ((d.units || []).some(([k]) => k === "villager") && r.vills.length >= this.L.vills[pl.age]) sc -= 6;
      for (const [res] of d.crates || []) if (pl.res[res] < 150) sc += 2;
      if (sc > bs) { bs = sc; best = id; }
    }
    if (best) this.cmd({ t: "card", card: best });
  }

  // ---------------------------------------------------------------- economy
  // shipment crates by the Town Center: a few villagers unpack them first
  crates(r) {
    const st = this.sim.st;
    if (!r.crates.length) return;
    const CR = GT.indexOf("crate");
    let on = r.vills.filter((v) => st.state[v] === S.GATHER && st.lastType[v] === CR).length;
    const want = Math.min(5, r.crates.length * 2), [hx, hz] = this.home;
    const pool = [...r.idle, ...r.vills.filter((v) => st.state[v] === S.GATHER && st.lastType[v] !== CR && st.carry[v] < 2 && Math.hypot(st.x[v] - hx, st.z[v] - hz) < 22)];
    while (on < want && pool.length) {
      const e = pool.shift();
      this.cmd({ t: "target", ids: [e], target: r.crates[on % r.crates.length] });
      const k = r.idle.indexOf(e); if (k >= 0) r.idle.splice(k, 1);
      on++;
    }
  }
  /**
   * Demand-driven economy: add up what the next ~minute of the plan will cost (villagers, the
   * soldiers each finished producer will train, the next House/Barracks/Mill, the next Age),
   * subtract the stockpile, and split the gatherers in proportion to what is missing — scaled by
   * how slowly each resource is gathered. A small floor keeps every resource flowing.
   */
  planDemand(bb) {
    const { r, pl, st } = bb, L = this.L, d = [0, 0, 0];
    const add = (cost, k = 1) => { for (let i = 0; i < 3; i++) d[i] += cost[i] * k; };
    if (r.vills.length < L.vills[pl.age]) add(DEFS.villager.cost, 5);
    const done = (k) => r.bld[k].filter((b) => st.prog[b] >= 1).length;
    add([62, 25, 12], 4 * done("barracks"));                                    // musketeer/pikeman mix
    if (pl.age >= 1) add(DEFS.grenadier.cost, done("barracks"));
    add(DEFS.hussar.cost, 3 * done("stable"));
    add(DEFS.falconet.cost, done("foundry"));
    // houses: whatever the plan trains needs room — ~1 House per 10 population trained this minute
    const popPerMin = (r.vills.length < L.vills[pl.age] ? 5 : 0) + 4 * done("barracks") + 6 * done("stable") + 3 * done("foundry");
    if (pl.popCap < 150) add(DEFS.house.cost, popPerMin / 10 + (pl.popCap - pl.popUsed <= L.houseRoom + 4 ? 1 : 0));
    if (!r.bld.barracks.length) add(DEFS.barracks.cost);
    if (this.needMill(bb)) add(DEFS.mill.cost);
    if (pl.age >= 1 && !r.bld.stable.length) add(DEFS.stable.cost);
    const next = AGES[pl.age + 1];
    if (next && !pl.aging && r.vills.length >= L.ageVills[pl.age] - 3) add(next.cost, 0.6); // a one-off goal, spread over ~2 min
    let tot = 0;
    for (let k = 0; k < 3; k++) {
      this.demand[k] = Math.round(d[k]);
      const need = Math.max(0, d[k] - pl.res[k]);
      this.share[k] = MIN_SHARE[k] + need / RATE[k] / 600;
      tot += this.share[k];
    }
    for (let k = 0; k < 3; k++) this.share[k] /= tot;
    const total = r.assign[0] + r.assign[1] + r.assign[2] + r.idle.length;
    this.want = this.share.map((sh) => sh * total);
  }
  assignIdle(r) {
    const want = this.want;
    if (!r.idle.length) return false;
    for (const e of r.idle) {
      let best = 0, bd = -1e9;
      for (let k = 0; k < 3; k++) { const def = want[k] - r.assign[k]; if (def > bd) { bd = def; best = k; } }
      if (this.sendGather(e, best, r)) r.assign[best]++;
      else if (this.sendGather(e, WOOD, r)) r.assign[WOOD]++;
    }
    return true;
  }
  rebalance(r) {
    const st = this.sim.st, want = this.want;
    const total = r.assign[0] + r.assign[1] + r.assign[2];
    if (total <= 6) return false;
    let over = -1, under = -1, om = 1.5, um = -1.5;
    for (let k = 0; k < 3; k++) { const d = r.assign[k] - want[k]; if (d > om) { om = d; over = k; } if (d < um) { um = d; under = k; } }
    if (over < 0 || under < 0) return false;
    const e = r.vills.find((v) => st.ctype[v] === over && st.state[v] === S.GATHER && st.carry[v] < 3);
    if (e === undefined) return false;
    return this.sendGather(e, under, r);
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

  abandoned(r) {
    const st = this.sim.st;
    return r.incomplete.filter((b) => !r.vills.some((v) => st.state[v] === S.BUILD && st.tgt[v] === b));
  }
  finishFoundations(r) {
    let any = false;
    for (const b of this.abandoned(r)) { const ids = this.pickBuilders(r, 1); if (ids.length) { this.cmd({ t: "target", ids, target: b }); any = true; } }
    return any;
  }
  needMill(bb) {
    const { sim, r } = bb;
    const building = r.bld.mill.some((b) => sim.st.prog[b] < 1);
    return sim.nearestResource(this.home[0], this.home[1], "berries", 30) < 0 && !building && r.bld.mill.length < 4
      && r.bld.mill.length < Math.ceil(r.assign[FOOD] / 9) + (bb.pl.age ? 1 : 0);
  }

  // ---------------------------------------------------------------- training & ages
  ageUp(bb) {
    const { sim, r, pl } = bb, next = AGES[pl.age + 1];
    this.saving = false;
    if (!next || pl.aging || r.vills.length < this.L.ageVills[pl.age]) return false;
    const a = ageStatus(sim, this.p);
    if (a.ok) { this.cmd({ t: "age" }); return true; }
    if (a.soft) this.saving = true;   // keep the Age cost aside while training soldiers
    return false;
  }
  trainVillagers(bb) {
    const { sim, st, r, pl } = bb, tc = pl.tc;
    if (tc < 0) return false;
    const q = st.queue.get(tc), ql = q ? q.items.length : 0;
    if (r.vills.length + ql < this.L.vills[pl.age] && ql < 2 && pl.res[FOOD] >= 50) { this.cmd({ t: "train", id: tc, def: "villager" }); return true; }
    if (r.explorer < 0 && limitLeft(sim, this.p, DEFS.explorer) > 0 && pl.res[COIN] >= 150 && r.vills.length >= 12) { this.cmd({ t: "train", id: tc, def: "explorer" }); return true; }
    return false;
  }
  /** Gradual training: every finished producer keeps at most 1–2 soldiers queued. */
  trainMilitary(bb) {
    const { sim, st, r, pl } = bb;
    if (r.military.length > 90) return false;
    const next = AGES[pl.age + 1];
    const reserve = this.saving && r.military.length >= 4 ? next.cost : [0, 0, 0];
    const afford = (d) => d.cost.every((c, i) => pl.res[i] - reserve[i] >= c);
    const em = r.enemyMil;
    let any = false;
    for (const b of r.bld.barracks) {
      if (st.prog[b] < 1) continue;
      const q = st.queue.get(b); if (q && q.items.length >= 2) continue;
      const pikeShare = 0.3 + (em.cav > em.inf ? 0.25 : 0) - (pl.res[2] > 400 ? 0.2 : 0);
      let def = sim.rng() < pikeShare ? "pikeman" : "musketeer";
      const roll = sim.rng();
      if (pl.age >= 2 && em.inf > em.cav && roll < 0.35) def = "skirmisher";
      else if (pl.age >= 1 && roll > 0.78) def = "grenadier";
      if (afford(DEFS[def])) { this.cmd({ t: "train", id: b, def }); any = true; }
    }
    for (const b of r.bld.stable) {
      if (st.prog[b] < 1) continue;
      const q = st.queue.get(b); if (q && q.items.length >= 1) continue;
      if (afford(DEFS.hussar)) { this.cmd({ t: "train", id: b, def: "hussar" }); any = true; }
    }
    const falc = r.military.filter((e) => DEF_LIST[st.def[e]].id === "falconet").length;
    for (const b of r.bld.foundry) {
      if (st.prog[b] < 1 || falc >= 4) continue;
      const q = st.queue.get(b); if (q && q.items.length >= 1) continue;
      if (afford(DEFS.falconet)) { this.cmd({ t: "train", id: b, def: "falconet" }); any = true; }
    }
    return any;
  }
  /** New soldiers gather at a point 13 tiles from home toward the enemy. */
  rally(r) {
    const sim = this.sim, st = sim.st;
    const enemyTC = sim.players[1 - this.p].tc, [hx, hz] = this.home;
    const tx = enemyTC >= 0 ? st.x[enemyTC] : 64, tz = enemyTC >= 0 ? st.z[enemyTC] : 64;
    const L = Math.hypot(tx - hx, tz - hz) || 1;
    this.front = [hx + (tx - hx) / L * 13, hz + (tz - hz) / L * 13];
    const ids = [...r.bld.barracks, ...r.bld.stable, ...r.bld.foundry];
    if (!ids.length) return false;
    this.cmd({ t: "rally", ids, x: this.front[0], z: this.front[1] });
    return true;
  }

  // ---------------------------------------------------------------- army
  prune() { const st = this.sim.st; for (const e of [...this.attackers]) if (!st.alive[e]) this.attackers.delete(e); }
  defend(r) {
    const st = this.sim.st, t = r.enemyNear[0];
    const defenders = r.military.filter((e) => !this.attackers.has(e) && st.state[e] !== S.ATTACK);
    if (defenders.length) this.cmd({ t: "move", ids: defenders, x: st.x[t], z: st.z[t], amove: 1 });
    if (r.enemyNear.length >= 6 && this.mode === "attack" && this.attackers.size < r.enemyNear.length) this.recall(r);
    return true;
  }
  launch(ids) {
    this.mode = "attack"; this.wave++; this.sent = ids.length;
    ids.forEach((e) => this.attackers.add(e));
    this.pushOn([...this.attackers]);
    this.sim.events.push("aiWave", { p: this.p, wave: this.wave, size: ids.length });
    return true;
  }
  pressOn() {
    const st = this.sim.st;
    const idle = [...this.attackers].filter((e) => st.state[e] === S.IDLE);
    if (!idle.length) return "running";
    this.pushOn(idle);
    return true;
  }
  /** Attack-move: Medium marches straight on the Town Center's coordinates (fighting whatever it meets). */
  pushOn(ids) {
    const sim = this.sim, st = sim.st, o = 1 - this.p;
    const [hx, hz] = this.home;
    let t = this.L.target === "tc" ? sim.players[o].tc : -1;
    if (t < 0) t = sim.nearest(hx, hz, (b) => st.owner[b] === o && (st.mask[b] & CM.BUILDING) && DEF_LIST[st.def[b]].id !== "house");
    if (t < 0) t = sim.players[o].tc;
    if (t < 0) return;
    this.cmd({ t: "move", ids, x: st.x[t], z: st.z[t], amove: 1 });
  }
  recall(r) {
    this.mode = "build"; this.nextAttack = this.sim.time + (this.L.firstAttack ? 110 : 45);
    const ids = [...this.attackers]; this.attackers.clear();
    const f = this.front || this.home;
    if (ids.length) this.cmd({ t: "move", ids, x: f[0], z: f[1] });
  }
}

export { LEVELS };

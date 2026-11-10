// Frontier Crown — input → selection + commands. Mouse/keyboard and landscape touch.
// The controller never edits the world: every action becomes a command for the sim.

import { DEFS, DEF_LIST, C } from "../data/defs.js";
import { CM, S } from "../sim/ecs.js";
import { W, H, BC, SLOPE_BUILD, SLOPE_CLIFF, T } from "../sim/map.js";

export class Controller {
  constructor({ sim, view, me = 0, sfx, canvas, touch = false }) {
    this.sim = sim; this.view = view; this.me = me; this.sfx = sfx || (() => {}); this.canvas = canvas; this.touch = touch;
    this.sel = view.selection;
    this.mode = null;            // {kind:'place', def} | {kind:'amove'}
    this.groups = new Map(); this.lastGroupKey = null; this.lastGroupT = 0;
    this.mouse = { x: innerWidth / 2, y: innerHeight / 2, inside: false };
    this.drag = null; this.mid = null; this.keys = new Set();
    this.lastClick = { t: 0, e: -1 };
    this.boxMode = false;
    this.lastAlert = null;
    this.onChange = () => {};
    this.enabled = true;
    this.boxEl = document.getElementById("boxSel");
    this.infoEl = document.getElementById("terrInfo");
    this.showGrid = false;
    this.ac = new AbortController();
    this.bind();
  }
  issue(c) { this.sim.issue({ p: this.me, ...c }); }
  own(e) { const st = this.sim.st; return st.alive[e] && st.owner[e] === this.me; }
  units() { const st = this.sim.st; return [...this.sel].filter((e) => this.own(e) && (st.mask[e] & CM.UNIT)); }
  villagers() { const st = this.sim.st; return this.units().filter((e) => st.mask[e] & CM.GATHERER); }

  // ------------------------------------------------------------------ selection
  setSel(ids, add = false) {
    if (!add) this.sel.clear();
    for (const e of ids) this.sel.add(e);
    this.onChange();
  }
  clearSel() { this.sel.clear(); this.onChange(); }
  pruneSel() { let ch = false; for (const e of [...this.sel]) if (!this.sim.st.alive[e]) { this.sel.delete(e); ch = true; } if (ch) this.onChange(); }
  centerOn(e) { const st = this.sim.st; if (st.alive[e]) this.view.cam.focus(st.x[e], st.z[e] + 3); }

  clickSelect(sx, sy, shift, dbl) {
    const { e } = this.view.pick(sx, sy, innerWidth, innerHeight);
    const st = this.sim.st;
    if (e < 0) { if (!shift) this.clearSel(); return; }
    const mine = this.own(e) && (st.mask[e] & (CM.UNIT | CM.BUILDING));
    if (mine && dbl && (st.mask[e] & CM.UNIT)) {
      const def = st.def[e], ids = [];
      for (let k = 0; k < st.top; k++) if (st.alive[k] && st.owner[k] === this.me && st.def[k] === def && this.view.onScreen(k, innerWidth, innerHeight)) ids.push(k);
      this.setSel(ids, shift); this.sfx("select", { ui: true }); return;
    }
    if (mine && shift && [...this.sel].every((k) => this.own(k) && (st.mask[k] & CM.UNIT)) && (st.mask[e] & CM.UNIT)) {
      if (this.sel.has(e)) this.sel.delete(e); else this.sel.add(e);
      this.onChange(); this.sfx("select", { ui: true }); return;
    }
    this.setSel([e]);
    this.sfx(mine ? "select" : "click", { ui: true });
    if (mine && (st.mask[e] & CM.UNIT)) this.unitVoice(e);
  }
  unitVoice(e) {
    const d = DEF_LIST[this.sim.st.def[e]];
    if (d.id === "hussar" && Math.random() < 0.5) this.sfx("neigh", { ui: true, gain: 0.8 });
  }

  // ------------------------------------------------------------------ commands
  smartCommand(sx, sy) {
    const st = this.sim.st;
    const { e, gp } = this.view.pick(sx, sy, innerWidth, innerHeight);
    if (!gp) return;
    const units = this.units();
    if (units.length) {
      if (e >= 0 && !(this.own(e) && (st.mask[e] & CM.UNIT))) {
        this.issue({ t: "target", ids: units, target: e });
        const enemy = st.owner[e] < 2 && st.owner[e] !== this.me;
        this.view.addMarker(st.x[e], st.z[e], enemy ? "attack" : (st.mask[e] & CM.RESOURCE) ? "gather" : "move");
        this.sfx("order", { ui: true });
        return;
      }
      this.issue({ t: "move", ids: units, x: gp.x, z: gp.z });
      this.view.addMarker(gp.x, gp.z, "move");
      this.sfx("order", { ui: true });
      return;
    }
    const prods = [...this.sel].filter((b) => this.own(b) && (st.mask[b] & CM.PRODUCER));
    if (prods.length) {
      const tgt = e >= 0 && ((st.mask[e] & CM.RESOURCE) || (this.own(e) && DEF_LIST[st.def[e]].farm)) ? e : -1;
      this.issue({ t: "rally", ids: prods, x: gp.x, z: gp.z, target: tgt });
      this.view.addMarker(gp.x, gp.z, tgt >= 0 ? "gather" : "move");
      this.sfx("order", { ui: true });
    }
  }
  attackMove(sx, sy) {
    const gp = this.view.cam.ground(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    if (!gp) return;
    const ids = this.units().filter((e) => !(this.sim.st.mask[e] & CM.GATHERER));
    if (ids.length) { this.issue({ t: "move", ids, x: gp.x, z: gp.z, amove: 1 }); this.view.addMarker(gp.x, gp.z, "attack"); this.sfx("order", { ui: true }); }
    this.mode = null;
  }
  startPlace(def) {
    if (!this.villagers().length) return;
    const pl = this.sim.players[this.me], d = DEFS[def];
    if (!d.cost.every((c, i) => pl.res[i] >= c)) { this.sfx("error", { ui: true }); this.onNotice && this.onNotice("Not enough resources", "error"); return; }
    if (d.age > pl.age) { this.sfx("error", { ui: true }); return; }
    this.mode = { kind: "place", def };
    this.sfx("click", { ui: true });
  }
  placementAt(sx, sy) {
    const gp = this.view.cam.ground(sx / innerWidth * 2 - 1, -(sy / innerHeight) * 2 + 1);
    if (!gp || !this.mode || this.mode.kind !== "place") return null;
    const d = DEFS[this.mode.def];
    const i = Math.round(gp.x - d.size / 2), j = Math.round(gp.z - d.size / 2);
    const g = this.sim.grid;
    let ok = g.canPlace(i, j, d.size);
    if (ok) for (let b = j; b < j + d.size && ok; b++) for (let a = i; a < i + d.size; a++) if (!g.exp[this.me][b * W + a]) { ok = false; break; }
    return { i, j, ok };
  }
  place(sx, sy, keep) {
    const p = this.placementAt(sx, sy);
    if (!p) return;
    if (!p.ok) { this.sfx("error", { ui: true }); return; }
    const ids = this.villagers();
    this.issue({ t: "build", ids, def: this.mode.def, i: p.i, j: p.j });
    this.sfx("hammer", { ui: true });
    const pl = this.sim.players[this.me], d = DEFS[this.mode.def];
    const canAgain = d.cost.every((c, i) => pl.res[i] - c >= c);
    if (!keep || !canAgain) this.mode = null;
  }
  train(b, def, n = 1) {
    const pl = this.sim.players[this.me], d = DEFS[def];
    if (!d.cost.every((c, i) => pl.res[i] >= c)) { this.sfx("error", { ui: true }); this.onNotice && this.onNotice("Not enough resources", "error"); return; }
    const ids = [...this.sel].filter((e) => this.own(e) && DEF_LIST[this.sim.st.def[e]].trains && DEF_LIST[this.sim.st.def[e]].trains.includes(def));
    const list = ids.length ? ids : [b];
    // spread across selected producers, shortest queue first
    const st = this.sim.st;
    const cnt = new Map(list.map((x) => [x, (st.queue.get(x) || { items: [] }).items.length]));
    for (let k = 0; k < n; k++) {
      let best = list[0];
      for (const x of list) if (cnt.get(x) < cnt.get(best)) best = x;
      this.issue({ t: "train", id: best, def });
      cnt.set(best, cnt.get(best) + 1);
    }
    this.sfx("click", { ui: true });
  }
  stop() { const ids = this.units(); if (ids.length) { this.issue({ t: "stop", ids }); this.sfx("order", { ui: true }); } }
  del() { const ids = [...this.sel].filter((e) => this.own(e)); if (ids.length) { this.issue({ t: "delete", ids }); this.clearSel(); } }
  idleVillager() {
    const st = this.sim.st, list = [];
    for (let e = 0; e < st.top; e++) if (this.own(e) && (st.mask[e] & CM.GATHERER) && st.state[e] === S.IDLE) list.push(e);
    if (!list.length) return;
    this.idleIdx = ((this.idleIdx || 0) + 1) % list.length;
    const e = list[this.idleIdx]; this.setSel([e]); this.centerOn(e); this.sfx("select", { ui: true });
  }
  selectTC() { const tc = this.sim.players[this.me].tc; if (tc >= 0) { this.setSel([tc]); this.centerOn(tc); this.sfx("select", { ui: true }); } }
  allMilitary() {
    const st = this.sim.st, ids = [];
    for (let e = 0; e < st.top; e++) if (this.own(e) && (st.mask[e] & CM.UNIT) && !(st.mask[e] & CM.GATHERER)) ids.push(e);
    if (ids.length) { this.setSel(ids); this.sfx("select", { ui: true }); }
  }

  // ------------------------------------------------------------------ binding
  dispose() { this.enabled = false; this.ac.abort(); }
  bind() {
    const cv = this.canvas, sig = { signal: this.ac.signal };
    cv.addEventListener("contextmenu", (e) => e.preventDefault(), sig);
    this.pointers = new Map();
    cv.addEventListener("pointerdown", (e) => this.down(e), sig);
    addEventListener("pointermove", (e) => this.move(e), sig);
    addEventListener("pointerup", (e) => this.up(e), sig);
    addEventListener("pointercancel", (e) => { this.pointers.delete(e.pointerId); this.drag = null; this.hideBox(); }, sig);
    cv.addEventListener("wheel", (e) => { e.preventDefault(); if (this.enabled) this.view.cam.zoom(e.deltaY * (e.deltaMode === 1 ? 30 : 1)); }, { passive: false, signal: this.ac.signal });
    document.addEventListener("mouseleave", () => (this.mouse.inside = false), sig);
    document.addEventListener("mouseenter", () => (this.mouse.inside = true), sig);
    addEventListener("keydown", (e) => this.key(e, true), sig);
    addEventListener("keyup", (e) => this.key(e, false), sig);
    addEventListener("blur", () => this.keys.clear(), sig);
  }
  down(e) {
    if (!this.enabled) return;
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    if (e.pointerType === "touch") return this.touchDown(e);
    if (e.button === 1) { this.mid = { x: e.clientX, y: e.clientY }; e.preventDefault(); return; }
    if (e.button === 2) {
      if (this.mode) { this.mode = null; return; }
      this.rdown = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY, box: false };
  }
  move(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    if (!this.enabled) return;
    if (e.pointerType === "touch") return this.touchMove(e);
    if (this.mid) { const k = 0.06; this.view.cam.pan(-(e.clientX - this.mid.x) * k, -(e.clientY - this.mid.y) * k); this.mid = { x: e.clientX, y: e.clientY }; return; }
    if (this.drag && !this.mode) {
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      if (!this.drag.box && Math.hypot(dx, dy) > 7) this.drag.box = true;
      if (this.drag.box) this.showBox(this.drag.x, this.drag.y, e.clientX, e.clientY);
    }
  }
  up(e) {
    if (e.pointerType === "touch") return this.touchUp(e);
    if (e.button === 1) { this.mid = null; return; }
    if (!this.enabled) { this.drag = null; this.hideBox(); return; }
    if (e.button === 2 && this.rdown) {
      if (Math.hypot(e.clientX - this.rdown.x, e.clientY - this.rdown.y) < 12 && e.target === this.canvas) this.smartCommand(e.clientX, e.clientY);
      this.rdown = null; return;
    }
    if (e.button !== 0 || !this.drag) return;
    const d = this.drag; this.drag = null;
    if (!d.box && e.target === this.canvas) { const h = this.view.cam.ground(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); if (h && h.nx !== undefined) this.lastGroundClick = h; }
    if (this.mode && this.mode.kind === "place") { if (e.target === this.canvas) this.place(e.clientX, e.clientY, e.shiftKey); return; }
    if (this.mode && this.mode.kind === "amove") { if (e.target === this.canvas) this.attackMove(e.clientX, e.clientY); return; }
    if (d.box) {
      this.hideBox();
      const ids = this.view.boxSelect(Math.min(d.x, e.clientX), Math.min(d.y, e.clientY), Math.max(d.x, e.clientX), Math.max(d.y, e.clientY), innerWidth, innerHeight);
      if (ids.length) { this.setSel(ids, e.shiftKey); this.sfx("select", { ui: true }); }
      else if (!e.shiftKey) this.clearSel();
      return;
    }
    if (e.target !== this.canvas) return;
    const now = performance.now();
    const { e: hit } = this.view.pick(e.clientX, e.clientY, innerWidth, innerHeight);
    const dbl = now - this.lastClick.t < 320 && hit === this.lastClick.e && hit >= 0;
    this.lastClick = { t: now, e: hit };
    this.clickSelect(e.clientX, e.clientY, e.shiftKey, dbl);
  }
  showBox(x0, y0, x1, y1) {
    if (!this.boxEl) return;
    const s = this.boxEl.style; this.boxEl.hidden = false;
    s.left = Math.min(x0, x1) + "px"; s.top = Math.min(y0, y1) + "px"; s.width = Math.abs(x1 - x0) + "px"; s.height = Math.abs(y1 - y0) + "px";
  }
  hideBox() { if (this.boxEl) this.boxEl.hidden = true; }

  // ---- touch: tap = select / smart order, one-finger drag = pan (or box in box mode), pinch = zoom
  touchDown(e) {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), moved: true }; }
  }
  touchMove(e) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    const px = p.x, py = p.y; p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinch) { this.view.cam.zoom((this.pinch.d - d) * 4); this.pinch.d = d; }
      this.view.cam.pan(-(e.clientX - px) * 0.03, -(e.clientY - py) * 0.03);
      return;
    }
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 12) p.moved = true;
    if (!p.moved) return;
    if (this.boxMode && !this.mode) this.showBox(p.sx, p.sy, p.x, p.y);
    else this.view.cam.pan(-(e.clientX - px) * 0.075, -(e.clientY - py) * 0.075);
  }
  touchUp(e) {
    const p = this.pointers.get(e.pointerId); this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.pinch = null;
    if (!p || !this.enabled) return;
    if (p.moved) {
      if (this.boxMode && !this.mode) {
        this.hideBox();
        const ids = this.view.boxSelect(Math.min(p.sx, p.x), Math.min(p.sy, p.y), Math.max(p.sx, p.x), Math.max(p.sy, p.y), innerWidth, innerHeight);
        if (ids.length) { this.setSel(ids); this.sfx("select", { ui: true }); }
        this.boxMode = false; this.onChange();
      }
      return;
    }
    if (e.target !== this.canvas) return;
    const long = performance.now() - p.t > 550;
    if (this.mode && this.mode.kind === "place") { this.place(p.x, p.y, false); return; }
    if (this.mode && this.mode.kind === "amove") { this.attackMove(p.x, p.y); return; }
    if (long) { this.clearSel(); return; }
    // tap: own thing → select; anything else with own units/producers selected → order
    const { e: hit } = this.view.pick(p.x, p.y, innerWidth, innerHeight);
    const st = this.sim.st;
    const haveOrders = this.units().length || [...this.sel].some((b) => this.own(b) && (st.mask[b] & CM.PRODUCER));
    const tapOwn = hit >= 0 && this.own(hit) && (st.mask[hit] & (CM.UNIT | CM.BUILDING));
    const tapOwnSite = tapOwn && (st.mask[hit] & CM.BUILDING) && (st.prog[hit] < 1 || DEF_LIST[st.def[hit]].farm) && this.villagers().length;
    if (haveOrders && (!tapOwn || tapOwnSite)) { this.smartCommand(p.x, p.y); return; }
    const now = performance.now(), dbl = now - this.lastClick.t < 350 && hit === this.lastClick.e && hit >= 0;
    this.lastClick = { t: now, e: hit };
    this.clickSelect(p.x, p.y, false, dbl);
  }

  key(e, down) {
    if (e.target && e.target.closest && e.target.closest("input,textarea,select")) return;
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (!down || !this.enabled) return;
    const st = this.sim.st;
    if (/^Digit[0-9]$/.test(e.code)) {
      const n = e.code.slice(5);
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); this.groups.set(n, [...this.sel].filter((k) => this.own(k))); this.onNotice && this.onNotice(`Group ${n} set`); return; }
      const g = (this.groups.get(n) || []).filter((k) => this.own(k));
      if (g.length) {
        const now = performance.now();
        if (this.lastGroupKey === n && now - this.lastGroupT < 400) this.centerOn(g[0]);
        this.lastGroupKey = n; this.lastGroupT = now;
        this.setSel(g, e.shiftKey); this.sfx("select", { ui: true });
      }
      return;
    }
    switch (e.code) {
      case "KeyH": case "Home": this.selectTC(); break;
      case "KeyG": this.showGrid = !this.showGrid; this.onNotice && this.onNotice(this.showGrid ? "Build grid on (G)" : "Build grid off (G)"); break;
      case "F3": case "KeyI": e.preventDefault(); if (this.infoEl) this.infoEl.hidden = !this.infoEl.hidden; break;
      case "Period": case "Comma": this.idleVillager(); break;
      case "Delete": this.del(); break;
      case "Space": if (this.lastAlert) { this.view.cam.focus(this.lastAlert.x, this.lastAlert.z + 3); e.preventDefault(); } break;
      case "PageUp": this.view.cam.zoom(-300); break;
      case "PageDown": this.view.cam.zoom(300); break;
    }
  }

  update(dt) {
    if (!this.enabled) return;
    const k = this.keys; let px = 0, pz = 0;
    if (k.has("ArrowLeft")) px -= 1; if (k.has("ArrowRight")) px += 1;
    if (k.has("ArrowUp")) pz -= 1; if (k.has("ArrowDown")) pz += 1;
    if (!this.touch && this.mouse.inside && !this.drag && !this.mid && document.hasFocus()) {
      const m = 4;
      if (this.mouse.x <= m) px -= 1; else if (this.mouse.x >= innerWidth - m) px += 1;
      if (this.mouse.y <= m) pz -= 1; else if (this.mouse.y >= innerHeight - m) pz += 1;
    }
    if (px || pz) this.view.cam.pan(px * dt * 34, pz * dt * 34);
    // hover + ghost + build grid
    this.view.gridState = null;
    if (this.mode && this.mode.kind === "place") {
      const p = this.placementAt(this.mouse.x, this.mouse.y);
      if (p) {
        const sz = DEFS[this.mode.def].size;
        this.view.setGhost(this.mode.def, p.i, p.j, p.ok);
        this.view.gridState = { x: p.i + sz / 2, z: p.j + sz / 2, foot: [p.i, p.j, p.i + sz, p.j + sz], ok: p.ok, radius: 10 + sz };
      }
      this.view.hover = -1;
    } else {
      if (this.showGrid && (this.mouse.inside || this.touch)) {
        const gp = this.view.cam.ground(this.mouse.x / innerWidth * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
        if (gp) this.view.gridState = { x: gp.x, z: gp.z, radius: 11 };
      }
      this.view.setGhost(null);
      if (!this.touch && this.mouse.inside) {
        const { e } = this.view.pick(this.mouse.x, this.mouse.y, innerWidth, innerHeight);
        this.view.hover = e;
        this.cursorFor(e);
      } else this.view.hover = -1;
    }
    if (this.mode && this.mode.kind === "place" && !this.villagers().length) this.mode = null;
    if (this.infoEl && !this.infoEl.hidden) this.updateInfo();
  }
  // F3: terrain inspector — exact X/Y/Z under the cursor from the heightmap ray picker.
  describeTile(i, j) {
    const g = this.sim.grid, k = j * W + i;
    if (!g.exp[this.me][k] && !this.view.fog.reveal) return "Unexplored";
    const c = g.tileClass(k);
    if (c === BC.OCCUPIED) return "Occupied";
    if (g.terrain[k] === T.DEEP) return "Deep water";
    if (g.terrain[k] === T.SHALLOW) return "Shallow water (walkable)";
    if (g.slope[k] > SLOPE_CLIFF || g.terrain[k] === T.ROCK) return "Cliff (blocked)";
    if (g.slope[k] > SLOPE_BUILD) return "Steep (walkable, not buildable)";
    return "Buildable";
  }
  updateInfo() {
    const h = this.view.cam.ground(this.mouse.x / innerWidth * 2 - 1, -(this.mouse.y / innerHeight) * 2 + 1);
    const f = (v) => v.toFixed(2);
    let html = "<b>Terrain</b> <kbd>F3</kbd>";
    if (h && h.nx !== undefined) {
      const k = h.j * W + h.i, g = this.sim.grid;
      html += `<div>Cursor X ${f(h.x)} · Y ${f(h.y)} · Z ${f(h.z)}</div><div>Tile ${h.i}, ${h.j} · slope ${f(g.slope[k])} · normal (${f(h.nx)}, ${f(h.ny)}, ${f(h.nz)})</div><div class="cls">${this.describeTile(h.i, h.j)}</div>`;
    } else html += "<div>Cursor is off the map</div>";
    if (this.lastGroundClick) { const c = this.lastGroundClick; html += `<div class="dim">Last click X ${f(c.x)} · Y ${f(c.y)} · Z ${f(c.z)}</div>`; }
    if (this.infoEl.innerHTML !== html) this.infoEl.innerHTML = html;
  }
  cursorFor(e) {
    const st = this.sim.st, cv = this.canvas;
    let c = "";
    if (this.mode && this.mode.kind === "amove") c = "c-attack";
    else if (e >= 0 && this.units().length) {
      if (st.owner[e] < 2 && st.owner[e] !== this.me) c = "c-attack";
      else if ((st.mask[e] & CM.RESOURCE) && this.villagers().length) c = "c-gather";
      else if (this.own(e) && (st.mask[e] & CM.BUILDING) && st.prog[e] < 1 && this.villagers().length) c = "c-build";
    }
    if (cv.dataset.c !== c) { cv.classList.remove("c-attack", "c-gather", "c-build"); if (c) cv.classList.add(c); cv.dataset.c = c; }
  }
}

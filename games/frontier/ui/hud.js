// Frontier Crown — HUD: resource bar, selection panel, command card, minimap, notifications.
// Reads the sim; acts only through the Controller (which issues commands).

import { DEFS, DEF_LIST, AGES, SHIPMENTS, RES, C, TEAM_CSS, CARRY } from "../data/defs.js";
import { CM, S } from "../sim/ecs.js";
import { W, H } from "../sim/map.js";
import { ICON } from "./icons.js";
import { GT } from "../sim/systems/command.js";

const HOT = "QWERTASDFGZXCVB";
const $ = (id) => document.getElementById(id);
const fmt = (n) => String(Math.floor(n));
const costHTML = (cost) => cost.map((c, i) => (c ? `<span class="c">${ICON[RES[i]]}${c}</span>` : "")).join("");

export class HUD {
  constructor({ sim, view, ctl, me = 0, sfx, onMenu, onSpeed, touch }) {
    this.sim = sim; this.view = view; this.ctl = ctl; this.me = me; this.sfx = sfx; this.onMenu = onMenu; this.onSpeed = onSpeed; this.touch = touch;
    this.el = {
      food: $("rFood"), wood: $("rWood"), coin: $("rCoin"), pop: $("rPop"), age: $("ageName"), ageBar: $("ageBar"), clock: $("clock"),
      card: $("card"), sel: $("selPanel"), feed: $("feed"), tip: $("tip"), idle: $("idleBtn"), idleN: $("idleN"),
      ship: $("shipPanel"), mini: $("mini"), speed: $("btnSpeed"), boxBtn: $("tBox"),
    };
    this.prev = {}; this.cardSig = ""; this.selSig = ""; this.selT = 0; this.miniT = 0; this.idleT = 0; this.pings = [];
    this.page = 0; // villager card page (0 = main)
    this.ac = new AbortController();
    this.el.card.innerHTML = "";
    this.mctx = this.el.mini.getContext("2d");
    this.fogCan = document.createElement("canvas"); this.fogCan.width = W; this.fogCan.height = H;
    this.fogCtx = this.fogCan.getContext("2d"); this.fogImg = this.fogCtx.createImageData(W, H);
    this.bind();
    this.ctl.onChange = () => { this.cardSig = ""; this.selSig = ""; };
    this.ctl.onNotice = (t, k) => this.notify(t, k);
    this.buttons = [];
    for (let i = 0; i < 15; i++) {
      const b = document.createElement("button"); b.className = "cb empty"; b.dataset.i = i;
      b.innerHTML = `<span class="ic"></span><kbd>${HOT[i]}</kbd>`;
      b.addEventListener("click", (e) => this.press(i, e.shiftKey));
      b.addEventListener("pointerenter", () => this.showTip(i));
      b.addEventListener("pointerleave", () => this.hideTip());
      this.el.card.appendChild(b); this.buttons.push(b);
    }
    $("rIconFood").innerHTML = ICON.food; $("rIconWood").innerHTML = ICON.wood; $("rIconCoin").innerHTML = ICON.coin; $("rIconPop").innerHTML = ICON.pop;
    $("idleIcon").innerHTML = ICON.idle;
    this.el.age.parentElement.addEventListener("click", () => this.ctl.selectTC(), { signal: this.ac.signal });
  }

  dispose() { this.ac.abort(); this.el.card.innerHTML = ""; this.hideTip(); }
  bind() {
    const sig = { signal: this.ac.signal };
    addEventListener("keydown", (e) => {
      if (!this.ctl.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && e.target.closest && e.target.closest("input,textarea,select")) return;
      const k = e.code.startsWith("Key") ? e.code.slice(3) : "";
      const i = HOT.indexOf(k);
      if (i >= 0 && k) { if (this.spec && this.spec[i]) { e.preventDefault(); this.press(i, e.shiftKey); } }
    }, sig);
    this.el.idle.addEventListener("click", () => this.ctl.idleVillager(), sig);
    this.el.speed.addEventListener("click", () => this.onSpeed && this.onSpeed(), sig);
    $("btnMenu").addEventListener("click", () => this.onMenu && this.onMenu(), sig);
    if (this.el.boxBtn) this.el.boxBtn.addEventListener("click", () => { this.ctl.boxMode = !this.ctl.boxMode; this.el.boxBtn.classList.toggle("on", this.ctl.boxMode); }, sig);
    const dsel = $("tDesel"); if (dsel) dsel.addEventListener("click", () => this.ctl.clearSel(), sig);
    const tarmy = $("tArmy"); if (tarmy) tarmy.addEventListener("click", () => this.ctl.allMilitary(), sig);
    // minimap
    const mini = this.el.mini;
    const toWorld = (e) => { const r = mini.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * W, (e.clientY - r.top) / r.height * H]; };
    let dragging = false;
    mini.addEventListener("contextmenu", (e) => e.preventDefault(), sig);
    mini.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      const [x, z] = toWorld(e);
      if (e.button === 2 || (this.touch && this.ctl.units().length && this.miniOrder)) {
        const ids = this.ctl.units(); if (ids.length) { this.ctl.issue({ t: "move", ids, x, z }); this.view.addMarker(x, z, "move"); this.sfx("order", { ui: true }); }
        return;
      }
      dragging = true; mini.setPointerCapture(e.pointerId); this.view.cam.focus(x, z + 4);
    }, sig);
    mini.addEventListener("pointermove", (e) => { if (dragging) { const [x, z] = toWorld(e); this.view.cam.focus(x, z + 4); } }, sig);
    mini.addEventListener("pointerup", () => (dragging = false), sig);
    this.el.ship.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-ch]"); if (!b) return;
      this.ctl.issue({ t: "ship", choice: +b.dataset.ch }); this.sfx("click", { ui: true });
      this.el.ship.hidden = true; this.shipShown = 0;
    }, sig);
  }

  // ------------------------------------------------------------------ command card
  buildSpec() {
    const sim = this.sim, st = sim.st, ctl = this.ctl, pl = sim.players[this.me];
    const sel = [...ctl.sel].filter((e) => st.alive[e]);
    const spec = new Array(15).fill(null);
    if (!sel.length || !ctl.own(sel[0])) return spec;
    const vills = ctl.villagers(), units = ctl.units();
    const can = (d) => {
      if (d.age > pl.age) return { ok: false, why: `Requires the ${AGES[d.age].name}` };
      if (!d.cost.every((c, i) => pl.res[i] >= c)) return { ok: false, why: "Not enough resources", soft: true };
      return { ok: true };
    };
    if (vills.length) {
      ["house", "mill", "barracks", "outpost", "stable", "foundry"].forEach((k, i) => {
        const d = DEFS[k];
        spec[i] = { icon: ICON[k], name: `Build ${d.name}`, cost: d.cost, desc: d.desc, avail: () => can(d), run: () => ctl.startPlace(k), locked: d.age > pl.age };
      });
    }
    if (units.length) {
      if (units.some((e) => !(st.mask[e] & CM.GATHERER))) spec[vills.length ? 10 : 0] = { icon: ICON.amove, name: "Attack-move", desc: "Move and engage every enemy met on the way. Then click the destination.", avail: () => ({ ok: true }), run: () => { ctl.mode = { kind: "amove" }; } };
      spec[vills.length ? 11 : 1] = { icon: ICON.stop, name: "Stop", desc: "Halt and hold position.", avail: () => ({ ok: true }), run: () => ctl.stop() };
      spec[14] = { icon: ICON.del, name: "Delete", desc: "Remove the selected units. (Delete)", avail: () => ({ ok: true }), run: () => ctl.del() };
      return spec;
    }
    // buildings (use the first selected type)
    const b = sel[0], bd = DEF_LIST[st.def[b]];
    if (bd.kind !== "building") return spec;
    if (st.prog[b] >= 1 && bd.trains) bd.trains.forEach((k, i) => {
      const d = DEFS[k];
      spec[i] = { icon: ICON[k], name: `Train ${d.name}`, cost: d.cost, desc: `${d.desc} Shift-click for 5.`, avail: () => can(d), run: (shift) => ctl.train(b, k, shift ? 5 : 1), locked: d.age > pl.age, def: k };
    });
    if (bd.id === "towncenter" && st.prog[b] >= 1 && pl.age < AGES.length - 1) {
      const a = AGES[pl.age + 1];
      spec[5] = { icon: ICON.age, name: `Advance to the ${a.name}`, cost: a.cost, desc: `Takes ${a.time}s. Unlocks new buildings and units, and a shipment from the Crown.`,
        avail: () => pl.aging ? { ok: false, why: "Already advancing" } : pl.pendingShip ? { ok: false, why: "Choose your shipment first" } : a.cost.every((c, i) => pl.res[i] >= c) ? { ok: true } : { ok: false, why: "Not enough resources", soft: true },
        run: () => { ctl.issue({ t: "age" }); this.sfx("click", { ui: true }); } };
    }
    if (bd.id !== "towncenter") spec[14] = { icon: ICON.del, name: "Delete", desc: "Demolish this building.", avail: () => ({ ok: true }), run: () => ctl.del() };
    return spec;
  }
  press(i, shift) {
    const s = this.spec && this.spec[i]; if (!s) return;
    const a = s.avail();
    if (!a.ok) { this.sfx("error", { ui: true }); this.notify(a.why, "error"); return; }
    s.run(shift);
    this.cardSig = "";
  }
  showTip(i) {
    const s = this.spec && this.spec[i]; if (!s) return this.hideTip();
    const a = s.avail();
    this.el.tip.innerHTML = `<b>${s.name}</b> <kbd>${HOT[i]}</kbd>${s.cost ? `<div class="cost">${costHTML(s.cost)}</div>` : ""}<p>${s.desc || ""}</p>${a.ok ? "" : `<p class="why">${a.why}</p>`}`;
    this.el.tip.hidden = false;
    const r = this.buttons[i].getBoundingClientRect();
    this.el.tip.style.left = Math.max(8, Math.min(innerWidth - 280, r.left + r.width / 2 - 130)) + "px";
    this.el.tip.style.bottom = (innerHeight - r.top + 8) + "px";
  }
  hideTip() { this.el.tip.hidden = true; }

  renderCard() {
    const spec = this.spec = this.buildSpec();
    for (let i = 0; i < 15; i++) {
      const b = this.buttons[i], s = spec[i];
      if (!s) { b.className = "cb empty"; b.querySelector(".ic").innerHTML = ""; b.removeAttribute("aria-label"); continue; }
      b.className = "cb"; b.querySelector(".ic").innerHTML = s.icon; b.setAttribute("aria-label", s.name);
    }
  }
  refreshCardState() {
    if (!this.spec) return;
    const st = this.sim.st;
    for (let i = 0; i < 15; i++) {
      const s = this.spec[i]; if (!s) continue;
      const a = s.avail(), b = this.buttons[i];
      b.classList.toggle("off", !a.ok && !a.soft);
      b.classList.toggle("poor", !a.ok && !!a.soft);
      b.classList.toggle("armed", (this.ctl.mode && this.ctl.mode.kind === "amove" && s.icon === ICON.amove) || (this.ctl.mode && this.ctl.mode.kind === "place" && s.name === `Build ${DEFS[this.ctl.mode.def].name}`));
    }
  }

  // ------------------------------------------------------------------ selection panel
  renderSel() {
    const sim = this.sim, st = sim.st, ctl = this.ctl;
    const sel = [...ctl.sel].filter((e) => st.alive[e]);
    const el = this.el.sel;
    if (!sel.length) { el.innerHTML = `<div class="empty-sel">${this.touch ? "Tap a unit or building to select it. Drag to scroll, pinch to zoom." : "Left-click to select · drag a box for many · right-click to order"}</div>`; return; }
    if (sel.length === 1) {
      const e = sel[0], d = DEF_LIST[st.def[e]], o = st.owner[e];
      const team = o < 2 ? TEAM_CSS[o] : "#c9b27a";
      let rows = "", extra = "";
      if (d.kind === "resource" || (d.cls === C.ANIMAL)) {
        rows = `<div class="stat">${ICON[RES[d.res]]}<b>${fmt(st.amount[e])}</b> ${RES[d.res]} left</div>`;
      } else {
        const hp = `<div class="hp"><i style="width:${(st.hp[e] / st.maxHp[e] * 100).toFixed(1)}%"></i><span>${fmt(Math.max(0, st.hp[e]))} / ${fmt(st.maxHp[e])}</span></div>`;
        rows += hp;
        if (d.atk) {
          const bonus = d.atk.bonus ? Object.entries(d.atk.bonus).map(([k, v]) => `×${v} vs ${clsName(+k)}`).join(", ") : "";
          rows += `<div class="stat">${ICON.sword}<b>${d.atk.dmg}</b> ${d.atk.type}${d.atk.range > 1.5 ? ` · range ${d.atk.range}` : ""}${bonus ? ` · <em>${bonus}</em>` : ""}</div>`;
        }
        if (d.armor && (d.armor.ranged || d.armor.melee) && d.kind === "unit") rows += `<div class="stat">${ICON.shield}${d.armor.ranged ? `${Math.round(d.armor.ranged * 100)}% ranged resist` : ""}${d.armor.melee ? ` ${Math.round(d.armor.melee * 100)}% melee resist` : ""}</div>`;
        if (d.gather && o === this.me) rows += `<div class="stat status">${villagerStatus(sim, e)}</div>`;
        if (d.kind === "building") {
          if (st.prog[e] < 1) rows += `<div class="stat status">Under construction · ${Math.floor(st.prog[e] * 100)}%</div>`;
          else if (d.pop) rows += `<div class="stat">${ICON.pop}+${d.pop} population</div>`;
          if (d.drop) rows += `<div class="stat">Drop-off: ${d.drop.map((r) => ICON[RES[r]]).join("")}</div>`;
          const q = st.queue.get(e);
          if (o === this.me && q && q.items.length) {
            extra += `<div class="queue">` + q.items.map((di, k) => {
              const qd = DEF_LIST[di];
              const p = k === 0 ? Math.min(100, q.t / qd.train * 100) : 0;
              return `<button class="qi" data-cancel="${k}" title="Cancel ${qd.name}">${ICON[qd.id]}${k === 0 ? `<i style="width:${p.toFixed(0)}%"></i>` : ""}</button>`;
            }).join("") + (q.blocked ? `<span class="warn">Need houses</span>` : "") + `</div>`;
          }
          const pl = sim.players[o];
          if (d.id === "towncenter" && pl.aging && o === this.me) extra += `<div class="aging">${ICON.age}<span>Advancing to the ${AGES[pl.aging.to].name}</span><div class="bar"><i style="width:${(pl.aging.t / pl.aging.total * 100).toFixed(1)}%"></i></div></div>`;
        }
      }
      el.innerHTML = `<div class="one"><div class="portrait" style="--tc:${team}">${ICON[d.id] || ""}</div><div class="info"><div class="nm">${d.name}<span class="own" style="color:${team}">${o === this.me ? "Yours" : o < 2 ? "Enemy" : "Wild"}</span></div>${rows}${extra}</div></div>`;
      el.querySelectorAll("[data-cancel]").forEach((b) => b.addEventListener("click", () => { this.ctl.issue({ t: "cancel", id: e, index: +b.dataset.cancel }); this.sfx("click", { ui: true }); }));
      return;
    }
    // many
    const list = sel.slice(0, 36);
    el.innerHTML = `<div class="many">${list.map((e) => { const d = DEF_LIST[st.def[e]]; return `<button class="mi" data-e="${e}" title="${d.name}" style="--tc:${TEAM_CSS[st.owner[e]] || "#c9b27a"}">${ICON[d.id] || ""}<i style="width:${(st.hp[e] / st.maxHp[e] * 100).toFixed(0)}%"></i></button>`; }).join("")}${sel.length > 36 ? `<span class="more">+${sel.length - 36}</span>` : ""}</div>`;
    el.querySelectorAll("[data-e]").forEach((b) => b.addEventListener("click", (ev) => {
      const e = +b.dataset.e;
      if (ev.shiftKey) { this.ctl.sel.delete(e); } else { this.ctl.sel.clear(); this.ctl.sel.add(e); }
      this.ctl.onChange(); this.sfx("select", { ui: true });
    }));
  }

  // ------------------------------------------------------------------ minimap
  renderMini() {
    const sim = this.sim, st = sim.st, g = sim.grid, ctx = this.mctx, cw = this.el.mini.width, ch = this.el.mini.height, me = this.me;
    const sx = cw / W, sz = ch / H, reveal = this.view.fog.reveal;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.view.miniImage, 0, 0, cw, ch);
    // resources & buildings & units
    const vis = g.vis[me], exp = g.exp[me];
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e]) continue;
      const m = st.mask[e], d = DEF_LIST[st.def[e]], x = st.x[e], z = st.z[e], k = Math.floor(z) * W + Math.floor(x);
      if ((m & CM.RESOURCE) && !(m & CM.UNIT)) {
        if (d.id === "tree" || (!exp[k] && !reveal)) continue;
        ctx.fillStyle = d.id === "goldmine" ? "#ffd84a" : "#ff7aa8";
        const r = d.id === "goldmine" ? 2.4 : 1.2; ctx.fillRect(x * sx - r, z * sz - r, r * 2, r * 2); continue;
      }
      const o = st.owner[e];
      if (o === 2) { if (vis[k] || reveal) { ctx.fillStyle = "#e9d3a8"; ctx.fillRect(x * sx - 1, z * sz - 1, 2, 2); } continue; }
      if (o !== me && !reveal) {
        if (m & CM.BUILDING) { if (!(this.view.known[e] && this.view.knownGen[e] === st.gen[e])) continue; }
        else if (!vis[k]) continue;
      }
      ctx.fillStyle = TEAM_CSS[o];
      if (m & CM.BUILDING) { const s = d.size * sx; ctx.fillRect(x * sx - s / 2, z * sz - s / 2, s, s); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1; ctx.strokeRect(x * sx - s / 2, z * sz - s / 2, s, s); }
      else { const r = this.ctl.sel.has(e) ? 2.2 : 1.6; ctx.fillRect(x * sx - r, z * sz - r, r * 2, r * 2); }
    }
    // fog
    if (!reveal) {
      const id = this.fogImg.data;
      for (let i = 0; i < W * H; i++) { id[i * 4 + 3] = vis[i] ? 0 : exp[i] ? 105 : 236; }
      this.fogCtx.putImageData(this.fogImg, 0, 0);
      ctx.drawImage(this.fogCan, 0, 0, cw, ch);
    }
    // camera viewport
    const cam = this.view.cam, pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([a, b]) => cam.ground(a, b) || cam.ground(a, b * 0.4) || { x: cam.tx, z: cam.tz });
    ctx.strokeStyle = "rgba(255,255,255,.9)"; ctx.lineWidth = 1.5; ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p.x * sx, p.z * sz) : ctx.moveTo(p.x * sx, p.z * sz)));
    ctx.closePath(); ctx.stroke();
    // pings
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 4000);
    for (const p of this.pings) {
      const k = ((now - p.t) % 1000) / 1000;
      ctx.strokeStyle = `rgba(255,70,50,${1 - k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x * sx, p.z * sz, 4 + k * 14, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // ------------------------------------------------------------------ notifications
  notify(text, kind = "", at = null) {
    const d = document.createElement("div"); d.className = "note " + kind; d.textContent = text;
    this.el.feed.prepend(d);
    while (this.el.feed.children.length > 5) this.el.feed.lastChild.remove();
    setTimeout(() => d.classList.add("fade"), 5200); setTimeout(() => d.remove(), 6200);
    if (at) this.pings.push({ x: at.x, z: at.z, t: performance.now() });
  }
  onEvents(list) {
    const st = this.sim.st, me = this.me;
    for (const ev of list) {
      if (ev.type === "built" && ev.p === me) this.notify(`${DEF_LIST[st.def[ev.e]].name} built`);
      else if (ev.type === "attacked" && ev.p === me) { this.notify("You are under attack!", "alert", ev); this.ctl.lastAlert = { x: ev.x, z: ev.z }; }
      else if (ev.type === "age") { if (ev.p === me) this.notify(`You have reached the ${AGES[ev.age].name}!`, "gold"); else this.notify(`The Rival Crown has reached the ${AGES[ev.age].name}`, "alert"); this.cardSig = ""; }
      else if (ev.type === "shipment" && ev.p === me) this.notify(`Shipment arrived: ${ev.name}`, "gold");
      else if (ev.type === "died" && ev.owner === me && ev.building) this.notify(`${DEF_LIST[ev.def].name} destroyed`, "alert", ev);
      else if (ev.type === "died" && ev.owner !== me && ev.owner < 2 && ev.building) this.notify(`Enemy ${DEF_LIST[ev.def].name} destroyed`, "gold");
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const sim = this.sim, pl = sim.players[this.me], el = this.el, P = this.prev;
    const set = (k, node, v) => { if (P[k] !== v) { P[k] = v; node.textContent = v; } };
    set("f", el.food, fmt(pl.res[0])); set("w", el.wood, fmt(pl.res[1])); set("c", el.coin, fmt(pl.res[2]));
    set("p", el.pop, `${pl.popUsed}/${pl.popCap}`);
    el.pop.parentElement.classList.toggle("capped", pl.popUsed >= pl.popCap);
    set("a", el.age, AGES[pl.age].name);
    const ap = pl.aging ? (pl.aging.t / pl.aging.total * 100).toFixed(1) + "%" : "0%";
    if (P.ap !== ap) { P.ap = ap; el.ageBar.style.width = ap; el.ageBar.parentElement.classList.toggle("on", !!pl.aging); }
    const t = Math.floor(sim.time), clock = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    set("t", el.clock, clock);
    // card
    const st = sim.st, selArr = [...this.ctl.sel];
    const sig = selArr.slice(0, 6).map((e) => `${e}:${st.def[e]}:${st.prog[e] >= 1 ? 1 : 0}`).join(",") + "|" + pl.age + "|" + selArr.length + "|" + (pl.aging ? 1 : 0) + (pl.pendingShip ? 1 : 0);
    if (sig !== this.cardSig) { this.cardSig = sig; this.renderCard(); this.selT = 1; }
    this.refreshCardState();
    // selection panel at ~6 Hz
    this.selT += dt; if (this.selT > 0.16) { this.selT = 0; this.renderSel(); }
    this.miniT += dt; if (this.miniT > 0.2) { this.miniT = 0; this.renderMini(); }
    this.idleT += dt;
    if (this.idleT > 0.5) {
      this.idleT = 0;
      let n = 0; for (let e = 0; e < st.top; e++) if (st.alive[e] && st.owner[e] === this.me && (st.mask[e] & CM.GATHERER) && st.state[e] === S.IDLE) n++;
      el.idleN.textContent = n; el.idle.classList.toggle("on", n > 0);
    }
    // shipment choice
    if (pl.pendingShip && this.shipShown !== pl.pendingShip) {
      this.shipShown = pl.pendingShip;
      const opts = SHIPMENTS[pl.pendingShip];
      el.ship.innerHTML = `<h3>${ICON.age} The Crown sends a shipment</h3><p>Choose one for the ${AGES[pl.pendingShip].name}.</p><div class="opts">${opts.map((o, i) => `<button data-ch="${i}"><b>${o.name}</b><span>${o.desc}</span></button>`).join("")}</div>`;
      el.ship.hidden = false;
    }
    if (!pl.pendingShip && !el.ship.hidden) el.ship.hidden = true;
  }
}

function clsName(k) { return k === C.CAV ? "cavalry" : k === C.INF ? "infantry" : k === C.ART ? "artillery" : k === C.BLD ? "buildings" : k === C.VIL ? "villagers" : "ranged"; }
function villagerStatus(sim, e) {
  const st = sim.st, s = st.state[e];
  const carry = st.carry[e] > 0 ? ` · carrying ${Math.floor(st.carry[e])} ${RES[st.ctype[e]]}` : "";
  if (s === S.GATHER) { const gt = GT[st.lastType[e]]; return ({ berries: "Foraging berries", hunt: "Hunting", mill: "Farming at the mill", wood: "Chopping wood", coin: "Mining coin" }[gt] || "Gathering") + carry; }
  if (s === S.RETURN) return "Returning resources" + carry;
  if (s === S.BUILD) return "Building";
  if (s === S.MOVE) return "Moving" + carry;
  if (s === S.ATTACK) return "Fighting";
  return "Idle" + carry;
}

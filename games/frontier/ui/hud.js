// Frontier Crown — HUD: resource bar, selection panel, command card, minimap, notifications.
// Reads the sim; acts only through the Controller (which issues commands).

import { DEFS, DEF_LIST, AGES, RES, C, TEAM_CSS, CARRY } from "../data/defs.js";
import { CARDS } from "../data/cards.js";
import { cardStatus } from "../sim/economy/shipments.js";
import { CM, S } from "../sim/ecs.js";
import { W, H } from "../sim/map.js";
import { ICON } from "./icons.js";
import { GT, limitLeft } from "../sim/systems/command.js";
import { guardsLeft, rewardLabel } from "../sim/treasures.js";
import { G_NAME } from "../sim/guardians.js";
import { ageStatus, unlocksFor } from "../sim/economy/age.js";
import { ECO } from "../sim/economy/villager-fsm.js";

const HOT = "QWERTASDFGZXCVB";
const $ = (id) => document.getElementById(id);
const fmt = (n) => String(Math.floor(n));
const costHTML = (cost) => cost.map((c, i) => (c ? `<span class="c">${ICON[RES[i]]}${c}</span>` : "")).join("");

export class HUD {
  constructor({ sim, view, ctl, me = 0, sfx, onMenu, onSpeed, input }) {
    this.sim = sim; this.view = view; this.ctl = ctl; this.me = me; this.sfx = sfx; this.onMenu = onMenu; this.onSpeed = onSpeed; this.input = input;
    this.el = {
      food: $("rFood"), wood: $("rWood"), coin: $("rCoin"), rates: [$("rateFood"), $("rateWood"), $("rateCoin")], pop: $("rPop"), age: $("ageName"), ageBar: $("ageBar"), clock: $("clock"),
      card: $("card"), sel: $("selPanel"), feed: $("feed"), tip: $("tip"), idle: $("idleBtn"), idleN: $("idleN"),
      ship: $("shipPanel"), shipBtn: $("shipBtn"), xpFill: $("xpFill"), shipN: $("shipN"), shipT: $("shipT"), mini: $("mini"), speed: $("btnSpeed"), topbar: $("topbar"), bottom: $("bottom"),
    };
    this.seenNew = new Set(); // "NEW" badges the player has already used
    this.prev = {}; this.cardSig = ""; this.selSig = ""; this.selT = 0; this.miniT = 0; this.idleT = 0; this.pings = [];
    this.page = 0; // villager card page (0 = main)
    this.ac = new AbortController();
    this.el.card.innerHTML = "";
    this.mctx = this.el.mini.getContext("2d");
    this.bind();
    this.ctl.onChange = () => { this.cardSig = ""; this.selSig = ""; };
    this.ctl.onNotice = (t, k) => this.notify(t, k);
    this.buttons = [];
    for (let i = 0; i < 15; i++) {
      const b = document.createElement("button"); b.className = "cb empty"; b.dataset.i = i;
      b.innerHTML = `<span class="ic"></span><kbd>${this.hotLabel(i)}</kbd>`;
      b.addEventListener("click", (e) => this.press(i, e.shiftKey));
      b.addEventListener("pointerenter", () => this.showTip(i));
      b.addEventListener("pointerleave", () => this.hideTip());
      this.el.card.appendChild(b); this.buttons.push(b);
    }
    $("rIconFood").innerHTML = ICON.food; $("rIconWood").innerHTML = ICON.wood; $("rIconCoin").innerHTML = ICON.coin; $("rIconPop").innerHTML = ICON.pop;
    $("idleIcon").innerHTML = ICON.idle; $("shipIc").innerHTML = ICON.ship;
    this.deckOpen = false; this.deckSig = ""; this.deckT = 0;
    this.el.age.parentElement.addEventListener("click", () => this.ctl.selectTC(), { signal: this.ac.signal });
  }

  get touch() { return this.input ? this.input.device === "touch" : false; }
  camKey(k) { return this.view.cam.settings.wasd && (k === "W" || k === "A" || k === "S" || k === "D"); }
  hotLabel(i) { return (this.camKey(HOT[i]) ? "Alt+" : "") + HOT[i]; }
  /** Settings changed (camera keys): relabel the command card. */
  relabel() { this.buttons.forEach((b, i) => { const k = b.querySelector("kbd"); if (k) k.textContent = this.hotLabel(i); }); }
  dispose() { this.ac.abort(); this.el.card.innerHTML = ""; this.hideTip(); }
  bind() {
    const sig = { signal: this.ac.signal };
    addEventListener("keydown", (e) => {
      if (!this.ctl.enabled || e.ctrlKey || e.metaKey) return;
      if (e.target && e.target.closest && e.target.closest("input,textarea,select")) return;
      const k = e.code.startsWith("Key") ? e.code.slice(3) : "";
      // "Camera keys: WASD" → plain W/A/S/D pan the camera; Alt+W/A/S/D reach the command card
      if (this.camKey(k) ? !e.altKey : e.altKey) return;
      if (e.altKey) e.preventDefault();
      if (k === "O") { e.preventDefault(); this.toggleDeck(); return; }
      const i = HOT.indexOf(k);
      if (i >= 0 && k) { if (this.spec && this.spec[i]) { e.preventDefault(); this.press(i, e.shiftKey); } }
    }, sig);
    this.el.idle.addEventListener("click", () => this.ctl.idleVillager(), sig);
    this.el.speed.addEventListener("click", () => this.onSpeed && this.onSpeed(), sig);
    $("btnMenu").addEventListener("click", () => this.onMenu && this.onMenu(), sig);
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
    // Crown Shipments: topbar button, O, Esc closes; clicks on cards issue {t:"card"} commands
    this.el.shipBtn.addEventListener("click", () => this.toggleDeck(), sig);
    addEventListener("keydown", (e) => { if (e.code === "Escape" && this.deckOpen) { e.stopImmediatePropagation(); e.preventDefault(); this.toggleDeck(false); } }, { capture: true, signal: this.ac.signal });
    this.el.ship.addEventListener("click", (e) => {
      if (e.target.closest(".close")) { this.toggleDeck(false); return; }
      const b = e.target.closest("button[data-card]"); if (!b) return;
      const st = cardStatus(this.sim, this.me, b.dataset.card);
      if (!st.ok) { this.sfx("error", { ui: true }); this.notify(st.why, "error"); return; }
      this.ctl.issue({ t: "card", card: b.dataset.card }); this.sfx("click", { ui: true });
      this.deckSig = ""; setTimeout(() => this.toggleDeck(false), 120);
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
      if (d.age > pl.age) return { ok: false, why: `Locked — unlocks in the ${AGES[d.age].name} (advance at the Town Center)` };
      if (d.limit && limitLeft(sim, this.me, d) <= 0) return { ok: false, why: `Only ${d.limit} ${d.name} at a time` };
      if (!d.cost.every((c, i) => pl.res[i] >= c)) return { ok: false, why: "Not enough resources", soft: true };
      return { ok: true };
    };
    if (vills.length) {
      ["house", "mill", "barracks", "outpost", "stable", "foundry"].forEach((k, i) => {
        const d = DEFS[k];
        spec[i] = { icon: ICON[k], name: `Build ${d.name}`, cost: d.cost, desc: d.desc, avail: () => can(d), run: () => ctl.startPlace(k), locked: d.age > pl.age, def: k };
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
    if (bd.id === "towncenter" && st.prog[b] >= 1 && pl.aging) {
      const a = AGES[pl.aging.to];
      spec[5] = { icon: ICON.cancelAge, name: `Cancel advance to the ${a.name}`, desc: "Stops the advance and returns its full cost to your stockpile.",
        avail: () => ({ ok: !!pl.aging, why: "Not advancing" }), run: () => { ctl.issue({ t: "ageCancel" }); this.sfx("click", { ui: true }); } };
    } else if (bd.id === "towncenter" && st.prog[b] >= 1 && pl.age < AGES.length - 1) {
      const a = AGES[pl.age + 1], u = unlocksFor(pl.age + 1);
      const names = (ks) => ks.map((k) => DEFS[k].name);
      const unl = [...names(u.buildings), ...Object.entries(u.byProducer).map(([b, ks]) => `${names(ks).join(", ")} at the ${DEFS[b].name}`)].join(" · ");
      const req = a.requires?.built ? ` Requires ${a.requires.built} completed buildings.` : "";
      spec[5] = { icon: ICON.age, name: `Advance to the ${a.name}`, cost: a.cost, desc: `The cost is paid now and refunded if you cancel. Takes ${a.time}s.${req} Unlocks: ${unl}. Plus a shipment from the Crown.`,
        avail: () => ageStatus(this.sim, this.me),
        run: () => { ctl.issue({ t: "age" }); this.sfx("click", { ui: true }); } };
    }
    if (bd.id !== "towncenter") spec[14] = { icon: ICON.del, name: "Delete", desc: "Demolish this building.", avail: () => ({ ok: true }), run: () => ctl.del() };
    return spec;
  }
  press(i, shift) {
    const s = this.spec && this.spec[i]; if (!s) return;
    const a = s.avail();
    if (!a.ok) { this.sfx("error", { ui: true }); this.notify(a.why, "error"); return; }
    if (s.def) this.seenNew.add(s.def);
    s.run(shift);
    this.cardSig = "";
  }
  showTip(i) {
    const s = this.spec && this.spec[i]; if (!s) return this.hideTip();
    const a = s.avail();
    this.el.tip.innerHTML = `<b>${s.name}</b> <kbd>${this.hotLabel(i)}</kbd>${s.cost ? `<div class="cost">${costHTML(s.cost)}</div>` : ""}<p>${s.desc || ""}</p>${a.ok ? "" : `<p class="why">${a.why}</p>`}`;
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
      const pl = this.sim.players[this.me], ua = s.def && pl.unlockedAt[s.def];
      const fresh = ua !== undefined && this.sim.time - ua < 90 && !this.seenNew.has(s.def);
      b.className = "cb" + (s.locked ? " locked" : "") + (fresh ? " new" : ""); b.querySelector(".ic").innerHTML = s.icon;
      b.setAttribute("aria-label", s.name + (s.locked ? " (locked)" : fresh ? " (new)" : ""));
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
    if (!sel.length) { el.innerHTML = `<div class="empty-sel">${this.touch ? "Tap to select · hold 0.4 s to order · drag a box for many · two fingers pan & zoom" : "Left-click to select · drag a box for many · right-click to order"}</div>`; return; }
    if (sel.length === 1) {
      const e = sel[0], d = DEF_LIST[st.def[e]], o = st.owner[e];
      const team = TEAM_CSS[o] || "#c9b27a";
      let rows = "", extra = "";
      const tr = sim.treasures.get(e);
      if (tr) {
        const left = guardsLeft(sim, e);
        rows = `<div class="stat">${ICON.treasure}<b>${rewardLabel(tr.reward)}</b></div>`
          + `<div class="stat status">${left ? `Guarded by ${left} — defeat them, then walk onto the chest` : "Unguarded — walk any unit onto the chest"}</div>`
          + (tr.claimBy === "explorer" ? `<div class="stat"><em>Only an Explorer can open it</em></div>` : "");
      } else if (d.kind === "resource" || (d.cls === C.ANIMAL)) {
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
        const gd = sim.guards.get(e);
        if (gd) rows += `<div class="stat status">Treasure guardian · ${G_NAME[gd.state]}</div>`;
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
      el.innerHTML = `<div class="one"><div class="portrait" style="--tc:${team}">${ICON[d.id] || (d.crate ? ICON[RES[d.res]] : "")}</div><div class="info"><div class="nm">${tr ? tr.name : d.name}<span class="own" style="color:${team}">${o === this.me ? "Yours" : o < 2 ? "Enemy" : o === 3 ? "Hostile" : "Wild"}</span></div>${rows}${extra}</div></div>`;
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
    const sx = cw / W, sz = ch / H, fog = this.view.fog, reveal = fog.reveal;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.view.miniImage, 0, 0, cw, ch);
    // fog: the SAME canvas the 3D view samples (tile-resolution copy), multiplied over the map:
    // black where unexplored, dimmed where explored, untouched in sight
    const fc = fog.miniCanvas();
    if (!reveal) { ctx.globalCompositeOperation = "multiply"; ctx.drawImage(fc, 0, 0, cw, ch); ctx.globalCompositeOperation = "source-over"; }
    // dots, filtered by the fog value under them (read back from that canvas)
    const SEEN = 200, KNOWN = 40;
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e]) continue;
      const m = st.mask[e], d = DEF_LIST[st.def[e]], x = st.x[e], z = st.z[e], f = fog.at(x, z);
      if (m & CM.TREASURE) {
        if (f < KNOWN) continue;
        ctx.fillStyle = "#fff0a0"; ctx.beginPath(); ctx.arc(x * sx, z * sz, 2.6, 0, 6.283); ctx.fill();
        ctx.strokeStyle = "rgba(60,40,10,.9)"; ctx.lineWidth = 1; ctx.stroke(); continue;
      }
      if (st.owner[e] === 3 && f < SEEN) continue; // guardians only where you can see them
      if ((m & CM.RESOURCE) && !(m & CM.UNIT)) {
        if (d.id === "tree" || f < KNOWN) continue;
        ctx.fillStyle = d.crate ? "#ffe9a8" : d.id === "goldmine" ? "#ffd84a" : "#ff7aa8";
        const r = d.id === "goldmine" ? 2.4 : 1.2; ctx.fillRect(x * sx - r, z * sz - r, r * 2, r * 2); continue;
      }
      const o = st.owner[e];
      if (o === 2) { if (f >= SEEN) { ctx.fillStyle = "#e9d3a8"; ctx.fillRect(x * sx - 1, z * sz - 1, 2, 2); } continue; }
      if (o !== me && !reveal) {
        // enemy buildings: last-seen memory in explored land; enemy units: only in sight
        if (m & CM.BUILDING) { if (f < KNOWN || !(this.view.known[e] && this.view.knownGen[e] === st.gen[e])) continue; }
        else if (f < SEEN) continue;
      }
      ctx.fillStyle = TEAM_CSS[o];
      if (m & CM.BUILDING) { const s = d.size * sx; ctx.fillRect(x * sx - s / 2, z * sz - s / 2, s, s); ctx.strokeStyle = "rgba(0,0,0,.6)"; ctx.lineWidth = 1; ctx.strokeRect(x * sx - s / 2, z * sz - s / 2, s, s); }
      else { const r = this.ctl.sel.has(e) ? 2.2 : 1.6; ctx.fillRect(x * sx - r, z * sz - r, r * 2, r * 2); }
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

  // ------------------------------------------------------------------ Crown Shipments deck
  toggleDeck(open = !this.deckOpen) {
    this.deckOpen = open; this.deckSig = "";
    this.el.ship.classList.toggle("deck", open);
    this.el.ship.hidden = !open;
    if (open) this.renderDeck();
    this.sfx("click", { ui: true });
  }
  renderDeck() {
    const sim = this.sim, pl = sim.players[this.me];
    const rows = pl.deck.map((id) => ({ id, c: CARDS[id], s: cardStatus(sim, this.me, id) }));
    const sig = pl.shipPoints + "|" + Math.floor(pl.xp) + "|" + (pl.ship ? pl.ship.id + Math.ceil(pl.ship.total - pl.ship.t) : "") + "|" + rows.map((r) => r.s.state + (r.s.ok ? 1 : 0) + Math.ceil(r.s.cooldownLeft)).join(",");
    if (sig === this.deckSig) return;
    this.deckSig = sig;
    const R = ["I", "II", "III"];
    const sail = pl.ship ? `<div class="sailbar">${ICON.ship}<span class="trk"><i style="width:${(pl.ship.t / pl.ship.total * 100).toFixed(1)}%"></i></span><span>${CARDS[pl.ship.id].name} arrives in ${Math.ceil(pl.ship.total - pl.ship.t)}s</span></div>` : "";
    const card = ({ id, c, s }) => {
      const uses = c.uses == null ? "∞" : `${Math.max(0, s.usesLeft)}/${c.uses}`;
      const cls = s.state === "ready" && !s.ok ? "nopoint" : s.state;
      const cd = s.state === "cooldown" ? ` data-cd="${Math.ceil(s.cooldownLeft)}" style="--cd:${(s.cooldownLeft / (c.cooldown || 1) * 100).toFixed(0)}%"` : "";
      return `<button class="scard ${cls}" data-card="${id}" title="${s.ok ? "Send this shipment" : s.why}"${cd}><span class="ic">${ICON[c.icon] || ICON.ship}</span><span class="age">${R[c.age]}</span><b>${c.name}</b><p>${c.desc}</p><span class="meta"><span title="Uses left">${uses} left</span><span title="Voyage time">${c.travel}s</span>${c.cooldown ? `<span title="Cooldown after arrival">CD ${c.cooldown}s</span>` : ""}</span></button>`;
    };
    this.el.ship.innerHTML = `<div class="deckHead"><h3>${ICON.ship} Crown Shipments</h3><span class="xpline">XP <b>${Math.floor(pl.xp)} / ${pl.xpNext}</b> · <b>${pl.shipPoints}</b> available</span><button class="close" aria-label="Close">×</button></div>${sail}<div class="deckGrid">${rows.map(card).join("")}</div>`;
  }

  flashSpent(cost) {
    [this.el.food, this.el.wood, this.el.coin].forEach((n, i) => { if (!cost[i]) return; const r = n.parentElement; r.classList.remove("spent"); void r.offsetWidth; r.classList.add("spent"); });
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
      else if (ev.type === "age") {
        if (ev.p === me) {
          this.notify(`You have reached the ${AGES[ev.age].name}!`, "gold");
          const list = [...ev.buildings, ...ev.units].map((k) => DEFS[k].name);
          if (list.length) this.notify(`Unlocked: ${list.join(", ")}`, "gold");
        } else this.notify(`The Rival Crown has reached the ${AGES[ev.age].name}`, "alert");
        this.cardSig = "";
      }
      else if (ev.type === "aging" && ev.p === me) { this.notify(`Advancing to the ${AGES[ev.to].name} — ${ev.cost.map((c, i) => c ? `${c} ${RES[i]}` : "").filter(Boolean).join(", ")} spent`); this.flashSpent(ev.cost); }
      else if (ev.type === "shipPoint" && ev.p === me) { this.notify(ev.why === "age" ? "The new Age brings a shipment! Press O" : ev.why === "lost" ? "Shipment returned — its point is back" : "Shipment available! Press O to choose a card", "gold"); this.deckSig = ""; }
      else if (ev.type === "shipSent" && ev.p === me) this.notify(`${CARDS[ev.card].name} sails from the Crown — arrives in ${Math.round(ev.travel)}s`);
      else if (ev.type === "shipArrived" && ev.p === me) { this.notify(`Shipment arrived: ${CARDS[ev.card].name}`, "gold", ev); this.ctl.lastAlert = { x: ev.x, z: ev.z }; }
      else if (ev.type === "shipArrived" && ev.p !== me && ev.units.some((e) => this.sim.st.alive[e] && !(DEF_LIST[this.sim.st.def[e]].cls & C.VIL)) && this.view.seen(ev.x, ev.z)) this.notify(`The Rival Crown received ${CARDS[ev.card].name}`, "alert");
      else if (ev.type === "treasureClaimed" && ev.p === me) this.notify(`Treasure claimed: ${ev.label}`, "gold", ev);
      else if (ev.type === "treasureClaimed" && ev.p !== me && this.view.seen(ev.x, ev.z)) this.notify(`The Rival Crown took a treasure (${ev.label})`, "alert");
      else if (ev.type === "claimBlocked" && ev.p === me) this.notify(ev.why, "error");
      else if (ev.type === "agecancel" && ev.p === me) this.notify(ev.lost ? "Age advance lost with the Town Center" : `Advance cancelled — resources refunded`, ev.lost ? "alert" : "");
      else if (ev.type === "shipment" && ev.p === me) this.notify(`Shipment arrived: ${ev.name}`, "gold");
      else if (ev.type === "died" && ev.owner === me && ev.building) this.notify(`${DEF_LIST[ev.def].name} destroyed`, "alert", ev);
      else if (ev.type === "died" && ev.owner !== me && ev.owner < 2 && ev.building) this.notify(`Enemy ${DEF_LIST[ev.def].name} destroyed`, "gold");
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt) {
    const sim = this.sim, pl = sim.players[this.me], el = this.el, P = this.prev;
    // the camera keeps its bounds to the part of the screen the HUD bars leave open
    if ((this.insetT = (this.insetT || 0) - dt) <= 0) { this.insetT = 0.5; this.view.cam.setInsets(this.el.topbar ? this.el.topbar.offsetHeight : 0, this.el.bottom ? this.el.bottom.offsetHeight : 0); }
    const set = (k, node, v) => { if (P[k] !== v) { P[k] = v; node.textContent = v; } };
    set("f", el.food, fmt(pl.res[0])); set("w", el.wood, fmt(pl.res[1])); set("c", el.coin, fmt(pl.res[2]));
    for (let i = 0; i < 3; i++) set("r" + i, el.rates[i], sim.time > 20 && pl.income[i] >= 1 ? `+${Math.round(pl.income[i])}/m` : "");
    set("p", el.pop, `${pl.popUsed}/${pl.popCap}`);
    el.pop.parentElement.classList.toggle("capped", pl.popUsed >= pl.popCap);
    set("a", el.age, AGES[pl.age].name);
    const ap = pl.aging ? (pl.aging.t / pl.aging.total * 100).toFixed(1) + "%" : "0%";
    if (P.ap !== ap) { P.ap = ap; el.ageBar.style.width = ap; el.ageBar.parentElement.classList.toggle("on", !!pl.aging); }
    const t = Math.floor(sim.time), clock = `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    set("t", el.clock, clock);
    // card
    const st = sim.st, selArr = [...this.ctl.sel];
    const sig = selArr.slice(0, 6).map((e) => `${e}:${st.def[e]}:${st.prog[e] >= 1 ? 1 : 0}`).join(",") + "|" + pl.age + "|" + selArr.length + "|" + (pl.aging ? 1 : 0);
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
    // Crown Shipments: XP bar, points badge, sailing countdown, open deck
    const xpPct = (pl.xp / pl.xpNext * 100).toFixed(1) + "%";
    if (P.xp !== xpPct) { P.xp = xpPct; el.xpFill.style.width = xpPct; }
    set("sn", el.shipN, String(pl.shipPoints));
    set("st", el.shipT, pl.ship ? `${Math.ceil(pl.ship.total - pl.ship.t)}s` : "");
    el.shipBtn.classList.toggle("has", pl.shipPoints > 0 && !pl.ship);
    const tt = `Crown Shipments (O) — XP ${Math.floor(pl.xp)}/${pl.xpNext} · ${pl.shipPoints} available`;
    if (P.stt !== tt) { P.stt = tt; el.shipBtn.title = tt; }
    if (this.deckOpen) { this.deckT += dt; if (this.deckT > 0.25) { this.deckT = 0; this.renderDeck(); } }
  }
}

function clsName(k) { return k === C.CAV ? "cavalry" : k === C.INF ? "infantry" : k === C.ART ? "artillery" : k === C.BLD ? "buildings" : k === C.VIL ? "villagers" : k === C.GUARD ? "guardians" : "ranged"; }
function villagerStatus(sim, e) {
  const st = sim.st, s = st.state[e];
  const carry = st.carry[e] > 0 ? ` · carrying ${Math.floor(st.carry[e])} ${RES[st.ctype[e]]}` : "";
  const load = `${Math.floor(st.carry[e])}/${CARRY} ${RES[st.ctype[e]]}`;
  if (s === S.GATHER) {
    const gt = GT[st.lastType[e]];
    if (st.eco[e] !== ECO.GATHERING) return ({ hunt: "Stalking game", mill: "Walking to the mill" }[gt] || "Heading to the resource") + carry;
    if (gt === "crate") return "Unpacking a shipment crate";
    return ({ berries: "Foraging berries", hunt: "Butchering game", mill: "Farming at the mill", wood: "Chopping wood", coin: "Mining coin" }[gt] || "Gathering") + ` · ${load}`;
  }
  if (s === S.RETURN) return (st.eco[e] === ECO.DEPOSIT ? "Unloading " : "Hauling ") + load;
  if (s === S.BUILD) return "Building";
  if (s === S.MOVE) return "Moving" + carry;
  if (s === S.ATTACK) return "Fighting";
  if (s === S.CLAIM) return "Going to claim a treasure";
  return "Idle" + carry;
}

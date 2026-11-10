// Frontier Crown — bootstrap + app state machine (Loading → Title → Match ⇄ Paused → Result).

import * as THREE from "three";
import { PA } from "../common.js";
import { fixedLoop, StateMachine, TICK } from "./core/core.js";
import { DEF_LIST, AGES, TEAM_CSS, PLAYER_NAMES, RES } from "./data/defs.js";
import { CM } from "./sim/ecs.js";
import { Sim } from "./sim/sim.js";
import { AIPlayer, LEVELS } from "./sim/ai.js";
import { pathStats } from "./sim/path.js";
import { MAPS } from "./sim/mapgen.js";
import { Heightmap } from "./terrain/heightmap.js";
import { View } from "./render/view.js";
import { Controller } from "./input/input.js";
import { HUD } from "./ui/hud.js";
import { ICON } from "./ui/icons.js";
import * as A from "./audio/audio.js";

const ARCADE = !window.CC_STANDALONE;
const Q = PA.params, THUMB = PA.THUMB, AUTO = Q.has("auto"), PROF = Q.has("prof");
const TOUCH = PA.TOUCH;
const $ = (id) => document.getElementById(id);
if (TOUCH) document.body.classList.add("touch");

const settings = Object.assign({ quality: "high", music: 0.5, sfx: 0.9, edge: true }, PA.store.get("fc:settings", {}));
const records = Object.assign({ wins: [0, 0, 0], losses: [0, 0, 0], best: [null, null, null] }, PA.store.get("fc:records", {}));
const saveSettings = () => PA.store.set("fc:settings", settings);

// ---------------------------------------------------------------- loading
const L = { el: $("loading"), bar: $("loadBar"), txt: $("loadTxt"), pct: $("loadPct") };
const stage = async (p, txt) => { L.bar.style.transform = `scaleX(${p})`; L.txt.textContent = txt; L.pct.textContent = Math.round(p * 100) + "%"; await new Promise((r) => setTimeout(r, THUMB ? 0 : 60)); };

let renderer, sim = null, view = null, ctl = null, hud = null, loop = null, attract = false, match = null, paused = false;
const speeds = [1, 1.5, 2]; let speedIdx = 0;

async function boot() {
  await stage(0.08, "Unrolling the map");
  renderer = await PA.renderer(THREE, { clear: 0xcfe0ea, shadows: true });
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  applyQuality();
  await stage(0.25, "Surveying the frontier");
  await newWorld({ seed: THUMB ? 7 : 1000 + Math.floor(Math.random() * 9000), difficulty: 1, attract: true });
  await stage(0.7, "Raising the Town Centers");
  renderer.compile(view.scene, view.camera);
  await stage(0.9, "Mustering the companies");
  view.render(0, 0.016);
  await stage(1, "Ready");
  L.el.classList.add("done");
  loop = fixedLoop({ step, render });
  if (THUMB) return thumbShot();
  if (Q.has("skip") || AUTO) startMatch({ difficulty: +(Q.get("diff") ?? 1), seed: +(Q.get("seed") || 0) || undefined, map: Q.get("map") || "fords" });
  else titleMenu();
}

function applyQuality() {
  const hi = settings.quality === "high";
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, hi ? 1.75 : 1));
  DR.max = renderer.getPixelRatio(); DR.pr = DR.max;
  renderer.shadowMap.enabled = settings.quality !== "low";
}
const DR = { pr: 1, max: 1, acc: 0, n: 0, t: 0 };
function dynRes(dt) {
  DR.acc += dt; DR.n++; DR.t += dt;
  if (DR.t < 1.5) return;
  const avg = DR.acc / DR.n; DR.acc = 0; DR.n = 0; DR.t = 0;
  let pr = DR.pr;
  if (avg > 1 / 45) pr = Math.max(0.6, pr - 0.15); else if (avg < 1 / 57) pr = Math.min(DR.max, pr + 0.05);
  if (Math.abs(pr - renderer.getPixelRatio()) > 0.01) { DR.pr = pr; renderer.setPixelRatio(pr); renderer.setSize(innerWidth, innerHeight); }
}

// Highland Pass relief comes from a grayscale heightmap image (129×129 → 128×128 tiles).
const heightCache = {};
async function loadHeights(map) {
  const m = MAPS[map];
  if (!m || !m.image) return null;
  if (!heightCache[map]) heightCache[map] = (await Heightmap.fromImage(new URL(m.image, import.meta.url).href, { min: m.min, max: m.max, size: 129 })).data;
  return heightCache[map];
}

async function newWorld({ seed, difficulty = 1, attract: att = false, map = "fords" }) {
  const heights = await loadHeights(map); // load before tearing down the current world
  if (view) { view.dispose(); }
  attract = att;
  sim = new Sim({ seed: seed || 1000 + Math.floor(Math.random() * 9000), difficulty, map, heights });
  sim.ais.push(new AIPlayer(sim, 1, difficulty));
  if (att || AUTO) sim.ais.push(new AIPlayer(sim, 0, att ? 1 : difficulty));
  view = new View(renderer, sim, { me: 0, quality: settings.quality });
  if (att) { view.fog.reveal = true; view.cam.goalDist = view.cam.dist = 30; view.cam.focus(26, 104); }
  if (ctl) ctl.dispose();
  if (hud) hud.dispose();
  ctl = new Controller({ sim, view, me: 0, sfx: A.sfx, canvas: renderer.domElement, touch: TOUCH });
  ctl.enabled = !att;
  hud = new HUD({ sim, view, ctl, me: 0, sfx: A.sfx, touch: TOUCH, onMenu: () => pauseMenu(), onSpeed: cycleSpeed });
  window.__fc = { THREE, sim, view, ctl, hud, records, settings, pathStats, startMatch, titleMenu, pauseMenu, resume, get loop() { return loop; }, DEF_LIST, CM };
}

function cycleSpeed() { speedIdx = (speedIdx + 1) % speeds.length; if (loop) loop.speed = speeds[speedIdx]; $("btnSpeed").textContent = speeds[speedIdx] + "×"; A.sfx("click", { ui: true }); }

// ---------------------------------------------------------------- the loop
let lastMusket = 0;
function step() {
  if (!sim || paused) return;
  const t0 = PROF ? performance.now() : 0;
  sim.step();
  if (PROF) (window.__prof = window.__prof || { step: 0, n: 0 }), (window.__prof.step += performance.now() - t0), window.__prof.n++;
  const ev = sim.events.drain();
  if (!ev.length) return;
  view.onEvents(ev);
  if (!attract) { hud.onEvents(ev); audioEvents(ev); }
  for (const e of ev) if (e.type === "over" && !attract) endMatch(e.winner);
  if (attract && sim.over) { // keep the title backdrop alive
    newWorld({ seed: 1000 + Math.floor(Math.random() * 9000), attract: true });
  }
}
function render(alpha, dt) {
  if (!view) return;
  const wdt = paused ? 0 : dt;
  if (attract) { view.cam.tx += dt * 0.55; view.cam.tz -= dt * 0.5; if (view.cam.tz < 30) view.cam.focus(26, 104); }
  if (ctl && !paused) ctl.update(dt);
  if (ctl) ctl.pruneSel();
  view.render(paused ? 1 : alpha, wdt);
  if (hud && !attract) hud.update(dt);
  if (!THUMB) dynRes(dt);
}

function audioEvents(list) {
  const cam = view.cam, now = performance.now();
  for (const ev of list) {
    const x = ev.x ?? (ev.e >= 0 ? sim.st.x[ev.e] : cam.tx), z = ev.z ?? (ev.e >= 0 ? sim.st.z[ev.e] : cam.tz);
    const dist = Math.hypot(x - cam.tx, z - cam.tz - 4) * (30 / Math.max(20, cam.dist)) ** 0.5, pan = (x - cam.tx) / 30;
    const o = { dist, pan };
    switch (ev.type) {
      case "shot":
        if (!view.seen(ev.x, ev.z) && !view.seen(ev.tx, ev.tz)) break;
        if (ev.kind === "ranged") { if (now - lastMusket > 45) { lastMusket = now; A.sfx("musket", { ...o, gain: 0.8 }); } }
        else if (ev.kind === "hunt") A.sfx("pop", o);
        else if (ev.kind === "cannon") A.sfx("cannon", o);
        else if (ev.kind === "melee") A.sfx(Math.random() < 0.55 ? "clash" : "thud", { ...o, gain: 0.7 });
        break;
      case "explode": if (view.seen(ev.x, ev.z)) A.sfx("boom", o); break;
      case "died": if (ev.building) A.sfx("collapse", o); else if (Math.random() < 0.5 && view.seen(ev.x, ev.z)) A.sfx("die", o); break;
      case "work": if (view.seen(ev.x, ev.z) && Math.random() < 0.7) A.sfx({ wood: "chop", coin: "pick", berries: "forage", mill: "forage", hunt: "forage", build: "hammer" }[ev.gt] || "forage", { ...o, gain: 0.6 }); break;
      case "built": if (ev.p === 0) A.sfx("built", { ui: true }); break;
      case "trained": if (ev.p === 0) A.sfx("bell", { ui: true, gain: DEF_LIST[sim.st.def[ev.e]].id === "villager" ? 0.35 : 0.6 }); break;
      case "age": if (ev.p === 0) A.sfx("fanfare", { ui: true }); else A.sfx("horn", { ui: true, gain: 0.5 }); break;
      case "aging": if (ev.p === 0) A.sfx("select", { ui: true }); break;
      case "attacked": if (ev.p === 0) A.sfx("horn", { ui: true, gain: 0.7 }); break;
      case "shipment": if (ev.p === 0) A.sfx("bell", { ui: true }); break;
    }
  }
}

// ---------------------------------------------------------------- menus
const menuEl = $("menu");
function showMenu(html, { cls = "" } = {}) {
  menuEl.className = "on " + cls; menuEl.innerHTML = html;
  const first = menuEl.querySelector("button, a"); if (first && !TOUCH) setTimeout(() => first.focus({ preventScroll: true }), 30);
  menuEl.querySelectorAll("button, a.mi").forEach((b) => b.addEventListener("click", () => { A.audioInit(); A.sfx("click", { ui: true }); }));
}
function hideMenu() { menuEl.className = ""; menuEl.innerHTML = ""; }
const on = (sel, fn) => menuEl.querySelectorAll(sel).forEach((n) => n.addEventListener("click", fn));

function titleMenu() {
  paused = false; match = null;
  document.body.classList.remove("in-match");
  $("hud").classList.add("off");
  if (!attract) newWorld({ seed: 1000 + Math.floor(Math.random() * 9000), attract: true });
  const wins = records.wins.reduce((a, b) => a + b, 0);
  showMenu(`
    <div class="title">
      <div class="crest">${ICON.age}</div>
      <h1 class="logo">Frontier <span>Crown</span></h1>
      <p class="tagline">Build a colony on the river frontier, rise through three Ages, and break the Rival Crown.</p>
      <div class="menu">
        <button class="mi big" data-a="play">Skirmish <span class="v2">1 vs 1 AI</span></button>
        <button class="mi" data-a="how">How to play</button>
        <button class="mi" data-a="settings">Settings</button>
        ${ARCADE ? `<a class="mi" href="../index.html#frontier">Back to the arcade</a>` : ""}
      </div>
      <p class="foot">${wins ? `Victories: ${records.wins.map((w, i) => `${LEVELS[i].name} ${w}`).join(" · ")}` : "Your record will appear here after your first victory."}</p>
    </div>`, { cls: "titleM" });
  on('[data-a="play"]', setupMenu); on('[data-a="how"]', () => howMenu(titleMenu)); on('[data-a="settings"]', () => settingsMenu(titleMenu));
  A.audioInit(); A.music(true);
}

let setup = { difficulty: PA.store.get("fc:diff", 1), seed: "", map: PA.store.get("fc:map", "fords") };
function setupMenu() {
  const diffBtns = LEVELS.map((l, i) => `<button class="seg ${setup.difficulty === i ? "on" : ""}" data-d="${i}">${l.name}</button>`).join("");
  showMenu(`
    <div class="card">
      <h2>Skirmish</h2>
      <label class="lbl">Rival Crown difficulty</label>
      <div class="segs">${diffBtns}</div>
      <p class="hint">${["A relaxed opponent who attacks late with small companies.", "A steady opponent: first attack after ~7 minutes.", "An aggressive opponent with a stronger economy and early raids."][setup.difficulty]}</p>
      <label class="lbl">Map</label>
      <div class="segs">${Object.entries(MAPS).map(([k, m]) => `<button class="seg ${setup.map === k ? "on" : ""}" data-m="${k}">${m.name}</button>`).join("")}</div>
      <p class="hint">${MAPS[setup.map].desc}</p>
      <label class="lbl" for="seedIn">Map seed <span>(leave empty for a random layout)</span></label>
      <input id="seedIn" inputmode="numeric" maxlength="6" value="${setup.seed}" placeholder="Random">
      <div class="row"><button class="mi" data-a="back">Back</button><button class="mi big" data-a="go">Found the colony</button></div>
    </div>`);
  on("[data-d]", (e) => { setup.seed = $("seedIn").value.replace(/\D/g, ""); setup.difficulty = +e.currentTarget.dataset.d; PA.store.set("fc:diff", setup.difficulty); setupMenu(); });
  on("[data-m]", (e) => { setup.seed = $("seedIn").value.replace(/\D/g, ""); setup.map = e.currentTarget.dataset.m; PA.store.set("fc:map", setup.map); setupMenu(); });
  on('[data-a="back"]', titleMenu);
  on('[data-a="go"]', () => { setup.seed = $("seedIn").value.replace(/\D/g, ""); startMatch({ difficulty: setup.difficulty, seed: +setup.seed || undefined, map: setup.map }); });
}

function howMenu(back) {
  showMenu(`
    <div class="card wide how">
      <h2>How to play</h2>
      <div class="cols">
        <div>
          <h3>Goal</h3><p>Destroy the Rival Crown's <b>Town Center</b>. Lose yours and the colony falls.</p>
          <h3>Economy</h3><p>Villagers gather <b>food</b> (berries, deer, mills), <b>wood</b> (trees) and <b>coin</b> (gold mines), then carry it to a Town Center or Mill. Build <b>Houses</b> for population.</p>
          <h3>Ages</h3><p>Advance at the Town Center: Discovery → Colonial (Stables, Hussars) → Fortress (Foundry, Falconets). Each Age brings a shipment of your choice.</p>
          <h3>Terrain</h3><p>Cliffs and deep water block movement. Steep slopes can be crossed but not built on. Rocky mesas have one ramp up — a fine spot for an Outpost.</p>
          <h3>Counters</h3><p>Pikemen and Musketeers beat cavalry · Hussars ride down cannon and villagers · Falconets shred infantry and buildings.</p>
        </div>
        <div>
          <h3>${TOUCH ? "Touch" : "Mouse & keyboard"}</h3>
          ${TOUCH ? `<ul><li>Tap to select; with units selected, tap the ground or a target to order them.</li><li>Drag to scroll · pinch to zoom · long-press to deselect.</li><li><b>Box</b> button: drag a box to select many.</li><li>Use the command card for buildings, training and Ages.</li></ul>`
          : `<ul><li><b>Left-click</b> select · <b>drag</b> box-select · <b>double-click</b> all of a type</li><li><b>Right-click</b> move / gather / build / attack</li><li><b>Arrows</b> or screen edge scroll · <b>wheel</b> zoom · <b>middle-drag</b> pan</li><li><b>Q W E R T / A S D F G / Z X C V B</b> command card</li><li><b>H</b> Town Center · <b>.</b> idle villager · <b>Ctrl+1–9</b> groups · <b>Space</b> last alert</li><li><b>G</b> build grid (green buildable, red cliff/water/slope, amber occupied) · <b>F3</b> or <b>I</b> terrain inspector (X/Y/Z under the cursor)</li><li><b>Shift</b> train 5 · keep placing · add to selection · <b>Esc</b> cancel / pause</li></ul>`}
        </div>
      </div>
      <div class="row"><button class="mi" data-a="back">Back</button></div>
    </div>`);
  on('[data-a="back"]', back);
}

function settingsMenu(back) {
  const seg = (k, opts) => opts.map(([v, l]) => `<button class="seg ${settings[k] === v ? "on" : ""}" data-k="${k}" data-v="${v}">${l}</button>`).join("");
  showMenu(`
    <div class="card">
      <h2>Settings</h2>
      <label class="lbl">Graphics</label><div class="segs">${seg("quality", [["high", "High"], ["medium", "Medium"], ["low", "Low"]])}</div>
      <label class="lbl">Music</label><div class="segs">${seg("music", [[0, "Off"], [0.3, "Low"], [0.5, "Mid"], [0.8, "High"]])}</div>
      <label class="lbl">Sound effects</label><div class="segs">${seg("sfx", [[0, "Off"], [0.5, "Low"], [0.9, "Mid"], [1.2, "High"]])}</div>
      <p class="hint">Graphics changes apply to the next match (Low turns off shadows).</p>
      <div class="row"><button class="mi" data-a="back">Back</button></div>
    </div>`);
  on("[data-k]", (e) => {
    const k = e.currentTarget.dataset.k, raw = e.currentTarget.dataset.v;
    settings[k] = k === "quality" ? raw : +raw; saveSettings();
    A.setVolumes({ music: settings.music, sfx: settings.sfx });
    if (k === "quality") applyQuality();
    settingsMenu(back);
  });
  on('[data-a="back"]', back);
}

async function startMatch({ difficulty = 1, seed, map = "fords" } = {}) {
  hideMenu();
  A.audioInit(); A.setVolumes({ music: settings.music, sfx: settings.sfx });
  await newWorld({ seed, difficulty, attract: false, map });
  match = { difficulty, seed: sim.seed, map };
  paused = false; speedIdx = 0; if (loop) loop.speed = 1; $("btnSpeed").textContent = "1×";
  $("hud").classList.remove("off");
  document.body.classList.add("in-match");
  ctl.enabled = true;
  if (Q.has("reveal")) view.fog.reveal = true;
  A.music(true);
  hud.notify(`Found your colony. The Rival Crown (${LEVELS[difficulty].name}) lies across the river.`, "gold");
  if (!PA.store.get("fc:tipsSeen", false) && !AUTO) {
    PA.store.set("fc:tipsSeen", true);
    setTimeout(() => hud.notify(TOUCH ? "Tip: tap a villager, then tap a berry bush or tree to gather." : "Tip: select villagers and right-click berries, trees or gold to gather.", ""), 2500);
    setTimeout(() => hud.notify(TOUCH ? "Tip: tap your Town Center, then the villager button to train more." : "Tip: select your Town Center (H) and train more villagers (Q).", ""), 9000);
  }
}

function pauseMenu() {
  if (!match || sim.over) return;
  paused = true; A.audioPause(true); ctl.enabled = false; ctl.mode = null;
  showMenu(`
    <div class="card">
      <h2>Paused</h2>
      <p class="hint">${MAPS[match.map].name} · ${LEVELS[match.difficulty].name} · seed ${match.seed} · ${clockStr(sim.time)}</p>
      <div class="menu">
        <button class="mi big" data-a="resume">Resume</button>
        <button class="mi" data-a="how">How to play</button>
        <button class="mi" data-a="settings">Settings</button>
        <button class="mi" data-a="restart">Restart</button>
        <button class="mi" data-a="resign">Resign</button>
        <button class="mi" data-a="quit">Quit to title</button>
      </div>
    </div>`);
  on('[data-a="resume"]', resume);
  on('[data-a="how"]', () => howMenu(pauseMenu));
  on('[data-a="settings"]', () => settingsMenu(pauseMenu));
  on('[data-a="restart"]', () => { A.audioPause(false); startMatch({ difficulty: match.difficulty, seed: match.seed, map: match.map }); });
  on('[data-a="resign"]', () => { resume(); sim.issue({ p: 0, t: "resign" }); });
  on('[data-a="quit"]', () => { A.audioPause(false); titleMenu(); });
}
function resume() { hideMenu(); paused = false; A.audioPause(false); if (ctl) ctl.enabled = true; }
const clockStr = (t) => `${String(Math.floor(t / 60)).padStart(2, "0")}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

function endMatch(winner) {
  const won = winner === 0, d = match.difficulty;
  if (!AUTO) {
    if (won) { records.wins[d]++; if (records.best[d] == null || sim.time < records.best[d]) records.best[d] = sim.time; } else records.losses[d]++;
    PA.store.set("fc:records", records);
  }
  A.music(false);
  A.sfx(won ? "victory" : "defeat", { ui: true });
  ctl.enabled = false; ctl.mode = null;
  setTimeout(() => {
    paused = true;
    const p = sim.players, row = (k, f) => `<tr><th>${k}</th><td>${f(p[0])}</td><td>${f(p[1])}</td></tr>`;
    showMenu(`
      <div class="card wide result ${won ? "win" : "lose"}">
        <div class="crest">${ICON.age}</div>
        <h2>${won ? "Victory" : "Defeat"}</h2>
        <p class="hint">${won ? "The Rival Crown's Town Center has fallen. The frontier is yours." : sim.players[0].resigned ? "You resigned the colony." : "Your Town Center has fallen."} · ${clockStr(sim.time)} · ${LEVELS[d].name}${won && records.best[d] === sim.time ? " · new best time!" : ""}</p>
        <table class="stats"><thead><tr><th></th><th style="color:${TEAM_CSS[0]}">${PLAYER_NAMES[0]}</th><th style="color:${TEAM_CSS[1]}">${PLAYER_NAMES[1]}</th></tr></thead><tbody>
          ${row("Age reached", (q) => AGES[q.age].name.replace(" Age", ""))}
          ${row("Units trained", (q) => q.stats.trained)}
          ${row("Enemies killed", (q) => q.stats.killed)}
          ${row("Units lost", (q) => q.stats.lost)}
          ${row("Buildings built", (q) => q.stats.built)}
          ${row("Buildings razed", (q) => q.stats.razed)}
          ${RES.map((r, i) => row(`${r[0].toUpperCase() + r.slice(1)} gathered`, (q) => Math.floor(q.stats.gathered[i]))).join("")}
        </tbody></table>
        <div class="row"><button class="mi" data-a="title">Title</button><button class="mi big" data-a="again">Play again</button></div>
      </div>`);
    on('[data-a="again"]', () => startMatch({ difficulty: d, map: match.map }));
    on('[data-a="title"]', titleMenu);
  }, 2600);
}

// ---------------------------------------------------------------- global keys, resize, orientation
addEventListener("keydown", (e) => {
  if (e.code === "Escape") {
    if (menuEl.classList.contains("on")) { if (match && !sim.over && paused) resume(); return; }
    if (ctl && ctl.mode) { ctl.mode = null; return; }
    if (ctl && ctl.sel.size) { ctl.clearSel(); return; }
    pauseMenu();
  } else if (e.code === "F10" || e.code === "KeyP") { if (match && !paused) { e.preventDefault(); pauseMenu(); } }
});
addEventListener("resize", () => { if (!renderer) return; renderer.setSize(innerWidth, innerHeight); if (view) view.resize(); checkRotate(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && match && !paused && !sim.over && !AUTO) pauseMenu(); });
function checkRotate() { $("rotate").classList.toggle("on", TOUCH && innerHeight > innerWidth); }
checkRotate();
addEventListener("pointerdown", () => A.audioInit(), { once: true });
addEventListener("keydown", () => A.audioInit(), { once: true });

// ---------------------------------------------------------------- thumbnail
async function thumbShot() {
  await newWorld({ seed: 7, difficulty: 1, attract: false });
  sim.ais.push(new AIPlayer(sim, 0, 2));
  for (let i = 0; i < 20 * 60 * 9; i++) { sim.step(); sim.events.drain(); }
  sim.ais.length = 0;
  view.fog.reveal = true; $("hud").classList.add("off");
  const st = sim.st, tc = sim.players[0].tc;
  const cx = st.x[tc] + 13, cz = st.z[tc] - 13;
  const add = (k, o, x, z) => { const e = sim.spawnUnit(DEF_LIST.find((d) => d.id === k).idx, o, x, z); return e; };
  for (let i = 0; i < 10; i++) { const e = add("musketeer", 0, cx - 4 + (i % 5) * 0.95, cz + 1 + Math.floor(i / 5) * 0.95); st.rot[e] = st.prot[e] = Math.PI; }
  for (let i = 0; i < 4; i++) { const e = add("pikeman", 0, cx + 1.5 + i * 0.9, cz + 0.2); st.rot[e] = st.prot[e] = Math.PI; }
  for (let i = 0; i < 6; i++) add("hussar", 1, cx - 1 + i * 1.35, cz - 6.5 - (i % 2) * 0.9);
  for (let i = 0; i < 5; i++) add("musketeer", 1, cx - 3 + i * 0.95, cz - 10);
  add("falconet", 1, cx + 4, cz - 11);
  view.cam.focus(cx - 4, cz + 3.5); view.cam.goalDist = view.cam.dist = 22;
  for (let i = 0; i < 64; i++) { sim.step(); const ev = sim.events.drain(); view.onEvents(ev); view.fx.update(0.05); }
  for (let i = 0; i < 3; i++) view.render(1, 0.016);
  window.__ready = true;
}

boot().catch((err) => { console.error(err); L.txt.textContent = "Failed to start: " + err.message; });

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
import { assets, UNIT_MODELS, MODEL_BASE } from "./render/assets.js";
import { AssetPipeline, loadManifest } from "../asset-pipeline.js";
import { Controller } from "./input/input.js";
import { InputAdapter } from "../input-adapter.js";
import { HUD } from "./ui/hud.js";
import { ICON } from "./ui/icons.js";
import { CARDS_JSON, CARDS, DECK_SIZE } from "./data/cards.js";
import { validateDeck } from "./sim/economy/shipments.js";
import * as A from "./audio/audio.js";
import { Soundtrack, TRACKS } from "./audio/soundtrack.js";
const OST = new Soundtrack(); // menu / exploration / ages / war / victory music (audio/soundtrack.js)
// Build stamp: shown in Settings and the console, so a stale (cached / older) copy is easy to spot.
export const BUILD = "2026-11-12";
console.info(`Frontier Crown build ${BUILD}`);
OST.onFallback = () => { if (hud && !attract) hud.notify("Soundtrack files could not be loaded — playing the built-in tune (see Settings)"); };

const ARCADE = !window.CC_STANDALONE;
const Q = PA.params, THUMB = PA.THUMB, AUTO = Q.has("auto"), PROF = Q.has("prof");
const TOUCH = PA.TOUCH;
const $ = (id) => document.getElementById(id);
if (TOUCH) document.body.classList.add("touch");

const settings = Object.assign({ quality: "high", music: 0.5, sfx: 0.9, edge: 1, camKeys: "arrows" }, PA.store.get("fc:settings", {}));
settings.edge = settings.edge ? 1 : 0;
const camSettings = () => ({ edge: !!settings.edge, wasd: settings.camKeys === "wasd" });
const records = Object.assign({ wins: [0, 0, 0], losses: [0, 0, 0], best: [null, null, null] }, PA.store.get("fc:records", {}));
const saveSettings = () => PA.store.set("fc:settings", settings);

// ---------------------------------------------------------------- loading
const L = { el: $("loading"), bar: $("loadBar"), txt: $("loadTxt"), pct: $("loadPct") };
const stage = async (p, txt) => { L.bar.style.transform = `scaleX(${p})`; L.txt.textContent = txt; L.pct.textContent = Math.round(p * 100) + "%"; await new Promise((r) => setTimeout(r, THUMB ? 0 : 60)); };

let renderer, input = null, sim = null, view = null, ctl = null, hud = null, loop = null, attract = false, match = null, paused = false;
const speeds = [1, 1.5, 2]; let speedIdx = 0;

async function boot() {
  await stage(0.08, "Unrolling the map");
  renderer = await PA.renderer(THREE, { clear: 0xcfe0ea, shadows: true });
  // one InputAdapter for the page: mouse + keyboard and touch become the same intents (games/input-adapter.js)
  input = new InputAdapter(renderer.domElement, { oneFingerDrag: "box" });
  window.__fcInput = input;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  applyQuality();
  // rigged soldier models (.glb): fetched + parsed once, cached for every match (render/assets.js)
  if (Q.get("glb") !== "0") {
    await stage(0.12, "Drilling the regiments");
    const t0 = performance.now();
    // the arcade's AssetPipeline: GLTFLoader with DRACO + KTX2, and assets.json's choice of variant
    const SITE = new URL("../../", import.meta.url).href;
    const pipe = new AssetPipeline(THREE, renderer, { manifest: ARCADE ? await loadManifest(SITE + "assets.json") : {}, base: SITE });
    assets.useLoader((await pipe.loaders()).gltf, (file) => { const r = pipe.resolve("games/frontier/models/" + file); return r.kind === "plain" ? new URL(file, MODEL_BASE).href : pipe.abs(r.url); });
    const r = await assets.preload(UNIT_MODELS, (p) => { L.bar.style.transform = `scaleX(${0.12 + p * 0.12})`; L.pct.textContent = Math.round((0.12 + p * 0.12) * 100) + "%"; });
    window.__fcAssets = { assets, ...r, ms: Math.round(performance.now() - t0) };
  }
  await stage(0.25, "Surveying the frontier");
  await newWorld({ seed: THUMB ? 7 : 1000 + Math.floor(Math.random() * 9000), difficulty: 1, attract: true });
  await stage(0.7, "Raising the Town Centers");
  renderer.compile(view.scene, view.camera);
  await stage(0.9, "Mustering the companies");
  view.render(0, 0.016);
  await stage(1, "Ready");
  L.el.classList.add("done");
  loop = fixedLoop({ step, render });
  // leaving the page (back to the arcade): stop the loop and music; PA's SceneCleaner then frees the GPU
  if (PA.cleaner) { PA.cleaner.track(assets); PA.cleaner.onLeave(() => { loop.stop(); OST.dispose(); input.dispose(); if (view) view.dispose(); }); }
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
  sim = new Sim({ seed: seed || 1000 + Math.floor(Math.random() * 9000), difficulty, map, heights, decks: [validateDeck(PA.store.get("fc:deck", null)), null] });
  sim.ais.push(new AIPlayer(sim, 1, difficulty));
  if (att || AUTO) sim.ais.push(new AIPlayer(sim, 0, att ? 1 : difficulty));
  view = new View(renderer, sim, { me: 0, quality: settings.quality, assets, input, actorBudget: Q.has("actors") ? +Q.get("actors") : undefined });
  view.cam.configure(camSettings());
  if (att) { view.fog.reveal = true; view.cam.goalDist = view.cam.dist = 30; view.cam.focus(26, 104); }
  if (ctl) ctl.dispose();
  if (hud) hud.dispose();
  ctl = new Controller({ sim, view, me: 0, sfx: A.sfx, canvas: renderer.domElement, input });
  ctl.enabled = !att;
  hud = new HUD({ sim, view, ctl, me: 0, sfx: A.sfx, input, onMenu: () => pauseMenu(), onSpeed: cycleSpeed });
  window.__fc = { OST, assets, THREE, sim, view, ctl, hud, records, settings, pathStats, startMatch, titleMenu, pauseMenu, resume, get loop() { return loop; }, DEF_LIST, CM };
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
  if (attract) { view.cam.tx += dt * 0.55; view.cam.tz -= dt * 0.5; if (view.cam.tz < 30 || view.cam.clamped.x || view.cam.clamped.z) view.cam.focus(26, 104); }
  if (ctl && !paused) ctl.update(dt);
  if (ctl) ctl.pruneSel();
  view.render(paused ? 1 : alpha, wdt);
  if (hud && !attract) hud.update(dt);
  if (aiDebugEl && !aiDebugEl.hidden && (aiDebugT += dt) > 0.4) { aiDebugT = 0; const bot = sim.ais.find((a) => a.p === 1); aiDebugEl.textContent = bot ? bot.debug() : ""; }
  if (!THUMB) dynRes(dt);
}

function audioEvents(list) {
  OST.events(list, sim, 0);
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
        else if (ev.kind === "grenade") A.sfx("thud", { ...o, gain: 0.45 });
        else if (ev.kind === "melee") A.sfx(Math.random() < 0.55 ? "clash" : "thud", { ...o, gain: 0.7 });
        break;
      case "explode": if (view.seen(ev.x, ev.z)) A.sfx("boom", ev.small ? { ...o, gain: 0.5 } : o); break;
      case "agecancel": if (ev.p === 0) A.sfx("click", { ui: true }); break;
      case "died": if (ev.building) A.sfx("collapse", o); else if (Math.random() < 0.5 && view.seen(ev.x, ev.z)) A.sfx("die", o); break;
      case "work": if (view.seen(ev.x, ev.z) && Math.random() < 0.7) A.sfx({ wood: "chop", coin: "pick", berries: "forage", mill: "forage", hunt: "forage", build: "hammer" }[ev.gt] || "forage", { ...o, gain: 0.6 }); break;
      case "built": if (ev.p === 0) A.sfx("built", { ui: true }); break;
      case "trained": if (ev.p === 0) A.sfx("bell", { ui: true, gain: DEF_LIST[sim.st.def[ev.e]].id === "villager" ? 0.35 : 0.6 }); break;
      case "age": if (ev.p === 0) { A.sfx("fanfare", { ui: true }); OST.ageReached(); } else A.sfx("horn", { ui: true, gain: 0.5 }); break;
      case "aging": if (ev.p === 0) A.sfx("select", { ui: true }); break;
      case "attacked": if (ev.p === 0) A.sfx("horn", { ui: true, gain: 0.7 }); break;
      case "treasureClaimed": if (ev.p === 0) { A.sfx("fanfare", { ui: true, gain: 0.55 }); A.sfx("pop", { ...o, gain: 0.8 }); } break;
      case "guardAggro": if (view.seen(ev.x, ev.z) && Math.random() < 0.5) A.sfx("thud", { ...o, gain: 0.4 }); break;
      case "shipPoint": if (ev.p === 0) A.sfx("select", { ui: true }); break;
      case "shipSent": if (ev.p === 0) A.sfx("horn", { ui: true, gain: 0.45 }); break;
      case "shipArrived": if (ev.p === 0) { A.sfx("fanfare", { ui: true, gain: 0.7 }); A.sfx("bell", { ui: true, gain: 0.5 }); } break;
    }
  }
}

// ---------------------------------------------------------------- menus
const menuEl = $("menu");
function showMenu(html, { cls = "" } = {}) {
  menuEl.className = "on " + cls; menuEl.innerHTML = html;
  const first = menuEl.querySelector("button, a"); if (first && !TOUCH) setTimeout(() => first.focus({ preventScroll: true }), 30);
  menuEl.querySelectorAll("button, a.mi").forEach((b) => b.addEventListener("click", () => { A.audioInit(); OST.kick(); A.sfx("click", { ui: true }); }));
}
function hideMenu() { menuEl.className = ""; menuEl.innerHTML = ""; }
const on = (sel, fn) => menuEl.querySelectorAll(sel).forEach((n) => n.addEventListener("click", fn));

function titleMenu() {
  if (aiDebugEl) aiDebugEl.hidden = true;
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
        <button class="mi" data-a="deck">Crown Deck <span class="v2">shipment cards</span></button>
        <button class="mi" data-a="how">How to play</button>
        <button class="mi" data-a="settings">Settings</button>
        ${ARCADE ? `<a class="mi" href="../index.html#frontier">Back to the arcade</a>` : ""}
      </div>
      <p class="foot">${wins ? `Victories: ${records.wins.map((w, i) => `${LEVELS[i].name} ${w}`).join(" · ")}` : "Your record will appear here after your first victory."}</p>
    </div>`, { cls: "titleM" });
  on('[data-a="play"]', setupMenu); on('[data-a="deck"]', () => deckMenu(titleMenu)); on('[data-a="how"]', () => howMenu(titleMenu)); on('[data-a="settings"]', () => settingsMenu(titleMenu));
  A.audioInit(); OST.menu();
}

let setup = { difficulty: PA.store.get("fc:diff", 1), seed: "", map: PA.store.get("fc:map", "fords") };
function setupMenu() {
  const diffBtns = LEVELS.map((l, i) => `<button class="seg ${setup.difficulty === i ? "on" : ""}" data-d="${i}">${l.name}</button>`).join("");
  showMenu(`
    <div class="card">
      <h2>Skirmish</h2>
      <label class="lbl">Rival Crown difficulty</label>
      <div class="segs">${diffBtns}</div>
      <p class="hint">${["A relaxed opponent who attacks late with small companies.", "A balanced Behavior-Tree bot: builds Houses and Barracks as it needs them, splits villagers by what it plans to buy, and attacks your Town Center whenever 10 soldiers are ready.", "An aggressive opponent with a stronger economy and early raids."][setup.difficulty]}</p>
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

// Crown Deck editor: pick 6–12 cards from the catalogue (data/cards.js); saved per browser.
function deckMenu(back) {
  const deck = validateDeck(PA.store.get("fc:deck", null));
  const R = ["Discovery", "Colonial", "Fortress"];
  const draw = () => {
    const cards = CARDS_JSON.cards.map((c) => {
      const on = deck.includes(c.id);
      return `<button class="scard ${on ? "in" : "out"}" data-card="${c.id}" aria-pressed="${on}"><span class="ic">${ICON[c.icon] || ICON.ship}</span><span class="age">${["I", "II", "III"][c.age]}</span><b>${c.name}</b><p>${c.desc}</p><span class="meta"><span title="Uses per match">${c.uses == null ? "∞ uses" : c.uses + "× use"}</span><span title="Voyage time">${c.travel}s</span>${c.cooldown ? `<span title="Cooldown after arrival">CD ${c.cooldown}s</span>` : ""}</span></button>`;
    }).join("");
    const n = deck.length, ok = n >= DECK_SIZE.min;
    showMenu(`
      <div class="card wide deckEd">
        <h2>Crown Deck</h2>
        <p class="hint">Earn XP by building, gathering and defeating enemies; each full XP bar (and every new Age) gives one shipment. In a match press <b>O</b> to send a card from this deck. Roman numerals = earliest Age.</p>
        <div class="deckCount ${ok ? "" : "bad"}"><b>${n} / ${DECK_SIZE.max}</b> cards ${ok ? "" : `— pick at least ${DECK_SIZE.min}`}</div>
        <div class="deckGrid">${cards}</div>
        <div class="row"><button class="mi" data-a="reset">Default deck</button><button class="mi big" data-a="done" ${ok ? "" : "disabled"}>Done</button></div>
      </div>`);
    on("[data-card]", (e) => {
      const id = e.currentTarget.dataset.card, i = deck.indexOf(id);
      if (i >= 0) deck.splice(i, 1); else if (deck.length < DECK_SIZE.max) deck.push(id); else return;
      PA.store.set("fc:deck", deck); draw();
    });
    on('[data-a="reset"]', () => { deck.length = 0; deck.push(...CARDS_JSON.defaultDeck); PA.store.set("fc:deck", deck); draw(); });
    on('[data-a="done"]', back);
  };
  draw();
}

function howMenu(back) {
  showMenu(`
    <div class="card wide how">
      <h2>How to play</h2>
      <div class="cols">
        <div>
          <h3>Goal</h3><p>Destroy the Rival Crown's <b>Town Center</b>. Lose yours and the colony falls.</p>
          <h3>Economy</h3><p>Villagers gather <b>food</b> (berries, deer, mills), <b>wood</b> (trees) and <b>coin</b> (gold mines) one stroke per second, then haul each load of 10 to a Town Center or Mill — your stockpile grows when they unload. The top bar shows income per minute. Build <b>Houses</b> for population.</p>
          <h3>Construction</h3><p>Pick a building: a hologram shows where it goes (green fits, red doesn't). Villagers raise it from the ground up; deleting an unfinished site refunds the unbuilt share.</p>
          <h3>Ages</h3><p>Advance at the Town Center (the cost is paid up front, refunded if you cancel): Discovery → Colonial (Stable, Hussars, <b>Grenadiers</b>) → Fortress (Foundry, Falconets, <b>Skirmishers</b>). Each Age needs a few completed buildings and grants a free shipment.</p>
          <h3>Treasures</h3><p>Glowing chests dot the frontier, each guarded by wolves or bandits. Guardians attack anyone who comes close but give up the chase far from their den. Defeat every guardian, then walk a unit onto the chest — some can only be opened by your <b>Explorer</b>. Prizes: food, wood, coin, XP or recruits.</p>
          <h3>Crown Shipments</h3><p>Building, gathering and defeating enemies earn <b>XP</b>. Each full XP bar gives one shipment: press <b>O</b> (or the ship button) and pick a card — settlers, soldiers or resource crates arrive at your Town Center after a short voyage. Villagers unpack crates in seconds. Build your deck from the title menu.</p>
          <h3>Terrain</h3><p>Cliffs and deep water block movement. Steep slopes can be crossed but not built on. Rocky mesas have one ramp up — a fine spot for an Outpost.</p>
          <h3>Counters</h3><p>Pikemen and Musketeers beat cavalry · Hussars ride down cannon and villagers · Grenadiers and Falconets shred infantry and buildings · Skirmishers out-shoot infantry.</p>
        </div>
        <div>
          <h3>${input.device === "touch" ? "Touch" : "Mouse & keyboard"}</h3>
          ${input.device === "touch" ? `<ul><li><b>Tap</b> select (tap twice: every unit of that type on screen) · place buildings</li><li><b>Hold 0.4 s</b> (a ring fills) = order: move, gather, build, attack — the same as right-click</li><li><b>Drag one finger</b> box-select · <b>two fingers</b> drag to pan, pinch to zoom</li><li>Use the command card for buildings, training and Ages.</li></ul>`
          : `<ul><li><b>Left-click</b> select · <b>drag</b> box-select (soldiers first; <b>Shift</b>-drag keeps villagers too) · <b>double-click</b> all of a type</li><li><b>Right-click</b> move / gather / build / attack</li><li><b>Arrows</b> (or <b>WASD</b>, see Settings), screen-edge scroll or <b>middle-drag</b> to pan · <b>wheel</b> zooms toward the cursor and tilts the view near the ground</li><li><b>Q W E R T / A S D F G / Z X C V B</b> command card</li><li><b>H</b> Town Center · <b>.</b> idle villager · <b>Ctrl+1–9</b> groups · <b>Space</b> last alert</li><li><b>G</b> build grid (green buildable, red cliff/water/slope, amber occupied) · <b>F3</b> or <b>I</b> terrain inspector (X/Y/Z under the cursor) · <b>F4</b> Rival Crown AI overlay</li><li><b>Shift</b> train 5 · keep placing · add to selection · <b>Esc</b> cancel / pause</li></ul>`}
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
      <label class="lbl">Camera keys</label><div class="segs">${seg("camKeys", [["arrows", "Arrows"], ["wasd", "WASD + Arrows"]])}</div>
      <label class="lbl">Edge scrolling</label><div class="segs">${seg("edge", [[1, "On"], [0, "Off"]])}</div>
      <p class="hint">Graphics changes apply to the next match (Low turns off shadows). With WASD camera keys, hold <b>Alt</b> for the command card's W, A, S and D.</p>
      <p class="hint">Build ${BUILD} · Music: ${OST.status === "fallback" ? `built-in tune — recorded soundtrack not loaded (${OST.error})` : OST.status === "playing" ? `recorded soundtrack (${Object.values(TRACKS).map((t) => t.loaded).filter(Boolean).join(", ") || "loading"})` : "recorded soundtrack (starts after your first click)"}</p>
      <div class="row"><button class="mi" data-a="back">Back</button></div>
    </div>`);
  on("[data-k]", (e) => {
    const k = e.currentTarget.dataset.k, raw = e.currentTarget.dataset.v;
    settings[k] = k === "quality" || k === "camKeys" ? raw : +raw; saveSettings();
    A.setVolumes({ music: settings.music, sfx: settings.sfx });
    if (view) view.cam.configure(camSettings());
    if (hud) hud.relabel();
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
  OST.matchStart(0);
  hud.notify(`Found your colony. The Rival Crown (${LEVELS[difficulty].name}) lies across the river.`, "gold");
  if (!PA.store.get("fc:tipsSeen", false) && !AUTO) {
    PA.store.set("fc:tipsSeen", true);
    setTimeout(() => hud.notify(input.device === "touch" ? "Tip: tap a villager, then hold your finger on a berry bush or tree to gather." : "Tip: select villagers and right-click berries, trees or gold to gather.", ""), 2500);
    setTimeout(() => hud.notify(input.device === "touch" ? "Tip: tap your Town Center, then the villager button to train more." : "Tip: select your Town Center (H) and train more villagers (Q).", ""), 9000);
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
  OST.finish();
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
// F4: Rival Crown AI overlay (mode, wave, economy plan, Behavior Tree branches that fired)
let aiDebugEl = null, aiDebugT = 0;
addEventListener("keydown", (e) => {
  if (e.code !== "F4" || !match) return;
  e.preventDefault();
  if (!aiDebugEl) {
    aiDebugEl = document.createElement("pre"); aiDebugEl.id = "aiDebug"; aiDebugEl.hidden = true;
    aiDebugEl.style.cssText = "position:fixed;right:10px;top:52px;z-index:30;margin:0;max-width:min(560px,calc(100vw - 20px));padding:8px 10px;border-radius:6px;background:rgba(20,14,9,.88);border:1px solid #7a5a32;color:#efe3c4;font:600 11.5px/1.45 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap;pointer-events:none";
    document.body.appendChild(aiDebugEl);
  }
  aiDebugEl.hidden = !aiDebugEl.hidden; aiDebugT = 1;
});
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
addEventListener("pointerdown", () => { A.audioInit(); OST.kick(); }, { once: true });
addEventListener("keydown", () => { A.audioInit(); OST.kick(); }, { once: true });

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

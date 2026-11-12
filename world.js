// Pixel Acre Arcade — the Valley Line.
// A cab drives along one road through the valley and stops at each game.
import * as THREE from "three"; // mapped by the loader in index.html (streamed with byte progress)
import { AssetPipeline, LoadProgress, loadManifest } from "./games/asset-pipeline.js";
import { cleanerFor } from "./games/scene-cleaner.js";

// Loading: index.html's bootstrap already counts the engine download; this module adds its own parts
// (world build, billboards, fonts, shader warm-up) to the same 0–100 % bar.
const LOAD = window.__paLoad || new LoadProgress((pct, label) => { const b = document.getElementById("ldBar"); if (b) b.style.transform = `scaleX(${pct / 100})`; });
performance.mark("hub:module");
const partWorld = LOAD.add("world.js", 20e3, "Starting the engine"); partWorld.done();
const manifestP = loadManifest("assets.json");

const $ = (id) => document.getElementById(id);
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem("pa:" + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("pa:" + k, JSON.stringify(v)); } catch {} },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let seed = 17; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

/* ================================================================ stops */
const STOPS = [
  { id: "start", z: 0, hour: 6.0, area: "Depot", kind: "intro", title: "Pixel Acre Arcade", genre: "Free 3D games along the Valley Line",
    desc: "Hop in. The cab drives you through the valley and pulls over at every game. Scroll, swipe or press ↓ to ride to the next stop.",
    jp: "ようこそ！出発しますよ。", en: "Welcome aboard! Off we go." },
  { id: "farm", z: -82, hour: 8.0, area: "The Homestead", title: "Little Furrow", genre: "Farming life sim", href: "games/farm.html", cta: "Start farming", thumb: "img/thumb-farm.jpg",
    desc: "Clear a weedy acre, grow ten crops through four seasons, feed hens and a cow, and befriend three neighbors who speak Japanese with English subtitles.",
    spec: [["Engine", "Three.js r169"], ["Play", "1 player · saves in your browser"], ["Controls", "Keyboard, mouse or touch"]],
    jp: "牧場に着きましたよ。", en: "Here's the farm." },
  { id: "ironrift", z: -165, hour: 14.6, area: "Hilltop Meadows", title: "Iron Rift", genre: "First-person shooter", href: "games/ironrift.html", cta: "Deploy", thumb: "img/thumb-ironrift.jpg",
    desc: "Hold a rain-slick container terminal at sunset against masked mercenaries, white robots, turret hounds and powered exos — eight waves, a three-phase boss, and a six-bot free-for-all.",
    spec: [["Engine", "Three.js r169"], ["Modes", "Onslaught (8 waves + boss) · Deathmatch"], ["Controls", "Keyboard & mouse, gamepad or touch"]],
    jp: "風が気持ちいいですね。", en: "Nice breeze up here." },
  { id: "frontier", z: -232, hour: 17.5, area: "Hilltop Meadows", title: "Frontier Crown", genre: "Real-time strategy", href: "games/frontier.html", cta: "Found a colony", thumb: "img/thumb-frontier.jpg",
    desc: "Found a colony on a river frontier: gather food, wood and coin, rise through three Ages, raise musketeers, pikemen, hussars and cannon, and break the Rival Crown's Town Center.",
    spec: [["Engine", "Three.js r169 · instanced ECS · heightmap terrain"], ["Mode", "Skirmish vs AI · 2 maps · Easy, Normal, Hard"], ["Controls", "Mouse & keyboard or touch"]],
    jp: "夕焼けがきれいですね。", en: "What a sunset." },
  { id: "rooftop", z: -312, hour: 20.2, area: "The Rain Quarter", title: "Rooftop Dash", genre: "Runner", href: "games/rooftop.html", cta: "Run", thumb: "img/thumb-rooftop.jpg",
    desc: "Deliver parcels across a rainy market town. Jump the gaps, slide under laundry lines and double-jump the chimneys.",
    spec: [["Engine", "Three.js r169"], ["Play", "1 player · endless"], ["Controls", "Arrows or swipe"]],
    jp: "雨ですね。気をつけて！", en: "Rainy tonight. Watch your step!" },
  { id: "canyon", z: -402, hour: 22.6, area: "Moon Road", title: "Canyon Circuit", genre: "Arcade stunt racing", href: "games/canyon.html", cta: "Race", thumb: "img/thumb-canyon.jpg",
    desc: "Race glossy supercars through two red-rock tracks — golden-hour Red Rock Run and violet Dusk Mesa. Chain drifts, ride the walls, fly the gaps and out-drive two AI rivals, or a friend in split-screen.",
    spec: [["Engine", "Three.js r169"], ["Tracks", "Red Rock Run · Dusk Mesa"], ["Play", "Solo vs 2 AI · 2P split-screen · time trial"], ["Controls", "Keyboard & mouse, gamepads or touch"]],
    jp: "今夜は月が明るいですね。", en: "The moon is bright tonight." },
  { id: "workshop", z: -482, hour: 23.5, area: "The Workshop", kind: "soon", title: "In the Workshop", genre: "Games being built",
    desc: "Under these covers are the next games on the line. They'll get their own stops when they're ready.",
    soon: [["Orchard Ledger", "plan an orchard over twelve seasons"], ["Beekeeper's Almanac", "keep three hives alive for a year"], ["Kite Festival", "hold a paper kite steady through gusts"], ["Lantern Thief", "slip through the night market without waking the cats"], ["Night Bus 22", "run the last bus route through a sleeping town"]],
    jp: "もうすぐ完成です。", en: "These are almost ready." },
  { id: "end", z: -552, hour: 24.4, area: "The Lookout", kind: "end", title: "Last Stop", genre: "Thanks for riding",
    desc: "That's the whole valley. Every game is free, runs in your browser, and works on phones.",
    faq: [["Are the games free?", "Yes. No ads and no sign-up."], ["Do they work on my phone?", "Yes. Each game shows an on-screen stick and buttons on touch screens."], ["Why do characters speak Japanese?", "Short Japanese voice lines add flavor, and every line is shown in English. Your device's Japanese voice is used if it has one; otherwise characters chirp."], ["Will my farm still be there?", "Little Furrow saves in this browser when you sleep, every 30 seconds, and when you leave."]],
    jp: "おつかれさまでした！", en: "Thanks for riding!" },
];
const LAST = STOPS.length - 1;

/* ================================================================ road */
const roadX = (z) => 18 * Math.sin(z / 70) + 5 * Math.sin(z / 27);
const pts = []; for (let z = 46; z >= -600; z -= 8) pts.push(new THREE.Vector3(roadX(z), 0, z));
const curve = new THREE.CatmullRomCurve3(pts, false, "centripetal");
const L = curve.getLength();
const UP = new THREE.Vector3(0, 1, 0);
const uOfZ = (z) => { let best = 0, bd = 1e9; for (let i = 0; i <= 3000; i++) { const u = i / 3000, p = curve.getPointAt(u); const d = Math.abs(p.z - z); if (d < bd) { bd = d; best = u; } } return best; };
STOPS.forEach((s) => (s.s = uOfZ(s.z) * L));
function frameAt(s) {
  const u = clamp(s / L, 0, 1);
  const p = curve.getPointAt(u), t = curve.getTangentAt(u).normalize(), r = new THREE.Vector3().crossVectors(t, UP).normalize();
  return { p, t, r };
}
// uOfZ scans 3000 curve samples, and scenery placement asks for the same z values many times — memoize.
const sCache = new Map();
const sOfZ = (z) => { let v = sCache.get(z); if (v === undefined) { v = uOfZ(z) * L; sCache.set(z, v); } return v; };

/* ================================================================ renderer */
const canvas = $("world");
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true }); } catch { renderer = null; }
const MOBILE = matchMedia("(max-width: 760px)").matches;
// Sign textures are drawn now with whatever font is available and redrawn when the web fonts
// arrive — the world no longer waits up to 1.8 s for fonts before it starts building.
const partFonts = LOAD.add("fonts", 30e3, "Painting the road signs");
const fontsReady = document.fonts
  ? Promise.race([Promise.all([document.fonts.load("64px 'Dela Gothic One'"), document.fonts.load("64px DotGothic16")]).catch(() => {}), new Promise((r) => setTimeout(r, 1800))])
  : Promise.resolve();
fontsReady.then(() => partFonts.done());
const partBuild = LOAD.add("build", 90e3, "Building the valley");
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd3ff, 60, 200);
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 600);
const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x4a3a32, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(MOBILE ? 1024 : 2048, MOBILE ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 140 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
if (renderer) {
  renderer.setPixelRatio(new URLSearchParams(location.search).has("lite") ? 0.6 : Math.min(devicePixelRatio || 1, MOBILE ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
}
function resize() { if (!renderer) return; renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();

const M = new Map();
const mat = (c, o = {}) => { const k = c + JSON.stringify(o); if (!M.has(k)) M.set(k, new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85, ...o })); return M.get(k); };
const G = new Map();
const geo = (k, f) => { if (!G.has(k)) G.set(k, f()); return G.get(k); };
function add(g, m, x = 0, y = 0, z = 0, p = scene, shadow = true) { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = shadow; o.receiveShadow = true; p.add(o); return o; }
const box = (w, h, d, c, x, y, z, p, o) => add(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat(c, o), x, y, z, p);
const tex = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
const signs = []; // [texture, redraw] — repainted once the web fonts have loaded
function textTex(text, { w = 512, h = 128, bg = "#2a2147", fg = "#f4a63a", size = 64, font = "'Dela Gothic One', 'Arial Black', sans-serif", border = null } = {}) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; const g = c.getContext("2d");
  const draw = () => {
    g.clearRect(0, 0, w, h);
    if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
    if (border) { g.strokeStyle = border; g.lineWidth = 8; g.strokeRect(4, 4, w - 8, h - 8); }
    g.fillStyle = fg; g.font = `${size}px ${font}`; g.textAlign = "center"; g.textBaseline = "middle";
    let s = size; while (g.measureText(text).width > w - 40 && s > 12) { s -= 2; g.font = `${s}px ${font}`; }
    g.fillText(text, w / 2, h / 2 + 3);
  };
  draw();
  const t = tex(c); signs.push([t, draw]); return t;
}
// Places an object beside the road at arc length s, `side` metres to the right (negative = left).
function beside(o, s, side, y = 0, faceRoad = true) {
  const { p, t, r } = frameAt(s);
  o.position.copy(p).addScaledVector(r, side); o.position.y = y;
  if (faceRoad) { const look = o.position.clone().addScaledVector(r, -Math.sign(side) * 10).addScaledVector(t, -14); look.y = y; o.lookAt(look); }
  return o;
}

/* ================================================================ ground & road */
const DIST = [ // z, base colour (fields), road-side colour
  [60, "#7cc46a"], [-40, "#7cc46a"], [-125, "#79c267"], [-250, "#6fbf62"], [-262, "#57506a"], [-350, "#57506a"], [-362, "#4f8a4a"], [-470, "#4f8a4a"], [-520, "#5d8f52"], [-620, "#5d8f52"],
];
function groundColor(z, dx) {
  let i = 0; while (i < DIST.length - 2 && z < DIST[i + 1][0]) i++;
  const [z0, c0] = DIST[i], [z1, c1] = DIST[i + 1];
  const c = new THREE.Color(c0).lerp(new THREE.Color(c1), clamp((z0 - z) / (z0 - z1), 0, 1));
  if (z < -255 && z > -355 && Math.abs(dx) > 34) c.lerp(new THREE.Color("#5a9a50"), smooth(34, 48, Math.abs(dx)));
  return c;
}
{
  const g = new THREE.PlaneGeometry(520, 720, 130, 180); g.rotateX(-Math.PI / 2); g.translate(0, 0, -280);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), dx = x - roadX(z);
    const hill = (Math.sin(x * 0.045) * Math.cos(z * 0.05) + Math.sin(x * 0.11 + z * 0.07) * 0.4) * 4.2;
    const far = smooth(16, 60, Math.abs(dx));
    pos.setY(i, hill * far + (Math.abs(dx) > 120 ? (Math.abs(dx) - 120) * 0.25 : 0) - 0.05);
    const c = groundColor(z, dx); const n = 0.92 + rnd() * 0.12; c.multiplyScalar(n);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const ground = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }));
  ground.receiveShadow = true; scene.add(ground);
}
function ribbon(width, y, material, uvScale, from = 0, to = L, steps = 1100) {
  const posA = [], uv = [], idx = [];
  for (let i = 0; i <= steps; i++) {
    const s = from + (to - from) * i / steps, { p, r } = frameAt(s);
    const a = p.clone().addScaledVector(r, -width / 2), b = p.clone().addScaledVector(r, width / 2);
    posA.push(a.x, y, a.z, b.x, y, b.z); uv.push(0, s / uvScale, 1, s / uvScale);
    if (i < steps) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(posA, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, material); m.receiveShadow = true; scene.add(m); return m;
}
const roadTex = (() => {
  const c = document.createElement("canvas"); c.width = 128; c.height = 256; const g = c.getContext("2d");
  g.fillStyle = "#3c3846"; g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 900; i++) { g.fillStyle = ["#35313f", "#46424f", "#403c4a"][i % 3]; g.fillRect(Math.random() * 128, Math.random() * 256, 2, 2); }
  g.fillStyle = "#e9e4f2"; g.fillRect(6, 0, 4, 256); g.fillRect(118, 0, 4, 256);
  g.fillStyle = "#f4c04a"; g.fillRect(61, 0, 6, 120);
  const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
})();
ribbon(12, 0.015, new THREE.MeshStandardMaterial({ color: "#a68b67", roughness: 1 }), 10);
const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.75, metalness: 0.05 });
ribbon(8, 0.03, roadMat, 9);
// puddles in the Rain Quarter
for (let i = 0; i < 12; i++) {
  const s = sOfZ(-262 - i * 7.5), { p, r } = frameAt(s);
  const m = add(geo("pud", () => new THREE.CircleGeometry(1, 14)), new THREE.MeshStandardMaterial({ color: "#2a2840", roughness: 0.04, metalness: 0.6 }), 0, 0.045, 0, scene, false);
  m.position.copy(p).addScaledVector(r, (rnd() - 0.5) * 5); m.position.y = 0.045; m.rotation.x = -Math.PI / 2; m.scale.set(0.8 + rnd() * 1.2, 0.5 + rnd() * 0.6, 1);
}

/* ================================================================ instanced scenery */
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3(), eul = new THREE.Euler();
function instanced(geometry, material, list, shadow = true) {
  const im = new THREE.InstancedMesh(geometry, material, Math.max(1, list.length));
  list.forEach((o, i) => { q.setFromEuler(eul.set(o.rx || 0, o.ry || 0, o.rz || 0)); m4.compose(pv.set(o.x, o.y, o.z), q, sc.set(o.sx ?? o.s ?? 1, o.sy ?? o.s ?? 1, o.sz ?? o.s ?? 1)); im.setMatrixAt(i, m4); });
  im.count = list.length; im.castShadow = shadow; im.receiveShadow = true; scene.add(im); return im;
}
const inTown = (z) => z < -255 && z > -352;
const inField = (x, z) => z < -42 && z > -122 && x - roadX(z) < -10 && x - roadX(z) > -40;
// trees
const trunks = [], leaves = [[], [], []];
seed = 5;
for (let i = 0; i < 900; i++) {
  const z = 50 - rnd() * 650, x = (rnd() - 0.5) * 300, dx = x - roadX(z);
  if (Math.abs(dx) < 11 || (inTown(z) && Math.abs(dx) < 46) || inField(x, z) || (Math.abs(dx) < 26 && STOPS.some((s) => Math.abs(s.z - z) < 14))) continue;
  const s = 0.9 + rnd() * 1.1, y = groundY(x, z);
  trunks.push({ x, y: y + 0.6 * s, z, s });
  const k = z < -362 ? 1 : rnd() < 0.2 && z > -250 ? 2 : rnd() < 0.5 ? 0 : 1;
  leaves[k].push({ x, y: y + 1.6 * s, z, s: 1.4 * s, ry: rnd() * 3 }, { x: x + 0.3 * s, y: y + 2.4 * s, z: z - 0.2 * s, s: 1.0 * s, ry: rnd() * 3 });
}
function groundY(x, z) { const dx = x - roadX(z); const hill = (Math.sin(x * 0.045) * Math.cos(z * 0.05) + Math.sin(x * 0.11 + z * 0.07) * 0.4) * 4.2; return hill * smooth(16, 60, Math.abs(dx)); }
instanced(new THREE.CylinderGeometry(0.15, 0.24, 1.2, 6), mat("#7a5236"), trunks);
const leafMats = [mat("#5fae5a"), mat("#2f6a42"), mat("#f2a7c3")];
leaves.forEach((l, i) => instanced(new THREE.IcosahedronGeometry(0.9, 0), leafMats[i], l));

// fences (Homestead + Moon Road)
const posts = [], rails = [];
function fenceRun(z0, z1, side) {
  for (let s = sOfZ(z0), end = sOfZ(z1); s < end; s += 3) {
    const { p, t, r } = frameAt(s); const x = p.x + r.x * side, z = p.z + r.z * side, ry = Math.atan2(t.x, t.z);
    posts.push({ x, y: 0.45, z });
    for (const y of [0.35, 0.72]) rails.push({ x: x + t.x * 1.5, y, z: z + t.z * 1.5, ry });
  }
}
fenceRun(-36, -122, 6.4); fenceRun(-36, -122, -6.4); fenceRun(-366, -470, 6.6); fenceRun(-366, -470, -6.6);
instanced(new THREE.BoxGeometry(0.16, 0.9, 0.16), mat("#f6efe2"), posts);
instanced(new THREE.BoxGeometry(0.08, 0.1, 3.0), mat("#f6efe2"), rails);

// crop rows in the Homestead
const sprouts = [], fruit = [[], [], []], soil = [];
for (let z = -48; z > -116; z -= 1.7) {
  const rx = roadX(z);
  soil.push({ x: rx - 25, y: 0.05, z, sx: 26, sy: 0.12, sz: 1.0 });
  for (let x = rx - 37.5; x < rx - 12.5; x += 1.25) { sprouts.push({ x, y: 0.35, z, ry: x * 3, s: 0.8 + rnd() * 0.4 }); if (rnd() < 0.55) fruit[Math.floor(rnd() * 3)].push({ x: x + 0.2, y: 0.28, z: z + 0.15, s: 0.8 + rnd() * 0.5 }); }
}
instanced(new THREE.BoxGeometry(1, 1, 1), mat("#6b4430"), soil, false);
instanced(new THREE.ConeGeometry(0.18, 0.55, 4), mat("#5aa84f"), sprouts);
["#e8414f", "#f3e9f7", "#ef8a2b"].forEach((c, i) => instanced(new THREE.IcosahedronGeometry(0.17, 0), mat(c), fruit[i]));

// street lamps (town + moon road + stops)
const lampPos = [];
for (let z = -256; z > -350; z -= 13) for (const side of [-5.2, 5.2]) { const zz = z + (side > 0 ? 6 : 0); if (side > 0 && Math.abs(zz - STOPS[4].z) < 14) continue; const { p, r } = frameAt(sOfZ(zz)); lampPos.push(p.clone().addScaledVector(r, side)); }
for (let z = -368; z > -540; z -= 24) { const { p, r } = frameAt(sOfZ(z)); lampPos.push(p.clone().addScaledVector(r, -5.4)); }
instanced(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 6), mat("#2f2a40"), lampPos.map((p) => ({ x: p.x, y: 2.1, z: p.z })));
const lampMat = new THREE.MeshStandardMaterial({ color: "#ffe9a8", emissive: "#ffb347", emissiveIntensity: 0 });
instanced(new THREE.IcosahedronGeometry(0.32, 1), lampMat, lampPos.map((p) => ({ x: p.x, y: 4.25, z: p.z })), false);

/* ================================================================ districts */
// --- Depot
{
  const g = new THREE.Group(); beside(g, STOPS[0].s + 4, 7.5); scene.add(g);
  box(5, 0.15, 2.4, "#3f7f8f", 0, 2.6, 0, g); box(0.15, 2.6, 0.15, "#2f2a40", -2.3, 1.3, 0.9, g); box(0.15, 2.6, 0.15, "#2f2a40", 2.3, 1.3, 0.9, g);
  box(4.6, 2.4, 0.1, "#cfe6ff", 0, 1.35, -1.1, g, { transparent: true, opacity: 0.35, roughness: 0.1 });
  box(3.2, 0.12, 0.7, "#c98d4a", 0, 0.55, -0.6, g); box(0.1, 0.5, 0.6, "#6b4430", -1.4, 0.28, -0.6, g); box(0.1, 0.5, 0.6, "#6b4430", 1.4, 0.28, -0.6, g);
  const sign = add(new THREE.PlaneGeometry(4.6, 0.75), new THREE.MeshBasicMaterial({ map: textTex("VALLEY LINE · DEPOT", { w: 1024, h: 168, size: 84 }), toneMapped: false }), 0, 3.15, 1.0, g, false);
  const cottage = new THREE.Group(); beside(cottage, STOPS[0].s - 6, -16); scene.add(cottage);
  box(6, 3.4, 5, "#f1e3c8", 0, 1.7, 0, cottage); const rf = add(new THREE.ConeGeometry(4.6, 2.4, 4), mat("#c4553f"), 0, 4.6, 0, cottage); rf.rotation.y = Math.PI / 4;
}
// --- Homestead: barn, silo, farmhouse, scarecrow
{
  const barn = new THREE.Group(); beside(barn, sOfZ(-102), 24); scene.add(barn);
  box(10, 6, 8, "#b8483a", 0, 3, 0, barn);
  const sh = new THREE.Shape(); sh.moveTo(-5.6, 0); sh.lineTo(5.6, 0); sh.lineTo(0, 3.6); sh.closePath();
  add(new THREE.ExtrudeGeometry(sh, { depth: 8.8, bevelEnabled: false }), mat("#5a3a3a"), 0, 6, -4.4, barn);
  box(3.4, 3.8, 0.1, "#8a3028", 0, 1.9, 4.05, barn);
  for (const rz of [0.84, -0.84]) { const b = box(4.6, 0.25, 0.08, "#f6efe2", 0, 1.9, 4.12, barn); b.rotation.z = rz; }
  add(new THREE.CylinderGeometry(2, 2, 9, 12), mat("#c9c3d6"), 8, 4.5, -2, barn); add(new THREE.SphereGeometry(2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat("#5a3a3a"), 8, 9, -2, barn);
  const house = new THREE.Group(); beside(house, sOfZ(-58), 20); scene.add(house);
  box(7, 4, 6, "#f1e3c8", 0, 2, 0, house); const hr = add(new THREE.ConeGeometry(5.6, 3, 4), mat("#3f7f8f"), 0, 5.5, 0, house); hr.rotation.y = Math.PI / 4;
  box(1.2, 2, 0.1, "#6b4430", 0, 1, 3.05, house);
  const crow = new THREE.Group(); const cp = frameAt(sOfZ(-90)); crow.position.copy(cp.p).addScaledVector(cp.r, -24); scene.add(crow);
  box(0.12, 2.6, 0.12, "#8a5a2f", 0, 1.3, 0, crow); box(2.2, 0.12, 0.12, "#8a5a2f", 0, 2, 0, crow); box(0.9, 1, 0.4, "#3f6fb5", 0, 1.9, 0, crow);
  add(new THREE.IcosahedronGeometry(0.38, 1), mat("#e3c08a"), 0, 2.75, 0, crow); add(new THREE.CylinderGeometry(0.7, 0.7, 0.08, 12), mat("#e9c46a"), 0, 3.05, 0, crow);
}
// --- Hilltop Meadows: windmills, a container stack for Iron Rift, a frontier outpost for Frontier Crown
const blades = [], gliders = [];
for (const [z, side] of [[-140, -30], [-188, 34], [-205, -44], [-250, 40]]) {
  const g = new THREE.Group(); const f = frameAt(sOfZ(z)); g.position.copy(f.p).addScaledVector(f.r, side); g.position.y = groundY(g.position.x, g.position.z); scene.add(g);
  g.lookAt(frameAt(sOfZ(z)).p.clone().setY(g.position.y));
  add(new THREE.CylinderGeometry(1.1, 1.8, 9, 7), mat("#f1e3c8"), 0, 4.5, 0, g); add(new THREE.ConeGeometry(1.6, 2.2, 7), mat("#c4553f"), 0, 10, 0, g);
  const b = new THREE.Group(); b.position.set(0, 8.4, 1.5); g.add(b);
  for (let i = 0; i < 4; i++) { const arm = new THREE.Group(); arm.rotation.z = i * Math.PI / 2; b.add(arm); box(0.9, 5.5, 0.12, "#fff4e6", 0.3, 2.9, 0, arm); }
  blades.push(b);
}
const ringMat = new THREE.MeshStandardMaterial({ color: "#f4c04a", emissive: "#f4a63a", emissiveIntensity: 0.6, metalness: 0.3, roughness: 0.4 });
const ringCenter = (() => { const f = frameAt(STOPS[2].s + 34); return f.p.clone().addScaledVector(f.r, -20).setY(9); })();
{ // Iron Rift: a small stack of shipping containers and a dock lamp beside the stop
  const yard = new THREE.Group(); beside(yard, STOPS[2].s + 22, -17); scene.add(yard);
  box(6.1, 2.6, 2.44, "#8e3b2a", 0, 1.3, 0, yard); box(6.1, 2.6, 2.44, "#3f6a4a", 0, 1.3, 2.6, yard); box(6.1, 2.6, 2.44, "#2c4f7c", 0.4, 3.9, 1.3, yard);
  box(0.25, 7.5, 0.25, "#d8d4cb", 4.2, 3.75, 1.3, yard); box(1.4, 0.35, 0.6, "#ffc58a", 4.2, 7.5, 1.3, yard); box(2.2, 0.9, 0.5, "#9a968e", -4.4, 0.45, 1.3, yard);
}
{
  // Frontier Crown: a small colonial outpost — palisade, watchtower with a flag, a field cannon
  const fort = new THREE.Group(); beside(fort, STOPS[3].s + 16, 15); scene.add(fort);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 1.5 + Math.PI * 0.75; box(0.35, 2.2 + (i % 2) * 0.3, 0.35, "#7a5432", Math.cos(a) * 4.2, 1.1, Math.sin(a) * 4.2, fort); }
  for (const [x, z] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) box(0.22, 4.2, 0.22, "#5a3d27", x - 1.2, 2.1, z - 1, fort);
  box(2.2, 0.2, 2.2, "#8a5a2f", -1.2, 4.2, -1, fort); box(2.2, 0.6, 0.1, "#8a5a2f", -1.2, 4.6, 0.05, fort);
  add(new THREE.ConeGeometry(1.7, 1.2, 4), mat("#c49a4f"), -1.2, 5.6, -1, fort).rotation.y = Math.PI / 4;
  box(0.06, 2.2, 0.06, "#4a3020", -1.2, 7.2, -1, fort); box(1.0, 0.6, 0.04, "#3f6fd8", -0.68, 7.95, -1, fort);
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), mat("#4a3020"), 1.7, 0.42, 1.2, fort).rotation.x = Math.PI / 2;
  add(new THREE.CylinderGeometry(0.42, 0.42, 0.1, 12), mat("#4a3020"), 1.7, 0.42, 2.2, fort).rotation.x = Math.PI / 2;
  const barrel = add(new THREE.CylinderGeometry(0.12, 0.17, 1.6, 10), mat("#b88a3e", { metalness: 0.4, roughness: 0.4 }), 2.3, 0.75, 1.7, fort); barrel.rotation.z = Math.PI / 2 + 0.15;
  box(1.6, 1.1, 1.3, "#eadfc8", 1.8, 0.55, -2.2, fort); add(new THREE.ConeGeometry(1.2, 0.8, 4), mat("#9a4330"), 1.8, 1.5, -2.2, fort).rotation.y = Math.PI / 4;
  for (let i = 0; i < 12; i++) add(geo("bulb", () => new THREE.IcosahedronGeometry(0.12, 0)), lampMat, -4.2 + i * 0.75, 3.4 - Math.sin(i / 11 * Math.PI) * 0.6, 3.6, fort, false);
}
// --- Rain Quarter: buildings, signs, lanterns
const winTex = (() => {
  const c = document.createElement("canvas"); c.width = 64; c.height = 128; const g = c.getContext("2d");
  g.fillStyle = "#2a2440"; g.fillRect(0, 0, 64, 128);
  for (let y = 6; y < 124; y += 14) for (let x = 6; x < 60; x += 14) { g.fillStyle = rnd() < 0.55 ? ["#ffd98a", "#ffb870", "#cfe6ff"][Math.floor(rnd() * 3)] : "#151225"; g.fillRect(x, y, 8, 9); }
  const t = tex(c); t.magFilter = THREE.NearestFilter; return t;
})();
const bldMats = ["#6a5a8a", "#8a5a6a", "#5a6a8a", "#7a6a5a"].map((c) => new THREE.MeshStandardMaterial({ color: c, map: winTex, emissive: "#ffffff", emissiveMap: winTex, emissiveIntensity: 0, roughness: 0.9 }));
const SIGNS = [["NOODLES", "#f27c8c"], ["BOOKS", "#8fb8ff"], ["TEA", "#86d9a6"], ["BAKERY", "#f4a63a"], ["LAUNDRY", "#b678d6"], ["ARCADE", "#f4d35e"], ["FLOWERS", "#f2a7c3"], ["RADIO", "#8fb8ff"]];
const signMats = [];
let si = 0;
for (let z = -258; z > -350; z -= 8.5) for (const side of [-1, 1]) {
  if (side > 0 && Math.abs(z - STOPS[4].z) < 9) continue;
  const w = 6 + rnd() * 2.5, h = 7 + rnd() * 11, d = 6 + rnd() * 3, off = 12 + rnd() * 3;
  const g = new THREE.Group(); beside(g, sOfZ(z), side * (off + d / 2)); scene.add(g);
  add(geo(`bld${w.toFixed(1)}${h.toFixed(1)}`, () => new THREE.BoxGeometry(w, h, d)), bldMats[Math.floor(rnd() * 4)], 0, h / 2, 0, g);
  box(w + 0.4, 0.4, d + 0.4, "#2f2a40", 0, h + 0.2, 0, g);
  if (rnd() < 0.75) {
    const [txt, col] = SIGNS[si++ % SIGNS.length];
    const m = new THREE.MeshStandardMaterial({ map: textTex(txt, { w: 384, h: 96, bg: "#17122b", fg: col, size: 54, border: col }), emissive: "#ffffff", emissiveMap: null, emissiveIntensity: 0, toneMapped: false });
    m.emissiveMap = m.map; signMats.push(m);
    add(geo("sign", () => new THREE.PlaneGeometry(3.6, 0.9)), m, 0, 3.4, d / 2 + 0.06, g, false);
    box(w * 0.9, 0.12, 1.4, ["#f27c8c", "#3f8f6a", "#f4a63a"][si % 3], 0, 2.6, d / 2 + 0.6, g).rotation.x = 0.25;
  }
}
const lanterns = [];
for (const z of [-268, -290, -333]) {
  const f = frameAt(sOfZ(z));
  for (let i = 0; i <= 10; i++) { const k = i / 10, p = f.p.clone().addScaledVector(f.r, -6 + k * 12); lanterns.push({ x: p.x, y: 6.4 - Math.sin(k * Math.PI) * 1.2, z: p.z, sy: 1.25 }); }
}
const lanternMat = new THREE.MeshStandardMaterial({ color: "#f27c8c", emissive: "#ff7a5c", emissiveIntensity: 0.4 });
instanced(new THREE.IcosahedronGeometry(0.35, 1), lanternMat, lanterns, false);
// --- Moon Road: hay bales and sheep
const sheep = [];
for (let i = 0; i < 18; i++) {
  const z = -368 - rnd() * 100, side = (rnd() < 0.5 ? -1 : 1) * (10 + rnd() * 26), f = frameAt(sOfZ(z));
  const p = f.p.clone().addScaledVector(f.r, side);
  if (i % 2) { const h = add(geo("bale", () => new THREE.CylinderGeometry(1, 1, 1.5, 12)), mat("#e6c35c"), p.x, 1 + groundY(p.x, p.z), p.z); h.rotation.set(Math.PI / 2, rnd() * 3, 0); }
  else {
    const g = new THREE.Group(); g.position.set(p.x, groundY(p.x, p.z), p.z); g.rotation.y = rnd() * 6; scene.add(g);
    for (let k = 0; k < 4; k++) add(geo("wool", () => new THREE.IcosahedronGeometry(0.45, 1)), mat("#f4f1ea"), (k % 2 - 0.5) * 0.5, 0.75 + (k > 1 ? 0.2 : 0), (k > 1 ? 0.3 : -0.3), g);
    box(0.32, 0.38, 0.4, "#2b2430", 0, 0.85, 0.75, g);
    for (const [x, zz] of [[-0.25, 0.35], [0.25, 0.35], [-0.25, -0.35], [0.25, -0.35]]) box(0.1, 0.45, 0.1, "#2b2430", x, 0.22, zz, g);
    sheep.push(g);
  }
}
// --- Workshop garage with covered games
const garageLight = new THREE.PointLight(0xffc27a, 0, 22, 1.2);
{
  const g = new THREE.Group(); beside(g, STOPS[6].s + 13, 16); scene.add(g);
  box(12, 0.3, 9, "#57506a", 0, 0.15, 0, g); box(12, 5.5, 0.4, "#c9c3d6", 0, 2.9, -4.3, g);
  box(0.4, 5.5, 9, "#c9c3d6", -5.8, 2.9, 0, g); box(0.4, 5.5, 9, "#c9c3d6", 5.8, 2.9, 0, g); box(12.6, 0.5, 9.6, "#3f7f8f", 0, 5.9, 0, g);
  const tarps = ["#f27c8c", "#8fb8ff", "#86d9a6", "#f4a63a", "#b678d6"];
  tarps.forEach((c, i) => { const x = -4.2 + i * 2.1; box(1.5, 2.6, 1.3, c, x, 1.6, -1.5 + (i % 2) * 0.6, g, { roughness: 1 }); add(geo("tarpTop", () => new THREE.ConeGeometry(1.0, 0.6, 4)), mat(c, { roughness: 1 }), x, 3.2, -1.5 + (i % 2) * 0.6, g).rotation.y = Math.PI / 4; });
  add(new THREE.PlaneGeometry(7, 1.1), new THREE.MeshBasicMaterial({ map: textTex("IN THE WORKSHOP", { w: 1024, h: 160, size: 80, bg: "#17122b", fg: "#f4a63a" }), toneMapped: false }), 0, 6.8, 4.5, g, false);
  garageLight.position.set(0, 4.5, 0); g.add(garageLight);
}
// --- Lookout
{
  const g = new THREE.Group(); beside(g, STOPS[7].s + 6, 9); scene.add(g);
  box(2.6, 0.12, 0.7, "#c98d4a", 0, 0.6, 0, g); box(2.6, 0.7, 0.1, "#c98d4a", 0, 1, -0.32, g);
  add(new THREE.CylinderGeometry(0.06, 0.06, 1.4, 6), mat("#2f2a40"), 2.2, 0.7, 0.4, g);
  const sc2 = add(new THREE.CylinderGeometry(0.12, 0.2, 1.1, 8), mat("#c9c3d6", { metalness: 0.5, roughness: 0.3 }), 2.2, 1.5, 0.6, g); sc2.rotation.x = -1.0;
  add(new THREE.PlaneGeometry(4.4, 0.9), new THREE.MeshBasicMaterial({ map: textTex("THANKS FOR RIDING", { w: 1024, h: 200, size: 84 }), toneMapped: false }), 0, 2.6, -0.4, g, false);
  box(0.12, 2.2, 0.12, "#2f2a40", -1.9, 1.1, -0.45, g); box(0.12, 2.2, 0.12, "#2f2a40", 1.9, 1.1, -0.45, g);
}

/* ================================================================ billboards & stop posts */
// billboard screenshots: AssetPipeline streams them with byte progress and loads the variant named in
// assets.json (a WebP sized for the billboard; KTX2 with ?assets=ktx2), decoded off the main thread
const pipe = new AssetPipeline(THREE, renderer, { progress: LOAD, manifest: await manifestP });
pipe.expect(STOPS.filter((st) => st.thumb).map((st) => st.thumb));
if (LOAD.remove) LOAD.remove("thumbs"); // the planned placeholder, now replaced by one part per file (exact bytes)
const texLoads = [];
const screenMats = [];
const placeholder = new THREE.DataTexture(new Uint8Array([42, 33, 71, 255]), 1, 1); placeholder.colorSpace = THREE.SRGBColorSpace; placeholder.needsUpdate = true;
STOPS.forEach((st, i) => {
  // stop post at the road edge
  const post = new THREE.Group(); beside(post, st.s + 3, -5.4); scene.add(post);
  box(0.12, 2.8, 0.12, "#2f2a40", 0, 1.4, 0, post);
  add(geo("discBack", () => new THREE.CircleGeometry(0.6, 24)), mat("#2f2a40", { side: THREE.DoubleSide }), 0, 2.9, -0.01, post, false);
  add(geo("disc", () => new THREE.CircleGeometry(0.55, 24)), new THREE.MeshBasicMaterial({ map: textTex(String(i + 1).padStart(2, "0"), { w: 128, h: 128, size: 70, bg: "#f4a63a", fg: "#1d1530", font: "DotGothic16, monospace" }), toneMapped: false }), 0, 2.9, 0.02, post, false);
  if (!st.thumb) return;
  const g = new THREE.Group(); beside(g, st.s + 5, 9.5); scene.add(g);
  for (const x of [-2.6, 2.6]) add(geo("bbpost", () => new THREE.CylinderGeometry(0.16, 0.2, 4.2, 8)), mat("#3a2f5e"), x, 2.1, -0.15, g);
  box(7.0, 4.7, 0.3, "#2a2147", 0, 5.9, -0.2, g);
  // placeholder map from the start: the shader variant (USE_MAP) is the final one, so it can be
  // compiled while the screenshots download, and swapping in the real texture needs no recompile
  const sm = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false, map: placeholder });
  texLoads.push(pipe.texture(st.thumb).then((t) => { sm.map = t; sm.needsUpdate = true; }).catch(() => {}));
  screenMats.push(sm);
  add(geo("screen", () => new THREE.PlaneGeometry(6.4, 4.0)), sm, 0, 5.9, -0.03, g, false);
  add(new THREE.PlaneGeometry(5.2, 0.95), new THREE.MeshBasicMaterial({ map: textTex(st.title.toUpperCase(), { w: 1024, h: 190, size: 96, bg: "#17122b", fg: "#f4a63a", border: "#f4a63a" }), toneMapped: false }), 0, 8.85, -0.05, g, false);
  for (const x of [-2.2, 2.2]) { const arm = box(0.08, 0.08, 0.9, "#2f2a40", x, 8.3, 0.35, g); add(geo("bbLamp", () => new THREE.ConeGeometry(0.22, 0.3, 8)), lampMat, x, 8.25, 0.8, g, false).rotation.x = Math.PI; }
  st.board = g;
});

/* ================================================================ the cab */
const cab = new THREE.Group(); scene.add(cab);
const body = new THREE.Group(); cab.add(body);
const wheels = [];
{
  const prof = new THREE.Shape();
  prof.moveTo(-2.05, 0.38); prof.lineTo(2.0, 0.38); prof.quadraticCurveTo(2.25, 0.4, 2.22, 0.78); prof.lineTo(2.1, 1.08); prof.lineTo(-1.95, 1.12); prof.quadraticCurveTo(-2.2, 1.1, -2.15, 0.7); prof.closePath();
  const bg = new THREE.ExtrudeGeometry(prof, { depth: 1.7, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 3, curveSegments: 8 });
  bg.translate(0, 0, -0.85); bg.rotateY(-Math.PI / 2);
  add(bg, new THREE.MeshStandardMaterial({ color: "#f4a63a", roughness: 0.45, metalness: 0.1 }), 0, 0, 0, body);
  const cabin = new THREE.Shape(); cabin.moveTo(-1.35, 0); cabin.lineTo(0.95, 0); cabin.quadraticCurveTo(0.7, 0.55, 0.45, 0.68); cabin.lineTo(-1.1, 0.7); cabin.quadraticCurveTo(-1.3, 0.62, -1.35, 0);
  const cg = new THREE.ExtrudeGeometry(cabin, { depth: 1.6, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 2, curveSegments: 8 });
  cg.translate(0, 0, -0.8); cg.rotateY(-Math.PI / 2);
  add(cg, new THREE.MeshStandardMaterial({ color: "#1d2a40", roughness: 0.08, metalness: 0.6 }), 0, 1.12, 0, body);
  box(1.66, 0.1, 1.55, "#fff4e6", 0, 1.86, -0.3, body);
  box(1.72, 0.66, 0.12, "#fff4e6", 0, 1.48, -0.25, body);
  box(2.0, 0.1, 4.1, "#3f8f6a", 0, 0.82, 0, body);
  box(2.0, 0.22, 0.25, "#2f2a40", 0, 0.45, 2.22, body); box(2.0, 0.22, 0.25, "#2f2a40", 0, 0.45, -2.2, body);
  // roof lamp: sprout leaves on a little lit sign
  const lampTex = textTex("CAB", { w: 256, h: 96, bg: "#fff4e6", fg: "#3f8f6a", size: 70 });
  const roofSign = add(new THREE.BoxGeometry(0.8, 0.3, 0.38), new THREE.MeshStandardMaterial({ map: lampTex, emissive: "#ffffff", emissiveMap: lampTex, emissiveIntensity: 0.3 }), 0, 2.06, -0.3, body);
  roofSign.rotation.y = Math.PI / 2; body.userData.roofSign = roofSign;
  for (const s of [-1, 1]) { const lf = add(geo("cabLeaf", () => new THREE.IcosahedronGeometry(0.16, 0)), mat("#86d9a6"), s * 0.14, 2.32, -0.3, body); lf.scale.set(1.4, 0.5, 0.8); lf.rotation.z = s * 0.5; }
  // lights
  body.userData.head = new THREE.MeshStandardMaterial({ color: "#fff6d8", emissive: "#ffe6a0", emissiveIntensity: 0.4 });
  body.userData.tail = new THREE.MeshStandardMaterial({ color: "#c42a3a", emissive: "#ff2a3a", emissiveIntensity: 0.3 });
  for (const x of [-0.62, 0.62]) {
    const h = add(geo("hl", () => new THREE.CylinderGeometry(0.17, 0.17, 0.08, 14)), body.userData.head, x, 0.78, 2.36, body, false); h.rotation.x = Math.PI / 2;
    box(0.36, 0.16, 0.06, "#c42a3a", x, 0.78, -2.34, body).material = body.userData.tail;
  }
  // driver
  add(new THREE.IcosahedronGeometry(0.2, 1), mat("#f2c9a0"), 0.38, 1.45, 0.05, body);
  add(new THREE.CylinderGeometry(0.21, 0.21, 0.1, 10), mat("#3f8f6a"), 0.38, 1.6, 0.05, body);
  for (const [x, z] of [[-0.98, 1.35], [0.98, 1.35], [-0.98, -1.35], [0.98, -1.35]]) {
    const w = new THREE.Group(); w.position.set(x, 0.42, z); cab.add(w);
    const t = add(geo("tyre", () => new THREE.CylinderGeometry(0.42, 0.42, 0.34, 16)), mat("#1d1530"), 0, 0, 0, w); t.rotation.z = Math.PI / 2;
    const h = add(geo("hub", () => new THREE.CylinderGeometry(0.2, 0.2, 0.36, 8)), mat("#e9e4f2", { metalness: 0.5, roughness: 0.3 }), 0, 0, 0, w); h.rotation.z = Math.PI / 2;
    wheels.push(w);
  }
  cab.traverse((o) => { if (o.isMesh) o.castShadow = true; });
}
const heads = [-0.6, 0.6].map((x) => {
  const l = new THREE.SpotLight(0xfff0c8, 0, 34, 0.5, 0.6, 1.2); l.position.set(x, 0.8, 2.2); cab.add(l);
  const tgt = new THREE.Object3D(); tgt.position.set(x * 1.5, 0, 14); cab.add(tgt); l.target = tgt; return l;
});
const puffs = [];
function puff(p) {
  const m = new THREE.Mesh(geo("puff", () => new THREE.IcosahedronGeometry(0.18, 0)), new THREE.MeshStandardMaterial({ color: "#e9e4f2", transparent: true, opacity: 0.7 }));
  m.position.copy(p); scene.add(m); puffs.push({ m, life: 0.9 });
}

/* ================================================================ sky, weather */
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(8, 28), new THREE.MeshBasicMaterial({ color: 0xffd27a, fog: false, toneMapped: false }));
const moonDisc = new THREE.Mesh(new THREE.CircleGeometry(6, 28), new THREE.MeshBasicMaterial({ color: 0xf1ecff, fog: false, toneMapped: false }));
scene.add(sunDisc, moonDisc);
const starGeo = new THREE.BufferGeometry(); const sp = new Float32Array(700 * 3);
for (let i = 0; i < 700; i++) { const a = rnd() * Math.PI * 2, e = 0.1 + rnd() * 1.3; sp.set([Math.cos(a) * Math.cos(e) * 380, Math.sin(e) * 380, Math.sin(a) * Math.cos(e) * 380], i * 3); }
starGeo.setAttribute("position", new THREE.BufferAttribute(sp, 3));
const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0, fog: false }));
scene.add(stars);
const clouds = [];
const cloudMat = new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 0.3, roughness: 1, transparent: true, opacity: 0.85 });
for (let i = 0; i < 22; i++) {
  const c = new THREE.Group(); for (let k = 0; k < 4; k++) add(geo("cl" + k, () => new THREE.IcosahedronGeometry(2.4 + k * 0.4, 1)), cloudMat, k * 2.6 - 4, rnd() * 1.2, (rnd() - 0.5) * 2, c, false);
  c.scale.set(1.4, 0.7, 1); c.position.set((rnd() - 0.5) * 260, 40 + rnd() * 25, 40 - rnd() * 640); scene.add(c); clouds.push(c);
}
const RAIN = 1200;
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIN * 6), 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0 })); rain.frustumCulled = false; scene.add(rain);
const drops = Array.from({ length: RAIN }, () => [rnd() * 60 - 30, rnd() * 26, rnd() * 60 - 30]);
const FF = 160;
const ffGeo = new THREE.BufferGeometry(); const ffBase = [];
for (let i = 0; i < FF; i++) { const z = -362 - rnd() * 120, f = frameAt(sOfZ(z)), side = (rnd() - 0.5) * 50; const p = f.p.clone().addScaledVector(f.r, side); ffBase.push([p.x, 0.6 + rnd() * 2.2, p.z, rnd() * 9]); }
ffGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FF * 3), 3));
const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.35, transparent: true, opacity: 0 })); fireflies.frustumCulled = false; scene.add(fireflies);
// night lights placed where they matter
const nightLights = [[STOPS[0].s + 4, 6, 3.5], [sOfZ(-275), 0, 5], [sOfZ(-312), 0, 5], [sOfZ(-338), 0, 5], [STOPS[5].s + 4, 7, 4], [STOPS[3].s + 16, 13, 4]].map(([s, side, y]) => {
  const f = frameAt(s); const l = new THREE.PointLight(0xffb85c, 0, 26, 1.3); l.position.copy(f.p).addScaledVector(f.r, side); l.position.y = y; scene.add(l); return l;
});

/* ================================================================ time of day */
const KEYS = [
  [4, "#141130", "#7a86ff", 0.3, 0.35], [5.5, "#3a2f6a", "#ff9a7a", 0.6, 0.5], [6.6, "#f3a98a", "#ffb27a", 1.4, 0.8],
  [9, "#9fd3ff", "#fff3dc", 2.6, 1.05], [15.5, "#a6d6ff", "#fff0d0", 2.5, 1.0], [17.6, "#f6b27c", "#ffbe7a", 2.0, 0.9],
  [19, "#b06a8f", "#ff8a6a", 0.9, 0.65], [20.5, "#2e2756", "#8a96ff", 0.45, 0.5], [23, "#17132f", "#7a86ff", 0.4, 0.42], [25, "#110e26", "#7a86ff", 0.35, 0.38],
];
const cA = new THREE.Color(), cB = new THREE.Color(), skyC = new THREE.Color();
function hourAt(s) {
  if (s <= STOPS[0].s) return STOPS[0].hour;
  for (let i = 0; i < LAST; i++) if (s <= STOPS[i + 1].s) return lerp(STOPS[i].hour, STOPS[i + 1].hour, (s - STOPS[i].s) / (STOPS[i + 1].s - STOPS[i].s));
  return STOPS[LAST].hour;
}
let night = 0, rainAmt = 0;
function applyLight(h, z, center) {
  let i = 0; while (i < KEYS.length - 2 && h > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
  skyC.copy(cA.set(a[1])).lerp(cB.set(b[1]), t);
  sun.color.copy(cA.set(a[2])).lerp(cB.set(b[2]), t);
  let si = lerp(a[3], b[3], t), hi = lerp(a[4], b[4], t);
  rainAmt = smooth(-246, -262, z) * smooth(-362, -346, z);
  skyC.lerp(cA.set("#4a4560"), rainAmt * 0.45); si *= 1 - rainAmt * 0.5;
  sun.intensity = si; hemi.intensity = hi; hemi.color.copy(skyC).lerp(cA.set("#ffffff"), 0.45);
  renderer.setClearColor(skyC); scene.fog.color.copy(skyC);
  scene.fog.near = lerp(60, 30, rainAmt); scene.fog.far = lerp(210, 120, rainAmt);
  night = clamp(smooth(18.8, 20.6, h) + (h < 5.6 ? 1 : 0), 0, 1);
  const day = clamp((h - 5.6) / 14.4, 0, 1), ang = day * Math.PI;
  const dir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.max(0.15, Math.sin(ang)), 0.45).normalize();
  if (night > 0.6) dir.set(-0.4, 0.8, 0.45).normalize();
  sun.position.copy(center).addScaledVector(dir, 60); sun.target.position.copy(center);
  sunDisc.position.copy(camera.position).add(new THREE.Vector3(Math.cos(ang) * 0.75, Math.sin(ang) * 0.5 - 0.05, -0.65).normalize().multiplyScalar(400));
  sunDisc.lookAt(camera.position); sunDisc.visible = night < 0.9 && Math.sin(ang) > -0.05 && rainAmt < 0.8;
  sunDisc.material.color.copy(sun.color).lerp(cA.set("#ffffff"), 0.25);
  const ma = clamp((h - 19.5) / 6, 0, 1) * Math.PI;
  moonDisc.position.copy(camera.position).add(new THREE.Vector3(Math.cos(ma) * 0.6 + 0.2, Math.sin(ma) * 0.45 + 0.08, -0.7).normalize().multiplyScalar(380));
  moonDisc.lookAt(camera.position); moonDisc.visible = night > 0.05;
  stars.position.copy(camera.position); stars.material.opacity = night * (1 - rainAmt) * 0.95;
  lampMat.emissiveIntensity = night * 2.4;
  bldMats.forEach((m) => (m.emissiveIntensity = 0.15 + night * 1.1)); signMats.forEach((m) => (m.emissiveIntensity = 0.3 + night * 1.6));
  lanternMat.emissiveIntensity = 0.4 + night * 2.2;
  nightLights.forEach((l) => (l.intensity = night * 14)); garageLight.intensity = 6 + night * 10;
  heads.forEach((l) => (l.intensity = Math.max(night, rainAmt * 0.7) * 60));
  body.userData.head.emissiveIntensity = 0.4 + Math.max(night, rainAmt) * 3;
  cloudMat.emissiveIntensity = 0.3 * (1 - night * 0.85); cloudMat.color.set(night > 0.5 ? "#6a6890" : "#ffffff");
  fireflies.material.opacity = night * smooth(-350, -366, z);
  screenMats.forEach((m) => m.color.setScalar(0.85 + night * 0.15));
}

/* ================================================================ ui */
const card = $("card"), bubble = $("bubble"), hint = $("hint"), track = $("track");
const fmt = (h) => { const m = Math.floor(((h % 24) * 60) / 10) * 10; let hh = Math.floor(m / 60); const ap = hh >= 12 ? "PM" : "AM"; hh = hh % 12 || 12; return `${hh}:${String(m % 60).padStart(2, "0")} ${ap}`; };
const arrow = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3l7 5-7 5z" fill="currentColor"/></svg>`;
function cardHTML(i) {
  const st = STOPS[i];
  const line = `<div class="stop-line"><span class="stop-no">Stop ${String(i + 1).padStart(2, "0")}</span><span class="area">${st.area}</span><span>· ${fmt(st.hour)}</span></div>`;
  let body = `${line}<h2>${st.title}</h2><p class="genre">${st.genre}</p><p class="desc">${st.desc}</p>`;
  const next = i < LAST ? `<button class="btn ghost" data-step="1">Next stop ↓</button>` : `<button class="btn" data-go="0">Back to the depot ↑</button>`;
  if (st.href) {
    body += `<dl class="spec">${st.spec.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`;
    body += `<div class="acts"><a class="btn" href="${st.href}">${st.cta} ${arrow}</a>${next}</div>`;
  } else if (st.kind === "intro") {
    body += `<div class="acts"><button class="btn" data-step="1">Start driving ↓</button><button class="btn ghost" data-menu>See the route</button></div>`;
    body += `<div class="jump"><span>Or ride straight to</span>${STOPS.filter((s) => s.href).map((s) => `<button data-go="${STOPS.indexOf(s)}">${s.title}</button>`).join("")}</div>`;
  } else if (st.kind === "soon") {
    body += `<ul class="soonlist">${st.soon.map(([n, d]) => `<li><span><b>${n}</b>: ${d}</span></li>`).join("")}</ul><div class="acts">${next}</div>`;
  } else if (st.kind === "end") {
    body += `<div class="faq">${st.faq.map(([qq, a]) => `<details><summary>${qq}</summary><p>${a}</p></details>`).join("")}</div><div class="acts">${next}</div><p class="genre" style="margin:16px 0 0;color:var(--mist-dim);font-weight:500">Made with Three.js · Pixel Acre Arcade</p>`;
  }
  return body;
}
let cardStop = -1;
function showCard(i) {
  cardStop = i; card.innerHTML = cardHTML(i);
  [...card.children].forEach((c, k) => c.style.setProperty("--i", k));
  card.scrollTop = 0; card.classList.remove("away");
}
function hideCard() { if (!card.classList.contains("away")) card.classList.add("away"); }
card.addEventListener("click", (e) => {
  const b = e.target.closest("[data-step],[data-go],[data-menu]"); if (!b) return;
  if (b.dataset.step) step(+b.dataset.step); else if (b.dataset.go) go(+b.dataset.go); else openMenu();
});
// route track
STOPS.forEach((st, i) => {
  const b = document.createElement("button"); b.style.left = `calc(6px + (100% - 12px) * ${st.s / STOPS[LAST].s})`;
  b.setAttribute("aria-label", `Stop ${i + 1}: ${st.title}`); b.innerHTML = `<span class="tip">${st.title}</span>`;
  b.onclick = () => go(i); track.appendChild(b);
});
const dots = [...track.querySelectorAll("button")];
// menu
const menu = $("menu");
$("menuList").innerHTML = STOPS.map((st, i) => `<li><button data-i="${i}"><span class="t">${fmt(st.hour)}</span><span class="n">${st.title}<small>${st.area}</small></span><span class="g">${st.href ? st.genre : ""}</span></button></li>`).join("");
$("menuList").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { closeMenu(); go(+b.dataset.i); } });
function openMenu() { menu.classList.add("open"); $("menuBtn").setAttribute("aria-expanded", "true"); $("menuList").querySelectorAll("button").forEach((b) => b.classList.toggle("on", +b.dataset.i === target)); setTimeout(() => $("menuClose").focus(), 50); blip(660); }
function closeMenu() { menu.classList.remove("open"); $("menuBtn").setAttribute("aria-expanded", "false"); }
$("menuBtn").onclick = openMenu; $("menuClose").onclick = closeMenu;
menu.addEventListener("click", (e) => { if (e.target === menu) closeMenu(); });
document.querySelectorAll(".top [data-go]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(0); }));
// flat list
$("fgrid").innerHTML = STOPS.filter((s) => s.href).map((s) => `<a class="fcard" href="${s.href}"><img src="${s.thumb}" alt="" loading="lazy" width="1200" height="750"><span class="g">${s.genre} · ${s.area}</span><h3>${s.title}</h3><p>${s.desc}</p></a>`).join("");
let flat = store.get("flat", false) || !renderer;
function setFlat(f) {
  flat = f; document.body.classList.toggle("flat", f); $("flatBtn").setAttribute("aria-pressed", String(!f)); store.set("flat", f);
  if (f) { $("loader").classList.add("gone"); stopEngine(); }
}
$("flatBtn").onclick = () => { if (!renderer) return; setFlat(!flat); if (!flat) started || begin(false); };

/* ================================================================ sound */
let soundOn = false, actx = null, engine = null, rainNoise = null;
function ac() { if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; actx = new AC(); } if (actx.state === "suspended") actx.resume(); return actx; }
function tone(f, t = 0.08, v = 0.06, type = "triangle", at = 0) {
  if (!soundOn) return; const c = ac(); if (!c) return; const n = c.currentTime + at;
  const o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, n);
  g.gain.setValueAtTime(0.0001, n); g.gain.exponentialRampToValueAtTime(v, n + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, n + t);
  o.connect(g).connect(c.destination); o.start(n); o.stop(n + t + 0.02);
}
const blip = (f = 700) => tone(f, 0.06, 0.04);
const horn = () => { tone(440, 0.14, 0.06, "square"); tone(554, 0.14, 0.05, "square"); tone(440, 0.16, 0.06, "square", 0.2); tone(554, 0.16, 0.05, "square", 0.2); };
function startEngine() {
  const c = ac(); if (!c || engine) return;
  const o = c.createOscillator(), o2 = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
  o.type = "sawtooth"; o2.type = "square"; o.frequency.value = 42; o2.frequency.value = 21; f.type = "lowpass"; f.frequency.value = 380; g.gain.value = 0;
  o.connect(f); o2.connect(f); f.connect(g).connect(c.destination); o.start(); o2.start(); engine = { o, o2, f, g };
  const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource(); src.buffer = buf; src.loop = true; const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 1400; const rg = c.createGain(); rg.gain.value = 0;
  src.connect(hp).connect(rg).connect(c.destination); src.start(); rainNoise = rg;
}
function stopEngine() { if (engine) { engine.g.gain.value = 0; } if (rainNoise) rainNoise.gain.value = 0; }
function setSound(on) {
  soundOn = on; store.set("sound", on); $("soundBtn").setAttribute("aria-pressed", String(on)); $("soundBtn").querySelector(".lbl3").textContent = on ? "Sound on" : "Sound off";
  if (on) { startEngine(); blip(520); } else { stopEngine(); if (window.speechSynthesis) speechSynthesis.cancel(); }
}
$("soundBtn").onclick = () => setSound(!soundOn);
let jaVoice = null;
const pickVoice = () => { const v = window.speechSynthesis ? speechSynthesis.getVoices() : []; jaVoice = v.find((x) => /^ja/i.test(x.lang)) || null; };
if (window.speechSynthesis) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
let bubbleT = 0;
function say(st) {
  bubble.innerHTML = `Driver: ${st.en}<small>${st.jp}</small>`; bubble.classList.add("show");
  clearTimeout(bubbleT); bubbleT = setTimeout(() => bubble.classList.remove("show"), 3400);
  if (!soundOn) return;
  if (window.speechSynthesis && jaVoice) { try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(st.jp); u.voice = jaVoice; u.lang = jaVoice.lang; u.rate = 1.05; u.pitch = 0.9; speechSynthesis.speak(u); return; } catch {} }
  for (let i = 0; i < 7; i++) tone(380 + Math.random() * 200, 0.06, 0.04, "triangle", i * 0.08);
}

/* ================================================================ driving */
let s = STOPS[0].s, v = 0, target = 0, arrived = true, started = false, lastStep = 0, firstMove = false;
const hashStop = STOPS.findIndex((x) => "#" + x.id === location.hash);
if (hashStop > 0) { target = hashStop; s = STOPS[hashStop].s; }
function go(i) {
  i = clamp(i, 0, LAST); if (!started) return;
  if (i === target && arrived) { showCard(i); return; }
  target = i; arrived = false; hideCard(); blip(560);
  if (!firstMove) { firstMove = true; hint.classList.add("off"); }
  if (REDUCED) { s = STOPS[i].s; v = 0; }
  updateSteer();
}
function step(d) { const now = performance.now(); if (now - lastStep < 450) return; lastStep = now; go(target + d); }
function updateSteer() { $("prevBtn").disabled = target <= 0; $("nextBtn").disabled = target >= LAST; dots.forEach((d, i) => d.classList.toggle("on", i === target)); }
$("prevBtn").onclick = () => step(-1); $("nextBtn").onclick = () => step(1);
function arrive() {
  arrived = true; v = 0; const st = STOPS[target];
  showCard(target); say(st); if (soundOn) horn();
  try { history.replaceState(null, "", "#" + st.id); } catch {}
}
// input
let wheelAcc = 0, wheelT = 0;
addEventListener("wheel", (e) => {
  if (flat || !started || menu.classList.contains("open")) return;
  const inCard = e.target.closest?.(".card");
  if (inCard && card.scrollHeight > card.clientHeight + 2) {
    const atTop = card.scrollTop <= 0, atEnd = card.scrollTop + card.clientHeight >= card.scrollHeight - 2;
    if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atEnd)) return;
  }
  e.preventDefault();
  const now = performance.now(); if (now - wheelT > 260) wheelAcc = 0; wheelT = now;
  wheelAcc += e.deltaY; if (Math.abs(wheelAcc) > 45) { step(Math.sign(wheelAcc)); wheelAcc = 0; }
}, { passive: false });
let ty = null, tInCard = false;
addEventListener("touchstart", (e) => { ty = e.touches[0].clientY; tInCard = !!e.target.closest?.(".card,.menu"); }, { passive: true });
addEventListener("touchend", (e) => {
  if (ty == null || flat || !started) return; const dy = e.changedTouches[0].clientY - ty; ty = null;
  if (tInCard && card.scrollHeight > card.clientHeight + 2) return;
  if (Math.abs(dy) > 45) step(dy < 0 ? 1 : -1);
});
addEventListener("keydown", (e) => {
  if (e.key === "Escape" && menu.classList.contains("open")) { closeMenu(); return; }
  if (flat || !started || menu.classList.contains("open") || e.target.closest?.("input,textarea,summary")) return;
  if (["ArrowDown", "ArrowRight", "PageDown", " ", "j"].includes(e.key)) { e.preventDefault(); step(1); }
  else if (["ArrowUp", "ArrowLeft", "PageUp", "k"].includes(e.key)) { e.preventDefault(); step(-1); }
  else if (e.key === "Home") go(0); else if (e.key === "End") go(LAST);
});

/* ================================================================ loop */
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3(), tmpC = new THREE.Vector3(), tmpD = new THREE.Vector3();
let lastHeading = null, roll = 0, pitch = 0, snapCam = true, puffT = 0, t0 = performance.now(), visible = true, prevV = 0;
document.addEventListener("visibilitychange", () => (visible = !document.hidden));
const LANE = 1.9;
let stopped = false, firstFrame = false;
function tick(now) {
  if (stopped) return;
  requestAnimationFrame(tick);
  if (!visible || flat || !renderer) return;
  // no frames while the (nearly opaque) loader covers the screen: the main thread and GPU go to
  // loading, and the shaders are compiled in parallel (compileAsync) instead of by a first frame
  if (!isReady) return;
  if (!firstFrame) { firstFrame = true; performance.mark("hub:frame0"); }
  const dt = clamp((now - t0) / 1000, 0, 0.05); t0 = now; const t = now / 1000;
  // drive
  if (!arrived) {
    const dist = STOPS[target].s - s, dir = Math.sign(dist), ad = Math.abs(dist);
    const vmax = clamp(ad / 2.2, 16, 70), decel = 18;
    const want = dir * Math.min(vmax, Math.sqrt(2 * decel * ad));
    const acc = Math.abs(want) > Math.abs(v) && Math.sign(want) === Math.sign(v || dir) ? 16 : 30;
    v += clamp(want - v, -acc * dt, acc * dt);
    s += v * dt;
    if (ad < 0.08 && Math.abs(v) < 1.2) { s = STOPS[target].s; arrive(); }
  }
  const accel = (v - prevV) / Math.max(dt, 1e-3); prevV = v;
  // cab pose
  const f = frameAt(s);
  const heading = Math.atan2(f.t.x, f.t.z);
  let turn = 0; if (lastHeading != null) { let dh = heading - lastHeading; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); turn = dh / Math.max(dt, 1e-3); } lastHeading = heading;
  cab.position.copy(f.p).addScaledVector(f.r, LANE); cab.position.y = 0.02;
  cab.lookAt(tmpA.copy(cab.position).add(f.t));
  roll = lerp(roll, clamp(-turn * Math.abs(v) * 0.02, -0.08, 0.08), Math.min(1, dt * 6));
  pitch = lerp(pitch, clamp(-accel * 0.004, -0.06, 0.06), Math.min(1, dt * 5));
  body.rotation.set(pitch, 0, roll); body.position.y = Math.abs(v) > 1 ? Math.sin(t * 22) * 0.012 : Math.sin(t * 3) * 0.006;
  wheels.forEach((w) => (w.rotation.x += v * dt / 0.42));
  body.userData.tail.emissiveIntensity = (accel < -4 && Math.abs(v) > 0.5) ? 3 : 0.3 + night * 1.2;
  body.userData.roofSign.material.emissiveIntensity = 0.3 + night * 1.5;
  puffT -= dt; if (Math.abs(v) > 2 && accel > 2 && puffT <= 0) { puffT = 0.08; puff(tmpB.copy(cab.position).addScaledVector(f.t, -2.4).add(tmpC.set(0, 0.45, 0)).addScaledVector(f.r, 0.6)); }
  for (let i = puffs.length - 1; i >= 0; i--) { const p = puffs[i]; p.life -= dt; p.m.position.y += dt * 0.8; p.m.scale.setScalar(1 + (0.9 - p.life) * 3); p.m.material.opacity = Math.max(0, p.life * 0.7); if (p.life <= 0) { scene.remove(p.m); p.m.material.dispose(); puffs.splice(i, 1); } }
  // camera: chase while driving, side-on beauty shot at a stop
  let near = 0, bd = 1e9; STOPS.forEach((st) => { const d = Math.abs(st.s - s); if (d < bd) { bd = d; near = st; } });
  const k = 1 - smooth(3, 26, bd);
  const tall = camera.aspect < 0.8 ? 1.75 : 1; // portrait screens: pull the camera back
  const ahead = clamp(v * 0.25, -6, 6);
  const drivePos = tmpA.copy(cab.position).addScaledVector(f.t, (-12 - Math.abs(v) * 0.06) * tall).addScaledVector(UP, (5.4 + Math.abs(v) * 0.02) * tall).addScaledVector(f.r, -1.5);
  const driveLook = tmpB.copy(cab.position).addScaledVector(f.t, 9 + ahead).addScaledVector(UP, 1.2);
  const stopPos = tmpC.copy(cab.position).addScaledVector(f.t, -9.5 * tall).addScaledVector(f.r, -6.5 * tall).addScaledVector(UP, 3.6 * tall);
  const stopLook = tmpD.copy(cab.position).addScaledVector(f.t, 5.5).addScaledVector(f.r, 4.2).addScaledVector(UP, near.thumb ? 3.0 : 1.8);
  drivePos.lerp(stopPos, k); driveLook.lerp(stopLook, k);
  if (snapCam) { camPos.copy(drivePos); camLook.copy(driveLook); snapCam = false; }
  camPos.lerp(drivePos, Math.min(1, dt * 3.2)); camLook.lerp(driveLook, Math.min(1, dt * 4));
  camera.position.copy(camPos); camera.lookAt(camLook);
  camera.fov = lerp(camera.fov, (tall > 1 ? 52 : 42) + Math.min(10, Math.abs(v) * 0.15), Math.min(1, dt * 3)); camera.updateProjectionMatrix();
  const w = innerWidth, h = innerHeight, cardOn = !card.classList.contains("away");
  const shift = (cardOn ? 1 : 0) * k;
  offX = lerp(offX, w > 760 ? -w * 0.17 * shift : 0, Math.min(1, dt * 4)); offY = lerp(offY, w <= 760 ? h * 0.2 * shift : 0, Math.min(1, dt * 4));
  camera.setViewOffset(w, h, offX, offY, w, h);
  // world animation
  const hour = hourAt(s); applyLight(hour, f.p.z, cab.position);
  if (!REDUCED) {
    blades.forEach((b) => (b.rotation.z -= dt * 0.9));
    gliders.forEach((gl, i) => { const a = t * 0.35 + gl.ph; gl.g.position.set(ringCenter.x + Math.cos(a) * 14, 8 + Math.sin(a * 2) * 2.2, ringCenter.z + Math.sin(a) * 14); gl.g.lookAt(ringCenter.x + Math.cos(a + 0.1) * 14, 8 + Math.sin((a + 0.1) * 2) * 2.2, ringCenter.z + Math.sin(a + 0.1) * 14); gl.g.rotateZ(-0.5); });
    clouds.forEach((c) => { c.position.x += dt * 1.6; if (c.position.x > 140) c.position.x = -140; });
    sheep.forEach((sh, i) => (sh.rotation.y += Math.sin(t * 0.5 + i) * dt * 0.2));
  }
  // rain
  rain.material.opacity = rainAmt * 0.55; rain.visible = rainAmt > 0.01;
  if (rain.visible) {
    const arr = rainGeo.attributes.position.array;
    for (let i = 0; i < RAIN; i++) { const d = drops[i]; d[1] -= 26 * dt; if (d[1] < 0) { d[1] = 26; d[0] = Math.random() * 60 - 30; d[2] = Math.random() * 60 - 30; } const x = cab.position.x + d[0], z = cab.position.z + d[2]; arr.set([x, d[1], z, x - 0.06, d[1] + 0.7, z + 0.04], i * 6); }
    rainGeo.attributes.position.needsUpdate = true;
  }
  if (fireflies.material.opacity > 0.01) { const arr = ffGeo.attributes.position.array; ffBase.forEach((b, i) => arr.set([b[0] + Math.sin(t * 0.6 + b[3]) * 0.9, b[1] + Math.sin(t * 1.4 + b[3]) * 0.4, b[2] + Math.cos(t * 0.5 + b[3]) * 0.9], i * 3)); ffGeo.attributes.position.needsUpdate = true; }
  // sound
  if (engine && soundOn) { const sp = Math.abs(v); engine.o.frequency.value = 40 + sp * 2.2; engine.o2.frequency.value = 20 + sp * 1.1; engine.f.frequency.value = 300 + sp * 18; engine.g.gain.value = 0.018 + Math.min(0.05, sp * 0.0012); }
  if (rainNoise && soundOn) rainNoise.gain.value = rainAmt * 0.035;
  // hud
  $("clock").textContent = fmt(hour); $("orb").style.setProperty("--orb", night > 0.5 ? "#c9d4ff" : hour > 17 ? "#f27c8c" : "#f4d35e");
  $("speed").innerHTML = `<b>${Math.round(Math.abs(v) * 2.4)}</b> km/h`;
  const pr = clamp(s / STOPS[LAST].s, 0, 1);
  $("done").style.transform = `scaleX(${pr})`; $("cabIco").style.left = `calc(6px + (100% - 12px) * ${pr})`;
  renderer.render(scene, camera);
}
let offX = 0, offY = 0;

/* ================================================================ boot */
let isReady = false;
function ready() {
  if (isReady) return; isReady = true;
  $("loader").classList.add("ready"); $("ldStatus").textContent = "Your cab is here.";
  $("goSound").focus({ preventScroll: true });
}
function begin(withSound) {
  started = true; $("loader").classList.add("gone");
  if (withSound) setSound(true);
  updateSteer(); setTimeout(() => { showCard(target); say(STOPS[target]); }, REDUCED ? 0 : 450);
}
$("goSound").onclick = () => begin(true);
$("goQuiet").onclick = () => begin(false);
$("soundBtn").querySelector(".lbl3").textContent = "Sound off";
setFlat(flat);
performance.mark("hub:built");
if (renderer) {
  partBuild.done();
  // GPU hygiene: everything this page uploaded is disposed when the player leaves for a game
  // (pagehide), and a page restored from the back/forward cache reloads (games/scene-cleaner.js)
  const cleaner = cleanerFor(renderer, { name: "hub" });
  cleaner.track(...M.values(), ...G.values(), ...signs.map(([t]) => t));
  cleaner.onLeave(() => { stopped = true; stopEngine(); });
  cleaner.installPageLifecycle();
  window.__paCleaner = cleaner;
  fontsReady.then(() => { for (const [t, draw] of signs) { draw(); t.needsUpdate = true; } });
  const compiled = pipe.compile(scene, camera); // parallel with the downloads (KHR_parallel_shader_compile)
  Promise.all([Promise.all(texLoads).then(() => performance.mark("hub:assets")), fontsReady, compiled])
    .then(() => { performance.mark("hub:ready"); ready(); });
  requestAnimationFrame(tick);
} else { partBuild.done(); }
if (new URLSearchParams(location.search).has("autostart")) { ready(); begin(false); }
window.__valley = { go, step, get s() { return s; }, get target() { return target; }, STOPS };

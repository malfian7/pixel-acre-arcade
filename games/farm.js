// Little Furrow — a cozy farming sim for Pixel Acre Arcade.
// Original game: till, plant, water, harvest, raise animals, befriend neighbors.
import * as THREE from "three";
import { PA } from "./common.js";
import { SEASONS, SEASON_COLORS, WEEKDAYS, DAYS_PER_SEASON, HOUR_SECONDS, DAY_START, PASS_OUT,
  CROPS, ITEMS, UPGRADES, NPCS, STORE_HOURS, GOALS, HINTS } from "./farm-data.js";

const $ = (id) => document.getElementById(id);
const W = 32, H = 26;
const FIELD = { x0: 8, z0: 9, x1: 19, z1: 15 };
const YARD = { x0: 24, z0: 5, x1: 29, z1: 9 };
const SAVE_KEY = "farm:save:v1";
const inField = (x, z) => x >= FIELD.x0 && x <= FIELD.x1 && z >= FIELD.z0 && z <= FIELD.z1;
const key = (x, z) => x + "," + z;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
let seedR = 7; const rnd = () => (seedR = (seedR * 16807) % 2147483647) / 2147483647;
const pick = (a) => a[Math.floor(Math.random() * a.length)];

/* ============================================================== map layout */
const T = new Array(W * H).fill(".");
const at = (x, z) => (x < 0 || z < 0 || x >= W || z >= H) ? "T" : T[x + z * W];
const set = (x, z, c) => { if (x >= 0 && z >= 0 && x < W && z < H) T[x + z * W] = c; };
const rect = (x0, z0, x1, z1, c) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, c); };
(function buildMap() {
  for (let x = 0; x < W; x++) { set(x, 0, "T"); set(x, H - 1, "T"); }
  for (let z = 0; z < H; z++) { set(0, z, "T"); set(W - 1, z, "T"); }
  rect(5, 6, 5, 7, "p"); rect(5, 7, 22, 7, "p"); rect(22, 7, 22, 17, "p"); rect(8, 8, 8, 8, "p");
  rect(FIELD.x0, FIELD.z0, FIELD.x1, FIELD.z1, "F");
  rect(3, 2, 7, 5, "H"); set(5, 5, "D");
  set(8, 6, "b"); set(7, 11, "W");
  rect(2, 12, 5, 16, "w"); set(2, 12, "."); set(5, 12, "."); set(2, 16, "."); set(5, 16, ".");
  rect(24, 1, 29, 4, "B"); rect(22, 2, 22, 3, "B");
  for (let z = 5; z <= 10; z++) { set(23, z, "f"); set(30, z, "f"); }
  for (let x = 23; x <= 30; x++) set(x, 10, "f");
  set(23, 7, "g"); set(27, 5, "R");
  rect(10, 18, 28, 23, "q");
  rect(12, 18, 14, 18, "S"); rect(25, 19, 26, 19, "K"); set(18, 18, "N");
  set(11, 22, "L"); set(27, 22, "L"); set(6, 8, "L"); set(21, 8, "L"); set(16, 21, "o"); set(20, 21, "o");
  seedR = 11;
  for (let z = 18; z <= 24; z++) for (let x = 1; x <= 8; x++) if (rnd() < 0.42 && !(x > 5 && z < 20)) set(x, z, "T");
  for (let x = 1; x < W - 1; x++) if (rnd() < 0.35 && at(x, 1) === ".") set(x, 1, "T");
  for (let z = 11; z <= 17; z++) if (rnd() < 0.5) set(29, z, "T"), rnd() < 0.5 && set(30, z, "T");
  set(30, 7, "f"); // keep the yard closed
})();
const SOLID = new Set(["T", "f", "w", "H", "D", "B", "b", "W", "S", "K", "R", "N", "L", "o"]);
const solidTile = (x, z) => SOLID.has(at(x, z));

/* ================================================================== state */
let S = null;
function newGame() {
  const field = {};
  seedR = 99;
  for (let z = FIELD.z0; z <= FIELD.z1; z++) for (let x = FIELD.x0; x <= FIELD.x1; x++) {
    const r = rnd();
    field[key(x, z)] = { till: 0, wet: 0, crop: null, obj: r < 0.12 ? "stone" : r < 0.3 ? "weed" : null };
  }
  return {
    v: 1, day: 1, season: 0, year: 1, min: DAY_START, money: 500, energy: 100, maxEnergy: 100, water: 20,
    weather: "sun", tomorrow: "sun", tool: 0, seedSel: "turnip_seed",
    inv: { turnip_seed: 12, potato_seed: 4, fodder: 10, onigiri: 2 },
    can: 1, hoe: 1, upgrades: {}, field,
    animals: [
      { kind: "chicken", name: "Pudding", aff: 2, fed: false, petted: false, milkReady: false },
      { kind: "chicken", name: "Biscuit", aff: 2, fed: false, petted: false, milkReady: false },
      { kind: "cow", name: "Mochi", aff: 2, fed: false, petted: false, milkReady: false },
    ],
    eggs: [],
    friends: { mina: { pts: 0, talked: false, gifted: false }, tomo: { pts: 0, talked: false, gifted: false }, kenji: { pts: 0, talked: false, gifted: false } },
    goals: {}, stats: { tilled: 0, planted: 0, watered: 0, shipped: 0, eggs: 0, bestHearts: 0, earned: 0, upgrades: 0, bigHarvest: 0 },
    shippedToday: {}, earnedToday: 0, daysPlayed: 1,
  };
}
const save = () => { if (!PA.THUMB) PA.store.set(SAVE_KEY, S); };
const loadSave = () => { const s = PA.store.get(SAVE_KEY, null); return s && s.v === 1 ? s : null; };

/* ============================================================== three setup */
const renderer = await PA.renderer(THREE, { clear: 0x9fd3ff });
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd3ff, 24, 52);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 220);
const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a32, 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -21, right: 21, top: 18, bottom: -18, near: 1, far: 90 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
PA.onResize(() => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

const matCache = new Map();
function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.85, ...o }));
  return matCache.get(k);
}
const geoCache = new Map();
function geo(name, make) { if (!geoCache.has(name)) geoCache.set(name, make()); return geoCache.get(name); }
function mesh(g, m, x = 0, y = 0, z = 0, parent = scene, shadow = true) {
  const o = new THREE.Mesh(g, m); o.position.set(x, y, z);
  o.castShadow = shadow; o.receiveShadow = true; parent.add(o); return o;
}
const box = (w, h, d, c, x, y, z, p = scene, o) => mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat(c, o), x, y, z, p);
function shade(hex, f) {
  const c = new THREE.Color(hex); c.multiplyScalar(f); return "#" + c.getHexString();
}

/* ========================================================= ground texture */
const TILE_PX = 16;
const groundCanvas = document.createElement("canvas");
groundCanvas.width = W * TILE_PX; groundCanvas.height = H * TILE_PX;
const groundTex = new THREE.CanvasTexture(groundCanvas);
groundTex.magFilter = THREE.NearestFilter; groundTex.minFilter = THREE.LinearMipmapLinearFilter;
groundTex.colorSpace = THREE.SRGBColorSpace; groundTex.anisotropy = 4;
const GRASS = [
  ["#7cc46a", "#6db35c", "#8fd17a", "#f7e27a"],
  ["#5cae54", "#4f9e49", "#6dbd62", "#f4a63a"],
  ["#c4a64e", "#b08f3e", "#d4b860", "#d9643a"],
  ["#e8eef5", "#d6e0ec", "#f6f9fc", "#a9c8ff"],
];
function paintGround(season) {
  const g = groundCanvas.getContext("2d"); seedR = 3;
  const [base, dark, light, flower] = GRASS[season];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const c = at(x, z), X = x * TILE_PX, Z = z * TILE_PX;
    let fill = base, specks = [dark, light];
    if (c === "p" || c === "g" || c === "D") { fill = season === 3 ? "#d9d4cf" : "#cdaa7a"; specks = [season === 3 ? "#c4bdb7" : "#b39060", "#dcbf92"]; }
    else if (c === "F") { fill = season === 3 ? "#cbbfb4" : "#94704c"; specks = [season === 3 ? "#b8aa9c" : "#7f5e3f", "#a7825b"]; }
    else if (c === "q" || c === "S" || c === "K" || c === "N" || c === "o") { fill = "#b9b1c9"; specks = ["#a59cba", "#c9c2d6"]; }
    else if (c === "w") { fill = "#3c7fb5"; specks = ["#356fa0", "#4a8ec4"]; }
    else if (c === "H" || c === "B" || c === "b" || c === "W") { fill = "#8a7a62"; specks = ["#7a6a52", "#9a8a72"]; }
    g.fillStyle = fill; g.fillRect(X, Z, TILE_PX, TILE_PX);
    for (let i = 0; i < 14; i++) { g.fillStyle = specks[i & 1]; g.fillRect(X + Math.floor(rnd() * 15), Z + Math.floor(rnd() * 15), 2, 2); }
    if (c === "q") { g.fillStyle = "#9d94b0"; g.fillRect(X, Z, TILE_PX, 1); g.fillRect(X, Z, 1, TILE_PX); g.fillRect(X + 8, Z + 8, 8, 1); }
    if ((c === "." || c === "T") && rnd() < 0.16) { // little flowers
      const fx = X + 3 + Math.floor(rnd() * 9), fz = Z + 3 + Math.floor(rnd() * 9);
      g.fillStyle = flower; g.fillRect(fx, fz, 2, 2); g.fillStyle = "#ffffff"; g.fillRect(fx + 3, fz + 2, 1, 1);
    }
    if (c === "." && x >= YARD.x0 && x <= YARD.x1 && z >= YARD.z0 && z <= YARD.z1) { g.fillStyle = "#d9b45a"; for (let i = 0; i < 4; i++) g.fillRect(X + Math.floor(rnd() * 13), Z + Math.floor(rnd() * 15), 3, 1); }
  }
  // soft path edges
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (at(x, z) === "p") {
    g.fillStyle = season === 3 ? "#e3e0dc" : "#bfa171";
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (at(x + dx, z + dz) === ".") {
      for (let i = 0; i < 5; i++) {
        const px = dx === 1 ? (x + 1) * TILE_PX : dx === -1 ? x * TILE_PX - 2 : x * TILE_PX + Math.floor(rnd() * 14);
        const pz = dz === 1 ? (z + 1) * TILE_PX : dz === -1 ? z * TILE_PX - 2 : z * TILE_PX + Math.floor(rnd() * 14);
        g.fillRect(px, pz, 2, 2);
      }
    }
  }
  groundTex.needsUpdate = true;
}
const ground = mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 1 }), W / 2, 0, H / 2, scene, false);
ground.rotation.x = -Math.PI / 2;
const outerMat = new THREE.MeshStandardMaterial({ color: GRASS[0][1], roughness: 1 });
const outer = mesh(new THREE.PlaneGeometry(240, 240), outerMat, W / 2, -0.02, H / 2, scene, false); outer.rotation.x = -Math.PI / 2;

/* ================================================================ scenery */
const leafMats = [mat("#5fae5a"), mat("#3f8f45"), mat("#f2a7c3")];
const LEAVES = [
  ["#5fae5a", "#46994a", "#f2a7c3"],
  ["#3f8f45", "#2f7a3c", "#57a64e"],
  ["#e0823a", "#d4552f", "#e9b13c"],
  ["#e9eef5", "#cfdbe8", "#b9cce0"],
];
const trunkGeo = new THREE.CylinderGeometry(0.09, 0.14, 0.7, 6);
const blobGeo = new THREE.IcosahedronGeometry(0.5, 0);
const treeSpots = [];
seedR = 21;
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (at(x, z) === "T") treeSpots.push([x + 0.5 + (rnd() - 0.5) * 0.3, z + 0.5 + (rnd() - 0.5) * 0.3, 0.8 + rnd() * 0.5]);
for (let i = 0; i < 140; i++) { // forest ring outside the map
  const a = rnd() * Math.PI * 2, r = 20 + rnd() * 16;
  const x = W / 2 + Math.cos(a) * r * 1.15, z = H / 2 + Math.sin(a) * r;
  if (x > -1 && x < W + 1 && z > -1 && z < H + 1) continue;
  treeSpots.push([x, z, 1 + rnd() * 0.9]);
}
const trunks = new THREE.InstancedMesh(trunkGeo, mat("#7a5236"), treeSpots.length);
const blobs = leafMats.map((m) => new THREE.InstancedMesh(blobGeo, m, treeSpots.length * 2));
const blobCount = [0, 0, 0];
{
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  treeSpots.forEach(([x, z, sc], i) => {
    m4.compose(p.set(x, 0.35 * sc, z), q.identity(), s.set(sc, sc, sc)); trunks.setMatrixAt(i, m4);
    const which = rnd() < 0.18 ? 2 : rnd() < 0.5 ? 1 : 0;
    for (let k = 0; k < 2; k++) {
      const bs = sc * (k ? 0.75 : 1.05);
      q.setFromEuler(new THREE.Euler(rnd(), rnd() * 3, rnd()));
      m4.compose(p.set(x + (k ? 0.18 : -0.05) * sc, (k ? 1.35 : 0.95) * sc, z + (k ? -0.1 : 0.05) * sc), q, s.set(bs, bs * 0.95, bs));
      blobs[which].setMatrixAt(blobCount[which]++, m4);
    }
  });
  blobs.forEach((b, i) => { b.count = blobCount[i]; b.castShadow = true; b.receiveShadow = true; scene.add(b); });
  trunks.castShadow = true; scene.add(trunks);
}
// distant hills
[[-30, -20, 22, "#6aa35a"], [10, -38, 30, "#5d9a54"], [55, -18, 24, "#6aa35a"], [-34, 40, 26, "#5d9a54"], [62, 34, 28, "#6aa35a"]].forEach(([x, z, r, c], i) => {
  const h = mesh(geo("hill", () => new THREE.IcosahedronGeometry(1, 1)), mat(c), x, -r * 0.55, z, scene, false);
  h.scale.set(r, r * 0.7, r); h.userData.hill = true;
});
const hills = scene.children.filter((o) => o.userData.hill);

// grass tufts (instanced)
const tuftSpots = [];
seedR = 41;
for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) if (at(x, z) === "." && rnd() < 0.5) tuftSpots.push([x + rnd(), z + rnd(), 0.6 + rnd() * 0.7]);
const tuftMat = mat("#6db35c");
const tufts = new THREE.InstancedMesh(new THREE.ConeGeometry(0.06, 0.22, 3), tuftMat, tuftSpots.length * 3);
{
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(); let n = 0;
  for (const [x, z, sc] of tuftSpots) for (let k = 0; k < 3; k++) {
    q.setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.6, rnd() * 3, (rnd() - 0.5) * 0.6));
    m4.compose(p.set(x + (k - 1) * 0.06, 0.1 * sc, z + (rnd() - 0.5) * 0.08), q, s.set(sc, sc, sc)); tufts.setMatrixAt(n++, m4);
  }
  tufts.receiveShadow = true; scene.add(tufts);
}

// House
const house = new THREE.Group(); scene.add(house);
const wallMat = mat("#f1e3c8"), roofMats = [mat("#3f7f8f")];
box(5, 2.1, 4, "#f1e3c8", 5.5, 1.05, 4, house);
function gable(w, d, h, color, x, y, z, parent) {
  const shape = new THREE.Shape(); shape.moveTo(-w / 2 - 0.25, 0); shape.lineTo(w / 2 + 0.25, 0); shape.lineTo(0, h); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d + 0.4, bevelEnabled: false });
  const m = mesh(g, mat(color), x, y, z - d / 2 - 0.2, parent); return m;
}
const houseRoof = gable(5, 4, 1.5, "#3f7f8f", 5.5, 2.1, 4, house);
box(0.5, 1.2, 0.5, "#9a6a52", 7, 3.1, 3.2, house);
box(0.8, 1.3, 0.1, "#6b4430", 5.5, 0.65, 6.03, house);
box(0.08, 0.08, 0.05, "#f4d35e", 5.75, 0.7, 6.1, house, { metalness: 0.6, roughness: 0.3 });
const windowMat = new THREE.MeshStandardMaterial({ color: "#ffe9a8", emissive: "#ffb347", emissiveIntensity: 0, flatShading: true });
[[4.0, 6.03], [7.0, 6.03]].forEach(([x, z]) => { mesh(geo("win", () => new THREE.BoxGeometry(0.8, 0.7, 0.06)), windowMat, x, 1.25, z, house); box(0.95, 0.1, 0.1, "#6b4430", x, 0.86, z + 0.04, house); });
for (let i = 0; i < 4; i++) box(0.16, 0.16, 0.16, ["#f27c8c", "#f4d35e", "#ffffff", "#b678d6"][i], 3.65 + i * 0.22, 0.95, 6.12, house);
box(1.6, 0.12, 1.1, "#a8743f", 5.5, 0.06, 6.5, house); // porch step

// Barn & silo
const barn = new THREE.Group(); scene.add(barn);
box(6, 2.6, 4, "#b8483a", 27, 1.3, 3, barn);
const barnRoof = gable(6, 4, 1.7, "#5a3a3a", 27, 2.6, 3, barn);
box(2, 1.9, 0.08, "#8a3028", 27, 0.95, 5.04, barn);
for (const r of [0.75, -0.75]) { const b = box(2.6, 0.12, 0.05, "#f6efe2", 27, 0.95, 5.1, barn); b.rotation.z = r; }
box(2.1, 0.12, 0.06, "#f6efe2", 27, 1.92, 5.1, barn);
const silo = mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.6, 10), mat("#c9c3d6"), 22.9, 1.8, 3, barn);
const siloTop = mesh(new THREE.SphereGeometry(0.85, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat("#5a3a3a"), 22.9, 3.6, 3, barn);

// shipping bin
const bin = new THREE.Group(); bin.position.set(8.5, 0, 6.5); scene.add(bin);
box(0.9, 0.62, 0.8, "#a8743f", 0, 0.31, 0, bin);
const binLid = box(0.96, 0.08, 0.86, "#8a5a2f", 0, 0.66, 0, bin);
box(0.5, 0.22, 0.03, "#f6efe2", 0, 0.35, 0.42, bin);

// well
const well = new THREE.Group(); well.position.set(7.5, 0, 11.5); scene.add(well);
mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.6, 9), mat("#a9a3b8"), 0, 0.3, 0, well);
mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 9), mat("#2f5f9a", { roughness: 0.2 }), 0, 0.55, 0, well);
box(0.07, 1.1, 0.07, "#6b4430", -0.38, 0.85, 0, well); box(0.07, 1.1, 0.07, "#6b4430", 0.38, 0.85, 0, well);
const wr = mesh(new THREE.ConeGeometry(0.62, 0.42, 4), mat("#c4553f"), 0, 1.55, 0, well); wr.rotation.y = Math.PI / 4;
box(0.2, 0.18, 0.2, "#8a5a2f", 0.1, 0.95, 0, well);

// pond
const water = mesh(new THREE.CircleGeometry(1, 28), new THREE.MeshStandardMaterial({ color: "#4f9bd0", roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.92 }), 4, 0.03, 14.5, scene, false);
water.rotation.x = -Math.PI / 2; water.scale.set(2.05, 2.55, 1);
seedR = 5;
for (let i = 0; i < 26; i++) { const a = i / 26 * Math.PI * 2; const r = mesh(geo("rock", () => new THREE.DodecahedronGeometry(0.16, 0)), mat("#a9a3b8"), 4 + Math.cos(a) * 2.1, 0.06, 14.5 + Math.sin(a) * 2.6); r.scale.setScalar(0.7 + rnd() * 0.7); }
for (const [x, z] of [[3.2, 13.6], [4.6, 15.4], [3.7, 15.9]]) { const p = mesh(geo("pad", () => new THREE.CircleGeometry(0.22, 8)), mat("#5aa45a"), x, 0.05, z, scene, false); p.rotation.x = -Math.PI / 2; }
const stool = box(0.4, 0.3, 0.4, "#8a5a2f", 6.55, 0.15, 13.6);

// fences (yard)
const postGeo = new THREE.BoxGeometry(0.12, 0.7, 0.12);
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (at(x, z) === "f" || at(x, z) === "g") {
  if (at(x, z) === "f") mesh(postGeo, mat("#f6efe2"), x + 0.5, 0.35, z + 0.5);
  if (at(x, z) === "f") for (const [dx, dz] of [[1, 0], [0, 1]]) if (at(x + dx, z + dz) === "f") {
    for (const y of [0.25, 0.52]) box(dx ? 1 : 0.06, 0.08, dz ? 1 : 0.06, "#f6efe2", x + 0.5 + dx / 2, y, z + 0.5 + dz / 2);
  }
}
// trough
const trough = new THREE.Group(); trough.position.set(27.5, 0, 5.5); scene.add(trough);
box(0.95, 0.35, 0.55, "#8a5a2f", 0, 0.18, 0, trough);
const hay = box(0.82, 0.08, 0.42, "#e6c35c", 0, 0.32, 0, trough); hay.visible = false;

// store stall
function stripeTexture(a, b) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 8; const g = c.getContext("2d");
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
function signTexture(text, bg, fg) {
  const c = document.createElement("canvas"); c.width = 256; c.height = 64; const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, 256, 64); g.fillStyle = fg; g.font = "bold 30px 'Dela Gothic One', 'Arial Black', sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, 128, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const stall = new THREE.Group(); stall.position.set(13.5, 0, 18.5); scene.add(stall);
box(2.8, 0.9, 0.7, "#c98d4a", 0, 0.45, -0.05, stall);
for (let i = 0; i < 6; i++) box(0.36, 0.2, 0.36, ["#e8414f", "#f6cf3c", "#7fbf5a", "#ef8a2b", "#b678d6", "#f3e9f7"][i], -1.05 + i * 0.42, 1.0, -0.1, stall);
for (const x of [-1.35, 1.35]) box(0.09, 2.0, 0.09, "#6b4430", x, 1.0, 0.3, stall);
const awn = mesh(new THREE.BoxGeometry(3.1, 0.06, 1.2), new THREE.MeshStandardMaterial({ map: stripeTexture("#f27c8c", "#fff4e6"), flatShading: true }), 0, 2.0, 0.15, stall);
awn.rotation.x = 0.25;
const s1 = mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: signTexture("MINA'S STORE", "#2a2147", "#f4a63a") }), 0, 2.35, 0.65, stall, false);
const closedSign = mesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshStandardMaterial({ map: signTexture("CLOSED", "#f27c8c", "#2a1606") }), 0, 0.6, 0.31, stall, false);

// workbench
const bench = new THREE.Group(); bench.position.set(26, 0, 19.5); scene.add(bench);
box(1.9, 0.12, 0.8, "#c98d4a", 0, 0.75, 0, bench);
for (const [x, z] of [[-0.85, -0.3], [0.85, -0.3], [-0.85, 0.3], [0.85, 0.3]]) box(0.1, 0.75, 0.1, "#8a5a2f", x, 0.37, z, bench);
box(0.9, 0.08, 0.22, "#e3c08a", -0.3, 0.85, 0.1, bench); box(0.25, 0.25, 0.25, "#7a7f8f", 0.6, 0.94, -0.1, bench);
const s2 = mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshStandardMaterial({ map: signTexture("KENJI TOOLS", "#3f8f6a", "#fff4e6") }), 0, 1.45, -0.42, bench, false);
box(0.06, 0.6, 0.06, "#6b4430", -0.6, 1.1, -0.42, bench); box(0.06, 0.6, 0.06, "#6b4430", 0.6, 1.1, -0.42, bench);
const closedSign2 = mesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshStandardMaterial({ map: signTexture("CLOSED", "#f27c8c", "#2a1606") }), 0, 0.5, 0.42, bench, false);
// plaza bench + planters
for (const x of [16.5, 20.5]) { const g = new THREE.Group(); g.position.set(x, 0, 21.5); scene.add(g); box(0.9, 0.08, 0.36, "#c98d4a", 0, 0.4, 0, g); box(0.9, 0.3, 0.06, "#c98d4a", 0, 0.6, -0.16, g); box(0.08, 0.4, 0.3, "#6b4430", -0.38, 0.2, 0, g); box(0.08, 0.4, 0.3, "#6b4430", 0.38, 0.2, 0, g); }
for (const [x, z] of [[10.5, 18.5], [28.4, 18.5], [10.5, 23.4], [23.5, 23.4]]) { box(0.6, 0.4, 0.6, "#a9a3b8", x, 0.2, z); for (let i = 0; i < 3; i++) box(0.14, 0.14, 0.14, ["#f27c8c", "#f4d35e", "#b678d6"][i], x - 0.15 + i * 0.15, 0.48, z); }
// notice board
const board = new THREE.Group(); board.position.set(18.5, 0, 18.5); scene.add(board);
box(0.08, 1.4, 0.08, "#6b4430", -0.45, 0.7, 0, board); box(0.08, 1.4, 0.08, "#6b4430", 0.45, 0.7, 0, board);
box(1.1, 0.75, 0.08, "#c98d4a", 0, 1.05, 0.02, board);
for (let i = 0; i < 3; i++) box(0.24, 0.3, 0.02, "#fff4e6", -0.32 + i * 0.32, 1.05 + (i % 2) * 0.1, 0.08, board);

// lamps with night lights
const lampMat = new THREE.MeshStandardMaterial({ color: "#ffe9a8", emissive: "#ffb347", emissiveIntensity: 0, flatShading: true });
const lampLights = [];
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (at(x, z) === "L") {
  box(0.1, 1.6, 0.1, "#3a2f5e", x + 0.5, 0.8, z + 0.5);
  mesh(geo("lamp", () => new THREE.BoxGeometry(0.28, 0.32, 0.28)), lampMat, x + 0.5, 1.75, z + 0.5);
  box(0.36, 0.06, 0.36, "#3a2f5e", x + 0.5, 1.94, z + 0.5);
}
for (const [x, y, z] of [[5.5, 1.6, 7.2], [13, 2.2, 21], [24.5, 2.2, 21.5], [21.5, 1.8, 9]]) {
  const l = new THREE.PointLight(0xffb85c, 0, 9, 1.4); l.position.set(x, y, z); scene.add(l); lampLights.push(l);
}

/* ================================================================== field */
const furrowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 16, 16);
  g.fillStyle = "#c9c9c9"; for (let i = 0; i < 4; i++) g.fillRect(0, 2 + i * 4, 16, 1);
  g.fillStyle = "#e6e6e6"; for (let i = 0; i < 18; i++) g.fillRect((i * 7) % 16, (i * 5) % 16, 1, 1);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const soilDry = new THREE.MeshStandardMaterial({ color: "#8c5a3a", map: furrowTex, roughness: 1 });
const soilWet = new THREE.MeshStandardMaterial({ color: "#563626", map: furrowTex, roughness: 0.55 });
const soilGeo = new THREE.BoxGeometry(0.94, 0.06, 0.94);
const tileFx = {}; // key -> {soil, crop group, obj}
for (let z = FIELD.z0; z <= FIELD.z1; z++) for (let x = FIELD.x0; x <= FIELD.x1; x++) {
  const soil = new THREE.Mesh(soilGeo, soilDry); soil.position.set(x + 0.5, 0.03, z + 0.5); soil.receiveShadow = true; soil.visible = false; scene.add(soil);
  const holder = new THREE.Group(); holder.position.set(x + 0.5, 0.06, z + 0.5); scene.add(holder);
  tileFx[key(x, z)] = { soil, holder, sig: "" };
}
const leafGeo = new THREE.ConeGeometry(0.07, 0.26, 4);
function addLeaves(g, n, color, h = 0.26, spread = 0.1, tilt = 0.5) {
  for (let i = 0; i < n; i++) {
    const l = mesh(leafGeo, mat(color), 0, h / 2, 0, g);
    const a = i / n * Math.PI * 2; l.position.set(Math.cos(a) * spread, h * 0.45, Math.sin(a) * spread);
    l.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt); l.scale.y = h / 0.26;
  }
}
const sph = (r) => geo("s" + r, () => new THREE.IcosahedronGeometry(r, 1));
function buildCrop(g, crop) {
  const c = CROPS[crop.t];
  if (crop.dead) { const s = mesh(geo("dead", () => new THREE.ConeGeometry(0.05, 0.3, 4)), mat("#7a5a3a"), 0, 0.12, 0, g); s.rotation.z = 0.6; return; }
  const p = crop.age / c.days;
  if (crop.age === 0) { for (let i = 0; i < 3; i++) mesh(sph(0.035), mat("#5a3a24"), (i - 1) * 0.16, 0.02, ((i * 7) % 3 - 1) * 0.1, g, false); return; }
  if (p < 0.45) { addLeaves(g, 2, "#8fd17a", 0.16, 0.03, 0.7); return; }
  if (p < 1) {
    if (c.shape === "tall") { mesh(geo("stalk", () => new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5)), mat(c.leaf), 0, 0.25, 0, g); addLeaves(g, 4, c.leaf, 0.24, 0.06, 0.9); }
    else addLeaves(g, 5, c.leaf, 0.26, 0.08, 0.7);
    return;
  }
  // mature
  const fruit = mat(c.fruit);
  if (c.shape === "root") {
    addLeaves(g, 5, c.leaf, 0.32, 0.06, 0.55);
    const r = mesh(sph(0.15), fruit, 0, 0.06, 0, g); r.scale.set(1, 0.85, 1);
    if (c.top !== c.fruit) { const t = mesh(sph(0.1), mat(c.top), 0, 0.12, 0, g); t.scale.set(1.2, 0.6, 1.2); }
    if (c.flower) for (let i = 0; i < 3; i++) mesh(sph(0.04), mat(c.flower), Math.cos(i * 2.1) * 0.12, 0.34, Math.sin(i * 2.1) * 0.12, g, false);
  } else if (c.shape === "bush") {
    addLeaves(g, 6, c.leaf, 0.3, 0.11, 0.8);
    for (let i = 0; i < 4; i++) { const f = mesh(sph(c.long ? 0.06 : 0.055), fruit, Math.cos(i * 1.6) * 0.17, 0.1 + (i % 2) * 0.08, Math.sin(i * 1.6) * 0.17, g); if (c.long) f.scale.set(1, 1.8, 1); }
  } else if (c.shape === "tall") {
    mesh(geo("stake", () => new THREE.CylinderGeometry(0.02, 0.02, 0.85, 4)), mat("#c98d4a"), 0.08, 0.42, 0, g);
    mesh(geo("stalk2", () => new THREE.CylinderGeometry(0.03, 0.035, 0.75, 5)), mat(c.leaf), 0, 0.37, 0, g);
    addLeaves(g, 5, c.leaf, 0.3, 0.08, 1.0);
    if (c.corn) { for (const s of [-1, 1]) { const cob = mesh(geo("cob", () => new THREE.CylinderGeometry(0.05, 0.04, 0.24, 6)), fruit, s * 0.08, 0.5, 0, g); cob.rotation.z = s * 0.4; } }
    else for (let i = 0; i < 3; i++) mesh(sph(0.07), fruit, Math.cos(i * 2.2) * 0.12, 0.3 + i * 0.12, Math.sin(i * 2.2) * 0.12, g);
  } else if (c.shape === "big") {
    if (c.leafy) { for (let i = 0; i < 3; i++) { const l = mesh(sph(0.2 - i * 0.04), mat(i ? c.fruit : c.leaf), 0, 0.14 + i * 0.03, 0, g); l.scale.set(1.15, 0.8, 1.15); } return; }
    addLeaves(g, 4, c.leaf, 0.2, 0.22, 1.2);
    const f = mesh(sph(0.24), fruit, 0, 0.18, 0, g); f.scale.set(1.1, c.ribbed ? 0.75 : 0.9, 1.1);
    if (c.stripe) for (let i = 0; i < 4; i++) { const s = mesh(geo("strp", () => new THREE.TorusGeometry(0.245, 0.012, 3, 14)), mat(c.stripe), 0, 0.18, 0, g); s.rotation.y = i * Math.PI / 4; s.scale.set(1.1, 0.9, 1.1); }
    if (c.ribbed) for (let i = 0; i < 4; i++) { const s = mesh(geo("rib", () => new THREE.TorusGeometry(0.24, 0.02, 3, 14)), mat(shade(c.fruit, 0.8)), 0, 0.18, 0, g); s.rotation.y = i * Math.PI / 4; s.scale.set(1.12, 0.75, 1.12); }
    mesh(geo("stem", () => new THREE.CylinderGeometry(0.02, 0.03, 0.12, 4)), mat("#5a8f3a"), 0, 0.38, 0, g);
  }
}
function buildObj(g, obj, x, z) {
  if (obj === "stone") { const s = mesh(geo("stone", () => new THREE.DodecahedronGeometry(0.22, 0)), mat("#9a94aa"), 0, 0.12, 0, g); s.rotation.set(x, z, 0); s.scale.set(1, 0.7, 1); }
  if (obj === "weed") for (let i = 0; i < 4; i++) { const w = mesh(leafGeo, mat("#4f8f3a"), Math.cos(i * 1.7) * 0.1, 0.1, Math.sin(i * 1.7) * 0.1, g); w.rotation.set(Math.sin(i) * 0.6, 0, Math.cos(i) * 0.6); }
}
function refreshTile(x, z, pop = false) {
  const t = S.field[key(x, z)], fx = tileFx[key(x, z)];
  fx.soil.visible = !!t.till; fx.soil.material = t.wet ? soilWet : soilDry;
  const sig = JSON.stringify([t.crop, t.obj]);
  if (sig !== fx.sig) {
    fx.sig = sig;
    for (const ch of [...fx.holder.children]) fx.holder.remove(ch);
    if (t.crop) buildCrop(fx.holder, t.crop);
    else if (t.obj) buildObj(fx.holder, t.obj, x, z);
    if (pop) bounce(fx.holder);
  }
}
const refreshField = () => { for (const k in S.field) { const [x, z] = k.split(",").map(Number); refreshTile(x, z); } };
const bounces = [];
const bounce = (o) => bounces.push({ o, t: 0 });

/* ============================================================ characters */
function makeFolk(o) {
  const g = new THREE.Group();
  const P = {};
  const skin = mat(o.skin || "#f2c9a0");
  P.legL = new THREE.Group(); P.legR = new THREE.Group();
  for (const [leg, x] of [[P.legL, -0.08], [P.legR, 0.08]]) { leg.position.set(x, 0.3, 0); g.add(leg); box(0.11, 0.28, 0.13, o.pants || "#3f6fb5", 0, -0.14, 0, leg); box(0.12, 0.06, 0.17, "#4a3426", 0, -0.27, 0.02, leg); }
  P.body = box(0.32, 0.32, 0.22, o.shirt, 0, 0.45, 0, g);
  if (o.overalls) { box(0.33, 0.2, 0.23, o.overalls, 0, 0.38, 0, g); box(0.05, 0.16, 0.235, o.overalls, -0.09, 0.55, 0, g); box(0.05, 0.16, 0.235, o.overalls, 0.09, 0.55, 0, g); }
  if (o.apron) box(0.26, 0.3, 0.02, o.apron, 0, 0.43, 0.12, g);
  P.armL = new THREE.Group(); P.armR = new THREE.Group();
  for (const [arm, x] of [[P.armL, -0.21], [P.armR, 0.21]]) { arm.position.set(x, 0.59, 0); g.add(arm); box(0.09, 0.28, 0.1, o.shirt, 0, -0.13, 0, arm); mesh(sph(0.05), skin, 0, -0.29, 0, arm); }
  P.head = new THREE.Group(); P.head.position.set(0, 0.82, 0); g.add(P.head);
  mesh(sph(0.2), skin, 0, 0, 0, P.head);
  for (const x of [-0.07, 0.07]) box(0.04, 0.06, 0.02, "#1d1530", x, 0.01, 0.185, P.head);
  for (const x of [-0.12, 0.12]) box(0.05, 0.03, 0.02, "#f29b9b", x, -0.06, 0.17, P.head);
  if (o.hair) { const h = mesh(sph(0.205), mat(o.hair), 0, 0.05, -0.03, P.head); h.scale.set(1.05, 0.85, 1.05); }
  if (o.bun) mesh(sph(0.09), mat(o.hair), 0, 0.2, -0.12, P.head);
  if (o.beard) { box(0.2, 0.05, 0.04, o.beard, 0, -0.08, 0.18, P.head); }
  if (o.band) { const b = mesh(geo("band", () => new THREE.TorusGeometry(0.19, 0.03, 4, 12)), mat(o.band), 0, 0.09, 0, P.head); b.rotation.x = Math.PI / 2; }
  if (o.hat === "sun") {
    mesh(geo("brim", () => new THREE.CylinderGeometry(0.34, 0.34, 0.03, 14)), mat("#e9c46a"), 0, 0.15, 0, P.head);
    mesh(geo("crown", () => new THREE.CylinderGeometry(0.15, 0.18, 0.15, 12)), mat("#e9c46a"), 0, 0.24, 0, P.head);
    mesh(geo("hband", () => new THREE.CylinderGeometry(0.185, 0.185, 0.04, 12)), mat("#f27c8c"), 0, 0.19, 0, P.head);
  }
  if (o.hat === "cap") { const c = mesh(sph(0.21), mat(o.capColor), 0, 0.08, 0, P.head); c.scale.set(1.02, 0.6, 1.02); box(0.2, 0.03, 0.14, o.capColor, 0, 0.06, 0.2, P.head); }
  P.tool = new THREE.Group(); P.tool.position.set(0, -0.3, 0.02); P.armR.add(P.tool);
  g.traverse((m) => { if (m.isMesh) { m.castShadow = true; } });
  return { g, P };
}
// player
const player = makeFolk({ shirt: "#fff4e6", overalls: "#3f6fb5", pants: "#3f6fb5", hair: "#5a3324", hat: "sun" });
scene.add(player.g);
const toolMeshes = {
  0: (() => { const g = new THREE.Group(); box(0.03, 0.5, 0.03, "#8a5a2f", 0, 0, 0.1, g).rotation.x = 1.2; box(0.12, 0.03, 0.12, "#a9a3b8", 0, -0.08, 0.32, g); return g; })(),
  1: (() => { const g = new THREE.Group(); const b = mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.14, 8), mat("#7fb3d9", { metalness: 0.4, roughness: 0.4 }), 0, -0.04, 0.06, g); const s = box(0.03, 0.03, 0.16, "#7fb3d9", 0, 0, 0.18, g); s.rotation.x = -0.5; return g; })(),
  2: (() => { const g = new THREE.Group(); mesh(sph(0.08), mat("#e3c08a"), 0, -0.04, 0.05, g); return g; })(),
  3: new THREE.Group(),
};
Object.values(toolMeshes).forEach((m) => { player.P.tool.add(m); m.visible = false; });
const P = { x: 5.5, z: 7.5, fx: 0, fz: 1, walk: 0, act: 0, actDur: 0.32, target: null, pending: null, stuck: 0, emote: 0 };

// neighbors
const npcs = {};
const NPC_SPOTS = { mina: [13.5, 19.55, 0], tomo: [6.55, 13.6, -Math.PI / 2], kenji: [24.6, 20.3, Math.PI / 2] };
const folkStyle = {
  mina: { shirt: "#f27c8c", apron: "#fff4e6", hair: "#5a2e2a", bun: true, pants: "#3a2f5e" },
  tomo: { shirt: "#4f6d8f", hair: "#e8e8e8", beard: "#e8e8e8", pants: "#5a4a3a", hat: "cap", capColor: "#c98d4a" },
  kenji: { shirt: "#3f8f6a", hair: "#2b1f1a", band: "#f4a63a", pants: "#4a3f6a", overalls: "#6b4430" },
};
for (const id of Object.keys(NPCS)) {
  const f = makeFolk(folkStyle[id]); const [x, z, r] = NPC_SPOTS[id];
  f.g.position.set(x, 0, z); f.g.rotation.y = r; f.home = { x, z, r }; scene.add(f.g);
  if (id === "tomo") { f.g.position.y = 0.1; f.P.legL.rotation.x = f.P.legR.rotation.x = -1.3; }
  npcs[id] = f;
}

// animals
const animals = []; // runtime {data, g, parts, x, z, tx, tz, wait}
function makeChicken() {
  const g = new THREE.Group();
  const body = mesh(sph(0.16), mat("#fffaf0"), 0, 0.2, 0, g); body.scale.set(1, 0.9, 1.25);
  const head = new THREE.Group(); head.position.set(0, 0.36, 0.13); g.add(head);
  mesh(sph(0.09), mat("#fffaf0"), 0, 0, 0, head);
  box(0.03, 0.07, 0.08, "#e8414f", 0, 0.09, 0, head);
  const beak = mesh(geo("beak", () => new THREE.ConeGeometry(0.03, 0.07, 4)), mat("#f4a63a"), 0, -0.01, 0.1, head); beak.rotation.x = Math.PI / 2;
  for (const x of [-0.05, 0.05]) box(0.02, 0.02, 0.01, "#1d1530", x, 0.02, 0.085, head);
  const tail = mesh(geo("tail", () => new THREE.ConeGeometry(0.08, 0.16, 4)), mat("#fffaf0"), 0, 0.28, -0.2, g); tail.rotation.x = -0.9;
  for (const x of [-0.05, 0.05]) box(0.02, 0.1, 0.02, "#f4a63a", x, 0.05, 0, g);
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return { g, head };
}
function makeCow() {
  const g = new THREE.Group();
  const spotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"); x.fillStyle = "#fbf8f2"; x.fillRect(0, 0, 32, 32); x.fillStyle = "#2b2430"; [[4, 6, 9], [20, 4, 7], [14, 20, 8], [26, 22, 5]].forEach(([a, b, r]) => { x.beginPath(); x.ellipse(a, b, r, r * 0.7, 0.4, 0, 7); x.fill(); }); const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; })();
  mesh(new THREE.BoxGeometry(0.5, 0.42, 0.85), new THREE.MeshStandardMaterial({ map: spotTex, flatShading: true }), 0, 0.5, 0, g);
  for (const [x, z] of [[-0.17, 0.3], [0.17, 0.3], [-0.17, -0.3], [0.17, -0.3]]) box(0.1, 0.3, 0.1, "#fbf8f2", x, 0.15, z, g);
  const head = new THREE.Group(); head.position.set(0, 0.68, 0.48); g.add(head);
  box(0.32, 0.3, 0.3, "#fbf8f2", 0, 0, 0, head); box(0.3, 0.14, 0.1, "#f2a7b8", 0, -0.08, 0.17, head);
  for (const x of [-0.08, 0.08]) box(0.04, 0.05, 0.02, "#1d1530", x, 0.05, 0.155, head);
  for (const s of [-1, 1]) { box(0.06, 0.1, 0.06, "#e9dcc0", s * 0.12, 0.19, 0, head); box(0.12, 0.05, 0.08, "#2b2430", s * 0.21, 0.06, -0.02, head); }
  box(0.08, 0.08, 0.08, "#f4d35e", 0, -0.2, 0.1, head); // bell
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return { g, head };
}
function yardSpot() { return [YARD.x0 + 0.5 + Math.random() * (YARD.x1 - YARD.x0), YARD.z0 + 1 + Math.random() * (YARD.z1 - YARD.z0 - 0.5)]; }
function spawnAnimals() {
  for (const a of animals) scene.remove(a.g);
  animals.length = 0;
  for (const d of S.animals) {
    const m = d.kind === "cow" ? makeCow() : makeChicken(); scene.add(m.g);
    const [x, z] = yardSpot(); animals.push({ d, g: m.g, head: m.head, x, z, tx: x, tz: z, wait: Math.random() * 2, bob: Math.random() * 6 });
  }
}
// eggs on the ground
const eggMeshes = [];
function refreshEggs() {
  for (const m of eggMeshes) scene.remove(m); eggMeshes.length = 0;
  for (const e of S.eggs) { const m = mesh(sph(0.08), mat(e.gold ? "#f6cf3c" : "#fff4e0", e.gold ? { metalness: 0.5, roughness: 0.3 } : {}), e.x, 0.08, e.z); m.scale.set(1, 1.3, 1); eggMeshes.push(m); }
}

/* ============================================================ particles */
const parts = [];
const partGeo = new THREE.BoxGeometry(0.06, 0.06, 0.06);
function burst(x, y, z, color, n = 8, sp = 1.6, up = 2.2) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(partGeo, mat(color)); m.position.set(x, y, z); scene.add(m);
    parts.push({ m, vx: (Math.random() - 0.5) * sp, vy: up * (0.5 + Math.random() * 0.6), vz: (Math.random() - 0.5) * sp, life: 0.6 + Math.random() * 0.3 });
  }
}
// rain / snow
const RAIN_N = 700;
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIN_N * 6), 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0.55 })); rain.frustumCulled = false; scene.add(rain);
const SNOW_N = 600;
const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SNOW_N * 3), 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9 })); snow.frustumCulled = false; scene.add(snow);
const drops = Array.from({ length: Math.max(RAIN_N, SNOW_N) }, () => [Math.random() * 30 - 15, Math.random() * 12, Math.random() * 26 - 13, Math.random() * 6]);
// butterflies (day) / fireflies (night)
const flutter = [];
for (let i = 0; i < 7; i++) {
  const g = new THREE.Group(); const c = ["#f4d35e", "#ffffff", "#f2a7c3"][i % 3];
  const wl = box(0.1, 0.01, 0.08, c, -0.05, 0, 0, g), wr = box(0.1, 0.01, 0.08, c, 0.05, 0, 0, g);
  g.position.set(9 + Math.random() * 12, 0.8, 9 + Math.random() * 8); scene.add(g);
  flutter.push({ g, wl, wr, ph: Math.random() * 9, cx: g.position.x, cz: g.position.z });
}
const FF_N = 40;
const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FF_N * 3), 3));
const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.12, transparent: true, opacity: 0 })); scene.add(fireflies);
const ffSeed = Array.from({ length: FF_N }, () => [2 + Math.random() * 26, 0.4 + Math.random() * 1.2, 8 + Math.random() * 14, Math.random() * 9]);

// tile cursor
const cursor = new THREE.Group(); scene.add(cursor);
const curMat = new THREE.MeshBasicMaterial({ color: 0xf4a63a, transparent: true, opacity: 0.95 });
for (const [w, d, x, z] of [[1, 0.06, 0, -0.47], [1, 0.06, 0, 0.47], [0.06, 1, -0.47, 0], [0.06, 1, 0.47, 0]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), curMat); m.position.set(x, 0.08, z); cursor.add(m); }

/* =============================================================== icons */
const iconCache = {};
function disc(g, cx, cy, rx, ry, col) { g.fillStyle = col; for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) { const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry; if (dx * dx + dy * dy <= 1) g.fillRect(x, y, 1, 1); } }
function blob(g, cx, cy, rx, ry, col) { disc(g, cx, cy, rx + 1, ry + 1, shade(col, 0.55)); disc(g, cx, cy, rx, ry, col); disc(g, cx - rx * 0.35, cy - ry * 0.4, Math.max(1, rx * 0.25), Math.max(1, ry * 0.2), shade(col, 1.25)); }
function icon(id) {
  if (iconCache[id]) return iconCache[id];
  const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d");
  const it = ITEMS[id];
  if (it.kind === "seed") {
    const cc = CROPS[it.crop];
    g.fillStyle = "#8a7656"; g.fillRect(2, 1, 12, 15); g.fillStyle = "#efe2c4"; g.fillRect(3, 2, 10, 13);
    g.fillStyle = cc.leaf; g.fillRect(3, 2, 10, 3); blob(g, 8, 10, 2.6, 2.6, cc.fruit);
  } else if (it.kind === "crop") {
    const cc = CROPS[id];
    if (id === "corn") { g.fillStyle = cc.leaf; g.fillRect(4, 3, 2, 11); g.fillRect(10, 3, 2, 11); blob(g, 8, 8, 2.5, 6, cc.fruit); }
    else if (id === "eggplant") { blob(g, 8, 9.5, 3.5, 5.5, cc.fruit); g.fillStyle = "#4a8a4a"; g.fillRect(5, 2, 6, 3); }
    else if (cc.shape === "big") { blob(g, 8, 9, 6, cc.ribbed ? 5 : 6, cc.fruit); if (cc.stripe) { g.fillStyle = cc.stripe; for (const x of [5, 8, 11]) g.fillRect(x, 4, 1, 10); } g.fillStyle = "#5a8f3a"; g.fillRect(7, 1, 2, 3); }
    else if (cc.shape === "root") { g.fillStyle = cc.leaf; g.fillRect(5, 1, 2, 5); g.fillRect(9, 1, 2, 5); g.fillRect(7, 0, 2, 5); blob(g, 8, 10, 5, 4.5, cc.fruit); if (cc.top !== cc.fruit) { disc(g, 8, 8, 4, 2, cc.top); } }
    else { blob(g, 8, 9, 5, 5, cc.fruit); g.fillStyle = cc.leaf; g.fillRect(6, 3, 4, 2); g.fillRect(7, 2, 2, 1); }
  } else if (id === "egg" || id === "gold_egg") blob(g, 8, 9, 4.5, 5.5, it.color);
  else if (id === "milk") { g.fillStyle = "#6b7fa8"; g.fillRect(4, 3, 8, 12); g.fillStyle = "#ffffff"; g.fillRect(5, 4, 6, 10); g.fillStyle = "#8fb8ff"; g.fillRect(5, 1, 6, 3); g.fillRect(5, 8, 6, 3); }
  else if (id === "fodder") { g.fillStyle = "#a8862f"; g.fillRect(2, 5, 12, 9); g.fillStyle = "#e6c35c"; g.fillRect(3, 6, 10, 7); g.fillStyle = "#c4553f"; g.fillRect(2, 9, 12, 1); }
  else if (id === "onigiri") { for (let y = 2; y < 15; y++) { const w = Math.round((y - 1) * 0.55); g.fillStyle = "#8a8a9a"; g.fillRect(8 - w - 1, y, w * 2 + 2, 1); g.fillStyle = "#ffffff"; g.fillRect(8 - w, y, w * 2, 1); } g.fillStyle = "#24302a"; g.fillRect(5, 10, 6, 5); }
  else if (id === "tea") { g.fillStyle = "#e6dccb"; g.fillRect(3, 6, 9, 8); g.fillStyle = it.color; g.fillRect(4, 7, 7, 3); g.fillStyle = "#e6dccb"; g.fillRect(12, 8, 2, 3); g.fillStyle = "#ffffff"; g.fillRect(6, 2, 1, 3); g.fillRect(9, 1, 1, 3); }
  return (iconCache[id] = c.toDataURL());
}
const TOOL_SVG = [
  `<svg viewBox="0 0 32 32"><rect x="14" y="6" width="4" height="22" rx="1" fill="#c98d4a"/><path d="M8 4h16v6H8z" fill="#c9c3d6"/><path d="M8 10h16v2H8z" fill="#8a849a"/></svg>`,
  `<svg viewBox="0 0 32 32"><rect x="7" y="11" width="14" height="14" rx="3" fill="#7fb3d9"/><path d="M21 15l8-5v3l-7 5z" fill="#5f93b9"/><path d="M10 11a4 4 0 0 1 8 0" fill="none" stroke="#5f93b9" stroke-width="2"/></svg>`,
  ``,
  `<svg viewBox="0 0 32 32"><path d="M10 28v-9l-3-5 2-1 4 4V6a2 2 0 0 1 4 0v8-2a2 2 0 0 1 4 0v3a2 2 0 0 1 4 0v8c0 4-3 6-7 6z" fill="#f2c9a0" stroke="#a8754f" stroke-width="1.5"/></svg>`,
];
function portrait(id) {
  const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d"), s = folkStyle[id];
  disc(g, 8, 9.5, 5.5, 5.5, "#f2c9a0");
  if (id === "mina") { disc(g, 8, 6, 6, 3.5, s.hair); disc(g, 8, 2, 2.5, 2, s.hair); g.fillStyle = s.hair; g.fillRect(2, 6, 2, 6); g.fillRect(12, 6, 2, 6); }
  if (id === "tomo") { g.fillStyle = "#c98d4a"; g.fillRect(3, 3, 10, 3); g.fillRect(2, 5, 12, 1); g.fillStyle = s.hair; g.fillRect(2, 7, 2, 4); g.fillRect(12, 7, 2, 4); g.fillRect(5, 12, 6, 2); }
  if (id === "kenji") { disc(g, 8, 5.5, 6, 3.5, s.hair); g.fillStyle = s.band; g.fillRect(2, 6, 12, 2); }
  g.fillStyle = "#1d1530"; g.fillRect(6, 9, 1, 2); g.fillRect(10, 9, 1, 2);
  g.fillStyle = "#f29b9b"; g.fillRect(4, 11, 2, 1); g.fillRect(11, 11, 2, 1);
  g.fillStyle = "#a8544f"; if (id !== "tomo") g.fillRect(7, 12, 3, 1);
  return c;
}

/* ================================================================= HUD */
const bar = PA.topBar({ title: "Little Furrow", scoreLabel: "500 G" });
const hotbar = $("hotbar");
const TOOL_NAMES = ["Hoe", "Watering can", "Seeds", "Hands"];
function seedTypes() { return Object.keys(S.inv).filter((k) => ITEMS[k]?.kind === "seed" && S.inv[k] > 0); }
function renderHotbar() {
  if (!seedTypes().includes(S.seedSel)) S.seedSel = seedTypes()[0] || null;
  hotbar.innerHTML = TOOL_NAMES.map((n, i) => {
    let inner = TOOL_SVG[i], cnt = "";
    if (i === 2) { inner = S.seedSel ? `<img alt="" src="${icon(S.seedSel)}">` : `<svg viewBox="0 0 32 32"><rect x="9" y="6" width="14" height="20" rx="2" fill="none" stroke="#6b6290" stroke-width="2" stroke-dasharray="3 3"/></svg>`; cnt = S.seedSel ? S.inv[S.seedSel] : "0"; }
    if (i === 1) cnt = S.water;
    const label = i === 2 ? (S.seedSel ? ITEMS[S.seedSel].name + (seedTypes().length > 1 ? " · Q to switch" : "") : "No seeds — buy at Mina's") : n;
    return `<button class="slot" data-slot="${i}" aria-pressed="${S.tool === i}" aria-label="${label}"><span class="k">${i + 1}</span>${inner}<span class="n">${cnt}</span><span class="slotlabel ${S.tool === i ? "show" : ""}">${label}</span></button>`;
  }).join("");
}
hotbar.addEventListener("click", (e) => { const b = e.target.closest(".slot"); if (b) selectTool(+b.dataset.slot); });
let flashT = 0;
function selectTool(i, silent = false) {
  if (i === 2 && S.tool === 2 && !silent) cycleSeed();
  S.tool = i; if (!silent) PA.sfx("click"); renderHotbar();
  const l = hotbar.querySelector(`[data-slot="${i}"] .slotlabel`); if (l) { l.classList.add("flash"); clearTimeout(flashT); flashT = setTimeout(() => l.classList.remove("flash"), 1100); }
  for (const [k, m] of Object.entries(toolMeshes)) m.visible = +k === i;
}
function cycleSeed() { const t = seedTypes(); if (t.length < 2) return; S.seedSel = t[(t.indexOf(S.seedSel) + 1) % t.length]; }

const fmtTime = (m) => { let h = Math.floor(m / 60) % 24; const mm = Math.floor(m % 60 / 10) * 10; const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return `${h}:${String(mm).padStart(2, "0")} ${ap}`; };
const WX = {
  sun: { name: "Sunny", svg: `<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="4" fill="#f4d35e"/><g stroke="#f4d35e" stroke-width="1.5"><path d="M8 0v2M8 14v2M0 8h2M14 8h2M2.5 2.5l1.4 1.4M12.1 12.1l1.4 1.4M2.5 13.5l1.4-1.4M12.1 3.9l1.4-1.4"/></g></svg>` },
  rain: { name: "Rain", svg: `<svg viewBox="0 0 16 16"><path d="M4 9a3 3 0 0 1 .5-6A4 4 0 0 1 12 4a2.5 2.5 0 0 1 0 5z" fill="#b9b0d6"/><path d="M5 11l-1 3M8 11l-1 3M11 11l-1 3" stroke="#8fb8ff" stroke-width="1.5"/></svg>` },
  snow: { name: "Snow", svg: `<svg viewBox="0 0 16 16"><path d="M4 8a3 3 0 0 1 .5-6A4 4 0 0 1 12 3a2.5 2.5 0 0 1 0 5z" fill="#d9e4f5"/><g fill="#ffffff"><circle cx="5" cy="12" r="1.2"/><circle cx="9" cy="14" r="1.2"/><circle cx="12" cy="11" r="1.2"/></g></svg>` },
};
let hudSig = "";
function renderHUD() {
  const sig = [S.day, S.season, Math.floor(S.min / 10), S.money, Math.round(S.energy), S.water, S.weather].join("|");
  if (sig === hudSig) return; hudSig = sig;
  $("cSeason").textContent = SEASONS[S.season]; $("cSeason").style.setProperty("--season", SEASON_COLORS[S.season]);
  const wd = WEEKDAYS[((S.season * DAYS_PER_SEASON) + S.day - 1) % 7];
  $("cDay").textContent = `Day ${S.day} · ${wd}`;
  $("cTime").textContent = fmtTime(S.min);
  $("cWx").innerHTML = `${WX[S.weather].svg}<span>${WX[S.weather].name}</span>`;
  $("cDayFill").style.transform = `scaleX(${clamp((S.min - DAY_START) / (24 * 60 - DAY_START), 0, 1)})`;
  $("energyFill").style.transform = `scaleX(${S.energy / S.maxEnergy})`; $("energyVal").textContent = Math.round(S.energy);
  $("energyMeter").classList.toggle("low", S.energy < 20);
  const cap = S.can === 2 ? 40 : 20;
  $("waterFill").style.transform = `scaleX(${S.water / cap})`; $("waterVal").textContent = S.water;
  bar.setScore(S.money.toLocaleString("en-US") + " G");
  const h = hotbar.querySelector('[data-slot="1"] .n'); if (h) h.textContent = S.water;
}
const prompt = $("prompt");
function setPrompt(k, text) {
  if (!text || PA.THUMB) { prompt.hidden = true; return; }
  const label = PA.TOUCH ? (k === "E" ? "Talk" : "Use") : k;
  prompt.innerHTML = `<kbd>${label}</kbd>${text}`; prompt.hidden = false;
}
function floatText(text, x, y, z, cls = "") {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const d = document.createElement("div"); d.className = "float " + cls; d.textContent = text;
  d.style.left = ((v.x + 1) / 2 * innerWidth) + "px"; d.style.top = ((1 - v.y) / 2 * innerHeight) + "px";
  document.body.appendChild(d); setTimeout(() => d.remove(), 1150);
}

/* ============================================================ goals/hints */
function stat(name, inc = 1) { S.stats[name] = (S.stats[name] || 0) + inc; checkGoals(); }
function checkGoals() {
  const best = Math.max(...Object.values(S.friends).map((f) => hearts(f.pts)));
  S.stats.bestHearts = best;
  for (const g of GOALS) if (!S.goals[g.id] && (S.stats[g.stat] || 0) >= g.need) {
    S.goals[g.id] = true; if (!PA.THUMB) { PA.sfx("win"); PA.toast("Journal: " + g.text + " — done"); }
  }
  renderHint();
}
const hearts = (pts) => Math.min(10, Math.floor(pts / 10));
function renderHint() {
  const el = $("hintbar");
  let text = null;
  if (S.min >= 22 * 60) text = "It's late. Head home and press E at your front door to sleep.";
  else if (S.energy <= 0) text = "You're exhausted. Eat a rice ball from your Bag, or sleep.";
  else if (S.daysPlayed <= 2) { const h = HINTS.find((h) => !h.until || !S.goals[h.until]); if (h && (h.until || S.daysPlayed === 1)) text = h.text; }
  el.hidden = !text || PA.THUMB; if (text && el.textContent !== text) el.textContent = text;
}

/* =========================================================== world logic */
const facingTile = () => {
  const px = Math.floor(P.x), pz = Math.floor(P.z);
  const ax = Math.abs(P.fx) > Math.abs(P.fz);
  return [px + (ax ? Math.sign(P.fx) : 0), pz + (ax ? 0 : Math.sign(P.fz))];
};
let hover = null; // tile under the mouse within reach
function targetTile() {
  if (hover) { const [hx, hz] = hover; if (Math.abs(hx - Math.floor(P.x)) <= 1 && Math.abs(hz - Math.floor(P.z)) <= 1) return hover; }
  return facingTile();
}
const canCap = () => (S.can === 2 ? 40 : 20);
function lineTiles(x, z, n) {
  if (n === 1) return [[x, z]];
  const ax = Math.abs(P.fx) > Math.abs(P.fz);
  const out = []; for (let i = 0; i < n; i++) out.push(ax ? [x + Math.sign(P.fx) * i, z] : [x, z + Math.sign(P.fz) * i]); return out;
}
function eggAt(x, z) { return S.eggs.findIndex((e) => Math.floor(e.x) === x && Math.floor(e.z) === z); }
function animalAt(x, z) { return animals.find((a) => Math.floor(a.x) === x && Math.floor(a.z) === z); }
// What would the current tool do on tile (x,z)? Returns {label, ok, run}.
function toolPreview(x, z) {
  const c = at(x, z), t = S.field[key(x, z)];
  const tool = S.tool;
  if (tool === 1 && (c === "w" || c === "W")) return { label: "Refill can", ok: true, run: refill };
  if (tool === 3 || tool === 0 || tool === 2) {
    const ei = eggAt(x, z); if (ei >= 0 && tool === 3) return { label: "Pick up egg", ok: true, run: () => takeEgg(ei) };
  }
  if (tool === 3) { const a = animalAt(x, z); if (a) return { label: "Pet " + a.d.name, ok: true, run: () => petAnimal(a) }; }
  if (!t) return { label: tool === 0 ? "Can't till here" : "", ok: false };
  if (tool === 0) {
    if (t.obj === "stone") return { label: "Break stone", ok: true, run: () => useHoe(x, z) };
    if (t.obj === "weed") return { label: "Clear weeds", ok: true, run: () => useHoe(x, z) };
    if (t.crop?.dead) return { label: "Clear dead crop", ok: true, run: () => useHoe(x, z) };
    if (t.crop) return { label: "A crop is growing", ok: false };
    if (t.till) return { label: "Already tilled", ok: false };
    return { label: "Till soil", ok: true, run: () => useHoe(x, z) };
  }
  if (tool === 1) {
    if (!t.till) return { label: "Till first", ok: false };
    if (S.water <= 0) return { label: "Can is empty", ok: false };
    if (t.wet && S.can === 1) return { label: "Already watered", ok: false };
    return { label: "Water", ok: true, run: () => useCan(x, z) };
  }
  if (tool === 2) {
    if (!S.seedSel) return { label: "No seeds", ok: false };
    if (!t.till || t.crop || t.obj) return { label: t.till ? "Spot taken" : "Till first", ok: false };
    const cc = CROPS[ITEMS[S.seedSel].crop];
    if (cc.season !== S.season) return { label: `${cc.name} grows in ${SEASONS[cc.season]}`, ok: false };
    return { label: "Plant " + cc.name, ok: true, run: () => plant(x, z) };
  }
  if (tool === 3) {
    if (t.obj === "weed") return { label: "Pull weeds", ok: true, run: () => pullWeed(x, z) };
    if (t.crop && !t.crop.dead && t.crop.age >= CROPS[t.crop.t].days) return { label: "Harvest " + CROPS[t.crop.t].name, ok: true, run: () => harvest(x, z) };
    if (t.crop?.dead) return { label: "Clear dead crop", ok: true, run: () => clearDead(x, z) };
  }
  return { label: "", ok: false };
}
function spend(e) {
  if (S.energy <= 0) { PA.toast("You're exhausted. Eat something or go to sleep."); PA.sfx("fail"); return false; }
  S.energy = Math.max(0, S.energy - e); return true;
}
function swing() { P.act = P.actDur; }
function useHoe(x, z) {
  const tiles = lineTiles(x, z, S.hoe === 2 ? 3 : 1);
  if (!spend(S.hoe === 2 ? 4 : 2)) return; swing();
  let did = false;
  for (const [tx, tz] of tiles) {
    const t = S.field[key(tx, tz)]; if (!t) continue;
    if (t.obj) { if (t.obj === "stone") burst(tx + 0.5, 0.2, tz + 0.5, "#9a94aa", 10); else burst(tx + 0.5, 0.2, tz + 0.5, "#4f8f3a", 8); t.obj = null; did = true; }
    else if (t.crop?.dead) { t.crop = null; did = true; }
    else if (!t.crop && !t.till) {
      if (S.season === 3 && false) continue;
      t.till = 1; if (S.weather !== "sun") t.wet = 1; stat("tilled"); did = true; burst(tx + 0.5, 0.1, tz + 0.5, "#8c5a3a", 6, 1.2, 1.6);
    }
    refreshTile(tx, tz, true);
  }
  PA.sfx(did ? "thud" : "click");
}
function useCan(x, z) {
  if (!spend(S.can === 2 ? 2 : 1)) return; swing();
  let n = 0;
  for (const [tx, tz] of lineTiles(x, z, S.can === 2 ? 3 : 1)) {
    const t = S.field[key(tx, tz)]; if (!t || !t.till || S.water <= 0) continue;
    if (!t.wet) { t.wet = 1; if (t.crop && !t.crop.dead) stat("watered"); }
    S.water--; n++; burst(tx + 0.5, 0.35, tz + 0.5, "#8fb8ff", 6, 1, 1.2); refreshTile(tx, tz);
  }
  if (n) PA.sfx("splash");
  renderHotbar();
}
function refill() { swing(); S.water = canCap(); PA.sfx("splash"); floatText("Can refilled", P.x, 1.4, P.z); renderHotbar(); }
function plant(x, z) {
  const t = S.field[key(x, z)]; const item = S.seedSel;
  t.crop = { t: ITEMS[item].crop, age: 0, dead: false };
  S.inv[item]--; if (!S.inv[item]) delete S.inv[item];
  swing(); PA.sfx("pop"); stat("planted"); refreshTile(x, z, true); renderHotbar();
}
function harvest(x, z) {
  const t = S.field[key(x, z)], c = CROPS[t.crop.t], id = t.crop.t;
  S.inv[id] = (S.inv[id] || 0) + 1;
  if (c.shape === "big") stat("bigHarvest");
  if (c.regrow) t.crop.age = c.days - c.regrow; else t.crop = null;
  swing(); PA.sfx("pop"); burst(x + 0.5, 0.4, z + 0.5, c.fruit, 10, 1.4, 2.6);
  floatText("+1 " + c.name, x + 0.5, 0.9, z + 0.5, "gold"); refreshTile(x, z, true);
}
function pullWeed(x, z) { if (!spend(1)) return; const t = S.field[key(x, z)]; t.obj = null; swing(); PA.sfx("pop"); burst(x + 0.5, 0.2, z + 0.5, "#4f8f3a", 8); refreshTile(x, z); }
function clearDead(x, z) { S.field[key(x, z)].crop = null; swing(); PA.sfx("pop"); refreshTile(x, z); }
function takeEgg(i) {
  const e = S.eggs.splice(i, 1)[0]; const id = e.gold ? "gold_egg" : "egg";
  S.inv[id] = (S.inv[id] || 0) + 1; stat("eggs"); swing(); PA.sfx("pop"); PA.sfx("cluck");
  floatText("+1 " + ITEMS[id].name, e.x, 0.6, e.z, "gold"); refreshEggs();
}
function petAnimal(a) {
  swing();
  if (a.d.kind === "cow" && a.d.milkReady) {
    a.d.milkReady = false; S.inv.milk = (S.inv.milk || 0) + 1; PA.sfx("moo"); floatText("+1 Milk", a.x, 1.2, a.z, "gold"); return;
  }
  if (!a.d.petted) { a.d.petted = true; a.d.aff = Math.min(10, a.d.aff + 1); floatText("♥ " + a.d.name, a.x, 1.0, a.z, "bad"); }
  else floatText(a.d.name + " is happy", a.x, 1.0, a.z);
  PA.sfx(a.d.kind === "cow" ? "moo" : "cluck"); a.hop = 0.4;
}
function feedAnimals() {
  const hungry = S.animals.filter((a) => !a.fed);
  if (!hungry.length) { PA.toast("Everyone's already fed today."); return; }
  const have = S.inv.fodder || 0;
  if (!have) { PA.toast("No fodder left. Mina sells it for 10 G."); PA.sfx("fail"); return; }
  const n = Math.min(have, hungry.length);
  for (let i = 0; i < n; i++) { hungry[i].fed = true; if (hungry[i].kind === "cow") hungry[i].milkReady = hungry[i].milkReady; }
  S.inv.fodder -= n; if (!S.inv.fodder) delete S.inv.fodder;
  hay.visible = true; swing(); PA.sfx("thud"); PA.sfx("cluck");
  PA.toast(n === hungry.length ? `Fed all ${n} animals.` : `Fed ${n} of ${hungry.length}. Buy more fodder at Mina's.`);
}

/* ======================================================== interactables */
function interactables() {
  const list = [
    { x: 5.5, z: 6.2, r: 1.0, label: "Sleep", run: askSleep },
    { x: 8.5, z: 6.5, r: 1.2, label: "Ship items", run: openShip },
    { x: 7.5, z: 11.5, r: 1.2, label: "Refill can", run: refill },
    { x: 27.5, z: 5.5, r: 1.2, label: "Feed animals", run: feedAnimals },
    { x: 18.5, z: 18.5, r: 1.2, label: "Read journal", run: openJournal },
  ];
  for (const [id, f] of Object.entries(npcs)) if (f.g.visible) list.push({ x: f.g.position.x, z: f.g.position.z, r: 1.35, label: "Talk to " + NPCS[id].name, run: () => talk(id) });
  for (const a of animals) list.push({ x: a.x, z: a.z, r: 0.95, label: a.d.kind === "cow" && a.d.milkReady ? "Milk " + a.d.name : "Pet " + a.d.name, run: () => petAnimal(a) });
  S.eggs.forEach((e, i) => list.push({ x: e.x, z: e.z, r: 0.9, label: "Pick up egg", run: () => takeEgg(i) }));
  if (at(Math.floor(P.x + P.fx), Math.floor(P.z + P.fz)) === "w") list.push({ x: P.x + P.fx, z: P.z + P.fz, r: 2, label: "Refill can", run: refill });
  return list;
}
function nearestInteract() {
  let best = null, bd = 1e9;
  for (const it of interactables()) {
    const dx = it.x - P.x, dz = it.z - P.z, d = Math.hypot(dx, dz);
    if (d > it.r) continue;
    const facing = (dx * P.fx + dz * P.fz) / (d || 1);
    const score = d - facing * 0.4;
    if (score < bd) { bd = score; best = it; }
  }
  return best;
}

/* ============================================================ dialogue */
const dlgEl = $("dialog");
let dlg = null, typeT = 0;
const isBusy = () => !!dlg || PA.overlayOpen();
function timeOfDay() { const h = S.min / 60; return h < 11 ? "morning" : h < 17 ? "day" : "evening"; }
function npcOpen(id) {
  const s = NPCS[id].shop; if (!s) return true;
  const [a, b] = STORE_HOURS[s]; const h = S.min / 60; return h >= a && h < b;
}
function heartsHTML(pts) { const h = hearts(pts); return "♥".repeat(Math.min(h, 5)) + `<span>${"♥".repeat(Math.max(0, 5 - h))}</span>` + (h > 5 ? ` +${h - 5}` : ""); }
function showLine(id, line, options) {
  const n = NPCS[id];
  PA.sayJP(line.jp, { pitch: n.pitch });
  dlg = { id, options };
  dlgEl.innerHTML = `<div class="panel" role="dialog" aria-label="${n.name}">
    <div class="portrait" style="--pc:${n.color}"></div>
    <div><div class="d-head"><span class="d-name">${n.name}</span><span class="d-role">${n.role}</span><span class="voice" aria-hidden="true"><i></i><i></i><i></i></span><span class="hearts" aria-label="${hearts(S.friends[id].pts)} hearts">${heartsHTML(S.friends[id].pts)}</span></div>
    <p class="d-text" aria-live="polite"></p><div class="d-opts"></div></div></div>`;
  dlgEl.querySelector(".portrait").appendChild(portrait(id));
  dlgEl.hidden = false;
  const p = dlgEl.querySelector(".d-text"); let i = 0; clearInterval(typeT);
  const full = line.en;
  const finish = () => { clearInterval(typeT); p.textContent = full; dlgEl.querySelector(".voice")?.remove(); renderOpts(); };
  dlg.finish = finish; dlg.typing = true;
  if (PA.REDUCED) finish();
  else typeT = setInterval(() => { i += 2; p.textContent = full.slice(0, i); if (i >= full.length) { dlg.typing = false; finish(); } }, 28);
  function renderOpts() {
    if (!dlg) return; dlg.typing = false;
    const box = dlgEl.querySelector(".d-opts");
    box.innerHTML = options.map((o, k) => `<button class="pa-btn ${k ? "ghost" : ""}" data-k="${k}">${o.label}</button>`).join("");
    box.querySelectorAll("button").forEach((b) => b.onclick = () => { PA.sfx("select"); options[+b.dataset.k].run(); });
    box.querySelector("button")?.focus({ preventScroll: true });
  }
}
function closeDialog() { clearInterval(typeT); dlg = null; dlgEl.hidden = true; dlgEl.innerHTML = ""; if (window.speechSynthesis) speechSynthesis.cancel(); }
function talk(id) {
  const n = NPCS[id], f = S.friends[id];
  npcs[id].g.rotation.y = Math.atan2(P.x - npcs[id].g.position.x, P.z - npcs[id].g.position.z);
  const opts = [];
  if (n.shop) opts.push({ label: n.shop === "store" ? "Shop" : "Upgrades", run: () => { if (!npcOpen(id)) { showLine(id, n.closed, [{ label: "Okay", run: closeDialog }]); return; } closeDialog(); n.shop === "store" ? openStore() : openWorkshop(); } });
  opts.push({ label: "Chat", run: () => chat(id) });
  opts.push({ label: "Give a gift", run: () => giftPicker(id) });
  opts.push({ label: "Bye", run: closeDialog });
  if (!f.talked) { f.talked = true; f.pts += 4; checkGoals(); }
  showLine(id, n.greet[timeOfDay()], opts);
}
function chat(id) {
  const n = NPCS[id], h = hearts(S.friends[id].pts);
  const pool = n.chat.filter((c) => c.h <= h);
  const line = pool[(S.daysPlayed * 3 + (dlg?.chatN || 0) + id.length) % pool.length];
  const k = (dlg?.chatN || 0) + 1;
  showLine(id, line, [{ label: "More", run: () => chat(id) }, { label: "Bye", run: closeDialog }]); dlg.chatN = k;
}
function giftPicker(id) {
  const items = Object.keys(S.inv).filter((k) => ["crop", "produce"].includes(ITEMS[k].kind));
  if (!items.length) { showLine(id, { en: "You've got nothing to give right now. Harvest something first!", jp: "またね！" }, [{ label: "Okay", run: closeDialog }]); return; }
  if (S.friends[id].gifted) { showLine(id, { en: "You already gave me something today. Thank you!", jp: "今日はもう十分だよ。" }, [{ label: "Okay", run: closeDialog }]); return; }
  closeDialog();
  PA.overlay(`<span class="pa-eyebrow">Gift for ${NPCS[id].name}</span><h2>Pick a gift</h2><div class="list">${items.map((k) => `<div class="row"><img alt="" src="${icon(k)}"><span class="t">${ITEMS[k].name}<small>You have ${S.inv[k]}</small></span><button class="pa-btn" data-gift="${k}">Give</button></div>`).join("")}</div><div class="pa-actions"><button class="pa-btn ghost" data-close>Cancel</button></div>`,
    { "[data-close]": () => PA.closeOverlay(), "[data-gift]": (e) => giveGift(id, e.currentTarget.dataset.gift) });
}
function giveGift(id, item) {
  PA.closeOverlay();
  const n = NPCS[id], f = S.friends[id];
  S.inv[item]--; if (!S.inv[item]) delete S.inv[item];
  f.gifted = true;
  const r = n.likes.includes(item) ? "like" : n.dislikes.includes(item) ? "bad" : "ok";
  f.pts = Math.max(0, f.pts + (r === "like" ? 12 : r === "ok" ? 5 : -4)); checkGoals();
  if (r === "like") floatText("♥♥", npcs[id].g.position.x, 1.4, npcs[id].g.position.z, "bad");
  showLine(id, n.react[r], [{ label: "Bye", run: closeDialog }]);
}

/* =============================================================== menus */
function rowItem(id, sub, btns) { return `<div class="row"><img alt="" src="${icon(id)}"><span class="t">${ITEMS[id].name}<small>${sub}</small></span><span class="pa-actions">${btns}</span></div>`; }
function openStore() {
  const seeds = Object.entries(CROPS).filter(([, c]) => c.season === S.season).map(([k]) => k + "_seed");
  const goods = [...seeds, "fodder", "onigiri", "tea"];
  PA.overlay(`<span class="pa-eyebrow">Mina's Store · ${SEASONS[S.season]} stock</span><h2>Buy supplies</h2>
    <p>You have <span class="money" data-money>${S.money.toLocaleString("en-US")} G</span></p>
    <div class="list">${goods.map((id) => {
      const it = ITEMS[id], c = it.crop ? CROPS[it.crop] : null;
      const sub = c ? `${it.price} G · ${c.days} days${c.regrow ? `, regrows every ${c.regrow}` : ""} · sells ${c.sell} G` : id === "fodder" ? `${it.price} G · one meal for one animal` : `${it.price} G · restores ${it.energy} energy`;
      return rowItem(id, sub + ` · own ${S.inv[id] || 0}`, `<button class="pa-btn" data-buy="${id}" data-n="1" ${S.money < it.price ? "disabled" : ""}>Buy 1</button><button class="pa-btn ghost" data-buy="${id}" data-n="5" ${S.money < it.price * 5 ? "disabled" : ""}>Buy 5</button>`);
    }).join("")}</div><div class="pa-actions"><button class="pa-btn ghost" data-close>Done</button></div>`,
    { "[data-close]": () => PA.closeOverlay(), "[data-buy]": (e) => { const b = e.currentTarget; buy(b.dataset.buy, +b.dataset.n); openStore(); } });
}
function buy(id, n) {
  const cost = ITEMS[id].price * n; if (S.money < cost) return;
  S.money -= cost; S.inv[id] = (S.inv[id] || 0) + n; PA.sfx("coin"); renderHotbar();
}
function openWorkshop() {
  const chickens = S.animals.filter((a) => a.kind === "chicken").length;
  const rows = Object.entries(UPGRADES).map(([id, u]) => {
    const owned = (id === "can2" && S.can === 2) || (id === "hoe2" && S.hoe === 2) || (id === "stamina" && S.upgrades.stamina);
    const full = id === "chicken" && chickens >= 6;
    const dis = owned || full || S.money < u.price;
    return `<div class="row"><span class="check">${owned ? "✓" : ""}</span><span class="t">${u.name}<small>${u.desc}${id === "chicken" ? ` You have ${chickens}.` : ""}</small></span><button class="pa-btn" data-up="${id}" ${dis ? "disabled" : ""}>${owned ? "Owned" : full ? "Coop full" : u.price.toLocaleString("en-US") + " G"}</button></div>`;
  }).join("");
  PA.overlay(`<span class="pa-eyebrow">Kenji Tools</span><h2>Upgrades</h2><p>You have <span class="money">${S.money.toLocaleString("en-US")} G</span></p><div class="list">${rows}</div><div class="pa-actions"><button class="pa-btn ghost" data-close>Done</button></div>`,
    { "[data-close]": () => PA.closeOverlay(), "[data-up]": (e) => buyUpgrade(e.currentTarget.dataset.up) });
}
const HEN_NAMES = ["Custard", "Sesame", "Waffle", "Dumpling", "Clover", "Nutmeg"];
function buyUpgrade(id) {
  const u = UPGRADES[id]; if (S.money < u.price) return;
  S.money -= u.price; S.upgrades[id] = (S.upgrades[id] || 0) + 1; stat("upgrades");
  if (id === "can2") { S.can = 2; S.water = 40; }
  if (id === "hoe2") S.hoe = 2;
  if (id === "stamina") { S.maxEnergy += 20; S.energy += 20; }
  if (id === "chicken") { S.animals.push({ kind: "chicken", name: HEN_NAMES[S.animals.length % HEN_NAMES.length], aff: 1, fed: false, petted: false, milkReady: false }); spawnAnimals(); }
  PA.sfx("coin"); PA.toast(`Bought: ${u.name}`); renderHotbar(); openWorkshop();
}
function openShip() {
  const items = Object.keys(S.inv).filter((k) => ITEMS[k].sell);
  const shipped = Object.entries(S.shippedToday).map(([k, n]) => `${n}× ${ITEMS[k].name}`).join(", ");
  PA.overlay(`<span class="pa-eyebrow">Shipping bin</span><h2>Ship produce</h2>
    <p>Everything you ship is paid overnight. In the bin today: <span class="money">${S.earnedToday.toLocaleString("en-US")} G</span>${shipped ? ` (${shipped})` : ""}.</p>
    <div class="list">${items.length ? items.map((k) => rowItem(k, `${ITEMS[k].sell} G each · you have ${S.inv[k]}`, `<button class="pa-btn ghost" data-ship="${k}" data-n="1">Ship 1</button><button class="pa-btn" data-ship="${k}" data-n="all">Ship all</button>`)).join("") : `<p>Nothing to ship yet. Harvest crops or collect eggs and milk.</p>`}</div>
    <div class="pa-actions">${items.length ? `<button class="pa-btn" data-all>Ship everything</button>` : ""}<button class="pa-btn ghost" data-close>Done</button></div>`,
    { "[data-close]": () => PA.closeOverlay(), "[data-ship]": (e) => { const b = e.currentTarget; ship(b.dataset.ship, b.dataset.n === "all" ? S.inv[b.dataset.ship] : 1); openShip(); }, "[data-all]": () => { for (const k of items) ship(k, S.inv[k]); openShip(); } });
}
function ship(id, n) {
  if (!S.inv[id]) return; n = Math.min(n, S.inv[id]);
  S.inv[id] -= n; if (!S.inv[id]) delete S.inv[id];
  S.shippedToday[id] = (S.shippedToday[id] || 0) + n; S.earnedToday += ITEMS[id].sell * n;
  binLid.rotation.x = -0.6; setTimeout(() => (binLid.rotation.x = 0), 350);
  PA.sfx("coin"); stat("shipped", n);
}
function openBag() {
  const ids = Object.keys(S.inv).sort((a, b) => ITEMS[a].kind.localeCompare(ITEMS[b].kind));
  PA.overlay(`<span class="pa-eyebrow">Bag</span><h2>Your things</h2>
    <div class="list">${ids.length ? ids.map((k) => {
      const it = ITEMS[k];
      const btn = it.kind === "food" ? `<button class="pa-btn" data-eat="${k}">Eat</button>` : it.kind === "seed" ? `<button class="pa-btn ghost" data-sel="${k}">Hold</button>` : "";
      return rowItem(k, `×${S.inv[k]}${it.sell ? ` · sells ${it.sell} G` : ""}${it.energy ? ` · +${it.energy} energy` : ""}`, btn);
    }).join("") : "<p>Your bag is empty.</p>"}</div><div class="pa-actions"><button class="pa-btn ghost" data-close>Close</button></div>`,
    { "[data-close]": () => PA.closeOverlay(), "[data-eat]": (e) => { const k = e.currentTarget.dataset.eat; S.inv[k]--; if (!S.inv[k]) delete S.inv[k]; S.energy = Math.min(S.maxEnergy, S.energy + ITEMS[k].energy); PA.sfx("pop"); PA.toast(`+${ITEMS[k].energy} energy`); openBag(); renderHint(); },
      "[data-sel]": (e) => { S.seedSel = e.currentTarget.dataset.sel; PA.closeOverlay(); selectTool(2); } });
}
function openJournal() {
  const rows = GOALS.map((g) => { const v = Math.min(g.need, S.stats[g.stat] || 0), d = !!S.goals[g.id]; return `<div class="row ${d ? "done" : ""}"><span class="check">${d ? "✓" : ""}</span><span class="t">${g.text}</span><span class="prog">${g.need > 1 ? `${v.toLocaleString("en-US")}/${g.need.toLocaleString("en-US")}` : d ? "Done" : ""}</span></div>`; }).join("");
  const folks = Object.entries(NPCS).map(([id, n]) => `<div class="row"><span class="check" style="background:${n.color}"></span><span class="t">${n.name}<small>${n.role} · likes ${n.likes.slice(0, 2).map((k) => ITEMS[k].name.toLowerCase()).join(", ")}</small></span><span class="hearts">${heartsHTML(S.friends[id].pts)}</span></div>`).join("");
  const done = Object.keys(S.goals).length;
  PA.overlay(`<span class="pa-eyebrow">Farm journal · Year ${S.year}</span><h2>${done} of ${GOALS.length} goals</h2><div class="list">${rows}${folks}</div><div class="pa-actions"><button class="pa-btn ghost" data-close>Close</button></div>`, { "[data-close]": () => PA.closeOverlay() });
}
function askSleep() {
  PA.overlay(`<span class="pa-eyebrow">Home · ${fmtTime(S.min)}</span><h2>Sleep until morning?</h2><p>Crops you watered today will grow overnight. Anything in the shipping bin gets paid while you sleep.</p>
    <div class="pa-actions"><button class="pa-btn" data-sleep>Sleep</button><button class="pa-btn ghost" data-close>Not yet</button></div>`,
    { "[data-sleep]": () => { PA.closeOverlay(); endDay(false); }, "[data-close]": () => PA.closeOverlay() });
}
function rollWeather(season) { const r = Math.random(); if (season === 3) return r < 0.3 ? "snow" : "sun"; return r < (season === 0 ? 0.28 : season === 1 ? 0.18 : 0.22) ? "rain" : "sun"; }

/* ============================================================ day cycle */
let transitioning = false;
function endDay(passedOut) {
  if (transitioning) return; transitioning = true;
  closeDialog(); $("fade").classList.add("on"); PA.sfx("whoosh");
  setTimeout(() => {
    const pay = S.earnedToday, shipped = { ...S.shippedToday };
    S.money += pay; S.stats.earned += pay;
    let grown = 0, ready = 0;
    for (const t of Object.values(S.field)) {
      if (t.crop && !t.crop.dead && t.wet && t.crop.age < CROPS[t.crop.t].days) { t.crop.age++; grown++; if (t.crop.age >= CROPS[t.crop.t].days) ready++; }
      t.wet = 0;
    }
    let newEggs = 0;
    for (const a of S.animals) {
      if (a.kind === "chicken" && a.fed) { const [x, z] = yardSpot(); S.eggs.push({ x, z, gold: a.aff >= 6 && Math.random() < 0.3 }); newEggs++; }
      if (a.kind === "cow") a.milkReady = a.fed;
      if (!a.fed) a.aff = Math.max(0, a.aff - 1);
      a.fed = false; a.petted = false;
    }
    S.eggs = S.eggs.slice(-12);
    const oldSeason = S.season;
    S.day++; S.daysPlayed++;
    if (S.day > DAYS_PER_SEASON) { S.day = 1; S.season = (S.season + 1) % 4; if (S.season === 0) S.year++; }
    let wilted = 0;
    if (S.season !== oldSeason) for (const t of Object.values(S.field)) if (t.crop && !t.crop.dead && CROPS[t.crop.t].season !== S.season) { t.crop.dead = true; wilted++; }
    S.weather = S.tomorrow; S.tomorrow = rollWeather(S.day === DAYS_PER_SEASON ? (S.season + 1) % 4 : S.season);
    if (S.weather !== "sun") for (const t of Object.values(S.field)) if (t.till) t.wet = 1;
    if (S.season !== 3) { const empty = Object.values(S.field).filter((t) => !t.till && !t.crop && !t.obj); for (let i = 0; i < 2 && empty.length; i++) empty.splice(Math.floor(Math.random() * empty.length), 1)[0].obj = "weed"; }
    for (const f of Object.values(S.friends)) { f.talked = false; f.gifted = false; }
    S.energy = passedOut ? Math.round(S.maxEnergy * 0.5) : S.maxEnergy;
    S.min = passedOut ? 7 * 60 : DAY_START;
    S.shippedToday = {}; S.earnedToday = 0;
    P.x = 5.5; P.z = 7.5; P.fx = 0; P.fz = 1; P.target = null;
    hay.visible = false;
    if (S.season !== oldSeason) applySeason();
    refreshField(); refreshEggs(); renderHotbar(); hudSig = ""; renderHUD(); save(); updateMusic(true);
    const lines = Object.entries(shipped).map(([k, n]) => `<span>${n}× ${ITEMS[k].name}</span><b>${(ITEMS[k].sell * n).toLocaleString("en-US")} G</b>`).join("");
    PA.overlay(`<span class="pa-eyebrow">${passedOut ? "You fainted at 2 AM" : "Good night"}</span><h2>${SEASONS[S.season]}, day ${S.day}</h2>
      ${S.season !== oldSeason ? `<p><strong>${SEASONS[S.season]} has arrived.</strong> ${wilted ? `${wilted} out-of-season crop${wilted > 1 ? "s" : ""} wilted. ` : ""}Mina has new seeds in stock.</p>` : ""}
      ${passedOut ? `<p>You woke up at 7 AM with half your energy. Try to be home by midnight.</p>` : ""}
      <div class="sum">${lines || `<span>Nothing shipped</span><b>0 G</b>`}<span class="tot">Paid overnight</span><b class="tot">${pay.toLocaleString("en-US")} G</b>
      <span>Crops that grew</span><b>${grown}</b><span>Ready to harvest</span><b>${ready}</b><span>New eggs</span><b>${newEggs}</b><span>Today's weather</span><b>${WX[S.weather].name}</b><span>Tomorrow</span><b>${WX[S.tomorrow].name}</b></div>
      <div class="pa-actions"><button class="pa-btn" data-go>Start the day</button></div>`, { "[data-go]": () => { PA.closeOverlay(); } });
    $("fade").classList.remove("on"); transitioning = false;
    if (pay) PA.sfx("coin");
  }, 700);
}

/* ===================================================== seasons & light */
function applySeason() {
  paintGround(S.season);
  LEAVES[S.season].forEach((c, i) => leafMats[i].color.set(c));
  tuftMat.color.set(GRASS[S.season][1]); outerMat.color.set(GRASS[S.season][1]);
  hills.forEach((h, i) => h.material = mat(S.season === 3 ? (i % 2 ? "#dfe7f0" : "#cfd9e6") : S.season === 2 ? (i % 2 ? "#b8923e" : "#a8823a") : (i % 2 ? "#6aa35a" : "#5d9a54")));
  const snowy = S.season === 3;
  houseRoof.material = mat(snowy ? "#e8eef5" : "#3f7f8f"); barnRoof.material = mat(snowy ? "#e8eef5" : "#5a3a3a");
  tufts.visible = !snowy;
  flutter.forEach((f) => (f.g.visible = S.season < 2));
}
const KEYS = [ // hour, sky, sun color, sun I, hemi I
  [4, "#1b1838", "#7a86ff", 0.25, 0.32],
  [6, "#f3b39a", "#ffb27a", 1.1, 0.75],
  [8.5, "#9fd3ff", "#fff3dc", 2.6, 1.05],
  [15.5, "#a6d6ff", "#fff0d0", 2.5, 1.0],
  [17.6, "#f6b27c", "#ffbe7a", 1.9, 0.9],
  [19, "#b06a8f", "#ff8a6a", 0.8, 0.65],
  [20.5, "#2e2756", "#8a96ff", 0.3, 0.38],
  [26, "#151230", "#7a86ff", 0.25, 0.32],
];
const cA = new THREE.Color(), cB = new THREE.Color(), skyC = new THREE.Color();
function applyLight() {
  const h = S.min / 60;
  let i = 0; while (i < KEYS.length - 2 && h > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = clamp((h - a[0]) / (b[0] - a[0]), 0, 1);
  skyC.copy(cA.set(a[1])).lerp(cB.set(b[1]), t);
  sun.color.copy(cA.set(a[2])).lerp(cB.set(b[2]), t);
  let si = lerp(a[3], b[3], t), hi = lerp(a[4], b[4], t);
  if (S.weather === "rain") { skyC.lerp(cA.set("#7d8698"), 0.55); si *= 0.4; hi *= 0.9; }
  if (S.weather === "snow") { skyC.lerp(cA.set("#cfd8e6"), 0.45); si *= 0.65; }
  sun.intensity = si; hemi.intensity = hi;
  hemi.color.copy(skyC).lerp(cA.set("#ffffff"), 0.4);
  renderer.setClearColor(skyC); scene.fog.color.copy(skyC);
  const day = clamp((h - 5.5) / 15, 0, 1), ang = day * Math.PI;
  const night = smooth(18.6, 20.2, h) + (h < 6 ? 1 : 0);
  const cx = W / 2, cz = H / 2;
  if (night > 0.5) sun.position.set(cx - 8, 26, cz + 10); else sun.position.set(cx + Math.cos(ang) * 22, 6 + Math.sin(ang) * 22, cz + 12);
  sun.target.position.set(cx, 0, cz);
  const n = clamp(night, 0, 1);
  lampMat.emissiveIntensity = n * 2.2; windowMat.emissiveIntensity = n * 1.8 + (S.weather === "rain" ? 0.4 : 0);
  lampLights.forEach((l) => (l.intensity = n * 9));
  fireflies.material.opacity = (S.season === 1 || S.season === 2) && S.weather === "sun" ? n * 0.95 : 0;
}

/* =========================================================== NPC hours */
function npcVisibility() {
  const h = S.min / 60;
  npcs.mina.g.visible = h >= 7 && h < 21;
  npcs.kenji.g.visible = h >= 7 && h < 21;
  npcs.tomo.g.visible = h >= 6.5 && h < 19.5 && S.weather === "sun";
  closedSign.visible = !npcOpen("mina"); closedSign2.visible = !npcOpen("kenji");
}

/* ============================================================== music */
let musicMode = "";
const SONGS = [
  { bpm: 104, root: 262, lead: [7, null, 9, 12, null, 9, 7, null, 4, null, 2, 4, null, 7, null, null], bass: [0, null, null, null, 5, null, null, null, 7, null, null, null, 5, null, null, null] },
  { bpm: 116, root: 294, lead: [12, 14, null, 12, 9, null, 7, 9, null, 12, null, 16, 14, null, 12, null], bass: [0, null, 0, null, 5, null, 5, null, 7, null, 7, null, 5, null, 4, null] },
  { bpm: 92, root: 220, lead: [7, null, 3, null, 5, 7, null, null, 10, null, 7, null, 5, null, 3, null], bass: [0, null, null, null, 8, null, null, null, 3, null, null, null, 10, null, null, null] },
  { bpm: 78, root: 247, lead: [12, null, null, 7, null, null, 9, null, 4, null, null, 7, null, null, null, null], bass: [0, null, null, null, null, null, null, null, 5, null, null, null, null, null, null, null] },
];
const NIGHT_SONG = { bpm: 66, root: 196, lead: [7, null, null, null, 4, null, null, 2, null, null, 0, null, null, null, null, null], bass: [0, null, null, null, null, null, null, null, 5, null, null, null, null, null, null, null] };
function updateMusic(force = false) {
  if (PA.THUMB || isBusyStart) return;
  const h = S.min / 60, mode = h >= 19.5 || h < 6 ? "night" : "s" + S.season;
  if (mode === musicMode && !force) return; musicMode = mode;
  PA.music(mode === "night" ? NIGHT_SONG : SONGS[S.season]);
}

/* ============================================================== input */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
function groundPoint(e) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(plane, hit) ? hit.clone() : null;
}
renderer.domElement.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  const p = groundPoint(e); hover = p ? [Math.floor(p.x), Math.floor(p.z)] : null;
});
renderer.domElement.addEventListener("pointerleave", () => (hover = null));
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (!started || isBusy() || e.button > 0) return;
  PA.ctx();
  const p = groundPoint(e); if (!p) return;
  const tx = Math.floor(p.x), tz = Math.floor(p.z);
  // clicked something interactive?
  let it = null, bd = 0.85;
  for (const c of interactables()) { const d = Math.hypot(c.x - p.x, c.z - p.z); if (d < bd) { bd = d; it = c; } }
  if (it) {
    if (Math.hypot(it.x - P.x, it.z - P.z) <= it.r + 0.2) { faceTo(it.x, it.z); it.run(); }
    else { P.target = { x: it.x, z: it.z, stop: it.r * 0.8 }; P.pending = it; }
    return;
  }
  const near = Math.abs(tx - Math.floor(P.x)) <= 1 && Math.abs(tz - Math.floor(P.z)) <= 1;
  if (near) { if (tx !== Math.floor(P.x) || tz !== Math.floor(P.z)) faceTo(tx + 0.5, tz + 0.5); hover = [tx, tz]; act(); if (e.pointerType !== "mouse") hover = null; }
  else { P.target = { x: tx + 0.5, z: tz + 0.5, stop: 0.9 }; P.pending = { tile: [tx, tz] }; }
});
renderer.domElement.addEventListener("wheel", (e) => { zoom = clamp(zoom + Math.sign(e.deltaY) * 1.2, 8, 19); e.preventDefault(); }, { passive: false });
function faceTo(x, z) { const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz) || 1; P.fx = dx / d; P.fz = dz / d; }
function act() {
  if (P.act > 0.1 || isBusy()) return;
  const [x, z] = targetTile(); const pv = toolPreview(x, z);
  if (pv.ok) { pv.run(); renderHUD(); return; }
  const it = nearestInteract(); if (it) { it.run(); return; }
  if (pv.label) { PA.toast(pv.label); PA.sfx("click"); }
}
function interact() { if (isBusy()) return; const it = nearestInteract(); if (it) it.run(); else act(); }
addEventListener("keydown", (e) => {
  if (!started) return;
  if (dlg) {
    if (e.code === "Escape") { closeDialog(); return; }
    if ((e.code === "Space" || e.code === "KeyE" || e.code === "Enter") && dlg.typing) { e.preventDefault(); dlg.finish(); return; }
    return;
  }
  if (e.code === "Escape" || e.code === "KeyP") { if (PA.overlayOpen()) { if (!transitioning) PA.closeOverlay(); } else pauseMenu(); return; }
  if (PA.overlayOpen() || e.repeat) return;
  if (e.code === "Space") { e.preventDefault(); act(); }
  if (e.code === "KeyE" || e.code === "Enter") interact();
  if (e.code === "KeyQ") { cycleSeed(); selectTool(2); }
  if (e.code === "KeyB" || e.code === "KeyI") openBag();
  if (e.code === "KeyJ") openJournal();
  const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code); if (n >= 0) selectTool(n);
});
$("bagBtn").onclick = () => { PA.sfx("click"); openBag(); };
$("journalBtn").onclick = () => { PA.sfx("click"); openJournal(); };
bar.onPause(() => pauseMenu());
function pauseMenu() {
  closeDialog();
  PA.overlay(`<span class="pa-eyebrow">Paused · ${SEASONS[S.season]} ${S.day}</span><h2>Taking a break</h2>${controlsHTML()}
    <div class="pa-actions"><button class="pa-btn" data-close>Resume</button><a class="pa-btn ghost" href="../index.html#farm" style="display:inline-flex;align-items:center;text-decoration:none" data-save>Save &amp; back to gallery</a></div>`,
    { "[data-close]": () => PA.closeOverlay(), "[data-save]": () => save() });
}
function controlsHTML() {
  return `<div class="pa-keys">
    <kbd>WASD / Arrows</kbd><span>Walk</span>
    <kbd>1 2 3 4</kbd><span>Hoe, can, seeds, hands</span>
    <kbd>Space / Click</kbd><span>Use the tool on the highlighted tile</span>
    <kbd>E</kbd><span>Talk, ship, feed animals, sleep at your door</span>
    <kbd>Q · B · J</kbd><span>Switch seeds · Bag · Journal</span>
    <kbd>Phone</kbd><span>Stick to walk, Use and Talk buttons, tap tools</span>
  </div>`;
}
PA.touchControls({ stick: true, buttons: [{ label: "Talk", code: "KeyE", alt: true }, { label: "Use", code: "Space" }] });
if (PA.TOUCH) document.body.classList.add("touch");

/* =========================================================== simulation */
function blocked(x, z) {
  const r = 0.26;
  for (const [ox, oz] of [[r, r], [-r, r], [r, -r], [-r, -r]]) if (solidTile(Math.floor(x + ox), Math.floor(z + oz))) return true;
  for (const f of Object.values(npcs)) if (f.g.visible && Math.hypot(f.g.position.x - x, f.g.position.z - z) < 0.45) return true;
  return false;
}
let zoom = 15;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
let started = false, isBusyStart = true;
function step(dt, t) {
  const busy = isBusy() || transitioning || !started;
  // movement
  let mx = 0, mz = 0;
  if (!busy) {
    const k = PA.keys;
    mx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + PA.axis.x;
    mz = (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) + PA.axis.y;
    if (Math.hypot(mx, mz) > 0.15) { P.target = null; P.pending = null; }
    else if (P.target) {
      const dx = P.target.x - P.x, dz = P.target.z - P.z, d = Math.hypot(dx, dz);
      if (d <= P.target.stop) {
        const pend = P.pending; P.target = null; P.pending = null;
        if (pend?.run) { faceTo(pend.x, pend.z); pend.run(); }
        else if (pend?.tile) { faceTo(pend.tile[0] + 0.5, pend.tile[1] + 0.5); hover = pend.tile; act(); hover = null; }
      } else { mx = dx / d; mz = dz / d; }
    }
  }
  const m = Math.hypot(mx, mz);
  if (m > 0.15 && P.act <= 0) {
    mx /= Math.max(1, m); mz /= Math.max(1, m);
    const sp = (S.energy <= 0 ? 2.2 : 3.6) * dt;
    const nx = P.x + mx * sp, nz = P.z + mz * sp;
    let moved = false;
    if (!blocked(nx, P.z)) { P.x = nx; moved = true; }
    if (!blocked(P.x, nz)) { P.z = nz; moved = true; }
    if (P.target) { P.stuck = moved ? 0 : P.stuck + dt; if (P.stuck > 0.4) { P.target = null; P.pending = null; } }
    P.fx = mx / Math.hypot(mx, mz); P.fz = mz / Math.hypot(mx, mz);
    P.walk += dt * 10;
  } else P.walk = 0;
  // player pose
  const g = player.g, pp = player.P;
  g.position.set(P.x, 0, P.z);
  const targetRot = Math.atan2(P.fx, P.fz);
  let dr = targetRot - g.rotation.y; dr = Math.atan2(Math.sin(dr), Math.cos(dr)); g.rotation.y += dr * Math.min(1, dt * 14);
  const sw = Math.sin(P.walk) * 0.7 * (P.walk ? 1 : 0);
  pp.legL.rotation.x = sw; pp.legR.rotation.x = -sw; pp.armL.rotation.x = -sw * 0.8;
  if (P.act > 0) { P.act -= dt; const k = 1 - P.act / P.actDur; pp.armR.rotation.x = -Math.sin(k * Math.PI) * 2.0 + 0.2; pp.body.rotation.x = Math.sin(k * Math.PI) * 0.15; }
  else { pp.armR.rotation.x = sw * 0.8; pp.body.rotation.x = 0; }
  g.position.y = P.walk ? Math.abs(Math.sin(P.walk)) * 0.04 : 0;
  // time
  if (!busy) {
    S.min += dt * 60 / HOUR_SECONDS;
    if (S.min >= PASS_OUT) { PA.toast("You collapsed from exhaustion…"); endDay(true); }
  }
  // npcs face the player when close; idle bob
  for (const [id, f] of Object.entries(npcs)) {
    const d = Math.hypot(P.x - f.g.position.x, P.z - f.g.position.z);
    const want = d < 3 ? Math.atan2(P.x - f.g.position.x, P.z - f.g.position.z) : f.home.r;
    let r = want - f.g.rotation.y; r = Math.atan2(Math.sin(r), Math.cos(r)); f.g.rotation.y += r * Math.min(1, dt * 4);
    f.P.head.position.y = 0.82 + Math.sin(t * 2 + id.length) * 0.012;
    if (id === "kenji" && d >= 3) { f.P.armR.rotation.x = -1.2 + Math.abs(Math.sin(t * 6)) * 0.9; } else if (id === "kenji") f.P.armR.rotation.x = 0;
  }
  // animals wander
  for (const a of animals) {
    a.wait -= dt;
    const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
    const sp = a.d.kind === "cow" ? 0.55 : 1.1;
    if (d > 0.05 && a.wait <= 0) { a.x += dx / d * sp * dt; a.z += dz / d * sp * dt; a.g.rotation.y = Math.atan2(dx, dz); a.bob += dt * 12; }
    else if (a.wait <= 0) { [a.tx, a.tz] = yardSpot(); if (Math.abs(a.tx - 27.5) < 0.8 && a.tz < 6.2) a.tz += 1; a.wait = 1 + Math.random() * 3; }
    a.hop = Math.max(0, (a.hop || 0) - dt);
    a.g.position.set(a.x, Math.abs(Math.sin(a.bob)) * (a.d.kind === "cow" ? 0.02 : 0.05) + Math.sin((a.hop || 0) / 0.4 * Math.PI) * 0.25, a.z);
    if (a.head) a.head.rotation.x = a.wait > 0 && a.d.kind === "chicken" ? Math.max(0, Math.sin(t * 5 + a.bob)) * 0.9 : 0;
  }
  // particles
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt; p.vy -= 9 * dt;
    p.m.position.x += p.vx * dt; p.m.position.y = Math.max(0.03, p.m.position.y + p.vy * dt); p.m.position.z += p.vz * dt;
    p.m.scale.setScalar(Math.max(0.01, p.life * 1.5));
    if (p.life <= 0) { scene.remove(p.m); parts.splice(i, 1); }
  }
  for (let i = bounces.length - 1; i >= 0; i--) { const b = bounces[i]; b.t += dt / 0.35; const s = 1 + Math.sin(Math.min(1, b.t) * Math.PI) * 0.35; b.o.scale.set(s, 2 - s, s); if (b.t >= 1) { b.o.scale.set(1, 1, 1); bounces.splice(i, 1); } }
  // weather particles around the camera focus
  const raining = S.weather === "rain", snowing = S.weather === "snow";
  rain.visible = raining; snow.visible = snowing;
  if (raining || snowing) {
    const arr = (raining ? rainGeo : snowGeo).attributes.position.array, n = raining ? RAIN_N : SNOW_N;
    for (let i = 0; i < n; i++) {
      const d = drops[i];
      d[1] -= (raining ? 16 : 1.4) * dt; if (snowing) d[0] += Math.sin(t + d[3]) * 0.3 * dt;
      if (d[1] < 0) { d[1] = 12; d[0] = Math.random() * 30 - 15; d[2] = Math.random() * 26 - 13; }
      const x = P.x + d[0], z = P.z + d[2];
      if (raining) { arr.set([x, d[1], z, x - 0.05, d[1] + 0.45, z - 0.05], i * 6); } else arr.set([x, d[1], z], i * 3);
    }
    (raining ? rainGeo : snowGeo).attributes.position.needsUpdate = true;
  }
  // critters
  const dayish = S.min / 60 > 7 && S.min / 60 < 18 && S.weather === "sun";
  for (const f of flutter) {
    f.g.visible = dayish && S.season < 2;
    f.ph += dt; f.g.position.set(f.cx + Math.sin(f.ph * 0.6) * 2, 0.7 + Math.sin(f.ph * 2.3) * 0.25, f.cz + Math.cos(f.ph * 0.45) * 1.6);
    const w = Math.sin(f.ph * 22) * 0.9; f.wl.rotation.z = w; f.wr.rotation.z = -w; f.g.rotation.y = f.ph * 0.6;
  }
  if (fireflies.material.opacity > 0) {
    const arr = ffGeo.attributes.position.array;
    ffSeed.forEach((s, i) => arr.set([s[0] + Math.sin(t * 0.5 + s[3]) * 0.8, s[1] + Math.sin(t * 1.3 + s[3]) * 0.3, s[2] + Math.cos(t * 0.4 + s[3]) * 0.8], i * 3));
    ffGeo.attributes.position.needsUpdate = true;
  }
  water.material.color.setHSL(0.57, 0.55, 0.52 + Math.sin(t * 1.5) * 0.02);
  // cursor + prompt
  const [cx, cz] = targetTile();
  const pv = busy ? { ok: false, label: "" } : toolPreview(cx, cz);
  cursor.visible = !busy && inBounds(cx, cz) && (pv.ok || (S.field[key(cx, cz)] && S.tool !== 3));
  cursor.position.set(cx + 0.5, 0, cz + 0.5);
  curMat.color.set(pv.ok ? 0xf4a63a : 0xece6fa); curMat.opacity = pv.ok ? 0.95 : 0.35;
  const s = 1 + Math.sin(t * 6) * 0.03; cursor.scale.set(s, 1, s);
  if (!busy) {
    const it = nearestInteract();
    if (pv.ok) setPrompt("Space", pv.label); else if (it) setPrompt("E", it.label); else setPrompt();
  } else setPrompt();
  // camera
  const aspectBoost = camera.aspect < 0.8 ? 1.35 : 1;
  const dist = zoom * aspectBoost;
  camLook.lerp(new THREE.Vector3(clamp(P.x, 6, W - 6), 0.3, clamp(P.z, 5, H - 4)), Math.min(1, dt * 5));
  camPos.set(camLook.x, camLook.y + dist * 0.78, camLook.z + dist * 0.64);
  camera.position.lerp(camPos, Math.min(1, dt * 6)); camera.lookAt(camLook);
  sun.shadow.camera.updateProjectionMatrix();
  npcVisibility(); applyLight(); renderHUD(); updateMusic();
  if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) renderHint();
}
const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < H;

/* ============================================================ start-up */
function boot(fresh) {
  S = fresh || loadSave() || newGame();
  applySeason(); refreshField(); spawnAnimals(); refreshEggs(); renderHotbar(); selectTool(S.tool, true);
  P.x = 5.5; P.z = 7.5;
  camLook.set(P.x, 0.3, P.z); camera.position.set(P.x, 10, P.z + 8); hudSig = ""; renderHUD();
}
function startPlay() {
  PA.closeOverlay(); started = true; isBusyStart = false;
  for (const id of ["clock", "meters", "dock"]) $(id).hidden = false;
  renderHint(); updateMusic(true);
  PA.sayJP("おはよう！今日もがんばろう！", { pitch: 1.1 });
  PA.toast("Good morning! Let's get to work.");
}
if (PA.params.has("debug")) window.__farm = { get S() { return S; }, P, endDay, act, interact, selectTool, talk, openStore, openWorkshop, openShip, openBag, openJournal, feedAnimals, closeDialog, get dlg() { return dlg; } };
const loop = PA.loop((dt, t) => { step(dt, t); renderer.render(scene, camera); });

if (PA.THUMB) {
  // Staged golden-hour scene for gallery thumbnails.
  S = newGame(); S.season = 0; S.day = 5; S.min = 17.75 * 60;
  let i = 0;
  for (const [k, t] of Object.entries(S.field)) {
    const [x, z] = k.split(",").map(Number); t.obj = null;
    if (x >= 9 && x <= 17 && z >= 10 && z <= 14) {
      t.till = 1; t.wet = (x + z) % 3 ? 1 : 0;
      const types = ["turnip", "strawberry", "potato", "turnip"];
      t.crop = { t: types[(x + z) % 4], age: Math.max(0, Math.min(8, (x * 3 + z) % 9)), dead: false };
      if (z === 12) t.crop.age = CROPS[t.crop.t].days;
    } else if (rnd() < 0.2) t.obj = "weed";
    i++;
  }
  S.eggs = [{ x: 25.2, z: 7.2, gold: false }];
  applySeason(); refreshField(); spawnAnimals(); refreshEggs(); renderHotbar(); selectTool(1, true);
  P.x = 12.4; P.z = 11.0; P.fx = 0.3; P.fz = 1; started = true; zoom = 15.5;
  camLook.set(13.5, 0.3, 12.5); camera.position.set(13.5, 10, 20);
  for (const id of ["clock", "meters", "dock"]) $(id).hidden = true;
  setTimeout(() => (window.__ready = true), 2200);
} else {
  boot();
  const saved = loadSave();
  const keysHTML = controlsHTML();
  PA.overlay(`<span class="pa-eyebrow">Farming life sim</span><h1>Little Furrow</h1>
    <p>You've inherited a weedy acre at the edge of the valley. Grow crops through four seasons, raise hens and a cow, and get to know your neighbors.</p>${keysHTML}
    <div class="pa-actions">${saved ? `<button class="pa-btn" data-cont>Continue · ${SEASONS[saved.season]} ${saved.day}</button><button class="pa-btn ghost" data-new>New farm</button>` : `<button class="pa-btn" data-new>Start farming</button>`}</div>`,
    { "[data-cont]": () => { boot(); startPlay(); }, "[data-new]": () => { boot(newGame()); save(); startPlay(); } });
  addEventListener("pagehide", save);
  setInterval(() => started && !transitioning && save(), 30000);
}

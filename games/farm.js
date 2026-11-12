// Little Furrow — a cozy farming sim for Pixel Acre Arcade.
// Original game: till, plant, water, harvest, raise animals, chop wood, fish, befriend neighbors.
//
// The valley has four zones around a village square (layout: farm/layout.js): Home & Garden with a
// 15 × 15 field, a fenced Ranch (cows, hens, sheep), Whisper Woods (wood and stone that regrow) and
// Mirror Pond with a river (fishing). Grass, flowers, trees and fences are instanced and sway in a
// vertex-shader wind (farm/veg.js); crops are batched per look (farm/fx.js); animals run a small
// wander state machine (farm/wander.js); light and fog follow a day/night palette (farm/sky.js).
import * as THREE from "three";
import { PA } from "./common.js";
import { SEASONS, SEASON_COLORS, WEEKDAYS, DAYS_PER_SEASON, HOUR_SECONDS, DAY_START, PASS_OUT,
  CROPS, ITEMS, UPGRADES, NPCS, STORE_HOURS, GOALS, HINTS } from "./farm-data.js";
import { W, H, FIELD, HOUSE, SPAWN, RANCH, BARN, SILO, COOP, TROUGH, STORE, SHOP, BOARD, BIN, WELL, POND, DOCKS,
  LAMPS, SIGNS, PENS, FOREST, SOLID, zoneAt, buildMap, inRect } from "./farm/layout.js";
import { Vegetation, wind, windify } from "./farm/veg.js";
import { Batches, bakeGroup, Pops, Highlighter } from "./farm/fx.js";
import { createAnimal, stepAnimal, cheer } from "./farm/wander.js";
import { createRod, cast as castRod, stepRod, pull as pullRod, FISH } from "./farm/fishing.js";
import { skyAt } from "./farm/sky.js";
import { Particles } from "./rooftop/fx.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const $ = (id) => document.getElementById(id);
const SAVE_KEY = "farm:save:v2", OLD_SAVE_KEY = "farm:save:v1";
const inField = (x, z) => x >= FIELD.x0 && x <= FIELD.x1 && z >= FIELD.z0 && z <= FIELD.z1;
const key = (x, z) => x + "," + z;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const damp = (k, dt) => 1 - Math.exp(-k * dt);
let seedR = 7; const rnd = () => (seedR = (seedR * 16807) % 2147483647) / 2147483647;

/* ============================================================== map */
const MAP = buildMap();
const at = MAP.at;
const solidTile = (x, z) => {
  const c = at(x, z);
  if ((c === "t" || c === "r") && S && S.forest[key(x, z)]) return false; // chopped / broken
  return SOLID.has(c);
};

/* ================================================================== state */
let S = null;
function newGame() {
  const field = {};
  seedR = 99;
  for (let z = FIELD.z0; z <= FIELD.z1; z++) for (let x = FIELD.x0; x <= FIELD.x1; x++) {
    const r = rnd();
    field[key(x, z)] = { till: 0, wet: 0, crop: null, obj: r < 0.1 ? "stone" : r < 0.27 ? "weed" : null };
  }
  return {
    v: 2, day: 1, season: 0, year: 1, min: DAY_START, money: 500, energy: 100, maxEnergy: 100, water: 20,
    weather: "sun", tomorrow: "sun", tool: 0, seedSel: "turnip_seed",
    inv: { turnip_seed: 12, potato_seed: 4, fodder: 10, onigiri: 2 },
    can: 1, hoe: 1, upgrades: {}, field,
    animals: [
      { kind: "chicken", name: "Pudding", aff: 2, fed: false, petted: false },
      { kind: "chicken", name: "Biscuit", aff: 2, fed: false, petted: false },
      { kind: "cow", name: "Mochi", aff: 2, fed: false, petted: false, milkReady: false },
      { kind: "sheep", name: "Cotton", aff: 2, fed: false, petted: false, woolReady: false, woolDays: 0 },
    ],
    eggs: [], forest: {},
    friends: { mina: { pts: 0, talked: false, gifted: false }, tomo: { pts: 0, talked: false, gifted: false }, kenji: { pts: 0, talked: false, gifted: false } },
    goals: {}, stats: { tilled: 0, planted: 0, watered: 0, shipped: 0, eggs: 0, bestHearts: 0, earned: 0, upgrades: 0, bigHarvest: 0, wood: 0, fish: 0, wool: 0 },
    shippedToday: {}, earnedToday: 0, daysPlayed: 1,
  };
}
/** A v1 save (small 12 × 7 field, no woods, no sheep) moves into the bigger valley. */
function migrate(o) {
  const s = newGame();
  for (const k of ["day", "season", "year", "money", "energy", "maxEnergy", "water", "weather", "tomorrow", "seedSel", "inv", "can", "hoe", "upgrades", "friends", "goals", "shippedToday", "earnedToday", "daysPlayed"]) if (o[k] !== undefined) s[k] = o[k];
  s.stats = { ...s.stats, ...(o.stats || {}) };
  s.tool = clamp(o.tool | 0, 0, 3);
  if (Array.isArray(o.animals) && o.animals.length) s.animals = [...o.animals, s.animals.find((a) => a.kind === "sheep")];
  for (const [k, t] of Object.entries(o.field || {})) { // old field x 8–19, z 9–15 → top-left of the new field
    const [x, z] = k.split(",").map(Number), nk = key(FIELD.x0 + x - 8, FIELD.z0 + z - 9);
    if (s.field[nk]) s.field[nk] = t;
  }
  return s;
}
const save = () => { if (!PA.THUMB && S) PA.store.set(SAVE_KEY, S); };
const loadSave = () => {
  const s = PA.store.get(SAVE_KEY, null); if (s && s.v === 2) return s;
  const o = PA.store.get(OLD_SAVE_KEY, null); return o && o.v === 1 ? migrate(o) : null;
};

/* ============================================================== three setup */
const renderer = await PA.renderer(THREE, { clear: 0x9fd3ff });
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fd3ff, 30, 68);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 420);
const hemi = new THREE.HemisphereLight(0xcfe6ff, 0x5a4a32, 1.0); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, near: 1, far: 90 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
const particles = new Particles(scene, 900);
PA.onResize(() => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); particles.resize(); });

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
function shade(hex, f) { const c = new THREE.Color(hex); c.multiplyScalar(f); return "#" + c.getHexString(); }
const sph = (r) => geo("s" + r, () => new THREE.IcosahedronGeometry(r, 1));

/* ================================================================ sky dome */
// Gradient sky with procedural twinkling stars and a moon. Seen when zoomed all the way out (the camera
// tilts toward the horizon for a scenic view) — and the same stars shimmer in the pond at night.
const skyU = { horizon: { value: new THREE.Color() }, zenith: { value: new THREE.Color() }, stars: { value: 0 }, moonDir: { value: new THREE.Vector3(0, 1, 0) }, moon: { value: 0 }, time: { value: 0 } };
const STAR_GLSL = /* glsl */`
  float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
  float starField(vec2 uv, float t) {
    vec2 id = floor(uv), f = fract(uv) - 0.5; float r = hash21(id);
    if (r < 0.965) return 0.0;
    vec2 o = vec2(hash21(id + 7.1), hash21(id + 3.7)) - 0.5;
    float d = length(f - o * 0.6);
    float tw = 0.55 + 0.45 * sin(t * (1.5 + r * 3.0) + r * 60.0);
    return smoothstep(0.11, 0.0, d) * tw * (0.5 + (r - 0.965) * 18.0);
  }`;
const skyDome = new THREE.Mesh(new THREE.SphereGeometry(300, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: /* glsl */`varying vec3 vDir; void main() { vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w * 0.9999; }`,
  fragmentShader: /* glsl */`
    uniform vec3 horizon, zenith, moonDir; uniform float stars, moon, time; varying vec3 vDir;
    ${STAR_GLSL}
    void main() {
      vec3 d = normalize(vDir); float h = max(d.y, 0.0);
      vec3 col = mix(horizon, zenith, pow(h, 0.55));
      vec2 uv = vec2(atan(d.z, d.x) * 38.0, d.y * 60.0);
      col += vec3(0.95, 0.97, 1.0) * starField(uv, time) * stars * smoothstep(0.02, 0.2, d.y);
      float m = dot(d, moonDir);
      col += vec3(1.0, 0.97, 0.88) * smoothstep(0.99955, 0.9997, m) * moon + vec3(0.55, 0.6, 0.85) * pow(max(m, 0.0), 160.0) * 0.35 * moon;
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
}));
skyDome.renderOrder = -10; skyDome.frustumCulled = false; scene.add(skyDome);

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
  const [base, dark, light] = GRASS[season], snowy = season === 3;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const c = at(x, z), X = x * TILE_PX, Z = z * TILE_PX;
    let fill = base, specks = [dark, light];
    if (c === "p" || c === "D" || c === "g") { fill = snowy ? "#d9d4cf" : "#cdaa7a"; specks = [snowy ? "#c4bdb7" : "#b39060", "#dcbf92"]; }
    else if (c === "F") { fill = snowy ? "#cbbfb4" : "#94704c"; specks = [snowy ? "#b8aa9c" : "#7f5e3f", "#a7825b"]; }
    else if (c === "q" || c === "S" || c === "K" || c === "N" || c === "o") { fill = "#b9b1c9"; specks = ["#a59cba", "#c9c2d6"]; }
    else if (c === "y") { fill = snowy ? "#e6e2da" : "#e2cf98"; specks = ["#d4bf86", "#efdfb0"]; }
    else if (c === "w" || c === "k") { fill = "#3a6f8f"; specks = ["#33627f", "#43799a"]; }
    else if ("HBCbWRL".includes(c)) { fill = "#8a7a62"; specks = ["#7a6a52", "#9a8a72"]; }
    else if (inRect(FOREST, x, z) && !snowy) { fill = shade(base, 0.82); specks = [shade(dark, 0.78), "#7a8f4a"]; }
    g.fillStyle = fill; g.fillRect(X, Z, TILE_PX, TILE_PX);
    for (let i = 0; i < 14; i++) { g.fillStyle = specks[i & 1]; g.fillRect(X + Math.floor(rnd() * 15), Z + Math.floor(rnd() * 15), 2, 2); }
    if (c === "q") { g.fillStyle = "#9d94b0"; g.fillRect(X, Z, TILE_PX, 1); g.fillRect(X, Z, 1, TILE_PX); g.fillRect(X + 8, Z + 8, 8, 1); }
    if (c === "." && inRect(RANCH, x, z) && !snowy) { g.fillStyle = "#d9b45a"; for (let i = 0; i < 3; i++) g.fillRect(X + Math.floor(rnd() * 13), Z + Math.floor(rnd() * 15), 3, 1); }
    if (c === "." && inRect(FOREST, x, z) && rnd() < 0.25) { g.fillStyle = snowy ? "#cfd9e6" : "#8a6a3a"; g.fillRect(X + Math.floor(rnd() * 12), Z + Math.floor(rnd() * 12), 3, 2); } // fallen needles
  }
  // soft edges where paths meet grass
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (at(x, z) === "p") {
    g.fillStyle = snowy ? "#e3e0dc" : "#bfa171";
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (".Tt".includes(at(x + dx, z + dz))) {
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
const outer = mesh(new THREE.PlaneGeometry(400, 400), outerMat, W / 2, -0.02, H / 2, scene, false); outer.rotation.x = -Math.PI / 2;

/* ================================================================ vegetation */
const veg = new Vegetation(scene, {
  W, H, at, chop: MAP.chop, rocks: MAP.rocks,
  skip: (x, z) => inField(x, z) || (x === SPAWN.x | 0 && z === SPAWN.z | 0),
  dense: (x, z) => inRect(RANCH, x, z),
  woods: (x, z) => inRect(FOREST, x, z),
});
// distant hills
const hills = [[-34, -24, 26], [16, -40, 34], [70, -22, 28], [-38, 52, 30], [86, 40, 32], [30, 86, 36], [-30, 14, 22]].map(([x, z, r], i) => {
  const h = mesh(geo("hill", () => new THREE.IcosahedronGeometry(1, 1)), mat(i % 2 ? "#6aa35a" : "#5d9a54"), x, -r * 0.55, z, scene, false);
  h.scale.set(r, r * 0.7, r); return h;
});

/* ================================================================== water */
// Every water tile is one quad, merged into a single mesh. The shader ripples, foams along the shore
// (a per-vertex "shore" weight), glints in the sun and mirrors the twinkling stars at night.
const waterU = { time: { value: 0 }, deep: { value: new THREE.Color("#2a6a9a") }, shallow: { value: new THREE.Color("#4f9fc4") }, skyCol: { value: new THREE.Color() }, stars: { value: 0 }, glint: { value: 1 }, dim: { value: 1 } };
const water = (() => {
  const pos = [], shore = [], idx = [];
  const isW = (x, z) => { const c = at(x, z); return c === "w" || c === "k"; };
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (isW(x, z)) {
    const b = pos.length / 3;
    for (const [cx, cz] of [[x, z], [x + 1, z], [x, z + 1], [x + 1, z + 1]]) {
      pos.push(cx, 0, cz);
      let land = 0; for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (!isW(cx + ox, cz + oz)) land++;
      shore.push(land ? 1 : 0);
    }
    idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("shore", new THREE.Float32BufferAttribute(shore, 1)); g.setIndex(idx);
  const m = new THREE.ShaderMaterial({
    transparent: true, fog: true, uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {}]),
    vertexShader: /* glsl */`
      attribute float shore; varying float vShore; varying vec3 vW;
      #include <fog_pars_vertex>
      void main() { vShore = shore; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mvPosition = viewMatrix * w; gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      uniform float time, stars, glint, dim; uniform vec3 deep, shallow, skyCol; varying float vShore; varying vec3 vW;
      #include <fog_pars_fragment>
      ${STAR_GLSL}
      void main() {
        vec2 p = vW.xz;
        float w1 = sin(p.x * 1.7 + time * 1.3 + sin(p.y * 0.9 + time * 0.7) * 1.4);
        float w2 = sin(p.y * 2.3 - time * 1.1 + sin(p.x * 1.3) * 1.2);
        float rip = (w1 + w2) * 0.25 + 0.5;
        vec3 col = mix(deep, shallow, vShore * 0.75 + rip * 0.18);
        col = mix(col, skyCol, 0.14);
        float lines = smoothstep(0.95, 0.995, rip) * 0.12;
        float foam = smoothstep(0.55, 1.0, vShore) * (0.55 + 0.45 * sin(time * 2.0 + p.x * 3.1 + p.y * 2.7));
        col += vec3(lines + foam * 0.28) * (0.4 + glint * 0.6);
        col *= dim;
        col += vec3(0.95, 0.97, 1.0) * starField(p * 1.5 + vec2(rip * 0.3), time) * stars * 1.3;
        gl_FragColor = vec4(col, 0.9 - vShore * 0.15);
        #include <fog_fragment>
        #include <colorspace_fragment>
      }`,
  });
  Object.assign(m.uniforms, waterU);
  const o = new THREE.Mesh(g, m); o.position.y = 0.04; o.renderOrder = 1; scene.add(o); return o;
})();
const staticStart = scene.children.length; // everything from here to the lamps is static scenery (merged below)
// rocks along the pond shore
seedR = 5;
for (let i = 0; i < 40; i++) {
  const a = i / 40 * Math.PI * 2, x = POND.cx + Math.cos(a) * (POND.rx + 0.2), z = POND.cz + Math.sin(a) * (POND.rz + 0.2);
  if (at(Math.floor(x), Math.floor(z)) === "p" || (x > 15 && z > 38)) continue;
  const r = mesh(geo("rock", () => new THREE.DodecahedronGeometry(0.16, 0)), mat("#a9a3b8"), x, 0.06, z); r.scale.setScalar(0.7 + rnd() * 0.8);
}
for (const [x, z] of [[7.5, 35.2], [9.6, 38.4], [13.4, 37.6], [6.6, 37.8]]) { const p = mesh(geo("pad", () => new THREE.CircleGeometry(0.24, 8)), mat("#5aa45a"), x, 0.07, z, scene, false); p.rotation.x = -Math.PI / 2; }
// reeds
for (let i = 0; i < 26; i++) { const a = rnd() * Math.PI * 2, x = POND.cx + Math.cos(a) * (POND.rx - 0.4), z = POND.cz + Math.sin(a) * (POND.rz - 0.3); if (Math.abs(x - 11.5) < 1.2 && z < POND.cz) continue; const r = box(0.05, 0.5 + rnd() * 0.4, 0.05, "#6b8f3a", x, 0.25, z); r.rotation.z = (rnd() - 0.5) * 0.3; }
// docks: planks + posts
for (const [x, z] of DOCKS) {
  for (let i = 0; i < 4; i++) box(0.96, 0.06, 0.22, i % 2 ? "#a8743f" : "#b98450", x + 0.5, 0.16, z + 0.14 + i * 0.24);
  for (const [ox, oz] of [[0.08, 0.08], [0.92, 0.08], [0.08, 0.92], [0.92, 0.92]]) box(0.1, 0.5, 0.1, "#6b4430", x + ox, 0.05, z + oz);
}

/* ================================================================ buildings */
function gable(w, d, h, color, x, y, z, parent) {
  const shape = new THREE.Shape(); shape.moveTo(-w / 2 - 0.25, 0); shape.lineTo(w / 2 + 0.25, 0); shape.lineTo(0, h); shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: d + 0.4, bevelEnabled: false });
  return mesh(g, mat(color), x, y, z - d / 2 - 0.2, parent);
}
// House
const house = new THREE.Group(); scene.add(house);
box(5, 2.1, 4, "#f1e3c8", 5.5, 1.05, 4, house);
const houseRoof = gable(5, 4, 1.5, "#3f7f8f", 5.5, 2.1, 4, house);
box(0.5, 1.2, 0.5, "#9a6a52", 7, 3.1, 3.2, house);
box(0.8, 1.3, 0.1, "#6b4430", 5.5, 0.65, 6.03, house);
box(0.08, 0.08, 0.05, "#f4d35e", 5.75, 0.7, 6.1, house, { metalness: 0.6, roughness: 0.3 });
const windowMat = new THREE.MeshStandardMaterial({ color: "#ffe9a8", emissive: "#ffb347", emissiveIntensity: 0, flatShading: true });
[[4.0, 6.03], [7.0, 6.03]].forEach(([x, z]) => { mesh(geo("win", () => new THREE.BoxGeometry(0.8, 0.7, 0.06)), windowMat, x, 1.25, z, house); box(0.95, 0.1, 0.1, "#6b4430", x, 0.86, z + 0.04, house); });
for (let i = 0; i < 4; i++) box(0.16, 0.16, 0.16, ["#f27c8c", "#f4d35e", "#ffffff", "#b678d6"][i], 3.65 + i * 0.22, 0.95, 6.12, house);
box(1.6, 0.12, 1.1, "#a8743f", 5.5, 0.06, 6.5, house);
// Barn (cows) & silo
const barn = new THREE.Group(); scene.add(barn);
const BX = (BARN.x0 + BARN.x1 + 1) / 2, BZ = (BARN.z0 + BARN.z1 + 1) / 2;
box(6, 2.6, 4, "#b8483a", BX, 1.3, BZ, barn);
const barnRoof = gable(6, 4, 1.7, "#5a3a3a", BX, 2.6, BZ, barn);
box(2, 1.9, 0.08, "#8a3028", BX, 0.95, BZ + 2.04, barn);
for (const r of [0.75, -0.75]) { const b = box(2.6, 0.12, 0.05, "#f6efe2", BX, 0.95, BZ + 2.1, barn); b.rotation.z = r; }
box(2.1, 0.12, 0.06, "#f6efe2", BX, 1.92, BZ + 2.1, barn);
mesh(new THREE.CylinderGeometry(0.85, 0.85, 3.6, 10), mat("#c9c3d6"), SILO[0] + 0.5, 1.8, SILO[1] + 1, barn);
const siloTop = mesh(new THREE.SphereGeometry(0.85, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat("#5a3a3a"), SILO[0] + 0.5, 3.6, SILO[1] + 1, barn);
// Coop (hens)
const coop = new THREE.Group(); scene.add(coop);
const CX = (COOP.x0 + COOP.x1 + 1) / 2, CZ = (COOP.z0 + COOP.z1 + 1) / 2;
box(3.6, 1.5, 2.6, "#f4e1a6", CX, 0.85, CZ, coop);
for (const x of [-1.7, 1.7]) for (const z of [-1.2, 1.2]) box(0.16, 0.2, 0.16, "#6b4430", CX + x, 0.1, CZ + z, coop);
const coopRoof = gable(3.6, 2.6, 1.0, "#c4553f", CX, 1.6, CZ, coop);
box(0.6, 0.75, 0.06, "#8a5a2f", CX, 0.6, CZ + 1.32, coop);
const ramp = box(0.5, 0.05, 0.9, "#a8743f", CX, 0.28, CZ + 1.7, coop); ramp.rotation.x = 0.45;
mesh(geo("win", () => new THREE.BoxGeometry(0.8, 0.7, 0.06)), windowMat, CX + 1.1, 1.05, CZ + 1.31, coop);
// hay bales in the pasture
for (const [x, z, r] of [[34.2, 18.6, 0.3], [35.6, 18.9, -0.2], [50.2, 16.4, 1.2], [44.5, 20.2, 0.1]]) { const h = mesh(geo("bale", () => new THREE.CylinderGeometry(0.42, 0.42, 0.7, 10)), mat("#e6c35c"), x, 0.42, z); h.rotation.set(Math.PI / 2, r, 0); }
// shipping bin
const bin = new THREE.Group(); bin.position.set(BIN[0] + 0.5, 0, BIN[1] + 0.5); scene.add(bin);
box(0.9, 0.62, 0.8, "#a8743f", 0, 0.31, 0, bin);
const binLid = box(0.96, 0.08, 0.86, "#8a5a2f", 0, 0.66, 0, bin);
box(0.5, 0.22, 0.03, "#f6efe2", 0, 0.35, 0.42, bin);
// well
const well = new THREE.Group(); well.position.set(WELL[0] + 0.5, 0, WELL[1] + 0.5); scene.add(well);
mesh(new THREE.CylinderGeometry(0.42, 0.46, 0.6, 9), mat("#a9a3b8"), 0, 0.3, 0, well);
mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.02, 9), mat("#2f5f9a", { roughness: 0.2 }), 0, 0.55, 0, well);
box(0.07, 1.1, 0.07, "#6b4430", -0.38, 0.85, 0, well); box(0.07, 1.1, 0.07, "#6b4430", 0.38, 0.85, 0, well);
const wr = mesh(new THREE.ConeGeometry(0.62, 0.42, 4), mat("#c4553f"), 0, 1.55, 0, well); wr.rotation.y = Math.PI / 4;
box(0.2, 0.18, 0.2, "#8a5a2f", 0.1, 0.95, 0, well);
// trough
const trough = new THREE.Group(); trough.position.set(TROUGH.x0 + 1, 0, TROUGH.z0 + 0.5); scene.add(trough);
box(1.9, 0.35, 0.55, "#8a5a2f", 0, 0.18, 0, trough);
const hay = box(1.76, 0.08, 0.42, "#e6c35c", 0, 0.32, 0, trough); hay.visible = false;
// Tomo's stool on the pond's east shore
const TOMO = { x: 17.55, z: 34.6 };
box(0.4, 0.3, 0.4, "#8a5a2f", TOMO.x, 0.15, TOMO.z);
// store stall
function stripeTexture(a, b) {
  const c = document.createElement("canvas"); c.width = 64; c.height = 8; const g = c.getContext("2d");
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? b : a; g.fillRect(i * 8, 0, 8, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
function signTexture(text, bg, fg, w = 256) {
  const c = document.createElement("canvas"); c.width = w; c.height = 64; const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, 64); g.fillStyle = fg; g.font = "bold 30px 'Dela Gothic One', 'Arial Black', sans-serif";
  g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const stall = new THREE.Group(); stall.position.set((STORE.x0 + STORE.x1 + 1) / 2, 0, STORE.z0 + 0.5); scene.add(stall);
box(2.8, 0.9, 0.7, "#c98d4a", 0, 0.45, -0.05, stall);
for (let i = 0; i < 6; i++) box(0.36, 0.2, 0.36, ["#e8414f", "#f6cf3c", "#7fbf5a", "#ef8a2b", "#b678d6", "#f3e9f7"][i], -1.05 + i * 0.42, 1.0, -0.1, stall);
for (const x of [-1.35, 1.35]) box(0.09, 2.0, 0.09, "#6b4430", x, 1.0, 0.3, stall);
const awn = mesh(new THREE.BoxGeometry(3.1, 0.06, 1.2), new THREE.MeshStandardMaterial({ map: stripeTexture("#f27c8c", "#fff4e6"), flatShading: true }), 0, 2.0, 0.15, stall);
awn.rotation.x = 0.25;
mesh(new THREE.PlaneGeometry(1.6, 0.4), new THREE.MeshStandardMaterial({ map: signTexture("MINA'S STORE", "#2a2147", "#f4a63a") }), 0, 2.35, 0.65, stall, false);
const closedSign = mesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshStandardMaterial({ map: signTexture("CLOSED", "#f27c8c", "#2a1606") }), 0, 0.6, 0.31, stall, false);
// Kenji's workbench (south edge of the square, facing north)
const bench = new THREE.Group(); bench.position.set(SHOP.x1 + 0.5, 0, SHOP.z0 + 0.5); bench.rotation.y = Math.PI; scene.add(bench);
box(1.9, 0.12, 0.8, "#c98d4a", 0, 0.75, 0, bench);
for (const [x, z] of [[-0.85, -0.3], [0.85, -0.3], [-0.85, 0.3], [0.85, 0.3]]) box(0.1, 0.75, 0.1, "#8a5a2f", x, 0.37, z, bench);
box(0.9, 0.08, 0.22, "#e3c08a", -0.3, 0.85, 0.1, bench); box(0.25, 0.25, 0.25, "#7a7f8f", 0.6, 0.94, -0.1, bench);
mesh(new THREE.PlaneGeometry(1.4, 0.35), new THREE.MeshStandardMaterial({ map: signTexture("KENJI TOOLS", "#3f8f6a", "#fff4e6") }), 0, 1.45, -0.42, bench, false).rotation.y = Math.PI;
box(0.06, 0.6, 0.06, "#6b4430", -0.6, 1.1, -0.42, bench); box(0.06, 0.6, 0.06, "#6b4430", 0.6, 1.1, -0.42, bench);
const closedSign2 = mesh(new THREE.PlaneGeometry(0.7, 0.26), new THREE.MeshStandardMaterial({ map: signTexture("CLOSED", "#f27c8c", "#2a1606") }), 0, 0.5, -0.42, bench, false); closedSign2.rotation.y = Math.PI;
// square benches + planters
for (const x of [23.5, 25.6]) { const g = new THREE.Group(); g.position.set(x, 0, 29.6); g.rotation.y = Math.PI; scene.add(g); box(0.9, 0.08, 0.36, "#c98d4a", 0, 0.4, 0, g); box(0.9, 0.3, 0.06, "#c98d4a", 0, 0.6, -0.16, g); box(0.08, 0.4, 0.3, "#6b4430", -0.38, 0.2, 0, g); box(0.08, 0.4, 0.3, "#6b4430", 0.38, 0.2, 0, g); }
for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (at(x, z) === "o") { box(0.6, 0.4, 0.6, "#a9a3b8", x + 0.5, 0.2, z + 0.5); for (let i = 0; i < 3; i++) box(0.14, 0.14, 0.14, ["#f27c8c", "#f4d35e", "#b678d6"][i], x + 0.35 + i * 0.15, 0.48, z + 0.5); }
// notice board
const board = new THREE.Group(); board.position.set(BOARD[0] + 0.5, 0, BOARD[1] + 0.5); scene.add(board);
box(0.08, 1.4, 0.08, "#6b4430", -0.45, 0.7, 0, board); box(0.08, 1.4, 0.08, "#6b4430", 0.45, 0.7, 0, board);
box(1.1, 0.75, 0.08, "#c98d4a", 0, 1.05, 0.02, board);
for (let i = 0; i < 3; i++) box(0.24, 0.3, 0.02, "#fff4e6", -0.32 + i * 0.32, 1.05 + (i % 2) * 0.1, 0.08, board);
// signposts at the zone entrances
for (const s of SIGNS) {
  const g = new THREE.Group(); g.position.set(s.x + 0.5, 0, s.z + 0.5); g.rotation.y = s.face; scene.add(g);
  box(0.08, 1.1, 0.08, "#6b4430", 0, 0.55, 0, g);
  const p = mesh(new THREE.BoxGeometry(0.95, 0.3, 0.05), [mat("#c98d4a"), mat("#c98d4a"), mat("#c98d4a"), mat("#c98d4a"), new THREE.MeshStandardMaterial({ map: signTexture(s.text, "#c98d4a", "#3a2412") }), mat("#c98d4a")], 0, 0.95, 0.05, g);
  p.castShadow = true;
}
// lamps with night lights
const lampMat = new THREE.MeshStandardMaterial({ color: "#ffe9a8", emissive: "#ffb347", emissiveIntensity: 0, flatShading: true });
for (const [x, z] of LAMPS) {
  box(0.1, 1.6, 0.1, "#3a2f5e", x + 0.5, 0.8, z + 0.5);
  mesh(geo("lamp", () => new THREE.BoxGeometry(0.28, 0.32, 0.28)), lampMat, x + 0.5, 1.75, z + 0.5);
  box(0.36, 0.06, 0.36, "#3a2f5e", x + 0.5, 1.94, z + 0.5);
}
// Warm light sources at night. Only three PointLights exist (a fixed count keeps one shader variant);
// each frame they sit on the three sources nearest the view.
const LIGHT_SPOTS = [[5.5, 1.6, 7.2], [26, 2.2, 27], [BX, 2.0, BZ + 2.8], [12.5, 1.9, 29], [CX, 1.6, CZ + 2.2], ...LAMPS.map(([x, z]) => [x + 0.5, 1.9, z + 0.5])];
const lampLights = [0, 1, 2].map(() => { const l = new THREE.PointLight(0xffb85c, 0, 9, 1.4); scene.add(l); return l; });

/* ===================================================== merge static props */
// Each little box above is its own mesh; merging all static ones that share a material leaves one draw
// call per material (≈200 → ≈40 calls with shadows). Things that move or swap material stay separate.
(function mergeStatic() {
  const keep = new Set([binLid, hay, closedSign, closedSign2, houseRoof, barnRoof, coopRoof, siloTop]);
  const groups = new Map();
  for (const root of scene.children.slice(staticStart)) {
    root.updateMatrixWorld(true);
    root.traverse((m) => {
      if (!m.isMesh || m.isInstancedMesh || keep.has(m) || Array.isArray(m.material)) return;
      const k = m.material.uuid + (m.castShadow ? ":s" : "");
      if (!groups.has(k)) groups.set(k, { material: m.material, shadow: m.castShadow, parts: [] });
      groups.get(k).parts.push(m);
    });
  }
  for (const { material, shadow, parts } of groups.values()) {
    if (parts.length < 2) continue;
    const geos = parts.map((m) => {
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      for (const a of Object.keys(g.attributes)) if (a !== "position" && a !== "normal" && a !== "uv") g.deleteAttribute(a);
      g.morphAttributes = {}; g.clearGroups();
      return g.applyMatrix4(m.matrixWorld);
    });
    const merged = mergeGeometries(geos); if (!merged) continue;
    const o = new THREE.Mesh(merged, material); o.castShadow = shadow; o.receiveShadow = true; scene.add(o);
    for (const m of parts) m.removeFromParent();
  }
})();

/* ================================================================== field */
const furrowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 16; const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, 16, 16);
  g.fillStyle = "#c9c9c9"; for (let i = 0; i < 4; i++) g.fillRect(0, 2 + i * 4, 16, 1);
  g.fillStyle = "#e6e6e6"; for (let i = 0; i < 18; i++) g.fillRect((i * 7) % 16, (i * 5) % 16, 1, 1);
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const soilGeo = new THREE.BoxGeometry(0.94, 0.06, 0.94).translate(0, 0.03, 0);
const soilMats = { dry: new THREE.MeshStandardMaterial({ color: "#8c5a3a", map: furrowTex, roughness: 1 }), wet: new THREE.MeshStandardMaterial({ color: "#563626", map: furrowTex, roughness: 0.55 }) };
const NTILES = (FIELD.x1 - FIELD.x0 + 1) * (FIELD.z1 - FIELD.z0 + 1);
const soil = new Batches(scene, (sig) => ({ geometry: soilGeo, material: soilMats[sig], shadow: false }), NTILES);
const cropMat = windify(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.85 }), 0.8, 0.035);
const leafGeo = new THREE.ConeGeometry(0.07, 0.26, 4);
function addLeaves(g, n, color, h = 0.26, spread = 0.1, tilt = 0.5) {
  for (let i = 0; i < n; i++) {
    const l = mesh(leafGeo, mat(color), 0, h / 2, 0, g);
    const a = i / n * Math.PI * 2; l.position.set(Math.cos(a) * spread, h * 0.45, Math.sin(a) * spread);
    l.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt); l.scale.y = h / 0.26;
  }
}
const stageOf = (crop) => { if (crop.dead) return "dead"; const p = crop.age / CROPS[crop.t].days; return crop.age === 0 ? "seed" : p < 0.45 ? "sprout" : p < 1 ? "grow" : "ripe"; };
function buildCrop(g, t, stage) {
  const c = CROPS[t];
  if (stage === "dead") { const s = mesh(geo("dead", () => new THREE.ConeGeometry(0.05, 0.3, 4)), mat("#7a5a3a"), 0, 0.12, 0, g); s.rotation.z = 0.6; return; }
  if (stage === "seed") { for (let i = 0; i < 3; i++) mesh(sph(0.035), mat("#5a3a24"), (i - 1) * 0.16, 0.02, ((i * 7) % 3 - 1) * 0.1, g, false); return; }
  if (stage === "sprout") { addLeaves(g, 2, "#8fd17a", 0.16, 0.03, 0.7); return; }
  if (stage === "grow") {
    if (c.shape === "tall") { mesh(geo("stalk", () => new THREE.CylinderGeometry(0.025, 0.03, 0.5, 5)), mat(c.leaf), 0, 0.25, 0, g); addLeaves(g, 4, c.leaf, 0.24, 0.06, 0.9); }
    else addLeaves(g, 5, c.leaf, 0.26, 0.08, 0.7);
    return;
  }
  const fruit = mat(c.fruit);
  if (c.shape === "root") {
    addLeaves(g, 5, c.leaf, 0.32, 0.06, 0.55);
    const r = mesh(sph(0.15), fruit, 0, 0.06, 0, g); r.scale.set(1, 0.85, 1);
    if (c.top !== c.fruit) { const tp = mesh(sph(0.1), mat(c.top), 0, 0.12, 0, g); tp.scale.set(1.2, 0.6, 1.2); }
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
function buildObj(g, obj) {
  if (obj === "stone") { const s = mesh(geo("stone", () => new THREE.DodecahedronGeometry(0.22, 0)), mat("#9a94aa"), 0, 0.12, 0, g); s.scale.set(1, 0.7, 1); }
  if (obj === "weed") for (let i = 0; i < 4; i++) { const w = mesh(leafGeo, mat("#4f8f3a"), Math.cos(i * 1.7) * 0.1, 0.1, Math.sin(i * 1.7) * 0.1, g); w.rotation.set(Math.sin(i) * 0.6, 0, Math.cos(i) * 0.6); }
}
// one InstancedMesh per look ("turnip:grow", "stone", …), built on first use from a baked little group
const crops = new Batches(scene, (sig) => {
  const g = new THREE.Group(), [a, b] = sig.split(":");
  if (b) buildCrop(g, a, b); else buildObj(g, a);
  return { geometry: bakeGroup(g).translate(0, 0.06, 0), material: cropMat };
}, NTILES);
const tileRot = (x, z) => ((x * 7 + z * 13) % 8) * 0.785;
function refreshTile(x, z, pop = false) {
  const k = key(x, z), t = S.field[k];
  soil.set(k, t.till ? (t.wet ? "wet" : "dry") : null, x + 0.5, z + 0.5);
  crops.set(k, t.crop ? `${t.crop.t}:${stageOf(t.crop)}` : t.obj, x + 0.5, z + 0.5, tileRot(x, z));
  if (pop) crops.bounce(k);
}
const refreshField = () => { for (const k in S.field) { const [x, z] = k.split(",").map(Number); refreshTile(x, z); } };
const refreshForest = () => {
  for (const [x, z] of MAP.chop) veg.setChopped(key(x, z), !!S.forest[key(x, z)]);
  for (const [x, z] of MAP.rocks) veg.setBroken(key(x, z), !!S.forest[key(x, z)]);
};

/* ============================================================ characters */
function makeFolk(o) {
  const g = new THREE.Group();
  const P = {};
  const skin = mat(o.skin || "#f2c9a0");
  P.legL = new THREE.Group(); P.legR = new THREE.Group();
  for (const [leg, x] of [[P.legL, -0.08], [P.legR, 0.08]]) { leg.position.set(x, 0.3, 0); g.add(leg); box(0.11, 0.28, 0.13, o.pants || "#3f6fb5", 0, -0.14, 0, leg); box(0.12, 0.06, 0.17, "#4a3426", 0, -0.27, 0.02, leg); }
  P.torso = new THREE.Group(); P.torso.position.y = 0.3; g.add(P.torso); // bends at the hips
  P.body = box(0.32, 0.32, 0.22, o.shirt, 0, 0.15, 0, P.torso);
  if (o.overalls) { box(0.33, 0.2, 0.23, o.overalls, 0, 0.08, 0, P.torso); box(0.05, 0.16, 0.235, o.overalls, -0.09, 0.25, 0, P.torso); box(0.05, 0.16, 0.235, o.overalls, 0.09, 0.25, 0, P.torso); }
  if (o.apron) box(0.26, 0.3, 0.02, o.apron, 0, 0.13, 0.12, P.torso);
  P.armL = new THREE.Group(); P.armR = new THREE.Group();
  for (const [arm, x] of [[P.armL, -0.21], [P.armR, 0.21]]) { arm.position.set(x, 0.29, 0); P.torso.add(arm); box(0.09, 0.28, 0.1, o.shirt, 0, -0.13, 0, arm); mesh(sph(0.05), skin, 0, -0.29, 0, arm); }
  P.head = new THREE.Group(); P.head.position.set(0, 0.52, 0); P.torso.add(P.head);
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
// player: root (position + slerped facing) → folk (squash & stretch, lean)
const player = makeFolk({ shirt: "#fff4e6", overalls: "#3f6fb5", pants: "#3f6fb5", hair: "#5a3324", hat: "sun" });
const playerRoot = new THREE.Group(); playerRoot.add(player.g); scene.add(playerRoot);
const rodTip = new THREE.Object3D();
const toolMeshes = {
  0: (() => { const g = new THREE.Group(); box(0.03, 0.5, 0.03, "#8a5a2f", 0, 0, 0.1, g).rotation.x = 1.2; box(0.12, 0.03, 0.12, "#a9a3b8", 0, -0.08, 0.32, g); return g; })(),
  1: (() => { const g = new THREE.Group(); mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.14, 8), mat("#7fb3d9", { metalness: 0.4, roughness: 0.4 }), 0, -0.04, 0.06, g); const s = box(0.03, 0.03, 0.16, "#7fb3d9", 0, 0, 0.18, g); s.rotation.x = -0.5; return g; })(),
  2: (() => { const g = new THREE.Group(); mesh(sph(0.08), mat("#e3c08a"), 0, -0.04, 0.05, g); return g; })(),
  3: new THREE.Group(),
  4: (() => { const g = new THREE.Group(); box(0.035, 0.5, 0.035, "#8a5a2f", 0, 0, 0.1, g).rotation.x = 1.2; const h = box(0.04, 0.16, 0.2, "#c9c3d6", 0, -0.02, 0.32, g); h.rotation.x = 1.2; return g; })(),
  5: (() => { const g = new THREE.Group(); const r = box(0.025, 1.3, 0.025, "#c98d4a", 0, 0, 0.55, g); r.rotation.x = 1.25; rodTip.position.set(0, 0.06, 1.18); g.add(rodTip); return g; })(),
};
Object.values(toolMeshes).forEach((m) => { player.P.tool.add(m); m.visible = false; });
const P = { x: SPAWN.x, z: SPAWN.z, vx: 0, vz: 0, fx: 0, fz: 1, walk: 0, act: 0, actDur: 0.42, actKind: "", impact: null, impactAt: 0.5, target: null, pending: null, stuck: 0, sq: 0, sqv: 0, lean: 0, speed: 0, zone: "" };
const qFace = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0);
// fishing line + bobber
const rod = createRod();
const bobber = new THREE.Group(); scene.add(bobber); bobber.visible = false;
mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat("#f2607e"), 0, 0, 0, bobber);
mesh(new THREE.SphereGeometry(0.07, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), mat("#ffffff"), 0, 0, 0, bobber);
const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 12), 3));
const fishLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xf6f1e7, transparent: true, opacity: 0.8 })); fishLine.frustumCulled = false; fishLine.visible = false; scene.add(fishLine);
const fishing = { from: new THREE.Vector3(), to: new THREE.Vector3(), spot: "pond", dip: 0, tug: 0 };

// neighbors
const npcs = {};
const NPC_SPOTS = { mina: [(STORE.x0 + STORE.x1 + 1) / 2, STORE.z0 + 1.55, 0], tomo: [TOMO.x, TOMO.z, -Math.PI / 2 - 0.3], kenji: [SHOP.x0 - 0.5, SHOP.z0 + 0.35, Math.PI / 2] };
const folkStyle = {
  mina: { shirt: "#f27c8c", apron: "#fff4e6", hair: "#5a2e2a", bun: true, pants: "#3a2f5e" },
  tomo: { shirt: "#4f6d8f", hair: "#e8e8e8", beard: "#e8e8e8", pants: "#5a4a3a", hat: "cap", capColor: "#c98d4a" },
  kenji: { shirt: "#3f8f6a", hair: "#2b1f1a", band: "#f4a63a", pants: "#4a3f6a", overalls: "#6b4430" },
};
for (const id of Object.keys(NPCS)) {
  const f = makeFolk(folkStyle[id]); const [x, z, r] = NPC_SPOTS[id];
  f.g.position.set(x, 0, z); f.g.rotation.y = r; f.home = { x, z, r }; scene.add(f.g);
  if (id === "tomo") { // sits on his stool with a rod out over the pond
    f.g.position.y = 0.1; f.P.legL.rotation.x = f.P.legR.rotation.x = -1.3;
    const r2 = box(0.025, 1.4, 0.025, "#8a5a2f", 0, -0.3, 0.6, f.P.armR); r2.rotation.x = 1.15; f.P.armR.rotation.x = -0.9;
  }
  npcs[id] = f;
}

/* ================================================================ animals */
const animals = []; // runtime { d (save data), w (wander state), g, head, body, kind }
function makeChicken() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const b = mesh(sph(0.16), mat("#fffaf0"), 0, 0.2, 0, body); b.scale.set(1, 0.9, 1.25);
  const head = new THREE.Group(); head.position.set(0, 0.34, 0.13); body.add(head);
  mesh(sph(0.09), mat("#fffaf0"), 0, 0.02, 0, head);
  box(0.03, 0.07, 0.08, "#e8414f", 0, 0.11, 0, head);
  const beak = mesh(geo("beak", () => new THREE.ConeGeometry(0.03, 0.07, 4)), mat("#f4a63a"), 0, 0.01, 0.1, head); beak.rotation.x = Math.PI / 2;
  for (const x of [-0.05, 0.05]) box(0.02, 0.02, 0.01, "#1d1530", x, 0.04, 0.085, head);
  const tail = mesh(geo("tail", () => new THREE.ConeGeometry(0.08, 0.16, 4)), mat("#fffaf0"), 0, 0.28, -0.2, body); tail.rotation.x = -0.9;
  const legs = []; for (const x of [-0.05, 0.05]) legs.push(box(0.02, 0.1, 0.02, "#f4a63a", x, 0.05, 0, g));
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return { g, head, body, legs, headY: 0.55 };
}
function makeCow() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const spotTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 32; const x = c.getContext("2d"); x.fillStyle = "#fbf8f2"; x.fillRect(0, 0, 32, 32); x.fillStyle = "#2b2430"; [[4, 6, 9], [20, 4, 7], [14, 20, 8], [26, 22, 5]].forEach(([a, b, r]) => { x.beginPath(); x.ellipse(a, b, r, r * 0.7, 0.4, 0, 7); x.fill(); }); const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace; return t; })();
  mesh(new THREE.BoxGeometry(0.5, 0.42, 0.85), new THREE.MeshStandardMaterial({ map: spotTex, flatShading: true }), 0, 0.5, 0, body);
  const legs = []; for (const [x, z] of [[-0.17, 0.3], [0.17, 0.3], [-0.17, -0.3], [0.17, -0.3]]) legs.push(box(0.1, 0.3, 0.1, "#fbf8f2", x, 0.15, z, g));
  const head = new THREE.Group(); head.position.set(0, 0.62, 0.48); body.add(head);
  box(0.32, 0.3, 0.3, "#fbf8f2", 0, 0.06, 0.04, head); box(0.3, 0.14, 0.1, "#f2a7b8", 0, -0.02, 0.21, head);
  for (const x of [-0.08, 0.08]) box(0.04, 0.05, 0.02, "#1d1530", x, 0.11, 0.195, head);
  for (const s of [-1, 1]) { box(0.06, 0.1, 0.06, "#e9dcc0", s * 0.12, 0.25, 0.04, head); box(0.12, 0.05, 0.08, "#2b2430", s * 0.21, 0.12, 0.02, head); }
  box(0.08, 0.08, 0.08, "#f4d35e", 0, -0.14, 0.14, head);
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return { g, head, body, legs, headY: 1.0 };
}
function makeSheep() {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
  const wool = mat("#f6f1e7"), woolD = mat("#e6dfcf");
  for (const [x, y, z, r] of [[0, 0.46, 0, 0.3], [0.14, 0.5, 0.18, 0.2], [-0.14, 0.5, 0.18, 0.2], [0.14, 0.5, -0.18, 0.2], [-0.14, 0.5, -0.18, 0.2], [0, 0.62, 0, 0.2], [0, 0.45, -0.3, 0.17]]) mesh(sph(r), r > 0.25 ? wool : woolD, x, y, z, body);
  const head = new THREE.Group(); head.position.set(0, 0.56, 0.36); body.add(head);
  const face = mesh(sph(0.13), mat("#3a3240"), 0, 0, 0.05, head); face.scale.set(0.9, 1, 1.15);
  mesh(sph(0.11), wool, 0, 0.1, -0.02, head);
  for (const s of [-1, 1]) { const e = box(0.12, 0.04, 0.06, "#3a3240", s * 0.13, 0.02, 0, head); e.rotation.z = s * 0.4; box(0.03, 0.03, 0.02, "#ffffff", s * 0.05, 0.03, 0.17, head); }
  const legs = []; for (const [x, z] of [[-0.12, 0.17], [0.12, 0.17], [-0.12, -0.17], [0.12, -0.17]]) legs.push(box(0.07, 0.3, 0.07, "#3a3240", x, 0.15, z, g));
  g.traverse((m) => m.isMesh && (m.castShadow = true));
  return { g, head, body, legs, headY: 0.95 };
}
const MAKERS = { chicken: makeChicken, cow: makeCow, sheep: makeSheep };
function penSpot(kind) { const p = PENS[kind]; for (let i = 0; i < 20; i++) { const x = p.x0 + 0.5 + Math.random() * (p.x1 - p.x0), z = p.z0 + 0.5 + Math.random() * (p.z1 - p.z0); if (!solidTile(Math.floor(x), Math.floor(z))) return [x, z]; } return [(p.x0 + p.x1) / 2, (p.z0 + p.z1) / 2]; }
function spawnAnimals() {
  for (const a of animals) scene.remove(a.g);
  animals.length = 0;
  for (const d of S.animals) {
    const m = MAKERS[d.kind](); scene.add(m.g);
    const [x, z] = penSpot(d.kind);
    animals.push({ d, kind: d.kind, w: createAnimal(d.kind, x, z), ...m });
  }
}
// eggs on the ground near the coop
const eggMeshes = [];
function refreshEggs() {
  for (const m of eggMeshes) scene.remove(m); eggMeshes.length = 0;
  for (const e of S.eggs) { const m = mesh(sph(0.08), mat(e.gold ? "#f6cf3c" : "#fff4e0", e.gold ? { metalness: 0.5, roughness: 0.3 } : {}), e.x, 0.08, e.z); m.scale.set(1, 1.3, 1); eggMeshes.push(m); }
}
function eggSpot() { return [COOP.x0 - 1 + Math.random() * (COOP.x1 - COOP.x0 + 4), COOP.z1 + 1.6 + Math.random() * 2.2]; }

/* ============================================================ feedback */
const pops = new Pops(scene, 28);
const highlight = new Highlighter(scene, 3);
const later = []; // [t, fn] — visual effects timed to a swing's impact
const after = (t, fn) => later.push([t, fn]);
const C = (h) => new THREE.Color(h);
const COL = { soil: C("#7a4a2a"), soilL: C("#a8784e"), dust: C("#e8d6b0"), water: C("#8fd0ff"), waterW: C("#e6f6ff"), leaf: C("#6dbd62"), chip: C("#d9a86a"), stone: C("#b0aac0"), seed: C("#e3c08a"), weed: C("#4f8f3a"), white: C("#ffffff"), gold: C("#f6cf3c") };
function burst(x, y, z, color, n = 8, sp = 1.6, up = 2.2, size = 0.32) {
  const c = typeof color === "string" ? C(color) : color;
  for (let i = 0; i < n; i++) particles.emit({ x: x + (Math.random() - 0.5) * 0.2, y, z: z + (Math.random() - 0.5) * 0.2, vx: (Math.random() - 0.5) * sp, vy: up * (0.5 + Math.random() * 0.6), vz: (Math.random() - 0.5) * sp, life: 0.5 + Math.random() * 0.35, size: size * (0.7 + Math.random() * 0.6), color: c, drag: 1.2, gravity: 9 });
}
function puff(x, z, n = 3, color = COL.dust, size = 0.5) {
  for (let i = 0; i < n; i++) particles.emit({ x: x + (Math.random() - 0.5) * 0.25, y: 0.08, z: z + (Math.random() - 0.5) * 0.25, vx: (Math.random() - 0.5) * 0.6, vy: 0.35 + Math.random() * 0.3, vz: (Math.random() - 0.5) * 0.6, life: 0.55, size, color, alpha: 0.55, drag: 3, grow: 0.9 });
}
/** Water arcing from the can's spout onto a tile over ~0.3 s. */
function pour(tx, tz) {
  for (let i = 0; i < 16; i++) after(i * 0.02, () => {
    const sx = P.x + P.fx * 0.45, sz = P.z + P.fz * 0.45, dx = tx - sx, dz = tz - sz;
    particles.emit({ x: sx, y: 0.75, z: sz, vx: dx * 2.2 + (Math.random() - 0.5) * 0.4, vy: 0.6 + Math.random() * 0.5, vz: dz * 2.2 + (Math.random() - 0.5) * 0.4, life: 0.42, size: 0.22, color: Math.random() < 0.3 ? COL.waterW : COL.water, alpha: 0.9, drag: 0.5, gravity: 9 });
  });
  after(0.34, () => { burst(tx, 0.1, tz, COL.water, 7, 1.2, 1.2, 0.2); puff(tx, tz, 2, COL.waterW, 0.4); });
}
/** Squash & stretch impulse (+ stretches tall, − squashes). */
const kick = (v) => { P.sqv += v; };
// rain / snow
const RAIN_N = 700;
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIN_N * 6), 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xbcd4ff, transparent: true, opacity: 0.55 })); rain.frustumCulled = false; scene.add(rain);
const SNOW_N = 600;
const snowGeo = new THREE.BufferGeometry(); snowGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(SNOW_N * 3), 3));
const snow = new THREE.Points(snowGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, transparent: true, opacity: 0.9 })); snow.frustumCulled = false; scene.add(snow);
const drops = Array.from({ length: Math.max(RAIN_N, SNOW_N) }, () => [Math.random() * 30 - 15, Math.random() * 12, Math.random() * 26 - 13, Math.random() * 6]);
// butterflies (day, around the garden) / fireflies (night, pond + woods edge)
const flutter = [];
for (let i = 0; i < 9; i++) {
  const g = new THREE.Group(); const c = ["#f4d35e", "#ffffff", "#f2a7c3"][i % 3];
  const wl = box(0.1, 0.01, 0.08, c, -0.05, 0, 0, g), wr = box(0.1, 0.01, 0.08, c, 0.05, 0, 0, g);
  const cx = i < 6 ? FIELD.x0 + Math.random() * 15 : 2 + Math.random() * 14, cz = i < 6 ? FIELD.z0 + Math.random() * 15 : 26 + Math.random() * 4;
  g.position.set(cx, 0.8, cz); scene.add(g); flutter.push({ g, wl, wr, ph: Math.random() * 9, cx, cz });
}
const FF_N = 70;
const ffGeo = new THREE.BufferGeometry(); ffGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FF_N * 3), 3));
const fireflies = new THREE.Points(ffGeo, new THREE.PointsMaterial({ color: 0xd8ff7a, size: 0.13, transparent: true, opacity: 0, depthWrite: false })); fireflies.frustumCulled = false; scene.add(fireflies);
const ffSeed = Array.from({ length: FF_N }, (_, i) => i < 40 ? [POND.cx + (Math.random() - 0.5) * 18, 0.4 + Math.random() * 1.2, POND.cz + (Math.random() - 0.5) * 12, Math.random() * 9] : [FOREST.x0 + Math.random() * 20, 0.4 + Math.random() * 1.4, FOREST.z0 + Math.random() * 18, Math.random() * 9]);

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
  } else if (it.kind === "fish") {
    disc(g, 7, 8.5, 5.5, 3.6, shade(it.color, 0.55)); disc(g, 7, 8.5, 4.6, 2.8, it.color); disc(g, 6, 10, 3.5, 1.2, shade(it.color, 1.2));
    g.fillStyle = it.accent; g.beginPath(); g.moveTo(11, 8.5); g.lineTo(15.5, 4.5); g.lineTo(15.5, 12.5); g.closePath(); g.fill(); g.fillRect(6, 4, 3, 2);
    g.fillStyle = "#1d1530"; g.fillRect(3, 7, 2, 2); g.fillStyle = "#ffffff"; g.fillRect(3, 7, 1, 1);
  } else if (id === "wood") { g.fillStyle = "#6b4430"; g.fillRect(1, 5, 14, 8); g.fillStyle = "#b07a45"; g.fillRect(2, 6, 11, 6); disc(g, 13, 9, 2.6, 3.6, "#e3c08a"); disc(g, 13, 9, 1.2, 1.8, "#c98d4a"); g.fillStyle = "#8a5a2f"; g.fillRect(3, 8, 7, 1); }
  else if (id === "stone") { blob(g, 8, 9.5, 6, 4.5, "#a9a3b8"); g.fillStyle = "#8a849a"; g.fillRect(6, 9, 4, 1); g.fillRect(9, 7, 1, 2); }
  else if (id === "wool") { for (const [x, y, r] of [[5, 9, 3.5], [10, 9, 3.5], [7.5, 6, 3.5], [8, 11, 3]]) disc(g, x, y, r, r, "#c9bfa9"); for (const [x, y, r] of [[5, 8.5, 2.8], [10, 8.5, 2.8], [7.5, 5.6, 2.8], [8, 10.5, 2.4]]) disc(g, x, y, r, r, "#f6f1e7"); }
  else if (id === "egg" || id === "gold_egg") blob(g, 8, 9, 4.5, 5.5, it.color);
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
  `<svg viewBox="0 0 32 32"><rect x="14" y="5" width="4" height="23" rx="1" fill="#c98d4a"/><path d="M18 5h6a4 4 0 0 1 0 11h-6z" fill="#c9c3d6"/><path d="M18 14h7v2h-7z" fill="#8a849a"/></svg>`,
  `<svg viewBox="0 0 32 32"><path d="M6 28L24 4" stroke="#c98d4a" stroke-width="3" stroke-linecap="round"/><path d="M24 4q5 10 1 18" fill="none" stroke="#ece6fa" stroke-width="1.2"/><circle cx="25" cy="23" r="2.6" fill="#f2607e"/><path d="M22.4 23h5.2" stroke="#fff" stroke-width="1.2"/></svg>`,
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
const TOOL_NAMES = ["Hoe", "Watering can", "Seeds", "Hands", "Axe", "Fishing rod"];
const NTOOLS = TOOL_NAMES.length;
function seedTypes() { return Object.keys(S.inv).filter((k) => ITEMS[k]?.kind === "seed" && S.inv[k] > 0); }
function renderHotbar() {
  if (!seedTypes().includes(S.seedSel)) S.seedSel = seedTypes()[0] || null;
  hotbar.innerHTML = TOOL_NAMES.map((n, i) => {
    let inner = TOOL_SVG[i], cnt = "";
    if (i === 2) { inner = S.seedSel ? `<img alt="" src="${icon(S.seedSel)}">` : `<svg viewBox="0 0 32 32"><rect x="9" y="6" width="14" height="20" rx="2" fill="none" stroke="#6b6290" stroke-width="2" stroke-dasharray="3 3"/></svg>`; cnt = S.seedSel ? S.inv[S.seedSel] : "0"; }
    if (i === 1) cnt = S.water;
    if (i === 4) cnt = S.inv.wood || "";
    const label = i === 2 ? (S.seedSel ? ITEMS[S.seedSel].name + (seedTypes().length > 1 ? " · Q to switch" : "") : "No seeds — buy at Mina's") : n;
    return `<button class="slot" data-slot="${i}" aria-pressed="${S.tool === i}" aria-label="${label}"><span class="k">${i + 1}</span>${inner}<span class="n">${cnt}</span><span class="slotlabel ${S.tool === i ? "show" : ""}">${label}</span></button>`;
  }).join("");
}
hotbar.addEventListener("click", (e) => { const b = e.target.closest(".slot"); if (b) selectTool(+b.dataset.slot); });
let flashT = 0;
function selectTool(i, silent = false) {
  if (i === 2 && S.tool === 2 && !silent) cycleSeed();
  if (i !== 5 && rod.phase !== "idle") reelIn(true);
  S.tool = i; if (!silent) PA.sfx("click"); renderHotbar();
  const l = hotbar.querySelector(`[data-slot="${i}"] .slotlabel`); if (l) { l.classList.add("flash"); clearTimeout(flashT); flashT = setTimeout(() => l.classList.remove("flash"), 1100); }
  for (const [k, m] of Object.entries(toolMeshes)) m.visible = +k === i;
  if (!silent) kick(0.6);
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
  $("waterFill").style.transform = `scaleX(${S.water / canCap()})`; $("waterVal").textContent = S.water;
  bar.setScore(S.money.toLocaleString("en-US") + " G");
  const h = hotbar.querySelector('[data-slot="1"] .n'); if (h) h.textContent = S.water;
}
const prompt = $("prompt");
let promptSig = "";
function setPrompt(k, text) {
  const sig = text && !PA.THUMB ? k + text : "";
  if (sig === promptSig) return; promptSig = sig;
  if (!sig) { prompt.hidden = true; return; }
  const label = PA.TOUCH ? (k === "E" ? "Talk" : "Use") : k;
  prompt.innerHTML = `<kbd>${label}</kbd>${text}`; prompt.hidden = false;
}
function floatText(text, x, y, z, cls = "") {
  const v = new THREE.Vector3(x, y, z).project(camera);
  const d = document.createElement("div"); d.className = "float " + cls; d.textContent = text;
  d.style.left = ((v.x + 1) / 2 * innerWidth) + "px"; d.style.top = ((1 - v.y) / 2 * innerHeight) + "px";
  document.body.appendChild(d); setTimeout(() => d.remove(), 1150);
}
const zoneEl = $("zone"); let zoneT = 0;
function showZone(name) { if (PA.THUMB || !started) return; zoneEl.textContent = name; zoneEl.classList.add("show"); clearTimeout(zoneT); zoneT = setTimeout(() => zoneEl.classList.remove("show"), 2200); }

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
  el.hidden = !text || PA.THUMB || !started; if (text && el.textContent !== text) el.textContent = text;
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
function animalAt(x, z) { let best = null, bd = 0.9; for (const a of animals) { const d = Math.hypot(a.w.x - (x + 0.5), a.w.z - (z + 0.5)); if (d < bd) { bd = d; best = a; } } return best; }
const isWater = (x, z) => at(x, z) === "w";
const waterSpot = (x, z) => { const dx = (x + 0.5 - POND.cx) / (POND.rx + 0.5), dz = (z + 0.5 - POND.cz) / (POND.rz + 0.5); return dx * dx + dz * dz < 1 ? "pond" : "river"; };
const hits = {}; // tree/boulder → hits so far today
// What would the current tool do on tile (x,z)? Returns {label, ok, run, tiles}.
function toolPreview(x, z) {
  const c = at(x, z), k = key(x, z), t = S.field[k];
  const tool = S.tool;
  if (tool === 5) {
    if (rod.phase === "bite") return { label: "Hook it!", ok: true, run: hookFish };
    if (rod.phase !== "idle") return { label: "Reel in", ok: true, run: () => reelIn(false) };
    if (isWater(x, z)) return { label: "Cast line", ok: true, run: () => startFishing(x, z) };
    return { label: "Face the water to fish", ok: false };
  }
  if (tool === 1 && (c === "w" || c === "W")) return { label: "Refill can", ok: true, run: refill };
  if (tool === 3) {
    const ei = eggAt(x, z); if (ei >= 0) return { label: "Pick up egg", ok: true, run: () => takeEgg(ei) };
    const a = animalAt(x, z); if (a) return { label: animalVerb(a), ok: true, run: () => petAnimal(a) };
  }
  if (c === "t" && !S.forest[k]) {
    if (tool === 4) return { label: `Chop tree${hits[k] ? ` (${hits[k]}/3)` : ""}`, ok: true, run: () => chop(x, z) };
    return { label: tool === 0 ? "Use the axe (5) on trees" : "", ok: false };
  }
  if (c === "r" && !S.forest[k]) {
    if (tool === 0) return { label: `Break boulder${hits[k] ? ` (${hits[k]}/2)` : ""}`, ok: true, run: () => breakRock(x, z) };
    return { label: tool === 4 ? "Use the hoe (1) on boulders" : "", ok: false };
  }
  if (!t) return { label: tool === 0 ? "Can't till here" : "", ok: false };
  if (tool === 0) {
    const tiles = lineTiles(x, z, S.hoe === 2 ? 3 : 1);
    if (t.obj === "stone") return { label: "Break stone", ok: true, run: () => useHoe(x, z), tiles };
    if (t.obj === "weed") return { label: "Clear weeds", ok: true, run: () => useHoe(x, z), tiles };
    if (t.crop?.dead) return { label: "Clear dead crop", ok: true, run: () => useHoe(x, z), tiles };
    if (t.crop) return { label: "A crop is growing", ok: false };
    if (t.till) return { label: "Already tilled", ok: false };
    return { label: "Till soil", ok: true, run: () => useHoe(x, z), tiles };
  }
  if (tool === 1) {
    if (!t.till) return { label: "Till first", ok: false };
    if (S.water <= 0) return { label: "Can is empty", ok: false };
    if (t.wet && S.can === 1) return { label: "Already watered", ok: false };
    return { label: "Water", ok: true, run: () => useCan(x, z), tiles: lineTiles(x, z, S.can === 2 ? 3 : 1) };
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
// Swing animation with anticipation → impact → follow-through; `onImpact` runs at the hit frame.
const SWING = { chop: [0.46, 0.55], pour: [0.5, 0.3], toss: [0.34, 0.45], reach: [0.32, 0.5], cast: [0.5, 0.52] };
function swing(kind, onImpact) { const [dur, at] = SWING[kind]; P.act = P.actDur = dur; P.actKind = kind; P.impact = onImpact || null; P.impactAt = at; kick(0.5); }
function useHoe(x, z) {
  const tiles = lineTiles(x, z, S.hoe === 2 ? 3 : 1);
  if (!spend(S.hoe === 2 ? 4 : 2)) return;
  const fx = [];
  for (const [tx, tz] of tiles) {
    const t = S.field[key(tx, tz)]; if (!t) continue;
    if (t.obj) { const was = t.obj; t.obj = null; if (was === "stone") { S.inv.stone = (S.inv.stone || 0) + 1; } fx.push([tx, tz, was]); }
    else if (t.crop?.dead) { t.crop = null; fx.push([tx, tz, "dead"]); }
    else if (!t.crop && !t.till) { t.till = 1; if (S.weather !== "sun") t.wet = 1; stat("tilled"); fx.push([tx, tz, "till"]); }
  }
  swing("chop", () => {
    for (const [tx, tz, what] of fx) {
      refreshTile(tx, tz, true);
      const cx = tx + 0.5, cz = tz + 0.5;
      if (what === "stone") { burst(cx, 0.2, cz, COL.stone, 10, 2, 2.4, 0.3); floatText("+1 Stone", cx, 0.8, cz); }
      else if (what === "weed") burst(cx, 0.2, cz, COL.weed, 9, 1.8, 2.2, 0.28);
      else { burst(cx, 0.1, cz, COL.soil, 9, 1.8, 2.6, 0.3); burst(cx, 0.1, cz, COL.soilL, 4, 1.2, 2, 0.24); puff(cx, cz, 3); }
    }
    PA.sfx(fx.length ? (fx.some((f) => f[2] === "stone") ? "crack" : "thud") : "click"); kick(-1.4);
  });
}
function useCan(x, z) {
  if (!spend(S.can === 2 ? 2 : 1)) return;
  const done = [];
  for (const [tx, tz] of lineTiles(x, z, S.can === 2 ? 3 : 1)) {
    const t = S.field[key(tx, tz)]; if (!t || !t.till || S.water <= 0) continue;
    if (!t.wet) { t.wet = 1; if (t.crop && !t.crop.dead) stat("watered"); }
    S.water--; done.push([tx, tz]);
  }
  swing("pour", () => { done.forEach(([tx, tz], i) => { pour(tx + 0.5, tz + 0.5); after(0.3 + i * 0.05, () => refreshTile(tx, tz)); }); if (done.length) PA.sfx("splash"); });
  renderHotbar();
}
function refill() { swing("reach", () => { burst(P.x + P.fx * 0.6, 0.4, P.z + P.fz * 0.6, COL.water, 10, 1.5, 2, 0.22); PA.sfx("splash"); }); S.water = canCap(); floatText("Can refilled", P.x, 1.4, P.z); renderHotbar(); }
function plant(x, z) {
  const t = S.field[key(x, z)]; const item = S.seedSel;
  t.crop = { t: ITEMS[item].crop, age: 0, dead: false };
  S.inv[item]--; if (!S.inv[item]) delete S.inv[item];
  stat("planted"); renderHotbar();
  swing("toss", () => { refreshTile(x, z, true); burst(x + 0.5, 0.25, z + 0.5, COL.seed, 6, 0.8, 1.4, 0.18); PA.sfx("pop"); kick(-0.7); });
}
function harvest(x, z) {
  const t = S.field[key(x, z)], c = CROPS[t.crop.t], id = t.crop.t;
  S.inv[id] = (S.inv[id] || 0) + 1;
  if (c.shape === "big") stat("bigHarvest");
  if (c.regrow) t.crop.age = c.days - c.regrow; else t.crop = null;
  swing("reach", () => {
    PA.sfx("pop"); burst(x + 0.5, 0.4, z + 0.5, c.fruit, 10, 1.4, 2.6, 0.3); burst(x + 0.5, 0.15, z + 0.5, COL.soil, 5, 1.2, 1.8, 0.24);
    floatText("+1 " + c.name, x + 0.5, 0.9, z + 0.5, "gold"); refreshTile(x, z, true); kick(1.6);
  });
}
function pullWeed(x, z) { if (!spend(1)) return; S.field[key(x, z)].obj = null; swing("reach", () => { PA.sfx("pop"); burst(x + 0.5, 0.2, z + 0.5, COL.weed, 8, 1.6, 2.2, 0.26); refreshTile(x, z); kick(1); }); }
function clearDead(x, z) { S.field[key(x, z)].crop = null; swing("reach", () => { PA.sfx("pop"); refreshTile(x, z); }); }
function chop(x, z) {
  const k = key(x, z); if (!spend(3)) return;
  hits[k] = (hits[k] || 0) + 1;
  const fell = hits[k] >= 3; let n = 0;
  if (fell) { delete hits[k]; S.forest[k] = 3; n = 3 + (Math.random() < 0.35 ? 1 : 0); S.inv.wood = (S.inv.wood || 0) + n; stat("wood", n); }
  swing("chop", () => {
    const [tx, tz, sc] = veg.treePos(k) || [x + 0.5, z + 0.5, 1];
    veg.hit(k); PA.sfx("chop"); kick(-1.4);
    burst(tx - P.fx * 0.2, 0.5, tz - P.fz * 0.2, COL.chip, 8, 2.2, 2.2, 0.24);
    for (let i = 0; i < 6; i++) particles.emit({ x: tx + (Math.random() - 0.5) * 1.2, y: 1.3 * sc + Math.random() * 0.6, z: tz + (Math.random() - 0.5) * 1.2, vx: (Math.random() - 0.5) * 0.8, vy: -0.3, vz: (Math.random() - 0.5) * 0.8, life: 1.4, size: 0.26, color: C(S.season === 2 ? "#e0823a" : S.season === 3 ? "#e9eef5" : "#5fae5a"), drag: 2.5, gravity: 1.4 });
    if (fell) {
      after(0.12, () => { veg.setChopped(k, true); PA.sfx("thud"); puff(tx, tz, 8, COL.dust, 0.8); burst(tx, 0.3, tz, COL.chip, 14, 3, 3, 0.3); pops.emit("star", tx, 1.0, tz, { size: 0.34 }); floatText(`+${n} Wood`, tx, 1.3, tz, "gold"); renderHotbar(); });
    }
  });
}
function breakRock(x, z) {
  const k = key(x, z); if (!spend(3)) return;
  hits[k] = (hits[k] || 0) + 1;
  const broke = hits[k] >= 2; let n = 0;
  if (broke) { delete hits[k]; S.forest[k] = 4; n = 2 + (Math.random() < 0.3 ? 1 : 0); S.inv.stone = (S.inv.stone || 0) + n; }
  swing("chop", () => {
    veg.hit(k); PA.sfx("crack"); kick(-1.4); burst(x + 0.5, 0.35, z + 0.5, COL.stone, 9, 2.2, 2.2, 0.26);
    if (broke) after(0.08, () => { veg.setBroken(k, true); puff(x + 0.5, z + 0.5, 6, COL.dust, 0.7); burst(x + 0.5, 0.3, z + 0.5, COL.stone, 16, 3, 3, 0.32); floatText(`+${n} Stone`, x + 0.5, 1, z + 0.5, "gold"); });
  });
}
function takeEgg(i) {
  const e = S.eggs.splice(i, 1)[0]; const id = e.gold ? "gold_egg" : "egg";
  S.inv[id] = (S.inv[id] || 0) + 1; stat("eggs");
  swing("reach", () => { PA.sfx("pop"); PA.sfx("cluck"); floatText("+1 " + ITEMS[id].name, e.x, 0.6, e.z, "gold"); refreshEggs(); kick(1.4); if (e.gold) pops.emit("star", e.x, 0.5, e.z); });
}
const VOICE = { chicken: "cluck", cow: "moo", sheep: "baa" };
function animalVerb(a) { return a.d.kind === "cow" && a.d.milkReady ? "Milk " + a.d.name : a.d.kind === "sheep" && a.d.woolReady ? "Shear " + a.d.name : "Pet " + a.d.name; }
function petAnimal(a) {
  const follow = () => [a.w.x, a.w.z];
  swing("reach");
  cheer(a.w, P.x, P.z);
  if (a.d.kind === "cow" && a.d.milkReady) { a.d.milkReady = false; S.inv.milk = (S.inv.milk || 0) + 1; PA.sfx("moo"); floatText("+1 Milk", a.w.x, 1.2, a.w.z, "gold"); return; }
  if (a.d.kind === "sheep" && a.d.woolReady) { a.d.woolReady = false; S.inv.wool = (S.inv.wool || 0) + 1; stat("wool"); PA.sfx("baa"); floatText("+1 Wool", a.w.x, 1.1, a.w.z, "gold"); burst(a.w.x, 0.6, a.w.z, COL.white, 14, 1.6, 1.6, 0.34); return; }
  if (!a.d.petted) { a.d.petted = true; a.d.aff = Math.min(10, a.d.aff + 1); pops.emit("heart", a.w.x, a.headY, a.w.z, { follow }); pops.emit("heart", a.w.x, a.headY, a.w.z, { follow, delay: 0.18, size: 0.3 }); }
  else pops.emit("note", a.w.x, a.headY, a.w.z, { follow, size: 0.32 });
  PA.sfx(VOICE[a.d.kind]);
}
function feedAnimals() {
  const hungry = S.animals.filter((a) => !a.fed);
  if (!hungry.length) { PA.toast("Everyone's already fed today."); return; }
  const have = S.inv.fodder || 0;
  if (!have) { PA.toast("No fodder left. Mina sells it for 10 G."); PA.sfx("fail"); return; }
  const n = Math.min(have, hungry.length);
  for (let i = 0; i < n; i++) hungry[i].fed = true; // a fed cow gives milk the next morning (see endDay)
  S.inv.fodder -= n; if (!S.inv.fodder) delete S.inv.fodder;
  swing("toss", () => { hay.visible = true; burst(trough.position.x, 0.5, trough.position.z, C("#e6c35c"), 12, 1.6, 1.6, 0.26); PA.sfx("thud"); });
  // everyone fed trots over to the trough, then cheers
  animals.forEach((a, i) => {
    if (!a.d.fed) return;
    const w = a.w, p = PENS[a.kind];
    w.tx = clamp(trough.position.x + (Math.random() - 0.5) * 1.6, p.x0 + 0.4, p.x1 + 0.6); w.tz = clamp(trough.position.z + 0.9 + Math.random() * 0.8, p.z0 + 0.4, p.z1 + 0.6);
    w.state = "walk"; w.t = 0; w.dur = 6;
    after(0.4 + i * 0.15, () => { pops.emit("heart", w.x, a.headY, w.z, { follow: () => [w.x, w.z] }); PA.sfx(VOICE[a.kind]); });
  });
  PA.toast(n === hungry.length ? `Fed all ${n} animals.` : `Fed ${n} of ${hungry.length}. Buy more fodder at Mina's.`);
}
// fishing
function startFishing(x, z) {
  if (!spend(2)) return;
  // cast as far as the water goes (up to 3 tiles out)
  let tx = x, tz = z; const sx = Math.sign(Math.abs(P.fx) > Math.abs(P.fz) ? P.fx : 0), sz = Math.sign(Math.abs(P.fx) > Math.abs(P.fz) ? 0 : P.fz);
  for (let i = 1; i < 3; i++) if (isWater(x + sx * i, z + sz * i)) { tx = x + sx * i; tz = z + sz * i; } else break;
  fishing.spot = waterSpot(tx, tz);
  fishing.to.set(tx + 0.5 + (Math.random() - 0.5) * 0.4, 0.06, tz + 0.5 + (Math.random() - 0.5) * 0.4);
  castRod(rod, { spot: fishing.spot, season: S.season, hour: S.min / 60, weather: S.weather, touch: PA.TOUCH });
  swing("cast", () => { PA.sfx("whoosh"); rodTip.getWorldPosition(fishing.from); bobber.visible = fishLine.visible = true; });
}
function hookFish() { if (pullRod(rod) === "hook") { PA.sfx("reel"); kick(1.2); fishing.tug = 1; } }
function reelIn(silent) { if (rod.phase === "idle") return; pullRod(rod); rod.phase = "idle"; bobber.visible = fishLine.visible = false; if (!silent) { PA.sfx("click"); swing("reach"); } }
function onFishEvent(e) {
  const b = bobber.position;
  if (e === "land") { PA.sfx("plop"); burst(b.x, 0.1, b.z, COL.waterW, 8, 1, 1.4, 0.2); }
  if (e === "nibble") { fishing.dip = 0.4; particles.emit({ x: b.x, y: 0.08, z: b.z, vy: 0.4, life: 0.4, size: 0.3, color: COL.waterW, alpha: 0.5, grow: 1 }); }
  if (e === "bite") { fishing.dip = 1; PA.sfx("bite"); pops.emit("bang", b.x, 0.5, b.z, { size: 0.5, rise: 0.4, life: PA.TOUCH ? 1.1 : 0.8 }); burst(b.x, 0.1, b.z, COL.waterW, 10, 1.4, 2, 0.22); }
  if (e === "escape") { PA.toast("It got away…"); bobber.visible = fishLine.visible = false; PA.sfx("fail"); }
  if (e === "caught") {
    const id = rod.fish; S.inv[id] = (S.inv[id] || 0) + 1; stat("fish");
    bobber.visible = fishLine.visible = false;
    burst(P.x + P.fx * 0.4, 1.1, P.z + P.fz * 0.4, COL.waterW, 12, 1.4, 2.2, 0.22); kick(2);
    pops.emit("star", P.x, 1.6, P.z, { size: 0.42 });
    floatText(`Caught a ${FISH[id].name}!`, P.x, 1.7, P.z, "gold");
    PA.sfx(FISH[id].sell >= 150 ? "win" : "coin");
  }
}

/* ======================================================== interactables */
const DOOR = { x: HOUSE.door[0] + 0.5, z: HOUSE.door[1] + 1.2 };
function interactables() {
  const list = [
    { x: DOOR.x, z: DOOR.z, r: 1.0, label: "Sleep", run: askSleep },
    { x: BIN[0] + 0.5, z: BIN[1] + 0.5, r: 1.2, label: "Ship items", run: openShip },
    { x: WELL[0] + 0.5, z: WELL[1] + 0.5, r: 1.2, label: "Refill can", run: refill },
    { x: trough.position.x, z: trough.position.z, r: 1.5, label: "Feed animals", run: feedAnimals },
    { x: BOARD[0] + 0.5, z: BOARD[1] + 0.5, r: 1.2, label: "Read journal", run: openJournal },
  ];
  for (const [id, f] of Object.entries(npcs)) if (f.g.visible) list.push({ x: f.g.position.x, z: f.g.position.z, r: 1.35, label: "Talk to " + NPCS[id].name, run: () => talk(id) });
  for (const a of animals) list.push({ x: a.w.x, z: a.w.z, r: 1.0, label: animalVerb(a), run: () => petAnimal(a) });
  S.eggs.forEach((e, i) => list.push({ x: e.x, z: e.z, r: 0.9, label: "Pick up egg", run: () => takeEgg(i) }));
  if (isWater(Math.floor(P.x + P.fx), Math.floor(P.z + P.fz)) && S.tool !== 5) list.push({ x: P.x + P.fx, z: P.z + P.fz, r: 2, label: "Refill can", run: refill });
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
  const items = Object.keys(S.inv).filter((k) => ["crop", "produce", "fish", "material"].includes(ITEMS[k].kind));
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
  const np = npcs[id].g.position;
  if (r === "like") { pops.emit("heart", np.x, 1.45, np.z); pops.emit("heart", np.x, 1.45, np.z, { delay: 0.2, size: 0.32 }); }
  else if (r === "ok") pops.emit("note", np.x, 1.45, np.z, { size: 0.32 });
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
  const chickens = S.animals.filter((a) => a.kind === "chicken").length, sheep = S.animals.filter((a) => a.kind === "sheep").length;
  const rows = Object.entries(UPGRADES).map(([id, u]) => {
    const owned = (id === "can2" && S.can === 2) || (id === "hoe2" && S.hoe === 2) || (id === "stamina" && S.upgrades.stamina);
    const full = (id === "chicken" && chickens >= 6) || (id === "sheep" && sheep >= 4);
    const mats = Object.entries(u.mats || {}), short = mats.some(([m, n]) => (S.inv[m] || 0) < n);
    const dis = owned || full || S.money < u.price || short;
    const need = mats.map(([m, n]) => `<span class="${(S.inv[m] || 0) < n ? "short" : ""}">${n} ${ITEMS[m].name.toLowerCase()} (have ${S.inv[m] || 0})</span>`).join(" · ");
    return `<div class="row"><span class="check">${owned ? "✓" : ""}</span><span class="t">${u.name}<small>${u.desc}${id === "chicken" ? ` You have ${chickens}.` : id === "sheep" ? ` You have ${sheep}.` : ""}${need && !owned ? `<br>Needs ${need}` : ""}</small></span><button class="pa-btn" data-up="${id}" ${dis ? "disabled" : ""}>${owned ? "Owned" : full ? "Pen full" : u.price.toLocaleString("en-US") + " G"}</button></div>`;
  }).join("");
  PA.overlay(`<span class="pa-eyebrow">Kenji Tools</span><h2>Upgrades</h2><p>You have <span class="money">${S.money.toLocaleString("en-US")} G</span> · wood ${S.inv.wood || 0} · stone ${S.inv.stone || 0}. Chop wood and break boulders in Whisper Woods.</p><div class="list">${rows}</div><div class="pa-actions"><button class="pa-btn ghost" data-close>Done</button></div>`,
    { "[data-close]": () => PA.closeOverlay(), "[data-up]": (e) => buyUpgrade(e.currentTarget.dataset.up) });
}
const HEN_NAMES = ["Custard", "Sesame", "Waffle", "Dumpling", "Clover", "Nutmeg"], SHEEP_NAMES = ["Marshmallow", "Puff", "Cloud"];
function buyUpgrade(id) {
  const u = UPGRADES[id]; if (S.money < u.price) return;
  for (const [m, n] of Object.entries(u.mats || {})) if ((S.inv[m] || 0) < n) return;
  for (const [m, n] of Object.entries(u.mats || {})) { S.inv[m] -= n; if (!S.inv[m]) delete S.inv[m]; }
  S.money -= u.price; S.upgrades[id] = (S.upgrades[id] || 0) + 1; stat("upgrades");
  if (id === "sheep") { S.animals.push({ kind: "sheep", name: SHEEP_NAMES[(S.animals.filter((a) => a.kind === "sheep").length - 1) % 3], aff: 1, fed: false, petted: false, woolReady: false, woolDays: 0 }); spawnAnimals(); }
  if (id === "can2") { S.can = 2; S.water = 40; }
  if (id === "hoe2") S.hoe = 2;
  if (id === "stamina") { S.maxEnergy += 20; S.energy += 20; }
  if (id === "chicken") { S.animals.push({ kind: "chicken", name: HEN_NAMES[S.animals.length % HEN_NAMES.length], aff: 1, fed: false, petted: false }); spawnAnimals(); }
  PA.sfx("coin"); PA.toast(`Bought: ${u.name}`); renderHotbar(); openWorkshop();
}
function openShip() {
  const items = Object.keys(S.inv).filter((k) => ITEMS[k].sell);
  const shipped = Object.entries(S.shippedToday).map(([k, n]) => `${n}× ${ITEMS[k].name}`).join(", ");
  PA.overlay(`<span class="pa-eyebrow">Shipping bin</span><h2>Ship produce</h2>
    <p>Everything you ship is paid overnight. In the bin today: <span class="money">${S.earnedToday.toLocaleString("en-US")} G</span>${shipped ? ` (${shipped})` : ""}.</p>
    <div class="list">${items.length ? items.map((k) => rowItem(k, `${ITEMS[k].sell} G each · you have ${S.inv[k]}`, `<button class="pa-btn ghost" data-ship="${k}" data-n="1">Ship 1</button><button class="pa-btn" data-ship="${k}" data-n="all">Ship all</button>`)).join("") : `<p>Nothing to ship yet. Harvest crops, collect eggs and milk, or catch fish.</p>`}</div>
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
  closeDialog(); reelIn(true); $("fade").classList.add("on"); PA.sfx("whoosh");
  setTimeout(() => {
    const pay = S.earnedToday, shipped = { ...S.shippedToday };
    S.money += pay; S.stats.earned += pay;
    let grown = 0, ready = 0;
    for (const t of Object.values(S.field)) {
      if (t.crop && !t.crop.dead && t.wet && t.crop.age < CROPS[t.crop.t].days) { t.crop.age++; grown++; if (t.crop.age >= CROPS[t.crop.t].days) ready++; }
      t.wet = 0;
    }
    let newEggs = 0, wool = 0;
    for (const a of S.animals) {
      if (a.kind === "chicken" && a.fed) { const [x, z] = eggSpot(); S.eggs.push({ x, z, gold: a.aff >= 6 && Math.random() < 0.3 }); newEggs++; }
      if (a.kind === "cow") a.milkReady = a.fed;
      if (a.kind === "sheep" && a.fed && !a.woolReady) { a.woolDays = (a.woolDays || 0) + 1; if (a.woolDays >= 2) { a.woolReady = true; a.woolDays = 0; wool++; } }
      if (!a.fed) a.aff = Math.max(0, a.aff - 1);
      a.fed = false; a.petted = false;
    }
    S.eggs = S.eggs.slice(-12);
    // the woods grow back
    for (const k of Object.keys(S.forest)) if (--S.forest[k] <= 0) delete S.forest[k];
    for (const k of Object.keys(hits)) delete hits[k];
    const oldSeason = S.season;
    S.day++; S.daysPlayed++;
    if (S.day > DAYS_PER_SEASON) { S.day = 1; S.season = (S.season + 1) % 4; if (S.season === 0) S.year++; }
    let wilted = 0;
    if (S.season !== oldSeason) for (const t of Object.values(S.field)) if (t.crop && !t.crop.dead && CROPS[t.crop.t].season !== S.season) { t.crop.dead = true; wilted++; }
    S.weather = S.tomorrow; S.tomorrow = rollWeather(S.day === DAYS_PER_SEASON ? (S.season + 1) % 4 : S.season);
    if (S.weather !== "sun") for (const t of Object.values(S.field)) if (t.till) t.wet = 1;
    if (S.season !== 3) { const empty = Object.values(S.field).filter((t) => !t.till && !t.crop && !t.obj); for (let i = 0; i < 3 && empty.length; i++) empty.splice(Math.floor(Math.random() * empty.length), 1)[0].obj = "weed"; }
    for (const f of Object.values(S.friends)) { f.talked = false; f.gifted = false; }
    S.energy = passedOut ? Math.round(S.maxEnergy * 0.5) : S.maxEnergy;
    S.min = passedOut ? 7 * 60 : DAY_START;
    S.shippedToday = {}; S.earnedToday = 0;
    P.x = SPAWN.x; P.z = SPAWN.z; P.vx = P.vz = 0; P.fx = 0; P.fz = 1; P.target = null;
    hay.visible = false;
    if (S.season !== oldSeason) applySeason();
    refreshField(); refreshForest(); refreshEggs(); renderHotbar(); hudSig = ""; renderHUD(); save(); updateMusic(true);
    const lines = Object.entries(shipped).map(([k, n]) => `<span>${n}× ${ITEMS[k].name}</span><b>${(ITEMS[k].sell * n).toLocaleString("en-US")} G</b>`).join("");
    PA.overlay(`<span class="pa-eyebrow">${passedOut ? "You fainted at 2 AM" : "Good night"}</span><h2>${SEASONS[S.season]}, day ${S.day}</h2>
      ${S.season !== oldSeason ? `<p><strong>${SEASONS[S.season]} has arrived.</strong> ${wilted ? `${wilted} out-of-season crop${wilted > 1 ? "s" : ""} wilted. ` : ""}Mina has new seeds in stock.</p>` : ""}
      ${passedOut ? `<p>You woke up at 7 AM with half your energy. Try to be home by midnight.</p>` : ""}
      <div class="sum">${lines || `<span>Nothing shipped</span><b>0 G</b>`}<span class="tot">Paid overnight</span><b class="tot">${pay.toLocaleString("en-US")} G</b>
      <span>Crops that grew</span><b>${grown}</b><span>Ready to harvest</span><b>${ready}</b><span>New eggs</span><b>${newEggs}</b>${wool ? `<span>Sheep ready to shear</span><b>${wool}</b>` : ""}<span>Today's weather</span><b>${WX[S.weather].name}</b><span>Tomorrow</span><b>${WX[S.tomorrow].name}</b></div>
      <div class="pa-actions"><button class="pa-btn" data-go>Start the day</button></div>`, { "[data-go]": () => { PA.closeOverlay(); } });
    $("fade").classList.remove("on"); transitioning = false;
    if (pay) PA.sfx("coin");
  }, 700);
}

/* ===================================================== seasons & light */
function applySeason() {
  paintGround(S.season);
  veg.setSeason(S.season);
  outerMat.color.set(GRASS[S.season][1]);
  hills.forEach((h, i) => h.material = mat(S.season === 3 ? (i % 2 ? "#dfe7f0" : "#cfd9e6") : S.season === 2 ? (i % 2 ? "#b8923e" : "#a8823a") : (i % 2 ? "#6aa35a" : "#5d9a54")));
  const snowy = S.season === 3;
  houseRoof.material = mat(snowy ? "#e8eef5" : "#3f7f8f"); barnRoof.material = mat(snowy ? "#e8eef5" : "#5a3a3a"); coopRoof.material = mat(snowy ? "#e8eef5" : "#c4553f"); siloTop.material = mat(snowy ? "#e8eef5" : "#5a3a3a");
  wind.uWind.value = S.season === 2 ? 1.35 : S.season === 3 ? 0.6 : 1;
}
const cA = new THREE.Color(), cB = new THREE.Color(), skyC = new THREE.Color(), focus = new THREE.Vector3();
const WARM_GROUND = new THREE.Color("#a8783a"), COOL_GROUND = new THREE.Color("#4a4a5a");
function applyLight(t) {
  const L = skyAt(S.min / 60, S.weather);
  skyC.setRGB(L.sky[0] / 255, L.sky[1] / 255, L.sky[2] / 255, THREE.SRGBColorSpace);
  sun.color.setRGB(L.light[0] / 255, L.light[1] / 255, L.light[2] / 255, THREE.SRGBColorSpace);
  sun.intensity = L.lightI; hemi.intensity = L.hemiI;
  hemi.color.copy(skyC).lerp(cA.set("#ffffff"), 0.4);
  hemi.groundColor.copy(COOL_GROUND).lerp(WARM_GROUND, L.warm * 0.8 + (1 - L.dark) * 0.2);
  renderer.setClearColor(skyC); scene.fog.color.copy(skyC);
  // scenic zoom pushes the fog back so the valley and the horizon open up
  const open = smooth(17, 24, zoom);
  scene.fog.near = L.fogNear + open * 14; scene.fog.far = L.fogFar + open * 50;
  // shadow camera follows the view, snapped to whole metres so shadows don't crawl as you walk
  const fx = Math.round(focus.x), fz = Math.round(focus.z);
  sun.position.set(fx + L.dir[0] * 34, L.dir[1] * 34, fz + L.dir[2] * 34); sun.target.position.set(fx, 0, fz);
  // sky dome
  skyU.horizon.value.copy(skyC);
  skyU.zenith.value.copy(skyC).lerp(cB.set(L.night ? "#05061a" : "#2f6fd0"), L.night ? 0.75 : 0.32);
  skyU.stars.value = L.stars; skyU.moon.value = L.night ? smooth(0, 0.6, L.stars) : 0; skyU.moonDir.value.set(L.dir[0], Math.max(0.25, L.dir[1]), L.dir[2]).normalize();
  skyU.time.value = t; skyDome.position.copy(camera.position);
  // water mirrors the sky; stars dance on it at night
  waterU.skyCol.value.copy(skyC); waterU.stars.value = L.stars * (S.weather === "sun" ? 1 : 0.2); waterU.glint.value = 1 - L.dark * 0.6; waterU.time.value = t;
  waterU.dim.value = lerp(1, 0.3, L.dark) * (S.weather === "rain" ? 0.85 : 1);
  waterU.deep.value.set("#2a6a9a").lerp(cA.set("#10224a"), L.dark * 0.8).lerp(cB.set("#3a5a7a"), L.warm * 0.25);
  const n = L.dark;
  lampMat.emissiveIntensity = n * 2.2; windowMat.emissiveIntensity = n * 1.8 + (S.weather === "rain" ? 0.4 : 0);
  if (n > 0.01) LIGHT_SPOTS.map((p) => [p, (p[0] - focus.x) ** 2 + (p[2] - focus.z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, 3).forEach(([p], i) => lampLights[i].position.set(p[0], p[1], p[2]));
  lampLights.forEach((l) => (l.intensity = n * 9));
  fireflies.material.opacity = (S.season === 1 || S.season === 2) && S.weather === "sun" ? n * 0.95 : 0;
  return L;
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
const touches = new Map(); let pinch = 0;
renderer.domElement.addEventListener("pointermove", (e) => {
  if (touches.has(e.pointerId)) {
    touches.set(e.pointerId, [e.clientX, e.clientY]);
    if (touches.size === 2) { const [a, b] = [...touches.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]); if (pinch) zoom = clamp(zoom + (pinch - d) / 28, 8, 24); pinch = d; }
  }
  if (e.pointerType !== "mouse") return;
  const p = groundPoint(e); hover = p ? [Math.floor(p.x), Math.floor(p.z)] : null;
});
const endTouch = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = 0; };
renderer.domElement.addEventListener("pointerup", endTouch);
renderer.domElement.addEventListener("pointercancel", endTouch);
renderer.domElement.addEventListener("pointerleave", (e) => { hover = null; endTouch(e); });
renderer.domElement.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch") { touches.set(e.pointerId, [e.clientX, e.clientY]); if (touches.size > 1) return; }
  if (!started || isBusy() || e.button > 0) return;
  PA.ctx();
  if (S.tool === 5 && rod.phase !== "idle") { act(); return; }
  const p = groundPoint(e); if (!p) return;
  const tx = Math.floor(p.x), tz = Math.floor(p.z);
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
renderer.domElement.addEventListener("wheel", (e) => { zoom = clamp(zoom + Math.sign(e.deltaY) * 1.2, 8, 24); e.preventDefault(); }, { passive: false });
function faceTo(x, z) { const dx = x - P.x, dz = z - P.z, d = Math.hypot(dx, dz) || 1; P.fx = dx / d; P.fz = dz / d; }
function act() {
  if (P.act > 0.1 || isBusy()) return;
  if (S.tool === 5 && rod.phase !== "idle") { if (rod.phase === "bite") hookFish(); else if (rod.phase !== "reel") reelIn(false); return; }
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
  if (e.code === "Minus" || e.code === "NumpadSubtract") zoom = clamp(zoom + 2, 8, 24);
  if (e.code === "Equal" || e.code === "NumpadAdd") zoom = clamp(zoom - 2, 8, 24);
  const n = ["Digit1", "Digit2", "Digit3", "Digit4", "Digit5", "Digit6"].indexOf(e.code); if (n >= 0) selectTool(n);
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
    <kbd>WASD / Arrows</kbd><span>Walk · hold Shift to run</span>
    <kbd>1 – 6</kbd><span>Hoe, can, seeds, hands, axe, rod</span>
    <kbd>Space / Click</kbd><span>Use the tool on the highlighted tile</span>
    <kbd>E</kbd><span>Talk, ship, feed animals, sleep at your door</span>
    <kbd>Q · B · J</kbd><span>Switch seeds · Bag · Journal</span>
    <kbd>Wheel · − +</kbd><span>Zoom — all the way out to see the sky</span>
    <kbd>Phone</kbd><span>Stick to walk (push far to run), Use and Talk buttons, pinch to zoom</span>
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
const camPos = new THREE.Vector3(), lookAt = new THREE.Vector3(), focusT = new THREE.Vector3();
let started = false, isBusyStart = true, voiceT = 0;
const animalStates = () => animals.map((a) => a.w);
const ease = (t) => t * t * (3 - 2 * t);
function armPose(kind, k) {
  // returns [arm x-rotation, torso bend, tool tilt]
  if (kind === "chop") {
    if (k < 0.4) { const a = ease(k / 0.4); return [lerp(0.2, -2.8, a), lerp(0, -0.14, a), 0]; }
    if (k < 0.55) { const a = (k - 0.4) / 0.15; return [lerp(-2.8, -0.45, a * a), lerp(-0.14, 0.32, a), 0]; }
    const a = ease((k - 0.55) / 0.45); return [lerp(-0.45, 0.2, a), lerp(0.32, 0, a), 0];
  }
  if (kind === "pour") { const up = Math.sin(Math.min(1, k / 0.22) * Math.PI / 2) * (k > 0.82 ? 1 - (k - 0.82) / 0.18 : 1); return [-1.25 * up, 0.12 * up, 0.9 * up * (k > 0.25 && k < 0.82 ? 1 : 0.4)]; }
  if (kind === "toss") { if (k < 0.3) return [lerp(0.2, 0.8, ease(k / 0.3)), -0.05, 0]; if (k < 0.45) return [lerp(0.8, -1.9, (k - 0.3) / 0.15), 0.18, 0]; return [lerp(-1.9, 0.2, ease((k - 0.45) / 0.55)), lerp(0.18, 0, (k - 0.45) / 0.55), 0]; }
  if (kind === "reach") { const s = Math.sin(k * Math.PI); return [-1.45 * s, 0.4 * s, 0]; }
  if (kind === "cast") {
    if (k < 0.4) { const a = ease(k / 0.4); return [lerp(0.2, -3.0, a), lerp(0, -0.18, a), 0]; }
    if (k < 0.55) { const a = (k - 0.4) / 0.15; return [lerp(-3.0, -0.8, a), lerp(-0.18, 0.2, a), 0]; }
    return [-0.8, lerp(0.2, 0.05, (k - 0.55) / 0.45), 0];
  }
  return [0.2, 0, 0];
}
function step(dt, t) {
  const busy = isBusy() || transitioning || !started;
  for (let i = later.length - 1; i >= 0; i--) { later[i][0] -= dt; if (later[i][0] <= 0) { const f = later[i][1]; later.splice(i, 1); f(); } }
  // ---- movement intent
  let mx = 0, mz = 0, run = false;
  if (!busy) {
    const k = PA.keys;
    mx = (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0) + PA.axis.x;
    mz = (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0) - (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) + PA.axis.y;
    run = k.has("ShiftLeft") || k.has("ShiftRight") || Math.hypot(PA.axis.x, PA.axis.y) > 0.92;
    if (Math.hypot(mx, mz) > 0.15) { P.target = null; P.pending = null; if (rod.phase !== "idle" && P.act <= 0) reelIn(true); }
    else if (P.target) {
      const dx = P.target.x - P.x, dz = P.target.z - P.z, d = Math.hypot(dx, dz);
      if (d <= P.target.stop) {
        const pend = P.pending; P.target = null; P.pending = null;
        if (pend?.run) { faceTo(pend.x, pend.z); pend.run(); }
        else if (pend?.tile) { faceTo(pend.tile[0] + 0.5, pend.tile[1] + 0.5); hover = pend.tile; act(); hover = null; }
      } else { mx = dx / d; mz = dz / d; run = d > 4; }
    }
  }
  // ---- velocity eases toward the stick (no instant starts/stops)
  const m = Math.hypot(mx, mz);
  let tvx = 0, tvz = 0;
  if (m > 0.15 && P.act <= 0 && rod.phase === "idle") {
    mx /= Math.max(1, m); mz /= Math.max(1, m);
    const sp = S.energy <= 0 ? 2.4 : run ? 6.0 : 4.0;
    tvx = mx * sp; tvz = mz * sp;
    const mm = Math.hypot(mx, mz); P.fx = mx / mm; P.fz = mz / mm;
  }
  const kk = damp(m > 0.15 ? 12 : 16, dt);
  P.vx += (tvx - P.vx) * kk; P.vz += (tvz - P.vz) * kk;
  const nx = P.x + P.vx * dt, nz = P.z + P.vz * dt;
  let moved = false;
  if (!blocked(nx, P.z)) { P.x = nx; moved = true; } else P.vx *= 0.3;
  if (!blocked(P.x, nz)) { P.z = nz; moved = true; } else P.vz *= 0.3;
  P.speed = Math.hypot(P.vx, P.vz);
  if (P.target) { P.stuck = moved && P.speed > 0.5 ? 0 : P.stuck + dt; if (P.stuck > 0.5) { P.target = null; P.pending = null; } }
  // ---- walk cycle, footsteps, dust
  const gaitK = clamp(P.speed / 4, 0, 1.4);
  if (P.speed > 0.25) {
    const before = Math.floor(P.walk / Math.PI); P.walk += dt * (5 + P.speed * 1.9);
    if (Math.floor(P.walk / Math.PI) !== before) {
      kick(-0.25 - P.speed * 0.06);
      const c = at(Math.floor(P.x), Math.floor(P.z));
      if (P.speed > 2.5 && "p.qyFg".includes(c) && S.weather !== "rain") puff(P.x - P.fx * 0.2, P.z - P.fz * 0.2, P.speed > 5 ? 2 : 1, c === "F" ? COL.soilL : COL.dust, 0.36);
    }
  } else P.walk = lerp(P.walk, Math.round(P.walk / Math.PI) * Math.PI, damp(10, dt));
  // ---- facing (quaternion slerp), lean, squash & stretch spring
  qFace.setFromAxisAngle(UP, Math.atan2(P.fx, P.fz));
  playerRoot.quaternion.slerp(qFace, damp(13, dt));
  playerRoot.position.set(P.x, 0, P.z);
  P.sqv += (-170 * P.sq - 13 * P.sqv) * dt; P.sq = clamp(P.sq + P.sqv * dt, -0.28, 0.32);
  P.lean = lerp(P.lean, clamp(P.speed / 6, 0, 1) * 0.2, damp(8, dt));
  const g = player.g, pp = player.P, sq = P.sq;
  g.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
  const sw = Math.sin(P.walk) * 0.75 * Math.min(1, gaitK);
  pp.legL.rotation.x = sw; pp.legR.rotation.x = -sw; pp.armL.rotation.x = -sw * 0.8;
  g.position.y = Math.abs(Math.sin(P.walk)) * 0.06 * Math.min(1, gaitK);
  let arm = sw * 0.8, bend = 0, tilt = 0;
  if (P.act > 0) {
    const k0 = 1 - P.act / P.actDur; P.act -= dt; const k = clamp(1 - P.act / P.actDur, 0, 1);
    if (P.impact && k0 < P.impactAt && k >= P.impactAt) { const f = P.impact; P.impact = null; f(); }
    [arm, bend, tilt] = armPose(P.actKind, k);
    if (P.act <= 0 && P.impact) { const f = P.impact; P.impact = null; f(); }
  } else if (rod.phase !== "idle") {
    arm = -0.8 + Math.sin(t * 2) * 0.03 - fishing.tug * 0.6; bend = 0.05;
  }
  pp.armR.rotation.x = arm; pp.torso.rotation.x = P.lean + bend; pp.tool.rotation.x = tilt;
  // ---- fishing line & bobber
  fishing.dip = Math.max(0, fishing.dip - dt * 2.5); fishing.tug = Math.max(0, fishing.tug - dt * 3);
  if (!busy) for (const e of stepRod(rod, dt)) onFishEvent(e);
  if (bobber.visible) {
    rodTip.getWorldPosition(fishing.from);
    if (rod.phase === "cast") {
      const k = clamp(rod.t / 0.45, 0, 1), s = fishing.from;
      bobber.position.set(lerp(s.x, fishing.to.x, k), lerp(s.y, fishing.to.y, k) + Math.sin(k * Math.PI) * 1.4, lerp(s.z, fishing.to.z, k));
    } else if (rod.phase === "reel") {
      const k = clamp(rod.t / 0.6, 0, 1);
      bobber.position.lerpVectors(fishing.to, fishing.from, ease(k)); bobber.position.y += Math.sin(k * Math.PI) * 0.8;
    } else bobber.position.set(fishing.to.x, 0.06 + Math.sin(t * 3) * 0.015 - fishing.dip * 0.12 - (rod.phase === "bite" ? 0.08 + Math.abs(Math.sin(t * 30)) * 0.04 : 0), fishing.to.z);
    const a = lineGeo.attributes.position.array, f = fishing.from, b = bobber.position, sag = rod.phase === "wait" || rod.phase === "bite" ? 0.5 : 0.15;
    for (let i = 0; i < 12; i++) { const u = i / 11; a[i * 3] = lerp(f.x, b.x, u); a[i * 3 + 1] = lerp(f.y, b.y + 0.05, u) - Math.sin(u * Math.PI) * sag * (1 - u * 0.3); a[i * 3 + 2] = lerp(f.z, b.z, u); }
    lineGeo.attributes.position.needsUpdate = true;
  }
  // ---- time
  if (!busy) {
    S.min += dt * 60 / HOUR_SECONDS;
    if (S.min >= PASS_OUT) { PA.toast("You collapsed from exhaustion…"); endDay(true); }
  }
  // ---- zone banner
  const zn = zoneAt(P.x, P.z);
  if (zn && zn.id !== P.zone) { if (P.zone) showZone(zn.name); P.zone = zn.id; }
  // ---- neighbors
  for (const [id, f] of Object.entries(npcs)) {
    const d = Math.hypot(P.x - f.g.position.x, P.z - f.g.position.z);
    const want = d < 3 && id !== "tomo" ? Math.atan2(P.x - f.g.position.x, P.z - f.g.position.z) : f.home.r;
    let r = want - f.g.rotation.y; r = Math.atan2(Math.sin(r), Math.cos(r)); f.g.rotation.y += r * Math.min(1, dt * 4);
    f.P.head.position.y = 0.52 + Math.sin(t * 2 + id.length) * 0.012;
    if (id === "kenji") f.P.armR.rotation.x = d >= 3 ? -1.2 + Math.abs(Math.sin(t * 6)) * 0.9 : 0;
    if (id === "tomo") { f.P.armR.rotation.x = -0.9 + Math.sin(t * 1.3) * 0.05; f.P.head.rotation.y = d < 3 ? clamp(Math.atan2(P.x - f.g.position.x, P.z - f.g.position.z) - f.g.rotation.y, -0.8, 0.8) * 0.6 : 0; }
  }
  // ---- animals
  voiceT -= dt;
  const herd = animalStates();
  for (const a of animals) {
    const w = a.w;
    const ev = stepAnimal(w, busy ? 0 : dt, { pen: PENS[a.kind], solid: solidTile, others: herd, player: busy ? null : { x: P.x, z: P.z, speed: P.speed } });
    if (ev.includes("voice") && voiceT <= 0 && Math.hypot(w.x - P.x, w.z - P.z) < 7) { PA.sfx(VOICE[a.kind]); voiceT = 3; }
    if (ev.includes("startle")) { PA.sfx(VOICE[a.kind]); puff(w.x, w.z, 2); }
    const sp = Math.min(1, w.v / 0.6);
    const hop = w.hop > 0 ? Math.sin((1 - w.hop / 0.45) * Math.PI) * (a.kind === "cow" ? 0.12 : 0.25) : 0;
    a.g.position.set(w.x, hop, w.z); a.g.rotation.y = w.h;
    a.body.position.y = Math.abs(Math.sin(w.gait)) * (a.kind === "chicken" ? 0.05 : 0.025) * sp;
    a.body.rotation.z = Math.sin(w.gait) * 0.04 * sp;
    const sq = w.state === "happy" ? Math.sin(w.t * 16) * 0.07 : 0; a.body.scale.set(1 - sq, 1 + sq, 1 - sq);
    a.legs.forEach((l, i) => (l.rotation.x = Math.sin(w.gait + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI : 0)) * 0.6 * sp));
    const graze = w.state === "graze" ? (a.kind === "chicken" ? Math.max(0, Math.sin(w.t * 9)) * 1.1 : 0.85) : 0;
    a.head.rotation.x = lerp(a.head.rotation.x, graze, damp(a.kind === "chicken" ? 20 : 4, dt));
    a.head.rotation.y = w.look;
  }
  // ---- feedback systems
  particles.update(dt, 0); pops.update(dt); veg.update(dt, t); crops.update(dt); soil.update(dt);
  // ---- weather around the player
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
  // ---- critters
  const dayish = S.min / 60 > 7 && S.min / 60 < 18 && S.weather === "sun";
  for (const f of flutter) {
    f.g.visible = dayish && S.season < 2;
    f.ph += dt; f.g.position.set(f.cx + Math.sin(f.ph * 0.6) * 2, 0.7 + Math.sin(f.ph * 2.3) * 0.25, f.cz + Math.cos(f.ph * 0.45) * 1.6);
    const wv = Math.sin(f.ph * 22) * 0.9; f.wl.rotation.z = wv; f.wr.rotation.z = -wv; f.g.rotation.y = f.ph * 0.6;
  }
  if (fireflies.material.opacity > 0) {
    const arr = ffGeo.attributes.position.array;
    ffSeed.forEach((s, i) => arr.set([s[0] + Math.sin(t * 0.5 + s[3]) * 0.8, s[1] + Math.sin(t * 1.3 + s[3]) * 0.3, s[2] + Math.cos(t * 0.4 + s[3]) * 0.8], i * 3));
    ffGeo.attributes.position.needsUpdate = true;
  }
  // ---- tile highlighter + prompt
  const [cx, cz] = targetTile();
  const pv = busy ? { ok: false, label: "" } : toolPreview(cx, cz);
  const fishingOut = rod.phase !== "idle";
  const show = !busy && !PA.THUMB && !fishingOut && inBounds(cx, cz) && (pv.ok || !!pv.label || (S.field[key(cx, cz)] && S.tool !== 3));
  highlight.set(pv.ok && pv.tiles ? pv.tiles.filter(([x, z]) => S.field[key(x, z)]) : [[cx, cz]], pv.ok, show);
  highlight.update(dt, t);
  if (!busy) {
    const it = nearestInteract();
    if (pv.ok) setPrompt("Space", pv.label); else if (it) setPrompt("E", it.label); else setPrompt();
  } else setPrompt();
  // ---- camera: smooth follow; zooming far out tilts toward the horizon for a scenic view of the sky
  const aspectBoost = camera.aspect < 0.8 ? 1.35 : 1;
  const open = smooth(17, 24, zoom), dist = zoom * aspectBoost, pitch = lerp(0.88, 0.2, open);
  focusT.set(clamp(P.x, 6, W - 6), 0.3 + open * 0.8, clamp(P.z, 5, H - 4));
  focus.lerp(focusT, damp(5, dt));
  camPos.set(focus.x, focus.y + dist * Math.sin(pitch), focus.z + dist * Math.cos(pitch));
  camera.position.lerp(camPos, damp(6, dt));
  lookAt.set(focus.x, focus.y + open * 2.2, focus.z); camera.lookAt(lookAt);
  npcVisibility(); applyLight(t); renderHUD(); updateMusic();
  if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) renderHint();
}
const inBounds = (x, z) => x >= 0 && z >= 0 && x < W && z < H;

/* ============================================================ start-up */
function boot(fresh) {
  S = fresh || loadSave() || newGame();
  S.forest ||= {};
  applySeason(); refreshField(); refreshForest(); spawnAnimals(); refreshEggs(); renderHotbar(); selectTool(S.tool, true);
  P.x = SPAWN.x; P.z = SPAWN.z; P.vx = P.vz = 0; P.zone = "";
  focus.set(P.x, 0.3, P.z); camera.position.set(P.x, 12, P.z + 10); hudSig = ""; renderHUD();
}
function startPlay() {
  PA.closeOverlay(); started = true; isBusyStart = false;
  for (const id of ["clock", "meters", "dock"]) $(id).hidden = false;
  renderHint(); updateMusic(true);
  PA.sayJP("おはよう！今日もがんばろう！", { pitch: 1.1 });
  PA.toast("Good morning! Let's get to work.");
}
if (PA.params.has("debug")) window.__farm = {
  get S() { return S; }, P, animals, rod, veg, endDay, act, interact, selectTool, talk, openStore, openWorkshop, openShip, openBag, openJournal, feedAnimals, closeDialog,
  get dlg() { return dlg; }, get zoom() { return zoom; }, setZoom(z) { zoom = z; }, setHour(h) { S.min = h * 60; },
  teleport(x, z, fx = 0, fz = 1) { P.x = x; P.z = z; P.fx = fx; P.fz = fz; P.vx = P.vz = 0; focus.set(clamp(x, 6, W - 6), 0.3, clamp(z, 5, H - 4)); },
  get stepMs() { return stepMs; }, tick(sec) { for (let i = 0; i < sec * 60; i++) { simT += 1 / 60; step(1 / 60, simT); } }, hits, pops, highlight, MAP, solidTile, particles,
  info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures }),
};
let stepMs = 0, simT = 0;
const loop = PA.loop((dt, t) => { const t0 = performance.now(); simT = t; step(dt, t); stepMs = stepMs * 0.9 + (performance.now() - t0) * 0.1; renderer.render(scene, camera); });

if (PA.THUMB) {
  // Staged golden-hour scene for gallery thumbnails.
  S = newGame(); S.season = 0; S.day = 5; S.min = 17.6 * 60;
  for (const [k, t] of Object.entries(S.field)) {
    const [x, z] = k.split(",").map(Number); t.obj = null;
    if (x >= 8 && x <= 20 && z >= 10 && z <= 22 && z !== 16) {
      t.till = 1; t.wet = (x + z) % 3 ? 1 : 0;
      const types = ["turnip", "strawberry", "potato", "turnip"];
      t.crop = { t: types[(x + z) % 4], age: Math.max(0, Math.min(8, (x * 3 + z) % 9)), dead: false };
      if (z % 3 === 0) t.crop.age = CROPS[t.crop.t].days;
    } else if (rnd() < 0.2) t.obj = "weed";
  }
  S.eggs = [];
  applySeason(); refreshField(); refreshForest(); spawnAnimals(); refreshEggs(); renderHotbar(); selectTool(1, true);
  P.x = 14.4; P.z = 16.5; P.fx = 0.3; P.fz = 1; started = true; zoom = 19;
  focus.set(17, 0.3, 15); camera.position.set(16, 12, 26);
  for (const id of ["clock", "meters", "dock"]) $(id).hidden = true;
  setTimeout(() => (window.__ready = true), 2200);
} else {
  boot();
  const saved = loadSave();
  const keysHTML = controlsHTML();
  PA.overlay(`<span class="pa-eyebrow">Farming life sim</span><h1>Little Furrow</h1>
    <p>You've inherited a weedy acre at the edge of the valley. Grow crops through four seasons, raise hens, a cow and a sheep, chop wood in the woods, fish the pond, and get to know your neighbors.</p>${keysHTML}
    <div class="pa-actions">${saved ? `<button class="pa-btn" data-cont>Continue · ${SEASONS[saved.season]} ${saved.day}</button><button class="pa-btn ghost" data-new>New farm</button>` : `<button class="pa-btn" data-new>Start farming</button>`}</div>`,
    { "[data-cont]": () => { boot(); startPlay(); }, "[data-new]": () => { boot(newGame()); save(); startPlay(); } });
  addEventListener("pagehide", save);
  setInterval(() => started && !transitioning && save(), 30000);
}

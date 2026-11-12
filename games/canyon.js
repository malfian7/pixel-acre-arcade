// Canyon Circuit — arcade stunt racing through a sunlit red-rock canyon. Pixel Acre Arcade original.
import * as THREE from "three";
import { PA } from "./common.js";
import { buildTrack, MAPS, SP, BANK_MAX, NO_GROUND, centerHeight } from "./canyon-track.js";

/* ================================================================ utils */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth01 = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
let seed = 1337; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const rr = (a, b) => a + rnd() * (b - a);
function hash2(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
function vnoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.28 + vnoise(x * 4.3, y * 4.3) * 0.17;
const fmtT = (t) => { if (t == null || !isFinite(t)) return "—"; const m = Math.floor(t / 60), s = t - m * 60; return `${m}:${s.toFixed(2).padStart(5, "0")}`; };
const AUTO = PA.params.has("auto"), THUMB = PA.THUMB, DEMO = AUTO || THUMB;
const ARCADE = !window.CC_STANDALONE;          // standalone builds have no arcade to return to
const SIM = +PA.params.get("sim") || 0;     // test hook: fixed physics steps per frame (fast-forward)
let PROBE = null;                            // test hook: called after every physics step

/* ================================================================ settings & records */
const DEFAULTS = { assist: 1, shake: 2, ghost: 1, haze: 1, quality: 1, units: 0, vol: 8, music: 7, sfx: 8, mouse: 1, rivals: 1,
  p1: { name: "RACER", model: 0, paint: 0 }, p2: { name: "PLAYER 2", model: 2, paint: 2 } };
const settings = Object.assign({}, DEFAULTS, PA.store.get("canyon:settings", {}));
settings.p1 = Object.assign({}, DEFAULTS.p1, settings.p1); settings.p2 = Object.assign({}, DEFAULTS.p2, settings.p2);
const saveSettings = () => { try { PA.store.set("canyon:settings", settings); } catch {} };
// Which map: ?map=N for tests, otherwise the last one picked on the title screen.
const MAP_I = clamp(Math.round(+(PA.params.get("map") ?? PA.store.get("canyon:map", 0))) || 0, 0, MAPS.length - 1);
const MAP = MAPS[MAP_I], LOOK = MAP.look, CHECKPOINTS = MAP.checkpoints.map((c) => ({ ...c }));
const RKEY = MAP_I ? "canyon:records2:" + MAP.id : "canyon:records2";      // map 1 keeps its old records
let records = PA.store.get(RKEY, { race: null, lap: null, splits: null, ghost: null, medal: 0, wins: 0 });
const saveRecords = () => { if (!DEMO) PA.store.set(RKEY, records); };
const LAPS = 3;
const MEDALS = [{ name: "Gold", t: MAP.medals[0], c: "#ffd34a" }, { name: "Silver", t: MAP.medals[1], c: "#d7dbe6" }, { name: "Bronze", t: MAP.medals[2], c: "#d08a4e" }];

/* ================================================================ renderer, scene, lights */
// Paint banners and signs with the real fonts: wait (briefly) for them first.
if (document.fonts) await Promise.race([Promise.all([document.fonts.load("64px 'Dela Gothic One'"), document.fonts.load("32px DotGothic16")]).catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
const renderer = await PA.renderer(THREE, { clear: LOOK.clear, shadows: true });
renderer.toneMappingExposure = LOOK.exposure;
const scene = new THREE.Scene();
const FOG = new THREE.Color(LOOK.fog);
scene.fog = new THREE.Fog(FOG, 140, 900);
const camera = new THREE.PerspectiveCamera(64, innerWidth / innerHeight, 0.3, 2600);
const hemi = new THREE.HemisphereLight(LOOK.hemi[0], LOOK.hemi[1], LOOK.hemi[2]); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffd2a0, LOOK.sunI);
sun.castShadow = true;
Object.assign(sun.shadow.camera, { left: -70, right: 70, top: 70, bottom: -70, near: 1, far: 420 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);
let sunAz = LOOK.sunAz, sunEl = LOOK.sunEl;   // a low sun, so canyon walls throw long shadows
const sunDir = new THREE.Vector3();
function setSunDir() { sunDir.set(Math.cos(sunEl) * Math.sin(sunAz), Math.sin(sunEl), Math.cos(sunEl) * Math.cos(sunAz)).normalize(); }
setSunDir();
function applyQuality() {
  const hi = settings.quality === 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, hi ? 1.75 : 1));
  sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  resize();
}

/* ---- sky dome: cobalt zenith to warm haze, sun glow baked into vertex colours ---- */
const skyGroup = new THREE.Group(); scene.add(skyGroup);
let skyGeo;
function paintSky() {
  const pos = skyGeo.attributes.position, cols = skyGeo.attributes.color, p = new THREE.Vector3(), c = new THREE.Color();
  const stops = [-0.2, 0, 0.07, 0.2, 0.45, 1].map((y, k) => [y, new THREE.Color(LOOK.sky[k])]);
  const glow = new THREE.Color(LOOK.glow);
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    let k = 0; while (k < stops.length - 2 && p.y > stops[k + 1][0]) k++;
    c.copy(stops[k][1]).lerp(stops[k + 1][1], clamp((p.y - stops[k][0]) / (stops[k + 1][0] - stops[k][0]), 0, 1));
    const g = Math.max(0, p.dot(sunDir)); c.lerp(glow, Math.pow(g, 10) * 0.85 + Math.pow(g, 3) * 0.12);
    cols.setXYZ(i, c.r, c.g, c.b);
  }
  cols.needsUpdate = true;
}
{
  skyGeo = new THREE.SphereGeometry(2000, 48, 24);
  skyGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(skyGeo.attributes.position.count * 3), 3));
  const sky = new THREE.Mesh(skyGeo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -2; skyGroup.add(sky); paintSky();
}
const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(60, 40), new THREE.MeshBasicMaterial({ color: 0xfff5dc, fog: false, toneMapped: false }));
skyGroup.add(sunDisc);
function placeSunDisc() { sunDisc.position.copy(sunDir).multiplyScalar(1900); sunDisc.lookAt(0, 0, 0); }
placeSunDisc();

const YAX = new THREE.Vector3(0, 1, 0), ZAX = new THREE.Vector3(0, 0, 1);
/* ================================================================ track */
const TR = buildTrack(MAP.segments);
const SEGS = Object.values(TR);
const rightOf = (th, out) => out.set(-Math.cos(th), 0, Math.sin(th));
// Projects world (x, z) onto a segment near sample `hint`. Returns arc length s (unclamped at the
// ends, so leaving a segment can be detected), signed lateral offset d (+ = right) and sample index.
const PRJ = { s: 0, d: 0, i: 0, th: 0 };
function project(seg, x, z, hint, out = PRJ) {
  const n = seg.n, X = seg.X, Z = seg.Z;
  let lo = clamp(hint - 12, 0, n - 1), hi = clamp(hint + 12, 0, n - 1), best = lo, bd = 1e18;
  for (let pass = 0; pass < 4; pass++) {
    for (let i = lo; i <= hi; i++) { const dx = x - X[i], dz = z - Z[i], dd = dx * dx + dz * dz; if (dd < bd) { bd = dd; best = i; } }
    if (best > lo && best < hi) break;
    if (best === lo && lo > 0) { hi = lo; lo = Math.max(0, lo - 40); } else if (best === hi && hi < n - 1) { lo = hi; hi = Math.min(n - 1, hi + 40); } else break;
  }
  let a = best, b = best + 1;
  if (b > n - 1) { a = n - 2; b = n - 1; }
  else if (best > 0) { // pick the neighbouring side the point lies on
    const tx = X[b] - X[a], tz = Z[b] - Z[a];
    if ((x - X[a]) * tx + (z - Z[a]) * tz < 0) { a = best - 1; b = best; }
  }
  const tx = X[b] - X[a], tz = Z[b] - Z[a], L2 = tx * tx + tz * tz;
  let t = ((x - X[a]) * tx + (z - Z[a]) * tz) / L2;
  if (a > 0 && b < n - 1) t = clamp(t, 0, 1);
  const th = seg.TH[a] + wrapA(seg.TH[b] - seg.TH[a]) * clamp(t, 0, 1);
  const cx = X[a] + tx * t, cz = Z[a] + tz * t;
  out.s = (a + t) * SP; out.d = (x - cx) * -Math.cos(th) + (z - cz) * Math.sin(th); out.i = clamp(Math.round(a + t), 0, n - 1); out.th = th;
  return out;
}
function frameAt(seg, s, out) {
  const f = clamp(s / SP, 0, seg.n - 1.0001), i = Math.floor(f), t = f - i;
  out.x = lerp(seg.X[i], seg.X[i + 1], t); out.z = lerp(seg.Z[i], seg.Z[i + 1], t);
  out.y = lerp(seg.Y[i], seg.Y[i + 1], t); out.th = seg.TH[i] + wrapA(seg.TH[i + 1] - seg.TH[i]) * t; out.i = i;
  return out;
}
const inGap = (seg, s) => seg.gaps.some((g) => s > g.s0 && s < g.s1);
// Surface at (s, d): flat road, then a quarter-pipe bank on each side that ends in the hard wall.
const SURF = { y: 0, slopeLat: 0, limit: 0, u: 0, R: 5, open: 0, center: 0 };
function surface(seg, s, d, out = SURF) {
  const f = clamp(s / SP, 0, seg.n - 1.0001), i = Math.floor(f);
  const hw = seg.HW[i], side = d < 0 ? -1 : 1, open = seg.OPEN[i] === side;
  const R = side < 0 ? seg.RL[i] : seg.RR[i];
  const base = centerHeight(seg, s);
  out.center = base; out.open = open; out.R = R;
  const u = Math.abs(d) - hw;
  if (open) { out.limit = hw + 0.7; out.u = 0; out.y = base; out.slopeLat = 0; return out; }
  out.limit = hw + R * BANK_MAX;
  if (u <= 0 || base === NO_GROUND) { out.u = 0; out.y = base; out.slopeLat = 0; return out; }
  const uu = Math.min(u, R * BANK_MAX);
  out.u = uu; out.y = base + R - Math.sqrt(R * R - uu * uu); out.slopeLat = side * uu / Math.sqrt(R * R - uu * uu);
  return out;
}

/* ================================================================ materials & textures */
const canvasTex = (w, h, draw, srgb = true) => {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
};
const roadTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = "#7b6660"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++) { g.fillStyle = ["#6d5955", "#88736d", "#7f6a64", "#665450"][i % 4]; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  for (let i = 0; i < 18; i++) { g.strokeStyle = "rgba(40,28,26,.25)"; g.lineWidth = 1; g.beginPath(); let x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (Math.random() - 0.5) * 20; y += Math.random() * 18; g.lineTo(x, y); } g.stroke(); }
  g.fillStyle = "#f3e2c4"; g.fillRect(5, 0, 5, h); g.fillRect(w - 10, 0, 5, h);
  g.fillStyle = "#ff9a2a"; g.fillRect(w / 2 - 3, 0, 6, h * 0.5);
});
roadTex.wrapT = THREE.RepeatWrapping;
const sandTex = canvasTex(128, 256, (g, w, h) => {
  g.fillStyle = "#d9a874"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2400; i++) { g.fillStyle = ["#cf9b66", "#e4b884", "#c8925d", "#efc796"][i % 4]; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
  for (const x of [0.3, 0.38, 0.62, 0.7]) { g.fillStyle = "rgba(150,96,58,.35)"; g.fillRect(w * x, 0, 5, h); }
  for (let i = 0; i < 40; i++) { g.fillStyle = ["#a77b55", "#8b6a54", "#efd4b0"][i % 3]; g.beginPath(); g.arc(Math.random() * w, Math.random() * h, 1.5 + Math.random() * 2.5, 0, 7); g.fill(); }
});
sandTex.wrapT = THREE.RepeatWrapping;
const roadMat = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.92, metalness: 0 });
const sandMat = new THREE.MeshStandardMaterial({ map: sandTex, roughness: 1, metalness: 0 });
const bankMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, flatShading: true });
const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true });
const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true, ...o });
const STRATA = ["#b8462a", "#c9593a", "#d9714a", "#e89a6a", "#f2c48d", "#d26a43", "#a83e27", "#c25236", "#e3855a", "#f0b27a"].map((c) => new THREE.Color(c));
function strataColor(y, x, z, out) {
  const t = (y + fbm(x * 0.01, z * 0.01) * 6) / 5.5;
  const k = Math.floor(t), f = t - k;
  out.copy(STRATA[((k % STRATA.length) + STRATA.length) % STRATA.length]).lerp(STRATA[(((k + 1) % STRATA.length) + STRATA.length) % STRATA.length], smooth01((f - 0.75) / 0.25));
  return out;
}

/* ================================================================ terrain: plateau carved by every road */
const PLATEAU = (x, z) => 64 + fbm(x * 0.006 + 3, z * 0.006 + 7) * 22 + Math.max(0, vnoise(x * 0.002, z * 0.002) - 0.55) * 60;
const terraces = (t) => { t = clamp(t, 0, 1); const s = t * 4.5, k = Math.floor(s), f = s - k; return Math.min(1, (k + smooth01((f - 0.55) / 0.45)) / 4.5); };
const HCELL = 40, hashGrid = new Map();
for (const seg of SEGS) { seg.SN = seg.TH.map(Math.sin); seg.CS = seg.TH.map(Math.cos); }
for (const seg of SEGS) for (let i = 0; i < seg.n; i++) {
  const k = Math.floor(seg.X[i] / HCELL) + "," + Math.floor(seg.Z[i] / HCELL);
  if (!hashGrid.has(k)) hashGrid.set(k, []); hashGrid.get(k).push(seg, i);
}
function carvedHeight(x, z) {
  const plat = PLATEAU(x, z), cx = Math.floor(x / HCELL), cz = Math.floor(z / HCELL);
  // Inside any road's corridor, only corridor floors count, so a nearby lower road can't scoop the
  // ground out from under a higher one; elsewhere every road carves its walls (lowest wins).
  let h = plat, floor = Infinity;
  for (let ox = -2; ox <= 2; ox++) for (let oz = -2; oz <= 2; oz++) {
    const list = hashGrid.get((cx + ox) + "," + (cz + oz)); if (!list) continue;
    for (let q = 0; q < list.length; q += 2) {
      const seg = list[q], i = list[q + 1], dx = x - seg.X[i], dz = z - seg.Z[i];
      if (dx * dx + dz * dz > 95 * 95) continue;
      const sn = seg.SN[i], cs = seg.CS[i], along = dx * sn + dz * cs, lat = -dx * cs + dz * sn;
      const w = Math.hypot(Math.max(0, Math.abs(along) - 1.2), lat), side = lat < 0 ? -1 : 1;
      const hw = seg.HW[i], R = side < 0 ? seg.RL[i] : seg.RR[i], base = seg.Y[i], edge = hw + R * BANK_MAX, topH = R * 0.66;
      let c, corridor = false;
      if (seg.TUN[i]) { if (w < 30) { c = base - 3; corridor = true; } else continue; }
      else if (seg.OPEN[i] === side && Math.abs(along) < 3) { corridor = w < hw + 1; c = corridor ? base - 1.5 : base - 2 - 13 * smooth01((w - hw - 1) / 9) + Math.max(0, w - hw - 24) * 1.6; }
      else if (inGap(seg, i * SP) && Math.abs(along) < 3) { corridor = w < edge + 6; c = corridor ? base - 46 : base - 46 + (plat - base + 46) * terraces((w - edge - 6) / 34); }
      else { corridor = w < edge - 0.6; c = corridor ? base - 1.5 : base + topH * 0.9 + (plat - base - topH) * terraces((w - edge + 0.6) / (26 + vnoise(x * 0.03, z * 0.03) * 16)); }
      if (corridor) { if (c < floor) floor = c; }
      else if (c < h) h = c;
    }
  }
  return floor < Infinity ? floor : h;
}
// True when (x, z) lies inside any road's drivable corridor (road + banks) plus a margin — used to keep
// scenery off the track, including off a neighbouring branch where two roads run side by side.
function inCorridor(x, z, margin = 1, y = null) {
  const cx = Math.floor(x / HCELL), cz = Math.floor(z / HCELL);
  for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) {
    const list = hashGrid.get((cx + ox) + "," + (cz + oz)); if (!list) continue;
    for (let q = 0; q < list.length; q += 2) {
      const seg = list[q], i = list[q + 1], dx = x - seg.X[i], dz = z - seg.Z[i];
      const along = dx * seg.SN[i] + dz * seg.CS[i]; if (Math.abs(along) > SP * 0.75) continue;
      const lat = -dx * seg.CS[i] + dz * seg.SN[i], R = lat < 0 ? seg.RL[i] : seg.RR[i];
      const lim = seg.OPEN[i] === (lat < 0 ? -1 : 1) ? seg.HW[i] + 0.7 : seg.HW[i] + R * BANK_MAX;
      if (Math.abs(lat) < lim + margin && (y == null || Math.abs(y - seg.Y[i]) < 14)) return true;
    }
  }
  return false;
}
// Where two branches share ground (just after a fork, just before a merge) this finds the sibling
// road under a point: returns its lateral offset there, or null.
function siblingAt(seg, i, x, z) {
  for (const [list, hintOf] of [[seg.sib, () => i], [seg.mergeSib, (o) => o.n - (seg.n - i)]]) for (const o of list) {
    project(o, x, z, clamp(hintOf(o), 0, o.n - 1), PRJ2);
    if (PRJ2.s >= 0 && PRJ2.s <= o.len) return { o, d: PRJ2.d, i: PRJ2.i };
  }
  return null;
}
const PRJ2 = { s: 0, d: 0, i: 0, th: 0 };
const TB = { x0: -260, x1: 980, z0: -780, z1: 420, step: 5 };
let terrainMesh;
{
  const nx = Math.round((TB.x1 - TB.x0) / TB.step), nz = Math.round((TB.z1 - TB.z0) / TB.step);
  const g = new THREE.PlaneGeometry(TB.x1 - TB.x0, TB.z1 - TB.z0, nx, nz); g.rotateX(-Math.PI / 2);
  g.translate((TB.x0 + TB.x1) / 2, 0, (TB.z0 + TB.z1) / 2);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const edge = Math.min(x - TB.x0, TB.x1 - x, z - TB.z0, TB.z1 - z);
    pos.setY(i, carvedHeight(x, z) + Math.max(0, 60 - edge) * 0.6);
  }
  g.computeVertexNormals();
  const nrm = g.attributes.normal, col = new Float32Array(pos.count * 3), c = new THREE.Color(), top = new THREE.Color("#e2a66e"), scrub = new THREE.Color("#a9a067"), SANDF = new THREE.Color("#d88d58");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ny = nrm.getY(i);
    strataColor(y, x, z, c);
    if (ny > 0.86) { c.lerp(y < 30 ? SANDF : top, y < 30 ? 0.8 : 0.55); if (y > 50 && vnoise(x * 0.05, z * 0.05) > 0.62) c.lerp(scrub, 0.45); }
    if (y < -24) c.multiplyScalar(0.8);
    c.offsetHSL(0, 0, (hash2(x * 0.7, z * 0.7) - 0.5) * 0.04);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  terrainMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: false })); terrainMesh.castShadow = true; terrainMesh.receiveShadow = true;
  terrainMesh.matrixAutoUpdate = false; terrainMesh.updateMatrix(); scene.add(terrainMesh);
}
// Distant buttes ring the valley so the horizon reads as more canyon country.
{
  const geos = [];
  seed = 77;
  for (let i = 0; i < 26; i++) {
    const a = (i / 26) * Math.PI * 2 + rr(-0.08, 0.08), rad = rr(1150, 1500), cx = 340 + Math.cos(a) * rad, cz = -180 + Math.sin(a) * rad;
    const h = rr(60, 190), r = rr(60, 170), sides = 7 + Math.floor(rnd() * 4);
    const geo = new THREE.CylinderGeometry(r * rr(0.75, 0.95), r, h, sides, 3);
    const p = geo.attributes.position;
    for (let k = 0; k < p.count; k++) { const y = p.getY(k); p.setX(k, p.getX(k) * (1 + (hash2(k, i) - 0.5) * 0.18)); p.setZ(k, p.getZ(k) * (1 + (hash2(i, k) - 0.5) * 0.18)); if (y > -h / 2 + 1 && y < h / 2 - 1) p.setY(k, y + (hash2(k * 3, i) - 0.5) * 8); }
    geo.translate(cx, h / 2 - 10, cz); geos.push(geo);
  }
  for (const geo of geos) {
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let k = 0; k < p.count; k++) { strataColor(p.getY(k), p.getX(k), p.getZ(k), c); c.lerp(FOG, 0.35); col.set([c.r, c.g, c.b], k * 3); }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, rockMat); m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m);
  }
}

/* ================================================================ road surfaces, banks, features */
const BANK_ANG = [70, 54, 38, 24, 11, 0].map((d) => (d * Math.PI) / 180);   // outer → inner
const ROCK_A = new THREE.Color("#c97a4a"), ROCK_B = new THREE.Color("#d68b58"), CHEV_A = new THREE.Color("#ff7a1e"), CHEV_B = new THREE.Color("#fff0d2"), CURB_R = new THREE.Color("#d8352a"), CURB_W = new THREE.Color("#f6ead8");
// A bank is left out where it would stand on a sibling branch's road (or, for the shortcut, anywhere
// inside the main branch's corridor, where the main branch already draws one).
function hiddenBank(seg, i, sg) {
  if (!seg.sib.length && !seg.mergeSib.length) return false;
  if (i * SP > 200 && seg.len - i * SP > 200) return false;
  const th = seg.TH[i], R = sg > 0 ? seg.RR[i] : seg.RL[i];
  for (const u of [0.3, R * BANK_MAX * 0.5, R * BANK_MAX]) {
    const d = sg * (seg.HW[i] + u), x = seg.X[i] - Math.cos(th) * d, z = seg.Z[i] + Math.sin(th) * d;
    const sb = siblingAt(seg, i, x, z); if (!sb) continue;
    const j = clamp(sb.i, 0, sb.o.n - 1), Ro = sb.d < 0 ? sb.o.RL[j] : sb.o.RR[j];
    const lim = seg.def.shortcut ? sb.o.HW[j] + Ro * BANK_MAX + 0.3 : sb.o.HW[j] - 0.2;
    if (Math.abs(sb.d) < lim) return true;
  }
  return false;
}
function buildRoad(seg) {
  const n = seg.n, cols = 2, pos = new Float32Array(n * cols * 3), uv = new Float32Array(n * cols * 2), idx = [];
  // road
  for (let i = 0; i < n; i++) {
    const th = seg.TH[i], rx = -Math.cos(th), rz = Math.sin(th), hw = seg.HW[i];
    for (let c = 0; c < 2; c++) {
      const d = c ? hw : -hw, o = i * 2 + c;
      pos.set([seg.X[i] + rx * d, seg.Y[i] + (seg.def.shortcut ? 0.05 : 0.02), seg.Z[i] + rz * d], o * 3); uv.set([c, (i * SP) / 9], o * 2);
    }
    if (i < n - 1 && !inGap(seg, i * SP + 1)) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const road = new THREE.Mesh(g, seg.def.surface === "sand" ? sandMat : roadMat); road.receiveShadow = true; scene.add(road);
  // banks (both sides): 6 columns per side from the hard-wall lip down to the road edge. Built flat-
  // coloured per quad so the curb stripes and wall-ride chevrons stay crisp.
  const C = BANK_ANG.length, P = new Float32Array(n * 2 * C * 3), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const th = seg.TH[i], rx = -Math.cos(th), rz = Math.sin(th), hw = seg.HW[i];
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1, R = side ? seg.RR[i] : seg.RL[i], open = seg.OPEN[i] === sg;
      for (let k = 0; k < C; k++) {
        const kk = side ? C - 1 - k : k, phi = BANK_ANG[kk];
        let u = R * Math.sin(phi) * (BANK_MAX / Math.sin(BANK_ANG[0])), h = R - Math.sqrt(Math.max(0, R * R - u * u));
        if (open) { u = kk === C - 1 ? 0 : 0.7; h = kk >= C - 2 ? 0 : 0.9; }
        const d = sg * (hw + u), o = ((i * 2 + side) * C + k) * 3;
        P[o] = seg.X[i] + rx * d; P[o + 1] = seg.Y[i] + h + 0.01; P[o + 2] = seg.Z[i] + rz * d;
      }
    }
  }
  const bpos = [], bcol = [], v = (i, side, k) => { const o = ((i * 2 + side) * C + k) * 3; bpos.push(P[o], P[o + 1], P[o + 2]); };
  for (let i = 0; i < n - 1; i++) {
    const s = i * SP; if (inGap(seg, s + 1)) continue;
    for (let side = 0; side < 2; side++) {
      const sg = side ? 1 : -1, R = side ? seg.RR[i] : seg.RL[i], open = seg.OPEN[i] === sg, wallride = R > 6.5;
      if (hiddenBank(seg, i, sg)) continue;
      for (let k = 0; k < C - 1; k++) {
        const band = side ? C - 2 - k : k;     // 0 = wall lip … 4 = next to the road
        const stripe = Math.floor(s / 4) % 2 === 0;
        if (band === 4 || (open && band === 3)) col.copy(stripe ? CURB_R : CURB_W);
        else if (wallride && band >= 1) col.copy(Math.floor(s / 6) % 2 ? CHEV_A : CHEV_B);
        else col.copy(ROCK_A).lerp(ROCK_B, hash2(i, band * 7 + side));
        v(i, side, k); v(i, side, k + 1); v(i + 1, side, k); v(i, side, k + 1); v(i + 1, side, k + 1); v(i + 1, side, k);
        for (let q = 0; q < 6; q++) bcol.push(col.r, col.g, col.b);
      }
    }
  }
  const bg = new THREE.BufferGeometry(); bg.setAttribute("position", new THREE.Float32BufferAttribute(bpos, 3)); bg.setAttribute("color", new THREE.Float32BufferAttribute(bcol, 3)); bg.computeVertexNormals();
  const banks = new THREE.Mesh(bg, bankMat); banks.receiveShadow = true; banks.material.side = THREE.DoubleSide; scene.add(banks);
}
for (const seg of SEGS) buildRoad(seg);

// Text banners for gates and signs.
function bannerTex(text, { bg = "#2a1410", fg = "#ffb23e", w = 1024, h = 160, checker = false } = {}) {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    if (checker) { const s = h / 4; for (let y = 0; y < 4; y++) for (let x = 0; x < w / s; x++) if ((x + y) % 2 === 0 && (x < 6 || x > w / s - 7)) { g.fillStyle = "#f6dcb0"; g.fillRect(x * s, y * s, s, s); } }
    g.fillStyle = fg; g.font = `${Math.round(h * 0.52)}px 'Dela Gothic One', 'Arial Black', sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2 + 4);
  });
}
// Gates: a big FINISH gantry on the start line, steel checkpoint arches elsewhere. The next gate glows.
const gates = [];
const fr = { x: 0, y: 0, z: 0, th: 0, i: 0 }, tmpV = new THREE.Vector3(), tmpR = new THREE.Vector3();
const steel = std("#2b2a30", { roughness: 0.5, metalness: 0.6, flatShading: false }), orangeM = std("#f26a1b", { roughness: 0.6 });
function checkerTex(w, h, cells) { return canvasTex(w, h, (g) => { const s = h / cells; for (let y = 0; y < cells; y++) for (let x = 0; x < w / s; x++) { g.fillStyle = (x + y) % 2 ? "#141418" : "#f4f1ea"; g.fillRect(x * s, y * s, s, s); } }); }
CHECKPOINTS.forEach((cp, k) => {
  const seg = TR[cp.seg], s = cp.f * seg.len; cp.s = s; cp.segRef = seg;
  frameAt(seg, s, fr); rightOf(fr.th, tmpR);
  const g = new THREE.Group(); g.position.set(fr.x, fr.y, fr.z); g.rotation.y = fr.th; scene.add(g);
  const span = seg.HW[fr.i] + Math.max(seg.RL[fr.i], seg.RR[fr.i]) * BANK_MAX + 1.6;
  let mat, glowH;
  if (k === 0) {
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(2.2, 15, 2.2), steel); p.position.set(sx * span, 7.5, 0); p.castShadow = true; g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 2.2, 3.6, 1.4), steel); beam.position.set(0, 13.4, 0); beam.castShadow = true; g.add(beam);
    mat = new THREE.MeshStandardMaterial({ map: bannerTex("FINISH", { bg: "#16151a", fg: "#f4f1ea", w: 1024, h: 180 }), emissive: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
    mat.emissiveMap = mat.map;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, 3.1), mat); face.position.set(0, 13.6, -0.71); face.rotation.y = Math.PI; g.add(face);
    const back = face.clone(); back.position.z = 0.71; back.rotation.y = 0; g.add(back);
    const chk = new THREE.Mesh(new THREE.PlaneGeometry(span * 2 + 2.2, 1.3), new THREE.MeshStandardMaterial({ map: checkerTex(1024, 64, 2), side: THREE.DoubleSide, roughness: 0.7 }));
    chk.position.set(0, 11, 0); g.add(chk);
    for (let q = 0; q < 6; q++) { const b = new THREE.Mesh(new THREE.BoxGeometry(2, 1.1, 1.1), new THREE.MeshStandardMaterial({ color: 0xf26a1b, emissive: 0xf26a1b, emissiveIntensity: 0.6 })); b.position.set((q - 2.5) * 3.4, 15.9, 0); g.add(b); }
    // painted start/finish line and grid boxes just beyond it
    const line = new THREE.Mesh(new THREE.PlaneGeometry(seg.HW[fr.i] * 2, 1.6), new THREE.MeshStandardMaterial({ map: checkerTex(512, 64, 2), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
    line.rotation.x = -Math.PI / 2; line.position.y = 0.04; g.add(line);
    glowH = 13;
  } else {
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 12, 0.9), steel); p.position.set(sx * span, 6, 0); p.castShadow = true; g.add(p); }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span * 2 + 0.9, 1.8, 0.8), steel); beam.position.set(0, 11.6, 0); g.add(beam);
    mat = new THREE.MeshStandardMaterial({ map: bannerTex(`CHECKPOINT ${k}`, { bg: "#f26a1b", fg: "#16151a", w: 1024, h: 120 }), emissive: 0xffffff, roughness: 0.6, side: THREE.DoubleSide });
    mat.emissiveMap = mat.map;
    const face = new THREE.Mesh(new THREE.PlaneGeometry(span * 1.4, 1.5), mat); face.position.set(0, 11.6, -0.41); face.rotation.y = Math.PI; g.add(face);
    const back = face.clone(); back.position.z = 0.41; back.rotation.y = 0; g.add(back);
    glowH = 11;
  }
  mat.emissiveIntensity = 0.15;
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(span * 2, glowH), new THREE.MeshBasicMaterial({ color: 0xffb23e, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  glow.position.y = glowH / 2; g.add(glow);
  gates.push({ g, mat, glow, cp });
});
// Starting grid: three staggered slots just past the line.
const GRID = [[16, -3.2], [10, 3.2], [4, -3.2]];
{
  const seg = TR[CHECKPOINTS[0].seg], s0 = CHECKPOINTS[0].f * seg.len, boxTex = canvasTex(128, 256, (g, w, h) => { g.strokeStyle = "#f4f1ea"; g.lineWidth = 9; g.beginPath(); g.moveTo(6, h - 6); g.lineTo(6, 6); g.lineTo(w - 6, 6); g.lineTo(w - 6, h - 6); g.stroke(); });
  const boxMat = new THREE.MeshBasicMaterial({ map: boxTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const [ds, d] of GRID) {
    frameAt(seg, s0 + ds, fr); rightOf(fr.th, tmpR);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 5.6), boxMat); m.rotation.order = "YXZ"; m.rotation.set(-Math.PI / 2, fr.th, 0);
    m.position.set(fr.x + tmpR.x * d, fr.y + 0.035, fr.z + tmpR.z * d); scene.add(m);
  }
  // floodlight poles along the start straight
  const pole = new THREE.CylinderGeometry(0.16, 0.22, 11, 8), head = new THREE.BoxGeometry(1.6, 0.5, 0.9), lampM = new THREE.MeshBasicMaterial({ color: 0xfff1d6, toneMapped: false });
  for (let ss = 40; ss < 330; ss += 48) for (const side of [-1, 1]) {
    frameAt(seg, ss + (side > 0 ? 24 : 0), fr); rightOf(fr.th, tmpR);
    const R = side > 0 ? seg.RR[fr.i] : seg.RL[fr.i], d = side * (seg.HW[fr.i] + R * BANK_MAX + 1.2);
    if (inCorridor(fr.x + tmpR.x * d, fr.z + tmpR.z * d, 0.6)) continue;
    const g = new THREE.Group(); g.position.set(fr.x + tmpR.x * d, fr.y + R * 0.66, fr.z + tmpR.z * d); g.rotation.y = fr.th; scene.add(g);
    const p = new THREE.Mesh(pole, steel); p.position.y = 5.5; p.castShadow = true; g.add(p);
    const h = new THREE.Mesh(head, steel); h.position.set(-side * 0.7, 11, 0); g.add(h);
    const l = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.7), lampM); l.rotation.x = Math.PI / 2; l.position.set(-side * 0.7, 10.74, 0); g.add(l);
  }
}
// Steel guardrails along the lip of ordinary edges and the open cliff ledge (wall-ride walls stay bare).
{
  const posts = [], rails = [];
  for (const seg of SEGS) for (let i = 2; i < seg.n - 2; i += 2) {
    if (seg.TUN[i] || inGap(seg, i * SP) || inGap(seg, (i + 2) * SP)) continue;
    const j = i + 2, thi = seg.TH[i];
    for (const side of [-1, 1]) {
      const R = side > 0 ? seg.RR[i] : seg.RL[i], open = seg.OPEN[i] === side;
      if (R > 6.5 && !open) continue;
      const off = open ? seg.HW[i] + 0.75 : seg.HW[i] + R * BANK_MAX + 0.15, h0 = open ? 0.9 : R - Math.sqrt(R * R - (R * BANK_MAX) ** 2);
      const x0 = seg.X[i] - Math.cos(thi) * side * off, z0 = seg.Z[i] + Math.sin(thi) * side * off, y0 = seg.Y[i] + h0;
      const thj = seg.TH[j], x1 = seg.X[j] - Math.cos(thj) * side * off, z1 = seg.Z[j] + Math.sin(thj) * side * off, y1 = seg.Y[j] + h0;
      posts.push([x0, y0, z0]); rails.push([(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.atan2(x1 - x0, z1 - z0), Math.hypot(x1 - x0, z1 - z0), Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0))]);
    }
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(0, 0, 0, "YXZ"), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 1.0, 0.14), steel, posts.length);
  posts.forEach(([x, y, z], k) => pm.setMatrixAt(k, m4.compose(pv.set(x, y + 0.5, z), q.identity(), sv.set(1, 1, 1))));
  const rail = new THREE.BoxGeometry(0.1, 0.32, 1);
  const rm = new THREE.InstancedMesh(rail, std("#b9b8bf", { roughness: 0.35, metalness: 0.7, flatShading: false }), rails.length);
  rails.forEach(([x, y, z, ry, L, rx], k) => rm.setMatrixAt(k, m4.compose(pv.set(x, y + 0.82, z), q.setFromEuler(e.set(-rx, ry, 0)), sv.set(1, 1, L + 0.05))));
  pm.castShadow = rm.castShadow = true; rm.receiveShadow = true; scene.add(pm, rm);
}
// Boost pads: scrolling chevrons laid on the road.
const padTex = canvasTex(64, 128, (g, w, h) => {
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#fff"; g.lineWidth = 12; g.lineJoin = "round";
  for (const y of [28, 92]) { g.beginPath(); g.moveTo(8, y + 18); g.lineTo(w / 2, y - 12); g.lineTo(w - 8, y + 18); g.stroke(); }
});
padTex.wrapT = THREE.RepeatWrapping;
const padMat = new THREE.MeshBasicMaterial({ map: padTex, color: 0xffa23a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
const pads = [];
for (const seg of SEGS) for (const f of seg.def.pads || []) {
  const s = f * seg.len; frameAt(seg, s, fr);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 8), padMat); m.rotation.set(-Math.PI / 2, 0, 0); const holder = new THREE.Group(); holder.position.set(fr.x, fr.y + 0.06, fr.z); holder.rotation.y = fr.th; m.rotation.z = Math.PI; holder.add(m); scene.add(holder);
  pads.push({ seg, s });
}

// Hoodoos: stacked sandstone pillars, some standing in the road as near-miss targets.
const pillars = [];
function hoodoo(x, y, z, r, h, parent = scene) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  let yy = 0, rad = r;
  const tiers = 3 + Math.floor(rnd() * 2);
  for (let k = 0; k < tiers; k++) {
    const th = h / tiers * rr(0.8, 1.2), geo = new THREE.CylinderGeometry(rad * rr(0.75, 0.95), rad, th, 7, 1);
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let q = 0; q < p.count; q++) { strataColor(y + yy + p.getY(q) + th / 2, x, z, c); col.set([c.r, c.g, c.b], q * 3); }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const m = new THREE.Mesh(geo, rockMat); m.position.set(rr(-0.15, 0.15) * r, yy + th / 2, rr(-0.15, 0.15) * r); m.rotation.y = rnd() * 3; m.castShadow = m.receiveShadow = true; g.add(m);
    yy += th; rad *= rr(0.72, 0.95);
  }
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(rad * 1.6, rad * 1.2, 0.9, 7), std("#7a3020")); cap.position.y = yy + 0.4; cap.castShadow = true; g.add(cap);
  return g;
}
seed = 4242;
for (const seg of SEGS) for (const [f, d, r] of seg.def.rocks || []) {
  const s = f * seg.len; frameAt(seg, s, fr); rightOf(fr.th, tmpR);
  const x = fr.x + tmpR.x * d, z = fr.z + tmpR.z * d, h = rr(9, 15);
  hoodoo(x, fr.y, z, r, h); pillars.push({ x, z, r, y: fr.y, top: fr.y + h, seg, s, near: false, minD: 99 });
}

// Natural arch over the Arch Gap and the rock tunnel block.
for (const seg of SEGS) if (seg.def.arch != null) {
  const s = seg.def.arch * seg.len; frameAt(seg, s, fr);
  const geo = new THREE.TorusGeometry(34, 5.5, 9, 40, Math.PI), p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); const n = (vnoise(x * 0.12, y * 0.12 + z * 0.3) - 0.5) * 3.2; p.setXYZ(i, x + n, y * 1.25 + n, z * (1 + (y / 60)) + n * 0.6); }
  geo.computeVertexNormals();
  const col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { strataColor(p.getY(i) + fr.y, p.getX(i), p.getZ(i), c); col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const arch = new THREE.Mesh(geo, rockMat); arch.position.set(fr.x, fr.y - 12, fr.z); arch.rotation.y = fr.th; arch.castShadow = arch.receiveShadow = true; scene.add(arch);
}
const tunnels = [];
for (const seg of SEGS) if (seg.def.tunnel) {
  const [f0, f1] = seg.def.tunnel, s0 = f0 * seg.len - 4, s1 = f1 * seg.len + 4;
  const a = frameAt(seg, s0, {}), b = frameAt(seg, s1, {});
  const hw = seg.HW[a.i] + seg.RL[a.i] * BANK_MAX, wallH = 5, half = 34, height = 74;
  const shape = new THREE.Shape(); shape.moveTo(-half, -3); shape.lineTo(half, -3); shape.lineTo(half, height); shape.lineTo(-half, height); shape.closePath();
  const hole = new THREE.Path(); hole.moveTo(-hw, -3); hole.lineTo(hw, -3); hole.lineTo(hw, wallH); hole.absarc(0, wallH, hw, 0, Math.PI, false); hole.lineTo(-hw, -3); shape.holes.push(hole);
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: len, bevelEnabled: false, curveSegments: 18 });
  const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) { const y = p.getY(i); strataColor(y + a.y, p.getX(i), p.getZ(i), c); if (Math.abs(p.getX(i)) < hw + 0.1 && y < wallH + hw + 0.1) c.multiplyScalar(0.55); col.set([c.r, c.g, c.b], i * 3); }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const m = new THREE.Mesh(geo, rockMat); m.castShadow = m.receiveShadow = true;
  m.position.set(a.x, a.y, a.z); m.rotation.y = Math.atan2(b.x - a.x, b.z - a.z); scene.add(m);
  // ceiling light strips
  const strips = new THREE.InstancedMesh(new THREE.BoxGeometry(3.2, 0.25, 1.2), new THREE.MeshBasicMaterial({ color: 0xffd38a, toneMapped: false }), Math.floor(len / 10));
  for (let k = 0; k < strips.count; k++) { tmpV.set(0, wallH + hw - 0.4, 5 + k * 10); strips.setMatrixAt(k, new THREE.Matrix4().makeTranslation(tmpV.x, tmpV.y, tmpV.z)); }
  m.add(strips);
  tunnels.push({ seg, s0: f0 * seg.len, s1: f1 * seg.len, roof: a.y + wallH + hw - 1.2 });
}
// Arrow boards on the outside of sharp bends, so fast corners stay readable.
const arrowTex = canvasTex(256, 128, (g, w, h) => {
  g.fillStyle = "#ffb23e"; g.fillRect(0, 0, w, h); g.fillStyle = "#2a1410";
  for (let k = 0; k < 3; k++) { const x = 40 + k * 70; g.beginPath(); g.moveTo(x, 20); g.lineTo(x + 40, h / 2); g.lineTo(x, h - 20); g.lineTo(x + 18, h - 20); g.lineTo(x + 58, h / 2); g.lineTo(x + 18, 20); g.closePath(); g.fill(); }
});
const arrowMat = std("#ffffff", { map: arrowTex, emissive: 0xffffff, emissiveMap: arrowTex, emissiveIntensity: 0.25 });
const postGeo = new THREE.BoxGeometry(0.25, 3.4, 0.25), boardGeo = new THREE.BoxGeometry(3, 1.5, 0.2);
for (const seg of SEGS) {
  for (let i = 6; i < seg.n - 6; i += 9) {
    const k = wrapA(seg.TH[i + 4] - seg.TH[i - 4]) / 16;      // curvature (rad/m)
    if (Math.abs(k) < 1 / 110 || inGap(seg, i * SP)) continue;
    const side = k > 0 ? 1 : -1;  // heading angle increasing = turning left → outside is the right
    if (seg.OPEN[i] === side) continue;
    const R = side > 0 ? seg.RR[i] : seg.RL[i], d = side * (seg.HW[i] + R * BANK_MAX + 1.6);
    rightOf(seg.TH[i], tmpR);
    if (inCorridor(seg.X[i] + tmpR.x * d, seg.Z[i] + tmpR.z * d, 0.8)) continue;
    const g = new THREE.Group(); g.position.set(seg.X[i] + tmpR.x * d, seg.Y[i] + R * 0.66, seg.Z[i] + tmpR.z * d); g.rotation.y = seg.TH[i] + Math.PI; scene.add(g);
    const post = new THREE.Mesh(postGeo, std("#3a1d16")); post.position.y = 1.7; g.add(post);
    const b = new THREE.Mesh(boardGeo, arrowMat); b.position.y = 3.2; b.scale.x = side > 0 ? -1 : 1; g.add(b);
  }
}
// Scattered boulders and desert scrub along the canyon floor and rims (instanced).
{
  seed = 99;
  const boulders = [], scrubs = [], cacti = [];
  for (const seg of SEGS) for (let i = 2; i < seg.n - 2; i += 3) {
    if (seg.TUN[i] || inGap(seg, i * SP)) continue;
    rightOf(seg.TH[i], tmpR);
    for (const side of [-1, 1]) {
      if (seg.OPEN[i] === side || rnd() < 0.55) continue;
      const R = side > 0 ? seg.RR[i] : seg.RL[i], d = side * (seg.HW[i] + R * BANK_MAX + rr(1.5, 7));
      const x = seg.X[i] + tmpR.x * d, z = seg.Z[i] + tmpR.z * d;
      const y = Math.max(carvedHeight(x, z), seg.Y[i] + R * 0.6);
      if (inCorridor(x, z, 1.4, y)) { rnd(); rr(0, 1); continue; }
      const r = rnd(); if (r < 0.45) boulders.push([x, y, z, rr(0.6, 2.2)]); else if (r < 0.75) cacti.push([x, y, z, rr(0.8, 1.5)]); else scrubs.push([x, y, z, rr(0.6, 1.3)]);
    }
  }
  for (let k = 0; k < 900; k++) {
    const x = rr(TB.x0 + 40, TB.x1 - 40), z = rr(TB.z0 + 40, TB.z1 - 40), y = carvedHeight(x, z);
    if (y > 40 && !inCorridor(x, z, 2)) (rnd() < 0.35 ? cacti : scrubs).push([x, y, z, rr(0.8, 2)]);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  const bm = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), std("#9c4630"), boulders.length);
  boulders.forEach(([x, y, z, s], k) => { q.setFromEuler(e.set(rnd() * 3, rnd() * 3, rnd() * 3)); bm.setMatrixAt(k, m4.compose(pv.set(x, y + s * 0.3, z), q, sv.set(s, s * 0.7, s))); });
  bm.castShadow = bm.receiveShadow = true; scene.add(bm);
  const sm = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), std("#8f9a5e"), scrubs.length);
  scrubs.forEach(([x, y, z, s], k) => { q.setFromEuler(e.set(0, rnd() * 3, 0)); sm.setMatrixAt(k, m4.compose(pv.set(x, y + s * 0.25, z), q, sv.set(s, s * 0.55, s))); sm.setColorAt(k, new THREE.Color().setHSL(0.17 + rnd() * 0.08, 0.3, 0.42 + rnd() * 0.1)); });
  sm.castShadow = true; scene.add(sm);
  // Saguaro-style cacti: a ribbed trunk plus one or two bent arms, three instanced part meshes.
  const cm = std("#5f8f45", { roughness: 0.8, flatShading: false });
  const trunkG = new THREE.CapsuleGeometry(0.42, 4.2, 2, 8), elbowG = new THREE.CapsuleGeometry(0.28, 0.9, 1, 6), upG = new THREE.CapsuleGeometry(0.28, 1.5, 2, 6);
  const tI = new THREE.InstancedMesh(trunkG, cm, cacti.length), eI = new THREE.InstancedMesh(elbowG, cm, cacti.length * 2), uI = new THREE.InstancedMesh(upG, cm, cacti.length * 2);
  const M = new THREE.Matrix4(), L = new THREE.Matrix4(), R = new THREE.Matrix4(); let ne = 0;
  cacti.forEach(([x, y, z, sc], k) => {
    M.compose(pv.set(x, y - 0.3, z), q.setFromAxisAngle(YAX, rnd() * 6.28), sv.set(sc, sc, sc));
    tI.setMatrixAt(k, R.multiplyMatrices(M, L.makeTranslation(0, 2.5, 0)));
    for (const side of rnd() < 0.5 ? [-1, 1] : [rnd() < 0.5 ? -1 : 1]) {
      const h = rr(1.6, 2.8);
      eI.setMatrixAt(ne, R.multiplyMatrices(M, L.compose(pv.set(side * 0.7, h, 0), q.setFromAxisAngle(ZAX, Math.PI / 2), sv.set(1, 1, 1))));
      uI.setMatrixAt(ne++, R.multiplyMatrices(M, L.makeTranslation(side * 1.2, h + 0.9, 0)));
    }
  });
  eI.count = uI.count = ne;
  tI.castShadow = true; scene.add(tI, eI, uI);
  // a few lone hoodoos on the rims as landmarks
  seed = 31;
  for (let k = 0; k < 40; k++) {
    const x = rr(TB.x0 + 60, TB.x1 - 60), z = rr(TB.z0 + 60, TB.z1 - 60), y = carvedHeight(x, z);
    if (y > 55 && !inCorridor(x, z, 10)) hoodoo(x, y - 1, z, rr(4, 9), rr(16, 40));
  }
}
/* ================================================================ cars: four original supercars */
// Bodies are lofted from rounded cross-sections (superellipses) for smooth, glossy shapes.
// Every model and every paint drives identically: looks only, never performance.
const ENV = (() => {   // a small sky-and-sand environment for glossy paint and glass reflections
  const es = new THREE.Scene(), g = new THREE.SphereGeometry(10, 32, 16), p = g.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color(), v = new THREE.Vector3();
  const top = new THREE.Color("#6f8fd6"), hor = new THREE.Color("#ffc9a0"), gnd = new THREE.Color("#b5643c");
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).normalize(); if (v.y > 0) c.copy(hor).lerp(top, Math.pow(v.y, 0.6)); else c.copy(hor).lerp(gnd, Math.min(1, -v.y * 4)); col.set([c.r, c.g, c.b], i * 3); }
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  const sunB = new THREE.Mesh(new THREE.SphereGeometry(0.9, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(6, 5, 4) })); sunB.position.copy(sunDir).multiplyScalar(9); es.add(sunB);
  const pm = new THREE.PMREMGenerator(renderer), rt = pm.fromScene(es, 0.03); pm.dispose();
  PA.cleaner.disposeObject(es); PA.cleaner.track(rt); // the bake scene is done; the target lives until the page closes
  return rt.texture;
})();
function loft(sections, N = 28) {
  const S = sections.length, pos = new Float32Array((S * N + 2) * 3), idx = [];
  for (let k = 0; k < S; k++) {
    const sc = sections[k], e = 2 / (sc.n || 4), ym = (sc.y0 + sc.y1) / 2, hh = (sc.y1 - sc.y0) / 2;
    for (let j = 0; j < N; j++) {
      const a = (j / N) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      let x = (sc.w / 2) * Math.sign(ca) * Math.pow(Math.abs(ca), e);
      const y = ym + hh * Math.sign(sa) * Math.pow(Math.abs(sa), e);
      if (sa > 0) x *= 1 - (sc.top || 0) * Math.pow(sa, 1.6);
      pos.set([x + (sc.x || 0), y, sc.z], (k * N + j) * 3);
    }
  }
  const c0 = S * N, c1 = S * N + 1, f = sections[0], l = sections[S - 1];
  pos.set([f.x || 0, (f.y0 + f.y1) / 2, f.z], c0 * 3); pos.set([l.x || 0, (l.y0 + l.y1) / 2, l.z], c1 * 3);
  for (let k = 0; k < S - 1; k++) for (let j = 0; j < N; j++) {
    const a = k * N + j, b = k * N + ((j + 1) % N), c = (k + 1) * N + j, d = (k + 1) * N + ((j + 1) % N);
    idx.push(a, b, c, b, d, c);
  }
  for (let j = 0; j < N; j++) { idx.push(c0, (j + 1) % N, j); idx.push(c1, (S - 1) * N + j, (S - 1) * N + ((j + 1) % N)); }
  const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const sec = (z, w, y0, y1, n = 4, top = 0.18, x = 0) => ({ z, w, y0, y1, n, top, x });
const MODELS = [
  { name: "Mesa Longtail", desc: "Long-tail coupe with a towering swan-neck wing.", tail: -2.75,
    body: [sec(-2.75, 1.5, 0.42, 0.8, 3), sec(-2.3, 1.94, 0.3, 0.9), sec(-1.45, 2.04, 0.24, 0.96), sec(-0.4, 1.9, 0.22, 0.9), sec(0.6, 1.92, 0.22, 0.84), sec(1.45, 2.02, 0.22, 0.8), sec(2.12, 1.86, 0.26, 0.66), sec(2.42, 1.4, 0.32, 0.5, 3)],
    cab: [sec(-1.55, 0.5, 0.86, 0.96, 3, 0.3), sec(-1.1, 1.1, 0.84, 1.13, 4, 0.3), sec(-0.35, 1.36, 0.82, 1.24, 4, 0.3), sec(0.5, 1.28, 0.8, 1.16, 4, 0.3), sec(0.95, 0.6, 0.79, 0.86, 3, 0.3)],
    wing: { z: -2.4, y: 1.62, w: 2.06, d: 0.55, swan: true }, stripes: 2 },
  { name: "Dune Viper", desc: "Wide, low wedge with deep side scoops.", tail: -2.45,
    body: [sec(-2.45, 1.7, 0.36, 0.84, 3), sec(-1.9, 2.08, 0.26, 0.92), sec(-1.2, 2.12, 0.24, 0.9), sec(-0.2, 1.96, 0.22, 0.8), sec(0.8, 1.98, 0.22, 0.7), sec(1.6, 2.0, 0.22, 0.6), sec(2.2, 1.8, 0.24, 0.48), sec(2.5, 1.3, 0.28, 0.4, 3)],
    cab: [sec(-1.4, 0.6, 0.8, 0.9, 3, 0.35), sec(-0.9, 1.2, 0.78, 1.06, 4, 0.35), sec(-0.1, 1.34, 0.76, 1.12, 4, 0.35), sec(0.7, 1.1, 0.72, 0.98, 4, 0.35), sec(1.15, 0.5, 0.7, 0.76, 3, 0.35)],
    wing: { z: -2.15, y: 1.08, w: 1.9, d: 0.42 }, scoops: true, stripes: 1 },
  { name: "Coyote RS", desc: "Compact mid-engine sprinter with a roof scoop.", tail: -2.25,
    body: [sec(-2.25, 1.66, 0.36, 0.92, 3), sec(-1.85, 1.98, 0.28, 1.0), sec(-1.2, 2.02, 0.24, 1.0), sec(-0.2, 1.88, 0.22, 0.94), sec(0.8, 1.9, 0.22, 0.84), sec(1.5, 1.96, 0.24, 0.78), sec(2.05, 1.8, 0.28, 0.66), sec(2.3, 1.36, 0.34, 0.54, 3)],
    cab: [sec(-1.3, 0.6, 0.94, 1.04, 3, 0.25), sec(-0.85, 1.2, 0.92, 1.3, 4, 0.25), sec(-0.05, 1.4, 0.9, 1.36, 4, 0.25), sec(0.7, 1.24, 0.86, 1.2, 4, 0.25), sec(1.1, 0.56, 0.84, 0.9, 3, 0.25)],
    wing: { z: -2.05, y: 1.18, w: 1.86, d: 0.36, duck: true }, scoop: true, stripes: 1 },
  { name: "Sidewinder", desc: "Open-cockpit speedster with twin headrest fins.", tail: -2.5,
    body: [sec(-2.5, 1.56, 0.38, 0.84, 3), sec(-2.0, 1.96, 0.28, 0.92), sec(-1.3, 2.04, 0.24, 0.92), sec(-0.3, 1.9, 0.22, 0.84), sec(0.7, 1.92, 0.22, 0.78), sec(1.5, 2.0, 0.22, 0.72), sec(2.15, 1.84, 0.26, 0.6), sec(2.45, 1.36, 0.32, 0.46, 3)],
    cab: null, wing: { z: -2.2, y: 1.2, w: 1.96, d: 0.4 }, fins: true, stripes: 2 },
];
const PAINTS = [
  { name: "Sunset Crimson", body: "#c41a26", stripe: "#f3eee4" }, { name: "Canyon Orange", body: "#e2611a", stripe: "#17161b" },
  { name: "Oasis Teal", body: "#16938f", stripe: "#f3eee4" }, { name: "Desert Gold", body: "#c4952c", stripe: "#17161b" },
  { name: "Graphite", body: "#2b2d34", stripe: "#e2611a" }, { name: "Pearl", body: "#e7e3da", stripe: "#1d4fb8" },
  { name: "Cactus Lime", body: "#b9c62a", stripe: "#17161b" }, { name: "Mesa Cobalt", body: "#1f4fb6", stripe: "#f2b234" },
];
function makeSupercar(modelIdx, paintIdx, ghost = null) {
  const M = MODELS[modelIdx], P = PAINTS[paintIdx];
  const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
  const paint = ghost || new THREE.MeshPhysicalMaterial({ color: P.body, metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, envMap: ENV, envMapIntensity: 1.1 });
  const stripe = ghost || new THREE.MeshPhysicalMaterial({ color: P.stripe, metalness: 0.2, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.08, envMap: ENV });
  const glass = ghost || new THREE.MeshPhysicalMaterial({ color: "#0e1118", metalness: 0.9, roughness: 0.04, envMap: ENV, envMapIntensity: 1.4 });
  const black = ghost || new THREE.MeshStandardMaterial({ color: "#121216", roughness: 0.6, metalness: 0.3 });
  const carbon = ghost || new THREE.MeshStandardMaterial({ color: "#1d1e24", roughness: 0.35, metalness: 0.5, envMap: ENV });
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = !ghost; m.receiveShadow = !ghost; parent.add(m); return m; };
  add(loft(M.body), paint);
  if (M.cab) add(loft(M.cab), glass);
  else {   // open cockpit: low screen, dark tub, twin fins
    add(new THREE.BoxGeometry(1.2, 0.08, 1.3), black, 0, 0.86, -0.4);
    const ws = add(new THREE.BoxGeometry(1.25, 0.32, 0.05), glass, 0, 1.0, 0.45); ws.rotation.x = -0.5;
    for (const sx of [-0.33, 0.33]) add(loft([sec(-1.9, 0.08, 0.8, 0.82, 3), sec(-1.4, 0.42, 0.84, 1.16, 4, 0.4), sec(-0.95, 0.46, 0.84, 1.2, 4, 0.4), sec(-0.75, 0.3, 0.84, 1.0, 3)], 16), paint, sx, 0, 0);
    add(new THREE.SphereGeometry(0.22, 14, 10), stripe, 0.3, 1.1, -0.45);
  }
  // racing stripes riding on the body's centre line
  const top = M.body.map((b) => sec(b.z, 0.001, 0, 0)), stripeW = M.stripes === 2 ? 0.2 : 0.42;
  for (const off of M.stripes === 2 ? [-0.2, 0.2] : [0]) {
    const st = M.body.slice(1, -1).map((b) => sec(b.z, stripeW, b.y1 - 0.03, b.y1 + 0.012, 6, 0, off));
    if (!ghost) add(loft(st, 12), stripe);
  }
  // wing
  const W = M.wing;
  const plate = add(loft([sec(-W.d / 2, W.w, -0.04, 0.03, 3, 0), sec(W.d / 2, W.w, -0.02, 0.05, 3, 0)], 16), carbon, 0, W.y, W.z); plate.rotation.x = -0.08;
  for (const sx of [-1, 1]) {
    add(new THREE.BoxGeometry(0.05, 0.36, W.d + 0.12), carbon, sx * W.w / 2, W.y - 0.08, W.z);
    const strut = add(new THREE.BoxGeometry(0.06, W.y - 0.8, 0.16), carbon, sx * 0.42, (W.y + 0.8) / 2, W.z + 0.05);
    if (W.swan) strut.rotation.x = 0.18;
  }
  if (M.scoops) for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.06, 0.26, 0.7), black, sx * 1.0, 0.6, -0.5);
  if (M.scoop) add(loft([sec(-0.2, 0.5, 1.3, 1.36, 3), sec(-0.6, 0.62, 1.3, 1.52, 4), sec(-1.0, 0.5, 1.2, 1.4, 3)], 14), paint);
  add(new THREE.BoxGeometry(1.75, 0.16, 4.2), black, 0, 0.24, -0.05);             // floor
  add(new THREE.BoxGeometry(1.7, 0.12, 0.5), carbon, 0, 0.26, 2.2);                 // splitter
  add(new THREE.BoxGeometry(1.6, 0.22, 0.3), carbon, 0, 0.32, M.tail + 0.15);       // diffuser
  // lights
  const head = ghost || new THREE.MeshBasicMaterial({ color: 0xfff4dc, toneMapped: false }), tail = ghost || new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });
  for (const sx of [-0.62, 0.62]) { const h = add(new THREE.BoxGeometry(0.42, 0.07, 0.1), head, sx, 0.62, 2.12); h.rotation.y = sx > 0 ? 0.35 : -0.35; }
  add(new THREE.BoxGeometry(1.5, 0.07, 0.06), tail, 0, 0.74, M.tail + 0.04);
  const pipes = [-0.24, 0.24].map((x) => { add(new THREE.CylinderGeometry(0.08, 0.09, 0.3, 10).rotateX(Math.PI / 2), black, x, 0.42, M.tail + 0.05); return new THREE.Vector3(x, 0.42, M.tail - 0.15); });
  // wheels: rounded tyre, multi-spoke rim, brake disc
  const tyreG = new THREE.LatheGeometry([[0.27, -0.16], [0.36, -0.17], [0.4, -0.13], [0.41, 0], [0.4, 0.13], [0.36, 0.17], [0.27, 0.16]].map(([r, y]) => new THREE.Vector2(r, y)), 22).rotateZ(Math.PI / 2);
  const rimG = new THREE.CylinderGeometry(0.27, 0.27, 0.28, 20).rotateZ(Math.PI / 2), spokeG = new THREE.BoxGeometry(0.06, 0.5, 0.07), discG = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16).rotateZ(Math.PI / 2);
  const rimM = ghost || new THREE.MeshStandardMaterial({ color: "#c9cbd2", metalness: 0.9, roughness: 0.25, envMap: ENV }), tyreM = ghost || new THREE.MeshStandardMaterial({ color: "#151518", roughness: 0.85 });
  const wheels = [], steer = [];
  for (const [x, z, front] of [[-0.93, 1.42, 1], [0.93, 1.42, 1], [-0.93, -1.45, 0], [0.93, -1.45, 0]]) {
    const piv = new THREE.Group(); piv.position.set(x, 0.41, z); root.add(piv);
    const spin = new THREE.Group(); piv.add(spin);
    add(tyreG, tyreM, 0, 0, 0, spin); add(rimG, black, 0, 0, 0, spin);
    for (let k = 0; k < 5; k++) { const sp = add(spokeG, rimM, Math.sign(x) * 0.13, 0, 0, spin); sp.rotation.x = (k / 5) * Math.PI; }
    add(discG, rimM, -Math.sign(x) * 0.02, 0, 0, spin);
    wheels.push({ piv, spin, x, z, front }); if (front) steer.push(piv);
  }
  scene.add(root);
  return { root, body, wheels, steer, paint, stripe, pipes, model: modelIdx, paintIdx };
}
function disposeCar(c3) { scene.remove(c3.root); c3.root.traverse((o) => { if (o.isMesh) o.geometry.dispose(); }); }
const ghostMat = new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.28, depthWrite: false });
let ghost3d = makeSupercar(0, 0, ghostMat); ghost3d.root.visible = false;

/* ================================================================ particles */
function makeParticles(N, additive) {
  const g = new THREE.BufferGeometry();
  const P = new Float32Array(N * 3), S = new Float32Array(N), A = new Float32Array(N), C = new Float32Array(N * 3);
  g.setAttribute("position", new THREE.BufferAttribute(P, 3)); g.setAttribute("size", new THREE.BufferAttribute(S, 1));
  g.setAttribute("alpha", new THREE.BufferAttribute(A, 1)); g.setAttribute("color", new THREE.BufferAttribute(C, 3));
  for (const k of ["position", "size", "alpha", "color"]) g.attributes[k].setUsage(THREE.DynamicDrawUsage);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    uniforms: { uScale: { value: 500 } },
    vertexShader: `attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float uScale;
      void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(0.2, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying float vA; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, ${additive ? "0.0" : "0.18"}, d) * vA; if (a < 0.01) discard; gl_FragColor = vec4(vC, a); }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
  const V = new Float32Array(N * 3), L = new Float32Array(N), MX = new Float32Array(N), S0 = new Float32Array(N), S1 = new Float32Array(N), A0 = new Float32Array(N), GR = new Float32Array(N), DR = new Float32Array(N);
  let head = 0;
  return {
    pts, mat,
    emit(x, y, z, vx, vy, vz, life, s0, s1, a0, col, grav = 0, drag = 0) {
      const i = head; head = (head + 1) % N;
      P[i * 3] = x; P[i * 3 + 1] = y; P[i * 3 + 2] = z; V[i * 3] = vx; V[i * 3 + 1] = vy; V[i * 3 + 2] = vz;
      L[i] = MX[i] = life; S0[i] = s0; S1[i] = s1; A0[i] = a0; GR[i] = grav; DR[i] = drag; C[i * 3] = col.r; C[i * 3 + 1] = col.g; C[i * 3 + 2] = col.b;
    },
    update(dt) {
      for (let i = 0; i < N; i++) {
        if (L[i] <= 0) { A[i] = 0; continue; }
        L[i] -= dt; const k = Math.max(0, L[i] / MX[i]), dr = Math.exp(-DR[i] * dt);
        V[i * 3] *= dr; V[i * 3 + 1] = V[i * 3 + 1] * dr - GR[i] * dt; V[i * 3 + 2] *= dr;
        P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt;
        S[i] = S1[i] + (S0[i] - S1[i]) * k; A[i] = A0[i] * Math.min(1, k * 2.2) * Math.min(1, (1 - k) * 12 + 0.2);
      }
      for (const a of ["position", "size", "alpha", "color"]) g.attributes[a].needsUpdate = true;
    },
    clear() { L.fill(0); A.fill(0); },
  };
}
const SOFT = makeParticles(1400, false), GLOW = makeParticles(900, true);
const COL = { smoke: new THREE.Color("#f1e4d4"), dust: new THREE.Color("#d9a26c"), sand: new THREE.Color("#e6bb85"), spark: new THREE.Color("#ffc24a"), spark2: new THREE.Color("#ff7a2a"), flame: new THREE.Color("#ffb23e"), flame2: new THREE.Color("#ff4f8a"), weed: new THREE.Color("#a88457") };

// Skid marks: a ring buffer of flat quads laid on the surface behind the rear wheels.
const SKID_N = 1600;
const skidGeo = new THREE.PlaneGeometry(1, 1); skidGeo.rotateX(-Math.PI / 2);
const skids = new THREE.InstancedMesh(skidGeo, new THREE.MeshBasicMaterial({ color: 0x24160f, transparent: true, opacity: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), SKID_N);
skids.frustumCulled = false; skids.count = SKID_N;
{ const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < SKID_N; i++) skids.setMatrixAt(i, z); }
scene.add(skids);
let skidHead = 0;
const skM = new THREE.Matrix4(), skQ = new THREE.Quaternion(), skS = new THREE.Vector3(), skP = new THREE.Vector3(), YAXIS = new THREE.Vector3(0, 1, 0);
function addSkid(x0, y0, z0, x1, y1, z1) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz); if (L < 0.05 || L > 4) return;
  skQ.setFromAxisAngle(YAXIS, Math.atan2(dx, dz));
  skids.setMatrixAt(skidHead, skM.compose(skP.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.03, (z0 + z1) / 2), skQ, skS.set(0.34, 1, L + 0.05)));
  skidHead = (skidHead + 1) % SKID_N; skids.instanceMatrix.needsUpdate = true;
}
function clearSkids() { const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < SKID_N; i++) skids.setMatrixAt(i, z); skids.instanceMatrix.needsUpdate = true; }

// Speed streaks: thin glowing slivers parked in the air; the car's own speed stretches them past the camera.
const STREAK_N = 70;
const streaks = new THREE.InstancedMesh(new THREE.BoxGeometry(0.035, 0.035, 5), new THREE.MeshBasicMaterial({ color: 0xfff2dc, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }), STREAK_N);
streaks.frustumCulled = false; scene.add(streaks);
const streakPos = Array.from({ length: STREAK_N }, () => new THREE.Vector3(0, -999, 0));

// Tumbleweeds roll across the wider stretches; smash through them for a little shower of twigs.
const weeds = [];
{
  const geo = new THREE.IcosahedronGeometry(0.95, 1), mat = new THREE.MeshStandardMaterial({ color: 0xa88457, wireframe: true });
  const core = new THREE.IcosahedronGeometry(0.55, 0), cmat = std("#8a6a44");
  const spots = SEGS.filter((sg) => !sg.def.shortcut).flatMap((sg) => [[sg.id, 0.3], [sg.id, 0.6]])
    .filter(([id, f]) => { const sg = TR[id], i = Math.round(f * (sg.n - 1)); return !sg.TUN[i] && !sg.gaps.some((g) => f * sg.len > g.s0 - 60 && f * sg.len < g.s1 + 20); });
  spots.forEach(([id, f], k) => {
    const m = new THREE.Group(); m.add(new THREE.Mesh(geo, mat)); const c = new THREE.Mesh(core, cmat); c.castShadow = true; m.add(c); scene.add(m);
    weeds.push({ m, seg: TR[id], s: f * TR[id].len, d: 0, dir: k % 2 ? 1 : -1, sp: 3 + (k % 3), y: 0, vy: 0, dead: 0, ph: k });
  });
}

/* ================================================================ audio: engine, tyres, wind, music */
const AU = { ctx: null, ready: false };
function audioInit() {
  if (AU.ctx) { if (AU.ctx.state === "suspended") AU.ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
  const c = AU.ctx = new AC();
  AU.master = c.createGain(); const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
  AU.master.connect(comp); comp.connect(c.destination);
  AU.music = c.createGain(); AU.music.connect(AU.master);
  AU.sfx = c.createGain(); AU.sfx.connect(AU.master);
  AU.lead = c.createGain(); AU.lead.gain.value = 0.9; AU.lead.connect(AU.music);
  const dl = c.createDelay(1); dl.delayTime.value = (60 / 126) * 0.75; const fb = c.createGain(); fb.gain.value = 0.34; const wet = c.createGain(); wet.gain.value = 0.42;
  const dlf = c.createBiquadFilter(); dlf.type = "lowpass"; dlf.frequency.value = 2400;
  AU.lead.connect(dl); dl.connect(dlf); dlf.connect(fb); fb.connect(dl); dlf.connect(wet); wet.connect(AU.music);
  const len = c.sampleRate * 2, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  AU.noise = buf;
  const loopNoise = (type, f, q, dest) => { const s = c.createBufferSource(); s.buffer = buf; s.loop = true; const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = c.createGain(); g.gain.value = 0; s.connect(fl); fl.connect(g); g.connect(dest); s.start(); return { g, fl }; };
  // engines: saw + square an octave down + sine sub through a lowpass that opens with throttle.
  // One voice per human driver (panned apart in split-screen) and one for the nearest rival.
  const makeEngine = (pan, level) => {
    const ef = c.createBiquadFilter(); ef.type = "lowpass"; ef.frequency.value = 700; ef.Q.value = 2.5;
    const eg = c.createGain(); eg.gain.value = 0; const pn = c.createStereoPanner(); pn.pan.value = pan;
    ef.connect(eg); eg.connect(pn); pn.connect(AU.sfx);
    const o1 = c.createOscillator(), o2 = c.createOscillator(), o3 = c.createOscillator(); o1.type = "sawtooth"; o2.type = "square"; o3.type = "sine";
    const g2 = c.createGain(); g2.gain.value = 0.5; const g3 = c.createGain(); g3.gain.value = 0.8;
    o1.connect(ef); o2.connect(g2); g2.connect(ef); o3.connect(g3); g3.connect(eg); o1.start(); o2.start(); o3.start();
    return { o1, o2, o3, ef, eg, pn, level, gear: 1 };
  };
  AU.engs = [makeEngine(0, 1), makeEngine(0, 1), makeEngine(0, 0.6)];
  AU.tire = loopNoise("bandpass", 1700, 4, AU.sfx);
  AU.wind = loopNoise("lowpass", 650, 0.7, AU.sfx);
  AU.boost = loopNoise("bandpass", 420, 0.9, AU.sfx);
  AU.scrape = loopNoise("highpass", 2600, 0.8, AU.sfx);
  AU.dirt = loopNoise("lowpass", 320, 1, AU.sfx);
  AU.ready = true; applyVolumes();
  if (MUS.want) musicStart(MUS.want);
}
function applyVolumes() {
  if (!AU.ready) return;
  AU.master.gain.value = PA.muted ? 0 : settings.vol / 10;
  AU.music.gain.value = (settings.music / 10) * 0.5;
  AU.sfx.gain.value = settings.sfx / 10;
}
function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
function osc(type, f, t, dur, peak, dest, f2 = null, a = 0.005) {
  const c = AU.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
  env(g, t, a, peak, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05); return o;
}
function noiseHit(t, dur, peak, type, f, dest, f2 = null, q = 1) {
  const c = AU.ctx, s = c.createBufferSource(), fl = c.createBiquadFilter(), g = c.createGain();
  s.buffer = AU.noise; fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q; if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  env(g, t, 0.004, peak, dur); s.connect(fl); fl.connect(g); g.connect(dest); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
const SFX = {
  ui: () => osc("triangle", 660, AU.ctx.currentTime, 0.05, 0.12, AU.sfx),
  select: () => { const t = AU.ctx.currentTime; osc("triangle", 520, t, 0.06, 0.14, AU.sfx); osc("triangle", 880, t + 0.05, 0.1, 0.14, AU.sfx); },
  beep: (hi) => osc("square", hi ? 880 : 440, AU.ctx.currentTime, hi ? 0.5 : 0.22, 0.16, AU.sfx),
  chime: () => { const t = AU.ctx.currentTime; osc("sine", 988, t, 0.25, 0.22, AU.sfx); osc("sine", 1480, t + 0.08, 0.4, 0.2, AU.sfx); },
  lap: () => { const t = AU.ctx.currentTime; [330, 415, 494, 659, 831].forEach((f, i) => osc("triangle", f, t + i * 0.08, 0.3, 0.2, AU.sfx)); },
  jump: () => noiseHit(AU.ctx.currentTime, 0.45, 0.35, "bandpass", 380, AU.sfx, 1800, 1.4),
  land: (k) => { const t = AU.ctx.currentTime; osc("sine", 110, t, 0.22, 0.35 + k * 0.5, AU.sfx, 38); noiseHit(t, 0.18, 0.25 + k * 0.3, "lowpass", 900, AU.sfx); },
  boost: () => { const t = AU.ctx.currentTime; noiseHit(t, 0.5, 0.5, "bandpass", 300, AU.sfx, 2200, 0.8); osc("sawtooth", 110, t, 0.5, 0.16, AU.sfx, 520); },
  pad: () => { const t = AU.ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => osc("sine", f, t + i * 0.045, 0.16, 0.16, AU.sfx)); },
  crash: (k) => { const t = AU.ctx.currentTime; noiseHit(t, 0.35, 0.5 + k * 0.4, "lowpass", 1400, AU.sfx, 300); osc("square", 80, t, 0.25, 0.25 * k + 0.1, AU.sfx, 40); },
  bump: () => noiseHit(AU.ctx.currentTime, 0.12, 0.25, "lowpass", 1100, AU.sfx),
  near: () => { const c = AU.ctx, t = c.currentTime, p = c.createStereoPanner(); p.pan.value = Math.random() < 0.5 ? -0.8 : 0.8; p.connect(AU.sfx); noiseHit(t, 0.32, 0.4, "bandpass", 700, p, 2600, 2); },
  ding: (k) => osc("sine", 660 * Math.pow(1.122, Math.min(8, k)), AU.ctx.currentTime, 0.25, 0.16, AU.sfx),
  weed: () => noiseHit(AU.ctx.currentTime, 0.25, 0.3, "highpass", 1800, AU.sfx),
  fall: () => noiseHit(AU.ctx.currentTime, 1.0, 0.3, "bandpass", 1600, AU.sfx, 200, 1.2),
  fanfare: () => { const t = AU.ctx.currentTime; [[330, 0], [415, 0.12], [494, 0.24], [659, 0.36], [494, 0.6], [659, 0.72]].forEach(([f, d]) => { osc("sawtooth", f, t + d, 0.35, 0.12, AU.lead); osc("triangle", f / 2, t + d, 0.4, 0.15, AU.sfx); }); },
};
const sfx = (name, ...a) => { if (DEMO || !AU.ready) return; try { SFX[name](...a); } catch {} };

// Music: an original desert-rock loop in E Phrygian dominant — four-on-the-floor kick, slap snare,
// a driving octave bass, a twangy echoing lead, and a low E–B drone that swells under it all.
const MUS = { mode: "off", step: 0, next: 0, timer: 0, drone: null, intensity: 0 };
const SCALE = [0, 1, 4, 5, 7, 8, 10];
const nf = (deg, oct = 0) => { const o = Math.floor(deg / 7); return 82.41 * Math.pow(2, (SCALE[((deg % 7) + 7) % 7] + 12 * (o + oct)) / 12); };
const BASS_BARS = [[0, 0, 7, 0, 0, 7, 1, 0], [0, 0, 7, 0, 2, 1, 0, -1], [3, 3, 10, 3, 2, 2, 9, 2], [1, 1, 8, 1, 0, 2, 1, 0]];
const LEAD = [ // 32 steps of 8ths over 4 bars, scale degrees (null = rest)
  7, null, 8, 9, 8, null, 7, 6, 7, null, null, 4, 5, 6, 5, null,
  7, null, 8, 9, 11, null, 10, 9, 8, 9, 8, 7, 6, null, 7, null,
];
const ARP = [0, 4, 7, 9, 7, 4, 2, 4];
function musicStart(mode) {
  MUS.want = mode;
  if (!AU.ready || DEMO) return;
  if (mode === MUS.mode) return;
  MUS.mode = mode; MUS.step = 0; MUS.next = AU.ctx.currentTime + 0.08;
  if (!MUS.drone) {
    const c = AU.ctx, g = c.createGain(); g.gain.value = 0; const f = c.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = 500; f.Q.value = 3;
    const os = [41.2, 61.7, 82.4].map((fr) => { const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.detune.value = (Math.random() - 0.5) * 12; o.connect(f); o.start(); return o; });
    const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = 0.08; lg.gain.value = 260; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    f.connect(g); g.connect(AU.music); MUS.drone = { g, f, os };
  }
  MUS.drone.g.gain.setTargetAtTime(mode === "off" ? 0 : mode === "title" ? 0.09 : 0.07, AU.ctx.currentTime, 0.6);
  if (!MUS.timer) MUS.timer = setInterval(musicTick, 25);
}
function musicTick() {
  if (!AU.ready || MUS.mode === "off") return;
  const c = AU.ctx, stepDur = 60 / 126 / 4;
  // after the timer was throttled (busy frame, background tab) skip missed notes instead of firing them all at once
  if (MUS.next < c.currentTime - 0.1) { const miss = Math.ceil((c.currentTime - MUS.next) / stepDur); MUS.step += miss; MUS.next += miss * stepDur; }
  while (MUS.next < c.currentTime + 0.12) {
    const t = MUS.next, st = MUS.step, s16 = st % 16, bar = Math.floor(st / 16) % 16;
    if (MUS.mode === "title") {
      if (s16 % 2 === 0) { const a = ARP[(st / 2) % 8]; osc("triangle", nf(a, 1), t, 0.32, 0.07, AU.lead); }
      if (s16 === 0) osc("sine", nf(bar % 4 === 3 ? 3 : 0, 0), t, 1.6, 0.18, AU.music, null, 0.04);
      if (s16 === 8 && bar % 2) noiseHit(t, 0.4, 0.05, "highpass", 6000, AU.music);
    } else if (MUS.mode === "race" || MUS.mode === "final") {
      const fin = MUS.mode === "final", B = bar % 8 >= 4 || fin;
      if (s16 % 4 === 0 || (s16 === 14 && bar % 4 === 3)) osc("sine", 150, t, 0.22, 0.75, AU.music, 42, 0.002);                     // kick
      if (s16 === 4 || s16 === 12) { noiseHit(t, 0.16, 0.32, "highpass", 1300, AU.music); osc("triangle", 200, t, 0.08, 0.2, AU.music, 140); } // snare
      if (s16 % 4 === 2) noiseHit(t, s16 === 14 ? 0.12 : 0.04, 0.12, "highpass", 7500, AU.music);                                     // hats
      if (fin && s16 % 2 === 1) noiseHit(t, 0.03, 0.06, "bandpass", 5200, AU.music, null, 2);                                         // shaker
      if (s16 % 2 === 0) { const b = BASS_BARS[bar % 4][s16 / 2]; osc("sawtooth", nf(b, -1), t, stepDur * 1.7, 0.2, AU.music); osc("square", nf(b, 0), t, stepDur * 0.9, 0.05, AU.music); }
      if (B && s16 % 2 === 0) { const l = LEAD[((bar % 4) * 8 + s16 / 2) % 32]; if (l != null) { osc("sawtooth", nf(l, 1), t, stepDur * 2.4, 0.075, AU.lead); osc("square", nf(l, 2), t, stepDur * 0.6, 0.025, AU.lead); } }
      if (bar % 8 === 7 && s16 >= 12) osc("sine", [180, 150, 120, 100][s16 - 12], t, 0.18, 0.4, AU.music, 70);                     // tom fill
    } else if (MUS.mode === "results") {
      if (s16 % 4 === 0) { const a = [0, 4, 7, 11][(st / 4) % 4]; osc("triangle", nf(a, 1), t, 0.6, 0.08, AU.lead); }
      if (s16 === 0) osc("sine", nf(0, 0), t, 1.8, 0.16, AU.music, null, 0.05);
    }
    MUS.step++; MUS.next += stepDur;
  }
}
/* ================================================================ input: keyboard, mouse, gamepad, touch */
// Solo: WASD or arrows. Split-screen: player 1 on WASD + Space/Left Shift, player 2 on the arrows + / and .
const KEYMAPS = {
  solo: [{ left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], gas: ["KeyW", "ArrowUp"], brake: ["KeyS", "ArrowDown"], drift: ["Space"], boost: ["ShiftLeft", "ShiftRight"], cam: ["KeyC"], recover: ["KeyR"] }],
  split: [
    { left: ["KeyA"], right: ["KeyD"], gas: ["KeyW"], brake: ["KeyS"], drift: ["Space"], boost: ["ShiftLeft"], cam: ["KeyC"], recover: ["KeyR"] },
    { left: ["ArrowLeft"], right: ["ArrowRight"], gas: ["ArrowUp"], brake: ["ArrowDown"], drift: ["Slash", "ControlRight"], boost: ["Period", "ShiftRight"], cam: ["Comma"], recover: ["Quote"] },
  ],
};
const KEYNAMES = { KeyA: "A", KeyD: "D", KeyW: "W", KeyS: "S", KeyC: "C", KeyR: "R", Space: "Space", ShiftLeft: "L-Shift", ShiftRight: "R-Shift", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", Slash: "/", ControlRight: "R-Ctrl", Period: ".", Comma: ",", Quote: "'" };
const newInput = () => ({ steer: 0, throttle: 0, brake: 0, drift: false, boost: false, bufBoost: 0, bufDrift: 0, cam: false, recover: false, rHeld: 0, last: PA.TOUCH ? "touch" : "kb" });
const IN = [newInput(), newInput()];
const edge = { pause: false };
let mouseBoost = false, mouseDrift = false;
const K = PA.keys;
const kb = (codes) => codes.some((c) => K.has(c));
const typing = () => document.activeElement && document.activeElement.tagName === "INPUT";
const keymap = () => (race.mode === "split" ? KEYMAPS.split : KEYMAPS.solo);
addEventListener("keydown", (e) => {
  audioInit();
  if (typing()) { if (e.code === "Enter" || e.code === "Escape") { document.activeElement.blur(); e.preventDefault(); } return; }
  if (e.repeat) return;
  keymap().forEach((m, h) => {
    if (m.cam.includes(e.code)) IN[h].cam = true;
    if (m.boost.includes(e.code)) { IN[h].bufBoost = 0.3; IN[h].last = "kb"; }
    if (m.drift.includes(e.code)) { IN[h].bufDrift = 0.3; IN[h].last = "kb"; }
    if (m.gas.includes(e.code) || m.left.includes(e.code) || m.right.includes(e.code)) IN[h].last = "kb";
  });
  if (e.code === "Escape" || e.code === "KeyP") edge.pause = true;
  menuKey(e);
});
addEventListener("keyup", (e) => { keymap().forEach((m, h) => { if (m.recover.includes(e.code) && IN[h].rHeld > 0 && IN[h].rHeld < 0.6) IN[h].recover = true; }); });
renderer.domElement.addEventListener("pointerdown", (e) => {
  audioInit(); if (e.pointerType !== "mouse" || !settings.mouse || race.mode === "split") return; IN[0].last = "kb";
  if (e.button === 0) { mouseBoost = true; IN[0].bufBoost = 0.3; } if (e.button === 2) { mouseDrift = true; IN[0].bufDrift = 0.3; }
});
addEventListener("pointerup", (e) => { if (e.button === 0) mouseBoost = false; if (e.button === 2) mouseDrift = false; });
addEventListener("contextmenu", (e) => { if (e.target === renderer.domElement) e.preventDefault(); });
renderer.domElement.addEventListener("wheel", (e) => { if (race.state === "race") { IN[0].cam = true; e.preventDefault(); } }, { passive: false });
addEventListener("touchstart", () => { IN[0].last = "touch"; audioInit(); }, { passive: true });
addEventListener("blur", () => { mouseBoost = mouseDrift = false; if (race.state === "race") edge.pause = true; });
document.addEventListener("visibilitychange", () => {
  if (document.hidden && race.state === "race") edge.pause = true;
  // stop all sound while the tab is hidden, pick it back up when it returns
  if (AU.ctx) { if (document.hidden) AU.ctx.suspend().catch(() => {}); else AU.ctx.resume().catch(() => {}); }
});
let touchUI = null;
if (PA.TOUCH) {
  document.body.classList.add("touch");
  touchUI = PA.touchControls({ stick: true, buttons: [{ label: "Brake", code: "KeyS", alt: true }, { label: "Drift", code: "Space", alt: true }, { label: "Boost", code: "ShiftLeft" }] });
  touchUI.style.display = "none";
}
// Gamepads (standard mapping): left stick steer, RT gas, LT brake/reverse, A boost, B/X/RB drift, Y camera,
// Start pause, Back recover (hold to restart); D-pad/stick + A/B drive the menus. Solo: any pad drives
// player 1. Split-screen: with two pads each player gets one; with one pad it goes to player 2.
let padPrev = [];
function pollPads() {
  let list = [];
  try { list = navigator.getGamepads ? [...(navigator.getGamepads() || [])].filter((p) => p && p.connected) : []; } catch { list = []; }
  const out = [];
  list.forEach((gp, n) => {
    const b = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.4), v = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
    const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0, prev = padPrev[n] || {};
    const now = { a: b(0), b: b(1), x: b(2), y: b(3), rb: b(5), back: b(8), start: b(9), up: b(12) || ay < -0.6, down: b(13) || ay > 0.6, left: b(14) || ax < -0.6, right: b(15) || ax > 0.6 };
    const pressed = (k) => now[k] && !prev[k];
    if (pressed("start")) edge.pause = true;
    if (menuOpen() && !typing()) {
      if (pressed("up")) menuMove(-1); if (pressed("down")) menuMove(1);
      if (pressed("left")) menuAdjust(-1); if (pressed("right")) menuAdjust(1);
      if (pressed("a")) menuActivate(); if (pressed("b")) menuBack();
    }
    padPrev[n] = now;
    const dz = Math.abs(ax) < 0.12 ? 0 : Math.sign(ax) * Math.pow((Math.abs(ax) - 0.12) / 0.88, 1.4);
    out.push({ steer: dz, throttle: v(7), brake: v(6), drift: now.b || now.x || now.rb, boost: now.a, back: now.back, any: Object.values(now).some(Boolean) || Math.abs(ax) > 0.3 || v(6) > 0.1 || v(7) > 0.1, pA: pressed("a"), pD: pressed("b") || pressed("x") || pressed("rb"), pY: pressed("y") });
  });
  return out;
}
function padFor(h, pads) {
  if (race.mode !== "split") return h === 0 ? pads : [];
  if (pads.length >= 2) return [pads[h]];
  return h === 1 ? pads.slice(0, 1) : [];
}
function readInput(dt) {
  const pads = pollPads(), maps = keymap(), n = race.mode === "split" ? 2 : 1;
  for (let h = 0; h < n; h++) {
    const I = IN[h], m = maps[h], gps = padFor(h, pads);
    const kSteer = (kb(m.right) ? 1 : 0) - (kb(m.left) ? 1 : 0);
    let steer = kSteer, gT = 0, gB = 0, gD = false, gBo = false, gBack = false;
    for (const g of gps) {
      if (g.any) I.last = "pad";
      if (Math.abs(g.steer) > Math.abs(steer)) steer = g.steer;
      gT = Math.max(gT, g.throttle); gB = Math.max(gB, g.brake); gD ||= g.drift; gBo ||= g.boost; gBack ||= g.back;
      if (g.pA) I.bufBoost = 0.3; if (g.pD) I.bufDrift = 0.3; if (g.pY) I.cam = true;
    }
    if (h === 0 && race.mode !== "split" && Math.abs(PA.axis.x) > 0.08) steer = clamp(PA.axis.x * 1.2, -1, 1);
    // keyboard steering ramps in (and snaps back faster) so taps stay precise
    if (steer === kSteer && kSteer !== 0) I.steer = damp(I.steer, kSteer, Math.sign(kSteer) !== Math.sign(I.steer) ? 16 : 8, dt);
    else if (steer === kSteer) I.steer = damp(I.steer, 0, 14, dt);
    else I.steer = steer;
    const touchGas = h === 0 && I.last === "touch" && PA.TOUCH;
    I.throttle = Math.max(kb(m.gas) ? 1 : 0, gT, touchGas && !K.has("KeyS") && PA.axis.y < 0.55 ? 1 : 0);
    I.brake = Math.max(kb(m.brake) ? 1 : 0, gB, h === 0 && PA.axis.y > 0.55 ? 1 : 0);
    I.drift = kb(m.drift) || gD || (h === 0 && mouseDrift);
    I.boost = kb(m.boost) || gBo || (h === 0 && mouseBoost);
    const rDown = kb(m.recover) || gBack;
    if (rDown) I.rHeld += dt; else { if (gBack === false && gps.length && I.rHeld > 0 && I.rHeld < 0.6 && !kb(m.recover)) I.recover = true; I.rHeld = 0; }
    I.bufBoost = Math.max(0, I.bufBoost - dt); I.bufDrift = Math.max(0, I.bufDrift - dt);
  }
}
const keyLabel = (what, h = 0) => {
  const L = IN[h].last;
  if (L === "pad") return { gas: "RT", brake: "LT", steer: "Left stick", drift: "B", boost: "A", cam: "Y", recover: "Back" }[what];
  if (L === "touch") return { gas: "auto", brake: "Brake", steer: "Stick", drift: "Drift", boost: "Boost", cam: "Map", recover: "❚❚" }[what];
  const m = keymap()[h] || KEYMAPS.solo[0];
  if (what === "steer") return m.left.slice(0, 1).concat(m.right.slice(0, 1)).map((k) => KEYNAMES[k]).join(" ") + (race.mode === "split" ? "" : " / ← →");
  const codes = { gas: m.gas, brake: m.brake, drift: m.drift, boost: m.boost, cam: m.cam, recover: m.recover }[what];
  return codes.slice(0, race.mode === "split" ? 1 : 2).map((k) => KEYNAMES[k] || k).join(" / ");
};

/* ================================================================ race & car state */
const G = 22, VMAX = 60, VBOOST = 80;
const RIVALS = [{ name: "Vega", model: 1, paint: 1 }, { name: "Juno", model: 3, paint: 2 }, { name: "Kestrel", model: 2, paint: 7 }];
const freshStats = () => ({ longestDrift: 0, maxChain: 0, maxAir: 0, nearMiss: 0, wallTime: 0, shortcuts: 0, topSpeed: 0, crashes: 0, landings: 0 });
const cars = [];      // every car in the race
const humans = [];    // { car, h, cam, camera, hud, rect }
const race = {
  state: "title", mode: "solo", time: 0, count: 0, countStep: 4, order: [], camModes: [PA.store.get("canyon:cam", 0), PA.store.get("canyon:cam2", 0)],
};
function newCar(ctrl, profile, slot) {
  const c = {
    ctrl, name: profile.name, profile, c3: makeSupercar(profile.model, profile.paint),
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, cy: 0, cvy: 0, yaw: 0, seg: TR.A, idx: 0, s: 0, d: 0, th: 0, grounded: true, air: 0, lastGroundY: 0,
    slip: 0, drift: false, driftT: 0, driftLast: -9, chain: 0, boost: 0, boosting: false, boostHold: 0, padT: 0, wallT: 0, scrape: 0,
    invuln: 0, steerVis: 0, roll: 0, pitch: 0, susY: 0, susV: 0, susP: 0, susPV: 0, susR: 0, susRV: 0, flowT: 0, wrongT: 0,
    respawn: 0, respawnTo: null, onSand: false, speed: 0, vf: 0, accel: 0, prevVf: 0, shortcutSeen: {}, lastSeg: null,
    lap: 1, nextCp: 1, lapStart: 0, laps: [], splits: [], finished: false, finishT: null, place: 0, prog: 0, stats: freshStats(),
    rec: [], recT: 0, safe: [], safeT: 0, lastSkid: [null, null], slot, hud: null, inp: ctrl === "ai" ? newInput() : null, ai: null, steerIn: 0,
  };
  if (ctrl === "ai") c.ai = { skill: 1, lane: 0, laneT: 0, plan: [], boostAt: 0.4 };
  cars.push(c);
  return c;
}
function placeCar(c, seg, s, speed = 0, d = 0) {
  frameAt(seg, s, fr); rightOf(fr.th, tmpR);
  c.seg = seg; c.idx = fr.i; c.s = s; c.d = d;
  c.x = fr.x + tmpR.x * d; c.z = fr.z + tmpR.z * d; c.yaw = fr.th; c.th = fr.th;
  c.y = surface(seg, s, d).y; if (c.y === NO_GROUND) c.y = fr.y;
  c.vx = Math.sin(fr.th) * speed; c.vz = Math.cos(fr.th) * speed; c.vy = 0;
  c.grounded = true; c.air = 0; c.lastGroundY = c.y; c.cy = centerHeight(seg, s); c.cvy = 0; c.drift = false; c.slip = 0; c.wallT = 0;
}
const START_S = CHECKPOINTS[0].f * TR.A.len;
function gridCar(c) { const [ds, d] = GRID[c.slot]; placeCar(c, TR.A, START_S + ds, 0, d); }
function clearCars() { for (const c of cars) disposeCar(c.c3); cars.length = 0; humans.length = 0; }
// Build the field for a mode: solo = you + two rivals, split = two players + one rival, trial = just you.
function setupField(mode) {
  clearCars(); race.mode = mode;
  const lvl = settings.rivals ? 1 : 0.9;
  const P1 = settings.p1, P2 = settings.p2;
  const ai = (k, slot) => { const c = newCar("ai", RIVALS[k], slot); c.ai.skill = lvl * (k === 0 ? 1 : 0.985); c.ai.boostAt = settings.rivals ? 0.35 : 0.7; return c; };
  if (mode === "solo") { ai(0, 0); ai(1, 1); humans.push({ car: newCar("p1", P1, 2), h: 0 }); }
  else if (mode === "split") { ai(0, 0); humans.push({ car: newCar("p1", P1, 1), h: 0 }); humans.push({ car: newCar("p2", P2, 2), h: 1 }); }
  else if (mode === "trial") humans.push({ car: newCar("p1", P1, 1), h: 0 });
  else humans.push({ car: newCar("p1", race.garageH ? P2 : P1, 1), h: 0 });   // garage preview
  for (const H of humans) {
    H.camera = H.h === 0 ? camera : new THREE.PerspectiveCamera(66, 1, 0.3, 2600);
    H.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, roll: 0, snap: true, mode: race.camModes[H.h] || 0 };
    H.car.inp = IN[H.h];
  }
  buildHUDs();
  resetRace();
}
function resetRace() {
  for (const c of cars) {
    gridCar(c);
    Object.assign(c, { boost: 0, boosting: false, padT: 0, chain: 0, driftLast: -9, invuln: 0, respawn: 0, respawnTo: null, shortcutSeen: {}, flowT: 0, wrongT: 0, lastSeg: c.seg,
      lap: 1, nextCp: 1, lapStart: 0, laps: [], splits: [], finished: false, finishT: null, place: 0, rec: [], recT: 0, safe: [], safeT: 0, stats: freshStats(), lastSkid: [null, null], tips: {}, bestLap: null, sessionSplits: null });
    if (c.ai) { c.ai.lane = (Math.random() - 0.5) * 3; c.ai.plan = []; }
  }
  Object.assign(race, { time: 0, order: [], doneT: 0 });
  for (const p of pillars) p.hits = new Map();
  for (const p of pads) p.cool = new Map();
  SOFT.clear(); GLOW.clear(); clearSkids();
  for (const H of humans) H.cam.snap = true;
  updateGates();
}

/* ---- events: feed, boost rewards, shake ---- */
function feed(c, text, sub = "", cls = "") {
  if (DEMO || !c || !c.hud) return;
  const box = c.hud.feed, d = document.createElement("div"); d.className = "ev " + cls; d.innerHTML = text + (sub ? `<small>${sub}</small>` : "");
  box.appendChild(d); while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => d.remove(), 950);
}
const reward = (c, amount) => { c.boost = Math.min(1, c.boost + amount); };
function addShake(c, k) { if (c.hud) c.hud.shake = Math.min(1.2, (c.hud.shake || 0) + k); }
const sfxFor = (c, name, ...a) => { if (c.ctrl !== "ai") sfx(name, ...a); };

/* ---- locating a car on the branching track ---- */
function locate(c) {
  let seg = c.seg;
  project(seg, c.x, c.z, c.idx);
  if (PRJ.s > seg.len && seg.next.length) {
    let best = null, bd = 1e9; const save = { ...PRJ };
    for (const nx of seg.next) { project(nx, c.x, c.z, 0); if (Math.abs(PRJ.d) < bd) { bd = Math.abs(PRJ.d); best = { ...PRJ, seg: nx }; } }
    if (best) { seg = best.seg; Object.assign(PRJ, best); } else Object.assign(PRJ, save);
  } else if (PRJ.s < 0 && seg.prev.length) {
    let best = null, bd = 1e9;
    for (const pv of seg.prev) { project(pv, c.x, c.z, pv.n - 1); if (Math.abs(PRJ.d) < bd) { bd = Math.abs(PRJ.d); best = { ...PRJ, seg: pv }; } }
    seg = best.seg; Object.assign(PRJ, best);
  }
  // where branches overlap (just after a fork, just before a merge) pick the road the car is really on
  const cand = [];
  if (PRJ.s < 90) cand.push(...seg.sib.map((o) => [o, PRJ.i]));
  if (seg.len - PRJ.s < 90) cand.push(...seg.mergeSib.map((o) => [o, o.n - (seg.n - PRJ.i)]));
  if (cand.length) {
    const cur = { ...PRJ, seg };
    for (const [o, hint] of cand) {
      project(o, c.x, c.z, clamp(hint, 0, o.n - 1));
      if (PRJ.s >= 0 && PRJ.s <= o.len && Math.abs(PRJ.d) < Math.abs(cur.d) - 0.4) Object.assign(cur, { ...PRJ, seg: o });
    }
    seg = cur.seg; Object.assign(PRJ, cur);
  }
  c.seg = seg; c.s = clamp(PRJ.s, 0, seg.len); c.d = PRJ.d; c.idx = PRJ.i; c.th = PRJ.th;
}
// Race distance along the canonical route (shortcuts are scaled onto the main line) — used for positions.
const OFF = {}, RSCALE = {};
let LAPLEN = 0;
{
  let seg = TR.A, guard = 0;
  do {
    OFF[seg.id] = LAPLEN; RSCALE[seg.id] = 1; LAPLEN += seg.len;
    const main = seg.next.find((n) => !n.def.shortcut) || seg.next[0];
    for (const o of seg.next) if (o !== main) { OFF[o.id] = LAPLEN; RSCALE[o.id] = main.len / o.len; }
    seg = main;
  } while (seg !== TR.A && guard++ < 64);
}
function progressOf(c) {
  const raw = OFF[c.seg.id] + c.s * RSCALE[c.seg.id], fromLine = (raw - START_S + LAPLEN) % LAPLEN;
  // just after the line a car is on its new lap; just before it, it is finishing the previous one
  const lapsDone = c.lap - 1 + (c.nextCp === 0 && fromLine < LAPLEN * 0.5 ? 1 : 0);
  return c.finished ? 1e9 - c.finishT : lapsDone * LAPLEN + fromLine;
}
function updatePlaces() {
  for (const c of cars) c.prog = progressOf(c);
  const order = [...cars].sort((a, b) => b.prog - a.prog);
  order.forEach((c, i) => (c.place = i + 1));
  race.order = order;
}
/* ---- the driving model (fixed 120 Hz step), shared by every car ---- */
function physStep(c, dt) {
  const racing = race.state === "race" && c.respawn <= 0 && !c.finished;
  if (race.state === "count" || race.state === "title" || race.state === "garage") { c.vx = c.vz = 0; return physCore(c, dt, 0, 0, 0, false, false); }
  if (c.ctrl === "ai" || c.finished || DEMO) {
    const a = autopilot(c), go = racing || c.finished || race.state === "done";
    return go ? physCore(c, dt, a.steer, a.throttle * (c.finished ? 0.75 : 1), a.brake, a.drift && !c.finished, a.boost && !c.finished, true) : physCore(c, dt, 0, 0, 1, false, false);
  }
  const I = c.inp;
  if (!racing) return physCore(c, dt, 0, 0, race.state === "done" ? 0 : 1, false, false);
  return physCore(c, dt, I.steer, I.throttle, I.brake, I.drift || I.bufDrift > 0, I.boost || I.bufBoost > 0);
}
function physCore(c, dt, st, thr, brk, wantDrift, wantBoost, aiHeld = false) {
  const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw), rx = -fz, rz = fx;
  let vf = c.vx * fx + c.vz * fz, vl = c.vx * rx + c.vz * rz;
  const hv = Math.hypot(c.vx, c.vz);
  c.steerIn = st;
  // boost: meter, pads, input buffer; a tap still gives a short burst
  const wasBoost = c.boosting;
  c.boostHold = Math.max(0, c.boostHold - dt);
  c.boosting = c.padT > 0 || ((wantBoost || c.boostHold > 0) && c.boost > 0.02 && (wasBoost || c.boost > 0.08));
  if (c.boosting && !wasBoost && c.padT <= 0) c.boostHold = 0.4;
  if (c.padT > 0) c.padT -= dt; else if (c.boosting) { c.boost = Math.max(0, c.boost - 0.3 * dt); if (c.inp) c.inp.bufBoost = 0; }
  if (c.boosting && !wasBoost) { sfxFor(c, "boost"); addShake(c, 0.12); }
  const vmax = c.boosting ? VBOOST : VMAX;
  const surf = surface(c.seg, c.s, c.d);
  const tx = Math.sin(c.th), tz = Math.cos(c.th), Rtx = -tz, Rtz = tx;
  const slopeS = (centerHeight(c.seg, Math.min(c.seg.len, c.s + 1)) - centerHeight(c.seg, Math.max(0, c.s - 1))) / 2;
  const align = fx * tx + fz * tz;
  const assist = c.ctrl === "ai" ? 1 : settings.assist;
  if (c.grounded) {
    // drift: hold the drift button while steering; tapping it snaps the rear out
    if (wantDrift && !c.drift && hv > 11 && Math.abs(st) > 0.15) { c.drift = true; c.yaw -= Math.sign(st) * 0.12; if (c.inp) c.inp.bufDrift = 0; }
    if (c.drift && (!(aiHeld ? wantDrift : c.inp && c.inp.drift) || hv < 8)) c.drift = false;
    const speedK = clamp(hv / 9, 0, 1);
    let yawRate = st * 2.15 * speedK / (1 + hv / 62);
    if (c.drift) yawRate *= 1.6;
    if (vf < -0.5) yawRate = -yawRate;
    if (assist === 2 && Math.abs(st) < 0.05 && hv > 15 && Math.abs(wrapA(c.th - c.yaw)) < 0.5) yawRate += wrapA(c.th - c.yaw) * 1.2;
    c.yaw -= yawRate * dt;
    let acc = 0;
    if (thr > 0) acc += thr * 31 * Math.pow(Math.max(0, 1 - Math.max(0, vf) / vmax), 0.55);
    if (c.boosting) acc += 26 * clamp((vmax - vf) / 10, 0, 1);
    if (vf > vmax) acc -= (vf - vmax) * 1.1;
    if (brk > 0) acc -= vf > 0.8 ? brk * 44 : (vf > -15 ? brk * 15 : 0);
    if (thr === 0 && brk === 0 && !c.boosting) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 1.6);
    acc -= vf * Math.abs(vf) * 0.0006;
    if (c.drift) acc -= Math.sign(vf) * 2.2;
    acc -= G * slopeS * align * 0.9;
    if (c.onSand) acc -= vf * 0.08;
    vf += acc * dt;
    // lateral grip: while drifting most of the slide's momentum carries forward
    const m0 = Math.hypot(vf, vl);
    const grip = c.drift ? 2.1 : clamp(10 - Math.abs(c.slip) * 6, 4.5, 10);
    vl *= Math.exp(-grip * dt);
    const m1 = Math.hypot(vf, vl);
    if (c.drift && vf > 3 && vf < vmax && m1 > 0.01) { const k = Math.min(lerp(1, m0 / m1, 0.9), vmax / Math.max(1, vf)); vf *= k; vl *= k; }
    const maxSlip = assist === 0 ? 1.35 : assist === 1 ? 1.05 : 0.85;
    const slip = hv > 3 ? Math.atan2(vl, Math.max(0.1, vf)) : 0;
    if (Math.abs(slip) > maxSlip) c.yaw -= (Math.abs(slip) - maxSlip) * Math.sign(slip) * Math.min(1, dt * 8);
    c.vx = fx * vf + rx * vl; c.vz = fz * vf + rz * vl;
    // banks: gravity pulls back toward the road, but speed glues the car to the wall (wall-riding)
    if (surf.slopeLat !== 0) {
      const stick = 1 - clamp((hv - 16) / 26, 0, 0.82), a = -G * Math.sin(Math.atan(surf.slopeLat)) * stick;
      c.vx += Rtx * a * dt; c.vz += Rtz * a * dt;
    }
  } else {
    c.yaw -= st * 1.5 * dt;                    // air control: line up the landing
    c.vx *= 1 - 0.02 * dt; c.vz *= 1 - 0.02 * dt;
    if (c.boosting) { c.vx += fx * 10 * dt; c.vz += fz * 10 * dt; }
  }
  c.slip = hv > 3 ? -wrapA(Math.atan2(c.vx, c.vz) - c.yaw) : 0;
  c.accel = (vf - c.prevVf) / dt; c.prevVf = vf;
  const prevSeg = c.seg, prevS = c.s;
  c.x += c.vx * dt; c.z += c.vz * dt;
  locate(c);
  const sf = surface(c.seg, c.s, c.d);
  if (Math.abs(c.d) > sf.limit) wallHit(c, sf);
  const s2 = surface(c.seg, c.s, c.d);
  c.onSand = c.seg.def.surface === "sand" && s2.u === 0;
  // vertical: follow the road; launch when its centre line falls away faster than gravity
  if (c.grounded) {
    const ch = s2.center;
    if (ch === NO_GROUND) { c.grounded = false; c.air = 0; c.vy = c.cvy; }
    else {
      const cb = c.cy + c.cvy * dt - 0.5 * G * dt * dt;
      if (c.seg !== prevSeg) {
        // moved onto another road (a segment hand-off or a fork/merge sibling): take its slope, never
        // turn a height step between the two profiles into vertical speed — that used to launch cars
        const along = c.vx * Math.sin(c.th) + c.vz * Math.cos(c.th);
        const sl = (centerHeight(c.seg, Math.min(c.seg.len, c.s + 1)) - centerHeight(c.seg, Math.max(0, c.s - 1))) / 2;
        c.cvy = clamp(sl * along, -30, 30); c.cy = ch; c.vy = c.cvy; c.y = s2.y; c.lastGroundY = c.y;
      } else if (ch < cb - 0.04 && c.cvy > -2) { c.grounded = false; c.air = 0; c.vy = c.cvy - G * dt; c.y += c.vy * dt; if (c.vy > 2.5) sfxFor(c, "jump"); }
      else { c.cvy = clamp((ch - c.cy) / dt, -30, 30); c.cy = ch; c.vy = c.cvy; c.y = s2.y; c.lastGroundY = c.y; }
    }
  } else {
    c.vy -= G * dt; c.y += c.vy * dt; c.air += dt;
    if (s2.y !== NO_GROUND && c.y <= s2.y) land(c, s2);
    else if (c.y < c.lastGroundY - 24 && c.respawn <= 0) fall(c);
  }
  for (const t of tunnels) if (c.seg === t.seg && c.s > t.s0 - 4 && c.s < t.s1 + 4 && c.y > t.roof - 1.2) { c.y = t.roof - 1.2; c.vy = Math.min(0, c.vy); }
  obstacles(c, dt);
  scoring(c, dt, s2, prevSeg, prevS);
  c.speed = Math.hypot(c.vx, c.vz); c.vf = vf;
}
function wallHit(c, sf) {
  const sg = Math.sign(c.d), over = Math.abs(c.d) - sf.limit, Rtx = -Math.cos(c.th), Rtz = Math.sin(c.th);
  c.x -= Rtx * over * sg; c.z -= Rtz * over * sg; c.d = sg * sf.limit;
  const vT = c.vx * Rtx + c.vz * Rtz;
  if (vT * sg > 0) {
    const imp = Math.abs(vT);
    c.vx -= Rtx * vT * 1.3; c.vz -= Rtz * vT * 1.3;
    const loss = (c.ctrl === "ai" || settings.assist) ? 0.006 : 0.009, k = 1 - Math.min(0.42, imp * loss); c.vx *= k; c.vz *= k;
    const into = wrapA(c.yaw - c.th);   // turn the nose back along the wall: a glancing hit becomes a scrape
    if (Math.sign(-into) === sg || Math.abs(into) > 0.5) c.yaw = c.th + into * (settings.assist || c.ctrl === "ai" ? 0.35 : 0.6);
    const px = c.x + Rtx * sg * 1.0, pz = c.z + Rtz * sg * 1.0;
    if (imp > 9) {
      sfxFor(c, "crash", Math.min(1, imp / 25)); addShake(c, Math.min(0.7, imp / 30)); feed(c, imp > 18 ? "SLAM!" : "WALL HIT", "", "bad");
      c.stats.crashes++; c.chain = 0; c.drift = false; c.driftT = 0;
      for (let i = 0; i < 26; i++) GLOW.emit(px, c.y + 0.6, pz, (Math.random() - 0.5) * 9 - Rtx * sg * 5, Math.random() * 7, (Math.random() - 0.5) * 9 - Rtz * sg * 5, 0.5, 0.18, 0.05, 1, Math.random() < 0.5 ? COL.spark : COL.spark2, 18, 1);
    } else if (imp > 2) { sfxFor(c, "bump"); addShake(c, 0.06); }
    c.scrape = Math.max(c.scrape, Math.min(1, Math.hypot(c.vx, c.vz) / 50));
  } else c.scrape = Math.max(c.scrape, 0.3 * Math.min(1, Math.hypot(c.vx, c.vz) / 50));
}
function land(c, sf) {
  const air = c.air, imp = Math.max(0, -c.vy);
  c.grounded = true; c.y = sf.y; c.vy = 0; c.lastGroundY = c.y; c.cy = sf.center; c.cvy = 0;
  const vdir = Math.atan2(c.vx, c.vz), mis = Math.abs(wrapA(vdir - c.yaw)), hv = Math.hypot(c.vx, c.vz);
  c.susV -= Math.min(6, imp * 0.35); c.susPV += 1.5 * Math.min(1, imp / 12);
  sfxFor(c, "land", Math.min(1, imp / 18)); addShake(c, Math.min(0.45, imp / 40));
  const n = Math.min(40, 8 + imp * 2);
  for (let i = 0; i < n; i++) { const a = Math.random() * 6.28; SOFT.emit(c.x + Math.cos(a) * 1.5, c.y + 0.3, c.z + Math.sin(a) * 1.5, Math.cos(a) * 5, 1 + Math.random() * 2, Math.sin(a) * 5, 1.1, 1.2, 4.5, 0.5, c.onSand ? COL.sand : COL.dust, -0.4, 1.8); }
  if (air > 0.5 && race.state === "race") {
    const clean = mis < 0.3 && Math.abs(c.roll) < 0.4;
    reward(c, 0.06 + Math.min(0.14, air * 0.08));
    c.stats.maxAir = Math.max(c.stats.maxAir, air); if (clean) c.stats.landings++;
    feed(c, air > 1.1 ? "HUGE AIR" : "BIG AIR", air.toFixed(1) + "s", air > 1.1 ? "big" : "");
    if (clean) { reward(c, 0.1); c.vx *= 1.04; c.vz *= 1.04; feed(c, "CLEAN LANDING", "+BOOST"); }
    else if (mis > 0.6) { c.vx *= 0.8; c.vz *= 0.8; feed(c, "ROUGH LANDING", "", "bad"); addShake(c, 0.2); }
  }
  const assist = c.ctrl === "ai" ? 2 : settings.assist;
  if (assist && hv > 5 && mis < 1.2) c.yaw = vdir + wrapA(c.yaw - vdir) * (assist === 2 ? 0.2 : 0.5);
}
function fall(c) {
  sfxFor(c, "fall"); feed(c, "OFF THE EDGE", "respawning", "bad");
  // fell into a jump gap: put the car back on the landing side, so a missed jump only costs time
  let to = null;
  for (const g of c.seg.gaps) if (c.s > g.s0 - 30 && c.s < g.s1 + 8) to = { seg: c.seg, s: g.land, v: 30 };
  beginRespawn(c, to || safePoint(c));
}
function safePoint(c) {
  for (let i = c.safe.length - 1; i >= 0; i--) if (race.time - c.safe[i].t > 1.2) return c.safe[i];
  return c.safe[0] || { seg: c.seg, s: c.s, v: 12 };
}
function beginRespawn(c, to) {
  if (c.respawn > 0) return;
  c.respawn = 0.9; c.respawnTo = to; if (c.hud) c.hud.fade.classList.add("on");
  c.chain = 0; c.drift = false; c.driftT = 0;
}
function finishRespawn(c) {
  const to = c.respawnTo; c.respawnTo = null;
  placeCar(c, to.seg, to.s, Math.max(14, to.v * 0.7), c.ai ? c.ai.lane * 0.5 : 0); c.invuln = 1.6; c.boosting = false;
  if (c.hud) c.hud.fade.classList.remove("on");
}
// Rock pillars (bump or thread past for a near-miss), tumbleweeds and boost pads.
function obstacles(c, dt) {
  for (const p of pillars) {
    const dx = c.x - p.x, dz = c.z - p.z; if (Math.abs(dx) > 30 || Math.abs(dz) > 30) continue;
    const dist = Math.hypot(dx, dz), rad = p.r + 1.05, st = p.hits.get(c) || { near: false, hit: false };
    if (dist < rad && c.y < p.top) {
      const nx = dx / dist, nz = dz / dist, vn = c.vx * nx + c.vz * nz;
      c.x = p.x + nx * rad; c.z = p.z + nz * rad;
      if (vn < 0) {
        c.vx -= nx * vn * 1.35; c.vz -= nz * vn * 1.35; c.vx *= 0.78; c.vz *= 0.78; st.hit = true;
        if (-vn > 6) { sfxFor(c, "crash", Math.min(1, -vn / 25)); addShake(c, Math.min(0.6, -vn / 30)); feed(c, "ROCK!", "", "bad"); c.chain = 0; c.stats.crashes++;
          for (let i = 0; i < 18; i++) GLOW.emit(c.x - nx, c.y + 0.7, c.z - nz, -nx * 6 + (Math.random() - 0.5) * 6, Math.random() * 6, -nz * 6 + (Math.random() - 0.5) * 6, 0.45, 0.16, 0.05, 1, COL.spark, 18, 1); }
      }
    } else if (dist < rad + 2.6 && c.speed > 22) st.near = true;
    else if (st.near && dist > rad + 7) {
      if (!st.hit && race.state === "race") { reward(c, 0.13); sfxFor(c, "near"); feed(c, "NEAR MISS", "+BOOST"); c.stats.nearMiss++; }
      st.near = false; st.hit = false;
    }
    p.hits.set(c, st);
  }
  for (const w of weeds) {
    if (w.dead > 0) continue;
    const dx = c.x - w.m.position.x, dz = c.z - w.m.position.z, dy = c.y + 0.8 - w.m.position.y;
    if (dx * dx + dz * dz < 4 && Math.abs(dy) < 2.5) {
      w.dead = 6; w.m.visible = false; sfxFor(c, "weed"); if (race.state === "race") feed(c, "TUMBLEWEED!", "");
      for (let i = 0; i < 30; i++) SOFT.emit(w.m.position.x, w.m.position.y, w.m.position.z, (Math.random() - 0.5) * 8 + c.vx * 0.3, Math.random() * 6, (Math.random() - 0.5) * 8 + c.vz * 0.3, 1, 0.35, 0.15, 0.9, COL.weed, 9, 0.5);
    }
  }
  for (const p of pads) {
    const cool = Math.max(0, (p.cool.get(c) || 0) - dt); p.cool.set(c, cool);
    if (p.seg === c.seg && c.grounded && Math.abs(c.s - p.s) < 4 && Math.abs(c.d) < 2.8 && cool <= 0) { c.padT = 1.4; p.cool.set(c, 2); sfxFor(c, "pad"); if (race.state === "race") feed(c, "BOOST PAD", ""); }
  }
}
// Cars bump off each other: equal masses, a little bounce, nobody gets launched. Each car is three
// overlapping circles along its length (nose, middle, tail), so bodies touch where they look like they do.
const FOOT = [-1.7, 0, 1.55], FOOT_R = 1.02;
function carContacts() {
  // two passes: the second one cleans up any overlap left after three cars bunch up
  for (let pass = 0; pass < 2; pass++) for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (a.respawn > 0 || b.respawn > 0 || a.invuln > 0 || b.invuln > 0) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d2 = dx * dx + dz * dz;
    if (d2 > 6.6 * 6.6 || Math.abs(a.y - b.y) > 1.6) continue;
    let best = null;
    for (const oa of FOOT) for (const ob of FOOT) {
      const ax = a.x + Math.sin(a.yaw) * oa, az = a.z + Math.cos(a.yaw) * oa, bx = b.x + Math.sin(b.yaw) * ob, bz = b.z + Math.cos(b.yaw) * ob;
      const ex = bx - ax, ez = bz - az, dd = Math.hypot(ex, ez);
      if (dd < FOOT_R * 2 && (!best || dd < best.dd)) best = { dd, ex, ez };
    }
    if (!best) continue;
    const nx = best.dd > 1e-3 ? best.ex / best.dd : Math.cos(a.yaw), nz = best.dd > 1e-3 ? best.ez / best.dd : -Math.sin(a.yaw), push = (FOOT_R * 2 - best.dd) / 2;
    a.x -= nx * push; a.z -= nz * push; b.x += nx * push; b.z += nz * push;
    const rv = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
    if (rv < 0) {
      const jj = -rv * 0.65;
      a.vx -= nx * jj; a.vz -= nz * jj; b.vx += nx * jj; b.vz += nz * jj;
      if (-rv > 3) {
        for (const c of [a, b]) { sfxFor(c, "bump"); addShake(c, Math.min(0.35, -rv / 30)); }
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        for (let q = 0; q < 10; q++) GLOW.emit(mx, a.y + 0.6, mz, (Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6, 0.35, 0.14, 0.04, 1, COL.spark, 16, 0.5);
      }
    }
  }
}
// Rewards, laps and checkpoints.
function scoring(c, dt, sf, prevSeg, prevS) {
  const st = c.stats, racing = race.state === "race" && !c.finished;
  const sliding = c.grounded && Math.abs(c.slip) > 0.28 && c.speed > 16;
  if (sliding) { c.driftT += dt; if (racing) reward(c, 0.085 * Math.min(1, Math.abs(c.slip) / 0.75) * (1 + c.chain * 0.15) * dt); }
  else if (c.driftT > 0) {
    if (c.driftT > 0.65 && racing) {
      const chained = race.time - c.driftLast < 1.5;
      c.chain = chained ? c.chain + 1 : 1; c.driftLast = race.time;
      reward(c, 0.03 * c.chain);
      feed(c, c.chain > 1 ? `DRIFT ×${c.chain}` : "DRIFT", c.driftT.toFixed(1) + "s", c.chain > 2 ? "big" : "");
      sfxFor(c, "ding", c.chain);
      st.longestDrift = Math.max(st.longestDrift, c.driftT); st.maxChain = Math.max(st.maxChain, c.chain);
    }
    c.driftT = 0;
  }
  if (c.chain > 0 && race.time - c.driftLast > 2.2 && c.driftT === 0) c.chain = 0;
  if (c.grounded && sf.u > sf.R * 0.42 && c.speed > 24 && !sf.open) { c.wallT += dt; if (racing) reward(c, 0.11 * dt); st.wallTime += dt; }
  else if (c.wallT > 0) { if (c.wallT > 0.7 && racing) feed(c, "WALL RIDE", c.wallT.toFixed(1) + "s"); c.wallT = 0; }
  if (c.speed > 52 && c.grounded) { c.flowT += dt; if (c.flowT > 5) { c.flowT = 0; if (racing) { reward(c, 0.08); feed(c, "IN THE ZONE", "+BOOST"); } } } else if (c.speed < 40) c.flowT = 0;
  st.topSpeed = Math.max(st.topSpeed, c.speed);
  if (c.seg !== c.lastSeg) {
    if (c.seg.def.shortcut && racing) {
      const first = !c.shortcutSeen[c.seg.id]; c.shortcutSeen[c.seg.id] = true;
      reward(c, first ? 0.22 : 0.08); feed(c, first ? "SHORTCUT FOUND" : "SHORTCUT", c.seg.def.name, "big"); if (first) st.shortcuts++;
    }
    c.lastSeg = c.seg;
  }
  c.safeT -= dt;
  if (c.grounded && c.safeT <= 0 && Math.abs(c.d) < c.seg.HW[c.idx] && c.respawn <= 0 && !c.seg.gaps.some((g) => c.s > g.s0 - 150 && c.s < g.s1 + 6)) {
    c.safeT = 0.4; c.safe.push({ seg: c.seg, s: c.s, v: c.speed, t: race.time }); if (c.safe.length > 20) c.safe.shift();
  }
  const along = c.vx * Math.sin(c.th) + c.vz * Math.cos(c.th);
  if (racing && along < -4) c.wrongT += dt; else c.wrongT = Math.max(0, c.wrongT - dt * 2);
  if (!racing) return;
  const cp = CHECKPOINTS[c.nextCp];
  if (c.seg === cp.segRef && prevSeg === c.seg && prevS < cp.s && c.s >= cp.s) passCheckpoint(c, c.nextCp);
}
function passCheckpoint(c, k) {
  const lapT = race.time - c.lapStart;
  c.splits[k] = lapT;
  if (c.hud) {
    const ref = (race.mode === "trial" || race.mode === "solo") && c.ctrl === "p1" ? records.splits || c.sessionSplits : c.sessionSplits;
    const el = c.hud.split, label = k === 0 ? "LAP" : "CHECKPOINT " + k;
    if (ref && ref[k] != null) { const dlt = lapT - ref[k]; el.innerHTML = `<small>${label}</small>${dlt <= 0 ? "−" : "+"}${Math.abs(dlt).toFixed(2)}`; el.className = "split show " + (dlt <= 0 ? "ahead" : "behind"); }
    else { el.innerHTML = `<small>${label}</small>${fmtT(lapT)}`; el.className = "split show"; }
    clearTimeout(el._t); el._t = setTimeout(() => (el.className = "split"), 1800);
    sfx("chime");
  }
  if (k === 0) lapComplete(c, lapT); else c.nextCp = (k + 1) % CHECKPOINTS.length;
  updateGates();
}
function lapComplete(c, lapT) {
  c.laps.push(lapT);
  if (c.bestLap == null || lapT < c.bestLap) { c.bestLap = lapT; c.sessionSplits = c.splits.slice(); }
  if (c.ctrl === "p1" && race.mode !== "split" && (records.lap == null || lapT < records.lap)) {
    records.lap = +lapT.toFixed(3); records.splits = c.splits.map((v) => +v.toFixed(3)); records.ghost = c.rec.map((v) => Math.round(v * 100) / 100); saveRecords();
    feed(c, "BEST LAP", fmtT(lapT), "big");
  }
  c.rec = []; c.recT = 0; c.lapStart = race.time; c.splits = []; c.nextCp = 1;
  if (c.lap >= LAPS) { finishCar(c); return; }
  c.lap++;
  if (c.hud) { sfx("lap"); if (c.lap === LAPS) { feed(c, "FINAL LAP", "", "big"); musicStart("final"); } else feed(c, `LAP ${c.lap}`, "", "big"); }
}
function finishCar(c) {
  c.finished = true; c.finishT = race.time;
  updatePlaces();
  if (c.hud) { sfx("fanfare"); feed(c, `FINISH · ${ordinal(c.place)}`, fmtT(c.finishT), "big"); c.hud.root.classList.add("done"); }
  if (humans.every((H) => H.car.finished) && race.state === "race") finishRace();
}
const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");
function updateGates() { const live = race.state !== "garage" && race.state !== "title"; gates.forEach((g, k) => { g.next = live && humans.some((H) => !H.car.finished && k === H.car.nextCp); }); }

/* ---- autopilot: drives the rivals (and attract mode, cool-down laps and automated playtests) ---- */
// A lap plan lists the branch taken at every fork. Rivals pick theirs per lap (Pro rivals hunt the
// shortcuts); the autopilot driving a human car (attract mode, playtests) runs safe, shortcut, mixed.
const FORKS = SEGS.filter((sg) => sg.next.length > 1);
const safeOf = (f) => f.next.find((n) => !n.def.shortcut) || f.next[0], cutOf = (f) => f.next.find((n) => n.def.shortcut) || f.next[f.next.length - 1];
function routeChoice(c, seg) {
  if (seg.next.length < 2) return seg.next[0];
  const forced = PA.params.get("route");
  let plan = forced ? forced.split(",") : c.ai && c.ai.plan[c.lap - 1];
  if (!plan) {
    if (c.ai) { const p = settings.rivals === 1 ? 0.5 : 0.12; plan = FORKS.map((f) => (Math.random() < p ? cutOf(f) : safeOf(f)).id); c.ai.plan[c.lap - 1] = plan; }
    else { const L = (c.lap - 1) % 3; plan = FORKS.map((f, k) => (L === 1 || (L === 2 && k % 2 === 0) ? cutOf(f) : safeOf(f)).id); }
  }
  return seg.next.find((n) => plan.includes(n.id)) || seg.next[0];
}
const AIP = { x: 0, z: 0, y: 0, th: 0, i: 0 };
function aheadOnRoute(c, seg, s, dist, out) {
  let sg = seg, ss = s + dist, guard = 0;
  while (ss > sg.len && guard++ < 4) { ss -= sg.len; sg = routeChoice(c, sg); }
  frameAt(sg, ss, out); out.seg = sg; return out;
}
function autopilot(c) {
  const hv = c.speed, ai = c.ai || { skill: 1, lane: 0, boostAt: 0.35 };
  // drift the racing lane around a little and steer around a car close ahead
  if (c.ai) {
    c.ai.laneT -= 1 / 120; if (c.ai.laneT <= 0) { c.ai.laneT = 2 + Math.random() * 3; c.ai.laneGoal = (Math.random() - 0.5) * 4; }
    let goal = c.ai.laneGoal || 0;
    for (const o of cars) {
      if (o === c) continue;
      const dx = o.x - c.x, dz = o.z - c.z, fwd = dx * Math.sin(c.yaw) + dz * Math.cos(c.yaw), side = -dx * Math.cos(c.yaw) + dz * Math.sin(c.yaw);
      if (fwd > 0 && fwd < 16 && Math.abs(side) < 2.6) goal = side > 0 ? -3.2 : 3.2;
      // about to rear-end a slower car: lift off instead of driving into it
      const closing = (c.vx - o.vx) * Math.sin(c.yaw) + (c.vz - o.vz) * Math.cos(c.yaw);
      if (fwd > 0 && fwd < 9 && Math.abs(side) < 2.3 && closing > 2 && Math.abs(o.y - c.y) < 1.6) c.ai.lift = 0.25;
    }
    c.ai.lift = Math.max(0, (c.ai.lift || 0) - 1 / 120);
    c.ai.lane = damp(c.ai.lane, goal, 1.5, 1 / 120);
  }
  const look = 9 + hv * 0.42;
  const p = aheadOnRoute(c, c.seg, c.s, look, AIP);
  const lane = clamp(ai.lane, -p.seg.HW[p.i] + 2, p.seg.HW[p.i] - 2), px = p.x - Math.cos(p.th) * lane, pz = p.z + Math.sin(p.th) * lane;
  const want = Math.atan2(px - c.x, pz - c.z), diff = wrapA(want - c.yaw);
  const a1 = aheadOnRoute(c, c.seg, c.s, 12, {}).th, a2 = aheadOnRoute(c, c.seg, c.s, 12 + Math.max(30, hv * 1.1), {}).th;
  const turn = Math.abs(wrapA(a2 - a1)) / Math.max(30, hv * 1.1), R = 1 / Math.max(1e-4, turn);
  const vSafe = (Math.sqrt(27 * R) + 6) * ai.skill, vTop = VMAX * (ai.skill < 1 ? 0.93 : 1.02);
  const gapAhead = c.seg.gaps.some((g) => g.s0 - c.s > 0 && g.s0 - c.s < 120);
  return {
    steer: clamp(-diff * 2.8, -1, 1), throttle: ((hv < vSafe && hv < vTop) || gapAhead) && !(ai.lift > 0 && !gapAhead) ? 1 : 0, brake: hv > vSafe + 9 && !gapAhead ? 1 : 0,
    drift: Math.abs(diff) > 0.3 && hv > 26, boost: c.boost > ai.boostAt && (turn < 1 / 160 || gapAhead),
  };
}

/* ================================================================ per-frame visuals */
const V1 = new THREE.Vector3(), V2 = new THREE.Vector3(), eul = new THREE.Euler(0, 0, 0, "YXZ");
const WHEEL_L = [new THREE.Vector3(-0.93, 0.04, -1.45), new THREE.Vector3(0.93, 0.04, -1.45)];
function nearHuman(c, r) { for (const H of humans) { const o = H.car; if (o === c || (Math.abs(o.x - c.x) < r && Math.abs(o.z - c.z) < r)) return true; } return false; }
function updateCarVisual(c, dt) {
  const c3 = c.c3, root = c3.root, hv = c.speed, live = race.state === "race";
  const align = Math.cos(c.yaw - c.th);
  let pT, rT;
  if (c.grounded) {
    const a = centerHeight(c.seg, Math.min(c.seg.len, c.s + 1.5)), b = centerHeight(c.seg, Math.max(0, c.s - 1.5));
    const slope = a === NO_GROUND || b === NO_GROUND ? 0 : (a - b) / 3;
    const sf = surface(c.seg, c.s, c.d);
    pT = -Math.atan(slope * align); rT = -Math.atan(sf.slopeLat) * align;
  } else { pT = clamp(-Math.atan2(c.vy, Math.max(4, hv)) * 0.55, -0.45, 0.45); rT = c.roll * 0.97 - c.steerIn * 0.004; }
  c.pitch = damp(c.pitch, pT, c.grounded ? 16 : 3, dt); c.roll = damp(c.roll, rT, c.grounded ? 14 : 2, dt);
  root.position.set(c.x, c.y, c.z);
  root.quaternion.setFromEuler(eul.set(c.pitch, c.yaw, c.roll));
  // suspension: springs for heave, pitch (squat / dive) and body roll
  const speedK = clamp(hv / 30, 0, 1);
  const rollT = -c.steerIn * speedK * 0.06 * (c.grounded ? 1 : 0.3) - (c.drift ? Math.sign(c.slip) * 0.04 : 0);
  const pitchT = clamp(-c.accel * 0.0035, -0.07, 0.07);
  if (dt > 0) {
    const d = Math.min(dt, 1 / 30);
    c.susV += (-(c.susY) * 160 - c.susV * 14) * d; c.susY += c.susV * d;
    c.susPV += ((pitchT - c.susP) * 120 - c.susPV * 12) * d; c.susP += c.susPV * d;
    c.susRV += ((rollT - c.susR) * 110 - c.susRV * 11) * d; c.susR += c.susRV * d;
  }
  const rough = c.grounded && (c.onSand || c.scrape > 0.2) ? (Math.random() - 0.5) * 0.03 * speedK : 0;
  c3.body.position.y = c.susY + rough + (c.grounded ? Math.sin(performance.now() * 0.03 + c.slot) * 0.006 * speedK : 0);
  c3.body.rotation.set(c.susP, 0, c.susR);
  for (const w of c3.wheels) { w.spin.rotation.x += (c.vf / 0.41) * dt; w.piv.position.y = 0.41 - clamp(c.susY * 0.6, -0.12, 0.1) + (c.grounded ? 0 : -0.1); }
  c.steerVis = damp(c.steerVis, c.steerIn * (live || c.ctrl === "ai" ? 1 : 0), 12, dt);
  for (const p of c3.steer) p.rotation.y = -c.steerVis * 0.42 + (c.drift ? Math.sign(c.slip) * 0.25 : 0);
  c3.body.visible = !(c.invuln > 0 && Math.floor(performance.now() / 70) % 2 === 0);
  root.visible = c.respawn <= 0.5 || c.respawn > 0.85 || c.ctrl !== "ai";
  root.updateMatrixWorld(true);
  if (nearHuman(c, 140)) effects(c, dt);
}
function effects(c, dt) {
  const root = c.c3.root, hv = c.speed;
  if (dt <= 0) return;
  const sf = surface(c.seg, c.s, c.d), braking = c.inp && c.inp.brake > 0.5 && c.vf > 12 && race.state === "race";
  const slide = c.grounded && hv > 9 && (Math.abs(c.slip) > 0.22 || braking);
  for (let k = 0; k < 2; k++) {
    const w = V1.copy(WHEEL_L[k]).applyMatrix4(root.matrixWorld);
    if (slide && sf.u < 0.5) {
      if (c.lastSkid[k]) addSkid(c.lastSkid[k].x, c.lastSkid[k].y, c.lastSkid[k].z, w.x, w.y, w.z);
      (c.lastSkid[k] ||= new THREE.Vector3()).copy(w);
      if (Math.random() < 0.7) SOFT.emit(w.x, w.y + 0.3, w.z, -c.vx * 0.12 + (Math.random() - 0.5) * 2, 0.8 + Math.random(), -c.vz * 0.12 + (Math.random() - 0.5) * 2, 1.4, 1.1, 5.5, c.onSand ? 0.55 : 0.32, c.onSand ? COL.sand : COL.smoke, -0.5, 1.4);
    } else c.lastSkid[k] = null;
    if (c.grounded && hv > 18 && Math.random() < (c.onSand ? 0.9 : sf.u > 0 ? 0.6 : 0.22)) SOFT.emit(w.x, w.y + 0.2, w.z, -c.vx * 0.05 + (Math.random() - 0.5) * 3, 0.6 + Math.random() * 1.5, -c.vz * 0.05 + (Math.random() - 0.5) * 3, 1.6, 0.8, 4.2, c.onSand ? 0.38 : 0.16, c.onSand ? COL.sand : COL.dust, -0.3, 1.2);
  }
  if (c.boosting) {
    for (const p of c.c3.pipes) {
      const e = V2.copy(p).applyMatrix4(root.matrixWorld), fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
      for (let q = 0; q < 2; q++) GLOW.emit(e.x, e.y, e.z, c.vx * 0.85 - fx * 9 + (Math.random() - 0.5) * 1.5, (Math.random() - 0.3) * 1.5, c.vz * 0.85 - fz * 9 + (Math.random() - 0.5) * 1.5, 0.2, 0.85, 0.2, 1, q ? COL.flame : COL.flame2, 0, 2);
      GLOW.emit(e.x, e.y, e.z, 0, 0.2, 0, 0.55, 0.55, 0.1, 0.45, COL.flame2, 0, 0);
    }
  }
  if (c.scrape > 0.15) {
    const sg = Math.sign(c.d), Rtx = -Math.cos(c.th), Rtz = Math.sin(c.th);
    for (let q = 0; q < 3; q++) GLOW.emit(c.x + Rtx * sg * 1.1, c.y + 0.5, c.z + Rtz * sg * 1.1, c.vx * 0.4 + (Math.random() - 0.5) * 6, Math.random() * 4, c.vz * 0.4 + (Math.random() - 0.5) * 6, 0.35, 0.14, 0.04, 1, Math.random() < 0.5 ? COL.spark : COL.spark2, 16, 0.5);
  }
  c.scrape *= Math.exp(-dt * 10);
}
function updateWorld(dt, t) {
  for (const w of weeds) {
    if (w.dead > 0) { w.dead -= dt; if (w.dead <= 0) w.m.visible = true; continue; }
    const seg = w.seg, i = clamp(Math.floor(w.s / SP), 0, seg.n - 1), lim = seg.HW[i] + 2;
    w.d += w.dir * w.sp * dt; if (Math.abs(w.d) > lim) { w.d = Math.sign(w.d) * lim; w.dir *= -1; }
    w.vy -= 18 * dt; w.y += w.vy * dt; if (w.y < 0) { w.y = 0; w.vy = 3 + Math.random() * 3; }
    frameAt(seg, w.s, fr); rightOf(fr.th, tmpR);
    const sy = surface(seg, w.s, w.d).y;
    w.m.position.set(fr.x + tmpR.x * w.d, (sy === NO_GROUND ? fr.y : sy) + 0.95 + w.y, fr.z + tmpR.z * w.d);
    w.m.rotation.x += w.dir * w.sp * dt; w.m.rotation.z += dt * 0.7;
  }
  padTex.offset.y = (t * 1.6) % 1;
  for (const g of gates) { const on = g.next ? 0.5 + 0.5 * Math.sin(t * 5) : 0; g.glow.material.opacity = on * 0.16; g.mat.emissiveIntensity = 0.15 + on * 0.9; }
  // speed streaks (single view only: in split-screen they would fly through the other player's view)
  const car = humans[0] && humans[0].car;
  const sk = car && humans.length === 1 ? clamp((car.speed - 38) / 30, 0, 1) * (race.state === "race" ? 1 : 0) : 0;
  streaks.material.opacity = sk * 0.55;
  if (sk > 0) {
    const fx = Math.sin(car.yaw), fz = Math.cos(car.yaw), m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromAxisAngle(YAXIS, Math.atan2(car.vx, car.vz));
    for (let i = 0; i < STREAK_N; i++) {
      const p = streakPos[i], rel = (p.x - car.x) * fx + (p.z - car.z) * fz;
      if (rel < -8 || rel > 90 || p.y < -500) { const a = Math.random() * 6.28, r = 3 + Math.random() * 7; p.set(car.x + fx * (40 + Math.random() * 50) + Math.cos(a) * r * fz, car.y + 1 + Math.sin(a) * r * 0.6 + 1.5, car.z + fz * (40 + Math.random() * 50) - Math.cos(a) * r * fx); }
      streaks.setMatrixAt(i, m.compose(p, q, skS.set(1, 1, 0.6 + sk * 1.6)));
    }
    streaks.instanceMatrix.needsUpdate = true;
  }
  SOFT.update(dt); GLOW.update(dt);
}
function setSunForRace(k) { // k: 0 → 1 over the race — the sun sinks lower and warmer
  sunAz = LOOK.sunAz + k * 0.12; sunEl = LOOK.sunEl - k * LOOK.sunDrop; setSunDir(); paintSky(); placeSunDisc();
  sun.color.setRGB(lerp(LOOK.sun[0], LOOK.sunEnd[0], k), lerp(LOOK.sun[1], LOOK.sunEnd[1], k), lerp(LOOK.sun[2], LOOK.sunEnd[2], k));
}

/* ================================================================ audio mix per frame */
const GEARS = [0, 15, 27, 39, 51, 64, 999];
function engineVoice(E, c, level, pan, mute, thr) {
  const t = AU.ctx.currentTime, v = c.speed, idle = race.state === "count" || race.state === "title" || race.state === "garage";
  let g = 1; while (g < GEARS.length - 1 && v > GEARS[g]) g++;
  if (g !== E.gear) { if (g > E.gear && race.state === "race" && c.ctrl !== "ai") c.susPV -= 0.25; E.gear = g; }
  const rpm = clamp((v - GEARS[g - 1]) / (GEARS[g] - GEARS[g - 1]), 0, 1);
  let f = idle ? 46 + thr * 80 : 48 + (0.18 + rpm * 0.82) * 92 + g * 7;
  if (!c.grounded) f *= 1.12;
  if (c.boosting) f *= 1.06;
  f *= 1 + (c.slot - 1) * 0.03;      // each car sounds a touch different
  E.o1.frequency.setTargetAtTime(f, t, 0.04); E.o2.frequency.setTargetAtTime(f / 2, t, 0.04); E.o3.frequency.setTargetAtTime(f / 2, t, 0.04);
  E.ef.frequency.setTargetAtTime(380 + thr * 1500 + v * 9, t, 0.06);
  E.pn.pan.setTargetAtTime(pan, t, 0.1);
  E.eg.gain.setTargetAtTime(mute ? 0 : level * (race.state === "title" || race.state === "garage" ? 0.05 : 0.08 + thr * 0.07), t, 0.08);
}
function updateAudio() {
  if (!AU.ready || DEMO || !humans.length) return;
  const t = AU.ctx.currentTime, live = race.state === "race" || race.state === "count" || race.state === "done";
  const muteAll = race.state === "paused" || (!live && race.state !== "title" && race.state !== "garage");
  const L = humans[0].car, split = humans.length > 1;
  const thrOf = (c) => race.state === "count" ? c.inp.throttle : race.state === "race" ? (DEMO || c.finished ? 1 : c.inp.throttle) : 0.2;
  const voices = humans.map((H, i) => ({ c: H.car, level: 1, pan: split ? (i ? 0.55 : -0.55) : 0, thr: thrOf(H.car) }));
  const camR = V1.set(1, 0, 0).applyQuaternion(humans[0].camera.quaternion), cp = humans[0].camera.position;
  // every rival keeps the same voice for the whole race (re-sorting by distance made pitch and pan jump)
  const menuish = race.state === "title" || race.state === "garage";
  for (const c of cars) {
    if (c.ctrl !== "ai" || voices.length >= AU.engs.length) continue;
    const d = Math.hypot(c.x - L.x, c.z - L.z), rel = (c.x - cp.x) * camR.x + (c.z - cp.z) * camR.z;
    voices.push({ c, level: menuish ? 0 : 0.6 / (1 + d / 12), pan: clamp(rel / 18, -0.8, 0.8), thr: c.speed < VMAX - 4 || c.boosting ? 1 : 0.35 });
  }
  // engines settle down once the race is over, and almost vanish behind the results screen
  const after = race.state === "done" ? (race.resultsShown ? 0.12 : 0.45) : 1;
  AU.engs.forEach((E, i) => { const vo = voices[i]; if (vo) engineVoice(E, vo.c, vo.level * after, vo.pan, muteAll, vo.thr); else E.eg.gain.setTargetAtTime(0, t, 0.1); });
  // tyre, wind, boost, scrape and dirt loops follow the human drivers
  let slipK = 0, wind = 0, boost = 0, scrape = 0, dirt = 0, slipF = 0;
  for (const H of humans) {
    const c = H.car, v = c.speed, brk = c.inp.brake > 0.5 && c.vf > 12 && c.grounded && race.state === "race";
    const sk = c.grounded ? clamp((Math.abs(c.slip) - 0.16) * 1.6, 0, 0.55) * Math.min(1, v / 18) + (brk ? 0.22 : 0) : 0;
    slipK = Math.max(slipK, sk * (c.onSand ? 0.4 : 0.75)); slipF = Math.max(slipF, Math.abs(c.slip));
    wind = Math.max(wind, Math.pow(v / 80, 2) * 0.55 + (c.grounded ? 0 : 0.12));
    if (c.boosting) boost = 0.32;
    scrape = Math.max(scrape, c.scrape * 0.45);
    dirt = Math.max(dirt, c.grounded ? (c.onSand ? 0.35 : 0.08) * Math.min(1, v / 40) : 0);
  }
  const m = muteAll || race.state === "title" || race.state === "garage" ? 0 : race.state === "done" ? 0.4 : 1;
  AU.tire.g.gain.setTargetAtTime(slipK * m, t, 0.05); AU.tire.fl.frequency.setTargetAtTime(1300 + slipF * 900, t, 0.1);
  AU.wind.g.gain.setTargetAtTime(wind * m, t, 0.1); AU.wind.fl.frequency.setTargetAtTime(350 + L.speed * 14, t, 0.1);
  AU.boost.g.gain.setTargetAtTime(boost * m, t, 0.05);
  AU.scrape.g.gain.setTargetAtTime(scrape * m, t, 0.03);
  AU.dirt.g.gain.setTargetAtTime(dirt * m, t, 0.1);
}

/* ================================================================ cameras: one per human, each in its own viewport */
const CAMS = [{ name: "Chase", dist: 8.6, h: 3.2, look: 1.4, fov: 66 }, { name: "Close", dist: 6, h: 2.2, look: 1.1, fov: 72 }, { name: "Bumper", bumper: true, fov: 80 }];
const camPrj = { s: 0, d: 0, i: 0, th: 0 }, fwdV = new THREE.Vector3();
function updateCamera(H, dt, t) {
  const c = H.car, hv = c.speed, cam = H.cam, camera = H.camera, r = H.rect || { w: innerWidth, h: innerHeight };
  const narrow = r.w / r.h < 1.15 ? 8 : 0;       // tall split views get a wider lens
  let mode = CAMS[cam.mode];
  if (race.state === "title" || race.state === "garage") {
    const gar = race.state === "garage", a = t * (gar ? 0.16 : 0.11) + (gar ? 2.2 : 0), rad = gar ? 7.4 : 11.5;
    cam.pos.set(c.x + Math.cos(a) * rad, c.y + (gar ? 1.7 : 2.6) + Math.sin(t * 0.21) * 0.5, c.z + Math.sin(a) * rad);
    cam.look.set(c.x, c.y + (gar ? 0.75 : 1.1), c.z); camera.up.set(0, 1, 0); camera.fov = damp(camera.fov, gar ? 44 : 52, 3, dt);
    if (r.w > 700) camera.setViewOffset(r.w, r.h, -r.w * (gar ? 0.22 : 0.2), 0, r.w, r.h); else camera.clearViewOffset();
  } else if (mode.bumper && race.state !== "done" && !c.finished) {
    camera.clearViewOffset();
    V1.set(0, 1.0, 2.45).applyMatrix4(c.c3.root.matrixWorld); cam.pos.copy(V1);
    V2.set(0, 0.95, 14).applyMatrix4(c.c3.root.matrixWorld); cam.look.copy(V2);
    camera.up.set(0, 1, 0).applyQuaternion(c.c3.root.quaternion);
    camera.fov = damp(camera.fov, mode.fov + narrow + Math.min(14, hv * 0.14) + (c.boosting ? 10 : 0), 4, dt);
  } else {
    if (race.state === "done" || c.finished) mode = CAMS[0];
    camera.clearViewOffset();
    const vyaw = hv > 4 ? Math.atan2(c.vx, c.vz) : c.yaw;
    const want = c.yaw + wrapA(vyaw - c.yaw) * 0.45;
    cam.yaw = cam.snap ? want : cam.yaw + wrapA(want - cam.yaw) * (1 - Math.exp(-dt * (c.grounded ? 5 : 2)));
    const fx = Math.sin(cam.yaw), fz = Math.cos(cam.yaw), pull = mode.dist + Math.min(1.6, hv * 0.02) + (c.boosting ? 0.8 : 0);
    V1.set(c.x - fx * pull, c.y + mode.h + (c.grounded ? 0 : 0.6), c.z - fz * pull);
    // keep the camera inside the canyon corridor and above the road
    project(c.seg, V1.x, V1.z, c.idx, camPrj);
    const ci = clamp(camPrj.i, 0, c.seg.n - 1), lim = c.seg.HW[ci] + (camPrj.d < 0 ? c.seg.RL[ci] : c.seg.RR[ci]) * 0.55;
    if (Math.abs(camPrj.d) > lim) { const o = Math.abs(camPrj.d) - lim, rx = -Math.cos(camPrj.th), rz = Math.sin(camPrj.th), sg = Math.sign(camPrj.d); V1.x -= rx * o * sg; V1.z -= rz * o * sg; }
    const sy = surface(c.seg, clamp(camPrj.s, 0, c.seg.len), clamp(camPrj.d, -lim, lim)).y;
    if (sy !== NO_GROUND) V1.y = Math.max(V1.y, sy + 1.4);
    for (const tn of tunnels) if (c.seg === tn.seg && camPrj.s > tn.s0 - 6 && camPrj.s < tn.s1 + 6) V1.y = Math.min(V1.y, tn.roof - 1);
    const k = cam.snap ? 1 : 1 - Math.exp(-dt * (race.state === "count" ? 1.6 : c.grounded ? 9 : 5));
    cam.pos.lerp(V1, k);
    V2.set(c.x + fx * 6, c.y + mode.look, c.z + fz * 6);
    cam.look.lerp(V2, cam.snap ? 1 : 1 - Math.exp(-dt * 14));
    // bank the camera into turns and with the car on walls
    const rollT = clamp(c.roll * 0.45 + c.steerIn * 0.035 * clamp(hv / 40, 0, 1) * (race.state === "race" ? 1 : 0), -0.45, 0.45);
    cam.roll = damp(cam.roll, rollT, 4, dt);
    fwdV.subVectors(cam.look, cam.pos).normalize();
    camera.up.set(0, 1, 0).applyAxisAngle(fwdV, cam.roll);
    camera.fov = damp(camera.fov, mode.fov + narrow + Math.min(10, hv * 0.11) + (c.boosting ? 7 : 0), 3, dt);
    cam.snap = false;
  }
  camera.position.copy(cam.pos);
  const hud = c.hud, sh = hud ? hud.shake || 0 : 0, amp = sh * [0, 0.45, 1][settings.shake];
  if (amp > 0.001) camera.position.add(V1.set((Math.random() - 0.5) * amp * 0.5, (Math.random() - 0.5) * amp * 0.4, (Math.random() - 0.5) * amp * 0.5));
  if (hud) hud.shake = Math.max(0, sh - dt * 1.8);
  camera.lookAt(cam.look);
  camera.aspect = r.w / r.h;
  camera.updateProjectionMatrix();
}

/* ================================================================ render: split viewports + heat haze / vignette post pass */
let rt = null;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const postMat = new THREE.ShaderMaterial({
  uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uHaze: { value: 1 }, uVig: { value: 0.25 } },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uHaze, uVig; varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      float band = smoothstep(0.16, 0.4, uv.y) * (1.0 - smoothstep(0.5, 0.64, uv.y));
      float n = sin(uv.y * 140.0 + uTime * 6.0) * 0.6 + sin(uv.x * 70.0 - uTime * 3.5 + uv.y * 50.0) * 0.4;
      uv.x += n * 0.0017 * band * uHaze;
      uv.y += cos(uv.x * 90.0 + uTime * 4.0) * 0.0009 * band * uHaze;
      vec3 col = texture2D(tDiffuse, uv).rgb;
      vec2 q = vUv - 0.5; float v = smoothstep(0.82, 0.3, length(q * vec2(1.0, 0.85)));
      col *= mix(1.0 - uVig, 1.0, v);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));
const DBS = new THREE.Vector2();
function ensureRT() {
  renderer.getDrawingBufferSize(DBS);
  if (!rt) rt = new THREE.WebGLRenderTarget(DBS.x, DBS.y, { samples: 4, type: THREE.HalfFloatType });
  else if (rt.width !== DBS.x || rt.height !== DBS.y) rt.setSize(DBS.x, DBS.y);
}
const lastInfo = { calls: 0, tris: 0 };
function render(t) {
  const W = innerWidth, Hh = innerHeight, multi = humans.length > 1, haze = !!settings.haze;
  if (haze) ensureRT(); else renderer.getDrawingBufferSize(DBS);
  const k = DBS.x / W;
  lastInfo.calls = lastInfo.tris = 0;
  for (const H of humans) {
    const r = H.rect, p = H.car.c3.root.position;
    // the sun's shadow box and the sky dome follow whichever car this view is watching
    sun.position.copy(p).addScaledVector(sunDir, 200); sun.target.position.copy(p); sun.target.updateMatrixWorld();
    skyGroup.position.copy(H.camera.position);
    SOFT.mat.uniforms.uScale.value = GLOW.mat.uniforms.uScale.value = (r.h * k) / (2 * Math.tan(THREE.MathUtils.degToRad(H.camera.fov) / 2));
    ghost3d.root.visible = race.ghostOn && H.h === 0;
    const vx = Math.round(r.x * k), vy = Math.round((Hh - r.y - r.h) * k), vw = Math.round(r.w * k), vh = Math.round(r.h * k);
    if (haze) {
      rt.viewport.set(vx, vy, vw, vh); rt.scissor.set(vx, vy, vw, vh); rt.scissorTest = multi;
      renderer.setRenderTarget(rt); renderer.render(scene, H.camera);
    } else {
      renderer.setViewport(vx / k, vy / k, vw / k, vh / k); renderer.setScissor(vx / k, vy / k, vw / k, vh / k); renderer.setScissorTest(multi);
      renderer.render(scene, H.camera);
    }
    lastInfo.calls += renderer.info.render.calls; lastInfo.tris += renderer.info.render.triangles;
  }
  if (haze) {
    renderer.setRenderTarget(null);
    postMat.uniforms.tDiffuse.value = rt.texture; postMat.uniforms.uTime.value = t;
    const lead = humans.reduce((m, H) => Math.max(m, (H.car.boosting ? 0.18 : 0) + clamp((H.car.speed - 45) / 40, 0, 0.12)), 0);
    postMat.uniforms.uVig.value = (multi ? 0.12 : 0.2) + lead;
    renderer.render(postScene, postCam);
  } else { renderer.setScissorTest(false); renderer.setViewport(0, 0, W, Hh); }
}
// Split-screen layout: side by side in landscape, stacked in portrait.
function layout() {
  const W = innerWidth, Hh = innerHeight, n = humans.length, side = W >= Hh;
  humans.forEach((H, i) => {
    H.rect = n < 2 ? { x: 0, y: 0, w: W, h: Hh } : side ? { x: i * Math.floor(W / 2), y: 0, w: i ? W - Math.floor(W / 2) : Math.floor(W / 2), h: Hh } : { x: 0, y: i * Math.floor(Hh / 2), w: W, h: i ? Hh - Math.floor(Hh / 2) : Math.floor(Hh / 2) };
    if (H.hud) Object.assign(H.hud.root.style, { left: H.rect.x + "px", top: H.rect.y + "px", width: H.rect.w + "px", height: H.rect.h + "px" });
  });
  hudEl.classList.toggle("multi", n > 1); hudEl.classList.toggle("stack", n > 1 && !side);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  layout();
  if (rt) ensureRT();
}
addEventListener("resize", resize);

/* ================================================================ HUD: one per human — position, laps, analog gauge, round minimap, name tags */
const hudEl = $("hud"), tipEl = $("tip");
const ordSuffix = (n) => ordinal(n).slice(String(n).length);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
// round minimap base: the whole circuit, north-up, inside a disc
const MB = { x0: 1e9, x1: -1e9, z0: 1e9, z1: -1e9 };
for (const s of SEGS) for (let i = 0; i < s.n; i++) { MB.x0 = Math.min(MB.x0, s.X[i]); MB.x1 = Math.max(MB.x1, s.X[i]); MB.z0 = Math.min(MB.z0, s.Z[i]); MB.z1 = Math.max(MB.z1, s.Z[i]); }
const MS = 300, mScale = (MS * 0.78) / Math.hypot(MB.x1 - MB.x0, MB.z1 - MB.z0) * 1.18;
const mapX = (x) => MS / 2 + (x - (MB.x0 + MB.x1) / 2) * mScale, mapZ = (z) => MS / 2 + (z - (MB.z0 + MB.z1) / 2) * mScale;
const mbase = document.createElement("canvas"); mbase.width = mbase.height = MS;
{
  const g = mbase.getContext("2d"), R = MS / 2;
  const bg = g.createRadialGradient(R, R * 0.8, 10, R, R, R); bg.addColorStop(0, "rgba(98,46,30,.82)"); bg.addColorStop(1, "rgba(27,13,10,.82)");
  g.fillStyle = bg; g.beginPath(); g.arc(R, R, R - 3, 0, 7); g.fill();
  g.lineWidth = 4; g.strokeStyle = "rgba(255,190,90,.75)"; g.stroke();
  g.save(); g.beginPath(); g.arc(R, R, R - 6, 0, 7); g.clip();
  g.lineCap = g.lineJoin = "round";
  for (const pass of [0, 1]) for (const s of SEGS) {
    g.beginPath(); for (let i = 0; i < s.n; i += 2) (i ? g.lineTo : g.moveTo).call(g, mapX(s.X[i]), mapZ(s.Z[i]));
    g.strokeStyle = pass ? (s.def.shortcut ? "#ffb23e" : "#f6dcb0") : "rgba(27,13,10,.9)"; g.lineWidth = pass ? 4.5 : 10;
    g.setLineDash(pass && s.def.shortcut ? [7, 6] : []); g.stroke();
  }
  g.setLineDash([]);
  for (const s of SEGS) for (const gp of s.gaps) { const f = frameAt(s, (gp.s0 + gp.s1) / 2, {}); g.fillStyle = "#ff6f61"; g.beginPath(); g.arc(mapX(f.x), mapZ(f.z), 4.5, 0, 7); g.fill(); }
  const f0 = frameAt(TR.A, START_S, {}); g.fillStyle = "#fff"; g.fillRect(mapX(f0.x) - 7, mapZ(f0.z) - 2, 14, 4);
  g.restore();
  g.fillStyle = "rgba(255,220,170,.85)"; g.font = "400 18px DotGothic16, monospace"; g.textAlign = "center"; g.fillText("N", R, 22);
}
function drawMini(hud, me) {
  const g = hud.mctx;
  g.clearRect(0, 0, MS, MS); g.drawImage(mbase, 0, 0);
  CHECKPOINTS.forEach((cp, k) => { const f = frameAt(cp.segRef, cp.s, {}); g.fillStyle = k === me.nextCp && race.state === "race" ? "#6fe0a0" : "rgba(246,220,176,.45)"; g.fillRect(mapX(f.x) - 4.5, mapZ(f.z) - 4.5, 9, 9); });
  if (race.ghostOn && ghost3d.root.visible) { g.fillStyle = "#9fe8ff"; g.beginPath(); g.arc(mapX(ghost3d.root.position.x), mapZ(ghost3d.root.position.z), 6, 0, 7); g.fill(); }
  const draw = (c, big) => {
    g.save(); g.translate(mapX(c.x), mapZ(c.z)); g.rotate(-c.yaw + Math.PI);
    g.fillStyle = PAINTS[c.profile.paint].body; g.strokeStyle = big ? "#fff" : "rgba(27,13,10,.9)"; g.lineWidth = big ? 3 : 2;
    const s = big ? 1 : 0.72; g.beginPath(); g.moveTo(0, -12 * s); g.lineTo(8.5 * s, 9 * s); g.lineTo(0, 4.5 * s); g.lineTo(-8.5 * s, 9 * s); g.closePath(); g.fill(); g.stroke(); g.restore();
  };
  for (const c of cars) if (c !== me) draw(c, false);
  draw(me, true);
}
function drawGauge(hud, c) {
  const g = hud.gctx, S = 360, cx = 180, cy = 186, R = 146, mph = !!settings.units;
  const max = mph ? 200 : 320, step = mph ? 10 : 20, major = mph ? 50 : 40, sp = c.speed * (mph ? 2.237 : 3.6);
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (v) => a0 + (a1 - a0) * clamp(v / max, 0, 1);
  g.clearRect(0, 0, S, S);
  const bg = g.createRadialGradient(cx, cy - 30, 20, cx, cy, R + 22); bg.addColorStop(0, "rgba(70,32,22,.78)"); bg.addColorStop(1, "rgba(20,9,7,.82)");
  g.fillStyle = bg; g.beginPath(); g.arc(cx, cy, R + 20, 0, 7); g.fill();
  g.lineWidth = 3; g.strokeStyle = "rgba(255,190,90,.55)"; g.stroke();
  // red zone: beyond normal top speed, only boost gets you there
  const red = VMAX * (mph ? 2.237 : 3.6);
  g.lineWidth = 10; g.strokeStyle = "rgba(255,80,60,.55)"; g.beginPath(); g.arc(cx, cy, R - 6, ang(red), a1); g.stroke();
  g.lineCap = "round";
  for (let v = 0; v <= max; v += step) {
    const a = ang(v), mj = v % major === 0, r0 = mj ? R - 24 : R - 15;
    g.strokeStyle = mj ? "#fff2dc" : "rgba(246,220,176,.55)"; g.lineWidth = mj ? 4 : 2;
    g.beginPath(); g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g.lineTo(cx + Math.cos(a) * (R - 4), cy + Math.sin(a) * (R - 4)); g.stroke();
    if (mj) { g.fillStyle = "rgba(255,236,210,.85)"; g.font = "400 21px DotGothic16, monospace"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(v), cx + Math.cos(a) * (R - 45), cy + Math.sin(a) * (R - 45)); }
  }
  // speed arc + boost ring
  const ag = g.createLinearGradient(30, 0, 330, 0); ag.addColorStop(0, "#ff7a2e"); ag.addColorStop(1, "#ffd36a");
  g.strokeStyle = ag; g.lineWidth = 7; g.beginPath(); g.arc(cx, cy, R + 8, a0, ang(sp)); g.stroke();
  g.lineWidth = 12; g.strokeStyle = "rgba(255,255,255,.12)"; g.beginPath(); g.arc(cx, cy, R - 70, a0, a1); g.stroke();
  if (c.boost > 0.01) { g.strokeStyle = c.boosting ? "#ff4fa0" : c.boost > 0.99 ? "#ffe07a" : "#ffb23e"; g.shadowColor = g.strokeStyle; g.shadowBlur = c.boosting || c.boost > 0.99 ? 14 : 0; g.beginPath(); g.arc(cx, cy, R - 70, a0, a0 + (a1 - a0) * c.boost); g.stroke(); g.shadowBlur = 0; }
  // needle
  const an = ang(sp); g.strokeStyle = "#ff5a2a"; g.lineWidth = 6; g.shadowColor = "rgba(255,90,42,.8)"; g.shadowBlur = 10;
  g.beginPath(); g.moveTo(cx - Math.cos(an) * 16, cy - Math.sin(an) * 16); g.lineTo(cx + Math.cos(an) * (R - 12), cy + Math.sin(an) * (R - 12)); g.stroke(); g.shadowBlur = 0;
  g.fillStyle = "#2a1410"; g.beginPath(); g.arc(cx, cy, 15, 0, 7); g.fill(); g.strokeStyle = "#ffb23e"; g.lineWidth = 3; g.stroke();
  // digital readout
  g.textAlign = "center"; g.textBaseline = "alphabetic"; g.fillStyle = "#fff"; g.font = "400 54px 'Dela Gothic One', sans-serif"; g.fillText(String(Math.round(sp)), cx, cy + 80);
  g.fillStyle = "#f6dcb0"; g.font = "400 19px DotGothic16, monospace"; g.fillText(mph ? "MPH" : "KM/H", cx, cy + 104);
  g.fillStyle = c.boosting ? "#ff8fc0" : c.boost > 0.99 ? "#ffe07a" : "rgba(246,220,176,.7)"; g.font = "400 17px DotGothic16, monospace"; g.fillText(c.boosting ? "BOOSTING" : c.boost > 0.99 ? "BOOST READY" : "BOOST", cx, cy + 128);
}
function lineOfSight(from, o) {
  const tx = o.x, ty = o.y + 1.4, tz = o.z;
  for (let k = 1; k < 8; k++) {
    const u = k / 8, x = lerp(from.x, tx, u), y = lerp(from.y, ty, u), z = lerp(from.z, tz, u);
    if (carvedHeight(x, z) > y + 0.8) return false;
  }
  return true;
}
function buildHUDs() {
  hudEl.querySelectorAll(".phud").forEach((e) => e.remove());
  const multi = humans.length > 1;
  for (const H of humans) {
    const root = document.createElement("div"); root.className = "phud";
    root.innerHTML = `
      <div class="tl hshadow">
        <div class="pos"><b>1</b><sup>st</sup><span>/${cars.length}</span></div>
        <div class="lap">LAP <b>1</b>/${LAPS}</div>
        <div class="rtime">0:00.00</div>
        <div class="sub lapT"></div><div class="sub best"></div>
        <ol class="board"></ol>
      </div>
      <div class="tr">${H.h === 0 ? `<button class="pbtn" aria-label="Pause">❚❚</button>` : ""}<canvas class="mini" width="${MS}" height="${MS}" title="Tap to change camera"></canvas></div>
      <div class="br"><div class="chain hshadow"></div><canvas class="gauge" width="360" height="360"></canvas></div>
      ${multi ? `<div class="plabel p${H.h + 1}">P${H.h + 1} · ${esc(H.car.name)}</div>` : ""}
      <div class="tags"></div>
      <div class="feed"></div><div class="split"></div><div class="count"></div>
      <div class="wrong cc-hidden">WRONG WAY</div><div class="hold cc-hidden"><i></i></div>
      <div class="donebox"></div>
      <div class="fade"></div>`;
    hudEl.appendChild(root);
    const q = (s) => root.querySelector(s);
    const hud = { root, H, posB: q(".pos"), posN: q(".pos b"), posS: q(".pos sup"), lap: q(".lap b"), time: q(".rtime"), lapT: q(".lapT"), best: q(".best"), board: q(".board"),
      mini: q(".mini"), gauge: q(".gauge"), chain: q(".chain"), feed: q(".feed"), split: q(".split"), count: q(".count"), wrong: q(".wrong"), hold: q(".hold"),
      done: q(".donebox"), fade: q(".fade"), tagBox: q(".tags"), tags: new Map(), shake: 0, cache: {}, gT: 0, mT: 0 };
    hud.mctx = hud.mini.getContext("2d"); hud.gctx = hud.gauge.getContext("2d");
    hud.posB.classList.toggle("cc-hidden", cars.length < 2); hud.board.classList.toggle("cc-hidden", cars.length < 2);
    hud.mini.addEventListener("click", () => { IN[H.h].cam = true; });
    const pb = q(".pbtn"); if (pb) pb.addEventListener("click", () => { edge.pause = true; });
    for (const c of cars) if (c !== H.car) {
      const el = document.createElement("div"); el.className = "ntag" + (c.ctrl === "ai" ? "" : " human"); el.style.setProperty("--c", PAINTS[c.profile.paint].body);
      el.innerHTML = `<b></b>${esc(c.name)}`; hud.tagBox.appendChild(el); hud.tags.set(c, el);
    }
    H.hud = hud; H.car.hud = hud;
  }
  layout();
}
const setT = (hud, key, el, v) => { if (hud.cache[key] !== v) { hud.cache[key] = v; el.textContent = v; } };
function updateHUD(dt) {
  const st = race.state; if (st !== "race" && st !== "count" && st !== "done" && st !== "paused") return;
  for (const H of humans) {
    const c = H.car, hud = H.hud, I = IN[H.h];
    setT(hud, "lap", hud.lap, String(Math.min(c.lap, LAPS)));
    setT(hud, "time", hud.time, fmtT(c.finished ? c.finishT : race.time));
    setT(hud, "lapT", hud.lapT, c.finished ? "Finished" : "Lap " + fmtT(race.time - c.lapStart));
    const best = race.mode === "split" ? c.bestLap : records.lap != null && c.bestLap != null ? Math.min(records.lap, c.bestLap) : records.lap ?? c.bestLap;
    setT(hud, "best", hud.best, "Best " + fmtT(best));
    if (cars.length > 1) {
      setT(hud, "pn", hud.posN, String(c.place)); setT(hud, "ps", hud.posS, ordSuffix(c.place));
      hud.posB.classList.toggle("lead", c.place === 1);
      const key = race.order.map((o) => o.slot).join(",");
      if (hud.cache.board !== key) {
        hud.cache.board = key;
        hud.board.innerHTML = race.order.map((o, i) => `<li class="${o === c ? "me" : ""}"><i style="--c:${PAINTS[o.profile.paint].body}"></i>${i + 1}. ${esc(o.name)}</li>`).join("");
      }
    }
    setT(hud, "done", hud.done, c.finished ? (cars.length > 1 ? `FINISHED · ${ordinal(c.place)}` : "FINISHED") : "");
    setT(hud, "chain", hud.chain, c.chain > 1 ? `DRIFT CHAIN ×${c.chain}` : c.driftT > 0.4 ? `DRIFTING ${c.driftT.toFixed(1)}s` : c.wallT > 0.4 ? `WALL RIDE ${c.wallT.toFixed(1)}s` : "");
    hud.wrong.classList.toggle("cc-hidden", c.wrongT < 1.4);
    hud.hold.classList.toggle("cc-hidden", I.rHeld < 0.25); hud.hold.firstChild.style.setProperty("--f", clamp((I.rHeld - 0.25) / 1.0, 0, 1));
    hud.gT -= dt; if (hud.gT <= 0) { hud.gT = 1 / 40; drawGauge(hud, c); }
    hud.mT -= dt; if (hud.mT <= 0) { hud.mT = 1 / 20; drawMini(hud, c); }
    // floating name tags over the other cars
    const r = H.rect;
    for (const [o, el] of hud.tags) {
      const dist = Math.hypot(o.x - c.x, o.z - c.z);
      V1.set(o.x, o.y + 2.1, o.z).project(H.camera);
      let vis = dist > 4 && dist < 160 && V1.z < 1 && Math.abs(V1.x) < 1.05 && Math.abs(V1.y) < 1.05 && o.c3.root.visible;
      // hide the tag when the canyon wall is between this camera and that car (checked ~8 times a second)
      if (vis) { const ls = hud.los || (hud.los = new Map()); let e = ls.get(o); if (!e || e.t <= 0) { e = { t: 0.12, ok: lineOfSight(H.camera.position, o) }; ls.set(o, e); } else e.t -= dt; vis = e.ok; }
      if (!vis) { if (el.style.display !== "none") el.style.display = "none"; continue; }
      el.style.display = "";
      el.style.transform = `translate(${((V1.x + 1) / 2) * r.w}px, ${((1 - V1.y) / 2) * r.h}px) translate(-50%, -100%) scale(${clamp(1.25 - dist / 140, 0.6, 1.1).toFixed(2)})`;
      el.style.opacity = clamp(1.4 - dist / 120, 0.35, 1).toFixed(2);
      const pl = String(o.place); if (el.firstChild.textContent !== pl) el.firstChild.textContent = pl;
    }
  }
}
let tipT = 0;
function tip(html, ms = 4200) { if (DEMO) return; tipEl.innerHTML = html; tipEl.classList.add("show"); clearTimeout(tipT); tipT = setTimeout(() => tipEl.classList.remove("show"), ms); }
const kbd = (w, h = 0) => `<kbd>${keyLabel(w, h)}</kbd>`;
const TIPS = [
  { seg: "A", f: 0.02, text: () => `${kbd("gas")} to go, ${kbd("steer")} to steer. Orange chevron pads give a free boost.` },
  { seg: "A", f: 0.36, text: () => `Hold ${kbd("drift")} while turning to drift. Slides fill your boost — ${kbd("boost")} spends it.` },
  ...(MAP_I === 0 ? [
    { seg: "A", f: 0.82, text: () => `The road splits! Left: safe Mesa Rim. Right: the Arch Gap jump — keep your speed up.` },
    { seg: "B1", f: 0.28, text: () => `Orange-and-white walls are for wall-riding: at speed, steer up the bank and stay on it.` },
    { seg: "C", f: 0.88, text: () => `Another split: the wide Dry Riverbed, or the narrow Cliff Ledge with a giant wall-ride.` },
    { seg: "E", f: 0.42, text: () => `Jump ahead! Steer in the air to land straight — clean landings give boost.` },
  ] : [
    { seg: "A", f: 0.82, text: () => `The road splits! Left: the climbing Switchback Mesa. Straight on: the Narrows Gap jump under the arch.` },
    { seg: "B1", f: 0.3, text: () => `Orange-and-white walls are for wall-riding: at speed, steer up the bank and stay on it.` },
    { seg: "D", f: 0.3, text: () => `Crest jump ahead! Steer in the air to land straight — clean landings give boost.` },
    { seg: "D", f: 0.5, text: () => `Hairpin coming up: brake early, then hold ${kbd("drift")} to swing around it.` },
  ]),
];
function contextTips() {
  const c = humans[0] && humans[0].car;
  if (!c || race.mode === "split" || c.lap > 1 || PA.store.get("canyon:tut", false)) return;
  for (const tp of TIPS) if (!c.tips[tp.seg + tp.f] && c.seg.id === tp.seg && c.s > tp.f * c.seg.len) { c.tips[tp.seg + tp.f] = true; tip(tp.text()); }
}

/* ================================================================ menus (keyboard, mouse and gamepad navigable) */
const uiEl = $("ui");
let MENU = null;
const menuOpen = () => !!MENU;
const OPTS = {
  assist: ["Off", "Light", "Full"], shake: ["Off", "Low", "Full"], ghost: ["Off", "On"], haze: ["Off", "On"], quality: ["Low", "High"], units: ["km/h", "mph"], mouse: ["Off", "On"],
  rivals: ["Relaxed", "Pro"], vol: "vol", music: "vol", sfx: "vol",
};
const prof = (h = race.garageH || 0) => (h ? settings.p2 : settings.p1);
function optText(k) {
  if (k === "model") return MODELS[prof().model].name;
  if (k === "paint") return PAINTS[prof().paint].name;
  const o = OPTS[k]; return o === "vol" ? "■".repeat(settings[k]) + "□".repeat(10 - settings[k]) : o[settings[k]];
}
function showMenu(html, { back = null, dim = true, focus = 0, cls = "" } = {}) {
  uiEl.className = (dim ? "dim " : "") + cls; uiEl.innerHTML = html;
  const items = [...uiEl.querySelectorAll(".mi")];
  MENU = { items, i: clamp(focus, 0, items.length - 1), back };
  items.forEach((el, i) => {
    el.addEventListener("mouseenter", () => { if (MENU && MENU.i !== i) { MENU.i = i; paintFocus(false); } });
    el.addEventListener("click", (e) => { if (el.tagName === "A" || e.target.tagName === "INPUT") return; e.preventDefault(); MENU.i = i; activate(el, 1); });
  });
  paintFocus(focus > 0);
}
function closeMenu() { MENU = null; uiEl.innerHTML = ""; uiEl.className = ""; }
function paintFocus(scroll = true) {
  if (!MENU) return;
  MENU.items.forEach((el, i) => el.classList.toggle("focus", i === MENU.i));
  const el = MENU.items[MENU.i];
  if (el) { if (el.tagName !== "LABEL") el.focus({ preventScroll: true }); else if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); if (scroll) el.scrollIntoView({ block: "nearest" }); }
}
function menuMove(d) { if (!MENU || !MENU.items.length) return; MENU.i = (MENU.i + d + MENU.items.length) % MENU.items.length; paintFocus(); sfx("ui"); }
function menuAdjust(d) {
  if (!MENU) return; const el = MENU.items[MENU.i]; if (!el) return;
  if (el.dataset.set) activate(el, d);
  else if (el.classList.contains("card")) { const j = MENU.i + d, o = MENU.items[j]; if (o && o.classList.contains("card") && o.parentElement === el.parentElement) { MENU.i = j; paintFocus(); sfx("ui"); } }
}
function menuActivate() { if (!MENU) return; const el = MENU.items[MENU.i]; if (el) { if (el.tagName === "A") { location.href = el.href; return; } activate(el, 1); } }
function menuBack() { if (MENU && MENU.back) { sfx("ui"); MENU.back(); } }
function menuKey(e) {
  if (!MENU) return;
  const c = e.code;
  if (c === "ArrowUp" || c === "KeyW") { menuMove(-1); e.preventDefault(); }
  else if (c === "ArrowDown" || c === "KeyS") { menuMove(1); e.preventDefault(); }
  else if (c === "ArrowLeft" || c === "KeyA") { menuAdjust(-1); e.preventDefault(); }
  else if (c === "ArrowRight" || c === "KeyD") { menuAdjust(1); e.preventDefault(); }
  else if (c === "Enter" || c === "Space") { e.preventDefault(); menuActivate(); }
  else if (c === "Escape" || c === "Backspace") { if (MENU.back) { e.stopPropagation(); edge.pause = false; menuBack(); } }
}
function activate(el, d) {
  audioInit();
  const k = el.dataset.set;
  if (k) {
    if (k === "model" || k === "paint") {
      const P = prof(), n = k === "model" ? MODELS.length : PAINTS.length; P[k] = (P[k] + d + n) % n; saveSettings(); applyProfile();
      if (k === "model") { const dd = uiEl.querySelector(".mdesc"); if (dd) dd.textContent = MODELS[P.model].desc; }
    } else { const o = OPTS[k], n = o === "vol" ? 11 : o.length; settings[k] = o === "vol" ? clamp(settings[k] + d, 0, 10) : (settings[k] + d + n) % n; saveSettings(); applySetting(k); }
    el.querySelector(".v").textContent = optText(k); sfx("ui"); return;
  }
  if (el.tagName === "LABEL") { const inp = el.querySelector("input"); if (inp) { inp.focus(); inp.select(); } return; }
  sfx("select");
  const fn = ACTIONS[el.dataset.act]; if (fn) fn();
}
function applySetting(k) {
  if (k === "quality") applyQuality();
  if (k === "vol" || k === "music" || k === "sfx") applyVolumes();
}
const sel = (k, label) => `<button class="mi" data-set="${k}">${label}<span class="v">${optText(k)}</span></button>`;
const ACTIONS = {};
function recordsLine() {
  const m = records.medal ? MEDALS[3 - records.medal] : null;
  return `${MAP.name}: best race ${fmtT(records.race)} · Best lap ${fmtT(records.lap)} · Wins ${records.wins || 0}${m ? ` · <span style="color:${m.c}">● ${m.name}</span>` : ""}`;
}
function titleScreen(focus = 0) {
  showMenu(`<div class="title">
    <h1 class="logo">CANYON<span>CIRCUIT</span></h1>
    <div class="tag">Drift · boost · fly · ride the walls</div>
    <div class="cards">
      <button class="mi card go" data-act="solo"><em>1P</em><b>Solo Race</b><small>You vs two AI rivals</small></button>
      <button class="mi card" data-act="split"><em>2P</em><b>Split-Screen</b><small>Couch race + one rival</small></button>
      <button class="mi card" data-act="trial"><em>⏱</em><b>Time Trial</b><small>Race your best-lap ghost</small></button>
    </div>
    <div class="eyebrow trk-h">Track</div>
    <div class="cards tracks">${MAPS.map((m, i) => `<button class="mi card trk${i === MAP_I ? " on" : ""}" data-act="map${i}"><b>${m.name}</b><small>${m.blurb}</small></button>`).join("")}</div>
    <div class="menu">
      <button class="mi" data-act="garage">Garage<span class="v2">${esc(MODELS[settings.p1.model].name)}</span></button>
      <button class="mi" data-act="howto">Controls &amp; how to play</button>
      <button class="mi" data-act="settings">Settings</button>
      ${ARCADE ? `<a class="mi" href="../index.html#canyon">Back to the arcade</a>` : ""}
    </div>
    <div class="recs">${recordsLine()}</div>
  </div>`, { dim: false, focus });
}
const TITLE_IDX = { solo: 0, split: 1, trial: 2, garage: 3 + MAPS.length, howto: 4 + MAPS.length, settings: 5 + MAPS.length };
// Switching track rebuilds the whole canyon, so it reloads the game into the chosen map.
MAPS.forEach((m, i) => { ACTIONS["map" + i] = () => { if (i === MAP_I) return; PA.store.set("canyon:map", i); uiEl.innerHTML = `<div class="loading">Loading ${m.name}…</div>`; MENU = null;
  const u = new URL(location.href); if (u.searchParams.has("map")) { u.searchParams.set("map", i); location.replace(u.href); } else location.reload(); }; });
ACTIONS.solo = () => soloScreen();
ACTIONS.split = () => splitScreen();
ACTIONS.trial = () => startRace("trial");
ACTIONS.garage = () => garageScreen(0, () => toTitle(TITLE_IDX.garage));
ACTIONS.howto = () => howTo(0, () => (race.state === "paused" ? pauseScreen(3) : toTitle(TITLE_IDX.howto)));
ACTIONS.settings = () => settingsScreen(() => (race.state === "paused" ? pauseScreen(4) : toTitle(TITLE_IDX.settings)));
ACTIONS.resume = () => resumeRace();
ACTIONS.recover = () => { resumeRace(); recover(humans[0].car); };
ACTIONS.restart = () => { closeMenu(); startCountdown(); };
ACTIONS.quit = () => toTitle();
ACTIONS.again = () => { closeMenu(); startCountdown(); };
ACTIONS.title = () => toTitle();
// Back from the garage: put the title scene (the grid with all three cars) back behind the menus.
function titleField() { if (race.state !== "garage") return; race.state = "title"; race.garageH = 0; setupField("solo"); }
function soloScreen(focus = 0) {
  titleField();
  showMenu(`<div class="panel"><div class="eyebrow">1P · Solo race · ${MAP.name} · ${LAPS} laps</div><h2>Three cars, one canyon</h2>
    <p>Race <b>Vega</b> and <b>Juno</b> to the flag. Everyone drives identical machines — only your lines, drifts and boosts make the difference.</p>
    <div class="menu">${sel("rivals", "Rivals")}
      <button class="mi" data-act="sgarage">Your ride<span class="v2">${esc(MODELS[settings.p1.model].name)} · ${esc(PAINTS[settings.p1.paint].name)}</span></button>
      <div class="row2"><button class="mi go" data-act="srace">Race!</button><button class="mi" data-act="sback">Back</button></div></div>
    <div class="hint2">Relaxed rivals take the safe roads and brake early. Pro rivals hunt the shortcuts.</div></div>`, { back: () => toTitle(0), focus });
  ACTIONS.sgarage = () => garageScreen(0, () => soloScreen(1));
  ACTIONS.srace = () => startRace("solo");
  ACTIONS.sback = () => toTitle(0);
}
function splitScreen(focus = 0) {
  titleField();
  const ctl = (h) => { const m = KEYMAPS.split[h]; return `${KEYNAMES[m.gas[0]]}${KEYNAMES[m.left[0]]}${KEYNAMES[m.brake[0]]}${KEYNAMES[m.right[0]]} · drift ${KEYNAMES[m.drift[0]]} · boost ${KEYNAMES[m.boost[0]]}`; };
  showMenu(`<div class="panel wide"><div class="eyebrow">2P · Split-screen · ${MAP.name} · ${LAPS} laps + one AI rival</div><h2>Couch showdown</h2>
    <div class="pp">
      <div class="pcard p1"><em>P1</em><b>${esc(settings.p1.name)}</b><small>${esc(MODELS[settings.p1.model].name)} · ${esc(PAINTS[settings.p1.paint].name)}</small><span>${ctl(0)}</span></div>
      <div class="pcard p2"><em>P2</em><b>${esc(settings.p2.name)}</b><small>${esc(MODELS[settings.p2.model].name)} · ${esc(PAINTS[settings.p2.paint].name)}</small><span>${ctl(1)}</span></div>
    </div>
    <div class="menu">
      <div class="row2"><button class="mi" data-act="g1">P1 garage</button><button class="mi" data-act="g2">P2 garage</button></div>
      ${sel("rivals", "Rival")}
      <div class="row2"><button class="mi go" data-act="prace">Race!</button><button class="mi" data-act="pback">Back</button></div></div>
    <div class="hint2">Gamepads: with two pads each player takes one; with a single pad it drives player 2. Pause with Esc or Start.</div></div>`, { back: () => toTitle(1), focus });
  ACTIONS.g1 = () => garageScreen(0, () => splitScreen(0));
  ACTIONS.g2 = () => garageScreen(1, () => splitScreen(1));
  ACTIONS.prace = () => startRace("split");
  ACTIONS.pback = () => toTitle(1);
}
// Garage: pick a model, a paint and a driver name. Looks only — every car has identical handling.
function garageScreen(h, back) {
  race.garageH = h; race.state = "garage"; setupField("garage"); showHUD(false); musicStart("title");
  const P = prof(h);
  showMenu(`<div class="panel garage"><div class="eyebrow">Garage · ${h ? "Player 2" : "Player 1"}</div><h2>Your ride</h2>
    <div class="menu">
      ${sel("model", "Model")}
      <p class="mdesc">${esc(MODELS[P.model].desc)}</p>
      ${sel("paint", "Paint")}
      <div class="swatches">${PAINTS.map((p, i) => `<i data-sw="${i}" class="${i === P.paint ? "on" : ""}" style="--c:${p.body};--s:${p.stripe}" title="${p.name}"></i>`).join("")}</div>
      <label class="mi namefield">Driver<input data-name maxlength="12" spellcheck="false" autocomplete="off" value="${esc(P.name)}"></label>
      <button class="mi go" data-act="gdone">Done</button>
    </div>
    <div class="hint2">Identical handling for every model and paint — looks only, never performance.</div></div>`, { dim: false, back: () => back(), cls: "garage" });
  ACTIONS.gdone = () => back();
  uiEl.querySelectorAll("[data-sw]").forEach((sw) => sw.addEventListener("click", () => { P.paint = +sw.dataset.sw; saveSettings(); applyProfile(); sfx("ui"); }));
  const inp = uiEl.querySelector("[data-name]");
  inp.addEventListener("input", () => { P.name = inp.value.replace(/[^\w .\-!?]/g, "").toUpperCase().slice(0, 12) || (h ? "PLAYER 2" : "RACER"); saveSettings(); if (cars[0]) cars[0].name = P.name; });
}
function applyProfile() {
  const P = prof(), c = cars[0];
  uiEl.querySelectorAll("[data-sw]").forEach((sw) => sw.classList.toggle("on", +sw.dataset.sw === P.paint));
  const pv = uiEl.querySelector('[data-set="paint"] .v'); if (pv) pv.textContent = PAINTS[P.paint].name;
  if (!c || race.state !== "garage") return;
  if (c.c3.model !== P.model) { disposeCar(c.c3); c.c3 = makeSupercar(P.model, P.paint); updateCarVisual(c, 0); }
  else if (c.c3.paintIdx !== P.paint) { c.c3.paint.color.set(PAINTS[P.paint].body); c.c3.stripe.color.set(PAINTS[P.paint].stripe); c.c3.paintIdx = P.paint; }
}
function settingsScreen(back) {
  showMenu(`<div class="panel"><div class="eyebrow">Settings</div><h2>Tune your ride</h2><div class="menu">
    ${sel("assist", "Driving assist")}${sel("rivals", "AI rivals")}${sel("shake", "Screen shake")}${sel("ghost", "Best-lap ghost (time trial)")}${sel("haze", "Heat haze")}${sel("quality", "Graphics")}
    ${sel("units", "Speed units")}${sel("mouse", "Mouse buttons (boost / drift)")}${sel("vol", "Master volume")}${sel("music", "Music")}${sel("sfx", "Effects")}
    <button class="mi go" data-act="back">Done</button></div>
    <div class="hint2">Assist Light squares up landings and stops spins; Full also keeps you pointed down the road. Off is raw.</div></div>`, { back });
  ACTIONS.back = back;
}
const ICONS = [
  `<svg viewBox="0 0 92 92"><rect x="6" y="40" width="80" height="34" rx="10" fill="#c4532e"/><rect x="22" y="26" width="44" height="22" rx="6" fill="#2a1410"/><circle cx="24" cy="74" r="10" fill="#1b0d0a"/><circle cx="68" cy="74" r="10" fill="#1b0d0a"/><path d="M10 20h20M4 30h18" stroke="#ffb23e" stroke-width="5" stroke-linecap="round"/></svg>`,
  `<svg viewBox="0 0 92 92"><path d="M10 80 C 20 30, 60 70, 82 14" fill="none" stroke="#f6dcb0" stroke-width="6" stroke-dasharray="8 8"/><g transform="rotate(-35 50 50)"><rect x="34" y="36" width="34" height="20" rx="6" fill="#c4532e"/></g><circle cx="20" cy="70" r="9" fill="#f1e4d4" opacity=".7"/><circle cx="30" cy="62" r="7" fill="#f1e4d4" opacity=".5"/></svg>`,
  `<svg viewBox="0 0 92 92"><rect x="14" y="40" width="40" height="18" rx="5" fill="#c4532e"/><path d="M14 44 L-2 40 L4 49 L-2 58 L14 54Z" fill="#ffb23e"/><path d="M58 30 l22 19 -22 19" fill="none" stroke="#ffb23e" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  `<svg viewBox="0 0 92 92"><path d="M4 80 h28 l10 -20" fill="none" stroke="#f6dcb0" stroke-width="5"/><path d="M60 82 q22 -4 28 -40" fill="none" stroke="#ff7a1e" stroke-width="8"/><g transform="rotate(-18 46 34)"><rect x="34" y="26" width="28" height="15" rx="5" fill="#c4532e"/></g><path d="M40 52 q6 10 14 12" stroke="#ffb23e" stroke-width="3" fill="none" stroke-dasharray="4 4"/></svg>`,
];
function howTo(page, done) {
  const P = [
    { h: "Drive", p: "Gas, brake and steer. Brake again while stopped to reverse. Crashes only cost a little time — just keep going.", rows: [["gas", "Accelerate"], ["brake", "Brake / reverse"], ["steer", "Steer"], ["cam", "Change camera"], ["recover", "Back on track (hold to restart)"]] },
    { h: "Drift & chain", p: "Hold drift while turning and the tail swings out. Longer, sharper slides fill your boost meter, and drifts linked within a second and a half build a chain multiplier.", rows: [["drift", "Drift / handbrake"]] },
    { h: "Boost", p: "Boost burns your meter — the inner ring of the speedometer — for a burst of speed. Fill it by drifting, wall-riding, big air, clean landings, near misses past rock pillars and finding shortcuts. Orange chevron pads boost for free.", rows: [["boost", "Boost"]] },
    { h: "Air & walls", p: "Ramps and crests launch you. Steer in the air to land straight for a clean-landing bonus. Orange-and-white walls are built for wall-riding: carry speed up the bank and it holds you there. Fall off a jump and you're dropped back on the far side.", rows: [] },
  ][page];
  const split = race.mode === "split" && race.state === "paused";
  const L = IN[0].last;
  const keys = P.rows.map(([w, l]) => `<kbd>${keyLabel(w)}</kbd><span>${l}</span>`).join("")
    + (page === 0 && L === "touch" ? `<kbd>Map</kbd><span>Tap the minimap to change camera</span><kbd>❚❚</kbd><span>Pause · back on track · restart</span>` : "");
  const dev = L === "pad" ? "Gamepad" : L === "touch" ? "Touch" : "Keyboard & mouse";
  const twoP = page === 0 ? `<p style="font-size:13px"><b>Split-screen:</b> P1 drives with W A S D, Space drift, Left Shift boost, C camera, R recover. P2 drives with the arrow keys, / drift, . boost, , camera and ' recover — or plug in gamepads.</p>` : "";
  showMenu(`<div class="panel"><div class="eyebrow">How to play · ${page + 1}/4 · ${dev}</div><h2>${P.h}</h2>
    <div class="tut">${ICONS[page]}<p>${P.p}</p></div>
    ${keys && !split ? `<div class="keys">${keys}</div>` : ""}
    ${page === 0 && L === "kb" && !split ? `<p style="font-size:13px">Mouse: left button boosts, right button drifts, wheel changes camera (toggle in Settings). Gamepads work too: RT gas, LT brake, A boost, B drift.</p>` : ""}
    ${twoP}
    <div class="dots">${[0, 1, 2, 3].map((i) => `<i class="${i === page ? "on" : ""}"></i>`).join("")}</div>
    <div class="row2">${page < 3 ? `<button class="mi go" data-act="tnext">Next</button><button class="mi" data-act="tskip">Skip</button>` : `<button class="mi go" data-act="tskip">Got it</button>`}</div></div>`, { back: () => done() });
  ACTIONS.tnext = () => howTo(page + 1, done);
  ACTIONS.tskip = () => done();
}
function pauseScreen(focus = 0) {
  const c = humans[0].car;
  showMenu(`<div class="panel"><div class="eyebrow">Paused · ${MAP.name} · Lap ${Math.min(c.lap, LAPS)}/${LAPS} · ${fmtT(race.time)}</div><h2>Engine idling</h2><div class="menu">
    <button class="mi go" data-act="resume">Resume</button>
    <button class="mi" data-act="recover">Back on track${race.mode === "split" ? " (P1)" : ""}</button>
    <button class="mi" data-act="restart">Restart race</button>
    <button class="mi" data-act="howto">How to play</button>
    <button class="mi" data-act="settings">Settings</button>
    <button class="mi" data-act="quit">Quit to title</button></div></div>`, { back: resumeRace, focus });
}
function resultsScreen(res) {
  const me = humans[0].car, solo = race.mode !== "split", m = res.medal ? MEDALS[3 - res.medal] : null;
  const rows = res.standings.map((r, i) => {
    const c = r.car, best = c.laps.length ? Math.min(...c.laps) : null;
    const who = c.ctrl === "ai" ? "" : race.mode === "split" ? ` <em class="tagp">P${c.ctrl === "p1" ? 1 : 2}</em>` : ` <em class="tagp">YOU</em>`;
    return `<tr class="${c.ctrl !== "ai" ? "me" : ""}"><td class="pl">${i + 1}</td><td><i class="dot" style="--c:${PAINTS[c.profile.paint].body}"></i>${esc(c.name)}${who}</td><td class="car">${esc(MODELS[c.c3.model].name)}</td>
      <td class="t">${r.dnf ? "DNF" : (r.est ? "~" : "") + fmtT(r.t)}</td><td class="t">${fmtT(best)}</td></tr>`;
  }).join("");
  const s = me.stats;
  const statBlock = solo ? `<div class="stats four">
      <span>Laps</span><b>${me.laps.map((t) => `<span class="${t === Math.min(...me.laps) ? "best" : ""}">${fmtT(t)}</span>`).join(" · ")}</b>
      <span>Longest drift</span><b>${s.longestDrift.toFixed(1)}s</b><span>Best drift chain</span><b>×${s.maxChain}</b>
      <span>Biggest air</span><b>${s.maxAir.toFixed(1)}s</b><span>Wall-ride time</span><b>${s.wallTime.toFixed(1)}s</b>
      <span>Near misses</span><b>${s.nearMiss}</b><span>Shortcuts found</span><b>${s.shortcuts}/2</b>
      <span>Top speed</span><b>${Math.round(settings.units ? s.topSpeed * 2.237 : s.topSpeed * 3.6)} ${settings.units ? "mph" : "km/h"}</b><span>Best race</span><b>${fmtT(records.race)}</b></div>`
    : `<div class="stats four split2">${humans.map((H) => { const t = H.car.stats; return `<span>P${H.h + 1} drift chain</span><b>×${t.maxChain}</b><span>P${H.h + 1} biggest air</span><b>${t.maxAir.toFixed(1)}s</b>`; }).join("")}</div>`;
  showMenu(`<div class="panel wide"><div class="eyebrow">Race complete · ${MAP.name} · ${race.mode === "split" ? "Split-screen" : race.mode === "trial" ? "Time trial" : "Solo race"}</div><h2>${res.headline}</h2>
    ${solo ? `<div class="big">${fmtT(me.finishT)}</div><p>${m ? `<span class="medal" style="--c:${m.c}"><i></i>${m.name.toUpperCase()} MEDAL</span>` : `<span class="medal" style="--c:#7a5a4a"><i></i>Gold under ${fmtT(MEDALS[0].t)}</span>`}
      ${res.newRecord ? ` <span class="medal" style="--c:#6fe0a0"><i></i>TRACK RECORD</span>` : ""}</p>` : ""}
    ${res.standings.length > 1 ? `<table class="stand"><thead><tr><th>#</th><th>Driver</th><th class="car">Car</th><th>Time</th><th>Best lap</th></tr></thead><tbody>${rows}</tbody></table>` : ""}
    ${statBlock}
    <div class="row2"><button class="mi go" data-act="again">Race again</button><button class="mi" data-act="title">Title</button></div>
    ${ARCADE ? `<div class="row2" style="margin-top:8px"><a class="mi" href="../index.html#canyon">Back to the arcade</a></div>` : ""}</div>`, { back: () => toTitle() });
}

/* ================================================================ race flow */
function showHUD(on) { hudEl.classList.toggle("cc-hidden", !on); if (touchUI) touchUI.style.display = on ? "" : "none"; if (!on) tipEl.classList.remove("show"); }
function toTitle(focus = 0) {
  closeMenu(); race.state = "title"; race.garageH = 0; race.ghostOn = false;
  setupField("solo"); showHUD(false); titleScreen(focus); musicStart("title"); setSunForRace(0);
}
function startRace(mode) {
  if (!PA.store.get("canyon:tut-seen", false)) { PA.store.set("canyon:tut-seen", true); howTo(0, () => startCountdown(mode)); }
  else startCountdown(mode);
}
function startCountdown(mode = race.mode) {
  closeMenu(); race.garageH = 0; setupField(mode); race.state = "count"; race.count = 3.999; race.countStep = 4; race.firstFinish = null; race.ghostOn = false;
  showHUD(true); musicStart("off"); setSunForRace(0);
  for (const H of humans) {
    const c = H.car; H.cam.snap = false; H.thrHeld = 0;
    H.cam.pos.set(c.x + Math.sin(c.yaw) * 14, c.y + 6, c.z + Math.cos(c.yaw) * 14); H.cam.look.set(c.x, c.y + 1, c.z); H.cam.yaw = c.yaw;
    H.hud.count.textContent = ""; H.hud.feed.innerHTML = "";
  }
}
function popCount(text) { for (const H of humans) { const el = H.hud.count; el.textContent = text; el.className = "count"; void el.offsetWidth; el.className = "count pop"; } }
function goRace() {
  race.state = "race"; popCount("GO!");
  sfx("beep", true); musicStart("race");
  for (const H of humans) {
    const c = H.car;
    if (IN[H.h].throttle > 0 && H.thrHeld < 0.9) { reward(c, 0.34); c.padT = 0.6; feed(c, "PERFECT START", "+BOOST", "big"); }
    else if (H.thrHeld > 1.8) feed(c, "Too early — wheelspin", "", "bad");
  }
  for (const c of cars) if (c.ai && Math.random() < (settings.rivals ? 0.7 : 0.3)) c.padT = 0.45;   // rivals nail some starts too
  contextTips();
}
function pauseRace() { if (race.state !== "race" && race.state !== "count") return; race.prev = race.state; race.state = "paused"; pauseScreen(); musicStart("off"); }
function resumeRace() {
  closeMenu(); race.state = race.prev || "race";
  if (race.state === "race") musicStart(humans.some((H) => H.car.lap === LAPS) ? "final" : "race");
}
// Race over once every human has crossed the line (or 45 s after the first one in split-screen).
// Rivals still on track get a projected time from their pace so far.
function finishRace() {
  if (race.state === "done") return;
  race.state = "done";
  updatePlaces();
  const standings = cars.map((c) => {
    if (c.finished) return { car: c, t: c.finishT };
    if (c.ctrl !== "ai") return { car: c, t: 1e6 + (1e5 - c.prog), dnf: true };
    const pace = Math.max(12, c.prog / Math.max(1, race.time));
    return { car: c, t: race.time + Math.max(0.5, (LAPS * LAPLEN - c.prog) / pace), est: true };
  }).sort((a, b) => a.t - b.t);
  const me = humans[0].car, solo = race.mode !== "split";
  let headline = "Finish!", newRecord = false, medal = 0;
  if (solo && me.finished) {
    const total = me.finishT;
    newRecord = records.race == null || total < records.race;
    medal = total <= MEDALS[0].t ? 3 : total <= MEDALS[1].t ? 2 : total <= MEDALS[2].t ? 1 : 0;
    if (newRecord) records.race = +total.toFixed(3);
    records.medal = Math.max(records.medal || 0, medal);
    const place = standings.findIndex((r) => r.car === me) + 1;
    if (race.mode === "solo") { if (place === 1) records.wins = (records.wins || 0) + 1; headline = place === 1 ? "Victory!" : `${ordinal(place)} place`; }
    else headline = newRecord ? "New track record!" : "Finish!";
    saveRecords();
  } else if (!solo) {
    const w = standings[0].car;
    headline = w.ctrl === "ai" ? `${esc(w.name)} takes it!` : `${esc(w.name)} wins!`;
  }
  if (!DEMO) PA.store.set("canyon:tut", true);
  musicStart("results");
  race.results = { standings, headline, newRecord, medal };
  race.resultsShown = false;
  setTimeout(() => { if (race.state === "done") { race.resultsShown = true; showHUD(false); resultsScreen(race.results); } }, 1800);
}
function recover(c) {
  if (race.state !== "race" || c.respawn > 0 || c.finished) return;
  feed(c, "BACK ON TRACK", "", ""); beginRespawn(c, { seg: c.seg, s: c.s, v: Math.max(10, c.speed * 0.5) });
}

/* ================================================================ main loop */
const STEP = 1 / 120;
let acc = 0, frameN = 0, sunCD = 0;
const REPS = AUTO ? 4 : 1;
function frame(dt, t) {
  readInput(dt);
  for (const H of humans) {
    const I = IN[H.h];
    if (I.cam) {
      I.cam = false;
      if (race.state === "race" || race.state === "count") {
        H.cam.mode = (H.cam.mode + 1) % CAMS.length; race.camModes[H.h] = H.cam.mode; PA.store.set(H.h ? "canyon:cam2" : "canyon:cam", H.cam.mode);
        feed(H.car, CAMS[H.cam.mode].name + " camera", ""); H.cam.snap = true;
      }
    }
    if (I.recover) { I.recover = false; recover(H.car); }
    if (I.rHeld > 1.25 && (race.state === "race" || race.state === "count")) { I.rHeld = 0; sfx("select"); startCountdown(); return; }
  }
  IN[0].cam = IN[1].cam = false;
  if (edge.pause) { edge.pause = false; if (race.state === "race" || race.state === "count") pauseRace(); else if (race.state === "paused" && MENU && MENU.back === resumeRace) resumeRace(); }
  if (race.state === "paused") { updateAudio(); updateHUD(0); render(t); return; }
  const sdt = SIM ? SIM * STEP : dt * REPS;
  if (race.state === "count") {
    for (const H of humans) { if (IN[H.h].throttle > 0) H.thrHeld += dt; else H.thrHeld = 0; }
    race.count -= sdt;
    const step = Math.ceil(race.count);
    if (step < race.countStep && step > 0) { race.countStep = step; popCount(String(step)); sfx("beep", false); }
    if (race.count <= 0) goRace();
  }
  const rec = race.mode !== "split" && humans[0] ? humans[0].car : null;
  acc += sdt; let guard = 0;
  while (acc >= STEP && guard++ < (SIM || 40)) {
    for (const c of cars) physStep(c, STEP);
    if (cars.length > 1 && (race.state === "race" || race.state === "done")) carContacts();
    if (PROBE) PROBE(cars, race.time);
    if (race.state === "race") {
      race.time += STEP;
      if (rec && !rec.finished) { rec.recT += STEP; if (rec.recT >= 0.05) { rec.recT -= 0.05; rec.rec.push(rec.x, rec.y, rec.z, rec.yaw, rec.pitch, rec.roll); } }
    }
    for (const c of cars) {
      if (c.respawn > 0) { const before = c.respawn; c.respawn -= STEP; if (before > 0.5 && c.respawn <= 0.5) finishRespawn(c); }
      c.invuln = Math.max(0, c.invuln - STEP);
    }
    acc -= STEP;
  }
  if (guard >= (SIM || 40)) acc = 0;
  if (race.state === "race" || race.state === "done" || race.state === "count") updatePlaces();
  if (race.state === "race") {
    contextTips();
    if (--sunCD <= 0) { sunCD = 30; setSunForRace(clamp(race.time / 170, 0, 1)); }
    // split-screen: once one player is home the other has 45 seconds to finish
    if (humans.some((H) => H.car.finished)) { race.firstFinish ??= race.time; if (race.time - race.firstFinish > 45) finishRace(); }
  }
  // ghost of the best lap (time trial)
  const gh = records.ghost;
  race.ghostOn = false;
  if (race.mode === "trial" && settings.ghost && gh && gh.length > 12 && race.state === "race" && rec && !rec.finished) {
    const f = (race.time - rec.lapStart) / 0.05, i = Math.floor(f), k = f - i, n = gh.length / 6;
    if (i < n - 1) {
      const a = i * 6, b = a + 6, L = (q) => lerp(gh[a + q], gh[b + q], k);
      race.ghostOn = true; ghost3d.root.position.set(L(0), L(1), L(2));
      ghost3d.root.quaternion.setFromEuler(eul.set(L(4), gh[a + 3] + wrapA(gh[b + 3] - gh[a + 3]) * k, L(5)));
    }
  }
  const vdt = Math.min(sdt, 0.1);
  for (const c of cars) updateCarVisual(c, vdt);
  updateWorld(vdt, t);
  for (const H of humans) updateCamera(H, SIM ? vdt : dt, t);
  updateAudio();
  updateHUD(dt);
  if (!SIM || ++frameN % 8 === 0) render(t);
}

/* ================================================================ boot */
toTitle();
applyQuality();
for (const c of cars) updateCarVisual(c, 0);
for (const H of humans) updateCamera(H, 0.016, 0);
try { await renderer.compileAsync(scene, camera); } catch {}
window.__cc = {
  cars, humans, race, records, settings, TR, IN, CHECKPOINTS, MODELS, PAINTS,
  get car() { return humans[0] && humans[0].car; },
  place: (id, s, v = 40, d = 0, k = 0) => { const c = humans[k] ? humans[k].car : cars[k]; placeCar(c, TR[id], s, v, d); for (const H of humans) H.cam.snap = true; return c; },
  info: () => ({ ...lastInfo, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length }),
  terrainAt: (x, z) => carvedHeight(x, z), surface: (id, s, d) => ({ ...surface(TR[id], s, d) }),
  setProbe: (f) => (PROBE = f), surfaceAt: (c) => ({ ...surface(c.seg, c.s, c.d) }),
  startCountdown, startRace, toTitle, titleScreen, garageScreen, finishRace, setupField, layout, menu: () => MENU, setState: (s) => (race.state = s),
};
if (THUMB) {
  // Attract shot for the gallery: three cars flying through the Arch Gap.
  closeMenu(); setupField("solo"); showHUD(false); race.state = "race";
  const TS = SEGS.find((sg) => sg.def.arch != null && sg.gaps.length) || SEGS.find((sg) => sg.gaps.length);
  const me = humans[0].car, g0 = TS.gaps[0].s0, [r1, r2] = cars.filter((c) => c.ai);
  humans[0].cam.mode = 1;
  placeCar(me, TS, g0 - 70, 46, -1.2); placeCar(r1, TS, g0 - 52, 47, 2.6); placeCar(r2, TS, g0 - 150, 40, 1.5);
  me.boost = 1;
  for (let i = 0; i < 120 * 3; i++) {
    for (const c of cars) physStep(c, STEP);
    for (const c of cars) updateCarVisual(c, STEP);
    updateCamera(humans[0], STEP, i * STEP);
    if (!me.grounded && me.seg === TS && me.s > g0 + 3) break;
  }
  for (let i = 0; i < 90; i++) updateCamera(humans[0], 1 / 30, 3 + i / 30);
  humans[0].camera.fov = 62; humans[0].camera.updateProjectionMatrix();
  race.state = "done-thumb";
  let fr2 = 0;
  PA.loop((dt, t) => { updateWorld(0, t); updateCamera(humans[0], 0, t); render(t); if (++fr2 > 20) window.__ready = true; });
} else {
  if (AUTO) startCountdown(PA.params.get("mode") || "solo");
  PA.loop((dt, t) => frame(dt, t));
}

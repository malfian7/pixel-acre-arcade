// Rooftop Dash — a courier's run across the rooftops of a neon town, from sunset into the night.
//
//   rooftop/parkour.js  how the runner moves (coyote time, jump buffer, variable jump, fall multiplier,
//                       slide / dive / roll, auto-vault, mantle, wall-run) — pure, unit-tested
//   rooftop/cam.js      chase camera: smooth follow, speed FOV, landing shake, slide / wall tilt
//   rooftop/fx.js       particles (footsteps, landings, sparks, splashes), speed lines, wind, rings
//   this file           the city (roofs at different heights, wall-run billboards, procedural roof
//                       props), atmosphere (sunset → cyberpunk night), obstacles, input, HUD, loop

import * as THREE from "three";
import { PA } from "../common.js";
import { PK, createRunner, step as runnerStep, height as runnerHeight } from "./parkour.js";
import { RunnerCam } from "./cam.js";
import { Particles, SpeedLines, Wind, Rings } from "./fx.js";

/* ------------------------------------------------------------ helpers */
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp, smooth = (a, b, x) => THREE.MathUtils.smoothstep(x, a, b);
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: 0.75, ...o });
function mesh(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; }
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const LANES = PK.lanes;
const AUTO = PA.THUMB || PA.params.has("auto");     // autopilot (thumbnail demo / testing)
const REDUCED = PA.REDUCED;

/* ------------------------------------------------------------ renderer / scene */
const renderer = await PA.renderer(THREE, { clear: 0x120e24 });
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x2a1c4a, 0.018);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 420);
const rcam = new RunnerCam(camera, { reduced: REDUCED });

// Atmosphere: two palettes, blended by how far the run has gone (sunset at the start → neon night).
const ATMOS = {
  sunset: { top: "#2b1d5e", mid: "#c84a7c", hor: "#ffb46a", below: "#5a2e50", fog: "#a8587c", fogD: 0.0145, hemiSky: "#ffb08a", hemiGround: "#3b2a5e", hemi: 1.25,
    key: "#ffae6a", keyI: 2.3, keyPos: [-10, 7, -30], rim: "#ff7aa8", rimI: 0.5, neon: 0.45, rain: 0, sun: 1, stars: 0, dust: "#ffd2a0", wind: "#ffcf9a", lines: "#ffe6c8" },
  night: { top: "#05041a", mid: "#1b1243", hor: "#ff3d9a", below: "#140f26", fog: "#2a1b4c", fogD: 0.02, hemiSky: "#6c5cff", hemiGround: "#ff2d95", hemi: 1.05,
    key: "#86d4ff", keyI: 1.2, keyPos: [-6, 16, 8], rim: "#ff3d9a", rimI: 1.4, neon: 1.0, rain: 1, sun: 0, stars: 1, dust: "#b8ccff", wind: "#9fe7ff", lines: "#bfe9ff" },
};
const A = {}; for (const k of Object.keys(ATMOS.sunset)) { const v = ATMOS.sunset[k]; A[k] = typeof v === "string" ? new THREE.Color(v) : Array.isArray(v) ? v.slice() : v; }
function mixAtmos(t) {
  for (const k of Object.keys(A)) {
    const a = ATMOS.sunset[k], b = ATMOS.night[k];
    if (typeof a === "string") A[k].set(a).lerp(new THREE.Color(b), t);
    else if (Array.isArray(a)) a.forEach((v, i) => (A[k][i] = lerp(v, b[i], t)));
    else A[k] = lerp(a, b, t);
  }
}

// Glossy wet surfaces reflect a tiny procedural "neon town" environment.
let envTex;
{
  const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
  env.background = new THREE.Color(0x2a2147);
  const glow = (c, x, y, z, w, h) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.lookAt(0, 0, 0); env.add(m); };
  glow(0xff8a3d, -6, 1, -8, 4, 2); glow(0xf27c8c, 7, 2, -6, 3, 3); glow(0xffd27a, 0, 3, -10, 6, 1.2);
  glow(0x8fb8ff, -8, 6, 4, 5, 2); glow(0xf4a63a, 6, 0.5, 6, 4, 1.5); glow(0x4a3a72, 0, 10, 0, 20, 20);
  const band = new THREE.Mesh(new THREE.CylinderGeometry(12, 12, 2.5, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x8a4a6a, side: THREE.BackSide })); env.add(band);
  const envRT = pm.fromScene(env, 0.035); envTex = envRT.texture; pm.dispose();
  PA.cleaner.disposeObject(env); PA.cleaner.track(envRT);
}

// Sky: one full-screen pass. Gradient + sun at the horizon + stars come from the palette (shader
// uniforms); the two skyline layers are painted once to a transparent canvas (windows in a second
// channel, so they can light up as the night falls).
const skySeed = Array.from({ length: 400 }, () => Math.random());
const skyU = {
  top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, below: { value: new THREE.Color() },
  sun: { value: 1 }, stars: { value: 0 }, neon: { value: 0.5 }, horizon: { value: 0.385 }, skyline: { value: null }, aspect: { value: 1 }, time: { value: 0 }, flash: { value: 0 },
};
const sky = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false, uniforms: skyU,
  vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }`,
  fragmentShader: /* glsl */`
    uniform vec3 top, mid, hor, below; uniform float sun, stars, neon, horizon, aspect, time, flash; uniform sampler2D skyline; varying vec2 vUv;
    float h21(vec2 p) { return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5); }
    void main() {
      float y = vUv.y, hz = 1.0 - horizon;               // horizon line (screen space, from the top)
      vec3 c = y > hz ? mix(hor, mix(mid, top, smoothstep(0.35, 1.0, (y - hz) / (1.0 - hz))), smoothstep(0.0, 0.35, (y - hz) / (1.0 - hz)))
                      : mix(below, hor * 0.55, smoothstep(hz - 0.25, hz, y));
      vec2 p = vec2((vUv.x - 0.5) * aspect, y - hz);
      float d = length(p - vec2(-0.18 * aspect, 0.05));
      c += sun * (vec3(1.0, 0.72, 0.42) * smoothstep(0.09, 0.07, d) * 1.2 + vec3(1.0, 0.55, 0.35) * exp(-d * 5.0) * 0.55);
      if (y > hz) { vec2 g = floor(vec2(vUv.x * 220.0 * aspect, y * 220.0)); float s = h21(g); c += stars * step(0.996, s) * (0.6 + 0.4 * sin(time * 2.0 + s * 60.0)) * smoothstep(hz, hz + 0.25, y); }
      vec4 L = texture2D(skyline, vUv);
      vec3 sil = mix(below * 0.55, vec3(0.06, 0.04, 0.12), neon);
      c = mix(c, sil, L.a);
      c += L.r * L.a * mix(vec3(0.9, 0.55, 0.35) * 0.35, vec3(1.0, 0.55, 0.8), neon) * (0.4 + neon);
      c += flash * vec3(0.55, 0.6, 0.8);
      gl_FragColor = vec4(c, 1.0);
    }`,
}));
sky.frustumCulled = false; sky.renderOrder = -10; scene.add(sky);
function paintSkyline() {
  const W = Math.min(1280, Math.round(innerWidth)), H = Math.round(W * innerHeight / innerWidth);
  const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
  const g = cv.getContext("2d"), hz = H * (camera.aspect < 0.8 ? 0.4 : 0.385);
  skyU.horizon.value = hz / H; skyU.aspect.value = W / H;
  let k = 0; const r = () => skySeed[k++ % skySeed.length];
  for (const [maxH, unit] of [[0.17, 0.035], [0.11, 0.05]]) {
    let x = -10;
    while (x < W) {
      const bw = W * unit * (0.5 + r()), bh = H * maxH * (0.25 + r() * 0.75);
      g.fillStyle = "rgba(0,0,0,1)"; g.fillRect(x, hz - bh, bw, bh + H);
      if (r() < 0.25) g.fillRect(x + bw * 0.45, hz - bh - H * 0.025, 2, H * 0.025);
      if (r() < 0.2) { g.beginPath(); g.moveTo(x - 2, hz - bh); g.lineTo(x + bw / 2, hz - bh - H * 0.02); g.lineTo(x + bw + 2, hz - bh); g.fill(); }
      for (let i = 0; i < 7; i++) if (r() < 0.55) { g.fillStyle = "rgba(255,0,0,1)"; g.fillRect(x + 2 + r() * (bw - 4), hz - bh + 4 + r() * (bh - 4), 2, 2); }
      x += bw + r() * 3;
    }
  }
  if (skyU.skyline.value) skyU.skyline.value.dispose();
  const t = new THREE.CanvasTexture(cv); t.flipY = true; skyU.skyline.value = t;
}

const hemi = new THREE.HemisphereLight(0xffb08a, 0x3b2a5e, 1.2); scene.add(hemi);
const key = new THREE.DirectionalLight(0xffae6a, 2.2);
key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -9, right: 9, top: 12, bottom: -12, near: 1, far: 60 });
key.shadow.bias = -0.0006; key.shadow.normalBias = 0.02;
scene.add(key, key.target);
const rim = new THREE.DirectionalLight(0xff7aa8, 0.5); scene.add(rim); // cool/pink back-rim on the runner
const signGlow = new THREE.PointLight(0xff9a50, 40, 28, 1.6); scene.add(signGlow);
const pinkGlow = new THREE.PointLight(0xf27c8c, 25, 22, 1.6); scene.add(pinkGlow);

/* ------------------------------------------------------------ textures & materials */
function facade(wall, cols, rows, litP) {
  const rects = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) rects.push({ c, r, lit: Math.random() < litP, col: pick(["#ffd08a", "#ffb070", "#ff9c8a", "#fff0c0", "#ffc46a", "#9fe7ff", "#ff7ad1"]), dark: pick(["#1a1630", "#221c3c", "#2a2446"]) });
  return new THREE.MeshBasicMaterial({ map: canvasTex(128, 512, (g, w, h) => {
    g.fillStyle = wall; g.fillRect(0, 0, w, h);
    const cw = w / cols, rh = h / rows;
    g.fillStyle = "rgba(0,0,0,.18)"; for (let r = 0; r < rows; r++) g.fillRect(0, r * rh + rh * 0.86, w, 3);
    for (const q of rects) {
      g.fillStyle = q.lit ? q.col : q.dark; g.fillRect(q.c * cw + cw * 0.22, q.r * rh + rh * 0.24, cw * 0.56, rh * 0.5);
      if (q.lit && Math.random() < 0.4) { g.fillStyle = "rgba(60,30,40,.55)"; g.fillRect(q.c * cw + cw * 0.22, q.r * rh + rh * 0.24, cw * 0.56, rh * 0.22); }
    }
    const sh = g.createLinearGradient(0, 0, 0, h); sh.addColorStop(0, "rgba(12,8,26,0)"); sh.addColorStop(0.35, "rgba(12,8,26,.35)"); sh.addColorStop(1, "rgba(12,8,26,.85)");
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
  }) });
}
const facades = [facade("#3b3058", 3, 12, 0.35), facade("#4a2f48", 4, 14, 0.3), facade("#2e3552", 3, 10, 0.4), facade("#463a3a", 4, 12, 0.32)];
const wallMat = M(0x221c38, { roughness: 0.95 });
const roofMats = [0x2f2b4a, 0x37304f, 0x2b3446].map((c) => M(c, { roughness: 0.28, metalness: 0.2, envMap: envTex, envMapIntensity: 1.0 }));
const trimMat = M(0x5a4d82, { roughness: 0.5 });
const puddleMat = new THREE.MeshStandardMaterial({ color: 0x2a2450, roughness: 0.04, metalness: 0, envMap: envTex, envMapIntensity: 3.2, polygonOffset: true, polygonOffsetFactor: -2 });

const WORDS = ["TEA", "NOODLES", "BAKERY", "FISH", "BOOKS", "TOFU", "FRUIT", "CAFE", "KITES", "RICE", "SOUP", "HATS", "SWEETS", "LAMPS", "RAMEN", "ARCADE", "HOTEL", "KARAOKE"];
const NEON = [["#ffcf7a", "#ff8a3d"], ["#ffd9e0", "#f27c8c"], ["#fff2c4", "#f4a63a"], ["#d6f5e3", "#86d9a6"], ["#e2ecff", "#8fb8ff"], ["#e8fbff", "#2de2ff"], ["#ffe0f6", "#ff3db8"]];
const neonMats = []; // their brightness follows the palette (dim in daylight, full at night)
function signMat(text, vertical) {
  const [fg, glow] = pick(NEON);
  const w = vertical ? 96 : 320, h = vertical ? 340 : 96;
  const t = canvasTex(w, h, (g) => {
    g.fillStyle = "#1d1328"; g.fillRect(0, 0, w, h);
    g.strokeStyle = glow; g.lineWidth = 5; g.shadowColor = glow; g.shadowBlur = 14; g.strokeRect(7, 7, w - 14, h - 14);
    g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle";
    if (vertical) { const L = text.slice(0, 5); g.font = "bold 50px 'Arial Black', sans-serif"; [...L].forEach((ch, i) => g.fillText(ch, w / 2, h / 2 + (i - (L.length - 1) / 2) * 60)); }
    else { g.font = `bold ${text.length > 6 ? 42 : 56}px 'Arial Black', sans-serif`; g.fillText(text, w / 2, h / 2 + 3); }
  });
  const m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); neonMats.push(m); return m;
}
const bladeMats = WORDS.map((w) => signMat(w, true));
const boardMats = WORDS.map((w) => signMat(w, false));
const glowTex = canvasTex(64, 64, (g) => { const r = g.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.35, "rgba(255,255,255,.35)"); r.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = r; g.fillRect(0, 0, 64, 64); });

/* ------------------------------------------------------------ pools */
class Pool {
  constructor(make, n = 0) { this.make = make; this.free = []; for (let i = 0; i < n; i++) this.put(this.spawn()); }
  spawn() { const o = this.make(); scene.add(o); return o; }
  get() { const o = this.free.pop() || this.spawn(); o.visible = true; return o; }
  put(o) { o.visible = false; this.free.push(o); }
}
const unitBox = new THREE.BoxGeometry(1, 1, 1);
function facadeBox(faces) { const g = new THREE.BoxGeometry(1, 1, 1), uv = g.attributes.uv; for (let f = 0; f < 6; f++) if (!faces.includes(f)) for (let i = 0; i < 4; i++) uv.setXY(f * 4 + i, 0.01, 0.995); return g; }
const boxRunner = facadeBox([4]), boxLeft = facadeBox([0, 4]), boxRight = facadeBox([1, 4]);

/* ------------------------------------------------------------ procedural roof props (scenery at the roof edges) */
const PROP = (() => {
  const steel = M(0x8a84a8, { roughness: 0.45, metalness: 0.4 }), dark = M(0x2a2540), wood = M(0x7a4e34, { roughness: 0.85 }), band = M(0x3a2a24);
  const bulb = (c) => new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
  return {
    // wooden water tank on stilts (the classic city roof silhouette)
    tank() {
      const g = new THREE.Group();
      for (const [x, z] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]]) { const l = mesh(new THREE.CylinderGeometry(0.06, 0.07, 1.4, 5), steel); l.position.set(x, 0.7, z); g.add(l); }
      const body = mesh(new THREE.CylinderGeometry(0.85, 0.85, 1.6, 12), wood); body.position.y = 2.2; g.add(body);
      for (const y of [1.65, 2.2, 2.75]) { const b = mesh(new THREE.CylinderGeometry(0.87, 0.87, 0.07, 12), band); b.position.y = y; g.add(b); }
      const lid = mesh(new THREE.ConeGeometry(0.98, 0.6, 12), dark); lid.position.y = 3.3; g.add(lid);
      return g;
    },
    // vent fan housing with spinning blades
    fan() {
      const g = new THREE.Group();
      const box = mesh(new THREE.BoxGeometry(1.1, 0.7, 1.1), M(0x6a6f90, { roughness: 0.45, metalness: 0.35 })); box.position.y = 0.35; g.add(box);
      const ring = mesh(new THREE.CylinderGeometry(0.48, 0.48, 0.12, 14, 1, true), steel); ring.position.y = 0.76; g.add(ring);
      const blades = new THREE.Group(); blades.position.y = 0.76;
      for (let i = 0; i < 4; i++) { const b = mesh(new THREE.BoxGeometry(0.85, 0.02, 0.16), dark); b.rotation.y = i * Math.PI / 4; b.rotation.x = 0.25; blades.add(b); }
      g.add(blades); g.userData.spin = blades;
      return g;
    },
    // free-standing neon billboard on a steel frame
    board() {
      const g = new THREE.Group();
      for (const x of [-1.1, 1.1]) { const p = mesh(new THREE.BoxGeometry(0.1, 2.6, 0.1), steel); p.position.set(x, 1.3, 0); g.add(p); }
      const brace = mesh(new THREE.BoxGeometry(2.4, 0.08, 0.08), steel); brace.position.y = 1.2; g.add(brace);
      const face = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), boardMats[0]); face.position.y = 2.2; g.add(face); g.userData.face = face;
      const back = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.9), boardMats[1]); back.position.y = 2.2; back.rotation.y = Math.PI; g.add(back); g.userData.back = back;
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff6ad5, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(4.2, 2.2, 1); halo.position.y = 2.2; g.add(halo); g.userData.halo = halo;
      return g;
    },
    antenna() {
      const g = new THREE.Group(); const pole = mesh(new THREE.CylinderGeometry(0.04, 0.05, 3.2, 5), steel); pole.position.y = 1.6; g.add(pole);
      for (const y of [2.2, 2.7]) { const b = mesh(new THREE.BoxGeometry(1.0, 0.04, 0.04), steel); b.position.y = y; g.add(b); }
      const tip = bulb(0xff4d5e); tip.position.y = 3.25; g.add(tip); g.userData.blink = tip;
      return g;
    },
    dish() {
      const g = new THREE.Group(); const p = mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.9, 5), steel); p.position.y = 0.45; g.add(p);
      const d = mesh(new THREE.SphereGeometry(0.6, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.35), M(0xd6d2e6, { side: THREE.DoubleSide })); d.position.y = 1.2; d.rotation.x = -1.1; g.add(d);
      return g;
    },
    pots() {
      const g = new THREE.Group();
      for (let i = 0; i < 3; i++) { const p = mesh(new THREE.CylinderGeometry(0.22, 0.17, 0.35, 7), M(0xb0603e)); p.position.set(0, 0.17, i * 0.6); g.add(p); const l = mesh(new THREE.IcosahedronGeometry(0.3, 0), M(0x3f8a6a)); l.position.set(0, 0.5, i * 0.6); g.add(l); }
      return g;
    },
    pipes() {
      const g = new THREE.Group(), m = M(0x7a6a8a, { metalness: 0.5, roughness: 0.4 });
      for (let i = 0; i < 2; i++) { const p = mesh(new THREE.CylinderGeometry(0.11, 0.11, 4.5, 8), m); p.rotation.x = Math.PI / 2; p.position.set(i * 0.3, 0.2 + i * 0.12, 0); g.add(p); }
      for (const z of [-1.8, 0, 1.8]) { const s = mesh(new THREE.BoxGeometry(0.6, 0.18, 0.12), dark); s.position.set(0.15, 0.08, z); g.add(s); }
      return g;
    },
  };
})();
const PROP_KINDS = ["tank", "fan", "board", "antenna", "dish", "pots", "pipes", "fan", "tank"];

/* ------------------------------------------------------------ runner rooftops */
const bulbGeo = new THREE.SphereGeometry(0.07, 6, 4);
const bulbMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const BULB_COLS = [0xffc46a, 0xf27c8c, 0x86d9a6, 0x2de2ff].map((c) => new THREE.Color(c));
function makeRoof() {
  const g = new THREE.Group(), u = g.userData;
  u.body = mesh(boxRunner, facades[0], false); g.add(u.body);
  u.slab = mesh(unitBox, roofMats[0], false); g.add(u.slab);
  u.lip = mesh(unitBox, trimMat, false); g.add(u.lip);
  u.para = [-1, 1].map((s) => { const p = mesh(unitBox, trimMat); p.position.set(s * 3.62, 0.15, 0); g.add(p); return p; });
  u.puddles = [0, 1, 2].map(() => { const p = new THREE.Mesh(new THREE.CircleGeometry(1, 14), puddleMat); p.rotation.x = -Math.PI / 2; p.receiveShadow = true; g.add(p); return p; });
  const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, 28); bulbs.frustumCulled = false; g.add(bulbs); u.bulbs = bulbs;
  for (let i = 0; i < 28; i++) bulbs.setColorAt(i, BULB_COLS[i % 4]);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.05), boardMats[0]); g.add(sign); u.sign = sign;
  // one of each prop kind (+ spares), placed by setupRoof
  u.props = PROP_KINDS.map((k) => { const p = PROP[k](); p.userData.kind = k; g.add(p); return p; });
  return g;
}
const roofPool = new Pool(makeRoof, 10);
function setupRoof(g, len, h) {
  const u = g.userData;
  g.position.y = h;
  u.body.material = pick(facades);
  u.body.scale.set(7, 34, len); u.body.position.y = -17.4;
  u.slab.material = pick(roofMats); u.slab.scale.set(7.4, 0.4, len); u.slab.position.y = -0.2;
  u.lip.scale.set(7.6, 0.28, 0.3); u.lip.position.set(0, -0.12, len / 2);
  u.para.forEach((p) => p.scale.set(0.16, 0.3, len));
  u.puddles.forEach((p) => { p.visible = Math.random() < 0.75; p.scale.set(rand(0.5, 1.3), rand(0.4, 0.9), 1); p.position.set(rand(-2.6, 2.6), 0.012, rand(-len / 2 + 1.5, len / 2 - 1.5)); });
  const on = Math.random() < 0.6, n = Math.min(28, Math.floor(len / 1.3)), side = pick([-1, 1]);
  u.bulbs.visible = on; u.bulbs.count = n; const m4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) { const z = -len / 2 + 0.6 + i * 1.3; m4.makeTranslation(side * 3.62, 0.38 + Math.sin(i * 1.7) * 0.03, z); u.bulbs.setMatrixAt(i, m4); }
  u.bulbs.instanceMatrix.needsUpdate = true;
  u.sign.visible = Math.random() < 0.7; u.sign.material = pick(boardMats); u.sign.position.set(rand(-1.4, 1.4), -1.9, len / 2 + 0.03);
  // procedural skyline of props along both outer edges (never inside the three lanes)
  u.props.forEach((p) => (p.visible = false));
  const slots = [];
  for (let z = -len / 2 + 2; z < len / 2 - 2; z += rand(3.5, 6.5)) slots.push(z);
  const kinds = PROP_KINDS.map((_, i) => i).sort(() => Math.random() - 0.5);
  let used = 0;
  for (const z of slots) {
    if (used >= Math.min(4, kinds.length) || Math.random() < 0.3) continue;
    const p = u.props[kinds[used++]], s = Math.random() < 0.5 ? -1 : 1;
    p.visible = true; p.position.set(s * rand(3.05, 3.35), 0, z); p.rotation.y = p.userData.kind === "board" ? (s > 0 ? -0.35 : 0.35) : rand(0, Math.PI * 2);
    if (p.userData.kind === "board") { p.userData.face.material = pick(boardMats); p.userData.back.material = pick(boardMats); p.userData.halo.material.color.set(pick(NEON)[1]); }
    if (p.userData.kind === "pipes") p.rotation.y = 0;
  }
}

/* ------------------------------------------------------------ wall-run billboards (span some gaps) */
const wallTex = canvasTex(512, 128, (g, w, h) => {
  g.fillStyle = "#140c26"; g.fillRect(0, 0, w, h);
  g.shadowBlur = 16; g.lineWidth = 6;
  for (const [y, c] of [[16, "#2de2ff"], [h - 16, "#ff3db8"]]) { g.strokeStyle = c; g.shadowColor = c; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  g.fillStyle = "#fff2fb"; g.shadowColor = "#ff3db8"; g.font = "bold 58px 'Arial Black', sans-serif"; g.textBaseline = "middle";
  for (let x = 20; x < w; x += 170) { g.fillText("▶▶", x, h / 2 + 4); }
});
wallTex.wrapS = THREE.RepeatWrapping;
const wallFaceMat = new THREE.MeshBasicMaterial({ map: wallTex, toneMapped: false, side: THREE.DoubleSide }); neonMats.push(wallFaceMat);
function makeWall() {
  const g = new THREE.Group();
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), wallFaceMat); face.rotation.y = Math.PI / 2; g.add(face); g.userData.face = face;
  const frame = mesh(unitBox, M(0x2a2540, { roughness: 0.4, metalness: 0.5 }), false); g.add(frame); g.userData.frame = frame;
  const legs = [0, 1, 2].map(() => { const l = mesh(new THREE.BoxGeometry(0.16, 1, 0.16), M(0x4a4568)); g.add(l); return l; }); g.userData.legs = legs;
  return g;
}
const wallPool = new Pool(makeWall, 3);
const walls = []; // { side, zNear, zFar, obj }
function addWall(side, zNear, zFar, h) {
  const g = wallPool.get(), u = g.userData, len = zNear - zFar;
  g.position.set(side * 3.0, h, (zNear + zFar) / 2);
  u.face.scale.set(len, 3.2, 1); u.face.position.set(-side * 0.13, 1.4, 0); wallTex.repeat.set(len / 7, 1);
  u.frame.scale.set(0.24, 3.4, len); u.frame.position.set(0, 1.4, 0);
  u.legs.forEach((l, i) => { l.scale.y = 30; l.position.set(side * 0.05, -15 + 0, (i - 1) * len * 0.42); });
  walls.push({ side, zNear, zFar, obj: g });
}

/* ------------------------------------------------------------ street-side buildings (scenery) */
const bladeGeo = new THREE.PlaneGeometry(1.0, 3.5);
const lantGeo = new THREE.SphereGeometry(0.22, 8, 6); lantGeo.scale(1, 1.3, 1);
const lantMatS = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const LANT_COLS = [0xff6a3d, 0xffa34a, 0xf27c8c].map((c) => new THREE.Color(c));
function makeSide() {
  const g = new THREE.Group();
  g.userData.body = new THREE.Mesh(unitBox, wallMat); g.add(g.userData.body);
  g.userData.blade = new THREE.Mesh(bladeGeo, bladeMats[0]); g.add(g.userData.blade);
  const ls = new THREE.InstancedMesh(lantGeo, lantMatS, 6); ls.frustumCulled = false; g.add(ls); g.userData.lants = ls;
  for (let i = 0; i < 6; i++) ls.setColorAt(i, LANT_COLS[i % 3]);
  return g;
}
const sidePool = new Pool(makeSide, 50);
const rows = [-1, 1].flatMap((s) => [{ s, near: true, items: [], nextZ: 15 }, { s, near: false, items: [], nextZ: 15 }]);
function placeSide(row) {
  const g = sidePool.get(), u = g.userData;
  const len = row.near ? rand(6, 11) : rand(9, 18);
  const top = row.near ? rand(-9, -2.5) : rand(-6, 12), inner = row.near ? rand(7.5, 9) : rand(17, 26), dx = row.near ? 8 : 10, bot = -45;
  u.body.material = pick(facades); u.body.geometry = row.s < 0 ? boxLeft : boxRight;
  u.body.scale.set(dx, top - bot, len); u.body.position.set(row.s * (inner + dx / 2), (top + bot) / 2, 0);
  u.blade.visible = row.near ? Math.random() < 0.75 : Math.random() < 0.35;
  u.blade.material = pick(bladeMats); u.blade.position.set(row.s * (inner - 0.6), top - rand(2.2, 3.6), len / 2 - 0.7);
  u.lants.visible = row.near && Math.random() < 0.55;
  if (u.lants.visible) {
    const y = rand(-3.4, -1.6), m4 = new THREE.Matrix4();
    for (let i = 0; i < 6; i++) { const f = (i + 0.5) / 6; m4.makeTranslation(row.s * (3.8 + f * (inner - 3.8)), y - Math.sin(f * Math.PI) * 0.6, 0); u.lants.setMatrixAt(i, m4); }
    u.lants.instanceMatrix.needsUpdate = true;
  }
  g.position.z = row.nextZ - len / 2; g.userData.len = len;
  row.nextZ -= len + rand(0.3, row.near ? 2.5 : 5);
  row.items.push(g);
}

/* ------------------------------------------------------------ hero: courier kid in a yellow raincoat */
const hero = (() => {
  const root = new THREE.Group(), squash = new THREE.Group(), body = new THREE.Group(); root.add(squash); body.position.y = 0.58; squash.add(body);
  const coat = M(0xf6c536, { roughness: 0.35, envMap: envTex, envMapIntensity: 0.8 }), skin = M(0xf0c09a), boot = M(0xd2475a, { roughness: 0.4 }), pants = M(0x2c3a66), box = M(0xb57d47), tape = M(0xead7a8);
  const add = (p, m, x, y, z) => { m.position.set(x, y, z); p.add(m); return m; };
  add(body, mesh(new THREE.CylinderGeometry(0.21, 0.32, 0.64, 8), coat), 0, 0.3, 0);
  add(body, mesh(new THREE.CylinderGeometry(0.3, 0.32, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xdfe8ff, emissive: 0x8fa8ff, emissiveIntensity: 0.6, flatShading: true })), 0, 0.12, 0);
  add(body, mesh(new THREE.SphereGeometry(0.2, 10, 8), skin), 0, 0.74, 0);
  const hood = add(body, mesh(new THREE.SphereGeometry(0.235, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), coat), 0, 0.75, 0.02); hood.rotation.x = 0.4;
  for (const s of [-1, 1]) add(body, mesh(new THREE.SphereGeometry(0.028, 5, 4), M(0x241a2c)), s * 0.07, 0.76, -0.185);
  const parcel = add(body, mesh(new THREE.BoxGeometry(0.46, 0.42, 0.3), box), 0, 0.4, 0.3);
  add(parcel, mesh(new THREE.BoxGeometry(0.47, 0.06, 0.31), tape), 0, 0, 0); add(parcel, mesh(new THREE.BoxGeometry(0.06, 0.43, 0.31), tape), 0, 0, 0);
  const limb = (x, y, r, l, m, end, endGeo) => { const piv = new THREE.Group(); piv.position.set(x, y, 0); body.add(piv); add(piv, mesh(new THREE.CapsuleGeometry(r, l, 2, 6), m), 0, -l / 2 - r * 0.4, 0); add(piv, mesh(endGeo, end), 0, -l - r * 1.4, endGeo.type === "BoxGeometry" ? -0.04 : 0); return piv; };
  const armL = limb(-0.27, 0.52, 0.065, 0.3, coat, skin, new THREE.SphereGeometry(0.07, 6, 5));
  const armR = limb(0.27, 0.52, 0.065, 0.3, coat, skin, new THREE.SphereGeometry(0.07, 6, 5));
  const legL = limb(-0.12, 0.02, 0.075, 0.32, pants, boot, new THREE.BoxGeometry(0.17, 0.17, 0.27));
  const legR = limb(0.12, 0.02, 0.075, 0.32, pants, boot, new THREE.BoxGeometry(0.17, 0.17, 0.27));
  scene.add(root);
  return { root, squash, body, armL, armR, legL, legR, phase: 0, flip: 0, roll: 0, sq: 0, sqV: 0, deadT: 0 };
})();
let R = createRunner(); // parkour state (position, velocity, timers)

/* ------------------------------------------------------------ obstacles & pickups (pooled) */
const DIM = { ac: { hw: 0.72, hd: 0.5, y0: 0, y1: 0.95 }, vent: { hw: 0.55, hd: 0.45, y0: 0, y1: 0.62 }, chimney: { hw: 0.45, hd: 0.45, y0: 0, y1: 2.6 }, laundry: { hw: 3.4, hd: 0.15, y0: 0.95, y1: 2.3 }, sign: { hw: 0.85, hd: 0.12, y0: 1.0, y1: 1.85 }, pigeons: { hw: 0.6, hd: 0.4, y0: 0, y1: 0.4 } };
const makers = {
  ac() {
    const g = new THREE.Group();
    const b = mesh(new THREE.BoxGeometry(1.45, 0.9, 0.95), M(0x9aa2c8, { roughness: 0.4, metalness: 0.3 })); b.position.y = 0.5; g.add(b);
    const f = mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.04, 12), M(0x2a2540)); f.rotation.x = Math.PI / 2; f.position.set(-0.25, 0.5, 0.48); g.add(f);
    const blade = mesh(new THREE.BoxGeometry(0.56, 0.08, 0.02), M(0x6a6a88)); blade.position.set(-0.25, 0.5, 0.51); g.add(blade); g.userData.spin = blade;
    for (let i = 0; i < 4; i++) { const v = mesh(new THREE.BoxGeometry(0.4, 0.03, 0.02), M(0x6a6f90)); v.position.set(0.38, 0.3 + i * 0.13, 0.48); g.add(v); }
    for (const s of [-1, 1]) { const l = mesh(new THREE.BoxGeometry(0.1, 0.06, 1.0), M(0x4a4568)); l.position.set(s * 0.6, 0.03, 0); g.add(l); }
    return g;
  },
  vent() { // low duct box: auto-vault fodder
    const g = new THREE.Group(), m = M(0x7a7f9e, { roughness: 0.45, metalness: 0.4 });
    const b = mesh(new THREE.BoxGeometry(1.1, 0.6, 0.9), m); b.position.y = 0.3; g.add(b);
    for (let i = 0; i < 3; i++) { const s = mesh(new THREE.BoxGeometry(0.9, 0.04, 0.05), M(0x2a2540)); s.position.set(0, 0.2 + i * 0.13, 0.46); g.add(s); }
    const hood = mesh(new THREE.CylinderGeometry(0.2, 0.25, 0.3, 8), m); hood.position.set(0.3, 0.75, 0); g.add(hood);
    return g;
  },
  chimney() {
    const g = new THREE.Group(), brick = M(0x8b4a4a, { roughness: 0.9 });
    const b = mesh(new THREE.BoxGeometry(0.9, 2.5, 0.9), brick); b.position.y = 1.25; g.add(b);
    for (let i = 0; i < 4; i++) { const r = mesh(new THREE.BoxGeometry(0.93, 0.05, 0.93), M(0x6e3a3e)); r.position.y = 0.4 + i * 0.5; g.add(r); }
    const cap = mesh(new THREE.BoxGeometry(1.08, 0.2, 1.08), M(0x4a3a4e)); cap.position.y = 2.55; g.add(cap);
    g.userData.smoke = [0, 1, 2].map((i) => { const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: 0x8a84a8, transparent: true, opacity: 0.5, flatShading: true, depthWrite: false })); s.position.y = 2.8 + i * 0.5; g.add(s); return s; });
    return g;
  },
  laundry() {
    const g = new THREE.Group(), pole = M(0x8a7a6a);
    for (const s of [-1, 1]) { const p = mesh(new THREE.CylinderGeometry(0.06, 0.07, 2.5, 6), pole); p.position.set(s * 3.4, 1.25, 0); g.add(p); }
    const rope = mesh(new THREE.CylinderGeometry(0.015, 0.015, 6.8, 4), M(0xdcd2c0)); rope.rotation.z = Math.PI / 2; rope.position.y = 2.3; g.add(rope);
    g.userData.cloths = [];
    const cols = [0xf27c8c, 0x8fb8ff, 0xf4a63a, 0x86d9a6, 0xece6fa, 0xb48ad8];
    for (let i = 0; i < 7; i++) {
      const piv = new THREE.Group(); piv.position.set(-3 + i * 1.0, 2.3, 0); g.add(piv);
      const h = rand(0.9, 1.3), w = rand(0.6, 0.85), c = mesh(new THREE.BoxGeometry(w, h, 0.04), M(pick(cols), { side: THREE.DoubleSide })); c.position.y = -h / 2 - 0.02; piv.add(c);
      g.userData.cloths.push(piv);
    }
    return g;
  },
  sign() {
    const g = new THREE.Group(), wood = M(0x6b4a3a);
    for (const s of [-1, 1]) { const p = mesh(new THREE.BoxGeometry(0.09, 2.0, 0.09), wood); p.position.set(s * 0.88, 1.0, 0); g.add(p); }
    const frame = mesh(new THREE.BoxGeometry(1.8, 0.92, 0.12), wood); frame.position.y = 1.42; g.add(frame);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(1.62, 0.76), boardMats[0]); face.position.set(0, 1.42, 0.065); g.add(face); g.userData.face = face;
    return g;
  },
  pigeons() {
    const g = new THREE.Group(), grey = M(0x8d8aa6), dark = M(0x5c5878);
    g.userData.birds = [0, 1, 2].map((i) => {
      const b = new THREE.Group(); b.position.set((i - 1) * 0.42, 0, (i % 2) * 0.3);
      const bd = mesh(new THREE.SphereGeometry(0.15, 7, 5), grey); bd.scale.set(1, 0.85, 1.4); bd.position.y = 0.17; b.add(bd);
      const hd = mesh(new THREE.SphereGeometry(0.085, 6, 5), dark); hd.position.set(0, 0.32, -0.16); b.add(hd);
      const bk = mesh(new THREE.ConeGeometry(0.03, 0.08, 4), M(0xf4a63a)); bk.rotation.x = -Math.PI / 2; bk.position.set(0, 0.31, -0.26); b.add(bk);
      b.userData.wings = [-1, 1].map((s) => { const w = new THREE.Group(); w.position.set(s * 0.1, 0.22, 0); const m = mesh(new THREE.BoxGeometry(0.32, 0.03, 0.2), dark); m.position.x = s * 0.16; w.add(m); b.add(w); return w; });
      g.add(b); return b;
    });
    return g;
  },
  lantern() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.26, 8, 6), new THREE.MeshStandardMaterial({ color: 0xff5a32, emissive: 0xff4a1e, emissiveIntensity: 1.25, flatShading: true })); body.scale.y = 1.25; g.add(body);
    for (const y of [-0.33, 0.33]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.07, 8), M(0x2a1a22)); c.position.y = y; g.add(c); }
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xff8a3d, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(1.5, 1.5, 1); g.add(halo);
    return g;
  },
  parcel() {
    const g = new THREE.Group();
    g.add(mesh(new THREE.BoxGeometry(0.55, 0.42, 0.42), M(0xc48a50)));
    const rib = new THREE.MeshStandardMaterial({ color: 0xf4a63a, emissive: 0xf4a63a, emissiveIntensity: 1.6 });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.57, 0.08, 0.44), rib), new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.44, 0.44), rib));
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xf4c46a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false })); halo.scale.set(1.8, 1.8, 1); g.add(halo);
    return g;
  },
};
const pools = Object.fromEntries(Object.entries(makers).map(([k, f]) => [k, new Pool(() => { const o = f(); o.traverse((c) => c.isMesh && (c.castShadow = !c.material.transparent)); return o; }, k === "lantern" ? 30 : 4)]));
const ents = [];   // active obstacles + pickups: {type, obj, x, y (above its roof), base (roof height), z, ...}
function spawn(type, lane, z, y = 0, base = 0) {
  const obj = pools[type].get(), x = type === "laundry" ? 0 : lane === "wall" ? 0 : LANES[lane];
  const e = { type, obj, x, y, base, z, lane, t: Math.random() * 6, fly: 0, pick: type === "lantern" || type === "parcel", done: false, vaulted: false, ...(DIM[type] || {}) };
  obj.position.set(x, base + y, z); obj.rotation.set(0, 0, 0);
  if (type === "sign") obj.userData.face.material = pick(boardMats);
  if (type === "pigeons") obj.userData.birds.forEach((b) => { b.position.y = 0; b.rotation.set(0, rand(-0.5, 0.5), 0); });
  ents.push(e); return e;
}

/* ------------------------------------------------------------ level generation */
const segs = [];   // { zNear, zFar, h, obj }
let nextZ = 12, nextH = 0, speed = 13, dist = 0, bonus = 0, lanterns = 0, tricks = 0, lastWall = -999;
const SPAWN_AHEAD = 170;
const diff = () => Math.min(1, dist / 1800);
function addSegment(gap, len, quiet = false, h = nextH) {
  const drop = Math.max(0, nextH - h); // a lower roof means a longer flight: keep its landing zone clear
  const zNear = nextZ - gap, zFar = zNear - len, g = roofPool.get();
  setupRoof(g, len, h); g.position.z = (zNear + zFar) / 2;
  const s = { zNear, zFar, h, obj: g }; segs.push(s); nextZ = zFar; nextH = h;
  if (gap > 0 && !quiet && Math.random() < 0.6) { const l = Math.floor(Math.random() * 3), m = zNear + gap / 2; [[-1.6, 1.5], [0, 2.2], [1.6, 1.5]].forEach(([dz, y]) => spawn("lantern", l, m + dz, y, h)); }
  if (!quiet) { let z = zNear - 7 - drop * speed * 0.12; while (z > zFar + 4) { pattern(z, h); z -= rand(8, 12) * (0.75 + speed / 40); } }
  return s;
}
function pattern(z, h) {
  const r = Math.random(), lanes = [0, 1, 2].sort(() => Math.random() - 0.5), d = diff();
  const row = (l, y = 0.9) => { for (let i = 0; i < 4; i++) spawn("lantern", l, z - i * 1.7, y, h); };
  if (r < 0.18) row(lanes[0]);
  else if (r < 0.4) {
    const n = Math.random() < 0.35 + 0.35 * d ? 2 : 1;
    for (let i = 0; i < n; i++) { spawn(Math.random() < 0.6 ? "ac" : "vent", lanes[i], z, 0, h); if (Math.random() < 0.4) [[1.2, 1.7], [0, 2.1], [-1.2, 1.7]].forEach(([dz, y]) => spawn("lantern", lanes[i], z + dz, y, h)); }
    if (n === 1 && Math.random() < 0.5) row(lanes[2]);
  } else if (r < 0.55) { spawn("chimney", lanes[0], z, 0, h); if (Math.random() < 0.3 + 0.4 * d) spawn("ac", lanes[1], z, 0, h); else row(lanes[1]); }
  else if (r < 0.69) { spawn("laundry", 1, z, 0, h); if (Math.random() < 0.5) row(lanes[0], 0.45); }
  else if (r < 0.81) { spawn("sign", lanes[0], z, 0, h); if (Math.random() < 0.3 + 0.4 * d) spawn("sign", lanes[1], z, 0, h); }
  else if (r < 0.93) { spawn("pigeons", lanes[0], z, 0, h); if (Math.random() < 0.5) row(lanes[1]); }
  else spawn("parcel", lanes[0], z, Math.random() < 0.5 ? 0.9 : 2.3, h);
}
// next roof height: mostly level, regular drops (big ones roll), small up-steps you can jump
function nextHeight(prev, gap) {
  const r = Math.random();
  let h = prev;
  if (r < 0.5) h = prev + rand(-0.3, 0.3);
  else if (r < 0.7) h = prev - rand(1.2, 3.4);
  else if (r < 0.76) h = prev - rand(4, 6);
  else if (gap < speed * 0.32) h = prev + rand(0.45, 0.85);
  else h = prev + rand(-0.2, 0.4);
  if (h < -7) h = prev + rand(0.45, 0.85) * (gap < speed * 0.32 ? 1 : 0);
  if (h > 3) h = prev - rand(1.2, 3);
  return Math.round(h * 20) / 20;
}
function generate() {
  while (nextZ > -SPAWN_AHEAD) {
    const prev = segs[segs.length - 1];
    if (dist + (12 - nextZ) > 260 && dist - lastWall > 220 && Math.random() < 0.16) {
      // wall-run gap: too wide to jump; a neon billboard along one side carries you across
      const gap = speed * 1.05 + 4, side = pick([-1, 1]), lane = side < 0 ? 0 : 2, h = nextH;
      const zStart = nextZ;
      for (let i = 0; i < 4; i++) spawn("lantern", lane, zStart + 6 - i * 1.6, 0.9, h);                // lead-in in the wall's lane
      for (let i = 0; i < 6; i++) spawn("lantern", lane, zStart - 2 - i * (gap - 4) / 6, 1.7, h);      // trail along the wall
      addWall(side, zStart - 0.4, zStart - gap + 2, h);
      addSegment(gap, rand(18, 26) + speed * 0.3, false, h);
      lastWall = dist + (12 - zStart);
      continue;
    }
    const gap = rand(2.4, 3.6 + speed * 0.12), len = rand(16, 30) + speed * 0.3;
    addSegment(gap, len, false, prev ? nextHeight(nextH, gap) : 0);
  }
  for (const row of rows) while (row.nextZ > -150) placeSide(row);
}
function resetWorld() {
  for (const s of segs) roofPool.put(s.obj); segs.length = 0;
  for (const w of walls) wallPool.put(w.obj); walls.length = 0;
  for (const e of ents) pools[e.type].put(e.obj); ents.length = 0;
  for (const row of rows) { row.items.forEach((g) => sidePool.put(g)); row.items.length = 0; row.nextZ = 15; }
  for (const k in trickLog) delete trickLog[k];
  nextZ = 12; nextH = 0; speed = PA.THUMB ? 16 : 13; dist = 0; bonus = 0; lanterns = 0; tricks = 0; milestone = 400; lastWall = -999;
  addSegment(0, PA.THUMB ? 32.6 : 46, true, 0);
  if (PA.THUMB) {  // hand-placed demo stretch
    addSegment(4, 34, true, -1.6);
    [[-20.8, 1.6], [-22.6, 2.3], [-24.4, 1.6]].forEach(([z, y]) => spawn("lantern", 2, z, y - 1.6, 0));
    for (let i = 0; i < 4; i++) spawn("lantern", 2, -28 - i * 1.8, 0.9, -1.6);
    spawn("ac", 0, -19, 0, 0); spawn("chimney", 1, -33, 0, -1.6); spawn("parcel", 0, -36, 0.9, -1.6); spawn("pigeons", 2, -44, 0, -1.6); spawn("laundry", 1, -54, 0, -1.6);
  }
  generate();
  R = createRunner();
  Object.assign(hero, { phase: 0, flip: 0, roll: 0, sq: 0, sqV: 0, deadT: 0, dead: false, fell: false });
  hero.root.rotation.set(0, 0, 0); hero.body.rotation.set(0, 0, 0); hero.squash.scale.set(1, 1, 1);
  fx.clear(); rcam.snap({ x: 0, y: 0 });
}

/* ------------------------------------------------------------ juice: particles, lines, wind, rings, rain */
const fx = new Particles(scene, 900);
const glints = new Particles(scene, 300, { additive: true });
fx.clear = () => { fx.life.fill(0); glints.life.fill(0); };
const lines = new SpeedLines(scene, REDUCED ? 30 : 70);
const wind = new Wind(scene, REDUCED ? 60 : 160);
const rings = new Rings(scene);
const RAIN = REDUCED ? 450 : 1100;
const rain = new THREE.InstancedMesh(new THREE.BoxGeometry(0.016, 0.8, 0.016), new THREE.MeshBasicMaterial({ color: 0xb4c6ff, transparent: true, opacity: 0.34, depthWrite: false }), RAIN);
rain.frustumCulled = false; scene.add(rain);
const rp = new Float32Array(RAIN * 3);
for (let i = 0; i < RAIN; i++) { rp[i * 3] = rand(-16, 16); rp[i * 3 + 1] = rand(-8, 16); rp[i * 3 + 2] = rand(-45, 2.5); }
const rq = new THREE.Quaternion(), rv = new THREE.Vector3(), rs = new THREE.Vector3(1, 1, 1), rm = new THREE.Matrix4(), XA = new THREE.Vector3(1, 0, 0);
function updateRain(dt, sp) {
  const amt = A.rain; rain.visible = amt > 0.05; if (!rain.visible) return;
  rain.material.opacity = 0.34 * amt; rain.count = Math.floor(RAIN * amt);
  rq.setFromAxisAngle(XA, -Math.atan2(sp, 26));
  const cy = camera.position.y;
  for (let i = 0; i < rain.count; i++) {
    let y = rp[i * 3 + 1] - 26 * dt, z = rp[i * 3 + 2] + sp * dt;
    if (y < -8) y += 24; if (z > 2.5) z -= 47.5;
    rp[i * 3 + 1] = y; rp[i * 3 + 2] = z;
    rv.set(rp[i * 3] + camera.position.x, y + cy - 3, z); rm.compose(rv, rq, rs); rain.setMatrixAt(i, rm);
  }
  rain.instanceMatrix.needsUpdate = true;
}
const C = { dust: new THREE.Color(), spark: new THREE.Color(0xffb34a), splash: new THREE.Color(0xc8d6ff), white: new THREE.Color(0xffffff), neonA: new THREE.Color(0x2de2ff), neonB: new THREE.Color(0xff3db8) };
// small puff at the feet; wet splash at night, warm dust at sunset
function puff(x, y, z, n, power = 1, spread = 0.25) {
  C.dust.copy(A.dust);
  for (let k = 0; k < n; k++) {
    const wet = Math.random() < A.rain;
    fx.emit({ x: x + rand(-spread, spread), y: y + 0.04, z: z + rand(-0.2, 0.2), vx: rand(-1.4, 1.4) * power, vy: rand(0.6, 2.4) * power, vz: rand(0.2, 2.2) * power,
      life: rand(0.35, 0.7), size: wet ? rand(0.05, 0.09) : rand(0.14, 0.3) * (0.7 + power * 0.3), grow: wet ? 0 : 0.6, color: wet ? C.splash : C.dust, alpha: wet ? 0.85 : 0.55, drag: wet ? 1 : 3, gravity: wet ? 12 : 1.5 });
  }
}
function sparks(x, y, z, n, col = C.spark, dir = 0) {
  for (let k = 0; k < n; k++) glints.emit({ x: x + rand(-0.1, 0.1), y: y + rand(0, 0.15), z: z + rand(-0.1, 0.1), vx: rand(-1.5, 1.5) + dir * 2, vy: rand(0.5, 3.5), vz: rand(1, 5), life: rand(0.2, 0.45), size: rand(0.05, 0.1), color: col, alpha: 1, drag: 2, gravity: 14 });
}
function burst(x, y, z, n, col) {
  for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; glints.emit({ x, y, z, vx: Math.cos(a) * 3.2, vy: Math.sin(a) * 3.2, vz: rand(-0.5, 0.5), life: 0.45, size: 0.12, color: col, alpha: 1, drag: 5, gravity: 0 }); }
}

/* ------------------------------------------------------------ UI */
const bar = PA.topBar({ title: "Rooftop Dash", scoreLabel: "0" });
const hud = PA.el(`<div class="hud"><span><b data-d>0</b> m</span><span><b data-l>0</b> lanterns</span><span><b data-t>0</b> tricks</span></div>`); document.body.appendChild(hud);
if (PA.THUMB) hud.style.display = "none"; hud.style.visibility = "hidden";
const sayEl = document.getElementById("say"), flashEl = document.getElementById("flash"), trickEl = document.getElementById("trick");
let sayT = 0, trickT = 0;
function say(jp, en, ms = 1300) { PA.sayJP(jp); sayEl.querySelector("b").textContent = en; sayEl.querySelector("small").textContent = `「${jp}」`; sayEl.classList.add("show"); clearTimeout(sayT); sayT = setTimeout(() => sayEl.classList.remove("show"), ms); }
const trickLog = {};
function trick(name, pts) {
  bonus += pts; tricks++; trickLog[name] = (trickLog[name] || 0) + 1;
  trickEl.innerHTML = `${name} <b>+${pts}</b>`; trickEl.classList.remove("show"); void trickEl.offsetWidth; trickEl.classList.add("show");
  clearTimeout(trickT); trickT = setTimeout(() => trickEl.classList.remove("show"), 900);
}

const tc = PA.touchControls({ stick: false, buttons: [{ label: "◀", code: "ArrowLeft", alt: true }, { label: "▶", code: "ArrowRight", alt: true }, { label: "Slide", code: "ArrowDown", alt: true }, { label: "Jump", code: "Space" }] });
{ const right = tc.querySelector(".pa-tbtns"), left = PA.el(`<div class="pa-tbtns left"></div>`); tc.appendChild(left); [...right.children].slice(0, 2).forEach((b) => left.appendChild(b)); }

let state = "start", milestone = 400;
const VOICE = [["いいね！", "Nice!"], ["すごい！", "Awesome!"], ["その調子！", "Keep it up!"], ["はやい！", "So fast!"]];
const score = () => Math.floor(dist) + bonus;
const MUSIC = { bpm: 150, root: 220, wave: "square", lead: [12, null, 15, 12, 10, null, 7, null, 12, null, 15, 17, 19, 17, 15, null, 12, null, 10, 7, 5, null, 7, null, 3, 5, 7, null, 10, null, 7, null], bass: [0, null, 0, 12, -2, null, -2, 10, -4, null, -4, 8, -5, null, -2, null] };
function startOverlay() {
  PA.overlay(`<div class="pa-eyebrow">Action · Parkour runner</div><h1>Rooftop Dash</h1>
    <p>Deliver the parcel across a neon town as the sun goes down: leap and drop between rooftops, slide under the clutter, vault the low stuff, wall-run the big gaps.</p>
    <div class="pa-keys">
      <kbd>← → / A D</kbd><span>Change lane</span>
      <kbd>↑ W Space</kbd><span>Jump — hold for higher, again in the air for a double jump</span>
      <kbd>↓ S</kbd><span>Slide · in the air: dive and roll on landing</span>
      <kbd>Auto</kbd><span>Vault low vents and AC units · grab ledges you nearly reach</span>
      <kbd>Wall-run</kbd><span>Jump the gap in the lane next to a neon wall, jump again to leap off it</span>
      <kbd>Touch</kbd><span>Tap = jump · swipe ↑ and hold = higher jump · swipe ←→ lane · swipe ↓ slide</span>
    </div>
    <div class="pa-actions"><button class="pa-btn" data-play>Play</button><a class="pa-btn ghost" href="../index.html#rooftop">Back to gallery</a></div>`, { "[data-play]": play });
}
function play() {
  PA.closeOverlay(); resetWorld(); state = "play"; hud.style.visibility = "visible";
  PA.music(MUSIC);
  if (!PA.TOUCH) { const h = PA.el(`<div class="pa-hint">Space to jump · hold for higher · ↓ to slide</div>`); document.body.appendChild(h); setTimeout(() => (h.style.opacity = 0), 3200); setTimeout(() => h.remove(), 4000); }
}
function pause() {
  if (state !== "play") return; state = "paused"; PA.stopMusic();
  PA.overlay(`<div class="pa-eyebrow">Paused</div><h2>Catch your breath</h2><p>Score so far: ${score()}</p>
    <div class="pa-actions"><button class="pa-btn" data-resume>Resume</button><button class="pa-btn ghost" data-restart>Restart</button><a class="pa-btn ghost" href="../index.html#rooftop">Back to gallery</a></div>`,
    { "[data-resume]": resume, "[data-restart]": play });
}
function resume() { PA.closeOverlay(); state = "play"; PA.music(MUSIC); }
bar.onPause(() => (state === "paused" ? resume() : pause()));
function gameOver() {
  state = "over"; PA.stopMusic(); PA.sfx("fail");
  const s = score(), b = PA.best("rooftop", s, true);
  PA.overlay(`<div class="pa-eyebrow">Delivery interrupted</div><h2>${b.isNew ? "New best run!" : "Splash down!"}</h2>
    <div class="pa-big-score">${s}</div><p class="sub">${Math.floor(dist)} m run · ${lanterns} lanterns · ${tricks} tricks · Best ${b.best}</p>
    <div class="pa-actions"><button class="pa-btn" data-again>Play again</button><a class="pa-btn ghost" href="../index.html#rooftop">Back to gallery</a></div>`, { "[data-again]": play });
  if (b.isNew) PA.sfx("win");
}
let crashInfo = null;
function crash(fell, why = fell ? "fell" : "hit") {
  if (hero.dead) return;
  crashInfo = { why, d: Math.round(dist), y: +R.y.toFixed(2), lane: R.lane, ground: env.ground, segs: segs.slice(0, 3).map((s) => [+s.zNear.toFixed(1), +s.zFar.toFixed(1), s.h]) };
  hero.dead = true; hero.fell = fell; hero.deadT = 0; state = "dying"; PA.sfx(fell ? "whoosh" : "hit");
  R.dead = true;
  if (!fell) { R.vy = 6; R.grounded = false; rcam.addTrauma(0.6); sparks(R.x, R.y + 0.8, -0.2, 14, C.white); }
  say("うわっ！", "Whoa!", 1400);
}

/* ------------------------------------------------------------ input (edge-triggered intents, consumed by the fixed step) */
const IN = { jump: false, slide: false, lane: 0 };
let touchHold = false, tapHold = 0;
const jumpHeld = () => PA.keys.has("Space") || PA.keys.has("ArrowUp") || PA.keys.has("KeyW") || touchHold || tapHold > 0;
addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Escape" || e.code === "KeyP") { if (state === "play") pause(); else if (state === "paused") resume(); return; }
  if (state !== "play" || PA.overlayOpen() || AUTO) return;
  const c = e.code;
  if (c === "ArrowLeft" || c === "KeyA") IN.lane = -1;
  else if (c === "ArrowRight" || c === "KeyD") IN.lane = 1;
  else if (c === "ArrowUp" || c === "KeyW" || c === "Space") IN.jump = true;
  else if (c === "ArrowDown" || c === "KeyS") IN.slide = true;
});
// touch: swipe ↑ = jump (keep the finger down for a higher one), tap = medium jump, swipe ←/→ = lane, swipe ↓ = slide
let sw = null;
const cv = renderer.domElement;
cv.addEventListener("touchstart", (e) => { const t = e.changedTouches[0]; sw = { x: t.clientX, y: t.clientY, t: performance.now(), done: false }; touchHold = false; }, { passive: true });
cv.addEventListener("touchmove", (e) => {
  if (!sw || sw.done || state !== "play") return;
  const t = e.changedTouches[0], dx = t.clientX - sw.x, dy = t.clientY - sw.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;
  sw.done = true;
  if (Math.abs(dx) > Math.abs(dy)) IN.lane = dx > 0 ? 1 : -1; else if (dy < 0) { IN.jump = true; touchHold = true; } else IN.slide = true;
}, { passive: true });
cv.addEventListener("touchend", () => { if (sw && !sw.done && state === "play" && !AUTO && performance.now() - sw.t < 300) { IN.jump = true; tapHold = 0.16; } touchHold = false; sw = null; }, { passive: true });

/* ------------------------------------------------------------ world queries for the parkour controller */
function segAt(z) { return segs.find((s) => s.zFar - 0.15 <= z && s.zNear + 0.25 >= z); }
const env = {
  ground: null, killY: -4,
  wall: (side) => walls.some((w) => w.side === side && w.zFar <= 0.3 && w.zNear >= -0.3),
  lowAhead(lane) {
    for (const e of ents) {
      if (e.pick || e.vaulted || e.done || e.lane !== lane || e.type === "laundry" || e.y1 > PK.vaultMaxH || e.y0 > 0.05) continue;
      if (Math.abs(e.base - R.y) > 0.3) continue;
      // from ~1.5 m ahead until the body is touching it (late = still forgiven, the hop pops over it)
      if (e.z < 0.1 && e.z > -(speed * 0.08 + e.hd + 0.35)) { e.vaulted = true; return { top: e.y1 }; }
    }
    return null;
  },
};
function refreshEnv() {
  const s = segAt(0); env.ground = s ? s.h : null;
  let lo = Infinity; for (const q of segs) if (q.zFar < 12 && q.zNear > -30) lo = Math.min(lo, q.h);
  env.killY = (lo === Infinity ? R.y : lo) - 3;
}

/* ------------------------------------------------------------ autopilot (thumbnail demo / ?auto) */
function autopilot() {
  const look = speed * 0.14, here = segAt(0), ahead = segAt(-look), wallAhead = walls.find((w) => w.zNear < 6 && w.zNear > -speed * 0.6);
  if (wallAhead && !R.wall) { const want = wallAhead.side < 0 ? 0 : 2; if (R.lane !== want) IN.lane = Math.sign(want - R.lane); }
  if (R.grounded && here && (!ahead || ahead.h > R.y + 0.4) && !R.vault) { IN.jump = true; autoHold = 0.35; }
  if (R.wall && R.wall.t > 0.85) { IN.jump = true; autoHold = 0.3; }
  if (!R.grounded && !R.wall && R.vy < -1 && R.airJumps > 0 && !segAt(-speed * 0.3) && !walls.some((w) => w.zFar < 0 && w.zNear > -2)) { IN.jump = true; autoHold = 0.3; }
  const block = (l, near, far) => ents.some((e) => !e.pick && e.type !== "laundry" && !(e.y1 <= PK.vaultMaxH) && e.lane === l && e.z < -near && e.z > -far);
  if (!wallAhead && block(R.lane, 0, speed * 0.55)) { const c = [R.lane - 1, R.lane + 1].filter((l) => l >= 0 && l <= 2 && !block(l, -1, speed * 0.55 + 4)); if (c.length) IN.lane = c[0] - R.lane; }
  if (ents.some((e) => (e.type === "laundry" || (e.type === "sign" && e.lane === R.lane)) && e.z < 0 && e.z > -speed * 0.3) && R.grounded) IN.slide = true;
}
let autoHold = 0;

/* ------------------------------------------------------------ simulation step */
const STEP = 1 / 120;
let acc = 0;
function simulate(dt) {
  acc = Math.min(acc + dt, 0.1);
  while (acc >= STEP) {
    acc -= STEP;
    if (AUTO && state === "play") autopilot();
    autoHold = Math.max(0, autoHold - STEP); tapHold = Math.max(0, tapHold - STEP);
    refreshEnv();
    const ev = runnerStep(R, STEP, env, { jump: IN.jump, held: jumpHeld() || autoHold > 0, slide: IN.slide, lane: IN.lane });
    IN.jump = IN.slide = false; IN.lane = 0;
    for (const e of ev) onEvent(typeof e === "string" ? { type: e } : e);
    collide();
    if (R.dead && state === "play") crash(true);
  }
}
let wallRanFrom = 0;
function onEvent(e) {
  const x = R.x, y = R.y;
  switch (e.type) {
    case "jump": PA.sfx("jump"); puff(x, y, 0, 7, 1); hero.sqV += 6; break;
    case "buffered": trick("Flow", 3); break;
    case "airjump": PA.sfx("pop"); hero.flip = 1; burst(x, y + 0.6, 0, 12, A.rim); break;
    case "walljump": PA.sfx("pop"); hero.flip = 1; sparks(x, y + 0.6, 0, 16, C.neonA, -e.side); trick("Wall-run", 25); wallRanFrom = 0; break;
    case "land": {
      const k = clamp((e.impact - 6) / 18, 0, 1);
      puff(x, y, 0, 4 + Math.round(k * 16), 0.6 + k * 1.2, 0.3 + k * 0.4);
      if (e.impact > 11) { rings.emit(x, y, 0, k, A.dust); rcam.addTrauma(0.15 + k * 0.55 + clamp(e.drop - 2, 0, 4) * 0.05); PA.sfx(e.impact > 17 ? "thud" : "land"); }
      else PA.sfx("land");
      hero.sqV -= 4 + k * 8;
      if (wallRanFrom) { trick("Wall-run", 25); wallRanFrom = 0; }
      break;
    }
    case "roll": PA.sfx("whoosh"); hero.roll = 1; trick("Roll", 5); break;
    case "slide": PA.sfx("whoosh"); puff(x, y, 0, 6, 0.8); break;
    case "dive": PA.sfx("whoosh"); break;
    case "vault": PA.sfx("click"); puff(x, y, -0.4, 5, 0.6); trick("Vault", 5); break;
    case "mantle": PA.sfx("thud"); puff(x, y, -0.3, 6, 0.7); trick("Ledge grab", 10); rcam.addTrauma(0.2); break;
    case "wallrun": PA.sfx("whoosh"); wallRanFrom = 1; rcam.addTrauma(0.12); break;
    case "smack": crash(false, "smack"); break;
    case "fall": crash(true); break;
  }
}
function collide() {
  if (R.dead) return;
  const top = runnerHeight(R);
  for (const e of ents) {
    if (e.done || e.vaulted || Math.abs(e.z) > (e.hd || 0.5) + 0.35) continue;
    const ry = R.y - e.base;
    if (e.pick) {
      if (Math.abs(e.x - R.x) < 0.75 && e.y > ry - 0.45 && e.y < ry + top + 0.4) {
        e.done = true; e.obj.visible = false;
        if (e.type === "parcel") { bonus += 50; PA.sfx("ring"); PA.toast("Parcel +50"); burst(e.x, e.base + e.y, e.z, 18, C.spark); }
        else { bonus += 10; lanterns++; PA.sfx("coin"); sparks(e.x, e.base + e.y, e.z, 6, C.spark); }
      }
    } else if (Math.abs(e.x - R.x) < e.hw + 0.28 && ry < e.y1 && ry + top > e.y0 && !PA.THUMB) {
      // coming down onto a low obstacle (feet near its top): kick off it instead of crashing into it
      if (!R.grounded && R.vy <= 0 && e.y1 <= PK.vaultMaxH && e.y0 <= 0.05 && ry > e.y1 - 0.5) {
        e.vaulted = true; R.y = e.base + e.y1; R.vy = 6.5; R.dive = false; onEvent({ type: "vault" }); continue;
      }
      crash(false, e.type);
    }
  }
}

/* ------------------------------------------------------------ hero animation (from the parkour state) */
function animateHero(dt, t) {
  const h = hero, b = h.body, L = (o, k, v, s = 18) => (o.rotation[k] += (v - o.rotation[k]) * Math.min(1, dt * s));
  h.root.position.set(R.x, R.y, 0);
  h.root.rotation.z = (R.x - (R.wall ? R.wall.side * PK.wallX : LANES[R.lane])) * 0.3 + (R.wall ? -R.wall.side * 0.45 : 0);
  // squash & stretch spring
  h.sqV += (-h.sq * 220 - h.sqV * 18) * dt; h.sq += h.sqV * dt;
  const sq = clamp(h.sq * 0.05, -0.3, 0.25); h.squash.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
  if (hero.dead) {
    if (hero.fell) { b.rotation.x -= dt * 4; b.rotation.z += dt * 2; }
    else { L(b, "x", 1.4); b.position.y += (0.3 - b.position.y) * Math.min(1, dt * 10); L(h.armL, "x", 2.6); L(h.armR, "x", 2.2); L(h.legL, "x", -0.6); }
    return;
  }
  if (state === "start") { b.rotation.x = 0; b.position.y = 0.58 + Math.sin(t * 2) * 0.01; h.legL.rotation.x = h.legR.rotation.x = 0; h.armL.rotation.x = Math.sin(t * 2) * 0.05; h.armR.rotation.x = 0; return; }
  if (h.roll > 0) { // forward roll: one full turn, tucked
    h.roll = Math.max(0, h.roll - dt / PK.rollTime); b.rotation.x = -(1 - h.roll) * Math.PI * 2; b.position.y = 0.38;
    L(h.legL, "x", 1.6, 30); L(h.legR, "x", 1.6, 30); L(h.armL, "x", 1.4, 30); L(h.armR, "x", 1.4, 30);
    if (Math.random() < dt * 40) puff(R.x, R.y, 0.2, 1, 0.5);
  } else if (R.vault) {
    const k = R.vault.mantle ? 1 : 0;
    L(b, "x", k ? 0.5 : 0.35, 24); b.position.y += ((k ? 0.5 : 0.5) - b.position.y) * Math.min(1, dt * 20);
    L(h.armL, "x", k ? 2.9 : 1.2, 30); L(h.armR, "x", k ? 2.9 : 1.2, 30); L(h.legL, "x", 1.4, 30); L(h.legR, "x", 0.9, 30);
  } else if (R.wall) { // running along the wall: legs cycle, body leans away from it
    h.phase += dt * speed * 0.62; const n = Math.sin(h.phase);
    L(b, "x", -0.1); b.position.y = 0.6; h.legL.rotation.x = n * 0.9; h.legR.rotation.x = -n * 0.9; h.armL.rotation.x = -n * 0.7; h.armR.rotation.x = n * 0.7;
    if (Math.random() < dt * 50) sparks(R.x + R.wall.side * 0.35, R.y + 0.15, 0.1, 1, R.wall.side < 0 ? C.neonA : C.neonB, -R.wall.side * 0.3);
  } else if ((R.slideT > 0) && R.grounded) {
    L(b, "x", 1.2); b.position.y += (0.36 - b.position.y) * Math.min(1, dt * 20);
    L(h.legL, "x", 0.15); L(h.legR, "x", 0.3); L(h.armL, "x", 0.6); L(h.armR, "x", 0.6);
    if (Math.random() < dt * 45) sparks(R.x + rand(-0.2, 0.2), R.y, 0.3, 1);
  } else if (!R.grounded) {
    if (h.flip > 0) { h.flip = Math.max(0, h.flip - dt * 2.4); b.rotation.x = -(1 - h.flip) * Math.PI * 2; } else L(b, "x", R.dive ? 0.6 : -0.1);
    b.position.y += (0.66 - b.position.y) * Math.min(1, dt * 12);
    const up = R.vy > 0;
    L(h.legL, "x", up ? 1.0 : 0.4); L(h.legR, "x", up ? -0.5 : 0.2); L(h.armL, "x", up ? 2.5 : 1.6); L(h.armR, "x", up ? 2.2 : 1.4);
  } else {
    const prev = Math.sin(h.phase); h.phase += dt * speed * 0.62; const n = Math.sin(h.phase);
    if (Math.sign(prev) !== Math.sign(n)) puff(R.x + (n > 0 ? -0.12 : 0.12), R.y, 0.1, 2, 0.45, 0.06); // footstep
    L(b, "x", -0.16 - clamp((speed - 13) / 18, 0, 1) * 0.12); b.position.y = 0.58 + Math.abs(Math.cos(h.phase)) * 0.07;
    h.legL.rotation.x = n * 0.95; h.legR.rotation.x = -n * 0.95; h.armL.rotation.x = -n * 0.85; h.armR.rotation.x = n * 0.85;
  }
  h.armL.rotation.z = -0.15; h.armR.rotation.z = 0.15;
}

function updateEnts(dt, dz) {
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i], o = e.obj; e.z += dz; e.t += dt;
    if (e.z > 12 || (e.done && e.type !== "pigeons")) { pools[e.type].put(o); ents.splice(i, 1); continue; }
    o.position.set(e.x, e.base + e.y, e.z);
    if (e.type === "lantern") { o.rotation.y = e.t * 1.6; o.children[0].position.y = Math.sin(e.t * 3) * 0.06; }
    else if (e.type === "parcel") { o.rotation.y = e.t * 2; o.position.y = e.base + e.y + Math.sin(e.t * 3) * 0.1; }
    else if (e.type === "ac") o.userData.spin.rotation.z += dt * 12;
    else if (e.type === "chimney") o.userData.smoke.forEach((s, k) => { const p = (e.t * 0.5 + k / 3) % 1; s.position.set(Math.sin(p * 5 + k) * 0.2, 2.7 + p * 1.6, p * 0.6); s.scale.setScalar(0.6 + p * 1.2); s.material.opacity = 0.45 * (1 - p); });
    else if (e.type === "laundry") o.userData.cloths.forEach((c, k) => (c.rotation.x = Math.sin(e.t * 2.4 + k) * 0.18 + 0.12));
    else if (e.type === "pigeons") {
      if (!e.fly && e.z > -13) { e.fly = 1; PA.sfx("bounce"); }
      if (e.fly) {
        const lift = e.z > 2 ? 1.15 + (e.z - 2) * 0.8 : Math.min(1.15, (e.z + 13) * 0.22);
        e.y0 = lift + 0.5 - 0.75; e.y1 = lift + 0.45;
        o.userData.birds.forEach((b, k) => { b.position.y = lift + Math.sin(e.t * 9 + k * 2) * 0.08; b.userData.wings.forEach((w, s) => (w.rotation.z = (s ? -1 : 1) * Math.sin(e.t * 28 + k) * 0.9)); });
      } else o.userData.birds.forEach((b, k) => (b.rotation.x = Math.max(0, Math.sin(e.t * 3 + k * 2)) * 0.5));
    }
  }
}

PA.onResize(() => {
  camera.aspect = innerWidth / innerHeight; camera.fov = rcam.baseFov(camera.aspect); camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); paintSkyline(); fx.resize(); glints.resize();
});

/* ------------------------------------------------------------ atmosphere per frame */
const fogCol = new THREE.Color();
function applyAtmos(t) {
  mixAtmos(t);
  skyU.top.value.copy(A.top); skyU.mid.value.copy(A.mid); skyU.hor.value.copy(A.hor); skyU.below.value.copy(A.below);
  skyU.sun.value = A.sun; skyU.stars.value = A.stars; skyU.neon.value = A.neon;
  scene.fog.color.copy(fogCol.copy(A.fog)); scene.fog.density = A.fogD;
  hemi.color.copy(A.hemiSky); hemi.groundColor.copy(A.hemiGround); hemi.intensity = A.hemi;
  key.color.copy(A.key); key.intensity = A.keyI; rim.color.copy(A.rim); rim.intensity = A.rimI;
  const nb = 0.35 + A.neon * 0.65; for (const m of neonMats) m.color.setScalar(nb);
  bulbMat.color.setScalar(0.5 + A.neon * 0.5); lantMatS.color.setScalar(0.5 + A.neon * 0.5);
  wind.mat.color.copy(A.wind); lines.mat.uniforms.color.value.copy(A.lines);
  signGlow.intensity = 15 + A.neon * 30; pinkGlow.intensity = 8 + A.neon * 22;
}

resetWorld();
paintSkyline();
// Warm up every shader variant once (pooled objects are hidden), so first spawns never hitch.
{ applyAtmos(0); const hidden = []; scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } }); camera.position.set(0, 3, 6.5); renderer.render(scene, camera); hidden.forEach((o) => (o.visible = false)); resetWorld(); }
if (PA.THUMB) state = "play"; else startOverlay();

let flashT = 0, nextFlash = rand(8, 14), thunderAt = -1;
function tick(dt, t) {
  const running = (state === "play" || state === "dying") && !PA.overlayOpen();
  const sdt = running ? dt : 0;
  let dz = 0;
  if (running) {
    if (state === "play") { speed = Math.min(31, (PA.THUMB ? 16 : 13) + dist * 0.011); dist += speed * sdt; }
    else { hero.deadT += sdt; speed *= Math.exp(-sdt * (R.y < (env.ground ?? R.y) ? 9 : 5)); if (hero.deadT > 1.1 && state === "dying") gameOver(); }
    dz = speed * sdt;
    for (const s of segs) { s.zNear += dz; s.zFar += dz; s.obj.position.z += dz; }
    for (const w of walls) { w.zNear += dz; w.zFar += dz; w.obj.position.z += dz; }
    nextZ += dz;
    for (let i = segs.length - 1; i >= 0; i--) if (segs[i].zFar > 20) { roofPool.put(segs[i].obj); segs.splice(i, 1); }
    for (let i = walls.length - 1; i >= 0; i--) if (walls[i].zFar > 20) { wallPool.put(walls[i].obj); walls.splice(i, 1); }
    for (const row of rows) { row.nextZ += dz; for (let i = row.items.length - 1; i >= 0; i--) { const g = row.items[i]; g.position.z += dz; if (g.position.z - g.userData.len / 2 > 18) { sidePool.put(g); row.items.splice(i, 1); } } }
    generate();
    updateEnts(sdt, dz);
    simulate(sdt);
    if (hero.dead && state === "dying") { R.vy -= 30 * sdt; R.y += R.vy * sdt; if (!hero.fell && env.ground != null && R.y < env.ground) { R.y = env.ground; R.vy = 0; } }
    if (state === "play" && dist > milestone) { const [jp, en] = VOICE[(milestone / 400 - 1) % VOICE.length]; say(jp, en); PA.toast(`${milestone} m!`); milestone += 400; }
    bar.setScore(String(score()));
    hud.querySelector("[data-d]").textContent = Math.floor(dist); hud.querySelector("[data-l]").textContent = lanterns; hud.querySelector("[data-t]").textContent = tricks;
    // spin the roof fans, blink antennas
    for (const s of segs) for (const p of s.obj.userData.props) { if (!p.visible) continue; if (p.userData.spin) p.userData.spin.rotation.y += sdt * 9; if (p.userData.blink) p.userData.blink.visible = Math.sin(t * 3 + s.zNear) > 0; }
  }
  animateHero(sdt, t);

  // atmosphere: sunset → night over the first ~1.4 km (thumbnail: dusk)
  const night = PA.THUMB ? 0.62 : smooth(150, 1400, dist);
  applyAtmos(night);
  skyU.time.value = t;
  updateRain(dt, running ? speed : 2);
  fx.update(sdt, dz); glints.update(sdt, dz); rings.update(sdt, dz);
  const sk = clamp((speed - 16) / 12, 0, 1) + (R.wall ? 0.35 : 0) + (R.dive ? 0.25 : 0);
  lines.update(sdt, speed, running && state === "play" ? Math.min(1, sk) * (REDUCED ? 0.4 : 1) : 0, camera);
  wind.update(running ? sdt : dt * 0.2, running ? speed : 1, t, R.y);
  wind.points.position.y = 0;

  // lightning at night only: double flicker, thunder a moment later
  if (!PA.THUMB) {
    nextFlash -= dt;
    if (nextFlash < 0) { if (A.rain > 0.5) { flashT = 0.0001; thunderAt = rand(0.5, 1.3); } nextFlash = rand(8, 18); }
    if (flashT > 0) { flashT += dt; if (flashT > 0.5) flashT = 0; }
    if (thunderAt > 0) { thunderAt -= dt; if (thunderAt <= 0 && state === "play") { PA.sfx("thud"); PA.sfx("whoosh"); } }
  }
  const fl = flashT > 0 ? Math.max(0, Math.sin(flashT * 40)) * (1 - flashT * 2) * (REDUCED ? 0.3 : 1) : 0;
  flashEl.style.opacity = (fl * 0.28).toFixed(3); hemi.intensity += fl * 4; skyU.flash.value = fl * 0.5;

  // camera
  rcam.update(dt, { x: R.x, y: hero.dead && hero.fell ? Math.max(R.y, env.killY + 2) : R.y, laneX: R.wall ? R.x : LANES[R.lane], speed: running ? speed : 13, sliding: (R.slideT > 0 || R.rollT > 0) && R.grounded, wall: R.wall ? R.wall.side : 0, dead: hero.dead });
  key.position.set(R.x + A.keyPos[0], R.y + A.keyPos[1], A.keyPos[2]); key.target.position.set(R.x, R.y, -4);
  rim.position.set(R.x + 4, R.y + 3, -10);
  signGlow.position.set(Math.sin(t * 0.3) * 2, R.y + 3.5, -16); pinkGlow.position.set(-5, R.y + 2.5, -7);
}

// Thumbnail: fast-forward the demo a moment (camera settles, run cycle going), then render for ~2 s.
let frames = 0, realStart = performance.now();
if (PA.THUMB) for (let i = 0; i < 58; i++) tick(1 / 60, i / 60);
realStart = performance.now();
window.__rd = { setDist(v) { dist = v; }, get crash() { return crashInfo; }, run(sec) { for (let i = 0; i < sec * 60 && state === "play"; i++) tick(1 / 60, i / 60); return { state, dist: Math.round(dist), tricks, log: { ...trickLog }, crashInfo }; }, get R() { return R; }, get state() { return state; }, get dist() { return dist; }, get speed() { return speed; }, segs, walls, ents, play, get tricks() { return tricks; }, rcam, camera, IN };
PA.loop((dt, t) => {
  dt = Math.max(0, dt);
  tick(PA.THUMB ? 0 : dt, t);
  renderer.render(scene, camera);
  if (PA.THUMB && !window.__ready && ++frames > 3 && performance.now() - realStart > 2000) window.__ready = true;
});

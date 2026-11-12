// Frontier Crown — builds the rigged, animated soldier models (models/*.glb) with Three.js and
// GLTFExporter. Run with Node 18+:   node games/frontier/tools/make-unit-glb.mjs
//
// Each .glb holds: a 14-bone humanoid skeleton, two skinned meshes bound to it ("Body" with vertex
// colours, "Team" in white so the game can tint it per player), and four clips —
// Idle (loop), Walk (loop), Attack (fire / thrust, played once per shot), Die (once).
// The low-poly style matches the rest of the game: rigid boxes, each vertex weighted 100% to one bone.

import * as THREE from "../../../lib/three.module.min.js";
import { GLTFExporter } from "./vendor/exporters/GLTFExporter.js";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// Node has Blob but no FileReader: the exporter only needs readAsArrayBuffer / readAsDataURL.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend && this.onloadend(); this.onload && this.onload(); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = "data:application/octet-stream;base64," + Buffer.from(b).toString("base64"); this.onloadend && this.onloadend(); this.onload && this.onload(); }); }
};

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "models");
const HIP = 0.44, SH = 0.83, SHX = 0.225;
const P = { skin: "#e2b48c", white: "#ece6d6", black: "#1d1b1b", boot: "#2a221c", steel: "#b8bec6", wood: "#6a4628" };

// ------------------------------------------------------------------ skeleton (world rest positions)
const BONES = [
  ["hips", null, [0, HIP, 0]], ["spine", "hips", [0, 0.58, 0]], ["chest", "spine", [0, 0.72, 0]], ["head", "chest", [0, 0.9, 0]],
  ["upperArmL", "chest", [-SHX, SH, 0]], ["foreArmL", "upperArmL", [-SHX, 0.67, 0]], ["handL", "foreArmL", [-SHX, 0.51, 0.02]],
  ["upperArmR", "chest", [SHX, SH, 0]], ["foreArmR", "upperArmR", [SHX, 0.67, 0]], ["handR", "foreArmR", [SHX, 0.51, 0.02]],
  ["thighL", "hips", [-0.085, HIP, 0]], ["shinL", "thighL", [-0.085, 0.22, 0]],
  ["thighR", "hips", [0.085, HIP, 0]], ["shinR", "thighR", [0.085, 0.22, 0]],
];
function makeSkeleton() {
  const bones = {}, list = [];
  for (const [name, parent, w] of BONES) {
    const b = new THREE.Bone(); b.name = name;
    const pw = parent ? BONES.find((x) => x[0] === parent)[2] : [0, 0, 0];
    b.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
    if (parent) bones[parent].add(b);
    bones[name] = b; list.push(b);
  }
  return { bones, list, index: Object.fromEntries(list.map((b, i) => [b.name, i])) };
}

// ------------------------------------------------------------------ rigid skinned boxes
class Builder {
  constructor(index) { this.index = index; this.parts = { body: [], team: [] }; }
  box(w, h, d, color, bone, { x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, team = false, cone = false, ball = false } = {}) {
    const g = cone ? new THREE.ConeGeometry(w, h, 4) : ball ? new THREE.IcosahedronGeometry(w, 1) : new THREE.BoxGeometry(w, h, d);
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    const ng = g.index ? g.toNonIndexed() : g; if (ng !== g) g.dispose();
    const n = ng.attributes.position.count, c = new THREE.Color(color);
    ng.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) { si[i * 4] = this.index[bone]; sw[i * 4] = 1; }
    ng.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(si, 4));
    ng.setAttribute("skinWeight", new THREE.Float32BufferAttribute(sw, 4));
    ng.deleteAttribute("uv");
    this.parts[team ? "team" : "body"].push(ng);
    return this;
  }
  merged(which) {
    const list = this.parts[which];
    const out = new THREE.BufferGeometry();
    for (const name of ["position", "normal", "color", "skinIndex", "skinWeight"]) {
      const size = list[0].attributes[name].itemSize, Arr = name === "skinIndex" ? Uint16Array : Float32Array;
      const total = list.reduce((s, g) => s + g.attributes[name].array.length, 0), arr = new Arr(total);
      let o = 0; for (const g of list) { arr.set(g.attributes[name].array, o); o += g.attributes[name].array.length; }
      out.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    out.computeBoundingBox(); out.computeBoundingSphere();
    return out;
  }
}

function humanBody(b, { legs = P.white, coat = true } = {}) {
  // legs: thigh + shin + boot on each side
  for (const [s, x] of [["L", -0.085], ["R", 0.085]]) {
    b.box(0.13, 0.22, 0.14, legs, "thigh" + s, { x, y: 0.33 });
    b.box(0.13, 0.2, 0.14, legs, "shin" + s, { x, y: 0.13 });
    b.box(0.14, 0.16, 0.15, P.black, "shin" + s, { x, y: 0.1 });
    b.box(0.14, 0.08, 0.2, P.boot, "shin" + s, { x, y: 0.04, z: 0.03 });
  }
  b.box(0.36, 0.2, 0.22, P.white, "hips", { y: 0.49 });
  b.box(0.34, 0.2, 0.06, "#d8d8d8", "hips", { y: 0.42, z: -0.1, team: true });           // coat tails
  b.box(0.36, 0.26, 0.22, "#fff", "chest", { y: 0.72, team: true });                       // coat (team colour)
  b.box(0.35, 0.12, 0.21, "#fff", "spine", { y: 0.6, team: true });
  if (coat) { b.box(0.37, 0.04, 0.23, P.white, "chest", { y: 0.68, rz: 0.75 }); b.box(0.37, 0.04, 0.23, P.white, "chest", { y: 0.68, rz: -0.75 }); }
  b.box(0.115, 0, 0, P.skin, "head", { y: 0.97, ball: true });
  for (const [s, x] of [["L", -SHX], ["R", SHX]]) {
    b.box(0.09, 0.17, 0.1, "#fff", "upperArm" + s, { x, y: 0.75, team: true });
    b.box(0.085, 0.16, 0.095, "#fff", "foreArm" + s, { x, y: 0.59, team: true });
    b.box(0.05, 0, 0, P.skin, "hand" + s, { x, y: 0.5, ball: true });
  }
}
function musketeerMesh(index) {
  const b = new Builder(index);
  humanBody(b);
  b.box(0.2, 0.13, 0, P.black, "head", { y: 1.09, ry: 0.5, cone: true });                  // tricorn
  // musket: grip in the right hand, stock below, barrel above (rest = upright at the side)
  b.box(0.045, 0.42, 0.06, P.wood, "handR", { x: SHX, y: 0.42, z: 0.06 });
  b.box(0.03, 0.62, 0.03, P.wood, "handR", { x: SHX, y: 0.92, z: 0.06 });
  b.box(0.02, 0.6, 0.02, P.steel, "handR", { x: SHX, y: 1.05, z: 0.08 });
  b.box(0.012, 0.16, 0.012, "#d6dbe0", "handR", { x: SHX, y: 1.42, z: 0.08 });
  return b;
}
function pikemanMesh(index) {
  const b = new Builder(index);
  humanBody(b, { coat: false });
  b.box(0.38, 0.3, 0.24, P.steel, "chest", { y: 0.74 });                                    // breastplate
  b.box(0.13, 0, 0, P.steel, "head", { y: 1.04, ball: true });                              // morion
  b.box(0.03, 2.4, 0.03, P.wood, "handR", { x: SHX, y: 1.2, z: 0.05 });
  b.box(0.04, 0.22, 0, P.steel, "handR", { x: SHX, y: 2.5, z: 0.05, cone: true });
  return b;
}

// ------------------------------------------------------------------ clips
// Poses are Euler angles (x, y, z) per bone; tracks interpolate quaternions between keyframes.
const HALF_PI = Math.PI / 2;
function clip(name, duration, keys, extra = []) {
  // keys: [{ t, pose: { bone: [x, y, z] }, hips?: [x, y, z] }]
  const bones = new Set(); keys.forEach((k) => Object.keys(k.pose).forEach((b) => bones.add(b)));
  const tracks = [];
  for (const bone of bones) {
    const times = [], values = [];
    let last = [0, 0, 0];
    for (const k of keys) {
      const e = k.pose[bone] || last; last = e;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(e[0], e[1], e[2]));
      times.push(k.t); values.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values));
  }
  if (keys.some((k) => k.hips)) {
    const times = [], values = [];
    let last = [0, HIP, 0];
    for (const k of keys) { const p = k.hips || last; last = p; times.push(k.t); values.push(...p); }
    tracks.push(new THREE.VectorKeyframeTrack("hips.position", times, values));
  }
  return new THREE.AnimationClip(name, duration, [...tracks, ...extra]);
}
// held weapon, level and pointing forward: hand angle cancels the arm so the total is +90°
const level = (arm, fore = 0) => HALF_PI - arm - fore;

function clips(kind) {
  const idleArmR = kind === "pike" ? [-0.1, 0, -0.05] : [-0.12, 0, -0.04];
  const idle = clip("Idle", 2.4, [0, 1.2, 2.4].map((t, i) => ({ t, pose: {
    chest: [i === 1 ? 0.035 : 0, i === 1 ? 0.04 : -0.02, 0], head: [0, i === 1 ? -0.15 : 0.1, 0],
    upperArmR: idleArmR, foreArmR: [-0.1, 0, 0], handR: [0, 0, 0],
    upperArmL: [i === 1 ? -0.08 : -0.02, 0, 0.06], foreArmL: [-0.15, 0, 0],
    thighL: [0, 0, 0], thighR: [0, 0, 0], shinL: [0, 0, 0], shinR: [0, 0, 0],
  }, hips: [0, HIP - (i === 1 ? 0.008 : 0), 0] })));
  const W = 0.9, sw = [-0.55, 0, 0.55, 0, -0.55], kn = [0.1, 0.65, 0.1, 0.1, 0.1], kn2 = [0.1, 0.1, 0.1, 0.65, 0.1];
  const walk = clip("Walk", W, [0, 1, 2, 3, 4].map((i) => ({ t: i * W / 4, pose: {
    thighL: [sw[i], 0, 0], thighR: [-sw[i], 0, 0], shinL: [kn[i], 0, 0], shinR: [kn2[i], 0, 0],
    upperArmL: [-sw[i] * 0.7, 0, 0.06], foreArmL: [-0.25, 0, 0],
    upperArmR: [idleArmR[0] + sw[i] * 0.2, 0, -0.05], foreArmR: [-0.12, 0, 0], handR: [0, 0, 0],
    chest: [0.06, sw[i] * 0.12, 0], head: [-0.04, -sw[i] * 0.08, 0],
  }, hips: [0, HIP + (i % 2 ? 0.035 : 0), 0] })));
  let attack;
  if (kind === "musket") {
    const aim = { upperArmR: [-1.45, 0, 0], foreArmR: [-0.15, 0, 0], handR: [level(-1.45, -0.15), 0, 0], upperArmL: [-1.3, 0, 0.55], foreArmL: [-0.3, 0, 0], chest: [0.02, 0.18, 0], head: [0.12, -0.1, 0] };
    const kick = { ...aim, upperArmR: [-1.2, 0, 0], handR: [level(-1.2, -0.15) + 0.25, 0, 0], chest: [-0.14, 0.18, 0] };
    // bayonet: musket held level at the hip (charge position), then driven forward
    const lowered = { upperArmR: [-0.35, 0, 0], foreArmR: [-0.9, 0, 0], handR: [level(-0.35, -0.9), 0, 0], upperArmL: [-0.9, 0, 0.5], foreArmL: [-0.6, 0, 0], chest: [0.1, 0.12, 0], head: [0.05, -0.1, 0] };
    const ram = { upperArmR: [-1.0, 0, 0], foreArmR: [-0.2, 0, 0], handR: [level(-1.0, -0.2), 0, 0], upperArmL: [-1.35, 0, 0.5], foreArmL: [-0.15, 0, 0], chest: [0.3, 0.12, 0], head: [-0.1, -0.1, 0] };
    attack = clip("Attack", 2.4, [
      { t: 0, pose: aim }, { t: 0.06, pose: kick }, { t: 0.3, pose: aim }, { t: 0.75, pose: lowered },
      { t: 1.1, pose: ram }, { t: 1.4, pose: lowered }, { t: 1.7, pose: ram }, { t: 1.95, pose: lowered }, { t: 2.4, pose: aim },
    ]);
  } else {
    const ready = { upperArmR: [-1.15, 0, 0], foreArmR: [0, 0, 0], handR: [level(-1.15), 0, 0], upperArmL: [-1.1, 0, 0.5], foreArmL: [-0.2, 0, 0], chest: [0.1, 0.15, 0], thighL: [-0.15, 0, 0], thighR: [0.15, 0, 0] };
    const lunge = { ...ready, upperArmR: [-1.4, 0, 0], handR: [level(-1.4), 0, 0], upperArmL: [-1.3, 0, 0.5], chest: [0.4, 0.15, 0], thighL: [-0.5, 0, 0], shinL: [0.3, 0, 0], thighR: [0.3, 0, 0] };
    attack = clip("Attack", 1.2, [{ t: 0, pose: ready }, { t: 0.14, pose: lunge }, { t: 0.32, pose: lunge }, { t: 0.7, pose: ready }, { t: 1.2, pose: ready }],);
  }
  const die = clip("Die", 1.5, [
    { t: 0, pose: { thighL: [0, 0, 0], thighR: [0, 0, 0], shinL: [0, 0, 0], shinR: [0, 0, 0], chest: [0, 0, 0], upperArmL: [0, 0, 0], upperArmR: [-0.2, 0, 0], head: [0, 0, 0] }, hips: [0, HIP, 0] },
    { t: 0.3, pose: { thighL: [-0.7, 0, 0], thighR: [-0.5, 0, 0], shinL: [1.1, 0, 0], shinR: [0.9, 0, 0], chest: [0.35, 0, 0], upperArmL: [-1.2, 0, 0.6], upperArmR: [-1.5, 0, -0.4], head: [0.3, 0, 0] }, hips: [0, HIP - 0.12, -0.05] },
    { t: 0.85, pose: { hips: [-1.45, 0, 0], thighL: [-0.4, 0, 0], thighR: [-0.1, 0, 0], shinL: [0.6, 0, 0], shinR: [0.2, 0, 0], chest: [-0.15, 0, 0], upperArmL: [-2.6, 0, 0.9], upperArmR: [-2.4, 0, -0.9], head: [-0.3, 0.4, 0] }, hips: [0, 0.16, -0.38] },
    { t: 1.5, pose: { hips: [-1.55, 0, 0.08], thighL: [-0.25, 0, 0], thighR: [0, 0, 0], shinL: [0.35, 0, 0], shinR: [0.1, 0, 0], chest: [-0.05, 0, 0], upperArmL: [-2.9, 0, 1.1], upperArmR: [-2.7, 0, -1.0], head: [-0.2, 0.55, 0] }, hips: [0, 0.13, -0.45] },
  ]);
  return [idle, walk, attack, die];
}

// ------------------------------------------------------------------ assemble + export
async function build(name, meshFn, kind) {
  const { bones, list, index } = makeSkeleton();
  const root = new THREE.Group(); root.name = name;
  root.add(bones.hips);
  root.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(list);
  const b = meshFn(index);
  const body = new THREE.SkinnedMesh(b.merged("body"), new THREE.MeshStandardMaterial({ name: "Body", vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.02 }));
  const team = new THREE.SkinnedMesh(b.merged("team"), new THREE.MeshStandardMaterial({ name: "Team", color: 0xffffff, flatShading: true, roughness: 0.8, metalness: 0.02 }));
  body.name = "Body"; team.name = "Team";
  for (const m of [body, team]) { root.add(m); m.bind(skeleton); }
  const animations = clips(kind);
  const scene = new THREE.Scene(); scene.add(root);
  const glb = await new Promise((res, rej) => new GLTFExporter().parse(scene, res, rej, { binary: true, animations }));
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name + ".glb"), Buffer.from(glb));
  console.log(`${name}.glb  ${(glb.byteLength / 1024).toFixed(1)} KB  clips: ${animations.map((a) => `${a.name} ${a.duration}s`).join(", ")}`);
}

await build("musketeer", musketeerMesh, "musket");
await build("pikeman", pikemanMesh, "pike");

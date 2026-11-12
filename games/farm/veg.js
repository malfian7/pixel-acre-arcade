// Little Furrow — everything green, drawn with InstancedMesh so the whole valley is a handful of draw calls:
//
//   grass     ~5 000 blades (one draw call), flowers (stems + heads, two calls), trees (round + pine,
//             trunks + canopies, four calls), stumps, boulders, fence posts and rails (two calls)
//   wind      a vertex-shader sway patched into the stock Lambert/Standard materials with onBeforeCompile:
//             displacement grows with the square of the vertex height inside the blade/tree (roots stay put),
//             phase varies with world position so gusts roll across the field, amplitude breathes slowly.
//             One shared uTime uniform, nothing per instance on the CPU.
//   seasons   per-instance colours are recomputed on season change (spring green → summer deep →
//             fall orange/red → winter snow-dusted; grass and flowers hide under snow)
//   chopping  choppable trees and boulders are ordinary instances; chopping one zero-scales it and shows a
//             stump instance, a hit wobbles it for a moment (its matrix only).
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export const wind = { uTime: { value: 0 }, uWind: { value: 1 } };

/** Patch a stock material so instances sway. h0 = local height of the tip, amp = metres of sway at the tip. */
export function windify(material, h0, amp) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = wind.uTime; sh.uniforms.uWind = wind.uWind;
    sh.vertexShader = "uniform float uTime;\nuniform float uWind;\n" + sh.vertexShader.replace("#include <project_vertex>", /* glsl */`
      vec4 mvPosition = vec4( transformed, 1.0 );
      #ifdef USE_INSTANCING
        mvPosition = instanceMatrix * mvPosition;
      #endif
      {
        vec4 wp = modelMatrix * mvPosition;
        float k = clamp( transformed.y / ${h0.toFixed(3)}, 0.0, 1.0 );
        float ph = uTime * 1.55 + wp.x * 0.31 + wp.z * 0.23;
        float gust = 0.55 + 0.45 * sin( uTime * 0.37 + wp.x * 0.045 - wp.z * 0.03 );
        vec2 sway = vec2( sin( ph ) + 0.35 * sin( ph * 2.7 + wp.z ), 0.45 * cos( ph * 0.83 + wp.x ) );
        mvPosition.xz += sway * ( ${amp.toFixed(3)} * uWind * gust * k * k );
      }
      mvPosition = modelViewMatrix * mvPosition;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  material.customProgramCacheKey = () => `wind:${h0}:${amp}`;
  return material;
}

const LEAF = [ // per season: three canopy tones (round trees), pine tone
  [["#5fae5a", "#46994a", "#f2a7c3"], "#2f7a4a"],
  [["#3f8f45", "#2f7a3c", "#57a64e"], "#26683f"],
  [["#e0823a", "#d4552f", "#e9b13c"], "#3a6b45"],
  [["#e9eef5", "#cfdbe8", "#b9cce0"], "#c8d6e4"],
];
const GRASS = ["#7cc46a", "#4fa14a", "#c4a64e", "#e8eef5"];
const FLOWERS = [["#f7e27a", "#f2a7c3", "#ffffff", "#b678d6"], ["#f4a63a", "#ef6b6b", "#f7e27a", "#ffffff"], ["#d9643a", "#f4a63a", "#c4553f", "#e9b13c"], ["#ffffff"]];

export class Vegetation {
  /** o = { W, H, at, skip(x,z) → no grass here, chop: [[x,z]], rocks: [[x,z]], seed } */
  constructor(scene, o) {
    this.scene = scene; this.o = o;
    let seed = o.seed || 21; const rnd = this.rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), e = new THREE.Euler();
    const up = (mesh, shadow = false) => { mesh.castShadow = shadow; mesh.receiveShadow = true; scene.add(mesh); return mesh; };

    // ---------------- grass blades
    const blade = new THREE.BufferGeometry();
    blade.setAttribute("position", new THREE.Float32BufferAttribute([-0.035, 0, 0, 0.035, 0, 0, -0.022, 0.14, 0.012, 0.022, 0.14, 0.012, 0, 0.3, 0.035], 3));
    blade.setAttribute("normal", new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
    blade.setAttribute("color", new THREE.Float32BufferAttribute([0.55, 0.62, 0.5, 0.55, 0.62, 0.5, 0.85, 0.9, 0.8, 0.85, 0.9, 0.8, 1.15, 1.15, 1.05], 3));
    blade.setIndex([0, 1, 2, 1, 3, 2, 2, 3, 4, 0, 2, 1, 1, 2, 3, 2, 4, 3]); // both windings, FrontSide: every face keeps its up-facing normal (DoubleSide would flip back faces dark)
    const spots = [];
    for (let z = 0; z < o.H; z++) for (let x = 0; x < o.W; x++) {
      const c = o.at(x, z); if (c !== "." || o.skip(x, z)) continue;
      const n = o.dense && o.dense(x, z) ? 6 : 4;
      for (let i = 0; i < n; i++) spots.push([x + rnd(), z + rnd(), 0.65 + rnd() * 0.75]);
    }
    this.grassMat = windify(new THREE.MeshLambertMaterial({ color: GRASS[0], vertexColors: true }), 0.3, 0.07);
    const grass = this.grass = up(new THREE.InstancedMesh(blade, this.grassMat, spots.length));
    const col = new THREE.Color();
    spots.forEach(([x, z, sc], i) => {
      q.setFromEuler(e.set((rnd() - 0.5) * 0.35, rnd() * Math.PI * 2, (rnd() - 0.5) * 0.35));
      m4.compose(p.set(x, 0, z), q, s.set(sc, sc * (0.8 + rnd() * 0.5), sc)); grass.setMatrixAt(i, m4);
      grass.setColorAt(i, col.setHSL(0, 0, 0.82 + rnd() * 0.3));
    });
    grass.frustumCulled = false; // covers the whole map; culling would test one huge sphere anyway

    // ---------------- flowers (stem + head share one matrix)
    const fspots = [];
    for (let z = 0; z < o.H; z++) for (let x = 0; x < o.W; x++) if (o.at(x, z) === "." && !o.skip(x, z) && rnd() < 0.07) {
      const n = 2 + Math.floor(rnd() * 3); for (let i = 0; i < n; i++) fspots.push([x + 0.15 + rnd() * 0.7, z + 0.15 + rnd() * 0.7, 0.8 + rnd() * 0.5, Math.floor(rnd() * 4)]);
    }
    const stemG = new THREE.BoxGeometry(0.014, 0.22, 0.014).translate(0, 0.11, 0);
    const headG = new THREE.OctahedronGeometry(0.05, 0).translate(0, 0.24, 0);
    this.stemMat = windify(new THREE.MeshLambertMaterial({ color: "#4f9e49" }), 0.24, 0.05);
    this.headMat = windify(new THREE.MeshLambertMaterial({ color: "#ffffff" }), 0.24, 0.05);
    this.stems = up(new THREE.InstancedMesh(stemG, this.stemMat, fspots.length));
    this.heads = up(new THREE.InstancedMesh(headG, this.headMat, fspots.length));
    this.fspots = fspots;
    fspots.forEach(([x, z, sc], i) => { q.setFromEuler(e.set((rnd() - 0.5) * 0.3, rnd() * 6, (rnd() - 0.5) * 0.3)); m4.compose(p.set(x, 0, z), q, s.set(sc, sc, sc)); this.stems.setMatrixAt(i, m4); this.heads.setMatrixAt(i, m4); });
    this.stems.frustumCulled = this.heads.frustumCulled = false;

    // ---------------- trees: round (trunk + two-blob canopy) and pine (trunk + three cones)
    const trunkG = new THREE.CylinderGeometry(0.09, 0.14, 0.75, 6).translate(0, 0.375, 0);
    const roundG = mergeGeometries([new THREE.IcosahedronGeometry(0.52, 0).translate(-0.05, 0.98, 0.05), new THREE.IcosahedronGeometry(0.4, 0).translate(0.2, 1.42, -0.1)]);
    const pineG = mergeGeometries([new THREE.ConeGeometry(0.62, 0.8, 7).translate(0, 0.95, 0), new THREE.ConeGeometry(0.48, 0.7, 7).translate(0, 1.4, 0), new THREE.ConeGeometry(0.32, 0.6, 7).translate(0, 1.82, 0)]);
    const trees = []; // {x, z, sc, kind: 0 round | 1 pine, tone, chopKey}
    const inWoods = (x, z) => o.woods && o.woods(x, z);
    for (let z = 0; z < o.H; z++) for (let x = 0; x < o.W; x++) {
      const c = o.at(x, z); if (c !== "T" && c !== "t") continue;
      const pine = inWoods(x, z) ? rnd() < 0.6 : rnd() < 0.12;
      trees.push({ x: x + 0.5 + (rnd() - 0.5) * 0.3, z: z + 0.5 + (rnd() - 0.5) * 0.3, sc: (c === "t" ? 0.85 : 0.8) + rnd() * 0.5, kind: pine ? 1 : 0, tone: rnd() < 0.15 ? 2 : rnd() < 0.5 ? 1 : 0, chop: c === "t" ? x + "," + z : null, rot: rnd() * 6 });
    }
    for (let i = 0; i < 260; i++) { // forest ring outside the map
      const a = rnd() * Math.PI * 2, r = 1 + rnd() * 0.5;
      const x = o.W / 2 + Math.cos(a) * (o.W / 2 + 2 + rnd() * 16) * r * 0.8, z = o.H / 2 + Math.sin(a) * (o.H / 2 + 2 + rnd() * 16) * r * 0.8;
      if (x > -1 && x < o.W + 1 && z > -1 && z < o.H + 1) continue;
      trees.push({ x, z, sc: 1 + rnd() * 0.9, kind: rnd() < 0.4 ? 1 : 0, tone: rnd() < 0.5 ? 1 : 0, chop: null, rot: rnd() * 6 });
    }
    this.trees = trees;
    this.trunkMat = new THREE.MeshLambertMaterial({ color: "#7a5236" });
    this.canopyMat = windify(new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true }), 2.0, 0.06);
    this.pineMat = windify(new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true }), 2.1, 0.05);
    const nR = trees.filter((t) => t.kind === 0).length, nP = trees.length - nR;
    this.trunks = up(new THREE.InstancedMesh(trunkG, this.trunkMat, trees.length), true);
    this.rounds = up(new THREE.InstancedMesh(roundG, this.canopyMat, nR), true);
    this.pines = up(new THREE.InstancedMesh(pineG, this.pineMat, nP), true);
    let iR = 0, iP = 0;
    trees.forEach((t, i) => { t.i = i; t.j = t.kind ? iP++ : iR++; });
    this.byChop = new Map(trees.filter((t) => t.chop).map((t) => [t.chop, t]));
    for (const t of trees) this.placeTree(t, 0);
    this.trunks.computeBoundingSphere(); this.rounds.computeBoundingSphere(); this.pines.computeBoundingSphere();

    // ---------------- stumps & boulders
    const chops = o.chop || [], rocks = o.rocks || [];
    this.stumps = up(new THREE.InstancedMesh(new THREE.CylinderGeometry(0.17, 0.21, 0.22, 7).translate(0, 0.11, 0), new THREE.MeshLambertMaterial({ color: "#8a6040" }), Math.max(1, chops.length)));
    this.stumpIdx = new Map(); chops.forEach(([x, z], i) => { this.stumpIdx.set(x + "," + z, i); this.stumps.setMatrixAt(i, m4.makeScale(0, 0, 0)); });
    this.rockMeshes = up(new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.42, 0), new THREE.MeshLambertMaterial({ color: "#ffffff", flatShading: true }), Math.max(1, rocks.length)), true);
    this.rocks = new Map();
    rocks.forEach(([x, z], i) => {
      const r = { i, x: x + 0.5 + (rnd() - 0.5) * 0.15, z: z + 0.5 + (rnd() - 0.5) * 0.15, rot: [rnd() * 3, rnd() * 3, rnd() * 3], sc: [0.95 + rnd() * 0.3, 0.6 + rnd() * 0.25, 0.9 + rnd() * 0.3] };
      this.rocks.set(x + "," + z, r); this.placeRock(r, true);
      this.rockMeshes.setColorAt(i, col.setHSL(0.7, 0.08, 0.55 + rnd() * 0.12));
    });
    this.stumps.frustumCulled = this.rockMeshes.frustumCulled = false;

    // ---------------- fences
    const posts = [], rails = [];
    const isF = (x, z) => o.at(x, z) === "f";
    for (let z = 0; z < o.H; z++) for (let x = 0; x < o.W; x++) {
      const c = o.at(x, z);
      if (c === "f") { posts.push([x + 0.5, z + 0.5, 1]); for (const [dx, dz] of [[1, 0], [0, 1]]) if (isF(x + dx, z + dz)) rails.push([x + 0.5 + dx / 2, z + 0.5 + dz / 2, dx]); }
      if (c === "g") { const ns = isF(x, z - 1); posts.push([x + 0.5 + (ns ? 0 : -0.45), z + 0.5 + (ns ? -0.45 : 0), 1.5], [x + 0.5 + (ns ? 0 : 0.45), z + 0.5 + (ns ? 0.45 : 0), 1.5]); }
    }
    const fenceMat = new THREE.MeshLambertMaterial({ color: "#f6efe2" });
    this.posts = up(new THREE.InstancedMesh(new THREE.BoxGeometry(0.13, 0.75, 0.13).translate(0, 0.375, 0), fenceMat, posts.length), true);
    posts.forEach(([x, z, h], i) => this.posts.setMatrixAt(i, m4.compose(p.set(x, 0, z), q.identity(), s.set(1, h, 1))));
    this.rails = up(new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 1), fenceMat, rails.length * 2), true);
    rails.forEach(([x, z, dx], i) => { for (let k = 0; k < 2; k++) this.rails.setMatrixAt(i * 2 + k, m4.compose(p.set(x, k ? 0.55 : 0.28, z), q.identity(), s.set(dx ? 1 : 0.06, 1, dx ? 0.06 : 1))); });
    this.posts.frustumCulled = this.rails.frustumCulled = false;

    this.shakes = [];
    this.setSeason(0);
  }

  placeTree(t, wob) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(wob, t.rot, wob * 0.5)), p = new THREE.Vector3(t.x, 0, t.z);
    const sc = t.gone ? 0 : t.sc, s = new THREE.Vector3(sc, sc, sc);
    m4.compose(p, q, s); this.trunks.setMatrixAt(t.i, m4); (t.kind ? this.pines : this.rounds).setMatrixAt(t.j, m4);
    this.trunks.instanceMatrix.needsUpdate = true; (t.kind ? this.pines : this.rounds).instanceMatrix.needsUpdate = true;
  }
  placeRock(r, show) {
    const m4 = new THREE.Matrix4().compose(new THREE.Vector3(r.x, 0.2, r.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(...r.rot)), show ? new THREE.Vector3(...r.sc) : new THREE.Vector3(0, 0, 0));
    this.rockMeshes.setMatrixAt(r.i, m4); this.rockMeshes.instanceMatrix.needsUpdate = true;
  }
  /** Chopped (true) or regrown (false). */
  setChopped(k, chopped) {
    const t = this.byChop.get(k); if (!t) return;
    t.gone = chopped; this.placeTree(t, 0);
    const i = this.stumpIdx.get(k); if (i == null) return;
    const [x, z] = k.split(",").map(Number);
    this.stumps.setMatrixAt(i, chopped ? new THREE.Matrix4().compose(new THREE.Vector3(t.x, 0, t.z), new THREE.Quaternion(), new THREE.Vector3(t.sc, t.sc, t.sc)) : new THREE.Matrix4().makeScale(0, 0, 0));
    this.stumps.instanceMatrix.needsUpdate = true; void x; void z;
  }
  setBroken(k, broken) { const r = this.rocks.get(k); if (r) this.placeRock(r, !broken); }
  hasTree(k) { const t = this.byChop.get(k); return t && !t.gone; }
  treePos(k) { const t = this.byChop.get(k); return t ? [t.x, t.z, t.sc] : null; }
  /** Wobble a choppable tree or a boulder for a moment. */
  hit(k) { const t = this.byChop.get(k); if (t && !t.gone) this.shakes.push({ t, k: 0 }); const r = this.rocks.get(k); if (r) this.shakes.push({ r, k: 0 }); }

  setSeason(si) {
    const col = new THREE.Color(), [tones, pine] = LEAF[si];
    for (const t of this.trees) {
      if (t.kind) this.pines.setColorAt(t.j, col.set(pine).multiplyScalar(0.92 + (t.tone * 0.07)));
      else this.rounds.setColorAt(t.j, col.set(tones[t.tone]));
    }
    this.rounds.instanceColor.needsUpdate = this.pines.instanceColor.needsUpdate = true;
    this.grassMat.color.set(GRASS[si]);
    const snowy = si === 3;
    this.grass.visible = this.stems.visible = this.heads.visible = !snowy;
    const pal = FLOWERS[si];
    this.fspots.forEach((f, i) => this.heads.setColorAt(i, col.set(pal[f[3] % pal.length])));
    if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    this.stemMat.color.set(si === 2 ? "#8a8f3a" : "#4f9e49");
  }

  update(dt, t) {
    wind.uTime.value = t;
    for (let i = this.shakes.length - 1; i >= 0; i--) {
      const s = this.shakes[i]; s.k += dt / 0.38;
      const w = Math.sin(s.k * 26) * 0.09 * (1 - Math.min(1, s.k));
      if (s.t) this.placeTree(s.t, s.k >= 1 ? 0 : w);
      if (s.r) { const r = s.r, o = r.x; r.x = o + w * 0.5; this.placeRock(r, true); r.x = o; if (s.k >= 1) this.placeRock(r, true); }
      if (s.k >= 1) this.shakes.splice(i, 1);
    }
  }
}

// Frontier Crown — the View: reads the simulation (never writes it) and draws it with
// instanced meshes, vertex-shader animation, LOD, fog of war and particles.

import * as THREE from "three";
import { DEF_LIST, DEFS, TEAM_COLORS, C } from "../data/defs.js";
import { CM, S, MAX } from "../sim/ecs.js";
import { W, H, WATER_Y } from "../sim/map.js";
import { lerp, lerpAngle } from "../core/core.js";
import { createModels } from "./models.js";
import { createInstancing } from "./instancing.js";
import { createFx } from "./fx.js";
import { RTSCamera } from "./camera.js";
import { buildWater, buildSky, FogTexture } from "./terrain.js";
import { buildTerrainGeometry, buildTintTexture, buildMinimapImage } from "../terrain/terrain-mesh.js";
import { createGroundTextures, createTerrainMaterial } from "../terrain/splat-material.js";
import { TerrainPicker } from "../terrain/picker.js";
import { BuildGrid } from "../terrain/build-grid.js";

let groundTex = null; // generated once per page

const UNIT_H = { villager: 1.3, musketeer: 1.4, pikeman: 1.4, hussar: 2.15, falconet: 1.25, deer: 1.3 };
const BLD_H = { towncenter: 5.4, house: 2.3, mill: 3.4, barracks: 2.7, stable: 2.8, foundry: 4.1, outpost: 4.3 };
const GAIT = { villager: 5.2, musketeer: 5.0, pikeman: 5.0, hussar: 2.6, falconet: 3.0, deer: 4.5 };
const LOD_DIST = 46;

export class View {
  constructor(renderer, sim, { me = 0, quality = "high" } = {}) {
    this.r = renderer; this.sim = sim; this.me = me; this.quality = quality;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe0ea);
    scene.fog = new THREE.Fog(0xcfe0ea, 90, 210);
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 600);
    this.cam = new RTSCamera(THREE, this.camera, (x, z) => sim.grid.heightAt(x, z));
    const tc = sim.players[me].tc;
    if (tc >= 0) this.cam.focus(sim.st.x[tc] + 4, sim.st.z[tc] + 2);

    // lights
    this.hemi = new THREE.HemisphereLight(0xdbe8ff, 0x5d4c34, 1.25); scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight(0xfff0d6, 2.5);
    sun.castShadow = quality !== "low";
    sun.shadow.mapSize.set(quality === "high" ? 2048 : 1024, quality === "high" ? 2048 : 1024);
    const sc = sun.shadow.camera; sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 160;
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
    scene.add(sun); scene.add(sun.target);
    // environment for water reflections
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene(); envScene.add(buildSky(THREE));
    this.env = pm.fromScene(envScene, 0.04).texture; pm.dispose();
    scene.environment = this.env; scene.environmentIntensity = 0.35;
    scene.add(buildSky(THREE));

    // fog of war + instancing helpers
    this.fog = new FogTexture(THREE);
    const inst = this.inst = createInstancing(THREE, { fogTex: this.fog.tex, mapSize: W });
    const mk = (anim) => inst.patch(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.02 }), { anim });
    this.matUnit = mk(true); this.matStatic = mk(false);

    // terrain: heightmap PlaneGeometry + splat shader + build grid + exact picker
    if (!groundTex) groundTex = createGroundTextures(THREE);
    this.buildGrid = new BuildGrid(THREE, sim.grid, me);
    this.tint = buildTintTexture(THREE, sim.grid, sim.seed);
    const tm = createTerrainMaterial(THREE, { textures: groundTex, tint: this.tint, fogTex: this.fog.tex, buildTex: this.buildGrid.tex, mapSize: W, triplanar: quality !== "low" });
    this.terrainUniforms = tm.uniforms;
    this.terrain = new THREE.Mesh(buildTerrainGeometry(THREE, sim.grid), tm.material);
    this.terrain.receiveShadow = true; this.terrain.castShadow = quality === "high"; scene.add(this.terrain);
    this.miniImage = buildMinimapImage(sim.grid);
    this.picker = new TerrainPicker(sim.grid);
    this.cam.picker = this.picker;
    this.gridState = null;
    const wt = buildWater(THREE); inst.patch(wt.mat);
    this.water = new THREE.Mesh(wt.geo, wt.mat); this.water.renderOrder = 1; scene.add(this.water);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x0f140c }));
    outer.position.set(W / 2, -1.6, H / 2); scene.add(outer);

    // models + pools
    const M = this.models = createModels(THREE);
    const pool = (geo, cap, o) => { const p = new inst.InstancePool(geo, o.anim ? this.matUnit : this.matStatic, cap, o); scene.add(p.mesh); return p; };
    this.unitPools = {};
    for (const k of ["villager", "musketeer", "pikeman", "hussar", "falconet"]) {
      this.unitPools[k] = [pool(M.units[k](0), 420, { anim: true, name: k }), pool(M.units[k](1), 420, { anim: true, shadow: false, name: k + "-lod" })];
    }
    this.deerPool = pool(M.units.deer(), 160, { anim: true, name: "deer" });
    this.bldPools = {};
    for (const k of Object.keys(M.buildings)) this.bldPools[k] = pool(M.buildings[k](), k === "house" ? 80 : 40, { name: k });
    this.scaffold = {}; this.rubblePool = {};
    for (const sz of [2, 3, 4, 5]) { this.scaffold[sz] = pool(M.scaffold(sz), 30, { name: "scaffold" }); this.rubblePool[sz] = pool(M.rubble(sz), 30, { shadow: false, name: "rubble" }); }
    this.blades = pool(M.millBlades(), 20, { name: "blades" });
    this.treePools = [pool(M.resources.pine(), 2600, { name: "pine" }), pool(M.resources.oak(), 2600, { name: "oak" })];
    this.stumpPool = pool(M.resources.stump(), 2000, { shadow: false, name: "stump" });
    this.bushPool = pool(M.resources.bush(), 120, { name: "bush" });
    this.minePool = pool(M.resources.goldmine(), 30, { name: "mine" });
    // overlays
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, depthWrite: false });
    inst.patch(ringMat, { fog: false });
    const ringGeo = new THREE.RingGeometry(0.82, 1, 32).rotateX(-Math.PI / 2);
    ringGeo.setAttribute("aTeam", new THREE.Float32BufferAttribute(new Float32Array(ringGeo.attributes.position.count).fill(1), 1));
    this.rings = new inst.InstancePool(ringGeo, ringMat, 400, { shadow: false, receive: false }); this.rings.mesh.renderOrder = 2; scene.add(this.rings.mesh);
    const barMat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false, transparent: true });
    inst.patch(barMat, { fog: false });
    const barGeo = new THREE.PlaneGeometry(1, 1);
    barGeo.setAttribute("aTeam", new THREE.Float32BufferAttribute(new Float32Array(4).fill(1), 1));
    this.bars = new inst.InstancePool(barGeo, barMat, 900, { shadow: false, receive: false }); this.bars.mesh.renderOrder = 5; scene.add(this.bars.mesh);
    const ballGeo = new THREE.IcosahedronGeometry(0.11, 0);
    ballGeo.setAttribute("aTeam", new THREE.Float32BufferAttribute(new Float32Array(ballGeo.attributes.position.count).fill(1), 1));
    this.balls = new inst.InstancePool(ballGeo, new THREE.MeshBasicMaterial({ color: 0x222222 }), 80, { shadow: false }); scene.add(this.balls.mesh);
    // rally flag + placement ghost
    this.rallyMesh = new THREE.Group();
    const fm = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[me], flatShading: true });
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 5), new THREE.MeshStandardMaterial({ color: 0x4a3020 })); pole.position.y = 0.7;
    const cloth = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.03), fm); cloth.position.set(0.27, 1.22, 0);
    this.rallyMesh.add(pole, cloth); this.rallyMesh.visible = false; scene.add(this.rallyMesh);
    this.ghost = null; this.ghostDef = null;
    this.fx = createFx(THREE, { fogUniform: inst.shared.uFog, mapSize: W });
    for (const o of this.fx.objects) scene.add(o);

    // per-entity view state
    this.phase = new Float32Array(MAX); this.mv = new Float32Array(MAX);
    this.known = new Uint8Array(MAX); this.knownGen = new Uint16Array(MAX);
    this.corpses = []; this.rubble = []; this.stumps = []; this.markers = []; this.burning = [];
    this.selection = new Set(); this.hover = -1;
    this.staticDirty = true; this.time = 0;
    this.frustum = new THREE.Frustum(); this.pm = new THREE.Matrix4(); this.sph = new THREE.Sphere();
    this.tm = new THREE.Matrix4(); this.tq = new THREE.Quaternion(); this.te = new THREE.Euler(0, 0, 0, "YXZ"); this.tv = new THREE.Vector3(); this.ts = new THREE.Vector3();
    this.teamRGB = TEAM_COLORS.map((c) => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; });
    this.stats = { calls: 0, tris: 0 };
    this.resize();
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.fx.setScale(h * 0.75);
  }

  // ------------------------------------------------------------------ events from the sim
  onEvents(list) {
    const st = this.sim.st, fx = this.fx, g = this.sim.grid;
    for (const ev of list) {
      switch (ev.type) {
        case "shot": {
          if (!this.seen(ev.x, ev.z) && !this.seen(ev.tx, ev.tz)) break;
          const dx = ev.tx - ev.x, dz = ev.tz - ev.z, L = Math.hypot(dx, dz) || 1;
          const y = g.heightAt(ev.x, ev.z);
          if (ev.kind === "ranged" || ev.kind === "hunt") {
            const shooterIsBld = ev.e >= 0 && st.alive[ev.e] && (st.mask[ev.e] & CM.BUILDING);
            fx.musket(ev.x + (shooterIsBld ? dx / L * 1.5 : 0), y + (shooterIsBld ? 2.6 : 1.05), ev.z + (shooterIsBld ? dz / L * 1.5 : 0), dx / L, dz / L);
            fx.impact(ev.tx, g.heightAt(ev.tx, ev.tz) + 0.5, ev.tz);
          } else if (ev.kind === "cannon") {
            fx.cannon(ev.x, y + 0.6, ev.z, dx / L, dz / L);
            if (this.dist2(ev.x, ev.z) < 900) this.cam.shake = Math.min(1, this.cam.shake + 0.25);
          } else if (ev.kind === "melee" && Math.random() < 0.6) fx.clash(ev.tx - dx / L * 0.3, g.heightAt(ev.tx, ev.tz) + 0.9, ev.tz - dz / L * 0.3);
          break;
        }
        case "explode": if (this.seen(ev.x, ev.z)) { fx.explode(ev.x, g.heightAt(ev.x, ev.z), ev.z); if (this.dist2(ev.x, ev.z) < 900) this.cam.shake = Math.min(1.2, this.cam.shake + 0.35); } break;
        case "died": {
          const d = DEF_LIST[ev.def];
          this.selection.delete(ev.e);
          if (!this.seen(ev.x, ev.z) && ev.owner !== this.me) break;
          if (ev.building) {
            this.rubble.push({ size: d.size, x: ev.x, z: ev.z, t: 0 });
            fx.dust(ev.x, g.heightAt(ev.x, ev.z), ev.z, d.size * 0.6, 26); fx.explode(ev.x, g.heightAt(ev.x, ev.z) + 0.5, ev.z);
          } else this.corpses.push({ def: d.id, x: ev.x, z: ev.z, rot: ev.rot, owner: ev.owner, t: 0, side: ev.e % 2 ? 1 : -1 });
          break;
        }
        case "depleted": {
          const d = DEF_LIST[ev.def];
          if (d.id === "tree") this.stumps.push({ x: ev.x, z: ev.z, r: (ev.x * 13.1 + ev.z * 7.7) % 6.28 });
          if (d.id === "goldmine") this.rubble.push({ size: 3, x: ev.x, z: ev.z, t: 0, keep: true });
          this.staticDirty = true;
          break;
        }
        case "built": if (this.seen(st.x[ev.e], st.z[ev.e])) fx.dust(st.x[ev.e], g.heightAt(st.x[ev.e], st.z[ev.e]), st.z[ev.e], DEF_LIST[st.def[ev.e]].size * 0.5, 16); break;
        case "placed": break;
        case "work":
          if (this.dist2(ev.x, ev.z) < 1600 && this.seen(ev.x, ev.z)) {
            const y = g.heightAt(ev.tx, ev.tz) + 0.6;
            if (ev.gt === "wood") fx.chips(lerp(ev.x, ev.tx, 0.6), y, lerp(ev.z, ev.tz, 0.6), [0.78, 0.62, 0.4]);
            else if (ev.gt === "coin") fx.chips(lerp(ev.x, ev.tx, 0.5), y, lerp(ev.z, ev.tz, 0.5), [0.95, 0.8, 0.3]);
          }
          break;
        case "age": if (ev.p === this.me) { const tc = this.sim.players[ev.p].tc; if (tc >= 0) fx.sparkle(st.x[tc], g.heightAt(st.x[tc], st.z[tc]) + 3, st.z[tc], 1, 0.85, 0.4); } break;
        case "trained": if (st.owner[ev.e] === this.me) fx.dust(st.x[ev.e], g.heightAt(st.x[ev.e], st.z[ev.e]), st.z[ev.e], 0.3, 3); break;
        case "spawn": if (st.mask[ev.e] & CM.RESOURCE) this.staticDirty = true; break;
      }
    }
  }
  // Lowest corner height under a footprint centred on (x,z): buildings sit on it and never float.
  footY(x, z, size) {
    const g = this.sim.grid, S = W + 1, i0 = Math.round(x - size / 2), j0 = Math.round(z - size / 2);
    let lo = Infinity;
    for (let j = j0; j <= j0 + size; j++) for (let i = i0; i <= i0 + size; i++) { if (i < 0 || j < 0 || i > W || j > H) continue; const h = g.hv[j * S + i]; if (h < lo) lo = h; }
    return lo === Infinity ? g.heightAt(x, z) : lo;
  }
  seen(x, z) { const i = Math.floor(x), j = Math.floor(z); if (i < 0 || j < 0 || i >= W || j >= H) return false; return this.fog.reveal || this.sim.grid.vis[this.me][j * W + i] === 1; }
  dist2(x, z) { return (x - this.cam.tx) ** 2 + (z - this.cam.tz) ** 2; }

  addMarker(x, z, kind) { this.markers.push({ x, z, t: 0, kind }); }

  // ------------------------------------------------------------------ static resources
  rebuildStatics() {
    const st = this.sim.st, g = this.sim.grid;
    for (const p of this.treePools) p.begin();
    this.bushPool.begin(); this.minePool.begin(); this.stumpPool.begin();
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e] || !(st.mask[e] & CM.RESOURCE) || (st.mask[e] & CM.UNIT)) continue;
      const d = DEF_LIST[st.def[e]], x = st.x[e], z = st.z[e], y = g.heightAt(x, z);
      const h = ((x * 12.9898 + z * 78.233) * 43758.5453) % 1, hh = Math.abs(h);
      if (d.id === "tree") {
        const pool = this.treePools[hh < 0.62 ? 0 : 1];
        const s = 0.85 + hh * 0.45, tint = 0.82 + ((hh * 7.3) % 1) * 0.3;
        pool.push(x + (hh - 0.5) * 0.3, y, z + (((hh * 3.1) % 1) - 0.5) * 0.3, hh * 6.28, s, tint, tint * (0.95 + hh * 0.1), tint * 0.9);
      } else if (d.id === "berries") this.bushPool.push(x, y, z, hh * 6.28, 0.95 + hh * 0.2, 1, 1, 1);
      else if (d.id === "goldmine") this.minePool.push(x, y, z, hh * 6.28, 1, 1, 1, 1);
    }
    for (const s of this.stumps) this.stumpPool.push(s.x, g.heightAt(s.x, s.z), s.z, s.r, 1);
    for (const p of this.treePools) p.end();
    this.bushPool.end(); this.minePool.end(); this.stumpPool.end();
    this.staticDirty = false;
  }

  // ------------------------------------------------------------------ placement ghost
  setGhost(defId, i, j, ok) {
    if (!defId) { if (this.ghost) this.ghost.visible = false; return; }
    if (this.ghostDef !== defId) {
      if (this.ghost) { this.scene.remove(this.ghost); this.ghost.geometry.dispose(); }
      const geo = this.models.buildings[defId]();
      this.ghostMat = this.ghostMat || new THREE.MeshBasicMaterial({ color: 0x7cff9a, transparent: true, opacity: 0.45, depthWrite: false });
      this.ghost = new THREE.Mesh(geo, this.ghostMat); this.ghost.renderOrder = 3; this.scene.add(this.ghost); this.ghostDef = defId;
    }
    const d = DEFS[defId], x = i + d.size / 2, z = j + d.size / 2;
    this.ghost.visible = true;
    this.ghost.position.set(x, this.footY(x, z, d.size), z);
    this.ghostMat.color.set(ok ? 0x7cff9a : 0xff5a48);
  }

  // ------------------------------------------------------------------ frame
  render(alpha, dt) {
    const sim = this.sim, st = sim.st, g = sim.grid, me = this.me;
    this.time += dt;
    this.inst.shared.uTime.value = this.time;
    this.cam.update(dt);
    this.fog.update(g, me, dt);
    if (this.gridState || this.buildGrid.alpha > 0) { this.buildGrid.reveal = this.fog.reveal; this.buildGrid.update(sim.fogVersion); }
    this.buildGrid.apply(this.terrainUniforms, dt, this.gridState);
    if (this.staticDirty) this.rebuildStatics();
    // shadow camera follows the view focus (snapped to texels)
    const snap = 84 / this.sun.shadow.mapSize.x;
    const fx0 = Math.round(this.cam.tx / snap) * snap, fz0 = Math.round(this.cam.tz / snap) * snap;
    this.sun.position.set(fx0 - 34, 62, fz0 + 26); this.sun.target.position.set(fx0, 0, fz0 - 6); this.sun.target.updateMatrixWorld();
    this.pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm);
    const camPos = this.camera.position, vis = g.vis[me], reveal = this.fog.reveal;
    const tile = (x, z) => { const i = Math.floor(x), j = Math.floor(z); return i >= 0 && j >= 0 && i < W && j < H ? j * W + i : 0; };

    for (const k in this.unitPools) { this.unitPools[k][0].begin(); this.unitPools[k][1].begin(); }
    this.deerPool.begin();
    for (const k in this.bldPools) this.bldPools[k].begin();
    for (const k in this.scaffold) { this.scaffold[k].begin(); this.rubblePool[k].begin(); }
    this.blades.begin(); this.rings.begin(); this.bars.begin(); this.balls.begin();
    const barQ = this.camera.quaternion;
    const hpBars = [];

    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e]) continue;
      const m = st.mask[e];
      if (!(m & (CM.UNIT | CM.BUILDING))) continue;
      const d = DEF_LIST[st.def[e]], o = st.owner[e];
      if (m & CM.UNIT) {
        const x = lerp(st.px[e], st.x[e], alpha), z = lerp(st.pz[e], st.z[e], alpha);
        if (o !== me && !reveal && !vis[tile(x, z)]) continue;
        let y = g.heightAt(x, z);
        this.sph.set(this.tv.set(x, y + 0.7, z), 1.6);
        if (!this.frustum.intersectsSphere(this.sph)) continue;
        const rot = lerpAngle(st.prot[e], st.rot[e], alpha);
        const spd = Math.hypot(st.vx[e], st.vz[e]);
        this.phase[e] += dt * spd * (GAIT[d.id] || 5);
        this.mv[e] += (Math.min(1, spd / Math.max(0.5, d.speed)) - this.mv[e]) * Math.min(1, dt * 8);
        const tint = st.hitT[e] < 0.12 ? 1.6 : 1;
        if (d.id === "deer") {
          if (st.dead[e]) {
            this.te.set(0, rot, Math.PI / 2); this.tq.setFromEuler(this.te); this.tm.compose(this.tv.set(x, y + 0.13, z), this.tq, this.ts.set(1, 1, 1));
            this.deerPool.pushMatrix(this.tm, 0.85, 0.75, 0.7);
          } else { const k = this.deerPool.push(x, y, z, rot, 1); this.deerPool.setAnim(k, this.phase[e], this.mv[e], 0); }
          if (this.selection.has(e)) this.ring(x, y, z, d.radius * 2.2, 2);
          continue;
        }
        const far = camPos.distanceTo(this.tv.set(x, y, z)) > LOD_DIST;
        const pool = this.unitPools[d.id][far ? 1 : 0];
        const tc = this.teamRGB[o];
        const k = pool.push(x, y, z, rot, 1, tc[0] * tint, tc[1] * tint, tc[2] * tint);
        let act = st.act[e];
        const s = st.state[e];
        if ((s === S.GATHER || s === S.BUILD) && !st.moving[e] && st.act[e] > 0) act = Math.abs(Math.sin(this.time * (s === S.BUILD ? 7 : 5.5) + e));
        pool.setAnim(k, this.phase[e], this.mv[e], act);
        if (this.selection.has(e) || this.hover === e) this.ring(x, y, z, d.radius * 1.55 + 0.12, o === me ? 0 : 1, this.hover === e && !this.selection.has(e));
        if (this.selection.has(e) || (st.hp[e] < st.maxHp[e] && st.hitT[e] < 6)) hpBars.push([x, y + UNIT_H[d.id], z, st.hp[e] / st.maxHp[e], 0.9, o]);
        continue;
      }
      // buildings
      const x = st.x[e], z = st.z[e], y = this.footY(x, z, d.size);
      if (o !== me && !reveal) {
        if (vis[tile(x, z)]) { this.known[e] = 1; this.knownGen[e] = st.gen[e]; }
        else if (!(this.known[e] && this.knownGen[e] === st.gen[e])) continue;
      }
      this.sph.set(this.tv.set(x, y + 1.5, z), d.size * 0.9 + 1.5);
      if (!this.frustum.intersectsSphere(this.sph)) continue;
      const tc = this.teamRGB[o], prog = st.prog[e];
      const sy = prog < 1 ? Math.max(0.04, Math.pow(prog, 0.8)) : 1;
      const tint = st.hitT[e] < 0.12 ? 1.4 : 1;
      this.bldPools[d.id].push(x, y, z, 0, 1, tc[0] * tint, tc[1] * tint, tc[2] * tint, sy);
      if (prog < 1) this.scaffold[d.size].push(x, y, z, 0, 1);
      if (d.id === "mill" && prog >= 1) {
        this.te.set(0, 0, this.time * 1.1 + e); this.tq.setFromEuler(this.te);
        this.tm.compose(this.tv.set(x, y + 2.05, z + 0.82), this.tq, this.ts.set(1, 1, 1)); this.blades.pushMatrix(this.tm);
      }
      if (prog >= 1 && Math.random() < dt * 1.6) {
        if (d.id === "towncenter") this.fx.chimney(x - 0.9, y + 3.6, z - 0.6);
        else if (d.id === "foundry") this.fx.chimney(x + 1.3, y + 3.9, z - 1.1);
        else if (d.id === "house" && Math.random() < 0.4) this.fx.chimney(x + 0.5, y + 2.0, z - 0.3);
      }
      const hr = st.hp[e] / st.maxHp[e];
      if (prog >= 1 && hr < 0.5 && Math.random() < dt * 8 * (1 - hr)) this.fx.fire(x + (Math.random() - 0.5) * d.size * 0.6, y + BLD_H[d.id] * 0.5, z + (Math.random() - 0.5) * d.size * 0.6);
      if (this.selection.has(e) || this.hover === e) this.ring(x, y, z, d.size * 0.78, o === me ? 0 : 1, this.hover === e && !this.selection.has(e));
      if (this.selection.has(e) || st.hitT[e] < 6 || prog < 1) hpBars.push([x, y + BLD_H[d.id] * (prog < 1 ? Math.max(0.35, prog) : 1) + 0.4, z, prog < 1 ? prog : hr, Math.min(3.2, d.size * 0.7), o, prog < 1]);
    }
    // selected resources
    for (const e of this.selection) {
      if (!st.alive[e] || !(st.mask[e] & CM.RESOURCE) || (st.mask[e] & CM.UNIT)) continue;
      const d = DEF_LIST[st.def[e]]; this.ring(st.x[e], g.heightAt(st.x[e], st.z[e]), st.z[e], d.size * 0.75, 2);
    }
    if (this.hover >= 0 && st.alive[this.hover] && (st.mask[this.hover] & CM.RESOURCE) && !(st.mask[this.hover] & CM.UNIT)) {
      const d = DEF_LIST[st.def[this.hover]]; this.ring(st.x[this.hover], g.heightAt(st.x[this.hover], st.z[this.hover]), st.z[this.hover], d.size * 0.72, 2, true);
    }
    // corpses
    for (let i = this.corpses.length - 1; i >= 0; i--) {
      const c = this.corpses[i]; c.t += dt;
      if (c.t > 14) { this.corpses.splice(i, 1); continue; }
      const fall = Math.min(1, c.t / 0.45), sink = c.t > 9 ? (c.t - 9) * 0.12 : 0;
      const y = g.heightAt(c.x, c.z) + 0.12 * fall - sink - (c.def === "hussar" ? 0 : 0);
      this.te.set(0, c.rot, c.side * Math.PI / 2 * fall * (c.def === "falconet" ? 0.25 : 1)); this.tq.setFromEuler(this.te);
      this.tm.compose(this.tv.set(c.x, y, c.z), this.tq, this.ts.set(1, 1, 1));
      if (c.def === "deer") continue;
      const tc = this.teamRGB[c.owner], dark = 0.75;
      this.unitPools[c.def][0].pushMatrix(this.tm, tc[0] * dark, tc[1] * dark, tc[2] * dark);
    }
    // rubble
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const r = this.rubble[i]; r.t += dt;
      if (!r.keep && r.t > 60) { this.rubble.splice(i, 1); continue; }
      const y = this.footY(r.x, r.z, r.size);
      this.rubblePool[r.size].push(r.x, y, r.z, r.x, 1);
      if (r.t < 8 && Math.random() < dt * 6) this.fx.fire(r.x + (Math.random() - 0.5) * r.size * 0.6, y + 0.3, r.z + (Math.random() - 0.5) * r.size * 0.6);
    }
    // cannonballs
    for (const p of sim.projectiles) {
      const t = Math.min(1, (p.t + alpha * 0.05) / p.T);
      const x = lerp(p.x, p.tx, t), z = lerp(p.z, p.tz, t);
      const y = lerp(g.heightAt(p.x, p.z) + 0.6, g.heightAt(p.tx, p.tz) + 0.2, t) + Math.sin(t * Math.PI) * (1 + p.T * 2);
      if (this.seen(x, z)) this.balls.push(x, y, z, 0, 1, 0.15, 0.15, 0.15);
    }
    // markers
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const mk = this.markers[i]; mk.t += dt;
      if (mk.t > 0.6) { this.markers.splice(i, 1); continue; }
      const s = 1.1 - mk.t * 1.2;
      const c = mk.kind === "attack" ? [1, 0.3, 0.25] : mk.kind === "gather" ? [1, 0.85, 0.35] : [0.5, 1, 0.6];
      this.rings.push(mk.x, g.heightAt(mk.x, mk.z) + 0.08, mk.z, 0, Math.max(0.15, s), c[0], c[1], c[2]);
    }
    // health bars (camera-facing)
    for (const [x, y, z, r, w, o, constr] of hpBars) {
      this.tm.compose(this.tv.set(x, y, z), barQ, this.ts.set(w + 0.06, 0.16, 1)); this.bars.pushMatrix(this.tm, 0.08, 0.06, 0.05);
      const fw = w * Math.max(0, r);
      this.tm.compose(this.tv.set(x - (w - fw) / 2, y, z), barQ, this.ts.set(Math.max(0.001, fw), 0.1, 1));
      const c = constr ? [0.95, 0.8, 0.3] : o === me ? (r > 0.5 ? [0.35, 0.9, 0.35] : r > 0.25 ? [0.95, 0.75, 0.2] : [0.95, 0.25, 0.2]) : [0.95, 0.3, 0.25];
      this.bars.pushMatrix(this.tm, c[0], c[1], c[2]);
    }
    // rally flag
    const sel = [...this.selection].filter((e) => st.alive[e] && st.owner[e] === me && (st.mask[e] & CM.PRODUCER));
    const rl = sel.length ? st.rally.get(sel[0]) : null;
    this.rallyMesh.visible = !!rl;
    if (rl) this.rallyMesh.position.set(rl.x, g.heightAt(rl.x, rl.z), rl.z);

    for (const k in this.unitPools) { this.unitPools[k][0].end(); this.unitPools[k][1].end(); }
    this.deerPool.end();
    for (const k in this.bldPools) this.bldPools[k].end();
    for (const k in this.scaffold) { this.scaffold[k].end(); this.rubblePool[k].end(); }
    this.blades.end(); this.rings.end(); this.bars.end(); this.balls.end();
    if (this.staticDirtyStumps) { this.rebuildStatics(); this.staticDirtyStumps = false; }
    this.fx.update(dt);
    this.r.render(this.scene, this.camera);
    this.stats.calls = this.r.info.render.calls; this.stats.tris = this.r.info.render.triangles;
  }

  ring(x, y, z, r, kind, faint = false) {
    const c = kind === 0 ? [0.55, 1, 0.65] : kind === 1 ? [1, 0.35, 0.3] : [1, 0.88, 0.4];
    const f = faint ? 0.55 : 1;
    this.rings.push(x, y + 0.06, z, 0, r, c[0] * f, c[1] * f, c[2] * f);
  }

  // ------------------------------------------------------------------ picking
  // Entity under a screen point: units (by projected distance), then footprints under the ground point.
  pick(sx, sy, w, h) {
    const st = this.sim.st, g = this.sim.grid, me = this.me;
    const gp = this.cam.ground(sx / w * 2 - 1, -(sy / h) * 2 + 1);
    if (!gp) return { e: -1, gp: null };
    let best = -1, bd = 26 * 26 * (30 / this.cam.dist);
    this.sim.hash.each(gp.x, gp.z, 3.5, (e) => {
      if (!st.alive[e]) return;
      const o = st.owner[e];
      if (o !== me && !this.seen(st.x[e], st.z[e])) return;
      const d = DEF_LIST[st.def[e]];
      const [px, py] = this.cam.project(st.x[e], g.heightAt(st.x[e], st.z[e]) + (UNIT_H[d.id] || 1.2) * 0.5, st.z[e], w, h);
      const dd = (px - sx) ** 2 + (py - sy) ** 2;
      if (dd < bd) { bd = dd; best = e; }
    });
    if (best >= 0) return { e: best, gp };
    const i = Math.floor(gp.x), j = Math.floor(gp.z);
    for (const [di, dj] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (i + di < 0 || j + dj < 0 || i + di >= W || j + dj >= H) continue;
      const e = g.occ[(j + dj) * W + i + di];
      if (e < 0 || !st.alive[e]) continue;
      if ((st.mask[e] & CM.BUILDING) && st.owner[e] !== me && !this.fog.reveal && !(this.known[e] && this.knownGen[e] === st.gen[e])) continue;
      if (!g.exp[me][(j + dj) * W + i + di] && !this.fog.reveal) continue;
      if (di === 0 && dj === 0) return { e, gp };
      if (st.mask[e] & CM.RESOURCE) return { e, gp };
    }
    return { e: -1, gp };
  }
  // Own units inside a screen rectangle.
  boxSelect(x0, y0, x1, y1, w, h) {
    const st = this.sim.st, g = this.sim.grid, out = [];
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e] || st.owner[e] !== this.me || !(st.mask[e] & CM.UNIT)) continue;
      const d = DEF_LIST[st.def[e]];
      const [px, py, pz] = this.cam.project(st.x[e], g.heightAt(st.x[e], st.z[e]) + (UNIT_H[d.id] || 1) * 0.5, st.z[e], w, h);
      if (pz < 1 && px >= x0 && px <= x1 && py >= y0 && py <= y1) out.push(e);
    }
    return out;
  }
  onScreen(e, w, h) {
    const st = this.sim.st, [px, py, pz] = this.cam.project(st.x[e], this.sim.grid.heightAt(st.x[e], st.z[e]), st.z[e], w, h);
    return pz < 1 && px >= 0 && px <= w && py >= 0 && py <= h;
  }

  dispose() {
    this.scene.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); }); } });
    this.env.dispose(); this.fog.tex.dispose(); this.buildGrid.tex.dispose(); this.tint.dispose();
  }
}

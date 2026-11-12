// Frontier Crown — the View: reads the simulation (never writes it) and draws it with
// instanced meshes, vertex-shader animation, LOD, fog of war and particles.

import * as THREE from "three";
import { DEF_LIST, DEFS, TEAM_COLORS, C, HARVEST_PULSE } from "../data/defs.js";
import { CM, S, MAX } from "../sim/ecs.js";
import { W, H, WATER_Y } from "../sim/map.js";
import { lerp, lerpAngle, TICK } from "../core/core.js";
import { createFloaters } from "./floaters.js";
import { createShipFx } from "./shipfx.js";
import { createPhysics } from "./physics.js";
import { ballisticAt } from "../sim/ballistics.js";
import { createModels } from "./models.js";
import { createInstancing } from "./instancing.js";
import { createFx } from "./fx.js";
import { RTSCameraController } from "./camera.js";
import { buildWater, buildSky } from "./terrain.js";
import { CanvasFog } from "./fog-canvas.js";
import { cleanerFor } from "../../scene-cleaner.js";
import { UnitActors } from "./unit-actors.js";
import { STATE } from "./unit-animator.js";
import { buildTerrainGeometry, buildTintTexture, buildMinimapImage } from "../terrain/terrain-mesh.js";
import { createGroundTextures, createTerrainMaterial } from "../terrain/splat-material.js";
import { TerrainPicker } from "../terrain/picker.js";
import { BuildGrid } from "../terrain/build-grid.js";
import { chooseClip, KIND_OF, CLIP, WORK_SYNC } from "./anim.js";
import { GT } from "../sim/systems/command.js";

let groundTex = null; // generated once per page

const UNIT_H = { villager: 1.3, musketeer: 1.4, pikeman: 1.4, grenadier: 1.5, skirmisher: 1.4, explorer: 1.45, bandit: 1.4, wolf: 0.95, hussar: 2.15, falconet: 1.25, deer: 1.3 };
const UNIT_TYPES = ["villager", "musketeer", "pikeman", "grenadier", "skirmisher", "explorer", "bandit", "wolf", "hussar", "falconet"];
// treasure aura colour by reward: food, wood, coin, XP, units
const AURA = [[1, 0.45, 0.3], [0.55, 0.95, 0.4], [1, 0.8, 0.28], [0.45, 0.72, 1], [0.95, 0.95, 0.95]];
const BLD_H = { towncenter: 5.4, house: 2.3, mill: 3.4, barracks: 2.7, stable: 2.8, foundry: 4.1, outpost: 4.3 };
const GAIT = { villager: 5.2, musketeer: 5.0, pikeman: 5.0, grenadier: 5.0, skirmisher: 5.1, explorer: 4.6, bandit: 5.0, wolf: 3.6, hussar: 2.6, falconet: 3.0, deer: 4.5 };
const LOD_DIST = 46;

export class View {
  constructor(renderer, sim, { me = 0, quality = "high", assets = null, actorBudget, input = null } = {}) {
    this.r = renderer; this.sim = sim; this.me = me; this.quality = quality;
    const scene = this.scene = new THREE.Scene();
    scene.background = new THREE.Color(0xcfe0ea);
    scene.fog = new THREE.Fog(0xcfe0ea, 90, 210);
    this.camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 0.5, 600);
    // classic RTS camera: inertial pan (keys / middle-drag / edge), pitch-on-zoom, map bounds
    this.cam = new RTSCameraController(THREE, this.camera, (x, z) => sim.grid.heightAt(x, z), W);
    if (input) this.cam.bindInput(input, renderer.domElement);
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
    this.cleaner = cleanerFor(renderer);
    const pm = new THREE.PMREMGenerator(renderer);
    const envScene = new THREE.Scene(); envScene.add(buildSky(THREE));
    this.envRT = pm.fromScene(envScene, 0.04); this.env = this.envRT.texture; pm.dispose();
    this.cleaner.disposeObject(envScene); // the capture scene's sky was uploaded once, only for the PMREM bake
    scene.environment = this.env; scene.environmentIntensity = 0.35;
    scene.add(buildSky(THREE));

    // fog of war + instancing helpers
    // fog of war: hidden canvases → CanvasTexture sampled by every material (render/fog-canvas.js)
    this.fog = new CanvasFog(THREE, sim, me, { W, H, res: quality === "high" ? 4 : quality === "low" ? 2 : 3 });
    const inst = this.inst = createInstancing(THREE, { fogTex: this.fog.tex, mapSize: W });
    const mk = (anim) => inst.patch(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.02 }), { anim });
    this.matUnit = mk(true); this.matStatic = mk(false);
    // buildings: same look plus the construction reveal (cut line, glowing band, hollow walls)
    this.matBld = inst.patch(new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.82, metalness: 0.02, side: THREE.DoubleSide }), { build: true });
    this.bldDepth = inst.buildDepth();
    this.matHolo = inst.holoMaterial({ color: 0x9fd8ff, instanced: true, opacity: 0.85 });
    // rigged glTF soldiers for the closest units (render/unit-actors.js); everything else stays instanced
    this.actors = new UnitActors(scene, assets || { has: () => false }, { patch: (m) => inst.patch(m), teamRGB: TEAM_COLORS.map((c) => { const k = new THREE.Color(c); return [k.r, k.g, k.b]; }), quality, budget: actorBudget });

    // terrain: heightmap PlaneGeometry + splat shader + build grid + exact picker
    if (!groundTex) { groundTex = createGroundTextures(THREE); this.cleaner.track(groundTex.grass, groundTex.dirt, groundTex.sand, groundTex.rock); } // page-lifetime cache
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
    for (const k of UNIT_TYPES) {
      this.unitPools[k] = [pool(M.units[k](0), 420, { anim: true, name: k }), pool(M.units[k](1), 420, { anim: true, shadow: false, name: k + "-lod" })];
    }
    this.deerPool = pool(M.units.deer(), 160, { anim: true, name: "deer" });
    this.bldPools = {};
    this.holoPools = {};
    const IB = { name: "iBuild", size: 3, def: [1, 1, 0] };
    for (const k of Object.keys(M.buildings)) {
      const geo = M.buildings[k](), cap = k === "house" ? 80 : 40;
      const bp = this.bldPools[k] = new inst.InstancePool(geo, this.matBld, cap, { name: k, extra: IB, depth: this.bldDepth }); scene.add(bp.mesh);
      // unbuilt remainder of each construction site, drawn as a hologram (one pool per type, empty most of the time)
      const hp = this.holoPools[k] = new inst.InstancePool(geo, this.matHolo, 24, { name: k + "-holo", extra: IB, shadow: false, receive: false });
      hp.mesh.renderOrder = 3; scene.add(hp.mesh);
      geo.dispose();
    }
    this.builtAt = new Map(); // entity → time it completed (completion flash)
    this.scaffold = {}; this.rubblePool = {};
    for (const sz of [2, 3, 4, 5]) { this.scaffold[sz] = pool(M.scaffold(sz), 30, { name: "scaffold" }); this.rubblePool[sz] = pool(M.rubble(sz), 30, { shadow: false, name: "rubble" }); }
    this.blades = pool(M.millBlades(), 20, { name: "blades" });
    this.treePools = [pool(M.resources.pine(), 2600, { name: "pine" }), pool(M.resources.oak(), 2600, { name: "oak" })];
    this.stumpPool = pool(M.resources.stump(), 2000, { shadow: false, name: "stump" });
    this.bushPool = pool(M.resources.bush(), 120, { name: "bush" });
    this.minePool = pool(M.resources.goldmine(), 30, { name: "mine" });
    this.cratePools = [0, 1, 2].map((r) => pool(M.resources.crate(r), 48, { name: "crate" + r }));
    // treasures: chest + additive aura disc (radial glow, turning rays, pulse) coloured by the prize
    this.chestPool = pool(M.resources.chest(), 40, { name: "chest" });
    this.auraMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, // normal blending: additive glow on green grass shifts every hue toward green
      uniforms: { uTime: inst.shared.uTime, uFog: inst.shared.uFog, uMap: inst.shared.uMap },
      vertexShader: /* glsl */ `
        uniform float uMap; varying vec2 vUv; varying vec3 vCol; varying vec2 vFogUv;
        void main() {
          vUv = uv * 2.0 - 1.0;
          vec4 wp = modelMatrix * instanceMatrix * vec4( position, 1.0 );
          vCol = instanceColor; vFogUv = wp.xz / uMap;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime; uniform sampler2D uFog; varying vec2 vUv; varying vec3 vCol; varying vec2 vFogUv;
        void main() {
          float r = length( vUv ); if ( r > 1.0 ) discard;
          float ang = atan( vUv.y, vUv.x );
          float ring = smoothstep( 0.72, 0.88, r ) * ( 1.0 - smoothstep( 0.9, 1.0, r ) );
          float glow = ( 1.0 - r ) * ( 1.0 - r ) * 0.6;
          float rays = pow( 0.5 + 0.5 * sin( ang * 7.0 + uTime * 1.3 ), 6.0 ) * ( 1.0 - r ) * 0.7;
          float pulse = 0.72 + 0.28 * sin( uTime * 3.0 );
          float a = clamp( ( ring * 0.9 + glow + rays ) * pulse, 0.0, 0.85 ) * texture2D( uFog, vFogUv ).r;
          gl_FragColor = vec4( min( vCol * ( 1.05 + rays ), vec3( 1.0 ) ), a );
          #include <colorspace_fragment>
        }`,
    });
    this.auraPool = new inst.InstancePool(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.auraMat, 40, { shadow: false, receive: false, name: "aura" });
    this.auraPool.mesh.renderOrder = 2; scene.add(this.auraPool.mesh);
    this.crates = new Map();    // crate entity → time it landed (drop animation)
    this.arrivedAt = new Map(); // shipped unit → arrival time (glow)
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
    this.floaters = createFloaters(THREE); scene.add(this.floaters.mesh);
    this.shipfx = createShipFx(THREE, { quality }); scene.add(this.shipfx.group);
    // cosmetic rigid bodies (cannon-es): blast ragdolls + building debris on the real heightfield
    this.phys = createPhysics(THREE, { grid: sim.grid, W, H, quality, inst, fx: this.fx }); scene.add(this.phys.mesh);
    this.ragdolls = []; this.hop = new Map(); this.bp = [0, 0, 0];

    // per-entity view state
    this.phase = new Float32Array(MAX); this.mv = new Float32Array(MAX);
    this.clip = new Uint8Array(MAX); this.clipT = new Float32Array(MAX);
    this.lastShot = new Float32Array(MAX).fill(-99); this.shotKind = new Uint8Array(MAX);
    this.forceClip = new Map();
    this.boxPreview = null; // units inside the marquee while dragging
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
          if (ev.e >= 0) { this.lastShot[ev.e] = this.time; this.shotKind[ev.e] = ev.kind === "melee" ? 1 : 0; }
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
          } else if (ev.kind === "grenade") {
            fx.fuse(ev.x, y + 1.3, ev.z);
          } else if (ev.kind === "melee" && Math.random() < 0.6) fx.clash(ev.tx - dx / L * 0.3, g.heightAt(ev.tx, ev.tz) + 0.9, ev.tz - dz / L * 0.3);
          break;
        }
        case "knock": this.hop.set(ev.e, { t: this.time, p: ev.power }); break;
        case "explode": if (this.seen(ev.x, ev.z)) { this.markers.push({ x: ev.x, z: ev.z, t: 0, kind: "blast", r: ev.r || 1 }); fx.explode(ev.x, g.heightAt(ev.x, ev.z), ev.z, ev.small ? 0.55 : 1); if (this.dist2(ev.x, ev.z) < 900) this.cam.shake = Math.min(1.2, this.cam.shake + (ev.small ? 0.12 : 0.35)); } break;
        case "died": {
          const d = DEF_LIST[ev.def];
          this.selection.delete(ev.e);
          if (!this.seen(ev.x, ev.z) && ev.owner !== this.me) break;
          if (ev.building) {
            // the intact mesh is gone this frame: debris bursts out, dust rolls, the rubble pile rises as it settles
            const y = this.footY(ev.x, ev.z, d.size);
            this.phys.collapse(d.id, this.bldPools[d.id].geo, ev.x, y, ev.z, d.size, BLD_H[d.id] || 3, ev.blast);
            this.rubble.push({ size: d.size, x: ev.x, z: ev.z, t: 0, smoke: 3.5 });
            fx.dust(ev.x, y, ev.z, d.size * 0.7, 40); fx.explode(ev.x, y + 0.5, ev.z, Math.min(1.4, d.size * 0.3));
            if (this.dist2(ev.x, ev.z) < 900) this.cam.shake = Math.min(1.2, this.cam.shake + 0.3);
          } else if (ev.blast && d.id !== "deer" && this.phys.ragdoll) {
            const kind = d.id === "hussar" ? "horse" : d.id === "falconet" ? "cannon" : d.id === "wolf" ? "beast" : "human";
            const r = this.phys.ragdoll(d.id, ev.owner, kind, ev.x, g.heightAt(ev.x, ev.z), ev.z, ev.rot, ev.blast);
            if (r) this.ragdolls.push(r);
            else this.corpses.push({ def: d.id, x: ev.x, z: ev.z, rot: ev.rot, owner: ev.owner, t: 0, side: ev.e % 2 ? 1 : -1 });
          } else if (!this.actors.kill(ev.e)) this.corpses.push({ def: d.id, x: ev.x, z: ev.z, rot: ev.rot, owner: ev.owner, t: 0, side: ev.e % 2 ? 1 : -1 });
          break;
        }
        case "depleted": {
          const d = DEF_LIST[ev.def];
          if (d.id === "tree") this.stumps.push({ x: ev.x, z: ev.z, r: (ev.x * 13.1 + ev.z * 7.7) % 6.28 });
          if (d.id === "goldmine") this.rubble.push({ size: 3, x: ev.x, z: ev.z, t: 0, keep: true });
          this.staticDirty = true;
          break;
        }
        case "built":
          this.builtAt.set(ev.e, this.time);
          if (this.seen(st.x[ev.e], st.z[ev.e])) {
            const d = DEF_LIST[st.def[ev.e]], x = st.x[ev.e], z = st.z[ev.e], y = this.footY(x, z, d.size);
            fx.dust(x, y, z, d.size * 0.5, 16); fx.sparkle(x, y + (BLD_H[d.id] || 3) * 0.7, z, 1, 0.85, 0.5);
          }
          break;
        case "treasureClaimed": {
          if (ev.p !== this.me && !this.seen(ev.x, ev.z)) break;
          const y = g.heightAt(ev.x, ev.z), rw = ev.reward;
          this.shipfx.burst(ev.x, y, ev.z, 0.9);
          for (let k = 0; k < 3; k++) fx.sparkle(ev.x, y + 0.5 + k * 0.5, ev.z, 1, 0.9, 0.5);
          if (ev.p === this.me) { if (rw.res != null) this.floaters.spawn(ev.x, y + 1.2, ev.z, rw.amount, rw.res); else if (rw.xp) this.floaters.spawn(ev.x, y + 1.2, ev.z, rw.xp, 3); }
          for (const u of ev.units) this.arrivedAt.set(u, this.time);
          break;
        }
        case "claimBlocked": if (ev.p === this.me) this.addMarker(ev.x, ev.z, "attack"); break;
        case "deposit":
          if (ev.p === this.me && this.dist2(ev.x, ev.z) < 2500) this.floaters.spawn(ev.x, g.heightAt(ev.x, ev.z) + 1.3, ev.z, ev.amt, ev.res);
          break;
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
        case "spawn":
          if (ev.crate) this.crates.set(ev.e, this.time + (this.crates.size % 7) * 0.08);
          else if (st.mask[ev.e] & CM.RESOURCE) this.staticDirty = true;
          break;
        case "shipArrived": {
          if (ev.p !== this.me && !this.seen(ev.x, ev.z)) break;
          const d = DEF_LIST[st.def[ev.at]], y = this.footY(ev.x, ev.z, d.size);
          this.shipfx.burst(ev.x, y, ev.z, d.size * 0.62);
          for (let k = 0; k < 3; k++) fx.sparkle(ev.x + (Math.random() - 0.5) * d.size, y + 2 + k, ev.z + (Math.random() - 0.5) * d.size, 1, 0.85, 0.45);
          for (const e of ev.units) { this.arrivedAt.set(e, this.time); fx.sparkle(st.x[e], g.heightAt(st.x[e], st.z[e]) + 0.6, st.z[e], 1, 0.9, 0.55); }
          if (ev.p === this.me && this.dist2(ev.x, ev.z) < 1600) this.cam.shake = Math.min(1, this.cam.shake + 0.2);
          break;
        }
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
      geo.computeBoundingBox();
      // hologram ghost: fresnel rim + scan lines + sweep, green when the footprint is free, red when not
      this.ghostMat = this.ghostMat || this.inst.holoMaterial({ color: 0x7cff9a, instanced: false });
      this.ghostMat.uniforms.uHeight.value = geo.boundingBox.max.y;
      this.ghost = new THREE.Mesh(geo, this.ghostMat); this.ghost.renderOrder = 3; this.scene.add(this.ghost); this.ghostDef = defId;
    }
    const d = DEFS[defId], x = i + d.size / 2, z = j + d.size / 2;
    this.ghost.visible = true;
    this.ghost.position.set(x, this.footY(x, z, d.size), z);
    this.ghostMat.uniforms.uColor.value.set(ok ? 0x7cff9a : 0xff5a48);
  }

  // ------------------------------------------------------------------ frame
  render(alpha, dt) {
    const sim = this.sim, st = sim.st, g = sim.grid, me = this.me;
    this.time += dt;
    this.inst.shared.uTime.value = this.time;
    this.cam.update(dt);
    this.fog.update();
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
    this.actors.begin();
    for (const k in this.bldPools) { this.bldPools[k].begin(); this.holoPools[k].begin(); }
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
        const hp = this.hop.get(e);
        if (hp) { const k = (this.time - hp.t) / 0.4; if (k >= 1) this.hop.delete(e); else y += Math.sin(k * Math.PI) * Math.min(0.9, hp.p * 0.12); }
        this.sph.set(this.tv.set(x, y + 0.7, z), 1.6);
        if (!this.frustum.intersectsSphere(this.sph)) continue;
        const rot = lerpAngle(st.prot[e], st.rot[e], alpha);
        const spd = Math.hypot(st.vx[e], st.vz[e]);
        // gait phase follows distance travelled (cannon wheels roll: distance / wheel radius)
        this.phase[e] += dt * spd * (d.id === "falconet" ? 1 / 0.33 : GAIT[d.id] || 5);
        this.mv[e] += (Math.min(1, spd / Math.max(0.5, d.speed)) - this.mv[e]) * Math.min(1, dt * 8);
        let tint = st.hitT[e] < 0.12 ? 1.6 : 1;
        const arr = this.arrivedAt.get(e);
        if (arr !== undefined) { const k = (this.time - arr) / 1.2; if (k >= 1) this.arrivedAt.delete(e); else tint = Math.max(tint, 1 + 1.1 * (1 - k)); }
        // animation clip from the simulation state (work, combat, carrying)
        const fc = this.forceClip && this.forceClip.get(e); // debug/gallery override
        let since = this.time - this.lastShot[e];
        if (fc && fc.period) since = (this.time + (e % 5) * 0.2) % fc.period;
        const clip = fc ? fc.clip : d.id === "deer" ? CLIP.IDLE : chooseClip(st, e, d, S, GT, { moving: this.mv[e] > 0.35 && spd > 0.15, sinceShot: since, shotKind: this.shotKind[e] ? "melee" : "ranged" });
        if (clip !== this.clip[e]) { this.clip[e] = clip; this.clipT[e] = 0; } else this.clipT[e] += dt;
        const timed = clip === CLIP.AIM || clip === CLIP.THRUST || clip === CLIP.SLASH || clip === CLIP.FIRE || clip === CLIP.THROW;
        let ct = timed ? since : this.clipT[e] + (e % 7) * 0.31;
        const sync = !fc && WORK_SYNC[clip];
        if (sync) { // phase-lock the swing to the sim's harvest pulse: the strike lands on the pulse
          const ph = Math.min(1, (st.pulse[e] + alpha * TICK) / HARVEST_PULSE);
          ct = (((ph - 1 + sync[0]) % 1) + 1) % 1 * sync[1];
        }
        const code = KIND_OF[d.id] * 32 + clip;
        const tilts = d.id === "hussar" || d.id === "falconet" || d.id === "deer" || d.id === "wolf";
        let pitch = 0, roll = 0;
        if (tilts) {
          const hx = (g.heightAt(x + 0.35, z) - g.heightAt(x - 0.35, z)) / 0.7, hz = (g.heightAt(x, z + 0.35) - g.heightAt(x, z - 0.35)) / 0.7;
          pitch = -Math.atan(hx * Math.sin(rot) + hz * Math.cos(rot)); roll = Math.atan(hx * Math.cos(rot) - hz * Math.sin(rot));
        }
        if (d.id === "deer") {
          if (st.dead[e]) {
            this.te.set(0, rot, Math.PI / 2); this.tq.setFromEuler(this.te); this.tm.compose(this.tv.set(x, y + 0.13, z), this.tq, this.ts.set(1, 1, 1));
            this.deerPool.pushMatrix(this.tm, 0.85, 0.75, 0.7);
          } else { const k = this.deerPool.pushTilt(x, y, z, rot, pitch, roll); this.deerPool.setAnim(k, code, ct, this.mv[e], this.phase[e]); }
          if (this.selection.has(e)) this.ring(x, y, z, d.radius * 2.2, 2);
          continue;
        }
        const dist = camPos.distanceTo(this.tv.set(x, y, z));
        // close enough for a rigged model? (sim state → Idle / Walk / Attack; the animator cross-fades)
        const actor = !fc && this.actors.supports(d.id) && this.actors.draw(e, d.id, o, {
          x, y, z, rot, dist, gen: st.gen[e], speed: spd, shot: this.lastShot[e], melee: this.shotKind[e] === 1,
          state: clip === CLIP.AIM || clip === CLIP.FIRE || clip === CLIP.THRUST || clip === CLIP.SLASH ? STATE.ATTACK : this.mv[e] > 0.35 && spd > 0.15 ? STATE.WALK : STATE.IDLE,
        });
        if (!actor) {
          const pool = this.unitPools[d.id][dist > LOD_DIST ? 1 : 0];
          const tc = this.teamRGB[o];
          const k = tilts ? pool.pushTilt(x, y, z, rot, pitch, roll, tc[0] * tint, tc[1] * tint, tc[2] * tint) : pool.push(x, y, z, rot, 1, tc[0] * tint, tc[1] * tint, tc[2] * tint);
          pool.setAnim(k, code, ct, this.mv[e], this.phase[e]);
        }
        if (this.boxPreview && this.boxPreview.has(e) && !this.selection.has(e)) this.ring(x, y, z, d.radius * 1.55 + 0.12, 0, true);
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
      const tint = st.hitT[e] < 0.12 ? 1.4 : 1;
      // construction: the real mesh is revealed bottom-up to progress × height (shader cut);
      // the unbuilt remainder is a hologram; at 100% the cut is disabled and the mesh is whole
      const bp = this.bldPools[d.id], H = bp.height + 0.05;
      const shown = prog < 1 ? 0.04 + 0.96 * prog : 1;
      let flash = 0;
      const bt = this.builtAt.get(e);
      if (bt !== undefined) { flash = Math.max(0, 1 - (this.time - bt) / 0.9); if (flash <= 0) this.builtAt.delete(e); }
      bp.setExtra(bp.push(x, y, z, 0, 1, tc[0] * tint, tc[1] * tint, tc[2] * tint), shown, H, flash);
      if (prog < 1) {
        const hp = this.holoPools[d.id];
        hp.setExtra(hp.push(x, y, z, 0, 1, 1, 1, 1), shown, H, 0);
        this.scaffold[d.size].push(x, y, z, 0, 1);
      }
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
      const sink = c.t > 9 ? (c.t - 9) * 0.12 : 0;
      if (c.mat) { // a ragdoll that came to rest: keep its exact final pose
        this.tm.copy(c.mat); this.tm.elements[13] -= sink;
        const tc = this.teamRGB[c.owner], dark = 0.75, pool = this.unitPools[c.def][0];
        pool.setAnim(pool.pushMatrix(this.tm, tc[0] * dark, tc[1] * dark, tc[2] * dark), c.code, c.ct, 0, 0);
        continue;
      }
      const fall = Math.min(1, c.t / 0.45);
      const y = g.heightAt(c.x, c.z) + 0.12 * fall - sink;
      this.te.set(0, c.rot, c.side * Math.PI / 2 * fall * (c.def === "falconet" ? 0.25 : 1)); this.tq.setFromEuler(this.te);
      this.tm.compose(this.tv.set(c.x, y, c.z), this.tq, this.ts.set(1, 1, 1));
      if (c.def === "deer") continue;
      const tc = this.teamRGB[c.owner], dark = 0.75;
      this.unitPools[c.def][0].pushMatrix(this.tm, tc[0] * dark, tc[1] * dark, tc[2] * dark);
    }
    // ragdolls (blast victims): mesh follows the rigid body, vertex shader flails the limbs
    const finished = this.phys.step(dt);
    for (const r of this.ragdolls) {
      if (!this.unitPools[r.def]) continue;
      this.phys.ragdollMatrix(r, this.tm);
      const tc = this.teamRGB[r.owner], pool = this.unitPools[r.def][0];
      pool.setAnim(pool.pushMatrix(this.tm, tc[0], tc[1], tc[2]), KIND_OF[r.def] * 32 + CLIP.FLAIL, r.t, 0, 0);
    }
    for (const r of finished) {
      this.ragdolls.splice(this.ragdolls.indexOf(r), 1);
      if (this.unitPools[r.def]) this.corpses.push({ def: r.def, owner: r.owner, t: 2.5, mat: this.phys.ragdollMatrix(r, new THREE.Matrix4()), code: KIND_OF[r.def] * 32 + CLIP.FLAIL, ct: r.t, x: r.body.position.x, z: r.body.position.z });
    }
    // rubble: rises out of the ground as the debris settles; smoke columns, then embers
    for (let i = this.rubble.length - 1; i >= 0; i--) {
      const r = this.rubble[i]; r.t += dt;
      if (!r.keep && r.t > 60) { this.rubble.splice(i, 1); continue; }
      const y = this.footY(r.x, r.z, r.size), rise = r.smoke ? Math.min(1, r.t / 1.6) : 1;
      this.rubblePool[r.size].push(r.x, y - (1 - rise) * 0.7, r.z, r.x, 1);
      if (r.smoke && r.t < r.smoke && Math.random() < dt * 14) this.fx.plume(r.x + (Math.random() - 0.5) * r.size * 0.7, y + 0.4, r.z + (Math.random() - 0.5) * r.size * 0.7, r.size);
      if (r.t < 8 && Math.random() < dt * 6) this.fx.fire(r.x + (Math.random() - 0.5) * r.size * 0.6, y + 0.3, r.z + (Math.random() - 0.5) * r.size * 0.6);
    }
    // cannonballs
    for (const p of sim.projectiles) {
      // the sim's own parabola, sampled between ticks (sim/ballistics.js)
      const tt = Math.min(p.T, p.t + alpha * TICK), gr = p.kind === 1;
      const [x, y, z] = ballisticAt(p, tt, this.bp);
      if (this.seen(x, z)) {
        this.balls.push(x, y, z, tt * 9, gr ? 0.62 : 1, 0.15, 0.15, 0.15);
        if (!gr && Math.random() < dt * 40) this.fx.trail(x, y, z);
        if (gr && Math.random() < dt * 30) this.fx.fuse(x, y + 0.08, z);
      }
    }
    // treasures (static chests; aura brighter + sparkles once the guardians are down)
    this.chestPool.begin(); this.auraPool.begin();
    const exp = g.exp[me];
    for (const [t, rec] of sim.treasures) {
      if (!st.alive[t]) continue;
      const x = st.x[t], z = st.z[t], i = Math.floor(x), j = Math.floor(z);
      if (!reveal && !exp[j * W + i]) continue;
      const y = g.heightAt(x, z), rw = rec.reward, c = AURA[rw.res != null ? rw.res : rw.xp ? 3 : 4];
      let guarded = false; for (const q of rec.guards) if (st.alive[q] && st.hp[q] > 0) { guarded = true; break; }
      this.chestPool.push(x, y, z, (x * 3.1 + z) % 6.28, 1);
      const k = guarded ? 0.5 : 1.25;
      this.auraPool.push(x, y + 0.05, z, this.time * 0.2, guarded ? 2.6 : 3.2, c[0] * k, c[1] * k, c[2] * k);
      if (!guarded && Math.random() < dt * 5 && this.dist2(x, z) < 1600) this.fx.sparkle(x + (Math.random() - 0.5) * 0.6, y + 0.4, z + (Math.random() - 0.5) * 0.6, c[0], c[1], c[2]);
      if ((this.selection.has(t) || this.hover === t)) this.ring(x, y, z, 1.1, 2, this.hover === t && !this.selection.has(t));
    }
    this.chestPool.end(); this.auraPool.end();
    // shipment crates: fall from the sky, bounce, shrink as villagers unpack them
    for (const p of this.cratePools) p.begin();
    for (const [e, t0] of this.crates) {
      if (!st.alive[e] || !DEF_LIST[st.def[e]].crate) { this.crates.delete(e); continue; }
      const x = st.x[e], z = st.z[e];
      if (st.owner[e] !== me && !this.seen(x, z)) continue;
      const t = this.time - t0, y0 = g.heightAt(x, z);
      if (t < 0) continue;
      const fall = t < 0.55 ? 7 * (1 - (t / 0.55) ** 2) : 0.28 * Math.abs(Math.sin((t - 0.55) * 9)) * Math.exp(-(t - 0.55) * 5);
      if (t >= 0.55 && t - dt < 0.55 && this.dist2(x, z) < 1600) this.fx.dust(x, y0, z, 0.4, 5);
      const sc = 0.55 + 0.45 * Math.min(1, st.amount[e] / 100);
      this.cratePools[DEF_LIST[st.def[e]].res].push(x, y0 + fall, z, (x * 7.13 + z * 3.7) % 6.28, sc);
    }
    for (const p of this.cratePools) p.end();
    // shipment on its way: emblem + progress ring over the receiving Town Center
    const pme = sim.players[me];
    if (pme.ship && pme.tc >= 0 && st.alive[pme.tc]) this.shipfx.transit(st.x[pme.tc], this.footY(st.x[pme.tc], st.z[pme.tc], 5), st.z[pme.tc], pme.ship.t / pme.ship.total, this.camera.quaternion);
    else this.shipfx.transit(0, 0, 0, null);
    // markers
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const mk = this.markers[i]; mk.t += dt;
      if (mk.t > 0.6) { this.markers.splice(i, 1); continue; }
      if (mk.kind === "blast") { const k = mk.t / 0.6; this.rings.push(mk.x, g.heightAt(mk.x, mk.z) + 0.1, mk.z, 0, mk.r * (0.5 + k * 1.1), 1.0 * (1 - k), 0.55 * (1 - k), 0.2 * (1 - k)); continue; }
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
    this.actors.end(dt);
    for (const k in this.bldPools) { this.bldPools[k].end(); this.holoPools[k].end(); }
    for (const k in this.scaffold) { this.scaffold[k].end(); this.rubblePool[k].end(); }
    this.blades.end(); this.rings.end(); this.bars.end(); this.balls.end();
    if (this.staticDirtyStumps) { this.rebuildStatics(); this.staticDirtyStumps = false; }
    this.fx.update(dt);
    this.floaters.update(dt);
    this.shipfx.update(dt);
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
      if (st.mask[e] & (CM.RESOURCE | CM.TREASURE)) return { e, gp };
    }
    return { e: -1, gp };
  }
  // Marquee selection: own units whose projected screen box (feet → head, body width) overlaps the
  // dragged rectangle. Interpolated positions are used so the box matches what is on screen.
  boxSelect(x0, y0, x1, y1, w, h) {
    const st = this.sim.st, g = this.sim.grid, out = [];
    for (let e = 0; e < st.top; e++) {
      if (!st.alive[e] || st.owner[e] !== this.me || !(st.mask[e] & CM.UNIT)) continue;
      const d = DEF_LIST[st.def[e]], x = st.x[e], z = st.z[e], y = g.heightAt(x, z);
      const [fx, fy, fz] = this.cam.project(x, y, z, w, h);
      if (fz >= 1) continue;
      const [, hy] = this.cam.project(x, y + (UNIT_H[d.id] || 1.2), z, w, h);
      const half = Math.max(4, (fy - hy) * (d.radius > 0.5 ? 0.55 : 0.32));
      if (fx + half >= x0 && fx - half <= x1 && fy >= y0 && hy <= y1) out.push(e);
    }
    // a box that catches soldiers and villagers keeps the soldiers (hold Shift to keep both)
    return out;
  }
  onScreen(e, w, h) {
    const st = this.sim.st, [px, py, pz] = this.cam.project(st.x[e], this.sim.grid.heightAt(st.x[e], st.z[e]), st.z[e], w, h);
    return pz < 1 && px >= 0 && px <= w && py >= 0 && py <= h;
  }

  /** Free every GPU resource this world uploaded (SceneCleaner: geometry, materials, every texture
   *  slot and shader uniform, shadow maps, render targets). Page-wide caches are kept: the ground
   *  textures (shared by every match) and the glTF unit templates (render/assets.js). */
  dispose() {
    this.cam.detach();
    this.actors.dispose(); // detach the model copies first: their geometry belongs to the AssetManager
    const keep = new Set([groundTex.grass, groundTex.dirt, groundTex.sand, groundTex.rock]);
    const report = this.cleaner.disposeObject(this.scene, { keep, detach: true });
    for (const x of [this.envRT, this.fog.tex, this.buildGrid.tex, this.tint, this.bldDepth, this.floaters, this.shipfx, this.phys]) if (x) x.dispose();
    this.r.renderLists.dispose();
    return report;
  }
}

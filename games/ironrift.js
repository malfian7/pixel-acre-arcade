// Iron Rift — a wave-survival FPS in a sunset container terminal. Pixel Acre Arcade original.
import * as THREE from "three";
import { PA } from "./common.js";
import { createFactory } from "./ironrift-models.js";
import { buildWorld } from "./ironrift-world.js";
import { audioInit, sfx, musicMode, ambience, audioPause, audioEnd, setVolumes } from "./ironrift-audio.js";

/* ================================================================ utils */
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const AUTO = PA.params.has("auto"), THUMB = PA.THUMB, SIM = +PA.params.get("sim") || 0, GOD = PA.params.has("god");
const ARCADE = !window.CC_STANDALONE;
const frameWait = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));

/* ================================================================ settings & records */
const DEFAULTS = { sens: 5, invert: 0, fov: 80, shake: 2, quality: 1, master: 8, music: 6, sfx: 8, padSens: 5 };
const settings = Object.assign({}, DEFAULTS, PA.store.get("ironrift:settings", {}));
const saveSettings = () => PA.store.set("ironrift:settings", settings);
const records = Object.assign({ onslaught: { score: 0, wave: 0, cleared: false }, deathmatch: { score: 0, kills: 0, wins: 0 } }, PA.store.get("ironrift:records", {}));
const saveRecords = () => { if (!AUTO && !THUMB) PA.store.set("ironrift:records", records); };
const applyVolumes = () => setVolumes({ master: settings.master / 10, music: settings.music / 10, sfx: settings.sfx / 10 });

/* ================================================================ loading screen */
const LOAD = { el: $("loading"), bar: $("loadBar"), txt: $("loadTxt"), pct: $("loadPct") };
function loadStep(p, text) { LOAD.bar.style.transform = `scaleX(${p})`; LOAD.txt.textContent = text; LOAD.pct.textContent = Math.round(p * 100) + "%"; }

/* ================================================================ renderer, scenes, cameras */
loadStep(0.04, "Waking the terminal");
if (document.fonts) await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]);
const renderer = await PA.renderer(THREE, { clear: 0x1a1214, shadows: true });
renderer.toneMappingExposure = 1.18;
renderer.autoClear = false;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 2600);
camera.rotation.order = "YXZ";
scene.add(camera);
// The viewmodel (arms + weapon) lives in its own scene with a fixed-FOV camera, drawn after a depth
// clear so it never clips into walls; it mirrors the world's sun and sky light.
const vmScene = new THREE.Scene(), vmCam = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);
const vmSun = new THREE.DirectionalLight(0xffc89a, 2.6), vmHemi = new THREE.HemisphereLight(0x8f9ccf, 0x4a3a34, 1.2);
vmSun.position.set(-0.4, 0.5, -1); vmScene.add(vmSun, vmHemi, vmCam);
const flashLight = new THREE.PointLight(0xffb066, 0, 9, 2); scene.add(flashLight);        // muzzle flash lighting in the world
const vmFlash = new THREE.PointLight(0xffb066, 0, 2, 2); vmScene.add(vmFlash);
const boomLight = new THREE.PointLight(0xff8a3a, 0, 30, 2); scene.add(boomLight);          // shared explosion light

loadStep(0.12, "Generating materials");
await frameWait();
const F = createFactory(THREE, renderer);
loadStep(0.2, "Stacking containers");
await frameWait();
const world = buildWorld(THREE, F, scene, renderer);
vmScene.environment = scene.environment;
loadStep(0.48, "Arming the operator");
await frameWait();

/* ================================================================ input: keyboard + mouse, gamepad, touch */
const K = PA.keys;
const IN = { move: V3(), lookX: 0, lookY: 0, swayX: 0, swayY: 0, fire: false, aim: false, sprint: false, crouch: false, last: PA.TOUCH ? "touch" : "kb",
  jumpP: false, reloadP: false, swapP: false, nextP: 0, slotP: -1, grenadeP: false, meleeP: false, overP: false, crouchP: false, pauseP: false, score: false };
const edge = new Set();
let mouseDown = [false, false, false], locked = false;
addEventListener("keydown", (e) => {
  audioInit(); applyVolumes();
  if (menuOpen()) { menuKey(e); return; }
  if (e.repeat) return;
  IN.last = "kb";
  edge.add(e.code);
  if (["Space", "Tab", "KeyQ", "KeyF", "KeyG"].includes(e.code)) e.preventDefault();
  if (e.code === "Escape") IN.pauseP = true;
});
addEventListener("keyup", (e) => { if (e.code === "Tab") e.preventDefault(); });
addEventListener("mousedown", (e) => {
  audioInit(); applyVolumes();
  if (G.state !== "play") return;
  if (!locked && !PA.TOUCH && !AUTO) { requestLock(); }
  mouseDown[e.button] = true; IN.last = "kb";
});
addEventListener("mouseup", (e) => { mouseDown[e.button] = false; });
addEventListener("contextmenu", (e) => { if (G.state === "play") e.preventDefault(); });
addEventListener("wheel", (e) => { if (G.state === "play") IN.nextP += Math.sign(e.deltaY); }, { passive: true });
addEventListener("mousemove", (e) => {
  if (G.state !== "play" || PA.TOUCH) return;
  if (!locked && !AUTO) return;
  if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;   // Chrome sometimes reports a huge jump right after locking
  const k = 0.0004 * settings.sens * (P.ads > 0.5 ? zoomSensK() : 1);
  IN.lookX += e.movementX * k; IN.lookY += e.movementY * k * (settings.invert ? -1 : 1);
});
function requestLock() { if (THUMB) return; try { const p = renderer.domElement.requestPointerLock({ unadjustedMovement: true }); if (p && p.catch) p.catch(() => { try { const q = renderer.domElement.requestPointerLock(); if (q && q.catch) q.catch(() => {}); } catch {} }); } catch {} }
document.addEventListener("pointerlockchange", () => {
  locked = document.pointerLockElement === renderer.domElement;
  if (!locked && G.state === "play" && !AUTO) pauseGame();
});
addEventListener("blur", () => { mouseDown = [false, false, false]; if (G.state === "play" && !AUTO) pauseGame(); });
document.addEventListener("visibilitychange", () => { if (document.hidden && G.state === "play" && !AUTO) pauseGame(); });

// Gamepad (standard mapping): LS move, RS look, RT fire, LT aim, A jump, X reload, Y last weapon, RB next weapon,
// LB grenade, B crouch (hold) / slide, L3 sprint, R3 melee, D-pad ↑ Overdrive, ↓ grenade, Start pause, Back scoreboard.
let padPrev = {};
function pollPad(dt) {
  let gp = null; try { gp = [...(navigator.getGamepads ? navigator.getGamepads() : [])].find((p) => p && p.connected); } catch {}
  if (!gp) return null;
  const b = (i) => !!gp.buttons[i] && (gp.buttons[i].pressed || gp.buttons[i].value > 0.35), v = (i) => (gp.buttons[i] ? gp.buttons[i].value : 0);
  const dz = (x) => (Math.abs(x) < 0.14 ? 0 : Math.sign(x) * Math.pow((Math.abs(x) - 0.14) / 0.86, 1.6));
  const now = { a: b(0), b: b(1), x: b(2), y: b(3), lb: b(4), rb: b(5), back: b(8), start: b(9), l3: b(10), r3: b(11), up: b(12), down: b(13), left: b(14), right: b(15), sy: (gp.axes[1] || 0) };
  const pr = (k) => now[k] && !padPrev[k];
  const any = Object.values(now).some((x) => x === true) || Math.abs(gp.axes[0]) > 0.3 || Math.abs(gp.axes[2]) > 0.3 || v(6) > 0.2 || v(7) > 0.2;
  if (any) IN.last = "pad";
  if (menuOpen()) {
    if (pr("up") || (now.sy < -0.6 && !(padPrev.sy < -0.6))) menuMove(-1); if (pr("down") || (now.sy > 0.6 && !(padPrev.sy > 0.6))) menuMove(1);
    if (pr("left")) menuAdjust(-1); if (pr("right")) menuAdjust(1); if (pr("a")) menuActivate(); if (pr("b") || pr("start")) menuBack();
    padPrev = now; return null;
  }
  const out = { mx: dz(gp.axes[0]), mz: dz(gp.axes[1]), lx: dz(gp.axes[2] || 0), ly: dz(gp.axes[3] || 0), fire: v(7) > 0.3, aim: v(6) > 0.3, sprint: now.l3, crouch: now.b };
  if (pr("l3")) IN.sprintLatch = !IN.sprintLatch;
  if (pr("a")) edge.add("Space"); if (pr("x")) edge.add("KeyR"); if (pr("y")) edge.add("KeyQ"); if (pr("rb")) IN.nextP += 1;
  if (pr("lb") || pr("down")) edge.add("KeyG"); if (pr("r3")) edge.add("KeyV"); if (pr("up")) edge.add("KeyF"); if (pr("start")) IN.pauseP = true;
  if (pr("b")) edge.add("KeyC");
  out.back = now.back;
  padPrev = now; return out;
}

// Touch (landscape phones): left stick moves, dragging on the right half looks; on-screen buttons for the rest.
const TOUCH = { look: null, lx: 0, ly: 0, fire: false, aim: false };
let touchUI = null;
if (PA.TOUCH) {
  document.body.classList.add("touch");
  touchUI = PA.touchControls({ stick: true, buttons: [{ label: "Jump", code: "Space" }, { label: "Crouch", code: "KeyC", alt: true }, { label: "Reload", code: "KeyR", alt: true }, { label: "Swap", code: "KeyQ", alt: true }, { label: "Nade", code: "KeyG", alt: true }, { label: "Melee", code: "KeyV", alt: true }] });
  touchUI.style.display = "none";
  const tb = $("touchBtns");
  const hold = (id, on) => { const el = $(id); el.addEventListener("touchstart", (e) => { e.preventDefault(); on(true); el.classList.add("down"); }, { passive: false }); el.addEventListener("touchend", (e) => { e.preventDefault(); on(false); el.classList.remove("down"); }, { passive: false }); };
  hold("tFire", (v) => (TOUCH.fire = v)); hold("tAim", (v) => { if (v) TOUCH.aim = !TOUCH.aim; }); hold("tOver", (v) => v && edge.add("KeyF")); hold("tPause", (v) => v && (IN.pauseP = true));
  renderer.domElement.addEventListener("touchstart", (e) => { for (const t of e.changedTouches) if (t.clientX > innerWidth * 0.4 && TOUCH.look == null) { TOUCH.look = t.identifier; TOUCH.px = t.clientX; TOUCH.py = t.clientY; } }, { passive: true });
  renderer.domElement.addEventListener("touchmove", (e) => { for (const t of e.changedTouches) if (t.identifier === TOUCH.look) { IN.lookX += (t.clientX - TOUCH.px) * 0.0042 * settings.sens / 5; IN.lookY += (t.clientY - TOUCH.py) * 0.0042 * settings.sens / 5; TOUCH.px = t.clientX; TOUCH.py = t.clientY; } }, { passive: true });
  const endT = (e) => { for (const t of e.changedTouches) if (t.identifier === TOUCH.look) TOUCH.look = null; };
  renderer.domElement.addEventListener("touchend", endT); renderer.domElement.addEventListener("touchcancel", endT);
  tb.classList.add("on");
}
// Gathers every device into one frame of input. Edges (presses) are consumed by the game once.
function readInput(dt) {
  const pad = pollPad(dt);
  const kx = (K.has("KeyD") ? 1 : 0) - (K.has("KeyA") ? 1 : 0), kz = (K.has("KeyS") ? 1 : 0) - (K.has("KeyW") ? 1 : 0);
  IN.move.set(kx, 0, kz);
  if (pad && (Math.abs(pad.mx) + Math.abs(pad.mz) > 0)) IN.move.set(pad.mx, 0, pad.mz);
  if (PA.TOUCH && (Math.abs(PA.axis.x) + Math.abs(PA.axis.y) > 0.05)) IN.move.set(PA.axis.x, 0, PA.axis.y);
  if (IN.move.lengthSq() > 1) IN.move.normalize();
  IN.fire = mouseDown[0] || TOUCH.fire || (pad && pad.fire) || false;
  IN.aim = mouseDown[2] || TOUCH.aim || (pad && pad.aim) || false;
  if (IN.move.z >= -0.2) IN.sprintLatch = false;
  IN.sprint = K.has("ShiftLeft") || K.has("ShiftRight") || (pad && (pad.sprint || IN.sprintLatch)) || (PA.TOUCH && PA.axis.y < -0.92) || false;
  IN.crouch = K.has("KeyC") || K.has("ControlLeft") || (pad && pad.crouch) || false;
  IN.score = K.has("Tab") || (pad && pad.back) || false;
  if (pad) {   // right stick look with a response curve, slowed slightly while the reticle is on a target
    const k = dt * 2.6 * settings.padSens / 5 * (P.ads > 0.5 ? 0.55 : 1) * (G.aimOnTarget ? 0.6 : 1);
    IN.lookX += pad.lx * k * 1.6; IN.lookY += pad.ly * k * (settings.invert ? -1 : 1);
  }
  IN.jumpP = edge.has("Space"); IN.reloadP = edge.has("KeyR"); IN.swapP = edge.has("KeyQ"); IN.grenadeP = edge.has("KeyG"); IN.meleeP = edge.has("KeyV") || edge.has("KeyE");
  IN.overP = edge.has("KeyF"); IN.crouchP = edge.has("KeyC") || edge.has("ControlLeft");
  IN.slotP = edge.has("Digit1") ? 0 : edge.has("Digit2") ? 1 : edge.has("Digit3") ? 2 : -1;
  edge.clear();
}

/* ================================================================ FX: particles, tracers, flashes, shells, decals, debris, shockwaves */
function makeParticles(N, additive) {
  const geo = new THREE.BufferGeometry(), pos = new Float32Array(N * 3), col = new Float32Array(N * 3), al = new Float32Array(N), sz = new Float32Array(N);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3)); geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setAttribute("alpha", new THREE.BufferAttribute(al, 1)); geo.setAttribute("size", new THREE.BufferAttribute(sz, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    vertexShader: `attribute vec3 color; attribute float alpha; attribute float size; varying vec3 vC; varying float vA; uniform float uScale;
      void main(){ vC = color; vA = alpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d); if (r > 0.5) discard; float a = vA * smoothstep(0.5, ${additive ? "0.0" : "0.18"}, r); gl_FragColor = vec4(vC, a); }`,
  });
  const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; pts.renderOrder = 3; scene.add(pts);
  const P = Array.from({ length: N }, () => ({ life: 0, max: 1, x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, s0: 1, s1: 1, a0: 1, c: new THREE.Color(), drag: 0, g: 0 }));
  let head = 0;
  return {
    mat,
    emit(x, y, z, vx, vy, vz, life, s0, s1, a0, c, drag = 0, g = 0) { const p = P[head]; head = (head + 1) % N; Object.assign(p, { life, max: life, x, y, z, vx, vy, vz, s0, s1, a0, drag, g }); p.c.copy(c); },
    update(dt) {
      for (let i = 0; i < N; i++) {
        const p = P[i];
        if (p.life <= 0) { al[i] = 0; continue; }
        p.life -= dt; const k = Math.exp(-p.drag * dt); p.vx *= k; p.vy = p.vy * k - p.g * dt; p.vz *= k;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt; if (p.y < 0.02 && p.g > 0) { p.y = 0.02; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
        const u = 1 - p.life / p.max; pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        col[i * 3] = p.c.r; col[i * 3 + 1] = p.c.g; col[i * 3 + 2] = p.c.b; al[i] = p.a0 * (1 - u) * Math.min(1, p.life * 8); sz[i] = lerp(p.s0, p.s1, u);
      }
      for (const k of ["position", "color", "alpha", "size"]) geo.attributes[k].needsUpdate = true;
    },
  };
}
const SOFT = makeParticles(1600, false), GLOW = makeParticles(1400, true);
const C = { smoke: new THREE.Color("#6b6560"), dark: new THREE.Color("#2b2624"), dust: new THREE.Color("#8d857b"), spark: new THREE.Color("#ffb54a"), spark2: new THREE.Color("#ff6a1a"),
  fire: new THREE.Color("#ff8a2a"), fire2: new THREE.Color("#ffd27a"), blood: new THREE.Color("#5a0d0b"), robo: new THREE.Color("#7fdcff"), white: new THREE.Color("#e8e8e8"), splash: new THREE.Color("#9aa6ad"),
  hp: new THREE.Color("#4dff8a"), ar: new THREE.Color("#4db8ff"), am: new THREE.Color("#ffbd3a"), od: new THREE.Color("#ff7a1a") };
const flashTex = F.canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, "rgba(255,250,230,1)"); gr.addColorStop(0.2, "rgba(255,200,110,.9)"); gr.addColorStop(0.6, "rgba(255,120,30,.25)"); gr.addColorStop(1, "rgba(255,90,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, w, h); g.globalCompositeOperation = "lighter"; g.strokeStyle = "rgba(255,220,150,.7)"; g.lineWidth = 5;
  for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2 + Math.random() * 0.3; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke(); }
});
flashTex.wrapS = flashTex.wrapT = THREE.ClampToEdgeWrapping;
const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
function flashMesh(size) { const g = new THREE.Group(); for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(size, size), flashMat); m.rotation.set(k === 0 ? 0 : Math.PI / 2, k === 2 ? Math.PI / 2 : 0, 0); g.add(m); } g.visible = false; return g; }
// enemy muzzle flashes: a small pool of sprites in the world
const eFlashes = Array.from({ length: 14 }, () => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, color: 0xffffff })); s.visible = false; s.t = 0; scene.add(s); return s; });
let eFlashI = 0;
function enemyFlash(p, size = 0.7, color = 0xffffff) { const s = eFlashes[eFlashI++ % eFlashes.length]; s.position.copy(p); s.scale.setScalar(size * rnd(0.8, 1.2)); s.material.color.set(color); s.material.rotation = Math.random() * 6; s.visible = true; s.t = 0.05; }
// tracers: thin additive streaks that travel along the shot
const tracerGeo = new THREE.BoxGeometry(1, 1, 1); tracerGeo.translate(0, 0, -0.5);
const tracers = Array.from({ length: 50 }, () => { const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xffcf7a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })); m.visible = false; m.t = 0; scene.add(m); return m; });
let tracerI = 0;
function tracer(from, to, color = 0xffcf7a, w = 0.022, speed = 320) {
  const m = tracers[tracerI++ % tracers.length], L = from.distanceTo(to); if (L < 0.5) return;
  m.position.copy(from); m.lookAt(to); m.material.color.set(color); m.scale.set(w, w, Math.min(L, 9)); m.visible = true;
  m.from = from.clone(); m.dir = V3().subVectors(to, from).normalize(); m.len = L; m.d = 0; m.speed = speed; m.w = w;
}
// ejected brass and shotgun shells (world space, simple physics)
const shellGeo = { brass: new THREE.CylinderGeometry(0.005, 0.005, 0.032, 6), shell: new THREE.CylinderGeometry(0.011, 0.011, 0.06, 8) };
shellGeo.brass.rotateZ(Math.PI / 2); shellGeo.shell.rotateZ(Math.PI / 2);
const shells = Array.from({ length: 36 }, () => { const m = new THREE.Mesh(shellGeo.brass, F.MAT.brass); m.visible = false; m.castShadow = false; scene.add(m); return { m, v: V3(), w: V3(), t: 0, b: 0 }; });
let shellI = 0;
function ejectShell(kind, pos, right, up) {
  const s = shells[shellI++ % shells.length]; s.m.geometry = shellGeo[kind]; s.m.material = kind === "shell" ? F.MAT.shellRed : F.MAT.brass;
  s.m.position.copy(pos); s.v.copy(right).multiplyScalar(rnd(1.8, 2.8)).addScaledVector(up, rnd(1.6, 2.6)).add(P.vel); s.w.set(rnd(-20, 20), rnd(-20, 20), rnd(-20, 20)); s.t = 2.5; s.b = 0; s.m.visible = true;
}
// impact decals: bullet holes and scorch marks on any surface
const holeTex = F.canvasTex(64, 64, (g, w, h) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 30); gr.addColorStop(0, "rgba(5,4,4,1)"); gr.addColorStop(0.22, "rgba(20,18,16,.95)"); gr.addColorStop(0.4, "rgba(60,55,50,.5)"); gr.addColorStop(1, "rgba(60,55,50,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
const scorchTex = F.canvasTex(128, 128, (g, w, h) => { for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, r = rnd(10, 50), x = 64 + Math.cos(a) * r * 0.4, y = 64 + Math.sin(a) * r * 0.4, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(10,8,7,.55)"); gr.addColorStop(1, "rgba(10,8,7,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); } });
holeTex.wrapS = holeTex.wrapT = scorchTex.wrapS = scorchTex.wrapT = THREE.ClampToEdgeWrapping;
function decalPool(n, tex, rough) {
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: rough, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }), n);
  const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < n; i++) m.setMatrixAt(i, z); m.frustumCulled = false; m.receiveShadow = true; scene.add(m); return { m, i: 0, n };
}
const HOLES = decalPool(220, holeTex, 0.9), SCORCH = decalPool(28, scorchTex, 1);
const DM = new THREE.Matrix4(), DQ = new THREE.Quaternion(), DS = V3(), DN = V3(), ZF = V3(0, 0, 1);
function decal(pool, p, n, size) {
  DN.set(n[0], n[1], n[2]); DQ.setFromUnitVectors(ZF, DN); const r = new THREE.Quaternion().setFromAxisAngle(ZF, Math.random() * 6.28); DQ.multiply(r);
  DM.compose(V3().copy(p).addScaledVector(DN, 0.012), DQ, DS.set(size, size, size)); pool.m.setMatrixAt(pool.i, DM); pool.i = (pool.i + 1) % pool.n; pool.m.instanceMatrix.needsUpdate = true;
}
// debris chunks: concrete, metal and robot shell fragments
const debrisM = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0.2 }), 180);
debrisM.castShadow = true; debrisM.frustumCulled = false; scene.add(debrisM);
const debris = Array.from({ length: 180 }, () => ({ p: V3(0, -99, 0), v: V3(), r: V3(), w: V3(), s: 0, t: 0 })); let debrisI = 0;
{ const z = new THREE.Matrix4().makeScale(0, 0, 0); for (let i = 0; i < 180; i++) { debrisM.setMatrixAt(i, z); debrisM.setColorAt(i, C.dust); } }
function chunk(p, v, s, color) { const d = debris[debrisI]; d.p.copy(p); d.v.copy(v); d.w.set(rnd(-12, 12), rnd(-12, 12), rnd(-12, 12)); d.r.set(rnd(0, 6), rnd(0, 6), rnd(0, 6)); d.s = s; d.t = rnd(1.6, 3); debrisM.setColorAt(debrisI, color); debrisM.instanceColor.needsUpdate = true; debrisI = (debrisI + 1) % debris.length; }
// shockwave rings
const ringGeo = new THREE.RingGeometry(0.86, 1, 56); ringGeo.rotateX(-Math.PI / 2);
const rings = Array.from({ length: 10 }, () => { const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })); m.visible = false; scene.add(m); return { m, t: 0, max: 1, r: 1 }; });
let ringI = 0;
function shockwave(p, radius, color = 0xffb070, dur = 0.45) { const r = rings[ringI++ % rings.length]; r.m.position.set(p.x, Math.max(0.06, p.y - 0.3), p.z); r.m.material.color.set(color); r.t = dur; r.max = dur; r.r = radius; r.m.visible = true; }
// floating ground telegraph for the boss mortars
const teleGeo = new THREE.RingGeometry(0.75, 1, 40); teleGeo.rotateX(-Math.PI / 2);
const teles = Array.from({ length: 12 }, () => { const m = new THREE.Mesh(teleGeo, new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, depthWrite: false, toneMapped: false, opacity: 0.8 })); m.visible = false; scene.add(m); return m; });

let shakeAmt = 0;
function addShake(k) { shakeAmt = Math.min(1.4, shakeAmt + k * [0, 0.5, 1][settings.shake]); }
// Explosion: fireball, smoke, sparks, debris, shockwave, light, scorch, sound, damage with falloff.
function explode(p, { radius = 5.5, dmg = 160, owner = "player", big = false, selfK = 0.5 } = {}) {
  for (let i = 0; i < (big ? 46 : 30); i++) { const a = rnd(0, 6.28), e = rnd(-0.2, 1.2), s = rnd(2, 9); GLOW.emit(p.x, p.y + 0.3, p.z, Math.cos(a) * Math.cos(e) * s, Math.sin(e) * s + 1, Math.sin(a) * Math.cos(e) * s, rnd(0.25, 0.6), rnd(1.4, 2.6) * (big ? 1.4 : 1), rnd(2.8, 4.5), 0.9, Math.random() < 0.5 ? C.fire : C.fire2, 5, -1); }
  for (let i = 0; i < 24; i++) SOFT.emit(p.x + rnd(-1, 1), p.y + rnd(0, 1.2), p.z + rnd(-1, 1), rnd(-3, 3), rnd(1, 4), rnd(-3, 3), rnd(1.6, 3.2), rnd(1.8, 3), rnd(4, 7), 0.55, Math.random() < 0.5 ? C.smoke : C.dark, 1.4, -0.4);
  for (let i = 0; i < 26; i++) GLOW.emit(p.x, p.y + 0.4, p.z, rnd(-16, 16), rnd(3, 16), rnd(-16, 16), rnd(0.4, 1.1), 0.12, 0.05, 1, C.spark, 1.2, 14);
  for (let i = 0; i < 14; i++) chunk(V3(p.x, p.y + 0.3, p.z), V3(rnd(-9, 9), rnd(4, 13), rnd(-9, 9)), rnd(0.06, 0.18), Math.random() < 0.5 ? C.dust : C.dark);
  shockwave(p, radius * 1.6, 0xffb070, 0.5); shockwave(p, radius * 0.9, 0xfff0c0, 0.25);
  if (p.y < 0.6) decal(SCORCH, V3(p.x, 0.01, p.z), [0, 1, 0], radius * 0.9);
  boomLight.position.set(p.x, p.y + 1.5, p.z); boomLight.intensity = big ? 1400 : 900;
  const d = p.distanceTo(camera.position); addShake(clamp(1.4 - d / 22, 0, 1) * (big ? 1.2 : 0.9));
  sfx("explosion", { ...pan3(p), big }); if (d < radius * 2.5) G.hitStop = Math.max(G.hitStop, 0.03);
  // damage: enemies (player multiplier applies), and the player (never multiplied, scaled by selfK)
  for (const e of foes()) {
    if (!e.alive) continue;
    const c = e.center(), dd = c.distanceTo(p); if (dd > radius) continue;
    const f = 1 - (dd / radius) * 0.7; if (!world.los(V3(p.x, p.y + 0.4, p.z), c) && dd > 1.5) continue;
    damageFoe(e, dmg * f, { part: "body", explosive: true, owner, dir: V3().subVectors(c, p).normalize(), point: c });
  }
  if (P.alive) {
    const pc = V3(P.pos.x, P.pos.y + 1, P.pos.z), dd = pc.distanceTo(p);
    if (dd < radius && (world.los(V3(p.x, p.y + 0.4, p.z), pc) || dd < 1.5)) {
      const base = dmg * (1 - (dd / radius) * 0.7);
      hurtPlayer(owner === "player" ? base * selfK * AUG.blastShield() : base, p, "explosion");
      P.vel.addScaledVector(V3().subVectors(pc, p).setY(0.6).normalize(), 9 * (1 - dd / radius));
    }
  }
}

/* ================================================================ player */
const P = { pos: V3(0, 0, 34), vel: V3(), yaw: 0, pitch: 0, ground: true, eye: 1.62, crouch: 0, slideT: 0, slideV: V3(), slideCD: 0, health: 100, maxHealth: 100, armor: 150, maxArmor: 150,
  lastHurt: -99, recharging: false, ads: 0, alive: true, airT: 0, bob: 0, landDip: 0, recoilP: 0, recoilY: 0, roll: 0, stepT: 0, lastSwap: -99, swapPrev: 0, kick: 0, sway: V3(), vmSway: V3() };
const opShadow = F.makeOperatorShadow(); scene.add(opShadow.root);
const RADIUS = 0.36;
// horizontal collision against boxes; returns the floor height under the player
function collidePlayer(p, r, feet, head) {
  for (const c of world.colliders) {
    if (feet >= c.y1 - 0.02 || head <= c.y0) continue;
    const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r) continue;
    if (d2 > 1e-8) { const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k; }
    else { const px = Math.min(p.x - c.x0, c.x1 - p.x), pz = Math.min(p.z - c.z0, c.z1 - p.z); if (px < pz) p.x = p.x - c.x0 < c.x1 - p.x ? c.x0 - r : c.x1 + r; else p.z = p.z - c.z0 < c.z1 - p.z ? c.z0 - r : c.z1 + r; }
  }
}
function floorAt(x, z, r, feet) {
  let f = 0;
  for (const c of world.colliders) { if (c.kind === "edge") continue; if (x + r * 0.7 < c.x0 || x - r * 0.7 > c.x1 || z + r * 0.7 < c.z0 || z - r * 0.7 > c.z1) continue; if (c.y1 <= feet + 0.35 && c.y1 > f) f = c.y1; }
  return f;
}
const FWD = V3(), RIGHT = V3(), UPV = V3(0, 1, 0), TMP = V3(), TMP2 = V3();
function updatePlayer(dt) {
  if (!P.alive) { P.vel.multiplyScalar(Math.exp(-4 * dt)); return; }
  // look
  P.yaw -= IN.lookX; P.pitch = clamp(P.pitch - IN.lookY, -1.5, 1.5); IN.lookX = IN.lookY = 0;
  FWD.set(-Math.sin(P.yaw), 0, -Math.cos(P.yaw)); RIGHT.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  const wish = TMP.set(0, 0, 0).addScaledVector(FWD, -IN.move.z).addScaledVector(RIGHT, IN.move.x);
  const moving = wish.lengthSq() > 0.01; if (moving) wish.normalize();
  const W = curW();
  const sprinting = IN.sprint && IN.move.z < -0.3 && P.ads < 0.3 && P.crouch < 0.5 && !W.reloading && P.slideT <= 0 && !IN.fire;
  P.sprinting = sprinting;
  // crouch / slide
  if (IN.crouchP && P.ground && P.slideT <= 0 && P.slideCD <= 0) {
    const hs = Math.hypot(P.vel.x, P.vel.z);
    if (hs > 6.2 && (IN.sprint || P.sprintedT > 0)) { P.slideT = 0.85; P.slideV.set(P.vel.x, 0, P.vel.z).normalize().multiplyScalar(Math.max(hs, 7) * 1.42 * AUG.move()); sfx("slide"); P.slideCD = 0.6; addStyleEvent("slideStart"); }
  }
  P.sprintedT = sprinting ? 0.25 : Math.max(0, (P.sprintedT || 0) - dt);
  P.slideCD -= dt;
  const crouchWant = (IN.crouch || P.slideT > 0) ? 1 : 0;
  // can't stand up under something
  P.crouch = damp(P.crouch, crouchWant, 14, dt);
  const speed = (P.crouch > 0.5 ? 2.9 : sprinting ? 7.7 : 5.3) * (P.ads > 0.5 ? 0.62 : 1) * AUG.move() * (G.overdrive > 0 ? 1.1 : 1);
  if (P.slideT > 0) {
    P.slideT -= dt; P.slideV.multiplyScalar(Math.exp(-1.6 * dt));
    P.vel.x = P.slideV.x + wish.x * 1.2; P.vel.z = P.slideV.z + wish.z * 1.2;
    if (P.slideT <= 0 || P.slideV.length() < 3.5) P.slideT = 0;
    if (Math.random() < 0.6) SOFT.emit(P.pos.x + rnd(-0.3, 0.3), 0.1, P.pos.z + rnd(-0.3, 0.3), -P.vel.x * 0.1, rnd(0.3, 1), -P.vel.z * 0.1, 0.8, 0.4, 1.4, 0.3, C.splash, 2, 0);
  } else if (P.ground) {
    const accel = 62, fr = 11;
    const hv = TMP2.set(P.vel.x, 0, P.vel.z);
    hv.multiplyScalar(Math.max(0, 1 - fr * dt * (moving ? 0.55 : 1)));
    if (moving) { const cur = hv.dot(wish), add = clamp(speed - cur, 0, accel * dt); hv.addScaledVector(wish, add); }
    if (hv.length() > speed && P.slideT <= 0) hv.multiplyScalar(lerp(1, speed / hv.length(), 1 - Math.exp(-10 * dt)));
    P.vel.x = hv.x; P.vel.z = hv.z;
  } else if (moving) { P.vel.x += wish.x * 9 * dt; P.vel.z += wish.z * 9 * dt; const h = Math.hypot(P.vel.x, P.vel.z), cap = Math.max(speed, 8.5); if (h > cap) { P.vel.x *= cap / h; P.vel.z *= cap / h; } }
  // jump
  if (IN.jumpP && P.ground) { P.vel.y = 6.9; P.ground = false; if (P.slideT > 0) { P.slideT = 0; P.vel.x *= 1.08; P.vel.z *= 1.08; } sfx("jump"); }
  P.vel.y -= 21 * dt;
  // integrate with collision
  const steps = 3, sdt = dt / steps;
  for (let s = 0; s < steps; s++) {
    P.pos.x += P.vel.x * sdt; P.pos.z += P.vel.z * sdt; P.pos.y += P.vel.y * sdt;
    collidePlayer(P.pos, RADIUS, P.pos.y + 0.05, P.pos.y + lerp(1.75, 1.15, P.crouch));
    const fl = floorAt(P.pos.x, P.pos.z, RADIUS, P.pos.y);
    if (P.pos.y <= fl) {
      if (!P.ground && P.vel.y < -4) { const k = clamp(-P.vel.y / 14, 0, 1); P.landDip = 0.14 * k; sfx("land", { k }); addShake(0.08 * k); }
      P.pos.y = fl; P.vel.y = Math.max(0, P.vel.y); P.ground = true;
    } else if (P.pos.y > fl + 0.06) P.ground = false;
    else if (P.ground) P.pos.y = fl;   // step down onto small ledges
  }
  P.airT = P.ground ? 0 : P.airT + dt;
  // footsteps (wet splashes)
  const hs = Math.hypot(P.vel.x, P.vel.z);
  if (P.ground && hs > 1.5 && P.slideT <= 0) { P.stepT -= dt * hs * (sprinting ? 0.42 : 0.5); if (P.stepT <= 0) { P.stepT = 1; sfx("step", { gain: P.crouch > 0.5 ? 0.1 : 0.22 }); } }
  P.bob += dt * hs * (P.ground && P.slideT <= 0 ? 1 : 0) * 1.35;
  // armour recharge: 55/s after one second without damage
  if (G.time - P.lastHurt > 1 - AUG.rechargeDelay() && P.armor < P.maxArmor) {
    if (!P.recharging) { P.recharging = true; sfx("armorCharge"); HUD.armorCharge(true); }
    P.armor = Math.min(P.maxArmor, P.armor + (55 + AUG.rechargeRate()) * dt);
    if (P.armor >= P.maxArmor) { P.recharging = false; sfx("armorFull"); HUD.armorCharge(false); }
  }
  // player body (shadow only) follows the camera
  opShadow.root.position.set(P.pos.x, P.pos.y, P.pos.z); opShadow.root.rotation.y = P.yaw + Math.PI;
  const run = clamp(hs / 6, 0, 1), cr = P.crouch;
  opShadow.actions.idle.setEffectiveWeight((1 - run) * (1 - cr)); opShadow.actions.run.setEffectiveWeight(run * (1 - cr)); opShadow.actions.walk.setEffectiveWeight(0); opShadow.actions.crouch.setEffectiveWeight(cr);
  opShadow.mixer.update(dt);
  opShadow.j.chest.rotation.x -= P.pitch * 0.5;
}
function hurtPlayer(dmg, from, kind = "bullet") {
  if (!P.alive || G.state !== "play" || GOD) return;
  P.lastHurt = G.time; if (P.recharging) { P.recharging = false; HUD.armorCharge(false); }
  const p = from ? pan3(from) : { pan: 0 };
  if (P.armor > 0) {
    const a = Math.min(P.armor, dmg); P.armor -= a; dmg -= a; sfx("armorHit", p); HUD.flash("armor");
    if (P.armor <= 0) { sfx("armorBreak"); HUD.armorBreak(); }
  }
  if (dmg > 0) { P.health -= dmg; sfx("hurt", p); HUD.flash("health"); }
  if (from) HUD.damageArc(from, clamp((dmg + 8) / 30, 0.4, 1));
  addShake(kind === "explosion" ? 0.5 : 0.12);
  styleHit(dmg + 4);
  G.stats.taken += dmg;
  if (P.health <= 0) { P.health = 0; playerDie(); }
}
function pan3(p) {   // stereo pan + distance gain for a world position
  const dx = p.x - camera.position.x, dz = p.z - camera.position.z, d = Math.hypot(dx, dz, p.y - camera.position.y);
  const rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  return { pan: clamp((dx * rx + dz * rz) / Math.max(1, d), -0.9, 0.9), gain: clamp(1.4 / (1 + d / 12), 0, 1) };
}

/* ================================================================ weapons */
F.MAT.reddot.depthTest = true;
const WEAPONS = [
  { id: "rifle", name: "AR-7 CARBINE", size: 30, mag: 30, res: 210, maxRes: 330, interval: 0.085, dmg: 24, spreadHip: 0.03, spreadAds: 0.0018, recoil: 0.0105, recoilYaw: 0.004, reload: 1.7, adsFov: 50, shell: "brass", fp: F.fpRifle(), flash: flashMesh(0.26) },
  { id: "shotgun", name: "SG-12 BREACHER", size: 8, mag: 8, res: 40, maxRes: 72, interval: 0.26, pellets: 9, dmg: 13, spreadHip: 0.07, spreadAds: 0.048, recoil: 0.045, recoilYaw: 0.01, reloadShell: 0.4, adsFov: 64, shell: "shell", fp: F.fpShotgun(), flash: flashMesh(0.4) },
  { id: "launcher", name: "RL-4 BREACH LAUNCHER", size: 1, mag: 1, res: 6, maxRes: 12, interval: 0.55, dmg: 120, splash: 190, radius: 5.5, recoil: 0.06, recoilYaw: 0.01, reload: 1.9, adsFov: 58, fp: F.fpLauncher(), flash: flashMesh(0.6) },
];
for (const w of WEAPONS) { w.fp.group.visible = false; w.flash.position.copy(w.fp.muzzle.position); w.fp.group.add(w.flash); w.cool = 0; w.reloading = false; w.rT = 0; w.pump = 0; }
const vmRoot = new THREE.Group(); vmCam.add(vmRoot);
const holder = new THREE.Group(); vmRoot.add(holder);
for (const w of WEAPONS) holder.add(w.fp.group);
const ARMS = F.fpArms(); for (const s of ["r", "l"]) for (const k of ["up", "fore", "cuff", "hand"]) vmRoot.add(ARMS[s][k]);
const nadeHand = F.grenadeMesh(); nadeHand.visible = false; vmRoot.add(nadeHand);
const W8 = { cur: 0, prev: 1, swapT: 0, swapTo: -1, nades: 3, maxNades: 3, meleeT: 0, throwT: 0, fireHeld: false, lastShot: -9, shots: 0, hits: 0 };
const curW = () => WEAPONS[W8.cur];
WEAPONS[0].fp.group.visible = true;
const zoomSensK = () => curW().adsFov / settings.fov;
function resetLoadout() {
  for (const w of WEAPONS) { w.mag = w.size; w.res = { rifle: 210, shotgun: 40, launcher: 6 }[w.id]; w.cool = 0; w.reloading = false; w.rT = 0; w.pump = 0; if (w.fp.rocket) w.fp.rocket.visible = true; if (w.fp.mag) w.fp.mag.visible = true; }
  Object.assign(W8, { cur: 0, prev: 1, swapT: 0, swapTo: -1, nades: 3, maxNades: 3, meleeT: 0, throwT: 0 });
  WEAPONS.forEach((w, i) => (w.fp.group.visible = i === 0));
}
function selectWeapon(i) {
  if (i === W8.cur || W8.swapTo >= 0 || i < 0 || i > 2) return;
  W8.swapTo = i; W8.swapT = 0.3 * AUG.handling(); curW().reloading = false; sfx("swap");
}
function startReload() {
  const w = curW(); if (w.reloading || w.mag >= w.size + AUG.magBonus(w) || w.res <= 0 || G.overdrive > 0) return;
  w.reloading = true; w.rT = 0; sfx("reload", { kind: w.id === "shotgun" ? "shell" : w.id });
}
const SPREAD_V = V3(), RAY_O = V3(), RAY_D = V3(), HIT_P = V3(), RH = {};
function fire(dtNow) {
  const w = curW();
  if (w.cool > 0 || W8.swapTo >= 0 || W8.meleeT > 0 || W8.throwT > 0 || P.sprinting) return;
  if (w.reloading) { if (w.id === "shotgun" && w.mag > 0) w.reloading = false; else return; }   // shotgun: firing interrupts loading
  const od = G.overdrive > 0;
  if (w.mag <= 0 && !od) { if (!W8.fireHeld) sfx("empty"); W8.fireHeld = true; if (w.res > 0) startReload(); return; }
  if (!od) w.mag--;
  w.cool = w.interval / (od ? 1.6 : 1); W8.lastShot = G.time; G.lastFire = G.time;
  const steady = AUG.steady();
  const spread = lerp(w.spreadHip, w.spreadAds, P.ads) * (P.ground ? 1 : 1.6) * (P.sprinting ? 2 : 1) * steady * (1 + Math.min(1, P.kick * 6) * 0.6);
  // camera kick, weapon kick
  P.recoilP += w.recoil * (P.ads > 0.5 ? 0.75 : 1) * steady; P.recoilY += (Math.random() - 0.5) * w.recoilYaw * 2 * steady; P.kick = Math.min(0.12, P.kick + (w.id === "rifle" ? 0.022 : w.id === "shotgun" ? 0.07 : 0.09));
  addShake(w.id === "rifle" ? 0.02 : w.id === "shotgun" ? 0.12 : 0.2);
  w.flash.visible = true; w.flash.rotation.z = Math.random() * 6; w.flash.scale.setScalar(rnd(0.8, 1.2)); w.flashT = 0.045;
  flashLight.intensity = 30; vmFlash.intensity = 6;
  sfx(w.id === "rifle" ? "rifle" : w.id === "shotgun" ? "shotgun" : "rocketFire", { pan: 0, gain: 1 });
  // world positions of the muzzle and ejection port (viewmodel space → world)
  vmRoot.updateMatrixWorld(true);
  const muzzleW = vmToWorld(w.fp.muzzle);
  if (w.shell) setTimeout(() => ejectShell(w.shell, vmToWorld(w.fp.eject), RIGHT, UPV), w.id === "shotgun" ? 120 : 0);
  if (w.id === "shotgun") w.pump = 1;
  RAY_O.copy(camera.position);
  if (w.id === "launcher") {
    camera.getWorldDirection(RAY_D); if (w.fp.rocket) w.fp.rocket.visible = false;
    spawnRocket(muzzleW, RAY_D, "player"); if (!od && w.mag <= 0 && w.res > 0) setTimeout(() => G.state === "play" && W8.cur === 2 && startReload(), 350);
    return;
  }
  const n = w.pellets || 1;
  W8.shots++;
  let hitAny = false;
  for (let k = 0; k < n; k++) {
    camera.getWorldDirection(RAY_D);
    const a = Math.random() * 6.28, r = spread * Math.sqrt(Math.random());
    SPREAD_V.set(Math.cos(a) * r, Math.sin(a) * r, 0).applyQuaternion(camera.quaternion); RAY_D.add(SPREAD_V).normalize();
    const res = shootRay(RAY_O, RAY_D, 200, w, k === 0);
    if (res) hitAny = true;
    if (k < (w.id === "shotgun" ? 4 : 1)) tracer(k === 0 ? muzzleW : muzzleW.clone().addScaledVector(RAY_D, 0.1), HIT_P.clone(), w.id === "shotgun" ? 0xffb15a : 0xffd590, w.id === "shotgun" ? 0.016 : 0.02);
  }
  if (hitAny) W8.hits++;
  if (!od && w.mag <= 0 && w.res > 0 && w.id !== "shotgun") setTimeout(() => G.state === "play" && curW() === w && startReload(), 260);
}
const vmToWorld = (o) => { const p = o.getWorldPosition(V3()); return p.applyMatrix4(vmCam.matrixWorldInverse).applyMatrix4(camera.matrixWorld); };
// hitscan: nearest of enemy hit-spheres and world boxes
function shootRay(o, d, max, w, primary) {
  world.raycast(o, d, max, RH); let best = RH.t, hitFoe = null, hitPart = null;
  for (const e of foes()) {
    if (!e.alive || e === P) continue;
    const h = e.rayHit(o, d, best); if (h) { best = h.t; hitFoe = e; hitPart = h.part; }
  }
  HIT_P.copy(o).addScaledVector(d, best);
  if (hitFoe) {
    const dist = best, fall = w.id === "shotgun" ? clamp(1.25 - dist / 24, 0.35, 1) : clamp(1.15 - dist / 140, 0.65, 1);
    damageFoe(hitFoe, w.dmg * fall, { part: hitPart, owner: "player", weapon: w.id, dir: d.clone(), point: HIT_P.clone(), dist });
    return true;
  }
  if (RH.n) {
    decal(HOLES, HIT_P, RH.n, w.id === "shotgun" ? 0.07 : 0.1);
    const metal = RH.hit && RH.hit !== "ground" && RH.hit.kind !== "barrier";
    for (let i = 0; i < (primary ? 6 : 2); i++) GLOW.emit(HIT_P.x, HIT_P.y, HIT_P.z, RH.n[0] * rnd(1, 5) + rnd(-2, 2), RH.n[1] * rnd(1, 5) + rnd(0, 3), RH.n[2] * rnd(1, 5) + rnd(-2, 2), rnd(0.15, 0.4), 0.06, 0.02, 1, metal ? C.spark : C.spark2, 2, 9);
    if (primary) { SOFT.emit(HIT_P.x, HIT_P.y, HIT_P.z, RH.n[0], RH.n[1] + 0.3, RH.n[2], 0.7, 0.15, 0.7, 0.45, RH.hit === "ground" && world.puddleAt(HIT_P.x, HIT_P.z) ? C.splash : C.dust, 2, -0.2); if (Math.random() < 0.5) chunk(HIT_P.clone(), V3(RH.n[0] * 3 + rnd(-1, 1), RH.n[1] * 3 + rnd(1, 3), RH.n[2] * 3 + rnd(-1, 1)), rnd(0.02, 0.05), metal ? C.dark : C.dust); sfx(metal ? "hitMetal" : "impact", pan3(HIT_P)); }
  }
  return false;
}
// melee: a fast rifle-butt strike, big damage in a short cone
function melee() {
  if (W8.meleeT > 0 || W8.throwT > 0 || W8.swapTo >= 0) return;
  W8.meleeT = 0.42; sfx("swing"); curW().reloading = false;
  setTimeout(() => {
    if (G.state !== "play") return;
    let best = null, bd = 2.6;
    camera.getWorldDirection(RAY_D);
    for (const e of foes()) { if (!e.alive) continue; const c = e.center(), to = V3().subVectors(c, camera.position), d = to.length(); if (d > bd + (e.big ? 1 : 0)) continue; to.normalize(); if (to.dot(RAY_D) > 0.55) { bd = d; best = e; } }
    if (best) { damageFoe(best, 75, { part: "body", owner: "player", weapon: "melee", melee: true, dir: RAY_D.clone(), point: best.center() }); sfx("meleeHit"); addShake(0.25); G.hitStop = Math.max(G.hitStop, 0.06); best.knock(RAY_D, 6); }
  }, 110);
}
function throwGrenade() {
  if (W8.nades <= 0 || W8.throwT > 0 || W8.meleeT > 0) return;
  W8.nades--; W8.throwT = 0.55; sfx("grenadeThrow"); curW().reloading = false;
  setTimeout(() => {
    if (G.state !== "play") return;
    camera.getWorldDirection(RAY_D);
    const p = camera.position.clone().addScaledVector(RAY_D, 0.6).addScaledVector(RIGHT, -0.15);
    spawnGrenade(p, V3().copy(RAY_D).multiplyScalar(17).add(V3(0, 4, 0)).add(P.vel.clone().multiplyScalar(0.6)), "player");
  }, 210);
}

/* ---- projectiles: rockets, grenades, plasma bolts ---- */
const PROJ = [];
const boltMat = new THREE.MeshBasicMaterial({ color: 0x7fe6ff, toneMapped: false }), rocketMat = F.MAT.exoFrame;
const boltGeo = new THREE.CapsuleGeometry(0.06, 0.5, 2, 6); boltGeo.rotateX(Math.PI / 2);
const rocketGeo = new THREE.CylinderGeometry(0.05, 0.06, 0.6, 8); rocketGeo.rotateX(Math.PI / 2);
function spawnRocket(p, d, owner, speed = 46, opts = {}) {
  const m = new THREE.Mesh(rocketGeo, rocketMat); m.position.copy(p); m.lookAt(V3().copy(p).add(d)); scene.add(m);
  PROJ.push({ kind: "rocket", m, v: V3().copy(d).multiplyScalar(speed), owner, t: 6, dmg: opts.dmg ?? 190, radius: opts.radius ?? 5.5, homing: opts.homing || 0, src: opts.src });
}
function spawnGrenade(p, v, owner, fuse = 2.0) {
  const m = F.grenadeMesh(); m.position.copy(p); scene.add(m);
  PROJ.push({ kind: "grenade", m, v, owner, t: fuse, dmg: 150, radius: 6 * AUG.blastRadius(), spin: V3(rnd(-9, 9), rnd(-9, 9), rnd(-9, 9)) });
}
function spawnBolt(p, d, owner, dmg = 13, speed = 32, color = 0x7fe6ff, src = null) {
  const m = new THREE.Mesh(boltGeo, boltMat.clone()); m.material.color.set(color); m.position.copy(p); m.lookAt(V3().copy(p).add(d)); scene.add(m);
  PROJ.push({ kind: "bolt", m, v: V3().copy(d).multiplyScalar(speed), owner, t: 3, dmg, src });
}
function updateProjectiles(dt) {
  for (let i = PROJ.length - 1; i >= 0; i--) {
    const pr = PROJ[i], m = pr.m; pr.t -= dt;
    if (pr.kind === "grenade") {
      pr.v.y -= 20 * dt; const prev = m.position.clone(); m.position.addScaledVector(pr.v, dt); m.rotation.x += pr.spin.x * dt; m.rotation.z += pr.spin.z * dt;
      if (m.position.y < 0.05) { m.position.y = 0.05; if (pr.v.y < -2) sfx("bounce", pan3(m.position)); pr.v.y *= -0.42; pr.v.x *= 0.62; pr.v.z *= 0.62; pr.spin.multiplyScalar(0.6); }
      const d = V3().subVectors(m.position, prev), L = d.length();
      if (L > 1e-4) { d.divideScalar(L); world.raycast(prev, d, L + 0.06, RH); if (RH.t < L + 0.06 && RH.hit !== "ground") { m.position.copy(prev).addScaledVector(d, RH.t - 0.06); const n = V3(...RH.n); pr.v.reflect(n).multiplyScalar(0.5); sfx("bounce", pan3(m.position)); } }
      if (pr.t <= 0) { explode(m.position.clone(), { radius: pr.radius, dmg: pr.dmg, owner: pr.owner }); scene.remove(m); PROJ.splice(i, 1); }
      continue;
    }
    if (pr.homing && P.alive) { const to = V3(P.pos.x, P.pos.y + 1, P.pos.z).sub(m.position).normalize(), sp = pr.v.length(); pr.v.lerp(to.multiplyScalar(sp), clamp(pr.homing * dt, 0, 1)).setLength(sp); m.lookAt(V3().copy(m.position).add(pr.v)); }
    const prev = m.position.clone(), step = pr.v.length() * dt, dir = pr.v.clone().normalize();
    m.position.addScaledVector(pr.v, dt);
    if (pr.kind === "rocket") { SOFT.emit(prev.x, prev.y, prev.z, rnd(-0.3, 0.3), rnd(0, 0.5), rnd(-0.3, 0.3), 1.2, 0.3, 1.6, 0.4, C.smoke, 1, -0.2); GLOW.emit(prev.x, prev.y, prev.z, -dir.x * 4, -dir.y * 4, -dir.z * 4, 0.12, 0.45, 0.2, 1, C.fire, 0, 0); }
    else GLOW.emit(prev.x, prev.y, prev.z, 0, 0, 0, 0.12, 0.35, 0.05, 0.8, pr.m.material.color, 0, 0);
    // hits: world, combatants
    world.raycast(prev, dir, step, RH); let tHit = RH.t < step ? RH.t : Infinity, target = null;
    for (const e of combatants()) {
      if (!e.alive || e === pr.src || (pr.owner === "player" && e === P)) continue;
      if (pr.owner !== "player" && pr.owner !== "ffa" && e !== P && G.mode !== "deathmatch") continue;   // enemy fire only hurts the player in Onslaught
      const c = e === P ? V3(P.pos.x, P.pos.y + 1, P.pos.z) : e.center(), r = e === P ? 0.55 : e.radius;
      const oc = V3().subVectors(prev, c), b = oc.dot(dir), cc = oc.lengthSq() - r * r, h = b * b - cc;
      if (h >= 0) { const t = -b - Math.sqrt(h); if (t >= 0 && t < tHit) { tHit = t; target = e; } }
    }
    if (tHit < Infinity || pr.t <= 0) {
      const at = tHit < Infinity ? prev.clone().addScaledVector(dir, tHit) : m.position.clone();
      if (pr.kind === "rocket") explode(at, { radius: pr.radius, dmg: pr.dmg, owner: pr.owner, big: pr.owner !== "player" ? false : true });
      else {
        if (target === P) hurtPlayer(pr.dmg, pr.src ? pr.src.center() : at, "bolt");
        else if (target) damageFoe(target, pr.dmg, { part: "body", owner: pr.owner, src: pr.src, dir, point: at });
        for (let k = 0; k < 10; k++) GLOW.emit(at.x, at.y, at.z, rnd(-4, 4), rnd(-1, 4), rnd(-4, 4), rnd(0.15, 0.35), 0.1, 0.03, 1, pr.m.material.color, 2, 6);
        if (RH.n && !target) decal(HOLES, at, RH.n, 0.18);
      }
      scene.remove(m); if (pr.kind === "bolt") m.material.dispose(); PROJ.splice(i, 1);
    }
  }
}
function clearProjectiles() { for (const pr of PROJ) scene.remove(pr.m); PROJ.length = 0; }

/* ---- viewmodel animation: ADS, sway, bob, kick, reload, pump, swap, melee, throw + two-joint IK arms ---- */
const HQ = new THREE.Quaternion(), HE = new THREE.Euler(), UPY = V3(0, 1, 0);
const SH_R = V3(0.24, -0.34, 0.08), SH_L = V3(-0.2, -0.36, 0.0);
function ikArm(arm, S, T, pole, a = 0.3, b = 0.29) {
  const d = V3().subVectors(T, S), L = clamp(d.length(), 0.05, a + b - 0.002); d.normalize();
  const ca = (a * a + L * L - b * b) / (2 * a * L), sa = Math.sqrt(Math.max(0, 1 - ca * ca));
  const perp = V3().copy(pole).addScaledVector(d, -pole.dot(d)).normalize();
  const E = V3().copy(S).addScaledVector(d, a * ca).addScaledVector(perp, a * sa), Tt = V3().copy(S).addScaledVector(d, L);
  place(arm.up, S, E); place(arm.fore, E, Tt);
  arm.cuff.position.copy(Tt).lerp(E, 0.12); arm.cuff.quaternion.copy(arm.fore.quaternion);
  arm.hand.position.copy(Tt); arm.hand.quaternion.copy(arm.fore.quaternion);
}
function place(m, A, B) { const d = V3().subVectors(B, A), L = d.length(); m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(UPY, d.normalize()); m.scale.set(1, L / 0.34, 1); }
const HIP = V3(), ADSP = V3(), HPOS = V3(), GRIPW = V3(), FOREW = V3();
function updateViewmodel(dt, t) {
  const w = curW(), fp = w.fp;
  // timers
  w.cool = Math.max(0, w.cool - dt);
  if (w.flashT > 0) { w.flashT -= dt; if (w.flashT <= 0) w.flash.visible = false; }
  flashLight.intensity = damp(flashLight.intensity, 0, 40, dt); vmFlash.intensity = damp(vmFlash.intensity, 0, 40, dt); flashLight.position.copy(camera.position).addScaledVector(FWD, 1.2);
  P.kick = damp(P.kick, 0, 14, dt);
  if (W8.swapTo >= 0) { W8.swapT -= dt; if (W8.swapT <= 0.15 && WEAPONS[W8.swapTo] !== w) { w.fp.group.visible = false; W8.prev = W8.cur; W8.cur = W8.swapTo; curW().fp.group.visible = true; P.lastSwap = G.time; } if (W8.swapT <= 0) W8.swapTo = -1; }
  if (W8.meleeT > 0) W8.meleeT -= dt; if (W8.throwT > 0) W8.throwT -= dt;
  // reload state machines
  if (w.reloading) {
    w.rT += dt / AUG.handling();
    if (w.id === "shotgun") {
      if (w.rT >= w.reloadShell) { w.rT = 0; if (w.res > 0 && w.mag < w.size + AUG.magBonus(w)) { w.mag++; w.res--; sfx("reload", { kind: "shell" }); } if (w.mag >= w.size + AUG.magBonus(w) || w.res <= 0) w.reloading = false; }
    } else {
      const dur = w.reload;
      if (fp.mag) fp.mag.visible = !(w.rT > dur * 0.22 && w.rT < dur * 0.55);
      if (fp.rocket) fp.rocket.visible = w.rT > dur * 0.62;
      if (w.rT >= dur) { const want = w.size + AUG.magBonus(w) - w.mag, take = Math.min(want, w.res); w.mag += take; w.res -= take; w.reloading = false; if (fp.mag) fp.mag.visible = true; }
    }
  }
  const adsWant = IN.aim && !P.sprinting && W8.swapTo < 0 && W8.meleeT <= 0 && W8.throwT <= 0 && !(w.reloading && w.id !== "shotgun");
  P.ads = damp(P.ads, adsWant ? 1 : 0, 16, dt);
  // poses
  HIP.copy(fp.hip); ADSP.set(0, -fp.sightY, -fp.eye);
  HPOS.copy(HIP).lerp(ADSP, P.ads);
  const hs = Math.hypot(P.vel.x, P.vel.z), bobK = (1 - P.ads * 0.85) * clamp(hs / 6, 0, 1) * (P.ground ? 1 : 0);
  P.vmSway.x = damp(P.vmSway.x, -IN.swayX * 0.6, 10, dt); P.vmSway.y = damp(P.vmSway.y, IN.swayY * 0.6, 10, dt);
  HPOS.x += Math.sin(P.bob * 2) * 0.012 * bobK + P.vmSway.x * 0.02 * (1 - P.ads * 0.8);
  HPOS.y += -Math.abs(Math.cos(P.bob * 2)) * 0.012 * bobK - P.landDip * 0.4 + P.vmSway.y * 0.02 * (1 - P.ads * 0.8) + Math.sin(t * 1.6) * 0.002 * (1 - P.ads);
  HPOS.z += P.kick * (P.ads > 0.5 ? 0.6 : 1);
  let rx = P.kick * (w.id === "rifle" ? 1.2 : 2.6) * (P.ads > 0.5 ? 0.5 : 1), ry = P.vmSway.x * 0.08, rz = P.vmSway.x * 0.1 * (1 - P.ads);
  const spr = damp(P.sprPose || 0, P.sprinting ? 1 : 0, 9, dt); P.sprPose = spr;
  HPOS.x += spr * 0.04; HPOS.y -= spr * 0.06; rx -= spr * 0.3; ry += spr * 0.75; rz += spr * 0.25;
  let rel = 0;
  if (w.reloading && w.id !== "shotgun") { const u = w.rT / w.reload; rel = Math.sin(Math.min(1, u) * Math.PI); rx += rel * 0.35; rz += rel * 0.5; HPOS.y -= rel * 0.05; }
  if (w.reloading && w.id === "shotgun") { rel = 0.6; rz += 0.5; rx += 0.15; HPOS.y -= 0.03; }
  if (W8.swapTo >= 0) { const u = W8.swapT / 0.3, k = u > 0.5 ? (1 - u) * 2 : u * 2; HPOS.y -= k * 0.25; rx -= k * 0.9; }
  if (W8.meleeT > 0) { const u = 1 - W8.meleeT / 0.42, k = Math.sin(u * Math.PI); HPOS.x -= k * 0.12; HPOS.z -= k * 0.16; ry += k * 0.9; rz += k * 0.5; }
  if (W8.throwT > 0) { const u = 1 - W8.throwT / 0.55; HPOS.y -= Math.sin(u * Math.PI) * 0.08; rz -= Math.sin(u * Math.PI) * 0.3; }
  holder.position.copy(HPOS); holder.rotation.set(rx, ry, rz);
  // shotgun pump and red-dot visibility
  if (fp.pump) { w.pump = Math.max(0, w.pump - dt / (w.interval * 0.7)); const u = w.pump > 0 ? Math.sin((1 - w.pump) * Math.PI) : 0; fp.pump.position.z = fp.pumpHome.z + u * 0.09; }
  if (fp.dot) fp.dot.visible = !w.reloading;
  // arms: right hand on the grip; left hand on the handguard, the magazine, the loading port or a grenade
  holder.updateMatrix(); fp.group.updateMatrix();
  GRIPW.copy(fp.grip).applyMatrix4(fp.group.matrix).applyMatrix4(holder.matrix);
  FOREW.copy(fp.pump ? V3(0, -0.04, fp.pump.position.z + 0.02) : fp.fore).applyMatrix4(fp.group.matrix).applyMatrix4(holder.matrix);
  if (w.reloading && w.id === "rifle" && fp.mag) { const u = w.rT / w.reload; FOREW.lerp(V3(0, -0.12, -0.06).applyMatrix4(fp.group.matrix).applyMatrix4(holder.matrix).add(V3(0, -0.12 * Math.sin(u * Math.PI), 0)), Math.sin(Math.min(1, u * 1.2) * Math.PI)); }
  if (w.reloading && w.id === "shotgun") FOREW.lerp(V3(0, -0.07, -0.05 + Math.sin(G.time * 15) * 0.02).applyMatrix4(fp.group.matrix).applyMatrix4(holder.matrix), 0.85);
  if (W8.throwT > 0) { const u = 1 - W8.throwT / 0.55; FOREW.set(-0.25 + u * 0.12, -0.1 + Math.sin(u * Math.PI) * 0.25, -0.35 - Math.sin(u * Math.PI) * 0.15); nadeHand.visible = u < 0.4; nadeHand.position.copy(FOREW); } else nadeHand.visible = false;
  ikArm(ARMS.r, SH_R, GRIPW, V3(1, -0.6, 0.4)); ikArm(ARMS.l, SH_L, FOREW, V3(-1, -0.8, 0.2));
  // hide the viewmodel during death
  vmRoot.visible = P.alive;
}

/* ================================================================ augments (stackable, picked between waves) */
const AUGS = [
  { id: "hollow", name: "Hollow Points", desc: "+15% weapon damage", max: 5, icon: "◆" },
  { id: "quick", name: "Quick Hands", desc: "Reload and swap 20% faster", max: 4, icon: "⟲" },
  { id: "plate", name: "Plate Weave", desc: "+30 max armor", max: 4, icon: "⬢" },
  { id: "fast", name: "Rapid Recharge", desc: "Armor recharges sooner and faster", max: 3, icon: "⚡" },
  { id: "adren", name: "Adrenal Gland", desc: "+8% move and slide speed", max: 3, icon: "»" },
  { id: "scav", name: "Scavenger", desc: "+40% pickup value, longer magnet", max: 3, icon: "✚" },
  { id: "deep", name: "Deep Mags", desc: "+30% magazine size", max: 3, icon: "▤" },
  { id: "over", name: "Overclock", desc: "Overdrive charges 35% faster, lasts +1.5 s", max: 3, icon: "◎" },
  { id: "frag", name: "Frag Belt", desc: "+1 grenade, +20% blast radius", max: 3, icon: "●" },
  { id: "steady", name: "Steady Hands", desc: "-28% recoil and spread", max: 3, icon: "✛" },
  { id: "vamp", name: "Leech Rounds", desc: "Headshot and weak-point kills heal 8", max: 3, icon: "♥" },
  { id: "shield", name: "Blast Shield", desc: "-40% damage from your own explosives", max: 2, icon: "◐" },
];
const AUG = {
  s: {}, n(id) { return this.s[id] || 0; },
  damage() { return 1 + 0.15 * this.n("hollow"); }, handling() { return Math.pow(0.8, this.n("quick")); },
  magBonus(w) { return w.id === "launcher" ? this.n("deep") : Math.round(w.size * 0.3 * this.n("deep")); },
  move() { return 1 + 0.08 * this.n("adren"); }, steady() { return Math.pow(0.72, this.n("steady")); },
  rechargeDelay() { return Math.min(0.6, 0.22 * this.n("fast")); }, rechargeRate() { return 18 * this.n("fast"); },
  scav() { return 1 + 0.4 * this.n("scav"); }, odGain() { return 1 + 0.35 * this.n("over"); }, odDur() { return 8 + 1.5 * this.n("over"); },
  blastShield() { return Math.pow(0.6, this.n("shield")); }, blastRadius() { return 1 + 0.2 * this.n("frag"); }, vamp() { return 8 * this.n("vamp"); },
};
function applyAugment(id) {
  AUG.s[id] = AUG.n(id) + 1;
  if (id === "plate") { P.maxArmor += 30; P.armor = P.maxArmor; }
  if (id === "frag") { W8.maxNades++; W8.nades = W8.maxNades; }
  if (id === "deep") for (const w of WEAPONS) w.mag = w.size + AUG.magBonus(w);
}

/* ================================================================ style rank, score and Overdrive */
const RANKS = ["D", "C", "B", "A", "S", "SS", "SSS"], RANK_NAMES = ["Dull", "Cool", "Bold", "Ace", "Savage", "Sick Style", "Supreme"];
const RANK_MULT = [1, 1.2, 1.5, 2, 3, 4, 6];
const rankOf = () => clamp(Math.floor(G.style / 100), 0, 6);
function addStyle(pts, label) {
  const before = rankOf();
  G.style = clamp(G.style + pts, 0, 699); G.styleIdle = 0;
  G.odMeter = Math.min(100, G.odMeter + pts * 0.16 * AUG.odGain() * (G.overdrive > 0 ? 0 : 1));
  if (G.odMeter >= 100 && !G.odReady && G.overdrive <= 0) { G.odReady = true; sfx("overdriveReady"); HUD.toast("OVERDRIVE READY", "Press " + (IN.last === "pad" ? "D-pad ↑" : IN.last === "touch" ? "OD" : "F"), "od"); }
  if (label) HUD.styleEvent(label, pts);
  const after = rankOf(); if (after > before) { sfx("rankUp", { rank: after }); HUD.rankUp(after); G.stats.bestRank = Math.max(G.stats.bestRank, after); }
}
function styleHit(dmg) { const before = rankOf(); G.style = Math.max(0, G.style - dmg * 1.3); if (rankOf() < before) { sfx("rankDown"); HUD.rankDown(); } }
function addStyleEvent(kind) { if (kind === "slideStart") G.lastSlide = G.time; }
function activateOverdrive() {
  if (G.odMeter < 100 || G.overdrive > 0) return;
  G.overdrive = AUG.odDur(); G.odMeter = 100; G.odReady = false; sfx("overdriveOn"); HUD.toast("OVERDRIVE", "Faster fire · unlimited ammo", "od"); addShake(0.3);
  for (const w of WEAPONS) { w.reloading = false; if (w.fp.rocket) w.fp.rocket.visible = true; if (w.fp.mag) w.fp.mag.visible = true; }
}

/* ================================================================ enemies: templates, instances, AI */
const KINDS = {
  wolf: { make: () => F.makeMerc("wolf"), hp: 110, speed: 4.4, radius: 0.5, range: 28, weapon: "rifle", score: 100, label: "Wolf merc" },
  boar: { make: () => F.makeMerc("boar"), hp: 135, speed: 4.0, radius: 0.5, range: 15, weapon: "scatter", score: 110, label: "Boar merc" },
  sentinel: { make: () => F.makeSentinel(), hp: 175, speed: 3.3, radius: 0.5, range: 32, weapon: "plasma", score: 150, label: "Sentinel", robot: true },
  dog: { make: () => F.makeDog(), hp: 80, speed: 9.6, radius: 0.55, range: 18, weapon: "dog", score: 120, label: "Hound", robot: true },
  exo: { make: () => F.makeExo(false), hp: 620, speed: 2.5, radius: 0.85, range: 30, weapon: "minigun", score: 400, label: "Exo heavy", big: true },
  boss: { make: () => F.makeExo(true), hp: 6400, speed: 2.9, radius: 1.25, range: 70, weapon: "boss", score: 5000, label: "THE FOREMAN", big: true },
};
const TEMPL = {};
// Streaming: a template is built (and its shaders compiled) once per kind; instances clone it and share geometry.
function ensureKind(kind) {
  if (TEMPL[kind]) return TEMPL[kind];
  const t = KINDS[kind].make();
  t.muzzle.name = "muzzle"; if (t.core) t.core.name = "core"; if (t.pods) t.pods.forEach((p, i) => (p.name = "pod" + i));
  TEMPL[kind] = t; return t;
}
const ENEMIES = [];
const foes = () => ENEMIES;
const combatants = () => [P, ...ENEMIES];
let flowField = new Uint16Array(world.nav.NX * world.nav.NZ), flowT = 0;
const flowCache = new Map();
function flowFor(target) {
  if (target === P && G.mode === "onslaught") return flowField;
  let c = flowCache.get(target); if (!c) { c = { f: new Uint16Array(world.nav.NX * world.nav.NZ), t: -9 }; flowCache.set(target, c); }
  if (G.time - c.t > 0.6) { const p = target === P ? P.pos : target.root.position; world.flow(p.x, p.z, c.f); c.t = G.time + Math.random() * 0.2; }
  return c.f;
}
const SPH = V3(), OC = V3();
class Enemy {
  constructor(kind, pos, opts = {}) {
    const K = this.K = KINDS[kind], T = ensureKind(kind);
    this.kind = kind; this.root = T.root.clone(true); this.root.position.copy(pos); scene.add(this.root);
    this.j = {}; this.root.traverse((o) => { if (o.name) this.j[o.name] = o; if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.muzzle = this.j.muzzle; this.core = this.j.core; this.pods = [this.j.pod0, this.j.pod1].filter(Boolean);
    this.scale = T.scale || 1; this.radius = K.radius; this.big = !!K.big; this.robot = !!K.robot;
    this.hit = T.hit.map((h) => ({ bone: this.j[h.bone.name], off: h.off, r: h.r * this.scale, part: h.part }));
    this.mixer = new THREE.AnimationMixer(this.root); this.actions = {};
    for (const [k, a] of Object.entries(T.actions)) { const na = this.mixer.clipAction(a.getClip()); na.play(); na.setEffectiveWeight(k === "idle" ? 1 : 0); na.time = Math.random() * a.getClip().duration; this.actions[k] = na; }
    const hpK = G.mode === "onslaught" ? 1 + (G.wave - 1) * 0.06 : 1;
    this.hp = this.maxHp = (opts.hp || K.hp) * hpK; this.alive = true; this.yaw = Math.random() * 6.28; this.vel = V3(); this.speed = K.speed * rnd(0.92, 1.08);
    this.fireT = rnd(1.2, 2.4); this.burst = 0; this.burstT = 0; this.strafe = Math.random() < 0.5 ? -1 : 1; this.strafeT = rnd(1, 2.5); this.flinch = 0; this.stagger = 0;
    this.deadT = 0; this.alert = 0; this.target = null; this.targetT = 0; this.name = opts.name || K.label; this.ffa = !!opts.ffa; this.kills = 0; this.deaths = 0; this.lastAttacker = null;
    this.spin = 0; this.cool = 0; this.phase = 1; this.invuln = 0; this.special = 4; this.stompCD = 2; this.lungeCD = 1; this.dash = 0; this.aimPitch = 0; this.dmgK = G.mode === "onslaught" ? 1 + (G.wave - 1) * 0.05 : 1;
    this.root.rotation.y = this.yaw;
  }
  center(out = V3()) { return this.j[this.kind === "dog" ? "body" : "chest"].getWorldPosition(out); }
  rayHit(o, d, maxT) {
    this.center(SPH); OC.subVectors(o, SPH); const b0 = OC.dot(d), c0 = OC.lengthSq() - (2.2 * this.scale) ** 2;
    if (b0 * b0 - c0 < 0) return null;
    let best = null;
    for (const h of this.hit) {
      h.bone.localToWorld(SPH.copy(h.off)); OC.subVectors(o, SPH);
      const b = OC.dot(d), c = OC.lengthSq() - h.r * h.r, disc = b * b - c; if (disc < 0) continue;
      const t = -b - Math.sqrt(disc); if (t < 0 || t > maxT) continue;
      // small precise zones (head, weak points, core) win over a big zone they sit inside
      const pri = h.part === "head" || h.part === "weak" || h.part === "core" ? 1 : 0;
      if (h.part === "core" && !(this.core && this.core.visible)) continue;
      if (!best || (pri > best.pri && t < best.t + 0.35) || (pri === best.pri && t < best.t) || (pri < best.pri && t < best.t - 0.35)) best = { t, part: h.part, pri };
    }
    return best;
  }
  knock(dir, f) { this.vel.addScaledVector(dir, f / (this.big ? 4 : 1)); this.stagger = Math.max(this.stagger, this.big ? 0.15 : 0.45); }
  remove() { scene.remove(this.root); this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.root); }
}
function spawnEnemy(kind, pos, opts) { const e = new Enemy(kind, pos, opts); ENEMIES.push(e); return e; }
function pickSpawn(minD = 24) {
  const ok = world.spawns.filter((s) => Math.hypot(s.x - P.pos.x, s.z - P.pos.z) > minD && !ENEMIES.some((e) => e.alive && Math.hypot(e.root.position.x - s.x, e.root.position.z - s.z) < 3));
  const list = ok.length ? ok : world.spawns; return pick(list);
}

// ---- per-enemy brain
const EP = V3(), TP = V3(), DIR = V3(), RHE = {};
function targetPoint(t, out) { if (t === P) return out.set(P.pos.x, P.pos.y + lerp(1.3, 0.85, P.crouch), P.pos.z); return t.center(out); }
function targetVel(t) { return t === P ? P.vel : t.vel; }
function chooseTarget(e) {
  if (!e.ffa) return P.alive ? P : null;
  if (e.target && e.target.alive && G.time - e.targetT < 2.2) return e.target;
  let best = null, bd = 60;
  for (const o of combatants()) {
    if (o === e || !o.alive) continue;
    const op = o === P ? P.pos : o.root.position, d = Math.hypot(op.x - e.root.position.x, op.z - e.root.position.z) * (o === e.lastAttacker ? 0.5 : 1);
    if (d < bd) { e.center(EP); targetPoint(o, TP); if (d < 12 || world.los(EP, TP)) { bd = d; best = o; } }
  }
  if (!best) for (const o of combatants()) if (o !== e && o.alive) { best = o; break; }
  e.target = best; e.targetT = G.time; return best;
}
function enemyCollide(e) {
  const p = e.root.position, r = e.radius * (e.big ? 1 : 0.8);
  for (const c of world.colliders) {
    if (c.y1 < 0.5) { if (c.kind !== "barrier") continue; }
    const cx = clamp(p.x, c.x0, c.x1), cz = clamp(p.z, c.z0, c.z1), dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
    if (d2 >= r * r || d2 < 1e-8) continue; const d = Math.sqrt(d2), k = (r - d) / d; p.x += dx * k; p.z += dz * k;
  }
}
function updateEnemy(e, dt) {
  const p = e.root.position;
  if (!e.alive) { dyingUpdate(e, dt); return; }
  e.flinch = damp(e.flinch, 0, 10, dt); e.stagger = Math.max(0, e.stagger - dt); e.invuln = Math.max(0, e.invuln - dt);
  const tgt = chooseTarget(e);
  let moveX = 0, moveZ = 0, face = null, los = false, dist = 99;
  if (tgt) {
    targetPoint(tgt, TP); e.center(EP);
    dist = Math.hypot(TP.x - p.x, TP.z - p.z);
    e.losT = (e.losT || 0) - dt; if (e.losT <= 0) { e.losT = 0.18 + Math.random() * 0.1; e.los = world.los(EP, TP); } los = e.los;
    const ff = flowFor(tgt);
    const engage = los && dist < e.K.range * (e.kind === "dog" ? 0.6 : 0.85);
    if (e.kind === "boss") bossBrain(e, dt, tgt, dist, los);
    if (engage || (e.kind === "dog" && los && dist < 22)) {
      face = Math.atan2(TP.x - p.x, TP.z - p.z);
      e.strafeT -= dt; if (e.strafeT <= 0) { e.strafeT = rnd(0.9, 2.4); e.strafe *= -1; }
      const want = e.kind === "dog" ? 6 : e.kind === "boar" ? 7 : e.big ? 12 : 14;
      const fx = (TP.x - p.x) / dist, fz = (TP.z - p.z) / dist, closeK = clamp((dist - want) / 6, -1, 1);
      const sK = e.big ? 0.25 : e.kind === "dog" ? 1 : 0.7;
      moveX = fx * closeK + -fz * e.strafe * sK; moveZ = fz * closeK + fx * e.strafe * sK;
    } else {
      // walk downhill on the distance field towards the target
      const c = world.cellOf(p.x, p.z);
      if (c >= 0) {
        const NZ = world.nav.NZ, i = (c / NZ) | 0, k = c % NZ; let best = ff[c], bx = 0, bz = 0;
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
          const ni = i + di, nk = k + dk; if (ni < 0 || nk < 0 || ni >= world.nav.NX || nk >= NZ) continue;
          const n = ni * NZ + nk; if (world.nav.block[n]) continue; if (di && dk && (world.nav.block[(i + di) * NZ + k] || world.nav.block[i * NZ + k + dk])) continue;
          const v = ff[n] + (di && dk ? 0.4 : 0); if (v < best) { best = v; bx = di; bz = dk; }
        }
        if (bx || bz) { const L = Math.hypot(bx, bz); moveX = bx / L; moveZ = bz / L; }
        else { moveX = (TP.x - p.x) / Math.max(1, dist); moveZ = (TP.z - p.z) / Math.max(1, dist); }
      }
      if (los && dist < e.K.range * 1.2) face = Math.atan2(TP.x - p.x, TP.z - p.z);
    }
    // weapon
    e.fireT -= dt;
    if (los && e.stagger <= 0 && dist < e.K.range * 1.15 && e.kind !== "boss") enemyWeapon(e, dt, tgt, dist);
    else { e.spin = Math.max(0, e.spin - dt); }
  }
  // separation
  for (const o of ENEMIES) { if (o === e || !o.alive) continue; const dx = p.x - o.root.position.x, dz = p.z - o.root.position.z, d2 = dx * dx + dz * dz, rr = (e.radius + o.radius) * 1.3; if (d2 < rr * rr && d2 > 1e-6) { const d = Math.sqrt(d2); moveX += (dx / d) * (rr - d) * 1.5; moveZ += (dz / d) * (rr - d) * 1.5; } }
  const mL = Math.hypot(moveX, moveZ); if (mL > 1) { moveX /= mL; moveZ /= mL; }
  const spd = e.speed * (e.stagger > 0 ? 0.2 : 1) * (e.kind === "exo" && e.spin > 0 ? 0.45 : 1) * (e.dash > 0 ? 4.5 : 1);
  e.vel.x = damp(e.vel.x, moveX * spd, 6, dt); e.vel.z = damp(e.vel.z, moveZ * spd, 6, dt);
  p.x += e.vel.x * dt; p.z += e.vel.z * dt; enemyCollide(e);
  p.x = clamp(p.x, world.ARENA.x0 + 1, world.ARENA.x1 - 1); p.z = clamp(p.z, world.ARENA.z0 + 1, world.ARENA.z1 - 1);
  // facing and animation blend
  const hs = Math.hypot(e.vel.x, e.vel.z);
  const yawT = face ?? (hs > 0.4 ? Math.atan2(e.vel.x, e.vel.z) : e.yaw);
  e.yaw += wrapA(yawT - e.yaw) * (1 - Math.exp(-(e.kind === "dog" ? 10 : 7) * dt)); e.root.rotation.y = e.yaw;
  const A = e.actions, run = clamp((hs - 1.6) / 3, 0, 1), walk = clamp(hs / 1.6, 0, 1) * (1 - run);
  if (e.kind === "dog") { A.run.setEffectiveWeight(clamp(hs / 4, 0, 1)); A.idle.setEffectiveWeight(1 - clamp(hs / 4, 0, 1)); A.run.timeScale = clamp(hs / 8, 0.6, 1.5); }
  else { A.idle.setEffectiveWeight(1 - run - walk); A.walk.setEffectiveWeight(walk); A.run.setEffectiveWeight(run); A.crouch.setEffectiveWeight(0); A.run.timeScale = e.big ? 0.75 : 1; A.walk.timeScale = e.big ? 0.8 : 1; }
  e.mixer.update(dt);
  // upper body aims at the target; flinch on hits
  if (tgt && e.kind !== "dog") { const pitch = Math.atan2(TP.y - (p.y + 1.3 * e.scale), Math.max(1, dist)); e.aimPitch = damp(e.aimPitch, -pitch, 8, dt); e.j.chest.rotation.x += e.aimPitch * 0.8 - e.flinch; e.j.spine.rotation.z += e.flinch * 0.4; }
  if (e.kind === "dog" && e.j.turret && tgt) { e.j.turret.rotation.y += wrapA(Math.atan2(TP.x - p.x, TP.z - p.z) - e.yaw); }
  e.root.updateMatrixWorld(true);
}
// ---- enemy weapons: every shot is telegraphed (flash, tracer, sound) and accuracy falls off with range and target speed
function hitChance(e, tgt, dist) {
  const tv = targetVel(tgt), sp = Math.hypot(tv.x, tv.z);
  let c = 0.72 - dist * 0.011 - sp * 0.028 + (tgt === P && P.crouch > 0.5 ? -0.12 : 0) + (tgt === P && P.slideT > 0 ? -0.2 : 0);
  if (e.ffa && tgt !== P) c += 0.05;
  return clamp(c, 0.06, 0.82);
}
function shootAt(e, tgt, dmg, color, sound, tw = 0.03) {
  const m = e.muzzle.getWorldPosition(V3()); targetPoint(tgt, TP);
  const hit = Math.random() < hitChance(e, tgt, Math.hypot(TP.x - m.x, TP.z - m.z));
  const end = TP.clone(); if (!hit) end.add(V3(rnd(-1.4, 1.4), rnd(-0.6, 1.2), rnd(-1.4, 1.4)));
  const d = V3().subVectors(end, m).normalize(); world.raycast(m, d, m.distanceTo(end) + (hit ? 0 : 40), RHE);
  const blocked = RHE.t < m.distanceTo(TP) - 0.6;
  const stop = m.clone().addScaledVector(d, Math.min(RHE.t, m.distanceTo(end) + (hit ? 0 : 30)));
  tracer(m, stop, color, tw, 260); enemyFlash(m, e.big ? 1.1 : 0.6);
  sfx(sound, pan3(m));
  if (hit && !blocked) { if (tgt === P) hurtPlayer(dmg * e.dmgK, m, "bullet"); else damageFoe(tgt, dmg * 1.6, { part: "body", owner: "ffa", src: e, dir: d, point: TP.clone() }); }
  else if (RHE.n) decal(HOLES, stop, RHE.n, 0.1);
}
function enemyWeapon(e, dt, tgt, dist) {
  const w = e.K.weapon;
  if (w === "rifle") {
    if (e.burst > 0) { e.burstT -= dt; if (e.burstT <= 0) { e.burst--; e.burstT = 0.1; shootAt(e, tgt, 7, 0xffc070, "enemyRifle"); } }
    else if (e.fireT <= 0) { e.burst = 3; e.burstT = 0; e.fireT = rnd(1.3, 2.1); }
  } else if (w === "scatter") {
    if (e.fireT <= 0 && dist < 16) { e.fireT = rnd(1.4, 1.9); for (let k = 0; k < 5; k++) shootAt(e, tgt, dist < 7 ? 6 : 4, 0xffb060, k ? "impact" : "shotgun", 0.018); }
  } else if (w === "plasma") {
    if (e.burst > 0) { e.burstT -= dt; if (e.burstT <= 0) { e.burst--; e.burstT = 0.22; const m = e.muzzle.getWorldPosition(V3()); targetPoint(tgt, TP); const lead = targetVel(tgt).clone().multiplyScalar(dist / 32 * 0.6); const d = V3().subVectors(TP.add(lead), m).normalize(); d.x += rnd(-0.03, 0.03); d.y += rnd(-0.02, 0.02); spawnBolt(m, d.normalize(), e.ffa ? "ffa" : "enemy", 13 * e.dmgK, 32, 0x7fe6ff, e); enemyFlash(m, 0.5, 0x7fe6ff); sfx("laser", pan3(m)); } }
    else if (e.fireT <= 0) { e.burst = 2; e.burstT = 0.35; e.fireT = rnd(1.4, 2.0); sfx("servo", pan3(e.root.position)); }
  } else if (w === "dog") {
    e.lungeCD -= dt;
    if (dist < 2.4 && e.lungeCD <= 0) { e.lungeCD = 1.3; e.vel.addScaledVector(V3(TP.x - e.root.position.x, 0, TP.z - e.root.position.z).normalize(), 8); sfx("dogBark", pan3(e.root.position)); if (tgt === P) hurtPlayer(14 * e.dmgK, e.root.position, "bite"); else damageFoe(tgt, 20, { owner: "ffa", src: e, part: "body" }); }
    if (e.burst > 0) { e.burstT -= dt; if (e.burstT <= 0) { e.burst--; e.burstT = 0.07; shootAt(e, tgt, 3.5, 0xff8a5a, "dogGun", 0.016); } }
    else if (e.fireT <= 0) { e.burst = 5; e.burstT = 0; e.fireT = rnd(1.2, 1.8); }
  } else if (w === "minigun") {
    e.stompCD -= dt;
    if (dist < 4.5 && e.stompCD <= 0) { e.stompCD = 4; stomp(e, 5, 22); return; }
    if (e.spin > 0) { e.spin -= dt; e.burstT -= dt; if (e.spin < 2.4 && e.burstT <= 0) { e.burstT = 0.085; shootAt(e, tgt, 4.5, 0xffd080, "minigun", 0.03); } if (e.spin <= 0) e.fireT = rnd(1.8, 2.6); }
    else if (e.fireT <= 0) { e.spin = 3.1; e.burstT = 0; sfx("servo", pan3(e.root.position)); }
  }
}
function stomp(e, radius, dmg) {
  const p = e.root.position; sfx("stomp", pan3(p)); shockwave(V3(p.x, 0.1, p.z), radius * 1.4, 0xffc28a, 0.6); addShake(0.35);
  for (let i = 0; i < 16; i++) SOFT.emit(p.x + rnd(-1, 1), 0.2, p.z + rnd(-1, 1), rnd(-6, 6), rnd(0.5, 2), rnd(-6, 6), 1.2, 0.6, 2.4, 0.5, C.splash, 2, 0);
  for (const o of combatants()) { if (o === e || !o.alive) continue; const op = o === P ? P.pos : o.root.position, d = Math.hypot(op.x - p.x, op.z - p.z); if (d > radius) continue;
    const k = 1 - d / radius; if (o === P) { if (P.ground) { hurtPlayer(dmg * k + 6, p, "stomp"); P.vel.add(V3(op.x - p.x, 0, op.z - p.z).normalize().multiplyScalar(9 * k).setY(4)); P.ground = false; } } else if (e.ffa) damageFoe(o, dmg * k, { owner: "ffa", src: e, part: "body" }); }
}
// ---- the boss: three phases
function bossBrain(e, dt, tgt, dist, los) {
  const hpK = e.hp / e.maxHp;
  if (e.phase === 1 && hpK < 0.66) bossPhase(e, 2); else if (e.phase === 2 && hpK < 0.33) bossPhase(e, 3);
  if (e.invuln > 0) return;
  e.stompCD -= dt; e.special -= dt; e.fireT -= dt; e.dash = Math.max(0, e.dash - dt);
  if (dist < 6 && e.stompCD <= 0) { e.stompCD = e.phase === 3 ? 2.8 : 4; stomp(e, 7, 30); return; }
  if (e.dash > 0) { if (dist < 2.6 && !e.dashHit && tgt === P) { e.dashHit = true; hurtPlayer(32, e.root.position, "charge"); P.vel.add(V3(P.pos.x - e.root.position.x, 0, P.pos.z - e.root.position.z).normalize().multiplyScalar(12).setY(5)); P.ground = false; addShake(0.6); } return; }
  if (e.special <= 0) {
    if (e.phase >= 2 && Math.random() < 0.5) { // rocket salvo from the shoulder pods
      e.special = e.phase === 3 ? 5.5 : 7; sfx("servo", pan3(e.root.position));
      for (let k = 0; k < 6; k++) setTimeout(() => { if (!e.alive || G.state !== "play") return; const pod = e.pods[k % 2] || e.muzzle, m = pod.getWorldPosition(V3()); spawnRocket(m, V3(rnd(-0.4, 0.4), 1, rnd(-0.4, 0.4)).normalize(), "enemy", 20, { dmg: 34, radius: 3.6, homing: 1.4, src: e }); enemyFlash(m, 1.2); sfx("rocketFire", pan3(m)); }, k * 160);
    } else if (e.phase === 3 && Math.random() < 0.5) { // mortar barrage: telegraphed circles, then impacts
      e.special = 6; sfx("roar", pan3(e.root.position));
      for (let k = 0; k < 7; k++) { const tp = V3(P.pos.x + rnd(-7, 7), 0.05, P.pos.z + rnd(-7, 7)), tm = teles[k]; tm.position.copy(tp); tm.scale.setScalar(3.4); tm.visible = true; tm.material.opacity = 0.85;
        setTimeout(() => { tm.visible = false; if (G.state === "play" && e.alive) explode(V3(tp.x, 0.3, tp.z), { radius: 3.4, dmg: 40, owner: "enemy" }); }, 1300 + k * 120); }
    } else if (e.phase >= 2) { e.special = e.phase === 3 ? 4 : 6; e.dash = 1.1; e.dashHit = false; sfx("roar", pan3(e.root.position)); e.vel.set(Math.sin(e.yaw), 0, Math.cos(e.yaw)).multiplyScalar(2); }
    else e.special = 3;
  }
  // rotary cannon
  if (los && dist < 60) {
    if (e.spin > 0) { e.spin -= dt; e.burstT -= dt; if (e.spin < 2.6 && e.burstT <= 0) { e.burstT = e.phase === 3 ? 0.06 : 0.08; shootAt(e, tgt, 4.2, 0xffd080, "minigun", 0.035); } }
    else if (e.fireT <= 0) { e.spin = 3.2; e.fireT = rnd(1.4, 2.4); sfx("servo", pan3(e.root.position)); }
  }
}
function bossPhase(e, n) {
  e.phase = n; e.invuln = 2.2; e.spin = 0; G.hitStop = 0.25; sfx("roar", pan3(e.root.position)); addShake(0.8);
  shockwave(V3(e.root.position.x, 0.2, e.root.position.z), 14, 0xff8a3a, 0.8);
  for (let i = 0; i < 18; i++) chunk(e.center(), V3(rnd(-8, 8), rnd(4, 12), rnd(-8, 8)), rnd(0.12, 0.3), C.dark);
  if (n === 2) { HUD.toast("PHASE 2 · ARMOR SHED", "Rocket pods online", "boss"); e.speed *= 1.2; for (let k = 0; k < 3; k++) { const sp = pickSpawn(18); spawnEnemy("dog", V3(sp.x, 0, sp.z)); } }
  if (n === 3) { HUD.toast("PHASE 3 · CORE EXPOSED", "Shoot the glowing core", "boss"); e.speed *= 1.25; if (e.core) e.core.visible = true; for (let k = 0; k < 2; k++) { const s = pickSpawn(20); spawnEnemy("sentinel", V3(s.x, 0, s.z)); } musicMode("boss"); }
  G.stats.bossPhase = n;
}

// ---- damage, death, drops
const PART_K = { head: 2.0, weak: 2.4, core: 3.2, armor: 0.45, limb: 0.75, body: 1 };
function damageFoe(e, dmg, info) {
  if (!e.alive || (e.invuln > 0)) return;
  let k = PART_K[info.part] ?? 1;
  if (info.part === "head" && info.weapon === "shotgun") k = 1.6;
  if (info.part === "armor" && info.explosive) k = 0.9;
  if (e.kind === "boss" && e.phase === 1 && (info.part === "armor" || info.part === "body")) k *= 0.6;
  let d = dmg * k;
  const byPlayer = info.owner === "player";
  if (byPlayer) d *= 1.25 * AUG.damage();   // player attacks hit 1.25× harder; enemy and self damage are untouched
  e.hp -= d; e.flinch = Math.min(0.35, e.flinch + d / (e.big ? 400 : 120)); if (d > 40 && !e.big) e.stagger = Math.max(e.stagger, 0.25);
  e.alert = 1; if (info.src || byPlayer) e.lastAttacker = byPlayer ? P : info.src;
  const pt = info.point || e.center();
  // hit feedback: sparks for robots and armour, a dark mist for people
  const metal = e.robot || info.part === "armor" || e.big;
  for (let i = 0; i < (info.part === "head" || info.part === "weak" || info.part === "core" ? 10 : 5); i++) {
    if (metal) GLOW.emit(pt.x, pt.y, pt.z, rnd(-4, 4), rnd(0, 5), rnd(-4, 4), rnd(0.2, 0.45), 0.08, 0.02, 1, info.part === "weak" || info.part === "core" ? C.robo : C.spark, 2, 10);
    else SOFT.emit(pt.x, pt.y, pt.z, rnd(-1.5, 1.5) + (info.dir ? info.dir.x * 2 : 0), rnd(-0.5, 1.5), rnd(-1.5, 1.5) + (info.dir ? info.dir.z * 2 : 0), rnd(0.3, 0.6), 0.12, 0.5, 0.6, C.blood, 3, 2);
  }
  if (byPlayer) {
    const crit = info.part === "head" || info.part === "weak" || info.part === "core";
    HUD.hitMarker(crit, info.part === "armor"); sfx("hitMarker", { head: crit }); sfx(metal ? "hitMetal" : "hitFlesh", { ...pan3(pt), gain: 0.5 });
    G.stats.dmg += d; if (crit) addStyle(3, null);
    G.odMeter = Math.min(100, G.odMeter + d * 0.012 * AUG.odGain() * (G.overdrive > 0 ? 0 : 1));
  }
  if (e.hp <= 0) killFoe(e, info);
}
function killFoe(e, info) {
  e.alive = false; e.deadT = 0; e.hp = 0;
  const byPlayer = info.owner === "player", p = e.root.position;
  for (const a of Object.values(e.actions)) a.fadeOut(0.25);
  e.fall = { ax: rnd(-0.3, 0.3), dir: info.dir ? Math.sign(info.dir.z * Math.cos(e.yaw) + info.dir.x * Math.sin(e.yaw)) || 1 : (Math.random() < 0.5 ? 1 : -1), v: 0, a: 0 };
  sfx("enemyDeath", { ...pan3(p), robot: e.robot });
  if (e.robot) for (let i = 0; i < 16; i++) { GLOW.emit(p.x, p.y + 0.8 * e.scale, p.z, rnd(-6, 6), rnd(1, 8), rnd(-6, 6), rnd(0.3, 0.8), 0.1, 0.03, 1, i % 2 ? C.robo : C.spark, 1.5, 12); if (i % 3 === 0) chunk(V3(p.x, p.y + 0.8, p.z), V3(rnd(-5, 5), rnd(2, 7), rnd(-5, 5)), rnd(0.05, 0.12), C.white); }
  if (e.kind === "dog") explodeSmall(V3(p.x, 0.6, p.z));
  if (e.kind === "exo") explodeSmall(e.center().add(V3(0, 0, 0)));
  if (e.kind === "boss") { bossDeath(e); }
  // FFA bookkeeping
  const killer = byPlayer ? P : info.src;
  if (G.mode === "deathmatch") { e.deaths++; if (killer && killer !== e) { killer.kills = (killer.kills || 0) + 1; HUD.feed(killer === P ? "YOU" : killer.name, e.name, info.part === "head"); } e.respawnT = 3; }
  if (!byPlayer) { dropLoot(e, 1); return; }
  // style: what made this kill special
  G.kills++; G.stats.kills++; if (info.part === "head") G.stats.heads++;
  const ev = []; let pts = 40;
  if (info.part === "head") ev.push(["HEADSHOT", 35]); else if (info.part === "weak" || info.part === "core") ev.push(["WEAK POINT", 30]);
  if (info.melee) ev.push(["EXECUTION", 50]);
  if (P.slideT > 0 || G.time - (G.lastSlide || -9) < 0.25) ev.push(["SLIDE KILL", 45]);
  if (!P.ground && P.airT > 0.12) ev.push(["AIRBORNE", 45]);
  if (G.time - P.lastSwap < 1.5 && !info.explosive) ev.push(["QUICK SWAP", 40]);
  if (info.dist > 35) ev.push(["LONG SHOT", 25]);
  if (info.explosive) ev.push(["BLAST", 20]);
  if (G.time - (G.lastKillT || -9) < 0.7) { G.multi = (G.multi || 1) + 1; ev.push([G.multi >= 3 ? "MULTI KILL ×" + G.multi : "DOUBLE KILL", 30 * (G.multi - 1)]); } else G.multi = 1;
  if (G.overdrive > 0) ev.push(["OVERDRIVE", 15]);
  if (e.big) ev.push([e.kind === "boss" ? "FOREMAN DOWN" : "HEAVY DOWN", e.kind === "boss" ? 300 : 80]);
  G.lastKillT = G.time;
  for (const [l, v] of ev) pts += v;
  addStyle(pts, ev.length ? ev.map((x) => x[0]).join(" · ") : "KILL");
  const sc = Math.round(e.K.score * RANK_MULT[rankOf()]); G.score += sc; HUD.killPop(sc, ev.length > 0);
  sfx("kill"); G.hitStop = Math.max(G.hitStop, info.part === "head" ? 0.07 : 0.045); HUD.killBurst();
  if ((info.part === "head" || info.part === "weak" || info.part === "core") && AUG.vamp()) P.health = Math.min(P.maxHealth, P.health + AUG.vamp());
  dropLoot(e, 1);
  if (G.mode === "deathmatch") G.score = P.kills;
}
function explodeSmall(p) {
  for (let i = 0; i < 18; i++) GLOW.emit(p.x, p.y, p.z, rnd(-5, 5), rnd(1, 6), rnd(-5, 5), rnd(0.2, 0.5), rnd(0.8, 1.6), 2.6, 0.9, i % 2 ? C.fire : C.fire2, 4, -1);
  for (let i = 0; i < 10; i++) SOFT.emit(p.x, p.y, p.z, rnd(-2, 2), rnd(1, 3), rnd(-2, 2), rnd(1.2, 2.2), 1, 3, 0.45, C.dark, 1.2, -0.3);
  shockwave(p, 4, 0xffb070, 0.35); boomLight.position.copy(p); boomLight.intensity = 500; sfx("explosion", { ...pan3(p) }); addShake(clamp(0.6 - p.distanceTo(camera.position) / 30, 0, 0.5));
}
function bossDeath(e) {
  G.hitStop = 0.4;
  for (let k = 0; k < 6; k++) setTimeout(() => explodeSmall(e.root.position.clone().add(V3(rnd(-1.5, 1.5), rnd(0.5, 3.5), rnd(-1.5, 1.5)))), k * 220);
  setTimeout(() => { if (G.mode === "onslaught") G.bossDead = true; }, 1600);
}
function dyingUpdate(e, dt) {
  e.deadT += dt;
  const f = e.fall;
  if (f && e.deadT < 1.2) {
    f.v += (e.kind === "dog" ? 9 : 7) * dt; f.a = Math.min(Math.PI / 2 * 0.98, f.a + f.v * dt);
    if (e.kind === "dog") e.root.rotation.z = f.a * f.dir; else e.root.rotation.x = -f.a * f.dir * (e.big ? 0.9 : 1);
    e.root.rotation.y = e.yaw + f.ax * f.a;
    e.root.position.y = -Math.sin(f.a) * 0.05;
    const j = e.j; if (j.lArm) { j.lArm.rotation.x = damp(j.lArm.rotation.x, -0.4, 4, dt); j.rArm.rotation.x = damp(j.rArm.rotation.x, -2.4, 4, dt); j.lThigh.rotation.x = damp(j.lThigh.rotation.x, -0.3, 4, dt); }
  }
  e.mixer.update(dt);
  if (e.deadT > 3.5) e.root.position.y -= dt * 0.5;
  e.root.updateMatrixWorld(true);
}

/* ---- pickups: Rift cells (health, armour, ammo) that pull toward you when close ---- */
const PICK_MAT = { health: new THREE.MeshStandardMaterial({ color: 0x103018, emissive: 0x4dff8a, emissiveIntensity: 1.4, roughness: 0.3 }), armor: new THREE.MeshStandardMaterial({ color: 0x0c2030, emissive: 0x4db8ff, emissiveIntensity: 1.4, roughness: 0.3 }), ammo: new THREE.MeshStandardMaterial({ color: 0x302008, emissive: 0xffbd3a, emissiveIntensity: 1.3, roughness: 0.3 }) };
const pickGeo = new THREE.OctahedronGeometry(0.16, 0);
const PICKS = [];
function dropLoot(e, mult) {
  const n = (e.big ? 4 : e.kind === "dog" ? 1 : 2) * mult, p = e.root.position;
  for (let i = 0; i < n; i++) {
    const needH = 1 - P.health / P.maxHealth, needA = 1 - P.armor / P.maxArmor, w = curW(), needM = 1 - (w.mag + w.res) / (w.size + w.maxRes);
    const r = Math.random() * (needH * 1.3 + needA + needM + 0.6);
    const kind = r < needH * 1.3 ? "health" : r < needH * 1.3 + needA ? "armor" : r < needH * 1.3 + needA + needM + 0.3 ? "ammo" : pick(["health", "armor", "ammo"]);
    const m = new THREE.Mesh(pickGeo, PICK_MAT[kind]); m.position.set(p.x + rnd(-0.6, 0.6), 0.6, p.z + rnd(-0.6, 0.6)); scene.add(m);
    PICKS.push({ m, kind, v: V3(rnd(-2.5, 2.5), rnd(3, 5), rnd(-2.5, 2.5)), t: 22, ph: Math.random() * 6 });
  }
}
function updatePickups(dt) {
  const mag = 6.5 * Math.sqrt(AUG.scav()), pc = V3(P.pos.x, P.pos.y + 0.9, P.pos.z);
  for (let i = PICKS.length - 1; i >= 0; i--) {
    const k = PICKS[i], m = k.m; k.t -= dt; k.ph += dt * 3;
    const d = m.position.distanceTo(pc);
    if (P.alive && d < mag) { const pull = V3().subVectors(pc, m.position).normalize().multiplyScalar(lerp(16, 4, d / mag)); k.v.lerp(pull, clamp(dt * 6, 0, 1)); }
    else { k.v.y -= 14 * dt; k.v.x *= Math.exp(-2 * dt); k.v.z *= Math.exp(-2 * dt); }
    m.position.addScaledVector(k.v, dt); if (m.position.y < 0.35 + Math.sin(k.ph) * 0.08 && d >= mag) { m.position.y = 0.35 + Math.sin(k.ph) * 0.08; k.v.y = Math.max(0, k.v.y); }
    m.rotation.y += dt * 3; m.rotation.x += dt * 1.3;
    if (Math.random() < 0.25) GLOW.emit(m.position.x, m.position.y, m.position.z, 0, 0.6, 0, 0.4, 0.18, 0.02, 0.7, C[k.kind === "health" ? "hp" : k.kind === "armor" ? "ar" : "am"], 1, 0);
    if (P.alive && d < 1.2) { collect(k.kind); scene.remove(m); PICKS.splice(i, 1); continue; }
    if (k.t <= 0) { scene.remove(m); PICKS.splice(i, 1); }
  }
}
function collect(kind) {
  const s = AUG.scav();
  if (kind === "health") P.health = Math.min(P.maxHealth, P.health + 14 * s);
  else if (kind === "armor") { P.armor = Math.min(P.maxArmor, P.armor + 28 * s); }
  else { for (const w of WEAPONS) w.res = Math.min(w.maxRes, w.res + Math.ceil({ rifle: 30, shotgun: 6, launcher: 1 }[w.id] * s * (w === curW() ? 1 : 0.5))); if (Math.random() < 0.25 && W8.nades < W8.maxNades) W8.nades++; }
  sfx("pickup", { kind }); HUD.pickup(kind);
}
function clearPickups() { for (const k of PICKS) scene.remove(k.m); PICKS.length = 0; }

/* ================================================================ waves (Onslaught) and free-for-all (Deathmatch) */
const WAVES = [
  { wolf: 4, boar: 2 },
  { wolf: 4, boar: 4, sentinel: 2 },
  { wolf: 4, boar: 3, sentinel: 4, dog: 2 },
  { wolf: 4, boar: 3, sentinel: 3, dog: 5 },
  { wolf: 4, boar: 3, sentinel: 4, dog: 3, exo: 1 },
  { wolf: 5, boar: 4, sentinel: 4, dog: 4, exo: 2 },
  { wolf: 5, boar: 4, sentinel: 6, dog: 6, exo: 3 },
  { boss: 1, wolf: 2, boar: 2 },
];
const kindsFor = (w) => Object.keys(WAVES[w - 1] || {});
function buildQueue(w) {
  const q = []; for (const [k, n] of Object.entries(WAVES[w - 1])) for (let i = 0; i < n; i++) q.push(k);
  for (let i = q.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [q[i], q[j]] = [q[j], q[i]]; }
  q.sort((a, b) => (a === "boss" ? -1 : b === "boss" ? 1 : (KINDS[a].big ? 1 : 0) - (KINDS[b].big ? 1 : 0)));   // heavies arrive late in the wave
  return q;
}
function startWave(n) {
  G.wave = n; G.queue = buildQueue(n); G.spawnT = 2.6; G.waveState = "intro"; G.waveT = 2.6; G.bossDead = false;
  for (const k of kindsFor(n)) ensureKind(k);   // make sure every model this wave needs is streamed in
  HUD.waveBanner(n);
  sfx("horn"); musicMode(WAVES[n - 1].boss ? "boss" : "combat");
}
function updateWaves(dt) {
  if (G.waveState === "intro") { G.waveT -= dt; if (G.waveT <= 0) G.waveState = "fight"; return; }
  if (G.waveState !== "fight") return;
  const alive = ENEMIES.filter((e) => e.alive).length, maxAlive = 6 + G.wave;
  G.spawnT -= dt;
  if (G.queue.length && alive < maxAlive && G.spawnT <= 0) {
    const k = G.queue.shift(); G.spawnT = k === "boss" ? 3 : rnd(0.7, 1.4);
    if (k === "boss") { const e = spawnEnemy("boss", V3(0, 0, -36)); G.boss = e; HUD.bossBar(e); HUD.toast("THE FOREMAN", "Powered exo prime · three phases", "boss"); sfx("roar", pan3(e.root.position)); }
    else { const s = pickSpawn(); spawnEnemy(k, V3(s.x + rnd(-1, 1), 0, s.z + rnd(-1, 1))); }
  }
  const remaining = G.queue.length + alive;
  G.remaining = remaining;
  const bossWave = !!WAVES[G.wave - 1].boss;
  if ((bossWave && G.bossDead) || (!bossWave && remaining === 0)) waveCleared();
}
function waveCleared() {
  G.waveState = "clear"; const bonus = 500 * G.wave; G.score += bonus; sfx("waveClear");
  records.onslaught.wave = Math.max(records.onslaught.wave, G.wave); records.onslaught.score = Math.max(records.onslaught.score, G.score); saveRecords();
  if (G.wave >= WAVES.length) { setTimeout(() => endRun(true), 1800); HUD.toast("RIFT HELD", "The Foreman is scrap", "win"); for (const e of ENEMIES) if (e.alive) killFoe(e, { owner: "world" }); return; }
  HUD.toast(`WAVE ${G.wave} CLEARED`, `+${bonus} · pick an augment`, "clear");
  setTimeout(() => { if (G.state === "play" && G.waveState === "clear") openAugments(); }, 1500);
}
const BOT_NAMES = [["wolf", "VARG-1"], ["wolf", "VARG-2"], ["boar", "TUSK-1"], ["boar", "TUSK-2"], ["sentinel", "UNIT-07"], ["sentinel", "UNIT-12"]];
const DM_LIMIT = 15, DM_TIME = 360;
function startDeathmatch() {
  for (const [k, n] of BOT_NAMES) { const s = pickSpawn(16); const e = spawnEnemy(k, V3(s.x, 0, s.z), { ffa: true, name: n, hp: 150 }); e.kills = 0; e.deaths = 0; }
  P.kills = 0; P.deaths = 0; G.dmTime = DM_TIME; musicMode("combat"); sfx("horn");
  HUD.toast("DEATHMATCH", `First to ${DM_LIMIT} kills`, "clear");
}
function updateDeathmatch(dt) {
  G.dmTime -= dt;
  for (const e of ENEMIES) {
    if (e.alive || e.respawnT == null) continue;
    e.respawnT -= dt;
    if (e.respawnT <= 0) {   // respawn in a fresh body at a far gate
      e.remove(); const s = pickSpawn(20), n = new Enemy(e.kind, V3(s.x, 0, s.z), { ffa: true, name: e.name, hp: 150 }); n.kills = e.kills; n.deaths = e.deaths;
      ENEMIES[ENEMIES.indexOf(e)] = n;
    }
  }
  const lead = Math.max(P.kills, ...ENEMIES.map((e) => e.kills));
  if (lead >= DM_LIMIT || G.dmTime <= 0) endRun(P.kills >= lead);
  if (!P.alive) { G.respawnT -= dt; if (G.respawnT <= 0) respawnPlayer(); }
}

/* ================================================================ game state */
const G = { state: "loading", mode: "onslaught", time: 0, wave: 0, score: 0, style: 0, styleIdle: 0, odMeter: 0, odReady: false, overdrive: 0, hitStop: 0, kills: 0,
  queue: [], spawnT: 0, waveState: "", waveT: 0, remaining: 0, boss: null, bossDead: false, lastFire: -9, aimOnTarget: false, stats: null, respawnT: 0, dmTime: 0 };
const freshStats = () => ({ kills: 0, heads: 0, dmg: 0, taken: 0, bestRank: 0, bossPhase: 0, start: 0 });

/* ================================================================ HUD */
const hc = $("hc"), hx = hc.getContext("2d");
const HUDP = [], ARCS = [];
let hmT = 0, hmCrit = false, hmArmor = false;
const HUD = {
  el: $("hud"),
  show(on) { this.el.classList.toggle("off", !on); if (touchUI) touchUI.style.display = on && PA.TOUCH ? "" : "none"; $("touchBtns").classList.toggle("hide", !on); },
  flash(kind) { const v = $("vig"); v.classList.remove("hitA", "hitH"); void v.offsetWidth; v.classList.add(kind === "armor" ? "hitA" : "hitH"); },
  armorCharge(on) { $("armorBox").classList.toggle("charging", on); },
  armorBreak() { const b = $("armorBox"); b.classList.remove("broke"); void b.offsetWidth; b.classList.add("broke"); this.toast("ARMOR BROKEN", "", "bad", 900); for (let i = 0; i < 26; i++) HUDP.push({ x: 150, y: innerHeight - 70, vx: rnd(-160, 220), vy: rnd(-260, -40), t: rnd(0.4, 0.9), c: "#4db8ff", s: rnd(2, 5), g: 600 }); },
  damageArc(from, k) { const dx = from.x - camera.position.x, dz = from.z - camera.position.z, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw); ARCS.push({ a: Math.atan2(dx * rx + dz * rz, dx * fx + dz * fz), t: 1.2, k }); },
  hitMarker(crit, armor) { hmT = 0.16; hmCrit = crit; hmArmor = armor; },
  killBurst() { const cx = innerWidth / 2, cy = innerHeight / 2; for (let i = 0; i < 14; i++) { const a = rnd(0, 6.28), s = rnd(120, 360); HUDP.push({ x: cx, y: cy, vx: Math.cos(a) * s, vy: Math.sin(a) * s, t: rnd(0.25, 0.5), c: i % 3 ? "#ffb23e" : "#ffffff", s: rnd(1.5, 3.5), g: 0 }); } },
  killPop(score, special) { const el = $("killPop"); el.textContent = "+" + score; el.className = special ? "pop big" : "pop"; void el.offsetWidth; el.classList.add("go"); },
  pickup(kind) { const tgt = kind === "health" ? $("hpBox") : kind === "armor" ? $("armorBox") : $("weap"); const r = tgt.getBoundingClientRect(); const c = kind === "health" ? "#4dff8a" : kind === "armor" ? "#4db8ff" : "#ffbd3a"; for (let i = 0; i < 10; i++) HUDP.push({ x: innerWidth / 2 + rnd(-30, 30), y: innerHeight / 2 + rnd(-20, 40), tx: r.left + r.width / 2, ty: r.top + r.height / 2, t: 0.55 + i * 0.02, max: 0.55 + i * 0.02, c, s: rnd(2, 4), home: true }); },
  toast(title, sub, cls = "", ms = 1900) { const el = $("toast"); el.innerHTML = `<b>${title}</b>${sub ? `<small>${sub}</small>` : ""}`; el.className = "toast show " + cls; clearTimeout(el._t); el._t = setTimeout(() => (el.className = "toast " + cls), ms); },
  styleEvent(label, pts) { const log = $("styleLog"), d = document.createElement("div"); d.innerHTML = `${label}<span>+${Math.round(pts)}</span>`; log.prepend(d); while (log.children.length > 4) log.lastChild.remove(); setTimeout(() => d.classList.add("fade"), 1600); setTimeout(() => d.remove(), 2200); },
  rankUp(r) { const el = $("rankL"); el.classList.remove("up"); void el.offsetWidth; el.classList.add("up"); const b = el.getBoundingClientRect(); for (let i = 0; i < 18; i++) HUDP.push({ x: b.left + b.width / 2, y: b.top + b.height / 2, vx: rnd(-200, 200), vy: rnd(-220, 60), t: rnd(0.4, 0.8), c: r >= 4 ? "#ff5a2a" : "#ffb23e", s: rnd(2, 4), g: 380 }); },
  rankDown() { const el = $("rankL"); el.classList.remove("down"); void el.offsetWidth; el.classList.add("down"); },
  waveBanner(n) { const boss = WAVES[n - 1].boss; this.toast(boss ? "FINAL WAVE" : `WAVE ${n}`, boss ? "The Foreman is coming" : Object.entries(WAVES[n - 1]).map(([k, c]) => `${c} ${KINDS[k].label.toLowerCase()}${c > 1 ? "s" : ""}`).join(" · "), boss ? "boss" : "wave", 2600); },
  bossBar(e) { $("bossBox").classList.toggle("on", !!e); },
  feed(a, b, head) { const box = $("feedBox"), d = document.createElement("div"); d.innerHTML = `<b>${a}</b> ${head ? "◎" : "▸"} ${b}`; box.prepend(d); while (box.children.length > 5) box.lastChild.remove(); setTimeout(() => d.remove(), 4500); },
};
const setTxt = (el, v) => { if (el._v !== v) { el._v = v; el.textContent = v; } };
const HE2 = { score: $("score"), mult: $("mult"), wave: $("waveLbl"), sub: $("waveSub"), rankL: $("rankL"), rankN: $("rankN"), rankBar: $("rankBar"), hp: $("hpFill"), hpN: $("hpNum"), ar: $("arFill"), arN: $("arNum"),
  wName: $("wName"), mag: $("mag"), res: $("res"), nades: $("nades"), od: $("odRing"), odBox: $("od"), bossFill: $("bossFill"), bossPh: $("bossPhase"), xh: $("xh"), vig: $("vig"), odEdge: $("odEdge"), board: $("board"), slots: [...document.querySelectorAll("#slots i")] };
function updateHUD(dt) {
  const w = curW();
  setTxt(HE2.score, G.mode === "deathmatch" ? `${P.kills || 0} / ${DM_LIMIT} KILLS` : G.score.toLocaleString("en-US"));
  setTxt(HE2.mult, G.mode === "deathmatch" ? `${Math.max(0, Math.ceil(G.dmTime / 60 - 1))}:${String(Math.max(0, Math.ceil(G.dmTime) % 60)).padStart(2, "0")}` : `×${RANK_MULT[rankOf()]}`);
  if (G.mode === "onslaught") { setTxt(HE2.wave, WAVES[G.wave - 1]?.boss ? "FINAL WAVE" : `WAVE ${G.wave} / ${WAVES.length}`); setTxt(HE2.sub, G.waveState === "fight" ? `${G.remaining} HOSTILE${G.remaining === 1 ? "" : "S"}` : G.waveState === "intro" ? "INBOUND" : "CLEAR"); }
  else { const lead = [...ENEMIES].sort((a, b) => b.kills - a.kills)[0]; setTxt(HE2.wave, "DEATHMATCH"); setTxt(HE2.sub, lead ? `LEADER ${Math.max(lead.kills, P.kills || 0) === (P.kills || 0) ? "YOU" : lead.name} · ${Math.max(lead.kills, P.kills || 0)}` : ""); }
  const r = rankOf(); setTxt(HE2.rankL, RANKS[r]); setTxt(HE2.rankN, RANK_NAMES[r]); HE2.rankL.dataset.r = r;
  HE2.rankBar.style.transform = `scaleX(${((G.style % 100) / 100).toFixed(3)})`;
  HE2.hp.style.transform = `scaleX(${(P.health / P.maxHealth).toFixed(3)})`; setTxt(HE2.hpN, String(Math.ceil(P.health)));
  HE2.ar.style.transform = `scaleX(${(P.armor / P.maxArmor).toFixed(3)})`; setTxt(HE2.arN, String(Math.ceil(P.armor)));
  setTxt(HE2.wName, w.name); setTxt(HE2.mag, G.overdrive > 0 ? "∞" : String(w.mag)); setTxt(HE2.res, String(w.res)); setTxt(HE2.nades, "● ".repeat(W8.nades).trim() || "—");
  HE2.mag.classList.toggle("low", w.mag <= Math.ceil(w.size * 0.25) && G.overdrive <= 0);
  HE2.slots.forEach((s, i) => s.classList.toggle("on", i === W8.cur));
  HE2.od.style.strokeDashoffset = String(289 * (1 - G.odMeter / 100)); HE2.odBox.classList.toggle("ready", G.odReady); HE2.odBox.classList.toggle("active", G.overdrive > 0);
  HE2.odEdge.classList.toggle("on", G.overdrive > 0);
  if (G.boss) { HE2.bossFill.style.transform = `scaleX(${Math.max(0, G.boss.hp / G.boss.maxHp).toFixed(3)})`; setTxt(HE2.bossPh, `PHASE ${G.boss.phase}`); if (!G.boss.alive) HUD.bossBar(null); }
  // low health: a pulsing blood-red edge, never blur or double vision
  HE2.vig.style.setProperty("--low", clamp(1 - P.health / 45, 0, 1).toFixed(2));
  // crosshair: hip only (sights are real when aiming), spread follows recoil and movement
  const spread = (lerp(w.spreadHip || 0.03, w.spreadAds || 0.003, P.ads) * (P.ground ? 1 : 1.6) + P.kick * 0.25) * innerHeight * 1.1;
  HE2.xh.style.setProperty("--g", (8 + spread).toFixed(1) + "px"); HE2.xh.style.opacity = (1 - P.ads * 1.4).toFixed(2); HE2.xh.classList.toggle("sg", w.id === "shotgun");
  HE2.board.classList.toggle("on", G.mode === "deathmatch" && IN.score);
  if (HE2.board.classList.contains("on")) HE2.board.innerHTML = `<h3>SCOREBOARD</h3>` + [{ name: "YOU", kills: P.kills || 0, deaths: P.deaths || 0, me: true }, ...ENEMIES].sort((a, b) => b.kills - a.kills).map((e) => `<div class="${e.me ? "me" : ""}"><span>${e.name}</span><b>${e.kills}</b><i>${e.deaths}</i></div>`).join("");
  drawHudCanvas(dt);
}
function drawHudCanvas(dt) {
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (hc.width !== innerWidth * dpr) { hc.width = innerWidth * dpr; hc.height = innerHeight * dpr; }
  hx.setTransform(dpr, 0, 0, dpr, 0, 0); hx.clearRect(0, 0, innerWidth, innerHeight);
  const cx = innerWidth / 2, cy = innerHeight / 2;
  // damage arcs point to where the hit came from
  for (let i = ARCS.length - 1; i >= 0; i--) {
    const a = ARCS[i]; a.t -= dt; if (a.t <= 0) { ARCS.splice(i, 1); continue; }
    const ang = a.a - Math.PI / 2, R = Math.min(innerWidth, innerHeight) * 0.2;
    hx.strokeStyle = `rgba(255,${60 + 80 * (1 - a.k) | 0},40,${(Math.min(1, a.t) * 0.85).toFixed(2)})`; hx.lineWidth = 6 + a.k * 6; hx.lineCap = "round";
    hx.beginPath(); hx.arc(cx, cy, R, ang - 0.32, ang + 0.32); hx.stroke();
    hx.lineWidth = 2; hx.beginPath(); hx.arc(cx, cy, R + 12, ang - 0.18, ang + 0.18); hx.stroke();
  }
  // hit marker
  if (hmT > 0) {
    hmT -= dt; const k = 7 + (0.16 - hmT) * 30, c = hmCrit ? "#ff3a2a" : hmArmor ? "#9fb6c8" : "#ffffff";
    hx.strokeStyle = c; hx.lineWidth = hmCrit ? 3 : 2; hx.beginPath();
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { hx.moveTo(cx + sx * k, cy + sy * k); hx.lineTo(cx + sx * (k + 7), cy + sy * (k + 7)); }
    hx.stroke();
  }
  // HUD particles: kill bursts, armour shards, pickups flying into their bars, rank-up sparks
  for (let i = HUDP.length - 1; i >= 0; i--) {
    const p = HUDP[i]; p.t -= dt; if (p.t <= 0) { HUDP.splice(i, 1); continue; }
    if (p.home) { const u = 1 - p.t / p.max, e = u * u; p.x = lerp(p.x, p.tx, e * 0.25); p.y = lerp(p.y, p.ty, e * 0.25); }
    else { p.vy += (p.g || 0) * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    hx.fillStyle = p.c; hx.globalAlpha = Math.min(1, p.t * 3); hx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
  }
  hx.globalAlpha = 1;
}

/* ================================================================ menus (mouse, keyboard and gamepad) */
const menuEl = $("menu");
let MENU = null;
function menuOpen() { return !!MENU; }
const OPTS = { sens: [1, 10], padSens: [1, 10], invert: ["Off", "On"], fov: [70, 100, 5], shake: ["Off", "Low", "Full"], quality: ["Low", "High"], master: [0, 10], music: [0, 10], sfx: [0, 10] };
const optText = (k) => { const o = OPTS[k]; if (typeof o[0] === "string") return o[settings[k]]; if (k === "fov") return settings.fov + "°"; return "▮".repeat(settings[k]) + "▯".repeat(o[1] - settings[k]); };
const sel = (k, label) => `<button class="mi" data-set="${k}"><span>${label}</span><span class="v">${optText(k)}</span></button>`;
function showMenu(html, { back = null, focus = 0, cls = "" } = {}) {
  menuEl.className = "on " + cls; menuEl.innerHTML = html;
  const items = [...menuEl.querySelectorAll(".mi")];
  MENU = { items, i: clamp(focus, 0, items.length - 1), back };
  items.forEach((el, i) => {
    el.addEventListener("mouseenter", () => { if (MENU && MENU.i !== i) { MENU.i = i; paint(); sfx("uiMove"); } });
    el.addEventListener("click", (e) => { if (el.tagName === "A") return; e.preventDefault(); MENU.i = i; activate(el, 1); });
  });
  paint();
}
function closeMenu() { MENU = null; menuEl.className = ""; menuEl.innerHTML = ""; }
function paint() { if (!MENU) return; MENU.items.forEach((el, i) => el.classList.toggle("focus", i === MENU.i)); const el = MENU.items[MENU.i]; if (el) el.scrollIntoView({ block: "nearest" }); }
function menuMove(d) { if (!MENU || !MENU.items.length) return; MENU.i = (MENU.i + d + MENU.items.length) % MENU.items.length; paint(); sfx("uiMove"); }
function menuAdjust(d) { if (!MENU) return; const el = MENU.items[MENU.i]; if (el && el.dataset.set) activate(el, d); else if (el && el.classList.contains("card")) menuMove(d); }
function menuActivate() { if (!MENU) return; const el = MENU.items[MENU.i]; if (!el) return; if (el.tagName === "A") { location.href = el.href; return; } activate(el, 1); }
function menuBack() { if (MENU && MENU.back) { sfx("uiBack"); MENU.back(); } }
function menuKey(e) {
  const c = e.code;
  if (c === "ArrowUp" || c === "KeyW") { menuMove(-1); e.preventDefault(); } else if (c === "ArrowDown" || c === "KeyS") { menuMove(1); e.preventDefault(); }
  else if (c === "ArrowLeft" || c === "KeyA") menuAdjust(-1); else if (c === "ArrowRight" || c === "KeyD") menuAdjust(1);
  else if (c === "Enter" || c === "Space") { e.preventDefault(); menuActivate(); }
  else if (c === "Escape" || c === "Backspace") { e.preventDefault(); menuBack(); }
  else if (/^Digit[1-3]$/.test(c) && G.state === "augment") { const el = MENU.items[+c.slice(5) - 1]; if (el) activate(el, 1); }
}
const ACT = {};
function activate(el, d) {
  audioInit(); applyVolumes();
  const k = el.dataset.set;
  if (k) {
    const o = OPTS[k];
    if (typeof o[0] === "string") settings[k] = (settings[k] + d + o.length) % o.length; else settings[k] = clamp(settings[k] + d * (o[2] || 1), o[0], o[1]);
    saveSettings(); applySettings(); el.querySelector(".v").textContent = optText(k); sfx("uiMove"); return;
  }
  sfx("uiSelect");
  const fn = ACT[el.dataset.act]; if (fn) fn(el);
}
function applySettings() {
  applyVolumes();
  const hi = settings.quality === 1;
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, hi ? 1.75 : 1));
  world.sun.shadow.mapSize.set(hi ? 2048 : 1024, hi ? 2048 : 1024); if (world.sun.shadow.map) { world.sun.shadow.map.dispose(); world.sun.shadow.map = null; }
  resize();
}
const hostiles = "Wolf and boar mercenaries · Sentinel robots · turret hounds · exo heavies";
function titleScreen(focus = 0) {
  G.state = "title"; HUD.show(false);
  const rec = records.onslaught, dm = records.deathmatch;
  showMenu(`<div class="title">
    <div class="eyebrow">TERMINAL 7 · DUSK · DRIZZLE · OFFLINE</div>
    <h1 class="logo">IRON <span>RIFT</span></h1>
    <p class="tagline">Hold the quay through eight waves, then break the Foreman. Fight loud, fight stylish.</p>
    <div class="menu">
      <button class="mi big" data-act="onslaught"><span>ONSLAUGHT</span><span class="v2">8 WAVES · BOSS</span></button>
      <button class="mi big" data-act="deathmatch"><span>DEATHMATCH</span><span class="v2">6-BOT FREE-FOR-ALL</span></button>
      <button class="mi" data-act="controls"><span>CONTROLS</span></button>
      <button class="mi" data-act="settings"><span>SETTINGS</span></button>
      ${ARCADE ? `<a class="mi" href="../index.html#ironrift"><span>BACK TO THE ARCADE</span></a>` : ""}
    </div>
    <div class="recs">Best wave ${rec.wave || "—"}${rec.cleared ? " · CLEARED" : ""} · Best score ${rec.score ? rec.score.toLocaleString("en-US") : "—"} · Deathmatch wins ${dm.wins || 0}</div>
    <div class="foot"><span id="streamTag">Streaming assets…</span> · ${hostiles}</div>
  </div>`, { focus, cls: "titleM" });
  musicMode("title"); ambience(true); audioEnd(false); audioPause(false);
  updateStreamTag();
}
ACT.onslaught = () => startRun("onslaught");
ACT.deathmatch = () => startRun("deathmatch");
ACT.controls = () => controlsScreen(() => (G.state === "paused" ? pauseScreen(2) : titleScreen(2)));
ACT.settings = () => settingsScreen(() => (G.state === "paused" ? pauseScreen(3) : titleScreen(3)));
ACT.resume = () => resumeGame();
ACT.restart = () => startRun(G.mode);
ACT.quit = () => { audioEnd(false); toTitle(); };
ACT.retry = () => startRun(G.mode);
ACT.title = () => toTitle();
function controlsScreen(back) {
  const rows = [["W A S D", "Move"], ["Mouse", "Look"], ["Left click", "Fire"], ["Right click", "Aim through the sights"], ["R", "Reload"], ["Shift", "Sprint"], ["Space", "Jump (vault onto barriers)"],
    ["C / Ctrl", "Hold to crouch behind cover · tap while sprinting to slide"], ["Q", "Quick-switch to your last weapon"], ["1 / 2 / 3 · wheel", "Rifle / shotgun / rocket launcher"], ["G", "Frag grenade"], ["V / E", "Melee strike"],
    ["F", "Overdrive when the ring is full"], ["Tab (hold)", "Scoreboard (Deathmatch)"], ["Esc", "Pause"]];
  showMenu(`<div class="panel wide"><div class="eyebrow">CONTROLS</div><h2>Field manual</h2>
    <div class="keys">${rows.map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join("")}</div>
    <p><b>Gamepad</b> RT fire · LT aim · A jump · X reload · Y last weapon · RB next weapon · LB grenade · B crouch / slide · L3 sprint · R3 melee · D-pad ↑ Overdrive · Start pause · Back scoreboard</p>
    <p><b>Touch</b> (landscape) Left stick moves, drag the right side to look; buttons for fire, aim, jump, crouch, reload, swap, grenade, melee and Overdrive.</p>
    <p><b>How to survive</b> Push forward. Kills drop Rift cells: green health, blue armor, amber ammo, and they pull toward you up close. Armor (150) recharges at 55/s after one second without damage. Headshots and exposed weak points hit harder. Slide kills, airborne kills, quick swaps and executions raise your style rank from D to SSS, which multiplies your score; taking hits drops it. Fill the Overdrive ring and press F for 8 seconds of faster fire and unlimited ammo. Pick an augment after every wave — they stack.</p>
    <div class="row"><button class="mi go" data-act="back">BACK</button></div></div>`, { back });
  ACT.back = back;
}
function settingsScreen(back) {
  showMenu(`<div class="panel"><div class="eyebrow">SETTINGS</div><h2>Loadout tuning</h2><div class="menu">
    ${sel("sens", "Mouse sensitivity")}${sel("padSens", "Gamepad look speed")}${sel("invert", "Invert look")}${sel("fov", "Field of view")}${sel("shake", "Screen shake")}${sel("quality", "Graphics")}
    ${sel("master", "Master volume")}${sel("music", "Music")}${sel("sfx", "Effects")}
    <button class="mi go" data-act="back">DONE</button></div></div>`, { back });
  ACT.back = back;
}
function pauseScreen(focus = 0) {
  showMenu(`<div class="panel"><div class="eyebrow">PAUSED · ${G.mode === "onslaught" ? `WAVE ${G.wave}` : "DEATHMATCH"} · SCORE ${G.score.toLocaleString("en-US")}</div><h2>Holding position</h2><div class="menu">
    <button class="mi go" data-act="resume">RESUME</button><button class="mi" data-act="restart">RESTART</button><button class="mi" data-act="controls">CONTROLS</button><button class="mi" data-act="settings">SETTINGS</button><button class="mi" data-act="quit">QUIT TO TITLE</button></div>
    ${Object.keys(AUG.s).length ? `<div class="augs">${Object.entries(AUG.s).map(([id, n]) => `<span>${AUGS.find((a) => a.id === id).icon} ${AUGS.find((a) => a.id === id).name}${n > 1 ? " ×" + n : ""}</span>`).join("")}</div>` : ""}</div>`, { back: resumeGame, focus });
}
function openAugments() {
  G.state = "augment"; exitLock(); musicMode("title");
  const pool = AUGS.filter((a) => AUG.n(a.id) < a.max), choice = [];
  while (choice.length < 3 && pool.length) choice.push(pool.splice((Math.random() * pool.length) | 0, 1)[0]);
  showMenu(`<div class="panel wide aug"><div class="eyebrow">WAVE ${G.wave} CLEARED · CHOOSE AN AUGMENT</div><h2>Field upgrade</h2>
    <div class="cards">${choice.map((a, i) => `<button class="mi card" data-act="aug" data-id="${a.id}"><em>${i + 1}</em><i>${a.icon}</i><b>${a.name}</b><small>${a.desc}</small><span>${AUG.n(a.id) ? `Stack ${AUG.n(a.id) + 1}` : "New"}</span></button>`).join("")}</div>
    <p class="hint">Augments stack. Armor and ammo are topped up for the next wave.</p></div>`, { cls: "augM" });
  ACT.aug = (el) => {
    applyAugment(el.dataset.id); sfx("augment"); closeMenu();
    P.armor = P.maxArmor; for (const w of WEAPONS) w.res = Math.max(w.res, Math.round(w.maxRes * 0.5));
    G.state = "play"; requestLock(); startWave(G.wave + 1);
  };
}
function resultsScreen(win) {
  const s = G.stats, acc = W8.shots ? Math.round((W8.hits / W8.shots) * 100) : 0, t = G.time - s.start;
  const dm = G.mode === "deathmatch";
  const board = dm ? `<div class="board2">${[{ name: "YOU", kills: P.kills, deaths: P.deaths, me: true }, ...ENEMIES].sort((a, b) => b.kills - a.kills).map((e, i) => `<div class="${e.me ? "me" : ""}"><em>${i + 1}</em><span>${e.name}</span><b>${e.kills}</b><i>${e.deaths}</i></div>`).join("")}</div>` : "";
  showMenu(`<div class="panel wide res ${win ? "win" : "lose"}"><div class="eyebrow">${dm ? "DEATHMATCH" : "ONSLAUGHT"} · ${win ? "MISSION COMPLETE" : "OPERATOR DOWN"}</div>
    <h2>${dm ? (win ? "Top of the board" : "Outgunned") : win ? "Rift held" : `KIA · wave ${G.wave}`}</h2>
    ${board}
    <div class="stats">
      <span>Score</span><b>${G.score.toLocaleString("en-US")}</b><span>Kills</span><b>${s.kills}</b>
      <span>Headshots</span><b>${s.heads}</b><span>Accuracy</span><b>${acc}%</b>
      <span>Best rank</span><b>${RANKS[s.bestRank]}</b><span>Damage dealt</span><b>${Math.round(s.dmg).toLocaleString("en-US")}</b>
      <span>Time</span><b>${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}</b><span>${dm ? "Deaths" : "Best wave"}</span><b>${dm ? P.deaths : records.onslaught.wave}</b>
    </div>
    <div class="row"><button class="mi go" data-act="retry">DEPLOY AGAIN</button><button class="mi" data-act="title">TITLE</button></div></div>`, { back: toTitle, cls: "resM" });
}

/* ================================================================ flow */
function exitLock() { try { if (document.pointerLockElement) document.exitPointerLock(); } catch {} }
function resetWorldState() {
  for (const e of ENEMIES) e.remove(); ENEMIES.length = 0; flowCache.clear(); clearProjectiles(); clearPickups();
  for (const tm of teles) tm.visible = false; G.boss = null; HUD.bossBar(null);
}
function startRun(mode) {
  closeMenu(); resetWorldState();
  G.mode = mode; G.state = "play"; G.time = 0; G.score = 0; G.style = 0; G.odMeter = 0; G.odReady = false; G.overdrive = 0; G.kills = 0; G.wave = 0; G.stats = freshStats(); G.hitStop = 0;
  Object.assign(P, { health: 100, maxHealth: 100, maxArmor: 150, armor: 150, alive: true, pitch: 0, yaw: 0, ads: 0, slideT: 0, crouch: 0, recharging: false, lastHurt: -99, recoilP: 0, recoilY: 0, kills: 0, deaths: 0 });
  P.pos.set(0, 0, 34); P.vel.set(0, 0, 0);
  AUG.s = {}; resetLoadout(); W8.shots = W8.hits = 0;
  HUD.show(true); $("styleLog").innerHTML = ""; $("feedBox").innerHTML = "";
  audioEnd(false); audioPause(false); ambience(true);
  if (!AUTO) requestLock();
  titleOp.root.visible = false; for (const m of titleMercs) m.root.visible = false;
  if (mode === "onslaught") startWave(1); else startDeathmatch();
  world.flow(P.pos.x, P.pos.z, flowField);
}
function toTitle() { closeMenu(); resetWorldState(); exitLock(); titleOp.root.visible = true; for (const m of titleMercs) m.root.visible = true; titleScreen(); }
function pauseGame() { if (G.state !== "play") return; G.state = "paused"; exitLock(); audioPause(true); pauseScreen(); }
function resumeGame() { if (G.state !== "paused") return; closeMenu(); G.state = "play"; audioPause(false); if (!AUTO) requestLock(); }
function playerDie() {
  P.alive = false; G.respawnT = 3;
  if (G.mode === "deathmatch") { P.deaths++; const killer = ENEMIES.find((e) => e.alive && e.target === P); if (killer) { killer.kills++; HUD.feed(killer.name, "YOU", false); } HUD.toast("ELIMINATED", "Redeploying in 3 s", "bad", 2600); return; }
  setTimeout(() => endRun(false), 1500);
}
function respawnPlayer() {
  const s = pickSpawn(20); P.pos.set(s.x, 0, s.z); P.vel.set(0, 0, 0); P.health = 100; P.armor = P.maxArmor; P.alive = true; resetLoadout(); P.yaw = Math.atan2(-(0 - s.x), -(0 - s.z));
}
function endRun(win) {
  if (G.state === "over") return;
  G.state = "over"; exitLock(); HUD.show(false);
  audioEnd(true); ambience(false);   // cut music, ambience and the world; the ending sting still plays
  sfx(win ? "victory" : "defeat");
  if (G.mode === "onslaught") { const r = records.onslaught; r.score = Math.max(r.score, G.score); r.wave = Math.max(r.wave, G.wave); if (win) r.cleared = true; }
  else { const r = records.deathmatch; r.kills = Math.max(r.kills || 0, P.kills); if (win) r.wins = (r.wins || 0) + 1; r.score = Math.max(r.score || 0, P.kills); }
  saveRecords();
  setTimeout(() => resultsScreen(win), win ? 600 : 900);
}

/* ================================================================ camera */
const CAMQ = new THREE.Euler(0, 0, 0, "YXZ");
function updateCamera(dt, t) {
  // half of the recoil climbs for good (pull down to control it), half springs back
  const tr = P.recoilP * (1 - Math.exp(-9 * dt)); P.pitch = clamp(P.pitch + tr * 0.5, -1.5, 1.5); P.recoilP -= tr;
  const ty = P.recoilY * (1 - Math.exp(-9 * dt)); P.yaw -= ty * 0.5; P.recoilY -= ty;
  const eye = P.alive ? lerp(1.62, P.slideT > 0 ? 0.82 : 1.02, P.crouch) : damp(camera.position.y - P.pos.y, 0.35, 3, dt);
  P.landDip = damp(P.landDip, 0, 8, dt);
  const hs = Math.hypot(P.vel.x, P.vel.z), bobK = P.ground && P.slideT <= 0 ? clamp(hs / 6, 0, 1) * (1 - P.ads * 0.8) : 0;
  camera.position.set(P.pos.x, P.pos.y + eye - P.landDip + Math.abs(Math.sin(P.bob * 2)) * 0.035 * bobK, P.pos.z);
  const strafe = IN.move.x * (P.ground ? 1 : 0.5);
  P.roll = damp(P.roll, (P.slideT > 0 ? 0.09 : 0) - strafe * 0.012 + (!P.alive ? 0.6 : 0), 6, dt);
  CAMQ.set(P.pitch + P.recoilP, P.yaw + P.recoilY, P.roll); camera.quaternion.setFromEuler(CAMQ);
  if (shakeAmt > 0.001) { camera.position.add(V3(rnd(-1, 1), rnd(-1, 1), rnd(-1, 1)).multiplyScalar(shakeAmt * 0.06)); camera.rotateZ(rnd(-1, 1) * shakeAmt * 0.012); }
  shakeAmt = Math.max(0, shakeAmt - dt * 2.4);
  const w = curW();
  const fov = lerp(settings.fov, w.adsFov * (settings.fov / 80), P.ads) + (P.sprinting ? 5 : 0) + (G.overdrive > 0 ? 4 : 0) + (P.slideT > 0 ? 6 : 0);
  camera.fov = damp(camera.fov, fov, 14, dt); camera.updateProjectionMatrix();
  vmCam.fov = lerp(58, 48, P.ads); vmCam.updateProjectionMatrix();
  camera.updateMatrixWorld(); vmCam.updateMatrixWorld();
}
// Title: an over-the-shoulder shot of the operator watching the quay
const titleOp = (() => {
  const c = { root: opShadow.root.clone(true) }; c.root.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.colorWrite = true; o.material.depthWrite = true; o.castShadow = true; o.receiveShadow = true; } });
  c.mixer = new THREE.AnimationMixer(c.root); c.mixer.clipAction(F.HCLIPS.idle).play(); c.root.position.set(-5.35, 0, -49.9); c.root.rotation.y = Math.PI + 0.75; scene.add(c.root); return c;
})();
const titleMercs = [];
function titleCamera(dt, t) {
  const sway = Math.sin(t * 0.21) * 0.25;
  camera.position.set(-6.1 + sway * 0.3, 1.62 + Math.sin(t * 0.33) * 0.04, -46.4);
  camera.lookAt(-16 + sway * 2, 5.2, -92); camera.fov = damp(camera.fov, 46, 4, dt); camera.updateProjectionMatrix();
  if (innerWidth > 760) camera.setViewOffset(innerWidth, innerHeight, -innerWidth * 0.08, 0, innerWidth, innerHeight); else camera.clearViewOffset();
  titleOp.mixer.update(dt); for (const m of titleMercs) m.mixer.update(dt);
  camera.updateMatrixWorld();
}

/* ================================================================ streaming: later-wave models load in stages, never during heavy fights */
const STREAM = [
  { label: "Harbour ships", run: () => world.stages[0]() },
  { label: "Sentinel robots", run: () => warm("sentinel") }, { label: "Robot hounds", run: () => warm("dog") },
  { label: "Exo heavies", run: () => warm("exo") }, { label: "The Foreman", run: () => warm("boss") },
];
let streamI = 0, streamBusy = false;
async function warm(kind) {
  const t = ensureKind(kind); t.root.position.set(0, -50, 0); scene.add(t.root);
  try { await renderer.compileAsync(scene, camera); } catch {}
  scene.remove(t.root);
}
function heavyCombat() { return G.state === "play" && (ENEMIES.filter((e) => e.alive).length > 4 || G.time - G.lastFire < 1.5); }
async function streamTick() {
  if (streamBusy || streamI >= STREAM.length || heavyCombat()) return;
  streamBusy = true; try { await STREAM[streamI].run(); } catch (e) { console.warn(e); } streamI++; streamBusy = false; updateStreamTag();
}
function updateStreamTag() { const el = $("streamTag"); if (el) el.textContent = streamI >= STREAM.length ? "All assets ready" : `Streaming ${STREAM[streamI].label.toLowerCase()} · ${streamI}/${STREAM.length}`; }

/* ================================================================ main loop */
const STEP_MAX = 1 / 30;
const PROF = PA.params.has("prof") ? (window.__prof = { step: 0, render: 0, n: 0, parts: {} }) : null;
const prof = (k, f) => { if (!PROF) return f(); const a = performance.now(); const r = f(); PROF.parts[k] = lerp(PROF.parts[k] || 0, performance.now() - a, 0.2); return r; };
let fr = 0, aimCheck = 0;
function autopilot() {   // test hook: aims at the nearest visible enemy and fires
  let best = null, bd = 1e9; const eye = camera.position;
  for (const e of ENEMIES) { if (!e.alive) continue; const c = e.center(), d = c.distanceTo(eye); if (d < bd && world.los(eye, c)) { bd = d; best = e; } }
  IN.fire = false; IN.move.set(0, 0, 0);
  if (best) { const c = best.center(), dx = c.x - eye.x, dz = c.z - eye.z, dy = c.y - eye.y; P.yaw = Math.atan2(-dx, -dz); P.pitch = Math.atan2(dy, Math.hypot(dx, dz)); IN.fire = true; IN.move.x = Math.sin(G.time * 0.8); if (bd > 18) IN.move.z = -1; }
  else { const e = ENEMIES.find((e) => e.alive); if (e) { const c = e.root.position; P.yaw = Math.atan2(-(c.x - P.pos.x), -(c.z - P.pos.z)); IN.move.z = -1; } }
  if (curW().mag === 0 && curW().res === 0) selectWeapon((W8.cur + 1) % 3);
}
function frame(dt, t) {
  readInput(dt);
  IN.swayX = IN.lookX * 25; IN.swayY = IN.lookY * 25;
  if (IN.pauseP) { IN.pauseP = false; if (G.state === "play") pauseGame(); else if (G.state === "paused" && MENU && MENU.back === resumeGame) resumeGame(); }
  const reps = SIM || 1, t0 = performance.now();
  for (let r = 0; r < reps; r++) step(r === 0 ? Math.min(dt, STEP_MAX) : STEP_MAX, t, r === 0);
  const t1 = performance.now();
  streamTick();
  if (!SIM || ++fr % 10 === 0) render();
  if (PROF) { const t2 = performance.now(); PROF.step = lerp(PROF.step, t1 - t0, 0.2); PROF.render = lerp(PROF.render, t2 - t1, 0.2); PROF.n++; }
}
function step(rdt, t, first) {
  if (G.state === "play") {
    const sdt = G.hitStop > 0 ? rdt * 0.08 : rdt; G.hitStop = Math.max(0, G.hitStop - rdt);
    G.time += sdt;
    if (AUTO) { autopilot(); P.health = Math.max(P.health, 60); }
    if (P.alive) {
      if (IN.slotP >= 0) selectWeapon(IN.slotP);
      if (IN.swapP) selectWeapon(W8.prev);
      if (IN.nextP) { selectWeapon((W8.cur + Math.sign(IN.nextP) + 3) % 3); IN.nextP = 0; }
      if (IN.reloadP) startReload(); if (IN.grenadeP) throwGrenade(); if (IN.meleeP) melee(); if (IN.overP) activateOverdrive();
      if (IN.fire) fire(); else W8.fireHeld = false;
    }
    if (!first) { IN.slotP = -1; IN.swapP = IN.reloadP = IN.grenadeP = IN.meleeP = IN.overP = IN.jumpP = IN.crouchP = false; }
    prof("player", () => updatePlayer(sdt));
    flowT -= sdt; if (flowT <= 0 && G.mode === "onslaught") { flowT = 0.35; prof("flow", () => world.flow(P.pos.x, P.pos.z, flowField)); }
    prof("enemies", () => { for (const e of ENEMIES) updateEnemy(e, sdt); });
    for (let i = ENEMIES.length - 1; i >= 0; i--) { const e = ENEMIES[i]; if (!e.alive && e.deadT > 5.5 && G.mode === "onslaught") { e.remove(); ENEMIES.splice(i, 1); } }
    updateProjectiles(sdt); updatePickups(sdt);
    if (G.mode === "onslaught") updateWaves(sdt); else updateDeathmatch(sdt);
    // style decays when you stop performing; Overdrive ticks down
    G.styleIdle += sdt; if (G.styleIdle > 2) G.style = Math.max(0, G.style - sdt * (16 + rankOf() * 7));
    if (G.overdrive > 0) { G.overdrive -= sdt; G.odMeter = Math.max(0, (G.overdrive / AUG.odDur()) * 100); if (G.overdrive <= 0) { G.overdrive = 0; G.odMeter = 0; sfx("overdriveOff"); } }
    prof("vm", () => updateViewmodel(sdt, t)); updateCamera(rdt, t);
    if (++aimCheck % 3 === 0) { camera.getWorldDirection(RAY_D); G.aimOnTarget = ENEMIES.some((e) => e.alive && e.rayHit(camera.position, RAY_D, 80)); }
    prof("fx", () => fxUpdate(sdt, t));
    if (first) prof("hud", () => updateHUD(rdt));
  } else if (G.state === "title") { titleCamera(rdt, t); fxUpdate(rdt, t); }
  else if (G.state === "over") { updateCamera(rdt, t); fxUpdate(rdt * 0.3, t); }
  prof("world", () => world.update(G.state === "paused" || G.state === "augment" ? 0 : rdt, t, camera));
}
function fxUpdate(dt, t) {
  SOFT.update(dt); GLOW.update(dt);
  for (const s of eFlashes) if (s.visible) { s.t -= dt; if (s.t <= 0) s.visible = false; }
  for (const m of tracers) if (m.visible) { m.d += m.speed * dt; if (m.d > m.len) { m.visible = false; continue; } m.position.copy(m.from).addScaledVector(m.dir, m.d); m.scale.z = Math.min(m.len - m.d, 6) + 0.01; m.material.opacity = 0.9; }
  for (const s of shells) if (s.m.visible) { s.t -= dt; s.v.y -= 14 * dt; s.m.position.addScaledVector(s.v, dt); s.m.rotation.x += s.w.x * dt; s.m.rotation.y += s.w.y * dt; if (s.m.position.y < 0.01) { s.m.position.y = 0.01; if (s.b++ < 2) { s.v.y *= -0.35; s.v.x *= 0.5; s.v.z *= 0.5; s.w.multiplyScalar(0.5); if (s.b === 1) sfx("shell", { pan: 0.4 }); } else s.v.set(0, 0, 0); } if (s.t <= 0) s.m.visible = false; }
  let anyD = false; const M = new THREE.Matrix4(), Qd = new THREE.Quaternion(), Ed = new THREE.Euler(), Sd = V3();
  for (let i = 0; i < debris.length; i++) { const d = debris[i]; if (d.t <= 0) continue; anyD = true; d.t -= dt; d.v.y -= 18 * dt; d.p.addScaledVector(d.v, dt); d.r.addScaledVector(d.w, dt); if (d.p.y < d.s / 2) { d.p.y = d.s / 2; d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); } M.compose(d.p, Qd.setFromEuler(Ed.set(d.r.x, d.r.y, d.r.z)), Sd.setScalar(d.t > 0 ? d.s : 0)); debrisM.setMatrixAt(i, M); }
  if (anyD) debrisM.instanceMatrix.needsUpdate = true;
  for (const r of rings) if (r.m.visible) { r.t -= dt; const u = 1 - r.t / r.max; r.m.scale.setScalar(0.3 + u * r.r); r.m.material.opacity = (1 - u) * 0.8; if (r.t <= 0) r.m.visible = false; }
  for (const tm of teles) if (tm.visible) { tm.material.opacity = 0.5 + 0.4 * Math.sin(t * 18); tm.rotation.y += dt * 2; }
  boomLight.intensity = damp(boomLight.intensity, 0, 7, dt);
}
function render() {
  const h = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  SOFT.mat.uniforms.uScale.value = GLOW.mat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  renderer.clear(); renderer.render(scene, camera);
  if (G.state === "play" || G.state === "paused" || G.state === "augment") {
    vmSun.color.copy(world.sun.color); renderer.clearDepth(); renderer.render(vmScene, vmCam);
  }
}
function resize() {
  renderer.setSize(innerWidth, innerHeight); camera.aspect = vmCam.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); vmCam.updateProjectionMatrix();
}
addEventListener("resize", resize);

/* ================================================================ boot */
loadStep(0.62, "Briefing the mercenaries");
await frameWait();
ensureKind("wolf"); ensureKind("boar");
for (const [k, x, z, ry] of [["wolf", 2.5, -58.2, -0.9], ["boar", 5.2, -56.4, -1.4]]) { const e = new Enemy(k, V3(x, 0, z)); e.root.rotation.y = ry; titleMercs.push(e); }
G.mode = "onslaught";
loadStep(0.78, "Compiling shaders");
updateCamera(0.016, 0); titleCamera(0.016, 0);
for (const w of WEAPONS) w.fp.group.visible = true;
try { await renderer.compileAsync(scene, camera); await renderer.compileAsync(vmScene, vmCam); } catch {}
for (const w of WEAPONS) w.fp.group.visible = false; WEAPONS[0].fp.group.visible = true;
applySettings();
loadStep(1, "Ready");
G.stats = freshStats();
window.__ir = {
  G, P, W8, WEAPONS, ENEMIES, AUG, world, camera, settings, records, TEMPL, vmCam, vmScene, holder,
  start: (m = "onslaught") => startRun(m), wave: (n) => { for (const e of ENEMIES) e.remove(); ENEMIES.length = 0; G.wave = n - 1; startWave(n); },
  killAll: () => { for (const e of ENEMIES) if (e.alive) killFoe(e, { owner: "player", part: "head", dir: V3(0, 0, -1) }); G.queue.length = 0; },
  spawn: (k, x = 0, z = 10) => spawnEnemy(k, V3(x, 0, z)), info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length }),
  stream: () => streamI, menu: () => MENU, pause: pauseGame, resume: resumeGame, hurt: (d) => hurtPlayer(d, V3(P.pos.x + 5, 1, P.pos.z)), aug: () => openAugments(),
};
setTimeout(() => { LOAD.el.classList.add("done"); setTimeout(() => LOAD.el.remove(), 900); }, 250);
if (THUMB) {
  // gallery shot: mid-fight in a container lane at dusk, rifle up, enemies firing back
  for (const m of titleMercs) m.root.visible = false; titleOp.root.visible = false;
  ensureKind("sentinel"); ensureKind("exo"); world.stages[0]();
  startRun("onslaught"); G.queue.length = 0; G.waveState = "intro"; G.waveT = 999; HUD.show(false);
  P.pos.set(-12, 0, -4.2); P.yaw = Math.PI / 2 + 0.1; P.pitch = 0.05;
  const face = (e) => { const dx = P.pos.x - e.root.position.x, dz = P.pos.z - e.root.position.z; e.yaw = e.root.rotation.y = Math.atan2(dx, dz); };
  const foesT = [spawnEnemy("wolf", V3(-18.6, 0, -6.4)), spawnEnemy("exo", V3(-23.5, 0, -2.2)), spawnEnemy("sentinel", V3(-19.5, 0, -1.2))];
  for (const e of foesT) { face(e); e.actions.idle.setEffectiveWeight(0.4); e.actions.run.setEffectiveWeight(0.6); e.mixer.update(0.35); e.root.updateMatrixWorld(true); }
  for (let i = 0; i < 30; i++) { updateViewmodel(0.016, i * 0.016); updateCamera(0.016, i * 0.016); }
  enemyFlash(foesT[1].muzzle.getWorldPosition(V3()), 1.5); enemyFlash(foesT[0].muzzle.getWorldPosition(V3()), 0.9);
  tracer(foesT[1].muzzle.getWorldPosition(V3()), V3(-12.5, 1.4, -3.6), 0xffd080, 0.04); tracers.forEach((m) => { if (m.visible) { m.d = m.len * 0.35; m.position.copy(m.from).addScaledVector(m.dir, m.d); m.scale.z = 4; } });
  explode(V3(-28, 0.6, -9), { dmg: 0, owner: "world" }); fxUpdate(0.1, 0);
  const w = curW(); w.flash.visible = true; w.flash.scale.setScalar(1.1); vmFlash.intensity = 5; flashLight.intensity = 25;
  G.state = "thumb";
  let n = 0; PA.loop((dt, t) => { world.update(0.016, t, camera); vmSun.color.copy(world.sun.color); renderer.clear(); renderer.render(scene, camera); renderer.clearDepth(); renderer.render(vmScene, vmCam); if (++n > 20) window.__ready = true; });
} else {
  titleScreen();
  if (AUTO) startRun(PA.params.get("mode") || "onslaught");
  PA.loop((dt, t) => frame(dt, t));
}

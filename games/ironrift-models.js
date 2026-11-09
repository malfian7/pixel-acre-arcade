// Iron Rift — procedural models: rigged characters (joint hierarchies driven by AnimationMixer clips),
// a robot dog, the exo heavy and its boss variant, and first-person weapons with real sights.
// Every part on a joint is merged per material, so a whole soldier is ~25 draw calls.

export function createFactory(THREE, renderer) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const rnd = (a, b) => a + Math.random() * (b - a);

  /* ---------------------------------------------------------------- canvas textures */
  function canvasTex(w, h, draw, srgb = true, repeat = 1) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = 4; return t;
  }
  const blobs = (g, w, h, cols, n, rmin, rmax) => { for (let i = 0; i < n; i++) { g.fillStyle = cols[i % cols.length]; g.beginPath(); const x = Math.random() * w, y = Math.random() * h, r = rnd(rmin, rmax); for (let k = 0; k < 9; k++) { const a = (k / 9) * 6.283, rr = r * rnd(0.6, 1.2); g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); } };
  const grain = (g, w, h, a = 0.08) => { const id = g.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 255 * a; d[i] += n; d[i + 1] += n; d[i + 2] += n; } g.putImageData(id, 0, 0); };
  const TEX = {
    camo: canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#6f6a52"; g.fillRect(0, 0, w, h); blobs(g, w, h, ["#8a7f5d", "#4f5238", "#9a8b68", "#3d3a2c", "#5d6346"], 70, 10, 34); grain(g, w, h, 0.1); }, true, 2),
    urban: canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#3b3d42"; g.fillRect(0, 0, w, h); blobs(g, w, h, ["#4b4e55", "#2a2b30", "#575a61"], 60, 10, 30); grain(g, w, h, 0.1); }, true, 2),
    cordura: canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#7c6a4c"; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 3) { g.fillStyle = y % 6 ? "rgba(0,0,0,.08)" : "rgba(255,255,255,.04)"; g.fillRect(0, y, w, 1); } g.strokeStyle = "rgba(30,24,16,.5)"; g.setLineDash([3, 3]); g.strokeRect(6, 6, w - 12, h - 12); grain(g, w, h, 0.08); }),
    wear: canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#808080"; g.fillRect(0, 0, w, h); for (let i = 0; i < 160; i++) { g.strokeStyle = `rgba(${Math.random() < 0.5 ? "255,255,255" : "0,0,0"},${rnd(0.05, 0.25)})`; g.lineWidth = rnd(0.5, 1.5); g.beginPath(); const x = Math.random() * w, y = Math.random() * h, a = Math.random() * 6.28, l = rnd(4, 30); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke(); } grain(g, w, h, 0.12); }, false),
    hazard: canvasTex(128, 32, (g, w, h) => { g.fillStyle = "#d9a400"; g.fillRect(0, 0, w, h); g.fillStyle = "#16161a"; for (let x = -h; x < w + h; x += 24) { g.beginPath(); g.moveTo(x, h); g.lineTo(x + 12, h); g.lineTo(x + 12 + h, 0); g.lineTo(x + h, 0); g.fill(); } grain(g, w, h, 0.12); }),
    fur: (base, dark) => canvasTex(128, 128, (g, w, h) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let i = 0; i < 900; i++) { g.strokeStyle = Math.random() < 0.5 ? dark : "rgba(255,255,255,.18)"; g.lineWidth = 1; g.beginPath(); const x = Math.random() * w, y = Math.random() * h; g.moveTo(x, y); g.lineTo(x + rnd(-2, 2), y + rnd(4, 9)); g.stroke(); } }),
  };

  /* ---------------------------------------------------------------- materials */
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const MAT = {
    camo: std({ map: TEX.camo, roughness: 0.92 }),
    urban: std({ map: TEX.urban, roughness: 0.9 }),
    cordura: std({ map: TEX.cordura, roughness: 0.88 }),
    black: std({ color: 0x1b1c1f, roughness: 0.75 }),
    boot: std({ color: 0x2a2520, roughness: 0.85 }),
    glove: std({ color: 0x24262a, roughness: 0.82 }),
    polymer: std({ color: 0x1e1f22, roughness: 0.55, metalness: 0.15, roughnessMap: TEX.wear }),
    gunmetal: std({ color: 0x2c2e33, roughness: 0.38, metalness: 0.75, roughnessMap: TEX.wear }),
    fde: std({ color: 0x8a7756, roughness: 0.6, metalness: 0.1, roughnessMap: TEX.wear }),
    helmet: std({ color: 0x55573f, roughness: 0.7, metalness: 0.05 }),
    wolf: std({ map: TEX.fur("#7b7f86", "rgba(20,22,26,.35)"), roughness: 0.75 }),
    boar: std({ map: TEX.fur("#5b4231", "rgba(20,12,8,.4)"), roughness: 0.8 }),
    tusk: std({ color: 0xe6dcc4, roughness: 0.4 }),
    shell: new THREE.MeshPhysicalMaterial({ color: 0xe9eaec, roughness: 0.28, metalness: 0.05, clearcoat: 0.6, clearcoatRoughness: 0.25 }),
    joint: std({ color: 0x2b2d31, roughness: 0.45, metalness: 0.6 }),
    exoFrame: std({ color: 0x34373c, roughness: 0.42, metalness: 0.8, roughnessMap: TEX.wear }),
    exoPlate: std({ color: 0x5c6152, roughness: 0.55, metalness: 0.45, roughnessMap: TEX.wear }),
    bossPlate: std({ color: 0x3a3532, roughness: 0.5, metalness: 0.55, roughnessMap: TEX.wear }),
    hazard: std({ map: TEX.hazard, roughness: 0.6, metalness: 0.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x9fb8c8, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false }),
    // emissive parts stay restrained (intensity ~1-2) so nothing blooms into glare
    eyeRed: std({ color: 0x220404, emissive: 0xff2a1a, emissiveIntensity: 1.6 }),
    visor: std({ color: 0x0b0d10, roughness: 0.15, metalness: 0.4, emissive: 0x1f6fff, emissiveIntensity: 0.35 }),
    coreCyan: std({ color: 0x0a1a20, emissive: 0x38d7ff, emissiveIntensity: 1.8 }),
    coreOrange: std({ color: 0x201005, emissive: 0xff7a18, emissiveIntensity: 1.8 }),
    vent: std({ color: 0x150a04, emissive: 0xff5a10, emissiveIntensity: 1.3 }),
    fiber: new THREE.MeshBasicMaterial({ color: 0x6dff5a, toneMapped: false }),
    reddot: new THREE.MeshBasicMaterial({ color: 0xff2414, toneMapped: false, depthTest: false, transparent: true }),
    brass: std({ color: 0xc89b3c, roughness: 0.3, metalness: 0.9 }),
    shellRed: std({ color: 0x9a1c18, roughness: 0.5 }),
  };
  // an invisible material that still casts shadows: the player's own body throws a moving shadow
  const shadowOnly = (m) => { const s = m.clone(); s.colorWrite = false; s.depthWrite = false; return s; };

  /* ---------------------------------------------------------------- geometry helpers */
  const GC = new Map();
  const geo = (key, make) => { if (!GC.has(key)) GC.set(key, make()); return GC.get(key); };
  function rbox(w, h, d, r = 0.02, seg = 2) {   // rounded box: an extruded rounded rectangle with a bevel
    return geo(`rb${w},${h},${d},${r}`, () => {
      const rr = Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3), s = new THREE.Shape(), x = -w / 2 + rr, y = -h / 2 + rr, W = w - 2 * rr, H = h - 2 * rr;
      s.moveTo(x, y - rr); s.lineTo(x + W, y - rr); s.quadraticCurveTo(x + W + rr, y - rr, x + W + rr, y); s.lineTo(x + W + rr, y + H); s.quadraticCurveTo(x + W + rr, y + H + rr, x + W, y + H + rr);
      s.lineTo(x, y + H + rr); s.quadraticCurveTo(x - rr, y + H + rr, x - rr, y + H); s.lineTo(x - rr, y); s.quadraticCurveTo(x - rr, y - rr, x, y - rr);
      const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(1e-3, d - 2 * rr), bevelEnabled: true, bevelThickness: rr, bevelSize: rr * 0.6, bevelSegments: seg, curveSegments: 3 });
      g.translate(0, 0, -(d - 2 * rr) / 2); g.computeVertexNormals(); return g;
    });
  }
  const box = (w, h, d) => geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cyl = (rt, rb, h, s = 12, open = false) => geo(`c${rt},${rb},${h},${s},${open}`, () => new THREE.CylinderGeometry(rt, rb, h, s, 1, open));
  const sph = (r, ws = 14, hs = 10) => geo(`s${r},${ws},${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
  const cap = (r, l, cs = 4, rs = 10) => geo(`p${r},${l},${cs},${rs}`, () => new THREE.CapsuleGeometry(r, l, cs, rs));
  const cone = (r, h, s = 8) => geo(`k${r},${h},${s}`, () => new THREE.ConeGeometry(r, h, s));
  const tor = (r, t, rs = 8, ts = 16, arc = Math.PI * 2) => geo(`t${r},${t},${rs},${ts},${arc}`, () => new THREE.TorusGeometry(r, t, rs, ts, arc));
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler(), P = V(), S = V();
  // merges [{g, m4}] into one non-indexed geometry (position + normal + uv)
  function merge(list) {
    let n = 0; const parts = list.map(({ g, m }) => { const ng = g.index ? g.toNonIndexed() : g.clone(); ng.applyMatrix4(m); n += ng.attributes.position.count; return ng; });
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2); let o = 0;
    for (const p of parts) { const c = p.attributes.position.count; pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); if (p.attributes.uv) uv.set(p.attributes.uv.array, o * 2); o += c; p.dispose(); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere(); return g;
  }
  // collects parts per joint and per material, then merges each bucket into a single mesh on that joint
  class Builder {
    constructor() { this.b = new Map(); }
    add(joint, g, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
      const key = joint.uuid + "|" + (typeof mat === "string" ? mat : mat.uuid);
      if (!this.b.has(key)) this.b.set(key, { joint, mat: typeof mat === "string" ? MAT[mat] : mat, list: [] });
      this.b.get(key).list.push({ g, m: new THREE.Matrix4().compose(P.set(x, y, z), Q.setFromEuler(E.set(rx, ry, rz)), S.set(sx, sy, sz)) });
      return this;
    }
    build({ shadow = true, shadowOnlyMats = false } = {}) {
      const meshes = [];
      for (const { joint, mat, list } of this.b.values()) {
        const m = new THREE.Mesh(merge(list), shadowOnlyMats ? shadowOnly(mat) : mat); m.castShadow = shadow; m.receiveShadow = !shadowOnlyMats; joint.add(m); meshes.push(m);
      }
      return meshes;
    }
  }

  /* ---------------------------------------------------------------- humanoid rig */
  const HB = {   // joint: [parent, x, y, z] — the character faces +z, its right side is −x
    hips: [null, 0, 0.98, 0], spine: ["hips", 0, 0.1, 0], chest: ["spine", 0, 0.2, 0], neck: ["chest", 0, 0.25, 0], head: ["neck", 0, 0.08, 0],
    rArm: ["chest", -0.2, 0.17, 0], rFore: ["rArm", 0, -0.29, 0], rHand: ["rFore", 0, -0.26, 0],
    lArm: ["chest", 0.2, 0.17, 0], lFore: ["lArm", 0, -0.29, 0], lHand: ["lFore", 0, -0.26, 0],
    rThigh: ["hips", -0.1, -0.06, 0], rShin: ["rThigh", 0, -0.43, 0], rFoot: ["rShin", 0, -0.43, 0],
    lThigh: ["hips", 0.1, -0.06, 0], lShin: ["lThigh", 0, -0.43, 0], lFoot: ["lShin", 0, -0.43, 0],
  };
  const DB = {   // robot dog joints, facing +z
    body: [null, 0, 0.62, 0], head: ["body", 0, 0.08, 0.42], turret: ["body", 0, 0.16, -0.05],
    flU: ["body", 0.17, -0.05, 0.3], flL: ["flU", 0, -0.26, 0], frU: ["body", -0.17, -0.05, 0.3], frL: ["frU", 0, -0.26, 0],
    blU: ["body", 0.17, -0.05, -0.3], blL: ["blU", 0, -0.26, 0], brU: ["body", -0.17, -0.05, -0.3], brL: ["brU", 0, -0.26, 0],
  };
  function makeRig(spec) {
    const root = new THREE.Group(), j = {};
    for (const [name, [par, x, y, z]] of Object.entries(spec)) { const o = new THREE.Group(); o.name = name; o.position.set(x, y, z); (par ? j[par] : root).add(o); j[name] = o; }
    return { root, j };
  }

  /* ---------------------------------------------------------------- animation clips (shared by every instance) */
  function clip(name, dur, keys, pos = {}) {
    const tracks = [];
    for (const [bone, frames] of Object.entries(keys)) {
      const times = [], vals = [];
      for (const [t, x, y, z] of frames) { times.push(t); Q.setFromEuler(E.set(x, y, z)); vals.push(Q.x, Q.y, Q.z, Q.w); }
      tracks.push(new THREE.QuaternionKeyframeTrack(bone + ".quaternion", times, vals));
    }
    for (const [bone, frames] of Object.entries(pos)) tracks.push(new THREE.VectorKeyframeTrack(bone + ".position", frames.map((f) => f[0]), frames.flatMap((f) => f.slice(1))));
    return new THREE.AnimationClip(name, dur, tracks);
  }
  const cyc = (T, a, b, ph = 0) => [0, 0.25, 0.5, 0.75, 1].map((u) => { const s = Math.sin((u + ph) * Math.PI * 2); return [u * T, a + b * s]; });
  const legKeys = (T, sw, kn, lean) => {
    const th = (ph) => cyc(T, 0, sw, ph).map(([t, v]) => [t, v, 0, 0]);
    const sh = (ph) => [0, 0.25, 0.5, 0.75, 1].map((u) => [u * T, kn * (0.55 + 0.45 * Math.sin((u + ph + 0.25) * Math.PI * 2)), 0, 0]);
    return { lThigh: th(0), rThigh: th(0.5), lShin: sh(0), rShin: sh(0.5), spine: [[0, lean, 0, 0], [T, lean, 0, 0]] };
  };
  // rifle held at the shoulder: right hand on the grip, left hand on the handguard
  const AIM = { rArm: [-0.45, 0, 0.3], rFore: [-1.15, 0, 0.1], lArm: [-1.0, 0, -0.55], lFore: [-0.6, 0, 0], neck: [0.05, 0, 0] };
  const pose = (T, bob = 0) => Object.fromEntries(Object.entries(AIM).map(([b, [x, y, z]]) => [b, [[0, x, y, z], [T / 2, x + bob, y, z], [T, x, y, z]]]));
  const HCLIPS = {
    idle: clip("idle", 2.4, { ...pose(2.4, 0.03), chest: [[0, 0, 0, 0], [1.2, 0.04, 0, 0], [2.4, 0, 0, 0]], lThigh: [[0, 0, 0, 0.04], [2.4, 0, 0, 0.04]], rThigh: [[0, 0, 0, -0.04], [2.4, 0, 0, -0.04]] }),
    walk: clip("walk", 1.05, { ...pose(1.05, 0.04), ...legKeys(1.05, 0.45, 0.6, 0.06) }, { hips: cyc(1.05, 0.98, 0.02).map(([t, y]) => [t, 0, y, 0]) }),
    run: clip("run", 0.66, { ...pose(0.66, 0.06), ...legKeys(0.66, 0.78, 1.15, 0.2) }, { hips: [0, 0.25, 0.5, 0.75, 1].map((u) => [u * 0.66, 0, 0.94 + 0.04 * Math.abs(Math.sin(u * Math.PI * 2)), 0]) }),
    crouch: clip("crouch", 1.6, { ...pose(1.6, 0.02), lThigh: [[0, -1.2, 0, 0.1], [1.6, -1.2, 0, 0.1]], rThigh: [[0, -0.5, 0, -0.1], [1.6, -0.5, 0, -0.1]], lShin: [[0, 1.5, 0, 0], [1.6, 1.5, 0, 0]], rShin: [[0, 1.9, 0, 0], [1.6, 1.9, 0, 0]], spine: [[0, 0.3, 0, 0], [1.6, 0.3, 0, 0]] }, { hips: [[0, 0, 0.62, 0], [1.6, 0, 0.62, 0]] }),
  };
  const DCLIPS = {
    idle: clip("idle", 1.8, { head: [[0, 0, -0.4, 0], [0.9, 0.05, 0.4, 0], [1.8, 0, -0.4, 0]], turret: [[0, 0, 0.3, 0], [0.9, 0, -0.3, 0], [1.8, 0, 0.3, 0]] }, { body: [[0, 0, 0.62, 0], [0.9, 0, 0.6, 0], [1.8, 0, 0.62, 0]] }),
    run: clip("run", 0.4, (() => { const T = 0.4, u = (ph) => cyc(T, 0, 0.75, ph).map(([t, v]) => [t, v, 0, 0]), l = (ph) => cyc(T, 0.5, 0.5, ph + 0.2).map(([t, v]) => [t, -v, 0, 0]);
      return { flU: u(0), frU: u(0.1), blU: u(0.5), brU: u(0.6), flL: l(0), frL: l(0.1), blL: l(0.5).map(([t, v]) => [t, -v, 0, 0]), brL: l(0.6).map(([t, v]) => [t, -v, 0, 0]), body: cyc(T, 0, 0.08, 0).map(([t, v]) => [t, v, 0, 0]) }; })(), { body: cyc(0.4, 0.6, 0.05).map(([t, y]) => [t, 0, y, 0]) }),
  };

  /* ---------------------------------------------------------------- shared body parts */
  function limbs(B, j, { arm = "camo", leg = "camo", gloves = "glove", boots = "boot", knee = "black", bulk = 1 } = {}) {
    for (const s of ["l", "r"]) {
      B.add(j[s + "Arm"], cap(0.058 * bulk, 0.2, 3, 8), arm, 0, -0.14, 0);
      B.add(j[s + "Fore"], cap(0.05 * bulk, 0.18, 3, 8), arm, 0, -0.12, 0);
      B.add(j[s + "Hand"], rbox(0.08 * bulk, 0.1, 0.05, 0.02), gloves, 0, -0.04, 0.01);
      B.add(j[s + "Thigh"], cap(0.085 * bulk, 0.3, 3, 10), leg, 0, -0.21, 0);
      B.add(j[s + "Shin"], cap(0.065 * bulk, 0.3, 3, 10), leg, 0, -0.21, 0);
      B.add(j[s + "Shin"], rbox(0.11 * bulk, 0.12, 0.06, 0.025), knee, 0, -0.02, 0.06);
      B.add(j[s + "Foot"], rbox(0.11 * bulk, 0.1, 0.27, 0.035), boots, 0, -0.03, 0.06);
    }
  }
  function torso(B, j, { cloth = "camo", carrier = "cordura", bulk = 1 } = {}) {
    B.add(j.hips, rbox(0.34 * bulk, 0.2, 0.22, 0.06), cloth, 0, -0.02, 0);
    B.add(j.hips, rbox(0.36 * bulk, 0.05, 0.24, 0.02), "black", 0, 0.08, 0);   // belt
    B.add(j.spine, rbox(0.3 * bulk, 0.22, 0.2, 0.06), cloth, 0, 0.1, 0);
    B.add(j.chest, rbox(0.4 * bulk, 0.3, 0.24, 0.07), cloth, 0, 0.1, 0);
    B.add(j.chest, rbox(0.36 * bulk, 0.3, 0.07, 0.025), carrier, 0, 0.08, 0.13);   // front plate
    B.add(j.chest, rbox(0.36 * bulk, 0.3, 0.06, 0.025), carrier, 0, 0.1, -0.13);   // back plate
    for (const x of [-0.11, 0, 0.11]) B.add(j.chest, rbox(0.09, 0.12, 0.05, 0.015), carrier, x * bulk, 0.0, 0.18);   // mag pouches
    B.add(j.chest, rbox(0.06, 0.08, 0.04, 0.012), "black", -0.15 * bulk, 0.2, 0.16);   // radio
    for (const s of [-1, 1]) B.add(j.chest, rbox(0.12 * bulk, 0.08, 0.16, 0.03), cloth, s * 0.2 * bulk, 0.2, 0);   // shoulders
    B.add(j.neck, cyl(0.055, 0.06, 0.1, 10), cloth, 0, 0.03, 0);
  }
  function helmet(B, h, { mat = "helmet", scale = 1 } = {}) {
    B.add(h, geo("helm", () => new THREE.SphereGeometry(0.135, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.55)), mat, 0, 0.09, -0.005, 0, 0, 0, scale, scale, scale);
    B.add(h, rbox(0.06, 0.04, 0.05, 0.01), "black", 0, 0.2, 0.08);                    // NVG shroud
    for (const s of [-1, 1]) { B.add(h, cyl(0.045, 0.045, 0.03, 14), "black", s * 0.13, 0.06, 0, 0, 0, Math.PI / 2); B.add(h, box(0.012, 0.03, 0.12), "black", s * 0.135, 0.13, 0); }
    B.add(h, cyl(0.004, 0.004, 0.09, 4), "black", -0.12, 0.05, 0.06, 1.2, 0, 0.3);       // boom mic
  }

  /* ---------------------------------------------------------------- enemy weapons (third person) */
  function rifle3p(B, parent, x, y, z, s = 1) {
    B.add(parent, rbox(0.05 * s, 0.07 * s, 0.4 * s, 0.01), "polymer", x, y, z + 0.05);
    B.add(parent, cyl(0.012 * s, 0.012 * s, 0.32 * s, 8), "gunmetal", x, y + 0.01, z + 0.4, Math.PI / 2);
    B.add(parent, rbox(0.03, 0.12, 0.05, 0.01), "polymer", x, y - 0.08, z + 0.12, 0.25);
    B.add(parent, rbox(0.04, 0.06, 0.2, 0.012), "polymer", x, y - 0.01, z - 0.22);
    B.add(parent, cyl(0.018, 0.018, 0.08, 10), "black", x, y + 0.06, z + 0.06, Math.PI / 2);
  }

  /* ---------------------------------------------------------------- characters */
  const HIT = (bone, x, y, z, r, part) => ({ bone, off: V(x, y, z), r, part });
  function humanoidBase(kind) {
    const { root, j } = makeRig(HB), B = new Builder();
    return { root, j, B, kind };
  }
  function finish(c, mats = {}) {
    const meshes = c.B.build(mats); delete c.B;
    c.mixer = new THREE.AnimationMixer(c.root);
    const clips = c.dog ? DCLIPS : HCLIPS;
    c.actions = {}; for (const [k, cl] of Object.entries(clips)) { const a = c.mixer.clipAction(cl); a.play(); a.setEffectiveWeight(k === "idle" ? 1 : 0); c.actions[k] = a; }
    c.meshes = meshes;
    return c;
  }
  // Wolf- or boar-masked mercenary
  function makeMerc(mask = "wolf") {
    const c = humanoidBase("merc"), { j, B } = c;
    torso(B, j, { cloth: mask === "wolf" ? "urban" : "camo" }); limbs(B, j, { arm: mask === "wolf" ? "urban" : "camo", leg: mask === "wolf" ? "urban" : "camo" });
    const h = j.head;
    B.add(h, sph(0.11, 14, 10), mask, 0, 0.06, 0.0, 0, 0, 0, 1, 1.1, 1);
    helmet(B, h, { mat: mask === "wolf" ? "black" : "helmet" });
    if (mask === "wolf") {
      B.add(h, geo("snoutW", () => { const g = new THREE.CylinderGeometry(0.035, 0.07, 0.16, 8); g.rotateX(Math.PI / 2); return g; }), "wolf", 0, 0.02, 0.15);
      B.add(h, sph(0.02, 8, 6), "black", 0, 0.035, 0.235);
      for (const s of [-1, 1]) { B.add(h, cone(0.04, 0.1, 4), "wolf", s * 0.07, 0.2, 0.0, -0.2, 0, -s * 0.3); B.add(h, box(0.035, 0.012, 0.01), "eyeRed", s * 0.045, 0.085, 0.1); }
    } else {
      B.add(h, geo("snoutB", () => { const g = new THREE.CylinderGeometry(0.065, 0.075, 0.1, 10); g.rotateX(Math.PI / 2); return g; }), "boar", 0, 0.0, 0.14);
      B.add(h, cyl(0.06, 0.06, 0.01, 10), "black", 0, 0.0, 0.19, Math.PI / 2);
      for (const s of [-1, 1]) { B.add(h, cone(0.012, 0.08, 6), "tusk", s * 0.05, -0.01, 0.17, -0.6, 0, s * 0.3); B.add(h, cone(0.035, 0.06, 4), "boar", s * 0.08, 0.17, 0.0, 0, 0, -s * 0.6); B.add(h, box(0.03, 0.012, 0.01), "eyeRed", s * 0.045, 0.08, 0.1); }
    }
    rifle3p(B, j.chest, -0.06, 0.12, 0.3);
    c.muzzle = new THREE.Object3D(); c.muzzle.position.set(-0.06, 0.13, 0.82); j.chest.add(c.muzzle);
    c.hit = [HIT(j.head, 0, 0.07, 0.02, 0.13, "head"), HIT(j.chest, 0, 0.08, 0.02, 0.26, "body"), HIT(j.hips, 0, 0, 0, 0.21, "body"),
      HIT(j.lThigh, 0, -0.2, 0, 0.11, "limb"), HIT(j.rThigh, 0, -0.2, 0, 0.11, "limb"), HIT(j.lShin, 0, -0.2, 0, 0.09, "limb"), HIT(j.rShin, 0, -0.2, 0, 0.09, "limb")];
    return finish(c);
  }
  // White humanoid robot: segmented glossy shell, dark joints, chest core weak point, arm cannon
  function makeSentinel() {
    const c = humanoidBase("sentinel"), { j, B } = c;
    B.add(j.hips, rbox(0.28, 0.16, 0.18, 0.06), "shell", 0, -0.02, 0);
    B.add(j.spine, cyl(0.07, 0.09, 0.2, 12), "joint", 0, 0.08, 0);
    B.add(j.chest, rbox(0.42, 0.34, 0.26, 0.11), "shell", 0, 0.1, 0);
    B.add(j.chest, rbox(0.3, 0.1, 0.2, 0.04), "joint", 0, -0.08, 0);
    B.add(j.chest, cyl(0.055, 0.055, 0.02, 18), "coreCyan", 0, 0.1, 0.13, Math.PI / 2);
    B.add(j.chest, tor(0.07, 0.012, 6, 20), "joint", 0, 0.1, 0.135);
    for (const s of [-1, 1]) B.add(j.chest, sph(0.09, 14, 10), "shell", s * 0.22, 0.2, 0, 0, 0, 0, 1, 0.8, 1);
    B.add(j.neck, cyl(0.035, 0.045, 0.1, 10), "joint", 0, 0.03, 0);
    B.add(j.head, rbox(0.18, 0.2, 0.2, 0.08), "shell", 0, 0.08, 0);
    B.add(j.head, rbox(0.17, 0.05, 0.05, 0.02), "visor", 0, 0.1, 0.08);
    for (const s of ["l", "r"]) {
      B.add(j[s + "Arm"], sph(0.05, 10, 8), "joint", 0, 0, 0); B.add(j[s + "Arm"], cap(0.055, 0.18, 3, 10), "shell", 0, -0.14, 0);
      B.add(j[s + "Fore"], sph(0.04, 10, 8), "joint", 0, 0, 0); B.add(j[s + "Fore"], cap(0.047, 0.17, 3, 10), "shell", 0, -0.13, 0);
      B.add(j[s + "Hand"], rbox(0.07, 0.09, 0.04, 0.02), "joint", 0, -0.04, 0);
      B.add(j[s + "Thigh"], sph(0.06, 10, 8), "joint", 0, 0, 0); B.add(j[s + "Thigh"], cap(0.075, 0.28, 3, 10), "shell", 0, -0.21, 0);
      B.add(j[s + "Shin"], sph(0.05, 10, 8), "joint", 0, 0, 0); B.add(j[s + "Shin"], cap(0.06, 0.3, 3, 10), "shell", 0, -0.21, 0);
      B.add(j[s + "Foot"], rbox(0.1, 0.07, 0.24, 0.03), "joint", 0, -0.03, 0.05);
    }
    // arm cannon on the right forearm
    B.add(j.rFore, rbox(0.09, 0.09, 0.26, 0.03), "joint", 0, -0.2, 0.06, -0.15);
    B.add(j.rFore, cyl(0.025, 0.025, 0.012, 12), "coreCyan", 0, -0.33, 0.07, 0, 0, 0);
    c.muzzle = new THREE.Object3D(); c.muzzle.position.set(0, -0.36, 0.06); j.rFore.add(c.muzzle);
    c.hit = [HIT(j.head, 0, 0.08, 0.02, 0.12, "head"), HIT(j.chest, 0, 0.1, 0.13, 0.08, "weak"), HIT(j.chest, 0, 0.08, 0, 0.27, "body"), HIT(j.hips, 0, 0, 0, 0.2, "body"),
      HIT(j.lThigh, 0, -0.2, 0, 0.1, "limb"), HIT(j.rThigh, 0, -0.2, 0, 0.1, "limb"), HIT(j.lShin, 0, -0.2, 0, 0.08, "limb"), HIT(j.rShin, 0, -0.2, 0, 0.08, "limb")];
    c.robot = true;
    return finish(c);
  }
  // Exoskeleton heavy (and, scaled up with rocket pods, the boss)
  function makeExo(boss = false) {
    const c = humanoidBase(boss ? "boss" : "exo"), { j, B } = c, plate = boss ? "bossPlate" : "exoPlate";
    torso(B, j, { cloth: "urban", carrier: "black", bulk: 1.05 }); limbs(B, j, { arm: "urban", leg: "urban", bulk: 1.05 });
    // powered frame: thick plates over the torso, hydraulic legs and arms, back power pack
    B.add(j.chest, rbox(0.56, 0.42, 0.14, 0.05), plate, 0, 0.1, 0.17);
    B.add(j.chest, rbox(0.5, 0.06, 0.142, 0.01), "hazard", 0, -0.08, 0.17);
    for (const s of [-1, 1]) { B.add(j.chest, rbox(0.24, 0.12, 0.34, 0.05), plate, s * 0.3, 0.3, 0, 0, 0, -s * 0.25); B.add(j.chest, rbox(0.06, 0.2, 0.06, 0.02), "exoFrame", s * 0.2, 0.0, -0.18); }
    B.add(j.chest, rbox(0.42, 0.44, 0.24, 0.05), "exoFrame", 0, 0.1, -0.26);
    for (const x of [-0.12, 0, 0.12]) B.add(j.chest, rbox(0.07, 0.24, 0.02, 0.008), "vent", x, 0.1, -0.385);
    for (const s of ["l", "r"]) {
      B.add(j[s + "Arm"], rbox(0.17, 0.26, 0.17, 0.04), plate, 0, -0.13, 0);
      B.add(j[s + "Fore"], rbox(0.15, 0.24, 0.15, 0.04), "exoFrame", 0, -0.12, 0);
      B.add(j[s + "Thigh"], rbox(0.2, 0.34, 0.2, 0.05), plate, 0, -0.2, 0.01);
      B.add(j[s + "Shin"], rbox(0.17, 0.34, 0.18, 0.04), plate, 0, -0.2, 0.03);
      B.add(j[s + "Shin"], cyl(0.022, 0.022, 0.36, 8), "gunmetal", 0, -0.2, -0.1);
      B.add(j[s + "Foot"], rbox(0.18, 0.12, 0.34, 0.04), "exoFrame", 0, -0.04, 0.07);
    }
    B.add(j.head, sph(0.12, 14, 10), "black", 0, 0.07, 0);
    B.add(j.head, rbox(0.25, 0.27, 0.27, 0.07), plate, 0, 0.09, 0);
    B.add(j.head, rbox(0.2, 0.05, 0.02, 0.01), "eyeRed", 0, 0.1, 0.135);
    // rotary cannon on the right forearm
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; B.add(j.rFore, cyl(0.016, 0.016, 0.55, 6), "gunmetal", Math.cos(a) * 0.045, -0.24 + Math.sin(a) * 0.045, 0.3, Math.PI / 2); }
    B.add(j.rFore, cyl(0.08, 0.08, 0.2, 12), "exoFrame", 0, -0.24, 0.08, Math.PI / 2);
    c.muzzle = new THREE.Object3D(); c.muzzle.position.set(0, -0.24, 0.6); j.rFore.add(c.muzzle);
    if (boss) {
      for (const s of [-1, 1]) {   // shoulder rocket pods
        B.add(j.chest, rbox(0.26, 0.24, 0.36, 0.04), "bossPlate", s * 0.34, 0.5, -0.02);
        for (let k = 0; k < 4; k++) B.add(j.chest, cyl(0.035, 0.035, 0.02, 10), "coreOrange", s * 0.34 + ((k % 2) - 0.5) * 0.11, 0.5 + (Math.floor(k / 2) - 0.5) * 0.11, 0.17, Math.PI / 2);
      }
      c.core = new THREE.Mesh(sph(0.11, 16, 12), MAT.coreOrange); c.core.position.set(0, 0.1, 0.25); c.core.visible = false; j.chest.add(c.core);
      c.pods = [V(-0.34, 0.5, 0.2), V(0.34, 0.5, 0.2)].map((p) => { const o = new THREE.Object3D(); o.position.copy(p); j.chest.add(o); return o; });
    }
    c.hit = [HIT(j.head, 0, 0.09, 0.02, 0.15, "head"), HIT(j.chest, 0, 0.12, -0.3, 0.2, "weak"), HIT(j.chest, 0, 0.1, 0.05, 0.4, "armor"), HIT(j.hips, 0, 0, 0, 0.24, "armor"),
      HIT(j.lThigh, 0, -0.2, 0, 0.14, "limb"), HIT(j.rThigh, 0, -0.2, 0, 0.14, "limb"), HIT(j.lShin, 0, -0.2, 0, 0.12, "limb"), HIT(j.rShin, 0, -0.2, 0, 0.12, "limb")];
    if (boss) c.hit.unshift(HIT(j.chest, 0, 0.1, 0.25, 0.12, "core"));
    finish(c);
    const s = boss ? 1.75 : 1.28; c.root.scale.setScalar(s); c.scale = s;
    return c;
  }
  // Robot dog with a back-mounted turret
  function makeDog() {
    const { root, j } = makeRig(DB), B = new Builder(), c = { root, j, B, kind: "dog", dog: true, robot: true };
    B.add(j.body, rbox(0.34, 0.2, 0.74, 0.07), "shell", 0, 0, 0);
    B.add(j.body, rbox(0.3, 0.06, 0.6, 0.02), "joint", 0, -0.11, 0);
    B.add(j.body, rbox(0.12, 0.04, 0.3, 0.01), "hazard", 0, 0.105, -0.12);
    B.add(j.head, rbox(0.2, 0.13, 0.2, 0.05), "shell", 0, 0, 0.06);
    B.add(j.head, rbox(0.16, 0.035, 0.03, 0.01), "eyeRed", 0, 0.01, 0.16);
    B.add(j.turret, cyl(0.07, 0.08, 0.06, 12), "joint", 0, 0, 0);
    B.add(j.turret, rbox(0.12, 0.08, 0.16, 0.02), "joint", 0, 0.06, 0.02);
    B.add(j.turret, cyl(0.014, 0.014, 0.3, 8), "gunmetal", 0, 0.06, 0.22, Math.PI / 2);
    for (const k of ["fl", "fr", "bl", "br"]) {
      B.add(j[k + "U"], sph(0.055, 10, 8), "joint"); B.add(j[k + "U"], cap(0.045, 0.18, 3, 8), "shell", 0, -0.13, 0);
      B.add(j[k + "L"], sph(0.04, 8, 6), "joint"); B.add(j[k + "L"], cap(0.03, 0.2, 3, 8), "joint", 0, -0.13, 0); B.add(j[k + "L"], sph(0.04, 8, 6), "black", 0, -0.26, 0);
    }
    c.muzzle = new THREE.Object3D(); c.muzzle.position.set(0, 0.06, 0.38); j.turret.add(c.muzzle);
    c.hit = [HIT(j.head, 0, 0, 0.06, 0.12, "weak"), HIT(j.turret, 0, 0.04, 0, 0.1, "weak"), HIT(j.body, 0, 0, 0.15, 0.22, "body"), HIT(j.body, 0, 0, -0.18, 0.22, "body")];
    return finish(c);
  }
  // The player's own body: same rig, drawn only into the shadow map
  function makeOperatorShadow() {
    const c = humanoidBase("operator"), { j, B } = c;
    torso(B, j); limbs(B, j); B.add(j.head, sph(0.11, 12, 8), "camo", 0, 0.06, 0); helmet(B, j.head);
    rifle3p(B, j.chest, -0.06, 0.12, 0.3);
    return finish(c, { shadow: true, shadowOnlyMats: true });
  }

  /* ---------------------------------------------------------------- first-person weapons (point down −z) */
  // Each returns { group, muzzle, eject, grip, fore, mag, sightY, sightZ, ... } where the sight line runs
  // along z at height sightY: aiming moves the weapon so that line sits exactly on the camera axis.
  function fpRifle() {
    const g = new THREE.Group(), B = new Builder();
    B.add(g, rbox(0.052, 0.07, 0.3, 0.008), "fde", 0, 0, 0);                            // upper receiver
    B.add(g, rbox(0.05, 0.05, 0.2, 0.008), "fde", 0, -0.05, 0.03);                       // lower
    B.add(g, rbox(0.058, 0.062, 0.3, 0.01), "polymer", 0, 0.004, -0.28);                 // handguard
    for (let k = 0; k < 7; k++) B.add(g, box(0.06, 0.012, 0.022), "gunmetal", 0, 0.004, -0.17 - k * 0.04);   // M-LOK ribs
    B.add(g, box(0.022, 0.012, 0.5), "gunmetal", 0, 0.041, -0.12);                       // top rail
    B.add(g, cyl(0.011, 0.011, 0.24, 10), "gunmetal", 0, 0.004, -0.55, Math.PI / 2);     // barrel
    B.add(g, cyl(0.016, 0.016, 0.06, 8), "gunmetal", 0, 0.004, -0.69, Math.PI / 2);      // muzzle brake
    B.add(g, rbox(0.036, 0.1, 0.05, 0.012), "polymer", 0, -0.09, 0.08, 0.3);             // grip
    B.add(g, rbox(0.03, 0.02, 0.07, 0.006), "polymer", 0, -0.06, 0.01);                  // trigger guard
    B.add(g, rbox(0.05, 0.075, 0.2, 0.015), "polymer", 0, -0.01, 0.27);                  // stock
    B.add(g, cyl(0.016, 0.016, 0.14, 10), "gunmetal", 0, 0.02, 0.16, Math.PI / 2);       // buffer tube
    B.add(g, rbox(0.03, 0.06, 0.03, 0.01), "polymer", 0, -0.06, -0.28);                  // vertical grip
    // red-dot optic: mount, open tube, a tinted lens and the dot itself
    const sightY = 0.083;
    B.add(g, rbox(0.04, 0.025, 0.06, 0.006), "gunmetal", 0, 0.058, -0.06);
    B.add(g, geo("dotTube", () => { const pts = [[0.024, -0.04], [0.028, -0.04], [0.028, 0.04], [0.024, 0.04]].map(([r, y]) => new THREE.Vector2(r, y)); const t = new THREE.LatheGeometry(pts, 28); t.rotateX(Math.PI / 2); return t; }), "gunmetal", 0, sightY, -0.06);
    B.add(g, rbox(0.016, 0.014, 0.03, 0.004), "gunmetal", 0.032, sightY, -0.06);          // brightness knob
    B.build({ shadow: false });
    const mag = new THREE.Group(); const MB = new Builder();
    for (let k = 0; k < 3; k++) MB.add(mag, rbox(0.03, 0.06, 0.07, 0.006), "polymer", 0, -k * 0.05, k * 0.012, k * 0.12);
    MB.build({ shadow: false }); mag.position.set(0, -0.06, -0.06); g.add(mag);
    const lens = new THREE.Mesh(geo("lens", () => new THREE.CircleGeometry(0.0245, 28)), MAT.glass); lens.position.set(0, sightY, -0.095); lens.renderOrder = 5; g.add(lens);
    const dot = new THREE.Mesh(geo("dot", () => new THREE.CircleGeometry(0.0011, 12)), MAT.reddot); dot.position.set(0, sightY, -0.094); dot.renderOrder = 6; g.add(dot);
    return { kind: "rifle", group: g, mag, magHome: mag.position.clone(), dot, muzzle: obj(g, 0, 0.004, -0.73), eject: obj(g, 0.03, 0.02, -0.02), grip: V(0, -0.09, 0.08), fore: V(0, -0.07, -0.28), sightY, eye: 0.21, hip: V(0.13, -0.135, -0.36) };
  }
  function fpShotgun() {
    const g = new THREE.Group(), B = new Builder();
    B.add(g, rbox(0.05, 0.075, 0.28, 0.01), "gunmetal", 0, 0, 0);
    B.add(g, cyl(0.014, 0.014, 0.52, 12), "gunmetal", 0, 0.018, -0.38, Math.PI / 2);     // barrel
    B.add(g, cyl(0.013, 0.013, 0.44, 10), "gunmetal", 0, -0.016, -0.33, Math.PI / 2);    // magazine tube
    const pump = new THREE.Group(); const PB = new Builder(); PB.add(pump, rbox(0.048, 0.042, 0.17, 0.012), "polymer"); for (let k = 0; k < 5; k++) PB.add(pump, box(0.05, 0.044, 0.008), "black", 0, 0, -0.06 + k * 0.03); PB.build({ shadow: false });
    pump.position.set(0, -0.014, -0.3); g.add(pump);
    B.add(g, rbox(0.04, 0.11, 0.05, 0.014), "polymer", 0, -0.08, 0.09, 0.35);
    B.add(g, rbox(0.045, 0.08, 0.24, 0.02), "polymer", 0, -0.02, 0.26, 0.08);
    B.add(g, rbox(0.03, 0.02, 0.07, 0.006), "polymer", 0, -0.055, 0.02);
    // iron sights: ghost-ring rear notch on the receiver, fibre bead on the barrel
    const sightY = 0.058;
    for (const s of [-1, 1]) B.add(g, rbox(0.006, 0.024, 0.012, 0.002), "black", s * 0.009, 0.046, 0.08);
    B.add(g, box(0.028, 0.006, 0.012), "black", 0, 0.036, 0.08);
    B.add(g, rbox(0.008, 0.024, 0.016, 0.002), "black", 0, 0.04, -0.62);
    B.build({ shadow: false });
    const bead = new THREE.Mesh(sph(0.0026, 8, 6), MAT.fiber); bead.position.set(0, sightY, -0.62); g.add(bead);
    return { kind: "shotgun", group: g, pump, pumpHome: pump.position.clone(), muzzle: obj(g, 0, 0.018, -0.65), eject: obj(g, 0.03, 0.01, -0.02), grip: V(0, -0.08, 0.09), fore: V(0, -0.03, -0.3), sightY, eye: 0.3, hip: V(0.13, -0.13, -0.38) };
  }
  function fpLauncher() {
    const g = new THREE.Group(), B = new Builder();
    B.add(g, cyl(0.055, 0.055, 0.86, 18, true), "exoPlate", 0, 0, -0.2, Math.PI / 2);
    B.add(g, cyl(0.06, 0.06, 0.05, 18, true), "gunmetal", 0, 0, -0.62, Math.PI / 2);
    B.add(g, cyl(0.065, 0.06, 0.08, 18, true), "gunmetal", 0, 0, 0.24, Math.PI / 2);
    B.add(g, rbox(0.04, 0.12, 0.05, 0.014), "polymer", 0, -0.1, 0.03, 0.2);
    B.add(g, rbox(0.04, 0.1, 0.05, 0.014), "polymer", 0, -0.09, -0.25, 0.1);
    B.add(g, rbox(0.03, 0.05, 0.08, 0.01), "black", 0.07, 0.03, -0.1);                   // side optic box
    B.add(g, rbox(0.02, 0.03, 0.02, 0.004), "black", 0, 0.068, 0.0);                      // rear aperture
    B.add(g, rbox(0.006, 0.03, 0.01, 0.002), "black", 0, 0.068, -0.5);                    // front post
    B.add(g, rbox(0.1, 0.012, 0.6, 0.004), "hazard", 0, -0.058, -0.2);
    B.build({ shadow: false });
    const rocket = new THREE.Group(); const RB = new Builder(); RB.add(rocket, cone(0.045, 0.13, 12), "exoFrame", 0, 0, -0.06, -Math.PI / 2); RB.add(rocket, cyl(0.045, 0.045, 0.05, 12), "coreOrange", 0, 0, 0.0, Math.PI / 2); RB.build({ shadow: false });
    rocket.position.set(0, 0, -0.66); g.add(rocket);
    const fb = new THREE.Mesh(sph(0.0028, 8, 6), MAT.fiber); fb.position.set(0, 0.084, -0.5); g.add(fb);
    return { kind: "launcher", group: g, rocket, muzzle: obj(g, 0, 0, -0.72), eject: obj(g, 0, 0, 0.3), grip: V(0, -0.1, 0.03), fore: V(0, -0.09, -0.25), sightY: 0.084, eye: 0.3, hip: V(0.16, -0.15, -0.34) };
  }
  function grenadeMesh() {
    const g = new THREE.Group(), B = new Builder();
    B.add(g, sph(0.033, 12, 10), "exoPlate", 0, 0, 0, 0, 0, 0, 1, 1.15, 1); B.add(g, cyl(0.012, 0.014, 0.025, 8), "gunmetal", 0, 0.04, 0); B.add(g, box(0.008, 0.05, 0.012), "gunmetal", 0.016, 0.02, 0);
    B.build({ shadow: true }); return g;
  }
  function knifeMesh() {
    const g = new THREE.Group(), B = new Builder();
    B.add(g, rbox(0.025, 0.11, 0.03, 0.008), "polymer", 0, -0.05, 0); B.add(g, box(0.004, 0.17, 0.028), "gunmetal", 0, 0.08, 0.004); B.add(g, box(0.05, 0.01, 0.034), "black", 0, 0.005, 0);
    B.build({ shadow: false }); return g;
  }
  const obj = (parent, x, y, z) => { const o = new THREE.Object3D(); o.position.set(x, y, z); parent.add(o); return o; };

  // First-person arms: sleeve + glove capsules posed every frame by a two-joint IK onto the weapon
  function fpArms() {
    const mk = (side) => {
      const up = new THREE.Mesh(cap(0.048, 0.26, 3, 10), MAT.camo), fore = new THREE.Mesh(cap(0.042, 0.22, 3, 10), MAT.camo);
      const cuff = new THREE.Mesh(cyl(0.047, 0.047, 0.05, 12), MAT.black), hand = new THREE.Group(), HBd = new Builder();
      HBd.add(hand, rbox(0.075, 0.095, 0.04, 0.018), "glove", 0, -0.03, 0); for (let k = 0; k < 4; k++) HBd.add(hand, cap(0.011, 0.04, 2, 6), "glove", -0.027 + k * 0.018, -0.1, 0.012, 0.4); HBd.add(hand, cap(0.012, 0.04, 2, 6), "glove", side * 0.04, -0.05, 0.02, 0.4, 0, side * 0.7);
      HBd.add(hand, rbox(0.06, 0.015, 0.03, 0.006), "black", 0, -0.055, 0.022); HBd.build({ shadow: false });
      for (const m of [up, fore, cuff]) m.castShadow = false;
      return { up, fore, cuff, hand };
    };
    return { r: mk(-1), l: mk(1) };
  }

  return { THREE, MAT, TEX, canvasTex, Builder, rbox, box, cyl, sph, cap, cone, merge,
    makeMerc, makeSentinel, makeExo, makeDog, makeOperatorShadow, fpRifle, fpShotgun, fpLauncher, grenadeMesh, knifeMesh, fpArms, HCLIPS, DCLIPS };
}

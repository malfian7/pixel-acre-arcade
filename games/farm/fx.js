// Little Furrow — small world-space feedback:
//   Batches      many tiles' crops/soil drawn as one InstancedMesh per look (crop type × growth stage), so a
//                full 15 × 15 field stays ~20 draw calls; tiles can "bounce" (squash & stretch) when changed
//   bakeGroup    flattens a little group of meshes into one vertex-coloured geometry (used to build each look)
//   Pops         icon sprites that pop, rise and fade: ♥ (petting / feeding / gifts), ! (fish bite), ♪, ✦
//   Highlighter  the tile cursor: a rounded outline with brighter corners that glides to the target tile
//                (exponential ease), pops a little when it moves, warms to orange when the action is valid
import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

export function bakeGroup(group) {
  group.updateMatrixWorld(true);
  const parts = [];
  group.traverse((m) => {
    if (!m.isMesh) return;
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    g.applyMatrix4(m.matrixWorld);
    const c = m.material.color, n = g.attributes.position.count, a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(a, 3));
    parts.push(g);
  });
  return parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
}

export class Batches {
  /** make(sig) → { geometry, material } ; cap = max tiles */
  constructor(scene, make, cap) { this.scene = scene; this.make = make; this.cap = cap; this.looks = new Map(); this.tiles = new Map(); this.dirty = false; this.bouncing = 0; }
  look(sig) {
    let L = this.looks.get(sig);
    if (!L) {
      const { geometry, material, shadow = true } = this.make(sig);
      const mesh = new THREE.InstancedMesh(geometry, material, this.cap); mesh.count = 0; mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.scene.add(mesh); L = { mesh }; this.looks.set(sig, L);
    }
    return L;
  }
  /** sig null = empty tile. */
  set(k, sig, x, z, rot = 0) {
    const cur = this.tiles.get(k);
    if (!sig) { if (cur) { this.tiles.delete(k); this.dirty = true; } return; }
    if (cur && cur.sig === sig && cur.x === x && cur.z === z) return;
    this.tiles.set(k, { sig, x, z, rot, b: cur?.b ?? 1 }); this.look(sig); this.dirty = true;
  }
  bounce(k) { const t = this.tiles.get(k); if (t) { t.b = 0; this.dirty = true; } }
  update(dt) {
    let anim = false;
    for (const t of this.tiles.values()) if (t.b < 1) { t.b = Math.min(1, t.b + dt / 0.38); anim = true; }
    if (!this.dirty && !anim) return;
    this.dirty = false;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (const L of this.looks.values()) L.n = 0;
    for (const t of this.tiles.values()) {
      const L = this.looks.get(t.sig);
      // squash & stretch: pops up tall and thin, then settles with a little overshoot
      const k = t.b, sq = k < 1 ? Math.sin(k * Math.PI) * 0.38 * (1 - k * 0.4) : 0;
      s.set(1 - sq * 0.45, 1 + sq, 1 - sq * 0.45);
      m4.compose(p.set(t.x, 0, t.z), q.setFromAxisAngle(up, t.rot), s);
      L.mesh.setMatrixAt(L.n++, m4);
    }
    for (const L of this.looks.values()) { L.mesh.count = L.n; L.mesh.instanceMatrix.needsUpdate = true; }
  }
}

// ---------------------------------------------------------------- pops
function iconTex(draw) {
  const c = document.createElement("canvas"); c.width = c.height = 32; const g = c.getContext("2d"); draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter; return t;
}
const px = (g, rows, palette, s = 2, ox = 0, oy = 0) => rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== ".") { g.fillStyle = palette[ch]; g.fillRect(ox + x * s, oy + y * s, s, s); } }));
const ICONS = {
  heart: () => iconTex((g) => px(g, [
    "..oo...oo..", ".oRRo.oRRo.", "oRWRRoRRRRo", "oRWRRRRRRRo", "oRRRRRRRRRo", ".oRRRRRRRo.", "..oRRRRRo..", "...oRRRo...", "....oRo....", ".....o.....",
  ], { o: "#5a1530", R: "#f2607e", W: "#ffd6df" }, 2.6, 2, 3)),
  bang: () => iconTex((g) => { g.fillStyle = "#2a1606"; g.beginPath(); g.arc(16, 16, 14, 0, 7); g.fill(); g.fillStyle = "#f4d35e"; g.beginPath(); g.arc(16, 16, 12, 0, 7); g.fill(); g.fillStyle = "#2a1606"; g.fillRect(14, 6, 4, 13); g.fillRect(14, 22, 4, 4); }),
  note: () => iconTex((g) => px(g, ["....oooo", "....oKKo", "....o..o", "....o..o", ".ooo..oo", "oKKo.oKo", "oKKo..o.", ".oo....."], { o: "#2a1606", K: "#b678d6" }, 3.4, 2, 2)),
  star: () => iconTex((g) => px(g, ["....o....", "...oYo...", "oooYYYooo", ".oYYWYYo.", "..oYYYo..", ".oYYoYYo.", ".oYo.oYo.", ".oo...oo."], { o: "#5a3a06", Y: "#f6cf3c", W: "#fff6c8" }, 3.2, 1, 3)),
  drop: () => iconTex((g) => px(g, ["...o...", "..oBo..", ".oBBBo.", "oBWBBBo", "oBWBBBo", "oBBBBBo", ".oBBBo.", "..ooo.."], { o: "#123a5a", B: "#6fb2ee", W: "#d8f0ff" }, 3.4, 4, 2)),
};

export class Pops {
  constructor(scene, n = 24) {
    this.tex = {}; this.items = [];
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, depthTest: false, fog: false }));
      s.visible = false; s.renderOrder = 9; scene.add(s); this.items.push({ s, t: 1, life: 1 });
    }
    this.i = 0;
  }
  emit(kind, x, y, z, { size = 0.42, rise = 0.75, life = 1.1, delay = 0, follow = null } = {}) {
    if (!this.tex[kind]) this.tex[kind] = ICONS[kind]();
    const it = this.items[this.i++ % this.items.length];
    it.s.material.map = this.tex[kind]; it.s.material.needsUpdate = true;
    Object.assign(it, { t: -delay, life, x, y, z, size, rise, follow, dx: (Math.random() - 0.5) * 0.25 });
    it.s.visible = false;
  }
  update(dt) {
    for (const it of this.items) {
      if (it.t >= it.life) { it.s.visible = false; continue; }
      it.t += dt; if (it.t < 0) continue;
      const k = it.t / it.life;
      const base = it.follow ? it.follow() : null;
      const x = (base ? base[0] : it.x) + it.dx * k, z = base ? base[1] : it.z;
      // pop: overshoot scale in the first 20%, then float up and fade in the last 35%
      const u = Math.min(1, k / 0.22) - 1, pop = 1 + 2.7 * u * u * u + 1.7 * u * u; // ease-out-back
      it.s.visible = true; it.s.position.set(x, it.y + (1 - Math.pow(1 - k, 2)) * it.rise, z);
      it.s.scale.setScalar(it.size * Math.max(0.01, pop));
      it.s.material.opacity = k > 0.65 ? 1 - (k - 0.65) / 0.35 : 1;
    }
  }
}

// ---------------------------------------------------------------- tile highlighter
export class Highlighter {
  constructor(scene, n = 3) {
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { color: { value: new THREE.Color(0xf4a63a) }, alpha: { value: 0 }, fill: { value: 0 }, t: { value: 0 } },
      vertexShader: /* glsl */`varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`
        varying vec2 vUv; uniform vec3 color; uniform float alpha, fill, t;
        float box(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r; }
        void main() {
          vec2 p = vUv - 0.5;
          float d = box(p, vec2(0.47), 0.11), w = fwidth(d);
          float ring = 1.0 - smoothstep(0.0, w * 1.5, abs(d + 0.028) - 0.022);
          float corner = smoothstep(0.24, 0.3, abs(p.x)) * smoothstep(0.24, 0.3, abs(p.y));
          float inside = 1.0 - smoothstep(-w, w, d);
          float a = ring * (0.5 + 0.5 * corner) + fill * inside * (0.14 + 0.06 * sin(t * 5.0));
          gl_FragColor = vec4(color, a * alpha);
          #include <colorspace_fragment>
        }`,
    });
    const g = new THREE.PlaneGeometry(1.06, 1.06).rotateX(-Math.PI / 2);
    this.rings = Array.from({ length: n }, () => { const m = new THREE.Mesh(g, this.mat); m.position.y = 0.075; m.visible = false; m.renderOrder = 2; scene.add(m); return { m, x: 0, z: 0, tx: 0, tz: 0, pop: 0, on: false }; });
    this.alpha = 0; this.want = 0; this.ok = false; this.col = new THREE.Color(0xf4a63a);
  }
  /** tiles: [[x,z], …] (first = main), ok: action valid */
  set(tiles, ok, visible) {
    this.want = visible && tiles.length ? 1 : 0; this.ok = ok;
    this.rings.forEach((r, i) => {
      const tl = tiles[i];
      if (!tl) { r.on = false; return; }
      const tx = tl[0] + 0.5, tz = tl[1] + 0.5;
      if (!r.on) { r.x = tx; r.z = tz; r.pop = 1; }
      else if (Math.abs(tx - r.tx) + Math.abs(tz - r.tz) > 0.01) r.pop = 1;
      r.tx = tx; r.tz = tz; r.on = true;
    });
  }
  update(dt, t) {
    const k = 1 - Math.exp(-dt * 18);
    this.alpha += (this.want * (this.ok ? 0.95 : 0.4) - this.alpha) * (1 - Math.exp(-dt * 12));
    this.col.lerp(new THREE.Color(this.ok ? 0xf4a63a : 0xece6fa), 1 - Math.exp(-dt * 10));
    const u = this.mat.uniforms; u.alpha.value = this.alpha; u.color.value.copy(this.col); u.fill.value = this.ok ? 1 : 0; u.t.value = t;
    for (const r of this.rings) {
      r.m.visible = r.on && this.alpha > 0.02;
      if (!r.on) continue;
      r.x += (r.tx - r.x) * k; r.z += (r.tz - r.z) * k;
      r.pop = Math.max(0, r.pop - dt * 5);
      const s = 1 + Math.sin(t * 6) * 0.025 + r.pop * 0.12;
      r.m.position.set(r.x, 0.075, r.z); r.m.scale.set(s, 1, s);
    }
  }
}

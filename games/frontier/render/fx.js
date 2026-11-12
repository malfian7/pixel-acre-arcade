// Frontier Crown — GPU point particles (musket smoke, flashes, dust, wood chips). One draw call per blend mode.

export function createFx(THREE, { fogUniform, mapSize }) {
  const vert = `
    attribute float aSize; attribute float aAlpha; attribute vec3 aCol;
    varying float vA; varying vec3 vC; varying vec2 vFogUv;
    uniform float uScale; uniform float uMap;
    void main() {
      vA = aAlpha; vC = aCol;
      vFogUv = position.xz / uMap;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aSize * uScale / -mv.z;
      gl_Position = projectionMatrix * mv;
    }`;
  const frag = `
    varying float vA; varying vec3 vC; varying vec2 vFogUv;
    uniform sampler2D uFog; uniform float uSoft;
    void main() {
      vec2 p = gl_PointCoord - 0.5; float d = length(p);
      if (d > 0.5) discard;
      float a = smoothstep(0.5, uSoft, d) * vA;
      float f = texture2D(uFog, vFogUv).r;
      gl_FragColor = vec4(vC * f, a);
    }`;

  class System {
    constructor(cap, additive, soft) {
      this.cap = cap; this.n = 0;
      this.pos = new Float32Array(cap * 3); this.vel = new Float32Array(cap * 3);
      this.life = new Float32Array(cap); this.max = new Float32Array(cap);
      this.s0 = new Float32Array(cap); this.s1 = new Float32Array(cap);
      this.a0 = new Float32Array(cap); this.grav = new Float32Array(cap); this.drag = new Float32Array(cap);
      this.col = new Float32Array(cap * 3); this.size = new Float32Array(cap); this.alpha = new Float32Array(cap);
      const g = new THREE.BufferGeometry();
      this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
      this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
      this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
      this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
      g.setAttribute("position", this.aPos); g.setAttribute("aSize", this.aSize); g.setAttribute("aAlpha", this.aAlpha); g.setAttribute("aCol", this.aCol);
      this.mat = new THREE.ShaderMaterial({
        vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        uniforms: { uScale: { value: 600 }, uMap: { value: mapSize }, uFog: fogUniform, uSoft: { value: soft } },
      });
      this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false;
      g.setDrawRange(0, 0);
    }
    emit(x, y, z, vx, vy, vz, life, s0, s1, a0, r, gg, b, grav = 0, drag = 0) {
      if (this.n >= this.cap) return;
      const k = this.n++, q = k * 3;
      this.pos[q] = x; this.pos[q + 1] = y; this.pos[q + 2] = z;
      this.vel[q] = vx; this.vel[q + 1] = vy; this.vel[q + 2] = vz;
      this.life[k] = 0; this.max[k] = life; this.s0[k] = s0; this.s1[k] = s1; this.a0[k] = a0;
      this.col[q] = r; this.col[q + 1] = gg; this.col[q + 2] = b; this.grav[k] = grav; this.drag[k] = drag;
    }
    update(dt) {
      let n = this.n;
      for (let k = 0; k < n; k++) {
        this.life[k] += dt;
        if (this.life[k] >= this.max[k]) { // swap-remove
          n--; this.copy(n, k); k--; continue;
        }
        const q = k * 3, dr = Math.max(0, 1 - this.drag[k] * dt);
        this.vel[q] *= dr; this.vel[q + 1] = this.vel[q + 1] * dr - this.grav[k] * dt; this.vel[q + 2] *= dr;
        this.pos[q] += this.vel[q] * dt; this.pos[q + 1] += this.vel[q + 1] * dt; this.pos[q + 2] += this.vel[q + 2] * dt;
        const t = this.life[k] / this.max[k];
        this.size[k] = this.s0[k] + (this.s1[k] - this.s0[k]) * t;
        this.alpha[k] = this.a0[k] * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
      }
      const had = this.n > 0 || n > 0;
      this.n = n;
      if (had) {
        this.points.geometry.setDrawRange(0, n);
        this.aPos.needsUpdate = this.aSize.needsUpdate = this.aAlpha.needsUpdate = this.aCol.needsUpdate = true;
      }
    }
    copy(from, to) {
      const a = from * 3, b = to * 3;
      for (let i = 0; i < 3; i++) { this.pos[b + i] = this.pos[a + i]; this.vel[b + i] = this.vel[a + i]; this.col[b + i] = this.col[a + i]; }
      this.life[to] = this.life[from]; this.max[to] = this.max[from]; this.s0[to] = this.s0[from]; this.s1[to] = this.s1[from];
      this.a0[to] = this.a0[from]; this.grav[to] = this.grav[from]; this.drag[to] = this.drag[from];
      this.size[to] = this.size[from]; this.alpha[to] = this.alpha[from];
    }
  }

  const smoke = new System(2600, false, 0.15);
  const glow = new System(900, true, 0.0);
  const R = Math.random;

  const api = {
    objects: [smoke.points, glow.points],
    setScale(h) { smoke.mat.uniforms.uScale.value = glow.mat.uniforms.uScale.value = h; },
    update(dt) { smoke.update(dt); glow.update(dt); },
    musket(x, y, z, dx, dz) {
      glow.emit(x + dx * 0.55, y, z + dz * 0.55, 0, 0, 0, 0.09, 0.9, 0.4, 1, 1.0, 0.75, 0.35);
      for (let k = 0; k < 5; k++) smoke.emit(x + dx * (0.5 + k * 0.12), y, z + dz * (0.5 + k * 0.12), dx * (0.8 + R()) + (R() - 0.5) * 0.4, 0.25 + R() * 0.3, dz * (0.8 + R()) + (R() - 0.5) * 0.4, 1.4 + R() * 1.0, 0.45, 1.6 + R() * 0.6, 0.55, 0.88, 0.87, 0.84, -0.12, 1.4);
    },
    impact(x, y, z) { for (let k = 0; k < 3; k++) smoke.emit(x, y, z, (R() - 0.5) * 1.2, 0.6 + R() * 0.8, (R() - 0.5) * 1.2, 0.5, 0.15, 0.4, 0.5, 0.62, 0.52, 0.38, 3, 2); },
    clash(x, y, z) { for (let k = 0; k < 4; k++) glow.emit(x, y, z, (R() - 0.5) * 3, 1 + R() * 2, (R() - 0.5) * 3, 0.18, 0.18, 0.05, 1, 1, 0.85, 0.5, 9, 0); },
    cannon(x, y, z, dx, dz) {
      glow.emit(x + dx * 0.9, y, z + dz * 0.9, 0, 0, 0, 0.14, 2.4, 0.8, 1, 1.0, 0.7, 0.3);
      for (let k = 0; k < 10; k++) smoke.emit(x + dx * 0.9, y, z + dz * 0.9, dx * (1 + R() * 1.5) + (R() - 0.5), 0.3 + R() * 0.5, dz * (1 + R() * 1.5) + (R() - 0.5), 2 + R() * 1.4, 0.8, 2.6 + R(), 0.6, 0.86, 0.85, 0.82, -0.1, 1.2);
    },
    explode(x, y, z, k = 1) {
      glow.emit(x, y + 0.3, z, 0, 0, 0, 0.18, 3.2 * k, 1.2 * k, 1, 1.0, 0.6, 0.25);
      for (let i = 0; i < 14 * k; i++) smoke.emit(x, y + 0.2, z, (R() - 0.5) * 4 * k, 2 + R() * 3 * k, (R() - 0.5) * 4 * k, 0.9 + R() * 0.5, 0.25, 0.5, 0.9, 0.42, 0.33, 0.24, 9, 0.5);
      for (let i = 0; i < 8 * k; i++) smoke.emit(x, y + 0.2, z, (R() - 0.5) * 1.5, 0.5 + R(), (R() - 0.5) * 1.5, (2 + R() * 1.2) * k, 0.8, 2.4 * k, 0.55, 0.45, 0.42, 0.4, -0.05, 1);
    },
    trail(x, y, z) { smoke.emit(x, y, z, (R() - 0.5) * 0.2, 0.15, (R() - 0.5) * 0.2, 0.7, 0.12, 0.55, 0.4, 0.78, 0.76, 0.72, -0.02, 1.5); },
    // thick rolling smoke from a collapsed building
    plume(x, y, z, size = 3) { smoke.emit(x, y, z, (R() - 0.5) * 0.8, 0.9 + R() * 0.8, (R() - 0.5) * 0.8, 2.6 + R() * 1.6, 0.5 + size * 0.1, 2.4 + size * 0.35, 0.55, 0.42 + R() * 0.08, 0.38, 0.34, -0.06, 0.5); },
    fuse(x, y, z) { glow.emit(x, y, z, (R() - 0.5) * 0.6, 0.4 + R() * 0.5, (R() - 0.5) * 0.6, 0.35, 0.22, 0.04, 1, 1.0, 0.75, 0.3, 4, 0); },
    dust(x, y, z, r = 1, n = 10) { for (let k = 0; k < n; k++) { const a = R() * 6.28, d = R() * r; smoke.emit(x + Math.cos(a) * d, y + 0.2, z + Math.sin(a) * d, Math.cos(a) * 0.8, 0.4 + R() * 0.6, Math.sin(a) * 0.8, 1.2 + R() * 1.2, 0.6, 2.2, 0.6, 0.72, 0.64, 0.5, 0, 1.5); } },
    chips(x, y, z, c) { for (let k = 0; k < 3; k++) smoke.emit(x, y, z, (R() - 0.5) * 2, 1.5 + R() * 1.5, (R() - 0.5) * 2, 0.6, 0.12, 0.1, 1, c[0], c[1], c[2], 8, 0); },
    chimney(x, y, z) { smoke.emit(x + (R() - 0.5) * 0.1, y, z + (R() - 0.5) * 0.1, 0.25 + R() * 0.2, 0.6 + R() * 0.3, -0.1 + R() * 0.2, 3.5 + R() * 2, 0.3, 1.8, 0.35, 0.6, 0.6, 0.62, -0.02, 0.3); },
    fire(x, y, z) {
      glow.emit(x + (R() - 0.5) * 0.6, y, z + (R() - 0.5) * 0.6, 0, 1 + R(), 0, 0.5 + R() * 0.3, 0.6, 0.1, 0.9, 1.0, 0.55 + R() * 0.2, 0.15);
      if (R() < 0.5) smoke.emit(x, y + 0.5, z, (R() - 0.5) * 0.3, 1 + R() * 0.5, (R() - 0.5) * 0.3, 2.5, 0.5, 2.2, 0.5, 0.25, 0.23, 0.22, -0.05, 0.3);
    },
    sparkle(x, y, z, r, g, b) { for (let k = 0; k < 8; k++) glow.emit(x + (R() - 0.5) * 0.8, y + R() * 1.2, z + (R() - 0.5) * 0.8, 0, 0.8 + R(), 0, 0.8 + R() * 0.4, 0.3, 0.05, 0.9, r, g, b, 0, 0); },
  };
  return api;
}

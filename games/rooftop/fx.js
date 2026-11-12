// Rooftop Dash — game juice: particles, speed lines, wind dust, landing rings.
//
// Everything lives in world space and is scrolled with the world each frame (the runner stays at z = 0
// and the city moves toward the camera at `speed`), so a puff left on a roof stays on that roof.
//
//   Particles   one GPU point buffer (soft round sprites) for every burst: footstep puffs, landing
//               dust, slide sparks, wall-run sparks, rain splashes, pickup glints. Per particle:
//               colour+alpha, size, velocity, drag, gravity, life. One draw call.
//   SpeedLines  thin streaks around the edge of the view, rushing past; their opacity and length grow
//               with speed (none below ~16 m/s). One instanced draw call.
//   Wind        drifting motes in the air (dust / ash / embers by palette) that sell the speed even when
//               the speed lines are off.
//   Rings       flat expanding shock rings on hard landings.

import * as THREE from "three";

const soft = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d"), r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, "rgba(255,255,255,1)"); r.addColorStop(0.4, "rgba(255,255,255,.55)"); r.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); return t;
})();

export class Particles {
  constructor(scene, max = 700, { additive = false } = {}) {
    this.max = max; this.i = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.life0 = new Float32Array(max);
    this.drag = new Float32Array(max); this.grav = new Float32Array(max); this.grow = new Float32Array(max); this.a0 = new Float32Array(max);
    const g = this.geo = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aColor", new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute("aSize", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { map: { value: soft }, scale: { value: innerHeight * 0.5 } },
      vertexShader: /* glsl */`
        attribute vec4 aColor; attribute float aSize; uniform float scale; varying vec4 vC;
        void main() { vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
          gl_PointSize = aColor.a > 0.003 ? aSize * scale / -mv.z : 0.0; }`,
      fragmentShader: /* glsl */`
        uniform sampler2D map; varying vec4 vC;
        void main() { float a = texture2D(map, gl_PointCoord).a * vC.a; if (a < 0.01) discard; gl_FragColor = vec4(vC.rgb, a); }`,
    });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; this.points.renderOrder = 4;
    scene.add(this.points);
  }
  /** o = { x, y, z, vx, vy, vz, life, size, color: THREE.Color|[r,g,b], alpha, drag, gravity, grow } */
  emit(o) {
    const i = this.i++ % this.max, c = o.color;
    this.pos.set([o.x, o.y, o.z], i * 3); this.vel.set([o.vx || 0, o.vy || 0, o.vz || 0], i * 3);
    this.col.set(c.isColor ? [c.r, c.g, c.b, o.alpha ?? 1] : [c[0], c[1], c[2], o.alpha ?? 1], i * 4);
    this.size[i] = o.size ?? 0.2; this.life[i] = this.life0[i] = o.life ?? 0.5; this.a0[i] = o.alpha ?? 1;
    this.drag[i] = o.drag ?? 2; this.grav[i] = o.gravity ?? 0; this.grow[i] = o.grow ?? 0;
  }
  update(dt, dz) {
    const P = this.pos, V = this.vel;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { if (this.col[i * 4 + 3] !== 0) this.col[i * 4 + 3] = 0; continue; }
      this.life[i] -= dt;
      const k = Math.exp(-this.drag[i] * dt);
      V[i * 3] *= k; V[i * 3 + 1] = V[i * 3 + 1] * k - this.grav[i] * dt; V[i * 3 + 2] *= k;
      P[i * 3] += V[i * 3] * dt; P[i * 3 + 1] += V[i * 3 + 1] * dt; P[i * 3 + 2] += V[i * 3 + 2] * dt + dz;
      const f = Math.max(0, this.life[i] / this.life0[i]);
      this.col[i * 4 + 3] = this.a0[i] * Math.min(1, f * 2.2);
      this.size[i] += this.grow[i] * dt;
    }
    const g = this.geo.attributes; g.position.needsUpdate = g.aColor.needsUpdate = g.aSize.needsUpdate = true;
  }
  resize() { this.mat.uniforms.scale.value = innerHeight * 0.5; }
  clear() { this.life.fill(0); }
}

export class SpeedLines {
  constructor(scene, n = 70) {
    this.n = n;
    const geo = new THREE.PlaneGeometry(0.035, 1, 1, 1); geo.translate(0, 0.5, 0); geo.rotateX(Math.PI / 2); // along +z
    const shade = new Float32Array(geo.attributes.position.count);
    for (let i = 0; i < shade.length; i++) shade[i] = geo.attributes.position.getZ(i) > 0.5 ? 0 : 1; // head bright, tail clear
    geo.setAttribute("aShade", new THREE.BufferAttribute(shade, 1));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { opacity: { value: 0 }, color: { value: new THREE.Color(0xffe2c4) } },
      vertexShader: /* glsl */`attribute float aShade; varying float vS; void main() { vS = aShade; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */`uniform float opacity; uniform vec3 color; varying float vS; void main() { gl_FragColor = vec4(color, opacity * vS); }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, n); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5;
    this.p = Array.from({ length: n }, () => this.spawn({}, true));
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3(); this.v = new THREE.Vector3();
    scene.add(this.mesh);
  }
  spawn(o, anywhere) {
    const a = Math.random() * Math.PI * 2, r = 1.6 + Math.random() * 3.4;
    o.ox = Math.cos(a) * r * 1.4; o.oy = Math.sin(a) * r; o.z = anywhere ? -Math.random() * 40 : -40 - Math.random() * 6; o.k = 0.6 + Math.random() * 0.8;
    return o;
  }
  /** strength 0–1 (from speed), cam = the camera (lines frame the view around its axis) */
  update(dt, speed, strength, cam) {
    this.mat.uniforms.opacity.value = strength * 0.42;
    this.mesh.visible = strength > 0.01;
    if (!this.mesh.visible) return;
    const len = 1.2 + strength * 5;
    for (let i = 0; i < this.n; i++) {
      const o = this.p[i];
      o.z += speed * 1.5 * o.k * dt;
      if (o.z > cam.position.z + 1) this.spawn(o, false);
      this.v.set(cam.position.x + o.ox, cam.position.y - 0.6 + o.oy, o.z);
      this.s.set(1, 1, len * o.k);
      this.m.compose(this.v, this.q, this.s); this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export class Wind {
  constructor(scene, n = 160) {
    this.n = n; this.pos = new Float32Array(n * 3); this.seed = new Float32Array(n);
    for (let i = 0; i < n; i++) { this.reset(i, true); this.seed[i] = Math.random() * 10; }
    const g = this.geo = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    this.mat = new THREE.PointsMaterial({ map: soft, size: 0.09, transparent: true, opacity: 0.6, depthWrite: false, color: 0xffd9b0, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(g, this.mat); this.points.frustumCulled = false; scene.add(this.points);
  }
  reset(i, anywhere) {
    this.pos[i * 3] = (Math.random() - 0.5) * 22; this.pos[i * 3 + 1] = -3 + Math.random() * 10;
    this.pos[i * 3 + 2] = anywhere ? -Math.random() * 50 : -50;
  }
  update(dt, speed, t, baseY) {
    for (let i = 0; i < this.n; i++) {
      const s = this.seed[i];
      this.pos[i * 3] += Math.sin(t * 0.7 + s) * 0.6 * dt - 0.8 * dt;
      this.pos[i * 3 + 1] += Math.cos(t * 0.9 + s * 1.7) * 0.4 * dt;
      this.pos[i * 3 + 2] += (speed * 1.1 + 2) * dt;
      if (this.pos[i * 3 + 2] > 8 || this.pos[i * 3] < -12) { this.reset(i, false); this.pos[i * 3 + 1] += baseY; }
    }
    this.geo.attributes.position.needsUpdate = true;
  }
}

export class Rings {
  constructor(scene, n = 6) {
    this.items = Array.from({ length: n }, () => {
      const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd9b0, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; m.renderOrder = 3; scene.add(m); return { m, t: 1 };
    });
    this.i = 0;
  }
  emit(x, y, z, power, color) {
    const r = this.items[this.i++ % this.items.length]; r.t = 0; r.p = power; r.m.position.set(x, y + 0.03, z); r.m.visible = true; if (color) r.m.material.color.set(color);
  }
  update(dt, dz) {
    for (const r of this.items) {
      if (r.t >= 1) { r.m.visible = false; continue; }
      r.t += dt * 2.2; r.m.position.z += dz;
      const s = 0.3 + r.t * (1.2 + r.p * 2.2); r.m.scale.set(s, 1, s); r.m.material.opacity = (1 - r.t) * 0.55 * Math.min(1, r.p);
    }
  }
}

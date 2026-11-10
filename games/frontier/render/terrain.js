// Frontier Crown — river water, sky, and the fog-of-war texture. (Terrain mesh + shader live in ../terrain/.)

import { W, H, WATER_Y } from "../sim/map.js";

export function buildWater(THREE) {
  const geo = new THREE.PlaneGeometry(W, H, 1, 1); geo.rotateX(-Math.PI / 2); geo.translate(W / 2, WATER_Y, H / 2);
  const mat = new THREE.MeshStandardMaterial({ color: 0x3f7590, roughness: 0.12, metalness: 0.15, transparent: true, opacity: 0.78, envMapIntensity: 1.2 });
  return { geo, mat };
}

export function buildSky(THREE) {
  const g = new THREE.SphereGeometry(400, 24, 12);
  const m = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x6fa3d8) }, mid: { value: new THREE.Color(0xcfe0ea) }, bot: { value: new THREE.Color(0xe9dcc0) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 mid; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, smoothstep(0.0, 0.5, h)) : mix(mid, bot, smoothstep(0.0, -0.3, h)); gl_FragColor = vec4(c, 1.0); }",
  });
  return new THREE.Mesh(g, m);
}

// Fog-of-war texture: 0..1 brightness per tile, eased toward the sim's visibility each frame.
export class FogTexture {
  constructor(THREE) {
    this.data = new Uint8Array(W * H);
    this.cur = new Float32Array(W * H).fill(0.1);
    this.tex = new THREE.DataTexture(this.data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter; this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
    this.reveal = false;
  }
  update(grid, p, dt) {
    const vis = grid.vis[p], exp = grid.exp[p], cur = this.cur, data = this.data;
    const k = Math.min(1, dt * 6);
    let changed = false;
    for (let i = 0; i < cur.length; i++) {
      const t = this.reveal ? 1 : vis[i] ? 1 : exp[i] ? 0.56 : 0.12;
      const c = cur[i];
      if (c !== t) {
        let n = c + (t - c) * k; if (Math.abs(n - t) < 0.01) n = t;
        cur[i] = n; data[i] = n * 255; changed = true;
      }
    }
    if (changed) this.tex.needsUpdate = true;
  }
}

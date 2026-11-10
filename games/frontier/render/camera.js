// Frontier Crown — RTS camera: fixed yaw looking north, pitch eases with zoom, smooth pan/zoom, map clamp.

export class RTSCamera {
  constructor(THREE, camera, heightAt, size = 128) {
    this.THREE = THREE; this.cam = camera; this.heightAt = heightAt; this.size = size;
    this.tx = 30; this.tz = 98; this.dist = 24; this.goalDist = 24; this.minD = 11; this.maxD = 62;
    this.ty = 0; this.shake = 0;
    this.vx = 0; this.vz = 0;
    this.ray = new THREE.Raycaster(); this.v2 = new THREE.Vector2(); this.v3 = new THREE.Vector3();
  }
  get zoomT() { return (this.dist - this.minD) / (this.maxD - this.minD); }
  focus(x, z) { this.tx = x; this.tz = z; this.clamp(); }
  zoom(delta) { this.goalDist = Math.max(this.minD, Math.min(this.maxD, this.goalDist * Math.pow(1.0018, delta))); }
  pan(dx, dz) { const k = this.dist / 30; this.tx += dx * k; this.tz += dz * k; this.clamp(); }
  clamp() { const m = 4; this.tx = Math.max(m, Math.min(this.size - m, this.tx)); this.tz = Math.max(m + 6, Math.min(this.size + 6, this.tz)); }
  update(dt) {
    this.dist += (this.goalDist - this.dist) * Math.min(1, dt * 10);
    const pitch = 0.92 + this.zoomT * 0.22; // ~53° .. 65°
    const h = this.heightAt(this.tx, Math.min(this.size - 0.5, this.tz));
    this.ty += (h - this.ty) * Math.min(1, dt * 4);
    let sx = 0, sy = 0;
    if (this.shake > 0) { this.shake = Math.max(0, this.shake - dt * 2.5); sx = (Math.random() - 0.5) * this.shake * 0.3; sy = (Math.random() - 0.5) * this.shake * 0.3; }
    this.cam.position.set(this.tx + sx, this.ty + this.dist * Math.sin(pitch) + sy, this.tz + this.dist * Math.cos(pitch));
    this.cam.lookAt(this.tx + sx, this.ty, this.tz);
    this.cam.updateMatrixWorld();
  }
  // Ground point under normalized device coords: exact heightfield hit via the TerrainPicker,
  // falling back to marching (for rays that leave the map, e.g. minimap viewport corners).
  ground(ndcX, ndcY) {
    this.v2.set(ndcX, ndcY); this.ray.setFromCamera(this.v2, this.cam);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (this.picker) { const hit = this.picker.intersect(o, d); if (hit) { this.lastHit = hit; return hit; } }
    if (d.y > -0.01) return null;
    let t = (0.4 - o.y) / d.y;
    for (let k = 0; k < 6; k++) {
      const x = o.x + d.x * t, z = o.z + d.z * t;
      const h = this.heightAt(Math.max(0, Math.min(this.size, x)), Math.max(0, Math.min(this.size, z)));
      t = (h - o.y) / d.y;
    }
    return { x: o.x + d.x * t, z: o.z + d.z * t };
  }
  project(x, y, z, w, h) {
    this.v3.set(x, y, z).project(this.cam);
    return [(this.v3.x + 1) / 2 * w, (1 - this.v3.y) / 2 * h, this.v3.z];
  }
}

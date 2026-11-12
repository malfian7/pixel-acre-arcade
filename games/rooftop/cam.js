// Rooftop Dash — the chase camera: smooth follow, speed FOV, landing shake, slide/wall tilt.
//
//   follow   each axis eases toward its target with THREE.MathUtils.lerp and a frame-rate independent
//            factor 1 − e^(−k·dt) (sideways k = 7, height k = 6), so lane changes and roof steps glide
//   FOV      base (by aspect) + up to +13° as the run speeds up (13 → 31 m/s), +4° while sliding,
//            +5° on a wall — eased, so speed is felt in the corners of the screen
//   shake    a "trauma" value (0–1) from hard landings; offset = trauma² × smooth noise (sums of sines,
//            not random jitter), decaying 1.8/s — a thump, never a vibration
//   tilt     the horizon rolls a little into a slide, toward the open side on a wall-run, and with
//            the lean of a lane change
// prefers-reduced-motion: shake × 0.25, FOV kick × 0.4, tilt × 0.5.

import * as THREE from "three";

const { lerp, clamp } = THREE.MathUtils;
const ease = (k, dt) => 1 - Math.exp(-k * dt);

export class RunnerCam {
  constructor(camera, { reduced = false } = {}) {
    this.cam = camera; this.reduced = reduced;
    this.pos = new THREE.Vector3(0, 3, 6); this.look = new THREE.Vector3(0, 1, -9);
    this.trauma = 0; this.roll = 0; this.fovKick = 0; this.t = 0;
    this.phase = [Math.random() * 9, Math.random() * 9, Math.random() * 9];
  }
  baseFov(aspect) { return aspect < 0.8 ? 80 : aspect < 1.2 ? 70 : 60; }
  /** Hard landing etc. 0–1 (stacking, capped). */
  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); }
  noise(i, f) { const p = this.phase[i], t = this.t * f; return Math.sin(t + p) * 0.6 + Math.sin(t * 2.17 + p * 1.3) * 0.3 + Math.sin(t * 4.31 + p * 0.7) * 0.1; }

  /** s = { x, y, laneX, speed, sliding, wall (−1|0|1), dead } */
  update(dt, s) {
    const c = this.cam, a = c.aspect, R = this.reduced;
    this.t += dt;
    const back = a < 0.8 ? 6.4 : 5.2, up = a < 0.8 ? 3.4 : 2.75;
    const low = s.sliding ? -0.55 : 0;
    // follow: smooth per axis
    this.pos.x = lerp(this.pos.x, s.x * 0.55 + s.wall * -0.6, ease(7, dt));
    this.pos.y = lerp(this.pos.y, up + s.y * 0.9 + low, ease(6, dt));
    this.pos.z = lerp(this.pos.z, back + (s.speed - 13) * 0.04, ease(3, dt));
    this.look.x = lerp(this.look.x, s.x * 0.75, ease(8, dt));
    this.look.y = lerp(this.look.y, s.y + 1.0 + low * 0.5, ease(7, dt));
    this.look.z = -9;
    // FOV
    const speedK = clamp((s.speed - 13) / 18, 0, 1);
    const kick = (speedK * 13 + (s.sliding ? 4 : 0) + (s.wall ? 5 : 0)) * (R ? 0.4 : 1);
    this.fovKick = lerp(this.fovKick, kick, ease(4, dt));
    const fov = this.baseFov(a) + this.fovKick;
    if (Math.abs(c.fov - fov) > 0.01) { c.fov = fov; c.updateProjectionMatrix(); }
    // tilt
    const rollT = ((s.sliding ? -0.07 : 0) + s.wall * 0.17 + (s.laneX - s.x) * 0.035) * (R ? 0.5 : 1);
    this.roll = lerp(this.roll, rollT, ease(8, dt));
    // shake (trauma²)
    this.trauma = Math.max(0, this.trauma - dt * 1.8);
    const sh = this.trauma * this.trauma * (R ? 0.25 : 1);
    c.position.set(this.pos.x + this.noise(0, 22) * 0.35 * sh, this.pos.y + this.noise(1, 26) * 0.3 * sh, this.pos.z);
    c.lookAt(this.look);
    c.rotateZ(this.roll + this.noise(2, 18) * 0.035 * sh);
  }
  snap(s) { this.pos.set(s.x * 0.55, 2.75 + s.y, 5.2); this.look.set(s.x * 0.75, s.y + 1, -9); }
}

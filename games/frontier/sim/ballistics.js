// Frontier Crown — deterministic projectile ballistics (shared by the sim and the renderer).
//
// A shell is a point under constant gravity:  p(t) = p0 + v0·t + ½·g·t²  (g pointing down).
// Given the muzzle point, the aim point and a flight time T, the launch velocity is solved in
// closed form, so the shell lands EXACTLY on the aim point at t = T unless something is in the way:
//   v0.xz = Δxz / T          v0.y = (Δy + ½·g·T²) / T
// The sim steps the same formula every tick and tests the terrain and building boxes under the
// shell, so a hill or a wall between gun and target catches the ball early. The view samples the
// same function between ticks — what you see is exactly what the simulation computed.

export const GRAVITY = 18; // tiles / s² — stronger than real gravity, reads better at RTS scale

/** Launch velocity that reaches (x1, y1, z1) from (x0, y0, z0) in T seconds. */
export function launchVelocity(x0, y0, z0, x1, y1, z1, T) {
  return [(x1 - x0) / T, (y1 - y0 + 0.5 * GRAVITY * T * T) / T, (z1 - z0) / T];
}

/** Position at time t of a projectile { x0, y0, z0, vx, vy, vz }. out = [x, y, z]. */
export function ballisticAt(p, t, out = [0, 0, 0]) {
  out[0] = p.x0 + p.vx * t;
  out[1] = p.y0 + p.vy * t - 0.5 * GRAVITY * t * t;
  out[2] = p.z0 + p.vz * t;
  return out;
}

/** Flight time: cannon shells fly flat and fast, grenades lob high and slow. */
export function flightTime(dist, lob) {
  return lob ? 0.55 + dist / 8.5 : 0.3 + dist / 17;
}

// Little Furrow — how ranch animals spend their day. Pure logic (no three.js), tested in node:
// games/farm/wander.test.mjs.
//
// A small state machine per animal:
//
//   idle     stands, looks around (head yaw wobble), now and then makes a sound
//   graze    head down, nibbling (cows and sheep longer than hens)
//   walk     picks a spot in its own pen a few metres away and ambles there, turning smoothly
//            (heading eases toward the target, so cows make wide slow turns and hens zip)
//   happy    after being petted or fed: hops / wiggles in place for a moment (the game pops a ♥)
//   startle  hens and sheep scurry away when the player rushes up to them
//
// Animals never leave their pen rectangle, step around solid tiles and push apart from each other.

export const KIND = {
  chicken: { speed: 1.25, turn: 9, idle: [0.5, 2.0], graze: [0.7, 2.2], reach: 3.2, radius: 0.24, startle: 1.3, voice: 0.05 },
  cow:     { speed: 0.6, turn: 2.6, idle: [1.5, 4.0], graze: [2.5, 6.5], reach: 5.0, radius: 0.55, startle: 0, voice: 0.012 },
  sheep:   { speed: 0.85, turn: 4.2, idle: [1.0, 3.0], graze: [2.0, 5.0], reach: 4.5, radius: 0.42, startle: 1.0, voice: 0.02 },
};
const TAU = Math.PI * 2;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const range = ([a, b], rng) => a + (b - a) * rng();

export function createAnimal(kind, x, z, rng = Math.random) {
  return { kind, x, z, tx: x, tz: z, h: rng() * TAU, v: 0, state: "idle", t: 0, dur: range(KIND[kind].idle, rng), look: 0, hop: 0, gait: rng() * 6 };
}

function setState(a, s, dur) { a.state = s; a.t = 0; a.dur = dur; }

/** Pick a free spot in the pen within `reach` of the animal. */
function pickTarget(a, env, rng) {
  const K = KIND[a.kind], p = env.pen;
  for (let i = 0; i < 10; i++) {
    const ang = rng() * TAU, r = 1 + rng() * (K.reach - 1);
    const x = clampX(a.x + Math.cos(ang) * r, p, K), z = clampZ(a.z + Math.sin(ang) * r, p, K);
    if (!env.solid(Math.floor(x), Math.floor(z))) { a.tx = x; a.tz = z; return true; }
  }
  return false;
}
const clampX = (x, p, K) => Math.max(p.x0 + K.radius, Math.min(p.x1 + 1 - K.radius, x));
const clampZ = (z, p, K) => Math.max(p.z0 + K.radius, Math.min(p.z1 + 1 - K.radius, z));

/**
 * Advance one animal.
 *   env = { pen: {x0,z0,x1,z1}, solid(tx,tz) → bool, others: animals, player: {x, z, speed} | null }
 * Returns events: "voice", "graze", "startle", "step".
 */
export function stepAnimal(a, dt, env, rng = Math.random) {
  const K = KIND[a.kind], ev = [];
  a.t += dt;
  a.hop = Math.max(0, a.hop - dt);
  // the player rushing up scares hens and sheep
  const pl = env.player;
  if (K.startle && pl && a.state !== "happy" && a.state !== "startle") {
    const d = Math.hypot(a.x - pl.x, a.z - pl.z);
    if (d < K.startle && pl.speed > 2.4) {
      const ang = Math.atan2(a.z - pl.z, a.x - pl.x) + (rng() - 0.5) * 0.8;
      a.tx = clampX(a.x + Math.cos(ang) * 2.4, env.pen, K); a.tz = clampZ(a.z + Math.sin(ang) * 2.4, env.pen, K);
      setState(a, "startle", 0.9); ev.push("startle");
    }
  }
  let want = 0; // forward speed this step
  switch (a.state) {
    case "idle":
      a.look = Math.sin(a.t * 1.3 + a.gait) * 0.5;
      if (rng() < K.voice * dt * 10) ev.push("voice");
      if (a.t > a.dur) {
        const r = rng();
        if (r < 0.48 && pickTarget(a, env, rng)) setState(a, "walk", 9);
        else if (r < 0.85) { setState(a, "graze", range(K.graze, rng)); ev.push("graze"); }
        else setState(a, "idle", range(K.idle, rng));
      }
      break;
    case "graze":
      a.look *= Math.exp(-dt * 4);
      if (a.t > a.dur) { if (rng() < 0.55 && pickTarget(a, env, rng)) setState(a, "walk", 9); else setState(a, "idle", range(K.idle, rng)); }
      break;
    case "walk": case "startle": {
      const dx = a.tx - a.x, dz = a.tz - a.z, d = Math.hypot(dx, dz);
      if (d < 0.2 || a.t > a.dur) { setState(a, rng() < 0.5 ? "graze" : "idle", range(rng() < 0.5 ? K.graze : K.idle, rng)); break; }
      const target = Math.atan2(dx, dz);
      a.h = wrap(a.h + wrap(target - a.h) * (1 - Math.exp(-dt * K.turn * (a.state === "startle" ? 2 : 1))));
      // slow down for sharp turns and on arrival: a gentle amble, not a slide
      const facing = Math.max(0, Math.cos(wrap(target - a.h)));
      want = K.speed * (a.state === "startle" ? 2.3 : 1) * facing * Math.min(1, d / 0.6 + 0.3);
      a.look *= Math.exp(-dt * 6);
      break;
    }
    case "happy":
      a.look = Math.sin(a.t * 14) * 0.25;
      if (a.t > a.dur) setState(a, "idle", range(K.idle, rng));
      break;
  }
  a.v += (want - a.v) * (1 - Math.exp(-dt * 6));
  if (a.v > 0.01) {
    const nx = a.x + Math.sin(a.h) * a.v * dt, nz = a.z + Math.cos(a.h) * a.v * dt;
    const blockX = env.solid(Math.floor(nx + Math.sign(Math.sin(a.h)) * K.radius), Math.floor(a.z));
    const blockZ = env.solid(Math.floor(a.x), Math.floor(nz + Math.sign(Math.cos(a.h)) * K.radius));
    if (!blockX) a.x = nx;
    if (!blockZ) a.z = nz;
    if ((blockX || blockZ) && a.state === "walk") { if (!pickTarget(a, env, rng)) setState(a, "idle", 1); }
    const g0 = Math.floor(a.gait / Math.PI); a.gait += a.v * dt * (a.kind === "chicken" ? 16 : 7);
    if (Math.floor(a.gait / Math.PI) !== g0) ev.push("step");
  }
  // personal space
  for (const o of env.others || []) {
    if (o === a) continue;
    const dx = a.x - o.x, dz = a.z - o.z, d = Math.hypot(dx, dz), min = K.radius + KIND[o.kind].radius;
    if (d > 0.0001 && d < min) { const push = (min - d) * 0.5; a.x += dx / d * push; a.z += dz / d * push; }
  }
  a.x = clampX(a.x, env.pen, K); a.z = clampZ(a.z, env.pen, K);
  return ev;
}

/** Petted or fed: a happy wiggle and face the player. */
export function cheer(a, towardX, towardZ) {
  if (towardX != null) a.h = Math.atan2(towardX - a.x, towardZ - a.z);
  setState(a, "happy", 1.1); a.hop = 0.45; a.v = 0;
}

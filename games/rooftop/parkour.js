// Rooftop Dash — the parkour controller: how the courier moves. Pure logic, no three.js (unit-tested in
// node: games/rooftop/parkour.test.mjs). The world tells it what is around (the roof height under the
// feet, a wall beside, a low obstacle ahead); the input tells it what the player pressed; it returns
// what happened. Roofs have different heights, so y is world height and `env.ground` is the surface
// under the runner (null over a gap).
//
//   Coyote time      0.15 s after running off an edge a jump still counts as a ground jump
//   Jump buffer      a press up to 0.15 s before touching down jumps the instant the feet land
//                    (a press higher up is a double jump instead — see `landingSoon`)
//   Variable height  holding jump keeps normal gravity on the way up; letting go multiplies it (cut)
//   Fall multiplier  gravity × 1.75 on the way down, plus a short "hang" at the apex while held
//   Slide            ground: 0.65 s, collider 1.45 → 0.7 m; in the air: dive (fast fall) → roll on landing
//   Roll             any landing faster than 15 m/s (or after a dive): 0.45 s low collider, no slowdown
//   Vault            running at a low obstacle (top ≤ 1.0 m) hops over it automatically
//   Wall-run         airborne in an outer lane next to a wall: ride it for up to 1.1 s with low gravity;
//                    jump while on it = wall jump toward the middle lane

export const PK = {
  lanes: [-2, 0, 2],
  laneK: 18,            // lane change easing (1/s)
  jumpV: 11.6,          // take-off speed (m/s)
  airJumpV: 10.4,       // double jump
  airJumps: 1,
  gravity: 38,          // rising, button held
  cutMult: 2.4,         // rising, button released → short hop
  fallMult: 1.75,       // falling
  hangMult: 0.55,       // |vy| < hangV near the apex while held
  hangV: 1.6,
  diveMult: 3.0,        // slide pressed in the air
  maxFall: 32,
  coyote: 0.15,
  buffer: 0.15,
  slideTime: 0.65,
  rollTime: 0.45,
  rollImpact: 15,       // landing speed (m/s) that turns into a roll
  standH: 1.45, airH: 1.3, lowH: 0.7,
  vaultMaxH: 1.0,       // obstacles up to this top height are vaulted
  vaultTime: 0.34,
  mantleReach: 1.15,    // ledge this far above the feet can still be grabbed
  mantleTime: 0.3,
  wallX: 2.45,          // where the body hugs a wall (|x|)
  wallRunMax: 1.1,
  wallRunG: 3.2,        // gravity while wall-running
  wallJumpV: 11.2,
};

export function createRunner() {
  return {
    x: 0, lane: 1, y: 0, vy: 0, grounded: true,
    coyote: 0, buffer: 0, airJumps: PK.airJumps, held: false,
    slideT: 0, rollT: 0, dive: false, vault: null, wall: null, wallCoyote: 0, wallSide: 0,
    fallStartY: 0, airT: 0, dead: false,
  };
}

/** Collider top (m above the feet). */
export function height(r) {
  if (r.slideT > 0 || r.rollT > 0) return PK.lowH;
  return r.grounded ? PK.standH : PK.airH;
}

/** Seconds until the feet reach `ground` at the current fall, or Infinity. */
function timeToGround(r, ground) {
  const h = r.y - ground;
  if (h <= 0) return 0;
  if (r.vy > 0) return Infinity;
  const g = PK.gravity * PK.fallMult, v = -r.vy; // falling: h(t) = h − v t − g t²/2
  return (-v + Math.sqrt(v * v + 2 * g * h)) / g;
}

/**
 * Advance one step.
 *   env:   { ground: roof height under the runner | null (gap), killY: fall below this = lost,
 *            wall: (side) => bool, lowAhead: (lane) => { top } | null  (top = height above the roof) }
 *   input: { jump: pressed this step, held, slide: pressed this step, lane: −1 | 0 | 1 }
 * Returns a list of events: jump, airjump, walljump, land {impact}, roll, slide, dive, vault, wallrun,
 * wallend, fall.
 */
export function step(r, dt, env, input) {
  const ev = [];
  if (r.dead) return ev;
  r.held = !!input.held;
  // ---- lanes (not outward while on a wall)
  if (input.lane) {
    const to = Math.max(0, Math.min(2, r.lane + input.lane));
    if (!(r.wall && Math.sign(PK.lanes[to]) === r.wall.side && to !== r.lane)) r.lane = to;
  }
  const tx = r.wall ? r.wall.side * PK.wallX : PK.lanes[r.lane];
  r.x += (tx - r.x) * (1 - Math.exp(-dt * PK.laneK));

  // ---- inputs → intents
  if (input.jump) {
    if (r.grounded || r.coyote > 0) r.buffer = PK.buffer;                 // ground jump (now or on landing)
    else if (r.wall || r.wallCoyote > 0) { wallJump(r, ev); }
    else if (env.ground != null && timeToGround(r, env.ground) < PK.buffer) r.buffer = PK.buffer; // about to land: buffer it
    else if (r.airJumps > 0) { r.airJumps--; r.vy = PK.airJumpV; r.dive = false; ev.push("airjump"); }
  }
  if (input.slide) {
    if (r.grounded && r.slideT <= 0 && r.rollT <= 0) { r.slideT = PK.slideTime; ev.push("slide"); }
    else if (!r.grounded && !r.wall) { r.dive = true; ev.push("dive"); }
  }

  // ---- buffered ground jump
  if (r.buffer > 0 && (r.grounded || r.coyote > 0) && !r.vault) {
    r.buffer = 0; r.coyote = 0; r.grounded = false; r.vy = PK.jumpV; r.slideT = 0; r.rollT = 0; r.dive = false;
    r.airJumps = PK.airJumps; r.fallStartY = r.y; r.airT = 0;
    ev.push("jump");
  }
  r.buffer = Math.max(0, r.buffer - dt);
  r.coyote = Math.max(0, r.coyote - dt);
  r.wallCoyote = Math.max(0, r.wallCoyote - dt);

  // ---- vault: low obstacle right ahead while running
  // (it also cuts a slide or roll short: touching a low obstacle always means going over it)
  if (r.grounded && !r.vault) {
    const o = env.lowAhead && env.lowAhead(r.lane);
    if (o && o.top <= PK.vaultMaxH) { r.vault = { t: 0, base: r.y, peak: o.top + 0.22, obj: o }; r.slideT = 0; r.rollT = 0; ev.push("vault"); }
  }
  if (r.vault) {
    const v = r.vault; v.t += dt;
    const k = Math.min(1, v.t / (v.mantle ? PK.mantleTime : PK.vaultTime));
    if (v.mantle) r.y = v.base + (v.target - v.base) * Math.sin(k * Math.PI / 2) + Math.sin(k * Math.PI) * 0.25;
    else r.y = v.base + Math.sin(k * Math.PI) * v.peak;
    if (k >= 1) {
      r.y = v.mantle ? v.target : v.base; r.vault = null; r.grounded = true; r.vy = 0; r.airJumps = PK.airJumps;
      if (env.ground == null) { r.grounded = false; r.coyote = PK.coyote; }
    }
    return finish(r, dt, ev);
  }

  // ---- ground: walked off an edge (or the roof steps down)?
  if (r.grounded && (env.ground == null || env.ground < r.y - 0.05)) { r.grounded = false; r.coyote = PK.coyote; r.vy = 0; r.fallStartY = r.y; r.airT = 0; }
  else if (r.grounded) r.y = env.ground;

  if (!r.grounded) {
    r.airT += dt;
    // wall-run: outer lane, airborne, wall on that side
    const side = Math.sign(PK.lanes[r.lane]);
    if (!r.wall && side && env.wall && env.wall(side) && r.y > env.killY + 1) {
      r.wall = { side, t: 0 }; r.vy = Math.max(r.vy, 1.2); r.airJumps = PK.airJumps; r.dive = false; ev.push("wallrun");
    }
    if (r.wall) {
      r.wall.t += dt;
      if (!env.wall(r.wall.side) || r.wall.t > PK.wallRunMax) { r.wallSide = r.wall.side; r.wall = null; r.wallCoyote = PK.coyote; ev.push("wallend"); }
    }
    let g = PK.gravity;
    if (r.wall) g = PK.wallRunG;
    else if (r.dive) g *= PK.diveMult;
    else if (r.vy < 0) g *= PK.fallMult;
    else if (!r.held) g *= PK.cutMult;
    else if (r.vy < PK.hangV) g *= PK.hangMult;
    r.vy = Math.max(-PK.maxFall, r.vy - g * dt);
    r.y += r.vy * dt;
    // landing (only from above the roof surface: below it you hit the building's side)
    const G = env.ground;
    if (G != null && r.vy <= 0 && r.y <= G && r.y > G - 0.45) {
      const impact = -r.vy, rolled = r.dive || impact > PK.rollImpact;
      ev.push({ type: "land", impact, drop: r.fallStartY - G, airT: r.airT });
      r.y = G; r.vy = 0; r.grounded = true; r.airJumps = PK.airJumps; r.wall = null;
      if (rolled) { r.rollT = PK.rollTime; ev.push("roll"); }
      r.dive = false;
      if (r.buffer > 0) { r.buffer = 0; r.grounded = false; r.vy = PK.jumpV; r.rollT = 0; r.fallStartY = r.y; r.airT = 0; ev.push("jump"); ev.push("buffered"); }
    } else if (G != null && r.y <= G - 0.45 && r.y > G - PK.mantleReach && !r.dead) {
      // a little short of the ledge: grab it and climb up (mantle) instead of hitting the wall
      r.vault = { t: 0, base: r.y, target: G, mantle: true }; r.wall = null; r.dive = false; ev.push("mantle");
    } else if (G != null && r.y <= G - PK.mantleReach && !r.dead) { r.dead = true; ev.push("smack"); } // into the building's side
    if (r.vy > 0) r.fallStartY = Math.max(r.fallStartY, r.y);
    if (r.y < env.killY && !r.dead) { r.dead = true; ev.push("fall"); }
  }
  return finish(r, dt, ev);
}

function wallJump(r, ev) {
  const side = r.wall ? r.wall.side : r.wallSide;
  r.wall = null; r.wallCoyote = 0; r.vy = PK.wallJumpV; r.lane = 1; r.dive = false;
  ev.push({ type: "walljump", side });
}

function finish(r, dt, ev) {
  r.slideT = Math.max(0, r.slideT - dt);
  r.rollT = Math.max(0, r.rollT - dt);
  return ev;
}

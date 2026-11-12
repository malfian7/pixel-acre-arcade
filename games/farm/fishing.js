// Little Furrow — fishing. Pure logic (no three.js), tested in node: games/farm/fishing.test.mjs.
//
//   cast    the line flies out (0.45 s) and the bobber lands with a plop
//   wait    a fish nibbles now and then (small dips) until it bites, 1.2–4.5 s (sooner in the rain)
//   bite    the bobber dunks and a "!" pops: press Use within the window (0.8 s, 1.1 s on touch) to hook it
//   reel    a short reel-in, then the catch is shown
// Pressing too early reels in an empty line; missing the window lets the fish get away.
// Which fish depends on the spot (pond or river), the season and the hour.

export const FISH = {
  loach:   { name: "Pond loach",   sell: 40,  spots: ["pond", "river"], seasons: [0, 1, 2, 3], hours: [5, 27],  w: 10, color: "#a8875a", accent: "#6b5236" },
  carp:    { name: "Silver carp",  sell: 75,  spots: ["pond"],          seasons: [0, 1, 2],    hours: [6, 20],  w: 6,  color: "#c9ced8", accent: "#7f8798" },
  sunfish: { name: "Sunfish",      sell: 65,  spots: ["pond", "river"], seasons: [1],          hours: [8, 18],  w: 7,  color: "#f4b13a", accent: "#4f8fb8" },
  trout:   { name: "River trout",  sell: 95,  spots: ["river"],         seasons: [0, 2, 3],    hours: [5, 20],  w: 6,  color: "#8fae7a", accent: "#e88a8a" },
  catfish: { name: "Moon catfish", sell: 150, spots: ["pond", "river"], seasons: [0, 1, 2, 3], hours: [19, 27], w: 4,  color: "#5a5f78", accent: "#c9c3d6" },
  koi:     { name: "Golden koi",   sell: 420, spots: ["pond"],          seasons: [0, 1, 2, 3], hours: [5, 27],  w: 0.6, color: "#f6cf3c", accent: "#ef8a2b" },
};

export const ROD = { castTime: 0.45, waitMin: 1.2, waitMax: 4.5, window: 0.8, touchWindow: 1.1, reelTime: 0.6 };

export function fishFor(spot, season, hour, weather, rng = Math.random) {
  const pool = Object.entries(FISH).filter(([, f]) => f.spots.includes(spot) && f.seasons.includes(season) && hour >= f.hours[0] && hour < f.hours[1]);
  let total = 0;
  const w = pool.map(([id, f]) => { let x = f.w; if (weather === "rain" && (id === "catfish" || id === "trout")) x *= 2; total += x; return x; });
  let r = rng() * total;
  for (let i = 0; i < pool.length; i++) { r -= w[i]; if (r <= 0) return pool[i][0]; }
  return pool.length ? pool[pool.length - 1][0] : "loach";
}

export function createRod() { return { phase: "idle", t: 0, biteAt: 0, nibbles: [], fish: null, ctx: null }; }

/** ctx = { spot, season, hour, weather, touch } */
export function cast(r, ctx, rng = Math.random) {
  if (r.phase !== "idle") return false;
  r.phase = "cast"; r.t = 0; r.ctx = ctx; r.fish = null;
  r.biteAt = ROD.waitMin + rng() * (ROD.waitMax - ROD.waitMin) * (ctx.weather === "rain" ? 0.6 : 1);
  r.nibbles = []; for (let k = 0.6; k < r.biteAt - 0.4; k += 0.5 + rng() * 0.9) r.nibbles.push(k);
  r.rng = rng;
  return true;
}

/** Advance; returns events: "land", "nibble", "bite", "escape", "caught". */
export function stepRod(r, dt) {
  const ev = [];
  if (r.phase === "idle") return ev;
  const t0 = r.t; r.t += dt;
  if (r.phase === "cast" && r.t >= ROD.castTime) { r.phase = "wait"; r.t = 0; ev.push("land"); }
  else if (r.phase === "wait") {
    for (const n of r.nibbles) if (t0 < n && r.t >= n) ev.push("nibble");
    if (r.t >= r.biteAt) { r.phase = "bite"; r.t = 0; r.fish = fishFor(r.ctx.spot, r.ctx.season, r.ctx.hour, r.ctx.weather, r.rng); ev.push("bite"); }
  } else if (r.phase === "bite" && r.t > (r.ctx.touch ? ROD.touchWindow : ROD.window)) { r.phase = "idle"; r.t = 0; r.fish = null; ev.push("escape"); }
  else if (r.phase === "reel" && r.t >= ROD.reelTime) { r.phase = "idle"; r.t = 0; ev.push("caught"); }
  return ev;
}

/** Player pressed Use while the line is out. Returns "hook" | "early" | null. */
export function pull(r) {
  if (r.phase === "bite") { r.phase = "reel"; r.t = 0; return "hook"; }
  if (r.phase === "cast" || r.phase === "wait") { r.phase = "idle"; r.t = 0; return "early"; }
  return null;
}

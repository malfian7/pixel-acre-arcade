// node games/farm/farm.test.mjs — wander FSM, fishing and sky palette.
import { createAnimal, stepAnimal, cheer, KIND } from "./wander.js";
import { createRod, cast, stepRod, pull, fishFor, FISH, ROD } from "./fishing.js";
import { skyAt } from "./sky.js";
import { buildMap, PENS, SOLID } from "./layout.js";
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
let seed = 5; const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const M = buildMap(); const solid = (x, z) => SOLID.has(M.at(x, z));

// ---- wander: 10 minutes of ranch life
const herd = [];
for (const kind of ["chicken", "chicken", "chicken", "cow", "cow", "sheep", "sheep"]) { const p = PENS[kind]; herd.push(createAnimal(kind, (p.x0 + p.x1) / 2 + rng() * 2, (p.z0 + p.z1) / 2 + rng() * 2, rng)); }
const visits = {}; let inside = true, maxSpeed = 0, steps = 0, overlap = 0;
for (let i = 0; i < 600 * 60; i++) {
  for (const a of herd) {
    const px = a.x, pz = a.z;
    const ev = stepAnimal(a, 1 / 60, { pen: PENS[a.kind], solid, others: herd, player: null }, rng);
    if (ev.includes("step")) steps++;
    visits[a.kind + ":" + a.state] = (visits[a.kind + ":" + a.state] || 0) + 1;
    const p = PENS[a.kind]; if (a.x < p.x0 || a.x > p.x1 + 1 || a.z < p.z0 || a.z > p.z1 + 1 || solid(Math.floor(a.x), Math.floor(a.z))) inside = false;
    if (i > 120) maxSpeed = Math.max(maxSpeed, Math.hypot(a.x - px, a.z - pz) * 60 / KIND[a.kind].speed);
  }
}
ok(inside, "10 min: every animal stayed in its pen and off solid tiles");
for (const k of ["chicken", "cow", "sheep"]) for (const s of ["idle", "graze", "walk"]) ok(visits[k + ":" + s] > 300, `${k} spends time in ${s} (${((visits[k + ":" + s] || 0) / 600 / 60).toFixed(1)} s·n)`);
ok(maxSpeed < 1.6, `never faster than ~speed (peak ${maxSpeed.toFixed(2)}× incl. separation)`);
ok(steps > 1000, `footsteps fire (${steps})`);
// startle
const hen = createAnimal("chicken", 46, 11, rng); const ev = stepAnimal(hen, 1 / 60, { pen: PENS.chicken, solid, others: [], player: { x: 46.5, z: 11.2, speed: 3.6 } }, rng);
ok(ev.includes("startle") && hen.state === "startle", "hens scatter from a rushing player");
const cow = createAnimal("cow", 36, 15, rng); stepAnimal(cow, 1 / 60, { pen: PENS.cow, solid, others: [], player: { x: 36.4, z: 15, speed: 3.6 } }, rng);
ok(cow.state !== "startle", "cows don't");
cheer(hen, 47, 12); ok(hen.state === "happy" && hen.hop > 0, "petting → happy");
for (let i = 0; i < 120; i++) stepAnimal(hen, 1 / 60, { pen: PENS.chicken, solid, others: [], player: null }, rng);
ok(hen.state !== "happy", "…and back to its day after a second");

// ---- fishing
const r = createRod(); cast(r, { spot: "pond", season: 0, hour: 10, weather: "sun", touch: false }, rng);
let evs = []; for (let i = 0; i < 600 && r.phase !== "bite"; i++) evs.push(...stepRod(r, 1 / 60));
ok(evs[0] === "land" && evs.includes("bite") && r.phase === "bite", `cast → land → bite (${evs.filter((e) => e === "nibble").length} nibbles first)`);
ok(pull(r) === "hook" && r.fish, "hooked a " + r.fish);
let got = []; for (let i = 0; i < 60; i++) got.push(...stepRod(r, 1 / 60)); ok(got.includes("caught") && r.phase === "idle", "reel in → caught");
cast(r, { spot: "pond", season: 0, hour: 10, weather: "sun" }, rng); for (let i = 0; i < 600 && r.phase !== "bite"; i++) stepRod(r, 1 / 60);
let esc = []; for (let i = 0; i < 70; i++) esc.push(...stepRod(r, 1 / 60)); ok(esc.includes("escape"), "missing the window lets it go");
cast(r, { spot: "river", season: 0, hour: 10, weather: "sun" }, rng); stepRod(r, 0.5); ok(pull(r) === "early" && r.phase === "idle", "pulling early reels in empty");
const night = new Set(), day = new Set(); for (let i = 0; i < 400; i++) { night.add(fishFor("pond", 2, 22, "sun", rng)); day.add(fishFor("river", 1, 12, "sun", rng)); }
ok(night.has("catfish") && !night.has("carp"), "night pond: catfish yes, carp no " + [...night]);
ok(day.has("sunfish") && !day.has("koi") && !day.has("catfish"), "summer river noon: " + [...day]);

// ---- sky
const at = (h) => skyAt(h, "sun");
ok(at(12).lightI > 2.4 && at(12).stars === 0, "noon bright, no stars");
ok(at(23).stars > 0.95 && at(23).lightI < 0.5 && at(23).night === 1, "night: stars, moonlight");
ok(at(17).warm > 0.7 && at(17).sky[0] > at(17).sky[2], "afternoon golden (warm, red > blue)");
let jump = 0; for (let m = 4 * 60; m < 26 * 60; m++) { const a = skyAt(m / 60), b = skyAt((m + 1) / 60); jump = Math.max(jump, Math.abs(a.lightI - b.lightI), Math.abs(a.sky[0] - b.sky[0]) / 255); }
ok(jump < 0.06, `gradual: biggest per-minute change ${jump.toFixed(3)}`);
ok(skyAt(19.5).lightI < 0.05 && skyAt(5.5).lightI < 0.05, "light fades out when sun hands over to moon");
ok(skyAt(12, "rain").lightI < at(12).lightI * 0.5, "rain dims");
console.log(fails ? `\n${fails} failed` : "\nall passed"); process.exit(fails ? 1 : 0);

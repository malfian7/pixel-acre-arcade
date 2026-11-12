// node games/rooftop/parkour.test.mjs — mechanics of the parkour controller, in a tiny 1-D world.
import { PK, createRunner, step, height } from "./parkour.js";
import assert from "node:assert/strict";
const DT = 1 / 120;
let pass = 0;
const t = (name, fn) => { fn(); pass++; console.log("ok -", name); };

// world: roofs [{z0, z1, h}] in metres along the run; the runner is at distance d = speed·time
function sim({ roofs, speed = 14, walls = [], low = [], inputs = () => ({}), T = 4, r = createRunner() }) {
  const log = [];
  let d = 0;
  for (let i = 0; i * DT < T && !r.dead; i++) {
    const time = i * DT;
    const roof = roofs.find((q) => d >= q.z0 && d <= q.z1);
    const env = {
      ground: roof ? roof.h : null,
      killY: Math.min(...roofs.map((q) => q.h)) - 3,
      wall: (side) => walls.some((w) => w.side === side && d >= w.z0 && d <= w.z1),
      lowAhead: (lane) => { const o = low.find((q) => !q.used && q.lane === lane && q.z - d > 0 && q.z - d < speed * 0.07); if (o) o.used = true; return o ? { top: o.top } : null; },
    };
    const ev = step(r, DT, env, inputs(time, r, d) || {});
    for (const e of ev) log.push({ time: +time.toFixed(3), d: +d.toFixed(2), e: typeof e === "string" ? e : e.type, ...(typeof e === "object" ? e : {}) });
    d += speed * DT;
  }
  return { r, log, d };
}
const press = (at, held = 0.25) => (time) => ({ jump: Math.abs(time - at) < DT / 2, held: time >= at && time < at + held });
const has = (log, e) => log.some((q) => q.e === e);

t("coyote: a jump 0.12 s after running off the edge is a full ground jump", () => {
  const edge = 10 / 14;
  const { log } = sim({ roofs: [{ z0: 0, z1: 10, h: 0 }, { z0: 16, z1: 40, h: 0 }], inputs: press(edge + 0.12), T: 2.5 });
  assert(has(log, "jump"), "ground jump"); assert(!has(log, "airjump")); assert(!has(log, "fall"));
});
t("coyote expires: 0.2 s after the edge it is the double jump, not a ground jump", () => {
  const edge = 10 / 14;
  const { log } = sim({ roofs: [{ z0: 0, z1: 10, h: 0 }, { z0: 30, z1: 40, h: 0 }], inputs: press(edge + 0.2), T: 2.5 });
  assert(!has(log, "jump")); assert(has(log, "airjump"));
});
t("jump buffer: pressed just before landing → jumps on the frame the feet touch", () => {
  // first jump at 0.1, land around ~0.75 s; press again 0.08 s before touch-down
  const r1 = sim({ roofs: [{ z0: 0, z1: 100, h: 0 }], inputs: (time) => ({ jump: Math.abs(time - 0.1) < DT / 2, held: true }), T: 1.5 });
  const land = r1.log.find((q) => q.e === "land").time;
  const { log } = sim({ roofs: [{ z0: 0, z1: 100, h: 0 }], inputs: (time) => ({ jump: Math.abs(time - 0.1) < DT / 2 || Math.abs(time - (land - 0.08)) < DT / 2, held: true }), T: 1.5 });
  assert(has(log, "buffered"), "buffered jump fired"); assert(!has(log, "airjump"), "did not burn the double jump");
  const L = log.find((q) => q.e === "land"), J = log.filter((q) => q.e === "jump")[1];
  assert.equal(J.time, L.time, "same step as landing");
});
t("variable jump height: hold ≈ 1.7 m, tap ≈ 0.9 m", () => {
  const peak = (held) => { let m = 0; sim({ roofs: [{ z0: 0, z1: 100, h: 0 }], inputs: (time, r) => { m = Math.max(m, r.y); return { jump: time < DT / 2, held: time < held }; }, T: 1.2 }); return m; };
  const hi = peak(1), lo = peak(0.04);
  console.log(`   hold apex ${hi.toFixed(2)} m, tap apex ${lo.toFixed(2)} m`);
  assert(hi > 1.6 && hi < 2.0); assert(lo < 1.0 && lo > 0.5);
});
t("fall multiplier: coming down is faster than going up", () => {
  let apexT = 0, m = 0;
  const { log } = sim({ roofs: [{ z0: 0, z1: 100, h: 0 }], inputs: (time, r) => { if (r.y > m) { m = r.y; apexT = time; } return { jump: time < DT / 2, held: true }; }, T: 1.5 });
  const land = log.find((q) => q.e === "land").time, up = apexT, down = land - apexT;
  console.log(`   rise ${up.toFixed(2)} s, fall ${down.toFixed(2)} s`);
  assert(down < up * 0.85);
});
t("slide: collider drops to 0.7 m for 0.65 s", () => {
  const r = createRunner(); let hMin = 9, dur = 0;
  sim({ r, roofs: [{ z0: 0, z1: 100, h: 0 }], inputs: (time) => ({ slide: Math.abs(time - 0.1) < DT / 2 }), T: 1.2 });
  const r2 = createRunner();
  sim({ r: r2, roofs: [{ z0: 0, z1: 100, h: 0 }], inputs: (time, rr) => { const h = height(rr); hMin = Math.min(hMin, h); if (h < 1) dur += DT; return { slide: Math.abs(time - 0.1) < DT / 2 }; }, T: 1.2 });
  assert.equal(hMin, PK.lowH); assert(Math.abs(dur - PK.slideTime) < 0.02);
});
t("dive + roll: slide in the air falls fast and rolls on landing", () => {
  const { log } = sim({ roofs: [{ z0: 0, z1: 100, h: 0 }], inputs: (time) => ({ jump: time < DT / 2, held: true, slide: Math.abs(time - 0.3) < DT / 2 }), T: 1.2 });
  assert(has(log, "dive") && has(log, "roll"));
});
t("hard landing from a high roof rolls automatically", () => {
  const { log } = sim({ roofs: [{ z0: 0, z1: 10, h: 4 }, { z0: 14, z1: 60, h: 0 }], r: Object.assign(createRunner(), { y: 4 }), T: 2 });
  const L = log.find((q) => q.e === "land");
  console.log(`   drop ${L.drop.toFixed(2)} m, impact ${L.impact.toFixed(1)} m/s`);
  assert(has(log, "roll")); assert(L.drop > 3.5);
});
t("vault: running at an AC unit (0.95 m) hops over it", () => {
  const low = [{ lane: 1, z: 8, top: 0.95 }];
  const r = createRunner(); let maxY = 0;
  const { log } = sim({ r, roofs: [{ z0: 0, z1: 100, h: 0 }], low, inputs: (time, rr) => { maxY = Math.max(maxY, rr.y); return {}; }, T: 1.2 });
  assert(has(log, "vault")); assert(maxY > 0.95, `cleared ${maxY.toFixed(2)}`);
});
t("mantle: a jump that comes up ~0.65 m short of a 2.4 m roof grabs the ledge", () => {
  const { log, r } = sim({ roofs: [{ z0: 0, z1: 10, h: 0 }, { z0: 14, z1: 60, h: 2.4 }], inputs: press(9.2 / 14, 0.5), T: 2 });
  assert(has(log, "mantle"), JSON.stringify(log)); assert(!r.dead); assert.equal(r.y, 2.4);
});
t("wall-run carries the runner across a gap a double jump cannot clear", () => {
  const speed = 15, gapA = 10, gapB = 10 + speed * 1.05 + 4;
  const roofs = [{ z0: 0, z1: gapA, h: 0 }, { z0: gapB, z1: gapB + 40, h: 0 }];
  // no wall: jump at the edge + double jump at the apex → falls short
  const plain = sim({ speed, roofs, r: Object.assign(createRunner(), { lane: 2, x: 2 }), inputs: (time) => ({ jump: Math.abs(time - 0.6) < DT / 2 || Math.abs(time - 0.92) < DT / 2, held: true }), T: 3 });
  assert(plain.r.dead, "double jump alone must not clear it");
  const walls = [{ side: 1, z0: gapA - 1, z1: gapB - 2 }];
  const run = sim({ speed, roofs, walls, r: Object.assign(createRunner(), { lane: 2, x: 2 }), inputs: (time, rr) => ({ jump: Math.abs(time - 0.6) < DT / 2 || (rr.wall && rr.wall.t > 0.95 && !rr.jumped && (rr.jumped = true)), held: true }), T: 3 });
  console.log(`   gap ${(gapB - gapA).toFixed(1)} m at ${speed} m/s; events ${run.log.map((q) => q.e).join(" → ")}`);
  assert(has(run.log, "wallrun")); assert(!run.r.dead, "made it");
});
t("second-floor up-step can be jumped (0.8 m higher roof)", () => {
  const { r, log } = sim({ roofs: [{ z0: 0, z1: 10, h: 0 }, { z0: 13, z1: 60, h: 0.8 }], inputs: press(9.2 / 14, 0.5), T: 2 });
  assert(!r.dead); assert.equal(r.y, 0.8); assert(!has(log, "mantle"), "clean landing, no mantle");
});
console.log(`\n${pass} passed`);

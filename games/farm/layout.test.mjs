// node games/farm/layout.test.mjs — map sanity: every zone is reachable, pens are closed, counts are sane.
import { W, H, FIELD, SPAWN, RANCH, PENS, DOCKS, SOLID, buildMap, zoneAt, STORE, SHOP, BOARD, BIN, WELL, TROUGH } from "./layout.js";
const M = buildMap();
let fails = 0; const ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } else console.log("ok  ", m); };
if (process.argv.includes("--print")) for (let z = 0; z < H; z++) console.log(M.T.slice(z * W, z * W + W).join(""));
const R = M.reach, r = (x, z) => R[x + z * W] === 1;
ok(r(5, 6), "door step reachable");
let fieldAll = true; for (let z = FIELD.z0; z <= FIELD.z1; z++) for (let x = FIELD.x0; x <= FIELD.x1; x++) if (!r(x, z)) fieldAll = false;
ok(fieldAll && (FIELD.x1 - FIELD.x0 + 1) === 15 && (FIELD.z1 - FIELD.z0 + 1) === 15, "15×15 field, all reachable");
ok(r(32, 8) && r(45, 15), "ranch interior reachable through the gate");
for (const [x, z] of DOCKS) ok(r(x, z), `dock ${x},${z} reachable`);
ok(r(STORE.x0 + 1, STORE.z0 + 1), "store counter front"); ok(r(SHOP.x0, SHOP.z0 - 1), "workbench front"); ok(r(BOARD[0], BOARD[1] + 1), "board front");
ok(r(BIN[0], BIN[1] + 1) || r(BIN[0] + 1, BIN[1]), "bin reachable"); ok(r(WELL[0] + 1, WELL[1]), "well reachable"); ok(r(TROUGH.x0, TROUGH.z0 + 1), "trough reachable");
ok(M.chop.length >= 30 && M.rocks.length >= 15, `woods: ${M.chop.length} choppable trees, ${M.rocks.length} boulders`);
// fence is closed: flood the pen interior without crossing the gate; it must not leak outside the fence rect
const seen = new Set(), q = [[40, 15]];
while (q.length) { const [x, z] = q.pop(); const k = x + "," + z; if (seen.has(k)) continue; seen.add(k);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, c = M.at(nx, nz); if (SOLID.has(c) || c === "g") continue; q.push([nx, nz]); } }
ok([...seen].every((k) => { const [x, z] = k.split(",").map(Number); return x > RANCH.x0 && x < RANCH.x1 && z > RANCH.z0 && z < RANCH.z1; }), `pasture closed (${seen.size} tiles)`);
for (const [kind, p] of Object.entries(PENS)) { let free = 0; for (let z = p.z0; z <= p.z1; z++) for (let x = p.x0; x <= p.x1; x++) if (!SOLID.has(M.at(x, z))) free++; ok(free > 25, `${kind} pen has ${free} free tiles`); }
ok(zoneAt(10, 10).id === "home" && zoneAt(40, 10).id === "ranch" && zoneAt(26, 27).id === "square" && zoneAt(45, 35).id === "woods" && zoneAt(10, 36).id === "pond", "zone lookup");
console.log(fails ? `\n${fails} failed` : "\nall passed"); process.exit(fails ? 1 : 0);

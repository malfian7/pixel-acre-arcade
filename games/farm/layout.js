// Little Furrow — the valley map. Pure data (no three.js), tested in node: games/farm/layout.test.mjs.
//
// 56 × 46 tiles, four zones around a village square:
//
//   NW  Home & Garden   house, shipping bin, well and a 15 × 15 field
//   NE  Ranch           fenced pasture with a cow barn, a hen coop, a trough; cows, hens and sheep roam it
//   SE  Whisper Woods   dense trees; some can be chopped (wood), boulders can be broken (stone); both regrow
//   SW  Mirror Pond     a pond with a dock that drains into a river along the south; fish from the docks
//   centre  Village Square  Mina's store, Kenji's workbench, the notice board
//
// Tile codes
//   .  grass       p  path       q  plaza stone   y  sand (shore)   F  field soil
//   T  tree (scenery, solid)     t  tree you can chop (solid until chopped)     r  boulder (solid until broken)
//   w  water       k  dock / pier (walkable over water)
//   H  house  D  door  b  shipping bin  W  well  B  barn / silo  C  coop  f  fence  g  gate  R  trough
//   S  store stall  K  workbench  N  notice board  L  lamp  o  planter  s  signpost
export const W = 56, H = 46;
export const FIELD = { x0: 7, z0: 9, x1: 21, z1: 23 };          // 15 × 15
export const HOUSE = { x0: 3, z0: 2, x1: 7, z1: 5, door: [5, 5] };
export const SPAWN = { x: 5.5, z: 6.6 };
export const RANCH = { x0: 31, z0: 3, x1: 52, z1: 21, gate: [31, 7] }; // fence line
export const BARN = { x0: 33, z0: 4, x1: 38, z1: 7 };
export const SILO = [39, 5];
export const COOP = { x0: 46, z0: 4, x1: 49, z1: 6 };
export const TROUGH = { x0: 40, z0: 9, x1: 41, z1: 9 };
export const PLAZA = { x0: 22, z0: 24, x1: 30, z1: 30 };
export const STORE = { x0: 23, z0: 24, x1: 25, z1: 24 };
export const SHOP = { x0: 28, z0: 30, x1: 29, z1: 30 };       // Kenji's workbench (south edge of the plaza)
export const BOARD = [27, 24];
export const BIN = [9, 6];
export const WELL = [4, 14];
export const POND = { cx: 10.5, cz: 36.6, rx: 6.2, rz: 4.5 };
export const FOREST = { x0: 32, z0: 25, x1: 54, z1: 44 };
export const DOCKS = [[11, 32], [11, 33], [26, 40]];
export const LAMPS = [[4, 8], [22, 8], [30, 8], [22, 30], [30, 25], [12, 28], [27, 39]];
export const SIGNS = [
  { x: 25, z: 8, text: "RANCH →", face: 0 },
  { x: 25, z: 23, text: "SQUARE", face: 0 },
  { x: 32, z: 28, text: "WOODS", face: 0 },
  { x: 13, z: 28, text: "POND", face: 0 },
];
// Where each kind of animal likes to roam (tile rect inside the fence; positions are continuous).
export const PENS = {
  chicken: { x0: 42, z0: 8, x1: 51, z1: 14 },
  cow: { x0: 32, z0: 10, x1: 42, z1: 20 },
  sheep: { x0: 37, z0: 12, x1: 51, z1: 20 },
};
export const ZONES = [
  { id: "home", name: "Home & Garden", x0: 1, z0: 1, x1: 23, z1: 24 },
  { id: "ranch", name: "Sunny Ranch", x0: 31, z0: 2, x1: 54, z1: 22 },
  { id: "square", name: "Village Square", x0: 21, z0: 23, x1: 31, z1: 31 },
  { id: "woods", name: "Whisper Woods", x0: 32, z0: 23, x1: 55, z1: 45 },
  { id: "pond", name: "Mirror Pond", x0: 1, z0: 28, x1: 31, z1: 45 },
];
export const zoneAt = (x, z) => ZONES.find((r) => x >= r.x0 && x <= r.x1 + 0.99 && z >= r.z0 && z <= r.z1 + 0.99) || null;

export const SOLID = new Set(["T", "t", "r", "f", "w", "H", "D", "B", "C", "b", "W", "S", "K", "R", "N", "L", "o", "s"]);
export const key = (x, z) => x + "," + z;
export const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function riverZ(x) { return 40.6 + Math.sin(x * 0.35) * 0.8; }

/** Build the tile map. Returns { T, at, chop: [[x,z]...], rocks: [[x,z]...] } — deterministic. */
export function buildMap() {
  let seed = 11;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const T = new Array(W * H).fill(".");
  const at = (x, z) => (x < 0 || z < 0 || x >= W || z >= H) ? "T" : T[x + z * W];
  const set = (x, z, c) => { if (x >= 0 && z >= 0 && x < W && z < H) T[x + z * W] = c; };
  const rect = (x0, z0, x1, z1, c) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) set(x, z, c); };
  const R = (r, c) => rect(r.x0, r.z0, r.x1, r.z1, c);

  // water first: pond ellipse + a river along the south that runs off the map's south-east
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const dx = (x + 0.5 - POND.cx) / POND.rx, dz = (z + 0.5 - POND.cz) / POND.rz;
    if (dx * dx + dz * dz < 1) set(x, z, "w");
  }
  for (let x = 15; x <= 33; x++) for (let z = 37; z < H; z++) if (Math.abs(z + 0.5 - riverZ(x)) < 1.25) set(x, z, "w");
  for (let z = 40; z < H; z++) for (const x of [33, 34]) set(x, z, "w");
  // shore sand
  const isW = (x, z) => at(x, z) === "w";
  for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) if (at(x, z) === ".") {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) if (isW(x + dx, z + dz)) { set(x, z, "y"); break; }
  }

  // paths
  rect(5, 6, 5, 7, "p"); rect(5, 7, 31, 7, "p");      // door → east, into the ranch gate
  rect(26, 7, 26, 39, "p");                           // north–south spine down to the river pier
  rect(3, 27, 52, 27, "p");                           // west–east road: pond lane ↔ square ↔ woods
  rect(11, 27, 11, 31, "p");                          // down to the pond dock
  rect(44, 27, 44, 41, "p"); rect(38, 41, 44, 41, "p"); rect(38, 34, 38, 41, "p"); // woods trail loop
  rect(32, 8, 32, 8, "p");
  R(PLAZA, "q");
  for (const [x, z] of DOCKS) set(x, z, "k");
  // home
  R(FIELD, "F");
  R(HOUSE, "H"); set(HOUSE.door[0], HOUSE.door[1], "D");
  set(BIN[0], BIN[1], "b"); set(WELL[0], WELL[1], "W");
  // ranch
  for (let x = RANCH.x0; x <= RANCH.x1; x++) { set(x, RANCH.z0, "f"); set(x, RANCH.z1, "f"); }
  for (let z = RANCH.z0; z <= RANCH.z1; z++) { set(RANCH.x0, z, "f"); set(RANCH.x1, z, "f"); }
  set(RANCH.gate[0], RANCH.gate[1], "g");
  R(BARN, "B"); set(SILO[0], SILO[1], "B"); set(SILO[0], SILO[1] + 1, "B");
  R(COOP, "C"); R(TROUGH, "R");
  // square
  R(STORE, "S"); R(SHOP, "K"); set(BOARD[0], BOARD[1], "N");
  for (const [x, z] of [[22, 24], [30, 24]]) set(x, z, "o");
  for (const [x, z] of LAMPS) set(x, z, "L");
  for (const s of SIGNS) set(s.x, s.z, "s");

  // border
  for (let x = 0; x < W; x++) { if (at(x, 0) !== "w") set(x, 0, "T"); if (at(x, H - 1) !== "w") set(x, H - 1, "T"); }
  for (let z = 0; z < H; z++) { set(0, z, "T"); set(W - 1, z, "T"); }

  // keep a clear ring around paths, zone furniture and the field so scatter trees never block anything
  const reserved = (x, z) => {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const c = at(x + dx, z + dz); if (c !== "." && c !== "T" && c !== "y") return true; }
    return false;
  };
  // the woods
  for (let z = FOREST.z0; z <= FOREST.z1; z++) for (let x = FOREST.x0; x <= FOREST.x1; x++) {
    if (at(x, z) !== ".") continue;
    const nearPath = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => at(x + dx, z + dz) === "p");
    const r = rnd();
    if (nearPath) { if (r < 0.2) set(x, z, "t"); else if (r < 0.3) set(x, z, "r"); continue; }
    if (r < 0.34) set(x, z, "T"); else if (r < 0.44) set(x, z, "t"); else if (r < 0.5) set(x, z, "r");
  }
  // scattered scenery elsewhere
  for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
    if (at(x, z) !== "." || inRect(FOREST, x, z) || inRect(RANCH, x, z) || reserved(x, z)) continue;
    const edge = x < 3 || z < 2 || x > W - 4 || z > H - 3;
    if (rnd() < (edge ? 0.5 : 0.06)) set(x, z, "T");
  }
  // a few boulders and choppable trees near home for an early taste
  for (const [x, z] of [[2, 20], [2, 23], [24, 12], [24, 17]]) if (at(x, z) === "." ) set(x, z, "t");
  for (const [x, z] of [[3, 25], [24, 20]]) if (at(x, z) === ".") set(x, z, "r");

  // every choppable tree / boulder must have a walkable neighbour that the player can reach
  const walk = (c) => !SOLID.has(c) || c === "D";
  const seen = new Uint8Array(W * H), q = [[SPAWN.x | 0, SPAWN.z | 0]]; seen[(SPAWN.x | 0) + (SPAWN.z | 0) * W] = 1;
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz; if (nx < 0 || nz < 0 || nx >= W || nz >= H || seen[nx + nz * W]) continue;
      const c = at(nx, nz); if (!walk(c) || c === "D") continue;
      seen[nx + nz * W] = 1; q.push([nx, nz]);
    }
  }
  const chop = [], rocks = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const c = at(x, z); if (c !== "t" && c !== "r") continue;
    const reach = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => seen[(x + dx) + (z + dz) * W]);
    if (!reach) { set(x, z, c === "t" ? "T" : "T"); continue; }
    (c === "t" ? chop : rocks).push([x, z]);
  }
  return { T, at, set, chop, rocks, reach: seen };
}

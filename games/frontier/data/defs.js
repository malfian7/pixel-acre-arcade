// Frontier Crown — data-driven definitions. Every balancing number lives here;
// systems read these tables and never hard-code unit stats.

export const RES = ["food", "wood", "coin"];
export const FOOD = 0, WOOD = 1, COIN = 2;

// Unit / building classes (bit flags) — used by attack bonuses and AI.
export const C = { VIL: 1, INF: 2, RANGED: 4, CAV: 8, ART: 16, BLD: 32, ANIMAL: 64 };

export const AGES = [
  { name: "Discovery Age", roman: "I" },
  { name: "Colonial Age", roman: "II", cost: [600, 0, 0], time: 30 },
  { name: "Fortress Age", roman: "III", cost: [1000, 0, 600], time: 45 },
];

// Age-up shipments: the player picks one of two when the new Age arrives.
export const SHIPMENTS = [
  null,
  [{ id: "settlers", name: "Settler Wagon", desc: "3 Villagers arrive at your Town Center.", units: ["villager", 3] },
   { id: "lumber", name: "Lumber Crates", desc: "+400 wood.", res: [0, 400, 0] }],
  [{ id: "company", name: "Musketeer Company", desc: "5 Musketeers march in from the coast.", units: ["musketeer", 5] },
   { id: "chest", name: "Treasury Chest", desc: "+800 coin.", res: [0, 0, 800] }],
];

export const START_RES = [300, 200, 100];
export const POP_MAX = 150;
export const CARRY = 10;

const U = (o) => ({ kind: "unit", pop: 1, radius: 0.36, vision: 10, armor: { ranged: 0, melee: 0, siege: 0 }, ...o });
const B = (o) => ({ kind: "building", cls: C.BLD, radius: 0, armor: { ranged: 0.75, melee: 0.3, siege: 0 }, vision: 8, pop: 0, ...o });
const R = (o) => ({ kind: "resource", radius: 0, vision: 0, ...o });

export const DEFS = {
  // ---------------------------------------------------------------- units
  villager: U({ name: "Villager", cls: C.VIL, cost: [50, 0, 0], hp: 120, speed: 2.3, train: 12, from: "towncenter", age: 0, vision: 9,
    atk: { dmg: 4, range: 0.5, rof: 1.5, type: "melee" },
    gather: { berries: 0.75, hunt: 1.0, mill: 0.6, wood: 0.6, coin: 0.65 }, build: 1, hotkey: "Q",
    desc: "Gathers food, wood and coin, and constructs buildings." }),
  musketeer: U({ name: "Musketeer", cls: C.INF | C.RANGED, cost: [75, 0, 25], hp: 160, speed: 2.05, train: 14, from: "barracks", age: 0, vision: 11,
    atk: { dmg: 18, range: 9, rof: 2.5, type: "ranged", bonus: { [C.CAV]: 3 } },
    melee: { dmg: 10, rof: 1.5, bonus: { [C.CAV]: 2 } }, armor: { ranged: 0.2, melee: 0, siege: 0 }, hotkey: "Q",
    desc: "Line infantry. Strong against cavalry; fixes bayonets up close." }),
  pikeman: U({ name: "Pikeman", cls: C.INF, cost: [50, 50, 0], hp: 130, speed: 2.3, train: 11, from: "barracks", age: 0, vision: 9,
    atk: { dmg: 9, range: 0.7, rof: 1.2, type: "melee", bonus: { [C.CAV]: 3, [C.BLD]: 2.5 } }, armor: { ranged: 0, melee: 0.1, siege: 0 }, hotkey: "W",
    desc: "Cheap melee infantry. Crushes cavalry and tears down buildings." }),
  hussar: U({ name: "Hussar", cls: C.CAV, cost: [100, 0, 80], hp: 260, speed: 3.6, train: 18, from: "stable", age: 1, vision: 12, pop: 2, radius: 0.55,
    atk: { dmg: 16, range: 0.8, rof: 1.4, type: "melee", bonus: { [C.ART]: 2.5, [C.VIL]: 1.5 } }, armor: { ranged: 0.2, melee: 0, siege: 0 }, hotkey: "Q",
    desc: "Heavy cavalry. Runs down artillery and villagers; fears pikes and muskets." }),
  falconet: U({ name: "Falconet", cls: C.ART, cost: [0, 150, 200], hp: 200, speed: 1.6, train: 26, from: "foundry", age: 2, vision: 11, pop: 3, radius: 0.65,
    atk: { dmg: 40, range: 15, rof: 4.5, type: "siege", splash: 1.6, minRange: 3, bonus: { [C.INF]: 2.2, [C.BLD]: 3 } }, armor: { ranged: 0.6, melee: 0, siege: 0 }, hotkey: "Q",
    desc: "Field cannon. Splash damage shreds infantry and buildings; helpless in melee." }),
  deer: U({ name: "Deer", cls: C.ANIMAL, cost: [0, 0, 0], hp: 1, speed: 1.2, vision: 0, radius: 0.4, res: FOOD, amount: 300, gtype: "hunt", pop: 0,
    desc: "Hunt for food." }),

  // ------------------------------------------------------------ buildings
  towncenter: B({ name: "Town Center", size: 5, hp: 2400, cost: [0, 0, 0], build: 120, age: 0, pop: 10, vision: 14, drop: [FOOD, WOOD, COIN],
    trains: ["villager"], atk: { dmg: 12, range: 10, rof: 2, type: "ranged" }, hotkey: "",
    desc: "Heart of your colony. Trains villagers, accepts all resources and advances your Age." }),
  house: B({ name: "House", size: 2, hp: 700, cost: [0, 100, 0], build: 14, age: 0, pop: 10, vision: 6, hotkey: "Q",
    desc: "+10 population." }),
  mill: B({ name: "Mill", size: 3, hp: 1000, cost: [0, 150, 0], build: 24, age: 0, vision: 7, drop: [FOOD], farm: 10, hotkey: "W",
    desc: "Endless food for up to 10 villagers. Also a food drop-off." }),
  barracks: B({ name: "Barracks", size: 4, hp: 1600, cost: [0, 200, 0], build: 30, age: 0, trains: ["musketeer", "pikeman"], hotkey: "E",
    desc: "Trains Musketeers and Pikemen." }),
  outpost: B({ name: "Outpost", size: 2, hp: 900, cost: [0, 100, 50], build: 26, age: 0, vision: 16, atk: { dmg: 10, range: 11, rof: 2, type: "ranged" }, hotkey: "R",
    desc: "Watchtower with a long line of sight that fires on nearby enemies." }),
  stable: B({ name: "Stable", size: 4, hp: 1600, cost: [0, 200, 0], build: 34, age: 1, trains: ["hussar"], hotkey: "A",
    desc: "Trains Hussars. Requires the Colonial Age." }),
  foundry: B({ name: "Artillery Foundry", size: 4, hp: 1600, cost: [0, 300, 100], build: 40, age: 2, trains: ["falconet"], hotkey: "S",
    desc: "Casts Falconets. Requires the Fortress Age." }),

  // ------------------------------------------------------------ resources
  tree: R({ name: "Tree", size: 1, res: WOOD, amount: 150, gtype: "wood" }),
  berries: R({ name: "Berry Bush", size: 1, res: FOOD, amount: 400, gtype: "berries" }),
  goldmine: R({ name: "Gold Mine", size: 3, res: COIN, amount: 2500, gtype: "coin" }),
};

// Stable numeric indices for typed arrays.
export const DEF_IDS = Object.keys(DEFS);
export const DEF_LIST = DEF_IDS.map((k, i) => Object.assign(DEFS[k], { id: k, idx: i }));
export const D = (k) => DEFS[k].idx;
export const BUILDABLE = ["house", "mill", "barracks", "outpost", "stable", "foundry"];

export const TEAM_COLORS = [0x2f6fe0, 0xd2392c];
export const TEAM_CSS = ["#4a86ff", "#ff5a48"];
export const PLAYER_NAMES = ["You", "Rival Crown"];

// Damage multiplier of attacker def `a` vs target def `t` for one attack profile.
export function bonusMult(atk, t) {
  if (!atk.bonus) return 1;
  let m = 1;
  for (const k in atk.bonus) if (t.cls & +k) m = Math.max(m, atk.bonus[k]);
  return m;
}

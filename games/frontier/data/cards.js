// Frontier Crown — Crown Shipments: XP tuning + the card catalogue.
// Everything below is plain JSON (no functions, no references), so it can be moved to a .json
// file, fetched from a server or edited by a designer without touching code. The sim reads it
// through sim/economy/shipments.js; the HUD reads the same objects to draw the deck.
//
// Card fields
//   id        unique key, stored in decks and save data
//   name/desc text on the card
//   icon      ICON key used by the HUD
//   age       earliest Age (0 Discovery, 1 Colonial, 2 Fortress) the card can be sent in
//   uses      how many times per match (null = unlimited)
//   cooldown  seconds after this card ARRIVES before it can be sent again (0 = none)
//   travel    seconds from "send" to arrival at the Town Center
//   deliver   { units: [[defId, count]], crates: [[resIndex, amount]], tech: {...} }
//             crates are split into 100-resource crates that villagers unpack (gtype "crate")
//   ai        rough priority hint for the computer player (higher = earlier)

export const XP_RULES = {
  firstShipment: 220,  // XP for the first shipment point
  growth: 1.16,        // each next point costs 16% more…
  cap: 900,            // …up to this
  killUnit: 0.12,      // × the victim's total cost
  killBuilding: 0.2,   // × the building's cost, + flat below
  killBuildingFlat: 40,
  build: 0.1,          // completed building: × cost + flat
  buildFlat: 15,
  deposit: 1,          // per unloaded villager load (a trickle for a busy economy)
  ageUpPoints: 1,      // a free shipment point on reaching a new Age
};

export const DECK_SIZE = { min: 6, max: 12 };
export const DEFAULT_TRAVEL = 25;

export const CARDS_JSON = {
  version: 1,
  cards: [
    { id: "settlers3", name: "3 Settlers", icon: "villager", age: 0, uses: null, cooldown: 60, travel: 25, deliver: { units: [["villager", 3]] }, desc: "Three villagers step off the wagon at your Town Center.", ai: 9 },
    { id: "food300", name: "300 Food", icon: "food", age: 0, uses: 1, cooldown: 0, travel: 20, deliver: { crates: [[0, 300]] }, desc: "Three crates of salted provisions. Villagers unpack them in seconds.", ai: 7 },
    { id: "wood300", name: "300 Wood", icon: "wood", age: 0, uses: 1, cooldown: 0, travel: 20, deliver: { crates: [[1, 300]] }, desc: "Three crates of sawn timber.", ai: 6 },
    { id: "coin300", name: "300 Coin", icon: "coin", age: 0, uses: 1, cooldown: 0, travel: 20, deliver: { crates: [[2, 300]] }, desc: "A strongbox of coin, split into three crates.", ai: 6 },
    { id: "pikemen4", name: "4 Pikemen", icon: "pikeman", age: 0, uses: 2, cooldown: 90, travel: 25, deliver: { units: [["pikeman", 4]] }, desc: "An emergency levy of pikemen.", ai: 4 },
    { id: "settlers5", name: "5 Settlers", icon: "villager", age: 1, uses: 1, cooldown: 0, travel: 30, deliver: { units: [["villager", 5]] }, desc: "A whole family convoy of settlers.", ai: 10 },
    { id: "wood700", name: "700 Wood", icon: "wood", age: 1, uses: 1, cooldown: 0, travel: 30, deliver: { crates: [[1, 700]] }, desc: "Seven crates of timber for a building boom.", ai: 8 },
    { id: "coin600", name: "600 Coin", icon: "coin", age: 1, uses: 1, cooldown: 0, travel: 30, deliver: { crates: [[2, 600]] }, desc: "Six crates of coin from the Crown treasury.", ai: 7 },
    { id: "musketeers5", name: "5 Musketeers", icon: "musketeer", age: 1, uses: 2, cooldown: 120, travel: 30, deliver: { units: [["musketeer", 5]] }, desc: "A company of line infantry.", ai: 5 },
    { id: "hussars3", name: "3 Hussars", icon: "hussar", age: 1, uses: 2, cooldown: 120, travel: 30, deliver: { units: [["hussar", 3]] }, desc: "Three heavy cavalrymen with their mounts.", ai: 4 },
    { id: "gather10", name: "Royal Charter", icon: "build", age: 1, uses: 1, cooldown: 0, travel: 20, deliver: { tech: { gatherMult: 1.1 } }, desc: "Villagers gather 10% faster for the rest of the match.", ai: 9 },
    { id: "grenadiers4", name: "4 Grenadiers", icon: "grenadier", age: 1, uses: 1, cooldown: 0, travel: 35, deliver: { units: [["grenadier", 4]] }, desc: "Grenade throwers to crack a wall or a square.", ai: 3 },
    { id: "skirmishers6", name: "6 Skirmishers", icon: "skirmisher", age: 2, uses: 2, cooldown: 150, travel: 35, deliver: { units: [["skirmisher", 6]] }, desc: "Long-rifle skirmishers from the colonies.", ai: 5 },
    { id: "falconets2", name: "2 Falconets", icon: "falconet", age: 2, uses: 1, cooldown: 0, travel: 40, deliver: { units: [["falconet", 2]] }, desc: "Two field guns, crews included.", ai: 4 },
    { id: "coin1000", name: "1000 Coin", icon: "coin", age: 2, uses: 1, cooldown: 0, travel: 35, deliver: { crates: [[2, 1000]] }, desc: "Ten crates of coin — the Crown's war chest.", ai: 6 },
  ],
  defaultDeck: ["settlers3", "food300", "wood300", "coin300", "pikemen4", "settlers5", "wood700", "musketeers5", "gather10", "hussars3", "skirmishers6", "falconets2"],
};

export const CARDS = Object.fromEntries(CARDS_JSON.cards.map((c) => [c.id, c]));

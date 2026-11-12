// Frontier Crown — Treasures & Guardians: placement, reward tables and guardian tuning.
// Plain JSON-shaped data (no functions); sim/economy/treasures.js and sim/guardians.js read it.
//
// A treasure "kind" says how big the prize is, who guards it and who may claim it.
//   guards    [[defId, min, max]] spawned in a ring around the chest
//   rewards   weighted table; one entry is rolled (seeded sim RNG) when the treasure is placed,
//             so the prize is fixed — and shown in the tooltip — before anyone fights for it
//   claimBy   "any" = any land unit of a player; "explorer" = only an Explorer may open it
//   aggro     tiles from the chest at which guardians notice an intruder
//   leash     tiles from their post after which guardians give up and walk back

export const TREASURE_RULES = {
  pairs: 6,            // treasures are placed in mirrored pairs (fair for both colonies)
  minFromTC: 20,       // keep the first minutes of a match quiet
  clearOfResources: 11, // tiles between a chest and any starting berry/gold/hunt near a colony (> aggro + margin)
  minApart: 20,       // > leash, so two guardian packs never chase over the same ground
  regenLeash: 0.25,    // guardians heal this share of max HP per second while leashing / idle
};

export const TREASURE_KINDS = {
  cache: {
    name: "Trapper's Cache", weight: 3, claimBy: "any", aggro: 6, leash: 11,
    guards: [["wolf", 2, 3]],
    rewards: [
      { w: 3, res: 0, amount: [100, 150] },
      { w: 3, res: 1, amount: [100, 150] },
      { w: 2, res: 2, amount: [80, 120] },
      { w: 2, xp: [80, 120] },
    ],
  },
  hoard: {
    name: "Bandit Hoard", weight: 2, claimBy: "any", aggro: 7, leash: 12,
    guards: [["bandit", 2, 3], ["wolf", 0, 1]],
    rewards: [
      { w: 3, res: 2, amount: [180, 260] },
      { w: 2, res: 1, amount: [200, 280] },
      { w: 2, xp: [160, 240] },
      { w: 1, units: [["musketeer", 2]], label: "2 Musketeers join you" },
    ],
  },
  map: {
    name: "Lost Expedition", weight: 1, claimBy: "explorer", aggro: 7, leash: 12,
    guards: [["bandit", 3, 4]],
    rewards: [
      { w: 2, xp: [260, 340] },
      { w: 2, res: 2, amount: [280, 340] },
      { w: 1, units: [["villager", 3]], label: "3 Settlers join you" },
    ],
  },
};

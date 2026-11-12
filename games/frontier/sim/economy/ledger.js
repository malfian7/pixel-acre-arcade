// Frontier Crown — Ledger: the only code that changes a player's stockpile.
// Every spend/refund/credit goes through here, so costs are atomic (all-or-nothing),
// cancellations refund exactly, and income per minute can be measured for the HUD and the AI.

import { RES } from "../../data/defs.js";

const N = RES.length;
const WINDOW = 60; // seconds of history kept for income rates

/** Attach ledger bookkeeping to a player record (called once from the Sim constructor). */
export function initLedger(pl) {
  pl.income = new Float32Array(N);                 // resources / minute, rolling window
  pl.ledger = { hist: new Float32Array(WINDOW * N), slot: 0, acc: new Float32Array(N), spent: new Float32Array(N), refunded: new Float32Array(N) };
}

export const canAfford = (pl, cost, k = 1) => cost.every((c, i) => pl.res[i] >= c * k);

/** Deduct `cost` (× k) atomically. Returns false and changes nothing if the player is short. */
export function spend(pl, cost, k = 1) {
  if (!canAfford(pl, cost, k)) return false;
  for (let i = 0; i < N; i++) { pl.res[i] -= cost[i] * k; pl.ledger.spent[i] += cost[i] * k; }
  return true;
}

/** Give back a previously spent cost (cancelled training, cancelled Age advance, demolished foundation). */
export function refund(pl, cost, k = 1) {
  for (let i = 0; i < N; i++) { pl.res[i] += cost[i] * k; pl.ledger.refunded[i] += cost[i] * k; }
}

/** Income from gathering (deposits), shipments, trickles. `gathered` feeds the end-of-game stats. */
export function credit(pl, res, amt, gathered = true) {
  pl.res[res] += amt;
  if (gathered) { pl.ledger.acc[res] += amt; pl.stats.gathered[res] += amt; } // income rate = gathering only
}

/** Once per simulated second: roll the income window and update resources-per-minute. */
export function ledgerTick(sim) {
  for (const pl of sim.players) {
    const L = pl.ledger, o = L.slot * N;
    for (let i = 0; i < N; i++) {
      L.hist[o + i] = L.acc[i]; L.acc[i] = 0;
      let sum = 0; for (let s = 0; s < WINDOW; s++) sum += L.hist[s * N + i];
      pl.income[i] = sum * (60 / Math.min(WINDOW, Math.max(1, sim.time)));
    }
    L.slot = (L.slot + 1) % WINDOW;
  }
}

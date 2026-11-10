// VictorySystem — a player falls when their Town Center is destroyed (or they resign).

export function victorySystem(sim) {
  if (sim.over) return;
  for (const pl of sim.players) {
    const st = sim.st;
    const lost = pl.resigned || pl.tc < 0 || !st.alive[pl.tc];
    if (lost) {
      pl.alive = false;
      sim.over = { winner: 1 - pl.id, loser: pl.id, time: sim.time };
      sim.events.push("over", { winner: 1 - pl.id });
      return;
    }
  }
}

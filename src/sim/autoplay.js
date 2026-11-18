// Automatische Führung für Testläufe und die Schaltfläche "Alle Fronten: Angriff".
export function allFrontsAttack(sim, n = sim.player) {
  const fronts = [...sim.fronts.values()].filter((f) => f.alive && f.side[n]).sort((x, y) => x.id - y.id);
  for (const f of fronts) if (f.side[n].order !== 'attack') sim.attack(f.id, n);
  // Reserve nach Frontlänge verteilen
  const open = fronts.filter((f) => !f.encircled[n]);
  if (!open.length) return;
  let reserve = sim.reserveOf(n).length;
  while (reserve > 0) {
    let best = open[0];
    let bestNeed = -Infinity;
    for (const f of open) {
      const have = sim.divisionsOn(f.id, n).length + sim.inTransitTo(f.id, n).length;
      const need = f.length / (have + 1);
      if (need > bestNeed) { bestNeed = need; best = f; }
    }
    if (!sim.transfer(0, best.id, 1, n)) break;
    reserve--;
  }
}

/** Autoplay-Funktion für sim.autoplay: Deutschland greift an allen Fronten an. */
export function autoplayAllAttack(sim) {
  allFrontsAttack(sim, sim.player);
}

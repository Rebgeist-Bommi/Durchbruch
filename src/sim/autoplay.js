import { declareWar as declareWarDip } from './diplomacy.js';
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

/**
 * Testlauf Phase 5 ("Kampagne ohne Spieler"): Angriff nur gegen Polen, an allen anderen Fronten
 * halten und befestigen. Neue Fronten (Westen) erhalten Truppen aus der Reserve, notfalls von
 * der Ostfront; die übrige Reserve geht nach Frontlänge an die Angriffsfronten.
 */
export function autoplayCampaign(sim) {
  const n = sim.player;
  const pol = sim.codeIndex.get('POL');
  // Szenario ab 01.03.1939: Kriegserklärung an Polen am historischen Datum (Testlauf)
  if (!sim.isWar(n, pol) && sim.nations.get(pol)?.status === 'aktiv' && sim.day >= (sim.bal.scenario.testWarDay ?? 0) && !sim.dip.flags.testWar) {
    sim.dip.flags.testWar = true;
    declareWarDip(sim, n, pol);
  }
  const fronts = [...sim.fronts.values()].filter((f) => f.alive && f.side[n]).sort((x, y) => x.id - y.id);
  const east = fronts.filter((f) => sim.enemyOn(f, n) === pol);
  const west = fronts.filter((f) => sim.enemyOn(f, n) !== pol);
  for (const f of east) if (f.side[n].order !== 'attack') sim.attack(f.id, n);
  for (const f of west) if (f.side[n].order !== 'hold') { if (f.side[n].order === 'attack') sim.stopAttack(f.id, n); else sim.setOrder(f.id, 'hold', n); }
  const have = (f) => sim.divisionsOn(f.id, n).length + sim.inTransitTo(f.id, n).length;
  for (const f of west) {
    if (f.encircled[n]) continue;
    let need = Math.min(12, Math.ceil(f.length / 4)) - have(f);
    while (need > 0 && sim.transfer(0, f.id, 1, n)) need--;
    const donors = east.filter((x) => !x.encircled[n]).sort((a, b) => have(b) - have(a));
    while (need > 0 && donors.length && have(donors[0]) > 4 && sim.transfer(donors[0].id, f.id, 1, n)) {
      need--;
      donors.sort((a, b) => have(b) - have(a));
    }
  }
  const open = east.filter((f) => !f.encircled[n]);
  if (!open.length) return;
  let reserve = sim.reserveOf(n).length;
  while (reserve > 0) {
    let best = open[0];
    let bestNeed = -Infinity;
    for (const f of open) {
      const need = f.length / (have(f) + 1);
      if (need > bestNeed) { bestNeed = need; best = f; }
    }
    if (!sim.transfer(0, best.id, 1, n)) break;
    reserve--;
  }
}

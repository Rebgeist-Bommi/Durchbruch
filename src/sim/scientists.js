// Wissenschaftler (Phase 4): Personen mit Fachgebiet, Bonus, Standort, Loyalität und Bewachung.
// Bonus nur in derselben Region (Sektor) wie eine passende Anstalt. Fachgebiet "geheimdienst"
// stärkt die Spionageabwehr des Dienstherrn.

export function initScientists(sim, data) {
  const G = sim.bal.intel.defaultGuard;
  sim.scientists = data.scientists.map((s) => {
    const cell = s.lat == null ? -1 : sim.grid.cellAtLonLat(s.lon, s.lat);
    return {
      id: s.id, name: s.name, field: s.field, topic: s.topic, place: s.place, bonus: s.bonus,
      loyalty: s.loyalty, origin: sim.idx(s.nation), employer: sim.idx(s.nation),
      cell: cell >= 0 && sim.grid.territory[cell] ? cell : -1, status: s.status || 'aktiv', guard: G.scientist,
    };
  });
}

function capitalCell(sim, n) {
  const c = sim.capital.get(n);
  if (c !== undefined && sim.owner[c] === n) return c;
  const city = sim.cities.find((x) => sim.owner[x.cell] === n);
  return city ? city.cell : -1;
}

/** Bester eigener Standort: Region einer passenden Anstalt, sonst Hauptstadt. */
export function bestPlace(sim, s) {
  const b = sim.buildings.find((x) => x.type === 'forschung' && x.done && x.focus === s.field && sim.owner[x.cell] === s.employer);
  return b ? b.cell : capitalCell(sim, s.employer);
}

export function relocate(sim, s, cell) {
  if (cell < 0 || sim.owner[cell] !== s.employer) return false;
  s.cell = cell;
  return true;
}

export function runScientists(sim) {
  const S = sim.bal.scientists;
  for (const s of sim.scientists) {
    if (s.status !== 'aktiv' || s.cell < 0) continue;
    const e = sim.econ.get(s.employer);
    if (e && s.guard) { e.money -= s.guard * S.guardCostPerLevel; e.spentToday += s.guard * S.guardCostPerLevel; }
    const here = sim.owner[s.cell];
    if (here !== s.employer) {
      // Standort verloren: gefangen genommen (bei Krieg) oder Flucht zum Dienstherrn
      if (here && sim.isWar(here, s.employer) && sim.rng() < S.captureChance) {
        const old = s.employer;
        s.employer = here;
        s.loyalty = S.capturedLoyalty;
        s.guard = 0;
        sim.log('scientist', `${s.name} (${sim.nationName(old)}) wurde in ${s.place} gefangen genommen.`, s.cell);
      } else {
        const to = bestPlace(sim, s);
        sim.log('scientist', `${s.name} flieht vor der Front nach ${sim.nearestCityName(to % sim.cols, Math.floor(to / sim.cols), 4)}.`, to);
        s.cell = to;
      }
      continue;
    }
    if (s.employer !== s.origin) {
      const risk = S.fleeChancePerDay * (1 - s.loyalty) * (1 - S.guardRiskFactor * s.guard);
      if (sim.rng() < risk) {
        const from = s.employer;
        s.employer = s.origin;
        s.loyalty = 0.9;
        s.cell = capitalCell(sim, s.origin);
        s.guard = sim.bal.intel.defaultGuard.scientist;
        sim.log('scientist', `${s.name} ist aus ${sim.nationName(from)} nach ${sim.nationName(s.origin)} geflohen.`);
        continue;
      }
      s.loyalty = Math.min(0.7, s.loyalty + S.loyaltyGainPerDay);
    }
  }
}

/** Abwehrbonus durch Wissenschaftler mit Fachgebiet Geheimdienst. */
export function intelScientistBonus(sim, n) {
  let b = 0;
  for (const s of sim.scientists || []) {
    if (s.status === 'aktiv' && s.field === 'geheimdienst' && s.employer === n && s.cell >= 0 && sim.owner[s.cell] === n) b += s.bonus;
  }
  return b;
}

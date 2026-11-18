// Generäle (Phase 4): ein General je Front und Seite mit genau einer Eigenschaft.

export function initGenerals(sim, data) {
  sim.generalTraits = data.traits;
  sim.generals = data.generals.map((g) => ({ ...g, n: sim.idx(g.nation), front: 0 }));
}

export function traitOf(sim, front, n) {
  const id = front?.side[n]?.general;
  if (!id) return {};
  const g = sim.generals.find((x) => x.id === id);
  return g ? sim.bal.generals[g.trait] || {} : {};
}

export function freeGenerals(sim, n) {
  return sim.generals.filter((g) => g.n === n && !g.front);
}

export function assignGeneral(sim, frontId, n, id) {
  const f = sim.fronts.get(frontId);
  if (!f || !f.alive || !f.side[n]) return false;
  const g = id ? sim.generals.find((x) => x.id === id && x.n === n) : null;
  if (id && !g) return false;
  const old = f.side[n].general;
  if (old) { const og = sim.generals.find((x) => x.id === old); if (og) og.front = 0; }
  if (g) {
    if (g.front) { const of = sim.fronts.get(g.front); if (of?.side[n]) of.side[n].general = null; }
    g.front = frontId;
  }
  f.side[n].general = g ? g.id : null;
  return true;
}

/** Freigewordene Generäle lösen, Fronten ohne General automatisch besetzen. */
export function runGenerals(sim) {
  for (const g of sim.generals) {
    if (!g.front) continue;
    const f = sim.fronts.get(g.front);
    if (!f || !f.alive || f.side[g.n]?.general !== g.id) g.front = 0;
  }
  for (const f of [...sim.fronts.values()].sort((a, b) => a.id - b.id)) {
    if (!f.alive) continue;
    for (const n of [f.a, f.b]) {
      const side = f.side[n];
      if (side.general && sim.generals.some((g) => g.id === side.general && g.front === f.id)) continue;
      side.general = null;
      const free = freeGenerals(sim, n);
      if (free.length) assignGeneral(sim, f.id, n, free[0].id);
    }
  }
}

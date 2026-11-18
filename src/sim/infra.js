// Infrastruktur (Phase 3): Bahnnetz mit Zustand je Feld, Ausbaustufen je Region (Sektor),
// Bahnknoten und Brücken mit Zustand, Instandsetzung, Nachschub über intakte Bahnknoten.
// Zustände: 0 keine Bahn, 1 intakt, 2 beschädigt, 3 zerstört.

export const INTACT = 1;
export const DAMAGED = 2;
export const DESTROYED = 3;
export const STATE_LABEL = ['–', 'intakt', 'beschädigt', 'zerstört'];

export function initInfra(sim, infra) {
  const N = sim.N;
  sim.railState = new Uint8Array(N);
  sim.railProgress = new Float32Array(N);
  let c = 0;
  for (let k = 0; k < infra.rail.length; k++) {
    c = k === 0 ? infra.rail[0] : c + infra.rail[k];
    sim.railState[c] = INTACT;
  }
  sim.nodes = infra.nodes.map((n) => ({ cell: n.c, name: n.n, state: INTACT }));
  sim.bridges = infra.bridges.map((b) => ({ cell: b.c, river: b.river, name: b.name, state: INTACT }));
  sim.nodeAt = new Int32Array(N).fill(-1);
  sim.bridgeAt = new Int32Array(N).fill(-1);
  sim.nodes.forEach((n, i) => { sim.nodeAt[n.cell] = i; });
  sim.bridges.forEach((b, i) => { sim.bridgeAt[b.cell] = i; });
  // Ausbaustufe je Sektor: Startwert der Nation, der die meisten Felder des Sektors gehören
  const R = sim.bal.infrastructure;
  const S = sim.sectors;
  const votes = new Map();
  for (let i = 0; i < N; i++) {
    const s = S.sectorOf[i];
    if (s < 0) continue;
    const key = s * 64 + sim.owner[i];
    votes.set(key, (votes.get(key) || 0) + 1);
  }
  const best = new Int32Array(S.count);
  const bestN = new Int32Array(S.count);
  for (const [key, v] of votes) {
    const s = Math.floor(key / 64);
    if (v > best[s]) { best[s] = v; bestN[s] = key % 64; }
  }
  sim.railLevel = new Uint8Array(S.count);
  for (let s = 0; s < S.count; s++) {
    const code = bestN[s] ? sim.code(bestN[s]) : null;
    sim.railLevel[s] = (code && R.startLevel[code]) || R.startLevel.default;
  }
  // Industrieregionen eine Stufe besser (max. 5)
  for (const site of infra.industry) {
    const s = S.sectorOf[site.c];
    if (s >= 0) sim.railLevel[s] = Math.min(5, Math.max(sim.railLevel[s], (R.startLevel[site.nation] || 2) + 1));
  }
  sim.railUpgrades = []; // {sector, nation, to, start, finish, cost}
  sim.damagedRail = []; // Liste beschädigter/zerstörter Bahnfelder
}

export function levelOfCell(sim, cell) {
  const s = sim.sectors.sectorOf[cell];
  return s >= 0 ? sim.railLevel[s] : 1;
}

/** Wirkungsfaktor einer Ausbaustufe (Stufe 1 -> 0,8 … Stufe 5 -> 1,0, Werte aus balance.json). */
export function levelFactor(sim, level) {
  const f = sim.bal.infrastructure.levelFactor;
  return f[Math.max(1, Math.min(5, level)) - 1];
}

/** Bei Eroberung: Bahn, Knoten und Brücke beschädigt (minimaler Schaden) oder zerstört. */
export function damageOnCapture(sim, cell, method) {
  if (!sim.railState || method === 0) return;
  if (sim.railState[cell]) {
    const st = method === 2 ? DESTROYED : DAMAGED;
    if (sim.railState[cell] === INTACT) sim.damagedRail.push(cell);
    sim.railState[cell] = Math.max(sim.railState[cell], st);
    sim.railProgress[cell] = 0;
  }
  const ni = sim.nodeAt[cell];
  if (ni >= 0) sim.nodes[ni].state = Math.max(sim.nodes[ni].state, method === 2 ? DESTROYED : DAMAGED);
  const bi = sim.bridgeAt[cell];
  if (bi >= 0) sim.bridges[bi].state = DESTROYED; // Brücken werden beim Rückzug gesprengt
}

/** Instandsetzung: von intakten eigenen Strecken aus, begrenzt durch Bautrupps je Nation. */
export function repairRail(sim) {
  const R = sim.bal.infrastructure;
  const { cols, rows } = sim;
  const crews = new Map();
  const still = [];
  const done = [];
  for (const cell of sim.damagedRail) {
    const st = sim.railState[cell];
    if (st === INTACT) continue;
    const n = sim.owner[cell];
    const econ = sim.econ?.get(n);
    // nur Nationen mit eigener Wirtschaft setzen instand; im Kriegsgebiet nur hinter der Front
    if (!econ || econ.money < 0) { still.push(cell); continue; }
    const used = crews.get(n) || 0;
    if (used >= R.repairCrewsPerDay) { still.push(cell); continue; }
    const r = Math.floor(cell / cols);
    const c = cell - r * cols;
    let anchored = false;
    for (let dr = -1; dr <= 1 && !anchored; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if ((!dr && !dc) || rr < 0 || rr >= rows || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        if (sim.railState[j] === INTACT && sim.owner[j] === n) { anchored = true; break; }
      }
    }
    if (!anchored) { still.push(cell); continue; }
    crews.set(n, used + 1);
    const days = st === DESTROYED ? R.repairDaysDestroyed : R.repairDaysDamaged;
    sim.railProgress[cell] += levelFactor(sim, levelOfCell(sim, cell)) / days;
    if (sim.railProgress[cell] >= 1) done.push(cell);
    else still.push(cell);
  }
  for (const cell of done) {
    sim.railState[cell] = INTACT;
    sim.railProgress[cell] = 0;
    const n = sim.owner[cell];
    const econ = sim.econ?.get(n);
    if (econ) { econ.money -= R.repairCostPerCell; econ.spentToday += R.repairCostPerCell; }
    const ni = sim.nodeAt[cell];
    if (ni >= 0) sim.nodes[ni].state = INTACT;
    const bi = sim.bridgeAt[cell];
    if (bi >= 0) sim.bridges[bi].state = INTACT;
  }
  sim.damagedRail = still;
}

/** Feld gehört zum eigenen Kerngebiet (vor dem Krieg oder angegliedert). */
function isHome(sim, n, i) {
  return sim.owner[i] === n && (sim.homeOwner[i] === n || sim.conqMethod[i] === 0);
}

/**
 * Nachschub je kriegführender Nation: Abstand (in Feldern über Land) zum nächsten intakten
 * Bahnknoten, der über intakte eigene Strecken mit dem Kernnetz verbunden ist.
 */
export function computeRailSupply(sim) {
  const R = sim.bal.supply;
  const N = sim.N;
  const nb = sim.nb;
  const { cols, rows } = sim;
  if (!sim.supplyDist) sim.supplyDist = new Map();
  const q = sim._sq || (sim._sq = new Int32Array(N));
  const conn = sim._conn || (sim._conn = new Int32Array(N));
  const [r0, r1, c0, c1] = sim.boxRange();
  sim._connStamp = (sim._connStamp || 0) + 1;
  for (const n of [...sim.nations.keys()].sort((x, y) => x - y)) {
    if (!sim.inWar[n] || !sim.enemiesOf(n).length) continue;
    const stamp = sim._connStamp * 64 + n;
    // 1. verbundenes Netz: Breitensuche über intakte eigene Bahnfelder ab dem Kernnetz (8er)
    let head = 0;
    let tail = 0;
    for (let r = r0; r <= r1; r++) {
      for (let i = r * cols + c0, e = r * cols + c1; i <= e; i++) {
        if (sim.railState[i] === INTACT && isHome(sim, n, i)) { conn[i] = stamp; q[tail++] = i; }
      }
    }
    while (head < tail) {
      const i = q[head++];
      const r = (i / cols) | 0;
      const c = i - r * cols;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= cols) continue;
          const j = rr * cols + cc;
          if (conn[j] === stamp || sim.railState[j] !== INTACT || sim.owner[j] !== n) continue;
          conn[j] = stamp;
          q[tail++] = j;
        }
      }
    }
    // 2. Abstand zu nutzbaren Knoten (Breitensuche über eigenes Land, Grenzfelder des Gegners erhalten Werte)
    let dist = sim.supplyDist.get(n);
    if (!dist) { dist = new Uint16Array(N); sim.supplyDist.set(n, dist); }
    dist.fill(65535);
    head = 0;
    tail = 0;
    for (const node of sim.nodes) {
      const i = node.cell;
      if (node.state !== INTACT || conn[i] !== stamp) continue;
      dist[i] = 0;
      q[tail++] = i;
    }
    while (head < tail) {
      const i = q[head++];
      if (sim.owner[i] !== n) continue; // gegnerische Felder erhalten einen Wert, leiten aber nicht weiter
      const d = dist[i] + 1;
      if (d > R.rangeCells + 2) continue;
      for (let k = i * 4, e = k + 4; k < e; k++) {
        const j = nb[k];
        if (j < 0 || dist[j] <= d) continue;
        dist[j] = d;
        q[tail++] = j;
      }
    }
  }
}

/**
 * Nachschubfaktor: voll bis `fullCells` Felder vom nächsten nutzbaren Knoten, dann linear bis
 * `minFactor` bei `rangeCells`; die Bahnstufe der Region wirkt schwach mit (levelWeight).
 */
export function railSupply(sim, n, cell) {
  const R = sim.bal.supply;
  const d = sim.supplyDist?.get(n)?.[cell] ?? 65535;
  const t = d === 65535 ? 1 : Math.max(0, d - R.fullCells) / (R.rangeCells - R.fullCells);
  const base = Math.max(R.minFactor, 1 - t);
  const lvl = levelOfCell(sim, cell);
  return base * (1 - R.levelWeight * (5 - lvl) / 4);
}

/** Ausbau einer Region um eine Stufe (Kosten und Dauer aus balance.json). */
export function upgradeCost(sim, sector) {
  const R = sim.bal.infrastructure;
  const to = sim.railLevel[sector] + 1;
  return { to, cost: R.upgradeCostPerLevel * to, days: R.upgradeDaysPerLevel * to };
}

export function startUpgrade(sim, sector, n) {
  if (sector < 0 || sim.railLevel[sector] >= 5) return false;
  if (sim.railUpgrades.some((u) => u.sector === sector)) return false;
  const econ = sim.econ.get(n);
  const { to, cost, days } = upgradeCost(sim, sector);
  if (!econ || econ.money < cost) return false;
  sim.railUpgrades.push({ sector, nation: n, to, start: sim.day, finish: sim.day + days, cost });
  econ.money -= cost;
  econ.spentToday += cost;
  return true;
}

export function advanceUpgrades(sim) {
  const keep = [];
  for (const u of sim.railUpgrades) {
    if (sim.day >= u.finish) {
      sim.railLevel[u.sector] = u.to;
      sim.railLevelVersion = (sim.railLevelVersion || 0) + 1;
      if (u.nation === sim.player) sim.log('infra', `Bahnausbau abgeschlossen: Region ${sim.sectorName(u.sector)} jetzt Stufe ${u.to}.`);
    } else keep.push(u);
  }
  sim.railUpgrades = keep;
}

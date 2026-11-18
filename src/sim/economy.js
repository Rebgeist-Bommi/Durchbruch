// Wirtschaft (Phase 3): Geld, Rohstoffe (ein gemeinsamer Wert), Arbeitskräfte (Mobilisierung),
// Gebäude (Fabrik, Rüstungsfabrik, Forschungsanstalt), Ausrüstung mit Panzeranteil, Aufstellung
// und Auffüllung von Divisionen, Eroberungsfolgen, einfache KI-Wirtschaft.
import { levelFactor, levelOfCell, startUpgrade, INTACT } from './infra.js';
import { mods as modsOf, FOCI, aiResearch } from './research.js';
import { moraleProduction } from './morale.js';
import { effectSum } from './events.js';

export const BUILDING_TYPES = ['fabrik', 'ruestung', 'forschung'];

export function initEconomy(sim, infra) {
  const E = sim.bal.economy;
  sim.econ = new Map();
  for (const [code, cfg] of Object.entries(E.nations)) {
    if (code.startsWith('_')) continue;
    const n = sim.idx(code);
    sim.econ.set(n, {
      pop: cfg.pop, mobLevel: cfg.mobLevel, money: cfg.money, resources: cfg.resources,
      equipment: cfg.equipment, tankEquipment: cfg.tankEquipment, tankShare: cfg.tankShare,
      recruited: 0, productivity: 1, ai: code !== sim.bal.scenario.playerNation,
      // Tageswerte (für Anzeige)
      incomeToday: 0, upkeepToday: 0, spentToday: 0, resProducedToday: 0, resUsedToday: 0,
      equipToday: 0, laborFactor: 1, workers: 0, soldiersTarget: 0, pool: 0,
      history: [], // Wochenwerte für Kurven: [Tag, Geld, Einnahmen, Ausrüstung/Tag]
    });
  }
  sim.buildings = [];
  sim.buildingsAt = new Map();
  let id = 1;
  for (const site of infra.industry) {
    for (const type of BUILDING_TYPES) {
      for (let k = 0; k < site[type]; k++) {
        const b = { id: id++, type, cell: site.c, nation: sim.idx(site.nation), site: 1, health: 1, progress: 1, done: true, siteName: site.name };
        sim.buildings.push(b);
      }
    }
  }
  sim.nextBuildingId = id;
  indexBuildings(sim);
  sim.industrySites = infra.industry.map((s) => ({ name: s.name, cell: s.c, note: s.note, nation: s.nation }));
  sim.resourceRegions = infra.resources.map((r) => ({ name: r.name, kind: r.kind, cell: r.c, cells: r.cells, output: r.output, note: r.note }));
  // Rekrutierte Soldaten zum Start: Mannschaft der vorhandenen Divisionen (+ halber Ersatz)
  for (const [n, e] of sim.econ) {
    const men = sim.divisions.filter((d) => d.nation === n).reduce((s, d) => s + d.men, 0);
    e.recruited = Math.min(soldiersTarget(sim, e) * E.mobilization.combatShare, men * 1.0) ;
    e.recruited = Math.max(e.recruited, men);
  }
  // Produktivität so wählen, dass das Grundeinkommen zum BIP-Anteil passt (Größenordnung 1938)
  for (const [n, e] of sim.econ) {
    const cfg = E.nations[sim.code(n)];
    const raw = rawIncome(sim, n, e);
    const target = cfg.gdp1938 * E.incomePerGdpPerDay;
    e.productivity = raw > 0 ? target / raw : 1;
  }
  computeFlows(sim, false); // Anzeige am Tag 0
}

/** Phase 5: Ertragsfaktor aus Moral und (beim Spieler) Schwierigkeit. */
function yieldMul(sim, n) {
  if (!sim.nations) return 1;
  return moraleProduction(sim, n) * (n === sim.player && sim.diff ? sim.diff().income : 1);
}

export function soldiersTarget(sim, e) {
  return e.pop * 1e6 * sim.bal.economy.mobilization.levels[e.mobLevel].rate;
}

function laborForce(sim, e) {
  return e.pop * 1e6 * sim.bal.economy.mobilization.laborShare;
}

/** Arbeiter und Produktionsfaktor (1 = Friedensstärke). */
export function labor(sim, e) {
  const M = sim.bal.economy.mobilization;
  const lf = laborForce(sim, e);
  const workers = Math.max(0, lf - soldiersTarget(sim, e));
  const ref = lf - e.pop * 1e6 * M.levels[0].rate;
  return { workers, factor: workers / ref };
}

function rawIncome(sim, n, e) {
  const B = sim.bal.economy.buildings;
  let money = 0;
  for (const b of sim.buildings) if (b.done && b.type === 'fabrik' && sim.owner[b.cell] === n) money += B.fabrik.money;
  return money + (labor(sim, e).workers / 1e6) * sim.bal.economy.taxPerMillionWorkers;
}

/** Wirkungsgrad eines Gebäudes: Zustand × Standort × Ertrag (Eroberung) × Bahnstufe. */
export function buildingFactor(sim, b) {
  return b.health * b.site * sim.yieldOf(b.cell) * levelFactor(sim, levelOfCell(sim, b.cell));
}

/** Kampfwert-Faktor einer Division aus Mannschaft und Ausrüstung. */
export function divisionStrength(sim, d) {
  const men = d.men / d.maxMen;
  const eq = d.equip / sim.bal.economy.equipmentPerDivision;
  return 0.5 * men + 0.5 * Math.min(men, eq);
}

/**
 * Tageswerte berechnen (Arbeitskräfte, Einnahmen, Unterhalt, Förderung, Rüstung).
 * Mit `apply = false` nur Anzeige (z. B. am Tag 0), ohne Bestände zu verändern.
 */
export function computeFlows(sim, apply = true) {
  const E = sim.bal.economy;
  const B = E.buildings;
  for (const [n, e] of sim.econ) {
    e.incomeToday = 0;
    e.upkeepToday = 0;
    e.resProducedToday = 0;
    e.resUsedToday = 0;
    e.equipToday = 0;
    const L = labor(sim, e);
    e.workers = L.workers;
    e.laborFactor = L.factor;
    e.soldiersTarget = soldiersTarget(sim, e);
    // Rekrutierung: Richtung Zielstärke (Anteil Kampftruppen), begrenzt je Tag; Demobilisierung sofort
    const target = e.soldiersTarget * E.mobilization.combatShare;
    const step = e.pop * 1e6 * E.mobilization.recruitPerDayOfPop;
    const recruited = e.recruited < target ? Math.min(target, e.recruited + step) : target;
    if (apply) e.recruited = recruited;
    const menInDivs = sim.divisions.reduce((s, d) => (d.nation === n ? s + d.men : s), 0);
    e.pool = Math.max(0, recruited - menInDivs);
    // Phase 5: Sandbox "unbegrenzte Mittel" (Spieler)
    if (sim.settings?.sandbox && n === sim.player) { e.pool = Math.max(e.pool, sim.bal.sandbox.pool); e.laborFactor = Math.max(1, e.laborFactor); }
    if (sim.nations.get(n)?.status !== 'kapituliert') e.incomeToday += (e.workers / 1e6) * E.taxPerMillionWorkers * e.productivity * yieldMul(sim, n);
  }
  const armament = new Map();
  for (const b of sim.buildings) {
    const n = sim.owner[b.cell];
    const e = sim.econ.get(n);
    if (!e || !b.done) continue;
    e.upkeepToday += B[b.type].upkeep;
    const f = buildingFactor(sim, b) * e.laborFactor * e.productivity * yieldMul(sim, n);
    const m = sim.modsCache ? modsOf(sim, n) : null;
    if (b.type === 'fabrik') e.incomeToday += B.fabrik.money * f * (1 + (m ? m.production : 0));
    else if (b.type === 'ruestung') armament.set(n, (armament.get(n) || 0) + B.ruestung.equipment * f * (1 + (m ? m.equipment : 0)));
  }
  for (const r of sim.resourceRegions) {
    const per = (r.output * E.resourcePerOutput) / r.cells.length;
    for (const c of r.cells) {
      const e = sim.econ.get(sim.owner[c]);
      if (!e) continue;
      const mr = sim.modsCache ? modsOf(sim, sim.owner[c]).resources : 0;
      e.resProducedToday += per * sim.yieldOf(c) * levelFactor(sim, levelOfCell(sim, c)) * e.laborFactor * (1 + mr) * yieldMul(sim, sim.owner[c]);
    }
  }
  for (const [n, e] of sim.econ) {
    const want = (armament.get(n) || 0) * Math.max(0, 1 + effectSum(sim, n, 'armament'));
    const need = want * E.resourcesPerEquipment;
    const stock = e.resources + e.resProducedToday;
    const ratio = need > 0 ? Math.min(1, stock / need) : 0;
    e.resUsedToday = need * ratio;
    e.equipToday = want * ratio;
    e.upkeepToday += sim.divisions.reduce((s, d) => (d.nation === n ? s + E.divisionUpkeep : s), 0);
  }
}

export function runEconomy(sim) {
  const B = sim.bal.economy.buildings;
  computeFlows(sim, true);
  if (sim.settings?.sandbox) {
    const e = sim.econ.get(sim.player);
    const S = sim.bal.sandbox;
    e.money = Math.max(e.money, S.money);
    e.resources = Math.max(e.resources, S.resources);
  }
  for (const e of sim.econ.values()) {
    e.resources += e.resProducedToday - e.resUsedToday;
    e.equipment += e.equipToday;
    e.tankEquipment += e.equipToday * e.tankShare;
    e.money += e.incomeToday - e.upkeepToday;
  }
  // Baustellen: Kosten verteilt über die Bauzeit, ohne Geld kein Fortschritt
  for (const b of sim.buildings) {
    if (b.done) continue;
    const n = sim.owner[b.cell];
    const e = sim.econ.get(n);
    if (!e || n !== b.nation) continue; // Baustelle verloren -> ruht
    const cfg = B[b.type];
    const dayCost = cfg.cost / cfg.days;
    if (e.money < dayCost) continue;
    e.money -= dayCost;
    e.spentToday += dayCost;
    b.progress += 1 / cfg.days;
    if (b.progress >= 1 - 1e-9) {
      b.progress = 1;
      b.done = true;
      if (n === sim.player) sim.log('build', `${cfg.label} in ${b.siteName} fertiggestellt.`, b.cell);
    }
  }
  replenish(sim);
  for (const [n, e] of sim.econ) {
    if (e.ai && sim.nations.get(n)?.status === 'aktiv' && (sim.day + n) % 7 === 0) aiEconomy(sim, n, e);
    if (sim.day % 7 === 0) {
      e.history.push([sim.day, Math.round(e.money), +(e.incomeToday - e.upkeepToday).toFixed(2), +e.equipToday.toFixed(3)]);
      if (e.history.length > 260) e.history.shift();
    }
  }
}

/** Ausrüstung für `men` Soldaten mit Panzeranteil `tank` aus dem Bestand entnehmen. */
function takeEquipment(sim, e, units, tank) {
  const tankNeed = units * tank;
  const tankTake = Math.min(tankNeed, e.tankEquipment, e.equipment);
  const restNeed = units - tankNeed;
  const restAvail = Math.max(0, e.equipment - e.tankEquipment);
  const restTake = Math.min(restNeed, restAvail);
  const take = tankTake + restTake;
  e.equipment -= take;
  e.tankEquipment -= tankTake;
  return take;
}

/** Verluste auffüllen: Soldaten aus dem Ersatz, Ausrüstung aus dem Bestand. */
function replenish(sim) {
  const E = sim.bal.economy;
  const perDiv = E.equipmentPerDivision;
  for (const d of sim.divisions) {
    const e = sim.econ.get(d.nation);
    if (!e) continue;
    const men = Math.min(d.maxMen - d.men, d.maxMen * E.replenishPerDay, e.pool);
    if (men > 0) {
      d.men += men;
      e.pool -= men;
    }
    const eqWant = Math.min(perDiv * (d.men / d.maxMen) - d.equip, perDiv * E.replenishPerDay);
    if (eqWant > 0) d.equip += takeEquipment(sim, e, eqWant, d.tank);
  }
}

export function canRaiseDivision(sim, n) {
  const e = sim.econ.get(n);
  const E = sim.bal.economy;
  return e && e.pool >= sim.bal.divisions.menPerDivision * E.minDivisionMenShare && e.equipment >= 1;
}

/** Neue Division aufstellen (in die Reserve). Fehlt Personal oder Ausrüstung, ist sie unvollständig. */
export function raiseDivision(sim, n, tank) {
  const e = sim.econ.get(n);
  if (!canRaiseDivision(sim, n)) return null;
  const E = sim.bal.economy;
  const max = sim.bal.divisions.menPerDivision;
  const men = Math.min(max, e.pool);
  const eq = takeEquipment(sim, e, E.equipmentPerDivision * (men / max), tank);
  const cfg = sim.bal.divisions.nations[sim.code(n)];
  const count = sim.divisions.filter((d) => d.nation === n).length + (sim.raisedCount?.get(n) || 0);
  sim.raisedCount = sim.raisedCount || new Map();
  sim.raisedCount.set(n, (sim.raisedCount.get(n) || 0) + 1);
  const air = cfg?.newAir ?? 0.1;
  const d = { id: sim.nextDivisionId++, nation: n, name: `${count + 1}. ${cfg?.label || 'Div.'}`, men, maxMen: max, equip: eq, tank, air, front: 0, transit: null };
  sim.divisions.push(d);
  e.pool -= men;
  if (n === sim.player) sim.log('division', `${d.name} aufgestellt (${Math.round(men / 1000)}.000 Mann, Ausrüstung ${Math.round((eq / E.equipmentPerDivision) * 100)} %, Panzer ${Math.round(tank * 100)} %).`);
  return d;
}

// ------------------------------------------------------------------ Standortwahl
/**
 * Eignung eines Feldes für ein Gebäude (0–1) mit Begründung.
 * Faktoren: Bahnanbindung, Arbeitskräfte (Städte in der Nähe), Rohstoffe, Abstand zur Front.
 */
export function siteSuitability(sim, n, cell, type, fields = null) {
  const F = fields || siteFields(sim, n);
  const W = sim.bal.economy.siteWeights[type];
  if (sim.owner[cell] !== n || !sim.grid.territory[cell]) return { score: 0, ok: false, reasons: [['–', 'Nicht eigenes Gebiet']] };
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const rail = clamp(1 - F.rail[cell] / 6) * (0.6 + 0.1 * levelOfCell(sim, cell));
  const laborV = clamp(F.labor[cell] / 0.6);
  const res = clamp(1 - F.res[cell] / 25);
  const front = F.front[cell] === 65535 ? 1 : clamp((F.front[cell] - 3) / 20);
  const score = (W.rail * rail + W.labor * laborV + W.res * res + W.front * front) / (W.rail + W.labor + W.res + W.front);
  const tag = (v) => (v >= 0.66 ? '+' : v >= 0.33 ? '○' : '–');
  const km = (v) => (v === 65535 ? 'weit' : `${v * 9} km`);
  const reasons = [
    [tag(rail), `Bahn: ${F.rail[cell] === 0 ? 'Anschluss im Feld' : `nächste Strecke ${km(F.rail[cell])}`}, Ausbaustufe ${levelOfCell(sim, cell)}`],
    [tag(laborV), `Arbeitskräfte: ${F.cityName[cell] ? `nahe ${F.cityName[cell]}` : 'keine größere Stadt in der Nähe'}`],
    [tag(res), `Rohstoffe: ${F.res[cell] === 65535 ? 'kein Rohstoffgebiet erreichbar' : `nächstes Gebiet ${km(F.res[cell])}`}`],
    [tag(front), `Front: ${F.front[cell] === 65535 ? 'kein Krieg in Reichweite' : `Abstand ${km(F.front[cell])}`}`],
  ];
  return { score, ok: true, reasons, rail, labor: laborV, res, front };
}

/** Abstandsfelder für die Standortwahl (einmal je Bauvorgang berechnet). */
export function siteFields(sim, n) {
  const N = sim.N;
  const nb = sim.nb;
  const bfs = (sources, through) => {
    const dist = new Uint16Array(N).fill(65535);
    const q = new Int32Array(N);
    let head = 0;
    let tail = 0;
    for (const s of sources) { if (dist[s] !== 0) { dist[s] = 0; q[tail++] = s; } }
    while (head < tail) {
      const i = q[head++];
      const d = dist[i] + 1;
      if (d > 60) continue;
      for (let k = i * 4, e = k + 4; k < e; k++) {
        const j = nb[k];
        if (j < 0 || dist[j] <= d || !through(j)) continue;
        dist[j] = d;
        q[tail++] = j;
      }
    }
    return dist;
  };
  const own = (j) => sim.owner[j] === n;
  const railSrc = [];
  for (let i = 0; i < N; i++) if (sim.railState[i] === INTACT && sim.owner[i] === n) railSrc.push(i);
  const resSrc = [];
  for (const r of sim.resourceRegions) for (const c of r.cells) if (sim.owner[c] === n) resSrc.push(c);
  const frontSrc = [];
  for (let i = 0; i < N; i++) {
    const o = sim.owner[i];
    if (o && o !== n && sim.isWar(o, n)) frontSrc.push(i);
  }
  // Arbeitskräfte: Städte nach Rang gewichtet, Abfall mit der Entfernung
  const labor = new Float32Array(N);
  const cityName = new Array(N).fill('');
  const cityBest = new Float32Array(N);
  const weight = [0, 1, 0.8, 0.6, 0.4];
  for (const c of sim.cities) {
    if (sim.owner[c.cell] !== n) continue;
    const w = weight[c.rank] || 0.3;
    const R = 6;
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        const r = c.row + dr;
        const col = c.col + dc;
        if (r < 0 || r >= sim.rows || col < 0 || col >= sim.cols) continue;
        const j = r * sim.cols + col;
        const v = w * Math.max(0, 1 - Math.hypot(dr, dc) / (R + 1));
        labor[j] += v;
        if (v > cityBest[j]) { cityBest[j] = v; cityName[j] = c.name; }
      }
    }
  }
  return {
    rail: bfs(railSrc, own),
    res: bfs(resSrc, () => true),
    front: frontSrc.length ? bfs(frontSrc, () => true) : new Uint16Array(N).fill(65535),
    labor,
    cityName,
  };
}

/**
 * Abstandswerte nur für ausgewählte Felder (schnell, für KI und Einzelklick).
 * Gleiche Bedeutung wie siteFields, Entfernungen als Manhattan-Abstand in Feldern.
 */
export function siteFieldsLocal(sim, n, cells) {
  const { cols, rows } = sim;
  const F = { rail: {}, res: {}, front: {}, labor: {}, cityName: {} };
  const resCells = [];
  for (const r of sim.resourceRegions) for (const c of r.cells) if (sim.owner[c] === n) resCells.push(c);
  const enemyCells = [];
  const E = sim.edges;
  if (E) {
    for (let k = 0; k < E.count; k++) {
      for (const c of [E.a[k], E.b[k]]) {
        const o = sim.owner[c];
        if (o !== n && sim.isWar(o, n)) enemyCells.push(c);
      }
    }
  }
  const weight = [0, 1, 0.8, 0.6, 0.4];
  for (const cell of cells) {
    const r0 = Math.floor(cell / cols);
    const c0 = cell - r0 * cols;
    let best = 65535;
    for (let dr = -6; dr <= 6; dr++) {
      for (let dc = -6; dc <= 6; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || r >= rows || c < 0 || c >= cols) continue;
        const j = r * cols + c;
        if (sim.railState[j] === INTACT && sim.owner[j] === n) best = Math.min(best, Math.abs(dr) + Math.abs(dc));
      }
    }
    F.rail[cell] = best;
    let rd = 65535;
    for (const j of resCells) rd = Math.min(rd, Math.abs(Math.floor(j / cols) - r0) + Math.abs((j % cols) - c0));
    F.res[cell] = rd > 60 ? 65535 : rd;
    let fd = 65535;
    for (const j of enemyCells) fd = Math.min(fd, Math.abs(Math.floor(j / cols) - r0) + Math.abs((j % cols) - c0));
    F.front[cell] = fd;
    let lab = 0;
    let bestV = 0;
    let name = '';
    for (const city of sim.cities) {
      if (sim.owner[city.cell] !== n) continue;
      const dr = city.row - r0;
      const dc = city.col - c0;
      if (Math.abs(dr) > 6 || Math.abs(dc) > 6) continue;
      const v = (weight[city.rank] || 0.3) * Math.max(0, 1 - Math.hypot(dr, dc) / 7);
      lab += v;
      if (v > bestV) { bestV = v; name = city.name; }
    }
    F.labor[cell] = lab;
    F.cityName[cell] = name;
  }
  return F;
}

/** Bauauftrag. Kosten fallen über die Bauzeit an. `F` = vorberechnete Abstandsfelder (optional). */
export function build(sim, n, type, cell, F = null, focus = null) {
  const B = sim.bal.economy.buildings;
  if (!B[type] || sim.owner[cell] !== n) return null;
  const e = sim.econ.get(n);
  const suit = siteSuitability(sim, n, cell, type, F || siteFieldsLocal(sim, n, [cell]));
  if (!suit.ok) return null;
  const site = sim.bal.economy.siteMin + (1 - sim.bal.economy.siteMin) * suit.score * 1.25;
  const b = {
    id: sim.nextBuildingId++, type, cell, nation: n, site: Math.min(1.15, site), health: 1, progress: 0, done: false,
    siteName: sim.nearestCityName(cell % sim.cols, Math.floor(cell / sim.cols), 4), started: sim.day,
  };
  if (type === 'forschung') {
    b.focus = FOCI.includes(focus) ? focus : FOCI[b.id % FOCI.length];
    b.budget = sim.bal.research.defaultBudget;
  }
  b.guard = sim.bal.intel?.defaultGuard?.[type] ?? 0;
  addBuilding(sim, b);
  void e;
  return { building: b, suitability: suit };
}

// ------------------------------------------------------------------ Eroberung
export function addBuilding(sim, b) {
  sim.buildings.push(b);
  if (!sim.buildingsAt.has(b.cell)) sim.buildingsAt.set(b.cell, []);
  sim.buildingsAt.get(b.cell).push(b);
}

export function indexBuildings(sim) {
  sim.buildingsAt = new Map();
  for (const b of sim.buildings) {
    if (!sim.buildingsAt.has(b.cell)) sim.buildingsAt.set(b.cell, []);
    sim.buildingsAt.get(b.cell).push(b);
  }
}

/** Gebäude auf erobertem Feld: Zustand nach Vorgehen. */
export function captureBuildings(sim, cell, method) {
  if (!sim.buildingsAt || method === 0) return;
  const list = sim.buildingsAt.get(cell);
  if (!list) return;
  const C = sim.bal.economy.conquest[method === 2 ? 'total' : 'minimal'];
  for (const b of list) b.health *= C.buildings;
}

/** Bestände einer kapitulierenden Nation gehen anteilig an den Eroberer. */
export function transferStocks(sim, from, to, method) {
  const a = sim.econ.get(from);
  const b = sim.econ.get(to);
  if (!a || !b) return;
  const C = sim.bal.economy.conquest[method === 2 ? 'total' : 'minimal'];
  b.equipment += a.equipment * C.stocks;
  b.tankEquipment += a.tankEquipment * C.stocks;
  b.resources += a.resources * C.stocks;
  a.equipment = 0;
  a.tankEquipment = 0;
  a.resources = 0;
}

// ------------------------------------------------------------------ KI-Wirtschaft
function aiEconomy(sim, n, e) {
  const E = sim.bal.economy;
  const A = E.ai;
  const atWar = sim.enemiesOf(n).length > 0;
  aiResearch(sim, n, e);
  // Mobilisierung
  const cfg = E.nations[sim.code(n)];
  e.mobLevel = atWar ? Math.max(cfg.mobLevel, A.warMobLevel) : cfg.mobLevel;
  // Divisionen aufstellen
  const per = E.equipmentPerDivision;
  let raised = 0;
  const net = e.incomeToday - e.upkeepToday;
  const affordable = atWar || net > E.divisionUpkeep * 3;
  while (affordable && raised < (atWar ? A.divisionsPerWeekWar : A.divisionsPerWeekPeace)
    && e.pool >= sim.bal.divisions.menPerDivision && e.equipment >= per * A.minEquipShare) {
    raiseDivision(sim, n, Math.min(e.tankShare, e.tankEquipment / Math.max(1, e.equipment)));
    raised++;
  }
  // Bauen: Reserve für 60 Tage Unterhalt halten, höchstens ein Auftrag je Woche
  const upkeep = e.upkeepToday || 1;
  const open = sim.buildings.filter((b) => !b.done && b.nation === n).length;
  if (open < A.maxOpenBuilds && e.money > upkeep * A.reserveDays + E.buildings.fabrik.cost) {
    const needEquip = e.equipment < per * A.equipReserveDivisions && e.resources > 5;
    const type = needEquip ? 'ruestung' : (sim.day / 7 + n) % 9 === 0 ? 'forschung' : 'fabrik';
    const cell = aiPickSite(sim, n, type);
    if (cell >= 0) build(sim, n, type, cell, siteFieldsLocal(sim, n, [cell]));
  } else if (e.money > upkeep * A.reserveDays * 3) {
    // Bahn in der schwächsten eigenen Industrieregion ausbauen
    let best = -1;
    let bl = 6;
    for (const s of sim.industrySites) {
      if (sim.owner[s.cell] !== n) continue;
      const sec = sim.sectors.sectorOf[s.cell];
      if (sec >= 0 && sim.railLevel[sec] < bl) { bl = sim.railLevel[sec]; best = sec; }
    }
    if (best >= 0 && bl < 5) startUpgrade(sim, best, n);
  }
}

/** Bester Bauplatz unter Kandidaten: eigene Städte und Industriezentren. */
function aiPickSite(sim, n, type) {
  const cand = new Set();
  for (const c of sim.cities) if (sim.owner[c.cell] === n) cand.add(c.cell);
  for (const s of sim.industrySites) if (sim.owner[s.cell] === n) cand.add(s.cell);
  if (!cand.size) return -1;
  const list = [...cand].sort((a, b) => a - b);
  const F = siteFieldsLocal(sim, n, list);
  let best = -1;
  let bs = -1;
  for (const c of list) {
    const s = siteSuitability(sim, n, c, type, F).score;
    if (s > bs) { bs = s; best = c; }
  }
  return best;
}

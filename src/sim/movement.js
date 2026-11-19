// Richtung A, Stufe A1: Divisionen sind Figuren auf der Karte.
// Jede Division hat einen Standort (`cell`) und marschiert entlang einer Route (`path`) über
// eigenes Gebiet – auf intakter Bahn schnell, im Gelände langsam, im Gebirge noch langsamer.
// Zuordnung zur Front ergibt sich aus der Lage: Wer nahe an seiner Front steht, kämpft dort
// (`d.front`, kein `transit`); wer noch marschiert, trägt `transit = {to, arrive}` und kämpft nicht.
// Reserve = Division ohne Front an ihrem Standort; ein Marschziel ohne Front ist `d.goal`.
// `d.trail` = heute durchlaufene Felder (nur für die Darstellung, wird jeden Tag neu gesetzt).

class Heap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    if (k.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= k.length) break;
        const r = l + 1;
        const m = r < k.length && k[r] < k[l] ? r : l;
        if (k[m] >= lk) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

const speedOf = (sim, d) => {
  const M = sim.bal.movement;
  return d.tank > 0.25 ? M.tankCellsPerDay : M.infantryCellsPerDay;
};

/** Kosten (in Tagen) für den Schritt a → b. */
export function stepCost(sim, d, a, b) {
  const M = sim.bal.movement;
  if (sim.railState[a] === 1 && sim.railState[b] === 1 && sim.owner[b] === d.nation) return 1 / M.railCellsPerDay;
  const base = 1 / speedOf(sim, d);
  return sim.terrain[b] === 1 ? base * M.mountainFactor : base;
}

/**
 * Route von `from` nach `goal` über Felder, die `d.nation` gehören (A*, Diagonalen über
 * 4er-Nachbarschaft). Gibt die Felder ohne den Start zurück oder null.
 */
export function findPath(sim, d, from, goal, maxNodes = 60000) {
  if (from === goal) return [];
  const N = sim.N;
  if (!sim._pf || sim._pf.g.length !== N) sim._pf = { g: new Float32Array(N), prev: new Int32Array(N), stamp: new Int32Array(N), closed: new Int32Array(N), cur: 0 };
  const P = sim._pf;
  P.cur++;
  const { cols } = sim;
  const M = sim.bal.movement;
  // gewichtete Schätzung (schneller, Wege nahezu optimal): zwischen Bahn- und Fußmarschkosten
  const minCost = M.pathGreed / M.railCellsPerDay;
  const gx = goal % cols;
  const gy = (goal / cols) | 0;
  const h = (c) => Math.hypot((c % cols) - gx, ((c / cols) | 0) - gy) * minCost;
  const own = d.nation;
  const heap = new Heap();
  P.stamp[from] = P.cur;
  P.g[from] = 0;
  P.prev[from] = -1;
  heap.push(h(from), from);
  let seen = 0;
  while (heap.size) {
    const c = heap.pop();
    if (P.closed[c] === P.cur) continue;
    P.closed[c] = P.cur;
    if (c === goal) break;
    if (++seen > maxNodes) return null;
    for (let k = c * 4, e = k + 4; k < e; k++) {
      const j = sim.nb[k];
      if (j < 0 || P.closed[j] === P.cur) continue;
      if (sim.owner[j] !== own && j !== goal) continue;
      const g = P.g[c] + stepCost(sim, d, c, j);
      if (P.stamp[j] !== P.cur || g < P.g[j]) {
        P.stamp[j] = P.cur;
        P.g[j] = g;
        P.prev[j] = c;
        heap.push(g + h(j), j);
      }
    }
  }
  if (P.closed[goal] !== P.cur) return null;
  const out = [];
  for (let c = goal; c !== from; c = P.prev[c]) out.push(c);
  return out.reverse();
}

/** Seeweg/Notroute (z. B. nach Ostpreußen): gerade Linie, Feldfolge ohne Besitzprüfung. */
function straightPath(sim, from, goal) {
  const { cols } = sim;
  const x0 = from % cols; const y0 = (from / cols) | 0;
  const x1 = goal % cols; const y1 = (goal / cols) | 0;
  const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
  const out = [];
  for (let i = 1; i <= n; i++) {
    const c = Math.round(y0 + ((y1 - y0) * i) / n) * cols + Math.round(x0 + ((x1 - x0) * i) / n);
    if (out[out.length - 1] !== c) out.push(c);
  }
  return out;
}

const dist = (sim, a, b) => Math.hypot((a % sim.cols) - (b % sim.cols), ((a / sim.cols) | 0) - ((b / sim.cols) | 0));

/** Startaufstellung: Fronttruppen an die Front verteilt, übrige als Garnison in die Städte. */
export function initPositions(sim) {
  const byNation = new Map();
  for (const d of sim.divisions) {
    if (d.cell !== undefined && d.cell >= 0) continue;
    if (!byNation.has(d.nation)) byNation.set(d.nation, []);
    byNation.get(d.nation).push(d);
  }
  for (const [n, list] of byNation) {
    const cities = sim.cities.filter((c) => sim.owner[c.cell] === n && c.rank <= 3).sort((a, b) => a.rank - b.rank || a.cell - b.cell);
    const cap = sim.capital.get(n);
    let k = 0;
    for (const d of list) {
      const f = d.front ? sim.fronts.get(d.front) : null;
      if (f && f.alive && f.side[n]) {
        const cells = sim.frontCellsOf(f, n);
        d.cell = cells.length ? cells[(d.id * 7919) % cells.length] : cap ?? 0;
        d.slot = d.cell;
      } else {
        const c = cities.length ? cities[k++ % Math.min(cities.length, 8)].cell : cap ?? sim.nationBox.get(n)?.r0 * sim.cols ?? 0;
        d.cell = c;
      }
      d.path = null; d.prog = 0; d.goal = null; d.trail = null;
    }
  }
}

/** Neue Division an einem Ort aufstellen (Stadt mit Kaserne oder Hauptstadt). */
export function placeNewDivision(sim, d, cell) {
  d.cell = cell ?? sim.capital.get(d.nation) ?? 0;
  d.path = null; d.prog = 0; d.goal = null; d.trail = null; d.slot = -1;
}

/** Marschbefehl ohne Front: Division geht in die Reserve und marschiert zum Feld `cell`. */
export function moveTo(sim, d, cell) {
  if (sim.owner[cell] !== d.nation) return false;
  d.front = 0;
  d.transit = null;
  d.goal = cell;
  d.path = null;
  d.slot = -1;
  return true;
}

/** Frontdaten je (Front, Nation) für einen Tag: Felder, Menge, Raster für die Nächste-Feld-Suche. */
function frontInfo(sim, cache, f, n) {
  const key = f.id * 64 + n;
  let I = cache.get(key);
  if (I) return I;
  const cells = sim.frontCellsOf(f, n);
  const B = 6;
  const grid = new Map();
  for (const c of cells) {
    const k = Math.floor((c % sim.cols) / B) * 1024 + Math.floor(((c / sim.cols) | 0) / B);
    let l = grid.get(k);
    if (!l) grid.set(k, (l = []));
    l.push(c);
  }
  I = { key, cells, set: new Set(cells), grid, B, field: null, near: new Map() };
  cache.set(key, I);
  return I;
}

/** Frontfelder im Umkreis `R` um `c` (über das Raster, ohne alle Frontfelder zu prüfen). */
function localCells(sim, I, c, R) {
  const x = c % sim.cols;
  const y = (c / sim.cols) | 0;
  const r = Math.ceil(R / I.B);
  const bx = Math.floor(x / I.B);
  const by = Math.floor(y / I.B);
  const out = [];
  for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    const l = I.grid.get((bx + dx) * 1024 + by + dy);
    if (!l) continue;
    for (const q of l) if (Math.abs((q % sim.cols) - x) <= R && Math.abs(((q / sim.cols) | 0) - y) <= R) out.push(q);
  }
  return out.length ? out : [c];
}

/** Nächstes Frontfeld (Raster, wachsender Suchring) → [Feld, Abstand in Feldern]. */
function nearestIn(sim, I, from) {
  if (!I.cells.length) return [-1, Infinity];
  const hit = I.near.get(from);
  if (hit) return hit;
  const res = nearestScan(sim, I, from);
  I.near.set(from, res);
  return res;
}

function nearestScan(sim, I, from) {
  const x = from % sim.cols;
  const y = (from / sim.cols) | 0;
  const bx = Math.floor(x / I.B);
  const by = Math.floor(y / I.B);
  let best = -1;
  let bd = Infinity;
  for (let r = 0; r < 80; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const l = I.grid.get((bx + dx) * 1024 + by + dy);
        if (!l) continue;
        for (const c of l) {
          const dd = Math.hypot((c % sim.cols) - x, ((c / sim.cols) | 0) - y);
          if (dd < bd) { bd = dd; best = c; }
        }
      }
    }
    if (best >= 0 && bd <= r * I.B) break;
  }
  return [best, bd];
}

/**
 * Wegefeld zur Front (Infanterie-Kosten; Bahn schnell). `next[c]` = nächster Schritt Richtung Front.
 * Die Rechnung endet, sobald alle angefragten Startfelder (`I.want`) erreicht sind.
 */
/** Endet die Route noch an der Front (höchstens 2 Felder daneben)? Spart tägliche Neuberechnung. */
function pathEndsAtFront(sim, I, path) {
  const end = path[path.length - 1];
  return I.set.has(end) || nearestIn(sim, I, end)[1] <= 6;
}

/**
 * Täglich nach der Frontberechnung: Zuordnung, Wegsuche, Marsch. Ein Tag Marsch = Budget 1,0;
 * jeder Schritt kostet `stepCost` (Bahn ≈ 1/18 Tag je Feld, Infanterie ≈ 1/2,5 Tag).
 * Marschierende suchen eine Route (A*, je Front höchstens `routesPerDay` neue am Tag) bis an die Front und verteilen sich dort auf einen Platz in
 * bis zu `spreadCells` Feldern Umkreis (kurze Wegsuche); Fronttruppen rücken dem Verlauf nach.
 */
export function runMovement(sim) {
  const M = sim.bal.movement;
  const cache = new Map();
  // 1. Durchgang: welche Anmarschrouten werden heute neu gebraucht (Startfelder je Front)?
  for (const d of sim.divisions) {
    if (d.cell === undefined || d.cell < 0) placeNewDivision(sim, d);
    const tid = d.transit ? d.transit.to : d.front;
    const f = tid ? sim.fronts.get(tid) : null;
    if (!f || !f.alive || !f.side[d.nation]) continue;
    const I = frontInfo(sim, cache, f, d.nation);
    if (d.path && d.path.length && pathEndsAtFront(sim, I, d.path)) continue;
    if (nearestIn(sim, I, d.cell)[1] <= M.frontReach) continue;
    // höchstens `routesPerDay` neue Anmarschrouten je Front und Tag (feste Reihenfolge nach Kennung)
    if ((I.want || (I.want = [])).length >= M.routesPerDay) { d.waitRoute = true; continue; }
    d.waitRoute = false;
    I.want.push(d.cell);
  }
  for (const d of sim.divisions) {
    d.trail = [d.cell];
    if (d.transit && !d.transit.to) { d.transit = null; d.front = 0; d.path = null; d.goal = null; } // zur Reserve: bleibt stehen
    const tid = d.transit ? d.transit.to : d.front;
    const f = tid ? sim.fronts.get(tid) : null;
    if (f && f.alive && f.side[d.nation]) {
      const I = frontInfo(sim, cache, f, d.nation);
      if (!I.cells.length) continue;
      // häufigster Fall zuerst: steht bereits auf seinem Frontplatz
      if (!d.transit && d.slot >= 0 && I.set.has(d.slot) && dist(sim, d.cell, d.slot) <= 1.5) { d.path = null; continue; }
      const [nearCell, near] = nearestIn(sim, I, d.cell);
      d.front = tid;
      if (near <= M.frontReach) {
        if (d.transit) d.transit = null; // angekommen
        // Platz an der Front: verteilt nach Kennung im Umkreis; bei Frontverschiebung neu wählen
        if (d.slot === undefined || d.slot < 0 || !I.set.has(d.slot)) {
          const local = localCells(sim, I, nearCell, M.spreadCells);
          d.slot = local[(d.id * 7919) % local.length];
          d.path = null;
        }
        if (dist(sim, d.cell, d.slot) <= 1.5) { d.path = null; continue; }
        if (!d.path || d.path[d.path.length - 1] !== d.slot) {
          // kurze Wege an der Front: gerade Linie, wenn sie nur über eigenes Gebiet führt; sonst Wegsuche
          const line = straightPath(sim, d.cell, d.slot);
          d.path = line.every((c) => sim.owner[c] === d.nation) ? line : findPath(sim, d, d.cell, d.slot, 1500);
        }
        if (!d.path) { d.slot = nearCell; continue; }
      } else {
        // Anmarsch (oder zu weit zurückgefallen): dem Wegefeld folgen, kämpft erst nach Ankunft
        if (near > M.frontReach * 2 && !d.transit) d.transit = { from: 0, to: tid, arrive: sim.day + 1, days: 1 };
        if (d.waitRoute) { d.waitRoute = false; if (!d.path || !d.path.length) continue; }
        else if (!d.path || !d.path.length || !pathEndsAtFront(sim, I, d.path)) {
          d.path = findPath(sim, d, d.cell, nearCell, 20000) || straightPath(sim, d.cell, nearCell);
          d.slot = -1;
        }
      }
    } else if (tid) {
      // Front erloschen: zurück in die Reserve am Standort
      d.front = 0; d.transit = null; d.path = null; d.slot = -1;
      continue;
    } else if (d.goal !== null && d.goal !== undefined && d.goal >= 0) {
      if (d.cell === d.goal) { d.goal = null; d.path = null; continue; }
      if (!d.path || d.path[d.path.length - 1] !== d.goal) d.path = findPath(sim, d, d.cell, d.goal);
      if (!d.path) { d.goal = null; continue; }
    } else {
      continue;
    }
    // Marsch: Budget eines Tages
    let budget = 1;
    while (budget > 1e-6 && d.path && d.path.length) {
      const next = d.path[0];
      const cost = sim.owner[next] === d.nation ? stepCost(sim, d, d.cell, next) : 1 / M.seaCellsPerDay;
      const need = (1 - d.prog) * cost;
      if (budget >= need) {
        budget -= need;
        d.cell = next;
        d.prog = 0;
        d.path.shift();
        d.trail.push(next);
      } else {
        d.prog += budget / cost;
        budget = 0;
      }
    }
    if (d.path && !d.path.length) d.path = null;
    if (d.transit) {
      const tf = sim.fronts.get(d.transit.to);
      const I = tf ? frontInfo(sim, cache, tf, d.nation) : null;
      if (I && I.cells.length && nearestIn(sim, I, d.cell)[1] <= M.frontReach) arrive(sim, d, d.transit.to);
      else d.transit.arrive = sim.day + Math.max(1, Math.ceil(remaining(sim, d)));
    }
  }
}

function arrive(sim, d, fid) {
  d.front = fid;
  d.transit = null;
  d.path = null;
}

/** Verbleibende Marschzeit in Tagen. */
export function remaining(sim, d) {
  if (!d.path || !d.path.length) return 0;
  let t = 0;
  let a = d.cell;
  for (const c of d.path) { t += sim.owner[c] === d.nation ? stepCost(sim, d, a, c) : 1 / sim.bal.movement.seaCellsPerDay; a = c; }
  return t * (1 - 0) - d.prog * stepCost(sim, d, d.cell, d.path[0]);
}

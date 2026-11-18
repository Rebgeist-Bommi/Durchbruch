// Einfache KI (Phase 2: Polen). Verteilt Divisionen auf bedrohte Abschnitte und Fronten,
// befestigt und zieht Truppen aus Räumen ab, denen die Einkesselung droht.
import { components } from './pockets.js';

export function runAi(sim) {
  for (const n of sim.nations.keys()) {
    if (n === sim.player) continue;
    if (sim.nations.get(n).status !== 'aktiv' || !sim.enemiesOf(n).length) continue;
    aiNation(sim, n);
  }
}

/** Vorlauf ohne Wirkung: Bedrohungserkennung einmal rechnen. */
export function warmupAi(sim, n) {
  const fronts = [...sim.fronts.values()].filter((f) => f.alive && f.side[n]);
  if (fronts.length) detectThreats(sim, n, fronts);
}

function aiNation(sim, n) {
  const A = sim.bal.ai;
  const fronts = [...sim.fronts.values()].filter((f) => f.alive && f.side[n]).sort((x, y) => x.id - y.id);
  if (!fronts.length) return;

  // 1. Halten und befestigen
  for (const f of fronts) if (f.side[n].order !== 'hold') f.side[n].order = 'hold';

  // 2. innerhalb der Front: Gewicht je Abschnitt nach Länge und Gefahr (gestriger Vormarsch)
  for (const f of fronts) {
    const enemy = sim.enemyOn(f, n);
    for (const sec of f.sections) {
      const cells = (n === f.b ? sec.cellsB : sec.cellsA).length;
      const danger = sec.stats.danger[n] || 0;
      sec.stats.defWeight[n] = cells * (1 + A.dangerWeight * Math.min(1, danger / 9));
      void enemy;
    }
  }

  // 3. drohende Kessel erkennen
  const threatened = detectThreats(sim, n, fronts);
  let moves = A.maxTransfersPerDay;
  const safe = fronts.filter((f) => !f.encircled[n] && !threatened.has(f.id));

  const enemyStr = (f) => sim.sideStrength(f.id, sim.enemyOn(f, n)).str;
  const current = (f) => sim.divisionsOn(f.id, n).length + sim.inTransitTo(f.id, n).length;

  // Rückzug aus bedrohten Räumen
  for (const f of fronts) {
    if (!threatened.has(f.id) || f.encircled[n] || !safe.length || moves <= 0) continue;
    const here = sim.divisionsOn(f.id, n).length;
    if (!here) continue;
    const target = safe.reduce((b, x) => (enemyStr(x) / (current(x) + 1) > enemyStr(b) / (current(b) + 1) ? x : b), safe[0]);
    const moved = sim.transfer(f.id, target.id, Math.min(moves, here), n);
    moves -= moved;
    if (moved && !f.retreatLogged) {
      f.retreatLogged = true;
      sim.log('retreat', `${sim.nationName(n)}: Truppen weichen aus dem Raum ${sim.nearestCityName(f.cx, f.cy, 4, n)} zurück.`);
    }
  }
  if (!safe.length) return;

  // 4. Verteilung nach Bedrohung: Reserve zuerst, dann Ausgleich zwischen Fronten
  const threat = new Map(safe.map((f) => [f.id, enemyStr(f) + 0.02 * f.length]));
  const sumThreat = [...threat.values()].reduce((s, v) => s + v, 0) || 1;
  const reserve = sim.reserveOf(n).length;
  const total = safe.reduce((s, f) => s + current(f), 0) + reserve;
  const desired = (f) => (total * threat.get(f.id)) / sumThreat;
  const deficit = (f) => desired(f) - current(f);
  const keepReserve = Math.floor(total * 0.05);
  let free = Math.max(0, reserve - keepReserve);
  while (free > 0 && moves > 0) {
    const t = safe.reduce((b, x) => (deficit(x) > deficit(b) ? x : b), safe[0]);
    if (deficit(t) < 0.5) break;
    if (!sim.transfer(0, t.id, 1, n)) break;
    free--;
    moves--;
  }
  while (moves > 0) {
    const over = safe.reduce((b, x) => (deficit(x) < deficit(b) ? x : b), safe[0]);
    const under = safe.reduce((b, x) => (deficit(x) > deficit(b) ? x : b), safe[0]);
    if (over === under || -deficit(over) < A.rebalanceThreshold || deficit(under) < A.rebalanceThreshold) break;
    if (!sim.transfer(over.id, under.id, 1, n)) break;
    moves--;
  }
}

/**
 * Drohender Kessel: Das eigene Gebiet wird um `retreatDepthCells` Felder von der Front aus
 * "abgetragen". Fronten, deren Hinterland danach keine breite Verbindung zum Kernland mehr hat,
 * gelten als bedroht.
 */
function detectThreats(sim, n, fronts) {
  const depth = sim.bal.ai.retreatDepthCells;
  const N = sim.N;
  const dist = sim._aiDist || (sim._aiDist = new Int16Array(N));
  const q = sim._aiQ || (sim._aiQ = new Int32Array(N));
  const nb = sim.nb;
  const owner = sim.owner;
  const [r0, r1, c0, c1] = sim.nationRange(n);
  const cells = [];
  for (let r = r0; r <= r1; r++) {
    for (let i = r * sim.cols + c0, e = r * sim.cols + c1; i <= e; i++) if (owner[i] === n) { cells.push(i); dist[i] = -1; }
  }
  let head = 0;
  let tail = 0;
  for (const i of cells) {
    for (let k = i * 4, e = k + 4; k < e; k++) {
      const j = nb[k];
      if (j >= 0 && owner[j] && owner[j] !== n && sim.isWar(n, owner[j])) { dist[i] = 0; q[tail++] = i; break; }
    }
  }
  while (head < tail) {
    const i = q[head++];
    if (dist[i] >= depth) continue;
    for (let k = i * 4, e = k + 4; k < e; k++) {
      const j = nb[k];
      if (j < 0 || owner[j] !== n || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      q[tail++] = j;
    }
  }
  // Rest nach Abtragung: Felder mit Abstand > depth oder ohne Abstand (weit weg).
  // Die abgetragenen Felder werden kurz mit 255 markiert und danach zurückgesetzt.
  const eroded = sim._aiEroded || (sim._aiEroded = new Int32Array(N));
  const saved = [];
  for (const i of cells) if (dist[i] >= 0 && dist[i] <= depth) { saved.push(i); owner[i] = 255; }
  const comps = components(sim, n, eroded);
  for (const i of saved) owner[i] = n;
  const threatened = new Set();
  if (!comps.length) return threatened;
  let core = comps[0];
  for (const c of comps) if (c.cells.length > core.cells.length) core = c;
  // Abstand zum abgetragenen Kernland
  const dCore = sim._aiCore || (sim._aiCore = new Int16Array(N));
  for (const i of cells) dCore[i] = -1;
  head = 0;
  tail = 0;
  for (const i of core.cells) { dCore[i] = 0; q[tail++] = i; }
  while (head < tail) {
    const i = q[head++];
    if (dCore[i] > depth + 3) continue;
    for (let k = i * 4, e = k + 4; k < e; k++) {
      const j = nb[k];
      if (j < 0 || owner[j] !== n || dCore[j] >= 0) continue;
      dCore[j] = dCore[i] + 1;
      q[tail++] = j;
    }
  }
  for (const f of fronts) {
    if (f.encircled[n]) continue;
    let near = false;
    for (const c of sim.frontCellsOf(f, n)) {
      if (dCore[c] >= 0 && dCore[c] <= depth + 2) { near = true; break; }
    }
    if (!near) threatened.add(f.id);
  }
  return threatened;
}

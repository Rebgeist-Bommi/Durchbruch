// Kriegsende: Kessel, Belagerung von Groß- und Hauptstädten, Kapitulation.
import { neighbors4 } from './combat.js';
import { fmtInt } from './calendar.js';
import { transferStocks } from './economy.js';
import { capitulationBonus, changeMorale } from './morale.js';
import { applyPartition } from './events.js';
import { alliesOf } from './diplomacy.js';

/**
 * Zusammenhangskomponenten (4er-Nachbarschaft) der Felder einer Nation im Suchbereich.
 * `mark` wird nicht geleert: Kennungen sind fortlaufend (sim._compSeq), alles kleiner als die
 * erste Kennung dieses Aufrufs gilt als unbesucht.
 */
export function components(sim, n, mark) {
  const comps = [];
  const q = sim._q || (sim._q = new Int32Array(sim.N));
  const base = (sim._compSeq || 0) + 1;
  const nb = sim.nb;
  const owner = sim.owner;
  const [r0, r1, c0, c1] = sim.nationRange ? sim.nationRange(n) : sim.boxRange();
  for (let r = r0; r <= r1; r++) {
    for (let i = r * sim.cols + c0, e = r * sim.cols + c1; i <= e; i++) {
      if (owner[i] !== n || mark[i] >= base) continue;
      const id = base + comps.length;
      let head = 0;
      let tail = 0;
      q[tail++] = i;
      mark[i] = id;
      const cells = [];
      while (head < tail) {
        const x = q[head++];
        cells.push(x);
        for (let k = x * 4, ke = k + 4; k < ke; k++) {
          const j = nb[k];
          if (j < 0 || mark[j] >= base || owner[j] !== n) continue;
          mark[j] = id;
          q[tail++] = j;
        }
      }
      comps.push({ id, cells });
    }
  }
  sim._compSeq = base + comps.length;
  return comps;
}

/** Kernland = größte zusammenhängende Fläche (eine eingeschlossene Hauptstadt ist ein Kessel). */
function coreComponent(sim, n, comps) {
  let best = comps[0];
  for (const c of comps) if (c.cells.length > best.cells.length) best = c;
  return best;
}

/** Vor Kriegsbeginn abgetrennte Landesteile (z. B. Ostpreußen) sind keine Kessel. */
export function markExclaves(sim, only = null) {
  if (!sim.exclave) sim.exclave = new Map();
  const mark = new Int32Array(sim.N);
  for (const n of sim.nations.keys()) {
    if (only && !only.includes(n)) continue;
    const comps = components(sim, n, mark);
    const ex = new Uint8Array(sim.N);
    if (comps.length) {
      const core = coreComponent(sim, n, comps);
      for (const c of comps) if (c !== core) for (const i of c.cells) ex[i] = 1;
    }
    sim.exclave.set(n, ex);
  }
}

function occupierOf(sim, n, cells) {
  const count = sim._occCount || (sim._occCount = new Int32Array(256));
  count.fill(0);
  const nb = sim.nb;
  const owner = sim.owner;
  for (const i of cells) {
    for (let k = i * 4, e = k + 4; k < e; k++) {
      const j = nb[k];
      if (j < 0) continue;
      const o = owner[j];
      if (o && o !== n && sim.isWar(o, n)) count[o]++;
    }
  }
  let best = 0;
  for (let o = 1; o < 256; o++) if (count[o] > count[best]) best = o;
  return count[best] ? best : 0;
}

export function resolveSieges(sim) {
  const S = sim.bal.siege;
  for (const f of sim.fronts.values()) for (const n of [f.a, f.b]) if (f.side[n]) f.side[n].tied = 0;
  for (const s of sim.sieges) {
    if (s.fallen) continue;
    const c = s.cell;
    if (sim.owner[c] !== s.nation) { s.fallen = true; continue; }
    if (!sim.enemiesOf(s.nation).length) continue;
    let by = 0;
    for (const j of neighbors4(sim, c)) {
      if (j < 0) continue;
      const o = sim.owner[j];
      if (o && o !== s.nation && sim.isWar(o, s.nation)) { by = o; break; }
    }
    if (!by) { s.besieged = false; continue; }
    if (!s.besieged) {
      s.besieged = true;
      if (s.since < 0) s.since = sim.day;
      s.by = by;
      sim.log('siege', `Belagerung von ${s.city.name} beginnt.`, c);
    }
    // Belagerung bindet Truppen: zuerst von der Front an der Stadt, dann von den nächsten Fronten
    const need = s.capital ? S.bindDivisionsCapital : S.bindDivisionsCity;
    const here = sim.frontAt(c);
    const col = c % sim.cols;
    const row = Math.floor(c / sim.cols);
    const fronts = [...sim.fronts.values()]
      .filter((f) => f.alive && !f.planned && f.side[by])
      .sort((x, y) => (x === here ? -1 : y === here ? 1 : (x.cx - col) ** 2 + (x.cy - row) ** 2 - ((y.cx - col) ** 2 + (y.cy - row) ** 2)) || x.id - y.id);
    let bound = 0;
    let airSum = 0;
    for (const f of fronts) {
      if (bound >= need) break;
      const st = sim.sideStrength(f.id, by);
      const take = Math.min(need - bound, Math.max(0, st.str - f.side[by].tied));
      if (take <= 0) continue;
      f.side[by].tied += take;
      bound += take;
      airSum += take * st.air;
    }
    const ratio = bound / need;
    const air = bound ? airSum / bound : 0;
    s.boundDivisions = bound;
    s.defense -= S.damagePerDay * ratio * (1 + S.airDamageBonus * air);
    if (s.defense <= 0) {
      s.defense = 0;
      const days = sim.day - s.since;
      sim.log('city', `${s.city.name} ergibt sich nach ${days} Tagen Belagerung.`, c);
      sim.setOwner(c, by, 1, true);
    }
  }
}

export function resolvePockets(sim) {
  const P = sim.bal.pocket;
  if (!sim.exclave) markExclaves(sim);
  if (!sim.pocketMark) { sim.pocketMark = new Map(); sim._pocketCells = new Map(); }
  if (!sim._compMark) sim._compMark = new Int32Array(sim.N);
  const cm = sim._compMark;
  for (const n of [...sim.nations.keys()].sort((x, y) => x - y)) {
    const st = sim.nations.get(n);
    let flag = sim.pocketMark.get(n);
    if (!flag) { flag = new Uint8Array(sim.N); sim.pocketMark.set(n, flag); }
    for (const i of sim._pocketCells.get(n) || []) flag[i] = 0; // Markierung des Vortags löschen
    const flagged = [];
    const hadPockets = (sim._pocketCells.get(n) || []).length > 0;
    sim._pocketCells.set(n, flagged);
    if (st.status !== 'aktiv' || !sim.enemiesOf(n).length) continue;
    // Leistung: Ohne Gebietsverlust (und ohne Kriegsänderung) seit gestern und ohne offene Kessel
    // ändert sich nichts – die Zerlegung des Gebiets wäre dieselbe wie am Vortag.
    if (!hadPockets && st.lastLossDay !== undefined && st.lastLossDay < sim.day - 1) continue;
    const comps = components(sim, n, cm);
    if (comps.length < 2) {
      for (const c of comps) for (const i of c.cells) sim.pocketSince[i] = -1;
      continue;
    }
    const core = coreComponent(sim, n, comps);
    const ex = sim.exclave.get(n);
    for (const i of core.cells) sim.pocketSince[i] = -1;
    for (const comp of comps) {
      if (comp === core) continue;
      if (comp.cells.some((i) => ex[i])) continue;
      const enemy = occupierOf(sim, n, comp.cells);
      if (!enemy) continue;
      let since = sim.day;
      let siegeOpen = false;
      let sx = 0;
      let sy = 0;
      for (const i of comp.cells) {
        if (sim.pocketSince[i] < 0) sim.pocketSince[i] = sim.day;
        since = Math.min(since, sim.pocketSince[i]);
        const sg = sim.siegeAt[i];
        if (sg >= 0 && !sim.sieges[sg].fallen) siegeOpen = true;
        sx += i % sim.cols;
        sy += Math.floor(i / sim.cols);
        flag[i] = 1;
        flagged.push(i);
      }
      const size = comp.cells.length;
      const where = sim.nearestCityName(sx / size, sy / size, 4, n);
      if (!siegeOpen && size <= P.instantCells) {
        for (const i of comp.cells) sim.setOwner(i, enemy, 1);
        continue;
      }
      if (since === sim.day && size >= P.messageMinCells) {
        sim.log('pocket', `Kessel bei ${where} geschlossen (${size} Felder, ca. ${fmtInt(size * 81)} km²).`, comp.cells[0]);
      }
      if (siegeOpen) continue; // Kessel mit belagerter Stadt hält, bis die Stadt fällt
      const days = P.surrenderBaseDays + (P.surrenderDaysPer100Cells * size) / 100;
      if (sim.day - since < days) continue;
      surrender(sim, n, enemy, comp, cm, where);
    }
  }
}

function surrender(sim, n, enemy, comp, mark, where) {
  let men = 0;
  let count = 0;
  for (const f of sim.fronts.values()) {
    if (!f.alive || f.planned || !f.side[n]) continue;
    const cells = sim.frontCellsOf(f, n);
    const inside = cells.filter((c) => mark[c] === comp.id).length;
    if (!cells.length || inside * 2 <= cells.length) continue;
    for (const d of sim.divisionsOn(f.id, n)) {
      men += d.men;
      count++;
      // erbeutete Ausrüstung (Anteil nach Vorgehen des Eroberers)
      const share = sim.bal.economy.conquest[sim.dominantMethod(enemy) === 2 ? 'total' : 'minimal'].stocks;
      const ce = sim.econ.get(enemy);
      if (ce) ce.equipment += d.equip * share;
      d.men = 0;
    }
    if (f.side[enemy]) f.side[enemy].prisonersTotal += men;
  }
  for (const i of comp.cells) sim.setOwner(i, enemy, 1, true);
  sim.nations.get(enemy).prisonersTaken += men;
  sim.nations.get(n).menLostAsPrisoners += men;
  changeMorale(sim, enemy, sim.bal.morale.pocketGain);
  changeMorale(sim, n, -sim.bal.morale.pocketLoss);
  const divText = count ? `${count} Divisionen ergeben sich, ca. ${fmtInt(Math.round(men / 1000) * 1000)} Gefangene` : 'kaum Gegenwehr';
  sim.log('pocket', `Kessel bei ${where} aufgerieben: ${divText}.`, comp.cells[0]);
}

export function checkCapitulation(sim) {
  const C = sim.bal.capitulation;
  for (const [n, st] of sim.nations) {
    if (st.status !== 'aktiv') continue;
    const enemies = sim.enemiesOf(n);
    if (!enemies.length) continue;
    const cap = sim.capital.get(n);
    const capLost = cap === undefined || sim.owner[cap] !== n;
    const lost = 1 - sim.ownedCount[n] / st.startCells;
    st.lostShare = lost;
    // Phase 5: hohe Moral schiebt die Kapitulationsschwelle hinaus
    if ((C.requireCapital && !capLost) || lost < C.lostShare + capitulationBonus(sim, n)) continue;
    // Kapitulation: Restgebiet wird besetzt (vereinbarte Teilungslinie oder nächster Gegner),
    // verbliebene Truppen gehen in Gefangenschaft
    const occ = mainEnemy(sim, n, enemies);
    if (!applyPartition(sim, n)) assignRemainder(sim, n, enemies, occ);
    transferStocks(sim, n, occ, sim.dominantMethod(occ));
    let men = 0;
    for (const d of sim.divisions) if (d.nation === n) { men += d.men; d.men = 0; }
    sim.nations.get(occ).prisonersTaken += men;
    st.menLostAsPrisoners += men;
    st.status = 'kapituliert';
    st.capitulationDay = sim.day;
    const warDays = sim.day - Math.max(0, st.warSince ?? 0);
    sim.log('capitulation', `${sim.nationName(n)} kapituliert am ${sim.dateText()} – nach ${warDays} Tagen Krieg. ${fmtInt(Math.round(men / 1000) * 1000)} Soldaten gehen in Gefangenschaft.`);
    const M = sim.bal.morale;
    for (const e of enemies) changeMorale(sim, e, M.capitulationGain);
    if (sim.dip) for (const x of alliesOf(sim, n)) if (x !== occ) changeMorale(sim, x, -M.allyCapitulationLoss);
    for (const e of enemies) sim.endWar(n, e);
  }
}

/** Gegner mit den meisten eroberten Feldern der Nation (erhält Bestände und Gefangene). */
function mainEnemy(sim, n, enemies) {
  if (enemies.length === 1) return enemies[0];
  const cnt = new Map(enemies.map((e) => [e, 0]));
  forBox(sim, n, (i) => { if (sim.startOwner[i] === n && cnt.has(sim.owner[i])) cnt.set(sim.owner[i], cnt.get(sim.owner[i]) + 1); });
  return [...cnt].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

/** Restgebiet an den nächstgelegenen Gegner (Breitensuche von dessen Feldern aus). */
function assignRemainder(sim, n, enemies, occ) {
  if (enemies.length === 1) {
    const m = sim.dominantMethod(occ);
    forBox(sim, n, (i) => { if (sim.owner[i] === n) sim.setOwner(i, occ, m, true); });
    return;
  }
  const to = new Uint8Array(sim.N);
  const q = [];
  const isEnemy = new Set(enemies);
  forBox(sim, n, (i) => {
    if (sim.owner[i] !== n) return;
    for (const j of neighbors4(sim, i)) {
      if (j >= 0 && isEnemy.has(sim.owner[j]) && !to[i]) { to[i] = sim.owner[j]; q.push(i); }
    }
  });
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (const j of neighbors4(sim, i)) {
      if (j >= 0 && sim.owner[j] === n && !to[j]) { to[j] = to[i]; q.push(j); }
    }
  }
  forBox(sim, n, (i) => {
    if (sim.owner[i] !== n) return;
    const o = to[i] || occ;
    sim.setOwner(i, o, sim.dominantMethod(o), true);
  });
}

/** Alle Felder im Suchrechteck einer Nation (enthält alle ihre Felder; Startgebiet: Stichtagsbesitz). */
function forBox(sim, n, fn) {
  const [r0, r1, c0, c1] = sim.nationRange(n);
  for (let r = r0; r <= r1; r++) for (let i = r * sim.cols + c0, e = r * sim.cols + c1; i <= e; i++) fn(i);
}

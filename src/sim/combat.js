// Kampf und feldweiser Vormarsch.
// Jedes gegnerische Grenzfeld kann pro Tick fallen. Die Chance hängt ab von Kräfteverhältnis im
// Abschnitt, Gelände, Befestigung, Angriffsvorbereitung, Luftanteil, Nachschub, Vorgehen und Zufall.
// Bei hoher Überlegenheit stoßen Truppen im selben Tick weiter vor (bis zu `substeps` Felder tief).
import { KM_PER_CELL } from './constants.js';
import { mods } from './research.js';
import { traitOf } from './generals.js';
import { moraleCombat } from './morale.js';
import { noteAttack } from './diplomacy.js';
import { ensureSupply, railSupply } from './infra.js';
import { effectSum } from './events.js';

/** Land-Nachbarn (N, O, S, W) eines Feldes, -1 = keiner. Liefert eine Ansicht, kein neues Array. */
function neighbors4(sim, i) {
  return sim.nb.subarray(i * 4, i * 4 + 4);
}

function countOwned(sim, i, n) {
  const nb = sim.nb;
  const o = sim.owner;
  let k = 0;
  for (let q = i * 4, e = q + 4; q < e; q++) if (nb[q] >= 0 && o[nb[q]] === n) k++;
  return k;
}

export function applyLosses(sim, frontId, n, men) {
  if (men <= 0) return;
  const divs = sim.divisionsOn(frontId, n);
  const total = divs.reduce((s, d) => s + d.men, 0);
  if (total <= 0) return;
  const k = Math.min(1, men / total);
  for (const d of divs) {
    d.men -= d.men * k;
    if (d.equip !== undefined) d.equip -= d.equip * k; // Ausrüstung geht mit verloren
  }
}

export function resolveCombat(sim) {
  const fronts = [...sim.fronts.values()].filter((f) => f.alive).sort((x, y) => x.id - y.id);
  for (const f of fronts) {
    for (const n of [f.a, f.b]) {
      const s = f.side[n];
      s.lossesToday = 0;
      s.prisonersToday = 0;
      s.airToday = 0;
      s.kmToday = 0;
    }
    for (const sec of f.sections) {
      sec.stats.km = {};
      sec.stats.captured = {};
    }
  }
  for (const f of fronts) {
    for (const n of [f.a, f.b]) {
      if (f.side[n].order !== 'attack') continue;
      const o = sim.enemyOn(f, n);
      if (!sim.isWar(n, o)) continue;
      attackFront(sim, f, n, o);
    }
  }
}

function attackFront(sim, f, n, o) {
  const C = sim.bal.combat;
  const O = sim.bal.orders;
  const side = f.side[n];
  const A = sim.sideStrength(f.id, n);
  const D = sim.sideStrength(f.id, o);
  const strEff = Math.max(0, A.str - side.tied);
  if (strEff <= 0.05) return;
  noteAttack(sim, n, o); // Phase 5: erster Angriff löst Bündnispflichten aus
  ensureSupply(sim, n); // Nachschub des Angreifers (einmal je Tag)

  const targetsOf = (sec) => (o === f.b ? sec.cellsB : sec.cellsA);
  let totalT = 0;
  let totalW = 0;
  for (const sec of f.sections) {
    const nT = targetsOf(sec).length;
    totalT += nT;
    totalW += sec.stats.defWeight[o] ?? nT;
  }
  if (!totalT) return;
  const method = sim.bal.methods[side.method];
  const T = tacticOf(sim, f, n, A);
  const methodCode = side.method === 'total' ? 2 : 1;
  // Phase 4: Forschung (Nation) und Generalseigenschaft (Front)
  const mA = mods(sim, n);
  const mD = mods(sim, o);
  const gA = traitOf(sim, f, n);
  const gD = traitOf(sim, f, o);
  const prepMul = 1 + (O.prepMaxBonus + (gA.prepMax || 0)) * side.prep;
  const airFront = A.air * (1 - (side.airShare || 0)); // für Luftangriffe abgestellter Anteil fehlt an der Front
  const airDefD = D.air * (1 - (f.side[o].airShare || 0));
  const airMul = Math.max(0.3, 1 + C.airBonus * T.air * airFront * (1 + mA.air + effectSum(sim, n, 'air')) - C.airDefense * airDefD * (1 + mD.airDefense));
  const attMul = T.attack * (1 + mA.attack) * (1 + (gA.odds || 0)) * moraleCombat(sim, n);
  const defMul = (1 + mD.defense) * (1 + (gD.defense || 0)) * moraleCombat(sim, o);
  const tankMul = T.tank * (1 + mA.tank + effectSum(sim, n, 'tank')) * (1 + (gA.tank || 0));
  const supplyBonus = gA.supply || 0;
  const encMul = f.encircled[o] ? C.encircledDefense : 1;

  const info = f.sections.map((sec) => {
    const nT = targetsOf(sec).length;
    const a = (strEff * nT) / totalT;
    const d = (D.str * (sec.stats.defWeight[o] ?? nT)) / (totalW || 1);
    const floor = C.defenseFloorPerCell * nT;
    const R = (a * prepMul * airMul * attMul) / ((d + floor) * encMul * defMul);
    return { sec, nT, a, d, R, Rx: Math.pow(R, C.ratioExponent), captured: 0 };
  });

  // Angriffsziel (Haltelinie): nur Felder diesseits der Linie
  const allowed = objectiveMask(sim, f, n, o);
  // Kandidaten der ersten Welle: alle gegnerischen Grenzfelder der Front
  let cand = [];
  info.forEach((it, si) => {
    for (const cell of targetsOf(it.sec)) if (!allowed || allowed[cell]) cand.push(cell, si);
  });
  if (allowed && !cand.length) {
    // Linie erreicht: Front geht zum Halten über
    side.order = 'hold';
    sim.log('info', `${f.name}: Haltelinie erreicht, die Truppen graben sich ein.`, Math.round(f.cy) * sim.cols + Math.round(f.cx));
    return;
  }
  if (!sim._seen || sim._seen.length !== sim.N) sim._seen = new Int32Array(sim.N);
  const steps = Math.max(1, C.substeps + T.substeps);
  const exploit = Math.min(0.9, C.exploitFactor * T.exploit);
  for (let k = 0; k < steps && cand.length; k++) {
    const wave = Math.pow(exploit, k);
    const fall = [];
    for (let q = 0; q < cand.length; q += 2) {
      const cell = cand[q];
      const si = cand[q + 1];
      if (sim.owner[cell] !== o) continue;
      const sg = sim.siegeAt[cell];
      if (sg >= 0 && !sim.sieges[sg].fallen) continue; // Großstädte werden belagert, nicht überrannt
      const nA = countOwned(sim, cell, n);
      if (!nA) continue;
      const mountain = sim.terrain[cell] === 1;
      let odds = info[si].Rx * C.neighborFactor[nA] * (nA >= 2 ? T.pincer : 1);
      if (mountain) odds *= C.mountainFactor;
      odds *= 1 + C.tankBonus * A.tank * tankMul * (mountain ? C.tankMountainFactor : 1);
      odds /= 1 + O.fortBonus * sim.fort[cell];
      odds *= Math.pow(Math.min(1, railSupply(sim, n, cell) + supplyBonus), T.supplyExp);
      odds *= method.speed * T.speed * wave;
      const noise = 1 + (sim.rng() - 0.5) * 2 * C.noise;
      const p = Math.min(C.maxChance, 1 - Math.exp(-C.baseRate * odds * noise));
      if (sim.rng() < p) fall.push(cell, si);
    }
    const next = [];
    const stamp = sim.day * 8 + k + 1;
    for (let q = 0; q < fall.length; q += 2) {
      const cell = fall[q];
      if (sim.owner[cell] !== o) continue;
      sim.setOwner(cell, n, methodCode);
      info[fall[q + 1]].captured++;
    }
    for (let q = 0; q < fall.length; q += 2) {
      for (let t = fall[q] * 4, e = t + 4; t < e; t++) {
        const j = sim.nb[t];
        if (j < 0 || sim.owner[j] !== o || sim._seen[j] === stamp || (allowed && !allowed[j])) continue;
        sim._seen[j] = stamp;
        next.push(j, fall[q + 1]);
      }
    }
    cand = next;
  }

  // Abschnittsergebnisse, Verluste, Gefangene, Lufteinsätze
  const men = sim.bal.divisions.menPerDivision;
  let attLoss = 0;
  let defLoss = 0;
  let prisoners = 0;
  let kmWeighted = 0;
  for (const it of info) {
    const km = (it.captured / Math.max(1, it.nT)) * KM_PER_CELL;
    const st = it.sec.stats;
    st.km[n] = km;
    st.captured[n] = it.captured;
    st.kmTotal[n] = (st.kmTotal[n] || 0) + km;
    st.danger[o] = km;
    st.status[n] = km >= C.statusBreakthroughKm ? 'Durchbruch' : km >= C.statusAdvanceKm ? 'Vormarsch' : 'festgefahren';
    kmWeighted += km * it.nT;
    if (it.a <= 0) continue;
    const R = Math.max(0.05, it.R);
    attLoss += (C.lossAttacker * it.a * men / Math.sqrt(R)) * (1 + (gA.lossAtt || 0)) * T.lossAtt;
    if (it.d > 0) {
      const dl = C.lossDefender * it.d * men * Math.sqrt(R) * T.lossDef;
      defLoss += dl;
      const share = Math.min(C.prisonerMax, Math.max(0, C.prisonerBase + C.prisonerPerRatio * (R - 1)));
      prisoners += dl * share;
    }
  }
  side.kmToday = kmWeighted / totalT;
  side.kmTotal += side.kmToday;
  applyLosses(sim, f.id, n, attLoss);
  applyLosses(sim, f.id, o, defLoss);
  side.lossesToday += attLoss;
  side.lossesTotal += attLoss;
  f.side[o].lossesToday += defLoss;
  f.side[o].lossesTotal += defLoss;
  side.prisonersToday += prisoners;
  side.prisonersTotal += prisoners;
  const air = sim.divisionsOn(f.id, n).reduce((s, d) => s + d.air * (d.men / d.maxMen), 0) * C.airMissionsPerDivision;
  side.airToday += air;
  side.airTotal += air;
  const sn = sim.nations.get(n);
  const so = sim.nations.get(o);
  sn.lossesTotal += attLoss;
  so.lossesTotal += defLoss;
  sn.prisonersTaken += prisoners;
  so.menLostAsPrisoners += prisoners;
  sn.airTotal += air;
  sn.airToday = (sn.airToday || 0) + air;
}

/**
 * Haltelinie einer Front (Überarbeitung 2): `side.objective = {line: [[col, row], …]}`. Die Linie
 * wird gerastert und an beiden Enden in Laufrichtung verlängert, bis sie gegnerisches Gebiet
 * verlässt. Erlaubt sind alle gegnerischen Felder, die von der Front aus ohne Überqueren der
 * Linie erreichbar sind, und die Linienfelder selbst. Ohne Ziel: null (ganzes Land).
 */
export function objectiveMask(sim, f, n, o) {
  const obj = f.side[n].objective;
  if (!obj || !obj.line || obj.line.length < 2) return null;
  const { cols, rows } = sim;
  const line = barrierCells(sim, obj.line, o);
  const mark = new Uint8Array(sim.N); // 1 = Linie, 2 = erlaubt
  for (const c of line) mark[c] = 1;
  const q = [];
  for (const sec of f.sections) for (const c of o === f.b ? sec.cellsB : sec.cellsA) {
    if (mark[c] === 1) { q.push(c); mark[c] = 3; continue; }
    if (!mark[c]) { mark[c] = 2; q.push(c); }
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    if (mark[i] === 3) continue; // Linienfeld: erlaubt, aber nicht weiter
    for (let k = i * 4, e = k + 4; k < e; k++) {
      const j = sim.nb[k];
      if (j < 0 || sim.owner[j] !== o) continue;
      if (mark[j] === 1) { mark[j] = 3; continue; }
      if (mark[j]) continue;
      mark[j] = 2;
      q.push(j);
    }
  }
  const out = new Uint8Array(sim.N);
  for (let i = 0; i < sim.N; i++) if (mark[i] >= 2) out[i] = 1;
  void cols; void rows;
  return out;
}

/** Felder unter einer Linie (Feldkoordinaten), Enden verlängert bis außerhalb des Gegners. */
export function barrierCells(sim, pts, o) {
  const { cols, rows } = sim;
  const set = new Set();
  const put = (x, y) => {
    const c = Math.floor(x);
    const r = Math.floor(y);
    if (c < 0 || r < 0 || c >= cols || r >= rows) return false;
    set.add(r * cols + c);
    // diagonale Lücken schließen: auch das Nachbarfeld rechts
    if (c + 1 < cols) set.add(r * cols + c + 1);
    return true;
  };
  const seg = (x0, y0, x1, y1) => {
    const L = Math.hypot(x1 - x0, y1 - y0);
    const k = Math.max(1, Math.ceil(L / 0.3));
    for (let i = 0; i <= k; i++) put(x0 + ((x1 - x0) * i) / k, y0 + ((y1 - y0) * i) / k);
  };
  for (let i = 0; i + 1 < pts.length; i++) seg(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  const extend = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    for (let s = 0.3; s < 120; s += 0.3) {
      const x = b[0] + (dx / L) * s;
      const y = b[1] + (dy / L) * s;
      if (!put(x, y)) break;
      const c = Math.floor(y) * cols + Math.floor(x);
      if (sim.owner[c] !== o) break;
    }
  };
  extend(pts[1], pts[0]);
  extend(pts[pts.length - 2], pts[pts.length - 1]);
  return set;
}

/**
 * Wirksame Taktik einer angreifenden Seite (Überarbeitung 2). Blitzkrieg wirkt anteilig nach
 * Panzeranteil, Luftunterstützung nach Luftanteil und nur, solange das Geld reicht (Kosten je
 * Division und Tag werden hier abgebucht). Ohne Voraussetzung: ausgewogen.
 */
export function tacticOf(sim, f, n, A = sim.sideStrength(f.id, n), pay = true) {
  const all = sim.bal.tactics;
  const base = all.standard;
  const t = all[f.side[n].tactic] || base;
  if (t === base) return base;
  let k = 1;
  if (t.needTank) k = Math.min(1, A.tank / t.needTank);
  if (t.needAir) k = Math.min(1, A.air / t.needAir);
  if (t.moneyPerDivDay && pay) {
    const e = sim.econ.get(n);
    const cost = t.moneyPerDivDay * A.count;
    if (!e || (e.money < cost && !sim.settings?.sandbox)) k = 0;
    else { e.money -= cost; e.spentToday = (e.spentToday || 0) + cost; }
  }
  if (k <= 0) return base;
  const mix = (key) => base[key] + (t[key] - base[key]) * k;
  return {
    attack: mix('attack'), tank: mix('tank'), air: mix('air'), substeps: Math.round(mix('substeps')), exploit: mix('exploit'),
    speed: mix('speed'), lossAtt: mix('lossAtt'), lossDef: mix('lossDef'), supplyExp: mix('supplyExp'), pincer: mix('pincer'), k,
  };
}

/** Vorbereitung und Befestigung wachsen über die Zeit. */
export function updateOrdersOverTime(sim) {
  const O = sim.bal.orders;
  for (const f of sim.fronts.values()) {
    if (!f.alive) continue;
    for (const n of [f.a, f.b]) {
      // Aufmarsch: nur der Planende bereitet vor; die Gegenseite reagiert erst im Krieg
      if (f.planned && !sim.plansAgainst(n, sim.enemyOn(f, n))) continue;
      const s = f.side[n];
      const g = traitOf(sim, f, n);
      if (s.order === 'prepare') s.prep = Math.min(1, s.prep + (1 + (g.prepSpeed || 0)) / O.prepDays);
      else if (s.order === 'attack') s.prep = Math.max(0, s.prep - O.prepDecayPerDay * ((sim.bal.tactics[s.tactic] || {}).prepDecay || 1));
      else s.prep = Math.max(0, s.prep - O.prepDecayPerDay / 2);
      const fortifies = s.order === 'hold' || (!O.fortHoldOnly && s.order === 'prepare');
      if (!fortifies) continue;
      for (const sec of f.sections) {
        for (const c of n === f.b ? sec.cellsB : sec.cellsA) sim.fort[c] = Math.min(1, sim.fort[c] + (1 + (g.fort || 0)) / O.fortDays);
      }
    }
  }
}

export { neighbors4 };

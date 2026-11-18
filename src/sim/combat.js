// Kampf und feldweiser Vormarsch.
// Jedes gegnerische Grenzfeld kann pro Tick fallen. Die Chance hängt ab von Kräfteverhältnis im
// Abschnitt, Gelände, Befestigung, Angriffsvorbereitung, Luftanteil, Nachschub, Vorgehen und Zufall.
// Bei hoher Überlegenheit stoßen Truppen im selben Tick weiter vor (bis zu `substeps` Felder tief).
import { KM_PER_CELL } from './constants.js';
import { mods } from './research.js';
import { traitOf } from './generals.js';

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
  const methodCode = side.method === 'total' ? 2 : 1;
  // Phase 4: Forschung (Nation) und Generalseigenschaft (Front)
  const mA = mods(sim, n);
  const mD = mods(sim, o);
  const gA = traitOf(sim, f, n);
  const gD = traitOf(sim, f, o);
  const prepMul = 1 + (O.prepMaxBonus + (gA.prepMax || 0)) * side.prep;
  const airFront = A.air * (1 - (side.airShare || 0)); // für Luftangriffe abgestellter Anteil fehlt an der Front
  const airDefD = D.air * (1 - (f.side[o].airShare || 0));
  const airMul = Math.max(0.3, 1 + C.airBonus * airFront * (1 + mA.air) - C.airDefense * airDefD * (1 + mD.airDefense));
  const attMul = (1 + mA.attack) * (1 + (gA.odds || 0));
  const defMul = (1 + mD.defense) * (1 + (gD.defense || 0));
  const tankMul = (1 + mA.tank) * (1 + (gA.tank || 0));
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

  // Kandidaten der ersten Welle: alle gegnerischen Grenzfelder der Front
  let cand = [];
  info.forEach((it, si) => {
    for (const cell of targetsOf(it.sec)) cand.push(cell, si);
  });
  if (!sim._seen || sim._seen.length !== sim.N) sim._seen = new Int32Array(sim.N);
  for (let k = 0; k < C.substeps && cand.length; k++) {
    const wave = Math.pow(C.exploitFactor, k);
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
      let odds = info[si].Rx * C.neighborFactor[nA];
      if (mountain) odds *= C.mountainFactor;
      odds *= 1 + C.tankBonus * A.tank * tankMul * (mountain ? C.tankMountainFactor : 1);
      odds /= 1 + O.fortBonus * sim.fort[cell];
      odds *= Math.min(1, sim.supply(n, cell) + supplyBonus);
      odds *= method.speed * wave;
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
        if (j < 0 || sim.owner[j] !== o || sim._seen[j] === stamp) continue;
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
    attLoss += (C.lossAttacker * it.a * men / Math.sqrt(R)) * (1 + (gA.lossAtt || 0));
    if (it.d > 0) {
      const dl = C.lossDefender * it.d * men * Math.sqrt(R);
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

/** Vorbereitung und Befestigung wachsen über die Zeit. */
export function updateOrdersOverTime(sim) {
  const O = sim.bal.orders;
  for (const f of sim.fronts.values()) {
    if (!f.alive) continue;
    for (const n of [f.a, f.b]) {
      const s = f.side[n];
      const g = traitOf(sim, f, n);
      if (s.order === 'prepare') s.prep = Math.min(1, s.prep + (1 + (g.prepSpeed || 0)) / O.prepDays);
      else if (s.order === 'attack') s.prep = Math.max(0, s.prep - O.prepDecayPerDay);
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

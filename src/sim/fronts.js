// Fronten entstehen automatisch an jeder Grenze zwischen Kriegsgegnern.
// Grundlage sind Kontaktkanten (gemeinsame Feldkante zweier verfeindeter Felder).
// Eine Front = zusammenhängende Kette solcher Kanten (über gemeinsame Eckpunkte).
// Identität über Ticks: Mehrheitsentscheid über die Front-Kennung der beteiligten Felder.
import { NMAX } from './constants.js';

function emptySide() {
  return {
    order: 'hold', prep: 0, method: 'minimal', attackStartDay: -1, attackPrep: 0,
    lossesToday: 0, lossesTotal: 0, prisonersToday: 0, prisonersTotal: 0,
    airToday: 0, airTotal: 0, tied: 0, kmToday: 0, kmTotal: 0,
  };
}

function inheritSide(p) {
  const s = emptySide();
  if (p) {
    s.order = p.order;
    s.prep = p.prep;
    s.method = p.method;
    s.attackStartDay = p.attackStartDay;
    s.attackPrep = p.attackPrep;
  }
  return s;
}

function ensureEdgeArrays(sim, cap) {
  if (sim.edges && sim.edges.a.length >= cap) return;
  sim.edges = {
    a: new Int32Array(cap), b: new Int32Array(cap), dir: new Uint8Array(cap),
    front: new Int32Array(cap), count: 0,
  };
}

export function updateFronts(sim) {
  const { cols, rows, owner, N } = sim;
  const V = (cols + 1) * (rows + 1);
  if (!sim._uf) {
    sim._uf = { parent: new Int32Array(V), stamp: new Int32Array(V), cur: 0 };
    sim._mark = { a: new Int32Array(N), stamp: 0 };
  }
  ensureEdgeArrays(sim, 65536);
  const E = sim.edges;
  E.count = 0;

  // Kriegspaar je Nationspaar: Index in sim.wars (+1), Vorzeichen = Reihenfolge
  const pairIdx = new Int16Array(NMAX * NMAX);
  sim.wars.forEach(([a, b], w) => {
    pairIdx[a * NMAX + b] = w + 1;
    pairIdx[b * NMAX + a] = -(w + 1);
  });
  const edgeWar = sim._edgeWar && sim._edgeWar.length >= E.a.length ? sim._edgeWar : (sim._edgeWar = new Int16Array(E.a.length));
  // Suchbereich: Rechteck um alle Felder kriegführender Nationen (laufend in sim.box geführt)
  const inWar = sim.inWar;
  const [R0, R1, C0, C1] = sim.boxRange();
  const r0 = R0 + 1;
  const r1 = R1 - 1;
  const c0 = C0 + 1;
  const c1 = C1 - 1;
  for (let r = Math.max(0, r0 - 1); r <= Math.min(rows - 1, r1 + 1); r++) {
    for (let c = Math.max(0, c0 - 1); c <= Math.min(cols - 1, c1 + 1); c++) {
      const i = r * cols + c;
      const o = owner[i];
      if (!o || !inWar[o]) continue;
      for (let dir = 0; dir < 2; dir++) {
        if (dir === 0 && c >= cols - 1) continue;
        if (dir === 1 && r >= rows - 1) continue;
        const j = dir === 0 ? i + 1 : i + cols;
        const p = owner[j];
        if (!p || p === o) continue;
        const pi = pairIdx[o * NMAX + p];
        if (!pi) continue;
        const k = E.count++;
        if (pi > 0) { E.a[k] = i; E.b[k] = j; } else { E.a[k] = j; E.b[k] = i; }
        E.dir[k] = dir;
        E.front[k] = 0;
        edgeWar[k] = Math.abs(pi) - 1;
      }
    }
  }

  const uf = sim._uf;
  const parent = uf.parent;
  const find = (v) => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  // Eckpunkte einer Kante: v1 und v1 + off
  const v1Of = (k) => {
    const i = E.a[k] < E.b[k] ? E.a[k] : E.b[k];
    const r = (i / cols) | 0;
    const c = i - r * cols;
    return E.dir[k] === 0 ? r * (cols + 1) + c + 1 : (r + 1) * (cols + 1) + c;
  };
  const offOf = (k) => (E.dir[k] === 0 ? cols + 1 : 1);

  const prevAlive = new Set([...sim.fronts.values()].filter((f) => f.alive).map((f) => f.id));
  const winners = new Map(); // frontId -> comp
  const allComps = [];

  sim.wars.forEach(([a, b], w) => {
    uf.cur++;
    const ks = [];
    for (let k = 0; k < E.count; k++) {
      if (edgeWar[k] !== w) continue;
      ks.push(k);
      const v1 = v1Of(k);
      const v2 = v1 + offOf(k);
      if (uf.stamp[v1] !== uf.cur) { uf.stamp[v1] = uf.cur; parent[v1] = v1; }
      if (uf.stamp[v2] !== uf.cur) { uf.stamp[v2] = uf.cur; parent[v2] = v2; }
      const r1 = find(v1);
      const r2 = find(v2);
      if (r1 !== r2) parent[r1] = r2;
    }
    const byRoot = new Map();
    for (const k of ks) {
      const root = find(v1Of(k));
      if (!byRoot.has(root)) byRoot.set(root, []);
      byRoot.get(root).push(k);
    }
    const comps = [...byRoot.values()].map((edges) => {
      const votes = new Map();
      for (const k of edges) {
        for (const cell of [E.a[k], E.b[k]]) {
          const h = sim.frontHint[cell];
          if (h && prevAlive.has(h)) votes.set(h, (votes.get(h) || 0) + 1);
        }
      }
      return { edges, votes, a, b, war: w, id: 0, parent: 0 };
    });
    // größte Komponenten zuerst; Reihenfolge eindeutig (Kantenzahl, erste Kante)
    comps.sort((x, y) => y.edges.length - x.edges.length || x.edges[0] - y.edges[0]);
    for (const comp of comps) {
      const cand = [...comp.votes.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
      const free = cand.find(([id]) => !winners.has(id));
      if (free) {
        comp.id = free[0];
        winners.set(free[0], comp);
      } else if (cand.length) {
        comp.parent = cand[0][0];
      }
      allComps.push(comp);
    }
  });

  // neue Fronten (Teilung oder Neuentstehung)
  for (const comp of allComps) {
    if (comp.id) continue;
    const parent = comp.parent ? sim.fronts.get(comp.parent) : null;
    const f = {
      id: sim.nextFrontId++, a: comp.a, b: comp.b, name: '', born: sim.day, alive: true,
      encircled: { [comp.a]: false, [comp.b]: false }, sections: [], edgeList: null, cx: 0, cy: 0,
      side: { [comp.a]: inheritSide(parent?.side[comp.a]), [comp.b]: inheritSide(parent?.side[comp.b]) },
    };
    sim.fronts.set(f.id, f);
    comp.id = f.id;
    comp.isNew = true;
  }

  // Geometrie, Abschnitte, Kennungen
  const mk = sim._mark;
  for (const comp of allComps) {
    const f = sim.fronts.get(comp.id);
    f.alive = true;
    mk.stamp++;
    const bySector = new Map();
    let sx = 0;
    let sy = 0;
    for (const k of comp.edges) {
      E.front[k] = f.id;
      const ca = E.a[k];
      const cb = E.b[k];
      sim.frontHint[ca] = f.id;
      sim.frontHint[cb] = f.id;
      sx += ((ca % cols) + (cb % cols)) / 2 + 0.5;
      sy += (Math.floor(ca / cols) + Math.floor(cb / cols)) / 2 + 0.5;
      const sec = sim.sectors.sectorOf[cb];
      let s = bySector.get(sec);
      if (!s) {
        s = { sector: sec, edges: 0, cellsA: [], cellsB: [] };
        bySector.set(sec, s);
      }
      s.edges++;
      if (mk.a[ca] !== mk.stamp) { mk.a[ca] = mk.stamp; s.cellsA.push(ca); }
      if (mk.a[cb] !== mk.stamp) { mk.a[cb] = mk.stamp; s.cellsB.push(cb); }
    }
    f.edgeList = Int32Array.from(comp.edges);
    f.cx = sx / comp.edges.length;
    f.cy = sy / comp.edges.length;
    f.sections = [...bySector.values()].sort((x, y) => x.sector - y.sector);
    for (const s of f.sections) {
      const key = `${f.a}-${f.b}:${s.sector}`;
      let st = sim.sectionStats.get(key);
      if (!st) {
        st = { km: {}, kmTotal: {}, status: {}, captured: {}, defWeight: {}, danger: {} };
        sim.sectionStats.set(key, st);
      }
      s.stats = st;
      s.name = sim.nearestCityName(sim.sectors.cx[s.sector], sim.sectors.cy[s.sector], 4, f.b);
    }
    f.length = comp.edges.length;
    // eingeschlossen, wenn die Mehrzahl der eigenen Kontaktfelder in einem Kessel liegt
    for (const n of [f.a, f.b]) {
      const mark = sim.pocketMark?.get(n);
      let inPocket = 0;
      let total = 0;
      for (const s of f.sections) {
        for (const c of n === f.b ? s.cellsB : s.cellsA) {
          total++;
          if (mark && mark[c] > 0) inPocket++;
        }
      }
      f.encircled[n] = total > 0 && inPocket * 2 > total;
    }
    if (comp.isNew || !f.name) {
      const where = sim.nearestCityName(f.cx, f.cy, 4, f.b);
      f.name = f.encircled[f.b] || f.encircled[f.a] ? `Kessel bei ${where}` : `Front bei ${where}`;
    } else if ((f.encircled[f.b] || f.encircled[f.a]) && !f.name.startsWith('Kessel')) {
      f.name = `Kessel bei ${sim.nearestCityName(f.cx, f.cy, 4, f.b)}`;
    }
  }

  // Teilungen: neue Front erhält anteilig Divisionen der Mutterfront
  for (const comp of allComps) {
    if (!comp.isNew || !comp.parent) continue;
    const parentComp = winners.get(comp.parent);
    const share = parentComp ? comp.edges.length / (comp.edges.length + parentComp.edges.length) : 1;
    for (const n of [comp.a, comp.b]) {
      const divs = sim.divisions.filter((d) => d.nation === n && d.front === comp.parent && !d.transit).sort((x, y) => y.id - x.id);
      const k = Math.round(divs.length * share);
      for (const d of divs.slice(0, k)) d.front = comp.id;
    }
  }

  // verschwundene Fronten: verschmolzen (Mehrheit der Stimmen) oder aufgelöst
  for (const id of prevAlive) {
    if (winners.has(id)) continue;
    const old = sim.fronts.get(id);
    let target = null;
    let best = 0;
    for (const comp of allComps) {
      const v = comp.votes.get(id) || 0;
      if (v > best) { best = v; target = comp; }
    }
    old.alive = false;
    for (const d of sim.divisions) {
      if (d.transit && d.transit.to === id) d.transit.to = target ? target.id : 0;
      if (d.front !== id || d.transit) continue;
      if (target) {
        d.front = target.id;
      } else {
        const nf = sim.nearestFront(d.nation, old.cx, old.cy);
        d.front = 0;
        if (nf) d.transit = { from: id, to: nf, arrive: sim.day + sim.travelDays(id, nf, d.nation), days: 1 };
      }
    }
    if (target) {
      const tf = sim.fronts.get(target.id);
      for (const n of [old.a, old.b]) {
        if (!tf.side[n] || !old.side[n]) continue;
        tf.side[n].lossesTotal += old.side[n].lossesTotal;
        tf.side[n].prisonersTotal += old.side[n].prisonersTotal;
        tf.side[n].airTotal += old.side[n].airTotal;
      }
    }
  }
  // alte, tote Fronten nach einiger Zeit vergessen
  for (const [id, f] of sim.fronts) if (!f.alive && sim.day - f.born > 400) sim.fronts.delete(id);
}

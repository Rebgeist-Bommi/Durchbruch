// Fronten entstehen automatisch an jeder Grenze zwischen Kriegsgegnern.
// Grundlage sind Kontaktkanten (gemeinsame Feldkante zweier verfeindeter Felder).
// Eine Front = zusammenhängende Kette solcher Kanten (über gemeinsame Eckpunkte).
// Identität über Ticks: Mehrheitsentscheid über die Front-Kennung der beteiligten Felder.
// Aufmarsch (Überarbeitung 2): Auch im Frieden kann eine Grenze als Front geplant werden
// (`sim.dip.plans`, Paare [Planer, Ziel]). Solche Fronten tragen `planned = true`: Truppen werden
// dorthin verlegt, die Vorbereitung wächst, gekämpft wird nicht. Bei der Kriegserklärung behält
// die Front ihre Kennung (gleiche Kanten) und damit Divisionen, Vorbereitung und General.
import { NMAX } from './constants.js';

function emptySide() {
  return {
    order: 'hold', prep: 0, method: 'minimal', attackStartDay: -1, attackPrep: 0,
    lossesToday: 0, lossesTotal: 0, prisonersToday: 0, prisonersTotal: 0,
    airToday: 0, airTotal: 0, tied: 0, kmToday: 0, kmTotal: 0,
    // vorab angelegt (gleiche Objektform von Anfang an, vermeidet Deoptimierung)
    general: null, airShare: 0, strikeTarget: null, strikeToday: 0, strikeHits: 0, tactic: 'standard', objective: null, commit: 1, focus: null,
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
    s.tactic = p.tactic || 'standard';
    s.objective = p.objective || null;
    s.commit = p.commit ?? 1;
    s.focus = p.focus || null;
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

  // Kriegs- und Aufmarschpaare: Index in `pairs` (+1), Vorzeichen = Reihenfolge
  const pairs = activePairs(sim);
  const pairIdx = new Int16Array(NMAX * NMAX);
  const inPair = new Uint8Array(NMAX);
  pairs.forEach(([a, b], w) => {
    pairIdx[a * NMAX + b] = w + 1;
    pairIdx[b * NMAX + a] = -(w + 1);
    inPair[a] = 1;
    inPair[b] = 1;
  });
  const edgeWar = sim._edgeWar && sim._edgeWar.length >= E.a.length ? sim._edgeWar : (sim._edgeWar = new Int16Array(E.a.length));
  // Suchbereich (Phase 5, Leistung): nur Grenzfelder (Land-Nachbar mit anderem Besitzer), aufsteigend
  // sortiert – gleiche Reihenfolge wie der frühere Durchlauf über das Rechteck aller Kriegsparteien.
  const inWar = inPair;
  const border = borderCells(sim);
  for (let q = 0; q < border.length; q++) {
    const i = border[q];
    const o = owner[i];
    if (!o || !inWar[o]) continue;
    const r = (i / cols) | 0;
    const c = i - r * cols;
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

  pairs.forEach(([a, b, planned], w) => {
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
      return { edges, votes, a, b, war: w, id: 0, parent: 0, planned: !!planned };
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
      retreatLogged: false, warned: false, planned: comp.planned, reacted: false, reactLogged: false,
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
    // Aufmarsch wird Krieg (oder umgekehrt): gleiche Front, Seiten bleiben erhalten
    f.planned = comp.planned;
    if (f.a !== comp.a) { f.a = comp.a; f.b = comp.b; }
    for (const n of [comp.a, comp.b]) if (!f.side[n]) f.side[n] = emptySide();
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
    if (f.planned) {
      if (comp.isNew || !f.name.startsWith('Grenze')) f.name = `Grenze bei ${sim.nearestCityName(f.cx, f.cy, 4, f.b)}`;
    } else if (comp.isNew || !f.name || f.name.startsWith('Grenze')) {
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

/** Kriegspaare und (nicht im Krieg stehende) Aufmarschpaare [a, b, geplant]. */
function activePairs(sim) {
  const out = sim.wars.map(([a, b]) => [a, b, false]);
  for (const [a, b] of sim.dip?.plans || []) {
    if (sim.isWar(a, b) || !sim.ownedCount[a] || !sim.ownedCount[b]) continue;
    out.push([a, b, true]);
  }
  return out;
}

/** Grenzfeld: Land mit mindestens einem Land-Nachbarn (4er) anderen Besitzers. */
function isBorder(sim, i) {
  const o = sim.owner[i];
  if (!o) return false;
  for (let k = i * 4, e = k + 4; k < e; k++) {
    const j = sim.nb[k];
    if (j >= 0 && sim.owner[j] && sim.owner[j] !== o) return true;
  }
  return false;
}

/**
 * Sortierte Liste der Grenzfelder. Wird nach Besitzwechseln (sim._ownerDirty aus setOwner)
 * örtlich nachgeführt; beim ersten Aufruf oder nach dem Laden vollständig aufgebaut.
 */
export function borderCells(sim) {
  const N = sim.N;
  if (!sim._border || sim._borderOwner !== sim.owner) {
    sim._borderFlag = new Uint8Array(N);
    const list = [];
    for (let i = 0; i < N; i++) if (isBorder(sim, i)) { sim._borderFlag[i] = 1; list.push(i); }
    sim._border = Int32Array.from(list);
    sim._borderOwner = sim.owner;
    sim._ownerDirty = [];
    return sim._border;
  }
  const dirty = sim._ownerDirty;
  if (!dirty || !dirty.length) return sim._border;
  const flag = sim._borderFlag;
  let changed = false;
  for (const c of dirty) {
    for (const i of [c, ...sim.nb.subarray(c * 4, c * 4 + 4)]) {
      if (i < 0) continue;
      const b = isBorder(sim, i) ? 1 : 0;
      if (flag[i] !== b) { flag[i] = b; changed = true; }
    }
  }
  sim._ownerDirty = [];
  if (changed) {
    const list = [];
    // Neuaufbau aus den Markierungen (nur bei Änderungen; Grenzfelder sind wenige Tausend)
    const old = sim._border;
    const seen = new Set();
    for (const i of old) if (flag[i]) { list.push(i); seen.add(i); }
    for (const c of dirty) for (const i of [c, ...sim.nb.subarray(c * 4, c * 4 + 4)]) if (i >= 0 && flag[i] && !seen.has(i)) { list.push(i); seen.add(i); }
    list.sort((x, y) => x - y);
    sim._border = Int32Array.from(list);
  }
  return sim._border;
}

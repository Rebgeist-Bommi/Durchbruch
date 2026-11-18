// Diplomatie (Phase 5, bewusst einfach): Krieg erklären, Bündnis anbieten, Nichtangriffspakt
// anbieten. Beziehungswert je Nationenpaar (−100 … +100). Bündnisse sind Beistandspakte: Wird ein
// Bündnispartner angegriffen, erklären die übrigen Partner dem Angreifer nach `allyDelayDays` den
// Krieg (einmal je Partner; Kriegserklärungen aus Bündnispflicht lösen keine weitere Kette aus).
import { updateFronts, borderCells } from './fronts.js';
import { changeMorale } from './morale.js';
import { runGenerals } from './generals.js';

const key = (a, b) => (a < b ? `${a}-${b}` : `${b}-${a}`);
const clampRel = (v) => Math.max(-100, Math.min(100, v));

export function initDiplomacy(sim) {
  const D = sim.bal.diplomacy;
  const pair = ([x, y]) => { const a = sim.idx(x); const b = sim.idx(y); return a < b ? [a, b] : [b, a]; };
  sim.dip = {
    alliances: D.alliances.map(pair),
    pacts: D.pacts.map(pair),
    wars: {},
    obligations: [],
    scheduled: [],
    breaches: {},
    offers: {},
    noFront: {},
    everEnemies: [],
    flags: {},
    effects: [],
    partition: null,
    plans: [], // Aufmarsch im Frieden: Paare [Planer, Ziel] (Grenzfronten ohne Kampf)
    annexed: [], // friedliche Gebietsänderungen (Szenario, Anschluss) für Darstellung und Speicherstand
  };
  for (const [k, v] of Object.entries(D.relations)) {
    const [x, y] = k.split('-');
    sim.relations[key(sim.idx(x), sim.idx(y))] = v;
  }
  // Kriege laut Szenario: Angreifer ist die erste Nation; Bündnispflichten greifen erst beim
  // ersten tatsächlichen Angriff (Testlauf ohne Angriff: keine Kriegserklärungen)
  for (const [x, y] of sim.bal.scenario.wars) {
    const a = sim.idx(x);
    const b = sim.idx(y);
    sim.dip.wars[key(a, b)] = { aggressor: a, day: 0, attacked: false, obligation: false };
  }
  trackEnemies(sim);
}

export function relation(sim, a, b) {
  return sim.relations[key(a, b)] || 0;
}

export function changeRelation(sim, a, b, d) {
  if (a === b) return;
  const k = key(a, b);
  sim.relations[k] = clampRel((sim.relations[k] || 0) + d);
}

const has = (list, a, b) => list.some(([x, y]) => (x === a && y === b) || (x === b && y === a));
export const isAllied = (sim, a, b) => has(sim.dip.alliances, a, b);
export const hasPact = (sim, a, b) => has(sim.dip.pacts, a, b);
const remove = (list, a, b) => list.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));

export function alliesOf(sim, n) {
  return sim.dip.alliances.filter(([x, y]) => x === n || y === n).map(([x, y]) => (x === n ? y : x));
}

/** Diplomatischer Stand zweier Nationen. */
export function statusOf(sim, a, b) {
  if (sim.isWar(a, b)) return 'krieg';
  if (isAllied(sim, a, b)) return 'buendnis';
  if (hasPact(sim, a, b)) return 'pakt';
  return 'neutral';
}

export const STATUS_LABEL = { krieg: 'Krieg', buendnis: 'Bündnis', pakt: 'Nichtangriffspakt', neutral: 'neutral' };

function active(sim, n) {
  const st = sim.nations.get(n);
  return st ? st.status === 'aktiv' : sim.ownedCount[n] > 0; // kleine Staaten ohne Wirtschaftsmodell
}

function trackEnemies(sim) {
  const ev = sim.dip.everEnemies;
  for (const e of sim.enemiesOf(sim.player)) if (!ev.includes(e)) ev.push(e);
}

/** Vertragsbruch: Vertrag fällt weg, Beziehungen leiden (beim Partner stark, bei allen etwas). */
function breach(sim, a, b) {
  const D = sim.bal.diplomacy;
  const what = isAllied(sim, a, b) ? 'Bündnis' : 'Nichtangriffspakt';
  sim.dip.alliances = remove(sim.dip.alliances, a, b);
  sim.dip.pacts = remove(sim.dip.pacts, a, b);
  sim.dip.breaches[a] = (sim.dip.breaches[a] || 0) + 1;
  changeRelation(sim, a, b, D.breachRelation);
  for (const n of sim.nations.keys()) if (n !== a && n !== b) changeRelation(sim, a, n, D.breachRelationOthers);
  sim.log('treaty', `Vertragsbruch: ${sim.nameNom(a)} kündigt den ${what} mit ${sim.nameDat(b)}.`);
}

/** Grenzbefestigungen (Westwall, Maginot-Linie …) wirken ab Kriegsbeginn an der neuen Front. */
function applyBorderFort(sim, a, b) {
  const extra = (sim.dip.effects || []).filter((x) => x.kind === 'borderFort').map((x) => ({ nation: sim.code(x.nation), against: sim.code(x.against), value: x.value }));
  for (const bf of [...(sim.bal.start.borderFortification || []), ...extra]) {
    const n = sim.idx(bf.nation);
    const o = sim.idx(bf.against);
    if (!((n === a && o === b) || (n === b && o === a))) continue;
    for (const f of sim.fronts.values()) {
      if (!f.alive || !f.side[n] || sim.enemyOn(f, n) !== o) continue;
      for (const c of sim.frontCellsOf(f, n)) sim.fort[c] = Math.max(sim.fort[c], bf.value);
    }
  }
}

/**
 * Kriegserklärung von `a` an `b`. `obligation`: aus Bündnispflicht (löst keine Kette aus).
 * Gibt false zurück, wenn bereits Krieg herrscht oder eine Seite nicht mehr handelt.
 */
export function declareWar(sim, a, b, { obligation = false, text = null } = {}) {
  const D = sim.bal.diplomacy;
  if (a === b || sim.isWar(a, b) || !active(sim, a) || !active(sim, b)) return false;
  if (isAllied(sim, a, b) || hasPact(sim, a, b)) breach(sim, a, b);
  changeRelation(sim, a, b, D.warRelation);
  if (!obligation) for (const n of sim.nations.keys()) if (n !== a && n !== b) changeRelation(sim, a, n, D.warRelationOthers);
  sim.startWar(sim.code(a), sim.code(b), text || `${sim.nameNom(a)} erklärt ${sim.nameDat(b)} den Krieg.`);
  sim.dip.wars[key(a, b)] = { aggressor: a, day: sim.day, attacked: true, obligation };
  sim.dip.plans = sim.dip.plans.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
  applyBorderFort(sim, a, b);
  // Szenario: an einen Krieg gebundene Gebietsänderungen (Danzig bei Krieg mit Polen)
  let annexed = false;
  for (const x of sim.bal.scenario.annexations || []) {
    if (!x.onWar) continue;
    const [p, q] = x.onWar.map((c) => sim.idx(c));
    if ((p === a && q === b) || (p === b && q === a)) annexed = sim.annex(x, true) || annexed;
  }
  if (annexed) updateFronts(sim);
  // Aufmarsch: Reserve des Spielers geht an die neuen Fronten (nach Frontlänge)
  runGenerals(sim); // neue Fronten erhalten sofort Generäle
  if (a === sim.player || b === sim.player) {
    const enemy = a === sim.player ? b : a;
    deployReserve(sim, sim.player, enemy);
    // nationales Ziel (z. B. Fall Weiß): Fronten starten vorbereitet
    const prep = sim.dip.effects.filter((x) => x.kind === 'warPrep' && x.nation === sim.player && x.against === enemy).reduce((s, x) => Math.max(s, x.value), 0);
    if (prep) for (const f of sim.fronts.values()) if (f.alive && f.side[sim.player] && sim.enemyOn(f, sim.player) === enemy) { f.side[sim.player].prep = Math.max(f.side[sim.player].prep, prep); if (f.side[sim.player].order === 'hold') f.side[sim.player].order = 'prepare'; }
  }
  changeMorale(sim, b, sim.bal.morale.warDeclaredRally);
  if (!obligation) scheduleAllyResponses(sim, a, b);
  trackEnemies(sim);
  return true;
}

/**
 * Aufmarsch an der Grenze zu `b` planen (ohne Krieg): Grenzfronten entstehen, Generäle werden
 * besetzt. Mit `send` geht die Reserve (bis auf den Reserveanteil) per Verlegung dorthin.
 * Gibt die Kennungen der neuen Fronten zurück.
 */
export function planDeployment(sim, a, b, { send = true } = {}) {
  if (a === b || sim.isWar(a, b) || !active(sim, a) || !active(sim, b)) return [];
  if (!sim.plansAgainst(a, b)) sim.dip.plans.push([a, b]);
  updateFronts(sim);
  runGenerals(sim);
  const fronts = [...sim.fronts.values()].filter((f) => f.alive && f.planned && f.side[a] && sim.enemyOn(f, a) === b);
  if (!fronts.length) { cancelPlan(sim, a, b); return []; }
  if (send) {
    const share = sim.bal.divisions.nations[sim.code(a)]?.reserveShare ?? 0;
    const total = sim.divisions.filter((d) => d.nation === a).length;
    let free = sim.reserveOf(a).length - Math.round(total * share);
    const have = (f) => sim.divisionsOn(f.id, a).length + sim.inTransitTo(f.id, a).length;
    while (free > 0) {
      const best = fronts.reduce((x, f) => (f.length / (have(f) + 1) > x.length / (have(x) + 1) ? f : x), fronts[0]);
      if (!sim.transfer(0, best.id, 1, a)) break;
      free--;
    }
  }
  if (a === sim.player) sim.log('plan', `Aufmarsch an der Grenze zu ${sim.nameDat(b)} befohlen.`);
  return fronts.map((f) => f.id);
}

/** Aufmarsch aufheben: Divisionen der Grenzfronten kehren in die Reserve zurück. */
export function cancelPlan(sim, a, b) {
  const ids = [...sim.fronts.values()].filter((f) => f.alive && f.planned && f.side[a] && sim.enemyOn(f, a) === b).map((f) => f.id);
  sim.dip.plans = sim.dip.plans.filter(([x, y]) => !(x === a && y === b));
  for (const d of sim.divisions) {
    if (d.nation !== a) continue;
    if (d.transit && ids.includes(d.transit.to)) d.transit.to = 0;
    if (!d.transit && ids.includes(d.front)) d.front = 0;
  }
  updateFronts(sim);
  return ids.length;
}

/** Reserve auf die Fronten gegen `enemy` verteilen (nach Länge). */
export function deployReserve(sim, n, enemy) {
  const fronts = [...sim.fronts.values()].filter((f) => f.alive && f.side[n] && sim.enemyOn(f, n) === enemy && !f.encircled[n]);
  if (!fronts.length) return 0;
  let moved = 0;
  // ein Teil bleibt in Reserve (Anteil laut balance.json)
  const share = sim.bal.divisions.nations[sim.code(n)]?.reserveShare ?? 0;
  const total = sim.divisions.filter((d) => d.nation === n).length;
  let reserve = sim.reserveOf(n).length - Math.round(total * share);
  const have = (f) => sim.divisionsOn(f.id, n).length + sim.inTransitTo(f.id, n).length;
  while (reserve > 0) {
    const best = fronts.reduce((x, f) => (f.length / (have(f) + 1) > x.length / (have(x) + 1) ? f : x), fronts[0]);
    // Aufmarsch: die Truppen stehen bei Kriegsbeginn bereits an der Grenze
    const d = sim.reserveOf(n).sort((x, y) => y.tank - x.tank || x.id - y.id)[0];
    if (!d) break;
    d.front = best.id;
    reserve--;
    moved++;
  }
  return moved;
}

/** Vertrag laut Szenario mit Datum (Garantie für Polen, Stahlpakt, Pakt mit Moskau). */
export function scenarioTreaty(sim, t) {
  const [a, b] = t.pair.map((c) => sim.idx(c));
  if (!active(sim, a) || !active(sim, b) || sim.isWar(a, b)) return false;
  if (t.unlessWar && sim.isWar(...t.unlessWar.map((c) => sim.idx(c)))) return false;
  if (t.minRelation !== undefined && relation(sim, a, b) < t.minRelation) return false;
  const p = a < b ? [a, b] : [b, a];
  if (t.kind === 'alliance') { if (isAllied(sim, a, b)) return false; sim.dip.pacts = remove(sim.dip.pacts, a, b); sim.dip.alliances.push(p); }
  else { if (hasPact(sim, a, b) || isAllied(sim, a, b)) return false; sim.dip.pacts.push(p); }
  sim.log('treaty', t.text);
  return true;
}

/** Erster tatsächlicher Angriff in einem Szenario-Krieg (aus combat.js aufgerufen). */
export function noteAttack(sim, n, o) {
  const w = sim.dip?.wars[key(n, o)];
  if (!w || w.attacked || w.aggressor !== n) return;
  w.attacked = true;
  w.day = sim.day;
  sim.log('war', `${sim.nameNom(n)} greift ${sim.nameAcc(o)} an.`);
  scheduleAllyResponses(sim, n, o);
}

function scheduleAllyResponses(sim, aggressor, victim) {
  const D = sim.bal.diplomacy;
  for (const x of alliesOf(sim, victim)) {
    if (x === aggressor || x === sim.player || !active(sim, x) || sim.isWar(x, aggressor)) continue; // Spieler entscheidet selbst
    if (isAllied(sim, x, aggressor) || hasPact(sim, x, aggressor)) continue;
    const ob = `${x}-${victim}`;
    if (sim.dip.obligations.includes(ob)) continue; // Beistand nur gegen den ersten Angreifer
    if (relation(sim, x, aggressor) >= 50) continue; // KI: Wer dem Angreifer nahesteht, bleibt fern
    sim.dip.obligations.push(ob);
    sim.dip.scheduled.push({ day: sim.day + D.allyDelayDays, type: 'allyWar', a: x, b: aggressor, victim });
  }
}

/** Frieden schließen (Status quo: besetzte Gebiete bleiben, Fronten verschwinden). */
export function makePeace(sim, a, b, text) {
  if (!sim.isWar(a, b)) return false;
  sim.endWar(a, b);
  delete sim.dip.wars[key(a, b)];
  changeRelation(sim, a, b, sim.bal.diplomacy.peaceRelation);
  sim.log('peace', text || `Frieden zwischen ${sim.nameDat(a)} und ${sim.nameDat(b)}.`);
  updateFronts(sim);
  return true;
}

/** KI-Bewertung eines Angebots: Beziehung, gemeinsame Feinde, Bedrohung, Verlässlichkeit. */
export function offerScore(sim, from, to, kind) {
  const D = sim.bal.diplomacy;
  let s = relation(sim, from, to);
  const fe = sim.enemiesOf(from);
  const common = sim.enemiesOf(to).filter((e) => fe.includes(e)).length;
  s += D.commonEnemyBonus * common;
  // Bedrohung: Wer deutlich schwächer ist, sucht eher einen Pakt mit dem Stärkeren
  const divs = (n) => sim.divisions.filter((d) => d.nation === n).length;
  if (kind === 'pakt' && divs(from) > 1.5 * divs(to)) s += D.threatBonus;
  s -= D.breachPenalty * (sim.dip.breaches[from] || 0);
  return Math.round(s);
}

/**
 * Angebot des Spielers (oder einer Nation) an eine KI-Nation. kind: 'buendnis' | 'pakt'.
 * Gibt {ok, text} zurück.
 */
export function offer(sim, to, kind, from = sim.player) {
  const D = sim.bal.diplomacy;
  const name = sim.nameNom(to);
  const label = kind === 'buendnis' ? 'Bündnis' : 'Nichtangriffspakt';
  if (!active(sim, to)) return { ok: false, text: `${name} handelt nicht mehr.` };
  if (sim.isWar(from, to)) return { ok: false, text: `Mit ${name} herrscht Krieg.` };
  if (kind === 'buendnis' && isAllied(sim, from, to)) return { ok: false, text: `Bündnis mit ${name} besteht bereits.` };
  if (kind === 'pakt' && (hasPact(sim, from, to) || isAllied(sim, from, to))) return { ok: false, text: `Vertrag mit ${name} besteht bereits.` };
  const last = sim.dip.offers[`${from}-${to}`];
  if (last !== undefined && sim.day - last < D.offerCooldownDays) {
    return { ok: false, text: `${name} prüft noch das letzte Angebot (wieder möglich ab Tag ${last + D.offerCooldownDays}).` };
  }
  sim.dip.offers[`${from}-${to}`] = sim.day;
  if (kind === 'buendnis' && sim.enemiesOf(from).some((e) => isAllied(sim, to, e))) {
    sim.log('treaty', `${name} lehnt das ${label} ab: verbündet mit einem Kriegsgegner.`);
    return { ok: false, text: `${name} lehnt ab: verbündet mit einem Ihrer Kriegsgegner.` };
  }
  const score = offerScore(sim, from, to, kind);
  const need = kind === 'buendnis' ? D.acceptAlliance : D.acceptPact;
  if (score < need) {
    sim.log('treaty', `${name} lehnt das Angebot eines ${label}s ab.`);
    return { ok: false, text: `${name} lehnt ab (Bewertung ${score}, nötig ${need}).` };
  }
  const p = from < to ? [from, to] : [to, from];
  if (kind === 'buendnis') {
    sim.dip.pacts = remove(sim.dip.pacts, from, to);
    sim.dip.alliances.push(p);
    changeRelation(sim, from, to, D.allianceRelation);
  } else {
    sim.dip.pacts.push(p);
    changeRelation(sim, from, to, D.pactRelation);
  }
  sim.log('treaty', `${sim.nameNom(from)} und ${sim.nameAcc(to)} schließen einen ${label}.`);
  return { ok: true, text: `${name} nimmt an: ${label} geschlossen.` };
}

/** Täglich: fällige Bündnis-Kriegserklärungen, Waffenstillstand ohne Front, Feindesliste. */
export function runDiplomacy(sim) {
  const D = sim.bal.diplomacy;
  const due = sim.dip.scheduled.filter((s) => s.day <= sim.day);
  sim.dip.scheduled = sim.dip.scheduled.filter((s) => s.day > sim.day);
  for (const s of due) {
    if (s.type !== 'allyWar') continue;
    if (!active(sim, s.victim) || !sim.isWar(s.b, s.victim)) continue; // Anlass entfallen
    declareWar(sim, s.a, s.b, {
      obligation: true,
      text: `${sim.nameNom(s.a)} erklärt ${sim.nameDat(s.b)} den Krieg (Beistand für ${sim.nameAcc(s.victim)}).`,
    });
  }
  // Version 1 ohne Seekrieg: Ein Gegner ohne Landfront, dessen Verbündete nicht mehr kämpfen,
  // schließt nach `ceasefireDays` einen Waffenstillstand.
  const p = sim.player;
  for (const e of sim.enemiesOf(p)) {
    const front = [...sim.fronts.values()].some((f) => f.alive && !f.planned && ((f.a === p && f.b === e) || (f.a === e && f.b === p)));
    const alliesFight = alliesOf(sim, e).some((x) => active(sim, x) && sim.isWar(x, p));
    // Frist läuft erst, wenn weder eine eigene Landfront besteht noch ein Verbündeter kämpft
    if (front || alliesFight) { delete sim.dip.noFront[e]; continue; }
    if (sim.dip.noFront[e] === undefined) sim.dip.noFront[e] = sim.day;
    if (sim.day - sim.dip.noFront[e] >= D.ceasefireDays) {
      makePeace(sim, p, e, `${sim.nameNom(e)} schließt einen Waffenstillstand mit ${sim.nameDat(p)}.`);
      delete sim.dip.noFront[e];
    }
  }
  // Warnung: eigene Front ohne Truppen, an der der Gegner Divisionen sammelt (einmal je Front)
  for (const f of sim.fronts.values()) {
    if (!f.alive || f.planned || !f.side[p] || f.warned) continue;
    const o = sim.enemyOn(f, p);
    const enemy = sim.divisionsOn(f.id, o).length;
    if (enemy < 3 || sim.divisionsOn(f.id, p).length || sim.inTransitTo(f.id, p).length) continue;
    f.warned = true;
    sim.log('warn', `${f.name}: keine eigenen Truppen – ${sim.nameNom(o)} sammelt ${enemy} Divisionen.`, Math.round(f.cy) * sim.cols + Math.round(f.cx));
  }
  trackEnemies(sim);
}

/** War `n` in diesem Krieg der Angreifer? (für die KI-Haltung) */
export function warInfo(sim, a, b) {
  return sim.dip?.wars[key(a, b)] || null;
}

// ------------------------------------------------------------------ kleine Staaten (Überarbeitung)
export const isMajor = (sim, n) => sim.bal.diplomacy.majors.includes(sim.code(n));

function divCount(sim, n) {
  let k = 0;
  for (const d of sim.divisions) if (d.nation === n) k++;
  return k;
}

function sharesBorder(sim, a, b) {
  for (const i of sim._border || []) {
    if (sim.owner[i] !== a) continue;
    for (let k = i * 4, e = k + 4; k < e; k++) { const j = sim.nb[k]; if (j >= 0 && sim.owner[j] === b) return true; }
  }
  return false;
}

/** Bewertung eines Anschluss-Angebots: Druck (Kräfteverhältnis), Beziehung, Schutzmächte, Nachbarschaft. */
export function anschlussScore(sim, to, from = sim.player) {
  const A = sim.bal.diplomacy.anschluss;
  const ratio = Math.max(0.25, divCount(sim, from) / Math.max(1, divCount(sim, to)));
  let s = A.relationWeight * relation(sim, from, to) + A.powerWeight * Math.log2(ratio);
  if (alliesOf(sim, to).some((x) => isMajor(sim, x) && x !== from)) s -= A.majorAllyPenalty;
  if (sharesBorder(sim, from, to)) s += A.borderBonus;
  s -= sim.bal.diplomacy.breachPenalty * (sim.dip.breaches[from] || 0);
  return Math.round(s);
}

/** Möglichkeiten gegenüber einer Nation (für Kontextfenster und Diplomatie-Reiter). */
export function actionsFor(sim, n, from = sim.player) {
  const war = sim.isWar(from, n);
  const alive = sim.ownedCount[n] > 0 && (sim.nations.get(n)?.status ?? 'aktiv') === 'aktiv';
  return {
    war: alive && !war,
    peace: false,
    alliance: alive && !war && !isAllied(sim, from, n) && sim.nations.has(n),
    pact: alive && !war && !isAllied(sim, from, n) && !hasPact(sim, from, n),
    anschluss: alive && !war && !isMajor(sim, n),
    rohstoffe: alive && !war && !sim.dip.effects.some((x) => x.kind === 'rohstoffe' && x.partner === n),
    plan: alive && !war && !sim.plansAgainst(from, n) && bordersWith(sim, from, n),
    unplan: !war && sim.plansAgainst(from, n),
  };
}

/** Gemeinsame Landgrenze zweier Nationen (Grundlage für einen Aufmarsch). */
export function bordersWith(sim, a, b) {
  for (const i of borderCells(sim)) {
    if (sim.owner[i] !== a) continue;
    for (let k = i * 4, e = k + 4; k < e; k++) if (sim.nb[k] >= 0 && sim.owner[sim.nb[k]] === b) return true;
  }
  return false;
}

/** Anschluss anbieten: bei Annahme geht die ganze Nation friedlich an den Anbietenden. */
export function offerAnschluss(sim, to, from = sim.player) {
  const D = sim.bal.diplomacy;
  const A = D.anschluss;
  const name = sim.nameNom(to);
  if (!actionsFor(sim, to, from).anschluss) return { ok: false, text: `Mit ${sim.nameDat(to)} ist das nicht möglich.` };
  const last = sim.dip.offers[`${from}-${to}-a`];
  if (last !== undefined && sim.day - last < D.offerCooldownDays) return { ok: false, text: `${name} hat gerade erst abgelehnt (wieder ab Tag ${last + D.offerCooldownDays}).` };
  sim.dip.offers[`${from}-${to}-a`] = sim.day;
  const score = anschlussScore(sim, to, from);
  if (score < A.need) {
    changeRelation(sim, from, to, A.declineRelation);
    sim.log('treaty', `${name} lehnt den Anschluss an ${sim.nameAcc(from)} ab.`);
    return { ok: false, text: `${name} lehnt ab (Bewertung ${score}, nötig ${A.need}).` };
  }
  // Teil der Armee wird übernommen
  const keep = A.keepDivisionsShare;
  let k = 0;
  for (const d of sim.divisions) if (d.nation === to && (k++ % Math.round(1 / Math.max(0.01, keep))) === 0) { d.nation = from; d.front = 0; d.transit = null; }
  sim.annex({ nation: sim.code(to), to: sim.code(from), text: `${name} schließt sich ${sim.nameDat(from)} an.` });
  for (const n of sim.nations.keys()) {
    if (n === from || n === to) continue;
    changeRelation(sim, from, n, isMajor(sim, n) ? A.acceptRelationMajors : A.acceptRelationOthers);
  }
  changeMorale(sim, from, A.acceptMorale);
  return { ok: true, text: `${name} nimmt an und gehört nun zu ${sim.nameDat(from)}.` };
}

/** Rohstoffabkommen: Geld gegen Rohstoffe für eine Zeit. */
export function offerRohstoffe(sim, to, from = sim.player) {
  const R = sim.bal.diplomacy.rohstoffe;
  const e = sim.econ.get(from);
  const name = sim.nameNom(to);
  if (!actionsFor(sim, to, from).rohstoffe) return { ok: false, text: `Mit ${sim.nameDat(to)} ist das nicht möglich.` };
  if (!e || e.money < R.cost) return { ok: false, text: `Zu wenig Geld (${R.cost} nötig).` };
  if (relation(sim, from, to) < R.minRelation) {
    sim.log('treaty', `${name} lehnt ein Rohstoffabkommen ab.`);
    return { ok: false, text: `${name} lehnt ab (Beziehung zu schlecht).` };
  }
  e.money -= R.cost;
  sim.dip.effects.push({ nation: from, kind: 'rohstoffe', partner: to, value: R.perDay, until: sim.day + R.days });
  changeRelation(sim, from, to, 5);
  sim.log('treaty', `Rohstoffabkommen mit ${sim.nameDat(to)}: +${R.perDay} Rohstoffe je Tag für ${R.days} Tage.`);
  return { ok: true, text: `Abkommen geschlossen: +${R.perDay} Rohstoffe je Tag.` };
}

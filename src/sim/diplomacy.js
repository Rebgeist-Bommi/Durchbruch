// Diplomatie (Phase 5, bewusst einfach): Krieg erklären, Bündnis anbieten, Nichtangriffspakt
// anbieten. Beziehungswert je Nationenpaar (−100 … +100). Bündnisse sind Beistandspakte: Wird ein
// Bündnispartner angegriffen, erklären die übrigen Partner dem Angreifer nach `allyDelayDays` den
// Krieg (einmal je Partner; Kriegserklärungen aus Bündnispflicht lösen keine weitere Kette aus).
import { updateFronts } from './fronts.js';
import { changeMorale } from './morale.js';

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
  return !!st && st.status === 'aktiv';
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
  for (const bf of sim.bal.start.borderFortification || []) {
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
  applyBorderFort(sim, a, b);
  changeMorale(sim, b, sim.bal.morale.warDeclaredRally);
  if (!obligation) scheduleAllyResponses(sim, a, b);
  trackEnemies(sim);
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
    const front = [...sim.fronts.values()].some((f) => f.alive && ((f.a === p && f.b === e) || (f.a === e && f.b === p)));
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
    if (!f.alive || !f.side[p] || f.warned) continue;
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

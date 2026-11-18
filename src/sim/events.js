// Ereignisse (Phase 5): historische Anlässe mit Auslösern und Entscheidungen des Spielers.
// Ein Ereignis tritt nur ein, wenn seine Bedingung in der Spiellage erfüllt ist.
// Entscheidungen halten die Simulation an: tick() rechnet erst weiter, wenn decide() gewählt hat.
import { forward } from '../data/projection.js';
import { declareWar, hasPact, relation, changeRelation, makePeace, warInfo } from './diplomacy.js';
import { changeMorale, moraleOf } from './morale.js';

const idxOr = (sim, code) => sim.codeIndex.get(code) || 0;
const active = (sim, n) => sim.nations.get(n)?.status === 'aktiv';

/** Gebietsverlust einer Nation (Anteil seit Kriegsbeginn). */
function lostShare(sim, n) {
  const st = sim.nations.get(n);
  return st && st.startCells ? 1 - sim.ownedCount[n] / st.startCells : 0;
}

// ------------------------------------------------------------------ Teilungslinie Polen
/**
 * Felder östlich der vereinbarten Linie (Polen am Stichtag). Die Linie ist eine Näherung aus
 * Stützpunkten (Länge, Breite) entlang der Flüsse, Nord nach Süd, siehe SOURCES.md.
 */
export function partitionZone(sim, lineKey) {
  const L = sim.bal.events.partition.lines[lineKey];
  const g = sim.grid;
  const pts = L.points.map(([lon, lat]) => {
    const [x, y] = forward(lon, lat);
    return [(x - g.originX) / g.cellSize, (g.originY - y) / g.cellSize]; // [col, row]
  });
  const colAt = (row) => {
    if (row <= pts[0][1]) return pts[0][0];
    for (let k = 1; k < pts.length; k++) {
      const [c0, r0] = pts[k - 1];
      const [c1, r1] = pts[k];
      if (row <= r1) return c0 + ((c1 - c0) * (row - r0)) / Math.max(1e-9, r1 - r0);
    }
    return pts[pts.length - 1][0];
  };
  const pol = idxOr(sim, 'POL');
  // Polens Felder am Stichtag (einmal je Simulation ermittelt)
  if (!sim._polCells) {
    const list = [];
    for (let i = 0; i < sim.N; i++) if (sim.startOwner[i] === pol) list.push(i);
    sim._polCells = Int32Array.from(list);
  }
  const zone = new Uint8Array(sim.N);
  for (const i of sim._polCells) {
    const r = Math.floor(i / sim.cols);
    const c = i - r * sim.cols;
    if (c + 0.5 > colAt(r + 0.5)) zone[i] = 1;
  }
  return zone;
}

/** Zone der vereinbarten Linie, zwischengespeichert (aus dem Schlüssel jederzeit neu berechenbar). */
function zoneOf(sim, key) {
  if (!sim._partition || sim._partition.key !== key) sim._partition = { key, zone: partitionZone(sim, key) };
  return sim._partition.zone;
}

/** Bei Kapitulation Polens: Aufteilung entlang der Linie (östlich Sowjetunion, westlich Deutschland). */
export function applyPartition(sim, n) {
  const pol = idxOr(sim, 'POL');
  const sov = idxOr(sim, 'SOV');
  const deu = idxOr(sim, 'DEU');
  const key = sim.dip?.partition;
  if (n !== pol || !key || key === 'abgelehnt' || !sim.isWar(sov, pol)) return false;
  const zone = zoneOf(sim, key);
  for (const i of sim._polCells) {
    const o = sim.owner[i];
    if (o !== pol && o !== deu && o !== sov) continue;
    const to = zone[i] ? sov : deu;
    if (o !== to) sim.setOwner(i, to, sim.dominantMethod(to), true);
  }
  sim.log('event', `Polen wird entlang der ${sim.bal.events.partition.lines[key].label} aufgeteilt.`);
  return true;
}

// ------------------------------------------------------------------ Entscheidungen
const DECISIONS = {
  partition: {
    title: 'Teilungsangebot der Sowjetunion',
    text: (sim) => `Moskau bietet an, in Ostpolen einzumarschieren, und verlangt eine Demarkationslinie. Polen hat ${Math.round(lostShare(sim, idxOr(sim, 'POL')) * 100)} % seines Gebiets verloren.`,
    options: [
      { label: 'Annehmen: Linie Narew–Weichsel–San', hint: 'Rote Armee marschiert in wenigen Tagen ein · Beziehung zur Sowjetunion steigt' },
      { label: 'Nachverhandeln: Linie am Bug', hint: 'mehr Gebiet für das Reich · Einmarsch später · Beziehung sinkt' },
      { label: 'Ablehnen', hint: 'kein sowjetischer Einmarsch · Beziehung sinkt deutlich' },
    ],
    apply(sim, k) {
      const P = sim.bal.events.partition;
      const deu = sim.player;
      const sov = idxOr(sim, 'SOV');
      if (k === 0) {
        sim.dip.partition = 'narew';
        zoneOf(sim, 'narew'); // vorab berechnen (hält den Kapitulationstag schlank)
        sim.dip.flags.sovInvadeDay = sim.day + P.invasionDelay;
        changeRelation(sim, deu, sov, P.acceptRelation);
      } else if (k === 1) {
        sim.dip.partition = 'bug';
        zoneOf(sim, 'bug');
        sim.dip.flags.sovInvadeDay = sim.day + P.invasionDelay + P.bugExtraDelay;
        changeRelation(sim, deu, sov, P.bugRelation);
      } else {
        sim.dip.partition = 'abgelehnt';
        changeRelation(sim, deu, sov, P.refuseRelation);
      }
    },
  },
  frenchPeace: {
    title: 'Friedensangebot Frankreichs',
    text: (sim) => `Paris lässt über neutrale Diplomaten anfragen, ob das Reich zu einem Frieden auf Grundlage des Status quo bereit ist. Stimmung in Frankreich: ${Math.round(moraleOf(sim, idxOr(sim, 'FRA')))} %. (Fiktives Ereignis)`,
    options: [
      { label: 'Frieden annehmen', hint: 'Krieg mit Frankreich endet · Großbritannien kämpft vorerst weiter' },
      { label: 'Ablehnen', hint: 'Krieg geht weiter · Moral im Reich sinkt leicht' },
    ],
    apply(sim, k) {
      const E = sim.bal.events.frenchPeace;
      const fra = idxOr(sim, 'FRA');
      if (k === 0) {
        makePeace(sim, sim.player, fra, 'Frieden zwischen dem Deutschen Reich und Frankreich.');
        changeRelation(sim, sim.player, fra, E.relation);
        changeMorale(sim, sim.player, E.peaceMorale);
      } else {
        changeMorale(sim, sim.player, E.refuseMorale);
        changeRelation(sim, sim.player, fra, -E.relation / 2);
      }
    },
  },
  generalRefuses: {
    title: 'General verweigert einen Befehl',
    text: (sim, d) => `${d.name} hält den Angriff an der ${d.front} für aussichtslos und verweigert den Befehl. Kräfteverhältnis etwa ${d.ratio.toFixed(1)} : 1.`,
    options: [
      { label: 'Befehl durchsetzen', hint: 'Angriff läuft · Moral sinkt leicht' },
      { label: 'Nachgeben', hint: 'Angriff wird abgebrochen, Front bereitet weiter vor' },
      { label: 'General ablösen', hint: 'Angriff läuft ohne ihn · Vorbereitung geht teilweise verloren' },
    ],
    apply(sim, k, d) {
      const G = sim.bal.events.generalRefuses;
      const f = sim.fronts.get(d.frontId);
      const side = f && f.alive ? f.side[sim.player] : null;
      if (!side) return;
      if (k === 0) changeMorale(sim, sim.player, G.enforceMorale);
      else if (k === 1) side.order = 'prepare';
      else {
        const g = sim.generals.find((x) => x.id === d.general);
        if (g) { g.front = 0; g.dismissedUntil = sim.day + 60; }
        side.general = null;
        side.prep = Math.max(0, side.prep - G.replacePrepLoss);
      }
    },
  },
  food: {
    title: 'Bevölkerung fordert Lebensmittel statt Rüstung',
    text: (sim) => `Lange Schlangen vor den Geschäften. Die Stimmung im Reich ist ${Math.round(moraleOf(sim, sim.player))} %. Die Gauleitungen drängen darauf, Rohstoffe und Arbeitskräfte von der Rüstung in die Versorgung zu lenken.`,
    options: [
      { label: 'Lebensmittel zuerst', hint: 'Rüstung −25 % für 60 Tage · Moral +10' },
      { label: 'Rüstung hat Vorrang', hint: 'Moral −6' },
      { label: 'Rationierung mit Propaganda', hint: 'kostet 80 · Rüstung −10 % für 30 Tage · Moral +4' },
    ],
    apply(sim, k) {
      const F = sim.bal.events.food;
      const p = sim.player;
      if (k === 0) {
        sim.dip.effects.push({ nation: p, kind: 'armament', value: F.foodArmament, until: sim.day + F.foodDays });
        changeMorale(sim, p, F.foodMorale);
      } else if (k === 1) {
        changeMorale(sim, p, F.armsMorale);
      } else {
        const e = sim.econ.get(p);
        e.money -= F.rationCost;
        sim.dip.effects.push({ nation: p, kind: 'armament', value: F.rationArmament, until: sim.day + F.rationDays });
        changeMorale(sim, p, F.rationMorale);
      }
    },
  },
};

export function decisionInfo(dec) {
  return DECISIONS[dec.kind];
}

function propose(sim, kind, data = {}) {
  const D = DECISIONS[kind];
  sim.pending = { kind, day: sim.day, title: D.title, text: D.text(sim, data), options: D.options.map((o) => ({ ...o })), data };
  sim.log('decision', `Entscheidung: ${D.title}.`);
}

/** Entscheidung treffen (Index der Option). Danach läuft die Simulation weiter. */
export function decide(sim, k) {
  const p = sim.pending;
  if (!p) return false;
  const D = DECISIONS[p.kind];
  if (!(k >= 0 && k < D.options.length)) throw new Error(`Option ${k}`);
  D.apply(sim, k, p.data);
  sim.dip.flags.lastDecisions = [...(sim.dip.flags.lastDecisions || []), { kind: p.kind, day: sim.day, choice: k }].slice(-50);
  sim.log('decision', `${p.title}: ${D.options[k].label}.`);
  sim.pending = null;
  return true;
}

/** Vor jedem Spieltag: Entscheidungsanlässe prüfen. Gibt true zurück, wenn eine Entscheidung ansteht. */
export function checkDecisions(sim) {
  if (sim.pending) return true;
  const E = sim.bal.events;
  const F = sim.dip.flags;
  const p = sim.player;
  const pol = idxOr(sim, 'POL');
  const sov = idxOr(sim, 'SOV');
  const fra = idxOr(sim, 'FRA');

  // Teilungsangebot: Pakt besteht, Deutschland hat Polen angegriffen
  const w = warInfo(sim, p, pol);
  if (!F.partitionOffered && pol && sov && hasPact(sim, p, sov) && w?.attacked && active(sim, pol) && active(sim, sov)
    && !sim.isWar(sov, pol) && (sim.day >= E.partition.fromDay || lostShare(sim, pol) >= E.partition.polandLost)) {
    F.partitionOffered = true;
    propose(sim, 'partition');
    return true;
  }
  // Friedensangebot Frankreichs (fiktiv): nach dem Fall Polens oder bei schlechter Stimmung
  if (!F.frenchPeace && fra && sim.isWar(p, fra) && active(sim, fra)) {
    const ps = sim.nations.get(pol);
    const afterPoland = ps && ps.status === 'kapituliert' && sim.day - ps.capitulationDay >= E.frenchPeace.afterPolandDays;
    if (afterPoland || moraleOf(sim, fra) <= E.frenchPeace.maxFrenchMorale) {
      F.frenchPeace = true;
      propose(sim, 'frenchPeace');
      return true;
    }
  }
  // General verweigert einen frisch erteilten Angriffsbefehl (nur erfundene Generäle)
  for (const f of [...sim.fronts.values()].sort((a, b) => a.id - b.id)) {
    const side = f.alive && f.side[p];
    if (!side || side.order !== 'attack' || side.attackStartDay !== sim.day || !side.general) continue;
    const g = sim.generals.find((x) => x.id === side.general);
    if (!g || g.historical || F[`refused_${g.id}`]) continue;
    const o = sim.enemyOn(f, p);
    const ratio = sim.sideStrength(f.id, p).str / Math.max(0.5, sim.sideStrength(f.id, o).str);
    if (ratio >= E.generalRefuses.maxRatio) continue;
    F[`refused_${g.id}`] = true;
    if (sim.rng() >= E.generalRefuses.chance) continue;
    propose(sim, 'generalRefuses', { general: g.id, name: g.name.replace(/ \(erfunden\)$/, ''), frontId: f.id, front: f.name, ratio });
    return true;
  }
  // Versorgungslage
  if (sim.day >= E.food.fromDay && sim.enemiesOf(p).length && moraleOf(sim, p) < E.food.maxMorale
    && (F.foodDay === undefined || sim.day - F.foodDay >= E.food.repeatDays)) {
    F.foodDay = sim.day;
    propose(sim, 'food');
    return true;
  }
  return false;
}

// ------------------------------------------------------------------ Ereignisse ohne Entscheidung
/** Nach jedem Spieltag: historische Anlässe, die die KI auslöst. */
export function runWorldEvents(sim) {
  const E = sim.bal.events;
  const F = sim.dip.flags;
  const p = sim.player;
  const pol = idxOr(sim, 'POL');
  const sov = idxOr(sim, 'SOV');
  const fin = idxOr(sim, 'FIN');
  const ita = idxOr(sim, 'ITA');
  const fra = idxOr(sim, 'FRA');
  const gbr = idxOr(sim, 'GBR');

  // Sowjetischer Einmarsch in Ostpolen: Polen im Krieg mit Deutschland, Pakt besteht, Teilung vereinbart
  if (F.sovInvadeDay !== undefined && !F.sovInvaded && sim.day >= F.sovInvadeDay) {
    F.sovInvaded = true;
    if (hasPact(sim, p, sov) && active(sim, pol) && sim.isWar(p, pol) && !sim.isWar(sov, pol)) {
      declareWar(sim, sov, pol, { text: 'Die Rote Armee überschreitet die polnische Ostgrenze.' });
    }
  }
  // Winterkrieg: Entscheidung der sowjetischen KI
  if (!F.winterWar && sov && fin && sim.day >= E.winterWar.fromDay && active(sim, sov) && active(sim, fin)
    && !sim.isWar(sov, fin) && !sim.isWar(sov, p) && !sim.enemiesOf(sov).length
    && relation(sim, sov, fin) <= E.winterWar.maxRelation) {
    if (sim.rng() < E.winterWar.chance) {
      F.winterWar = sim.day;
      declareWar(sim, sov, fin, { text: 'Die Sowjetunion greift Finnland an. Der Winterkrieg beginnt.' });
    }
  }
  // Kriegseintritt Italiens: abhängig von Kriegslage (Frankreich geschwächt) und Beziehung zum Reich
  if (!F.italy && ita && fra && sim.day >= E.italy.fromDay && active(sim, ita) && sim.isWar(p, fra) && active(sim, fra)
    && !sim.isWar(ita, p) && relation(sim, ita, p) >= E.italy.minRelation
    && (lostShare(sim, fra) >= E.italy.franceLost || moraleOf(sim, fra) <= E.italy.franceMorale)) {
    if (sim.rng() < E.italy.chance) {
      F.italy = sim.day;
      declareWar(sim, ita, fra, { text: 'Italien erklärt Frankreich den Krieg.' });
      if (gbr && sim.isWar(p, gbr)) declareWar(sim, ita, gbr, { text: `Italien erklärt ${sim.nameDat(gbr)} den Krieg.` });
    }
  }
  // abgelaufene Wirkungen
  sim.dip.effects = sim.dip.effects.filter((x) => x.until > sim.day);
}

/** Summe aktiver Wirkungen einer Art (z. B. Rüstung −25 %). */
export function effectSum(sim, n, kind) {
  let s = 0;
  for (const x of sim.dip?.effects || []) if (x.nation === n && x.kind === kind) s += x.value;
  return s;
}

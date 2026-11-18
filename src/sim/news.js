// Zeitung "Der Tagesanzeiger" (Phase 5): Schlagzeilen aus den Meldungen des Tages und eine
// wöchentliche Stimmungsnotiz. Rein aus dem Spielverlauf erzeugt, ohne historische Behauptungen.
import { moodText, moraleOf } from './morale.js';

export function initNews(sim) {
  sim.news = [];
  sim.newsSeen = 0;
}

function headline(sim, e) {
  const t = e.text;
  switch (e.type) {
    case 'capitulation': return { prio: 5, title: t.split(' kapituliert')[0].toUpperCase() + ' KAPITULIERT', text: t };
    case 'war': return { prio: 4, title: t.includes('greift') ? 'DER KRIEG HAT BEGONNEN' : 'KRIEGSERKLÄRUNG', text: t };
    case 'peace': return { prio: 4, title: 'Die Waffen schweigen', text: t };
    case 'event': return { prio: 4, title: 'Sondermeldung', text: t };
    case 'treaty': return { prio: 3, title: t.includes('lehnt') ? 'Absage aus dem Ausland' : t.includes('Vertragsbruch') ? 'Vertrag gebrochen' : 'Neuer Vertrag', text: t };
    case 'city': {
      const ci = e.cell >= 0 ? sim.cityAt[e.cell] : -1;
      const c = ci >= 0 ? sim.cities[ci] : null;
      if (!c || c.rank > 2) return null;
      const cap = c.capital;
      return { prio: cap ? 4 : 2, title: cap ? `${c.name.toUpperCase()} GEFALLEN` : `${c.name} genommen`, text: t };
    }
    case 'pocket': return t.includes('aufgerieben') ? { prio: 2, title: 'Kessel bereinigt', text: t } : null;
    case 'annex': return { prio: 2, title: 'Heimkehr', text: t };
    case 'warn': return { prio: 3, title: 'Sorge um die Grenze', text: t };
    case 'decision': return t.startsWith('Entscheidung:') ? null : { prio: 3, title: 'Aus der Reichskanzlei', text: t };
    default: return null;
  }
}

/** Nach jedem Spieltag: neue Meldungen in Schlagzeilen übersetzen. */
export function runNews(sim) {
  const ev = sim.events;
  for (let k = sim.newsSeen; k < ev.length; k++) {
    const h = headline(sim, ev[k]);
    if (h) sim.news.push({ day: ev[k].day, ...h });
  }
  sim.newsSeen = ev.length;
  if (sim.day % 7 === 0) {
    const m = moraleOf(sim, sim.player);
    sim.news.push({ day: sim.day, prio: 1, title: `Stimmung im Reich: ${moodText(m)}`, text: `Die Berichte aus den Gauen nennen die Bevölkerung ${moodText(m)} (Moral ${Math.round(m)} %).` });
  }
  if (sim.news.length > 400) sim.news.splice(0, sim.news.length - 400);
}

/** Ausgabe eines Tages: Schlagzeilen bis einschließlich `day`, wichtigste zuerst (letzte 7 Tage). */
export function issue(sim, day = sim.day) {
  const items = sim.news.filter((n) => n.day <= day && n.day > day - 7);
  items.sort((a, b) => b.prio - a.prio || b.day - a.day);
  return items.slice(0, 6);
}

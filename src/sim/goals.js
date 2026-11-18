// Nationale Ziele (Überarbeitung, angelehnt an den Fokusbaum): Der Spieler wählt jeweils ein Ziel;
// nach Ablauf der Dauer tritt die Wirkung dauerhaft ein. Wirkungen laufen über sim.dip.effects
// (dauerhaft: until = FOREVER), damit Speichern/Laden nichts Neues braucht.
import { changeRelation } from './diplomacy.js';

export const FOREVER = 1e9;

export function initGoals(sim) {
  sim.goals = { current: null, done: [] };
}

export const goalList = (sim) => sim.bal.goals.list;

export function goalState(sim, id) {
  if (sim.goals.done.includes(id)) return 'fertig';
  if (sim.goals.current?.id === id) return 'laeuft';
  const g = goalList(sim).find((x) => x.id === id);
  return (g.requires || []).every((r) => sim.goals.done.includes(r)) ? 'frei' : 'gesperrt';
}

/** Ebene im Baum (Länge der längsten Voraussetzungskette). */
export function goalTier(sim, id) {
  const g = goalList(sim).find((x) => x.id === id);
  return (g.requires || []).length ? 1 + Math.max(...g.requires.map((r) => goalTier(sim, r))) : 0;
}

export function startGoal(sim, id) {
  if (sim.goals.current || goalState(sim, id) !== 'frei') return false;
  sim.goals.current = { id, start: sim.day };
  return true;
}

export function goalProgress(sim) {
  const c = sim.goals.current;
  if (!c) return 0;
  const g = goalList(sim).find((x) => x.id === c.id);
  return Math.min(1, (sim.day - c.start) / g.days);
}

function apply(sim, g) {
  const p = sim.player;
  for (const e of g.effects) {
    switch (e.kind) {
      case 'relation': changeRelation(sim, p, sim.idx(e.with), e.value); break;
      case 'annex': sim.annex({ territory: e.territory, to: e.to, text: `${g.label}: ${sim.grid.territories.find((t) => t.key === e.territory)?.name || e.territory} schließt sich an.` }); break;
      case 'mobilize': { const ec = sim.econ.get(p); if (ec) ec.mobLevel = Math.min(sim.bal.economy.mobilization.levels.length - 1, ec.mobLevel + 1); break; }
      case 'borderFort': {
        const o = sim.idx(e.against);
        sim.dip.effects.push({ nation: p, kind: 'borderFort', against: o, value: e.value, until: FOREVER });
        // bereits bestehende Front sofort verstärken
        for (const f of sim.fronts.values()) {
          if (!f.alive || !f.side[p] || sim.enemyOn(f, p) !== o) continue;
          for (const c of sim.frontCellsOf(f, p)) sim.fort[c] = Math.min(1, sim.fort[c] + e.value);
        }
        break;
      }
      default: sim.dip.effects.push({ nation: p, kind: e.kind, value: e.value, against: e.against ? sim.idx(e.against) : undefined, until: FOREVER });
    }
  }
}

/** Täglich: laufendes Ziel abschließen. */
export function runGoals(sim) {
  const c = sim.goals.current;
  if (!c) return;
  const g = goalList(sim).find((x) => x.id === c.id);
  if (sim.day - c.start < g.days) return;
  sim.goals.current = null;
  sim.goals.done.push(g.id);
  apply(sim, g);
  sim.log('goal', `Nationales Ziel erreicht: ${g.label} – ${g.text}.`);
}

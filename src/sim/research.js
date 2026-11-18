// Forschung (Phase 4): Forschungsanstalten mit Schwerpunkt und Budget, Ergebnisse in fester
// Reihenfolge je Schwerpunkt mit steigenden Kosten. Effekte sind abstrakte Prozentboni.
import { effectSum } from './events.js';

export const FOCI = ['heer', 'luft', 'industrie', 'sonder'];

export function initResearch(sim) {
  const R = sim.bal.research;
  sim.research = new Map();
  for (const n of sim.econ.keys()) sim.research.set(n, newTracks());
  sim.unlocks = new Map();
  sim.modsCache = new Map();
  // Schwerpunkte der Anstalten zum Start (balance.research.initialFocus), sonst reihum
  const used = new Map();
  let k = 0;
  for (const b of sim.buildings) {
    if (b.type !== 'forschung') continue;
    const list = R.initialFocus[b.siteName] || [];
    const i = used.get(b.siteName) || 0;
    used.set(b.siteName, i + 1);
    b.focus = list[i] || FOCI[k++ % FOCI.length];
    b.budget = R.defaultBudget;
  }
}

function newTracks() {
  const t = {};
  for (const f of FOCI) t[f] = { level: 0, progress: 0 };
  return t;
}

export function resultCost(sim, level) {
  const R = sim.bal.research;
  return R.baseCost * R.costGrowth ** level;
}

/** Summe der freigeschalteten Effekte einer Nation (zwischengespeichert). */
export function mods(sim, n) {
  let m = sim.modsCache.get(n);
  if (m) return m;
  m = { attack: 0, defense: 0, tank: 0, air: 0, airDefense: 0, strike: 0, counter: 0, production: 0, repair: 0, railCost: 0, resources: 0, equipment: 0, supply: 0 };
  const tr = sim.research.get(n);
  if (tr) {
    for (const f of FOCI) {
      const res = sim.bal.research.foci[f].results;
      for (let i = 0; i < tr[f].level; i++) for (const [k, v] of Object.entries(res[i].mods || {})) m[k] += v;
    }
  }
  sim.modsCache.set(n, m);
  return m;
}

/** Bonus der Wissenschaftler für eine Anstalt (gleiche Region, passendes Fachgebiet, gleicher Dienstherr). */
export function scientistBonus(sim, b) {
  const owner = sim.owner[b.cell];
  const sec = sim.sectors.sectorOf[b.cell];
  let bonus = 0;
  for (const s of sim.scientists || []) {
    if (s.status !== 'aktiv' || s.cell < 0 || s.employer !== owner || s.field !== b.focus) continue;
    if (sim.sectors.sectorOf[s.cell] === sec && sim.owner[s.cell] === owner) bonus += s.bonus;
  }
  return Math.min(1, bonus);
}

export function ownsResource(sim, n, kind) {
  return sim.resourceRegions.some((r) => r.kind === kind && r.cells.some((c) => sim.owner[c] === n));
}

/** Fortschritt je Tag einer Anstalt (ohne Bezahlung). */
export function dailyPoints(sim, b) {
  const max = sim.bal.research.maxBudget;
  const budget = Math.max(0, Math.min(max, b.budget || 0));
  const goal = sim.dip ? effectSum(sim, sim.owner[b.cell], 'research') : 0; // nationales Ziel
  return budget * (1 + scientistBonus(sim, b)) * b.health * (1 + goal);
}

export function runResearch(sim) {
  const R = sim.bal.research;
  const max = R.maxBudget;
  for (const b of sim.buildings) {
    if (b.type !== 'forschung' || !b.done) continue;
    b.budget = Math.max(0, Math.min(max, b.budget || 0)); // Höchstbudget je Anstalt
    const n = sim.owner[b.cell];
    const e = sim.econ.get(n);
    const tr = sim.research.get(n);
    if (!e || !tr || b.budget <= 0 || e.money < b.budget) continue;
    e.money -= b.budget;
    e.spentToday += b.budget;
    e.researchToday = (e.researchToday || 0) + b.budget;
    tr[b.focus].progress += dailyPoints(sim, b);
  }
  for (const [n, tr] of sim.research) {
    for (const f of FOCI) {
      const t = tr[f];
      const res = R.foci[f].results;
      while (t.level < res.length) {
        const cost = resultCost(sim, t.level);
        if (t.progress < cost) break;
        const r = res[t.level];
        if (r.needs && !ownsResource(sim, n, r.needs)) { t.progress = cost; break; } // wartet auf Uran
        t.progress -= cost;
        t.level++;
        sim.modsCache.delete(n);
        if (r.unlock) {
          if (!sim.unlocks.has(n)) sim.unlocks.set(n, []);
          sim.unlocks.get(n).push(r.unlock);
        }
        if (!sim.researchLog) sim.researchLog = [];
        sim.researchLog.push({ day: sim.day, n, focus: f, level: t.level });
        if (n === sim.player) sim.log('research', `Forschung ${R.foci[f].label}: „${r.name}“ – ${r.text}.`);
        leakResult(sim, n, f, cost);
      }
    }
  }
}

/** Unzuverlässige (entführte/gefangene) Wissenschaftler verraten Ergebnisse an ihr Herkunftsland. */
function leakResult(sim, n, focus, cost) {
  const S = sim.bal.scientists;
  for (const s of sim.scientists || []) {
    if (s.employer !== n || s.origin === n || s.field !== focus || s.status !== 'aktiv') continue;
    const chance = S.leakChancePerResult * (1 - s.loyalty) * (1 - S.guardRiskFactor * s.guard);
    if (sim.rng() >= chance) continue;
    const tr = sim.research.get(s.origin);
    if (tr) tr[focus].progress += cost * 0.5;
    if (n === sim.player) sim.log('intel', `Verdacht: ${s.name} hat Forschungsergebnisse an ${sim.nationName(s.origin)} weitergegeben.`);
  }
}

/** KI: Budgets nach Kassenlage, Schwerpunkt neuer Anstalten reihum. */
export function aiResearch(sim, n, e) {
  const R = sim.bal.research;
  const rich = e.money > (e.upkeepToday || 1) * 60;
  for (const b of sim.buildings) {
    if (b.type !== 'forschung' || sim.owner[b.cell] !== n) continue;
    if (!b.focus) b.focus = FOCI[b.id % FOCI.length];
    b.budget = rich ? R.maxBudget : e.money > 0 ? R.defaultBudget : 0;
  }
}

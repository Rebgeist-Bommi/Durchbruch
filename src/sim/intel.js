// Geheimdienst (Phase 4): eine Geheimdienststufe je Nation, Agenten, vier Missionen
// (Aufklären, Sabotage, Wissenschaftler entführen, Desinformation), Enttarnung, Beziehungen,
// Nebel des Krieges.
import { DESTROYED, INTACT } from './infra.js';
import { mods } from './research.js';
import { intelScientistBonus, bestPlace } from './scientists.js';

export const MISSION_TYPES = ['aufklaeren', 'sabotage', 'entfuehren', 'desinformation'];

export function initIntel(sim) {
  const I = sim.bal.intel;
  sim.intel = new Map();
  for (const n of sim.econ.keys()) {
    sim.intel.set(n, {
      level: I.startLevel[sim.code(n)] || 2, upgrade: null, agents: [], nextAgentId: 1,
      revealedSectors: {}, revealedNations: {}, phantom: [], reports: [],
    });
  }
  sim.relations = {}; // "a-b" -> Wert (−100 … +100); Startwerte setzt diplomacy.js
  const G = I.defaultGuard;
  for (const node of sim.nodes) node.guard = G.node;
  for (const b of sim.bridges) b.guard = G.bridge;
  for (const b of sim.buildings) b.guard = G[b.type] ?? 0;
}

export function relation(sim, a, b) {
  return sim.relations[a < b ? `${a}-${b}` : `${b}-${a}`] || 0;
}

function changeRelation(sim, a, b, d) {
  const k = a < b ? `${a}-${b}` : `${b}-${a}`;
  sim.relations[k] = Math.max(-100, Math.min(100, (sim.relations[k] || 0) + d));
}

/** Spionageabwehr einer Nation: Stufe + Forschung + Kryptoanalytiker. */
export function counterOf(sim, n) {
  const st = sim.intel.get(n);
  return (st ? st.level : 1) + mods(sim, n).counter + intelScientistBonus(sim, n);
}

// ------------------------------------------------------------------ Ziele
/** Ziel beschreiben: {kind, id} -> {nation, cell, name, guard} oder null. */
export function describeTarget(sim, t) {
  if (!t) return null;
  switch (t.kind) {
    case 'node': { const x = sim.nodes[t.id]; return x && { nation: sim.owner[x.cell], cell: x.cell, name: `Bahnknoten ${x.name}`, guard: x.guard, state: x.state, obj: x }; }
    case 'bridge': { const x = sim.bridges[t.id]; return x && { nation: sim.owner[x.cell], cell: x.cell, name: x.name, guard: x.guard, state: x.state, obj: x }; }
    case 'building': {
      const x = sim.buildings.find((b) => b.id === t.id);
      if (!x) return null;
      const label = sim.bal.economy.buildings[x.type].label;
      return { nation: sim.owner[x.cell], cell: x.cell, name: `${label} ${x.siteName}`, guard: x.guard || 0, health: x.health, obj: x };
    }
    case 'scientist': { const x = sim.scientists.find((s) => s.id === t.id); return x && x.cell >= 0 && { nation: x.employer, cell: x.cell, name: x.name, guard: x.guard, obj: x }; }
    case 'sector': {
      // Gebiet: Nation = häufigster Besitzer im Sektor (Mittelpunkt)
      const c = Math.round(sim.sectors.cy[t.id]) * sim.cols + Math.round(sim.sectors.cx[t.id]);
      return { nation: sim.owner[c], cell: c, name: `Raum ${sim.sectorName(t.id)}`, guard: 0 };
    }
    case 'front': { const f = sim.fronts.get(t.id); return f && f.alive && { nation: 0, cell: Math.round(f.cy) * sim.cols + Math.round(f.cx), name: f.name, guard: 0, front: f }; }
    default: return null;
  }
}

/** Welche Missionen auf ein Ziel passen. */
export function missionsFor(sim, n, t) {
  const d = describeTarget(sim, t);
  if (!d) return [];
  if (t.kind === 'front') return d.front.side[n] ? ['desinformation'] : [];
  if (d.nation === n || !d.nation) return [];
  if (t.kind === 'sector') return ['aufklaeren'];
  if (t.kind === 'scientist') return ['entfuehren', 'aufklaeren'];
  return ['sabotage', 'aufklaeren'];
}

/** Erfolgschance: eigene Stufe gegen gegnerische Abwehr, abzüglich Bewachung. */
export function missionChance(sim, n, type, t) {
  const I = sim.bal.intel;
  const d = describeTarget(sim, t);
  if (!d) return 0;
  const enemy = type === 'desinformation' ? sim.enemyOn(d.front, n) : d.nation;
  const own = sim.intel.get(n).level;
  const p = I.missions[type].base + I.perLevel * (own - counterOf(sim, enemy)) - I.perGuard * (d.guard || 0) + (n === sim.player && sim.diff ? sim.diff().intel : 0);
  return Math.max(I.minChance, Math.min(I.maxChance, p));
}

// ------------------------------------------------------------------ Befehle
export function recruitAgent(sim, n) {
  const I = sim.bal.intel;
  const st = sim.intel.get(n);
  const e = sim.econ.get(n);
  if (!st || !e || e.money < I.agentCost || st.agents.length >= I.maxAgents) return null;
  e.money -= I.agentCost;
  e.spentToday += I.agentCost;
  const a = { id: st.nextAgentId++, state: 'training', ready: sim.day + I.agentTrainingDays, mission: null };
  st.agents.push(a);
  return a;
}

export function raiseLevel(sim, n) {
  const I = sim.bal.intel;
  const st = sim.intel.get(n);
  const e = sim.econ.get(n);
  if (!st || st.upgrade || st.level >= 6 || e.money < I.levelUpCost * st.level) return false;
  e.money -= I.levelUpCost * st.level;
  e.spentToday += I.levelUpCost * st.level;
  st.upgrade = { finish: sim.day + I.levelUpDays };
  return true;
}

export function startMission(sim, n, type, t) {
  const I = sim.bal.intel;
  const st = sim.intel.get(n);
  if (!missionsFor(sim, n, t).includes(type)) return null;
  const a = st.agents.find((x) => x.state === 'ready');
  if (!a) return null;
  const chance = missionChance(sim, n, type, t);
  a.state = 'mission';
  a.mission = { type, target: { ...t }, start: sim.day, finish: sim.day + I.missions[type].days, chance };
  return a;
}

// ------------------------------------------------------------------ Ablauf
/** Würfelt eine Mission (für Tests auch ohne Wirkung nutzbar). */
export function rollMission(sim, chance) {
  return sim.rng() < chance;
}

export function runIntel(sim) {
  const I = sim.bal.intel;
  for (const [n, st] of sim.intel) {
    if (st.upgrade && sim.day >= st.upgrade.finish) {
      st.level++;
      st.upgrade = null;
      if (n === sim.player) sim.log('intel', `Geheimdienst: Stufe ${st.level} erreicht.`);
    }
    st.phantom = st.phantom.filter((p) => p.until >= sim.day);
    for (const a of st.agents) {
      if (a.state === 'training' && sim.day >= a.ready) a.state = 'ready';
      if (a.state === 'mission' && sim.day >= a.mission.finish) resolveAgent(sim, n, a);
    }
    st.agents = st.agents.filter((a) => a.state !== 'lost');
  }
  runAiIntel(sim);
}

/**
 * Mission eines Agenten auswerten. Die Erfolgschance wurde beim Start festgehalten und ist
 * dieselbe, die die Akte angezeigt hat. Rückgabe: 'erfolg', 'enttarnt', 'gescheitert' oder null.
 */
export function resolveAgent(sim, n, a) {
  const I = sim.bal.intel;
  const m = a.mission;
  const d = describeTarget(sim, m.target);
  const enemy = d ? (m.type === 'desinformation' ? sim.enemyOn(d.front, n) : d.nation) : 0;
  if (!d || !enemy) { a.state = 'ready'; a.mission = null; return null; }
  if (rollMission(sim, m.chance)) {
    applySuccess(sim, n, m, d, enemy);
    a.state = 'ready';
    a.mission = null;
    return 'erfolg';
  }
  if (sim.rng() < I.missions[m.type].exposeOnFail) {
    a.state = 'lost';
    changeRelation(sim, n, enemy, -I.relationLoss);
    if (n === sim.player) sim.log('intel', `Agent enttarnt: ${I.missions[m.type].label} gegen ${d.name} gescheitert, Agent verloren. Beziehung zu ${sim.nationName(enemy)} sinkt.`);
    else if (enemy === sim.player) sim.log('intel', `Feindlicher Agent (${sim.nationName(n)}) bei ${d.name} enttarnt.`, d.cell);
    return 'enttarnt';
  }
  a.state = 'ready';
  a.mission = null;
  if (n === sim.player) sim.log('intel', `${I.missions[m.type].label} gegen ${d.name} gescheitert; Agent unentdeckt zurück.`);
  return 'gescheitert';
}

function applySuccess(sim, n, m, d, enemy) {
  const I = sim.bal.intel;
  const st = sim.intel.get(n);
  const own = n === sim.player;
  const vsPlayer = enemy === sim.player;
  switch (m.type) {
    case 'aufklaeren': {
      const sec = sim.sectors.sectorOf[d.cell];
      if (sec >= 0) st.revealedSectors[sec] = sim.day + I.missions.aufklaeren.revealDays;
      st.revealedNations[enemy] = sim.day + I.missions.aufklaeren.revealDays;
      if (own) sim.log('intel', `Aufklärung erfolgreich: ${d.name} – Truppen, Gebäude und Forschungsstand von ${sim.nationName(enemy)} für ${I.missions.aufklaeren.revealDays} Tage sichtbar.`, d.cell);
      break;
    }
    case 'sabotage': {
      sabotage(sim, m.target, d);
      if (own) sim.log('intel', `Sabotage erfolgreich: ${d.name} getroffen.`, d.cell);
      else if (vsPlayer) sim.log('intel', `Sabotage: ${d.name} wurde getroffen (Täter unbekannt).`, d.cell);
      break;
    }
    case 'entfuehren': {
      const s = d.obj;
      const from = s.employer;
      s.employer = n;
      s.loyalty = sim.bal.scientists.abductedLoyalty;
      s.guard = 0;
      s.cell = bestPlace(sim, s);
      if (own) sim.log('intel', `${s.name} wurde aus ${sim.nationName(from)} entführt.`, s.cell);
      else if (vsPlayer) sim.log('intel', `${s.name} ist verschwunden – vermutlich entführt.`);
      break;
    }
    case 'desinformation': {
      sim.intel.get(enemy).phantom.push({ frontId: d.front.id, strength: I.missions.desinformation.phantomDivisions, until: sim.day + I.missions.desinformation.effectDays, by: n });
      if (own) sim.log('intel', `Desinformation wirkt: ${sim.nationName(enemy)} erwartet einen Großangriff an der ${d.name}.`, d.cell);
      break;
    }
    default:
  }
}

/** Sabotage: Knoten/Brücke zerstört, Gebäude schwer beschädigt. */
export function sabotage(sim, t, d = describeTarget(sim, t)) {
  if (!d) return;
  if (t.kind === 'node' || t.kind === 'bridge') {
    d.obj.state = DESTROYED;
    if (sim.railState[d.cell]) {
      if (sim.railState[d.cell] === INTACT) sim.damagedRail.push(d.cell);
      sim.railState[d.cell] = DESTROYED;
      sim.railProgress[d.cell] = 0;
    }
  } else if (t.kind === 'building') {
    d.obj.health = Math.max(0.05, d.obj.health - 0.5);
  }
}

/** Nebel des Krieges: Ist ein Feld für `viewer` aufgeklärt (oder kein Feindgebiet)? */
export function isRevealed(sim, viewer, cell) {
  const o = sim.owner[cell];
  if (!o || o === viewer || !sim.isWar(o, viewer)) return true;
  const st = sim.intel.get(viewer);
  const sec = sim.sectors.sectorOf[cell];
  return !!st && sec >= 0 && (st.revealedSectors[sec] || -1) >= sim.day;
}

export function nationRevealed(sim, viewer, n) {
  if (n === viewer || !sim.isWar(n, viewer)) return true;
  const st = sim.intel.get(viewer);
  return !!st && (st.revealedNations[n] || -1) >= sim.day;
}

/** Vorgetäuschte Stärke an einer Front aus Sicht der getäuschten Nation. */
export function phantomStrength(sim, n, frontId) {
  const st = sim.intel.get(n);
  if (!st) return 0;
  return st.phantom.reduce((s, p) => (p.frontId === frontId ? s + p.strength : s), 0);
}

// ------------------------------------------------------------------ KI
function runAiIntel(sim) {
  const I = sim.bal.intel;
  const p = sim.player;
  for (const [n, st] of sim.intel) {
    if (n === p || sim.nations.get(n)?.status !== 'aktiv') continue;
    if ((sim.day + n * 3) % I.ai.intervalDays !== 0) continue;
    const atWar = sim.isWar(n, p);
    if (st.agents.length < (atWar ? 3 : 1)) recruitAgent(sim, n);
    if (!st.agents.some((a) => a.state === 'ready') || sim.rng() >= I.ai.missionChance) continue;
    let target = null;
    let type = 'aufklaeren';
    if (atWar) {
      // Sabotage am Bahnknoten des Spielers, der einer gemeinsamen Front am nächsten liegt
      const f = [...sim.fronts.values()].find((x) => x.alive && !x.planned && x.side[n] && x.side[p]);
      if (f) {
        let best = -1;
        let bd = Infinity;
        sim.nodes.forEach((node, i) => {
          if (sim.owner[node.cell] !== p || node.state !== INTACT) return;
          const dd = (node.cell % sim.cols - f.cx) ** 2 + (Math.floor(node.cell / sim.cols) - f.cy) ** 2;
          if (dd < bd) { bd = dd; best = i; }
        });
        if (best >= 0) { target = { kind: 'node', id: best }; type = 'sabotage'; }
      }
    }
    if (!target) {
      const cap = sim.capital.get(p);
      if (cap !== undefined) target = { kind: 'sector', id: sim.sectors.sectorOf[cap] };
    }
    if (target) startMission(sim, n, type, target);
  }
}

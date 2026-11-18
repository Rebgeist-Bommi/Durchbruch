// Luftangriffe auf Infrastruktur (Phase 4): Ein Teil des Luftanteils einer Front greift
// Bahnknoten, Brücken oder Fabriken hinter der Front an und fehlt dann an der Front.
import { INTACT, DAMAGED, DESTROYED } from './infra.js';
import { describeTarget } from './intel.js';
import { mods } from './research.js';
import { divisionStrength } from './economy.js';

/** Ziele hinter der gegnerischen Front in Reichweite, nächstgelegene zuerst. */
export function strikeTargets(sim, front, n, limit = 8) {
  const R = sim.bal.airstrike;
  const enemy = sim.enemyOn(front, n);
  const list = [];
  const add = (kind, id, cell) => {
    if (sim.owner[cell] !== enemy) return;
    const d = Math.hypot(cell % sim.cols - front.cx, Math.floor(cell / sim.cols) - front.cy);
    if (d <= R.rangeCells) list.push({ kind, id, d });
  };
  sim.nodes.forEach((x, i) => add('node', i, x.cell));
  sim.bridges.forEach((x, i) => add('bridge', i, x.cell));
  for (const b of sim.buildings) if (b.done && b.type !== 'forschung') add('building', b.id, b.cell);
  return list.sort((a, b) => a.d - b.d || a.id - b.id).slice(0, limit);
}

/** Abgestellte Luftstärke und Trefferchance je Tag. */
export function strikePower(sim, front, n) {
  const R = sim.bal.airstrike;
  const side = front.side[n];
  if (!side?.airShare) return { air: 0, chance: 0 };
  let air = 0;
  for (const d of sim.divisions) if (d.nation === n && d.front === front.id && !d.transit) air += d.air * divisionStrength(sim, d);
  air *= side.airShare;
  const chance = Math.min(R.maxHit, R.hitPerAirDivision * air * (1 + mods(sim, n).strike));
  return { air, chance };
}

export function runAirStrikes(sim) {
  const R = sim.bal.airstrike;
  for (const f of [...sim.fronts.values()].sort((a, b) => a.id - b.id)) {
    if (!f.alive || f.planned) continue;
    for (const n of [f.a, f.b]) {
      const side = f.side[n];
      if (!side?.airShare || !side.strikeTarget) continue;
      const d = describeTarget(sim, side.strikeTarget);
      if (!d || d.nation !== sim.enemyOn(f, n)) { side.strikeTarget = null; continue; }
      const { chance } = strikePower(sim, f, n);
      side.strikeToday = chance;
      if (sim.rng() >= chance) continue;
      const t = side.strikeTarget;
      if (t.kind === 'building') {
        d.obj.health = Math.max(0.05, d.obj.health - R.buildingDamage);
      } else {
        const st = d.obj.state === INTACT ? DAMAGED : DESTROYED;
        d.obj.state = st;
        if (sim.railState[d.cell]) {
          if (sim.railState[d.cell] === INTACT) sim.damagedRail.push(d.cell);
          sim.railState[d.cell] = Math.max(sim.railState[d.cell], st);
          sim.railProgress[d.cell] = 0;
        }
      }
      side.strikeHits = (side.strikeHits || 0) + 1;
      if (n === sim.player) sim.log('air', `Luftangriff: ${d.name} getroffen.`, d.cell);
    }
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim } from '../tools/sim_run.mjs';
import { serialize, deserialize } from '../src/sim/save.js';
import { declareWar, planDeployment, cancelPlan } from '../src/sim/diplomacy.js';

const planned = (sim, n) => [...sim.fronts.values()].filter((f) => f.alive && f.planned && f.side[sim.player] && sim.enemyOn(f, sim.player) === n);

test('Aufmarsch im Frieden: Grenzfront gegen Frankreich, Truppen sammeln, Vorbereitung, kein Kampf', () => {
  const sim = newSim({ atWar: false });
  const fra = sim.idx('FRA');
  const ids = planDeployment(sim, sim.player, fra);
  assert.ok(ids.length >= 1, 'Grenzfront entsteht');
  assert.equal(sim.wars.length, 0, 'kein Krieg');
  const f = sim.fronts.get(ids[0]);
  assert.ok(f.name.startsWith('Grenze bei'), f.name);
  const moving = sim.divisions.filter((d) => d.nation === sim.player && d.transit && ids.includes(d.transit.to)).length;
  assert.ok(moving >= 20, `${moving} Divisionen unterwegs`);
  sim.setOrder(ids[0], 'prepare');
  sim.attack(ids[0]); // ohne Krieg wirkungslos
  assert.equal(f.side[sim.player].order, 'prepare');
  const owner0 = sim.owner.slice();
  for (let d = 0; d < 20; d++) sim.tick();
  assert.ok(f.alive && f.planned);
  assert.ok(sim.divisionsOn(f.id, sim.player).length > 0, 'Truppen an der Grenze angekommen');
  assert.ok(f.side[sim.player].prep > 0.3, `Vorbereitung ${f.side[sim.player].prep}`);
  let changed = 0;
  for (let i = 0; i < sim.N; i++) if (sim.owner[i] !== owner0[i] && (owner0[i] === fra || sim.owner[i] === fra)) changed++;
  assert.equal(changed, 0, 'keine Gebietsänderung mit Frankreich');
  assert.equal(sim.divisionsOn(f.id, fra).length, 0, 'KI zieht ohne Krieg nicht an die Grenze');
});

test('Aufmarsch → Kriegserklärung: Front behält Kennung, Divisionen und Vorbereitung', () => {
  const sim = newSim({ atWar: false });
  const fra = sim.idx('FRA');
  const ids = planDeployment(sim, sim.player, fra);
  for (const id of ids) sim.setOrder(id, 'prepare');
  for (let d = 0; d < 25; d++) sim.tick();
  const main = planned(sim, fra).sort((x, y) => y.length - x.length)[0];
  const divs = sim.divisionsOn(main.id, sim.player).length;
  const prep = main.side[sim.player].prep;
  assert.ok(declareWar(sim, sim.player, fra));
  assert.equal(sim.dip.plans.length, 0);
  const after = sim.fronts.get(main.id);
  assert.ok(after.alive && !after.planned, 'gleiche Front, jetzt im Krieg');
  assert.ok(after.name.startsWith('Front bei'), after.name);
  assert.ok(sim.divisionsOn(main.id, sim.player).length >= divs);
  assert.ok(after.side[sim.player].prep >= prep - 1e-9);
  sim.attack(main.id);
  assert.equal(after.side[sim.player].order, 'attack');
});

test('Aufmarsch aufheben und Speicherstand: identischer Verlauf', () => {
  const sim = newSim({ atWar: false });
  const fra = sim.idx('FRA');
  const bel = sim.idx('BEL');
  planDeployment(sim, sim.player, fra);
  planDeployment(sim, sim.player, bel);
  for (let d = 0; d < 5; d++) sim.tick();
  assert.ok(cancelPlan(sim, sim.player, bel) >= 1);
  assert.equal(planned(sim, bel).length, 0);
  assert.ok(planned(sim, fra).length >= 1);
  const data = serialize(sim);
  const copy = newSim({ atWar: false });
  deserialize(copy, JSON.parse(JSON.stringify(data)));
  assert.ok(planned(copy, fra).length >= 1, 'Aufmarsch geladen');
  for (let d = 0; d < 30; d++) { sim.tick(); copy.tick(); }
  assert.equal(copy.stateHash(), sim.stateHash());
});

test('Taktik und Haltelinie: Blitzkrieg schneller als Materialschlacht, Linie stoppt den Vormarsch', async () => {
  const { objectiveMask } = await import('../src/sim/combat.js');
  const run = (tactic, line) => {
    const sim = newSim({ seed: 7 });
    const pol = sim.idx('POL');
    const fs = [...sim.fronts.values()].filter((f) => f.alive && f.side[sim.player] && sim.enemyOn(f, sim.player) === pol);
    for (const f of fs) { sim.setTactic(f.id, tactic); if (line) sim.setObjective(f.id, line(sim, f)); sim.attack(f.id); }
    let cells = 0;
    for (let d = 0; d < 6; d++) { sim.tick(); }
    for (let i = 0; i < sim.N; i++) if (sim.startOwner[i] === pol && sim.owner[i] === sim.player) cells++;
    return { sim, cells };
  };
  const blitz = run('blitzkrieg').cells;
  const mat = run('material').cells;
  assert.ok(blitz > mat, `Blitzkrieg ${blitz} > Materialschlacht ${mat}`);
  // Haltelinie 3 Felder hinter der größten Front: kaum tiefer als die Linie
  const lined = run('standard', (sim, f) => {
    const cells = sim.frontCellsOf(f, sim.enemyOn(f, sim.player));
    const xs = cells.map((c) => c % sim.cols);
    const ys = cells.map((c) => Math.floor(c / sim.cols));
    // waagerechte Linie knapp hinter der Front (nach Süden/Osten egal: Maske prüft Erreichbarkeit)
    return [[Math.min(...xs) - 5, Math.max(...ys) + 3], [Math.max(...xs) + 5, Math.max(...ys) + 3]];
  });
  const free = run('standard').cells;
  assert.ok(lined.cells <= free, `Linie ${lined.cells} ≤ frei ${free}`);
  const f = [...lined.sim.fronts.values()].find((x) => x.alive && x.side[lined.sim.player]?.objective);
  if (f) assert.ok(objectiveMask(lined.sim, f, lined.sim.player, lined.sim.enemyOn(f, lined.sim.player)));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim } from '../tools/sim_run.mjs';
import { serialize, deserialize } from '../src/sim/save.js';
import { declareWar, offerAnschluss, offerRohstoffe, anschlussScore, changeRelation, actionsFor } from '../src/sim/diplomacy.js';
import { startGoal, goalState, goalList } from '../src/sim/goals.js';

test('Start 01.03.1939: Tschecho-Slowakei, Memelland litauisch, kein Krieg; Ereignisse im März', () => {
  const sim = newSim({ atWar: false });
  assert.equal(sim.dateText(0), '1. März 1939');
  assert.equal(sim.wars.length, 0);
  const csr = sim.idx('CSR');
  const prag = sim.cities.find((c) => c.name === 'Prag');
  const memel = sim.cities.find((c) => c.name === 'Memel');
  assert.equal(sim.owner[prag.cell], csr);
  assert.equal(sim.owner[memel.cell], sim.idx('LTU'));
  for (let d = 0; d < 40; d++) sim.tick();
  assert.equal(sim.owner[prag.cell], sim.player, 'Prag am 15.03.');
  assert.equal(sim.owner[memel.cell], sim.player, 'Memel am 23.03.');
  const pressburg = sim.cities.find((c) => c.name === 'Preßburg');
  assert.equal(sim.owner[pressburg.cell], sim.idx('SVK'));
  assert.equal(sim.capital.get(sim.idx('SVK')), pressburg.cell);
  assert.equal(sim.ownedCount[csr], 0);
  assert.equal(sim.divisions.filter((d) => d.nation === csr).length, 0, 'tschechoslowakische Divisionen aufgelöst');
  assert.ok(sim.dip.annexed.length >= 4);
  assert.equal(sim.conqDay[prag.cell], -1, 'friedlich: kein Ertragsverlust');
});

test('Kriegserklärung: Reserve marschiert auf, Danzig wird angegliedert', () => {
  const sim = newSim({ atWar: false });
  const pol = sim.idx('POL');
  declareWar(sim, sim.player, pol);
  const onFront = sim.divisions.filter((d) => d.nation === sim.player && (d.front || d.transit)).length;
  assert.ok(onFront >= 40, `${onFront} Divisionen an der Front`);
  const danzig = sim.cities.find((c) => c.name === 'Danzig');
  assert.equal(sim.owner[danzig.cell], sim.player);
});

test('Kleine Staaten: Krieg erklären möglich, Anschluss nach Druck und Beziehung, Rohstoffabkommen', () => {
  const sim = newSim({ atWar: false });
  const p = sim.player;
  const lux = sim.idx('LUX');
  const che = sim.idx('CHE');
  assert.ok(actionsFor(sim, che).anschluss && !actionsFor(sim, sim.idx('FRA')).anschluss);
  const r1 = offerAnschluss(sim, che);
  assert.equal(r1.ok, false, r1.text);
  changeRelation(sim, p, lux, 60);
  const score = anschlussScore(sim, lux);
  const r2 = offerAnschluss(sim, lux);
  assert.equal(r2.ok, score >= sim.bal.diplomacy.anschluss.need, r2.text);
  if (r2.ok) assert.equal(sim.ownedCount[lux], 0);
  sim.econ.get(p).money = 500;
  const r3 = offerRohstoffe(sim, sim.idx('SWE'));
  assert.equal(r3.ok, true, r3.text);
  const res0 = sim.econ.get(p).resources;
  sim.tick();
  assert.ok(sim.dip.effects.some((x) => x.kind === 'rohstoffe'));
  assert.ok(Number.isFinite(sim.econ.get(p).resources) && sim.econ.get(p).resources !== res0);
  // Krieg gegen Belgien: Fronten entstehen, Belgien verteidigt sich
  const bel = sim.idx('BEL');
  assert.ok(declareWar(sim, p, bel));
  assert.ok([...sim.fronts.values()].some((f) => f.alive && f.side[bel]));
  for (let d = 0; d < 10; d++) sim.tick();
  assert.ok(sim.divisions.some((d) => d.nation === bel && d.front));
});

test('Nationale Ziele: Voraussetzungen, Dauer, Wirkung, Speichern', () => {
  const sim = newSim({ atWar: false });
  assert.equal(goalState(sim, 'panzerwaffe'), 'gesperrt');
  assert.ok(startGoal(sim, 'aufruestung'));
  assert.equal(startGoal(sim, 'vierjahresplan'), false, 'nur ein Ziel gleichzeitig');
  const days = goalList(sim).find((g) => g.id === 'aufruestung').days;
  for (let d = 0; d < days; d++) sim.tick();
  assert.equal(goalState(sim, 'aufruestung'), 'fertig');
  assert.equal(goalState(sim, 'panzerwaffe'), 'frei');
  assert.ok(sim.dip.effects.some((x) => x.kind === 'armament' && x.nation === sim.player));
  startGoal(sim, 'panzerwaffe');
  const b = newSim({ atWar: false });
  deserialize(b, JSON.parse(JSON.stringify(serialize(sim))));
  assert.equal(b.goals.current.id, 'panzerwaffe');
  for (let d = 0; d < 20; d++) { sim.tick(); b.tick(); }
  assert.equal(sim.stateHash(), b.stateHash());
});

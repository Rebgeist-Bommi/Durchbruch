import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim, runCampaign } from '../tools/sim_run.mjs';
import { serialize, deserialize } from '../src/sim/save.js';
import { historySize } from '../src/sim/history.js';
import { autoplayAllAttack } from '../src/sim/autoplay.js';
import { siteFields, siteSuitability, build, raiseDivision } from '../src/sim/economy.js';
import { DAMAGED, INTACT } from '../src/sim/infra.js';

const avg = (a) => a.reduce((s, v) => s + v, 0) / a.length;

test('Deutschland 1 Jahr ohne Krieg (Standardwerte): Geld und Produktion stabil oder wachsend', () => {
  const sim = newSim({ peace: true });
  const de = sim.econ.get(sim.player);
  const money0 = de.money;
  const income = [];
  const equip = [];
  for (let d = 0; d < 365; d++) {
    sim.tick();
    income.push(de.incomeToday);
    equip.push(de.equipToday);
  }
  const early = avg(income.slice(0, 60));
  const late = avg(income.slice(-60));
  const eqEarly = avg(equip.slice(0, 60));
  const eqLate = avg(equip.slice(-60));
  console.log(`  Geld ${money0.toFixed(0)} -> ${de.money.toFixed(0)} | Einnahmen/Tag ${early.toFixed(1)} -> ${late.toFixed(1)} | Ausrüstung/Tag ${eqEarly.toFixed(2)} -> ${eqLate.toFixed(2)} | Bestand ${de.equipment.toFixed(0)}`);
  assert.ok(de.money >= money0, 'Geld wächst');
  assert.ok(late >= early * 0.98, 'Einnahmen stabil');
  assert.ok(eqLate >= eqEarly * 0.95, 'Rüstungsproduktion stabil');
});

test('Mobilisierung hoch: Produktion sinkt sichtbar', () => {
  const run = (level) => {
    const sim = newSim({ peace: true });
    const de = sim.econ.get(sim.player);
    de.mobLevel = level;
    const inc = [];
    const eq = [];
    for (let d = 0; d < 30; d++) { sim.tick(); inc.push(de.incomeToday); eq.push(de.equipToday); }
    return { inc: avg(inc), eq: avg(eq), workers: de.workers };
  };
  const std = run(2);
  const high = run(4);
  console.log(`  Einnahmen ${std.inc.toFixed(1)} -> ${high.inc.toFixed(1)} (${((high.inc / std.inc - 1) * 100).toFixed(0)} %), Ausrüstung ${std.eq.toFixed(2)} -> ${high.eq.toFixed(2)} (${((high.eq / std.eq - 1) * 100).toFixed(0)} %)`);
  assert.ok(high.inc < std.inc * 0.92, 'Einnahmen sinken deutlich');
  assert.ok(high.eq < std.eq * 0.92, 'Ausrüstung sinkt deutlich');
  assert.ok(high.workers < std.workers);
});

test('Polenfeldzug läuft weiterhin bis zur Kapitulation', () => {
  const sim = runCampaign({ seed: 1939 });
  const pol = sim.nations.get(sim.idx('POL'));
  console.log(`  Kapitulation an Tag ${pol.capitulationDay} (Phase 2: Tag 35, historisch Tag 36)`);
  assert.equal(pol.status, 'kapituliert');
  assert.ok(pol.capitulationDay <= 60);
  // Bahn: eroberte Strecken wurden beschädigt und teilweise wieder instand gesetzt
  let repaired = 0;
  let open = 0;
  for (let i = 0; i < sim.N; i++) {
    if (sim.startOwner[i] !== sim.idx('POL') || !sim.startRail[i]) continue;
    if (sim.railState[i] === INTACT) repaired++; else open++;
  }
  console.log(`  ehemals polnische Bahnfelder: ${repaired} instand gesetzt, ${open} noch beschädigt/zerstört`);
  assert.ok(repaired > 0 && open > 0);
  const kb = historySize(sim) / 1024;
  console.log(`  Momentaufnahmen: ${sim.history.days.length} Tage, ${kb.toFixed(1)} kB`);
  assert.ok(kb < 100);
});

test('Speichern und Laden: 30 Tage nach dem Laden identisch mit ununterbrochenem Lauf', () => {
  const a = newSim({ seed: 77 });
  a.autoplay = autoplayAllAttack;
  for (let d = 0; d < 12; d++) a.tick();
  const text = JSON.stringify(serialize(a));
  const b = newSim({ seed: 77 });
  deserialize(b, JSON.parse(text));
  b.autoplay = autoplayAllAttack;
  assert.equal(a.stateHash(), b.stateHash(), 'direkt nach dem Laden gleich');
  for (let d = 0; d < 30; d++) { a.tick(); b.tick(); }
  console.log(`  Spielstand ${(text.length / 1024).toFixed(0)} kB (Text), Prüfsumme nach 30 Tagen ${a.stateHash()} / ${b.stateHash()}`);
  assert.equal(a.day, b.day);
  assert.equal(a.stateHash(), b.stateHash());
  assert.deepEqual(a.events.map((e) => e.text), b.events.map((e) => e.text));
  assert.deepEqual(JSON.stringify([...a.econ]), JSON.stringify([...b.econ]));
  assert.deepEqual(JSON.stringify(a.divisions), JSON.stringify(b.divisions));
  assert.deepEqual([...a.railState], [...b.railState]);
});

test('KI-Nationen führen ihre Wirtschaft selbst (1 Jahr Frieden)', () => {
  const sim = newSim({ peace: true });
  const before = new Map([...sim.econ].map(([n]) => [n, sim.divisions.filter((d) => d.nation === n).length]));
  for (let d = 0; d < 365; d++) sim.tick();
  let builders = 0;
  for (const [n, e] of sim.econ) {
    if (!e.ai) continue;
    const built = sim.buildings.filter((b) => b.nation === n && b.started !== undefined).length;
    const divs = sim.divisions.filter((d) => d.nation === n).length - before.get(n);
    if (built) builders++;
    console.log(`  ${sim.code(n)}: Geld ${e.money.toFixed(0)}, Bauaufträge ${built}, neue Divisionen ${divs}, Mobilisierung ${e.mobLevel}`);
    assert.ok(Number.isFinite(e.money));
  }
  assert.ok(builders >= 4, 'mehrere KI-Nationen bauen');
});

test('Standortwahl: Eignung mit Begründung, Bauauftrag kostet Zeit', () => {
  const sim = newSim({ peace: true });
  const n = sim.player;
  const F = siteFields(sim, n);
  const ruhr = sim.industrySites.find((s) => s.name === 'Ruhrgebiet').cell;
  const good = siteSuitability(sim, n, ruhr, 'ruestung', F);
  assert.ok(good.ok && good.score > 0.6 && good.reasons.length === 4, JSON.stringify(good));
  const res = build(sim, n, 'fabrik', ruhr, F);
  assert.ok(res && !res.building.done);
  for (let d = 0; d < sim.bal.economy.buildings.fabrik.days + 2; d++) sim.tick();
  assert.ok(res.building.done, 'nach Bauzeit fertig');
});

test('Neue Division braucht Soldaten und Ausrüstung', () => {
  const sim = newSim({ peace: true });
  const e = sim.econ.get(sim.player);
  e.pool = 15000;
  e.equipment = 30;
  e.tankEquipment = 0;
  const d = raiseDivision(sim, sim.player, 0.05);
  assert.ok(d, 'Division aufgestellt');
  assert.ok(d.equip < sim.bal.economy.equipmentPerDivision, 'unvollständig ausgerüstet');
  e.pool = 0;
  assert.equal(raiseDivision(sim, sim.player, 0.05), null, 'ohne Soldaten keine Division');
});

test('Eroberte Bahn ist beschädigt', () => {
  const sim = newSim({ seed: 5 });
  const pl = sim.idx('POL');
  let cell = -1;
  for (let i = 0; i < sim.N; i++) if (sim.owner[i] === pl && sim.railState[i] === INTACT) { cell = i; break; }
  sim.setOwner(cell, sim.player, 1);
  assert.equal(sim.railState[cell], DAMAGED);
});

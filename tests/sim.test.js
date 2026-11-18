import test from 'node:test';
import assert from 'node:assert/strict';
import { runCampaign, loadInputs, newSim } from '../tools/sim_run.mjs';

const SEED = 1939;

function freshSim(seed = SEED) {
  return newSim({ seed });
}

test('Testlauf ohne Spieler: Polen kapituliert (alle Fronten auf Angriff)', () => {
  const sim = runCampaign({ seed: SEED });
  const pol = sim.nations.get(sim.idx('POL'));
  console.log(`  Kapitulation Polens an Tag ${pol.capitulationDay} (${sim.dateText(pol.capitulationDay)}); historisch: 6. Oktober 1939 = Tag 36`);
  assert.equal(pol.status, 'kapituliert');
  const warDays = pol.capitulationDay - pol.warSince;
  console.log(`  Kriegsdauer bis zur Kapitulation: ${warDays} Tage`);
  assert.ok(warDays >= 20 && warDays <= 60, `Dauer ${warDays} Tage`);
  const warsaw = sim.sieges.find((s) => s.city.name === 'Warschau');
  assert.ok(warsaw.fallen, 'Warschau muss gefallen sein');
  assert.ok(sim.events.some((e) => e.type === 'capitulation'));
  assert.ok(sim.events.some((e) => e.type === 'city'));
});

test('Reproduzierbar: zwei Läufe mit gleichem Seed ergeben dasselbe Ergebnis', () => {
  const a = runCampaign({ seed: SEED });
  const b = runCampaign({ seed: SEED });
  assert.equal(a.day, b.day);
  assert.equal(a.stateHash(), b.stateHash());
  assert.deepEqual(a.events.map((e) => e.text), b.events.map((e) => e.text));
  const c = runCampaign({ seed: SEED + 1 });
  assert.notEqual(a.stateHash() + a.events.length, c.stateHash() + c.events.length, 'anderer Seed sollte abweichen');
});

test('Leistung: Tickdauer messen (Ziel höchstens 16 ms)', () => {
  const sim = runCampaign({ seed: SEED });
  const ms = sim.tickMs.filter((v) => v > 0);
  const sorted = [...ms].sort((x, y) => x - y);
  const mean = ms.reduce((s, v) => s + v, 0) / ms.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const max = sorted.at(-1);
  console.log(`  Tick: Mittel ${mean.toFixed(2)} ms, 95 % ${p95.toFixed(2)} ms, Max ${max.toFixed(2)} ms (${ms.length} Ticks)`);
  assert.ok(mean < 16 && p95 < 16, `Mittel ${mean} / 95 % ${p95}`);
});

test('Divisionen haben Panzer- und Luftanteil zwischen 0 und 100 %', () => {
  const sim = freshSim();
  assert.ok(sim.divisions.length > 50);
  for (const d of sim.divisions) {
    assert.ok(d.tank >= 0 && d.tank <= 1 && d.air >= 0 && d.air <= 1);
  }
  assert.ok(sim.reserveOf(sim.player).length > 0, 'Reserve vorhanden');
});

test('balance.json ist als Platzhalter gekennzeichnet', () => {
  const { balance } = loadInputs();
  assert.match(balance._hinweis, /# TODO historisch prüfen/);
  assert.match(balance.divisions._todo, /# TODO historisch prüfen/);
  assert.ok(balance.capitulation.lostShare > 0 && balance.capitulation.lostShare < 1);
});

test('Fronten: automatisch an der deutsch-polnischen Grenze, in Abschnitte geteilt', () => {
  const sim = freshSim();
  const fronts = [...sim.fronts.values()].filter((f) => f.alive);
  assert.ok(fronts.length >= 2, `${fronts.length} Fronten`);
  for (const f of fronts) {
    assert.ok(f.sections.length >= 1);
    const km = f.length * 9;
    assert.ok(km / f.sections.length < 260, `Abschnitt zu lang: ${km / f.sections.length} km`);
  }
});

test('Befehle: Vorbereitung baut Angriffsbonus auf, Halten befestigt', () => {
  const sim = freshSim();
  const f = [...sim.fronts.values()].find((x) => x.alive);
  const de = sim.player;
  const pl = sim.enemyOn(f, de);
  sim.setOrder(f.id, 'prepare');
  f.side[de].prep = 0;
  const cell = sim.frontCellsOf(f, pl)[0];
  const fort0 = sim.fort[cell];
  sim.tick();
  const g = sim.frontAt(cell) || f;
  assert.ok(g.side[de].prep > 0, 'Vorbereitung steigt');
  assert.ok(sim.fort[cell] > fort0 || sim.owner[cell] !== pl, 'Befestigung steigt');
});

test('Belagerung: Warschau fällt nicht wie ein normales Feld', () => {
  const sim = freshSim();
  const s = sim.sieges.find((x) => x.capital && sim.code(x.nation) === 'POL');
  assert.ok(s && s.defense > 0);
  // alle Nachbarn deutsch machen -> Belagerung beginnt, Stadt bleibt polnisch
  for (const j of sim.nb.subarray(s.cell * 4, s.cell * 4 + 4)) if (j >= 0) sim.setOwner(j, sim.player, 1, true);
  // Aufmarsch abgeschlossen (die Reserve marschiert seit Überarbeitung 2 mit Verlegungsdauer)
  for (const d of sim.divisions) if (d.transit) { d.front = d.transit.to; d.transit = null; }
  for (const f of sim.fronts.values()) if (f.side[sim.player]) sim.attack(f.id);
  sim.tick();
  assert.equal(sim.owner[s.cell], sim.idx('POL'));
  assert.ok(s.besieged && s.defense < s.max);
});

test('Kessel: kleine Restflächen fallen sofort', () => {
  const sim = freshSim();
  const pl = sim.idx('POL');
  const cap = sim.capital.get(pl);
  const ring = (t) => [-1, 0, 1].flatMap((dr) => [-1, 0, 1].map((dc) => t + dr * sim.cols + dc)).filter((x) => x !== t);
  // polnisches Feld, dessen 3×3-Umgebung vollständig polnisches Land ohne Städte ist
  let target = -1;
  for (let i = cap + 40; i < sim.N && target < 0; i++) {
    if (sim.owner[i] !== pl) continue;
    if ([i, ...ring(i)].every((x) => sim.owner[x] === pl && sim.cityAt[x] < 0)) target = i;
  }
  assert.ok(target >= 0);
  for (const j of ring(target)) sim.setOwner(j, sim.player, 1, true); // geschlossener Ring aus 8 Feldern
  sim.tick();
  assert.equal(sim.owner[target], sim.player, 'eingeschlossenes Einzelfeld fällt sofort');
});

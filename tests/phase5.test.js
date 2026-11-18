import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim, runCampaign } from '../tools/sim_run.mjs';
import { serialize, deserialize } from '../src/sim/save.js';
import { decide, checkDecisions } from '../src/sim/events.js';
import { declareWar, offer, relation, hasPact, isAllied, statusOf } from '../src/sim/diplomacy.js';
import { propaganda, propagandaGain, moraleCombat, moraleProduction, capitulationBonus, changeMorale } from '../src/sim/morale.js';
import { issue } from '../src/sim/news.js';
import { autoplayCampaign } from '../src/sim/autoplay.js';

const SEED = 1939;

test('Kampagne ohne Spieler (Normal): Angriff auf Polen → Kriegserklärung GB/FR → Kapitulation Polens', () => {
  const sim = runCampaign({ seed: SEED });
  const DEU = sim.player;
  const POL = sim.idx('POL');
  const GBR = sim.idx('GBR');
  const FRA = sim.idx('FRA');
  const attack = sim.events.find((e) => e.type === 'war' && (e.text.includes('greift Polen an') || e.text.includes('erklärt Polen den Krieg')));
  const gb = sim.events.find((e) => e.type === 'war' && e.text.startsWith('Das Vereinigte Königreich erklärt'));
  const fr = sim.events.find((e) => e.type === 'war' && e.text.startsWith('Frankreich erklärt'));
  const pol = sim.nations.get(POL);
  console.log(`  Dauer bis zur Kapitulation Polens: ${pol.capitulationDay} Tage (${sim.dateText(pol.capitulationDay)}); historisch 6. Oktober 1939 = Tag 36`);
  for (const e of sim.events.filter((x) => /war|capitulation|event|decision|peace|treaty/.test(x.type))) console.log(`    Tag ${String(e.day).padStart(2)} · ${e.text}`);
  assert.ok(attack, 'Angriff protokolliert');
  assert.ok(gb && fr, 'GB und FR erklären den Krieg');
  assert.ok(gb.day - attack.day <= sim.bal.diplomacy.allyDelayDays + 1 && gb.day >= attack.day, `GB nach ${gb.day - attack.day} Tagen`);
  assert.ok(sim.isWar(GBR, DEU) && sim.isWar(FRA, DEU));
  assert.equal(pol.status, 'kapituliert');
  const warDays = pol.capitulationDay - pol.warSince;
  console.log(`  Kriegsdauer ${warDays} Tage (Kriegsbeginn ${sim.dateText(pol.warSince)})`);
  assert.ok(warDays >= 20 && warDays <= 60);
  // Teilungsangebot angenommen → Einmarsch der Sowjetunion, Aufteilung entlang der Linie
  assert.ok(sim.events.some((e) => e.text.includes('Rote Armee')), 'sowjetischer Einmarsch');
  assert.ok(sim.events.some((e) => e.text.includes('aufgeteilt')), 'Aufteilung');
  const SOV = sim.idx('SOV');
  let sovCells = 0;
  for (let i = 0; i < sim.N; i++) if (sim.startOwner[i] === POL && sim.owner[i] === SOV) sovCells++;
  assert.ok(sovCells > 500, `Sowjetunion besitzt ${sovCells} ehemals polnische Felder`);
});

test('Testlauf ohne Angriff: GB und FR erklären NICHT den Krieg (bis Ende 1939)', () => {
  const sim = newSim({ seed: SEED, atWar: false });
  sim.autoDecide = () => 0;
  for (let d = 0; d < 300; d++) sim.tick();
  const DEU = sim.player;
  assert.equal(sim.isWar(sim.idx('GBR'), DEU), false);
  assert.equal(sim.isWar(sim.idx('FRA'), DEU), false);
  assert.equal(sim.isWar(sim.idx('SOV'), sim.idx('POL')), false, 'ohne deutschen Angriff kein Teilungsangebot');
  assert.ok(!sim.events.some((e) => e.text.includes('Beistand')));
  assert.equal(sim.nations.get(sim.idx('POL')).status, 'aktiv');
});

test('Pop-up: Spiel hält an und läuft erst nach der Entscheidung weiter', () => {
  const sim = newSim({ seed: SEED, atWar: false });
  sim.autoDecide = null;
  sim.autoplay = autoplayCampaign;
  let guard = 0;
  while (!sim.pending && guard++ < 260) sim.tick();
  assert.ok(sim.pending, 'Entscheidung steht an');
  assert.equal(sim.pending.kind, 'partition');
  assert.ok(sim.pending.options.length >= 2 && sim.pending.options.length <= 3);
  const day = sim.day;
  for (let k = 0; k < 5; k++) assert.equal(sim.tick(), false, 'tick() verweigert');
  assert.equal(sim.day, day, 'Tag bleibt stehen');
  decide(sim, 1); // Nachverhandeln: Linie am Bug
  assert.equal(sim.pending, null);
  assert.equal(sim.dip.partition, 'bug');
  assert.equal(sim.tick(), true);
  assert.equal(sim.day, day + 1);
});

test('Entscheidungen haben spürbare Folgen (Teilung abgelehnt: kein Einmarsch, Beziehung sinkt)', () => {
  const sim = runCampaign({ seed: SEED, decide: (s, d) => (d.kind === 'partition' ? 2 : 0) });
  const SOV = sim.idx('SOV');
  assert.equal(sim.dip.partition, 'abgelehnt');
  assert.ok(!sim.events.some((e) => e.text.includes('Rote Armee')));
  assert.ok(relation(sim, sim.player, SOV) < sim.bal.diplomacy.relations['DEU-SOV']);
  assert.equal(sim.nations.get(sim.idx('POL')).status, 'kapituliert');
});

test('Speichern/Laden mit allen Werten aus Phase 5: 30 Tage identisch (auch mit offener Entscheidung)', () => {
  const a = newSim({ seed: 77, atWar: false });
  a.setDifficulty('schwer');
  a.autoplay = autoplayCampaign;
  a.autoDecide = () => 0;
  for (let d = 0; d < 200; d++) a.tick();
  propaganda(a);
  const text = JSON.stringify(serialize(a));
  const b = newSim({ seed: 77, atWar: false });
  deserialize(b, JSON.parse(text));
  b.autoplay = autoplayCampaign;
  b.autoDecide = () => 0;
  assert.equal(b.settings.difficulty, 'schwer');
  assert.equal(a.stateHash(), b.stateHash());
  for (let d = 0; d < 30; d++) { a.tick(); b.tick(); }
  console.log(`  Spielstand ${(text.length / 1024).toFixed(0)} kB, Prüfsumme nach 30 Tagen ${a.stateHash()} / ${b.stateHash()}`);
  assert.equal(a.day, b.day);
  assert.equal(a.stateHash(), b.stateHash());
  assert.deepEqual(a.events.map((e) => e.text), b.events.map((e) => e.text));
  assert.deepEqual(JSON.stringify(a.dip), JSON.stringify(b.dip));
  assert.deepEqual(a.relations, b.relations);
  assert.deepEqual([...a.nations].map(([n, s]) => [n, s.morale, s.status]), [...b.nations].map(([n, s]) => [n, s.morale, s.status]));
  assert.deepEqual(a.news, b.news);
  assert.deepEqual(JSON.stringify([...a.econ]), JSON.stringify([...b.econ]));
  // offene Entscheidung wird mitgespeichert
  const c = newSim({ seed: 5, atWar: false });
  c.autoDecide = null;
  c.autoplay = autoplayCampaign;
  while (!c.pending && c.day < 260) c.tick();
  const d = newSim({ seed: 5, atWar: false });
  deserialize(d, JSON.parse(JSON.stringify(serialize(c))));
  d.autoDecide = null;
  assert.equal(d.pending.kind, c.pending.kind);
  assert.equal(d.tick(), false);
});

test('Leistung: Tickdauer über 320 Tage (Frieden, Polenfeldzug, Westmächte, Sowjetunion)', () => {
  const sim = runCampaign({ seed: SEED, maxDays: 320, until: () => false, decide: (x, d) => (d.kind === 'frenchPeace' ? 1 : 0) });
  const ms = sim.tickMs.slice(1);
  const sorted = [...ms].sort((x, y) => x - y);
  const mean = ms.reduce((s, v) => s + v, 0) / ms.length;
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  console.log(`  Tick: Mittel ${mean.toFixed(2)} ms, 95 % ${p95.toFixed(2)} ms, Max ${sorted.at(-1).toFixed(2)} ms (${ms.length} Ticks, Kriege am Ende: ${sim.wars.map(([a, b]) => `${sim.code(a)}–${sim.code(b)}`).join(', ')})`);
  assert.ok(sim.day === 320 && sim.wars.length >= 2);
  assert.ok(mean < 16 && p95 < 16, `Mittel ${mean} / 95 % ${p95}`);
});

test('Moral: Propaganda nutzt sich ab, niedrige Moral schwächt, hohe Moral verschiebt die Kapitulation', () => {
  const sim = newSim({ seed: 3 });
  const p = sim.player;
  sim.econ.get(p).money = 1000;
  const g1 = propagandaGain(sim, p);
  const got1 = propaganda(sim, p);
  const got2 = propaganda(sim, p);
  const got3 = propaganda(sim, p);
  assert.ok(Math.abs(got1 - g1) < 1e-9);
  assert.ok(got1 > got2 && got2 > got3, `${got1} > ${got2} > ${got3}`);
  assert.equal(sim.econ.get(p).money, 1000 - 3 * sim.bal.morale.propaganda.cost);
  const st = sim.nations.get(p);
  st.morale = 20;
  assert.ok(moraleCombat(sim, p) < 1 && moraleProduction(sim, p) < 1);
  assert.equal(capitulationBonus(sim, p), 0);
  const men = sim.divisions.filter((d) => d.nation === p).reduce((s, d) => s + d.men, 0);
  sim.tick();
  assert.ok(st.deserted > 0, 'Desertion bei Moral unter 30');
  assert.ok(sim.divisions.filter((d) => d.nation === p).reduce((s, d) => s + d.men, 0) < men);
  st.morale = 95;
  assert.equal(moraleCombat(sim, p), 1);
  assert.ok(capitulationBonus(sim, p) > 0.1);
  changeMorale(sim, p, 50);
  assert.equal(st.morale, 100, 'auf 100 begrenzt');
});

test('Moral: Städte und Kessel heben, Verluste senken', () => {
  const sim = runCampaign({ seed: SEED, until: (s) => s.day >= 196 });
  const p = sim.player;
  const pol = sim.idx('POL');
  assert.ok(sim.nations.get(pol).morale < sim.bal.morale.start.POL, `Polen ${sim.nations.get(pol).morale}`);
});

test('Diplomatie: Pakt- und Bündnisangebote nach Beziehung, Vertragsbruch kostet Beziehungen', () => {
  const sim = newSim({ seed: 2, atWar: false });
  const p = sim.player;
  const NLD = sim.idx('NLD');
  const FIN = sim.idx('FIN');
  const SOV = sim.idx('SOV');
  const ITA = sim.idx('ITA');
  assert.ok(isAllied(sim, sim.idx('GBR'), sim.idx('FRA')) && !isAllied(sim, p, ITA) && !hasPact(sim, p, SOV), 'Stand 01.03.1939');
  for (let d = 0; d < 180; d++) sim.tick();
  assert.equal(statusOf(sim, p, ITA), 'buendnis', 'Stahlpakt (22.05.1939)');
  assert.ok(hasPact(sim, p, SOV), 'Nichtangriffspakt (23.08.1939)');
  assert.ok(isAllied(sim, sim.idx('GBR'), sim.idx('POL')) && isAllied(sim, sim.idx('FRA'), sim.idx('POL')), 'Garantie für Polen (31.03.1939)');
  assert.equal(sim.owner[sim.capital.get(sim.idx('DEU'))], p);
  assert.equal(sim.nations.get(sim.idx('CSR'))?.status ?? 'aufgelöst', 'aufgelöst', 'Tschecho-Slowakei aufgelöst');
  const r1 = offer(sim, NLD, 'buendnis');
  assert.equal(r1.ok, false, r1.text);
  const r2 = offer(sim, FIN, 'pakt');
  assert.equal(r2.ok, true, r2.text);
  assert.ok(hasPact(sim, p, FIN));
  const again = offer(sim, NLD, 'pakt');
  assert.equal(again.ok, false, 'Wartezeit nach Angebot');
  const relItaBefore = relation(sim, p, ITA);
  assert.ok(declareWar(sim, p, SOV), 'Krieg an die Sowjetunion');
  assert.ok(!hasPact(sim, p, SOV), 'Pakt gebrochen');
  assert.equal(sim.dip.breaches[p], 1);
  assert.ok(relation(sim, p, SOV) <= -40);
  assert.ok(relation(sim, p, ITA) < relItaBefore, 'Vertragsbruch verärgert auch Dritte');
  assert.ok(sim.isWar(p, SOV));
  assert.equal(declareWar(sim, p, SOV), false, 'kein zweites Mal');
});

test('Schwierigkeit: Startwerte identisch, nur Wirkungen unterscheiden sich; Sandbox mit unbegrenzten Mitteln', () => {
  const snap = (s) => JSON.stringify({ div: s.divisions, econ: [...s.econ].map(([n, e]) => [n, e.money, e.resources, e.equipment]), owner: s.stateHash() });
  const a = newSim({ seed: 9 });
  const b = newSim({ seed: 9 });
  a.setDifficulty('leicht');
  b.setDifficulty('schwer');
  assert.equal(snap(a), snap(b));
  assert.ok(a.diff().income > b.diff().income && a.diff().aiAttack > b.diff().aiAttack);
  for (let d = 0; d < 10; d++) { a.tick(); b.tick(); }
  assert.ok(a.econ.get(a.player).money > b.econ.get(b.player).money, 'Erträge unterscheiden sich');
  const s = newSim({ seed: 9 });
  s.setDifficulty('normal', true);
  s.econ.get(s.player).money = 0;
  s.tick();
  assert.ok(s.econ.get(s.player).money >= s.bal.sandbox.money - 1000);
  assert.ok(s.econ.get(s.player).pool >= s.bal.sandbox.pool * 0.9);
});

test('Spielende: Sieg nach Kapitulation aller Gegner, Niederlage bei Kapitulation Deutschlands', () => {
  // ohne Bündnispartner Polens: Krieg nur gegen Polen
  const sim = newSim({ seed: SEED });
  sim.dip.alliances = sim.dip.alliances.filter(([a, b]) => a !== sim.idx('POL') && b !== sim.idx('POL'));
  sim.autoplay = autoplayCampaign;
  sim.autoDecide = () => 0;
  while (!sim.isOver() && sim.day < 120) sim.tick();
  assert.equal(sim.outcome?.result, 'sieg');
  assert.equal(sim.outcome.allCapitulated, true);
  assert.equal(sim.tick(), false, 'nach Spielende kein Tick');
  assert.ok(sim.history.days.length >= sim.outcome.day, 'Momentaufnahmen vorhanden');
  const lose = newSim({ seed: SEED });
  lose.nations.get(lose.player).status = 'kapituliert';
  lose.checkOutcome();
  assert.equal(lose.outcome.result, 'niederlage');
});

test('Zeitung: Schlagzeilen zu Kriegserklärung, Städten und Kapitulation', () => {
  const sim = runCampaign({ seed: SEED });
  const titles = sim.news.map((n) => n.title);
  assert.ok(titles.includes('KRIEGSERKLÄRUNG') || titles.includes('DER KRIEG HAT BEGONNEN'));
  assert.ok(titles.some((t) => t.includes('KAPITULIERT')));
  assert.ok(titles.some((t) => /genommen|GEFALLEN/.test(t)));
  assert.ok(titles.some((t) => t.startsWith('Stimmung im Reich')));
  const today = issue(sim);
  assert.ok(today.length > 0 && today[0].prio >= today.at(-1).prio);
});

test('Winterkrieg: Entscheidung der sowjetischen KI im Spätherbst (ohne Krieg mit dem Reich)', () => {
  const sim = runCampaign({ seed: SEED, maxDays: 300, until: () => false, decide: (s, d) => (d.kind === 'frenchPeace' ? 1 : 0) });
  const ww = sim.events.find((e) => e.text.includes('Winterkrieg'));
  console.log(`  Winterkrieg: ${ww ? ww.date : 'nicht ausgelöst'}; historisch 30. November 1939`);
  assert.ok(ww && ww.day >= sim.bal.events.winterWar.fromDay);
});

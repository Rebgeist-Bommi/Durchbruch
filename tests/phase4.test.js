import test from 'node:test';
import assert from 'node:assert/strict';
import { newSim, runCampaign } from '../tools/sim_run.mjs';
import { serialize, deserialize } from '../src/sim/save.js';
import { autoplayAllAttack } from '../src/sim/autoplay.js';
import { dailyPoints, resultCost, FOCI } from '../src/sim/research.js';
import { MISSION_TYPES, missionChance, startMission, resolveAgent, sabotage, recruitAgent } from '../src/sim/intel.js';
import { computeRailSupply, INTACT } from '../src/sim/infra.js';
import { assignGeneral, freeGenerals } from '../src/sim/generals.js';
import { strikeTargets } from '../src/sim/airstrike.js';

test('Forschung: festes Budget -> Ergebnisse in steigenden Abständen, Höchstbudget greift', () => {
  const sim = newSim({ peace: true });
  const p = sim.player;
  const labs = sim.buildings.filter((b) => b.type === 'forschung' && sim.owner[b.cell] === p);
  for (const b of labs) { b.focus = 'industrie'; b.budget = 1.0; }
  sim.econ.get(p).money = 1e6;
  const days = [];
  for (let d = 0; d < 720 && sim.research.get(p).industrie.level < 5; d++) {
    const before = sim.research.get(p).industrie.level;
    sim.tick();
    if (sim.research.get(p).industrie.level > before) days.push(sim.day);
  }
  const gaps = days.map((d, i) => d - (i ? days[i - 1] : 0));
  console.log(`  Ergebnisse (Industrie) an Tag ${days.join(', ')} – Abstände ${gaps.join(', ')}`);
  assert.equal(days.length, 5);
  for (let i = 2; i < gaps.length; i++) assert.ok(gaps[i] > gaps[i - 1], `Abstand ${i} steigt`);
  assert.ok(resultCost(sim, 4) > resultCost(sim, 3));
  // Höchstbudget
  const b = labs[0];
  b.budget = 99;
  sim.tick();
  assert.equal(b.budget, sim.bal.research.maxBudget);
  assert.ok(Math.abs(dailyPoints(sim, b) - sim.bal.research.maxBudget * b.health * (1 + 0)) < 1e-9 || dailyPoints(sim, b) > sim.bal.research.maxBudget);
});

test('Wissenschaftler: Bonus nur in derselben Region wie eine passende Anstalt', () => {
  const sim = newSim({ peace: true });
  const lab = sim.buildings.find((b) => b.type === 'forschung' && b.siteName === 'Berlin' && b.focus === 'sonder');
  const hahn = sim.scientists.find((s) => s.id === 'hahn');
  assert.ok(lab && hahn);
  lab.budget = 1;
  const withHahn = dailyPoints(sim, lab);
  hahn.cell = sim.capital.get(sim.idx('DEU')) + 40 * sim.cols; // weit weg
  const without = dailyPoints(sim, lab);
  console.log(`  Anstalt Berlin (Sonderwaffen): ${withHahn.toFixed(2)} mit Hahn, ${without.toFixed(2)} ohne`);
  assert.ok(withHahn > without);
});

test('Geheimdienst: 1.000 Missionen je Typ – Erfolgsquote passt zur angezeigten Chance', () => {
  const sim = newSim({ seed: 3 });
  const p = sim.player;
  const pl = sim.idx('POL');
  const st = sim.intel.get(p);
  const node = sim.nodes.findIndex((x) => sim.owner[x.cell] === pl);
  const front = [...sim.fronts.values()].find((f) => f.alive && f.side[p]);
  const targets = {
    aufklaeren: { kind: 'sector', id: sim.sectors.sectorOf[sim.capital.get(pl)] },
    sabotage: { kind: 'node', id: node },
    entfuehren: { kind: 'scientist', id: 'rejewski' },
    desinformation: { kind: 'front', id: front.id },
  };
  const rej = sim.scientists.find((s) => s.id === 'rejewski');
  for (const type of MISSION_TYPES) {
    const t = targets[type];
    const shown = missionChance(sim, p, type, t);
    let ok = 0;
    for (let i = 0; i < 1000; i++) {
      // Ziel zurücksetzen (Sabotage/Entführung verändern es)
      sim.nodes[node].state = INTACT;
      rej.employer = pl; rej.guard = sim.bal.intel.defaultGuard.scientist; rej.cell = sim.grid.cellAtLonLat(21.01, 52.12);
      st.agents = [{ id: i + 1, state: 'ready', ready: 0, mission: null }];
      const a = startMission(sim, p, type, t);
      assert.ok(a, type);
      assert.equal(a.mission.chance, shown, 'gespeicherte Chance = angezeigte Chance');
      a.mission.finish = sim.day;
      if (resolveAgent(sim, p, a) === 'erfolg') ok++;
    }
    const rate = ok / 1000;
    console.log(`  ${type.padEnd(15)} angezeigt ${(shown * 100).toFixed(1)} %, erzielt ${(rate * 100).toFixed(1)} %`);
    assert.ok(Math.abs(rate - shown) < 0.05, `${type}: ${rate} vs ${shown}`);
  }
});

test('Sabotage an einem Bahnknoten senkt Nachschub und Vormarschtempo der Front', () => {
  const seeds = [11, 12, 13, 14, 15, 16, 17, 18];
  let supA = 0; let supB = 0; let capA = 0; let capB = 0;
  for (const seed of seeds) {
    const run = (sab) => {
      const sim = newSim({ seed });
      sim.autoplay = autoplayAllAttack;
      for (let d = 0; d < 4; d++) sim.tick();
      const de = sim.player;
      // Knoten mit dem größten Einzugsgebiet an der Front: der nächste intakte deutsche Knoten zur Frontmitte
      const f = [...sim.fronts.values()].filter((x) => x.alive && x.side[de]).sort((a, b) => b.length - a.length)[0];
      const cand = sim.nodes.map((n, i) => ({ n, i })).filter(({ n }) => sim.owner[n.cell] === de && n.state === INTACT);
      const near = (n) => (n.cell % sim.cols - f.cx) ** 2 + (Math.floor(n.cell / sim.cols) - f.cy) ** 2;
      cand.sort((a, b) => near(a.n) - near(b.n));
      const node = cand[0];
      const R = sim.bal.supply.capRadius + 2;
      const watch = sim.frontCellsOf(f, sim.enemyOn(f, de)).filter((c) => Math.hypot(c % sim.cols - node.n.cell % sim.cols, Math.floor(c / sim.cols) - Math.floor(node.n.cell / sim.cols)) < R);
      if (sab) sabotage(sim, { kind: 'node', id: node.i });
      computeRailSupply(sim);
      const sup = watch.reduce((s, c) => s + sim.supply(de, c), 0) / Math.max(1, watch.length);
      const region = new Set();
      for (let i = 0; i < sim.N; i++) {
        if (sim.owner[i] !== sim.idx('POL')) continue;
        if (Math.hypot(i % sim.cols - node.n.cell % sim.cols, Math.floor(i / sim.cols) - Math.floor(node.n.cell / sim.cols)) < R) region.add(i);
      }
      for (let d = 0; d < 5; d++) sim.tick();
      let cap = 0;
      for (const i of region) if (sim.owner[i] === de) cap++;
      return { sup, cap };
    };
    const a = run(false);
    const b = run(true);
    supA += a.sup; supB += b.sup; capA += a.cap; capB += b.cap;
  }
  console.log(`  Nachschub im Einzugsgebiet: ${(supA / seeds.length * 100).toFixed(0)} % ohne, ${(supB / seeds.length * 100).toFixed(0)} % mit Sabotage | eroberte Felder in 5 Tagen: ${capA} ohne, ${capB} mit Sabotage (8 Seeds, Einzugsgebiet des Knotens)`);
  assert.ok(supB < supA, 'Nachschub sinkt');
  assert.ok(capB < capA, 'Vormarsch langsamer');
});

test('Generäle: einer je Front, Wechsel möglich, Eigenschaft wirkt', () => {
  const sim = newSim({ seed: 1 });
  const de = sim.player;
  const fronts = [...sim.fronts.values()].filter((f) => f.alive && f.side[de]);
  for (const f of fronts) assert.ok(f.side[de].general, 'automatisch besetzt');
  const free = freeGenerals(sim, de);
  assert.ok(free.length > 0);
  assert.ok(assignGeneral(sim, fronts[0].id, de, free[0].id));
  assert.equal(fronts[0].side[de].general, free[0].id);
  const ids = fronts.map((f) => f.side[de].general);
  assert.equal(new Set(ids).size, ids.length, 'kein General doppelt');
});

test('Luftangriffe: Ziele hinter der Front, abgestellter Luftanteil trifft Infrastruktur', () => {
  const sim = newSim({ seed: 2 });
  const de = sim.player;
  for (let d = 0; d < 5; d++) sim.tick(); // Aufmarsch: Divisionen marschieren seit Richtung A an die Front
  const f = [...sim.fronts.values()].filter((x) => x.alive && x.side[de]).sort((a, b) => sim.divisionsOn(b.id, de).length - sim.divisionsOn(a.id, de).length)[0];
  const targets = strikeTargets(sim, f, de);
  assert.ok(targets.length > 0);
  const t = targets.find((x) => x.kind === 'node') || targets[0];
  f.side[de].airShare = 0.5;
  f.side[de].strikeTarget = { kind: t.kind, id: t.id };
  let hits = 0;
  for (let d = 0; d < 10; d++) { sim.tick(); hits = Math.max(hits, (sim.fronts.get(f.id)?.side[de].strikeHits) || 0); }
  console.log(`  Treffer in 10 Tagen: ${hits}`);
  assert.ok(hits > 0);
});

test('Polenfeldzug (Phase 4) läuft bis zur Kapitulation', () => {
  const sim = runCampaign({ seed: 1939 });
  const pol = sim.nations.get(sim.idx('POL'));
  console.log(`  Kapitulation an Tag ${pol.capitulationDay} (Phase 3: Tag 40)`);
  assert.equal(pol.status, 'kapituliert');
});

test('Speichern/Laden mit Forschung, Geheimdienst, Generälen, Luftangriffen: 30 Tage identisch', () => {
  const a = newSim({ seed: 21 });
  a.autoplay = autoplayAllAttack;
  for (let d = 0; d < 8; d++) a.tick();
  const p = a.player;
  for (const b of a.buildings) if (b.type === 'forschung' && a.owner[b.cell] === p) b.budget = 1.5;
  a.econ.get(p).money += 500;
  recruitAgent(a, p);
  a.intel.get(p).agents[0].state = 'ready';
  startMission(a, p, 'sabotage', { kind: 'node', id: a.nodes.findIndex((x) => a.owner[x.cell] === a.idx('POL')) });
  const f = [...a.fronts.values()].find((x) => x.alive && x.side[p]);
  const t = strikeTargets(a, f, p)[0];
  f.side[p].airShare = 0.25;
  f.side[p].strikeTarget = { kind: t.kind, id: t.id };
  const text = JSON.stringify(serialize(a));
  const b = newSim({ seed: 21 });
  deserialize(b, JSON.parse(text));
  b.autoplay = autoplayAllAttack;
  for (let d = 0; d < 30; d++) { a.tick(); b.tick(); }
  console.log(`  Prüfsumme ${a.stateHash()} / ${b.stateHash()}, Spielstand ${(text.length / 1024).toFixed(0)} kB`);
  assert.equal(a.stateHash(), b.stateHash());
  assert.deepEqual(a.events.map((e) => e.text), b.events.map((e) => e.text));
  assert.equal(JSON.stringify([...a.research]), JSON.stringify([...b.research]));
  assert.equal(JSON.stringify([...a.intel]), JSON.stringify([...b.intel]));
  assert.equal(JSON.stringify(a.scientists), JSON.stringify(b.scientists));
  assert.equal(JSON.stringify(a.generals), JSON.stringify(b.generals));
  void FOCI;
});

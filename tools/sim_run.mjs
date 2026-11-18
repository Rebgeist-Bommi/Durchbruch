// Testlauf der Simulation ohne Spieler (Node). Deutschland greift an allen Fronten an.
// Aufruf: node tools/sim_run.mjs [seed] [--quiet]
import { readFileSync } from 'node:fs';
import { Grid } from '../src/data/grid.js';
import { decodeMap } from '../src/data/loader.js';
import { Simulation } from '../src/sim/simulation.js';
import { autoplayCampaign } from '../src/sim/autoplay.js';
import { declareWar } from '../src/sim/diplomacy.js';

export function loadInputs() {
  const dir = new URL('../public/data/', import.meta.url);
  const meta = JSON.parse(readFileSync(new URL('grid.json', dir), 'utf8'));
  const bin = readFileSync(new URL('grid.bin', dir));
  const map = decodeMap(JSON.parse(readFileSync(new URL('map.json', dir), 'utf8')));
  const balance = JSON.parse(readFileSync(new URL('../data/balance.json', import.meta.url), 'utf8'));
  const infra = JSON.parse(readFileSync(new URL('infra.json', dir), 'utf8'));
  const people = {
    scientists: JSON.parse(readFileSync(new URL('../data/scientists.json', import.meta.url), 'utf8')),
    generals: JSON.parse(readFileSync(new URL('../data/generals.json', import.meta.url), 'utf8')),
  };
  return { meta, bin, map, balance, infra, people };
}

/**
 * Neue Simulation. Start 01.03.1939 im Frieden; mit atWar (Standard für Einzeltests) erklärt das
 * Reich Polen sofort den Krieg (Aufmarsch aus der Reserve, Vorbereitung wie früher 0,6).
 */
export function newSim({ seed, peace = false, atWar = !peace } = {}) {
  const { meta, bin, map, balance, infra, people } = loadInputs();
  const grid = new Grid(meta, new Uint8Array(bin));
  const sim = new Simulation({ grid, map, balance, infra, people, seed: seed ?? balance.seed, peace });
  sim.autoDecide = () => 0; // Einzeltests: Entscheidungen automatisch (Pop-up-Tests setzen null)
  if (atWar) {
    declareWar(sim, sim.player, sim.idx('POL'));
    for (const f of sim.fronts.values()) if (f.alive && f.side[sim.player]) { f.side[sim.player].order = 'prepare'; f.side[sim.player].prep = 0.6; }
  }
  return sim;
}

/**
 * Kampagne ohne Spieler (Schwierigkeit Normal): Angriff auf Polen, Westen halten, Entscheidungen
 * automatisch mit der ersten Option. Ende bei Kapitulation Polens (oder `until`) bzw. maxDays.
 */
export function runCampaign({ seed, maxDays = 420, onDay, difficulty = 'normal', autoplay = autoplayCampaign, until = null, decide = () => 0 } = {}) {
  const sim = newSim({ seed, atWar: false });
  sim.setDifficulty(difficulty);
  if (autoplay) sim.autoplay = autoplay;
  sim.autoDecide = decide;
  const pol = sim.idx('POL');
  const done = until || ((s) => s.nations.get(pol).status === 'kapituliert');
  while (!sim.isOver() && !done(sim) && sim.day < maxDays) {
    sim.tick();
    if (onDay) onDay(sim);
  }
  return sim;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const seed = Number(process.argv[2] || 1939);
  const quiet = process.argv.includes('--quiet');
  const POL = (s) => s.idx('POL');
  const sim = runCampaign({
    seed,
    onDay: (s) => {
      if (quiet) return;
      const st = s.nations.get(POL(s));
      const pd = s.divisions.filter((d) => d.nation === POL(s)).length;
      const gd = s.divisions.filter((d) => d.nation === s.player).length;
      const war = s.sieges.find((x) => x.city.name === 'Warschau');
      const fr = [...s.fronts.values()].filter((f) => f.alive).length;
      const lost = 1 - [...s.owner].filter((o) => o === POL(s)).length / st.startCells;
      console.log(`Tag ${String(s.day).padStart(3)} ${s.dateText().padEnd(20)} Polen verloren ${(lost * 100).toFixed(0).padStart(3)}% | Div DEU ${gd} POL ${pd} | Fronten ${fr} | Warschau ${!war ? '–' : war.fallen ? 'gefallen' : war.besieged ? `belagert ${war.defense.toFixed(0)}` : 'frei'} | Tick ${s.tickMs.at(-1).toFixed(1)} ms`);
      for (const e of s.events.filter((x) => x.day === s.day)) console.log(`        · ${e.text}`);
    },
  });
  const st = sim.nations.get(sim.idx('POL'));
  const ms = sim.tickMs.slice(1);
  console.log(`\nErgebnis Seed ${seed}: Polen ${st.status}${st.capitulationDay >= 0 ? ` an Tag ${st.capitulationDay} (${sim.dateText(st.capitulationDay)})` : ''}`);
  console.log(`Tick: Mittel ${(ms.reduce((a, b) => a + b, 0) / ms.length).toFixed(2)} ms, Max ${Math.max(...ms).toFixed(2)} ms, Prüfsumme ${sim.stateHash()}`);
}

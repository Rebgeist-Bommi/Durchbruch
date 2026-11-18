// Moral (Phase 5): ein Wert 0–100 je Nation. Siege, Städte und Kessel heben sie, Niederlagen,
// Verluste und verlorene Städte senken sie. Propaganda kostet Geld und nutzt sich ab.
// Wirkung: niedrige Moral senkt Kampfkraft und Produktion und führt zu Desertion; hohe Moral
// schiebt die Kapitulationsschwelle hinaus.

const clamp = (v) => Math.max(0, Math.min(100, v));

export function initMorale(sim) {
  const M = sim.bal.morale;
  for (const [n, st] of sim.nations) {
    st.morale = M.start[sim.code(n)] ?? M.start.default;
    st.propaganda = [];
    st.lossSeen = 0;
    st.deserted = 0;
  }
}

/** Gleichgewichtswert, zu dem die Moral langsam zurückkehrt (Spieler: plus Schwierigkeit). */
export function moraleBase(sim, n) {
  const M = sim.bal.morale;
  const b = M.start[sim.code(n)] ?? M.start.default;
  const goal = (sim.dip?.effects || []).reduce((s, x) => (x.nation === n && x.kind === 'moraleBase' ? s + x.value : s), 0);
  return (n === sim.player ? b + sim.diff().morale : b) + goal;
}

export function moraleOf(sim, n) {
  const st = sim.nations.get(n);
  return st && st.morale !== undefined ? st.morale : 60;
}

export function changeMorale(sim, n, delta) {
  const st = sim.nations.get(n);
  if (!st || st.morale === undefined || st.status !== 'aktiv') return;
  st.morale = clamp(st.morale + delta);
}

/** Kampfkraft-Faktor (1 bei Moral ≥ lowFrom, darunter bis 1 − combatPenalty). */
export function moraleCombat(sim, n) {
  const M = sim.bal.morale;
  const m = moraleOf(sim, n);
  return 1 - M.combatPenalty * Math.max(0, (M.lowFrom - m) / M.lowFrom);
}

/** Produktions-Faktor (Einnahmen und Rüstung). */
export function moraleProduction(sim, n) {
  const M = sim.bal.morale;
  const m = moraleOf(sim, n);
  return 1 - M.prodPenalty * Math.max(0, (M.lowFrom - m) / M.lowFrom);
}

/** Zusätzlicher Gebietsverlust, den eine Nation mit hoher Moral bis zur Kapitulation erträgt. */
export function capitulationBonus(sim, n) {
  const M = sim.bal.morale;
  const m = moraleOf(sim, n);
  return M.capitulationBonus * Math.max(0, (m - M.highFrom) / (100 - M.highFrom));
}

/** Wirkung des nächsten Propaganda-Einsatzes (nimmt bei häufigem Einsatz ab). */
export function propagandaGain(sim, n) {
  const P = sim.bal.morale.propaganda;
  const st = sim.nations.get(n);
  const recent = (st?.propaganda || []).filter((d) => sim.day - d < P.windowDays).length;
  return P.gain * Math.pow(P.decay, recent);
}

export function propaganda(sim, n = sim.player) {
  const P = sim.bal.morale.propaganda;
  const st = sim.nations.get(n);
  const e = sim.econ.get(n);
  if (!st || !e || st.status !== 'aktiv' || e.money < P.cost) return 0;
  const gain = propagandaGain(sim, n);
  e.money -= P.cost;
  e.spentToday = (e.spentToday || 0) + P.cost;
  st.propaganda = st.propaganda.filter((d) => sim.day - d < P.windowDays);
  st.propaganda.push(sim.day);
  changeMorale(sim, n, gain);
  return gain;
}

/** Stadt erobert: Eroberer gewinnt, Verteidiger verliert (nach Rang, Hauptstadt besonders). */
export function moraleCity(sim, city, from, to) {
  const M = sim.bal.morale;
  const cap = sim.capital.get(from) === city.cell;
  changeMorale(sim, to, cap ? M.capitalGain : M.cityGain[city.rank] || 0);
  changeMorale(sim, from, -(cap ? M.capitalLoss : M.cityLoss[city.rank] || 0));
}

/** Täglich: Verluste, Kriegsmüdigkeit, Rückkehr zum Gleichgewicht, Desertion. */
export function runMorale(sim) {
  const M = sim.bal.morale;
  const men = new Map();
  for (const d of sim.divisions) men.set(d.nation, (men.get(d.nation) || 0) + d.men);
  for (const [n, st] of sim.nations) {
    if (st.status !== 'aktiv' || st.morale === undefined) continue;
    const total = men.get(n) || 0;
    const lost = st.lossesTotal + st.menLostAsPrisoners - st.lossSeen;
    st.lossSeen = st.lossesTotal + st.menLostAsPrisoners;
    let d = 0;
    if (total > 0 && lost > 0) d -= M.lossPerPctMen * (100 * lost) / (total + lost);
    if (sim.enemiesOf(n).length) d -= M.warWeariness;
    d += (moraleBase(sim, n) - st.morale) * M.drift;
    st.morale = clamp(st.morale + d);
    // Desertion bei sehr niedriger Moral
    if (st.morale < M.desertBelow) {
      const rate = M.desertPerDay * (M.desertBelow - st.morale) / M.desertBelow;
      for (const dv of sim.divisions) {
        if (dv.nation !== n) continue;
        const x = dv.men * rate;
        dv.men -= x;
        st.deserted += x;
      }
    }
  }
}

/** Stimmung in Worten (Zeitung, Anzeige). */
export function moodText(m) {
  if (m >= 80) return 'begeistert';
  if (m >= 65) return 'zuversichtlich';
  if (m >= 50) return 'gefasst';
  if (m >= 35) return 'gedrückt';
  if (m >= 20) return 'kriegsmüde';
  return 'verzweifelt';
}

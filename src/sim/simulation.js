// Simulation von Phase 2: Zeit (1 Tick = 1 Tag), Divisionen, Fronten, Vormarsch, Kessel,
// Belagerung, Kapitulation. Kein DOM, keine Darstellung: läuft identisch im Browser und in Node.
import { createRng, hash01 } from './rng.js';
import { buildSectors } from './sectors.js';
import { updateFronts } from './fronts.js';
import { resolveCombat, updateOrdersOverTime } from './combat.js';
import { resolvePockets, resolveSieges, checkCapitulation, markExclaves } from './pockets.js';
import { runAi, warmupAi } from './ai.js';
import { formatDate } from './calendar.js';
import { initInfra, computeRailSupply, ensureSupply, ensureSupplyFull, railSupply, repairRail, advanceUpgrades, damageOnCapture, levelFactor, levelOfCell } from './infra.js';
import { initEconomy, runEconomy, divisionStrength, captureBuildings, transferStocks } from './economy.js';
import { initHistory, recordDay } from './history.js';
import { initResearch, runResearch } from './research.js';
import { initScientists, runScientists } from './scientists.js';
import { initIntel, runIntel, isRevealed } from './intel.js';
import { runAirStrikes } from './airstrike.js';
import { initGenerals, runGenerals } from './generals.js';
import { initMorale, runMorale, moraleCity } from './morale.js';
import { initDiplomacy, runDiplomacy, scenarioTreaty, declareWar as dipDeclareWar } from './diplomacy.js';
import { checkDecisions, decide, runWorldEvents } from './events.js';
import { initNews, runNews } from './news.js';
import { initGoals, runGoals } from './goals.js';

import { NMAX, KM_PER_CELL } from './constants.js';

export { NMAX, KM_PER_CELL };

// Namen mit Artikel: [Nominativ am Satzanfang, Dativ, Akkusativ]; ohne Eintrag: Name ohne Artikel
const ARTICLES = {
  DEU: ['Das Deutsche Reich', 'dem Deutschen Reich', 'das Deutsche Reich'],
  GBR: ['Das Vereinigte Königreich', 'dem Vereinigten Königreich', 'das Vereinigte Königreich'],
  SOV: ['Die Sowjetunion', 'der Sowjetunion', 'die Sowjetunion'],
  NLD: ['Die Niederlande', 'den Niederlanden', 'die Niederlande'],
  SVK: ['Die Slowakei', 'der Slowakei', 'die Slowakei'],
  CHE: ['Die Schweiz', 'der Schweiz', 'die Schweiz'],
  TUR: ['Die Türkei', 'der Türkei', 'die Türkei'],
  DAN: ['Die Freie Stadt Danzig', 'der Freien Stadt Danzig', 'die Freie Stadt Danzig'],
};

export class Simulation {
  /**
   * Einmaliger Vorlauf je Programmstart: zwei Ticks auf einer Wegwerf-Kopie, damit die
   * JavaScript-Engine die Tick-Funktionen schon vor dem ersten echten Spieltag optimiert.
   * Das echte Spiel bleibt unberührt (eigenes Raster, eigener Zufall).
   */
  static warmup({ grid, map, balance, infra, people }) {
    Simulation.warmedUp = true;
    const bytes = new Uint8Array(grid.size * 2);
    bytes.set(grid.territory, 0);
    bytes.set(grid.terrain, grid.size);
    const copy = new grid.constructor(grid.meta, bytes);
    const sim = new Simulation({ grid: copy, map, balance, infra, people, seed: 1, warm: true });
    sim.autoDecide = () => 0;
    dipDeclareWar(sim, sim.player, sim.idx('POL'));
    for (const f of sim.fronts.values()) if (f.side[sim.player]) sim.attack(f.id);
    for (let k = 0; k < 3; k++) sim.tick();
  }

  constructor({ grid, map, balance, infra, people, seed, warm = false, peace = false }) {
    if (!infra) throw new Error('Simulation braucht infra.json (Phase 3)');
    if (!people) throw new Error('Simulation braucht Wissenschaftler und Generäle (Phase 4)');
    // Leistung (Phase 5): Alle später genutzten Felder vorab anlegen. Kommen Felder erst im Lauf
    // hinzu, ändert sich die Objektform und die JavaScript-Engine verwirft optimierten Code.
    for (const k of ['_ownerDirty', '_border', '_borderOwner', '_borderFlag', '_supplyDay', '_sq', '_q', '_occCount', '_conn',
      '_aiQ', '_aiEroded', '_aiDist', '_aiCore', '_uf', '_seen', '_mark', '_edgeWar', '_compMark', 'supplyDist', 'nodeCount',
      'phaseMs', 'phaseLog', 'autoDecide', 'autoplay', 'pocketMark', '_pocketCells', 'exclave', '_polCells', '_partition', '_supplyFullDay']) this[k] = null;
    this._connStamp = 0;
    this._compSeq = 0;
    this.grid = grid;
    this.map = map;
    this.bal = balance;
    this.seed = seed ?? balance.seed;
    // Phase 5: Schwierigkeit und Sandbox (Startwerte sind auf allen Stufen gleich)
    this.settings = { difficulty: balance.difficulty.default, sandbox: false };
    this.pending = null; // anstehende Entscheidung (hält die Simulation an)
    this.outcome = null; // Spielende (nur Niederlage): {result: 'niederlage', day}
    this.victory = null; // zuletzt gewonnener Feldzug (Spiel läuft weiter)
    this.rng = createRng(this.seed);
    this.day = 0;
    this.cols = grid.cols;
    this.rows = grid.rows;
    this.N = grid.size;
    this.codes = grid.nationCodes;
    this.codeIndex = new Map(this.codes.map((c, i) => [c, i + 1]));
    this.player = this.idx(balance.scenario.playerNation);

    this.owner = grid.owner; // gemeinsam mit Grid: Feldinfo zeigt immer den aktuellen Besitzer
    this.startOwner = Uint8Array.from(this.owner); // Besitz am 31.08.1939 (Basis für Speicherstände)
    this.homeOwner = this.startOwner; // Kerngebiet für den Nachschub
    // Nachbartabelle (N, O, S, W; -1 = Rand oder Meer): vermeidet Speicheranlagen im Tick
    this.nb = new Int32Array(this.N * 4).fill(-1);
    for (let i = 0; i < this.N; i++) {
      if (!grid.territory[i]) continue;
      const r = Math.floor(i / this.cols);
      const c = i - r * this.cols;
      const cand = [r > 0 ? i - this.cols : -1, c < this.cols - 1 ? i + 1 : -1, r < this.rows - 1 ? i + this.cols : -1, c > 0 ? i - 1 : -1];
      for (let k = 0; k < 4; k++) if (cand[k] >= 0 && grid.territory[cand[k]]) this.nb[i * 4 + k] = cand[k];
    }
    this.ownedCount = new Int32Array(NMAX);
    for (let i = 0; i < this.N; i++) this.ownedCount[this.owner[i]]++;
    // Rechteck je Nation um ihre Felder (Suchbereich für Kessel, KI, Nachschub)
    this.nationBox = new Map();
    for (let i = 0; i < this.N; i++) if (this.owner[i]) this.growNationBox(this.owner[i], i);
    this.terrain = grid.terrain;
    this.fort = new Float32Array(this.N);
    this.conqDay = new Int16Array(this.N).fill(-1);
    this.conqMethod = new Uint8Array(this.N); // 0 –, 1 minimal, 2 total
    this.frontHint = new Int32Array(this.N);
    this.pocketSince = new Int16Array(this.N).fill(-1);
    this.changed = []; // in diesem Tick geänderte Felder (für die Darstellung)
    this.events = [];
    this.tickMs = [];

    this.atWar = new Uint8Array(NMAX * NMAX);
    this.inWar = new Uint8Array(NMAX);
    this.box = { r0: this.rows, r1: -1, c0: this.cols, c1: -1 };
    this.wars = [];
    if (!peace) for (const [a, b] of balance.scenario.wars) this.declareWar(this.idx(a), this.idx(b), false);

    this.sectors = buildSectors(grid, balance.sectors.spacingCells);
    initInfra(this, infra);
    this.startRail = Uint8Array.from(this.railState);
    this.initCities();
    // Nationen mit eigener Wirtschaft (Spieler + KI) und alle Kriegsparteien
    this.nations = new Map();
    const all = new Set([...Object.keys(balance.economy.nations).filter((c) => !c.startsWith('_')).map((c) => this.idx(c)), ...this.warNations()]);
    for (const n of [...all].sort((x, y) => x - y)) {
      this.nations.set(n, {
        status: 'aktiv', capitulationDay: -1, startCells: 0,
        lossesTotal: 0, prisonersTaken: 0, menLostAsPrisoners: 0, airTotal: 0,
        airToday: 0, lostShare: 0, lastLossDay: -1000, morale: 60, propaganda: [], lossSeen: 0, deserted: 0,
        warSince: this.inWar[n] ? 0 : -1,
      });
    }
    this.fronts = new Map();
    this.nextFrontId = 1;
    this.sectionStats = new Map(); // `${frontKey}` je Sektor und Seite
    this.divisions = [];
    this.createDivisions();
    initEconomy(this, infra);
    initResearch(this);
    initScientists(this, people.scientists);
    initIntel(this);
    initGenerals(this, people.generals);
    initHistory(this);
    initMorale(this);
    initDiplomacy(this);
    initGoals(this);
    initNews(this);
    this.methodCount = new Map(); // eroberte Felder je Nation und Vorgehen
    this.computeStartState();
    updateFronts(this);
    this.initialDeployment();
    // Vorlauf: rechenintensive Teile einmal ausführen (ohne Wirkung auf den Spielstand),
    // damit schon der erste Tick ohne Anlaufkosten läuft.
    resolvePockets(this);
    updateFronts(this);
    runGenerals(this);
    for (const n of this.nations.keys()) if (n !== this.player) warmupAi(this, n);
    if (!warm && !Simulation.warmedUp) Simulation.warmup({ grid, map, balance, infra, people });
    if (this.wars.length) this.log('info', `Aufmarsch abgeschlossen. Kriegszustand mit ${this.nationName(this.idx('POL'))}.`);
    else this.log('info', `${this.dateText()}: Europa ist noch im Frieden.`);
  }

  // ---------------------------------------------------------------- Hilfen
  idx(code) {
    const i = this.codeIndex.get(code);
    if (!i) throw new Error(`unbekannte Nation ${code}`);
    return i;
  }
  code(i) { return this.codes[i - 1]; }
  nationName(i) { return this.grid.nationNames[this.code(i)]; }
  /** Name mit Artikel am Satzanfang (Nominativ), im Dativ und im Akkusativ (Phase 5, Meldungen). */
  nameNom(i) { const a = ARTICLES[this.code(i)]; return a ? a[0] : this.nationName(i); }
  nameDat(i) { const a = ARTICLES[this.code(i)]; return a ? a[1] : this.nationName(i); }
  nameAcc(i) { const a = ARTICLES[this.code(i)]; return a ? a[2] : this.nationName(i); }
  isWar(a, b) { return this.atWar[a * NMAX + b] === 1; }
  /** Aufmarsch geplant (`a` sammelt Truppen an der Grenze zu `b`)? */
  plansAgainst(a, b) { return (this.dip?.plans || []).some(([x, y]) => x === a && y === b); }
  warNations() {
    const s = new Set();
    for (const [a, b] of this.wars) { s.add(a); s.add(b); }
    return [...s].sort((x, y) => x - y);
  }
  enemiesOf(n) {
    return this.wars.filter(([a, b]) => a === n || b === n).map(([a, b]) => (a === n ? b : a));
  }
  dateText(day = this.day) { return formatDate(this.bal.time.startDate, day); }

  /** Werte der gewählten Schwierigkeit. */
  diff() { return this.bal.difficulty.levels[this.settings.difficulty] || this.bal.difficulty.levels.normal; }

  setDifficulty(level, sandbox = this.settings.sandbox) {
    if (!this.bal.difficulty.levels[level]) throw new Error(`Schwierigkeit ${level}`);
    this.settings.difficulty = level;
    this.settings.sandbox = !!sandbox;
    for (const [n, st] of this.nations) if (n === this.player) st.morale = Math.max(0, Math.min(100, st.morale + this.diff().morale));
  }

  declareWar(a, b, message = true, text = null) {
    this.atWar[a * NMAX + b] = 1;
    this.atWar[b * NMAX + a] = 1;
    this.wars.push([a, b]);
    this.inWar[a] = 1;
    this.inWar[b] = 1;
    for (const n of [a, b]) { const st = this.nations?.get(n); if (st) { st.lastLossDay = this.day; if (st.warSince < 0) st.warSince = this.day; } }
    // Suchrechteck aller Kriegsparteien: Vereinigung der Nationsrechtecke (enthalten alle Felder)
    for (const n of [a, b]) {
      const nb = this.nationBox?.get(n);
      if (!nb || nb.r1 < 0) continue;
      this.growBox(nb.r0 * this.cols + nb.c0);
      this.growBox(nb.r1 * this.cols + nb.c1);
    }
    if (message) this.log('war', text || `${this.nameNom(a)} und ${this.nameAcc(b)} befinden sich im Krieg.`);
  }

  /** Rechteck um alle Felder kriegführender Nationen (Suchbereich der Tick-Berechnungen). */
  growBox(i) {
    const r = (i / this.cols) | 0;
    const c = i - r * this.cols;
    const b = this.box;
    if (r < b.r0) b.r0 = r;
    if (r > b.r1) b.r1 = r;
    if (c < b.c0) b.c0 = c;
    if (c > b.c1) b.c1 = c;
  }

  growNationBox(n, i) {
    let b = this.nationBox.get(n);
    if (!b) { b = { r0: this.rows, r1: -1, c0: this.cols, c1: -1 }; this.nationBox.set(n, b); }
    const r = (i / this.cols) | 0;
    const c = i - r * this.cols;
    if (r < b.r0) b.r0 = r;
    if (r > b.r1) b.r1 = r;
    if (c < b.c0) b.c0 = c;
    if (c > b.c1) b.c1 = c;
  }

  /** Suchbereich einer Nation (+1 Feld Rand). */
  nationRange(n) {
    const b = this.nationBox.get(n);
    if (!b) return [0, -1, 0, -1];
    return [Math.max(0, b.r0 - 1), Math.min(this.rows - 1, b.r1 + 1), Math.max(0, b.c0 - 1), Math.min(this.cols - 1, b.c1 + 1)];
  }

  /** Feldindizes im Suchbereich (+1 Feld Rand), zeilenweise. */
  boxRange() {
    const b = this.box;
    return [Math.max(0, b.r0 - 1), Math.min(this.rows - 1, b.r1 + 1), Math.max(0, b.c0 - 1), Math.min(this.cols - 1, b.c1 + 1)];
  }

  endWar(a, b) {
    this.atWar[a * NMAX + b] = 0;
    this.atWar[b * NMAX + a] = 0;
    this.wars = this.wars.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)));
    for (const n of [a, b]) { const st = this.nations.get(n); if (st) st.lastLossDay = this.day; }
  }

  log(type, text, cell = -1) {
    this.events.push({ day: this.day, date: this.dateText(), type, text, cell });
  }

  /** Nächstgelegene Stadt; mit `nation` nur Städte, die vor dem Krieg zu dieser Nation gehörten. */
  nearestCityName(col, row, maxRank = 4, nation = 0) {
    let best = null;
    let bd = Infinity;
    for (const c of this.cities) {
      if (c.rank > maxRank || (nation && c.nation !== nation)) continue;
      const d = (c.col - col) ** 2 + (c.row - row) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best ? best.name : '–';
  }

  // ---------------------------------------------------------------- Aufbau
  initCities() {
    const m = this.map;
    this.cities = [];
    this.cityAt = new Int32Array(this.N).fill(-1);
    for (const c of m.cities) {
      const [wx, wy] = [m.originX + c.x * m.unit, m.originY + c.y * m.unit];
      const cell = this.grid.cellAtWorld(wx, wy);
      if (cell < 0) continue;
      const entry = { name: c.name, rank: c.rank, capital: c.capital, cell, col: cell % this.cols, row: Math.floor(cell / this.cols), nation: this.owner[cell] };
      this.cityAt[cell] = this.cities.length;
      this.cities.push(entry);
    }
    this.capital = new Map();
    for (const c of this.cities) if (c.capital) this.capital.set(c.nation, c.cell);
    this.sieges = [];
    this.siegeAt = new Int32Array(this.N).fill(-1);
    for (const n of this.warNations()) this.addSieges(n);
  }

  /** Groß- und Hauptstädte einer Nation werden belagerbar (bei Kriegseintritt). */
  addSieges(nation) {
    const S = this.bal.siege;
    for (const c of this.cities) {
      if (c.nation !== nation || this.siegeAt[c.cell] >= 0) continue;
      const isCap = this.capital.get(c.nation) === c.cell;
      if (!isCap && c.rank > S.cityMaxRank) continue;
      const max = isCap ? S.capitalDefense : S.cityDefense;
      this.siegeAt[c.cell] = this.sieges.length;
      this.sieges.push({ city: c, cell: c.cell, nation: c.nation, capital: isCap, defense: max, max, besieged: false, since: -1, fallen: false, by: 0 });
    }
  }

  createDivisions() {
    const D = this.bal.divisions;
    let id = 1;
    for (const [code, cfg] of Object.entries(D.nations)) {
      const n = this.idx(code);
      let k = 1;
      for (const g of cfg.groups) {
        for (let i = 0; i < g.count; i++) {
          this.divisions.push({
            id: id++, nation: n, name: `${k}. ${cfg.label}`, men: D.menPerDivision, maxMen: D.menPerDivision,
            equip: this.bal.economy.equipmentPerDivision, tank: g.tank, air: g.air, front: 0, transit: null,
          });
          k++;
        }
      }
    }
    this.nextDivisionId = id;
  }

  computeStartState() {
    for (const [n, st] of this.nations) st.startCells = this.ownedCount[n];
    this.computeSupply();
    markExclaves(this);
  }

  /** Nachschub (Phase 3): über intakte Bahnknoten, siehe infra.js. */
  computeSupply() {
    computeRailSupply(this);
  }

  /** Nachschub des Spielers für die Feldanzeige (ganzes Land). */
  supplyDisplay(cell, n = this.player) {
    ensureSupplyFull(this, n);
    return railSupply(this, n, cell);
  }

  supply(n, cell) {
    ensureSupply(this, n);
    return railSupply(this, n, cell);
  }

  initialDeployment() {
    const prep = this.bal.start.prep || {};
    const fortStart = this.bal.start.fortification || {};
    for (const f of this.fronts.values()) {
      for (const n of [f.a, f.b]) {
        const side = f.side[n];
        const p = prep[this.code(n)];
        if (p !== undefined) { side.order = 'prepare'; side.prep = p; }
        const fv = fortStart[this.code(n)];
        if (fv !== undefined) for (const c of this.frontCellsOf(f, n)) this.fort[c] = Math.max(this.fort[c], fv);
      }
    }
    // Spieler: Divisionen nach Frontlänge verteilen, Panzer gestreut, Rest in Reserve
    for (const n of this.nations.keys()) {
      const cfg = this.bal.divisions.nations[this.code(n)];
      const own = this.divisions.filter((d) => d.nation === n).sort((x, y) => y.tank - x.tank || x.id - y.id);
      const nReserve = Math.round(own.length * (cfg?.reserveShare ?? 0));
      const fronts = [...this.fronts.values()].filter((f) => f.side[n]);
      if (!fronts.length) continue;
      const deployable = own.slice(0, own.length - nReserve);
      const count = new Map(fronts.map((f) => [f.id, 0]));
      const weight = new Map(fronts.map((f) => [f.id, this.frontCellsOf(f, this.enemyOn(f, n)).length]));
      for (const d of deployable) {
        let best = fronts[0];
        let bestNeed = -Infinity;
        for (const f of fronts) {
          const need = weight.get(f.id) / (count.get(f.id) + 1);
          if (need > bestNeed) { bestNeed = need; best = f; }
        }
        d.front = best.id;
        count.set(best.id, count.get(best.id) + 1);
      }
    }
  }

  // ---------------------------------------------------------------- Abfragen
  enemyOn(front, n) { return front.a === n ? front.b : front.a; }

  frontCellsOf(front, n) {
    const out = [];
    for (const s of front.sections) out.push(...(n === front.b ? s.cellsB : s.cellsA));
    return out;
  }

  divisionsOn(frontId, n) {
    return this.divisions.filter((d) => d.nation === n && d.front === frontId && !d.transit);
  }

  inTransitTo(frontId, n) {
    return this.divisions.filter((d) => d.nation === n && d.transit && d.transit.to === frontId);
  }

  reserveOf(n) { return this.divisions.filter((d) => d.nation === n && d.front === 0 && !d.transit); }

  /** Kampfkraft einer Seite an einer Front (in "vollen Divisionen"). */
  sideStrength(frontId, n) {
    let str = 0;
    let tank = 0;
    let air = 0;
    let count = 0;
    for (const d of this.divisions) {
      if (d.nation !== n || d.front !== frontId || d.transit) continue;
      const s = divisionStrength(this, d);
      str += s;
      tank += s * d.tank;
      air += s * d.air;
      count++;
    }
    return { str, tank: str ? tank / str : 0, air: str ? air / str : 0, count };
  }

  /** Geschätzte Gegnerzahl (Aufklärung ungenau, aber stabil über 3 Tage). */
  estimate(frontId, n, viewer = this.player) {
    const real = this.divisionsOn(frontId, n).length;
    if (this.frontRevealed(frontId, viewer)) return real; // Aufklärung: genaue Zahl
    const noise = (hash01(frontId, n, Math.floor(this.day / 3)) - 0.5) * 0.5;
    return Math.max(0, Math.round(real * (1 + noise)));
  }

  /** Front aufgeklärt, wenn ein Abschnitt in einem aufgeklärten Sektor liegt. */
  frontRevealed(frontId, viewer) {
    const f = this.fronts.get(frontId);
    if (!f) return false;
    const enemy = this.enemyOn(f, viewer);
    return f.sections.some((s) => (n => isRevealed(this, viewer, n))(enemy === f.b ? s.cellsB[0] : s.cellsA[0]));
  }

  yieldOf(cell) {
    if (this.conqDay[cell] < 0) return 1;
    const m = this.conqMethod[cell] === 2 ? this.bal.methods.total : this.bal.methods.minimal;
    const t = Math.min(1, (this.day - this.conqDay[cell]) / m.recoverDays);
    return m.yieldStart + (1 - m.yieldStart) * t;
  }

  frontAt(cell) {
    const id = this.frontHint[cell];
    const f = this.fronts.get(id);
    return f && f.alive ? f : null;
  }

  // ---------------------------------------------------------------- Befehle
  frontSide(frontId, n) {
    const f = this.fronts.get(frontId);
    if (!f || !f.alive || !f.side[n]) throw new Error(`Front ${frontId} unbekannt`);
    return f.side[n];
  }

  setOrder(frontId, order, n = this.player) {
    if (!['hold', 'prepare'].includes(order)) throw new Error(`Befehl ${order}`);
    this.frontSide(frontId, n).order = order;
  }

  attack(frontId, n = this.player) {
    const s = this.frontSide(frontId, n);
    if (this.fronts.get(frontId).planned) return; // Aufmarsch: erst Krieg erklären
    if (s.order === 'attack') return;
    s.order = 'attack';
    s.attackStartDay = this.day;
    s.attackPrep = s.prep;
  }

  stopAttack(frontId, n = this.player) {
    const s = this.frontSide(frontId, n);
    if (s.order === 'attack') s.order = 'hold';
  }

  setTactic(frontId, tactic, n = this.player) {
    if (!this.bal.tactics[tactic] || tactic.startsWith('_')) throw new Error(`Taktik ${tactic}`);
    this.frontSide(frontId, n).tactic = tactic;
  }

  /** Haltelinie setzen (Feldkoordinaten) oder mit null aufheben (ganzes Land). */
  setObjective(frontId, line, n = this.player) {
    this.frontSide(frontId, n).objective = line && line.length >= 2 ? { line: line.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]) } : null;
  }

  setMethod(frontId, method, n = this.player) {
    if (!this.bal.methods[method]) throw new Error(`Vorgehen ${method}`);
    this.frontSide(frontId, n).method = method;
  }

  /** Ort einer Front oder der Reserve (Hauptstadt) in Feldkoordinaten. */
  placeOf(frontId, n) {
    if (frontId) {
      const f = this.fronts.get(frontId);
      if (f) return [f.cx, f.cy];
    }
    const cap = this.capital.get(n);
    return cap !== undefined ? [cap % this.cols, Math.floor(cap / this.cols)] : [this.cols / 2, this.rows / 2];
  }

  travelDays(fromId, toId, n) {
    const [x0, y0] = this.placeOf(fromId, n);
    const [x1, y1] = this.placeOf(toId, n);
    const km = Math.hypot(x1 - x0, y1 - y0) * KM_PER_CELL;
    const T = this.bal.transfer;
    // Bahnausbau beschleunigt Verlegungen: Mittel der Stufen an Start und Ziel
    const cellAt = (x, y) => Math.max(0, Math.min(this.rows - 1, Math.round(y))) * this.cols + Math.max(0, Math.min(this.cols - 1, Math.round(x)));
    const lv = (levelOfCell(this, cellAt(x0, y0)) + levelOfCell(this, cellAt(x1, y1))) / 2;
    const speed = T.kmPerDay * (T.levelSpeed[Math.round(lv) - 1] || 1);
    // zerstörte oder beschädigte eigene Bahnknoten nahe dem Ziel bremsen die Verlegung
    let broken = 0;
    for (const node of this.nodes) {
      if (node.state === 1 || this.owner[node.cell] !== n) continue;
      if (Math.hypot(node.cell % this.cols - x1, Math.floor(node.cell / this.cols) - y1) <= T.nodePenaltyRadius) broken++;
    }
    const slow = Math.min(T.nodePenaltyMax, 1 + T.nodePenalty * broken);
    return Math.max(T.minDays, Math.ceil((km / speed) * slow));
  }

  /** Verlegt bis zu `count` Divisionen. Quelle/Ziel 0 = Reserve. Gibt die Anzahl zurück. */
  transfer(fromId, toId, count, n = this.player) {
    if (fromId === toId || count <= 0) return 0;
    if (fromId) {
      const f = this.fronts.get(fromId);
      if (!f || !f.alive || f.encircled[n]) return 0; // aus Kesseln gibt es keinen Ausweg
    }
    if (toId) {
      const t = this.fronts.get(toId);
      if (!t || !t.alive || !t.side[n] || t.encircled[n]) return 0;
    }
    const pool = (fromId ? this.divisionsOn(fromId, n) : this.reserveOf(n)).sort((x, y) => x.tank - y.tank || y.id - x.id);
    const days = this.travelDays(fromId, toId, n);
    let moved = 0;
    for (const d of pool.slice(0, count)) {
      d.front = 0;
      d.transit = { from: fromId, to: toId, arrive: this.day + days, days };
      moved++;
    }
    return moved;
  }

  // ---------------------------------------------------------------- Tick
  tick() {
    // Entscheidungen halten das Spiel an (Testläufe: automatische Wahl über sim.autoDecide)
    if (this.outcome) return false;
    if (checkDecisions(this)) {
      if (!this.autoDecide) return false;
      decide(this, this.autoDecide(this, this.pending));
      if (checkDecisions(this)) decide(this, this.autoDecide(this, this.pending));
      if (this.pending) return false;
    }
    const t0 = (globalThis.performance || Date).now();
    this.changed = [];
    this.day += 1;
    for (const e of this.econ.values()) e.spentToday = 0;

    // Historische Gebietsänderungen und Verträge mit Datum (Szenario ab 01.03.1939)
    let annexed = false;
    for (const a of this.bal.scenario.annexations || []) if (a.day === this.day) annexed = this.annex(a, true) || annexed;
    if (annexed) updateFronts(this);
    for (const t of this.bal.scenario.treaties || []) if (t.day === this.day) scenarioTreaty(this, t);

    // Ankunft verlegter Divisionen
    for (const d of this.divisions) {
      if (!d.transit || d.transit.arrive > this.day) continue;
      const to = d.transit.to;
      const f = to ? this.fronts.get(to) : null;
      d.transit = null;
      if (to && (!f || !f.alive)) d.front = this.nearestFront(d.nation, ...this.placeOf(to, d.nation)) || 0;
      else d.front = to;
    }

    for (const st of this.nations.values()) st.airToday = 0;
    const clock = globalThis.performance || Date;
    const phases = this.phaseMs || (this.phaseMs = {});
    const run = (name, fn) => {
      const a = clock.now();
      fn();
      phases[name] = clock.now() - a;
    };
    run('generaele', () => runGenerals(this));
    run('ki', () => runAi(this));
    run('auto', () => this.autoplay && this.autoplay(this));
    run('belagerung', () => resolveSieges(this));
    run('kampf', () => resolveCombat(this));
    run('kessel', () => resolvePockets(this));
    run('kapitulation', () => checkCapitulation(this));
    run('fronten', () => updateFronts(this));
    run('befehle', () => updateOrdersOverTime(this));
    run('infrastruktur', () => { repairRail(this); advanceUpgrades(this); });
    run('wirtschaft', () => runEconomy(this));
    run('forschung', () => { runResearch(this); runScientists(this); });
    run('geheimdienst', () => { runIntel(this); runAirStrikes(this); });
    run('diplomatie', () => { runDiplomacy(this); runWorldEvents(this); runMorale(this); runGoals(this); });
    this.cleanupDivisions();
    this.checkOutcome();
    runNews(this);
    recordDay(this);
    const ms = clock.now() - t0;
    this.tickMs.push(ms);
    this.phaseLog = this.phaseLog || [];
    this.phaseLog.push({ day: this.day, ms, ...phases });
    return true;
  }

  /** Spielende: Sieg = alle Kriegsgegner haben kapituliert oder Frieden geschlossen (mindestens
   * eine Kapitulation); Niederlage = Kapitulation Deutschlands. */
  checkOutcome() {
    if (this.outcome) return;
    const me = this.nations.get(this.player);
    if (me.status === 'kapituliert') {
      this.outcome = { result: 'niederlage', day: this.day };
      this.log('end', `Niederlage: ${this.nameNom(this.player)} hat kapituliert.`);
      return;
    }
    // Überarbeitung: Ein gewonnener Feldzug beendet das Spiel nicht (Start im Frieden, weitere
    // Kriege möglich). Er wird als Sieg festgehalten; die Oberfläche zeigt eine Bilanz.
    const ever = this.dip.everEnemies;
    if (!ever.length || this.enemiesOf(this.player).length) return;
    const caps = ever.filter((n) => this.nations.get(n)?.status === 'kapituliert');
    const seen = this.dip.flags.victoryCaps || 0;
    if (caps.length <= seen) return;
    this.dip.flags.victoryCaps = caps.length;
    this.victory = { result: 'sieg', day: this.day, allCapitulated: caps.length === ever.length, caps };
    this.dip.flags.lastVictory = this.victory;
    this.log('end', 'Sieg: Kein Kriegsgegner steht mehr im Feld.');
  }

  /**
   * Gebiet friedlich übertragen (Szenario, Anschluss-Angebot). a = {territory | nation, to, text,
   * onlyIfOwner, rename}. Gibt true zurück, wenn sich Besitz geändert hat. Eine Nation ohne Felder
   * wird aufgelöst (Divisionen entfallen, Kriege enden).
   */
  annex(a, deferFronts = false) {
    const to = this.idx(a.to);
    const tid = a.territory ? this.grid.territories.findIndex((t) => t.key === a.territory) + 1 : 0;
    const nat = a.nation ? this.idx(a.nation) : 0;
    const only = a.onlyIfOwner ? this.idx(a.onlyIfOwner) : 0;
    const from = new Set();
    for (let i = 0; i < this.N; i++) {
      const o = this.owner[i];
      if (!o || o === to) continue;
      if (tid ? this.grid.territory[i] !== tid : o !== nat) continue;
      if (only && o !== only) continue;
      if (this.isWar(o, to)) continue; // umkämpftes Gebiet wird nicht übertragen
      from.add(o);
      this.setOwner(i, to, 0, true);
      this.conqDay[i] = -1; // friedlich: kein Ertragsverlust
    }
    if (!from.size) return false;
    this.dip.annexed.push({ territory: a.territory || null, nation: a.nation || null, to: a.to, day: this.day, rename: a.rename || null });
    // neue Nation (z. B. Slowakei): Hauptstadt aus den übertragenen Städten
    if (!this.capital.has(to) || this.owner[this.capital.get(to)] !== to) {
      const cap = this.cities.find((c) => c.capital && this.owner[c.cell] === to && from.has(c.nation));
      if (cap) this.capital.set(to, cap.cell);
    }
    for (const f of from) {
      if (this.ownedCount[f] > 0) continue;
      this.divisions = this.divisions.filter((d) => d.nation !== f);
      const st = this.nations.get(f);
      if (st) st.status = 'aufgelöst';
      for (const e of this.enemiesOf(f)) this.endWar(f, e);
    }
    if (a.text) this.log('annex', a.text);
    if (!deferFronts) updateFronts(this);
    return true;
  }

  setOwner(cell, n, method, quiet = false) {
    const old = this.owner[cell];
    if (old === n) return;
    this.owner[cell] = n;
    // Phase 5 (Leistung): letzter Gebietsverlust je Nation, geänderte Felder für die Frontsuche
    const lst = this.nations.get(old);
    if (lst) lst.lastLossDay = this.day;
    (this._ownerDirty || (this._ownerDirty = [])).push(cell);
    this.ownedCount[old]--;
    this.ownedCount[n]++;
    if (this.inWar[n]) this.growBox(cell);
    this.growNationBox(n, cell);
    this.fort[cell] = 0;
    this.conqDay[cell] = this.day;
    this.conqMethod[cell] = method;
    this.pocketSince[cell] = -1;
    this.changed.push(cell);
    if (method) {
      damageOnCapture(this, cell, method);
      captureBuildings(this, cell, method);
      const mc = this.methodCount.get(n) || [0, 0, 0];
      mc[method]++;
      this.methodCount.set(n, mc);
    }
    const ci = this.cityAt[cell];
    if (ci >= 0) {
      const c = this.cities[ci];
      const si = this.siegeAt[cell];
      if (old && this.isWar(old, n)) moraleCity(this, c, old, n);
      if (si >= 0 && !this.sieges[si].fallen) {
        const s = this.sieges[si];
        s.fallen = true;
        s.by = n;
      }
      if (c.rank <= 4 && !quiet) this.log('city', `${c.name} eingenommen.`, cell);
    }
  }

  nearestFront(n, x, y) {
    let best = 0;
    let bd = Infinity;
    for (const f of this.fronts.values()) {
      if (!f.alive || !f.side[n] || f.encircled[n]) continue;
      const d = (f.cx - x) ** 2 + (f.cy - y) ** 2;
      if (d < bd) { bd = d; best = f.id; }
    }
    return best;
  }

  cleanupDivisions() {
    const lim = this.bal.divisions.destroyedBelow;
    this.divisions = this.divisions.filter((d) => d.men >= d.maxMen * lim);
  }

  /** Spiel beendet (Sieg oder Niederlage, siehe checkOutcome). */
  isOver() {
    return !!this.outcome;
  }

  /** Vorwiegendes Vorgehen einer Nation bei Eroberungen (1 minimal, 2 total). */
  dominantMethod(n) {
    const mc = this.methodCount.get(n) || [0, 0, 0];
    return mc[2] > mc[1] ? 2 : 1;
  }

  sectorName(sector) {
    return this.nearestCityName(this.sectors.cx[sector], this.sectors.cy[sector], 4);
  }

  /** Krieg beginnen (technisch; Diplomatie und Folgen in diplomacy.declareWar). */
  startWar(aCode, bCode, text = null) {
    const a = this.idx(aCode);
    const b = this.idx(bCode);
    if (this.isWar(a, b)) return false;
    const fresh = [a, b].filter((n) => !this.inWar[n]);
    this.declareWar(a, b, true, text);
    for (const n of [a, b]) {
      if (!this.nations.has(n)) {
        this.nations.set(n, { status: 'aktiv', capitulationDay: -1, startCells: 0, lossesTotal: 0, prisonersTaken: 0, menLostAsPrisoners: 0, airTotal: 0, airToday: 0, lostShare: 0, lastLossDay: -1000, morale: 60, propaganda: [], lossSeen: 0, deserted: 0, warSince: -1 });
      }
      const st = this.nations.get(n);
      if (!st.startCells) st.startCells = this.ownedCount[n];
      this.addSieges(n);
    }
    markExclaves(this, fresh);
    updateFronts(this);
    return true;
  }

  /** Prüfsumme des Spielzustands (für Reproduzierbarkeitstests). */
  stateHash() {
    let h = 2166136261;
    for (let i = 0; i < this.N; i++) { h ^= this.owner[i]; h = Math.imul(h, 16777619); }
    for (const d of this.divisions) { h ^= (d.id * 31 + Math.round(d.men)) | 0; h = Math.imul(h, 16777619); }
    return (h >>> 0).toString(16);
  }
}

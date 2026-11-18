// Speichern und Laden. Der Spielstand enthält alles, was den weiteren Verlauf beeinflusst,
// damit ein geladener Stand genau so weiterläuft wie ein ununterbrochener Lauf.
// Große Felder werden als Unterschied zum Startzustand (dünn besetzt) gespeichert.
import { updateFronts } from './fronts.js';
import { indexBuildings } from './economy.js';

export const SAVE_VERSION = 3;

const b64 = {
  enc(u8) {
    if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64');
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  },
  dec(str) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
    const s = atob(str);
    const u = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
    return u;
  },
};

/** Dünn besetzte Kodierung: [Index, Wert, Index, Wert, …] aller Abweichungen von `base`. */
function sparse(arr, base) {
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const b = typeof base === 'number' ? base : base[i];
    if (arr[i] !== b) out.push(i, arr[i]);
  }
  return out;
}

function unsparse(target, list, base) {
  if (typeof base === 'number') target.fill(base);
  else target.set(base);
  for (let k = 0; k < list.length; k += 2) target[list[k]] = list[k + 1];
}

export function serialize(sim) {
  const fronts = [...sim.fronts.values()].map((f) => ({
    id: f.id, a: f.a, b: f.b, name: f.name, born: f.born, alive: f.alive, encircled: f.encircled,
    cx: f.cx, cy: f.cy, side: f.side, retreatLogged: !!f.retreatLogged,
  }));
  const pockets = {};
  for (const [n, cells] of sim._pocketCells || []) pockets[n] = cells;
  const exclave = {};
  for (const [n, arr] of sim.exclave) exclave[n] = sparse(arr, 0);
  return {
    v: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    seed: sim.seed,
    day: sim.day,
    rng: sim.rng.getState(),
    owner: sparse(sim.owner, sim.startOwner),
    fort: sparse(sim.fort, 0),
    conqDay: sparse(sim.conqDay, -1),
    conqMethod: sparse(sim.conqMethod, 0),
    frontHint: sparse(sim.frontHint, 0),
    pocketSince: sparse(sim.pocketSince, -1),
    railState: sparse(sim.railState, sim.startRail),
    railProgress: sparse(sim.railProgress, 0),
    damagedRail: sim.damagedRail,
    railLevel: [...sim.railLevel],
    railUpgrades: sim.railUpgrades,
    nodes: sim.nodes.map((n) => n.state),
    bridges: sim.bridges.map((b) => b.state),
    wars: sim.wars,
    inWar: [...sim.inWar],
    box: sim.box,
    divisions: sim.divisions,
    nextDivisionId: sim.nextDivisionId,
    raisedCount: [...(sim.raisedCount || new Map())],
    methodCount: [...sim.methodCount],
    fronts,
    nextFrontId: sim.nextFrontId,
    sectionStats: [...sim.sectionStats],
    sieges: sim.sieges.map((s) => ({ defense: s.defense, besieged: s.besieged, since: s.since, fallen: s.fallen, by: s.by, boundDivisions: s.boundDivisions || 0 })),
    siegeCells: sim.sieges.map((s) => s.cell),
    nations: [...sim.nations],
    econ: [...sim.econ],
    buildings: sim.buildings,
    nextBuildingId: sim.nextBuildingId,
    pockets,
    exclave,
    events: sim.events,
    history: {
      days: sim.history.days,
      eventIdx: sim.history.eventIdx,
      wars: sim.history.wars,
      bytes: b64.enc(concat(sim.history.bytes)),
      lens: sim.history.bytes.map((b) => b.length),
    },
  };
}

function concat(list) {
  const total = list.reduce((s, b) => s + b.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const b of list) { out.set(b, o); o += b.length; }
  return out;
}

/** Spielstand in eine frisch erzeugte Simulation (gleiche Daten) einspielen. */
export function deserialize(sim, s) {
  if (s.v !== SAVE_VERSION) throw new Error(`Spielstand-Version ${s.v} wird nicht unterstützt (erwartet ${SAVE_VERSION}).`);
  sim.seed = s.seed;
  sim.day = s.day;
  sim.rng.setState(s.rng);
  unsparse(sim.owner, s.owner, sim.startOwner);
  unsparse(sim.fort, s.fort, 0);
  unsparse(sim.conqDay, s.conqDay, -1);
  unsparse(sim.conqMethod, s.conqMethod, 0);
  unsparse(sim.frontHint, s.frontHint, 0);
  unsparse(sim.pocketSince, s.pocketSince, -1);
  unsparse(sim.railState, s.railState, sim.startRail);
  unsparse(sim.railProgress, s.railProgress, 0);
  sim.damagedRail = s.damagedRail;
  sim.railLevel.set(s.railLevel);
  sim.railUpgrades = s.railUpgrades;
  s.nodes.forEach((st, i) => { sim.nodes[i].state = st; });
  s.bridges.forEach((st, i) => { sim.bridges[i].state = st; });
  sim.wars = s.wars;
  sim.atWar.fill(0);
  for (const [a, b] of s.wars) { sim.atWar[a * 64 + b] = 1; sim.atWar[b * 64 + a] = 1; }
  sim.inWar.set(s.inWar);
  sim.box = s.box;
  sim.divisions = s.divisions;
  sim.nextDivisionId = s.nextDivisionId;
  sim.raisedCount = new Map(s.raisedCount);
  sim.methodCount = new Map(s.methodCount);
  sim.fronts = new Map();
  for (const f of s.fronts) sim.fronts.set(f.id, { ...f, sections: [], edgeList: null, length: 0 });
  sim.nextFrontId = s.nextFrontId;
  sim.sectionStats = new Map(s.sectionStats);
  s.sieges.forEach((st, i) => Object.assign(sim.sieges[i], st));
  sim.nations = new Map(s.nations);
  sim.econ = new Map(s.econ);
  sim.buildings = s.buildings;
  indexBuildings(sim);
  sim.nextBuildingId = s.nextBuildingId;
  sim.events = s.events;
  // Besitzzähler, Kessel- und Exklavenmarken
  sim.ownedCount.fill(0);
  for (let i = 0; i < sim.N; i++) sim.ownedCount[sim.owner[i]]++;
  sim.pocketMark = new Map();
  sim._pocketCells = new Map();
  for (const n of sim.nations.keys()) {
    const flag = new Uint8Array(sim.N);
    const cells = s.pockets[n] || [];
    for (const i of cells) flag[i] = 1;
    sim.pocketMark.set(n, flag);
    sim._pocketCells.set(n, cells);
  }
  sim.exclave = new Map();
  for (const n of sim.nations.keys()) {
    const arr = new Uint8Array(sim.N);
    unsparse(arr, s.exclave[n] || [], 0);
    sim.exclave.set(n, arr);
  }
  // Momentaufnahmen
  const all = b64.dec(s.history.bytes);
  let o = 0;
  sim.history = { days: s.history.days, eventIdx: s.history.eventIdx, wars: s.history.wars, bytes: [] };
  for (const len of s.history.lens) { sim.history.bytes.push(all.slice(o, o + len)); o += len; }
  sim.changed = [];
  // Abschnitte und Kontaktkanten aus dem Besitz neu aufbauen (verändert keine Kennungen)
  updateFronts(sim);
  return sim;
}

/** Spielstand als Text (JSON). */
export function saveToString(sim) {
  return JSON.stringify(serialize(sim));
}

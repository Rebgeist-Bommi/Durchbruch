// Momentaufnahmen je Spieltag für den späteren Kriegs-Zeitraffer (kompakt).
// Je Tag: geänderte Felder mit neuem Besitzer, gepackt in 3 Bytes (18 Bit Feld, 6 Bit Nation),
// dazu der Index der Ereignisse bis zu diesem Tag. Frontlinien ergeben sich aus Besitz + Krieg.

export function initHistory(sim) {
  sim.history = { days: [], bytes: [], eventIdx: [], wars: [] };
}

export function recordDay(sim) {
  const h = sim.history;
  h.days.push(sim.day);
  const packed = new Uint8Array(sim.changed.length * 3);
  sim.changed.forEach((cell, k) => {
    const v = (cell << 6) | (sim.owner[cell] & 63);
    packed[k * 3] = v & 255;
    packed[k * 3 + 1] = (v >> 8) & 255;
    packed[k * 3 + 2] = (v >> 16) & 255;
  });
  h.bytes.push(packed);
  h.eventIdx.push(sim.events.length);
  h.wars.push(sim.wars.map(([a, b]) => a * 64 + b));
}

export function unpackDay(packed) {
  const out = [];
  for (let k = 0; k < packed.length; k += 3) {
    const v = packed[k] | (packed[k + 1] << 8) | (packed[k + 2] << 16);
    out.push([v >> 6, v & 63]);
  }
  return out;
}

export function historySize(sim) {
  return sim.history.bytes.reduce((s, b) => s + b.length, 0) + sim.history.days.length * 8;
}

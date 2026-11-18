// Reproduzierbarer Zufall (sfc32). Gleicher Startwert -> gleiche Folge, auf jedem System.
export function createRng(seed) {
  let a = 0x9e3779b9 ^ (seed >>> 0);
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = (seed >>> 0) ^ 0x5bd1e995;
  function next() {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    let t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    t = (t + d) | 0;
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  }
  for (let i = 0; i < 16; i++) next();
  // Zustand lesen/setzen (Speichern und Laden)
  next.getState = () => [a >>> 0, b >>> 0, c >>> 0, d >>> 0];
  next.setState = (s) => { [a, b, c, d] = s; };
  return next;
}

/** Zustandsloser Hash -> [0, 1). Für Werte, die den Hauptzufall nicht verbrauchen sollen. */
export function hash01(...parts) {
  let h = 2166136261;
  for (const p of parts) {
    h ^= p | 0;
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

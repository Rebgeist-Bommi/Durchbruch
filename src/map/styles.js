// Farb- und Schriftstile der Karte je Modus.

// Grundpalette (gedeckt, Kartentisch-Optik). Schlüssel = Nationscode.
const BASE = {
  DEU: '#8d8f6f', DAN: '#b89b5e', POL: '#a8775a', SVK: '#a08f6c', HUN: '#a6955f', ITA: '#7d8b5a',
  FRA: '#6d8196', GBR: '#9a7062', IRL: '#8ea079', NLD: '#b48a55', BEL: '#a49770', LUX: '#988c6b',
  CHE: '#b7aa88', LIE: '#a99d7d', AND: '#a99d7d', SMR: '#a99d7d', ESP: '#b59c64', PRT: '#8d9b74',
  YUG: '#9b8a74', GRC: '#7c95a1', BGR: '#92a079', ROU: '#b19a69', SOV: '#9b5e4f', EST: '#8b989e',
  LVA: '#a0796c', LTU: '#a5a26a', FIN: '#a3aeac', SWE: '#8c9fb1', NOR: '#a78170', DNK: '#b08e79',
  TUR: '#a99470',
};

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgb([r, g, b]) {
  return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
}
function mix(a, b, t) {
  return a.map((v, i) => v + (b[i] - v) * t);
}

function palette(fn) {
  const out = {};
  for (const [k, v] of Object.entries(BASE)) out[k] = rgb(fn(hexToRgb(v), k));
  return out;
}

// Relief: Grauwert je Ton (Schattenstufe 0–4 + 5 × Höhenstufe 0–2), Mischung "soft-light"
const SHADE_GRAY = [6, 66, 128, 188, 246];
const BAND_CONTRAST = [0.55, 0.85, 1.0];
export function reliefGray(tone) {
  const s = tone % 5;
  const band = Math.floor(tone / 5);
  const g = 128 + (SHADE_GRAY[s] - 128) * BAND_CONTRAST[band];
  const v = Math.max(0, Math.min(255, Math.round(g)));
  return `rgb(${v},${v},${v})`;
}

export const STYLES = {
  front: {
    sea: '#1E2B25',
    seaGrid: 'rgba(200,161,86,0.05)',
    nation: palette((c) => c),
    reliefAlpha: 1,
    reliefBlend: 'soft-light',
    coast: { color: 'rgba(20,22,15,0.85)', width: 1.1 },
    coastGlow: { color: 'rgba(200,161,86,0.18)', width: 4 },
    land: { color: '#1f1d14', width: 1.6 },
    internal: { color: 'rgba(31,29,20,0.75)', width: 1.0, dash: [5, 4] },
    front: { color: '#9b2a1f', edge: '#e4d9bc', width: 3.2, teeth: true },
    warFront: {
      width: 5, edge: '#15140e', selected: 'rgba(228,217,188,0.55)',
      colors: { Durchbruch: '#e0452a', Vormarsch: '#b5402a', festgefahren: '#7b7a70', halten: '#C8A156', vorbereiten: '#e3b45c' },
    },
    siege: '#e0452a',
    occAlpha: 0.94,
    rails: null,
    city: { fill: '#1A1C14', stroke: '#E4D9BC', capital: '#7a1f17' },
    label: { font: '"Spectral", Georgia, serif', color: '#1a1a12', halo: 'rgba(228,217,188,0.85)' },
    nationLabel: { font: '"IM Fell English SC", Georgia, serif', color: 'rgba(26,28,20,0.62)' },
    select: { stroke: '#C8A156', fill: 'rgba(200,161,86,0.28)' },
    grid: 'rgba(26,28,20,0.22)',
  },
  economy: {
    sea: '#2a2f34',
    seaGrid: 'rgba(255,255,255,0.03)',
    nation: palette((c, k) => {
      if (k === 'DEU') return hexToRgb('#d39b3c');
      const l = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
      return mix([l, l, l], [118, 126, 134], 0.55);
    }),
    reliefAlpha: 0.9,
    reliefBlend: 'soft-light',
    coast: { color: 'rgba(15,17,19,0.9)', width: 1.0 },
    coastGlow: null,
    land: { color: '#1b1e21', width: 1.3 },
    internal: { color: 'rgba(27,30,33,0.7)', width: 0.9, dash: [3, 3] },
    front: null,
    warFront: {
      width: 4, edge: '#16191c', selected: 'rgba(224,168,58,0.45)',
      colors: { Durchbruch: '#ff6a2a', Vormarsch: '#E0A83A', festgefahren: '#9aa1a8', halten: '#cfd4d9', vorbereiten: '#f0c86a' },
    },
    siege: '#E0A83A',
    occAlpha: 0.9,
    rails: { color: 'rgba(222,226,230,0.55)', width: 0.9, highlight: '#2a1d08', highlightWidth: 1.5 },
    city: { fill: '#E0A83A', stroke: '#1b1e21', capital: '#E0A83A' },
    label: { font: '"Saira Condensed", "Arial Narrow", sans-serif', color: '#eef0f2', halo: 'rgba(30,33,37,0.9)' },
    nationLabel: { font: '"Saira Stencil One", Impact, sans-serif', color: 'rgba(240,242,244,0.32)' },
    select: { stroke: '#E0A83A', fill: 'rgba(224,168,58,0.3)' },
    grid: 'rgba(255,255,255,0.10)',
  },
  intel: {
    sea: '#07080b',
    seaGrid: 'rgba(179,38,30,0.04)',
    nation: palette((c, k) => mix(c, [12, 14, 19], k === 'DEU' ? 0.66 : 0.76)),
    reliefAlpha: 1,
    reliefBlend: 'soft-light',
    coast: { color: 'rgba(160,170,185,0.30)', width: 0.9 },
    coastGlow: null,
    land: { color: 'rgba(179,38,30,0.75)', width: 1.0 },
    internal: { color: 'rgba(179,38,30,0.4)', width: 0.8, dash: [2, 3] },
    front: null,
    warFront: {
      width: 3, edge: '#050608', selected: 'rgba(179,38,30,0.45)',
      colors: { Durchbruch: '#ff3b2e', Vormarsch: '#B3261E', festgefahren: '#6f6a62', halten: '#8f897b', vorbereiten: '#c9584f' },
    },
    siege: '#B3261E',
    occAlpha: 0.85,
    rails: null,
    city: { fill: '#c9c3b4', stroke: '#0C0E13', capital: '#B3261E' },
    label: { font: '"Special Elite", "Courier New", monospace', color: '#d8d2c2', halo: 'rgba(12,14,19,0.9)' },
    nationLabel: { font: '"Special Elite", "Courier New", monospace', color: 'rgba(216,210,194,0.28)' },
    select: { stroke: '#B3261E', fill: 'rgba(179,38,30,0.25)' },
    grid: 'rgba(216,210,194,0.08)',
    spotlight: true,
  },
};

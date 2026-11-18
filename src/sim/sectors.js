import { createRng } from './rng.js';

/**
 * Feste Aufteilung des Landes in Abschnitte von ca. `spacing` Feldern Kantenlänge
 * (Voronoi um gejitterte Gitterpunkte). Ein Frontabschnitt = Teil einer Front in einem Sektor.
 * Unabhängig vom Spiel-Seed, damit Abschnitte in jedem Lauf gleich liegen.
 */
export function buildSectors(grid, spacing) {
  const rng = createRng(4242);
  const { cols, rows } = grid;
  const bx = Math.ceil(cols / spacing) + 1;
  const by = Math.ceil(rows / spacing) + 1;
  const seedX = new Float32Array(bx * by);
  const seedY = new Float32Array(bx * by);
  for (let j = 0; j < by; j++) {
    for (let i = 0; i < bx; i++) {
      seedX[j * bx + i] = (i + 0.5 + (rng() - 0.5) * 0.7) * spacing;
      seedY[j * bx + i] = (j + 0.5 + (rng() - 0.5) * 0.7) * spacing;
    }
  }
  const raw = new Int32Array(grid.size).fill(-1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!grid.territory[i]) continue;
      const gi = Math.floor((c + 0.5) / spacing);
      const gj = Math.floor((r + 0.5) / spacing);
      let best = -1;
      let bd = Infinity;
      for (let j = Math.max(0, gj - 1); j <= Math.min(by - 1, gj + 1); j++) {
        for (let k = Math.max(0, gi - 1); k <= Math.min(bx - 1, gi + 1); k++) {
          const s = j * bx + k;
          const d = (seedX[s] - c - 0.5) ** 2 + (seedY[s] - r - 0.5) ** 2;
          if (d < bd) { bd = d; best = s; }
        }
      }
      raw[i] = best;
    }
  }
  // fortlaufende Nummern nur für benutzte Sektoren
  const remap = new Int32Array(bx * by).fill(-1);
  let count = 0;
  const sectorOf = new Int32Array(grid.size).fill(-1);
  for (let i = 0; i < grid.size; i++) {
    const s = raw[i];
    if (s < 0) continue;
    if (remap[s] < 0) remap[s] = count++;
    sectorOf[i] = remap[s];
  }
  const sumC = new Float64Array(count);
  const sumR = new Float64Array(count);
  const cells = new Int32Array(count);
  for (let i = 0; i < grid.size; i++) {
    const s = sectorOf[i];
    if (s < 0) continue;
    sumC[s] += i % cols;
    sumR[s] += Math.floor(i / cols);
    cells[s]++;
  }
  const cx = new Float32Array(count);
  const cy = new Float32Array(count);
  for (let s = 0; s < count; s++) {
    cx[s] = sumC[s] / cells[s] + 0.5;
    cy[s] = sumR[s] / cells[s] + 0.5;
  }
  return { sectorOf, count, cx, cy, cells };
}

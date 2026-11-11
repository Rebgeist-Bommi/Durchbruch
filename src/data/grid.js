import { forward } from './projection.js';

/**
 * Spielfeld aus quadratischen Feldern (9 × 9 km) in EPSG:3035.
 * index = row * cols + col, Zeile 0 liegt im Norden.
 * Jedes Feld: Gebiet (-> Besitzer), Terrain, Nachbarn (4er-Nachbarschaft, nur Land).
 * `owner` ist veränderlich (Nationsindex) – spätere Phasen verschieben Fronten feldweise.
 */
export class Grid {
  constructor(meta, buffer) {
    this.meta = meta;
    this.cols = meta.cols;
    this.rows = meta.rows;
    this.cellSize = meta.cellSize;
    this.originX = meta.originX;
    this.originY = meta.originY;
    const n = this.cols * this.rows;
    this.size = n;
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (bytes.length !== 2 * n) throw new Error(`grid.bin: ${bytes.length} Bytes, erwartet ${2 * n}`);
    this.territory = bytes.subarray(0, n);
    this.terrain = bytes.subarray(n, 2 * n);
    this.territories = meta.territories;
    this.nationCodes = Object.keys(meta.nations);
    this.nationNames = meta.nations;
    const codeIndex = new Map(this.nationCodes.map((c, i) => [c, i + 1]));
    this.owner = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const t = this.territory[i];
      if (t) this.owner[i] = codeIndex.get(this.territories[t - 1].owner);
    }
  }

  isLand(i) {
    return i >= 0 && i < this.size && this.territory[i] !== 0;
  }

  rowCol(i) {
    return [Math.floor(i / this.cols), i % this.cols];
  }

  /** Feldindex zu Weltkoordinaten in Metern, -1 außerhalb. */
  cellAtWorld(x, y) {
    const col = Math.floor((x - this.originX) / this.cellSize);
    const row = Math.floor((this.originY - y) / this.cellSize);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return -1;
    return row * this.cols + col;
  }

  cellAtLonLat(lon, lat) {
    const [x, y] = forward(lon, lat);
    return this.cellAtWorld(x, y);
  }

  /** Begrenzung eines Feldes in Metern. */
  cellBounds(i) {
    const [r, c] = this.rowCol(i);
    const x0 = this.originX + c * this.cellSize;
    const y1 = this.originY - r * this.cellSize;
    return { x0, y0: y1 - this.cellSize, x1: x0 + this.cellSize, y1 };
  }

  territoryOf(i) {
    const t = this.territory[i];
    return t ? this.territories[t - 1] : null;
  }

  ownerOf(i) {
    const o = this.owner[i];
    return o ? this.nationCodes[o - 1] : null;
  }

  terrainOf(i) {
    return this.isLand(i) ? this.meta.terrainTypes[this.terrain[i]] : 'Meer';
  }

  /** Land-Nachbarn in der Reihenfolge N, O, S, W. */
  neighbors(i) {
    const [r, c] = this.rowCol(i);
    const out = [];
    if (r > 0 && this.territory[i - this.cols]) out.push(i - this.cols);
    if (c < this.cols - 1 && this.territory[i + 1]) out.push(i + 1);
    if (r < this.rows - 1 && this.territory[i + this.cols]) out.push(i + this.cols);
    if (c > 0 && this.territory[i - 1]) out.push(i - 1);
    return out;
  }
}

import { Camera } from './camera.js';
import { flagUrl } from '../ui/flags.js';
import { DIPLO_COLORS, STYLES, reliefGray } from './styles.js';
import { isRevealed, describeTarget } from '../sim/intel.js';
import { statusOf as diploStatus, relation as diploRelation } from '../sim/diplomacy.js';

function pathFromLines(lines, closed = false, target = new Path2D()) {
  for (const flat of lines) {
    target.moveTo(flat[0], flat[1]);
    for (let i = 2; i < flat.length; i += 2) target.lineTo(flat[i], flat[i + 1]);
    if (closed) target.closePath();
  }
  return target;
}

/** Zeichnet die Karte auf ein Canvas. Alle Pfade liegen in Karteneinheiten (hm). */
export class MapRenderer {
  constructor(canvas, data, grid) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = data.map;
    this.grid = grid;
    this.mode = 'front';
    this.selected = -1;
    this.showGrid = false;
    this.spot = null;
    this.dpr = 1;
    this.pending = false;
    this.onAfterRender = null;

    const [bx0, by0] = this.map.worldToMap(this.map.bbox[0], this.map.bbox[1]);
    const [bx1, by1] = this.map.worldToMap(this.map.bbox[2], this.map.bbox[3]);
    this.bounds = { minX: bx0, minY: by0, maxX: bx1, maxY: by1 };
    this.camera = new Camera(this.bounds);

    this.buildPaths(data.relief);
    this.reliefCanvas = document.createElement('canvas');
    this.mainCtx = this.ctx;
    // zwischengespeicherte Ebenen (nur bei Kamera-/Moduswechsel neu gezeichnet)
    this.layers = {};
    for (const k of ['under', 'over', 'labels', 'tmp']) this.layers[k] = document.createElement('canvas');
    this.cacheKey = '';
    this.layerVersion = 0;
    this.sim = null;
    this.selectedFront = 0;
    this.selectedSector = -1;
    this.buildOverlay = null;
    this.time = 0;
    const g = this.grid;
    this.cellU = g.cellSize / this.map.unit;
    this.gx0 = (g.originX - this.map.originX) / this.map.unit;
    this.gy1 = (g.originY - this.map.originY) / this.map.unit;
  }

  buildPaths(relief) {
    const m = this.map;
    this.territoryPaths = new Map();
    this.ownerPaths = new Map();
    this.landPath = new Path2D();
    for (const t of m.territories) {
      const p = new Path2D();
      for (const poly of t.polys) pathFromLines(poly, true, p);
      this.territoryPaths.set(t.key, p);
      if (!this.ownerPaths.has(t.owner)) this.ownerPaths.set(t.owner, new Path2D());
      this.ownerPaths.get(t.owner).addPath(p);
      this.landPath.addPath(p);
    }
    this.coastPath = pathFromLines(m.borders.coast);
    this.landBorderPath = pathFromLines(m.borders.land);
    this.internalPath = pathFromLines(m.borders.internal);
    this.railPath = pathFromLines(m.rails);
    this.frontPath = new Path2D();
    for (const f of m.fronts) pathFromLines(f.lines, false, this.frontPath);

    // Relief: ein Pfad je Ton -> wenige Füllaufrufe
    this.reliefPaths = Array.from({ length: 15 }, () => new Path2D());
    const { coords, tones, triCount } = relief;
    for (let t = 0; t < triCount; t++) {
      const p = this.reliefPaths[tones[t]];
      const o = t * 6;
      p.moveTo(coords[o], coords[o + 1]);
      p.lineTo(coords[o + 2], coords[o + 3]);
      p.lineTo(coords[o + 4], coords[o + 5]);
      p.closePath();
    }
    this.reliefGrays = this.reliefPaths.map((_, i) => reliefGray(i));
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'diplomacy' && this.sim) this.updateDiploColors(false);
    this.layerVersion++;
    if (this.sim) this.rebuildOccupation();
    this.requestRender();
  }

  invalidate() {
    this.layerVersion++;
    this.requestRender();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.reliefCanvas.width = this.canvas.width;
    this.reliefCanvas.height = this.canvas.height;
    for (const c of Object.values(this.layers)) {
      c.width = this.canvas.width;
      c.height = this.canvas.height;
    }
    this.layerVersion++;
    const first = this.camera.width === 1;
    this.camera.resize(w, h);
    if (first) this.focusStart();
    this.render();
  }

  /** Startansicht: Mitteleuropa um Deutschland und Polen */
  focusStart() {
    const [x0, y0] = this.map.worldToMap(3_550_000, 2_450_000);
    const [x1, y1] = this.map.worldToMap(5_650_000, 3_700_000);
    this.camera.fit(x0, y0, x1, y1);
  }

  requestRender() {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.render(this.t ?? 1);
    });
  }

  /** Ein Bild zeichnen. `t` (0–1) = Fortschritt innerhalb des laufenden Spieltags. */
  render(t = 1) {
    const t0 = performance.now();
    if (this.camera.stepZoom && this.camera.stepZoom()) this.requestRender(); // weicher Zoom
    const { camera: cam, dpr } = this;
    const st = STYLES[this.mode];
    const W = this.canvas.width;
    const H = this.canvas.height;
    const key = `${this.mode}|${cam.cx.toFixed(3)}|${cam.cy.toFixed(3)}|${cam.scale.toFixed(6)}|${W}|${H}|${this.layerVersion}|${this.sim?.railLevelVersion || 0}`;
    if (key !== this.cacheKey) {
      this.renderStatic(st);
      this.cacheKey = key;
    }
    const ctx = this.mainCtx;
    this.ctx = ctx;
    const u = 1 / cam.scale;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.layers.under, 0, 0);
    if (this.sim) this.drawOccupation(st, t);
    if (this.mode === 'front') this.drawSupply();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layers.over, 0, 0);

    ctx.setTransform(...cam.matrix(dpr));
    if (this.showGrid) this.drawGrid(st, u);
    if (st.front) this.drawStaticFronts(st, u);
    if (this.sim) this.drawWarFronts(st, u, t);
    if (this.sim && st.rails) this.drawEconomyOverlay(st, u);
    if (this.selected >= 0) this.drawSelection(st, u);

    // Industriesymbole unter den Beschriftungen, damit Stadtnamen lesbar bleiben
    if (this.sim && st.rails) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.drawIndustry(st);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layers.labels, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.sim) this.drawSieges(st);
    if (this.sim && this.mode === 'front') { this.drawObjectives(); this.drawUnits(st, t); }
    if (st.spotlight) this.drawSpotlight();
    if (this.sim && st.spotlight) this.drawIntel(st);

    this.lastFrameMs = performance.now() - t0;
    if (this.onAfterRender) this.onAfterRender();
  }

  /** Statische Ebenen: Meer, Länder, Relief (unter der Besetzung); Grenzen, Bahn (darüber); Beschriftung. */
  renderStatic(st) {
    const { camera: cam, dpr } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const u = 1 / cam.scale;
    const t0 = performance.now();

    let ctx = this.layers.under.getContext('2d');
    this.ctx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = st.sea;
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(...cam.matrix(dpr));
    this.drawSeaGrid(st, u);
    for (const t of this.map.territories) {
      ctx.fillStyle = st.nation[t.owner] || '#888';
      ctx.fill(this.territoryPaths.get(t.key));
    }
    this.drawRelief(st, u);
    if (st.rails && this.sim) {
      // Rohstoffgebiete (Kohle, Erz, Öl) im Wirtschaftsmodus
      ctx.save();
      ctx.clip(this.landPath);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.75;
      this.drawCells(ctx, this.resourceCanvas());
      ctx.restore();
    }

    ctx = this.layers.over.getContext('2d');
    this.ctx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(...cam.matrix(dpr));
    if (st.rails && this.sim) this.drawRailLevels(st, u);
    else if (st.rails) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = st.rails.color;
      ctx.lineWidth = st.rails.width * u;
      ctx.stroke(this.railPath);
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (st.coastGlow) {
      ctx.strokeStyle = st.coastGlow.color;
      ctx.lineWidth = st.coastGlow.width * u;
      ctx.stroke(this.coastPath);
    }
    ctx.strokeStyle = st.coast.color;
    ctx.lineWidth = st.coast.width * u;
    ctx.stroke(this.coastPath);
    ctx.strokeStyle = st.internal.color;
    ctx.lineWidth = st.internal.width * u;
    ctx.setLineDash(st.internal.dash.map((d) => d * u));
    ctx.stroke(this.internalPath);
    ctx.setLineDash([]);
    ctx.strokeStyle = st.land.color;
    ctx.lineWidth = st.land.width * u;
    ctx.stroke(this.landBorderPath);

    ctx = this.layers.labels.getContext('2d');
    this.ctx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(st);
    this.ctx = this.mainCtx;
    this.lastStaticMs = performance.now() - t0;
  }

  drawSeaGrid(st, u) {
    // dezentes Gradnetz-Ersatzraster (alle 500 km) für Orientierung auf dem Meer
    const { ctx } = this;
    const v = this.camera.view();
    const step = 5000;
    ctx.strokeStyle = st.seaGrid;
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    for (let x = Math.ceil(v.x0 / step) * step; x <= v.x1; x += step) {
      ctx.moveTo(x, v.y0);
      ctx.lineTo(x, v.y1);
    }
    for (let y = Math.ceil(v.y0 / step) * step; y <= v.y1; y += step) {
      ctx.moveTo(v.x0, y);
      ctx.lineTo(v.x1, y);
    }
    ctx.stroke();
  }

  drawRelief(st, u) {
    const r = this.reliefCanvas.getContext('2d');
    r.setTransform(1, 0, 0, 1, 0, 0);
    r.clearRect(0, 0, this.reliefCanvas.width, this.reliefCanvas.height);
    r.setTransform(...this.camera.matrix(this.dpr));
    r.lineJoin = 'round';
    r.lineWidth = 0.9 * u; // gleiche Farbe als Kontur schließt Haarfugen zwischen Dreiecken
    for (let i = 0; i < 15; i++) {
      r.fillStyle = this.reliefGrays[i];
      r.strokeStyle = this.reliefGrays[i];
      r.fill(this.reliefPaths[i]);
      r.stroke(this.reliefPaths[i]);
    }
    const { ctx } = this;
    ctx.save();
    ctx.clip(this.landPath);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = st.reliefBlend || 'overlay';
    ctx.globalAlpha = st.reliefAlpha;
    ctx.drawImage(this.reliefCanvas, 0, 0);
    ctx.restore();
  }

  drawGrid(st, u) {
    const g = this.grid;
    const cellU = g.cellSize / this.map.unit;
    if (cellU / u < 5) return; // zu klein zum Zeichnen
    const { ctx } = this;
    const v = this.camera.view();
    const gx0 = (g.originX - this.map.originX) / this.map.unit;
    const gy1 = (g.originY - this.map.originY) / this.map.unit;
    const c0 = Math.max(0, Math.floor((v.x0 - gx0) / cellU));
    const c1 = Math.min(g.cols, Math.ceil((v.x1 - gx0) / cellU));
    const r0 = Math.max(0, Math.floor((gy1 - v.y1) / cellU));
    const r1 = Math.min(g.rows, Math.ceil((gy1 - v.y0) / cellU));
    ctx.save();
    ctx.clip(this.landPath);
    ctx.strokeStyle = st.grid;
    ctx.lineWidth = 1 * u;
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) {
      ctx.moveTo(gx0 + c * cellU, gy1 - r0 * cellU);
      ctx.lineTo(gx0 + c * cellU, gy1 - r1 * cellU);
    }
    for (let r = r0; r <= r1; r++) {
      ctx.moveTo(gx0 + c0 * cellU, gy1 - r * cellU);
      ctx.lineTo(gx0 + c1 * cellU, gy1 - r * cellU);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Phase-1-Grenzlinien (z. B. deutsch-französisch) nur, solange dort kein Krieg geführt wird. */
  drawStaticFronts(st, u) {
    const { ctx } = this;
    const scenarioPairs = this.scenarioPairs || new Set();
    const p = new Path2D();
    let any = false;
    for (const fr of this.map.fronts) {
      const key = [fr.attacker, fr.defender].sort().join('-');
      if (scenarioPairs.has(key)) continue;
      for (const flat of fr.lines) {
        p.moveTo(flat[0], flat[1]);
        for (let i = 2; i < flat.length; i += 2) p.lineTo(flat[i], flat[i + 1]);
        any = true;
      }
    }
    if (!any) return;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(200,161,86,0.85)';
    ctx.lineWidth = 2.2 * u;
    ctx.setLineDash([7 * u, 5 * u]);
    ctx.stroke(p);
    ctx.setLineDash([]);
  }

  frontTeeth(spacing, size) {
    const p = new Path2D();
    for (const fr of this.map.fronts) {
      for (const flat of fr.lines) {
        let carry = spacing / 2;
        for (let i = 0; i + 3 < flat.length; i += 2) {
          const ax = flat[i], ay = flat[i + 1], bx = flat[i + 2], by = flat[i + 3];
          const len = Math.hypot(bx - ax, by - ay);
          if (len === 0) continue;
          const dx = (bx - ax) / len, dy = (by - ay) / len;
          // rechte Normale in Karteneinheiten (y nach Norden): (dy, -dx)
          const nx = dy, ny = -dx;
          let s = carry;
          while (s < len) {
            const px = ax + dx * s, py = ay + dy * s;
            p.moveTo(px - dx * size * 0.65, py - dy * size * 0.65);
            p.lineTo(px + nx * size, py + ny * size);
            p.lineTo(px + dx * size * 0.65, py + dy * size * 0.65);
            p.closePath();
            s += spacing;
          }
          carry = s - len;
        }
      }
    }
    return p;
  }

  drawSelection(st, u) {
    const { ctx, grid } = this;
    const b = grid.cellBounds(this.selected);
    const [x0, y0] = this.map.worldToMap(b.x0, b.y0);
    const [x1, y1] = this.map.worldToMap(b.x1, b.y1);
    ctx.fillStyle = st.select.fill;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = st.select.stroke;
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  /** Beschriftungen ohne Überlappung (gierige Platzierung nach Rang). */
  drawLabels(st) {
    const { ctx, camera: cam } = this;
    // Bedienelemente, die über der Karte liegen (z. B. die Akte im Geheimdienstmodus), freihalten
    const placed = [];
    const cr = this.canvas.getBoundingClientRect();
    for (const el of document.querySelectorAll('[data-map-overlay]')) {
      if (getComputedStyle(el).position !== 'absolute') continue;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) placed.push({ x0: r.left - cr.left - 6, y0: r.top - cr.top - 6, x1: r.right - cr.left + 6, y1: r.bottom - cr.top + 6 });
    }
    const hit = (r) => placed.some((p) => r.x0 < p.x1 && r.x1 > p.x0 && r.y0 < p.y1 && r.y1 > p.y0);
    const W = cam.width;
    const H = cam.height;
    const zoom = cam.scale / cam.minScale;

    // Städte zuerst reservieren (Symbole), dann Namen
    const cities = this.map.cities
      .filter((c) => c.rank === 1 || (c.rank === 2 && cam.scale > 0.045) || (c.rank === 3 && cam.scale > 0.085))
      .sort((a, b) => a.rank - b.rank || b.capital - a.capital);
    const items = [];
    for (const c of cities) {
      const [sx, sy] = cam.toScreen(c.x, c.y);
      if (sx < -50 || sy < -20 || sx > W + 50 || sy > H + 20) continue;
      const r = c.capital ? 4.2 : 3;
      const box = { x0: sx - r - 1, y0: sy - r - 1, x1: sx + r + 1, y1: sy + r + 1 };
      if (hit(box)) continue;
      placed.push(box);
      items.push({ c, sx, sy, r });
    }

    // Nationen- und Gebietsnamen
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    const nl = st.nationLabel;
    const terrs = [...this.map.territories].sort((a, b) => b.area - a.area);
    for (const t of terrs) {
      const main = t.key === t.owner;
      const pxArea = t.area * 1e6 * (cam.scale / this.map.unit) ** 2;
      if (pxArea < (main ? 2600 : 9000)) continue;
      const [ax, ay] = cam.toScreen(t.label[0], t.label[1]);
      if (ax < 0 || ay < 0 || ax > W || ay > H) continue;
      const area = main ? this.ownerPaths.get(t.owner) : this.territoryPaths.get(t.key);
      const base = Math.max(10, Math.min(main ? 22 : 13, Math.sqrt(pxArea) / 9));
      const text = main ? t.name.toUpperCase().split('').join('\u2009') : t.name;
      let done = false;
      for (const size of [base, base * 0.8, base * 0.64]) {
        if (done || size < 9) break;
        ctx.font = `${main ? '' : 'italic '}${size.toFixed(1)}px ${nl.font}`;
        const w = ctx.measureText(text).width;
        for (const k of [0, -1.6, 1.6, -3.2, 3.2]) {
          const sx = ax;
          const sy = ay + k * size;
          const box = { x0: sx - w / 2 - 3, y0: sy - size / 2 - 2, x1: sx + w / 2 + 3, y1: sy + size / 2 + 2 };
          if (box.x0 < 2 || box.x1 > W - 2 || box.y0 < 2 || box.y1 > H - 2 || hit(box)) continue;
          if (!this.boxInside(area, box)) continue;
          placed.push(box);
          ctx.fillStyle = nl.color;
          ctx.fillText(text, sx, sy);
          done = true;
          break;
        }
      }
    }

    // Städte: Symbol + Name
    const lab = st.label;
    for (const it of items) {
      const { c, sx, sy, r } = it;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = st.city.stroke;
      ctx.fillStyle = c.capital ? st.city.capital : st.city.fill;
      if (c.capital) {
        ctx.fillRect(sx - r, sy - r, 2 * r, 2 * r);
        ctx.strokeRect(sx - r, sy - r, 2 * r, 2 * r);
      } else {
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      const size = c.rank === 1 ? 14 : c.rank === 2 ? 12.5 : 11.5;
      ctx.font = `${c.rank === 1 ? '600 ' : ''}${size}px ${lab.font}`;
      const w = ctx.measureText(c.name).width;
      // Kandidatenpositionen: rechts, links, oben, unten
      const cands = [
        [sx + r + 4, sy, 'left'],
        [sx - r - 4, sy, 'right'],
        [sx, sy - r - size * 0.7, 'center'],
        [sx, sy + r + size * 0.7, 'center'],
      ];
      for (const [lx, ly, align] of cands) {
        const x0 = align === 'left' ? lx : align === 'right' ? lx - w : lx - w / 2;
        const box = { x0: x0 - 2, y0: ly - size / 2 - 1, x1: x0 + w + 2, y1: ly + size / 2 + 1 };
        if (box.x0 < 0 || box.x1 > W || box.y0 < 0 || box.y1 > H || hit(box)) continue;
        placed.push(box);
        ctx.textAlign = align;
        ctx.lineJoin = 'round';
        ctx.lineWidth = 3;
        ctx.strokeStyle = lab.halo;
        ctx.strokeText(c.name, lx, ly);
        ctx.fillStyle = lab.color;
        ctx.fillText(c.name, lx, ly);
        break;
      }
    }
    this.placedLabels = placed;
  }

  /** Liegt das Beschriftungsrechteck (CSS-Pixel) vollständig in der Fläche? */
  boxInside(path, box) {
    const { ctx, dpr } = this;
    ctx.save();
    ctx.setTransform(...this.camera.matrix(dpr));
    const xs = [box.x0 + 2, (box.x0 + box.x1) / 2, box.x1 - 2];
    const ys = [box.y0 + 2, box.y1 - 2];
    let ok = true;
    for (const x of xs) for (const y of ys) if (ok && !ctx.isPointInPath(path, x * dpr, y * dpr)) ok = false;
    ctx.restore();
    return ok;
  }

  drawSpotlight() {
    const { ctx, camera: cam } = this;
    const W = cam.width;
    const H = cam.height;
    const sx = this.spot ? this.spot[0] : W * 0.52;
    const sy = this.spot ? this.spot[1] : H * 0.45;
    const R = Math.min(W, H) * 0.34;
    const g = ctx.createRadialGradient(sx, sy, R * 0.15, sx, sy, R);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(0.7, 'rgba(3,4,6,0.45)');
    g.addColorStop(1, 'rgba(3,4,6,0.82)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // warmer Lichtschein der Lampe
    ctx.globalCompositeOperation = 'screen';
    const l = ctx.createRadialGradient(sx, sy, 0, sx, sy, R * 0.8);
    l.addColorStop(0, 'rgba(255,236,190,0.16)');
    l.addColorStop(1, 'rgba(255,236,190,0)');
    ctx.fillStyle = l;
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---------------------------------------------------------------- Phase 2: Simulation
  attachSim(sim) {
    this.sim = sim;
    this.scenarioPairs = new Set(sim.bal.scenario.wars.map((w) => [...w].sort().join('-')));
    const { cols, rows } = this.grid;
    const mk = () => {
      const c = document.createElement('canvas');
      c.width = cols;
      c.height = rows;
      return c;
    };
    this.occ = { prev: mk(), curr: mk(), annex: mk(), anim: mk() };
    this.occImg = this.occ.curr.getContext('2d').createImageData(cols, rows);
    this.animImg = this.occ.anim.getContext('2d').createImageData(cols, rows);
    this.anim = null;
    this.prevOwner = Uint8Array.from(sim.owner);
    this.annexImg = this.occ.annex.getContext('2d').createImageData(cols, rows);
    this.origOwner = new Uint8Array(this.grid.size);
    const idx = new Map(this.grid.nationCodes.map((c, i) => [c, i + 1]));
    for (let i = 0; i < this.grid.size; i++) {
      const t = this.grid.territory[i];
      if (t) this.origOwner[i] = idx.get(this.grid.territories[t - 1].owner);
    }
    this.edgeFrontAt = new Int32Array(this.grid.size);
    this.hatch = this.makeHatch();
    this.rebuildOccupation();
    this.annexApplied = 0;
    this.applyAnnexations();
    this.frontGeom = this.buildFrontGeometry();
    this.prevFrontGeom = null;
  }

  /**
   * Friedliche Gebietsänderungen (Szenario, Anschluss) in die Karte übernehmen: Besitzer und Name
   * der Gebiete, Länderflächen und Ausgangsbesitz der Felder (keine Besatzungsschraffur).
   */
  applyAnnexations() {
    const list = this.sim?.dip?.annexed || [];
    if (this.annexApplied >= list.length) return false;
    const idx = new Map(this.grid.nationCodes.map((c, i) => [c, i + 1]));
    for (let k = this.annexApplied; k < list.length; k++) {
      const a = list[k];
      const to = idx.get(a.to);
      const tid = a.territory ? this.grid.territories.findIndex((t) => t.key === a.territory) + 1 : 0;
      const nat = a.nation ? idx.get(a.nation) : 0;
      for (const t of this.map.territories) {
        if ((a.territory && t.key === a.territory) || (a.nation && t.owner === a.nation)) {
          t.owner = a.to;
          if (a.rename) t.name = a.rename;
        }
      }
      for (let i = 0; i < this.grid.size; i++) {
        if (tid ? this.grid.territory[i] === tid : (nat && this.origOwner[i] === nat)) {
          if (this.sim.owner[i] === to) this.origOwner[i] = to;
        }
      }
    }
    this.annexApplied = list.length;
    // Länderflächen neu gruppieren, statische Ebenen und Besetzung neu zeichnen
    this.ownerPaths = new Map();
    for (const t of this.map.territories) {
      if (!this.ownerPaths.has(t.owner)) this.ownerPaths.set(t.owner, new Path2D());
      this.ownerPaths.get(t.owner).addPath(this.territoryPaths.get(t.key));
    }
    this.layerVersion++;
    this.rebuildOccupation();
    return true;
  }

  /** Diplomatie-Ansicht: Länderfarbe nach Stand und Beziehung zum Spieler. */
  updateDiploColors(bump = true) {
    const sim = this.sim;
    const p = sim.player;
    const nation = STYLES.diplomacy.nation;
    for (let n = 1; n <= this.grid.nationCodes.length; n++) {
      const code = sim.code(n);
      let c;
      if (n === p) c = DIPLO_COLORS.self;
      else if (!sim.ownedCount[n]) c = DIPLO_COLORS.weg;
      else {
        const s = diploStatus(sim, p, n);
        if (s !== 'neutral') c = DIPLO_COLORS[s];
        else {
          const r = diploRelation(sim, p, n);
          c = r >= 30 ? DIPLO_COLORS.gut : r <= -30 ? DIPLO_COLORS.schlecht : DIPLO_COLORS.neutral;
        }
      }
      nation[code] = c;
    }
    if (bump && this.mode === 'diplomacy') { this.layerVersion++; this.rebuildOccupation(); this.requestRender(); }
  }

  /** Nachschub-Schicht: eigene Felder mit schwachem Nachschub rötlich (Feldbild, einmal je Tag). */
  buildSupplyImage() {
    const { cols, rows } = this.grid;
    if (!this.supplyCanvas) { this.supplyCanvas = document.createElement('canvas'); this.supplyCanvas.width = cols; this.supplyCanvas.height = rows; }
    const ctx = this.supplyCanvas.getContext('2d');
    const img = ctx.createImageData(cols, rows);
    const sim = this.sim;
    const p = sim.player;
    // nur Frontnähe: Breitensuche von den eigenen Frontfeldern aus (bis 22 Felder ≈ 200 km)
    const near = new Uint8Array(sim.N);
    const q = [];
    for (const f of sim.fronts.values()) {
      if (!f.alive || !f.side[p]) continue;
      for (const c of sim.frontCellsOf(f, p)) if (!near[c]) { near[c] = 1; q.push(c); }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      if (near[i] > 22) continue;
      for (let k = i * 4, e = k + 4; k < e; k++) {
        const j = sim.nb[k];
        if (j >= 0 && !near[j] && sim.owner[j] === p) { near[j] = near[i] + 1; q.push(j); }
      }
    }
    for (const i of q) {
      const s = sim.supplyDisplay(i);
      if (s >= 0.97) continue;
      const k = Math.min(1, (1 - s) / 0.5);
      const o = i * 4;
      img.data[o] = 200; img.data[o + 1] = 60 + 120 * (1 - k); img.data[o + 2] = 30; img.data[o + 3] = Math.round(70 + 120 * k);
    }
    ctx.putImageData(img, 0, 0);
    this.supplyDay = sim.day;
  }

  drawSupply() {
    if (!this.supplyOn || !this.sim) return;
    if (this.supplyDay !== this.sim.day || !this.supplyCanvas) this.buildSupplyImage();
    const main = this.mainCtx;
    main.save();
    main.setTransform(...this.camera.matrix(this.dpr));
    main.imageSmoothingEnabled = false;
    main.globalAlpha = 0.75;
    this.drawCells(main, this.supplyCanvas);
    main.restore();
  }

  makeHatch() {
    const c = document.createElement('canvas');
    c.width = 8;
    c.height = 8;
    const x = c.getContext('2d');
    x.strokeStyle = 'rgba(0,0,0,0.32)';
    x.lineWidth = 1.4;
    x.beginPath();
    x.moveTo(-2, 10);
    x.lineTo(10, -2);
    x.moveTo(6, 10);
    x.lineTo(10, 6);
    x.moveTo(-2, 2);
    x.lineTo(2, -2);
    x.stroke();
    return this.ctx.createPattern(c, 'repeat');
  }

  /** Farbe eines besetzten Feldes (RGB) im aktuellen Modus. */
  occColor(i) {
    const st = STYLES[this.mode];
    const code = this.grid.nationCodes[this.sim.owner[i] - 1];
    const css = st.nation[code] || '#888888';
    let rgb = css.startsWith('#')
      ? [1, 3, 5].map((k) => parseInt(css.slice(k, k + 2), 16))
      : css.match(/\d+/g).slice(0, 3).map(Number);
    if (this.sim.conqMethod[i] === 2) rgb = rgb.map((v, k) => v * 0.55 + [59, 42, 27][k] * 0.45); // verwüstet
    return rgb;
  }

  /** Felder kriegführender Nationen, die an ein erobertes Feld grenzen (8er-Nachbarschaft). */
  nearConquest(i) {
    const sim = this.sim;
    const { cols, rows } = this.grid;
    const r = Math.floor(i / cols);
    const c = i - r * cols;
    for (let dr = -1; dr <= 1; dr++) {
      const rr = r + dr;
      if (rr < 0 || rr >= rows) continue;
      for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc;
        if ((!dr && !dc) || cc < 0 || cc >= cols) continue;
        const j = rr * cols + cc;
        if (sim.owner[j] && sim.owner[j] !== this.origOwner[j]) return true;
      }
    }
    return false;
  }

  /**
   * Pixel je Feld: eroberte Felder in "occ" (schraffiert), angegliederte Felder und ein Saum
   * aus Feldern neben eroberten Feldern in "annex" (ohne Schraffur). Der Saum deckt kleine
   * Abweichungen zwischen Grenzflächen und 9-km-Raster an der alten Grenze ab.
   */
  writeOccPixel(i) {
    const sim = this.sim;
    const o = i * 4;
    const occ = this.occImg.data;
    const ann = this.annexImg.data;
    occ[o + 3] = 0;
    ann[o + 3] = 0;
    const own = sim.owner[i];
    if (!own) return;
    const conquered = own !== this.origOwner[i];
    let d = null;
    if (conquered) d = sim.conqMethod[i] === 0 ? ann : occ;
    else if (sim.inWar[own] && this.nearConquest(i)) d = ann;
    if (!d) return;
    const [r, g, b] = this.occColor(i);
    d[o] = r;
    d[o + 1] = g;
    d[o + 2] = b;
    d[o + 3] = 255;
  }

  rebuildOccupation() {
    if (!this.sim) return;
    for (let i = 0; i < this.grid.size; i++) this.writeOccPixel(i);
    this.occ.curr.getContext('2d').putImageData(this.occImg, 0, 0);
    const pc = this.occ.prev.getContext('2d');
    pc.clearRect(0, 0, this.occ.prev.width, this.occ.prev.height);
    pc.drawImage(this.occ.curr, 0, 0);
    this.occ.annex.getContext('2d').putImageData(this.annexImg, 0, 0);
    this.anim = null;
    if (this.prevOwner) this.prevOwner.set(this.sim.owner);
  }

  /** Nach jedem Simulations-Tick: geänderte Felder und Frontgeometrie übernehmen. */
  onTick() {
    if (this.applyAnnexations()) this.frontGeom = this.buildFrontGeometry();
    if (this.mode === 'diplomacy') this.updateDiploColors();
    const { cols, rows } = this.grid;
    const touched = new Set();
    for (const i of this.sim.changed) {
      const r = Math.floor(i / cols);
      const c = i - r * cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) touched.add(rr * cols + cc);
        }
      }
    }
    const occ = this.occImg.data;
    const before = new Map();
    for (const i of touched) before.set(i, occ.slice(i * 4, i * 4 + 4));
    for (const i of touched) this.writeOccPixel(i);
    this.occ.curr.getContext('2d').putImageData(this.occImg, 0, 0);
    if (touched.size) this.occ.annex.getContext('2d').putImageData(this.annexImg, 0, 0);
    this.startOccAnim(before);
    this.prevOwner.set(this.sim.owner);
    const prev = this.frontGeom;
    this.frontGeom = this.buildFrontGeometry();
    this.linkGeometry(prev, this.frontGeom);
  }

  /**
   * Eroberte Felder füllen sich über den Tag wellenförmig: Felder neben dem bisherigen Gebiet des
   * Eroberers zuerst, tiefere Vorstöße später (Tiefe über Breitensuche), mit leichter Streuung.
   */
  startOccAnim(before) {
    const sim = this.sim;
    const occ = this.occImg.data;
    const cells = [];
    for (const [i, px] of before) {
      const o = i * 4;
      if (px[0] !== occ[o] || px[1] !== occ[o + 1] || px[2] !== occ[o + 2] || px[3] !== occ[o + 3]) cells.push(i);
    }
    if (!cells.length) return; // nichts Neues: laufende Animation bleibt
    const prevOwner = this.prevOwner;
    const depth = new Map();
    const q = [];
    for (const i of cells) {
      const n = sim.owner[i];
      if (n === prevOwner[i]) { depth.set(i, 0); continue; }
      for (let k = i * 4, e = k + 4; k < e; k++) {
        const j = sim.nb[k];
        if (j >= 0 && prevOwner[j] === n && sim.owner[j] === n) { depth.set(i, 0); q.push(i); break; }
      }
    }
    for (let h = 0; h < q.length; h++) {
      const i = q[h];
      const d = depth.get(i);
      for (let k = i * 4, e = k + 4; k < e; k++) {
        const j = sim.nb[k];
        if (j >= 0 && before.has(j) && !depth.has(j) && sim.owner[j] === sim.owner[i] && prevOwner[j] !== sim.owner[j]) { depth.set(j, d + 1); q.push(j); }
      }
    }
    const n = cells.length;
    const delay = new Float32Array(n);
    const prev = new Uint8ClampedArray(n * 4);
    const { cols } = this.grid;
    let x0 = cols; let x1 = -1; let y0 = 1e9; let y1 = -1;
    cells.forEach((i, k) => {
      const jitter = (((i * 2654435761) >>> 0) % 1000) / 1000;
      delay[k] = Math.min(0.62, (depth.get(i) ?? 2) * 0.17 + jitter * 0.14);
      prev.set(before.get(i), k * 4);
      const r = (i / cols) | 0;
      const c = i - r * cols;
      if (c < x0) x0 = c; if (c > x1) x1 = c; if (r < y0) y0 = r; if (r > y1) y1 = r;
    });
    this.animImg.data.set(occ);
    this.anim = { cells: Int32Array.from(cells), delay, prev, box: [x0, y0, x1 - x0 + 1, y1 - y0 + 1], lastT: -1 };
    this.updateOccAnim(0);
  }

  updateOccAnim(t) {
    const A = this.anim;
    if (!A || Math.abs(t - A.lastT) < 0.004) return;
    A.lastT = t;
    const cur = this.occImg.data;
    const out = this.animImg.data;
    for (let k = 0; k < A.cells.length; k++) {
      const o = A.cells[k] * 4;
      const a = ease(Math.max(0, Math.min(1, (t - A.delay[k]) / 0.3)));
      const pa = A.prev[k * 4 + 3];
      const ca = cur[o + 3];
      if (!pa) { out[o] = cur[o]; out[o + 1] = cur[o + 1]; out[o + 2] = cur[o + 2]; out[o + 3] = ca * a; }
      else if (!ca) { out[o] = A.prev[k * 4]; out[o + 1] = A.prev[k * 4 + 1]; out[o + 2] = A.prev[k * 4 + 2]; out[o + 3] = pa * (1 - a); }
      else for (let c = 0; c < 4; c++) out[o + c] = A.prev[k * 4 + c] + (cur[o + c] - A.prev[k * 4 + c]) * a;
    }
    const [x, y, w, h] = A.box;
    this.occ.anim.getContext('2d').putImageData(this.animImg, 0, 0, x, y, w, h);
  }

  /**
   * Draht wandert statt zu überblenden: Jeder Punkt der neuen Linie wird dem nächsten Punkt der
   * alten Linie (bis ca. 4 Felder) zugeordnet und über den Tag dorthin verschoben. Neue Linienteile
   * blenden ein, verschwundene aus.
   */
  linkGeometry(prev, next) {
    next.linked = false;
    next.gone = null;
    if (!prev || !prev.chains.length) return;
    const B = this.cellU * 3.5;
    const R2 = B * B;
    const bucket = (geom) => {
      const m = new Map();
      for (const ch of geom.chains) {
        const P = ch.p;
        for (let i = 0; i < P.length; i += 2) {
          const k = Math.floor(P[i] / B) * 65536 + Math.floor(P[i + 1] / B);
          let b = m.get(k);
          if (!b) m.set(k, (b = []));
          b.push(P[i], P[i + 1]);
        }
      }
      return m;
    };
    const nearest = (m, x, y, out) => {
      const cx = Math.floor(x / B);
      const cy = Math.floor(y / B);
      let bd = R2;
      let hit = false;
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const b = m.get((cx + dx) * 65536 + cy + dy);
          if (!b) continue;
          for (let j = 0; j < b.length; j += 2) {
            const d = (b[j] - x) ** 2 + (b[j + 1] - y) ** 2;
            if (d < bd) { bd = d; out[0] = b[j]; out[1] = b[j + 1]; hit = true; }
          }
        }
      }
      return hit;
    };
    const old = bucket(prev);
    const tmp = [0, 0];
    let moved = 0;
    for (const ch of next.chains) {
      const P = ch.p;
      const from = new Float32Array(P.length);
      let fresh = 0;
      for (let i = 0; i < P.length; i += 2) {
        if (nearest(old, P[i], P[i + 1], tmp)) {
          from[i] = tmp[0]; from[i + 1] = tmp[1];
          if (tmp[0] !== P[i] || tmp[1] !== P[i + 1]) moved++;
        } else { from[i] = P[i]; from[i + 1] = P[i + 1]; fresh++; }
      }
      ch.from = from;
      ch.fadeIn = fresh * 2 > P.length / 2;
    }
    const neu = bucket(next);
    const gone = prev.chains.filter((ch) => {
      let miss = 0;
      for (let i = 0; i < ch.p.length; i += 2) if (!nearest(neu, ch.p[i], ch.p[i + 1], tmp)) miss++;
      return miss * 2 > ch.p.length / 2;
    }).map((ch) => ({ ...ch, from: null }));
    next.gone = gone.length ? this.geomPaths(gone) : null;
    next.linked = moved > 0 || !!gone.length || next.chains.some((c) => c.fadeIn);
  }

  /** Feldbild in Karteneinheiten zeichnen (Zeile 0 = Norden). */
  drawCells(ctx, img) {
    ctx.save();
    ctx.translate(this.gx0, this.gy1);
    ctx.scale(this.cellU, -this.cellU);
    ctx.drawImage(img, 0, 0);
    ctx.restore();
  }

  drawOccupation(st, t) {
    const { camera: cam, dpr } = this;
    const main = this.mainCtx;
    // angegliederte Gebiete (z. B. Danzig): voll eingefärbt, ohne Schraffur
    main.save();
    main.setTransform(...cam.matrix(dpr));
    main.clip(this.landPath);
    main.imageSmoothingEnabled = false;
    this.drawCells(main, this.occ.annex);
    main.restore();
    // eroberte Felder: Vortag voll, neue Felder blenden über den Tag ein; dann Schraffur
    const tmp = this.layers.tmp.getContext('2d');
    tmp.setTransform(1, 0, 0, 1, 0, 0);
    tmp.globalCompositeOperation = 'source-over';
    tmp.globalAlpha = 1;
    tmp.clearRect(0, 0, this.layers.tmp.width, this.layers.tmp.height);
    tmp.save();
    tmp.setTransform(...cam.matrix(dpr));
    tmp.clip(this.landPath);
    tmp.imageSmoothingEnabled = false;
    if (this.anim && t < 1) {
      this.updateOccAnim(t); // Felder füllen sich wellenförmig über den Tag
      this.drawCells(tmp, this.occ.anim);
    } else {
      this.drawCells(tmp, this.occ.curr);
    }
    tmp.restore();
    tmp.globalAlpha = 1;
    tmp.globalCompositeOperation = 'source-atop';
    tmp.setTransform(dpr, 0, 0, dpr, 0, 0);
    tmp.fillStyle = this.hatch;
    tmp.fillRect(0, 0, cam.width, cam.height);
    tmp.globalCompositeOperation = 'source-over';
    main.setTransform(1, 0, 0, 1, 0, 0);
    main.globalAlpha = st.occAlpha ?? 0.92;
    main.drawImage(this.layers.tmp, 0, 0);
    main.globalAlpha = 1;
  }

  /**
   * Frontlinien als Stacheldraht (nur Darstellung). Kontaktkanten werden je Front zu Linien
   * verkettet und mit Chaikin geglättet; je Teilstück: Befehl/Status (Schein) und Befestigung
   * der eigenen Seite (Drahtdichte, Pfähle). Die Felder darunter bleiben unverändert.
   */
  buildFrontGeometry() {
    const sim = this.sim;
    const E = sim.edges;
    const { cols } = this.grid;
    const VC = cols + 1;
    const cu = this.cellU;
    this.edgeFrontAt.fill(0);
    const player = sim.player;
    const byFront = new Map(); // fid -> Liste von Kanten {v1, v2, cat, fort}
    for (let k = 0; k < E.count; k++) {
      const fid = E.front[k];
      const f = sim.fronts.get(fid);
      if (!f || !f.alive) continue;
      const a = E.a[k];
      const b = E.b[k];
      this.edgeFrontAt[a] = fid;
      this.edgeFrontAt[b] = fid;
      const lo = a < b ? a : b;
      const r = Math.floor(lo / cols);
      const c = lo - r * cols;
      const v1 = E.dir[k] === 0 ? r * VC + c + 1 : (r + 1) * VC + c;
      const v2 = E.dir[k] === 0 ? v1 + VC : v1 + 1;
      const me = f.side[player] ? player : f.a;
      const side = f.side[me];
      let cat = 'halten';
      if (side.order === 'prepare') cat = 'vorbereiten';
      if (side.order === 'attack') {
        const sec = f.sections.find((x) => x.sector === sim.sectors.sectorOf[b]);
        cat = sec?.stats.status[me] || 'Vormarsch';
      }
      const myCell = me === f.a ? a : b;
      if (!byFront.has(fid)) byFront.set(fid, []);
      byFront.get(fid).push({ v1, v2, cat, fort: sim.fort[myCell] });
    }
    const vx = (v) => this.gx0 + (v % VC) * cu;
    const vy = (v) => this.gy1 - Math.floor(v / VC) * cu;
    const chains = [];
    for (const [fid, edges] of byFront) {
      const adj = new Map();
      edges.forEach((e, i) => {
        for (const v of [e.v1, e.v2]) {
          if (!adj.has(v)) adj.set(v, []);
          adj.get(v).push(i);
        }
      });
      const used = new Uint8Array(edges.length);
      const walk = (startV) => {
        const pts = [startV];
        const attr = [];
        let v = startV;
        for (;;) {
          const next = (adj.get(v) || []).find((i) => !used[i]);
          if (next === undefined) break;
          used[next] = 1;
          const e = edges[next];
          v = e.v1 === v ? e.v2 : e.v1;
          pts.push(v);
          attr.push(e);
        }
        return { pts, attr };
      };
      // erst offene Enden (Grad 1), dann Schleifen
      const starts = [...adj.entries()].filter(([, l]) => l.length === 1).map(([v]) => v);
      for (const v of [...starts, ...adj.keys()]) {
        while ((adj.get(v) || []).some((i) => !used[i])) {
          const { pts, attr } = walk(v);
          if (attr.length) chains.push(smoothChain(pts.map((q) => [vx(q), vy(q)]), attr, fid));
        }
      }
    }
    return this.geomPaths(chains);
  }

  /** Pfade einer Kettenliste: Schein je Kategorie, Linie, Pfad je Front (Auswahl). */
  geomPaths(chains) {
    // Schein je Kategorie (Karteneinheiten), schlichte Linie für alle
    const glow = new Map();
    const line = new Path2D();
    const byFrontPath = new Map();
    for (const ch of chains) {
      const P = ch.p;
      if (!byFrontPath.has(ch.fid)) byFrontPath.set(ch.fid, new Path2D());
      const fp = byFrontPath.get(ch.fid);
      line.moveTo(P[0], P[1]);
      fp.moveTo(P[0], P[1]);
      for (let i = 2; i < P.length; i += 2) { line.lineTo(P[i], P[i + 1]); fp.lineTo(P[i], P[i + 1]); }
      for (let i = 0; i + 3 < P.length; i += 2) {
        const cat = ch.cat[i / 2];
        if (!glow.has(cat)) glow.set(cat, new Path2D());
        const g = glow.get(cat);
        g.moveTo(P[i], P[i + 1]);
        g.lineTo(P[i + 2], P[i + 3]);
      }
    }
    return { chains, glow, line, byFront: byFrontPath };
  }

  /** Musterkacheln (einmal je Detailstufe und Pixeldichte vorberechnet). */
  wireTiles() {
    const dpr = this.dpr;
    if (this._tiles && this._tiles.dpr === dpr) return this._tiles;
    const make = (L, H, draw) => {
      const c = document.createElement('canvas');
      // doppelte Auflösung, damit die Kachel auch vergrößert scharf bleibt
      const q = dpr * 2;
      c.width = Math.ceil(L * q);
      c.height = Math.ceil(H * q);
      const x = c.getContext('2d');
      x.scale(q, q);
      draw(x, L, H);
      return { c, L, H };
    };
    const IRON = '#2a2925';
    const SHINE = 'rgba(205,200,186,0.85)';
    const wires = (x, L, H, amp, twists, extra = 0) => {
      const strands = [0, Math.PI];
      if (extra) strands.push(Math.PI / 2);
      for (const [lw, col, dy] of [[1.9, IRON, 0], [0.6, SHINE, -0.55]]) {
        x.strokeStyle = col;
        x.lineWidth = lw;
        for (const ph of strands) {
          const a = ph === Math.PI / 2 ? amp * 1.7 : amp;
          x.beginPath();
          for (let i = 0; i <= 48; i++) {
            const px = (i / 48) * L;
            const py = H / 2 + a * Math.sin((px / L) * Math.PI * 2 * twists + ph) + dy;
            if (i === 0) x.moveTo(px, py); else x.lineTo(px, py);
          }
          x.stroke();
        }
      }
    };
    const barb = (x, cx, cy, s) => {
      x.lineCap = 'round';
      for (const [lw, col, off] of [[1.6, IRON, 0], [0.5, SHINE, -0.4]]) {
        x.strokeStyle = col;
        x.lineWidth = lw;
        x.beginPath();
        x.moveTo(cx - s, cy - s + off); x.lineTo(cx + s, cy + s + off);
        x.moveTo(cx + s, cy - s + off); x.lineTo(cx - s, cy + s + off);
        x.stroke();
      }
      x.fillStyle = IRON;
      x.beginPath();
      x.arc(cx, cy, 1.4, 0, Math.PI * 2);
      x.fill();
    };
    const tiles = {
      dpr,
      plain: make(24, 10, (x, L, H) => wires(x, L, H, 1.6, 2)),
      full: [0, 1, 2].map((d) => make(24, 14, (x, L, H) => {
        wires(x, L, H, 2.2, 2, d === 2);
        const n = d + 1; // Befestigung: mehr Stachelknoten
        for (let i = 0; i < n; i++) barb(x, ((i + 0.5) / n) * L, H / 2, 2.6);
      })),
      post: make(8, 22, (x, L, H) => {
        x.fillStyle = '#5b3d22';
        x.fillRect(L / 2 - 1.8, 1, 3.6, H - 2);
        x.fillStyle = 'rgba(255,220,170,0.35)';
        x.fillRect(L / 2 - 1.8, 1, 1, H - 2);
        x.strokeStyle = '#2b1c10';
        x.lineWidth = 0.8;
        x.strokeRect(L / 2 - 1.8, 1, 3.6, H - 2);
      }),
    };
    this._tiles = tiles;
    return tiles;
  }

  drawWarFronts(st, u, t) {
    const fs = st.warFront;
    if (!fs) return;
    const g = this.frontGeom;
    if (!g) return;
    const tt = ease(Math.max(0, Math.min(1, t / 0.85))); // Draht wandert weich über den Tag
    if (tt >= 1 || !g.linked) {
      this.curChains = g.chains;
      this.drawWire(st, u, g, 1);
      return;
    }
    if (g.gone) this.drawWire(st, u, g.gone, 1 - tt);
    const moving = [];
    const fresh = [];
    for (const ch of g.chains) {
      const P = ch.p;
      const F = ch.from;
      const p = new Float32Array(P.length);
      if (F) for (let i = 0; i < P.length; i++) p[i] = F[i] + (P[i] - F[i]) * tt;
      else p.set(P);
      (ch.fadeIn ? fresh : moving).push({ fid: ch.fid, p, cat: ch.cat, fort: ch.fort });
    }
    this.curChains = moving.concat(fresh);
    if (moving.length) this.drawWire(st, u, this.geomPaths(moving), 1);
    if (fresh.length) this.drawWire(st, u, this.geomPaths(fresh), tt);
  }

  /** Feldkoordinaten (Spalte, Zeile als Kommazahl) unter einem Bildschirmpunkt. */
  cellCoordAt(sx, sy) {
    const [mx, my] = this.camera.toMap(sx, sy);
    return [(mx - this.gx0) / this.cellU, (this.gy1 - my) / this.cellU];
  }

  /** Haltelinien eigener Fronten (gestrichelt, ausgewählte Front kräftig) und Entwurf. */
  drawObjectives() {
    const sim = this.sim;
    const p = sim.player;
    const { ctx, camera: cam } = this;
    const cu = this.cellU;
    const toScr = ([cx, cy]) => cam.toScreen(this.gx0 + cx * cu, this.gy1 - cy * cu);
    const smooth = (P) => {
      let Q = P;
      for (let it = 0; it < 2 && Q.length > 2; it++) {
        const N = [Q[0]];
        for (let i = 0; i < Q.length - 1; i++) {
          N.push([0.75 * Q[i][0] + 0.25 * Q[i + 1][0], 0.75 * Q[i][1] + 0.25 * Q[i + 1][1]]);
          N.push([0.25 * Q[i][0] + 0.75 * Q[i + 1][0], 0.25 * Q[i][1] + 0.75 * Q[i + 1][1]]);
        }
        N.push(Q[Q.length - 1]);
        Q = N;
      }
      return Q;
    };
    const stroke = (raw, sel, draft) => {
      if (raw.length < 2) return;
      const pts = smooth(raw);
      ctx.beginPath();
      pts.forEach((q, k) => { const [x, y] = toScr(q); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(20,16,10,0.75)';
      ctx.lineWidth = sel ? 6 : 4;
      ctx.stroke();
      ctx.setLineDash(draft ? [6, 5] : [10, 6]);
      ctx.strokeStyle = draft ? '#f0c96a' : sel ? '#e8553a' : 'rgba(232,85,58,0.7)';
      ctx.lineWidth = sel ? 3 : 2;
      ctx.stroke();
      ctx.setLineDash([]);
      // Querstriche an den Enden ("Halt")
      for (const q of [pts[0], pts[pts.length - 1]]) {
        const [x, y] = toScr(q);
        ctx.fillStyle = draft ? '#f0c96a' : '#e8553a';
        ctx.beginPath(); ctx.arc(x, y, sel ? 4.5 : 3.5, 0, Math.PI * 2); ctx.fill();
      }
    };
    ctx.save();
    for (const f of sim.fronts.values()) {
      const o = f.alive && f.side[p]?.objective;
      if (o) stroke(o.line, f.id === this.selectedFront, false);
    }
    const d = this.lineDraft;
    if (d) {
      stroke(d.pts, true, true);
    }
    ctx.restore();
  }

  /** Miniflagge (Bild) je Nation, einmal geladen; zeichnet neu, sobald sie da ist. */
  flagImage(code) {
    this._flags = this._flags || new Map();
    let img = this._flags.get(code);
    if (!img) {
      img = new Image();
      img.onload = () => { this._counters?.clear(); this.requestRender(); };
      img.src = flagUrl(code);
      this._flags.set(code, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  /**
   * Spielstein einer Division-Gruppe als Medaillon (vorgerendert, je Zustand zwischengespeichert):
   * Eichenlaubkranz (eigen: Messing, Gegner: Stahl), Porträt-Silhouette im Rund (Soldat mit
   * Stahlhelm, bei Panzerverbänden ein Panzer), Stärkering, Flagge oben, Befehlsstein rechts und
   * ein Band mit der Divisionszahl. Eigene Zeichnung, keine Hoheitszeichen. `kind`: 'front' | 'small'.
   */
  counter({ code, text, tank = 0, str = 1, order = '', kind = 'front', enemy = false }) {
    const dpr = this.dpr;
    const armor = tank > 0.25;
    const key = `${code}|${text}|${armor ? 1 : 0}|${Math.round(str * 10)}|${order}|${kind}|${enemy}|${dpr}|${this.flagImage(code) ? 1 : 0}`;
    this._counters = this._counters || new Map();
    let c = this._counters.get(key);
    if (c) return c;
    const sc = kind === 'small' ? 0.64 : 1;
    const W = Math.round(66 * sc);
    const H = Math.round(64 * sc);
    const M = 6;
    c = document.createElement('canvas');
    c.width = Math.ceil((W + 2 * M) * dpr);
    c.height = Math.ceil((H + 2 * M) * dpr);
    c.W = W; c.H = H; c.M = M;
    const x = c.getContext('2d');
    x.scale(dpr, dpr);
    x.translate(M, M);
    const R = 15 * sc; // Porträt
    const cx = W / 2;
    const cy = 25 * sc;
    const metal = enemy ? ['#eef0f2', '#a9aeb3', '#5d6166', '#2c2f33'] : ['#fff1c2', '#d9b25e', '#8c6424', '#3b2a10'];
    const grad = (r0, r1) => { const g = x.createRadialGradient(cx - r1 * 0.35, cy - r1 * 0.45, r0, cx, cy, r1); g.addColorStop(0, metal[0]); g.addColorStop(0.45, metal[1]); g.addColorStop(1, metal[2]); return g; };
    // Schatten
    x.save();
    x.shadowColor = 'rgba(0,0,0,0.55)';
    x.shadowBlur = 6 * sc;
    x.shadowOffsetY = 2.5 * sc;
    x.beginPath(); x.arc(cx, cy, R + 3 * sc, 0, Math.PI * 2); x.fillStyle = '#000'; x.fill();
    x.restore();
    // Eichenlaubkranz: je Seite Blätter vom unteren Ende bis knapp unter die Spitze
    const leaf = (px, py, ang, len, wid) => {
      x.save();
      x.translate(px, py);
      x.rotate(ang);
      x.beginPath();
      x.moveTo(0, 0);
      // gelappter Rand (drei Lappen je Seite), Eichenblatt
      const lob = [0.22, 0.5, 0.78];
      for (const sgn of [-1, 1]) {
        if (sgn === 1) x.moveTo(0, 0);
        let lx = 0;
        for (const t of lob) {
          const tx = t * len;
          x.quadraticCurveTo((lx + tx) / 2, sgn * wid * 0.55, tx - len * 0.06, sgn * wid * 0.35);
          x.quadraticCurveTo(tx + len * 0.04, sgn * wid * 1.05, tx + len * 0.12, sgn * wid * 0.3);
          lx = tx + len * 0.12;
        }
        x.quadraticCurveTo(len * 0.97, sgn * wid * 0.35, len, 0);
      }
      const g = x.createLinearGradient(0, -wid, 0, wid);
      g.addColorStop(0, metal[0]); g.addColorStop(0.5, metal[1]); g.addColorStop(1, metal[2]);
      x.fillStyle = g;
      x.fill();
      x.lineWidth = 0.7 * sc;
      x.strokeStyle = metal[3];
      x.stroke();
      x.beginPath(); x.moveTo(len * 0.05, 0); x.lineTo(len * 0.9, 0); x.lineWidth = 0.5 * sc; x.stroke();
      x.restore();
    };
    const acorn = (px, py, ang) => {
      x.save();
      x.translate(px, py);
      x.rotate(ang);
      x.beginPath(); x.ellipse(0, 2.2 * sc, 1.9 * sc, 2.6 * sc, 0, 0, Math.PI * 2);
      x.fillStyle = metal[1]; x.fill(); x.strokeStyle = metal[3]; x.lineWidth = 0.6 * sc; x.stroke();
      x.beginPath(); x.ellipse(0, 0.2 * sc, 2.3 * sc, 1.4 * sc, 0, Math.PI, Math.PI * 2); x.closePath();
      x.fillStyle = metal[2]; x.fill(); x.stroke();
      x.restore();
    };
    const Rw = R + 6 * sc;
    const n = kind === 'small' ? 5 : 7;
    for (const side of [-1, 1]) {
      // Stängel
      x.beginPath();
      x.arc(cx, cy, Rw - 1 * sc, Math.PI / 2 + side * 0.35, Math.PI / 2 + side * 2.55, side < 0);
      x.strokeStyle = metal[3]; x.lineWidth = 1.2 * sc; x.stroke();
      for (let i = 0; i < n; i++) {
        const a = Math.PI / 2 + side * (0.45 + (i * 2.05) / (n - 1));
        const px = cx + Math.cos(a) * Rw;
        const py = cy + Math.sin(a) * Rw;
        // Blatt zeigt schräg nach außen und in Wuchsrichtung (nach oben)
        const ang = a + side * (Math.PI / 2) - side * 0.55;
        leaf(px, py, ang, 9.5 * sc, 3.6 * sc);
        if (i === 2 || i === 4) acorn(cx + Math.cos(a + side * 0.12) * (Rw - 3.5 * sc), cy + Math.sin(a + side * 0.12) * (Rw - 3.5 * sc), a + side * 0.4);
      }
    }
    // Rahmen und Porträtgrund (Sepia mit Ton der Nationalfarbe)
    x.beginPath(); x.arc(cx, cy, R + 3 * sc, 0, Math.PI * 2); x.fillStyle = grad(1, R + 3 * sc); x.fill();
    x.lineWidth = 0.8 * sc; x.strokeStyle = metal[3]; x.stroke();
    const tint = STYLES.front.nation[code] || '#888888';
    const tg = x.createRadialGradient(cx - R * 0.3, cy - R * 0.4, 1, cx, cy, R);
    tg.addColorStop(0, '#f3e7c8');
    tg.addColorStop(1, tint);
    x.beginPath(); x.arc(cx, cy, R, 0, Math.PI * 2); x.fillStyle = tg; x.fill();
    // Porträt-Silhouette
    x.save();
    x.beginPath(); x.arc(cx, cy, R - 0.5, 0, Math.PI * 2); x.clip();
    x.fillStyle = 'rgba(38,27,16,0.92)';
    const u = R / 15;
    if (armor) {
      // Panzer von der Seite: Laufwerk, Wanne, Turm, Rohr
      x.beginPath();
      x.moveTo(cx - 11 * u, cy + 6 * u); x.lineTo(cx + 11 * u, cy + 6 * u); x.lineTo(cx + 9 * u, cy + 10 * u); x.lineTo(cx - 9 * u, cy + 10 * u); x.closePath(); x.fill();
      x.fillRect(cx - 10 * u, cy + 1 * u, 20 * u, 5 * u);
      x.beginPath(); x.moveTo(cx - 5 * u, cy + 1 * u); x.lineTo(cx - 4 * u, cy - 4 * u); x.lineTo(cx + 4 * u, cy - 4 * u); x.lineTo(cx + 6 * u, cy + 1 * u); x.closePath(); x.fill();
      x.fillRect(cx + 5 * u, cy - 2.6 * u, 10 * u, 1.6 * u);
      x.fillStyle = 'rgba(243,231,200,0.55)';
      for (let k = -3; k <= 3; k++) { x.beginPath(); x.arc(cx + k * 2.8 * u, cy + 8 * u, 1 * u, 0, Math.PI * 2); x.fill(); }
    } else {
      // Soldat im Profil: Schultern, Hals, Kopf, Stahlhelm mit Nackenschirm
      x.beginPath();
      x.moveTo(cx - 13 * u, cy + 16 * u);
      x.quadraticCurveTo(cx - 11 * u, cy + 6 * u, cx - 3 * u, cy + 5 * u);
      x.lineTo(cx - 2 * u, cy + 2 * u);
      x.lineTo(cx + 3 * u, cy + 2 * u);
      x.lineTo(cx + 4 * u, cy + 5 * u);
      x.quadraticCurveTo(cx + 12 * u, cy + 6 * u, cx + 13 * u, cy + 16 * u);
      x.closePath(); x.fill();
      x.beginPath(); x.ellipse(cx + 0.5 * u, cy - 1 * u, 4.2 * u, 4.6 * u, 0, 0, Math.PI * 2); x.fill();
      x.beginPath();
      x.moveTo(cx - 7.5 * u, cy - 0.5 * u);
      x.quadraticCurveTo(cx - 7 * u, cy - 10 * u, cx + 0.5 * u, cy - 10 * u);
      x.quadraticCurveTo(cx + 7 * u, cy - 10 * u, cx + 6.5 * u, cy - 3 * u);
      x.lineTo(cx + 8 * u, cy - 2.2 * u);
      x.lineTo(cx + 5.5 * u, cy - 1.6 * u);
      x.lineTo(cx - 3 * u, cy - 2.5 * u);
      x.quadraticCurveTo(cx - 6 * u, cy - 2 * u, cx - 7.5 * u, cy - 0.5 * u);
      x.closePath(); x.fill();
      x.strokeStyle = 'rgba(243,231,200,0.45)'; x.lineWidth = 0.8 * u;
      x.beginPath(); x.moveTo(cx - 5.5 * u, cy - 7 * u); x.quadraticCurveTo(cx, cy - 9.5 * u, cx + 5 * u, cy - 6.5 * u); x.stroke();
    }
    x.restore();
    // Stärkering
    if (kind !== 'small') {
      x.lineWidth = 2.2 * sc;
      x.strokeStyle = 'rgba(30,20,10,0.45)';
      x.beginPath(); x.arc(cx, cy, R + 1.4 * sc, 0, Math.PI * 2); x.stroke();
      x.strokeStyle = str > 0.75 ? '#5d8c38' : str > 0.45 ? '#d1a032' : '#b8391f';
      x.beginPath(); x.arc(cx, cy, R + 1.4 * sc, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, str))); x.stroke();
    }
    // Flagge oben auf dem Rahmen
    const fw = 13 * sc;
    const fh = 8.5 * sc;
    const flag = this.flagImage(code);
    const fx = cx - fw / 2;
    const fy = cy - R - 7.5 * sc;
    if (flag) x.drawImage(flag, fx, fy, fw, fh); else { x.fillStyle = tint; x.fillRect(fx, fy, fw, fh); }
    x.strokeStyle = metal[3]; x.lineWidth = 0.9 * sc; x.strokeRect(fx, fy, fw, fh);
    // Befehlsstein rechts oben
    const col = { prepare: '#e0b04e', attack: '#d2401f', hold: '#8a877c' }[order];
    if (col && kind !== 'small') {
      const gx = cx + (R + 4) * Math.cos(-0.75);
      const gy = cy + (R + 4) * Math.sin(-0.75);
      x.beginPath(); x.moveTo(gx, gy - 4); x.lineTo(gx + 4, gy); x.lineTo(gx, gy + 4); x.lineTo(gx - 4, gy); x.closePath();
      x.fillStyle = col; x.fill(); x.strokeStyle = '#21170c'; x.lineWidth = 0.9; x.stroke();
    }
    // Band mit der Zahl (Schwalbenschwanz)
    const bw = (kind === 'small' ? 30 : 40) * sc / (kind === 'small' ? 0.64 : 1);
    const bh = 13 * sc;
    const by = cy + R + 1 * sc;
    const bx = cx - bw / 2;
    x.beginPath();
    x.moveTo(bx - 6 * sc, by + 1 * sc); x.lineTo(bx + 2 * sc, by + bh / 2); x.lineTo(bx - 6 * sc, by + bh);
    x.lineTo(bx + bw + 6 * sc, by + bh); x.lineTo(bx + bw - 2 * sc, by + bh / 2); x.lineTo(bx + bw + 6 * sc, by + 1 * sc);
    x.closePath();
    x.fillStyle = enemy ? '#7a2c22' : '#5d2a1a';
    x.fill();
    x.beginPath(); x.rect(bx, by, bw, bh);
    const rg = x.createLinearGradient(0, by, 0, by + bh);
    if (enemy) { rg.addColorStop(0, '#d9d4cb'); rg.addColorStop(1, '#a9a197'); } else { rg.addColorStop(0, '#f6ecd0'); rg.addColorStop(1, '#d8c597'); }
    x.fillStyle = rg; x.fill();
    x.strokeStyle = metal[3]; x.lineWidth = 0.9 * sc; x.stroke();
    x.fillStyle = '#21170c';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.font = `700 ${Math.round(11 * Math.max(sc, 0.85))}px "IBM Plex Sans", system-ui, sans-serif`;
    x.fillText(text, cx, by + bh / 2 + 0.5);
    this._counters.set(key, c);
    if (this._counters.size > 400) this._counters.clear();
    return c;
  }

  /** Spielstein mittig auf (sx, sy) setzen; `scale` für sanftes Ein-/Ausblenden. */
  stamp(c, sx, sy, alpha = 1) {
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    ctx.drawImage(c, sx - c.W / 2 - c.M, sy - c.H / 2 - c.M, c.W + 2 * c.M, c.H + 2 * c.M);
    ctx.globalAlpha = 1;
  }

  /**
   * Truppenanzeige (Frontansicht): je Front ein eigener Spielstein auf der eigenen Seite des Drahts
   * und ein gegnerischer gegenüber (geschätzt), verlegte Divisionen als wandernde Steine mit
   * gepunkteter Marschroute und Resttagen, die Reserve an der Hauptstadt.
   */
  drawUnits(st, t) {
    const sim = this.sim;
    const p = sim.player;
    const { ctx, camera: cam } = this;
    const cu = this.cellU;
    const toScr = (cx, cy) => cam.toScreen(this.gx0 + cx * cu, this.gy1 - cy * cu);
    const myCode = sim.code(p);
    const now = performance.now();
    // Mitte und Richtung der längsten Kette je Front (wandert mit dem Draht)
    const mid = new Map();
    for (const ch of this.curChains || []) {
      const n = ch.p.length / 2;
      const best = mid.get(ch.fid);
      if ((best && best.n >= n) || n < 2) continue;
      const k = Math.floor(n / 2);
      const k0 = Math.max(0, k - 3) * 2;
      const k1 = Math.min(n - 1, k + 3) * 2;
      mid.set(ch.fid, { n, x: ch.p[k * 2], y: ch.p[k * 2 + 1], dx: ch.p[k1] - ch.p[k0], dy: ch.p[k1 + 1] - ch.p[k0 + 1] });
    }
    ctx.save();
    const strengthOf = (fid, n) => {
      const divs = sim.divisionsOn(fid, n);
      if (!divs.length) return { str: 0, tank: 0 };
      let s = 0;
      let tk = 0;
      for (const d of divs) { s += (d.men / d.maxMen) * 0.5 + Math.min(d.men / d.maxMen, (d.equip ?? 100) / 100) * 0.5; tk += d.tank; }
      return { str: s / divs.length, tank: tk / divs.length };
    };
    for (const f of sim.fronts.values()) {
      if (!f.alive || !f.side[p]) continue;
      const m = mid.get(f.id);
      if (!m) continue;
      const [sx, sy] = cam.toScreen(m.x, m.y);
      if (sx < -60 || sy < -40 || sx > cam.width + 60 || sy > cam.height + 40) continue;
      // Normale zur Linie (Bildschirm), eigene Seite über den Feldbesitz bestimmen
      const L = Math.hypot(m.dx, m.dy) || 1;
      let nx = -m.dy / L;
      let ny = m.dx / L; // Karteneinheiten, y nach Norden
      const probe = this.cellAtMap(m.x + nx * cu * 1.5, m.y + ny * cu * 1.5);
      if (probe >= 0 && sim.owner[probe] !== p) { nx = -nx; ny = -ny; }
      const off = 36;
      const ox = nx * off;
      const oy = -ny * off; // Bildschirm: y nach unten
      const e = sim.enemyOn(f, p);
      const side = f.side[p];
      const own = sim.divisionsOn(f.id, p).length;
      const os = strengthOf(f.id, p);
      const known = !f.planned || sim.frontRevealed(f.id, p);
      // im Frieden steht der Gegner noch nicht an der Grenze: geschätzte Gesamtarmee zeigen
      const total = sim.divisions.filter((d) => d.nation === e).length;
      const est = f.planned ? (known ? total : Math.max(1, Math.round(total / 5) * 5)) : sim.estimate(f.id, e);
      const es = strengthOf(f.id, e);
      // Verbindungsstrich zum Draht
      ctx.strokeStyle = 'rgba(30,22,12,0.55)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ox * 0.55, sy + oy * 0.55); ctx.moveTo(sx, sy); ctx.lineTo(sx - ox * 0.55, sy - oy * 0.55); ctx.stroke();
      const cOwn = this.counter({ code: myCode, text: String(own), tank: os.tank, str: own ? os.str : 0, order: side.order });
      const cEn = this.counter({ code: sim.code(e), text: `~${est}`, tank: es.tank, str: est > 0 ? es.str : 0, order: f.side[e].order, enemy: true });
      if (f.id === this.selectedFront) {
        ctx.save();
        ctx.shadowColor = '#f0c96a';
        ctx.shadowBlur = 12;
        ctx.strokeStyle = 'rgba(240,201,106,0.9)';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sx + ox, sy + oy - cOwn.H / 2 + 25, 25, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      this.stamp(cEn, sx - ox, sy - oy, 0.95);
      this.stamp(cOwn, sx + ox, sy + oy);
      // Gefahr: Gegner deutlich stärker oder Front leer → rot pulsierender Rahmen um den eigenen Stein
      if (!f.planned && est > 0 && (own === 0 || est > own * 1.6)) {
        const a = 0.5 + 0.5 * Math.sin(now / 200);
        ctx.strokeStyle = `rgba(214,52,30,${0.45 + 0.55 * a})`;
        ctx.lineWidth = 2 + a;
        ctx.beginPath(); ctx.arc(sx + ox, sy + oy - cOwn.H / 2 + 25, 27, 0, Math.PI * 2); ctx.stroke();
      }
    }
    // verlegte Divisionen: Stein wandert über den Tag weich zum Ziel, gepunktete Route mit Pfeil
    const groups = new Map();
    for (const d of sim.divisions) {
      if (d.nation !== p || !d.transit) continue;
      const k = `${d.transit.from}|${d.transit.to}|${d.transit.arrive}|${d.transit.days}`;
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    for (const [k, count] of groups) {
      const [from, to, arrive, days] = k.split('|').map(Number);
      const raw = Math.max(0, Math.min(1, (sim.day + t - (arrive - days)) / Math.max(1, days)));
      const prog = raw * raw * (3 - 2 * raw);
      const [ax, ay] = toScr(...sim.placeOf(from, p));
      const [bx, by] = toScr(...sim.placeOf(to, p));
      // leicht gebogene Route (Bogen nach Norden), damit sich Routen nicht decken
      const cx = (ax + bx) / 2 - (by - ay) * 0.12;
      const cy = (ay + by) / 2 + (bx - ax) * 0.12;
      const q = (u) => [(1 - u) ** 2 * ax + 2 * (1 - u) * u * cx + u * u * bx, (1 - u) ** 2 * ay + 2 * (1 - u) * u * cy + u * u * by];
      const [x, y] = q(prog);
      ctx.setLineDash([2, 5]);
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(30,22,12,0.6)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let i = 1; i <= 24; i++) ctx.lineTo(...q(prog + ((1 - prog) * i) / 24));
      ctx.stroke();
      ctx.strokeStyle = 'rgba(241,231,204,0.95)';
      ctx.lineWidth = 1.8;
      ctx.stroke();
      ctx.setLineDash([]);
      // Pfeilspitze am Ziel
      const [px2, py2] = q(0.97);
      const ang = Math.atan2(by - py2, bx - px2);
      ctx.fillStyle = 'rgba(241,231,204,0.95)';
      ctx.strokeStyle = 'rgba(30,22,12,0.7)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - 9 * Math.cos(ang - 0.45), by - 9 * Math.sin(ang - 0.45));
      ctx.lineTo(bx - 9 * Math.cos(ang + 0.45), by - 9 * Math.sin(ang + 0.45));
      ctx.closePath(); ctx.fill(); ctx.stroke();
      const c = this.counter({ code: myCode, text: String(count), kind: 'small' });
      const fade = raw > 0.85 ? Math.max(0.25, 1 - (raw - 0.85) / 0.15) : 1; // verschmilzt bei Ankunft mit dem Frontstein
      this.stamp(c, x, y, fade);
      // Resttage als kleines Band unter dem Stein
      const left = Math.max(0, arrive - sim.day);
      const label = left <= 0 ? 'heute' : `${left} ${left === 1 ? 'Tag' : 'Tage'}`;
      ctx.font = '600 10px "IBM Plex Sans", system-ui, sans-serif';
      const w = ctx.measureText(label).width + 8;
      ctx.globalAlpha = fade;
      ctx.fillStyle = 'rgba(32,24,15,0.85)';
      ctx.fillRect(x + 20, y - 9, w, 14);
      ctx.fillStyle = '#f1e7cc';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, x + 20 + w / 2, y - 2);
      ctx.globalAlpha = 1;
    }
    // Reserve an der Hauptstadt
    const res = sim.reserveOf(p);
    const cap = sim.capital.get(p);
    if (cap !== undefined) {
      const [rx, ry] = toScr(cap % sim.cols + 0.5, Math.floor(cap / sim.cols) + 0.5);
      if (rx > -60 && ry > -40 && rx < cam.width + 60 && ry < cam.height + 40) {
        let tk = 0;
        for (const d of res) tk += d.tank;
        const c = this.counter({ code: myCode, text: String(res.length), tank: res.length ? tk / res.length : 0, str: res.length ? 1 : 0 });
        this.stamp(c, rx, ry + 26);
        ctx.font = '600 10px "IBM Plex Sans", system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = 'rgba(32,24,15,0.85)';
        ctx.fillRect(rx - 24, ry + 43, 48, 13);
        ctx.fillStyle = '#f1e7cc';
        ctx.fillText('Reserve', rx, ry + 50);
      }
    }
    ctx.restore();
  }

  /** Feldindex unter Kartenkoordinaten (-1 außerhalb). */
  cellAtMap(mx, my) {
    const c = Math.floor((mx - this.gx0) / this.cellU);
    const r = Math.floor((this.gy1 - my) / this.cellU);
    const { cols, rows } = this.grid;
    return c < 0 || r < 0 || c >= cols || r >= rows ? -1 : r * cols + c;
  }

  /** Stacheldraht zeichnen: Schein (Befehl), dann Draht je nach Zoomstufe. */
  drawWire(st, u, g, alpha) {
    if (!g || alpha <= 0.01) return;
    const { ctx, camera: cam, dpr } = this;
    const fs = st.warFront;
    const cellPx = this.cellU / u;
    const pulse = this.lowDetail ? 1 : 0.7 + 0.3 * Math.sin(performance.now() / 160);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const sel = this.selectedFront && g.byFront.get(this.selectedFront);
    if (sel) {
      ctx.strokeStyle = fs.selected;
      ctx.lineWidth = 16 * u;
      ctx.stroke(sel);
    }
    // Schein unter dem Draht: Messing (vorbereiten), grau (halten), rot nach Kampfstatus
    for (const [cat, p] of g.glow) {
      const col = fs.glow[cat] || fs.glow.halten;
      ctx.globalAlpha = alpha * (cat === 'Durchbruch' ? pulse : 1);
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(7, Math.min(16, cellPx * 1.1)) * u;
      ctx.stroke(p);
    }
    ctx.globalAlpha = alpha;
    if (cellPx < 6 || this.lowDetail) {
      // weit herausgezoomt: schlichte Drahtlinie
      ctx.strokeStyle = '#2a2925';
      ctx.lineWidth = 2.2 * u;
      ctx.stroke(g.line);
      ctx.strokeStyle = 'rgba(205,200,186,0.6)';
      ctx.lineWidth = 0.7 * u;
      ctx.stroke(g.line);
      ctx.restore();
      return;
    }
    // Musterkacheln entlang der Linie (Bildschirmraum): Die Linie wird in gleichen Bogenlängen
    // abgetastet, jede Kachel liegt als Sehne zwischen zwei Abtastpunkten und folgt so den Biegungen.
    const tiles = this.wireTiles();
    const detail = cellPx >= 14;
    // nah herangezoomt wächst der Draht maßvoll mit (bis 1,8-fach)
    const k = detail ? Math.min(1.8, Math.max(1, cellPx / 28)) : 1;
    const D = tiles.plain.L * k;
    const W = cam.width;
    const H = cam.height;
    const m = cam.matrix(1);
    const off = (x, y) => x < -40 || x > W + 40 || y < -40 || y > H + 40;
    const posts = [];
    const stampAt = (ax, ay, bx, by, fort, n) => {
      if (off(ax, ay) && off(bx, by)) return;
      const dx = bx - ax;
      const dy = by - ay;
      const c = Math.hypot(dx, dy);
      if (c < 0.5) return;
      const tile = detail ? tiles.full[fort >= 0.66 ? 2 : fort >= 0.33 ? 1 : 0] : tiles.plain;
      const cos = dx / c;
      const sin = dy / c;
      ctx.setTransform(dpr * cos, dpr * sin, -dpr * sin, dpr * cos, dpr * ax, dpr * ay);
      const f = Math.min(1, c / D);
      ctx.drawImage(tile.c, 0, 0, tile.c.width * f, tile.c.height, 0, (-tile.H * k) / 2, c + 0.6, tile.H * k);
      // Holzpfähle ab hoher Befestigung (nur nah), nach dem Draht gesammelt gezeichnet
      if (detail && fort >= 0.66 && n % 3 === 0) posts.push(ax, ay);
    };
    for (const ch of g.chains) {
      const P = ch.p;
      let px = P[0] * m[0] + m[4];
      let py = P[1] * m[3] + m[5];
      let ax = px;
      let ay = py;
      let need = D;
      let fortA = ch.fort[0];
      let n = 0;
      for (let i = 2; i < P.length; i += 2) {
        const qx = P[i] * m[0] + m[4];
        const qy = P[i + 1] * m[3] + m[5];
        const len = Math.hypot(qx - px, qy - py);
        let pos = 0;
        while (len - pos >= need) {
          pos += need;
          const bx = px + ((qx - px) * pos) / len;
          const by = py + ((qy - py) * pos) / len;
          stampAt(ax, ay, bx, by, fortA, n++);
          ax = bx;
          ay = by;
          need = D;
          fortA = ch.fort[i / 2 - 1];
        }
        need -= len - pos;
        px = qx;
        py = qy;
      }
      if (D - need > 1) stampAt(ax, ay, px, py, fortA, n);
    }
    for (let i = 0; i < posts.length; i += 2) {
      ctx.setTransform(dpr, 0, 0, dpr, dpr * posts[i], dpr * posts[i + 1]);
      ctx.drawImage(tiles.post.c, (-tiles.post.L * k) / 2, -tiles.post.H * 0.75 * k, tiles.post.L * k, tiles.post.H * k);
    }
    ctx.restore();
  }

  /** Belagerte Städte: Ring mit verbleibendem Verteidigungswert. */
  drawSieges(st) {
    const { ctx, camera: cam } = this;
    for (const s of this.sim.sieges) {
      if (!s.besieged || s.fallen) continue;
      const b = this.grid.cellBounds(s.cell);
      const [mx, my] = this.map.worldToMap((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      const [sx, sy] = cam.toScreen(mx, my);
      if (sx < -20 || sy < -20 || sx > cam.width + 20 || sy > cam.height + 20) continue;
      const r = 11;
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(20,20,16,0.85)';
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = st.siege || '#d4452c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(sx, sy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * s.defense) / s.max);
      ctx.stroke();
    }
  }

  /** Front unter dem Mauszeiger (Toleranz ca. 10 px), 0 = keine. */
  frontAtScreen(sx, sy) {
    if (!this.sim) return 0;
    const i = this.cellAt(sx, sy);
    if (i < 0) return 0;
    const { cols, rows } = this.grid;
    const cellPx = this.cellU * this.camera.scale;
    const R = Math.max(1, Math.ceil(10 / cellPx));
    const r0 = Math.floor(i / cols);
    const c0 = i % cols;
    let best = 0;
    let bd = Infinity;
    for (let r = Math.max(0, r0 - R); r <= Math.min(rows - 1, r0 + R); r++) {
      for (let c = Math.max(0, c0 - R); c <= Math.min(cols - 1, c0 + R); c++) {
        const f = this.edgeFrontAt[r * cols + c];
        if (!f) continue;
        const d = (r - r0) ** 2 + (c - c0) ** 2;
        if (d < bd) { bd = d; best = f; }
      }
    }
    return best;
  }

  // ---------------------------------------------------------------- Phase 3: Wirtschaft
  /** Bahnlinien je Ausbaustufe (Stufe der Region am Streckenstück). */
  drawRailLevels(st, u) {
    const sim = this.sim;
    const ver = sim.railLevelVersion || 0;
    if (!this.railLevelPaths || this.railLevelPathsVer !== ver) {
      const paths = [1, 2, 3, 4, 5].map(() => new Path2D());
      const { cols, rows } = this.grid;
      for (const flat of this.map.rails) {
        for (let i = 0; i + 3 < flat.length; i += 2) {
          const mx = (flat[i] + flat[i + 2]) / 2;
          const my = (flat[i + 1] + flat[i + 3]) / 2;
          const c = Math.floor((mx - this.gx0) / this.cellU);
          const r = Math.floor((this.gy1 - my) / this.cellU);
          const cell = r >= 0 && r < rows && c >= 0 && c < cols ? r * cols + c : -1;
          const sec = cell >= 0 ? sim.sectors.sectorOf[cell] : -1;
          const lvl = sec >= 0 ? sim.railLevel[sec] : 1;
          const p = paths[lvl - 1];
          p.moveTo(flat[i], flat[i + 1]);
          p.lineTo(flat[i + 2], flat[i + 3]);
        }
      }
      this.railLevelPaths = paths;
      this.railLevelPathsVer = ver;
    }
    const ctx = this.ctx;
    const R = st.railLevels;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let l = 0; l < 5; l++) {
      ctx.strokeStyle = R.casing;
      ctx.lineWidth = (R.width[l] + 1.4) * u;
      ctx.stroke(this.railLevelPaths[l]);
    }
    for (let l = 0; l < 5; l++) {
      ctx.strokeStyle = R.color[l];
      ctx.lineWidth = R.width[l] * u;
      ctx.stroke(this.railLevelPaths[l]);
    }
  }

  resourceCanvas() {
    if (this._resCanvas) return this._resCanvas;
    const { cols, rows } = this.grid;
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const x = c.getContext('2d');
    const img = x.createImageData(cols, rows);
    const color = { Kohle: [24, 24, 26], Erz: [150, 64, 40], Öl: [72, 46, 110], Uran: [150, 170, 40] };
    for (const r of this.sim.resourceRegions) {
      const [cr, cg, cb] = color[r.kind];
      for (const cell of r.cells) {
        const o = cell * 4;
        img.data[o] = cr;
        img.data[o + 1] = cg;
        img.data[o + 2] = cb;
        img.data[o + 3] = 200;
      }
    }
    x.putImageData(img, 0, 0);
    this._resCanvas = c;
    return c;
  }

  /** Eignungskarte beim Bauen: Funktion Feld -> {score, ok} oder null. */
  setBuildOverlay(fn) {
    this.buildOverlay = null;
    if (fn) {
      const { cols, rows } = this.grid;
      const c = document.createElement('canvas');
      c.width = cols;
      c.height = rows;
      const x = c.getContext('2d');
      const img = x.createImageData(cols, rows);
      const n = this.sim.player;
      for (let i = 0; i < this.grid.size; i++) {
        if (this.sim.owner[i] !== n) continue;
        const s = fn(i);
        if (!s.ok) continue;
        const col = s.score >= 0.66 ? [63, 174, 74] : s.score >= 0.4 ? [227, 193, 58] : [200, 64, 47];
        const o = i * 4;
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      this.buildOverlay = c;
    }
    this.requestRender();
  }

  sectorCanvas(sector) {
    if (this._secCanvas && this._secCanvasId === sector) return this._secCanvas;
    const { cols, rows } = this.grid;
    const c = document.createElement('canvas');
    c.width = cols;
    c.height = rows;
    const x = c.getContext('2d');
    const img = x.createImageData(cols, rows);
    const so = this.sim.sectors.sectorOf;
    for (let i = 0; i < this.grid.size; i++) {
      if (so[i] !== sector) continue;
      const o = i * 4;
      img.data[o] = 255;
      img.data[o + 1] = 255;
      img.data[o + 2] = 255;
      img.data[o + 3] = 255;
    }
    x.putImageData(img, 0, 0);
    this._secCanvas = c;
    this._secCanvasId = sector;
    return c;
  }

  /** Eignungskarte, gewählte Region, beschädigte Bahn und Knoten (Karteneinheiten). */
  drawEconomyOverlay(st, u) {
    const { ctx, sim } = this;
    if (this.buildOverlay) {
      ctx.save();
      ctx.clip(this.landPath);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.58;
      this.drawCells(ctx, this.buildOverlay);
      ctx.restore();
    }
    if (this.selectedSector >= 0 && !this.buildOverlay) {
      ctx.save();
      ctx.clip(this.landPath);
      ctx.imageSmoothingEnabled = false;
      ctx.globalAlpha = 0.22;
      this.drawCells(ctx, this.sectorCanvas(this.selectedSector));
      ctx.restore();
    }
    const cu = this.cellU;
    const cellPx = cu / u;
    const v = this.camera.view();
    const { cols } = this.grid;
    const inView = (cell) => {
      const x = this.gx0 + (cell % cols + 0.5) * cu;
      const y = this.gy1 - (Math.floor(cell / cols) + 0.5) * cu;
      return x > v.x0 - cu && x < v.x1 + cu && y > v.y0 - cu && y < v.y1 + cu ? [x, y] : null;
    };
    // beschädigte/zerstörte Bahn
    const sz = Math.max(2.2 * u, cu * 0.42);
    const dmg = new Path2D();
    const des = new Path2D();
    for (const cell of sim.damagedRail) {
      const p = inView(cell);
      if (!p) continue;
      (sim.railState[cell] === 3 ? des : dmg).rect(p[0] - sz / 2, p[1] - sz / 2, sz, sz);
    }
    ctx.fillStyle = st.railDamage.damaged;
    ctx.fill(dmg);
    ctx.fillStyle = st.railDamage.destroyed;
    ctx.fill(des);
    // Bahnknoten und Brücken erst bei näherer Ansicht
    if (cellPx >= 7) {
      const ns = Math.min(cu * 0.55, 6 * u);
      for (const node of sim.nodes) {
        const p = inView(node.cell);
        if (!p) continue;
        ctx.fillStyle = node.state === 1 ? st.railNode.ok : node.state === 2 ? st.railDamage.damaged : st.railDamage.destroyed;
        ctx.strokeStyle = st.railLevels.casing;
        ctx.lineWidth = 1.2 * u;
        ctx.fillRect(p[0] - ns / 2, p[1] - ns / 2, ns, ns);
        ctx.strokeRect(p[0] - ns / 2, p[1] - ns / 2, ns, ns);
      }
      for (const b of sim.bridges) {
        const p = inView(b.cell);
        if (!p) continue;
        ctx.beginPath();
        ctx.moveTo(p[0] - ns * 0.7, p[1] - ns * 0.25);
        ctx.lineTo(p[0] + ns * 0.7, p[1] - ns * 0.25);
        ctx.moveTo(p[0] - ns * 0.7, p[1] + ns * 0.25);
        ctx.lineTo(p[0] + ns * 0.7, p[1] + ns * 0.25);
        ctx.strokeStyle = b.state === 1 ? st.railNode.ok : st.railDamage.destroyed;
        ctx.lineWidth = 1.6 * u;
        ctx.stroke();
      }
    }
  }

  /** Industriesymbole (Bildschirmraum): Größe nach Gebäudezahl, Ring bei Rüstung. */
  drawIndustry(st) {
    const { ctx, camera: cam, sim } = this;
    const groups = new Map();
    for (const b of sim.buildings) {
      if (!groups.has(b.cell)) groups.set(b.cell, { f: 0, r: 0, w: 0, open: 0, health: 0, n: 0 });
      const g = groups.get(b.cell);
      if (!b.done) { g.open++; continue; }
      if (b.type === 'fabrik') g.f++;
      else if (b.type === 'ruestung') g.r++;
      else g.w++;
      g.health += b.health;
      g.n++;
    }
    const zoomed = cam.scale > 0.075;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [cell, g] of groups) {
      if (!isRevealed(sim, sim.player, cell)) continue; // Nebel des Krieges: gegnerische Gebäude nur nach Aufklärung
      const b = this.grid.cellBounds(cell);
      const [mx, my] = this.map.worldToMap((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
      const [cx0, cy0] = cam.toScreen(mx, my);
      const sx = cx0 - 9;
      const sy = cy0 + 8;
      if (sx < -30 || sy < -30 || sx > cam.width + 30 || sy > cam.height + 30) continue;
      const total = g.f + g.r + g.w;
      const r = Math.max(5, Math.min(13, 4 + Math.sqrt(total) * 2.2));
      const damaged = g.n && g.health / g.n < 0.6;
      ctx.beginPath();
      ctx.moveTo(sx - r, sy + r * 0.7);
      ctx.lineTo(sx - r, sy - r * 0.2);
      ctx.lineTo(sx - r * 0.33, sy - r * 0.7);
      ctx.lineTo(sx - r * 0.33, sy - r * 0.2);
      ctx.lineTo(sx + r * 0.33, sy - r * 0.7);
      ctx.lineTo(sx + r * 0.33, sy - r * 0.2);
      ctx.lineTo(sx + r, sy - r * 0.7);
      ctx.lineTo(sx + r, sy + r * 0.7);
      ctx.closePath();
      ctx.fillStyle = damaged ? st.industry.damaged : st.industry.fill;
      ctx.fill();
      ctx.lineWidth = g.r ? 2.4 : 1.2;
      ctx.strokeStyle = g.r ? st.industry.armament : st.industry.stroke;
      ctx.stroke();
      if (g.open) {
        ctx.setLineDash([3, 2]);
        ctx.strokeStyle = st.industry.armament;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(sx - r - 4, sy - r - 4, 2 * r + 8, 2 * r + 8);
        ctx.setLineDash([]);
      }
      if (zoomed && total) {
        ctx.font = '600 10.5px "Saira Condensed", sans-serif';
        const label = `${g.f}·${g.r}${g.w ? `·${g.w}` : ''}`;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(20,23,26,0.9)';
        ctx.strokeText(label, sx, sy + r + 8);
        ctx.fillStyle = '#f1f3f5';
        ctx.fillText(label, sx, sy + r + 8);
      }
    }
  }

  // ---------------------------------------------------------------- Phase 4: Geheimdienst
  screenOfCell(cell) {
    const b = this.grid.cellBounds(cell);
    const [mx, my] = this.map.worldToMap((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    return this.camera.toScreen(mx, my);
  }

  /** Ziel unter dem Mauszeiger: Wissenschaftler, Gebäude, Brücke, Knoten, Front oder Gebiet. */
  pickIntelTarget(sx, sy) {
    const sim = this.sim;
    let best = null;
    let bd = 14 * 14;
    const consider = (kind, id, cell, pri) => {
      const [x, y] = this.screenOfCell(cell);
      const d = (x - sx) ** 2 + (y - sy) ** 2 - pri * 20;
      if (d < bd) { bd = d; best = { kind, id }; }
    };
    for (const s of sim.scientists) if (s.status === 'aktiv' && s.cell >= 0) consider('scientist', s.id, s.cell, 4);
    const seen = new Set();
    const pri = { ruestung: 3, forschung: 3, fabrik: 2 };
    for (const b of [...sim.buildings].sort((a, c) => (pri[c.type] || 0) - (pri[a.type] || 0))) {
      if (!b.done || seen.has(b.cell)) continue;
      seen.add(b.cell);
      if (isRevealed(sim, sim.player, b.cell)) consider('building', b.id, b.cell, pri[b.type]);
    }
    sim.bridges.forEach((b, i) => consider('bridge', i, b.cell, 1));
    sim.nodes.forEach((x, i) => consider('node', i, x.cell, 0));
    if (best) return best;
    const fid = this.frontAtScreen(sx, sy);
    if (fid) return { kind: 'front', id: fid };
    const cell = this.cellAt(sx, sy);
    if (cell >= 0 && this.grid.territory[cell]) return { kind: 'sector', id: sim.sectors.sectorOf[cell] };
    return null;
  }

  /** Pinnwand: Ziele, Agenten (rote Nadeln), Fäden, Fadenkreuze; aufgeklärte Gebiete. */
  drawIntel(st) {
    const { ctx, camera: cam, sim } = this;
    const p = sim.player;
    const W = cam.width;
    const H = cam.height;
    const vis = (x, y) => x > -20 && y > -20 && x < W + 20 && y < H + 20;
    const cellPx = this.cellU * cam.scale;
    // aufgeklärte Gebiete (gestrichelter roter Rahmen um die Sektormitte)
    const stI = sim.intel.get(p);
    ctx.save();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(179,38,30,0.8)';
    ctx.lineWidth = 1.2;
    for (const [sec, until] of Object.entries(stI.revealedSectors)) {
      if (until < sim.day) continue;
      const [x, y] = this.screenOfCell(Math.round(sim.sectors.cy[sec]) * sim.cols + Math.round(sim.sectors.cx[sec]));
      const r = 5.5 * cellPx;
      if (vis(x, y)) ctx.strokeRect(x - r, y - r, 2 * r, 2 * r);
    }
    ctx.restore();
    // Ziele: Knoten, Brücken (ab näherer Ansicht), Gebäude, Wissenschaftler
    // Knoten und Brücken: eigene und gegnerische immer, neutrale erst bei naher Ansicht
    const relevant = (cell) => { const o = sim.owner[cell]; return o === p || sim.isWar(o, p) || cellPx >= 6; };
    if (cellPx >= 3) {
      for (const node of sim.nodes) {
        if (!relevant(node.cell)) continue;
        const [x, y] = this.screenOfCell(node.cell);
        if (!vis(x, y)) continue;
        ctx.fillStyle = node.state === 1 ? 'rgba(216,210,194,0.55)' : '#B3261E';
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }
      for (const b of sim.bridges) {
        if (!relevant(b.cell)) continue;
        const [x, y] = this.screenOfCell(b.cell);
        if (!vis(x, y)) continue;
        ctx.strokeStyle = b.state === 1 ? 'rgba(216,210,194,0.7)' : '#B3261E';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x - 3, y - 1.5); ctx.lineTo(x + 3, y - 1.5);
        ctx.moveTo(x - 3, y + 1.5); ctx.lineTo(x + 3, y + 1.5);
        ctx.stroke();
      }
    }
    const seen = new Set();
    for (const b of sim.buildings) {
      if (!b.done || seen.has(b.cell) || !isRevealed(sim, p, b.cell)) continue;
      seen.add(b.cell);
      const [x, y] = this.screenOfCell(b.cell);
      if (!vis(x, y)) continue;
      ctx.strokeStyle = sim.owner[b.cell] === p ? 'rgba(216,210,194,0.7)' : 'rgba(216,210,194,0.95)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 3, y - 3, 6, 6);
    }
    ctx.font = '11px "Special Elite", monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const placed = [...(this.placedLabels || [])];
    for (const s of sim.scientists) {
      if (s.status === 'aktiv' && s.cell >= 0) {
        const [x, y] = this.screenOfCell(s.cell);
        placed.push({ x0: x - 5, y0: y - 6, x1: x + 5, y1: y + 6 });
      }
    }
    for (const s of sim.scientists) {
      if (s.status !== 'aktiv' || s.cell < 0) continue;
      const [x, y] = this.screenOfCell(s.cell);
      if (!vis(x, y)) continue;
      ctx.fillStyle = s.employer === p ? '#d8d2c2' : '#f1ece0';
      ctx.beginPath();
      ctx.moveTo(x, y - 5); ctx.lineTo(x + 4, y); ctx.lineTo(x, y + 5); ctx.lineTo(x - 4, y);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = s.employer === p ? '#0C0E13' : '#B3261E';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      if (cam.scale > 0.05) {
        // Namen ohne Überlappung mit Kartenbeschriftung und anderen Namen
        const w = ctx.measureText(s.name).width;
        const cands = [[x + 7, y, 'left'], [x - 7, y, 'right'], [x, y + 13, 'center'], [x, y - 13, 'center']];
        for (const [lx, ly, al] of cands) {
          const x0 = al === 'left' ? lx : al === 'right' ? lx - w : lx - w / 2;
          const box = { x0: x0 - 2, y0: ly - 7, x1: x0 + w + 2, y1: ly + 7 };
          if (placed.some((q) => box.x0 < q.x1 && box.x1 > q.x0 && box.y0 < q.y1 && box.y1 > q.y0)) continue;
          placed.push(box);
          ctx.textAlign = al;
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(12,14,19,0.9)';
          ctx.strokeText(s.name, lx, ly);
          ctx.fillStyle = '#d8d2c2';
          ctx.fillText(s.name, lx, ly);
          break;
        }
      }
    }
    // Agenten: Nadeln an der eigenen Hauptstadt, Fäden zu den Zielen
    const cap = sim.capital.get(p);
    if (cap === undefined) return;
    const [cx, cy] = this.screenOfCell(cap);
    const agents = stI.agents;
    const crosshair = (x, y, r, color, lw) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.moveTo(x - r - 5, y); ctx.lineTo(x - r + 3, y);
      ctx.moveTo(x + r - 3, y); ctx.lineTo(x + r + 5, y);
      ctx.moveTo(x, y - r - 5); ctx.lineTo(x, y - r + 3);
      ctx.moveTo(x, y + r - 3); ctx.lineTo(x, y + r + 5);
      ctx.stroke();
    };
    agents.forEach((a, k) => {
      const ang = -Math.PI / 2 + (k - (agents.length - 1) / 2) * 0.55;
      const px = cx + Math.cos(ang) * 22;
      const py = cy + Math.sin(ang) * 22;
      if (a.state === 'mission') {
        const d = describeTarget(sim, a.mission.target);
        if (d) {
          const [tx, ty] = this.screenOfCell(d.cell);
          ctx.strokeStyle = 'rgba(179,38,30,0.85)';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.quadraticCurveTo((px + tx) / 2, Math.min(py, ty) - 40, tx, ty);
          ctx.stroke();
          crosshair(tx, ty, 8, '#B3261E', 1.6);
        }
      }
      // Nadel
      ctx.strokeStyle = '#8c8c8c';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px, py + 9);
      ctx.stroke();
      ctx.fillStyle = a.state === 'ready' ? '#e2382c' : a.state === 'mission' ? '#B3261E' : '#6d2420';
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#0C0E13';
      ctx.stroke();
    });
    if (this.intelTarget) {
      const d = describeTarget(sim, this.intelTarget);
      if (d) {
        const [tx, ty] = this.screenOfCell(d.cell);
        const pulse = 11 + Math.sin(performance.now() / 250) * 1.5;
        crosshair(tx, ty, pulse, '#ff4a3d', 2.2);
      }
    }
  }

  /** Feld unter Bildschirmposition (CSS-Pixel relativ zum Canvas). */
  cellAt(sx, sy) {
    const [mx, my] = this.camera.toMap(sx, sy);
    const [wx, wy] = this.map.mapToWorld(mx, my);
    return this.grid.cellAtWorld(wx, wy);
  }
}

/**
 * Chaikin-Glättung (2 Durchgänge) einer Linie aus Feldecken. `attr[i]` gehört zum Stück i→i+1;
 * jedes neue Stück erbt Kategorie und Befestigung seines Ursprungsstücks.
 */
function smoothChain(pts, attr, fid) {
  let P = pts;
  let A = attr.map((e) => ({ cat: e.cat, fort: e.fort }));
  const closed = P.length > 3 && P[0][0] === P[P.length - 1][0] && P[0][1] === P[P.length - 1][1];
  for (let it = 0; it < 2; it++) {
    const NP = [];
    const NA = [];
    if (!closed) NP.push(P[0]);
    for (let i = 0; i < P.length - 1; i++) {
      const [x0, y0] = P[i];
      const [x1, y1] = P[i + 1];
      NP.push([0.75 * x0 + 0.25 * x1, 0.75 * y0 + 0.25 * y1]);
      NP.push([0.25 * x0 + 0.75 * x1, 0.25 * y0 + 0.75 * y1]);
      NA.push(A[i], A[i]);
    }
    if (closed) NP.push(NP[0]);
    else NP.push(P[P.length - 1]);
    // Stückattribute auf die neue Punktzahl bringen
    while (NA.length < NP.length - 1) NA.push(NA[NA.length - 1] || A[A.length - 1]);
    P = NP;
    A = NA.slice(0, NP.length - 1);
  }
  const p = new Float32Array(P.length * 2);
  P.forEach(([x, y], i) => { p[i * 2] = x; p[i * 2 + 1] = y; });
  return { fid, p, cat: A.map((a) => a.cat), fort: A.map((a) => a.fort) };
}


/** weiche Übergänge (ease-in-out) */
function ease(x) {
  return x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2;
}

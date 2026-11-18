import { Camera } from './camera.js';
import { STYLES, reliefGray } from './styles.js';

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
    const { camera: cam, dpr } = this;
    const st = STYLES[this.mode];
    const W = this.canvas.width;
    const H = this.canvas.height;
    const key = `${this.mode}|${cam.cx.toFixed(3)}|${cam.cy.toFixed(3)}|${cam.scale.toFixed(6)}|${W}|${H}|${this.layerVersion}`;
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
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layers.over, 0, 0);

    ctx.setTransform(...cam.matrix(dpr));
    if (this.showGrid) this.drawGrid(st, u);
    if (st.front) this.drawStaticFronts(st, u);
    if (this.sim) this.drawWarFronts(st, u, t);
    if (this.selected >= 0) this.drawSelection(st, u);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.layers.labels, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.sim) this.drawSieges(st);
    if (st.spotlight) this.drawSpotlight();

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

    ctx = this.layers.over.getContext('2d');
    this.ctx = ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.setTransform(...cam.matrix(dpr));
    if (st.rails) {
      ctx.lineJoin = 'round';
      ctx.strokeStyle = st.rails.color;
      ctx.lineWidth = st.rails.width * u;
      ctx.stroke(this.railPath);
      ctx.save();
      ctx.clip(this.ownerPaths.get('DEU'));
      ctx.strokeStyle = st.rails.highlight;
      ctx.lineWidth = st.rails.highlightWidth * u;
      ctx.stroke(this.railPath);
      ctx.restore();
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
    this.occ = { prev: mk(), curr: mk(), annex: mk() };
    this.occImg = this.occ.curr.getContext('2d').createImageData(cols, rows);
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
    this.frontGeom = this.buildFrontGeometry();
    this.prevFrontGeom = null;
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
  }

  /** Nach jedem Simulations-Tick: geänderte Felder und Frontgeometrie übernehmen. */
  onTick() {
    const pc = this.occ.prev.getContext('2d');
    pc.clearRect(0, 0, this.occ.prev.width, this.occ.prev.height);
    pc.drawImage(this.occ.curr, 0, 0);
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
    for (const i of touched) this.writeOccPixel(i);
    this.occ.curr.getContext('2d').putImageData(this.occImg, 0, 0);
    if (touched.size) this.occ.annex.getContext('2d').putImageData(this.annexImg, 0, 0);
    this.prevFrontGeom = this.frontGeom;
    this.frontGeom = this.buildFrontGeometry();
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
    this.drawCells(tmp, this.occ.prev);
    tmp.globalAlpha = Math.max(0, Math.min(1, t / 0.6)); // neue Felder blenden in 60 % des Tages ein
    this.drawCells(tmp, this.occ.curr);
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

  /** Frontbalken aus den Kontaktkanten der Simulation (Karteneinheiten). */
  buildFrontGeometry() {
    const sim = this.sim;
    const E = sim.edges;
    const { cols } = this.grid;
    const cu = this.cellU;
    const gx0 = this.gx0;
    const gy1 = this.gy1;
    const paths = new Map();
    const byFront = new Map();
    const teeth = [];
    this.edgeFrontAt.fill(0);
    const player = sim.player;
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
      let x1;
      let y1;
      let x2;
      let y2;
      if (E.dir[k] === 0) {
        x1 = x2 = gx0 + (c + 1) * cu;
        y1 = gy1 - r * cu;
        y2 = gy1 - (r + 1) * cu;
      } else {
        y1 = y2 = gy1 - (r + 1) * cu;
        x1 = gx0 + c * cu;
        x2 = x1 + cu;
      }
      const me = f.side[player] ? player : f.a;
      const side = f.side[me];
      let status = 'halten';
      if (side.order === 'prepare') status = 'vorbereiten';
      if (side.order === 'attack') {
        const sec = f.sections.find((x) => x.sector === sim.sectors.sectorOf[b]);
        status = sec?.stats.status[me] || 'Vormarsch';
        // Zahn zeigt in das gegnerische Feld
        const myCell = me === f.a ? a : b;
        const enemyCell = me === f.a ? b : a;
        let nx = 0;
        let ny = 0;
        if (E.dir[k] === 0) nx = enemyCell > myCell ? 1 : -1;
        else ny = enemyCell > myCell ? -1 : 1;
        teeth.push((x1 + x2) / 2, (y1 + y2) / 2, nx, ny, (a * 7 + b * 13) % 997);
      }
      if (!paths.has(status)) paths.set(status, new Path2D());
      const p = paths.get(status);
      p.moveTo(x1, y1);
      p.lineTo(x2, y2);
      if (!byFront.has(fid)) byFront.set(fid, new Path2D());
      const q = byFront.get(fid);
      q.moveTo(x1, y1);
      q.lineTo(x2, y2);
    }
    return { paths, byFront, teeth };
  }

  drawWarFronts(st, u, t) {
    const fs = st.warFront;
    if (!fs) return;
    const { ctx } = this;
    const pulse = 0.7 + 0.3 * Math.sin(performance.now() / 160);
    const draw = (g, alpha) => {
      if (!g || alpha <= 0.01) return;
      ctx.globalAlpha = alpha;
      ctx.lineCap = 'square';
      ctx.lineJoin = 'miter';
      const sel = this.selectedFront && g.byFront.get(this.selectedFront);
      if (sel) {
        ctx.strokeStyle = fs.selected;
        ctx.lineWidth = (fs.width + 9) * u;
        ctx.stroke(sel);
      }
      ctx.strokeStyle = fs.edge;
      ctx.lineWidth = (fs.width + 3) * u;
      for (const p of g.paths.values()) ctx.stroke(p);
      // Zähne zur Gegnerseite bei Angriff
      const cellPx = this.cellU / u;
      const every = Math.max(1, Math.ceil(13 / cellPx));
      const size = Math.min(7, Math.max(3.5, cellPx * 0.45)) * u;
      const tp = new Path2D();
      for (let i = 0; i < g.teeth.length; i += 5) {
        if (g.teeth[i + 4] % every) continue;
        const mx = g.teeth[i];
        const my = g.teeth[i + 1];
        const nx = g.teeth[i + 2];
        const ny = g.teeth[i + 3];
        tp.moveTo(mx - ny * size * 0.7, my + nx * size * 0.7);
        tp.lineTo(mx + nx * size * 1.25, my + ny * size * 1.25);
        tp.lineTo(mx + ny * size * 0.7, my - nx * size * 0.7);
        tp.closePath();
      }
      ctx.fillStyle = fs.edge;
      ctx.lineWidth = 2 * u;
      ctx.strokeStyle = fs.edge;
      ctx.stroke(tp);
      for (const [status, p] of g.paths) {
        ctx.strokeStyle = fs.colors[status] || fs.colors.halten;
        ctx.globalAlpha = alpha * (status === 'Durchbruch' ? pulse : 1);
        ctx.lineWidth = fs.width * u;
        ctx.stroke(p);
      }
      ctx.globalAlpha = alpha;
      ctx.fillStyle = fs.colors.Vormarsch;
      ctx.fill(tp);
      ctx.globalAlpha = 1;
    };
    // kurze Überblendung im ersten Drittel des Tages, danach steht die neue Front
    const tt = Math.max(0, Math.min(1, t / 0.3));
    if (this.prevFrontGeom && tt < 1) draw(this.prevFrontGeom, 1 - tt);
    draw(this.frontGeom, this.prevFrontGeom ? tt : 1);
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

  /** Feld unter Bildschirmposition (CSS-Pixel relativ zum Canvas). */
  cellAt(sx, sy) {
    const [mx, my] = this.camera.toMap(sx, sy);
    const [wx, wy] = this.map.mapToWorld(mx, my);
    return this.grid.cellAtWorld(wx, wy);
  }
}

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
      this.render();
    });
  }

  render() {
    const t0 = performance.now();
    const { ctx, camera: cam, dpr } = this;
    const st = STYLES[this.mode];
    const W = this.canvas.width;
    const H = this.canvas.height;
    const u = 1 / cam.scale; // Karteneinheiten je CSS-Pixel

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = st.sea;
    ctx.fillRect(0, 0, W, H);

    ctx.setTransform(...cam.matrix(dpr));
    this.drawSeaGrid(st, u);

    // Länder
    for (const t of this.map.territories) {
      ctx.fillStyle = st.nation[t.owner] || '#888';
      ctx.fill(this.territoryPaths.get(t.key));
    }

    // Relief (facettiert), auf Land beschnitten
    this.drawRelief(st, u);

    // Bahn
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

    // Grenzen
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

    if (this.showGrid) this.drawGrid(st, u);
    if (st.front) this.drawFronts(st, u);
    if (this.selected >= 0) this.drawSelection(st, u);

    // Bildschirmraum: Beschriftungen, Lichtkegel
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(st);
    if (st.spotlight) this.drawSpotlight();

    this.lastFrameMs = performance.now() - t0;
    if (this.onAfterRender) this.onAfterRender();
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

  drawFronts(st, u) {
    const { ctx } = this;
    const f = st.front;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    // Zähne zur Gegnerseite (rechts der Laufrichtung, deutsches Gebiet liegt links)
    const teeth = f.teeth ? this.frontTeeth(16 * u, 6.5 * u) : null;
    ctx.strokeStyle = f.edge;
    ctx.lineWidth = (f.width + 2.4) * u;
    ctx.stroke(this.frontPath);
    if (teeth) {
      ctx.lineWidth = 2 * u;
      ctx.stroke(teeth);
      ctx.fillStyle = f.color;
      ctx.fill(teeth);
    }
    ctx.strokeStyle = f.color;
    ctx.lineWidth = f.width * u;
    ctx.stroke(this.frontPath);
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

  /** Feld unter Bildschirmposition (CSS-Pixel relativ zum Canvas). */
  cellAt(sx, sy) {
    const [mx, my] = this.camera.toMap(sx, sy);
    const [wx, wy] = this.map.mapToWorld(mx, my);
    return this.grid.cellAtWorld(wx, wy);
  }
}

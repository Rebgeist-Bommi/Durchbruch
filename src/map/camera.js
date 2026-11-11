// Kamera: Karteneinheiten (y nach Norden) <-> Bildschirmpixel (CSS-Pixel, y nach unten).
export class Camera {
  constructor({ minX, minY, maxX, maxY }) {
    this.bounds = { minX, minY, maxX, maxY };
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    this.scale = 0.05; // Pixel je Karteneinheit
    this.width = 1;
    this.height = 1;
    this.minScale = 0.01;
    this.maxScale = 2.5;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    const b = this.bounds;
    // kleinste Zoomstufe: ganzer Ausschnitt sichtbar
    this.minScale = Math.min(width / (b.maxX - b.minX), height / (b.maxY - b.minY));
    this.scale = Math.max(this.scale, this.minScale);
    this.clamp();
  }

  fit(minX, minY, maxX, maxY) {
    this.cx = (minX + maxX) / 2;
    this.cy = (minY + maxY) / 2;
    this.scale = Math.min(this.width / (maxX - minX), this.height / (maxY - minY));
    this.clamp();
  }

  toScreen(x, y) {
    return [(x - this.cx) * this.scale + this.width / 2, this.height / 2 - (y - this.cy) * this.scale];
  }

  toMap(sx, sy) {
    return [(sx - this.width / 2) / this.scale + this.cx, this.cy - (sy - this.height / 2) / this.scale];
  }

  /** Transformationsmatrix für ctx.setTransform (inkl. Pixeldichte). */
  matrix(dpr) {
    const s = this.scale * dpr;
    return [s, 0, 0, -s, (this.width / 2 - this.cx * this.scale) * dpr, (this.height / 2 + this.cy * this.scale) * dpr];
  }

  panBy(dxPx, dyPx) {
    this.cx -= dxPx / this.scale;
    this.cy += dyPx / this.scale;
    this.clamp();
  }

  zoomAt(sx, sy, factor) {
    const [mx, my] = this.toMap(sx, sy);
    this.scale = Math.min(this.maxScale, Math.max(this.minScale, this.scale * factor));
    // Punkt unter dem Mauszeiger bleibt stehen
    this.cx = mx - (sx - this.width / 2) / this.scale;
    this.cy = my + (sy - this.height / 2) / this.scale;
    this.clamp();
  }

  clamp() {
    const b = this.bounds;
    const halfW = this.width / 2 / this.scale;
    const halfH = this.height / 2 / this.scale;
    this.cx = halfW * 2 >= b.maxX - b.minX ? (b.minX + b.maxX) / 2 : Math.min(b.maxX - halfW, Math.max(b.minX + halfW, this.cx));
    this.cy = halfH * 2 >= b.maxY - b.minY ? (b.minY + b.maxY) / 2 : Math.min(b.maxY - halfH, Math.max(b.minY + halfH, this.cy));
  }

  /** sichtbarer Ausschnitt in Karteneinheiten */
  view() {
    const [x0, y1] = this.toMap(0, 0);
    const [x1, y0] = this.toMap(this.width, this.height);
    return { x0, y0, x1, y1 };
  }
}

import '@fontsource/im-fell-english-sc/400.css';
import '@fontsource/spectral/400.css';
import '@fontsource/spectral/600.css';
import '@fontsource/unifrakturmaguntia/400.css';
import '@fontsource/saira-stencil-one/400.css';
import '@fontsource/saira-condensed/400.css';
import '@fontsource/saira-condensed/600.css';
import '@fontsource/special-elite/400.css';
import './styles/base.css';
import './styles/front.css';
import './styles/economy.css';
import './styles/intel.css';

import { loadAll } from './data/loader.js';
import { Grid } from './data/grid.js';
import { inverse } from './data/projection.js';
import { MapRenderer } from './map/renderer.js';
import { Panel } from './ui/panel.js';

const MODES = ['front', 'economy', 'intel'];
const FONT_FAMILIES = ['IM Fell English SC', 'Spectral', 'UnifrakturMaguntia', 'Saira Stencil One', 'Saira Condensed', 'Special Elite'];

async function main() {
  const data = await loadAll(import.meta.env.BASE_URL);
  const grid = new Grid(data.gridMeta, data.gridBuf);
  const canvas = document.getElementById('map-canvas');
  const renderer = new MapRenderer(canvas, data, grid);
  const panel = new Panel(grid);
  window.__durchbruch = { renderer, grid, data }; // für Tests und Fehlersuche

  const zoomEl = document.getElementById('s-zoom');
  const coordEl = document.getElementById('s-coord');
  renderer.onAfterRender = () => {
    const km = Math.round(100 / renderer.camera.scale / 10) * 1; // km je 100 px
    zoomEl.textContent = `100 px ≈ ${km} km`;
  };

  // ---- Modus ----
  function setMode(mode) {
    if (!MODES.includes(mode)) return;
    for (const m of MODES) document.body.classList.toggle(`mode-${m}`, m === mode);
    for (const b of document.querySelectorAll('#modes button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
    renderer.setMode(mode);
  }
  document.getElementById('modes').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-mode]');
    if (b) setMode(b.dataset.mode);
  });

  // ---- Größe ----
  new ResizeObserver(() => renderer.resize()).observe(document.getElementById('map'));
  renderer.resize();

  // ---- Zoom und Verschieben ----
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    renderer.camera.zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.0015));
    renderer.requestRender();
  }, { passive: false });

  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false };
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const [mx, my] = renderer.camera.toMap(px, py);
    const [lon, lat] = inverse(...renderer.map.mapToWorld(mx, my));
    coordEl.textContent = `${lat.toFixed(2)}° N  ${lon.toFixed(2)}° O`;
    if (renderer.mode === 'intel') {
      renderer.spot = [px, py];
      renderer.requestRender();
    }
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 4) {
      drag.moved = true;
      canvas.classList.add('dragging');
    }
    if (drag.moved) {
      renderer.camera.panBy(e.clientX - drag.x, e.clientY - drag.y);
      renderer.requestRender();
    }
    drag.x = e.clientX;
    drag.y = e.clientY;
  });
  const endDrag = (e) => {
    if (!drag) return;
    if (!drag.moved && e.type === 'pointerup') {
      const r = canvas.getBoundingClientRect();
      const i = renderer.cellAt(e.clientX - r.left, e.clientY - r.top);
      renderer.selected = i;
      panel.showCell(i);
      renderer.requestRender();
    }
    drag = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- Tastatur ----
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const cam = renderer.camera;
    switch (e.key) {
      case '1': setMode('front'); break;
      case '2': setMode('economy'); break;
      case '3': setMode('intel'); break;
      case 'g': case 'G': renderer.showGrid = !renderer.showGrid; renderer.requestRender(); break;
      case '0': renderer.focusStart(); renderer.requestRender(); break;
      case '+': case '=': cam.zoomAt(cam.width / 2, cam.height / 2, 1.25); renderer.requestRender(); break;
      case '-': cam.zoomAt(cam.width / 2, cam.height / 2, 0.8); renderer.requestRender(); break;
      default: return;
    }
  });

  // Schriften fürs Canvas nachladen, dann neu zeichnen
  await Promise.allSettled(FONT_FAMILIES.map((f) => document.fonts.load(`16px "${f}"`)));
  renderer.render();
  document.getElementById('loading').classList.add('done');
  document.body.dataset.ready = 'true';
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  el.textContent = `Fehler beim Laden: ${err.message}`;
});

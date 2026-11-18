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
import './styles/game.css';

import balance from '../data/balance.json';
import { loadAll } from './data/loader.js';
import { Grid } from './data/grid.js';
import { inverse } from './data/projection.js';
import { MapRenderer } from './map/renderer.js';
import { Panel } from './ui/panel.js';
import { GameUI } from './ui/game.js';
import { Simulation } from './sim/simulation.js';

const MODES = ['front', 'economy', 'intel'];
const FONT_FAMILIES = ['IM Fell English SC', 'Spectral', 'UnifrakturMaguntia', 'Saira Stencil One', 'Saira Condensed', 'Special Elite'];

async function main() {
  const data = await loadAll(import.meta.env.BASE_URL);
  const grid = new Grid(data.gridMeta, data.gridBuf);
  const canvas = document.getElementById('map-canvas');
  const renderer = new MapRenderer(canvas, data, grid);
  const panel = new Panel(grid);
  const seed = Number(new URLSearchParams(location.search).get('seed')) || balance.seed;
  const sim = new Simulation({ grid, map: data.map, balance, seed });
  panel.sim = sim;
  renderer.attachSim(sim);

  // ---- Zeit: Simulation tickt einmal pro Spieltag, Darstellung animiert dazwischen ----
  const msPerDay = balance.time.msPerDayAt1x;
  const clock = { speed: 0, lastSpeed: 1, acc: 0, last: 0, running: false };
  const centerOnCell = (cell) => {
    const b = grid.cellBounds(cell);
    const [mx, my] = data.map.worldToMap((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    renderer.camera.cx = mx;
    renderer.camera.cy = my;
    renderer.camera.clamp();
    renderer.requestRender();
  };
  const ui = new GameUI({ sim, renderer, panel, onCenter: centerOnCell });
  ui.onGameOver = () => setSpeed(0);

  function doTick() {
    sim.tick();
    renderer.onTick();
    ui.onTick();
  }

  function frame(now) {
    if (!clock.running) return;
    const dt = Math.min(250, now - clock.last);
    clock.last = now;
    if (clock.speed > 0 && !sim.isOver()) {
      clock.acc += dt * clock.speed;
      if (clock.acc >= msPerDay) {
        clock.acc = Math.min(clock.acc - msPerDay, msPerDay * 0.5);
        doTick();
      }
    }
    const t = clock.acc / msPerDay;
    renderer.t = t;
    ui.setDayProgress(t);
    renderer.render(t);
    if (clock.speed > 0 && !sim.isOver()) requestAnimationFrame(frame);
    else clock.running = false;
  }

  function setSpeed(s) {
    clock.speed = s;
    if (s > 0) clock.lastSpeed = s;
    for (const b of document.querySelectorAll('#time [data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
    document.body.classList.toggle('paused', s === 0);
    if (s > 0 && !clock.running && !sim.isOver()) {
      clock.running = true;
      clock.last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  document.getElementById('time').addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (b) setSpeed(Number(b.dataset.speed));
  });

  window.__durchbruch = { renderer, grid, data, sim, ui, setSpeed, doTick, clock };

  // ---- Statuszeile ----
  const zoomEl = document.getElementById('s-zoom');
  const coordEl = document.getElementById('s-coord');
  renderer.onAfterRender = () => {
    zoomEl.textContent = `100 px ≈ ${Math.round(10 / renderer.camera.scale)} km`;
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
    if (!drag) {
      canvas.classList.toggle('over-front', renderer.mode === 'front' && renderer.frontAtScreen(px, py) > 0);
      return;
    }
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
      const sx = e.clientX - r.left;
      const sy = e.clientY - r.top;
      const fid = renderer.mode === 'front' ? renderer.frontAtScreen(sx, sy) : 0;
      if (fid) {
        ui.selectFront(fid);
      } else {
        const i = renderer.cellAt(sx, sy);
        renderer.selected = i;
        panel.showCell(i);
      }
      renderer.requestRender();
    }
    drag = null;
    canvas.classList.remove('dragging');
  };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);

  // ---- Tastatur ----
  window.addEventListener('keydown', (e) => {
    if (e.target.closest && e.target.closest('input, textarea, select')) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const cam = renderer.camera;
    switch (e.key) {
      case '1': setMode('front'); break;
      case '2': setMode('economy'); break;
      case '3': setMode('intel'); break;
      case ' ': setSpeed(clock.speed ? 0 : clock.lastSpeed); break;
      case 'g': case 'G': renderer.showGrid = !renderer.showGrid; renderer.requestRender(); break;
      case '0': renderer.focusStart(); renderer.requestRender(); break;
      case '+': case '=': cam.zoomAt(cam.width / 2, cam.height / 2, 1.25); renderer.requestRender(); break;
      case '-': cam.zoomAt(cam.width / 2, cam.height / 2, 0.8); renderer.requestRender(); break;
      case 'Escape': ui.closeFront(); break;
      default: return;
    }
    e.preventDefault();
  });

  // Schriften fürs Canvas nachladen, dann neu zeichnen
  await Promise.allSettled(FONT_FAMILIES.map((f) => document.fonts.load(`16px "${f}"`)));
  renderer.invalidate();
  renderer.render(0);
  setSpeed(0);
  document.getElementById('loading').classList.add('done');
  document.body.dataset.ready = 'true';
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  el.textContent = `Fehler beim Laden: ${err.message}`;
});

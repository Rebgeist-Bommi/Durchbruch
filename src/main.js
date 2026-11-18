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
import './styles/econ.css';

import balance from '../data/balance.json';
import scientistsData from '../data/scientists.json';
import generalsData from '../data/generals.json';
import { loadAll } from './data/loader.js';
import { Grid } from './data/grid.js';
import { inverse } from './data/projection.js';
import { MapRenderer } from './map/renderer.js';
import { Panel } from './ui/panel.js';
import { GameUI } from './ui/game.js';
import { Simulation } from './sim/simulation.js';
import { EconomyUI } from './ui/economy.js';
import { IntelUI } from './ui/intel.js';
import { serialize, deserialize } from './sim/save.js';

const MODES = ['front', 'economy', 'intel'];
const FONT_FAMILIES = ['IM Fell English SC', 'Spectral', 'UnifrakturMaguntia', 'Saira Stencil One', 'Saira Condensed', 'Special Elite'];

async function main() {
  const data = await loadAll(import.meta.env.BASE_URL);
  const grid = new Grid(data.gridMeta, data.gridBuf);
  const canvas = document.getElementById('map-canvas');
  const renderer = new MapRenderer(canvas, data, grid);
  const panel = new Panel(grid);
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed')) || balance.seed;
  const sim = new Simulation({ grid, map: data.map, balance, infra: data.infra, people: { scientists: scientistsData, generals: generalsData }, seed });
  // Spielstand laden, der vor dem Neuladen der Seite hinterlegt wurde (Laden/Import)
  let loadedFrom = null;
  try {
    const pending = sessionStorage.getItem('durchbruch-pending');
    if (pending) {
      sessionStorage.removeItem('durchbruch-pending');
      deserialize(sim, JSON.parse(pending));
      loadedFrom = sim.dateText();
    }
  } catch (err) {
    console.error(err);
    alert(`Spielstand konnte nicht geladen werden: ${err.message}`);
  }
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
  if (loadedFrom || sim.isOver()) ui.gameOverShown = sim.isOver();
  const econ = new EconomyUI({
    sim, renderer, onChange: () => { econ.refresh(); ui.refresh(); renderer.requestRender(); },
  });
  panel.railInfo = (i) => econ.railInfo(i);
  const intel = new IntelUI({ sim, renderer, onChange: () => { intel.refresh(); econ.refresh(); renderer.requestRender(); } });

  // ---- Speichern, Laden, Export, Import, Autosave ----
  const toast = (text) => {
    const t = document.getElementById('toast');
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 2600);
  };
  const store = (key) => {
    try {
      localStorage.setItem(key, JSON.stringify(serialize(sim)));
      return true;
    } catch (err) {
      console.error(err);
      toast(`Speichern fehlgeschlagen: ${err.message}`);
      return false;
    }
  };
  const loadText = (text) => {
    sessionStorage.setItem('durchbruch-pending', text);
    location.reload();
  };
  async function exportFile() {
    const text = JSON.stringify(serialize(sim));
    let blob = new Blob([text], { type: 'application/json' });
    let ext = 'json';
    if (typeof CompressionStream !== 'undefined') {
      blob = await new Response(blob.stream().pipeThrough(new CompressionStream('gzip'))).blob();
      ext = 'durchbruch';
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const dt = sim.dateText().replace(/\s+/g, '-').replace(/\./g, '');
    a.download = `durchbruch-${dt}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`Exportiert: ${a.download} (${Math.round(blob.size / 1024)} kB)`);
  }
  async function importFile(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    let text;
    if (buf[0] === 0x1f && buf[1] === 0x8b) {
      text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    } else {
      text = new TextDecoder().decode(buf);
    }
    JSON.parse(text); // Prüfung vor dem Neuladen
    loadText(text);
  }
  document.querySelector('.savebar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-save]');
    if (!b) return;
    const k = b.dataset.save;
    if (k === 'save' && store('durchbruch-save')) toast(`Gespeichert: ${sim.dateText()}`);
    if (k === 'load' || k === 'auto') {
      const t = localStorage.getItem(k === 'load' ? 'durchbruch-save' : 'durchbruch-auto');
      if (!t) toast(k === 'load' ? 'Kein Spielstand gespeichert.' : 'Noch kein automatischer Speicherstand.');
      else loadText(t);
    }
    if (k === 'export') exportFile();
    if (k === 'import') document.getElementById('import-file').click();
  });
  document.getElementById('import-file').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (f) importFile(f).catch((err) => toast(`Import fehlgeschlagen: ${err.message}`));
  });
  if (loadedFrom) setTimeout(() => toast(`Spielstand geladen: ${loadedFrom}`), 300);

  // ---- Debug-Schalter für Kriegserklärungen (?debug=1); Diplomatie folgt in Phase 5 ----
  if (params.get('debug')) {
    const bar = document.getElementById('debugbar');
    const sel = document.getElementById('debug-nation');
    const fill = () => {
      sel.innerHTML = Object.keys(balance.economy.nations).filter((c) => !c.startsWith('_') && c !== 'DEU' && !sim.isWar(sim.player, sim.idx(c)))
        .map((c) => `<option value="${c}">${grid.nationNames[c]}</option>`).join('');
    };
    fill();
    bar.hidden = false;
    document.getElementById('debug-war').addEventListener('click', () => {
      if (!sel.value) return;
      sim.startWar('DEU', sel.value);
      renderer.onTick();
      ui.refresh();
      econ.refresh();
      fill();
      renderer.requestRender();
    });
  }

  function doTick() {
    sim.tick();
    renderer.onTick();
    ui.onTick();
    econ.refresh();
    intel.refresh();
    if (sim.day % 7 === 0) store('durchbruch-auto');
  }

  function frame(now) {
    if (!clock.running) return;
    const dt = Math.min(250, now - clock.last);
    clock.last = now;
    if (clock.speed > 0) {
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
    if (clock.speed > 0) requestAnimationFrame(frame);
    else clock.running = false;
  }

  function setSpeed(s) {
    clock.speed = s;
    if (s > 0) clock.lastSpeed = s;
    for (const b of document.querySelectorAll('#time [data-speed]')) b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === s));
    document.body.classList.toggle('paused', s === 0);
    if (s > 0 && !clock.running) {
      clock.running = true;
      clock.last = performance.now();
      requestAnimationFrame(frame);
    }
  }
  document.getElementById('time').addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (b) setSpeed(Number(b.dataset.speed));
  });

  window.__durchbruch = { renderer, grid, data, sim, ui, econ, intel, setSpeed, doTick, clock, serialize };

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
    if (mode !== 'economy' && econ.buildType) econ.setBuildMode(null);
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
      if (econ.buildType) econ.hover(renderer.cellAt(px, py), e.clientX, e.clientY);
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
      const i = renderer.cellAt(sx, sy);
      if (econ.buildType) {
        econ.click(i);
      } else if (renderer.mode === 'intel') {
        intel.select(renderer.pickIntelTarget(sx, sy));
      } else if (fid) {
        ui.selectFront(fid);
      } else {
        renderer.selected = i;
        panel.showCell(i);
        if (renderer.mode === 'economy') econ.selectCell(i);
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
      case 'Escape': if (econ.buildType) econ.setBuildMode(null); else ui.closeFront(); break;
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

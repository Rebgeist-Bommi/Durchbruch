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
import './styles/phase5.css';
import './styles/diplomacy.css';
import './styles/ui2.css';

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
import { checkDecisions } from './sim/events.js';
import { declareWar } from './sim/diplomacy.js';
import { DecisionUI, DiplomacyUI, NewspaperUI } from './ui/phase5.js';
import { MainMenu, loadSettings, saveSettingsNow } from './ui/menu.js';
import { MenuBackdrop, MenuMusic } from './ui/menuMedia.js';
import { autoplayCampaign } from './sim/autoplay.js';
import { Popover, DiplomacyTab, Banner, GoalsUI, Tutorial, renderAlerts } from './ui/ui2.js';
import { flagUrl } from './ui/flags.js';

const MODES = ['front', 'economy', 'intel', 'diplomacy'];
const FONT_FAMILIES = ['IM Fell English SC', 'Spectral', 'UnifrakturMaguntia', 'Saira Stencil One', 'Saira Condensed', 'Special Elite'];

async function main() {
  // Hauptmenü sofort zeigen (Fotos, Zeitungen, Musik), während die Karte noch lädt
  const settings = loadSettings();
  const earlyParams = new URLSearchParams(location.search);
  let hasPending = false;
  let hasStart = false;
  try { hasPending = !!sessionStorage.getItem('durchbruch-pending'); hasStart = !!sessionStorage.getItem('durchbruch-start'); } catch { /* ohne sessionStorage */ }
  const menuAtStart = !hasPending && !hasStart && earlyParams.get('menu') !== '0';
  const menuRoot = document.getElementById('menu');
  const backdrop = new MenuBackdrop(menuRoot);
  const music = new MenuMusic({ button: menuRoot.querySelector('.m-music'), settings, onSettings: (st) => saveSettingsNow(st) });
  if (menuAtStart) {
    menuRoot.hidden = false;
    backdrop.start();
    music.setActive(true);
  }
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
  // Phase 5: Neues Spiel aus dem laufenden Spiel heraus (Seite wurde mit Startwahl neu geladen)
  let startCfg = null;
  try {
    const st = sessionStorage.getItem('durchbruch-start');
    if (st) { sessionStorage.removeItem('durchbruch-start'); startCfg = JSON.parse(st); }
  } catch { /* ohne sessionStorage */ }
  if (startCfg) { sim.setDifficulty(startCfg.level, startCfg.sandbox); sim.started = true; }
  try {
    const pending = sessionStorage.getItem('durchbruch-pending');
    if (pending) {
      sessionStorage.removeItem('durchbruch-pending');
      deserialize(sim, JSON.parse(pending));
      loadedFrom = sim.dateText();
      sim.started = true;
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
    renderer.camera.glideTo(mx, my); // weich zur Front gleiten
    renderer.requestRender();
  };
  const ui = new GameUI({ sim, renderer, panel, onCenter: centerOnCell });
  ui.onGameOver = () => setSpeed(0);
  if (loadedFrom || sim.isOver()) ui.gameOverShown = sim.isOver();
  ui.victoryShown = sim.dip.flags.lastVictory?.day; // alte Siegesbilanz nach dem Laden nicht erneut zeigen
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

  // ---- Phase 5: Entscheidungen, Diplomatie, Zeitung, Hauptmenü ----
  const applySettings = (st) => {
    renderer.lowDetail = st.detail === 'niedrig';
    renderer.requestRender();
  };
  applySettings(settings);
  clock.lastSpeed = settings.speed || 1;
  const afterChange = () => {
    renderer.onTick();
    renderer.updateDiploColors();
    ui.refresh();
    refreshPanels();
    paper.badge();
    refreshUi2();
    renderer.requestRender();
  };
  ui.onWar = () => afterChange();
  // Überarbeitung: Länderfenster, Diplomatie-Reiter, Banner, Ziele, Tutorial, Hinweise
  const openFrontOf = (n) => {
    const f = [...sim.fronts.values()].find((x) => x.alive && x.side[sim.player] && sim.enemyOn(x, sim.player) === n);
    if (f) { setMode('front'); ui.selectFront(f.id, true); }
  };
  const popover = new Popover({ sim, onChange: () => afterChange(), openFront: openFrontOf });
  const diploTab = new DiplomacyTab({ sim, onChange: () => afterChange(), openFront: openFrontOf });
  const banner = new Banner({ sim, onClick: () => {} });
  const goals = new GoalsUI({ sim, onChange: () => afterChange() });
  const tutorial = new Tutorial({ setMode: (m) => { if (renderer.mode !== m) setMode(m); }, econTab: (t) => { if (econ.tab !== t) { econ.tab = t; econ.refresh(); } }, ctx: () => ({ sim, popover, ui, renderer, econ, goals, clock }) });
  document.getElementById('top-flag').src = flagUrl(sim.code(sim.player));
  document.getElementById('goal-chip').addEventListener('click', () => goals.show());
  document.getElementById('supply-toggle').addEventListener('change', (e) => { renderer.supplyOn = e.target.checked; renderer.requestRender(); });
  // nur sichtbare Seitenleisten neu aufbauen (Kennzahlen oben immer)
  function refreshPanels() {
    if (renderer.mode === 'economy') { econ.refresh(); if (econ.tab === 'forschung') tutorial.offer('forschung'); } else econ.renderKpis();
    if (renderer.mode === 'intel') intel.refresh();
  }
  function refreshUi2() {
    renderAlerts(sim, {
      front: (empty) => { if (empty[0]) { setMode('front'); ui.selectFront(empty[0].id, true); } },
      decision: () => decision.show(),
      equip: () => setMode('economy'),
      money: () => setMode('economy'),
      morale: () => setMode('front'),
    });
    banner.collect();
    if (sim.enemiesOf(sim.player).length) tutorial.offer('krieg'); // erster Krieg: Erklärung anbieten
    if (renderer.mode === 'diplomacy') diploTab.render();
    if (popover.open) popover.render();
  }
  const decision = new DecisionUI({
    sim,
    onDecided: () => {
      afterChange();
      if (clock.resumeAfterDecision) { clock.resumeAfterDecision = false; setSpeed(clock.lastSpeed); }
    },
  });
  const diplo = new DiplomacyUI({ sim, onChange: afterChange });
  const paper = new NewspaperUI({ sim });
  /** Entscheidung anzeigen und Spiel anhalten, falls eine ansteht. */
  const pauseForDecision = () => {
    if (!checkDecisions(sim)) return false;
    if (clock.speed > 0) clock.resumeAfterDecision = true;
    setSpeed(0);
    decision.show();
    return true;
  };
  const menu = new MainMenu({
    settings,
    onVisible: (on) => { if (on) backdrop.start(); else backdrop.stop(); music.setActive(on); },
    levels: balance.difficulty.levels,
    inGame: () => sim.day > 0 || !!sim.started,
    onStart: (level, sandbox, tut = false) => {
      if (sim.day > 0 || sim.started) {
        sessionStorage.setItem('durchbruch-start', JSON.stringify({ level, sandbox, tut }));
        location.reload();
        return;
      }
      sim.setDifficulty(level, sandbox);
      sim.started = true;
      menu.hide();
      afterChange();
      let seen = false;
      try { seen = localStorage.getItem('durchbruch-tutorial') === 'done'; } catch { /* ohne Speicher */ }
      if (tut) setTimeout(() => tutorial.start(), 400);
      else if (!seen && !sandbox) setTimeout(() => tutorial.startGuided(), 400);
      toast(`${sandbox ? 'Sandbox' : 'Kampagne'} · ${balance.difficulty.levels[level].label}${sandbox ? ' · unbegrenzte Mittel' : ''}`);
    },
    onLoad: (kind) => {
      if (kind === 'import') { document.getElementById('import-file').click(); return; }
      const t = localStorage.getItem(kind === 'load' ? 'durchbruch-save' : 'durchbruch-auto');
      if (t) loadText(t);
    },
    onResume: () => { if (settings.speed) clock.lastSpeed = settings.speed; },
    onSettings: (st) => { Object.assign(settings, st); applySettings(settings); clock.lastSpeed = settings.speed || 1; music.setVolume(settings.volume); music.update(); },
  });
  ui.onMenu = () => { setSpeed(0); menu.show(); };
  ui.onPropaganda = () => econ.refresh();
  document.querySelector('.gamebar').addEventListener('click', (e) => {
    const b = e.target.closest('[data-open]');
    if (!b) return;
    if (b.dataset.open === 'menu') { setSpeed(0); menu.show(); }
    if (b.dataset.open === 'diplo') setMode('diplomacy');
    if (b.dataset.open === 'paper') paper.show();
  });

  // ---- Debug-Schalter für Kriegserklärungen (?debug=1) ----
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
      declareWar(sim, sim.player, sim.idx(sel.value));
      renderer.onTick();
      ui.refresh();
      econ.refresh();
      fill();
      renderer.requestRender();
    });
  }

  function doTick() {
    if (pauseForDecision()) return;
    const advanced = sim.tick();
    if (!advanced) { pauseForDecision(); return; }
    renderer.onTick();
    // Oberfläche nach dem nächsten Bild aktualisieren, damit der Tageswechsel nicht ruckelt
    const ui2 = () => { ui.onTick(); refreshPanels(); paper.badge(); refreshUi2(); };
    if (clock.speed > 0) setTimeout(ui2, 0); else ui2();
    if (sim.day % 7 === 0) setTimeout(() => store('durchbruch-auto'), 50);
    if (sim.isOver()) { setSpeed(0); return; }
    pauseForDecision(); // Entscheidung erscheint sofort zum Tagesende
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
    // Entscheidungen, Hauptmenü und Spielende halten das Spiel an
    if (s > 0 && (sim.pending || sim.isOver() || menu.open)) {
      if (sim.pending) decision.show();
      s = 0;
    }
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

  window.__durchbruch = { renderer, grid, data, sim, ui, econ, intel, setSpeed, doTick, clock, serialize, decision, diplo, paper, menu, autoplayCampaign, popover, diploTab, goals, tutorial, banner };

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
    if (mode === 'diplomacy') diploTab.render();
    if (mode === 'economy') econ.refresh();
    if (mode === 'intel') intel.refresh();
    popover.hide();
    renderer.setMode(mode);
    // erster Besuch einer Ansicht: kurze Erklärung anbieten
    const chap = { economy: 'wirtschaft', intel: 'geheim', diplomacy: 'diplomatie' }[mode];
    if (chap) tutorial.offer(chap);
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
    renderer.camera.zoomSmooth(e.clientX - r.left, e.clientY - r.top, Math.exp(-delta * 0.0015));
    renderer.requestRender();
  }, { passive: false });

  // Haltelinie: Zeichenmodus aus dem Frontfenster, Abschluss per Doppelklick oder Enter
  ui.onDrawLine = (fid) => {
    renderer.lineDraft = { fid, pts: [] };
    setMode('front');
    toast('Haltelinie: Maustaste gedrückt halten und die Linie von A nach B ziehen. Esc bricht ab.');
    canvas.classList.add('drawing');
    renderer.requestRender();
  };
  function finishLine() {
    const d = renderer.lineDraft;
    renderer.lineDraft = null;
    canvas.classList.remove('drawing');
    const pts = simplifyLine(d.pts, 0.6);
    if (pts.length >= 2 && sim.fronts.get(d.fid)?.alive) { sim.setObjective(d.fid, pts); toast('Haltelinie gesetzt. Die Truppen stoßen bis dorthin vor und halten dann.'); }
    ui.refresh();
    renderer.requestRender();
  }
  // Ziehen: Maus gedrückt halten, jeder Mauspunkt (ab ca. 0,4 Feldern Abstand) wird Teil der Linie
  const linePoint = (e) => { const r = canvas.getBoundingClientRect(); return renderer.cellCoordAt(e.clientX - r.left, e.clientY - r.top); };
  canvas.addEventListener('pointerdown', (e) => {
    if (!renderer.lineDraft || e.button !== 0) return;
    e.stopImmediatePropagation();
    canvas.setPointerCapture(e.pointerId);
    renderer.lineDraft.drawing = true;
    renderer.lineDraft.pts = [linePoint(e)];
    renderer.requestRender();
  }, { capture: true });
  canvas.addEventListener('pointermove', (e) => {
    const d = renderer.lineDraft;
    if (!d || !d.drawing) return;
    e.stopImmediatePropagation();
    const q = linePoint(e);
    const last = d.pts[d.pts.length - 1];
    if (Math.hypot(q[0] - last[0], q[1] - last[1]) > 0.4) { d.pts.push(q); renderer.requestRender(); }
  }, { capture: true });
  canvas.addEventListener('pointerup', (e) => {
    const d = renderer.lineDraft;
    if (!d || !d.drawing) return;
    e.stopImmediatePropagation();
    d.pts.push(linePoint(e));
    if (d.pts.length >= 2) finishLine(); else d.drawing = false;
  }, { capture: true });

  // Rechtsklick auf eine Front: Truppen der gewählten Front (oder Reserve) dorthin verlegen
  canvas.addEventListener('contextmenu', (e) => {
    if (renderer.mode !== 'front') return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const fid = renderer.frontAtScreen(e.clientX - r.left, e.clientY - r.top);
    const to = sim.fronts.get(fid);
    if (!to || !to.side[sim.player]) return;
    const from = ui.frontId && ui.frontId !== fid ? ui.frontId : 0;
    const c = ui.transferCount === 'alle' ? 1e6 : Number(ui.transferCount || (from ? 1 : 5));
    const n = sim.transfer(from, fid, c);
    const days = sim.travelDays(from, fid, sim.player);
    toast(n ? `${n} Div. ${from ? 'verlegt' : 'aus der Reserve'} nach ${to.name} – Ankunft in ${days} ${days === 1 ? 'Tag' : 'Tagen'}.` : 'Keine Truppen zum Verlegen.');
    ui.refresh();
    renderer.requestRender();
  });

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
      } else if (renderer.mode === 'diplomacy') {
        diploTab.select(i >= 0 ? sim.owner[i] : 0);
        renderer.selected = i;
      } else if (fid) {
        popover.hide();
        ui.selectFront(fid);
      } else {
        renderer.selected = i;
        panel.showCell(i);
        if (renderer.mode === 'economy') econ.selectCell(i);
        // fremdes Land: Länderfenster mit den möglichen Aktionen
        if (renderer.mode === 'front' && i >= 0 && sim.owner[i] && sim.owner[i] !== sim.player) popover.show(sim.owner[i], e.clientX, e.clientY);
        else popover.hide();
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
    if (menu.open || decision.open) return; // Menü und Entscheidung: nur Maus/Tab
    if (tutorial.open && !tutorial.interactive && e.key !== 'Escape') return;
    const cam = renderer.camera;
    switch (e.key) {
      case '1': setMode('front'); break;
      case '2': setMode('economy'); break;
      case '3': setMode('intel'); break;
      case '4': setMode('diplomacy'); break;
      case 'n': case 'N': { const c = document.getElementById('supply-toggle'); c.checked = !c.checked; renderer.supplyOn = c.checked; renderer.requestRender(); break; }
      case ' ': setSpeed(clock.speed ? 0 : clock.lastSpeed); break;
      case 'd': case 'D': setMode(renderer.mode === 'diplomacy' ? 'front' : 'diplomacy'); break;
      case 'z': case 'Z': if (goals.open) goals.close(); else goals.show(); break;
      case 't': case 'T': if (paper.open) paper.close(); else paper.show(); break;
      case 'h': case 'H': if (tutorial.open) tutorial.end(); else tutorial.start(); break;
      case 'g': case 'G': renderer.showGrid = !renderer.showGrid; renderer.requestRender(); break;
      case '0': renderer.focusStart(); renderer.requestRender(); break;
      case '+': case '=': cam.zoomSmooth(cam.width / 2, cam.height / 2, 1.25); renderer.requestRender(); break;
      case '-': cam.zoomSmooth(cam.width / 2, cam.height / 2, 0.8); renderer.requestRender(); break;
      case 'Escape':
        if (renderer.lineDraft) { renderer.lineDraft = null; canvas.classList.remove('drawing'); ui.refresh(); renderer.requestRender(); }
        else if (popover.open) popover.hide();
        else if (goals.open) goals.close();
        else if (tutorial.open) tutorial.end();
        else if (diplo.open) diplo.close();
        else if (paper.open) paper.close();
        else if (econ.buildType) econ.setBuildMode(null);
        else ui.closeFront();
        break;
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
  // Hauptmenü beim Start (nicht nach Laden oder neuem Spiel aus dem Menü; ?menu=0 überspringt es)
  if (!loadedFrom && !startCfg && params.get('menu') !== '0') menu.show();
  if (sim.pending) decision.show();
  refreshUi2();
  banner.seen = sim.events.length; // alte Meldungen nicht erneut als Banner
  if (startCfg?.tut) setTimeout(() => tutorial.start(), 600);
  document.body.dataset.ready = 'true';
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('loading');
  el.textContent = `Fehler beim Laden: ${err.message}`;
});

/** Linie vereinfachen (Douglas-Peucker, Toleranz in Feldern), Endpunkte bleiben. */
function simplifyLine(pts, tol) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > bd) { bd = d; best = i; }
    }
    if (best > 0) { keep[best] = 1; stack.push([a, best], [best, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

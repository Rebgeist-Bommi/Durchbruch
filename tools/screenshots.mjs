// Abnahme-Screenshots und Video (Phase 2–5) mit Playwright.
// Voraussetzung: npm run build && npm run preview (Port 4173). Aufruf: npm run screenshots
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PAGE_URL = process.env.URL || 'http://localhost:4173/?menu=0';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (statSync(OUT + f).isFile()) rmSync(OUT + f); // Unterordner (z. B. stacheldraht/) bleiben

const browser = await chromium.launch();
const errors = [];
const report = { shots: [] };

async function open(ctxOpts = {}, url = PAGE_URL) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...ctxOpts });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(url);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
  // Phase 5: ein Spieltag; anstehende Entscheidungen mit der ersten Option beantworten (wie im Testlauf)
  await page.evaluate(() => {
    window.__tick = () => {
      const D = window.__durchbruch;
      if (D.sim.pending) { D.decision.show(); document.querySelector('#dc-options [data-opt="0"]').click(); return; }
      D.doTick();
    };
  });
  return { context, page };
}

const zoomPoland = (page) => page.evaluate(() => {
  const { renderer: r } = window.__durchbruch;
  const [x0, y0] = r.map.worldToMap(4_650_000, 2_850_000);
  const [x1, y1] = r.map.worldToMap(5_550_000, 3_600_000);
  r.camera.fit(x0, y0, x1, y1);
  r.render(r.t ?? 1);
});

async function shot(page, name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}${name}.png` });
  report.shots.push(name);
}

// ---------------------------------------------------------------- 1. Modi am 31.08.1939
let { context, page } = await open();
for (const [key, name] of [['1', '01-front'], ['2', '02-wirtschaft'], ['3', '03-geheimdienst']]) {
  await page.keyboard.press(key);
  if (key === '3') await page.mouse.move(820, 520);
  await shot(page, name);
}
await page.keyboard.press('1');

// ---------------------------------------------------------------- 2. Klick auf Frontbalken
await zoomPoland(page);
const hit = await page.evaluate(() => {
  const { renderer: r, sim } = window.__durchbruch;
  const E = sim.edges;
  const k = Math.floor(E.count / 3);
  const cell = E.b[k];
  const b = r.grid.cellBounds(cell);
  const a = r.grid.cellBounds(E.a[k]);
  const [mx, my] = r.map.worldToMap((b.x0 + b.x1 + a.x0 + a.x1) / 4, (b.y0 + b.y1 + a.y0 + a.y1) / 4);
  const [sx, sy] = r.camera.toScreen(mx, my);
  const rect = r.canvas.getBoundingClientRect();
  return [rect.left + sx, rect.top + sy];
});
await page.mouse.click(hit[0], hit[1]);
const opened = await page.evaluate(() => document.body.classList.contains('front-open'));
report.frontWindowOpensOnClick = opened;
await shot(page, '04-frontfenster-aufmarsch');

// ---------------------------------------------------------------- 3. Angriff auslösen und Feldzug
await page.click('#all-attack');
// wie im Testlauf: Angriff auf Polen, Westen halten (neue Westfront erhält Truppen)
await page.evaluate(() => { const D = window.__durchbruch; D.sim.autoplay = D.autoplayCampaign; });
const days = [3, 7, 12, 18, 25];
let day = 0;
for (const d of days) {
  await page.evaluate((n) => { const D = window.__durchbruch; for (let i = 0; i < n; i++) window.__tick(); D.renderer.render(1); }, d - day);
  day = d;
  await shot(page, `05-angriff-tag-${String(d).padStart(2, '0')}`);
}
// Wirtschafts- und Geheimdienstmodus während des Krieges
await page.keyboard.press('2');
await shot(page, '06-wirtschaft-krieg');
await page.keyboard.press('3');
await page.mouse.move(1000, 450);
await shot(page, '07-geheimdienst-krieg');
await page.keyboard.press('1');
// bis zur Kapitulation
const end = await page.evaluate(() => {
  const D = window.__durchbruch;
  const POL = D.sim.idx('POL');
  while (D.sim.nations.get(POL).status === 'aktiv' && D.sim.day < 150) window.__tick();
  D.renderer.render(1);
  const pol = D.sim.nations.get(D.sim.idx('POL'));
  const ms = D.sim.tickMs.filter((v) => v > 0);
  return { day: pol.capitulationDay, status: pol.status, tickMean: ms.reduce((a, b) => a + b, 0) / ms.length, tickMax: Math.max(...ms) };
});
report.capitulation = end;
await shot(page, '08-kapitulation');
await page.evaluate(() => { window.__durchbruch.renderer.focusStart(); window.__durchbruch.renderer.render(1); });
await shot(page, '09-karte-nach-feldzug');
await context.close();

// ---------------------------------------------------------------- 4. Phase 3: Wirtschaft
({ context, page } = await open());
await page.keyboard.press('2');
await shot(page, '11-wirtschaft-uebersicht');
// Region wählen (Ruhrgebiet) -> Infrastruktur mit Ausbau
const screenOf = (name, d = 0) => page.evaluate(([n, dd]) => {
  const { renderer: r, sim } = window.__durchbruch;
  const site = sim.industrySites.find((s) => s.name === n);
  const bb = r.grid.cellBounds(site.cell + dd);
  const [mx, my] = r.map.worldToMap((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
  const [sx, sy] = r.camera.toScreen(mx, my);
  const rc = r.canvas.getBoundingClientRect();
  return [rc.left + sx, rc.top + sy];
}, [name, d]);
let pt = await page.evaluate(() => {
  const { renderer: r, sim } = window.__durchbruch;
  const city = sim.cities.find((c) => c.name === 'Stettin');
  const bb = r.grid.cellBounds(city.cell + 2);
  const [mx, my] = r.map.worldToMap((bb.x0 + bb.x1) / 2, (bb.y0 + bb.y1) / 2);
  const [sx, sy] = r.camera.toScreen(mx, my);
  const rc = r.canvas.getBoundingClientRect();
  return [rc.left + sx, rc.top + sy];
});
await page.mouse.click(pt[0], pt[1]);
await shot(page, '12-wirtschaft-region-ausbau');
report.upgradeButton = await page.locator('[data-action="upgrade"]').count();
// Standortwahl: Rüstungsfabrik, Erklärung am Mauszeiger, Klick baut
await page.click('[data-action="build"][data-type="ruestung"]');
pt = await screenOf('Sachsen', 2);
await page.mouse.move(pt[0], pt[1]);
await page.waitForTimeout(250);
await shot(page, '13-standortwahl-erklaerung');
const before = await page.evaluate(() => window.__durchbruch.sim.buildings.filter((b) => !b.done).length);
await page.mouse.click(pt[0], pt[1]);
const after = await page.evaluate(() => window.__durchbruch.sim.buildings.filter((b) => !b.done).length);
report.buildByClick = after - before;
// Krieg: Wirtschaftsmodus mit beschädigten Strecken in Polen
await page.evaluate(() => {
  const D = window.__durchbruch;
  for (const f of D.sim.fronts.values()) if (f.side[D.sim.player]) D.sim.attack(f.id);
  for (let i = 0; i < 20; i++) window.__tick();
  const r = D.renderer;
  const [x0, y0] = r.map.worldToMap(4_550_000, 2_900_000);
  const [x1, y1] = r.map.worldToMap(5_400_000, 3_550_000);
  r.camera.fit(x0, y0, x1, y1);
  r.render(1);
});
await shot(page, '14-wirtschaft-krieg-bahnschaeden');
// Speichern -> 5 Tage weiter -> Laden (Seite lädt neu) -> Tag stimmt
const savedDay = await page.evaluate(() => window.__durchbruch.sim.day);
await page.click('[data-save="save"]');
await page.evaluate(() => { for (let i = 0; i < 5; i++) window.__tick(); });
await page.click('[data-save="load"]');
await page.waitForSelector('body[data-ready="true"]', { timeout: 60000 });
await page.waitForTimeout(300);
report.saveLoad = { savedDay, loadedDay: await page.evaluate(() => window.__durchbruch.sim.day) };
await page.keyboard.press('1');
await shot(page, '15-nach-dem-laden-front');
await context.close();

// ---------------------------------------------------------------- 5. Phase 4: Forschung, Geheimdienst, General
({ context, page } = await open());
await page.evaluate(() => {
  const D = window.__durchbruch;
  for (const f of D.sim.fronts.values()) if (f.side[D.sim.player]) D.sim.attack(f.id);
  for (let i = 0; i < 30; i++) window.__tick();
});
await page.keyboard.press('2');
await page.click('[data-action="tab"][data-tab="forschung"]');
await shot(page, '16-forschung');
await page.keyboard.press('3');
const nodePt = await page.evaluate(() => {
  const { renderer: r, sim } = window.__durchbruch;
  const i = sim.nodes.findIndex((n) => n.name.includes('Warschau'));
  const [x, y] = r.screenOfCell(sim.nodes[i].cell);
  const rc = r.canvas.getBoundingClientRect();
  return [rc.left + x, rc.top + y];
});
await page.mouse.click(nodePt[0], nodePt[1]);
await page.evaluate(() => { const D = window.__durchbruch; D.sim.intel.get(D.sim.player).agents.push({ id: 99, state: 'ready', ready: 0, mission: null }); D.intel.refresh(); });
await page.click('[data-action="mission"]');
await page.mouse.move(nodePt[0] + 80, nodePt[1] + 60);
await shot(page, '17-geheimdienst-akte');
report.intelMission = await page.evaluate(() => window.__durchbruch.sim.intel.get(window.__durchbruch.sim.player).agents.filter((a) => a.state === 'mission').length);
await page.keyboard.press('1');
await page.evaluate(() => { const D = window.__durchbruch; const f = [...D.sim.fronts.values()].find((x) => x.alive && x.side[D.sim.player]); D.ui.selectFront(f.id); });
await shot(page, '18-frontfenster-general');
await context.close();

// ---------------------------------------------------------------- 6. Phase 5: Hauptmenü, Entscheidung, Zeitung, Diplomatie, Ende
({ context, page } = await open({}, PAGE_URL.replace('?menu=0', '')));
await page.waitForTimeout(1500);
await shot(page, '19-hauptmenue');
report.menuPhotos = await page.evaluate(() => document.querySelectorAll('#menu .m-papers .paper').length);
await page.click('#menu [data-m="credits"]');
await page.waitForSelector('#m-credits .credits');
await shot(page, '19b-mitwirkende');
await page.click('#menu [data-m="main"]');
await page.click('#menu [data-m="campaign"]');
await page.click('#menu [data-m="start-campaign"]');
report.phase5 = await page.evaluate(() => {
  const D = window.__durchbruch;
  D.sim.autoplay = D.autoplayCampaign;
  while (!D.sim.pending && D.sim.day < 60) D.doTick();
  D.setSpeed(2); // bleibt wegen der Entscheidung angehalten
  return { decisionDay: D.sim.day, decision: D.sim.pending?.title, speedWhilePending: D.clock.speed };
});
await shot(page, '20-entscheidung');
await page.click('#dc-options [data-opt="0"]');
await page.evaluate(() => { for (let i = 0; i < 6; i++) window.__tick(); });
await page.click('.gamebar [data-open="paper"]');
await shot(page, '21-zeitung');
await page.keyboard.press('Escape');
await page.click('.gamebar [data-open="diplo"]');
await shot(page, '22-diplomatie');
await page.keyboard.press('Escape');
report.phase5.end = await page.evaluate(() => {
  const D = window.__durchbruch;
  while (!D.sim.isOver() && D.sim.day < 250) window.__tick();
  return D.sim.outcome;
});
await page.waitForTimeout(300);
await shot(page, '23-abschluss');
await context.close();

// ---------------------------------------------------------------- 7. Video: Angriff in Echtzeit (4×)
({ context, page } = await open({ recordVideo: { dir: OUT, size: { width: 1280, height: 800 } }, viewport: { width: 1280, height: 800 } }));
await page.evaluate(() => {
  const { renderer: r } = window.__durchbruch;
  const [x0, y0] = r.map.worldToMap(4_700_000, 3_000_000);
  const [x1, y1] = r.map.worldToMap(5_250_000, 3_450_000);
  r.camera.fit(x0, y0, x1, y1);
  r.render(0);
});
await page.click('#all-attack');
await page.click('#time [data-speed="4"]');
const frameStats = await page.evaluate(() => new Promise((resolve) => {
  const t = [];
  let last = performance.now();
  const loop = (now) => {
    t.push(now - last);
    last = now;
    if (t.length < 60 * 12) requestAnimationFrame(loop);
    else resolve({ frames: t.length, meanMs: t.reduce((a, b) => a + b, 0) / t.length });
  };
  requestAnimationFrame(loop);
}));
report.video = { ...frameStats, dayReached: await page.evaluate(() => window.__durchbruch.sim.day) };
const video = page.video();
await context.close();
const vpath = await video.path();
renameSync(vpath, `${OUT}10-angriff-4x.webm`);

await browser.close();
report.errors = errors;
console.log(JSON.stringify(report, null, 1));
if (errors.length) process.exit(1);

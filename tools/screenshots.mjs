// Abnahme-Screenshots und Video (Phase 2) mit Playwright.
// Voraussetzung: npm run build && npm run preview (Port 4173). Aufruf: npm run screenshots
import { createRequire } from 'node:module';
import { mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PAGE_URL = process.env.URL || 'http://localhost:4173/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) rmSync(OUT + f);

const browser = await chromium.launch();
const errors = [];
const report = { shots: [] };

async function open(ctxOpts = {}) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, ...ctxOpts });
  const page = await context.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(PAGE_URL);
  await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });
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
const days = [3, 7, 12, 18, 25];
let day = 0;
for (const d of days) {
  await page.evaluate((n) => { const D = window.__durchbruch; for (let i = 0; i < n; i++) D.doTick(); D.renderer.render(1); }, d - day);
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
  while (!D.sim.isOver() && D.sim.day < 150) D.doTick();
  D.renderer.render(1);
  const pol = D.sim.nations.get(D.sim.idx('POL'));
  const ms = D.sim.tickMs.filter((v) => v > 0);
  return { day: pol.capitulationDay, status: pol.status, tickMean: ms.reduce((a, b) => a + b, 0) / ms.length, tickMax: Math.max(...ms) };
});
report.capitulation = end;
await shot(page, '08-kapitulation');
await page.click('#go-close');
await page.evaluate(() => { window.__durchbruch.renderer.focusStart(); window.__durchbruch.renderer.render(1); });
await shot(page, '09-karte-nach-feldzug');
await context.close();

// ---------------------------------------------------------------- 4. Video: Angriff in Echtzeit (4×)
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

// Screenshots aller drei Kartenmodi mit Playwright.
// Aufruf: npm run build && npm run preview  (zweites Terminal)  dann: npm run screenshots
// Optional: URL=http://… node tools/screenshots.mjs
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const PAGE_URL = process.env.URL || 'http://localhost:4173/';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: Number(process.env.DPR || 1) });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(PAGE_URL);
await page.waitForSelector('body[data-ready="true"]', { timeout: 30000 });

const shots = [];
async function shot(name) {
  await page.waitForTimeout(250);
  const file = `${OUT}${name}.png`;
  await page.screenshot({ path: file });
  const ms = await page.evaluate(() => window.__durchbruch.renderer.lastFrameMs);
  shots.push({ name, frameMs: Math.round(ms) });
}

for (const [key, name] of [['1', 'modus1-front'], ['2', 'modus2-wirtschaft'], ['3', 'modus3-geheimdienst']]) {
  await page.keyboard.press(key);
  if (key === '3') await page.mouse.move(820, 520);
  await shot(name);
}

// Nahansicht Alpen/Böhmen mit Feldraster und ausgewähltem Feld (Prag)
await page.keyboard.press('1');
await page.evaluate(() => {
  const { renderer, grid } = window.__durchbruch;
  const cam = renderer.camera;
  const [x0, y0] = renderer.map.worldToMap(4_250_000, 2_550_000);
  const [x1, y1] = renderer.map.worldToMap(5_000_000, 3_100_000);
  cam.fit(x0, y0, x1, y1);
  renderer.render();
});
const prag = await page.evaluate(() => {
  const { renderer, grid } = window.__durchbruch;
  const b = grid.cellBounds(grid.cellAtLonLat(14.4378, 50.0755));
  const [mx, my] = renderer.map.worldToMap((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  const r = renderer.canvas.getBoundingClientRect();
  const [sx, sy] = renderer.camera.toScreen(mx, my);
  return [r.left + sx, r.top + sy];
});
await page.mouse.click(prag[0], prag[1]);
await page.keyboard.press('g');
await shot('detail-front-raster-prag');
const info = await page.evaluate(() => ({
  owner: document.getElementById('f-owner').textContent,
  territory: document.getElementById('f-territory').textContent,
  terrain: document.getElementById('f-terrain').textContent,
}));
await page.keyboard.press('g');

// Nahansicht Danzig/Ostpreußen (Front-Modus) und Wirtschaft
await page.evaluate(() => {
  const { renderer } = window.__durchbruch;
  const [x0, y0] = renderer.map.worldToMap(4_600_000, 3_300_000);
  const [x1, y1] = renderer.map.worldToMap(5_250_000, 3_700_000);
  renderer.camera.fit(x0, y0, x1, y1);
  renderer.render();
});
await shot('detail-front-danzig');
await page.keyboard.press('2');
await shot('detail-wirtschaft-danzig');

// Zoom per Mausrad und Ziehen testen
await page.keyboard.press('1');
await page.keyboard.press('0');
const before = await page.evaluate(() => ({ ...window.__durchbruch.renderer.camera }));
await page.mouse.move(900, 500);
await page.mouse.wheel(0, -600);
await page.waitForTimeout(100);
await page.mouse.down();
await page.mouse.move(700, 420, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(100);
const after = await page.evaluate(() => ({ ...window.__durchbruch.renderer.camera }));
await shot('interaktion-zoom-pan');

console.log(JSON.stringify({ shots, info, zoom: { before: before.scale, after: after.scale }, pan: { dx: after.cx - before.cx, dy: after.cy - before.cy }, errors }, null, 1));
await browser.close();
if (errors.length) process.exit(1);

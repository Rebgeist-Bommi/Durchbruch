// Layoutprüfung: Kopfleisten-Elemente (inkl. überstehender Inhalte) dürfen sich in keiner Fenstergröße überlappen.
// Aufruf (mit laufendem "npm run preview"): node tools/check_layout.mjs
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const PAGE_URL = process.env.URL || 'http://localhost:4173/?menu=0';
const OUT = new URL('../screenshots/', import.meta.url).pathname;
const sizes = [[1920, 1080], [1600, 1000], [1440, 900], [1366, 768], [1280, 720], [1024, 700]];
const browser = await chromium.launch();
let fail = 0;
for (const [w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(PAGE_URL);
  await page.waitForSelector('body[data-ready="true"]');
  for (const key of ['1', '2', '3', '4']) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    const res = await page.evaluate(() => {
      // Vereinigung aller sichtbaren Nachfahren: erfasst auch überstehende Inhalte
      const ids = ['.brand', '#modes', '#kpis'];
      const rects = ids.map((sel) => {
        const root = document.querySelector(sel);
        let l = Infinity; let t = Infinity; let r = -Infinity; let b = -Infinity;
        for (const el of [root, ...root.querySelectorAll('*')]) {
          const cs = getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const q = el.getBoundingClientRect();
          if (!q.width || !q.height) continue;
          l = Math.min(l, q.left); t = Math.min(t, q.top); r = Math.max(r, q.right); b = Math.max(b, q.bottom);
        }
        return { left: l, top: t, right: r, bottom: b };
      });
      const overlaps = [];
      for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) overlaps.push(`${ids[i]}×${ids[j]}`);
      }
      const kpis = document.querySelector('#kpis');
      const docW = document.documentElement.scrollWidth;
      const modes = document.querySelector('#modes').getBoundingClientRect();
      const center = Math.abs((modes.left + modes.right) / 2 - window.innerWidth / 2);
      return { overlaps, overflow: kpis.scrollWidth > kpis.clientWidth + 1 || docW > window.innerWidth, modesOffCenter: Math.round(center) };
    });
    const bad = res.overlaps.length || res.overflow;
    if (bad) fail++;
    console.log(`${w}×${h} Modus ${key}: ${bad ? 'FEHLER' : 'ok'} ${JSON.stringify(res)}`);
    if (w === 1280) await page.screenshot({ path: `${OUT}layout-1280-modus${key}.png` });
  }
  await page.close();
}
await browser.close();
process.exit(fail ? 1 : 0);

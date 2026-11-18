// Hauptmenü-Hintergrund (Zwischenauftrag): Originalfotos im Wechsel (8 s, langsamer Zoom,
// verschwommene Überblendung), Zeitungs-Titelseiten als Stapel, Filmkorn/Flackern/Kratzer
// (CSS) und Musik nach dem ersten Klick. Nachweise in public/media/credits.json und MEDIA_SOURCES.md.

const BASE = import.meta.env.BASE_URL;
const SLIDE_MS = 8000;
let creditsPromise = null;

/** Bildnachweise (einmal geladen). */
export function loadCredits() {
  if (!creditsPromise) creditsPromise = fetch(`${BASE}media/credits.json`).then((r) => r.json()).catch(() => ({ photos: [], papers: [], music: [] }));
  return creditsPromise;
}

export const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export class MenuBackdrop {
  constructor(root) {
    this.root = root;
    this.slides = [...root.querySelectorAll('.m-slides .slide')];
    this.caption = root.querySelector('.m-caption');
    this.papersEl = root.querySelector('.m-papers');
    this.photos = [];
    this.index = 0;
    this.timer = 0;
    this.running = false;
    this.ready = loadCredits().then((c) => {
      this.photos = c.photos;
      this.renderPapers(c.papers);
      this.setCaption(0);
      this.preload(1);
    });
  }

  /** Nächste Bilder im Hintergrund nachladen, während das erste angezeigt wird. */
  preload(from) {
    const next = (k) => {
      if (k >= this.photos.length) return;
      const im = new Image();
      im.decoding = 'async';
      im.onload = im.onerror = () => setTimeout(() => next(k + 1), 50);
      im.src = BASE + this.photos[k].file;
    };
    next(from);
  }

  renderPapers(papers) {
    const rot = [-7, 4, -2.5, 6, -4.5];
    this.papersEl.innerHTML = papers.map((p, k) => `<figure class="paper" style="--r:${rot[k % rot.length]}deg; --k:${k}" tabindex="0">
        <img src="${BASE + p.file}" alt="Titelseite: ${p.label}" loading="lazy" decoding="async"><figcaption>${p.label}</figcaption></figure>`).join('');
  }

  setCaption(k) {
    const p = this.photos[k];
    if (this.caption) this.caption.textContent = p ? `${p.motiv} · ${shortAuthor(p.artist)} · ${p.license}` : '';
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.root.classList.toggle('still', reducedMotion());
    if (reducedMotion()) return; // Standbild
    this.ready.then(() => {
      if (!this.running || this.photos.length < 2) return;
      clearInterval(this.timer);
      this.timer = setInterval(() => this.advance(), SLIDE_MS);
    });
  }

  stop() {
    this.running = false;
    clearInterval(this.timer);
  }

  advance() {
    if (document.hidden) return;
    this.index = (this.index + 1) % this.photos.length;
    const [cur, nxt] = this.slides[0].classList.contains('on') ? this.slides : [this.slides[1], this.slides[0]];
    const img = nxt.querySelector('img');
    const show = () => {
      // Zoom-Ursprung wechselt, damit der langsame Zoom nicht immer gleich wirkt
      nxt.style.setProperty('--ox', `${30 + ((this.index * 37) % 40)}%`);
      nxt.style.setProperty('--oy', `${35 + ((this.index * 23) % 30)}%`);
      nxt.classList.remove('zoom');
      void nxt.offsetWidth;
      nxt.classList.add('on', 'zoom');
      cur.classList.remove('on');
      this.setCaption(this.index);
    };
    img.onload = show;
    img.src = BASE + this.photos[this.index].file;
    if (img.complete && img.naturalWidth) { img.onload = null; show(); }
  }
}

function shortAuthor(a) {
  const s = (a || '').replace(/\s+/g, ' ').trim();
  if (!s || /unknown/i.test(s)) return 'Fotograf unbekannt';
  return s.length > 48 ? `${s.slice(0, 46)}…` : s;
}

/** Musik: startet erst nach dem ersten Klick (Browser blockieren Autoplay), Schalter an/aus. */
export class MenuMusic {
  constructor({ button, settings, onSettings }) {
    this.button = button;
    this.settings = settings;
    this.onSettings = onSettings;
    this.tracks = [];
    this.track = 0;
    this.audio = new Audio();
    this.audio.preload = 'none';
    this.audio.addEventListener('ended', () => this.next());
    this.unlocked = false;
    this.active = false; // Menü sichtbar
    this.fade = 0;
    loadCredits().then((c) => { this.tracks = c.music.map((m) => BASE + m.file); });
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      this.unlocked = true;
      this.settings.music = !this.enabled;
      this.onSettings(this.settings);
      this.update();
    });
    const unlock = () => {
      if (this.unlocked) return;
      this.unlocked = true;
      this.update();
    };
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock, { capture: true });
    this.render();
  }

  get enabled() { return this.settings.music !== false; }

  setActive(on) { this.active = on; this.update(); }

  setVolume(v) { this.settings.volume = v; if (!this.fade) this.audio.volume = this.target(); }

  target() { return Math.max(0, Math.min(1, (this.settings.volume ?? 70) / 100)); }

  next() {
    if (!this.tracks.length) return;
    this.track = (this.track + 1) % this.tracks.length;
    this.audio.src = this.tracks[this.track];
    this.audio.play().catch(() => {});
  }

  update() {
    this.render();
    const play = this.enabled && this.unlocked && this.active;
    if (play) {
      if (!this.tracks.length) { loadCredits().then(() => this.update()); return; }
      if (!this.audio.src) this.audio.src = this.tracks[this.track];
      this.fadeTo(this.target());
      this.audio.play().catch(() => {});
    } else if (!this.audio.paused) {
      this.fadeTo(0, () => this.audio.pause());
    }
  }

  fadeTo(v, done) {
    cancelAnimationFrame(this.fade);
    const from = this.audio.paused ? 0 : this.audio.volume;
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / 900);
      this.audio.volume = from + (v - from) * k;
      if (k < 1) this.fade = requestAnimationFrame(step);
      else { this.fade = 0; if (done) done(); }
    };
    this.fade = requestAnimationFrame(step);
  }

  render() {
    const on = this.enabled;
    this.button.setAttribute('aria-pressed', String(on));
    this.button.textContent = on ? (this.unlocked ? '♪ Musik: an' : '♪ Musik: an (startet nach dem ersten Klick)') : '♪ Musik: aus';
  }
}

/** Mitwirkende: alle Bildnachweise. */
export function creditsHtml(c, esc) {
  const link = (url, text) => `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>`;
  const photo = (p) => `<li>${link(p.page, p.title.replace(/^File:/, ''))}<br><small>${esc(shortAuthor(p.artist))} · ${esc(p.date || '')} · ${esc(p.license)} · bearbeitet: ${esc(p.changes)}</small></li>`;
  const paper = (p) => `<li>${link(p.page, p.label)}<br><small>${esc(p.provider)} · ${esc(p.rights)}</small></li>`;
  const music = (m) => `<li>${link(m.page, m.label)}<br><small>${esc(m.artist)} · ${esc(m.license)} · ${esc(m.changes)}</small></li>`;
  return `<div class="credits">
    <h3>Spiel</h3><p>Durchbruch – privates Strategiespiel. Karten- und Datenquellen siehe LICENSES.md, historische Werte siehe SOURCES.md.</p>
    <h3>Fotos</h3><ul>${c.photos.map(photo).join('')}</ul>
    <h3>Zeitungen</h3><ul>${c.papers.map(paper).join('')}</ul>
    <h3>Musik</h3><ul>${c.music.map(music).join('')}</ul>
    <p class="muted">Bundesarchiv-Fotos: CC BY-SA 3.0 DE (creativecommons.org/licenses/by-sa/3.0/de/); bearbeitete Fassungen unter derselben Lizenz. Fotos der US-Regierung und Aufnahmen der US-Militärkapellen: gemeinfrei. Vollständige Liste: MEDIA_SOURCES.md.</p>
  </div>`;
}

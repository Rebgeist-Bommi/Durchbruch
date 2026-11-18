// Überarbeitung der Oberfläche: Hinweise in der Kopfleiste, nationales Ziel, Ereignis-Banner,
// Länderfenster an der Karte, Diplomatie-Reiter, Zielbaum, Tutorial.
import { flagUrl } from './flags.js';
import {
  declareWar, offer, offerAnschluss, offerRohstoffe, actionsFor, relation, statusOf, STATUS_LABEL,
  anschlussScore, offerScore, isAllied, hasPact,
} from '../sim/diplomacy.js';
import { goalList, goalState, goalTier, startGoal, goalProgress } from '../sim/goals.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ Aktionen gegenüber einer Nation
/** Gemeinsame Aktionsleiste (Länderfenster und Diplomatie-Reiter). */
export class NationActions {
  constructor({ sim, onChange }) {
    this.sim = sim;
    this.onChange = onChange;
    this.confirm = 0;
    this.msg = '';
  }

  prospect(n, kind) {
    const sim = this.sim;
    const D = sim.bal.diplomacy;
    if (kind === 'anschluss') return anschlussScore(sim, n) >= D.anschluss.need ? 'gut' : 'gering';
    const s = offerScore(sim, sim.player, n, kind);
    const need = kind === 'buendnis' ? D.acceptAlliance : D.acceptPact;
    return s >= need ? 'gut' : s >= need - 25 ? 'unsicher' : 'gering';
  }

  html(n, cls = 'p-acts') {
    const sim = this.sim;
    const a = actionsFor(sim, n);
    const front = [...sim.fronts.values()].find((f) => f.alive && f.side[sim.player] && sim.enemyOn(f, sim.player) === n);
    const pend = this.confirm === n;
    const b = (act, label, ok, title = '', extra = '') => `<button type="button" data-act="${act}" data-n="${n}" class="${extra}" ${ok ? '' : 'disabled'} title="${esc(title)}">${esc(label)}</button>`;
    const breach = isAllied(sim, sim.player, n) || hasPact(sim, sim.player, n);
    return `<div class="${cls}">
      ${front ? b('front', 'Front öffnen', true, 'Frontfenster mit Befehlen', 'main') : ''}
      ${b('war', pend ? 'Wirklich? Bestätigen' : 'Krieg erklären', a.war, breach ? 'Achtung: Vertragsbruch' : 'Kriegserklärung (zweiter Klick bestätigt)', `war${pend ? ' confirm' : ''}`)}
      ${b('anschluss', 'Anschluss anbieten', a.anschluss, `Aussicht: ${a.anschluss ? this.prospect(n, 'anschluss') : '–'} · erhöht die Spannung mit den Westmächten`)}
      ${b('rohstoffe', 'Rohstoffabkommen', a.rohstoffe, `Geld gegen Rohstoffe (${sim.bal.diplomacy.rohstoffe.cost})`)}
      ${b('pact', 'Pakt anbieten', a.pact, `Nichtangriffspakt · Aussicht: ${a.pact ? this.prospect(n, 'pakt') : '–'}`)}
      ${b('alliance', 'Bündnis anbieten', a.alliance, `Beistandspakt · Aussicht: ${a.alliance ? this.prospect(n, 'buendnis') : '–'}`)}
    </div><p class="${cls === 'p-acts' ? 'p-msg' : 'dl-msg'}" role="status">${esc(this.msg)}</p>`;
  }

  /** Klick auswerten; gibt true zurück, wenn etwas geschah. */
  handle(e, openFront) {
    const btn = e.target.closest('[data-act]');
    if (!btn || btn.disabled) return false;
    const sim = this.sim;
    const n = Number(btn.dataset.n);
    const act = btn.dataset.act;
    if (act === 'front') { openFront(n); return true; }
    if (act === 'war') {
      if (this.confirm !== n) { this.confirm = n; this.msg = ''; return true; }
      this.confirm = 0;
      this.msg = declareWar(sim, sim.player, n) ? `Krieg mit ${sim.nameDat(n)}. Truppen marschieren auf.` : 'Nicht möglich.';
    } else {
      this.confirm = 0;
      const r = act === 'anschluss' ? offerAnschluss(sim, n) : act === 'rohstoffe' ? offerRohstoffe(sim, n) : offer(sim, n, act === 'alliance' ? 'buendnis' : 'pakt');
      this.msg = r.text;
    }
    this.onChange();
    return true;
  }
}

function nationSummary(sim, n) {
  const p = sim.player;
  const st = sim.ownedCount[n] ? statusOf(sim, p, n) : 'weg';
  const rel = Math.round(relation(sim, p, n));
  const divs = sim.divisions.filter((d) => d.nation === n).length;
  const est = divs ? `ca. ${Math.max(1, Math.round(divs / 5) * 5)} Divisionen` : 'keine Armee';
  return { st, label: st === 'weg' ? 'existiert nicht mehr' : STATUS_LABEL[st], rel, est };
}

// ------------------------------------------------------------------ Länderfenster an der Karte
export class Popover {
  constructor({ sim, onChange, openFront }) {
    this.sim = sim;
    this.n = 0;
    this.actions = new NationActions({ sim, onChange: () => { onChange(); this.render(); } });
    $('popover').addEventListener('click', (e) => {
      if (e.target.closest('.p-close')) { this.hide(); return; }
      if (this.actions.handle(e, (n) => { this.hide(); openFront(n); })) this.render();
    });
  }

  get open() { return !$('popover').hidden; }

  show(n, x, y) {
    if (!n || n === this.sim.player) { this.hide(); return; }
    this.n = n;
    this.actions.confirm = 0;
    this.actions.msg = '';
    this.render();
    const el = $('popover');
    el.hidden = false;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, x + 14))}px`;
    el.style.top = `${Math.max(56, Math.min(window.innerHeight - h - 8, y - 20))}px`;
  }

  hide() { $('popover').hidden = true; this.n = 0; }

  render() {
    if (!this.n) return;
    const sim = this.sim;
    const n = this.n;
    const s = nationSummary(sim, n);
    $('popover').innerHTML = `<div class="p-head"><img src="${flagUrl(sim.code(n))}" alt=""><b>${esc(sim.nationName(n))}</b><button type="button" class="p-close" aria-label="Schließen">×</button></div>
      <p class="p-line">${esc(s.label)} · Beziehung ${s.rel > 0 ? '+' : ''}${s.rel} · ${esc(s.est)}</p>
      ${this.actions.html(n)}`;
  }
}

// ------------------------------------------------------------------ Diplomatie-Reiter
export class DiplomacyTab {
  constructor({ sim, onChange, openFront }) {
    this.sim = sim;
    this.n = 0;
    this.actions = new NationActions({ sim, onChange: () => { onChange(); this.render(); } });
    $('diplopanel').addEventListener('click', (e) => {
      const li = e.target.closest('[data-pick]');
      if (li) { this.select(Number(li.dataset.pick)); return; }
      if (this.actions.handle(e, openFront)) this.render();
    });
  }

  select(n) {
    if (n === this.sim.player) n = 0;
    this.n = n;
    this.actions.confirm = 0;
    this.actions.msg = '';
    this.render();
  }

  nations() {
    const sim = this.sim;
    const out = [];
    for (let n = 1; n <= sim.codes.length; n++) {
      if (n === sim.player || !sim.ownedCount[n] || sim.ownedCount[n] < 3) continue;
      out.push(n);
    }
    const order = { krieg: 0, buendnis: 1, pakt: 2, neutral: 3 };
    return out.sort((a, b) => order[statusOf(sim, sim.player, a)] - order[statusOf(sim, sim.player, b)] || sim.ownedCount[b] - sim.ownedCount[a]);
  }

  render() {
    const sim = this.sim;
    const p = sim.player;
    const n = this.n;
    const card = n ? (() => {
      const s = nationSummary(sim, n);
      return `<div class="dl-card"><div class="p-head"><img src="${flagUrl(sim.code(n))}" alt=""><b>${esc(sim.nationName(n))}</b></div>
        <p class="p-line">${esc(s.label)} · Beziehung ${s.rel > 0 ? '+' : ''}${s.rel} · ${esc(s.est)}</p>${this.actions.html(n, 'dl-acts')}</div>`;
    })() : '<p class="hint">Land auf der Karte oder in der Liste anklicken.</p>';
    const rows = this.nations().map((x) => {
      const st = statusOf(sim, p, x);
      const r = Math.round(relation(sim, p, x));
      return `<li data-pick="${x}" class="${x === n ? 'sel' : ''}"><img src="${flagUrl(sim.code(x))}" alt=""><span>${esc(sim.nationName(x))}</span><span class="dst ${st}">${STATUS_LABEL[st]}</span><span class="rv">${r > 0 ? '+' : ''}${r}</span></li>`;
    }).join('');
    $('diplopanel').innerHTML = `<h2>Diplomatie</h2>${card}
      <div class="dl-legend"><span><i style="background:#6f9a4a"></i>Bündnis</span><span><i style="background:#a4a35a"></i>Pakt</span><span><i style="background:#b0402c"></i>Krieg</span><span><i style="background:#9fae7c"></i>freundlich</span><span><i style="background:#a4786a"></i>feindselig</span></div>
      <ul class="dl-list">${rows}</ul>`;
  }
}

// ------------------------------------------------------------------ Ereignis-Banner
const BANNER_TYPES = { war: 'Krieg', capitulation: 'Kapitulation', peace: 'Frieden', treaty: 'Diplomatie', annex: 'Gebiet', event: 'Sondermeldung', goal: 'Nationales Ziel', warn: 'Warnung', end: 'Kriegsende' };

export class Banner {
  constructor({ sim, onClick }) {
    this.sim = sim;
    this.seen = sim.events.length;
    this.queue = [];
    this.timer = 0;
    $('banner').addEventListener('click', () => { this.next(); if (onClick) onClick(); });
  }

  /** neue Meldungen der wichtigen Arten einreihen */
  collect() {
    const ev = this.sim.events;
    for (let k = this.seen; k < ev.length; k++) {
      const e = ev[k];
      if (!BANNER_TYPES[e.type]) continue;
      if (e.type === 'treaty' && /lehnt/.test(e.text)) continue;
      this.queue.push(e);
    }
    this.seen = ev.length;
    // nur Aktuelles zeigen: Meldungen älter als 3 Spieltage verfallen, höchstens 4 in der Warteschlange
    const day = this.sim.day;
    this.queue = this.queue.filter((e) => day - e.day <= 3).slice(-4);
    if (!this.timer || (this.current && day - this.current.day > 3)) this.next();
  }

  next() {
    clearTimeout(this.timer);
    const el = $('banner');
    const e = this.queue.shift();
    this.current = e || null;
    if (!e) { el.classList.remove('show'); this.timer = 0; setTimeout(() => { if (!el.classList.contains('show')) el.hidden = true; }, 450); return; }
    const sim = this.sim;
    const code = flagFor(sim, e.text);
    el.hidden = false;
    el.className = `k-${e.type}`;
    el.innerHTML = `${code ? `<img src="${flagUrl(code)}" alt="">` : ''}<div><div class="b-kind">${esc(BANNER_TYPES[e.type])} · ${esc(e.date)}</div><div class="b-text">${esc(e.text)}</div></div>`;
    void el.offsetWidth;
    el.classList.add('show');
    this.timer = setTimeout(() => this.next(), e.type === 'war' || e.type === 'capitulation' ? 6000 : 4200);
  }
}

/** Flagge der ersten im Text genannten Nation (für das Banner). */
function flagFor(sim, text) {
  let best = null;
  let pos = Infinity;
  for (let n = 1; n <= sim.codes.length; n++) {
    for (const nm of [sim.nationName(n), sim.nameNom(n), sim.nameDat(n)]) {
      const k = text.indexOf(nm);
      if (k >= 0 && k < pos) { pos = k; best = sim.code(n); }
    }
  }
  return best;
}

// ------------------------------------------------------------------ Hinweise und Ziel in der Kopfleiste
export function renderAlerts(sim, handlers) {
  const p = sim.player;
  const items = [];
  const empty = [...sim.fronts.values()].filter((f) => f.alive && f.side[p] && !sim.divisionsOn(f.id, p).length && !sim.inTransitTo(f.id, p).length);
  if (empty.length) items.push({ k: 'front', ico: '⚔', n: empty.length, t: `${empty.length} Front(en) ohne eigene Truppen – klicken zum Öffnen` });
  if (sim.pending) items.push({ k: 'decision', ico: '!', t: 'Entscheidung offen' });
  const e = sim.econ.get(p);
  if (e && e.equipment < 200) items.push({ k: 'equip', ico: '⚙', t: 'Ausrüstung knapp – Rüstungsfabriken bauen' });
  if (e && e.money < 0) items.push({ k: 'money', ico: 'ℳ', t: 'Schulden – Einnahmen erhöhen' });
  const m = sim.nations.get(p)?.morale ?? 60;
  if (m < 40) items.push({ k: 'morale', ico: '✦', t: 'Moral niedrig – Propaganda einsetzen' });
  const el = $('alerts');
  const html = items.map((x) => `<button type="button" data-alert="${x.k}" title="${esc(x.t)}">${x.ico}${x.n > 1 ? `<b>${x.n}</b>` : ''}</button>`).join('');
  if (el.innerHTML !== html) el.innerHTML = html;
  el.onclick = (ev) => {
    const b = ev.target.closest('[data-alert]');
    if (b && handlers[b.dataset.alert]) handlers[b.dataset.alert](empty);
  };
  // Ziel
  const chip = $('goal-chip');
  const c = sim.goals.current;
  if (c) {
    const g = goalList(sim).find((x) => x.id === c.id);
    const left = Math.max(0, g.days - (sim.day - c.start));
    chip.querySelector('.g-text').textContent = `${g.label} · ${left} T.`;
    chip.querySelector('.g-bar b').style.width = `${Math.round(goalProgress(sim) * 100)}%`;
    chip.classList.remove('idle');
  } else {
    const any = goalList(sim).some((g) => goalState(sim, g.id) === 'frei');
    chip.querySelector('.g-text').textContent = any ? 'Ziel wählen' : 'alle Ziele erreicht';
    chip.querySelector('.g-bar b').style.width = '0';
    chip.classList.toggle('idle', any);
  }
}

// ------------------------------------------------------------------ Zielbaum
export class GoalsUI {
  constructor({ sim, onChange }) {
    this.sim = sim;
    $('goals').addEventListener('click', (e) => {
      if (e.target.id === 'goals' || e.target.closest('[data-close]')) { this.close(); return; }
      const c = e.target.closest('[data-goal]');
      if (c && startGoal(this.sim, c.dataset.goal)) { onChange(); this.render(); }
    });
  }

  get open() { return !$('goals').hidden; }
  show() { this.render(); $('goals').hidden = false; }
  close() { $('goals').hidden = true; }

  render() {
    const sim = this.sim;
    const cols = [];
    for (const g of goalList(sim)) {
      const t = goalTier(sim, g.id);
      (cols[t] || (cols[t] = [])).push(g);
    }
    const names = ['Grundlagen', 'Ausbau', 'Vorbereitung', 'Entscheidung'];
    const card = (g) => {
      const st = goalState(sim, g.id);
      const req = (g.requires || []).map((r) => goalList(sim).find((x) => x.id === r).label).join(', ');
      const status = st === 'fertig' ? '✓ erreicht' : st === 'laeuft' ? `läuft · noch ${Math.max(0, g.days - (sim.day - sim.goals.current.start))} Tage` : st === 'gesperrt' ? `braucht: ${req}` : `${g.days} Tage`;
      return `<button type="button" class="gl-card ${st}" ${st === 'frei' && !sim.goals.current ? `data-goal="${g.id}"` : 'disabled'}><b>${esc(g.label)}</b><span>${esc(g.text)}</span><small>${esc(status)}</small></button>`;
    };
    $('goals-body').innerHTML = `<p class="gl-intro">Wähle ein Ziel. Nach Ablauf der Dauer wirkt es dauerhaft. Es läuft immer nur ein Ziel gleichzeitig.${sim.goals.current ? '' : ' <b>Gerade läuft keins.</b>'}</p>
      <div class="gl-tree">${cols.map((list, k) => `<div class="gl-col"><h4>${names[k] || `Stufe ${k + 1}`}</h4>${list.map(card).join('')}</div>`).join('')}</div>`;
  }
}

// ------------------------------------------------------------------ Tutorial
const STEPS = [
  { sel: null, title: 'Willkommen', text: 'Es ist der 1. März 1939, du führst das Deutsche Reich. Dieses Tutorial zeigt in wenigen Schritten das Wichtigste. Du kannst es jederzeit beenden.' },
  { sel: '#kpis', title: 'Deine Mittel', text: 'Oben links stehen Geld, Rohstoffe, Arbeitskräfte und Moral. Die kleine Zahl dahinter zeigt die Veränderung je Tag.' },
  { sel: '#time', title: 'Zeit', text: 'Hier läuft die Zeit. Mit der Leertaste hältst du an oder setzt fort. 1×, 2× und 4× bestimmen das Tempo. Im Frieden lohnt sich 4×.' },
  { sel: '#goal-chip', title: 'Nationale Ziele', text: 'Wähle hier ein Ziel, zum Beispiel „Wiederaufrüstung“. Nach einigen Wochen gibt es einen dauerhaften Vorteil. Wähle immer ein neues, sobald eines fertig ist.' },
  { sel: '#map', title: 'Die Karte', text: 'Klicke auf ein Land, um zu sehen, was du damit tun kannst: Krieg erklären, einen Anschluss anbieten, ein Rohstoffabkommen schließen oder einen Pakt.' },
  { sel: '#modes', title: 'Ansichten', text: 'Mit 1–4 wechselst du die Ansicht: Front (Krieg), Wirtschaft (Bauen, Forschung), Geheimdienst (Agenten) und Diplomatie (Beziehungen auf einen Blick).' },
  { sel: '#panel', title: 'Krieg führen', text: 'Im Krieg stehen links deine Fronten. Klicke eine Front an: „Angriff vorbereiten“ baut einen Bonus auf, „Angriff auslösen“ greift an. Truppen ohne Nachschub kämpfen schlechter.' },
  { sel: '#alerts', title: 'Hinweise', text: 'Rote Symbole oben weisen auf Probleme hin, zum Beispiel eine Front ohne Truppen. Ein Klick führt direkt dorthin.' },
  { sel: null, title: 'Los geht’s', text: 'Historisch beginnt der Krieg am 1. September 1939. Wann und gegen wen du Krieg führst, entscheidest du. Viel Erfolg!' },
];

export class Tutorial {
  constructor({ onEnd }) {
    this.k = 0;
    this.onEnd = onEnd;
    $('tutorial').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tut]');
      if (!b) return;
      if (b.dataset.tut === 'next') this.go(this.k + 1);
      else if (b.dataset.tut === 'back') this.go(this.k - 1);
      else this.end();
    });
    window.addEventListener('resize', () => { if (this.open) this.go(this.k); });
  }

  get open() { return !$('tutorial').hidden; }
  start() { $('tutorial').hidden = false; this.go(0); }
  end() { $('tutorial').hidden = true; try { localStorage.setItem('durchbruch-tutorial', 'done'); } catch { /* ohne Speicher */ } if (this.onEnd) this.onEnd(); }

  go(k) {
    if (k >= STEPS.length) { this.end(); return; }
    this.k = Math.max(0, k);
    const s = STEPS[this.k];
    const ring = $('tutorial').querySelector('.tut-ring');
    const box = $('tutorial').querySelector('.tut-box');
    const el = s.sel && document.querySelector(s.sel);
    const r = el ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0, right: window.innerWidth / 2, bottom: window.innerHeight / 2 };
    const pad = el ? 6 : 0;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    box.innerHTML = `<h3>${esc(s.title)}</h3><p>${esc(s.text)}</p><div class="tut-nav"><button type="button" data-tut="end">Beenden</button><span>${this.k + 1} / ${STEPS.length}</span>
      <span>${this.k ? '<button type="button" data-tut="back">Zurück</button> ' : ''}<button type="button" class="next" data-tut="next">${this.k === STEPS.length - 1 ? 'Spielen' : 'Weiter'}</button></span></div>`;
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let x = el ? r.left : (window.innerWidth - bw) / 2;
    let y = el ? r.bottom + 14 : (window.innerHeight - bh) / 2;
    if (el && y + bh > window.innerHeight - 10) y = Math.max(10, r.top - bh - 14);
    if (el && r.height > window.innerHeight * 0.6) { x = r.right + 14 > window.innerWidth - bw ? r.left + 20 : r.right + 14; y = r.top + 20; }
    box.style.left = `${Math.max(10, Math.min(window.innerWidth - bw - 10, x))}px`;
    box.style.top = `${Math.max(10, Math.min(window.innerHeight - bh - 10, y))}px`;
  }
}

// Überarbeitung der Oberfläche: Hinweise in der Kopfleiste, nationales Ziel, Ereignis-Banner,
// Länderfenster an der Karte, Diplomatie-Reiter, Zielbaum, Tutorial.
import { flagUrl } from './flags.js';
import {
  declareWar, offer, offerAnschluss, offerRohstoffe, actionsFor, relation, statusOf, STATUS_LABEL,
  anschlussScore, offerScore, isAllied, hasPact, planDeployment, cancelPlan,
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
      ${front ? b('front', front.planned ? 'Grenzfront öffnen' : 'Front öffnen', true, 'Frontfenster: Truppen, Vorbereitung, General', 'main') : ''}
      ${a.plan ? b('plan', 'Aufmarsch an der Grenze', true, 'Grenzfront anlegen und die Reserve dorthin verlegen – ohne Krieg. Dort vorbereiten, später Krieg erklären.', 'plan') : ''}
      ${a.unplan ? b('unplan', 'Aufmarsch abbrechen', true, 'Truppen kehren in die Reserve zurück') : ''}
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
    if (act === 'plan') {
      this.confirm = 0;
      const ids = planDeployment(sim, sim.player, n);
      this.msg = ids.length ? `Aufmarsch befohlen: ${ids.length} Grenzfront${ids.length > 1 ? 'en' : ''}. Truppen sind unterwegs – im Frontfenster „Vorbereiten“ wählen.` : 'Keine gemeinsame Grenze.';
      this.onChange();
      if (ids.length) openFront(n);
      return true;
    }
    if (act === 'unplan') { this.confirm = 0; cancelPlan(sim, sim.player, n); this.msg = 'Aufmarsch abgebrochen.'; this.onChange(); return true; }
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
// Tutorial in Kapiteln (Überarbeitung 2): jeder Bereich wird erklärt. `mode` wechselt die Ansicht,
// `tab` den Reiter der Wirtschaftsleiste, `sel` hebt ein Element hervor.
const CHAPTERS = [
  { id: 'gefuehrt', label: 'Geführter Einstieg', text: 'Empfohlen: Schritt für Schritt selbst ausprobieren – vom Aufmarsch bis zum ersten Angriff' },
  { id: 'grund', label: 'Grundlagen', text: 'Mittel, Zeit, Ansichten, Speichern' },
  { id: 'aufmarsch', label: 'Aufmarsch und Angriff', text: 'Truppen an der Grenze sammeln, vorbereiten, Taktik, Haltelinie' },
  { id: 'krieg', label: 'Im Krieg', text: 'Nachschub, Kessel, Luftangriffe, Zweifrontenkrieg' },
  { id: 'wirtschaft', label: 'Wirtschaft', text: 'Mobilisierung, Rüstung, Bauen, Bahn' },
  { id: 'forschung', label: 'Forschung', text: 'Anstalten, Budget, Wissenschaftler' },
  { id: 'geheim', label: 'Geheimdienst', text: 'Agenten, Missionen, Nebel des Krieges' },
  { id: 'diplomatie', label: 'Diplomatie', text: 'Pakte, Bündnisse, Anschluss, Rohstoffe' },
  { id: 'ziele', label: 'Ziele, Moral, Zeitung', text: 'Nationale Ziele, Propaganda, Ereignisse' },
];

// Geführter Einstieg: `wait(c)` prüft, ob der Spieler die verlangte Aktion ausgeführt hat; dann geht
// es von selbst weiter. `c` = {sim, popover, ui, renderer, econ, goals, clock}.
const POL = (c) => c.sim.idx('POL');
const polFronts = (c) => [...c.sim.fronts.values()].filter((f) => f.alive && f.side[c.sim.player] && c.sim.enemyOn(f, c.sim.player) === POL(c));
const GUIDE = [
  { chap: 'gefuehrt', mode: 'front', sel: null, title: 'Willkommen, Herr Reichskanzler', text: 'Es ist der 1. März 1939. Ich führe dich jetzt durch deinen ersten Feldzug. Du machst jeden Schritt selbst – ich zeige dir, wo. Das Spiel ist angehalten.' },
  { chap: 'gefuehrt', sel: '#kpis', title: 'Deine Mittel', text: 'Hier oben stehen Geld, Rohstoffe, Arbeitskräfte und Moral. Behalte sie im Blick – daraus entstehen Ausrüstung und neue Divisionen.' },
  { chap: 'gefuehrt', sel: '#map', title: 'Schritt 1: Polen anklicken', text: 'Klicke auf der Karte auf Polen (östlich von Deutschland, rötlich). Es öffnet sich ein Fenster mit allem, was du mit dem Land tun kannst.', wait: (c) => c.popover.n === POL(c) || c.sim.plansAgainst(c.sim.player, POL(c)) },
  { chap: 'gefuehrt', sel: '#popover', title: 'Schritt 2: Aufmarsch befehlen', text: 'Das Länderfenster zeigt Beziehung, Armee und Aktionen. Klicke auf „Aufmarsch an der Grenze“: Es entsteht eine Grenzfront mit Stacheldraht, deine Reserve marschiert dorthin – noch ohne Krieg.', wait: (c) => c.sim.plansAgainst(c.sim.player, POL(c)) || c.sim.isWar(c.sim.player, POL(c)) },
  { chap: 'gefuehrt', sel: '#map', title: 'Deine Truppen auf der Karte', text: 'Auf dem Draht sitzt eine Marke: links deine Divisionen an dieser Front, rechts die des Gegners. Die Marken mit Pfeil sind Truppen auf dem Marsch – die Zahl dahinter sind die Resttage. An Berlin steht deine Reserve.' },
  { chap: 'gefuehrt', sel: '#frontwin', title: 'Das Frontfenster', text: 'Rechts siehst du die gewählte Front: Kräfte, General, Taktik, Angriffsziel und Befehl. Hier steuerst du den ganzen Feldzug.' },
  { chap: 'gefuehrt', sel: '#frontwin input[value="prepare"]', title: 'Schritt 3: Angriff vorbereiten', text: 'Wähle „Angriff vorbereiten“. In etwa 7 Tagen baut sich bis zu +60 % Angriffsbonus auf.', wait: (c) => polFronts(c).some((f) => f.side[c.sim.player].order !== 'hold') },
  { chap: 'gefuehrt', sel: '#tactic-select', title: 'Schritt 4: Taktik wählen', text: 'Wähle eine Taktik, zum Beispiel „Blitzkrieg“ (schnelle Panzerkeile) oder „Starke Luftunterstützung“. Der Text darunter erklärt Vor- und Nachteile. Du kannst auch „Weiter“ drücken und bei „Ausgewogen“ bleiben.', wait: (c) => polFronts(c).some((f) => (f.side[c.sim.player].tactic || 'standard') !== 'standard') },
  { chap: 'gefuehrt', sel: '#lage', title: 'Mehrere Fronten', text: 'Gegen Polen gibt es zwei Grenzfronten: Westpolen und Ostpreußen. Links in der Lage wählst du sie aus. Bereite am besten beide vor.' },
  { chap: 'gefuehrt', sel: '#time', title: 'Schritt 5: Zeit laufen lassen', text: 'Starte die Zeit mit der Leertaste oder einem Klick auf 2×. Beobachte, wie die Marschmarken zur Grenze wandern und der Angriffsbonus wächst.', wait: (c) => c.clock.speed > 0 },
  { chap: 'gefuehrt', sel: '#frontwin', title: 'Warten auf den Aufmarsch', text: (c) => { const fs = polFronts(c); const t = c.sim.divisions.filter((d) => d.nation === c.sim.player && d.transit && fs.some((f) => f.id === d.transit.to)).length; const pr = Math.max(0, ...fs.map((f) => f.side[c.sim.player].prep)); return `Noch ${t} Divisionen unterwegs · Angriffsbonus +${Math.round(pr * 60)} %. Sobald alle angekommen sind und der Bonus über 40 % liegt, geht es weiter.`; }, wait: (c) => { const fs = polFronts(c); return !c.sim.divisions.some((d) => d.nation === c.sim.player && d.transit && fs.some((f) => f.id === d.transit.to)) && fs.some((f) => f.side[c.sim.player].prep >= 0.66); } },
  { chap: 'gefuehrt', sel: '#time', title: 'Kurz anhalten', text: 'Halte die Zeit an (Leertaste oder ❚❚). Vor großen Entscheidungen lohnt sich die Pause.', wait: (c) => c.clock.speed === 0 },
  { chap: 'gefuehrt', sel: '#frontwin', title: 'Angriffsziel (optional)', text: 'Unter „Angriffsziel“ kannst du „Bis zur Haltelinie“ wählen und eine Linie auf die Karte klicken – dann stoßen die Truppen nur bis dorthin vor. Für den Anfang reicht „Ganzes Land“.' },
  { chap: 'gefuehrt', sel: '[data-action="war-attack"]', title: 'Schritt 6: Krieg erklären', text: 'Klicke auf „Krieg erklären und angreifen“ und bestätige mit einem zweiten Klick. Alle vorbereiteten Grenzfronten greifen gleichzeitig an. Achtung: Großbritannien und Frankreich haben Polen ab 31. März ihren Schutz zugesagt.', wait: (c) => c.sim.isWar(c.sim.player, POL(c)) },
  { chap: 'gefuehrt', sel: '#time', title: 'Schritt 7: Der Angriff läuft', text: 'Lass die Zeit laufen. Eroberte Felder füllen sich, der Draht wandert nach vorn, die Lage links zeigt Durchbruch, Vormarsch oder festgefahren.', wait: (c) => c.clock.speed > 0 },
  { chap: 'gefuehrt', sel: '#map', title: 'Denk an den Westen', text: 'Erklären Frankreich und Großbritannien den Krieg, entsteht eine Westfront. Lass sie nie leer – sonst marschieren die Franzosen ein. Ein rot blinkender Rahmen an der Marke warnt dich. Mit Rechtsklick auf eine Front schickst du Truppen dorthin.' },
  { chap: 'gefuehrt', sel: '#modes', title: 'Schritt 8: Wirtschaft', text: 'Drücke Taste 2 oder klicke auf „Wirtschaft“.', wait: (c) => c.renderer.mode === 'economy' },
  { chap: 'gefuehrt', mode: 'economy', sel: '#econ', title: 'Die Wirtschaft', text: 'Hier stellst du Mobilisierung und Panzeranteil der Rüstung ein und baust Fabriken, Rüstungswerke und Forschungsanstalten. Ausrüstung füllt geschwächte Divisionen wieder auf.' },
  { chap: 'gefuehrt', mode: 'economy', sel: '#econ', title: 'Schritt 9: Forschung', text: 'Klicke oben in der Leiste auf den Reiter „Forschung“.', wait: (c) => c.econ.tab === 'forschung' },
  { chap: 'gefuehrt', mode: 'economy', sel: '#econ', title: 'Die Forschung', text: 'Jede Anstalt forscht in einem Schwerpunkt: Heer, Luftwaffe, Industrie oder Sonderwaffen. Mehr Budget heißt schneller. Wissenschaftler helfen, wenn eine passende Anstalt in ihrer Region steht.' },
  { chap: 'gefuehrt', mode: 'front', sel: '#goal-chip', title: 'Schritt 10: Nationales Ziel', text: 'Klicke oben auf „Ziel wählen“ und starte ein Ziel, zum Beispiel „Wiederaufrüstung“. Nach einigen Wochen gibt es einen dauerhaften Vorteil.', wait: (c) => !!c.sim.goals?.current || (c.sim.goals?.done || []).length > 0 },
  { chap: 'gefuehrt', sel: '#modes', title: 'Geheimdienst und Diplomatie', text: 'Taste 3 öffnet den Geheimdienst (Agenten, Sabotage, Aufklärung), Taste 4 die Diplomatie (Pakte, Bündnisse, Anschluss). Beim ersten Besuch biete ich dir dort eine kurze Erklärung an.' },
  { chap: 'gefuehrt', sel: null, title: 'Du bist bereit', text: 'Das Wichtigste kennst du jetzt. Mit H öffnest du jederzeit die Kapitel zu jedem Bereich. Viel Erfolg!' },
];

const STEPS = [
  // Grundlagen
  { chap: 'grund', mode: 'front', sel: null, title: 'Willkommen', text: 'Es ist der 1. März 1939, du führst das Deutsche Reich. Wann und gegen wen du Krieg führst, entscheidest du. Historisch beginnt er am 1. September 1939.' },
  { chap: 'grund', sel: '#kpis', title: 'Deine Mittel', text: 'Oben links: Geld, Rohstoffe, Arbeitskräfte und Moral. Die kleine Zahl zeigt die Veränderung je Tag. Geld bezahlt Bauten, Forschung und Propaganda, Rohstoffe und Arbeitskräfte werden zu Ausrüstung und Soldaten.' },
  { chap: 'grund', sel: '#time', title: 'Zeit', text: 'Leertaste hält an oder setzt fort, 1×, 2× und 4× bestimmen das Tempo. Ein Spieltag dauert bei 1× etwa 4,5 Sekunden. Befehle kannst du auch in der Pause geben.' },
  { chap: 'grund', sel: '#modes', title: 'Vier Ansichten', text: 'Taste 1 Front, 2 Wirtschaft (mit Reiter Forschung), 3 Geheimdienst, 4 Diplomatie. Jede Ansicht färbt die Karte passend und zeigt links ihre Leiste.' },
  { chap: 'grund', sel: '#alerts', title: 'Hinweise', text: 'Rote Symbole warnen vor Problemen: Front ohne Truppen, fehlende Ausrüstung, leere Kasse, sinkende Moral, offene Entscheidung. Ein Klick führt hin.' },
  { chap: 'grund', sel: '#messages', title: 'Meldungen', text: 'Unten laufen die Meldungen des Tages: Kriegserklärungen, eroberte Städte, Verträge. Große Ereignisse erscheinen zusätzlich als Banner oben.' },
  { chap: 'grund', sel: null, title: 'Speichern und Tasten', text: 'Esc öffnet das Menü mit Speichern, Laden und Einstellungen; alle 7 Tage wird automatisch gespeichert. Tasten: D Diplomatie, Z Ziele, T Zeitung, N Nachschub, G Gitter, +/− Zoom, H dieses Tutorial.' },
  // Aufmarsch und Angriff
  { chap: 'aufmarsch', mode: 'front', sel: '#map', title: 'Land anklicken', text: 'Klicke ein Nachbarland an, zum Beispiel Frankreich oder Polen. Das Länderfenster zeigt Beziehung, geschätzte Armee und alle Aktionen.' },
  { chap: 'aufmarsch', sel: '#map', title: 'Aufmarsch an der Grenze', text: '„Aufmarsch an der Grenze“ legt schon im Frieden eine Grenzfront mit Stacheldraht an. Die Reserve marschiert dorthin – das dauert je nach Entfernung und Bahnausbau einige Tage.' },
  { chap: 'aufmarsch', sel: '#map', title: 'Truppen auf der Karte', text: 'Jede Front trägt eine Marke: links deine Divisionen, rechts die geschätzten des Gegners. Ein rot blinkender Rahmen heißt: Gegner deutlich stärker oder Front leer. Wandernde Marken zeigen Verlegungen mit Resttagen, an der Hauptstadt steht die Reserve.' },
  { chap: 'aufmarsch', sel: '#panel', title: 'Verlegen', text: 'Im Frontfenster holst du Divisionen aus der Reserve (+1, +5) oder verlegst 1, 5, 10 oder alle zu einer anderen Front; die Dauer steht auf dem Knopf. Schneller: Front wählen und eine andere Front mit Rechtsklick anklicken.' },
  { chap: 'aufmarsch', sel: '#panel', title: 'Vorbereiten oder halten', text: '„Angriff vorbereiten“ baut in etwa 7 Tagen bis zu +60 % Angriffsbonus auf. „Halten und befestigen“ gräbt die Truppen ein: Stacheldraht wird dichter, ab hoher Befestigung mit Holzpfählen.' },
  { chap: 'aufmarsch', sel: '#panel', title: 'Taktik', text: 'Blitzkrieg: Panzerkeile stoßen tief vor, brauchen aber Panzer und Nachschub. Starke Luftunterstützung: mehr Durchschlag, weniger Verluste, kostet Geld. Zangenangriff: begünstigt Kessel. Materialschlacht: langsam, aber verlustarm.' },
  { chap: 'aufmarsch', sel: '#panel', title: 'Angriffsziel', text: '„Ganzes Land“: die Truppen rücken immer weiter vor. „Bis zur Haltelinie“: Linie mit Klicks auf die Karte zeichnen, Doppelklick oder Enter beendet. Ist die Linie erreicht, halten die Truppen und graben sich ein.' },
  { chap: 'aufmarsch', sel: '#panel', title: 'Krieg erklären und angreifen', text: 'An einer Grenzfront heißt der Knopf „Krieg erklären und angreifen“ (zweiter Klick bestätigt). Alle vorbereiteten Grenzfronten gegen dieses Land greifen gleichzeitig an. Achtung: Ab 31. März garantieren Großbritannien und Frankreich Polen.' },
  // Im Krieg
  { chap: 'krieg', mode: 'front', sel: '#panel', title: 'Lage', text: 'Links stehen alle Fronten mit eigenen und geschätzten gegnerischen Divisionen. Der Schein am Draht zeigt den Stand: grau halten, messing vorbereiten, rot Angriff, hell pulsierend Durchbruch.' },
  { chap: 'krieg', sel: '#supply-toggle', title: 'Nachschub', text: 'Taste N zeigt den Nachschub: rot heißt schwach. Er hängt an intakten Bahnknoten. Truppen weit vor der Bahn kämpfen schlechter – besonders mit Blitzkrieg. Eroberte Strecken müssen erst instand gesetzt werden.' },
  { chap: 'krieg', sel: '#map', title: 'Kessel und Belagerung', text: 'Gebiet ohne Verbindung zum Hauptland wird zum Kessel und ergibt sich nach einiger Zeit. Haupt- und Großstädte werden belagert, das bindet Truppen. Fällt die Hauptstadt und ist genug Land verloren, kapituliert das Land.' },
  { chap: 'krieg', sel: '#panel', title: 'Vorgehen und Luftangriffe', text: 'Im Frontfenster eingeklappt: „Minimaler Schaden“ erhält Land und Wirtschaft, „Totale Verwüstung“ ist schneller. Unter Luftangriffe stellst du einen Teil der Luftwaffe für Angriffe auf Bahnknoten, Brücken und Fabriken ab.' },
  { chap: 'krieg', sel: '#map', title: 'Zweifrontenkrieg', text: 'Wer Polen angreift, bekommt oft Frankreich und Großbritannien zum Gegner. Lass die Westgrenze nie leer: Befestige sie (Ziel „Westwall“) und halte dort genug Divisionen. Ein roter Rahmen an der Marke warnt dich.' },
  // Wirtschaft
  { chap: 'wirtschaft', mode: 'economy', tab: 'wirtschaft', sel: '#econ', title: 'Wirtschaftsleiste', text: 'Hier stehen Einnahmen, Rohstoffe, Ausrüstung und Arbeitskräfte. Die Karte zeigt Industrie, Rohstoffgebiete und den Bahnausbau je Region.' },
  { chap: 'wirtschaft', sel: '#econ', title: 'Mobilisierung', text: 'Höhere Mobilisierung bringt mehr Soldaten, nimmt der Industrie aber Arbeiter weg. Im Frieden zahlt sich eine starke Wirtschaft aus, kurz vor dem Krieg die Mobilmachung.' },
  { chap: 'wirtschaft', sel: '#econ', title: 'Rüstung und Divisionen', text: 'Rohstoffe und Fabriken werden zu Ausrüstung; der Panzeranteil bestimmt, wie viel davon Panzer sind. Ausrüstung füllt geschwächte Divisionen auf und stellt neue auf.' },
  { chap: 'wirtschaft', sel: '#map', title: 'Bauen', text: 'Fabrik, Rüstungswerk oder Forschungsanstalt wählen und einen Ort auf der Karte anklicken. Die Farbe zeigt die Standorteignung. Gute Bahn und nahe Rohstoffe erhöhen den Ertrag.' },
  { chap: 'wirtschaft', sel: '#map', title: 'Bahnausbau', text: 'Eine höhere Bahnstufe einer Region beschleunigt Verlegungen und verbessert den Nachschub. Gerade an künftigen Fronten lohnt sich der Ausbau.' },
  // Forschung
  { chap: 'forschung', mode: 'economy', tab: 'forschung', sel: '#econ', title: 'Forschungsanstalten', text: 'Jede Anstalt hat einen Schwerpunkt: Heer, Luftwaffe, Industrie oder Sonderwaffen. Ergebnisse wirken dauerhaft, etwa Panzerwirkung +15 % oder Nachschubreichweite +20 %.' },
  { chap: 'forschung', sel: '#econ', title: 'Budget', text: 'Das Budget je Anstalt bestimmt das Tempo. Jedes weitere Ergebnis kostet mehr als das vorige. Neue Anstalten baust du in der Wirtschaftsansicht.' },
  { chap: 'forschung', sel: '#econ', title: 'Wissenschaftler', text: 'Wissenschaftler geben einen Bonus, wenn in ihrer Region eine passende Anstalt steht – sonst versetzen. Geringe Loyalität kann zu Flucht oder Verrat führen; Wachen schützen. Die Atombombe braucht zusätzlich Uran.' },
  // Geheimdienst
  { chap: 'geheim', mode: 'intel', sel: '#intelui', title: 'Geheimdienst', text: 'Stufe und Agenten bestimmen deine Möglichkeiten. Ohne Aufklärung siehst du gegnerische Divisionen nur geschätzt (±25 %), Befestigung und Industrie gar nicht.' },
  { chap: 'geheim', sel: '#map', title: 'Missionen', text: 'Aufklären deckt eine Region oder ein Land auf. Sabotage trifft Bahnknoten und Fabriken, Entführen holt Wissenschaftler, Desinformation täuscht die KI über deine Stärke. Die Erfolgschance steht vor dem Start fest.' },
  { chap: 'geheim', sel: '#intelui', title: 'Enttarnung', text: 'Ein enttarnter Agent ist verloren und die Beziehung zum Land sinkt. Gegnerische Agenten wehrst du mit höherer Stufe und Geheimdienst-Wissenschaftlern ab.' },
  // Diplomatie
  { chap: 'diplomatie', mode: 'diplomacy', sel: '#map', title: 'Diplomatie-Karte', text: 'Die Karte zeigt deine Beziehungen: Bündnis, Pakt, Krieg, freundlich, neutral oder feindselig. Links stehen alle Länder, ein Klick wählt eines aus.' },
  { chap: 'diplomatie', sel: '#diplopanel', title: 'Pakte und Bündnisse', text: 'Ein Nichtangriffspakt verhindert Krieg mit diesem Land, ein Bündnis verpflichtet zum Beistand. Wer einen Vertrag bricht, verliert überall an Ansehen.' },
  { chap: 'diplomatie', sel: '#diplopanel', title: 'Anschluss und Rohstoffe', text: 'Kleine Länder kannst du zum Anschluss auffordern. Ob sie annehmen, hängt von deiner Überlegenheit, der Beziehung und ihren Schutzmächten ab. Ein Rohstoffabkommen tauscht Geld gegen Rohstoffe für 180 Tage.' },
  { chap: 'diplomatie', sel: '#diplopanel', title: 'Bündnispflichten', text: 'Greifst du ein Land an, erklären dessen Verbündete und Garantiemächte oft den Krieg. Frieden schließt ein Gegner, wenn er kapituliert oder lange keine Landfront mehr hat.' },
  // Ziele, Moral, Zeitung
  { chap: 'ziele', mode: 'front', sel: '#goal-chip', title: 'Nationale Ziele', text: 'Taste Z: 12 Ziele in drei Stufen, zum Beispiel Wiederaufrüstung, Westwall oder Fall Weiß (Fronten starten vorbereitet). Nach einigen Wochen gibt es einen dauerhaften Vorteil. Es läuft immer nur ein Ziel.' },
  { chap: 'ziele', sel: '#moral', title: 'Moral und Propaganda', text: 'Siege und eroberte Städte heben die Moral, Verluste und Kriegsmüdigkeit senken sie. Unter 50 sinken Kampfkraft und Produktion, unter 30 desertieren Soldaten. Propaganda kostet Geld und nutzt sich bei häufigem Einsatz ab.' },
  { chap: 'ziele', sel: null, title: 'Ereignisse und Zeitung', text: 'Historische Ereignisse verlangen manchmal eine Entscheidung; das Spiel hält dann an. Taste T öffnet die Zeitung „Der Tagesanzeiger“ mit den Schlagzeilen der Woche.' },
  { chap: 'ziele', sel: null, title: 'Los geht’s', text: 'Das war alles. Mit H öffnest du das Tutorial jederzeit wieder, auch einzelne Kapitel. Viel Erfolg!' },
];

export class Tutorial {
  constructor({ onEnd, setMode, econTab, ctx }) {
    this.k = 0;
    this.onEnd = onEnd;
    this.ctx = ctx;
    this.timer = 0;
    this.setMode = setMode;
    this.econTab = econTab;
    this.steps = STEPS;
    $('tutorial').addEventListener('click', (e) => {
      const c = e.target.closest('[data-chap]');
      if (c) { this.startChapter(c.dataset.chap); return; }
      const o = e.target.closest('[data-offer]');
      if (o) { const id = o.dataset.offer; this.hideOffer(); if (id !== 'nein') this.startChapter(id); return; }
      const b = e.target.closest('[data-tut]');
      if (!b) return;
      if (b.dataset.tut === 'next') this.go(this.k + 1);
      else if (b.dataset.tut === 'back') this.go(this.k - 1);
      else if (b.dataset.tut === 'menu') this.overview();
      else this.end();
    });
    window.addEventListener('resize', () => { if (this.open && this.k >= 0) this.go(this.k); });
  }

  get open() { return !$('tutorial').hidden; }

  /** Start: Kapitelübersicht (alles am Stück oder einzelne Kapitel). */
  start() { $('tutorial').hidden = false; this.overview(); }

  /** Geführter Einstieg beim ersten Spiel. */
  startGuided() { this.startChapter('gefuehrt'); }

  /** Läuft gerade ein Schritt, der auf eine Aktion des Spielers wartet? Dann sind Tasten frei. */
  get interactive() { return this.open && this.k >= 0 && !!this.steps[this.k]?.wait; }

  /** Erster Besuch einer Ansicht: kurze Erklärung anbieten (einmal je Bereich). */
  offer(chap) {
    if (this.open) return;
    const key = `durchbruch-seen-${chap}`;
    try { if (localStorage.getItem(key)) return; localStorage.setItem(key, '1'); } catch { return; }
    const c = CHAPTERS.find((x) => x.id === chap);
    if (!c) return;
    let el = document.getElementById('tut-offer');
    if (!el) { el = document.createElement('div'); el.id = 'tut-offer'; $('tutorial').after(el); el.addEventListener('click', (e) => { const o = e.target.closest('[data-offer]'); if (!o) return; this.hideOffer(); if (o.dataset.offer !== 'nein') this.startChapter(o.dataset.offer); }); }
    el.innerHTML = `<b>Neu hier: ${esc(c.label)}</b><span>${esc(c.text)}</span><div><button type="button" data-offer="${c.id}" class="next">Kurz erklären</button><button type="button" data-offer="nein">Nein danke</button></div>`;
    el.hidden = false;
    clearTimeout(this.offerTimer);
    this.offerTimer = setTimeout(() => this.hideOffer(), 15000);
  }

  hideOffer() { const el = document.getElementById('tut-offer'); if (el) el.hidden = true; }

  startChapter(id) {
    this.steps = id === 'alle' ? STEPS : id === 'gefuehrt' ? GUIDE : STEPS.filter((s) => s.chap === id);
    $('tutorial').hidden = false;
    this.go(0);
  }

  overview() {
    this.k = -1;
    const ring = $('tutorial').querySelector('.tut-ring');
    Object.assign(ring.style, { left: '50%', top: '50%', width: '0px', height: '0px' });
    const box = $('tutorial').querySelector('.tut-box');
    box.classList.add('tut-wide');
    box.innerHTML = `<h3>Tutorial</h3><p>Wähle ein Kapitel oder geh alles der Reihe nach durch (${STEPS.length} kurze Schritte).</p>
      <div class="tut-chaps">${CHAPTERS.map((c) => `<button type="button" data-chap="${c.id}"><b>${esc(c.label)}</b><small>${esc(c.text)}</small></button>`).join('')}</div>
      <div class="tut-nav"><button type="button" data-tut="end">Schließen</button><span></span><button type="button" class="next" data-chap="alle">Alles der Reihe nach</button></div>`;
    box.style.left = `${Math.max(10, (window.innerWidth - box.offsetWidth) / 2)}px`;
    box.style.top = `${Math.max(10, (window.innerHeight - box.offsetHeight) / 2)}px`;
  }

  end() { clearInterval(this.timer); this.timer = 0; $('tutorial').hidden = true; try { localStorage.setItem('durchbruch-tutorial', 'done'); } catch { /* ohne Speicher */ } if (this.onEnd) this.onEnd(); }

  go(k) {
    const steps = this.steps;
    if (k >= steps.length) { this.end(); return; }
    this.k = Math.max(0, k);
    const s = steps[this.k];
    // Ansicht des Kapitels herstellen (auch beim Einstieg mitten im Kapitel)
    const mode = s.mode || [...steps.slice(0, this.k + 1)].reverse().find((x) => x.mode)?.mode;
    const tab = s.tab || [...steps.slice(0, this.k + 1)].reverse().find((x) => x.tab)?.tab;
    if (mode && this.setMode) this.setMode(mode);
    if (tab && this.econTab) this.econTab(tab);
    const ring = $('tutorial').querySelector('.tut-ring');
    const box = $('tutorial').querySelector('.tut-box');
    box.classList.remove('tut-wide');
    const el = s.sel && document.querySelector(s.sel);
    const vis = el && el.offsetParent !== null;
    const r = vis ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0, right: window.innerWidth / 2, bottom: window.innerHeight / 2 };
    const pad = vis ? 6 : 0;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const chap = CHAPTERS.find((c) => c.id === s.chap);
    const c = this.ctx ? this.ctx() : null;
    const text = typeof s.text === 'function' ? (c ? s.text(c) : '') : s.text;
    const waiting = !!s.wait;
    box.classList.toggle('tut-wait', waiting);
    $('tutorial').classList.toggle('tut-free', waiting);
    box.innerHTML = `<small class="tut-chap">${esc(chap?.label || '')}</small><h3>${esc(s.title)}</h3><p class="tut-text">${esc(text)}</p>${waiting ? '<p class="tut-todo">▸ Du bist dran – ich warte, bis du es gemacht hast.</p>' : ''}<div class="tut-nav"><span><button type="button" data-tut="end">Beenden</button> <button type="button" data-tut="menu">Kapitel</button></span><span>${this.k + 1} / ${steps.length}</span>
      <span>${this.k ? '<button type="button" data-tut="back">Zurück</button> ' : ''}<button type="button" class="${waiting ? '' : 'next'}" data-tut="next">${waiting ? 'Überspringen' : this.k === steps.length - 1 ? 'Fertig' : 'Weiter'}</button></span></div>`;
    // Aktion abwarten: alle 250 ms prüfen, Hervorhebung nachführen, dynamischen Text erneuern
    clearInterval(this.timer);
    this.timer = 0;
    if (waiting && c) {
      const k0 = this.k;
      this.timer = setInterval(() => {
        if (!this.open || this.k !== k0) { clearInterval(this.timer); return; }
        const cc = this.ctx();
        if (s.wait(cc)) { this.go(this.k + 1); return; }
        if (typeof s.text === 'function') { const p = box.querySelector('.tut-text'); if (p) p.textContent = s.text(cc); }
        this.place(s, ring, box);
      }, 250);
    }
    this.place(s, ring, box);
  }

  /** Ring um das hervorgehobene Element, Kasten daneben (folgt dem Element, wenn es erscheint). */
  place(s, ring, box) {
    const el = s.sel && document.querySelector(s.sel);
    const vis = el && el.offsetParent !== null;
    const r = vis ? el.getBoundingClientRect() : { left: window.innerWidth / 2, top: window.innerHeight / 2, width: 0, height: 0, right: window.innerWidth / 2, bottom: window.innerHeight / 2 };
    const pad = vis ? 6 : 0;
    Object.assign(ring.style, { left: `${r.left - pad}px`, top: `${r.top - pad}px`, width: `${r.width + 2 * pad}px`, height: `${r.height + 2 * pad}px` });
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let x = vis ? r.left : (window.innerWidth - bw) / 2;
    let y = vis ? r.bottom + 14 : (window.innerHeight - bh) / 2;
    if (vis && y + bh > window.innerHeight - 10) y = Math.max(10, r.top - bh - 14);
    if (vis && r.height > window.innerHeight * 0.6) { x = r.right + 14 > window.innerWidth - bw ? r.left + 20 : r.right + 14; y = r.top + 20; }
    if (vis && r.width > window.innerWidth * 0.6 && r.height > window.innerHeight * 0.6) { x = (window.innerWidth - bw) / 2; y = window.innerHeight - bh - 70; }
    box.style.left = `${Math.max(10, Math.min(window.innerWidth - bw - 10, x))}px`;
    box.style.top = `${Math.max(10, Math.min(window.innerHeight - bh - 10, y))}px`;
  }
}

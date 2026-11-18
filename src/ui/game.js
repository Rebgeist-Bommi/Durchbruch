// Spieloberfläche Phase 2: Lage, Frontfenster, Kampfanzeige, Meldungsleiste, Abschlussdialog.
import { flagUrl } from './flags.js';
import { fmtInt } from '../sim/calendar.js';
import { freeGenerals, assignGeneral } from '../sim/generals.js';
import { strikeTargets, strikePower } from '../sim/airstrike.js';
import { describeTarget } from '../sim/intel.js';
import { renderMorale } from './phase5.js';
import { declareWar as declareWarFn } from '../sim/diplomacy.js';
import { tacticOf } from '../sim/combat.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)} %`;
const ORDER_LABEL = { hold: 'Halten und befestigen', prepare: 'Angriff vorbereiten', attack: 'Angriff läuft' };
const STATUS_CLASS = { Durchbruch: 'st-break', Vormarsch: 'st-adv', festgefahren: 'st-stuck' };

export class GameUI {
  constructor({ sim, renderer, panel, onCenter }) {
    this.sim = sim;
    this.renderer = renderer;
    this.panel = panel;
    this.onCenter = onCenter;
    this.frontId = 0;
    this.shownEvents = 0;
    this.messages = [];
    this.gameOverShown = false;
    this.transferTarget = 0;
    $('frontwin').addEventListener('click', (e) => this.onFrontAction(e));
    this.openDetails = new Set();
    $('frontwin').addEventListener('toggle', (e) => {
      const d = e.target.closest?.('details[data-d]');
      if (d) { if (d.open) this.openDetails.add(d.dataset.d); else this.openDetails.delete(d.dataset.d); }
    }, true);
    $('frontwin').addEventListener('change', (e) => {
      if (e.target.id === 'tf-target') { this.transferTarget = Number(e.target.value); this.refresh(); }
      if (e.target.id === 'tf-count') { this.transferCount = e.target.value; this.refresh(); }
      if (e.target.id === 'tactic-select') this.cmd(() => this.sim.setTactic(this.frontId, e.target.value));
      if (e.target.id === 'gen-select') this.cmd(() => assignGeneral(this.sim, this.frontId, this.sim.player, e.target.value || null));
      if (e.target.id === 'strike-target') this.cmd(() => {
        const [kind, id] = e.target.value.split(':');
        const side = this.sim.fronts.get(this.frontId).side[this.sim.player];
        side.strikeTarget = kind ? { kind, id: Number(id) } : null;
      });
      if (e.target.name === 'objective') {
        if (e.target.value === 'all') this.cmd(() => this.sim.setObjective(this.frontId, null));
        else if (!this.sim.fronts.get(this.frontId)?.side[this.sim.player].objective && this.onDrawLine) this.onDrawLine(this.frontId);
      }
      if (e.target.name === 'method') this.cmd(() => this.sim.setMethod(this.frontId, e.target.value));
      if (e.target.name === 'order') this.cmd(() => this.sim.setOrder(this.frontId, e.target.value));
    });
    $('lage').addEventListener('click', (e) => {
      const li = e.target.closest('[data-front]');
      if (li) this.selectFront(Number(li.dataset.front), true);
    });
    $('all-attack').addEventListener('click', () => this.cmd(() => {
      for (const f of this.playerFronts()) this.sim.attack(f.id);
    }));
    $('messages').addEventListener('click', (e) => {
      const m = e.target.closest('[data-cell]');
      if (m && Number(m.dataset.cell) >= 0) this.onCenter(Number(m.dataset.cell));
    });
    $('go-close').addEventListener('click', () => { $('gameover').hidden = true; });
    $('go-menu').addEventListener('click', () => { $('gameover').hidden = true; if (this.onMenu) this.onMenu(); });
    this.refresh();
  }

  /** aufgeklappte Abschnitte im Frontfenster bleiben über Ticks hinweg offen */
  isOpen(k) { return this.openDetails?.has(k) ? 'open' : ''; }

  cmd(fn) {
    fn();
    this.renderer.frontGeom = this.renderer.buildFrontGeometry();
    this.renderer.requestRender();
    this.refresh();
  }

  playerFronts() {
    const p = this.sim.player;
    return [...this.sim.fronts.values()].filter((f) => f.alive && f.side[p]).sort((a, b) => b.length - a.length || a.id - b.id);
  }

  selectFront(id, center = false) {
    const f = this.sim.fronts.get(id);
    if (!f || !f.alive) return;
    this.frontId = id;
    this.renderer.selectedFront = id;
    document.body.classList.add('front-open');
    if (center) this.onCenter(Math.round(f.cy) * this.sim.cols + Math.round(f.cx));
    this.refresh();
    this.renderer.requestRender();
  }

  closeFront() {
    this.frontId = 0;
    this.renderer.selectedFront = 0;
    document.body.classList.remove('front-open');
    this.renderer.requestRender();
  }

  onTick() {
    // ausgewählte Front kann verschmolzen sein: Nachfolger über die Feldkennung suchen
    if (this.frontId) {
      const f = this.sim.fronts.get(this.frontId);
      if (!f || !f.alive) {
        const old = f;
        const next = old ? this.sim.nearestFront(this.sim.player, old.cx, old.cy) : 0;
        if (next) this.selectFront(next); else this.closeFront();
      }
    }
    this.refresh();
  }

  refresh() {
    const sim = this.sim;
    $('date').textContent = sim.dateText();
    this.renderLage();
    if (this.frontId) this.renderFrontWin();
    this.renderMessages();
    renderMorale(sim, () => { this.refresh(); if (this.onPropaganda) this.onPropaganda(); });
    if (this.panel.selected >= 0) this.panel.showCell(this.panel.selected);
    if (sim.isOver() && !this.gameOverShown) this.showGameOver();
    const v = sim.dip.flags.lastVictory;
    if (v && this.victoryShown !== v.day) { this.victoryShown = v.day; this.showGameOver(v); }
  }

  setDayProgress(t) {
    $('day-bar').style.width = `${Math.round(Math.min(1, t) * 100)}%`;
  }

  // ------------------------------------------------------------ Lage (linke Leiste)
  renderLage() {
    const sim = this.sim;
    const p = sim.player;
    const fronts = this.playerFronts();
    const reserve = sim.reserveOf(p).length;
    const transit = sim.divisions.filter((d) => d.nation === p && d.transit).length;
    const rows = fronts.map((f) => {
      const own = sim.divisionsOn(f.id, p).length;
      const enemy = sim.estimate(f.id, sim.enemyOn(f, p));
      const order = f.side[p].order;
      const tag = f.encircled[sim.enemyOn(f, p)] ? ' kessel' : '';
      return `<li data-front="${f.id}" class="${f.id === this.frontId ? 'sel' : ''}${tag}">
        <span class="o o-${order}" title="${ORDER_LABEL[order]}"></span>
        <span class="n">${esc(f.name)}</span>
        <span class="d" title="eigene / Gegner (geschätzt)">${own} : ~${enemy}</span></li>`;
    });
    const over = sim.isOver();
    $('lage').innerHTML = `
      <ul class="fronts">${rows.join('') || '<li class="empty">Keine Front. Für einen Aufmarsch ein Nachbarland anklicken → „Aufmarsch an der Grenze“.</li>'}</ul>
      <div class="reserve">Reserve: <b>${reserve}</b> Div.${transit ? ` · unterwegs: ${transit}` : ''}</div>`;
    $('all-attack').disabled = over || !fronts.length;
  }

  // ------------------------------------------------------------ Frontfenster (rechts)
  renderFrontWin() {
    const sim = this.sim;
    const f = sim.fronts.get(this.frontId);
    if (!f || !f.alive) { this.closeFront(); return; }
    const p = sim.player;
    const e = sim.enemyOn(f, p);
    const side = f.side[p];
    const own = sim.sideStrength(f.id, p);
    const transit = sim.inTransitTo(f.id, p).length;
    const enemyEst = sim.estimate(f.id, e);
    const B = sim.bal;
    const prepBonus = Math.round(B.orders.prepMaxBonus * side.prep * 100);
    const attacking = side.order === 'attack';
    const others = this.playerFronts().filter((x) => x.id !== f.id);
    if (this.transferTarget && !others.some((x) => x.id === this.transferTarget)) this.transferTarget = 0;
    const target = this.transferTarget || others[0]?.id || 0;
    const days = target ? sim.travelDays(f.id, target, p) : 0;
    const sections = f.sections.map((sec) => {
      const st = sec.stats;
      const status = st.status[p];
      const km = st.km[p];
      return `<tr><td>${esc(sec.name)}</td><td class="num">${km !== undefined ? km.toFixed(1) : '–'}</td>
        <td class="num">${(st.kmTotal[p] || 0).toFixed(0)}</td>
        <td>${attacking && status ? `<span class="chip ${STATUS_CLASS[status]}">${status}</span>` : '<span class="chip">–</span>'}</td></tr>`;
    }).join('');
    $('frontwin').innerHTML = `
      <header class="fw-head">
        <img class="flag mini" src="${flagUrl(sim.code(e))}" alt="">
        <h2>${esc(f.name)}</h2>
        <button type="button" class="close" data-action="close" aria-label="Frontfenster schließen">×</button>
      </header>
      ${f.planned ? `<p class="fw-plan">Aufmarsch – noch Frieden mit ${esc(sim.nameDat(e))}. Truppen sammeln, „Angriff vorbereiten“ wählen und erst dann den Krieg erklären.</p>` : ''}
      <p class="fw-sub">${f.planned ? 'Grenze zu' : 'gegen'} ${esc(sim.nationName(e))} · ${f.sections.length} Abschnitte · ${fmtInt(f.length * 9)} km${f.encircled[e] ? ' · <b>Gegner eingeschlossen</b>' : ''}</p>

      <section>
        <h3>Kräfte</h3>
        <dl class="fw-grid">
          <dt>Eigene</dt><dd><b>${own.count}</b> Div.${transit ? ` (+${transit} unterwegs)` : ''} · Stärke ${own.count ? pct(own.str / own.count) : '–'}</dd>
          <dt></dt><dd>Panzer ${pct(own.tank)} · Luft ${pct(own.air)}${side.tied ? ` · Belagerung bindet ${side.tied.toFixed(1)}` : ''}</dd>
          <dt>Gegner</dt><dd>${f.planned ? (sim.divisionsOn(f.id, e).length ? `an der Grenze ca. <b>${enemyEst}</b> Div. · gesamt ca. ${Math.max(1, Math.round(sim.divisions.filter((d) => d.nation === e).length / 5) * 5)}` : `Armee gesamt ca. <b>${Math.max(1, Math.round(sim.divisions.filter((d) => d.nation === e).length / 5) * 5)}</b> Div. <span class="muted">(noch nicht an der Grenze)</span>`) : `ca. <b>${enemyEst}</b> Div. <span class="muted">(geschätzt)</span>`}</dd>
        </dl>
      </section>

      ${this.generalHtml(f, p)}

      ${this.tacticHtml(f, p)}

      <section>
        <h3>Angriffsziel</h3>
        <label class="radio"><input type="radio" name="objective" value="all" ${side.objective ? '' : 'checked'}> Ganzes Land <span class="muted">– die Truppen rücken immer weiter vor</span></label>
        <label class="radio"><input type="radio" name="objective" value="line" ${side.objective ? 'checked' : ''}> Bis zur Haltelinie <span class="muted">– danach halten und eingraben</span></label>
        <div class="row"><button type="button" class="btn small" data-action="draw-line">${side.objective ? 'Linie neu zeichnen' : 'Linie auf der Karte zeichnen'}</button></div>
      </section>

      <section>
        <h3>Einsatz und Schwerpunkt</h3>
        <div class="seg" role="radiogroup" aria-label="Einsatzstärke">${sim.bal.orders.commitLevels.map((v) => `<button type="button" role="radio" aria-checked="${Math.abs((side.commit ?? 1) - v) < 1e-6}" data-action="commit" data-v="${v}">${Math.round(v * 100)} %</button>`).join('')}</div>
        <p class="fw-sub">Anteil der Divisionen, die angreifen – der Rest hält die Linie. Weniger Einsatz: langsamer, aber geringere Verluste.</p>
        <div class="row"><button type="button" class="btn small" data-action="set-focus">${side.focus ? 'Schwerpunkt verlegen' : 'Schwerpunkt auf der Karte setzen'}</button>${side.focus ? '<button type="button" class="btn small" data-action="clear-focus">aufheben</button>' : ''}</div>
        <p class="fw-sub">${side.focus ? 'Der Stoßpfeil zeigt den Schwerpunkt: Abschnitte in seiner Nähe erhalten den Großteil der Angriffskraft.' : 'Ohne Schwerpunkt greift die Front auf ganzer Breite an.'}</p>
      </section>

      <section>
        <h3>Befehl</h3>
        <label class="radio"><input type="radio" name="order" value="hold" ${side.order === 'hold' ? 'checked' : ''} ${attacking ? 'disabled' : ''}> Halten und befestigen</label>
        <label class="radio"><input type="radio" name="order" value="prepare" ${side.order === 'prepare' ? 'checked' : ''} ${attacking ? 'disabled' : ''}> Angriff vorbereiten</label>
        ${attacking ? `<p class="fw-status">Angriff läuft seit ${esc(sim.dateText(side.attackStartDay))}.</p>` : ''}
        <div class="bar-label">Angriffsbonus <b>+${prepBonus} %</b>${side.order === 'prepare' && side.prep < 1 ? ' · baut sich auf' : ''}${attacking ? ' · wird verbraucht' : ''}</div>
        <div class="bar" title="Angriffsbonus"><i style="width:${Math.round(side.prep * 100)}%"></i></div>
        ${attacking
          ? `<button type="button" class="btn" data-action="stop">Angriff einstellen</button>`
          : f.planned
            ? `<button type="button" class="btn btn-main${this.warConfirm === f.id ? ' confirm' : ''}" data-action="war-attack" ${sim.isOver() ? 'disabled' : ''}>${this.warConfirm === f.id ? `Wirklich ${esc(sim.nameDat(e))} den Krieg erklären?` : 'Krieg erklären und angreifen'}</button>`
            : `<button type="button" class="btn btn-main" data-action="attack" ${sim.isOver() ? 'disabled' : ''}>Angriff auslösen</button>`}
      </section>

      <details data-d="vorgehen" ${this.isOpen('vorgehen')}>
        <summary>Vorgehen bei Eroberung</summary>
        <label class="radio"><input type="radio" name="method" value="minimal" ${side.method === 'minimal' ? 'checked' : ''}> Minimaler Schaden <span class="muted">– Land und Wirtschaft bleiben erhalten, langsamer</span></label>
        <label class="radio"><input type="radio" name="method" value="total" ${side.method === 'total' ? 'checked' : ''}> Totale Verwüstung <span class="muted">– schneller, kaum Ertrag für lange Zeit</span></label>
      </details>

      ${f.planned ? '' : this.airHtml(f, p)}

      <section>
        <h3>Truppen</h3>
        <div class="row">
          <button type="button" class="btn small" data-action="from-reserve" ${sim.reserveOf(p).length ? '' : 'disabled'}>+1 aus Reserve (${sim.reserveOf(p).length})</button>
          <button type="button" class="btn small" data-action="from-reserve5" ${sim.reserveOf(p).length ? '' : 'disabled'}>+5</button>
          <button type="button" class="btn small" data-action="to-reserve" ${own.count && !f.encircled[p] ? '' : 'disabled'}>−1 zur Reserve</button>
        </div>
        <p class="fw-sub">Aus der Reserve: ${sim.travelDays(0, f.id, p)} ${sim.travelDays(0, f.id, p) === 1 ? 'Tag' : 'Tage'} Marsch. Auf der Karte: Rechtsklick auf eine andere Front verlegt die gewählte Anzahl dorthin.</p>
        ${others.length ? `<div class="row">
          <select id="tf-target" aria-label="Zielfront">${others.map((x) => `<option value="${x.id}" ${x.id === target ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <select id="tf-count" aria-label="Anzahl">${['1', '5', '10', 'alle'].map((v) => `<option value="${v}" ${v === (this.transferCount || '1') ? 'selected' : ''}>${v === 'alle' ? 'alle' : `${v} Div.`}</option>`).join('')}</select>
          <button type="button" class="btn small" data-action="transfer" ${own.count ? '' : 'disabled'}>Verlegen · ${days} ${days === 1 ? 'Tag' : 'Tage'}</button>
        </div>` : ''}
      </section>

      ${f.planned ? '' : `<details data-d="kampf" ${this.isOpen('kampf')}>
        <summary>Kampfbericht</summary>
        <table class="fw-table">
          <thead><tr><th>Abschnitt</th><th class="num">km heute</th><th class="num">km ges.</th><th>Status</th></tr></thead>
          <tbody>${sections}</tbody>
        </table>
        <dl class="fw-grid">
          <dt>Vormarsch</dt><dd>${side.kmToday.toFixed(1)} km heute · ${side.kmTotal.toFixed(0)} km gesamt</dd>
          <dt>Verluste</dt><dd>eigene ${fmtInt(side.lossesToday)} heute · ${fmtInt(side.lossesTotal)} gesamt</dd>
          <dt></dt><dd>Gegner ${fmtInt(f.side[e].lossesToday)} heute · ${fmtInt(f.side[e].lossesTotal)} gesamt</dd>
          <dt>Gefangene</dt><dd>${fmtInt(side.prisonersToday)} heute · ${fmtInt(side.prisonersTotal)} gesamt</dd>
          <dt>Lufteinsätze</dt><dd>${fmtInt(side.airToday)} heute · ${fmtInt(side.airTotal)} gesamt</dd>
        </dl>
      </details>`}`;
  }

  tacticHtml(f, p) {
    const sim = this.sim;
    const side = f.side[p];
    const all = Object.entries(sim.bal.tactics).filter(([k]) => !k.startsWith('_'));
    const cur = sim.bal.tactics[side.tactic] || sim.bal.tactics.standard;
    const k = tacticOf(sim, f, p, undefined, false).k ?? 1;
    const t = cur;
    const warn = t.needTank && k < 1 ? ` Wirkung nur ${Math.round(k * 100)} % – zu wenige Panzer an dieser Front.`
      : t.needAir && k < 1 ? ` Wirkung nur ${Math.round(k * 100)} % – zu wenig Luftwaffe an dieser Front.` : '';
    const cost = t.moneyPerDivDay ? ` Kosten beim Angriff: ${(t.moneyPerDivDay * sim.divisionsOn(f.id, p).length).toFixed(0)} Geld je Tag.` : '';
    return `<section>
        <h3>Taktik beim Angriff</h3>
        <select id="tactic-select" aria-label="Taktik" class="full">
          ${all.map(([key, v]) => `<option value="${key}" ${key === (side.tactic || 'standard') ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}
        </select>
        <p class="fw-sub">${esc(t.text)}${esc(warn)}${esc(cost)}</p>
      </section>`;
  }

  generalHtml(f, p) {
    const sim = this.sim;
    const side = f.side[p];
    const g = side.general ? sim.generals.find((x) => x.id === side.general) : null;
    const tr = g ? sim.generalTraits[g.trait] : null;
    const options = [g, ...freeGenerals(sim, p)].filter(Boolean);
    return `<section>
        <h3>General</h3>
        <select id="gen-select" aria-label="General wählen" class="full">
          ${!g ? '<option value="">– kein General –</option>' : ''}
          ${options.map((x) => `<option value="${x.id}" ${g && x.id === g.id ? 'selected' : ''}>${esc(x.name)} – ${esc(sim.generalTraits[x.trait].label)}</option>`).join('')}
        </select>
        ${tr ? `<p class="fw-sub">${esc(tr.label)}: ${esc(tr.text)}</p>` : ''}
      </section>`;
  }

  airHtml(f, p) {
    const sim = this.sim;
    const side = f.side[p];
    const shares = sim.bal.airstrike.shares;
    const targets = strikeTargets(sim, f, p);
    const cur = side.strikeTarget ? `${side.strikeTarget.kind}:${side.strikeTarget.id}` : '';
    const power = strikePower(sim, f, p);
    const name = (t) => describeTarget(sim, t)?.name || '–';
    return `<details data-d="luft" ${this.isOpen('luft')}>
        <summary>Luftangriffe</summary>
        <div class="seg">${shares.map((v) => `<button type="button" role="radio" aria-checked="${Math.abs((side.airShare || 0) - v) < 1e-6}" data-action="airshare" data-v="${v}">${Math.round(v * 100)} %</button>`).join('')}</div>
        <select id="strike-target" aria-label="Ziel der Luftangriffe" class="full">
          <option value="">– Ziel hinter der Front wählen –</option>
          ${targets.map((t) => `<option value="${t.kind}:${t.id}" ${`${t.kind}:${t.id}` === cur ? 'selected' : ''}>${esc(name(t))} (${Math.round(t.d * 9)} km)</option>`).join('')}
        </select>
        <p class="fw-sub">${side.airShare ? `${Math.round(side.airShare * 100)} % des Luftanteils fehlen an der Front · Trefferchance ${Math.round(power.chance * 100)} % je Tag${side.strikeHits ? ` · ${side.strikeHits} Treffer` : ''}` : 'Kein Luftanteil abgestellt.'}</p>
      </details>`;
  }

  onFrontAction(e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const id = this.frontId;
    const sim = this.sim;
    switch (b.dataset.action) {
      case 'close': this.closeFront(); return;
      case 'attack': this.cmd(() => sim.attack(id)); break;
      case 'war-attack': {
        if (this.warConfirm !== id) { this.warConfirm = id; this.refresh(); return; }
        this.warConfirm = 0;
        const f = sim.fronts.get(id);
        const enemy = sim.enemyOn(f, sim.player);
        // alle Grenzfronten gegen diesen Gegner greifen gemeinsam an, wenn vorbereitet
        const mine = this.playerFronts().filter((x) => x.planned && sim.enemyOn(x, sim.player) === enemy);
        const ready = new Set(mine.filter((x) => x.id === id || x.side[sim.player].order === 'prepare').map((x) => x.id));
        if (declareWarFn(sim, sim.player, enemy)) {
          for (const fid of ready) if (sim.fronts.get(fid)?.alive) sim.attack(fid);
          if (this.onWar) this.onWar();
        }
        this.cmd(() => {});
        break;
      }
      case 'draw-line': if (this.onDrawLine) this.onDrawLine(id); return;
      case 'commit': this.cmd(() => sim.setCommit(id, Number(b.dataset.v))); break;
      case 'set-focus': if (this.onSetFocus) this.onSetFocus(id); return;
      case 'clear-focus': this.cmd(() => sim.setFocus(id, null)); break;
      case 'from-reserve5': this.cmd(() => sim.transfer(0, id, 5)); break;
      case 'stop': this.cmd(() => sim.stopAttack(id)); break;
      case 'from-reserve': this.cmd(() => sim.transfer(0, id, 1)); break;
      case 'airshare': this.cmd(() => { sim.fronts.get(id).side[sim.player].airShare = Number(b.dataset.v); }); break;
      case 'to-reserve': this.cmd(() => sim.transfer(id, 0, 1)); break;
      case 'transfer': {
        const t = this.transferTarget || this.playerFronts().find((x) => x.id !== id)?.id;
        const c = this.transferCount === 'alle' ? 1e6 : Number(this.transferCount || 1);
        if (t) this.cmd(() => sim.transfer(id, t, c));
        break;
      }
      default:
    }
  }

  // ------------------------------------------------------------ Meldungsleiste
  renderMessages() {
    const ev = this.sim.events;
    if (ev.length === this.shownEvents && $('messages').childElementCount) return;
    this.shownEvents = ev.length;
    const last = ev.slice(-6).reverse();
    $('messages').innerHTML = last.map((m, k) => `<span class="msg t-${m.type}${k === 0 ? ' new' : ''}" data-cell="${m.cell}">
      <time>${esc(m.date)}</time> ${esc(m.text)}</span>`).join('');
  }

  // ------------------------------------------------------------ Abschluss (Phase 5)
  showGameOver(victory = null) {
    if (!victory) this.gameOverShown = true;
    const sim = this.sim;
    const p = sim.player;
    const o = victory || sim.outcome || { result: 'sieg', day: sim.day };
    const win = o.result === 'sieg';
    const me = sim.nations.get(p);
    const ever = sim.dip.everEnemies;
    const caps = ever.filter((n) => sim.nations.get(n)?.status === 'kapituliert');
    let conquered = 0;
    for (let i = 0; i < sim.N; i++) if (sim.owner[i] === p && sim.startOwner[i] !== p) conquered++;
    const enemyLoss = ever.reduce((t, n) => t + (sim.nations.get(n)?.lossesTotal || 0), 0);
    const title = win ? 'Feldzug gewonnen' : 'Niederlage';
    const sub = win
      ? (o.allCapitulated ? 'Alle Kriegsgegner haben kapituliert.' : `Kein Kriegsgegner steht mehr im Feld (Kapitulation: ${caps.map((n) => sim.nationName(n)).join(', ') || '–'}; übrige durch Frieden oder Waffenstillstand).`)
      : `${sim.nameNom(p)} hat am ${sim.dateText(o.day)} kapituliert.`;
    const keyTypes = new Set(['war', 'capitulation', 'peace', 'treaty', 'event', 'end']);
    const events = sim.events.filter((e) => keyTypes.has(e.type) || (e.type === 'decision' && !e.text.startsWith('Entscheidung:'))).slice(-16);
    const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
    const pol = sim.codeIndex.get('POL');
    const ps = pol ? sim.nations.get(pol) : null;
    $('go-title').textContent = title;
    $('go-title').className = win ? 'win' : 'lose';
    $('go-body').innerHTML = `
      <p class="go-sub">${esc(sub)}</p>
      <div class="go-stats">
        ${stat(`${o.day} Tage`, `Dauer · bis ${esc(sim.dateText(o.day))}`)}
        ${stat(`${fmtInt(conquered * 81)} km²`, `erobert (${fmtInt(conquered)} Felder)`)}
        ${stat(String(caps.length), 'Gegner kapituliert')}
        ${stat(fmtInt(me.lossesTotal), 'eigene Verluste')}
        ${stat(fmtInt(enemyLoss), 'Verluste der Gegner')}
        ${stat(fmtInt(me.prisonersTaken), 'Gefangene gemacht')}
        ${stat(fmtInt(me.menLostAsPrisoners), 'eigene Gefangene')}
        ${stat(fmtInt(me.deserted || 0), 'Deserteure')}
        ${stat(`${Math.round(me.morale)} %`, 'Moral am Ende')}
      </div>
      <h3>Wichtigste Ereignisse</h3>
      <ul class="go-events">${events.map((e) => `<li><time>${esc(e.date)}</time>${esc(e.text)}</li>`).join('')}</ul>
      ${ps && ps.status === 'kapituliert' ? `<p class="muted">Zum Vergleich: Historisch kapitulierten die letzten polnischen Verbände am 6. Oktober 1939 (Tag 36); im Spiel kapitulierte Polen am ${esc(sim.dateText(ps.capitulationDay))} (Tag ${ps.capitulationDay}).</p>` : ''}
      <p class="muted">Die täglichen Momentaufnahmen bleiben im Spielstand für einen späteren Zeitraffer erhalten.</p>`;
    $('go-close').textContent = win ? 'Weiterspielen' : 'Karte weiter ansehen';
    $('gameover').hidden = false;
    if (this.onGameOver) this.onGameOver();
  }
}

// Spieloberfläche Phase 2: Lage, Frontfenster, Kampfanzeige, Meldungsleiste, Abschlussdialog.
import { flagUrl } from './flags.js';
import { fmtInt } from '../sim/calendar.js';
import { freeGenerals, assignGeneral } from '../sim/generals.js';
import { strikeTargets, strikePower } from '../sim/airstrike.js';
import { describeTarget } from '../sim/intel.js';

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
    $('frontwin').addEventListener('change', (e) => {
      if (e.target.id === 'tf-target') this.transferTarget = Number(e.target.value);
      if (e.target.id === 'gen-select') this.cmd(() => assignGeneral(this.sim, this.frontId, this.sim.player, e.target.value || null));
      if (e.target.id === 'strike-target') this.cmd(() => {
        const [kind, id] = e.target.value.split(':');
        const side = this.sim.fronts.get(this.frontId).side[this.sim.player];
        side.strikeTarget = kind ? { kind, id: Number(id) } : null;
      });
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
    this.refresh();
  }

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
    if (this.panel.selected >= 0) this.panel.showCell(this.panel.selected);
    if (sim.isOver() && !this.gameOverShown) this.showGameOver();
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
      <ul class="fronts">${rows.join('') || '<li class="empty">Keine Front – kein Krieg.</li>'}</ul>
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
      <p class="fw-sub">gegen ${esc(sim.nationName(e))} · ${f.sections.length} Abschnitte · ${fmtInt(f.length * 9)} km${f.encircled[e] ? ' · <b>Gegner eingeschlossen</b>' : ''}</p>

      <section>
        <h3>Kräfte</h3>
        <dl class="fw-grid">
          <dt>Eigene</dt><dd><b>${own.count}</b> Div.${transit ? ` (+${transit} unterwegs)` : ''} · Stärke ${own.count ? pct(own.str / own.count) : '–'}</dd>
          <dt></dt><dd>Panzer ${pct(own.tank)} · Luft ${pct(own.air)}${side.tied ? ` · Belagerung bindet ${side.tied.toFixed(1)}` : ''}</dd>
          <dt>Gegner</dt><dd>ca. <b>${enemyEst}</b> Div. <span class="muted">(geschätzt)</span></dd>
        </dl>
      </section>

      ${this.generalHtml(f, p)}

      <section>
        <h3>Befehl</h3>
        <label class="radio"><input type="radio" name="order" value="hold" ${side.order === 'hold' ? 'checked' : ''} ${attacking ? 'disabled' : ''}> Halten und befestigen</label>
        <label class="radio"><input type="radio" name="order" value="prepare" ${side.order === 'prepare' ? 'checked' : ''} ${attacking ? 'disabled' : ''}> Angriff vorbereiten</label>
        ${attacking ? `<p class="fw-status">Angriff läuft seit ${esc(sim.dateText(side.attackStartDay))} (Tag ${side.attackStartDay}).</p>` : ''}
        <div class="bar-label">Angriffsbonus <b>+${prepBonus} %</b>${side.order === 'prepare' && side.prep < 1 ? ' · baut sich auf' : ''}${attacking ? ' · wird verbraucht' : ''}</div>
        <div class="bar" title="Angriffsbonus"><i style="width:${Math.round(side.prep * 100)}%"></i></div>
        ${attacking
          ? `<button type="button" class="btn" data-action="stop">Angriff einstellen</button>`
          : `<button type="button" class="btn btn-main" data-action="attack" ${sim.isOver() ? 'disabled' : ''}>Angriff auslösen</button>`}
      </section>

      <section>
        <h3>Vorgehen bei Eroberung</h3>
        <label class="radio"><input type="radio" name="method" value="minimal" ${side.method === 'minimal' ? 'checked' : ''}> Minimaler Schaden <span class="muted">– Land und Wirtschaft bleiben erhalten, langsamer</span></label>
        <label class="radio"><input type="radio" name="method" value="total" ${side.method === 'total' ? 'checked' : ''}> Totale Verwüstung <span class="muted">– schneller, kaum Ertrag für lange Zeit</span></label>
      </section>

      ${this.airHtml(f, p)}

      <section>
        <h3>Truppen</h3>
        <div class="row">
          <button type="button" class="btn small" data-action="from-reserve" ${sim.reserveOf(p).length ? '' : 'disabled'}>+1 aus Reserve (${sim.reserveOf(p).length})</button>
          <button type="button" class="btn small" data-action="to-reserve" ${own.count && !f.encircled[p] ? '' : 'disabled'}>−1 zur Reserve</button>
        </div>
        ${others.length ? `<div class="row">
          <select id="tf-target" aria-label="Zielfront">${others.map((x) => `<option value="${x.id}" ${x.id === target ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>
          <button type="button" class="btn small" data-action="transfer" ${own.count ? '' : 'disabled'}>Verlegen (1 Div., ${days} ${days === 1 ? 'Tag' : 'Tage'})</button>
        </div>` : ''}
      </section>

      <section>
        <h3>Kampf</h3>
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
    return `<section>
        <h3>Luftangriffe</h3>
        <div class="seg">${shares.map((v) => `<button type="button" role="radio" aria-checked="${Math.abs((side.airShare || 0) - v) < 1e-6}" data-action="airshare" data-v="${v}">${Math.round(v * 100)} %</button>`).join('')}</div>
        <select id="strike-target" aria-label="Ziel der Luftangriffe" class="full">
          <option value="">– Ziel hinter der Front wählen –</option>
          ${targets.map((t) => `<option value="${t.kind}:${t.id}" ${`${t.kind}:${t.id}` === cur ? 'selected' : ''}>${esc(name(t))} (${Math.round(t.d * 9)} km)</option>`).join('')}
        </select>
        <p class="fw-sub">${side.airShare ? `${Math.round(side.airShare * 100)} % des Luftanteils fehlen an der Front · Trefferchance ${Math.round(power.chance * 100)} % je Tag${side.strikeHits ? ` · ${side.strikeHits} Treffer` : ''}` : 'Kein Luftanteil abgestellt.'}</p>
      </section>`;
  }

  onFrontAction(e) {
    const b = e.target.closest('[data-action]');
    if (!b) return;
    const id = this.frontId;
    const sim = this.sim;
    switch (b.dataset.action) {
      case 'close': this.closeFront(); return;
      case 'attack': this.cmd(() => sim.attack(id)); break;
      case 'stop': this.cmd(() => sim.stopAttack(id)); break;
      case 'from-reserve': this.cmd(() => sim.transfer(0, id, 1)); break;
      case 'airshare': this.cmd(() => { sim.fronts.get(id).side[sim.player].airShare = Number(b.dataset.v); }); break;
      case 'to-reserve': this.cmd(() => sim.transfer(id, 0, 1)); break;
      case 'transfer': {
        const t = this.transferTarget || this.playerFronts().find((x) => x.id !== id)?.id;
        if (t) this.cmd(() => sim.transfer(id, t, 1));
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

  // ------------------------------------------------------------ Abschluss
  showGameOver() {
    this.gameOverShown = true;
    const sim = this.sim;
    const p = sim.player;
    const lines = [];
    for (const [n, st] of sim.nations) {
      if (st.status === 'kapituliert') {
        lines.push(`<p><img class="flag mini" src="${flagUrl(sim.code(n))}" alt=""> <b>${esc(sim.nationName(n))}</b> kapituliert am ${esc(sim.dateText(st.capitulationDay))} – nach <b>${st.capitulationDay} Tagen</b>.</p>`);
      }
    }
    const me = sim.nations.get(p);
    lines.push(`<dl class="fw-grid">
      <dt>Gefangene</dt><dd>${fmtInt(me.prisonersTaken)}</dd>
      <dt>Eigene Verluste</dt><dd>${fmtInt(me.lossesTotal)}</dd>
      <dt>Lufteinsätze</dt><dd>${fmtInt(me.airTotal)}</dd>
    </dl>
    <p class="muted">Historisch kapitulierten die letzten polnischen Verbände am 6. Oktober 1939 (Tag 36). Im Spiel fehlen u. a. der sowjetische Einmarsch ab 17. September und die Westmächte.</p>`);
    $('go-body').innerHTML = lines.join('');
    $('gameover').hidden = false;
    if (this.onGameOver) this.onGameOver();
  }
}

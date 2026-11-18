// Oberfläche Phase 5: Entscheidungs-Pop-up, Diplomatiefenster, Zeitung, Moral und Propaganda.
import { flagUrl } from './flags.js';
import { decide } from '../sim/events.js';
import { declareWar, offer, offerScore, relation, statusOf, STATUS_LABEL, isAllied, hasPact } from '../sim/diplomacy.js';
import { issue } from '../sim/news.js';
import { moraleOf, moodText, moraleCombat, moraleProduction, capitulationBonus, propagandaGain, propaganda } from '../sim/morale.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ------------------------------------------------------------------ Entscheidung
export class DecisionUI {
  constructor({ sim, onDecided }) {
    this.sim = sim;
    this.onDecided = onDecided;
    $('dc-options').addEventListener('click', (e) => {
      const b = e.target.closest('[data-opt]');
      if (!b || !this.sim.pending) return;
      decide(this.sim, Number(b.dataset.opt));
      $('decision').hidden = true;
      this.onDecided();
    });
  }

  get open() { return !$('decision').hidden; }

  show() {
    const p = this.sim.pending;
    if (!p) { $('decision').hidden = true; return; }
    $('dc-title').textContent = p.title;
    $('dc-date').textContent = this.sim.dateText();
    $('dc-text').textContent = p.text;
    $('dc-options').innerHTML = p.options.map((o, k) => `<button type="button" data-opt="${k}"><b>${esc(o.label)}</b><span>${esc(o.hint)}</span></button>`).join('');
    $('decision').hidden = false;
    $('dc-options').querySelector('button')?.focus();
  }
}

// ------------------------------------------------------------------ Diplomatie
export class DiplomacyUI {
  constructor({ sim, onChange }) {
    this.sim = sim;
    this.onChange = onChange;
    this.confirm = 0; // Nation, deren Kriegserklärung auf Bestätigung wartet
    this.msg = '';
    $('diplo').addEventListener('click', (e) => {
      if (e.target.id === 'diplo' || e.target.closest('[data-close]')) { this.close(); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const n = Number(b.dataset.n);
      const sim = this.sim;
      const act = b.dataset.act;
      if (act === 'war') {
        if (this.confirm !== n) { this.confirm = n; this.msg = `Kriegserklärung an ${sim.nameAcc(n)}? Zum Bestätigen erneut klicken.`; this.render(); return; }
        this.confirm = 0;
        const ok = declareWar(sim, sim.player, n);
        this.msg = ok ? `${sim.nameNom(sim.player)} hat ${sim.nameDat(n)} den Krieg erklärt.` : 'Kriegserklärung nicht möglich.';
        this.onChange();
      } else {
        this.confirm = 0;
        this.msg = offer(sim, n, act === 'alliance' ? 'buendnis' : 'pakt').text;
        this.onChange();
      }
      this.render();
    });
  }

  get open() { return !$('diplo').hidden; }
  show() { this.confirm = 0; this.msg = ''; this.render(); $('diplo').hidden = false; }
  close() { $('diplo').hidden = true; }

  prospect(n, kind) {
    const sim = this.sim;
    const D = sim.bal.diplomacy;
    const s = offerScore(sim, sim.player, n, kind);
    const need = kind === 'buendnis' ? D.acceptAlliance : D.acceptPact;
    return s >= need ? 'Aussicht: gut' : s >= need - 25 ? 'Aussicht: unsicher' : 'Aussicht: gering';
  }

  outlook(n, gone, war) {
    const sim = this.sim;
    const p = sim.player;
    if (gone || war) return '';
    const parts = [];
    if (!isAllied(sim, p, n)) parts.push(`Bündnis: ${this.prospect(n, 'buendnis').replace('Aussicht: ', '')}`);
    if (!isAllied(sim, p, n) && !hasPact(sim, p, n)) parts.push(`Pakt: ${this.prospect(n, 'pakt').replace('Aussicht: ', '')}`);
    if (isAllied(sim, p, n) || hasPact(sim, p, n)) parts.push('Kriegserklärung wäre Vertragsbruch');
    return `<span class="dp-out">Aussicht – ${esc(parts.join(' · '))}</span>`;
  }

  render() {
    const sim = this.sim;
    const p = sim.player;
    const codes = sim.bal.diplomacy.nations.filter((c) => sim.codeIndex.has(c));
    const rows = codes.map((c) => {
      const n = sim.idx(c);
      const st = sim.nations.get(n);
      const gone = !st || st.status !== 'aktiv';
      const rel = relation(sim, p, n);
      const status = gone ? 'kapituliert' : statusOf(sim, p, n);
      const w = Math.min(50, Math.abs(rel) / 2);
      const war = status === 'krieg';
      const pending = this.confirm === n;
      return `<tr class="${gone ? 'capit' : ''}">
        <td class="nm"><img class="flag mini" src="${flagUrl(c)}" alt=""> ${esc(sim.nationName(n))}</td>
        <td><span class="dst ${status}">${gone ? 'kapituliert' : STATUS_LABEL[status]}</span></td>
        <td><div class="rel"><div class="rel-bar"><i class="${rel >= 0 ? 'pos' : 'neg'}" style="width:${w}%"></i></div><span class="rel-val">${rel > 0 ? '+' : ''}${Math.round(rel)}</span></div></td>
        <td><div class="dp-act">
          <button type="button" class="war${pending ? ' confirm' : ''}" data-act="war" data-n="${n}" ${gone || war ? 'disabled' : ''} title="${isAllied(sim, p, n) || hasPact(sim, p, n) ? 'Achtung: Vertragsbruch' : 'Krieg erklären'}">${pending ? 'Bestätigen' : 'Krieg erklären'}</button>
          <button type="button" data-act="alliance" data-n="${n}" ${gone || war || isAllied(sim, p, n) ? 'disabled' : ''} title="${this.prospect(n, 'buendnis')}">Bündnis anbieten</button>
          <button type="button" data-act="pact" data-n="${n}" ${gone || war || hasPact(sim, p, n) || isAllied(sim, p, n) ? 'disabled' : ''} title="${this.prospect(n, 'pakt')}">Pakt anbieten</button>
        </div>${this.outlook(n, gone, war)}</td>
      </tr>`;
    }).join('');
    const breaches = sim.dip.breaches[p] || 0;
    $('diplo-body').innerHTML = `
      <p class="dp-intro">Beziehungen des Deutschen Reichs. Bündnisse sind Beistandspakte: Wird ein Partner angegriffen, treten die übrigen Partner in den Krieg ein. Spionage-Enttarnungen und Vertragsbruch verschlechtern die Beziehungen.</p>
      <table class="dp-table">
        <thead><tr><th>Nation</th><th>Stand</th><th>Beziehung</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p class="dp-msg" role="status">${esc(this.msg)}</p>
      <p class="dp-foot">Verlässlichkeit: ${breaches ? `${breaches} Vertragsbruch${breaches > 1 ? 'e' : ''} – Angebote werden skeptischer bewertet.` : 'kein Vertragsbruch.'} Neue Angebote an dieselbe Nation frühestens nach ${sim.bal.diplomacy.offerCooldownDays} Tagen.</p>`;
  }
}

// ------------------------------------------------------------------ Zeitung
export class NewspaperUI {
  constructor({ sim }) {
    this.sim = sim;
    this.day = null; // angezeigter Tag (null = heute)
    this.seenNews = 0;
    $('paper').addEventListener('click', (e) => {
      if (e.target.id === 'paper' || e.target.closest('[data-close]')) { this.close(); return; }
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      const d = (this.day ?? this.sim.day) + Number(b.dataset.nav);
      this.day = Math.min(this.sim.day, Math.max(0, d));
      if (this.day === this.sim.day) this.day = null;
      this.render();
    });
  }

  get open() { return !$('paper').hidden; }
  show() { this.day = null; this.render(); $('paper').hidden = false; this.seenNews = this.sim.news.length; this.badge(); }
  close() { $('paper').hidden = true; }

  /** Rote Marke, wenn seit dem letzten Lesen wichtige Schlagzeilen erschienen sind. */
  badge() {
    const fresh = this.sim.news.slice(this.seenNews).some((n) => n.prio >= 3);
    $('paper-badge').hidden = !fresh;
  }

  render() {
    const sim = this.sim;
    const day = this.day ?? sim.day;
    const items = issue(sim, day);
    const lead = items[0];
    const rest = items.slice(1);
    const no = 1000 + day;
    $('paper-body').innerHTML = `
      <header class="np-mast"><h1>Der Tagesanzeiger</h1></header>
      <div class="np-line"><span>Nr. ${no}</span><span>${esc(sim.dateText(day))}</span><span>Preis 10 Pf.</span></div>
      ${lead ? `<section class="np-lead"><h2>${esc(lead.title)}</h2><p>${esc(lead.text)}</p></section>` : '<p class="np-empty">Keine besonderen Vorkommnisse.</p>'}
      ${rest.length ? `<div class="np-cols">${rest.map((n) => `<article><div class="d">${esc(sim.dateText(n.day))}</div><h3>${esc(n.title)}</h3><p>${esc(n.text)}</p></article>`).join('')}</div>` : ''}
      <nav class="np-nav">
        <button type="button" data-nav="-7" ${day <= 0 ? 'disabled' : ''}>← frühere Ausgabe</button>
        <button type="button" data-nav="7" ${day >= sim.day ? 'disabled' : ''}>spätere Ausgabe →</button>
      </nav>
      <p class="np-note">Schlagzeilen aus dem Spielverlauf, keine historischen Zeitungstexte.</p>`;
  }
}

// ------------------------------------------------------------------ Moral (linke Leiste) und Kennzahl
export function renderMorale(sim, onPropaganda) {
  const p = sim.player;
  const m = moraleOf(sim, p);
  const M = sim.bal.morale;
  const eff = [];
  const c = moraleCombat(sim, p);
  const pr = moraleProduction(sim, p);
  if (c < 1) eff.push(`Kampfkraft −${Math.round((1 - c) * 100)} %`);
  if (pr < 1) eff.push(`Produktion −${Math.round((1 - pr) * 100)} %`);
  if (m < M.desertBelow) eff.push('Desertion');
  const cb = capitulationBonus(sim, p);
  if (cb > 0) eff.push(`hält ${Math.round(cb * 100)} Punkte mehr Gebietsverlust aus`);
  const gain = propagandaGain(sim, p);
  const e = sim.econ.get(p);
  const can = e && e.money >= M.propaganda.cost && sim.nations.get(p).status === 'aktiv' && !sim.isOver();
  $('moral').innerHTML = `
    <div class="m-head"><span>Stimmung: ${moodText(m)}</span><span class="m-val">${Math.round(m)} %</span></div>
    <div class="m-bar" title="Moral"><i style="width:${m}%"></i><b style="left:${M.lowFrom}%" title="darunter sinken Kampfkraft und Produktion"></b></div>
    <p class="m-eff">${eff.length ? esc(eff.join(' · ')) : 'keine Auswirkung'}</p>
    <button type="button" class="btn small" id="propaganda" ${can ? '' : 'disabled'} title="Wirkung nimmt bei häufigem Einsatz ab (${M.propaganda.windowDays} Tage)">Propaganda (${M.propaganda.cost}) · +${gain.toFixed(1)} Moral</button>`;
  $('propaganda').onclick = () => { propaganda(sim, p); onPropaganda(); };
  const k = document.querySelector('#kpis [data-kpi="morale"] .k-value');
  if (k) k.textContent = String(Math.round(m));
}

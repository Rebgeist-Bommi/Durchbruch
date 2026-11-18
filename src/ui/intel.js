// Geheimdienst-Oberfläche (Phase 4): Akte zum gewählten Ziel, Agenten, Missionen.
import { fmtInt } from '../sim/calendar.js';
import { MISSION_TYPES, describeTarget, missionsFor, missionChance, recruitAgent, raiseLevel, startMission, counterOf, isRevealed } from '../sim/intel.js';
import { STATE_LABEL } from '../sim/infra.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (v) => `${Math.round(v * 100)} %`;
const EFFECT = {
  aufklaeren: 'Truppen, Gebäude und Forschung im Gebiet werden für 30 Tage sichtbar.',
  sabotage: 'Bahnknoten/Brücke zerstört (Nachschub und Verlegung leiden bis zur Instandsetzung); Gebäude verliert 50 % Leistung.',
  entfuehren: 'Wissenschaftler arbeitet für uns – mit niedriger Loyalität (Flucht- und Verratsrisiko).',
  desinformation: 'Der Gegner erwartet 14 Tage lang einen Großangriff an dieser Front und verlegt Truppen dorthin.',
};

export class IntelUI {
  constructor({ sim, renderer, onChange }) {
    this.sim = sim;
    this.renderer = renderer;
    this.onChange = onChange;
    this.target = null;
    $('intelui').addEventListener('click', (e) => this.onClick(e));
    this.refresh();
  }

  get n() { return this.sim.player; }

  select(t) {
    this.target = t;
    this.renderer.intelTarget = t;
    this.refresh();
    this.renderer.requestRender();
  }

  refresh() {
    const sim = this.sim;
    const I = sim.bal.intel;
    const st = sim.intel.get(this.n);
    const e = sim.econ.get(this.n);
    const ready = st.agents.filter((a) => a.state === 'ready').length;
    const training = st.agents.filter((a) => a.state === 'training').length;
    const busy = st.agents.filter((a) => a.state === 'mission');
    const levelCost = I.levelUpCost * st.level;
    let akte = '<p class="hint">Ziel auf der Karte anklicken: Bahnknoten, Brücke, Fabrik, Wissenschaftler, Front oder Gebiet.</p>';
    const d = this.target && describeTarget(sim, this.target);
    if (d) {
      const own = d.nation === this.n;
      const types = missionsFor(sim, this.n, this.target);
      const owner = d.nation ? sim.nationName(d.nation) : (d.front ? `Front gegen ${sim.nationName(sim.enemyOn(d.front, this.n))}` : '–');
      const known = own || isRevealed(sim, this.n, d.cell);
      const state = d.state ? STATE_LABEL[d.state] : d.health !== undefined ? (known ? `Leistung ${pct(d.health)}` : 'unbekannt') : '';
      const guardCtl = own && d.obj && 'guard' in d.obj
        ? `<span class="seg mini">${[0, 1, 2].map((g) => `<button type="button" role="radio" aria-checked="${d.obj.guard === g}" data-action="guard" data-v="${g}">${g}</button>`).join('')}</span>`
        : `<b>${d.guard ?? 0}</b>`;
      const rows = types.map((t) => {
        const p = missionChance(sim, this.n, t, this.target);
        const expose = (1 - p) * I.missions[t].exposeOnFail;
        return `<div class="mission">
          <div class="ec-row"><b>${esc(I.missions[t].label)}</b><span class="chance">${pct(p)}</span></div>
          <p class="ec-sub">${esc(EFFECT[t])}</p>
          <p class="ec-sub">Risiko Enttarnung ${pct(expose)} · Beziehung −${I.relationLoss} · Dauer ${I.missions[t].days} Tage</p>
          <button type="button" class="btn small" data-action="mission" data-type="${t}" ${ready ? '' : 'disabled'}>Agent ansetzen</button>
        </div>`;
      }).join('');
      akte = `<div class="akte">
        <div class="ec-row"><b>${esc(d.name)}</b></div>
        <dl class="ec-grid">
          <dt>Besitzer</dt><dd>${esc(owner)}</dd>
          ${state ? `<dt>Zustand</dt><dd>${esc(state)}</dd>` : ''}
          <dt>Bewachung</dt><dd>${guardCtl}</dd>
          ${!own && d.nation ? `<dt>Abwehr</dt><dd>Stufe ${counterOf(sim, d.nation).toFixed(1).replace('.', ',')}</dd>` : ''}
        </dl>
        ${own ? '<p class="ec-sub">Eigenes Ziel: Bewachung senkt die Chance feindlicher Missionen.</p>' : rows || '<p class="hint">Keine Mission möglich.</p>'}
      </div>`;
    }
    const missions = busy.map((a) => {
      const m = a.mission;
      const td = describeTarget(sim, m.target);
      return `<li><span>${esc(I.missions[m.type].label)} · ${esc(td ? td.name : '–')}</span><span>${m.finish - sim.day} T. · ${pct(m.chance)}</span></li>`;
    }).join('');
    $('intelui').innerHTML = `
      <h2>Geheimdienst</h2>
      <dl class="ec-grid">
        <dt>Stufe</dt><dd>${st.level}${st.upgrade ? ` (Stufe ${st.level + 1} ab ${esc(sim.dateText(st.upgrade.finish))})` : ''} · Abwehr ${counterOf(sim, this.n).toFixed(1).replace('.', ',')}</dd>
        <dt>Agenten</dt><dd>${ready} bereit · ${training} in Ausbildung · ${busy.length} im Einsatz</dd>
      </dl>
      <div class="row">
        <button type="button" class="btn small" data-action="recruit" ${e.money >= I.agentCost && st.agents.length < I.maxAgents ? '' : 'disabled'}>Agent ausbilden · ${fmtInt(I.agentCost)} · ${I.agentTrainingDays} T.</button>
        <button type="button" class="btn small" data-action="level" ${!st.upgrade && e.money >= levelCost ? '' : 'disabled'}>Stufe erhöhen · ${fmtInt(levelCost)}</button>
      </div>
      <h2>Akte</h2>
      ${akte}
      ${missions ? `<h2>Im Einsatz</h2><ul class="labs">${missions}</ul>` : ''}`;
  }

  onClick(ev) {
    const b = ev.target.closest('[data-action]');
    if (!b) return;
    const sim = this.sim;
    switch (b.dataset.action) {
      case 'recruit': recruitAgent(sim, this.n); break;
      case 'level': raiseLevel(sim, this.n); break;
      case 'mission': startMission(sim, this.n, b.dataset.type, this.target); break;
      case 'guard': { const d = describeTarget(sim, this.target); if (d?.obj) d.obj.guard = Number(b.dataset.v); break; }
      default: return;
    }
    this.onChange();
  }
}

export { MISSION_TYPES };

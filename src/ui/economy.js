// Wirtschaftsoberfläche (Phase 3): Kennzahlen oben, Seitenleiste im Modus "Wirtschaft"
// (Mobilisierung, Produktion, Rohstoffe, Infrastruktur, Bauen) und Standortwahl.
import { fmtInt } from '../sim/calendar.js';
import { labor, raiseDivision, canRaiseDivision, siteFields, siteSuitability, build } from '../sim/economy.js';
import { upgradeCost, startUpgrade, STATE_LABEL, INTACT } from '../sim/infra.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f1 = (v) => (Math.abs(v) >= 100 ? fmtInt(v) : v.toFixed(1).replace('.', ','));
const sign = (v) => (v >= 0 ? `+${f1(v)}` : `−${f1(-v)}`);
const TANK_PRESETS = [0.05, 0.35, 0.7];

export class EconomyUI {
  constructor({ sim, renderer, onChange }) {
    this.sim = sim;
    this.renderer = renderer;
    this.onChange = onChange;
    this.tankPreset = 0.05;
    this.buildType = null;
    this.fields = null;
    this.sector = -1;
    $('econ').addEventListener('click', (e) => this.onClick(e));
    this.refresh();
  }

  get n() { return this.sim.player; }
  get e() { return this.sim.econ.get(this.sim.player); }

  // ---------------------------------------------------------------- Kennzahlen oben
  renderKpis() {
    const e = this.e;
    const net = e.incomeToday - e.upkeepToday - e.spentToday;
    const resNet = e.resProducedToday - e.resUsedToday;
    const set = (k, value, unit, title) => {
      const li = document.querySelector(`#kpis [data-kpi="${k}"]`);
      li.querySelector('.k-value').textContent = value;
      li.querySelector('.k-unit').textContent = unit;
      li.title = title;
    };
    set('money', fmtInt(e.money), `${sign(net)}/Tag`, `Geld (Mio. RM-Gegenwert). Heute: Einnahmen ${f1(e.incomeToday)}, Unterhalt ${f1(e.upkeepToday)}, Bau/Ausbau ${f1(e.spentToday)}`);
    set('resources', fmtInt(e.resources), `${sign(resNet)}/Tag`, `Rohstoffe (Kohle, Erz, Öl als ein Wert). Förderung ${f1(e.resProducedToday)}, Verbrauch Rüstung ${f1(e.resUsedToday)}`);
    set('manpower', (e.workers / 1e6).toFixed(1).replace('.', ','), 'Mio. Arb.', `Arbeiter ${f1(e.workers / 1e6)} Mio., Soldaten-Ziel ${f1(e.soldiersTarget / 1e6)} Mio., Ersatz verfügbar ${fmtInt(e.pool)}`);
  }

  // ---------------------------------------------------------------- Seitenleiste
  refresh() {
    this.renderKpis();
    const sim = this.sim;
    const E = sim.bal.economy;
    const e = this.e;
    const M = E.mobilization.levels;
    const L = labor(sim, e);
    const myDivs = sim.divisions.filter((d) => d.nation === this.n);
    const incomplete = myDivs.filter((d) => d.equip < E.equipmentPerDivision * 0.95 * (d.men / d.maxMen) || d.men < d.maxMen * 0.95).length;
    const fab = (t) => sim.buildings.filter((b) => b.type === t && b.done && sim.owner[b.cell] === this.n).length;
    const open = sim.buildings.filter((b) => !b.done && b.nation === this.n);
    const regions = sim.resourceRegions.filter((r) => r.cells.some((c) => sim.owner[c] === this.n));
    const byKind = { Kohle: 0, Erz: 0, Öl: 0 };
    for (const r of regions) byKind[r.kind] += r.cells.filter((c) => sim.owner[c] === this.n).length / r.cells.length * r.output;
    const damaged = sim.damagedRail.filter((c) => sim.owner[c] === this.n).length;
    const upgrades = sim.railUpgrades.filter((u) => u.nation === this.n);
    const canRaise = canRaiseDivision(sim, this.n);
    const B = E.buildings;
    let infra = '<p class="hint">Region auf der Karte anklicken.</p>';
    if (this.sector >= 0) {
      const lvl = sim.railLevel[this.sector];
      const up = upgradeCost(sim, this.sector);
      const running = sim.railUpgrades.find((u) => u.sector === this.sector);
      infra = `<div class="ec-row"><b>Region ${esc(sim.sectorName(this.sector))}</b><span class="lvl lvl-${lvl}">Stufe ${lvl}</span></div>
        ${running ? `<p class="hint">Ausbau auf Stufe ${running.to} läuft, fertig am ${esc(sim.dateText(running.finish))}.</p>`
          : lvl < 5 ? `<button type="button" class="btn small" data-action="upgrade" ${e.money >= up.cost ? '' : 'disabled'}>Ausbau auf Stufe ${up.to} · ${fmtInt(up.cost)} · ${up.days} Tage</button>`
            : '<p class="hint">Höchste Ausbaustufe.</p>'}`;
    }
    $('econ').innerHTML = `
      <section>
        <h2>Mobilisierung</h2>
        <div class="seg" role="radiogroup" aria-label="Mobilisierung">
          ${M.map((m, i) => `<button type="button" role="radio" aria-checked="${e.mobLevel === i}" data-action="mob" data-level="${i}" title="${esc(m.label)}: ${Math.round(m.rate * 1000) / 10} % der Bevölkerung unter Waffen">${i + 1}</button>`).join('')}
        </div>
        <p class="ec-sub"><b>${esc(M[e.mobLevel].label)}</b> · Soldaten-Ziel ${f1(e.soldiersTarget / 1e6)} Mio. · Arbeiter ${f1(L.workers / 1e6)} Mio. · Produktion <b>${Math.round(L.factor * 100)} %</b></p>
      </section>
      <section>
        <h2>Produktion</h2>
        <dl class="ec-grid">
          <dt>Geld</dt><dd>${sign(e.incomeToday)} Einnahmen · ${sign(-e.upkeepToday)} Unterhalt${e.spentToday ? ` · ${sign(-e.spentToday)} Bau` : ''}</dd>
          <dt>Gebäude</dt><dd>${fab('fabrik')} Fabriken · ${fab('ruestung')} Rüstung · ${fab('forschung')} Forschung</dd>
          <dt>Ausrüstung</dt><dd>${sign(e.equipToday)}/Tag · Bestand ${fmtInt(e.equipment)} (Panzer ${fmtInt(e.tankEquipment)})</dd>
          <dt>Divisionen</dt><dd>${myDivs.length}${incomplete ? ` · ${incomplete} unvollständig` : ''} · Ersatz ${fmtInt(e.pool)} Mann</dd>
        </dl>
        <div class="ec-label">Panzeranteil der Rüstung</div>
        <div class="seg" role="radiogroup" aria-label="Panzeranteil der Rüstung">
          ${[0, 0.1, 0.2, 0.3, 0.5].map((v) => `<button type="button" role="radio" aria-checked="${Math.abs(e.tankShare - v) < 0.001}" data-action="tankshare" data-v="${v}">${Math.round(v * 100)} %</button>`).join('')}
        </div>
        <div class="ec-label">Neue Division (Panzeranteil)</div>
        <div class="row">
          ${TANK_PRESETS.map((v) => `<button type="button" class="btn small ${this.tankPreset === v ? 'on' : ''}" data-action="preset" data-v="${v}">${Math.round(v * 100)} %</button>`).join('')}
          <button type="button" class="btn small main" data-action="raise" ${canRaise ? '' : 'disabled'} title="Braucht ${fmtInt(sim.bal.divisions.menPerDivision)} Soldaten und ${E.equipmentPerDivision} Ausrüstung">Aufstellen</button>
        </div>
      </section>
      <section>
        <h2>Rohstoffe</h2>
        <dl class="ec-grid">
          <dt>Bestand</dt><dd>${fmtInt(e.resources)} · ${sign(e.resProducedToday - e.resUsedToday)}/Tag</dd>
          <dt>Förderung</dt><dd>${f1(e.resProducedToday)}/Tag (Kohle ${f1(byKind.Kohle)}, Erz ${f1(byKind.Erz)}, Öl ${f1(byKind['Öl'])})</dd>
          <dt>Verbrauch</dt><dd>${f1(e.resUsedToday)}/Tag in Rüstungsfabriken</dd>
        </dl>
      </section>
      <section>
        <h2>Infrastruktur</h2>
        ${infra}
        <p class="ec-sub">In Instandsetzung: ${damaged} Bahnfelder${upgrades.length ? ` · Ausbau: ${upgrades.length} Region${upgrades.length > 1 ? 'en' : ''}` : ''}</p>
      </section>
      <section>
        <h2>Bauen</h2>
        <div class="build-buttons">
          ${['fabrik', 'ruestung', 'forschung'].map((t) => `<button type="button" class="btn small ${this.buildType === t ? 'on' : ''}" data-action="build" data-type="${t}" title="${fmtInt(B[t].cost)} · ${B[t].days} Tage">${esc(B[t].label)}<span>${fmtInt(B[t].cost)} · ${B[t].days} T.</span></button>`).join('')}
        </div>
        ${this.buildType ? '<p class="hint">Karte zeigt die Eignung (grün/gelb/rot). Klick auf ein Feld baut, Esc bricht ab.</p>' : ''}
        ${open.length ? `<ul class="queue">${open.map((b) => `<li><span>${esc(B[b.type].label)} · ${esc(b.siteName)}</span><span class="pbar"><i style="width:${Math.round(b.progress * 100)}%"></i></span></li>`).join('')}</ul>` : ''}
      </section>`;
  }

  onClick(ev) {
    const b = ev.target.closest('[data-action]');
    if (!b) return;
    const sim = this.sim;
    const e = this.e;
    switch (b.dataset.action) {
      case 'mob': e.mobLevel = Number(b.dataset.level); break;
      case 'tankshare': e.tankShare = Number(b.dataset.v); break;
      case 'preset': this.tankPreset = Number(b.dataset.v); break;
      case 'raise': raiseDivision(sim, this.n, this.tankPreset); break;
      case 'upgrade': startUpgrade(sim, this.sector, this.n); break;
      case 'build': this.setBuildMode(this.buildType === b.dataset.type ? null : b.dataset.type); return;
      default: return;
    }
    this.onChange();
  }

  // ---------------------------------------------------------------- Standortwahl
  setBuildMode(type) {
    this.buildType = type;
    this.fields = type ? siteFields(this.sim, this.n) : null;
    this.renderer.setBuildOverlay(type ? (cell) => siteSuitability(this.sim, this.n, cell, type, this.fields) : null);
    document.body.classList.toggle('building', !!type);
    if (!type) $('buildtip').hidden = true;
    this.refresh();
  }

  /** Erklärung am Mauszeiger (Bildschirmkoordinaten relativ zur Seite). */
  hover(cell, pageX, pageY) {
    const tip = $('buildtip');
    if (!this.buildType || cell < 0) { tip.hidden = true; return; }
    const sim = this.sim;
    const B = sim.bal.economy.buildings[this.buildType];
    const s = siteSuitability(sim, this.n, cell, this.buildType, this.fields);
    const pct = Math.round(s.score * 100);
    const cls = s.score >= 0.66 ? 'good' : s.score >= 0.4 ? 'mid' : 'bad';
    tip.innerHTML = `<div class="tt-head"><b>${esc(B.label)}</b><span class="score ${s.ok ? cls : 'bad'}">${s.ok ? `Eignung ${pct} %` : 'nicht möglich'}</span></div>
      <ul>${s.reasons.map(([t, txt]) => `<li class="r-${t === '+' ? 'good' : t === '○' ? 'mid' : 'bad'}"><i>${t}</i>${esc(txt)}</li>`).join('')}</ul>
      ${s.ok ? `<div class="tt-foot">${fmtInt(B.cost)} · ${B.days} Tage · Klick baut</div>` : ''}`;
    tip.hidden = false;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    tip.style.left = `${Math.min(window.innerWidth - w - 8, pageX + 16)}px`;
    tip.style.top = `${Math.min(window.innerHeight - h - 8, pageY + 16)}px`;
  }

  /** Klick im Baumodus: bauen. Gibt true zurück, wenn der Klick verbraucht wurde. */
  click(cell) {
    if (!this.buildType) return false;
    const sim = this.sim;
    const res = build(sim, this.n, this.buildType, cell, this.fields);
    if (res) {
      const B = sim.bal.economy.buildings[this.buildType];
      sim.log('build', `Bau begonnen: ${B.label} bei ${res.building.siteName} (Eignung ${Math.round(res.suitability.score * 100)} %, fertig in ${B.days} Tagen).`, cell);
      this.setBuildMode(null);
      this.onChange();
    }
    return true;
  }

  selectCell(cell) {
    this.sector = cell >= 0 && this.sim.grid.territory[cell] ? this.sim.sectors.sectorOf[cell] : -1;
    this.renderer.selectedSector = this.sector;
    this.refresh();
  }

  railInfo(cell) {
    const sim = this.sim;
    if (!sim.railState[cell]) return 'keine Bahn';
    const node = sim.nodeAt[cell] >= 0 ? sim.nodes[sim.nodeAt[cell]] : null;
    const bridge = sim.bridgeAt[cell] >= 0 ? sim.bridges[sim.bridgeAt[cell]] : null;
    const parts = [`Strecke ${STATE_LABEL[sim.railState[cell]]}`];
    if (sim.railState[cell] !== INTACT) parts.push(`Instandsetzung ${Math.round(sim.railProgress[cell] * 100)} %`);
    if (node) parts.push(`Knoten ${node.name} (${STATE_LABEL[node.state]})`);
    if (bridge) parts.push(`${bridge.name} (${STATE_LABEL[bridge.state]})`);
    return parts.join(' · ');
  }
}

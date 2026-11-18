// Wirtschaftsoberfläche (Phase 3): Kennzahlen oben, Seitenleiste im Modus "Wirtschaft"
// (Mobilisierung, Produktion, Rohstoffe, Infrastruktur, Bauen) und Standortwahl.
import { fmtInt } from '../sim/calendar.js';
import { labor, raiseDivision, canRaiseDivision, siteFields, siteSuitability, build } from '../sim/economy.js';
import { upgradeCost, startUpgrade, STATE_LABEL, INTACT } from '../sim/infra.js';
import { FOCI, resultCost, dailyPoints, scientistBonus } from '../sim/research.js';
import { bestPlace, relocate } from '../sim/scientists.js';
import { nationRevealed } from '../sim/intel.js';

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
    this.tab = 'wirtschaft';
    this.buildFocus = null;
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
    set('money', fmtInt(e.money), `${sign(net)}`, `Geld (Mio. RM-Gegenwert). Heute: Einnahmen ${f1(e.incomeToday)}, Unterhalt ${f1(e.upkeepToday)}, Bau/Ausbau ${f1(e.spentToday)}`);
    set('resources', fmtInt(e.resources), `${sign(resNet)}`, `Rohstoffe (Kohle, Erz, Öl als ein Wert). Förderung ${f1(e.resProducedToday)}, Verbrauch Rüstung ${f1(e.resUsedToday)}`);
    set('manpower', (e.workers / 1e6).toFixed(1).replace('.', ','), 'Mio.', `Arbeiter ${f1(e.workers / 1e6)} Mio., Soldaten-Ziel ${f1(e.soldiersTarget / 1e6)} Mio., Ersatz verfügbar ${fmtInt(e.pool)}`);
  }

  // ---------------------------------------------------------------- Seitenleiste
  refresh() {
    this.renderKpis();
    const tabs = `<div class="tabs" role="tablist">
      <button type="button" role="tab" aria-selected="${this.tab === 'wirtschaft'}" data-action="tab" data-tab="wirtschaft">Wirtschaft</button>
      <button type="button" role="tab" aria-selected="${this.tab === 'forschung'}" data-action="tab" data-tab="forschung">Forschung</button>
    </div>`;
    if (this.tab === 'forschung') { $('econ').innerHTML = tabs + this.researchHtml(); return; }
    this.renderEconomy(tabs);
  }

  // ---------------------------------------------------------------- Forschung
  researchHtml() {
    const sim = this.sim;
    const R = sim.bal.research;
    const n = this.n;
    const tr = sim.research.get(n);
    const labs = sim.buildings.filter((b) => b.type === 'forschung' && sim.owner[b.cell] === n);
    const tracks = FOCI.map((f) => {
      const t = tr[f];
      const res = R.foci[f].results;
      const done = t.level >= res.length;
      const cost = done ? 1 : resultCost(sim, t.level);
      const perDay = labs.filter((b) => b.done && b.focus === f).reduce((s2, b) => s2 + dailyPoints(sim, b), 0);
      const next = done ? null : res[t.level];
      const eta = !done && perDay > 0 ? Math.ceil((cost - t.progress) / perDay) : null;
      return `<div class="track">
        <div class="ec-row"><b>${esc(R.foci[f].label)}</b><span class="lvl">${t.level}/${res.length}</span></div>
        ${done ? '<p class="hint">Alle Ergebnisse erreicht.</p>' : `
        <div class="pbar big"><i style="width:${Math.min(100, (t.progress / cost) * 100).toFixed(1)}%"></i></div>
        <p class="ec-sub">Nächstes: <b>${esc(next.name)}</b> – ${esc(next.text)}${next.needs && !sim.resourceRegions.some((r) => r.kind === next.needs && r.cells.some((c) => sim.owner[c] === n)) ? ' · <b>fehlt: Uran</b>' : ''}</p>
        <p class="ec-sub">${f1(perDay)} Punkte/Tag · ${eta ? `noch ca. ${eta} Tage` : 'kein Budget'}</p>`}
        ${t.level ? `<p class="ec-sub done">Erreicht: ${res.slice(0, t.level).map((r) => esc(r.name)).join(', ')}</p>` : ''}
      </div>`;
    }).join('');
    const labRows = labs.map((b) => {
      const bonus = scientistBonus(sim, b);
      return `<li><span title="${esc(b.siteName)}">${esc(b.siteName)} · ${esc(R.foci[b.focus].label)}${bonus ? ` · +${Math.round(bonus * 100)} %` : ''}${b.done ? '' : ' · im Bau'}</span>
        <span class="seg mini">${[0, R.defaultBudget, R.maxBudget].map((v) => `<button type="button" role="radio" aria-checked="${Math.abs((b.budget || 0) - v) < 1e-6}" data-action="budget" data-id="${b.id}" data-v="${v}">${v ? f1(v) : 'aus'}</button>`).join('')}</span></li>`;
    }).join('');
    const mine = sim.scientists.filter((x) => x.employer === n);
    const sciRows = mine.map((x) => {
      const active = x.cell >= 0 && labs.some((b) => b.done && b.focus === x.field && sim.sectors.sectorOf[b.cell] === sim.sectors.sectorOf[x.cell]);
      const loyalty = Math.round(x.loyalty * 100);
      return `<li class="sci"><div><b>${esc(x.name)}</b> · ${esc(x.topic)}${x.origin !== n ? ` <span class="warn">(aus ${esc(sim.nationName(x.origin))})</span>` : ''}</div>
        <div class="ec-sub">${x.status === 'aktiv' ? esc(x.cell >= 0 ? sim.nearestCityName(x.cell % sim.cols, Math.floor(x.cell / sim.cols), 4) : '–') : esc(x.place)} · Bonus ${Math.round(x.bonus * 100)} % ${x.field === 'geheimdienst' ? '(Abwehr)' : active ? '(wirkt)' : '(keine passende Anstalt in der Region)'} · Loyalität ${loyalty} %</div>
        <div class="row">
          <span class="seg mini" title="Bewachung kostet ${f1(sim.bal.scientists.guardCostPerLevel)} je Stufe und Tag">${[0, 1, 2].map((g) => `<button type="button" role="radio" aria-checked="${x.guard === g}" data-action="guard" data-id="${x.id}" data-v="${g}">Wache ${g}</button>`).join('')}</span>
          ${x.field !== 'geheimdienst' && x.status === 'aktiv' && !active ? `<button type="button" class="btn small" data-action="relocate" data-id="${x.id}">versetzen</button>` : ''}
        </div></li>`;
    }).join('');
    const foreign = [...sim.research].filter(([m]) => m !== n && sim.isWar(m, n));
    const intelRows = foreign.map(([m, t]) => `<li>${esc(sim.nationName(m))}: ${nationRevealed(sim, n, m) ? FOCI.map((f) => `${esc(R.foci[f].label)} ${t[f].level}`).join(' · ') : '<i>unbekannt – Aufklärung nötig</i>'}</li>`).join('');
    return `<section><h2>Forschung</h2>${tracks}</section>
      <section><h2>Anstalten (Budget je Tag)</h2>
        ${labs.length ? `<ul class="labs">${labRows}</ul>` : '<p class="hint">Keine Forschungsanstalt.</p>'}
        <div class="ec-label">Neue Forschungsanstalt (Schwerpunkt wählen, dann Ort anklicken)</div>
        <div class="seg">${FOCI.map((f) => `<button type="button" role="radio" aria-checked="${this.buildType === 'forschung' && this.buildFocus === f}" data-action="buildlab" data-focus="${f}">${esc(R.foci[f].label.split(' ')[0])}</button>`).join('')}</div>
      </section>
      <section><h2>Wissenschaftler</h2>${mine.length ? `<ul class="labs">${sciRows}</ul>` : '<p class="hint">Keine.</p>'}</section>
      ${foreign.length ? `<section><h2>Forschungsstand der Gegner</h2><ul class="labs">${intelRows}</ul></section>` : ''}`;
  }

  renderEconomy(tabs) {
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
    $('econ').innerHTML = `${tabs}
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
      case 'build':
        if (b.dataset.type === 'forschung') { this.tab = 'forschung'; break; } // Schwerpunkt im Reiter Forschung wählen
        this.buildFocus = null;
        this.setBuildMode(this.buildType === b.dataset.type ? null : b.dataset.type);
        return;
      case 'tab': this.tab = b.dataset.tab; break;
      case 'budget': { const x = sim.buildings.find((y) => y.id === Number(b.dataset.id)); if (x) x.budget = Number(b.dataset.v); break; }
      case 'guard': { const x = sim.scientists.find((y) => y.id === b.dataset.id); if (x) x.guard = Number(b.dataset.v); break; }
      case 'relocate': { const x = sim.scientists.find((y) => y.id === b.dataset.id); if (x) relocate(sim, x, bestPlace(sim, x)); break; }
      case 'buildlab': {
        const f = b.dataset.focus;
        if (this.buildType === 'forschung' && this.buildFocus === f) { this.buildFocus = null; this.setBuildMode(null); return; }
        this.buildFocus = f;
        this.setBuildMode('forschung');
        return;
      }
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
    const res = build(sim, this.n, this.buildType, cell, this.fields, this.buildFocus || 'heer');
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

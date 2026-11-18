// Hauptmenü (Phase 5): Kampagne, Sandbox, Spiel laden, Einstellungen, Beenden.
// Einstellungen werden im Browser gespeichert (Spieltempo, Lautstärke für später, Grafikdetail).

import { loadCredits, creditsHtml } from './menuMedia.js';

const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'durchbruch-settings';

export function saveSettingsNow(s) { saveSettings(s); }

export function loadSettings() {
  const def = { speed: 1, volume: 70, detail: 'hoch', music: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return def; }
}

function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* privat: ohne Speicherung */ }
}

export class MainMenu {
  /**
   * @param {object} o
   * @param {object} o.levels  Schwierigkeitsstufen aus balance.json
   * @param {() => boolean} o.inGame  läuft bereits ein Spiel (Tag > 0)?
   * @param {(level: string, sandbox: boolean) => void} o.onStart
   * @param {(kind: 'load'|'auto'|'import') => void} o.onLoad
   * @param {() => void} o.onResume
   * @param {(s: object) => void} o.onSettings
   */
  constructor(o) {
    Object.assign(this, o);
    this.settings = this.settings || loadSettings();
    this.level = 'normal';
    this.unlimited = true;
    this.panel = 'main';
    $('menu').addEventListener('click', (e) => this.onClick(e));
    $('menu').addEventListener('change', (e) => this.onInput(e));
    $('menu').addEventListener('input', (e) => this.onInput(e));
  }

  get open() { return !$('menu').hidden; }

  show(panel = 'main') {
    this.panel = panel;
    this.render();
    $('menu').hidden = false;
    $('menu-body').querySelector('button')?.focus();
    if (this.onVisible) this.onVisible(true);
  }

  hide() { $('menu').hidden = true; if (this.onVisible) this.onVisible(false); }

  levelsHtml() {
    return Object.entries(this.levels).map(([k, v]) => `<label><input type="radio" name="level" value="${k}" ${k === this.level ? 'checked' : ''}>${esc(v.label)}
      <small>${k === 'leicht' ? 'KI zurückhaltender, höhere Erträge, besserer Nachschub' : k === 'schwer' ? 'KI angriffslustiger, geringere Erträge, schwächerer Nachschub' : 'ausgewogen'}</small></label>`).join('');
  }

  render() {
    const s = this.settings;
    let html = '';
    switch (this.panel) {
      case 'campaign':
        html = `<div class="menu-panel"><h2>Kampagne</h2>
          <p>Deutsches Reich, 31. August 1939. Startwerte sind auf allen Stufen gleich; die Schwierigkeit wirkt über KI, Erträge, Nachschub, Moral und Geheimdienst.</p>
          <fieldset><legend>Schwierigkeit</legend>${this.levelsHtml()}</fieldset>
          <button type="button" class="menu-start" data-m="start-campaign">Kampagne beginnen</button>
          <button type="button" class="menu-back" data-m="main">Zurück</button></div>`;
        break;
      case 'sandbox':
        html = `<div class="menu-panel"><h2>Sandbox</h2>
          <p>Freies Spiel ab 31. August 1939.</p>
          <fieldset><legend>Mittel</legend><label><input type="checkbox" id="m-unlimited" ${this.unlimited ? 'checked' : ''}>unbegrenzte Mittel<small>Geld, Rohstoffe und Arbeitskräfte gehen nie aus</small></label></fieldset>
          <fieldset><legend>Schwierigkeit</legend>${this.levelsHtml()}</fieldset>
          <button type="button" class="menu-start" data-m="start-sandbox">Sandbox beginnen</button>
          <button type="button" class="menu-back" data-m="main">Zurück</button></div>`;
        break;
      case 'load': {
        const has = (k) => { try { return !!localStorage.getItem(k); } catch { return false; } };
        html = `<div class="menu-panel"><h2>Spiel laden</h2>
          <div class="menu-list">
            <button type="button" data-m="load" ${has('durchbruch-save') ? '' : 'disabled'}>Gespeicherter Spielstand</button>
            <button type="button" data-m="auto" ${has('durchbruch-auto') ? '' : 'disabled'}>Automatischer Spielstand</button>
            <button type="button" data-m="import">Aus Datei laden …</button>
          </div>
          <button type="button" class="menu-back" data-m="main">Zurück</button></div>`;
        break;
      }
      case 'settings':
        html = `<div class="menu-panel"><h2>Einstellungen</h2>
          <fieldset><legend>Spieltempo beim Fortsetzen</legend><div class="seg">${[1, 2, 4].map((v) => `<button type="button" data-speed="${v}" aria-pressed="${s.speed === v}">${v}×</button>`).join('')}</div></fieldset>
          <fieldset><legend>Lautstärke</legend><input type="range" id="m-volume" min="0" max="100" value="${s.volume}" aria-label="Lautstärke"><small>${s.volume} % – Menümusik folgt (Download der Aufnahmen steht noch aus)</small></fieldset>
          <fieldset><legend>Grafikdetail</legend><div class="seg">${['hoch', 'niedrig'].map((v) => `<button type="button" data-detail="${v}" aria-pressed="${s.detail === v}">${v === 'hoch' ? 'Hoch' : 'Niedrig'}</button>`).join('')}</div><small>Niedrig: Fronten als schlichte Linie, kein Pulsieren.</small></fieldset>
          <button type="button" class="menu-back" data-m="main">Zurück</button></div>`;
        break;
      case 'credits':
        html = `<div class="menu-panel credits-panel"><h2>Mitwirkende</h2><div id="m-credits"><p class="menu-wait">Nachweise werden geladen …</p></div>
          <button type="button" class="menu-back" data-m="main">Zurück</button></div>`;
        loadCredits().then((c) => { const el = $('m-credits'); if (el) el.innerHTML = creditsHtml(c, esc); });
        break;
      case 'bye':
        html = `<div class="menu-panel"><p class="menu-bye">Das Spiel ist beendet. Das Fenster kann jetzt geschlossen werden.</p>
          <button type="button" class="menu-back" data-m="main">Zurück zum Menü</button></div>`;
        break;
      default:
        html = `<div class="menu-list">
            ${this.inGame() ? '<button type="button" data-m="resume">Weiterspielen</button>' : ''}
            <button type="button" data-m="campaign">Kampagne</button>
            <button type="button" data-m="sandbox">Sandbox</button>
            <button type="button" data-m="load-panel">Spiel laden</button>
            <button type="button" data-m="settings">Einstellungen</button>
            <button type="button" data-m="credits">Mitwirkende</button>
            <button type="button" data-m="quit">Beenden</button>
          </div>
          <p class="menu-foot">Privates Strategiespiel · Spielwerte sind Platzhalter, keine historischen Angaben</p>`;
    }
    $('menu-body').innerHTML = html;
  }

  onClick(e) {
    const sp = e.target.closest('[data-speed]');
    if (sp) { this.settings.speed = Number(sp.dataset.speed); saveSettings(this.settings); this.onSettings(this.settings); this.render(); return; }
    const mu = e.target.closest('[data-music]');
    if (mu) { this.settings.music = mu.dataset.music === 'true'; saveSettings(this.settings); this.onSettings(this.settings); this.render(); return; }
    const dt = e.target.closest('[data-detail]');
    if (dt) { this.settings.detail = dt.dataset.detail; saveSettings(this.settings); this.onSettings(this.settings); this.render(); return; }
    const b = e.target.closest('[data-m]');
    if (!b) return;
    const m = b.dataset.m;
    switch (m) {
      case 'main': case 'campaign': case 'sandbox': case 'settings': case 'credits': this.show(m); break;
      case 'load-panel': this.show('load'); break;
      case 'resume': this.hide(); this.onResume(); break;
      case 'start-campaign': this.onStart(this.level, false); break;
      case 'start-sandbox': this.onStart(this.level, this.unlimited); break;
      case 'load': case 'auto': case 'import': this.onLoad(m); break;
      case 'quit': this.show('bye'); try { window.close(); } catch { /* Browser lässt Schließen nicht zu */ } break;
      default:
    }
  }

  onInput(e) {
    if (e.target.name === 'level') this.level = e.target.value;
    if (e.target.id === 'm-unlimited') this.unlimited = e.target.checked;
    if (e.target.id === 'm-volume') {
      this.settings.volume = Number(e.target.value);
      saveSettings(this.settings);
      this.onSettings(this.settings);
      const sm = e.target.parentElement.querySelector('small');
      if (sm) sm.textContent = `${this.settings.volume} % – Menümusik folgt (Download der Aufnahmen steht noch aus)`;
    }
  }
}

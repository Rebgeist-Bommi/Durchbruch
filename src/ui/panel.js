import { inverse } from '../data/projection.js';
import { flagUrl } from './flags.js';

const $ = (id) => document.getElementById(id);

function fmtCoord(lon, lat) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lon >= 0 ? 'O' : 'W';
  return `${Math.abs(lat).toFixed(2).replace('.', ',')}° ${ns}, ${Math.abs(lon).toFixed(2).replace('.', ',')}° ${ew}`;
}

/** Seitenleiste: Nationenanzeige und Feldinformation. */
export class Panel {
  constructor(grid, playerNation = 'DEU') {
    this.grid = grid;
    this.sim = null;
    this.selected = -1;
    $('nation-flag').src = flagUrl(playerNation);
    $('nation-flag').alt = `Flagge ${grid.nationNames[playerNation]}`;
    $('nation-name').textContent = grid.nationNames[playerNation];
  }

  showCell(i) {
    const g = this.grid;
    this.selected = i;
    if (i < 0) {
      $('field-info').hidden = true;
      $('field-hint').hidden = false;
      $('field-hint').textContent = 'Außerhalb der Karte.';
      return;
    }
    const [row, col] = g.rowCol(i);
    const b = g.cellBounds(i);
    const [lon, lat] = inverse((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
    $('field-hint').hidden = true;
    $('field-info').hidden = false;
    const owner = g.ownerOf(i);
    const terr = g.territoryOf(i);
    $('f-flag').hidden = !owner;
    if (owner) {
      $('f-flag').src = flagUrl(owner);
      $('f-flag').alt = `Flagge ${g.nationNames[owner]}`;
    }
    $('f-owner').textContent = owner ? g.nationNames[owner] : 'Meer – kein Besitzer';
    $('f-territory').textContent = terr ? terr.name : '–';
    $('f-terrain').textContent = g.terrainOf(i);
    $('f-cell').textContent = `Spalte ${col}, Zeile ${row} (9 × 9 km)`;
    $('f-coord').textContent = fmtCoord(lon, lat);
    $('f-neighbors').textContent = g.isLand(i) ? `${g.neighbors(i).length} Landfelder` : '–';
    const sim = this.sim;
    const land = g.isLand(i) && sim;
    $('f-fort').textContent = land ? `${Math.round(sim.fort[i] * 100)} %` : '–';
    $('f-supply').textContent = land && sim.supplyDist.has(sim.player) ? `${Math.round(sim.supply(sim.player, i) * 100)} % (für ${sim.nationName(sim.player)})` : '–';
    if (land && sim.conqDay[i] >= 0) {
      const how = sim.conqMethod[i] === 2 ? 'verwüstet' : sim.conqMethod[i] === 1 ? 'erobert' : 'angegliedert';
      $('f-yield').textContent = `${Math.round(sim.yieldOf(i) * 100)} % (${how} am ${sim.dateText(sim.conqDay[i])})`;
    } else {
      $('f-yield').textContent = land ? '100 %' : '–';
    }
    if (land) {
      $('f-rail').textContent = this.railInfo ? this.railInfo(i) : '–';
      const list = sim.buildingsAt.get(i) || [];
      const site = sim.industrySites.find((x) => x.cell === i);
      const cnt = (t) => list.filter((b) => b.type === t && b.done).length;
      const open = list.filter((b) => !b.done).length;
      const health = list.length ? Math.round((list.reduce((s2, b) => s2 + b.health, 0) / list.length) * 100) : 100;
      $('f-industry').textContent = list.length
        ? `${site ? `${site.name}: ` : ''}${cnt('fabrik')} Fabrik, ${cnt('ruestung')} Rüstung, ${cnt('forschung')} Forschung${open ? `, ${open} im Bau` : ''}${health < 100 ? ` · Zustand ${health} %` : ''}`
        : '–';
    } else {
      $('f-rail').textContent = '–';
      $('f-industry').textContent = '–';
    }
    const si = sim ? sim.siegeAt[i] : -1;
    if (si >= 0) {
      const s = sim.sieges[si];
      $('f-terrain').textContent += s.fallen ? ' · Stadt gefallen' : ` · Großstadt, Verteidigung ${Math.round(s.defense)}/${s.max}${s.besieged ? ' (belagert)' : ''}`;
    }
  }
}

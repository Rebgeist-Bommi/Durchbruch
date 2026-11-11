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
    $('nation-flag').src = flagUrl(playerNation);
    $('nation-flag').alt = `Flagge ${grid.nationNames[playerNation]}`;
    $('nation-name').textContent = grid.nationNames[playerNation];
  }

  showCell(i) {
    const g = this.grid;
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
  }
}

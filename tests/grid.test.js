import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Grid } from '../src/data/grid.js';
import { parseRelief, decodeMap } from '../src/data/loader.js';

const dir = new URL('../public/data/', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('grid.json', dir), 'utf8'));
const grid = new Grid(meta, readFileSync(new URL('grid.bin', dir)));

// Dieselben Punktproben wie in tools/tests/test_points.py – hier über die Spiel-API
const SAMPLES = [
  ['Prag', 50.0755, 14.4378, 'CSR'],
  ['Wien', 48.2082, 16.3738, 'DEU'],
  ['Pressburg', 48.1486, 17.1077, 'CSR'],
  ['Chust', 48.17, 23.3, 'HUN'],
  ['Memel', 55.71, 21.13, 'LTU'],
  ['Danzig', 54.352, 18.6466, 'DAN'],
  ['Karwin', 49.85, 18.54, 'POL'],
  ['Warschau', 52.2297, 21.0122, 'POL'],
  ['Paris', 48.8566, 2.3522, 'FRA'],
];

for (const [name, lat, lon, owner] of SAMPLES) {
  test(`Punktprobe ${name} -> ${owner}`, () => {
    const i = grid.cellAtLonLat(lon, lat);
    assert.ok(i >= 0, 'außerhalb des Rasters');
    assert.equal(grid.ownerOf(i), owner, `${name}: ${grid.ownerOf(i)} (${grid.territoryOf(i)?.key})`);
  });
}

test('Terrain: Zugspitze Gebirge, Berlin Ebene, Meer ist Meer', () => {
  assert.equal(grid.terrainOf(grid.cellAtLonLat(10.98, 47.42)), 'Gebirge');
  assert.equal(grid.terrainOf(grid.cellAtLonLat(13.405, 52.52)), 'Ebene');
  assert.equal(grid.terrainOf(grid.cellAtLonLat(-20, 45)), 'Meer');
});

test('Nachbarn: symmetrisch, höchstens 4, nur Land', () => {
  let checked = 0;
  for (let i = 0; i < grid.size; i += 7) {
    if (!grid.isLand(i)) continue;
    const nb = grid.neighbors(i);
    assert.ok(nb.length <= 4);
    for (const j of nb) {
      assert.ok(grid.isLand(j));
      assert.ok(grid.neighbors(j).includes(i));
    }
    checked++;
  }
  assert.ok(checked > 10000);
});

test('Feldgröße 9 km, Feldgrenzen enthalten den Punkt', () => {
  assert.equal(grid.cellSize, 9000);
  const i = grid.cellAtWorld(4638483, 3005512);
  const b = grid.cellBounds(i);
  assert.ok(b.x0 <= 4638483 && 4638483 < b.x1 && b.y0 <= 3005512 && 3005512 < b.y1);
});

test('Relief und Karte lassen sich dekodieren', () => {
  const buf = readFileSync(new URL('relief.bin', dir));
  const relief = parseRelief(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  assert.ok(relief.triCount > 10000);
  assert.equal(relief.tones.length, relief.triCount);
  const map = decodeMap(JSON.parse(readFileSync(new URL('map.json', dir), 'utf8')));
  assert.ok(map.territories.find((t) => t.key === 'DAN'));
  assert.equal(map.fronts.length, 2);
});

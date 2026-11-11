import test from 'node:test';
import assert from 'node:assert/strict';
import { forward, inverse } from '../src/data/projection.js';

// Referenzwerte aus pyproj (EPSG:4326 -> EPSG:3035)
const REF = [
  [14.4378, 50.0755, 4638483.08, 3005512.589],
  [2.3522, 48.8566, 3760771.865, 2889484.802],
  [-9.139, 38.722, 2665537.073, 1946725.128],
  [37.617, 55.756, 6006421.861, 3957775.669],
  [10, 52, 4321000.0, 3210000.0],
];

test('forward stimmt mit pyproj auf 1 m überein', () => {
  for (const [lon, lat, x, y] of REF) {
    const [px, py] = forward(lon, lat);
    assert.ok(Math.abs(px - x) < 1 && Math.abs(py - y) < 1, `${lon},${lat}: ${px},${py}`);
  }
});

test('inverse ist Umkehrung von forward', () => {
  for (const [lon, lat] of REF) {
    const [l2, b2] = inverse(...forward(lon, lat));
    assert.ok(Math.abs(l2 - lon) < 1e-7 && Math.abs(b2 - lat) < 1e-7, `${lon},${lat} -> ${l2},${b2}`);
  }
});

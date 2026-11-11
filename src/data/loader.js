// Lädt die in tools/ erzeugten Spieldateien aus public/data.
// Karteneinheit ("map units"): Hektometer ab (originX, originY) der map.json, y nach Norden.

/** relief.bin -> Dreiecke in Karteneinheiten. Format siehe tools/build_relief.py. */
export function parseRelief(buffer, mapOriginX = 2500000, mapOriginY = 1350000, mapUnit = 100) {
  const view = new DataView(buffer);
  const nVerts = view.getUint32(0, true);
  const nTris = view.getUint32(4, true);
  const ox = view.getInt32(8, true);
  const oy = view.getInt32(12, true);
  const unit = view.getUint32(16, true);
  let off = 20;
  const verts = new Uint16Array(buffer.slice(off, off + nVerts * 4));
  off += nVerts * 4;
  const idx = new Uint32Array(buffer.slice(off, off + nTris * 12));
  off += nTris * 12;
  const tones = new Uint8Array(buffer.slice(off, off + nTris));
  const k = unit / mapUnit;
  const bx = (ox - mapOriginX) / mapUnit;
  const by = (oy - mapOriginY) / mapUnit;
  const coords = new Float32Array(nTris * 6);
  for (let t = 0; t < nTris; t++) {
    for (let v = 0; v < 3; v++) {
      const vi = idx[t * 3 + v];
      coords[t * 6 + v * 2] = bx + verts[vi * 2] * k;
      coords[t * 6 + v * 2 + 1] = by + verts[vi * 2 + 1] * k;
    }
  }
  return { triCount: nTris, coords, tones };
}

/** map.json -> unverändert, ergänzt um Umrechnungsfunktionen. */
export function decodeMap(json) {
  const { originX, originY, unit } = json;
  return {
    ...json,
    worldToMap: (x, y) => [(x - originX) / unit, (y - originY) / unit],
    mapToWorld: (mx, my) => [originX + mx * unit, originY + my * unit],
  };
}

export async function loadAll(base) {
  const get = async (name) => {
    const r = await fetch(`${base}data/${name}`);
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    return r;
  };
  const [mapJson, gridMeta, gridBuf, reliefBuf] = await Promise.all([
    get('map.json').then((r) => r.json()),
    get('grid.json').then((r) => r.json()),
    get('grid.bin').then((r) => r.arrayBuffer()),
    get('relief.bin').then((r) => r.arrayBuffer()),
  ]);
  const map = decodeMap(mapJson);
  return { map, gridMeta, gridBuf, relief: parseRelief(reliefBuf, map.originX, map.originY, map.unit) };
}

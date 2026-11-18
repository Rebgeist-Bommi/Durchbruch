"""Schritt 6 (Phase 3): Infrastruktur, Industriezentren und Rohstoffgebiete -> public/data/infra.json

Inhalt:
  rail       Feldindizes mit Bahnstrecke (Natural Earth 10m, scalerank <= 7), aufsteigend,
             als Differenzen gespeichert (erster Wert absolut)
  nodes      Bahnknoten: Abzweigungen (Endpunkte von mindestens 3 Streckenstücken) und
             Bahnhöfe in Städten; je Knoten {c: Feld, n: Name}
  bridges    Eisenbahnbrücken über große Flüsse (Natural Earth 50m, scalerank <= 5)
  industry   Industriezentren zum Start (tools/data/industry.csv) mit Feld
  resources  Rohstoffgebiete (tools/data/resources.csv) mit ihren Feldern
"""
import json
import sys
from collections import Counter
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from rasterio.features import rasterize
from rasterio.transform import from_origin
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import BBOX, CACHE, CELL, COLS, CRS, DATA, OUT, RAIL_MAX_SCALERANK, ROWS, SOURCES, X_MIN, Y_MAX  # noqa: E402

RIVER_MAX_SCALERANK = 5
RIVER_DE = {
    "Vistula": "Weichsel", "Rhine": "Rhein", "Danube": "Donau", "Warta": "Warthe", "Neman": "Memel",
    "Dnieper": "Dnjepr", "Dniester": "Dnjestr", "Volga": "Wolga", "Meuse": "Maas", "Moselle": "Mosel",
    "Thames": "Themse", "Western Dvina": "Düna", "Daugava": "Düna", "Vltava": "Moldau", "Tisza": "Theiß",
    "Sava": "Save", "Drava": "Drau", "Prut": "Pruth", "Pripyat": "Pripjet", "Rhône": "Rhône",
    "Narew": "Narew", "Bug": "Bug", "Western Bug": "Bug", "Southern Bug": "Südlicher Bug", "Don": "Don",
    "Desna": "Desna", "Zapadnaya Dvina": "Düna", "Elbe": "Elbe", "Oder": "Oder", "Seine": "Seine", "Loire": "Loire", "Po": "Po",
}
NODE_MERGE_CELLS = 3


def cell_of(x, y):
    c = int((x - X_MIN) // CELL)
    r = int((Y_MAX - y) // CELL)
    if 0 <= c < COLS and 0 <= r < ROWS:
        return r * COLS + c
    return -1


def main() -> None:
    grid = np.frombuffer((OUT / "grid.bin").read_bytes(), dtype=np.uint8)
    land = grid[: ROWS * COLS].reshape(ROWS, COLS) > 0
    frame = box(*BBOX)

    rails = gpd.read_file(CACHE / SOURCES["ne_railroads"]["file"])
    rails = rails[rails.scalerank <= RAIL_MAX_SCALERANK].to_crs(CRS)
    rails = rails[rails.intersects(frame)]
    geoms = [g for g in shapely.intersection(rails.geometry.values, frame) if not g.is_empty]
    raster = rasterize(((g, 1) for g in geoms), out_shape=(ROWS, COLS),
                       transform=from_origin(X_MIN, Y_MAX, CELL, CELL), fill=0, dtype="uint8", all_touched=True)
    raster = (raster == 1) & land
    rail_cells = np.flatnonzero(raster.ravel())

    # Abzweigungen: Endpunkte der Streckenstücke, die in einem Feld mindestens dreimal vorkommen
    ends = Counter()
    for g in geoms:
        for line in getattr(g, "geoms", [g]):
            if line.geom_type != "LineString":
                continue
            for x, y in (line.coords[0], line.coords[-1]):
                c = cell_of(x, y)
                if c >= 0 and raster.ravel()[c]:
                    ends[c] += 1
    junctions = [c for c, k in ends.items() if k >= 3]

    cities = pd.read_csv(DATA / "cities.csv")
    cg = gpd.GeoDataFrame(cities, geometry=gpd.points_from_xy(cities.lon, cities.lat), crs=4326).to_crs(CRS)
    city_cells = []
    rail_flat = raster.ravel()
    for r in cg.itertuples():
        c = cell_of(r.geometry.x, r.geometry.y)
        if c < 0:
            continue
        # Bahnhof: Bahnfeld im Umkreis von 1 Feld
        rr, cc = divmod(c, COLS)
        best = None
        for dr in (-1, 0, 1):
            for dc in (-1, 0, 1):
                j = (rr + dr) * COLS + cc + dc
                if 0 <= rr + dr < ROWS and 0 <= cc + dc < COLS and rail_flat[j]:
                    best = j if best is None or (dr == 0 and dc == 0) else best
        if best is not None:
            city_cells.append((best, r.name, int(r.rank)))

    def nearest_city(c):
        """(Name, Abstand in Feldern) der nächsten Stadt."""
        rr, cc = divmod(c, COLS)
        best, bd = "", 1e18
        for r in cg.itertuples():
            cx = (r.geometry.x - X_MIN) / CELL
            cy = (Y_MAX - r.geometry.y) / CELL
            d = (cx - cc - 0.5) ** 2 + (cy - rr - 0.5) ** 2
            if d < bd:
                bd, best = d, r.name
        return best, bd ** 0.5

    nodes = [(c, name, rank) for c, name, rank in sorted(city_cells, key=lambda t: (t[2], t[0]))]
    for c in sorted(junctions):
        nodes.append((c, None, 9))
    kept = []
    for c, name, rank in nodes:
        rr, cc = divmod(c, COLS)
        if any(abs(rr - k[0] // COLS) <= NODE_MERGE_CELLS and abs(cc - k[0] % COLS) <= NODE_MERGE_CELLS for k in kept):
            continue
        if not name:
            city, dist = nearest_city(c)
            name = f"Bahnknoten bei {city}" if dist > 2 else city
        kept.append((c, name, rank))
    kept.sort(key=lambda t: t[0])

    # Brücken: Schnitt Bahn x großer Fluss
    rivers = gpd.read_file(CACHE / SOURCES["ne_rivers"]["file"])
    rivers = rivers[(rivers.scalerank <= RIVER_MAX_SCALERANK) & (rivers.featurecla.str.contains("River"))].to_crs(CRS)
    rivers = rivers[rivers.intersects(frame)]
    rail_union = shapely.union_all(geoms)
    bridges = []
    seen = []
    for rv in rivers.itertuples():
        inter = rv.geometry.intersection(rail_union)
        pts = [p for p in getattr(inter, "geoms", [inter]) if p.geom_type == "Point"]
        for p in pts:
            c = cell_of(p.x, p.y)
            if c < 0 or not land.ravel()[c]:
                continue
            rr, cc = divmod(c, COLS)
            if any(abs(rr - s // COLS) <= 2 and abs(cc - s % COLS) <= 2 for s in seen):
                continue
            seen.append(c)
            river = rv.name_en if isinstance(rv.name_en, str) and rv.name_en else rv.name
            river = RIVER_DE.get(str(river), str(river))
            bridges.append({"c": c, "river": river, "name": f"{river}brücke bei {nearest_city(c)[0]}"})
    bridges.sort(key=lambda b: b["c"])

    def snap_land(c):
        if c >= 0 and land.ravel()[c]:
            return c
        rr, cc = divmod(c, COLS)
        for rad in range(1, 6):
            for dr in range(-rad, rad + 1):
                for dc in range(-rad, rad + 1):
                    j = (rr + dr) * COLS + cc + dc
                    if 0 <= rr + dr < ROWS and 0 <= cc + dc < COLS and land.ravel()[j]:
                        return j
        return -1

    def to_cell(lat, lon):
        p = gpd.GeoSeries(gpd.points_from_xy([lon], [lat]), crs=4326).to_crs(CRS).iloc[0]
        return snap_land(cell_of(p.x, p.y)) if frame.contains(p) else -1

    industry = []
    for r in pd.read_csv(DATA / "industry.csv").itertuples():
        c = to_cell(r.lat, r.lon)
        if c < 0:
            print(f"  außerhalb des Ausschnitts: {r.name}")
            continue
        industry.append({"name": r.name, "nation": r.nation, "c": c, "fabrik": int(r.fabrik),
                         "ruestung": int(r.ruestung), "forschung": int(r.forschung), "note": r.hinweis})
    resources = []
    for r in pd.read_csv(DATA / "resources.csv").itertuples():
        c = to_cell(r.lat, r.lon)
        if c < 0:
            print(f"  außerhalb des Ausschnitts: {r.name}")
            continue
        rr, cc = divmod(c, COLS)
        rad = int(r.radius_cells)
        cells = []
        for dr in range(-rad, rad + 1):
            for dc in range(-rad, rad + 1):
                if dr * dr + dc * dc > rad * rad + 0.5:
                    continue
                j = (rr + dr) * COLS + cc + dc
                if 0 <= rr + dr < ROWS and 0 <= cc + dc < COLS and land.ravel()[j]:
                    cells.append(int(j))
        resources.append({"name": r.name, "kind": r.kind, "c": c, "cells": sorted(cells),
                          "output": float(r.output), "note": r.hinweis})

    rail_list = [int(v) for v in rail_cells]
    out = {
        "version": 1,
        "rail": [rail_list[0]] + [b - a for a, b in zip(rail_list, rail_list[1:])],
        "nodes": [{"c": int(c), "n": n} for c, n, _ in kept],
        "bridges": bridges,
        "industry": industry,
        "resources": resources,
    }
    (OUT / "infra.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"infra.json: {len(rail_list)} Bahnfelder, {len(kept)} Knoten, {len(bridges)} Brücken, "
          f"{len(industry)} Industriezentren, {len(resources)} Rohstoffgebiete, "
          f"{(OUT / 'infra.json').stat().st_size / 1e3:.0f} kB")


if __name__ == "__main__":
    main()

"""Schritt 5: Vektordaten für die Darstellung erzeugen -> public/data/map.json

Inhalt (alle Koordinaten als ganze Zahlen: Welt = origin + wert × unit, EPSG:3035):
  territories  Flächen je Gebiet (Außenringe gegen, Löcher im Uhrzeigersinn -> nonzero-Füllung)
  borders      land (zwischen Nationen), internal (zwischen Gebieten derselben Nation), coast
  fronts       deutsch-polnische und deutsch-französische Grenze; Linien so orientiert,
               dass deutsches Gebiet links der Laufrichtung liegt
  rails        Bahnnetz Natural Earth 10m, scalerank <= 6
  cities       Städte mit Rang (1–3) und Hauptstadt-Kennung
"""
import json
import sys
from itertools import combinations
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import LineString, Point, box
from shapely.ops import polylabel

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import BBOX, CACHE, CRS, DATA, OUT, QUANT_M, SOURCES, X_MIN, Y_MIN  # noqa: E402

RAIL_MAX_SCALERANK = 6
RAIL_SIMPLIFY_M = 800
FRONTS = [
    ("DEU-POL", "Deutsch-polnische Grenze", "DEU", "POL"),
    ("DEU-FRA", "Deutsch-französische Grenze", "DEU", "FRA"),
]


def q_line(coords) -> list[int]:
    a = np.asarray(coords)[:, :2]
    qx = np.round((a[:, 0] - X_MIN) / QUANT_M).astype(int)
    qy = np.round((a[:, 1] - Y_MIN) / QUANT_M).astype(int)
    out, last = [], None
    for x, y in zip(qx, qy):
        if (x, y) != last:
            out += [int(x), int(y)]
            last = (x, y)
    return out


def q_ring(ring) -> list[int]:
    flat = q_line(ring.coords)
    if len(flat) >= 4 and flat[:2] == flat[-2:]:
        flat = flat[:-2]
    return flat


def lines_of(geom) -> list[LineString]:
    if geom is None or geom.is_empty:
        return []
    if geom.geom_type == "LineString":
        return [geom]
    if geom.geom_type == "MultiLineString":
        return list(geom.geoms)
    if geom.geom_type == "GeometryCollection":
        return [l for g in geom.geoms for l in lines_of(g)]
    return []


def merged(lines: list[LineString]) -> list[LineString]:
    if not lines:
        return []
    return lines_of(shapely.line_merge(shapely.union_all(lines)))


def encode_lines(lines) -> list[list[int]]:
    out = []
    for l in lines:
        flat = q_line(l.coords)
        if len(flat) >= 4:
            out.append(flat)
    return out


def main() -> None:
    gdf = gpd.read_file(CACHE / "territories.gpkg", layer="simplified")
    gdf["geometry"] = shapely.orient_polygons(gdf.geometry.values, exterior_cw=False)
    frame_edge = box(*BBOX).exterior.buffer(50)

    territories = []
    for r in gdf.itertuples():
        polys = []
        for p in getattr(r.geometry, "geoms", [r.geometry]):
            if p.geom_type != "Polygon":
                continue
            rings = [q_ring(p.exterior)] + [q_ring(i) for i in p.interiors]
            rings = [x for x in rings if len(x) >= 6]
            if rings and len(rings[0]) >= 6:
                polys.append(rings)
        largest = max(getattr(r.geometry, "geoms", [r.geometry]), key=lambda g: g.area)
        lp = polylabel(largest, tolerance=2000)
        territories.append({"key": r.key, "name": r.name, "owner": r.owner, "polys": polys,
                            "label": q_line([(lp.x, lp.y)]), "area": round(r.geometry.area / 1e6)})

    # --- Grenzlinien klassifizieren ---------------------------------------------------
    bnd = [shapely.set_precision(g.boundary, 1.0) for g in gdf.geometry]
    land, internal, shared_all = [], [], []
    pair_lines: dict[tuple[str, str], list[LineString]] = {}
    for i, j in combinations(range(len(gdf)), 2):
        if not gdf.geometry.iloc[i].intersects(gdf.geometry.iloc[j]):
            continue
        shared = lines_of(shapely.intersection(bnd[i], bnd[j]))
        if not shared:
            continue
        shared_all += shared
        oi, oj = gdf.owner.iloc[i], gdf.owner.iloc[j]
        (internal if oi == oj else land).extend(shared)
        pair_lines.setdefault((oi, oj), []).extend(shared)
        pair_lines.setdefault((oj, oi), []).extend(shared)
    shared_union = shapely.union_all(shared_all).buffer(30)
    coast = []
    for b in bnd:
        coast += lines_of(shapely.difference(b, shared_union).difference(frame_edge))

    # --- Frontlinien ------------------------------------------------------------------
    owner_union = {o: shapely.union_all(g.geometry.values) for o, g in gdf.groupby("owner")}
    fronts = []
    for fid, name, a, b in FRONTS:
        lines = [l for l in merged(pair_lines.get((a, b), [])) if l.length >= 3000]
        oriented = []
        for l in lines:
            c = np.asarray(l.coords)
            k = len(c) // 2
            p0, p1 = c[max(k - 1, 0)], c[min(k, len(c) - 1)] if len(c) > 1 else c[0]
            d = p1 - p0
            nrm = np.array([-d[1], d[0]]) / (np.hypot(*d) or 1.0)
            left = Point(*(0.5 * (p0 + p1) + nrm * 800))
            if not owner_union[a].contains(left):
                l = LineString(c[::-1])
            oriented.append(l)
        fronts.append({"id": fid, "name": name, "attacker": a, "defender": b,
                       "lines": encode_lines(oriented)})

    # --- Bahn -------------------------------------------------------------------------
    rails = gpd.read_file(CACHE / SOURCES["ne_railroads"]["file"])
    rails = rails[rails.scalerank <= RAIL_MAX_SCALERANK].to_crs(CRS)
    rails = rails[rails.intersects(box(*BBOX))]
    rl = []
    for g in rails.geometry:
        g = shapely.intersection(g, box(*BBOX)).simplify(RAIL_SIMPLIFY_M)
        rl += lines_of(g)
    rl = merged(rl)

    # --- Städte -----------------------------------------------------------------------
    cities = pd.read_csv(DATA / "cities.csv")
    cg = gpd.GeoDataFrame(cities, geometry=gpd.points_from_xy(cities.lon, cities.lat), crs=4326).to_crs(CRS)
    cg = cg[cg.within(box(*BBOX))]
    raw = gpd.read_file(CACHE / "territories.gpkg", layer="raw")
    joined = gpd.sjoin_nearest(cg, raw[["key", "owner", "geometry"]], how="left")
    city_list = []
    for r in joined.itertuples():
        city_list.append({
            "name": r.name, "rank": int(r.rank), "capital": bool(r.capital),
            "x": int(round((r.geometry.x - X_MIN) / QUANT_M)), "y": int(round((r.geometry.y - Y_MIN) / QUANT_M)),
            "owner": r.owner if isinstance(r.owner, str) else None,
        })

    out = {
        "version": 1, "crs": CRS, "unit": QUANT_M, "originX": X_MIN, "originY": Y_MIN, "bbox": list(BBOX),
        "territories": territories,
        "borders": {"land": encode_lines(merged(land)), "internal": encode_lines(merged(internal)),
                    "coast": encode_lines(merged(coast))},
        "fronts": fronts,
        "rails": encode_lines(rl),
        "cities": city_list,
    }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "map.json"
    path.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"map.json: {path.stat().st_size / 1e6:.2f} MB, {len(territories)} Gebiete, "
          f"{len(out['rails'])} Bahnlinien, {len(city_list)} Städte, "
          f"Fronten: {[(f['id'], len(f['lines'])) for f in fronts]}")


if __name__ == "__main__":
    main()

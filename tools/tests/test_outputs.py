"""Struktur- und Konsistenzprüfungen der erzeugten Spieldateien."""
import json
import struct

import numpy as np
from shapely.geometry import LineString, Point
import geopandas as gpd

from config import CACHE, OUT, QUANT_M, X_MIN, Y_MIN


def load_map():
    return json.loads((OUT / "map.json").read_text(encoding="utf-8"))


def test_map_contents():
    m = load_map()
    keys = {t["key"] for t in m["territories"]}
    assert {"DEU", "PROT", "SVK", "KARP", "OLSA", "MEMEL", "DAN", "ALB", "POL", "FRA"} <= keys
    alb = next(t for t in m["territories"] if t["key"] == "ALB")
    assert alb["owner"] == "ALB"  # Stand 01.03.1939 (italienische Besetzung am 07.04. ist ein Ereignis)
    assert len(m["borders"]["land"]) > 20 and len(m["borders"]["coast"]) > 50
    assert len(m["rails"]) > 50
    caps = [c for c in m["cities"] if c["capital"]]
    assert any(c["name"] == "Berlin" for c in caps)
    assert all(c["owner"] for c in m["cities"]), [c["name"] for c in m["cities"] if not c["owner"]]


def test_fronts_oriented_german_side_left():
    m = load_map()
    raw = gpd.read_file(CACHE / "territories.gpkg", layer="raw")
    deu = raw[raw.owner == "DEU"].union_all()
    ids = {f["id"] for f in m["fronts"]}
    assert ids == {"DEU-POL", "DEU-FRA"}
    for f in m["fronts"]:
        assert f["lines"], f["id"]
        total = 0.0
        for flat in f["lines"]:
            pts = np.array(flat, dtype=float).reshape(-1, 2) * QUANT_M + [X_MIN, Y_MIN]
            total += LineString(pts).length
            k = len(pts) // 2
            p0, p1 = pts[k - 1], pts[k]
            d = p1 - p0
            n = np.array([-d[1], d[0]]) / np.hypot(*d)
            assert deu.contains(Point(*((p0 + p1) / 2 + n * 800))), f["id"]
        assert total > (1_000_000 if f["id"] == "DEU-POL" else 300_000), (f["id"], total)


def test_relief_file():
    b = (OUT / "relief.bin").read_bytes()
    nv, nt, ox, oy, unit = struct.unpack_from("<IIiiI", b, 0)
    off = 20
    verts = np.frombuffer(b, "<u2", nv * 2, off); off += nv * 4
    idx = np.frombuffer(b, "<u4", nt * 3, off); off += nt * 12
    tone = np.frombuffer(b, "u1", nt, off); off += nt
    assert off == len(b)
    assert nt > 10_000 and idx.max() < nv
    assert tone.max() < 15
    # mindestens 4 verschiedene Schattenstufen -> kantiges, facettiertes Relief
    assert len(np.unique(tone % 5)) >= 4

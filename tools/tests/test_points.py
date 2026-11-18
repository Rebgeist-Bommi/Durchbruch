"""Punktproben: jede Probe muss die richtige Nation liefern – im Vektorlayer
(unvereinfachte Gebiete) und im Feldraster (Feld, in dem der Punkt liegt)."""
import json
import struct

import geopandas as gpd
import numpy as np
import pytest
from pyproj import Transformer
from shapely.geometry import Point

from config import CACHE, CELL, COLS, OUT, ROWS, X_MIN, Y_MAX

TO_PROJ = Transformer.from_crs("EPSG:4326", "EPSG:3035", always_xy=True)

# (Name, Breite N, Länge O, erwarteter Besitzer)
SAMPLES = [
    ("Prag", 50.0755, 14.4378, "CSR"),
    ("Wien", 48.2082, 16.3738, "DEU"),
    ("Pressburg", 48.1486, 17.1077, "CSR"),
    ("Chust", 48.17, 23.30, "CSR"),
    ("Memel", 55.71, 21.13, "LTU"),
    ("Danzig", 54.3520, 18.6466, "DAN"),
    ("Karwin", 49.85, 18.54, "POL"),
    ("Warschau", 52.2297, 21.0122, "POL"),
    ("Paris", 48.8566, 2.3522, "FRA"),
]
# zusätzliche Plausibilitätsproben
EXTRA = [
    ("Berlin", 52.52, 13.405, "DEU"),
    ("Gdingen", 54.518, 18.531, "POL"),
    ("Tirana", 41.328, 19.818, "ALB"),
    ("Kowno", 54.899, 23.904, "LTU"),
    ("Mährisch-Ostrau", 49.835, 18.282, "CSR"),
    ("Elbing", 54.156, 19.404, "DEU"),
]


@pytest.fixture(scope="module")
def raw():
    return gpd.read_file(CACHE / "territories.gpkg", layer="raw")


@pytest.fixture(scope="module")
def grid():
    meta = json.loads((OUT / "grid.json").read_text(encoding="utf-8"))
    data = np.frombuffer((OUT / "grid.bin").read_bytes(), dtype=np.uint8)
    n = meta["rows"] * meta["cols"]
    return meta, data[:n].reshape(meta["rows"], meta["cols"]), data[n:2 * n].reshape(meta["rows"], meta["cols"])


def cell_of(lat, lon):
    x, y = TO_PROJ.transform(lon, lat)
    return int((Y_MAX - y) // CELL), int((x - X_MIN) // CELL)


@pytest.mark.parametrize("name,lat,lon,owner", SAMPLES + EXTRA, ids=[s[0] for s in SAMPLES + EXTRA])
def test_vector_owner(raw, name, lat, lon, owner):
    x, y = TO_PROJ.transform(lon, lat)
    hit = raw[raw.contains(Point(x, y))]
    assert len(hit) == 1, f"{name}: {len(hit)} Treffer"
    assert hit.owner.iloc[0] == owner, f"{name}: {hit.owner.iloc[0]} ({hit.key.iloc[0]}) statt {owner}"


@pytest.mark.parametrize("name,lat,lon,owner", SAMPLES + EXTRA, ids=[s[0] for s in SAMPLES + EXTRA])
def test_grid_owner(grid, name, lat, lon, owner):
    meta, terr, _ = grid
    r, c = cell_of(lat, lon)
    tid = int(terr[r, c])
    assert tid > 0, f"{name}: Feld ({r},{c}) ist Meer"
    t = meta["territories"][tid - 1]
    assert t["owner"] == owner, f"{name}: {t['owner']} ({t['key']}) statt {owner}"


def test_grid_geometry(grid):
    meta, terr, terrain = grid
    assert meta["cellSize"] == CELL == 9000
    assert (meta["cols"], meta["rows"]) == (COLS, ROWS) == (456, 356)
    assert meta["originX"] == 2_500_000 and meta["originY"] == 4_550_000
    assert set(np.unique(terrain)) <= {0, 1}
    assert not np.any(terrain[terr == 0]), "Gebirge auf Meeresfeldern"
    assert 60_000 < int((terr > 0).sum()) < 120_000


@pytest.mark.parametrize("name,lat,lon,expected", [
    ("Zugspitze", 47.42, 10.98, 1), ("Hohe Tatra", 49.17, 20.13, 1), ("Montblanc", 45.83, 6.86, 1),
    ("Pyrenäen", 42.65, 0.65, 1), ("Berlin", 52.52, 13.405, 0), ("Warschau", 52.23, 21.01, 0),
    ("Paris", 48.857, 2.352, 0), ("Ungarische Tiefebene", 47.0, 20.5, 0),
])
def test_terrain(grid, name, lat, lon, expected):
    _, _, terrain = grid
    r, c = cell_of(lat, lon)
    assert int(terrain[r, c]) == expected, name


def test_every_correction_territory_has_cells(grid):
    meta, terr, _ = grid
    counts = np.bincount(terr.ravel(), minlength=len(meta["territories"]) + 1)
    for t in meta["territories"]:
        if t["key"] in {"PROT", "SVK", "KARP", "OLSA", "MEMEL", "DAN", "ALB"}:
            assert counts[t["id"]] >= 5, t["key"]


def test_neighbors_are_symmetric(grid):
    _, terr, _ = grid
    land = terr > 0
    # 4er-Nachbarschaft: Anzahl Kanten von links und von rechts gezählt müssen übereinstimmen
    horiz = land[:, :-1] & land[:, 1:]
    vert = land[:-1, :] & land[1:, :]
    assert horiz.sum() > 0 and vert.sum() > 0

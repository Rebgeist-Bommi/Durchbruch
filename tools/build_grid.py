"""Schritt 3: Felder (9 × 9 km) erzeugen.

Ausgabe:
  public/data/grid.bin   – ROWS*COLS Bytes Gebiets-ID (0 = Meer), danach ROWS*COLS Bytes Terrain
  public/data/grid.json  – Metadaten: Rastergeometrie, Gebiete, Nationen, Terrainarten

Besitzer eines Feldes: Mehrheit von 5 × 5 Teilpunkten (Landfeld ab 6 Landpunkten);
Felder mit einer Stadt aus tools/data/cities.csv gehören immer zum Gebiet der Stadt.
Terrain: 0 Ebene, 1 Gebirge (aus Höhenmodell + Natural-Earth-Gebirgszügen).
Nachbarn: 4er-Nachbarschaft (N, O, S, W), nur Landfelder; wird beim Laden berechnet.
"""
import json
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
from rasterio.features import rasterize
from rasterio.transform import from_origin
from scipy.ndimage import maximum_filter, minimum_filter, zoom

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import CACHE, CELL, COLS, CRS, DATA, OUT, ROWS, SOURCES, STATE_DATE, X_MIN, Y_MAX  # noqa: E402
from dem import load_interpolator, sample_xy  # noqa: E402
from nations import NATIONS  # noqa: E402

TERRAIN = ["Ebene", "Gebirge"]
SUBT = 5      # Teilpunkte je Feldkante für die Besitzerermittlung
LAND_MIN = 6  # ab so vielen von 25 Teilpunkten an Land ist das Feld ein Landfeld
SUB = 3   # Unterabtastung des Höhenmodells je Feld (3 × 3 Punkte im Abstand von 3 km)


def territory_raster(gdf: gpd.GeoDataFrame) -> np.ndarray:
    """Mehrheitsentscheid über 5 × 5 Teilpunkte je Feld: Landfeld ab LAND_MIN Landpunkten,
    Besitzer = häufigstes Gebiet unter den Landpunkten."""
    shapes = ((geom, i + 1) for i, geom in enumerate(gdf.geometry))
    fine = rasterize(shapes, out_shape=(ROWS * SUBT, COLS * SUBT),
                     transform=from_origin(X_MIN, Y_MAX, CELL / SUBT, CELL / SUBT),
                     fill=0, dtype="uint8", all_touched=False)
    blocks = fine.reshape(ROWS, SUBT, COLS, SUBT).transpose(0, 2, 1, 3).reshape(ROWS, COLS, SUBT * SUBT)
    counts = np.stack([(blocks == i).sum(axis=2) for i in range(1, len(gdf) + 1)], axis=0)
    owner = counts.argmax(axis=0).astype("uint8") + 1
    land = counts.sum(axis=0) >= LAND_MIN
    return np.where(land, owner, 0).astype("uint8")


def pin_cities(terr: np.ndarray, gdf: gpd.GeoDataFrame) -> int:
    """Felder mit einer Stadt gehören immer zum Gebiet der Stadt (auch an der Küste)."""
    cities = pd.read_csv(DATA / "cities.csv")
    pts = gpd.GeoDataFrame(cities, geometry=gpd.points_from_xy(cities.lon, cities.lat), crs=4326).to_crs(CRS)
    idx = gdf.reset_index(drop=True)
    j = gpd.sjoin_nearest(pts, idx[["geometry"]], how="left")
    changed = 0
    for p, tid in zip(j.geometry, j.index_right):
        r, c = int((Y_MAX - p.y) // CELL), int((p.x - X_MIN) // CELL)
        if 0 <= r < ROWS and 0 <= c < COLS and terr[r, c] != tid + 1:
            terr[r, c] = tid + 1
            changed += 1
    return changed


def terrain_raster(land: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    interp = load_interpolator()
    step = CELL / SUB
    xs = X_MIN + (np.arange(COLS * SUB) + 0.5) * step
    ys = Y_MAX - (np.arange(ROWS * SUB) + 0.5) * step
    X, Y = np.meshgrid(xs, ys)
    fine = sample_xy(interp, X, Y)
    elev = fine.reshape(ROWS, SUB, COLS, SUB).mean(axis=(1, 3))
    # lokale Reliefenergie: Spannweite im Fenster von 27 × 27 km
    relief_fine = maximum_filter(fine, size=SUB * 3) - minimum_filter(fine, size=SUB * 3)
    relief = relief_fine.reshape(ROWS, SUB, COLS, SUB).max(axis=(1, 3))

    regions = gpd.read_file(CACHE / SOURCES["ne_regions"]["file"]).to_crs(CRS)
    ranges = regions[regions.FEATURECLA == "Range/mtn"]
    in_range = rasterize(((g, 1) for g in ranges.geometry), out_shape=(ROWS, COLS),
                         transform=from_origin(X_MIN, Y_MAX, CELL, CELL), fill=0, dtype="uint8") == 1

    mountain = ((elev >= 1000) | ((elev >= 380) & (relief >= 600))
                | (in_range & (elev >= 450) & (relief >= 350)))
    terrain = np.where(land & mountain, 1, 0).astype("uint8")
    return terrain, elev


def main() -> None:
    gdf = gpd.read_file(CACHE / "territories.gpkg", layer="raw")
    terr = territory_raster(gdf)
    pinned = pin_cities(terr, gdf)
    terrain, elev = terrain_raster(terr > 0)

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "grid.bin").write_bytes(terr.tobytes() + terrain.tobytes())
    meta = {
        "version": 1,
        "date": STATE_DATE,
        "crs": CRS,
        "cellSize": CELL,
        "cols": COLS,
        "rows": ROWS,
        "originX": X_MIN,
        "originY": Y_MAX,
        "layout": "zeilenweise von Nord nach Süd, je Zeile West nach Ost; index = row * cols + col",
        "layers": [
            {"name": "territory", "type": "uint8", "offset": 0, "note": "0 = Meer, sonst territories[id-1]"},
            {"name": "terrain", "type": "uint8", "offset": ROWS * COLS},
        ],
        "neighbors": "4er-Nachbarschaft N/O/S/W, nur Landfelder",
        "terrainTypes": TERRAIN,
        "territories": [{"id": i + 1, "key": r.key, "name": r.name, "owner": r.owner}
                        for i, r in enumerate(gdf.itertuples())],
        "nations": NATIONS,
    }
    (OUT / "grid.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    land = int((terr > 0).sum())
    print(f"Raster {COLS}×{ROWS}, {land} Landfelder, davon {int(terrain.sum())} Gebirge, {pinned} Stadtfelder angepasst")
    np.save(CACHE / "elevation_cells.npy", elev.astype("float32"))


if __name__ == "__main__":
    main()

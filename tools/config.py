"""Zentrale Konstanten der Datenpipeline (Phase 1)."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / "tools"
CACHE = TOOLS / ".cache"          # Rohdaten und Zwischenstände (nicht im Repo)
OUT = ROOT / "public" / "data"    # vom Spiel geladene Dateien (im Repo)
DATA = TOOLS / "data"             # handgepflegte Eingaben (Städte, Näherungspolygone)

CRS = "EPSG:3035"
STATE_DATE = "1939-08-31"
# Kartenausschnitt in EPSG:3035 (Meter)
X_MIN, X_MAX = 2_500_000, 6_600_000
Y_MIN, Y_MAX = 1_350_000, 4_550_000
BBOX = (X_MIN, Y_MIN, X_MAX, Y_MAX)

# Felder: exakt 9 km, Ursprung oben links (X_MIN, Y_MAX)
CELL = 9_000
COLS = -(-(X_MAX - X_MIN) // CELL)   # 456
ROWS = -(-(Y_MAX - Y_MIN) // CELL)   # 356

# Vektorvereinfachung (topologieerhaltend) und Quantisierung für die Ausgabe
SIMPLIFY_M = 600
QUANT_M = 100   # Koordinaten werden als ganze Hektometer gespeichert

SOURCES = {
    "cshapes": {
        "url": "https://raw.githubusercontent.com/cran/cshapes/master/inst/extdata/cshapes_2_cow.topojson.xz",
        "file": "cshapes_2_cow.topojson.xz",
    },
    "ne_countries": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson",
        "file": "ne_50m_admin_0_countries.geojson",
    },
    "ne_regions": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_geography_regions_polys.geojson",
        "file": "ne_50m_geography_regions_polys.geojson",
    },
    "ne_railroads": {
        "url": "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_railroads.geojson",
        "file": "ne_10m_railroads.geojson",
    },
    "topography": {
        "url": "https://github.com/fatiando-data/earth-topography-10arcmin/releases/download/v1/earth-topography-10arcmin.nc",
        "file": "earth-topography-10arcmin.nc",
        "sha256": "e45628a3f559ec600a4003587a2b575402d22986651ee48806930aa909af4cf6",
        # Ersatzweg, falls Release-Downloads gesperrt sind: dieselben Rohdaten (ICGEM-Export
        # von ETOPO1) liegen im Git-Repository unter raw/etopo1.gdf.xz.
        "git": "https://github.com/fatiando-data/earth-topography-10arcmin",
        "git_raw": "raw/etopo1.gdf.xz",
    },
}

"""Schritt 2: Gebiete (Territorien) zum Spielstart 01.03.1939 erzeugen.

Grenzverläufe: CShapes zum 31.08.1939 (Grenzen nach dem Münchner Abkommen). Besitzer zum
01.03.1939: Tschecho-Slowakei (Böhmen und Mähren, Slowakei, Karpatenukraine), Memelland bei
Litauen, Albanien selbstständig. Spätere Änderungen (15.03., 23.03., 07.04.1939) sind Ereignisse
im Spiel (data/balance.json, scenario.annexations).

Ergebnis: tools/.cache/territories.gpkg mit den Layern
  raw         – unvereinfachte Flächen (Grundlage für Raster und Tests)
  simplified  – topologieerhaltend vereinfacht (Grundlage für die Darstellung)

Jedes Gebiet hat: key, name (deutsch), owner (Nation, die es kontrolliert).
CShapes bildet Staaten ab, nicht die tatsächliche Kontrolle. Deshalb werden
die in CLAUDE.md beschriebenen Korrekturen als Übermalungen angewandt.
"""
import sys
from pathlib import Path

import geopandas as gpd
import pandas as pd
import shapely
from shapely.geometry import box

sys.path.insert(0, str(Path(__file__).resolve().parent))
from config import BBOX, CACHE, CRS, DATA, SIMPLIFY_M, SOURCES, STATE_DATE  # noqa: E402
from nations import NATIONS  # noqa: E402

# CShapes-COW-Code -> (Gebietsschlüssel, Name, Besitzer)
COW = {
    200: ("GBR", "Vereinigtes Königreich", "GBR"),
    352: ("CYP", "Zypern", "GBR"),
    338: ("MLT", "Malta", "GBR"),
    205: ("IRL", "Irland", "IRL"),
    210: ("NLD", "Niederlande", "NLD"),
    211: ("BEL", "Belgien", "BEL"),
    212: ("LUX", "Luxemburg", "LUX"),
    615: ("DZA", "Algerien", "FRA"),
    616: ("TUN", "Tunesien", "FRA"),
    600: ("MAR", "Französisch-Marokko", "FRA"),
    220: ("FRA", "Frankreich", "FRA"),
    225: ("CHE", "Schweiz", "CHE"),
    602: ("SMA", "Spanisch-Marokko", "ESP"),
    230: ("ESP", "Spanien", "ESP"),
    235: ("PRT", "Portugal", "PRT"),
    315: ("CSR", "Tschechoslowakei (aufgeteilt)", "DEU"),   # wird unten aufgeteilt
    255: ("DEU", "Deutsches Reich", "DEU"),
    290: ("POL", "Polen", "POL"),
    310: ("HUN", "Ungarn", "HUN"),
    325: ("ITA", "Italien", "ITA"),
    339: ("ALB", "Albanien", "ALB"),
    345: ("YUG", "Jugoslawien", "YUG"),
    350: ("GRC", "Griechenland", "GRC"),
    355: ("BGR", "Bulgarien", "BGR"),
    360: ("ROU", "Rumänien", "ROU"),
    365: ("SOV", "Sowjetunion", "SOV"),
    366: ("EST", "Estland", "EST"),
    367: ("LVA", "Lettland", "LVA"),
    368: ("LTU", "Litauen", "LTU"),
    375: ("FIN", "Finnland", "FIN"),
    380: ("SWE", "Schweden", "SWE"),
    385: ("NOR", "Norwegen", "NOR"),
    390: ("DNK", "Dänemark", "DNK"),
    640: ("TUR", "Türkei", "TUR"),
}

# Natural-Earth-ADM0 -> Gebiet, für Land, das in CShapes fehlt (Inseln, Kleinstaaten)
NE_FILL = {
    "JEY": "GBR", "GGY": "GBR", "IMN": "GBR", "GBR": "GBR", "MLT": "MLT",
    "UKR": "SOV", "RUS": "SOV", "BLR": "SOV", "SWE": "SWE", "NLD": "NLD", "ITA": "ITA",
    "GRC": "GRC", "DEU": "DEU", "ALD": "FIN", "FIN": "FIN", "FRO": "FRO", "DNK": "DNK",
    "HRV": "YUG", "NOR": "NOR", "EST": "EST", "FRA": "FRA", "ESP": "ESP", "PRT": "PRT",
    "IRL": "IRL", "TUR": "TUR", "DZA": "DZA", "TUN": "TUN", "MAR": "MAR",
}
EXTRA_TERRITORIES = {
    "FRO": ("Färöer", "DNK"),
    "AND": ("Andorra", "AND"),
    "LIE": ("Liechtenstein", "LIE"),
    "SMR": ("San Marino", "SMR"),
    "DOD": ("Dodekanes (italienisch)", "ITA"),
}
CORRECTION_TERRITORIES = {
    "PROT": ("Böhmen und Mähren", "CSR"),
    "SVK": ("Slowakei", "CSR"),
    "KARP": ("Karpatenukraine", "CSR"),
    "OLSA": ("Olsagebiet (polnisch)", "POL"),
    "MEMEL": ("Memelland", "LTU"),
    "DAN": ("Freie Stadt Danzig", "DAN"),
}
DODECANESE = box(26.4, 35.3, 28.4, 37.6)   # lon/lat
DANZIG_CSHAPES_DATE = "1938-08-01"
MIN_PART_M2 = 30e6     # kleinere Splitter von Korrekturflächen werden dem Nachbarn zugeschlagen


def load_cshapes(date: str) -> gpd.GeoDataFrame:
    path = CACHE / SOURCES["cshapes"]["file"].removesuffix(".xz")
    g = gpd.read_file(path).set_crs(4326)
    t = pd.Timestamp(date)
    return g[(g.start <= t) & (g.end >= t)].copy()


def to_proj(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    frame = box(*BBOX)
    gdf = gdf.to_crs(CRS)
    gdf = gdf[gdf.intersects(frame)].copy()
    gdf["geometry"] = shapely.intersection(shapely.make_valid(gdf.geometry.values), frame)
    gdf["geometry"] = shapely.set_precision(gdf.geometry.values, 1.0)
    return gdf[~gdf.is_empty]


class Canvas:
    """Gebiete ohne Überlappung: paint() übermalt bestehende Flächen."""

    def __init__(self):
        self.geoms: dict[str, shapely.Geometry] = {}
        self.meta: dict[str, tuple[str, str]] = {}

    def paint(self, key: str, name: str, owner: str, geom) -> None:
        geom = shapely.make_valid(geom)
        if geom.is_empty:
            return
        for k in list(self.geoms):
            if k != key and self.geoms[k].intersects(geom):
                self.geoms[k] = shapely.make_valid(self.geoms[k].difference(geom))
        self.geoms[key] = geom if key not in self.geoms else self.geoms[key].union(geom)
        self.meta[key] = (name, owner)

    def remove(self, key: str) -> None:
        self.geoms.pop(key, None)
        self.meta.pop(key, None)

    def absorb_slivers(self, keys) -> None:
        """Teile < MIN_PART_M2 der genannten Gebiete an den Nachbarn mit der längsten
        gemeinsamen Grenze abgeben (vermeidet Splitter aus Grenzabweichungen)."""
        for key in keys:
            parts = list(getattr(self.geoms[key], "geoms", [self.geoms[key]]))
            keep = [p for p in parts if p.area >= MIN_PART_M2]
            for p in (p for p in parts if p.area < MIN_PART_M2):
                best, best_len = None, 0.0
                ring = p.buffer(5)
                for k, g in self.geoms.items():
                    if k == key:
                        continue
                    shared = ring.intersection(g.boundary).length if ring.intersects(g) else 0
                    if shared > best_len:
                        best, best_len = k, shared
                if best is None:
                    keep.append(p)          # isolierte Insel bleibt
                else:
                    self.geoms[best] = shapely.make_valid(self.geoms[best].union(p))
            self.geoms[key] = shapely.union_all(keep)

    def frame(self) -> gpd.GeoDataFrame:
        rows = []
        for k, g in self.geoms.items():
            g = shapely.set_precision(shapely.make_valid(g), 1.0)
            polys = [p for p in getattr(g, "geoms", [g]) if p.geom_type == "Polygon" and p.area > 1e5]
            if not polys:
                continue
            rows.append({"key": k, "name": self.meta[k][0], "owner": self.meta[k][1],
                         "geometry": shapely.MultiPolygon(polys)})
        return gpd.GeoDataFrame(rows, crs=CRS)


def build() -> gpd.GeoDataFrame:
    cs = to_proj(load_cshapes(STATE_DATE))
    canvas = Canvas()
    for _, r in cs.iterrows():
        key, name, owner = COW[int(r.cowcode)]
        canvas.paint(key, name, owner, r.geometry)

    ne = to_proj(gpd.read_file(CACHE / SOURCES["ne_countries"]["file"]))
    ne_by = {a: shapely.union_all(g.geometry.values) for a, g in ne.groupby("ADM0_A3")}

    # --- fehlendes Land: isolierte Inseln > 30 km² und Kleinstaaten -------------------
    covered = shapely.union_all(list(canvas.geoms.values()))
    near = covered.buffer(1500)
    dodecanese = gpd.GeoSeries([DODECANESE], crs=4326).to_crs(CRS).iloc[0]
    for adm, geom in ne_by.items():
        if adm not in NE_FILL:
            continue
        left = geom.difference(covered)
        for part in getattr(left, "geoms", [left]):
            if part.geom_type != "Polygon" or part.area < MIN_PART_M2 or part.intersects(near):
                continue
            key = NE_FILL[adm]
            if adm == "GRC" and part.intersects(dodecanese):
                key = "DOD"
            name, owner = EXTRA_TERRITORIES.get(key) or canvas.meta[key]
            canvas.paint(key, name, owner, part)
    for key in ("AND", "LIE", "SMR"):
        name, owner = EXTRA_TERRITORIES[key]
        canvas.paint(key, name, owner, ne_by[key])

    # --- Korrektur 1–3: Aufteilung der Tschechoslowakei -------------------------------
    csr = canvas.geoms["CSR"]
    d = 15_000
    cz, sk, ua = ne_by["CZE"], ne_by["SVK"], ne_by["UKR"]
    zone_cz = cz.buffer(d).difference(sk).difference(ua)
    zone_sk = sk.buffer(d).difference(cz).difference(ua).difference(zone_cz)
    canvas.remove("CSR")
    canvas.paint("PROT", *CORRECTION_TERRITORIES["PROT"], csr.intersection(zone_cz))
    canvas.paint("SVK", *CORRECTION_TERRITORIES["SVK"], csr.intersection(zone_sk))
    canvas.paint("KARP", *CORRECTION_TERRITORIES["KARP"], csr.difference(zone_cz).difference(zone_sk))

    # --- Korrektur 4–6: Näherungspolygone ---------------------------------------------
    approx = gpd.read_file(DATA / "corrections.geojson").set_crs(4326, allow_override=True).to_crs(CRS)
    poly = {r.key: r.geometry for r in approx.itertuples()}
    former_csr = canvas.geoms["PROT"].union(canvas.geoms["SVK"])
    canvas.paint("OLSA", *CORRECTION_TERRITORIES["OLSA"], poly["OLSA"].intersection(former_csr))
    canvas.paint("MEMEL", *CORRECTION_TERRITORIES["MEMEL"], poly["MEMEL"].intersection(canvas.geoms["LTU"]))
    # Danzig: CShapes führt die Freie Stadt bis 1938-08-31 als eigene Einheit (Mandat) und
    # schlägt sie danach Deutschland zu. Diese CShapes-Fläche ist grenzgenau; das
    # Näherungspolygon dient als Plausibilitätsrahmen (gepuffert) und als Ersatz.
    land_pl_de = canvas.geoms["DEU"].union(canvas.geoms["POL"])
    cs_old = to_proj(load_cshapes(DANZIG_CSHAPES_DATE))
    cs_dan = cs_old[cs_old.cowcode == 291]
    if len(cs_dan):
        danzig = shapely.union_all(cs_dan.geometry.values).intersection(poly["DANZIG"].buffer(8000))
    else:
        danzig = poly["DANZIG"]
    canvas.paint("DAN", *CORRECTION_TERRITORIES["DAN"], danzig.intersection(land_pl_de))

    # Korrektur 7 (Albanien -> Besitzer Italien) steckt bereits in der COW-Tabelle.
    canvas.absorb_slivers(["PROT", "SVK", "KARP", "OLSA", "MEMEL", "DAN"])

    gdf = canvas.frame()
    unknown = set(gdf.owner) - set(NATIONS)
    assert not unknown, f"Besitzer ohne Nationseintrag: {unknown}"
    return gdf.sort_values("key").reset_index(drop=True)


def simplify(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    out = gdf.copy()
    out["geometry"] = shapely.coverage_simplify(gdf.geometry.values, SIMPLIFY_M, simplify_boundary=True)
    out["geometry"] = shapely.make_valid(out.geometry.values)
    return out


def main() -> None:
    gdf = build()
    path = CACHE / "territories.gpkg"
    path.unlink(missing_ok=True)
    gdf.to_file(path, layer="raw", driver="GPKG")
    simplify(gdf).to_file(path, layer="simplified", driver="GPKG")
    for r in gdf.itertuples():
        print(f"  {r.key:6s} {r.owner:4s} {r.geometry.area / 1e6:12.0f} km²  {r.name}")
    print(f"{len(gdf)} Gebiete -> {path}")


if __name__ == "__main__":
    main()

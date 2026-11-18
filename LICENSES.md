# Datenquellen und Lizenzen

| Quelle | Verwendung | Bezug | Lizenz |
|---|---|---|---|
| CShapes 2.0 (Weidmann, Schvitz, Girardin), CRAN-Spiegel `cran/cshapes`, Datei `inst/extdata/cshapes_2_cow.topojson.xz` | Staatsgrenzen am 1939-08-31; Fläche der Freien Stadt Danzig (Stand 1938-08-01) | https://github.com/cran/cshapes | GPL (≥ 2), laut `DESCRIPTION` des Pakets |
| Natural Earth `ne_50m_admin_0_countries` | Aufteilung der Tschechoslowakei (heutige Grenzen CZ/SK/UA), fehlende Inseln und Kleinstaaten | https://github.com/nvkelso/natural-earth-vector | gemeinfrei (Public Domain) |
| Natural Earth `ne_50m_geography_regions_polys` | Gebirgszüge (FEATURECLA `Range/mtn`) für die Terrainzuordnung | wie oben | gemeinfrei |
| Natural Earth `ne_10m_railroads` | Bahnnetz, `scalerank ≤ 7` (Darstellung, Raster für Nachschub, Bahnknoten) | wie oben | gemeinfrei |
| Natural Earth `ne_50m_rivers_lake_centerlines` | Eisenbahnbrücken über große Flüsse (`scalerank ≤ 5`) | wie oben | gemeinfrei |
| Earth – Topography grid at 10 arc-minute resolution (Fatiando a Terra), `earth-topography-10arcmin.nc`, v1, DOI 10.5281/zenodo.5882203 | Höhenmodell für Terrain (Gebirge) und facettiertes Relief | https://github.com/fatiando-data/earth-topography-10arcmin | CC BY 4.0; Ausgangsdaten ETOPO1 (NOAA, Amante & Eakins 2009, DOI 10.7289/V5C8276M) gemeinfrei |
| Schriften IM Fell English SC, Spectral, UnifrakturMaguntia, Saira Stencil One, Saira Condensed, Special Elite (npm `@fontsource/*`) | Oberfläche und Kartenbeschriftung | https://fontsource.org | SIL Open Font License 1.1 |
| Vite | Build-Werkzeug | https://vitejs.dev | MIT |

## Eigene Daten
- `tools/data/cities.csv`: Städteliste (deutsche Namen von 1939, Koordinaten, Rang 1–4), selbst zusammengestellt.
- `data/balance.json`: Spielwerte (Platzhalter), selbst festgelegt; belegte historische Werte siehe `SOURCES.md`.
- `tools/data/industry.csv`, `tools/data/resources.csv`: Industriezentren und Rohstoffgebiete, selbst zusammengestellt (Orte allgemein bekannt, Gewichte sind Spielwerte).
- `tools/data/corrections.geojson`: Näherungspolygone für Memelland, Danzig (Rahmen) und Olsagebiet, selbst erstellt.
- `src/assets/flags/*.svg`: vereinfachte Nachzeichnungen der Nationalflaggen 1939, selbst erstellt.

## Folgen für das Projekt
- Die erzeugten Dateien `public/data/map.json`, `grid.json` und `grid.bin` sind aus CShapes abgeleitet
  und stehen damit unter GPL (≥ 2). Bei Weitergabe (auch über GitHub Pages) muss der Quellcode der
  Ableitung verfügbar sein; das ist mit `tools/` im Repository erfüllt.
- `relief.bin` und das Terrain in `grid.bin` sind aus dem Fatiando-Höhenmodell abgeleitet (CC BY 4.0):
  Namensnennung erfolgt hier und in der Statusleiste des Spiels.

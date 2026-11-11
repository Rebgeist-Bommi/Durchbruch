# Durchbruch

## Projektziel
"Durchbruch" ist ein privates Echtzeit-Strategiespiel im Browser (HTML/JavaScript) zum Zweiten
Weltkrieg. Start am 31. August 1939, der Spieler führt Deutschland. Das Spiel wird in 6 Phasen
gebaut.

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Karte und Grundgerüst | fertig |
| 2–6 | folgen | offen |

## Technik
- Reines HTML/CSS/JavaScript (ES-Module), kein Framework. Build mit Vite (`base: './'`).
- Statische Seite auf GitHub Pages, lauffähig in jedem aktuellen Browser auf Mac und Windows.
- Darstellung mit Canvas 2D. Schriften lokal über `@fontsource` (keine Anfragen an Google).
- Datenpipeline in Python (geopandas, shapely ≥ 2.1, rasterio, xarray, scipy) unter `tools/`.
  Die erzeugten Spieldateien liegen versioniert in `public/data/`. Die CI braucht kein Python.
- Deployment: `.github/workflows/deploy.yml` baut bei jedem Push auf `main` und veröffentlicht
  `dist/` auf GitHub Pages.

## Ordnerstruktur
```
index.html                 Einstieg, Layout (Kopfleiste, Seitenleiste, Karte, Statusleiste)
src/main.js                Start, Eingaben (Zoom, Ziehen, Klick, Tasten 1/2/3, G, 0, +/-)
src/data/projection.js     EPSG:3035 vorwärts/rückwärts (ellipsoidisch)
src/data/grid.js           Feldraster: Besitzer, Terrain, Nachbarn
src/data/loader.js         Laden und Dekodieren von public/data/*
src/map/camera.js          Kamera (Zoom um Mauszeiger, Verschieben, Begrenzung)
src/map/renderer.js        Kartenzeichnung (Länder, Relief, Grenzen, Fronten, Bahn, Beschriftung)
src/map/styles.js          Farben und Schriften je Kartenmodus
src/ui/                    Seitenleiste (Feldinfo, Nationenanzeige), Flaggen
src/styles/                base.css + front.css / economy.css / intel.css (Layout je Modus)
src/assets/flags/          Nationalflaggen 1939 als SVG (vereinfacht)
public/data/               erzeugte Spieldaten (nicht von Hand ändern)
tools/                     Datenpipeline, Tests, Screenshot- und Layoutprüfung
tools/data/                handgepflegte Eingaben (Städte, Näherungspolygone)
tests/                     JavaScript-Tests (node:test)
screenshots/               Abnahme-Screenshots der letzten Phase
```

## Befehle
```bash
pip install -r tools/requirements.txt
python tools/build_all.py        # Rohdaten laden -> public/data/* erzeugen -> pytest
npm ci
npm test                         # JavaScript-Tests
npm run dev                      # Entwicklungsserver
npm run build && npm run preview # Produktionsbuild lokal (Port 4173)
npm run screenshots              # Playwright-Screenshots aller Modi (Preview muss laufen)
node tools/check_layout.mjs      # Überlappungsprüfung der Kopfleiste in 4 Fenstergrößen
```

## Arbeitsregeln
- Pro Sitzung genau eine Phase.
- Erst testen, dann berichten: `python tools/build_all.py` (pytest) und `npm test` müssen grün sein,
  Screenshots aller drei Modi werden angesehen und geprüft.
- Alle Datenschritte reproduzierbar als Skripte in `/tools`. Keine Handbearbeitung erzeugter Dateien.
- Jede Datenquelle mit Lizenz in `LICENSES.md`.

## Datenmodell (Phase 1)
- Projektion EPSG:3035, Ausschnitt x 2.500.000–6.600.000, y 1.350.000–4.550.000.
- Stichtag 1939-08-31. Gebiete (`territories`) haben `key`, `name`, `owner` (Nationscode, siehe
  `tools/nations.py`). Korrekturen gegenüber CShapes stehen in `tools/territories.py`.
- Felder: 9 × 9 km, 456 × 356, Ursprung oben links (2.500.000 / 4.550.000), Index
  `row * cols + col`. `grid.bin` = Gebiets-ID je Feld (uint8, 0 = Meer) + Terrain je Feld
  (0 Ebene, 1 Gebirge). Nachbarn: 4er-Nachbarschaft, nur Land. `Grid.owner` ist veränderlich
  (für spätere Frontverschiebung).
- Kartenkoordinaten im Frontend: Hektometer ab (2.500.000 / 1.350.000), y nach Norden.
- Frontlinien in `map.json` sind so orientiert, dass Deutschland links der Laufrichtung liegt.

# Durchbruch

## Projektziel
"Durchbruch" ist ein privates Echtzeit-Strategiespiel im Browser (HTML/JavaScript) zum Zweiten
Weltkrieg. Start am 31. August 1939, der Spieler führt Deutschland. Das Spiel wird in 6 Phasen
gebaut.

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Karte und Grundgerüst | fertig |
| 2 | Echtzeit und Kampf (Deutschland gegen Polen spielbar) | fertig |
| 3 | Wirtschaft, Infrastruktur, KI-Nationen, Speichern | fertig |
| 4–6 | folgen | offen |

## Technik
- Reines HTML/CSS/JavaScript (ES-Module), kein Framework. Build mit Vite (`base: './'`).
- Statische Seite auf GitHub Pages, lauffähig in jedem aktuellen Browser auf Mac und Windows.
- Darstellung mit Canvas 2D. Schriften lokal über `@fontsource` (keine Anfragen an Google).
- Datenpipeline in Python (geopandas, shapely ≥ 2.1, rasterio, xarray, scipy) unter `tools/`.
  Die erzeugten Spieldateien liegen versioniert in `public/data/`. Die CI braucht kein Python.
- Deployment: `.github/workflows/deploy.yml` baut bei jedem Push auf `main` und schreibt `dist/`
  in den Branch `gh-pages` (Pages-Quelle: „Deploy from a branch“). Live: https://rebgeist-bommi.github.io/Durchbruch/

## Ordnerstruktur
```
index.html                 Einstieg, Layout (Kopfleiste mit Zeit, Seitenleiste, Karte, Frontfenster,
                           Meldungsleiste, Statusleiste, Abschlussdialog)
src/main.js                Start, Spielschleife (Tick je Spieltag, Animation dazwischen), Eingaben
                           (Zoom, Ziehen, Klick auf Feld/Front, Tasten 1/2/3, Leertaste, G, 0, +/-, Esc)
data/balance.json          Spielwerte (alle Platzhalter, "# TODO historisch prüfen")
src/sim/                   Simulation ohne DOM (läuft im Browser und in Node gleich):
  simulation.js            Zustand, Tick-Ablauf, Befehle, Nachschub, Verlegung, Ereignisse
  fronts.js                Fronten aus Kontaktkanten, Identität über Ticks, Abschnitte (~100 km)
  combat.js                Kampf, feldweiser Vormarsch, Verluste, Vorbereitung/Befestigung
  pockets.js               Kessel, Belagerung von Groß-/Hauptstädten, Kapitulation
  ai.js                    einfache KI (Polen): Verteilung, Befestigung, Rückzug bei Kesselgefahr
  autoplay.js              "Alle Fronten: Angriff" (Schaltfläche und Testlauf)
  economy.js               Wirtschaft: Mobilisierung, Geld, Rohstoffe, Ausrüstung, Gebäude, Bau,
                           Standorteignung, Auffüllung/Aufstellung von Divisionen, KI-Wirtschaft
  infra.js                 Bahn: Zustand je Feld, Ausbaustufe je Region, Knoten, Brücken,
                           Instandsetzung, Nachschub über intakte Bahnknoten
  save.js                  Speichern/Laden (vollständiger Zustand, dünn besetzt gegenüber Start)
  history.js               Momentaufnahme je Tag (geänderte Felder, Ereignisindex) für den Zeitraffer
  sectors.js, rng.js (mit speicherbarem Zustand), calendar.js, constants.js
src/data/projection.js     EPSG:3035 vorwärts/rückwärts (ellipsoidisch)
src/data/grid.js           Feldraster: Besitzer, Terrain, Nachbarn
src/data/loader.js         Laden und Dekodieren von public/data/*
src/map/camera.js          Kamera (Zoom um Mauszeiger, Verschieben, Begrenzung)
src/map/renderer.js        Kartenzeichnung in Ebenen: statisch (Länder, Relief, Grenzen, Bahn,
                           Beschriftung; nur bei Kamera-/Moduswechsel neu) und dynamisch (Besetzung
                           feldweise mit Schraffur, Frontbalken mit Abschnittsstatus, Belagerungen)
src/map/styles.js          Farben und Schriften je Kartenmodus
src/ui/                    panel.js (Feldinfo, Nation), game.js (Lage, Frontfenster, Kampfanzeige,
                           Meldungen, Abschluss), economy.js (Kennzahlen, Wirtschaftsleiste,
                           Standortwahl), flags.js
src/styles/                base.css + front.css / economy.css / intel.css (Layout je Modus), game.css, econ.css
src/assets/flags/          Nationalflaggen 1939 als SVG (vereinfacht)
public/data/               erzeugte Spieldaten (nicht von Hand ändern)
tools/                     Datenpipeline, Tests, Screenshot- und Layoutprüfung
tools/data/                handgepflegte Eingaben (Städte, Näherungspolygone, Industriezentren,
                           Rohstoffgebiete)
SOURCES.md                 historische Werte mit Quelle (belegt / ungeprüft)
tests/                     JavaScript-Tests (node:test), u. a. Testlauf Polenfeldzug
screenshots/               Abnahme-Screenshots und Video der letzten Phase
```

## Befehle
```bash
pip install -r tools/requirements.txt
python tools/build_all.py        # Rohdaten laden -> public/data/* erzeugen -> pytest
npm ci
npm test                         # JavaScript-Tests
npm run dev                      # Entwicklungsserver
npm run build && npm run preview # Produktionsbuild lokal (Port 4173)
npm run screenshots              # Playwright-Screenshots + Video eines Angriffs (Preview muss laufen)
node tools/check_layout.mjs      # Überlappungsprüfung der Kopfleiste in 6 Fenstergrößen × 3 Modi
node tools/sim_run.mjs [seed]    # Feldzug ohne Spieler im Terminal (Tagesprotokoll, Tickzeiten)
# Im Browser: ?seed=123 (anderer Zufall), ?debug=1 (Schalter für Kriegserklärungen)
```

## Arbeitsregeln
- Pro Sitzung genau eine Phase.
- Erst testen, dann berichten: `python tools/build_all.py` (pytest) und `npm test` müssen grün sein,
  Screenshots aller drei Modi werden angesehen und geprüft.
- Spielwerte nur in `data/balance.json`; nichts als historische Tatsache ausgeben, was nicht geprüft ist.
- Simulation bleibt frei von DOM und Darstellung; Zufall nur über `sim.rng` (Seed), damit Läufe
  reproduzierbar sind. Ein Tick muss unter 16 ms bleiben (Test in `tests/sim.test.js`).
- Alle Datenschritte reproduzierbar als Skripte in `/tools`. Keine Handbearbeitung erzeugter Dateien.
- Jede Datenquelle mit Lizenz in `LICENSES.md`, historische Werte mit Quelle in `SOURCES.md`.
- Alles, was den weiteren Verlauf beeinflusst, muss in `save.js` gespeichert werden (Test:
  Laden + 30 Tage = ununterbrochener Lauf).

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

## Datenmodell (Phase 2)
- Zeit: 1 Tick = 1 Spieltag, Tag 0 = 31.08.1939. Geschwindigkeit Pause/1×/2×/4×, 1× = 4,5 s je Tag.
  Die Darstellung blendet zwischen zwei Ticks über (`render(t)`, t = Anteil des Tages).
- Kriegszustand aus `balance.json` (`scenario.wars`), Danzig wird an Tag 1 angegliedert.
- Divisionen: `{id, nation, men, maxMen, tank, air, front, transit}`; `front = 0` heißt Reserve.
  Verlegung dauert `ceil(Entfernung / kmPerDay)` Tage.
- Fronten: zusammenhängende Ketten von Kontaktkanten zwischen Kriegsgegnern; Identität über
  `frontHint` je Feld (Mehrheitsentscheid), Teilung verteilt Divisionen anteilig, Verschmelzung
  vereinigt sie. Abschnitt = Front ∩ Sektor (feste Voronoi-Aufteilung, ca. 100 km).
- Je Front und Seite: Befehl (`hold` / `prepare` / `attack`), Vorbereitung `prep` (0–1),
  Vorgehen (`minimal` / `total`), Tagesstatistik. Befestigung je Feld (`sim.fort`).
- Vormarsch: Chance je gegnerischem Grenzfeld aus Kräfteverhältnis, Gelände, Befestigung,
  Vorbereitung, Luft, Panzer, Nachschub (`sim.supply`), Vorgehen, Zufall; bis zu 3 Felder pro Tag.
- Kessel = Fläche ohne Verbindung zum größten zusammenhängenden Gebiet (vor Kriegsbeginn
  abgetrennte Teile wie Ostpreußen ausgenommen). Belagerung für Hauptstädte und Städte bis Rang 2.
- Kapitulation: Hauptstadt verloren und Gebietsverlust ≥ `capitulation.lostShare`.
- Ertrag eroberter Felder: `sim.yieldOf(cell)` (für die Wirtschaft in späteren Phasen).

## Datenmodell (Phase 3)
- `public/data/infra.json` (aus `tools/build_infra.py`): Bahnfelder, Bahnknoten, Brücken,
  Industriezentren, Rohstoffgebiete.
- Wirtschaft je Nation (`sim.econ`): Bevölkerung, Mobilisierungsstufe (1–5), Geld, Rohstoffe,
  Ausrüstung (davon Panzer), Panzeranteil der Rüstung, Rekrutierte/Ersatz. Einnahmen werden über
  `productivity` an das BIP 1938 angeglichen (`incomePerGdpPerDay`).
- Arbeitskräfte: Erwerbspersonen = Bevölkerung × `laborShare`; Soldaten-Ziel = Bevölkerung ×
  Mobilisierungsrate; Produktionsfaktor = Arbeiter / Arbeiter bei Friedensstärke.
- Gebäude `{type, cell, nation, site, health, progress, done}`; Wirkung = Zustand × Standort ×
  Ertrag (Eroberung) × Bahnstufe × Arbeitskräfte. Produktion gehört dem Besitzer des Feldes.
- Divisionen haben zusätzlich `equip` (0–100); Kampfwert = 0,5 × Mannschaft + 0,5 × min(Mannschaft,
  Ausrüstung). Verluste kosten Ausrüstung anteilig; Auffüllung täglich aus Ersatz und Bestand.
- Bahn: `railState` je Feld (0 keine, 1 intakt, 2 beschädigt, 3 zerstört), `railLevel` je Sektor
  (1–5), Knoten und Brücken mit eigenem Zustand (für Sabotage/Luftangriffe in Phase 4).
  Eroberte Strecken: minimaler Schaden → beschädigt, totale Verwüstung → zerstört, Brücken gesprengt.
  Instandsetzung schreitet von intakten eigenen Strecken aus voran.
- Nachschub: Abstand zum nächsten intakten Bahnknoten, der über intakte eigene Strecken mit dem
  Kernnetz verbunden ist; voll bis `supply.fullCells`, dann abnehmend bis `rangeCells`.
- Speichern: `serialize(sim)` / `deserialize(sim, data)`; im Browser localStorage (manuell +
  Autosave alle 7 Tage), Export/Import als gzip-Datei (`.durchbruch`). Laden = Seite neu laden mit
  hinterlegtem Stand (sessionStorage).

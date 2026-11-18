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
| 4 | Forschung, Geheimdienst, Generäle | fertig |
| 5–6 | folgen | offen |

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
data/scientists.json       Wissenschaftler (Fachgebiet, Ort 1939; Quellen in SOURCES.md)
data/generals.json         Generäle mit Eigenschaft (historisch nur mit belegter Kriegsführung)
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
  research.js              Forschung: Schwerpunkt und Budget je Anstalt, Ergebnisse mit
                           steigenden Kosten, abstrakte Effekte (mods), Uran-Bedingung
  scientists.js            Wissenschaftler: Bonus in derselben Region, Loyalität, Flucht, Verrat,
                           Bewachung, Gefangennahme
  intel.js                 Geheimdienst: Stufe, Agenten, Missionen, Enttarnung, Beziehungen,
                           Nebel des Krieges (isRevealed), Desinformation, KI-Missionen
  airstrike.js             Luftangriffe einer Front auf Knoten/Brücken/Fabriken hinter der Front
  generals.js              ein General je Front und Seite, Eigenschaften, automatische Besetzung
  sectors.js, rng.js (mit speicherbarem Zustand), calendar.js, constants.js
src/data/projection.js     EPSG:3035 vorwärts/rückwärts (ellipsoidisch)
src/data/grid.js           Feldraster: Besitzer, Terrain, Nachbarn
src/data/loader.js         Laden und Dekodieren von public/data/*
src/map/camera.js          Kamera (Zoom um Mauszeiger, Verschieben, Begrenzung)
src/map/renderer.js        Kartenzeichnung in Ebenen: statisch (Länder, Relief, Grenzen, Bahn,
                           Beschriftung; nur bei Kamera-/Moduswechsel neu) und dynamisch (Besetzung
                           feldweise mit Schraffur, Fronten als Stacheldraht, Belagerungen)
src/map/styles.js          Farben und Schriften je Kartenmodus
src/ui/                    panel.js (Feldinfo, Nation), game.js (Lage, Frontfenster, Kampfanzeige,
                           Meldungen, Abschluss, General, Luftangriffe), economy.js (Kennzahlen,
                           Wirtschaftsleiste, Standortwahl, Reiter Forschung), intel.js (Akte,
                           Agenten, Missionen), flags.js
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

## Datenmodell (Phase 4)
- Forschung: Anstalt `{focus: heer|luft|industrie|sonder, budget, guard}`; je Nation und Schwerpunkt
  `{level, progress}`. Fortschritt/Tag = min(Budget, maxBudget) × (1 + Wissenschaftlerbonus) ×
  Zustand. Ergebnis k kostet `baseCost × costGrowth^k`. Effekte (`mods(sim, n)`): attack, defense,
  tank, air, airDefense, strike, counter, production, repair, railCost, resources, equipment, supply.
  Atombombe braucht ein eigenes Uran-Rohstoffgebiet und schaltet nur eine Fähigkeit frei.
- Wissenschaftler `{employer, origin, cell, loyalty, guard, status}`: Bonus nur, wenn in derselben
  Region (Sektor) eine passende Anstalt des Dienstherrn steht. Fachgebiet `geheimdienst` erhöht die
  Spionageabwehr. Fremde Wissenschaftler können fliehen oder Ergebnisse verraten.
- Geheimdienst je Nation `{level, agents, revealedSectors, revealedNations, phantom}`; Erfolgschance
  = Basis + perLevel × (Stufe − gegnerische Abwehr) − perGuard × Bewachung, beim Start der Mission
  festgehalten und genau so gewürfelt (`resolveAgent`). Enttarnung kostet den Agenten und senkt
  `sim.relations` (Diplomatie ab Phase 5).
- Nebel des Krieges: Gegnerische Divisionen nur geschätzt (±25 %), Befestigung, Industrie,
  Belagerungswerte und Forschung unbekannt, solange das Gebiet bzw. die Nation nicht aufgeklärt ist.
- Nachschub zusätzlich mit Durchsatz: Zahl nutzbarer Knoten im Umkreis `supply.capRadius`
  (gesättigt bei `capNodes`). Zerstörte Knoten/Brücken brauchen länger zur Instandsetzung und
  bremsen Verlegungen in ihrer Nähe.
- Front-Seite zusätzlich: `general`, `airShare` (fehlt an der Front), `strikeTarget`.

## Darstellung Frontlinie (Zwischenauftrag)
- Fronten werden als Stacheldraht gezeichnet (`renderer.js`: `buildFrontGeometry`, `wireTiles`,
  `drawWire`). Kontaktkanten je Front zu Linien verkettet, Chaikin-geglättet (2 Durchgänge).
- Draht = vorberechnete Musterkacheln, in gleichen Bogenlängen als Sehnen entlang der Linie gestempelt.
- Zoomstufen: unter 6 px je Feld schlichte Linie, bis 14 px verdrillter Draht, darüber Stacheln,
  Dichte nach Befestigung (0,33 / 0,66), ab 0,66 Holzpfähle. Schein: Messing = vorbereiten,
  grau = halten, rot = Angriff (nach Abschnittsstatus).

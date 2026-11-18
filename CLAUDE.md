# Durchbruch

## Projektziel
"Durchbruch" ist ein privates Echtzeit-Strategiespiel im Browser (HTML/JavaScript) zum Zweiten
Weltkrieg. Start am 1. März 1939 (seit der Überarbeitung), der Spieler führt Deutschland. Das Spiel wird in 6 Phasen
gebaut.

| Phase | Inhalt | Stand |
|---|---|---|
| 1 | Karte und Grundgerüst | fertig |
| 2 | Echtzeit und Kampf (Deutschland gegen Polen spielbar) | fertig |
| 3 | Wirtschaft, Infrastruktur, KI-Nationen, Speichern | fertig |
| 4 | Forschung, Geheimdienst, Generäle | fertig |
| 5 | Moral, Diplomatie, Ereignisse, Hauptmenü, Spielende (Version 1 fertig) | fertig |
| – | Überarbeitung: Start 01.03.1939, Diplomatie-Reiter, Länderfenster, Ziele, Tutorial | fertig |
| – | Überarbeitung 2: Aufmarsch im Frieden, Taktiken, Haltelinie, Truppen-Medaillons, geführter Einstieg | fertig |
| 6 | folgt | offen |

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
  morale.js                Moral je Nation, Propaganda, Wirkung auf Kampf/Produktion/Desertion/Kapitulation
  diplomacy.js             Verträge, Beziehungen, Kriegserklärung, Bündnispflicht, Angebote, Frieden,
                           Waffenstillstand ohne Landfront
  events.js                historische Ereignisse (Auslöser) und Entscheidungs-Pop-ups, Teilungslinie
  news.js                  Zeitung "Der Tagesanzeiger" (Schlagzeilen aus den Meldungen)
  goals.js                 nationale Ziele (Zielbaum, dauerhafte Wirkungen über sim.dip.effects)
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
                           Meldungen, Abschlussbildschirm, General, Luftangriffe), economy.js (Kennzahlen,
                           Wirtschaftsleiste, Standortwahl, Reiter Forschung), intel.js (Akte,
                           Agenten, Missionen), phase5.js (Entscheidung, Diplomatie, Zeitung, Moral),
                           menu.js (Hauptmenü, Einstellungen, Mitwirkende), menuMedia.js (Diashow,
                           Zeitungsstapel, Musik, Bildnachweise), ui2.js (Hinweise, Ziel, Banner,
                           Länderfenster, Diplomatie-Reiter, Zielbaum, Tutorial), flags.js
src/styles/                base.css + front.css / economy.css / intel.css (Layout je Modus), game.css, econ.css,
                           phase5.css, diplomacy.css (Ansicht 4), ui2.css (Kopfleiste, neue Elemente)
src/assets/flags/          Nationalflaggen 1939 als SVG (vereinfacht)
public/data/               erzeugte Spieldaten (nicht von Hand ändern)
tools/                     Datenpipeline, Tests, Screenshot- und Layoutprüfung
tools/data/                handgepflegte Eingaben (Städte, Näherungspolygone, Industriezentren,
                           Rohstoffgebiete)
SOURCES.md                 historische Werte mit Quelle (belegt / ungeprüft)
MEDIA_SOURCES.md           Fotos, Zeitungen, Musik im Hauptmenü: Titel, Quelle, Urheber, Lizenz; Verworfenes
public/media/              Menü-Medien (erzeugt von tools/build_media.py aus tools/data/media.json)
tests/                     JavaScript-Tests (node:test), u. a. Testlauf Polenfeldzug
screenshots/               Abnahme-Screenshots und Video der letzten Phase
```

## Befehle
```bash
pip install -r tools/requirements.txt
python tools/build_all.py        # Rohdaten laden -> public/data/* erzeugen -> pytest
python tools/build_media.py      # Menü-Medien laden (Lizenz je Datei geprüft) -> public/media/*, MEDIA_SOURCES.md
npm ci
npm test                         # JavaScript-Tests
npm run dev                      # Entwicklungsserver
npm run build && npm run preview # Produktionsbuild lokal (Port 4173)
npm run screenshots              # Playwright-Screenshots + Video eines Angriffs (Preview muss laufen)
node tools/check_layout.mjs      # Überlappungsprüfung der Kopfleiste in 6 Fenstergrößen × 3 Modi
node tools/sim_run.mjs [seed]    # Kampagne ohne Spieler (Normal, Angriff auf Polen, Westen halten) im Terminal
# Im Browser: ?seed=123 (anderer Zufall), ?debug=1 (Schalter für Kriegserklärungen), ?menu=0 (ohne Hauptmenü)
```

## Arbeitsregeln
- Pro Sitzung genau eine Phase.
- Änderungswünsche des Nutzers vollständig und gründlich umsetzen, nicht minimal: jeden genannten
  Punkt in voller Breite (z. B. Tutorial erklärt alle Bereiche, nicht nur die Grundbedienung) und
  vor dem Bericht gegen die ursprüngliche Liste abhaken.
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

## Datenmodell (Phase 5)
- Moral: `nations[n].morale` (0–100), Gleichgewicht `morale.start` (+ Schwierigkeit beim Spieler).
  Städte/Kessel/Kapitulationen ±, tägliche Verluste und Kriegsmüdigkeit −. Unter `lowFrom` sinken
  Kampfkraft (`moraleCombat`) und Produktion (`moraleProduction`), unter `desertBelow` Desertion;
  über `highFrom` steigt die Kapitulationsschwelle (`capitulationBonus`). Propaganda kostet Geld,
  Wirkung × `decay` je Einsatz der letzten `windowDays`.
- Diplomatie `sim.dip`: `alliances`, `pacts` (Paare), `wars[a-b] = {aggressor, day, attacked,
  obligation}`, `obligations`, `scheduled` (Bündnis-Kriegserklärungen), `breaches`, `offers`
  (Wartezeit), `noFront` (Waffenstillstand), `everEnemies`, `flags` (Ereignisse), `effects`
  (befristete Wirkungen, z. B. Rüstung −25 %), `partition` (Teilungslinie). Beziehungen in
  `sim.relations` (−100 … +100). Bündnis = Beistandspakt gegen den ersten Angreifer; Spieler wird
  nie automatisch verpflichtet. Szenario-Krieg DEU–POL: Bündnispflichten erst beim ersten Angriff.
- KI-Haltung (`ai.js decidePosture`): Angreifer ab Kräfteverhältnis `aiAttackRatio.offensive`,
  Verteidiger ab `defensive` und erst nach `aiDefensiveDelayDays`; gegnerische Befestigung zählt.
- Entscheidungen: `sim.pending = {kind, title, text, options}`; `tick()` gibt `false` zurück und
  rechnet nicht weiter, bis `decide(sim, k)`. Testläufe: `sim.autoDecide`.
- Spielende `sim.outcome = {result: 'sieg'|'niederlage', day, allCapitulated}`. Sieg: keine Gegner
  mehr und mindestens eine Kapitulation; Niederlage: Kapitulation Deutschlands.
- Einstellungen `sim.settings = {difficulty, sandbox}`; `sim.diff()` liefert die Stufe
  (aiAttack, income, supply, morale, intel). Startwerte sind auf allen Stufen gleich.
- Zeitung `sim.news` (Schlagzeilen mit Priorität), `issue(sim, day)` = Ausgabe der letzten 7 Tage.
- Leistung: Nachschub wird bei Bedarf je angreifender Nation berechnet (`ensureSupply`, regional um
  die Fronten), Grenzfeldliste statt Rechteckdurchlauf, Kessel/Bedrohung nur nach Gebietsverlust.
  Alle Felder des Simulationsobjekts werden im Konstruktor angelegt (stabile Objektform).

## Hauptmenü mit Originalmaterial (Zwischenauftrag)
- Nur gemeinfreies oder frei lizenziertes Material; Lizenz je Datei an der Quelle geprüft
  (`tools/build_media.py`), Nachweise in `MEDIA_SOURCES.md` und `public/media/credits.json`
  (Menüpunkt „Mitwirkende“). Unklare Lizenz → Datei wird nicht verwendet.
- Fotos 1600×900 WebP < 300 KB (Sepia, Filmkorn), Wechsel alle 8 s mit langsamem Zoom und
  verschwommener Überblendung; Zeitungsseiten als gedrehter Stapel (Hover vergrößert);
  Filmkorn, Flackern, Kratzer, Vignette per CSS; bei „Bewegung reduzieren“ nur Standbild.
- Musik (MP3 < 5 MB) startet erst nach dem ersten Klick, Schalter „Musik an/aus“, Lautstärke aus
  den Einstellungen; spielt nur, solange das Menü sichtbar ist.
- Das Menü erscheint sofort beim Seitenaufruf; die Karte lädt dahinter (Spielstart erst danach).

## Überarbeitung (Start 1. März 1939, Bedienung)
- Daten: Tschecho-Slowakei (CSR) und Albanien (ALB) als eigene Staaten, Memelland litauisch
  (`tools/territories.py`, `tools/nations.py`). Tag 0 = 01.03.1939, kein Krieg zu Beginn.
- Szenario: `scenario.annexations` (mit `day` oder `onWar`) und `scenario.treaties` (Tag, Paar,
  Bedingungen). Friedliche Übertragung über `sim.annex()` (kein Ertragsverlust, Nation ohne Felder
  wird aufgelöst); Liste in `sim.dip.annexed`, die Karte übernimmt Besitzer/Namen (`applyAnnexations`).
- Kriegserklärung des Spielers: Aufmarsch der Reserve direkt an die neuen Fronten (`deployReserve`,
  Anteil `reserveShare` bleibt zurück); Generäle werden sofort besetzt.
- Kleine Staaten haben Platzhalter-Armeen und sind angreifbar; Anschluss-Angebot (`offerAnschluss`,
  Bewertung aus Kräfteverhältnis, Beziehung, Schutzmächten) und Rohstoffabkommen (`offerRohstoffe`).
- Nationale Ziele: `balance.json goals.list`; ein Ziel gleichzeitig; Wirkungen armament, income,
  moraleBase, tank, air, research, borderFort, warPrep, relation, annex, mobilize.
- Oberfläche: Kopfleiste links Flagge + Kennzahlen, Mitte Ansichten 1–4, rechts Hinweise, Ziel,
  Datum/Tempo. Ansicht 4 Diplomatie (Karte nach Stand/Beziehung). Klick auf ein fremdes Land im
  Frontmodus öffnet das Länderfenster mit Aktionen. Ereignis-Banner für Krieg, Verträge, Gebiete.
  Nachschub-Schicht (Taste N) bis ca. 200 km hinter den Fronten. Tutorial beim ersten Spiel und
  im Menü. Tasten: D Diplomatie, Z Ziele, T Zeitung.
- Flüssigkeit: Besetzung und Draht blenden weich über den Tag über; Seitenleisten werden nur
  aktualisiert, wenn sichtbar, und erst nach dem Bild des Tageswechsels.
- Speicherstand Version 6 (Ziele; Nationsindizes geändert, ältere Stände werden nicht geladen).

## Überarbeitung 2 (Aufmarsch, Taktik, Bedienung)
- Aufmarsch: `sim.dip.plans` = Paare [Planer, Ziel]. `updateFronts` legt dafür Grenzfronten mit
  `planned = true` an (kein Kampf, KI/Kessel/Luftangriffe ignorieren sie; nur der Planer bereitet vor
  und befestigt). Bei Kriegserklärung behält die Front Kennung, Divisionen, Vorbereitung, General.
  `planDeployment` (Reserve per Verlegung), `cancelPlan`, `bordersWith` in `diplomacy.js`.
- Taktik je Front und Seite (`side.tactic`, `balance.json tactics`): standard, blitzkrieg (Panzer,
  Nachschub), luft (Geld je Division/Tag), zange (Felder mit ≥ 2 eigenen Nachbarn), material.
  Wirkung anteilig nach Panzer-/Luftanteil (`tacticOf` in `combat.js`).
- Haltelinie (`side.objective = {line}` in Feldkoordinaten): `objectiveMask` erlaubt nur Felder, die
  von der Front ohne Überqueren der (an den Enden verlängerten) Linie erreichbar sind; erreicht →
  Befehl halten. Zeichnen: Maus gedrückt ziehen (Douglas-Peucker, Chaikin in der Anzeige).
- Darstellung: Draht wandert (Punktzuordnung alt → neu, `linkGeometry`), eroberte Felder füllen sich
  wellenförmig (`startOccAnim`), weicher Zoom/Schwenk (`camera.stepZoom`). Truppen-Medaillons
  (Eichenlaub, Porträt-Silhouette, Stärkering, Band mit Zahl) beidseits des Drahts, wandernde
  Verlegungen mit Resttagen, Reserve an der Hauptstadt. Rechtsklick auf Front = verlegen.
- Tutorial: Kapitelübersicht (Taste H), geführter Einstieg beim ersten Spiel (wartet auf Aktionen),
  Erstbesuch-Angebote je Ansicht (`localStorage durchbruch-seen-*`).

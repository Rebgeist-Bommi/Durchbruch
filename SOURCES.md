# Historische Werte und Quellen

Stand Phase 5. Alle Zahlen in `data/balance.json`, die hier nicht als **belegt** geführt sind, sind
Spielwerte oder tragen den Vermerk „# TODO historisch prüfen“.

## Belegt (in dieser Sitzung an der Quelle geprüft)

| Wert | Verwendung | Quelle |
|---|---|---|
| Bevölkerung Deutsches Reich, Volkszählung 17.05.1939: 79.375.281 | `economy.nations.DEU.pop` (zusammen mit dem Protektorat 86,8 Mio.) | Statistisches Jahrbuch für das Deutsche Reich (Ausgaben 1939–1941/42), digitalisiert unter https://digi.bib.uni-mannheim.de/fileadmin/statjahrb/514401303_1941/pdf/514401303_0059.pdf |
| Protektorat Böhmen und Mähren: rund 7,38 Mio. Einwohner | dito | ebd. (Tabelle Reichsgebiet und Protektorat) |

## Aus der Fachliteratur übernommen, aber nicht online geprüft (# TODO historisch prüfen)

Die Quelle war aus dieser Sitzung nicht erreichbar (Host `warwick.ac.uk` nicht freigegeben). Die
Werte stammen aus der Literatur und sind als Größenordnung zu verstehen:

| Wert | Verwendung | Quelle |
|---|---|---|
| BIP 1938 in Mrd. internationaler Dollar (1990): Vereinigtes Königreich 284, Frankreich 186, Deutschland 351 (+ Österreich 24 = 375), Italien 141, Sowjetunion 359 | `economy.nations.*.gdp1938`: skaliert die Einnahmen der Nationen zueinander | Mark Harrison (Hg.): The Economics of World War II. Cambridge University Press 1998, Kap. 1, Tab. 1.1 |
| BIP 1938: Polen 76, Niederlande 45, Finnland 12 (Größenordnung) | dito | Angus Maddison: Monitoring the World Economy 1820–1992. OECD 1995 (über Harrison 1998) |
| Bevölkerung 1938/39 in Mio.: Polen 35,1, Frankreich 41,9, Vereinigtes Königreich 47,5, Italien 43,4, Sowjetunion 170,6 (Volkszählung Januar 1939), Niederlande 8,7, Finnland 3,7 | `economy.nations.*.pop` | Harrison 1998, Tab. 1.1 (Grundlage: Völkerbund 1940); Sowjetunion: Volkszählung 1939 |

## Kontext (nicht als Spielwert verwendet)

- Deutsche Rohstahlerzeugung 1939: 22,0 Mio. t einschließlich Österreich und Saar (House of Commons,
  schriftliche Antwort „Steel Output“, 18.02.1946, https://api.parliament.uk/historic-hansard/commons/1946/feb/18/steel-output).
  Sie diente nur als Plausibilitätsrahmen für das große Gewicht von Ruhr und Oberschlesien.

## Ungeprüfte Spielwerte (Auswahl)

- Divisionszahlen aller Nationen, Panzer- und Luftanteile, Ausrüstungsbestände, Geld- und Rohstoffbestände
- Zahl der Gebäude je Industriezentrum (`tools/data/industry.csv`): Gewichtung nach allgemein bekannter
  Bedeutung der Zentren, keine Produktionsstatistik
- Förderwerte der Rohstoffgebiete (`tools/data/resources.csv`): relative Gewichte
- Bahn-Ausbaustufen zum Start, Mobilisierungsstufen, Kosten, Bauzeiten, Unterhalt

## Phase 4: Wissenschaftler (`data/scientists.json`)

Bonus und Loyalität sind Spielwerte. Belegt heißt: in dieser Sitzung über die genannte Quelle
geprüft. Wikipedia und warwick.ac.uk waren aus der Sitzung nicht direkt abrufbar; geprüft wurde
über Suchergebnisse mit den angegebenen Seiten.

| Person | Angabe im Spiel | Stand | Quelle |
|---|---|---|---|
| Hans von Ohain | Strahltriebwerk, Heinkel; Erstflug He 178 am 27.08.1939 | belegt; Standort Rostock: # TODO historisch prüfen | https://www.airandspaceforces.com/article/0106engines/ |
| Frank Whittle | Strahltriebwerk, Power Jets Ltd. (1936), Auftrag W1 Juli 1939 | belegt; Standort Lutterworth: # TODO historisch prüfen | https://www-g.eng.cam.ac.uk/125/achievements/whittle/Chronology.htm |
| Sergei Koroljow | Raketen; seit Juni 1938 in Haft (Lager an der Kolyma), 1940 zurück nach Moskau | belegt | https://russianspaceweb.com/korolev.html |
| Igor Kurtschatow | Kernphysik, Leningrader Physikalisch-Technisches Institut (seit 1925), 1939 Arbeiten zur Kettenreaktion mit Fljorow | belegt (Ort 1939 aus Institutszugehörigkeit abgeleitet) | https://ipfs.ssi.eecc.de/ipns/en.wikipedia-on-ipfs.org/wiki/Igor_Kurchatov |
| Marian Rejewski | Kryptoanalyse, Polnisches Chiffrierbüro (Enigma 1932, Treffen in Pyry Juli 1939) | belegt | https://www.gchq.gov.uk/news/director-gchq-commemorates-crucial-pre-war-enigma-information-sharing-meeting-poland |
| Werner Heisenberg | Kernphysik, Leipzig; Uranverein ab 1939 | belegt | https://link.springer.com/10.1007/s00016-022-00294-8 |
| Frédéric Joliot-Curie | Kernphysik, Paris; 1939 Nachweis mehrerer Neutronen je Spaltung | belegt | https://ahf.nuclearmuseum.org/manhattan-project-spotlight-french-scientists |
| Gerhard Schrader | Chemie (Entdecker mehrerer Kampfstoffe 1936/1938) | Fachgebiet belegt; Labor Leverkusen (IG Farben): # TODO historisch prüfen | https://en.wikipedia.org/wiki/Gerhard_Schrader (über Suche) |
| Alan Turing | Kryptoanalyse, Bletchley Park ab Anfang September 1939 | teilweise belegt (Mathematiker meldeten sich Anfang Sept. 1939 in Bletchley); genaues Datum: # TODO historisch prüfen | https://www.nsa.gov/portals/75/documents/about/cryptologic-heritage/historical-figures-publications/publications/wwii/solving_enigma.pdf |
| Otto Hahn | Kernchemie, Berlin(-Dahlem) | # TODO historisch prüfen (allgemein bekannt, nicht online geprüft) | – |
| Wernher von Braun | Raketen, Peenemünde | # TODO historisch prüfen | – |
| Robert Watson-Watt | Radar, London (Luftfahrtministerium) | Fachgebiet allgemein bekannt; Funktion und Ort 1939: # TODO historisch prüfen | – |

Im Spiel gibt es keine technischen Details realer Waffen; die Forschungsergebnisse sind abstrakte
Prozentboni. Uran: Rohstoffgebiet Sankt Joachimsthal (Uranerzbergbau, allgemein bekannt; Lage und
Bedeutung 1939: # TODO historisch prüfen).

## Phase 4: Generäle (`data/generals.json`)

| General | Eigenschaft | Stand | Quelle |
|---|---|---|---|
| Heinz Guderian | Panzerspezialist | belegt: führte 1939 das XIX. (Panzer-)Korps als Speerspitze im Norden des Polenfeldzugs | https://en.wikipedia.org/wiki/XIX_Army_Corps (über Suche) |
| Erich von Manstein | Stratege | # TODO historisch prüfen (Planungsrolle 1939/40 allgemein bekannt, nicht online geprüft) | – |
| Walter Model | Verteidiger | # TODO historisch prüfen | – |
| Tadeusz Kutrzeba | Stratege (Gegenangriff an der Bzura) | # TODO historisch prüfen | – |

Alle übrigen Generäle sind erfunden und so benannt („(erfunden)“). Wertende Eigenschaften
(„vorsichtig“, „rücksichtslos“) tragen nur erfundene Generäle.

## Phase 5: Diplomatie und Ereignisse

Verträge zum Stichtag und historische Anlässe der Ereignisse. Geprüft in dieser Sitzung über
Suchergebnisse mit den genannten Seiten. Das Eintreten im Spiel hängt von der Spiellage ab; Daten
im Spiel sind keine Behauptung, dass es so kommen muss.

| Angabe | Verwendung | Stand | Quelle |
|---|---|---|---|
| Stahlpakt Deutschland–Italien, unterzeichnet 22.05.1939 in Berlin | Startbündnis DEU–ITA (`diplomacy.alliances`) | belegt | https://en.wikipedia.org/wiki/Pact_of_Steel (über Suche); https://germanhistorydocs.org/en/nazi-germany-1933-1945/the-pact-of-steel-the-signing-of-the-german-italian-military-alliance-in-the-new-reich-chancellery-may-22-1939 |
| Deutsch-sowjetischer Nichtangriffspakt 23.08.1939 mit geheimem Zusatzprotokoll: Interessengrenze in Polen etwa entlang Narew, Weichsel und San (Pissa per Ergänzung) | Startpakt DEU–SOV; Option „Linie Narew–Weichsel–San“ im Teilungsangebot | belegt | https://avalon.law.yale.edu/20th_century/addsepro.asp; https://soviethistory.msu.edu/1939/soviet-territorial-annexations/soviet-territorial-annexations-texts/secret-protocol/ |
| Grenz- und Freundschaftsvertrag 28.09.1939: Linie weitgehend entlang Bug und San | Option „Linie am Bug“ | belegt; genauer Verlauf in den Quellen uneinheitlich | https://www.britishpoles.uk/?p=47173; https://www.marxists.org/history/ussr/great-patriotic-war/soviet-german-pact/tasca/ch5.htm |
| Britische Garantieerklärung für Polen (März 1939), britisch-polnisches Beistandsabkommen 25.08.1939 | Bündnis GBR–POL | belegt (Abkommen 25.08.); Tag der Garantieerklärung: # TODO historisch prüfen | https://ipfs.ssi.eecc.de/ipns/en.wikipedia-on-ipfs.org/wiki/Anglo-Polish_military_alliance |
| Französisch-polnisches Bündnis | Bündnis FRA–POL | # TODO historisch prüfen (allgemein bekannt, Vertragsdaten nicht online geprüft) | – |
| Britisch-französisches Bündnis | Bündnis GBR–FRA | # TODO historisch prüfen (vereinfachte Abbildung der Zusammenarbeit 1939) | – |
| Kriegserklärung Großbritanniens und Frankreichs an Deutschland am 03.09.1939 nach Ultimaten | Ereignis „Beistand für Polen“ (2 Tage nach dem ersten Angriff) | belegt | https://sites.lsa.umich.edu/ww2/1939-2/; https://courses.lumenlearning.com/suny-hccc-worldhistory2/chapter/hostilities-commence/ |
| Sowjetischer Einmarsch in Ostpolen am 17.09.1939; die Westmächte erklärten der Sowjetunion nicht den Krieg | Ereignis „Rote Armee“; Bündnispflicht nur gegen den ersten Angreifer | belegt | https://sites.lsa.umich.edu/ww2/1939-2/ |
| Winterkrieg: sowjetischer Angriff auf Finnland am 30.11.1939, Ende 13.03.1940 | KI-Entscheidung der Sowjetunion ab Tag 85 | belegt | https://talvisota.fi/en/world-war/; https://ipfs.ssi.eecc.de/ipns/en.wikipedia-on-ipfs.org/wiki/Timeline_of_the_Winter_War |
| Kriegseintritt Italiens gegen Frankreich und Großbritannien am 10.06.1940 | Ereignis „Italien tritt in den Krieg ein“ (abhängig von Lage und Beziehung) | belegt | https://www.britannica.com/event/World-War-II/Italys-entry-into-the-war-and-the-French-Armistice |
| Westwall, Maginot-Linie, Alpenbefestigungen (Bestehen 1939) | Grenzbefestigung ab Kriegsbeginn (`start.borderFortification`) | allgemein bekannt; Stärke ist Spielwert | – |

Nicht historisch (fiktiv bzw. Spielmechanik): Friedensangebot Frankreichs, General verweigert einen
Befehl (nur erfundene Generäle), Forderung der Bevölkerung nach Lebensmitteln, Waffenstillstand
Großbritanniens ohne Landfront (Version 1 ohne Seekrieg), alle Beziehungswerte, Moralwerte,
Schwellen und Fristen. Die Teilungslinien sind Näherungen aus Stützpunkten (Länge/Breite) entlang
der Flüsse und nicht flussgenau. Die Zeitung erzeugt Schlagzeilen aus dem Spielverlauf, keine
historischen Zeitungstexte.

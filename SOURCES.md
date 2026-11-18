# Historische Werte und Quellen

Stand Phase 3. Alle Zahlen in `data/balance.json`, die hier nicht als **belegt** geführt sind, sind
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

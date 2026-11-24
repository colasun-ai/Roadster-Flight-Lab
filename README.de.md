# Roadster Flight Lab

[English](README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · **Deutsch** · [Français](README.fr.md) · [Español](README.es.md)

**Drei Fahrzeuge auf einem Testgelände. Springe mit dem düsenunterstützten Roadster über eine Rampe, teste das Fahrwerk des Model 3 in der Steilkurve oder beobachte im Model Y, wie der lokale Fahrplaner durch die Stadt navigiert.**

[Download für Windows x64](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Windows-x64.exe) · [Download für Apple Silicon](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/download/v0.10.0/Roadster-Flight-Lab-0.10.0-Mac-arm64.zip) · [Versionshinweise und Prüfsummen](https://github.com/colasun-ai/Roadster-Flight-Lab/releases/tag/v0.10.0)

![Tesla Garage mit ausgestelltem Model 3 Performance 2018](docs/images/garage.jpg)

## Ihre erste Fahrt

Wählen Sie „Roadster“ in der Tesla-Garage, wählen Sie „Fahren starten“, öffnen Sie dann den Pistenpark und wählen Sie „D5“. Untersuchen Sie das Rampenprofil, springen Sie zum Startpunkt und versuchen Sie den Lauf mit Elektroantrieb. Wiederholen Sie den Vorgang, während Sie die Umschalttaste gedrückt halten, um nach hinten zu stoßen.

**Sprache** · Englisch ist die Ausgangssprache. Wählen Sie in Tesla Garage eine Sprache aus, um die Garage mit Ihrer Wahl erneut zu öffnen. Die App speichert es zwischen den Sitzungen. Menüs, Instrumente, Kursbeschreibungen und Navigationsanweisungen funktionieren offline.

## In der Garage

| Fahrzeug | Was Sie ausprobieren sollten |
| --- | --- |
| Tesla Roadster | Der Roadster nutzt zehn Kaltgasdüsen zum Beschleunigen, Schweben und Steuern in der Luft. Drei Flugmodi verändern die Stabilisierung. Ein Kompressor füllt die Druckbehälter während der Fahrt nach. |
| 2018 Model 3 Performance | Vergleichen Sie die Modi „Standard“, „Leistung“ und „Track“. Das AWD-Modell mit zwei Motoren kombiniert regeneratives und Reibungsbremsen. Die 450-PS-Referenz stammt aus einem historischen Straßentest. |
| 2026 Model Y Performance | Fahren Sie das Performance-SUV auf dem US-Markt mit eigener Leistungsentfaltung, eigenem Fahrwerk und eigener Dämpfung. Nehmen Sie die gleiche Ecke oder den gleichen Hügel wie das Model 3, um die Körperbewegungen zu vergleichen. |

## Zwanzig Möglichkeiten, eine Federung zu testen

Der Pistenpark besteht aus vier Bereichen: Hügelstarts mit 8–45 % Steigung, Kuppen und Senken, Steilhänge und Cross-Achs-Abschnitte sowie Sprünge mit unterschiedlichen Landungen. Der Renderer und die Physik-Engine verwenden dieselben Oberflächenscheitelpunkte. Bei einer Steigung von 45 % steigt der Anstieg auf 100 m horizontaler Distanz um 45 m.

![Roadster auf dem Weg zum D5-Weitsprung](docs/images/jump.jpg)

## Folgen Sie einem lokalen Planer durch die Stadt

Wähle ein Ziel auf der Karte und aktiviere FSD. Das 61,43 km lange Straßennetz umfasst Schnellstraßen, Nebenstraßen, Anschlussrampen, Tunnel und Wendemöglichkeiten. Plan-R1 berechnet 16 zukünftige Fahrzeugpositionen mit Ausrichtung für die nächsten acht Sekunden. Die Regelung folgt der gewählten Bahn und berücksichtigt Verkehr und Bremsweg. Das blaue Band zeigt den Abschnitt direkt vor dem Auto. Mit WASD oder der Leertaste übernimmst du das Steuer.

![Eine Stadtkurve mit dem geplanten Weg, der vor dem Fahrzeug sichtbar ist](docs/images/city.jpg)

## Tastatursteuerung

| Schlüssel | Aktion |
| --- | --- |
| W / S · A / D | Beschleunigen, bremsen oder rückwärts fahren; nach links oder rechts lenken |
| Space | Handbremse; im Stadtmodus übernehmen |
| C · R · Esc | Fahrradkamera; das Auto zurücksetzen; öffne die Garage |
| Shift · J / K · H | Hinterer Boost; vertikale Düsen; Hover umschalten |
| T | Flugmodus beim Roadster oder Fahrmodus beim Model 3 ändern |

## Desktop-Downloads

Doppelklicken Sie unter Windows 11 mit einer Intel- oder AMD-CPU auf die portable EXE-Datei. Planen Sie etwa 3 GB temporären Speicherplatz für die Extraktion ein. Die ausführbare Datei ist nicht signiert, daher zeigt Windows möglicherweise eine Eingabeaufforderung zum unbekannten Herausgeber an.

Entpacken Sie auf einem Apple Silicon Mac die ZIP-Datei und öffnen Sie die App. Es verfügt über eine Ad-hoc-Signatur und wurde nicht von Apple notariell beglaubigt. Beide Desktop-Pakete enthalten die Fahrzeuge, Texturen, die Physik-Engine und den CPU-Planer.

## Was wurde gemessen

Rapier läuft mit festen 120 Hz. Jedes der drei Autos absolvierte alle zwanzig Kurse in einer physikalischen Regression in sechzig Läufen. Bei 1.788 Strahlenproben stimmten die Kollisions- und sichtbaren Neigungshöhen innerhalb von 3 mm überein. Frühere Roadster-Simulatortests verzeichneten 3,502 s für einen elektrischen Start von 0–100 km/h und 1,0411 s mit Jet-Unterstützung. Dies sind Simulatorergebnisse. [Daten zur Neigungsvalidierung](reports/slope-park/驾驶验证.md)

## Aus dem Quellcode erstellen

Verwenden Sie Node.js 22.12 oder neuer mit npm. Das Repository umfasst Originalmodelle, fahrbereite Netze, Texturen, das Aktionsvokabular und den Plan-R1-Checkpoint. Für die erste Abhängigkeitsinstallation ist ein Internetzugang erforderlich.

```sh
git clone https://github.com/colasun-ai/Roadster-Flight-Lab.git
cd Roadster-Flight-Lab
npm ci
npm run dev
```

Windows x64: Verwenden Sie Python 3.10 oder höher, um die eingebettete Laufzeit vorzubereiten, überprüfen Sie die tatsächliche Inferenz und erstellen Sie dann die portable EXE-Datei.

```sh
python scripts/fsd/prepare_windows_runtime.py
node scripts/fsd/smoke_portable.cjs
npm run pack:win
```

Apple Silicon: Installieren Sie die Xcode-Befehlszeilentools und UV, bevor Sie die Laufzeit vorbereiten und die signierte App erstellen.

```sh
python3 scripts/fsd/bootstrap.py
npm run pack:mac
```

### Führen Sie die Regressionssuiten aus

```sh
npm test
npm run test:vehicles
npm run test:fsd
node tests/slope-park.test.js
```

Desktop-Pakete werden in das Desktop-Build-Verzeichnis geschrieben. Das Druckverzeichnis enthält den 1:24 Roadster 3MF und sein Rebuild-Skript.

## Credits und Lizenzen

Fahrzeugmodelle von asiphy007, Ameer Studio, BloxBloger und vecarz / heynic. Die Stadt adaptiert die historische DriveScene Studio-Umgebung von Peixin und verwendet Poly Haven-Bodentexturen. Die lokale Planung basiert auf Plan-R1 von Xiaolong Tang und Kollegen. Das Model Y-Asset ist CC BY-NC 4.0 und ist auf die nichtkommerzielle Nutzung beschränkt. Für den Upstream-Checkpoint gibt es keine gesondert ausgewiesene Lizenz. Roadster Flight Lab ist ein unabhängiger Simulator. [Ursprüngliche Vermögenswerte, Lizenzen und Modifikationen](CREDITS.md)

# KV-Diagramme

Ein kleiner Editor für Karnaugh-Veitch-Diagramme mit 2 bis 4 Variablen, der direkt im Browser läuft. Die Diagramme lassen sich als SVG oder PNG exportieren, etwa für Skripte, Übungsblätter oder Präsentationen.

## Funktionen

- **Zellen** füllen: Ein Klick schaltet durch leer → `1` → `0` → `X`.
- **Gruppen** einzeichnen: „+ Gruppe“ wählen, dann die Zellen im Diagramm anklicken. Esc beendet die Auswahl. Gruppen, die über den Rand hinausgehen, werden als offene Rahmen gezeichnet. Überlappende Gruppen werden unterschiedlich weit eingerückt.
- **Beschriftung** als Balken oder Gray-Code, Minterm-Index ein- oder ausblendbar.
- **Namen** für Funktion und Variablen werden als LaTeX gesetzt, z. B. `x_1` oder `\overline{y}`.
- **Export** einzeln oder für alle Diagramme nebeneinander, als SVG oder als PNG in dreifacher Auflösung.
- **Speichern**: Der Stand bleibt automatisch im Browser erhalten. Über JSON-Export und -Import lässt er sich sichern oder weitergeben.

## Starten

Es gibt keinen Build-Schritt und keine Abhängigkeiten. Es reicht, `index.html` im Browser zu öffnen, oder einen lokalen Server zu starten:

```sh
python3 -m http.server
```

Danach ist der Editor unter <http://localhost:8000> erreichbar.

MathJax wird von jsDelivr geladen. Ohne Internetverbindung funktioniert der Editor trotzdem, die Beschriftungen erscheinen dann aber in einer einfacheren Darstellung, die nur Tiefstellungen versteht.

## Dateien

| Datei | Inhalt |
| --- | --- |
| `index.html` | Seitengerüst und Kopfleiste |
| `style.css` | Gestaltung der Oberfläche |
| `app.js` | Datenmodell, Zeichnen der Diagramme, Export und Oberfläche |

## JSON-Format

```json
{
  "format": "kv-diagramme",
  "version": 1,
  "settings": { "labelStyle": "bars", "showIndex": true },
  "diagrams": [
    {
      "name": "f",
      "vars": ["a", "b", "c", "d"],
      "cells": ["1", "", "", "", "", "", "", "", "1", "", "", "", "", "", "", ""],
      "groups": [{ "color": "#d62728", "cells": [0, 8] }]
    }
  ]
}
```

`cells` ist nach Minterm-Nummer geordnet, die erste Variable ist das MSB. Erlaubte Werte sind `""`, `"0"`, `"1"` und `"X"`. `labelStyle` ist `"bars"` oder `"gray"`.

## Veröffentlichen mit GitHub Pages

Das Repository auf GitHub pushen, dann unter **Settings → Pages** die Option **Deploy from a branch** mit Branch `main` und Ordner `/ (root)` wählen. Die Seite ist danach unter `https://<benutzername>.github.io/<repository>/` erreichbar.

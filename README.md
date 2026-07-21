# Running Society App

Mobile Progressive Web App für den 6‑Wochen-Intervallplan der Running Society Berlin.

## Version 2.1.0

Stabile Release-Version mit finalisiertem Design und vollständiger Kernfunktionalität.

## Funktionen

- automatische 6‑Wochen-Rotation
- persönliche 5-km- und Threshold-Pace
- ausklappbare Trainingskarten
- Streckenkarten und Google-Maps-Treffpunkt
- automatischer Timer für zeitbasierte Intervalle
- manuelle Bestätigung bei Distanzabschnitten
- Wake Lock: Display bleibt während des Trainings aktiv
- Vibration und Sprachansagen
- Strava-Text zum Kopieren
- installierbare PWA
- Offline-Fallback
- automatische Aktualisierung beim nächsten Öffnen

## Projektstruktur

```text
.
├── index.html
├── styles.css
├── app.js
├── manifest.webmanifest
├── sw.js
├── netlify.toml
├── _headers
├── data/
│   └── berlin.json
├── images/
│   ├── woche1.png
│   └── ...
└── icons/
    ├── icon-192.png
    ├── icon-512.png
    └── apple-touch-icon.png
```

## Inhalte bearbeiten

Die Trainings, der Treffpunkt und der Beginn des 6‑Wochen-Zyklus stehen in:

`data/berlin.json`

Wichtige Felder:

- `cycleStart`: Montag, an dem Woche 1 beginnt
- `meetingPointName`
- `meetingPointUrl`
- `workouts`

## GitHub → Netlify

1. Dieses Projekt in ein GitHub-Repository hochladen.
2. In Netlify **Add new site → Import an existing project** wählen.
3. GitHub verbinden und das Repository auswählen.
4. Build command leer lassen.
5. Publish directory: `.`
6. Deploy starten.

Jeder Commit auf GitHub löst danach automatisch einen neuen Netlify-Deploy aus.

## Lokales Testen

Da die App JSON lädt und einen Service Worker nutzt, sollte sie über einen lokalen Webserver geöffnet werden, nicht direkt als `file://`.

Beispiel:

```bash
python -m http.server 8000
```

Anschließend `http://localhost:8000` öffnen.

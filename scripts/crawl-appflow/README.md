# App Flow Runtime-Crawl (B1)

Erste lokale Runtime-Crawl-Implementierung für den App Flow.

## Vertrag (Ein-/Ausgabe)

- **Eingabe:** `baseUrl`, Liste der Screens (path, type, id); optional Projekt-Kontext.
- **Ausgabe:** Pro State-Screen (modal, tab) optional eine `screenshotUrl`; optional verifizierte Kanten mit Trigger-Metadaten.

## Aktueller Stand

`crawl.mjs` nutzt Playwright und:

1. Jede Route (baseUrl + screen.path) lädt
2. Sichere klickbare Elemente auswählt
3. Bei URL-Wechsel Navigate-Kanten bestätigt
4. Bei State-Change Modal/Tab/Dropdown per Screenshot erfasst
5. Ein JSON-Ergebnis mit `verifiedEdges`, `stateScreens`, `snapshots` und `issues` zurückgibt

Zusätzlich kann der lokale Preview Runner denselben Crawl über `POST /crawl/:runId` ausführen.

## Ausführung

```bash
npm run crawl:appflow -- --baseUrl "http://localhost:5173" --screens '[{"id":"screen:projects","name":"Projects","path":"/projects","type":"page"}]'
```

Die Appflow-UI kann die zurückgegebenen `screenshotUrl`-Data-URLs direkt als Thumbnail für Modal/Tab/Dropdown verwenden.

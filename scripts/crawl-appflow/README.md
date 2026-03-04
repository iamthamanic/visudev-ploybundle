# App Flow Runtime-Crawl (B1)

Stub und Erweiterungspunkt für den Runtime-Crawl des App Flows.

## Vertrag (Ein-/Ausgabe)

- **Eingabe:** `baseUrl`, Liste der Screens (path, type, id); optional Projekt-Kontext.
- **Ausgabe:** Pro State-Screen (modal, tab) optional eine `screenshotUrl`; optional verifizierte Kanten mit Trigger-Metadaten.

## Geplante Erweiterung

Ein Playwright-Skript (z. B. `crawl.mjs`) kann hier ergänzt werden, das:

1. Jede Route (baseUrl + screen.path) lädt
2. Klickbare Elemente ermittelt und Safe-Clicks ausführt
3. Bei URL-Wechsel Navigate-Kanten bestätigt; bei State-Change (Modal/Tab) Screenshots erzeugt und den zugehörigen Screen-Objekten zuordnet
4. Screenshot-URLs (z. B. nach Upload in Storage) zurückgibt

Siehe **docs/APPFLOW_RUNTIME_CRAWL.md** für den genauen Ablauf und **docs/APPFLOW_GAP_AND_TARGET.md** (B1) für den Gesamtkontext.

## Ausführung (nach Implementierung)

```bash
# Beispiel (wenn crawl.mjs existiert):
node scripts/crawl-appflow/crawl.mjs --baseUrl "http://localhost:5173" --screens '[...]'
```

Die Appflow-UI zeigt Thumbnails für Modal/Tab/Dropdown bereits an, sobald `screenshotUrl` auf dem Screen gesetzt ist (z. B. aus Crawl-Ergebnis).

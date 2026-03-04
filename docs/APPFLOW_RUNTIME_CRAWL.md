# App Flow: Runtime-Crawl (B1)

**Ziel:** Pro Route die Live-App laden, klickbare Elemente ausführen und dabei Kanten verifizieren bzw. State-Screens (Modal, Tab) per Screenshot erfassen.

**Bezug:** APPFLOW_MODALS_TABS_DROPDOWNS_KONZEPT Abschnitt 6, APPFLOW_GAP_AND_TARGET B1.

---

## 1. Ein- und Ausgabe

**Eingabe:**

- `projectId`, `baseUrl` (Preview- oder Deployed-URL)
- `screens` aus Analyse (path-basiert + modal/tab/dropdown)
- Optional: Fixtures (D1/D2) für dynamische Routen

**Ausgabe:**

- Verifizierte/ergänzte Kanten mit Trigger-Metadaten (welcher Button/Link/Tab)
- Screenshots für State-Screens (Modal geöffnet, Tab aktiv) → `screenshotUrl` auf den entsprechenden Screen-Objekten
- Optional: DOM-Snapshot pro Zustand

---

## 2. Ablauf (geplant)

1. Pro **path-basiertem Screen** die URL `baseUrl + screen.path` laden.
2. **Klickbare Elemente** finden: `a[href]`, `button`, `[role="button"]`, Tab-Trigger, Dropdown-Trigger.
3. **Safe-Click-Regeln:** z. B. kein Submit auf „Löschen“ ohne Bestätigung; Timeout pro Aktion.
4. Nach Klick:
   - **URL-Wechsel** → Navigate-Edge verifizieren/ergänzen, Trigger (Label/Selector) speichern.
   - **Nur State-Change** (Modal öffnet sich, Tab wechselt) → State-Edge / `open-modal` / `switch-tab` verifizieren; Screenshot des Zustands erstellen und dem Modal/Tab-Screen zuordnen.
5. Rücksprung (z. B. `page.goto(nextRoute)` oder `history.back`) für nächsten Test.
6. Screenshots in Storage hochladen, `screenshotUrl` in Analyse-Ergebnis bzw. Projekt zurückmelden.

---

## 3. Implementierungsort

- **Skript/Service:** `scripts/crawl-appflow/` (siehe README dort).
- **Abhängigkeiten:** Commit-Handshake (C1), ggf. Fixtures (D1/D2), Playwright (oder vergleichbar).
- **Anbindung:** Nach Analyse oder manuell auslösbar; Ergebnis (Screenshots + ggf. Kanten-Updates) in Projekt übernehmen.

---

## 4. Status

- **Konzept und Vertrag:** in diesem Doc.
- **Minimaler Stub:** siehe `scripts/crawl-appflow/README.md`.
- **Vollständige Implementierung:** ausstehend (Playwright-Crawler mit Klick-Logik, Screenshot-Zuordnung zu State-Screens).

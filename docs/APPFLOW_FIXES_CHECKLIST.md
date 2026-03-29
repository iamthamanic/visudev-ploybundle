# App Flow: Fix-Checkliste (Kanten, Modals, Login)

Kurze Übersicht: Was umgesetzt wurde und was optional noch zu tun ist.

---

## 1. Kanten von den Buttons (nicht vom Kartenrand)

### Erledigt

- **FlowEdgesLayer.tsx:** Navigate-Kanten nutzen jetzt den **Fallback-DOM-Report** für die Startposition, wenn der Screen `edge.fromId` selbst keinen Report hat. D. h. sobald irgendein Iframe (z. B. die Shell) `visudev-dom-report` mit `navItems` sendet, starten die Linien an der **Tab-Position** (Button-Rect), nicht mehr am rechten Kartenrand.
- **LiveFlowCanvas.tsx:** `fallbackDomReport` war bereits vorhanden (erster Report mit `navItems`). Wird nun in FlowEdgesLayer auch für x1/y1 genutzt.

### Optional / bei Bedarf

- Sicherstellen, dass die **Preview-App** (Shell) im Iframe läuft und `postMessage({ type: "visudev-dom-report", route, navItems })` sendet (Sidebar mit `data-nav-path` und `onDomReport` in ShellPage).
- Wenn Kanten trotzdem am Rand starten: prüfen, ob `edge.targetPath` und die `path` in `navItems` übereinstimmen (z. B. `/projects` vs `/` – wird in `normalizePathForMatch` bereits gleich behandelt).

---

## 2. Modal-Inhalte (Modal0, Modal1 nicht leer)

### Erledigt

- **FlowNodeCard.tsx:** State-Nodes (Modal/Tab/Dropdown) zeigen bei fehlendem `screenshotUrl` jetzt **Name + optional State-Key** an (Icon + Typ-Label + `screen.name` + ggf. `screen.stateKey`), damit die Karte nicht leer wirkt.
- **LiveFlowCanvas.module.css:** Neue Klasse `.nodeStateKey` für den State-Key (klein, muted).

### Optional / bei Bedarf

- **Screenshots für Modals:** Wenn die Analyse/Crawl- oder Screenshot-API **Modal-URLs** oder State-Screens unterstützt, `screenshotUrl` auf den entsprechenden Screen-Objekten setzen. Die Karte rendert dann automatisch das Thumbnail (`FlowNodeCard` nutzt bereits `screen.screenshotUrl`).
- Konzept: `docs/APPFLOW_MODALS_TABS_DROPDOWNS_KONZEPT.md` und `docs/APPFLOW_RUNTIME_CRAWL.md` (Runtime-Crawl mit Screenshots für State-Screens).

---

## 3. Login-Screen in der App-Flow-Ansicht

### Bereits im Code

- **layout.ts:** `getScreenDepths()` behandelt `path === "/login"` als möglichen Root; Login wird nicht herausgefiltert.
- **Analyzer:** React Router / Next.js Extraktion erkennt Routen wie `/login` (siehe `screen-extraction.service.test.ts`). Wenn die **analysierte App** eine Route `/login` hat, erscheint der Screen in der Liste.

### Wenn „nur 5/7 sichtbar“ und Login fehlt

- **5/7** = 5 von 7 Screens mit Status „loaded“, 2 „loading“ oder „failed“. Alle 7 Karten werden gerendert; die 2 ohne Load zeigen Fehler-/Timeout-Hinweis.
- **Login fehlt in der Liste:** Dann hat der Analyzer keine `/login`-Route gefunden (z. B. Auth unter anderem Pfad oder keine Route im erkannten Framework). Lösung: In der User-App die Login-Route so definieren, dass der Analyzer sie findet (z. B. `<Route path="/login" />` oder `app/login/page.tsx`).
- **Login ist einer der 7, lädt aber nicht (failed):** Typisch wenn die Preview-App bei `/login` weiterleitet (z. B. wenn schon eingeloggt) oder Auth-Check den Iframe blockiert. Dann bleibt die Karte sichtbar, zeigt aber den Fehlerstatus; optional Preview so konfigurieren, dass `/login` ohne Redirect erreichbar ist.

---

## Dateien geändert (Stand Fix)

| Datei                                                  | Änderung                                                                                                                       |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/modules/appflow/components/FlowEdgesLayer.tsx`    | Navigate-Edge: Fallback-DOM-Report für Startposition (x1, y1) nutzen, wenn `domReports[fromId]` keinen passenden Nav-Item hat. |
| `src/modules/appflow/components/FlowNodeCard.tsx`      | State-Node: optional `screen.stateKey` unter dem Namen anzeigen (Klasse `nodeStateKey`).                                       |
| `src/modules/appflow/styles/LiveFlowCanvas.module.css` | Neue Klasse `.nodeStateKey` für State-Key-Anzeige.                                                                             |

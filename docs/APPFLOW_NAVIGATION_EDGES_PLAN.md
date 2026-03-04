# App Flow: Verbindungen Tab → Screen (Implementierungsplan)

**Integrationsstatus:** Umgesetzt (Phase 1–4: Analyzer, navigatesTo nur Nav-Host, Zielauflösung, Tab-Anker).

Ziel: Im App-Flow-Diagramm sollen die Kanten so verlaufen, wie du es dir vorgestellt hast:

- **Projekte-Screen, Tab „App Flow“** → Kante zum **App-Flow-Screen**
- **Projekte-Screen, Tab „Blueprint“** → Kante zum **Blueprint-Screen**
- **Projekte-Screen, Tab „Data“** → Kante zum **Data-Screen**
- **Projekte-Screen, Tab „Logs“** → Kante zum **Logs-Screen**
- **Projekte-Screen, Tab „Settings“** → Kante zum **Settings-Screen**

Und das **generisch** für beliebige Projekte (nicht nur VisuDEV).

---

## Übersicht: Was muss gemacht werden

| Phase | Was                                                                                      | Wo                                        | Priorität |
| ----- | ---------------------------------------------------------------------------------------- | ----------------------------------------- | --------- |
| 1     | Programmatische Navigation im Analyzer erfassen (onNavigate, handleNavigate, Tab→Path)   | visudev-analyzer                          | Hoch      |
| 2     | navigatesTo dem richtigen Screen zuordnen (z. B. nur Shell/Projekte, nicht allen Routes) | visudev-analyzer                          | Hoch      |
| 3     | Ziel-Screen eindeutig auflösen (exakter Pfad, kein „erstes Match“)                       | layout.ts                                 | Hoch      |
| 4     | Optional: Kanten von Tab-Position starten (Anker)                                        | layout.ts + FlowEdgesLayer + FlowNodeCard | Mittel    |

---

## Phase 1: Programmatische Navigation im Analyzer erfassen

**Datei:** `src/supabase/functions/visudev-analyzer/module/services/screen-extraction.service.ts`

**Problem:** `extractNavigationLinks` erkennt nur:

- `href="..."`, `<Link to="..."`, `router.push("...")`, `navigate("...")`

Die Shell nutzt aber z. B.:

- `onNavigate("appflow")`, `handleNavigate(screen)`, `setActiveScreen("appflow")`, `history.pushState(..., path)` mit path aus einer Map.

**Erweiterungen (generisch):**

1. **Neue Muster in `extractNavigationLinks` (oder neue Hilfsfunktion):**
   - `onNavigate\s*\(\s*["']([^"']+)["']`
   - `handleNavigate\s*\(\s*["']([^"']+)["']`
   - `setActiveScreen\s*\(\s*["']([^"']+)["']`
   - `(?:path|route|screen)\s*:\s*["']([^"']+)["']` in Objekten/Arrays (z. B. Tab-Config)
   - Optional: `["'](appflow|blueprint|data|logs|settings|projects)["']` in typischen Nav-Kontexten (z. B. nach `key:\s*` oder in `navItems`)

2. **Pfad-Normalisierung:**  
   Gefundene Segmente wie `"appflow"` oder `"blueprint"` in Pfade umwandeln: `"/appflow"`, `"/blueprint"` usw. (führendes `/` ergänzen, wenn noch keins da ist).

3. **Keine Duplikate:**  
   Wie bisher nur eindeutige Pfade in die Liste aufnehmen.

**Ergebnis:** Die Datei, die die Sidebar/Tabs enthält (z. B. ShellPage oder Sidebar), liefert `navigatesTo: ["/appflow", "/blueprint", "/data", "/logs", "/settings"]` (plus ggf. `/projects`).

---

## Phase 2: navigatesTo dem richtigen Screen zuordnen

**Datei:** gleicher Analyzer, gleicher Service.

**Problem:** Bei React Router u. ä. bekommen **alle** Screens, die aus derselben Datei kommen, aktuell **dieselbe** `navigatesTo`-Liste. Dann entstehen Kanten von **jedem** Screen zu jedem Ziel (Logs→App Flow, Settings→Blueprint usw.).

**Lösung (generisch):**

1. **Welcher Screen ist „Nav-Host“?**  
   Nur der Screen, der die **Navigation-UI** enthält (Sidebar, Tab-Bar, Nav-Liste), soll die gefundenen Pfade als `navigatesTo` bekommen.

2. **Heuristik:**
   - Wenn eine Datei **sowohl** Routes/Pages **als auch** Nav-Links/onNavigate/HandleNavigate enthält:
     - Entweder: nur **einen** „Container“-Screen (z. B. Root/Shell) annehmen und ihm `navigatesTo` zuweisen, **oder**
     - Pro **Route** nur die Links übernehmen, die in dem gleichen „Block“/Component stehen wie die Route (schwieriger ohne AST).
   - Pragmatisch: Bei **Single-Page mit Tabs** (eine Shell, mehrere Segmente):
     - Ein Screen mit path `/` oder `/projects` oder name „Shell“/“Projects“ bekommt die aus der **gleichen Datei** extrahierten Navigations-Links.
     - Andere Screens aus derselben Datei (z. B. pro Tab eine Route) bekommen **leeres** `navigatesTo` für diese Datei, **oder** man erzeugt nur einen Screen für die Shell und keine doppelten Screens pro Tab.

3. **Konkret im Code:**
   - In `extractReactRouterScreens` (und ggf. anderen Frameworks):
     - `navigatesTo` nicht mehr **für jeden** `entry` aus `routeEntries` gleich setzen.
     - Stattdessen: einen „root“ oder „shell“ Eintrag identifizieren (z. B. path `/` oder `/projects` oder erste Route) und **nur diesem** die aus der Datei extrahierten `navigatesTo` zuweisen.
     - Für die anderen Einträge: `navigatesTo: []` oder nur Links, die im jeweiligen Route-Component-Code vorkommen (wenn ihr später pro-Route parst).

**Ergebnis:** Nur der „Projekte“/Shell-Screen hat `navigatesTo: ["/appflow", "/blueprint", ...]`, die Tab-Screens (App Flow, Blueprint, …) haben keine oder nur ihre eigenen, gezielten Links.

---

## Phase 3: Ziel-Screen eindeutig auflösen

**Datei:** `src/modules/appflow/layout.ts`, Funktion `buildEdges`.

**Problem:**  
`const target = screens.find(s => s.path === targetPath || (targetPath && s.path.includes(targetPath)))`  
nimmt das **erste** passende Screen. Bei mehreren Screens mit ähnlichem path oder gleichem Segment kann die Kante zum falschen Screen gehen.

**Lösung:**

1. **Zuerst exakter Match:**  
   `const exact = screens.find(s => s.path === targetPath)`  
   Wenn `exact` vorhanden, diesen als Ziel nehmen.

2. **Sonst Segment-Match:**  
   `targetPath` normalisieren (z. B. `/appflow` → Segment `appflow`).  
   Dann: `screens.filter(s => pathToSegment(s.path) === segment)` und davon **einen** wählen (z. B. ersten oder den mit kürzestem path).

3. **Hilfe:**  
   Eine Hilfsfunktion `pathToSegment(path: string): string` (z. B. path ohne führendes `/`, kleingeschrieben).  
   In `getScreenPreviewPath` / Shell gibt es schon ähnliche Logik; ggf. eine gemeinsame Normalisierung nutzen.

4. **Deduplizierung:**  
   Pro Paar `(source.id, target.id)` nur **eine** Kante pro targetPath (keine doppelten Kanten für gleichen Ziel-Screen).

**Ergebnis:** Jede Navigation „Projekte → /appflow“ landet garantiert beim **App-Flow-Screen**, nicht bei einem anderen Screen, der „appflow“ im path enthält.

---

## Phase 4 (optional): Kanten von Tab-Position starten

**Ziel:** Die Linie startet optisch beim **Tab** (z. B. „App Flow“) auf der Projekte-Karte, nicht in der Kartenmitte.

**Datenmodell:**

1. **GraphEdge erweitern** (`layout.ts`):

   ```ts
   export interface GraphEdge {
     fromId: string;
     toId: string;
     type: "navigate" | "call";
     /** Optional: für type "navigate", welcher Pfad/Ziel (z. B. "/appflow"). Ermöglicht Anker-Berechnung. */
     targetPath?: string;
   }
   ```

2. **buildEdges:** Bei Navigations-Kanten `targetPath` setzen (den verwendeten `targetPath` aus der Schleife mitgeben).

**Layout/Rendering:**

3. **Anker auf der Karte:**  
   Entweder:
   - **Fest:** Pro Screen mit vielen Navigations-Kanten die Start-Y-Positionen der Linien **gleichmäßig** auf der rechten Kantenfläche verteilen (z. B. 5 Tabs → 5 Y-Offsets zwischen `fromPos.y + 20` und `fromPos.y + NODE_HEIGHT - 20`).  
     Oder:
   - **Aus Daten:** Wenn der Analyzer pro Link/Tab eine Kennung liefert (z. B. Reihenfolge oder Name), kann man dieselbe Reihenfolge für die Y-Offsets nutzen (z. B. erste Kante zu `/appflow` = oberster Tab).

4. **FlowEdgesLayer:**  
   Statt fester `y1 = fromPos.y + NODE_HEIGHT/2` pro Kante:
   - Wenn `edge.targetPath` gesetzt ist und wir eine Anker-Y-Liste für den Source-Screen haben (z. B. nach Reihenfolge der navigatesTo), dann `y1 = fromPos.y + anchorYOffset`.
   - Sonst Fallback wie bisher (Kartenmitte).

5. **FlowNodeCard:**  
   Keine zwingende Änderung nötig, solange Anker nur aus Reihenfolge/Konfiguration berechnet werden. Später möglich: echte DOM-Positionen der Tabs im Mini-Preview (aufwändiger).

**Ergebnis:** Linien starten verteilt am rechten Rand der Quell-Karte (entsprechend der Tab-Reihenfolge) und landen weiterhin an der Ziel-Karte – visuell „Tab → Screen“.

---

## Reihenfolge der Umsetzung

1. **Phase 1 + 2** (Analyzer): Navigation erfassen + nur dem richtigen Screen zuordnen.  
   → Danach sollten die **richtigen** Kanten (Projekte → App Flow, Blueprint, …) erscheinen, auch wenn sie noch in der Kartenmitte starten.

2. **Phase 3** (layout.ts): Ziel-Screen eindeutig auflösen.  
   → Kanten landen garantiert auf dem richtigen Screen.

3. **Phase 4** (optional): Anker für Tab-Start-Positionen.  
   → Optik „von Tab zu Screen“.

---

## Erkannte UI-Elemente (Modals, Tabs, Dropdowns)

Welche **konkreten** UI-Elemente und Muster (Dialog, Modal, Drawer, Tab, DropdownMenu, Select, …) der Analyzer erkennt, ist in **APPFLOW_MODALS_TABS_DROPDOWNS_KONZEPT.md**, Abschnitt **4.5 Erkannte UI-Elemente und Muster (Referenz)**, dokumentiert. Optionale Markup-Attribute: **VISUDEV_MARKUP_CONVENTION.md**.

---

## Betroffene Dateien (Kurzliste)

- `src/supabase/functions/visudev-analyzer/module/services/screen-extraction.service.ts` – Phase 1 & 2
- `src/modules/appflow/layout.ts` – Phase 3, optional Phase 4 (GraphEdge + buildEdges)
- `src/modules/appflow/components/FlowEdgesLayer.tsx` – Phase 4 (Anker-Y)
- Optional: `src/lib/visudev/types.ts` – nur wenn ihr `navigatesTo` um optionale Anker-Infos erweitert (z. B. pro Eintrag `{ path, label? }`); für Phase 4 reicht erstmal `targetPath` auf der Edge.

---

## Test

- Nach Phase 1+2+3: App Flow öffnen, „Neu analysieren“, dann: Von der Projekte-Karte gehen **genau** fünf Kanten zu den Screens App Flow, Blueprint, Data, Logs, Settings (keine zu „falschen“ Screens, keine doppelten).
- Nach Phase 4: Die fünf Linien starten am rechten Rand der Projekte-Karte in unterschiedlichen Höhen (tab-ähnlich).

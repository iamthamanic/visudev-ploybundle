# Appflow: Modals, Tabs und Dropdowns als interaktive Screens

Konzept und Umsetzungsplan, damit state-basierte Views (Modals, Tabs, Dropdowns) im Appflow als eigene, interaktive Screens/Nodes erscheinen und der Flow vollständig abbildbar ist.

**Bezug:** Diskussion basierend auf APPFLOW_GAP_AND_TARGET.md und aktuellem Screen-/Analyzer-Stand.

**Status:** Integriert (Datenmodell, Analyzer, Appflow-UI, Dropdown, Thumbnails für State-Screens). Runtime-Crawl: Vertrag und Stub in docs/APPFLOW_RUNTIME_CRAWL.md und scripts/crawl-appflow/; vollständige Playwright-Implementierung ausstehend.

---

## 1. Ausgangslage

### Was heute im Appflow abgebildet wird

- **Screens** kommen ausschließlich aus **route-basierter Extraktion** (Next.js App/Pages Router, React Router, Nuxt, Heuristik).
- Jeder Screen hat einen **`path`** (z.B. `/`, `/settings`). Pro Screen wird **ein Iframe** mit `previewUrl + screen.path` geladen.
- **Kanten** entstehen aus statischer Navigation (`navigatesTo[]`); es gibt **keine** Zuordnung zu konkreten Triggern (Button/Tab/Dropdown) und **keine** Berücksichtigung von State-Änderungen ohne URL-Wechsel.

### Was fehlt (bekannte Lücke)

- **Modals:** Öffnen sich per Klick, haben typischerweise **keine eigene URL**. Es existiert kein eigener Screen/Node und kein Iframe dafür.
- **Dropdowns:** Können Aktionen auslösen (z.B. „Öffnen“, „Bearbeiten“, „Löschen“ → Modal). Werden weder als Node noch als Trigger an Kanten abgebildet.
- **Tabs:** Wechseln den sichtbaren Inhalt ohne Route-Change. Jeder Tab-Inhalt ist ein eigener „View“, erscheint aber nicht als Screen.

In **APPFLOW_GAP_AND_TARGET.md** steht explizit: _„keine Behandlung von ‚Klick macht State-Change statt Route-Change‘ (Tabs, Accordion, Modals)“_.

### Warum alle als interaktive Screens gedacht werden müssen

- Ein **Dropdown** kann einen Screen oder ein Modal auslösen (z.B. „Öffnen“ → Route, „Löschen“ → Bestätigungs-Modal).
- **Tabs** wechseln den sichtbaren Inhalt und können ihrerseits Links/Buttons zu weiteren Screens oder Modals enthalten.
- **Modals** zeigen einen eigenen Kontext (Formular, Bestätigung, Detail).

Damit der Flow vollständig und nachvollziehbar ist, müssen **alle diese View-Container** als Nodes (bzw. Sub-Screens) und ihre **Auslöser** als Kanten mit Trigger-Metadaten abgebildet werden.

### Abgrenzung: Visudev-Shell vs. analysierte App

- **Appflow** zeigt die **analysierte Projekt-App** (Preview im Iframe), nicht die Visudev-Oberfläche.
- Das **„Neues Projekt“-Modal** in Visudev ist Teil der **Shell** (ProjectsPage + Dialog). Dafür ist bewusst **kein** Screen im Appflow vorgesehen.
- Die **Sidebar** in Visudev (Projekte, App Flow, Blueprint, Data, Logs, Settings) ist **funktional tab-ähnlich** (eine aktive Ansicht, Klick wechselt), aber **route-basiert** umgesetzt: Jedes Item hat eine URL (`/`, `/appflow`, …). Würde man Visudev selbst analysieren, wären das bereits path-basierte Screens. Das fehlende Puzzleteil sind **state-basierte** Views in **beliebigen** analysierten Apps (Modals, Tabs ohne URL, Dropdowns als Auslöser).

---

## 2. Zielbild

- **Modals, Tabs, Dropdowns (und vergleichbare state-basierte Views)** werden erkannt und im Appflow dargestellt.
- Jeder solche **View-Container** ist ein **interaktiver Screen/Node** (oder Sub-Node mit Parent-Beziehung).
- **Kanten** sind **trigger-spezifisch**: Es ist erkennbar, welcher Button, Tab oder Dropdown-Eintrag welchen Screen/Modal öffnet.
- Wo sinnvoll (z.B. Modals, Tab-Panels): **eigener Node** mit Thumbnail/Label; **kein zweiter Voll-Iframe**, da keine eigene URL. Iframes bleiben **path-basierten** Screens vorbehalten.

---

## 3. Datenmodell

### 3.1 Screen-Typen erweitern

Aktuell: `ScreenType = "page" | "screen" | "view" | "cli-command"`.

**Neu (Beispiele):**

- `modal` – Dialog, Modal, Drawer
- `tab` – ein Tab-Panel (Inhalt eines Tabs)
- Optional: `dropdown` oder nur als Trigger-Metadaten an Kanten (Dropdown-Einträge als Auslöser)

### 3.2 Screen-Objekt

- **Parent-Beziehung:** State-basierte Screens gehören zu einer Route/Seite.
  - `parentScreenId?: string` oder `parentPath?: string`
- **State-Key / virtueller Pfad:** Modals/Dropdowns haben oft keine URL.
  - Entweder `path` optional machen und z.B. `stateKey?: string` einführen (z.B. `"modal:create-project"`),
  - oder virtueller Pfad: z.B. `path` = Parent-Pfad, plus `stateKey` für Eindeutigkeit.
- **Bestehende Felder:** `id`, `name`, `filePath`, `type`, `flows`, `navigatesTo`, `framework` etc. bleiben; für Modals/Tabs ggf. `path` abweichend nutzen oder ergänzen.

### 3.3 Kanten (Edges) und Trigger

- **Trigger pro Kante** (wie in APPFLOW_GAP_AND_TARGET Phase 4):
  - `trigger?: { label?, selector?, testId?, file?, line?, confidence? }`
- **Edge-Typen** erweitern, z.B.:
  - `navigate` – Route-Wechsel (bestehend)
  - `open-modal` – öffnet Modal
  - `switch-tab` – wechselt Tab
  - `dropdown-action` oder nur über Trigger-Label abbildbar

So können Buttons, Tabs und Dropdown-Einträge explizit als Auslöser von Screens/Modals dargestellt werden.

---

## 4. Analyzer (statische Erkennung)

### 4.1 Modals

- **Erkennung im Code:**
  - Radix/shadcn: `Dialog`, `DialogContent`, `Modal`
  - Attribute: `role="dialog"`, `aria-modal="true"`
  - Heuristik: Komponenten-Namen wie `*Modal`, `*Dialog`, `*Drawer`
- **Zuordnung:** Parent-Screen (in welcher Route/Seite wird der Dialog gerendert?), Trigger-Button (welches Element öffnet ihn?).
- **Output:** Pro Modal ein Eintrag in `screens[]` mit `type: "modal"`, `parentScreenId`/`parentPath`, plus Kante vom Trigger zum Modal mit `type: "open-modal"` und `trigger`.

### 4.2 Tabs

- **Erkennung:** Radix Tabs, MUI Tabs, oder eigene Tab-Listen mit State (z.B. `useState` für aktiven Tab).
- **Abstraktion:** Pro Tab-Panel einen „Screen“ mit `type: "tab"`, Parent = Route, die die Tabs enthält; Kante vom Tab-Trigger zum Tab-Panel mit `type: "switch-tab"` und `trigger`.

### 4.3 Dropdowns

- **Erkennung:** Radix DropdownMenu, Select, Custom Menus.
- **Fokus:** Einträge als **Trigger** für Navigation oder Modal (z.B. „Öffnen“ → Route, „Löschen“ → Bestätigungs-Modal).
- **Darstellung:** Primär als **Kanten-Metadaten** (Trigger-Label/Selector); optional eigener kleiner Node pro Dropdown-„View“, wenn gewünscht.

### 4.4 Implementierungsort

- **Screen-Extraction-Service** (bzw. bestehende Analyzer-Pipeline): Neue Methoden für Modal-/Tab-/Dropdown-Erkennung, die den bestehenden AST/Code-Durchlauf nutzen und `screens[]` sowie Kanten (mit Trigger und ggf. neuen Edge-Typen) anreichern.

### 4.5 Erkannte UI-Elemente und Muster (Referenz)

Die folgenden **konkreten** Muster werden im Analyzer (`screen-extraction.service.ts`) für die statische Erkennung verwendet. Optional verbessert `data-visudev-*` die Namenszuordnung (siehe **VISUDEV_MARKUP_CONVENTION.md**).

| Kategorie     | Erkannte Muster / Komponenten                                                                                                                                                                                                                                                                                               | Optionale Markup                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **Modals**    | JSX: `<Dialog>`, `<Modal>`, `<Drawer>`, `<DialogContent>`. HTML/ARIA: `role="dialog"`, `aria-modal="true"`. Zusätzlich: Komponenten-Namen `*Dialog*`, `*Modal*`, `*Drawer*` (z. B. `NewProjectDialog`), außer reine Primitives (`DialogTrigger`, `DialogClose`, `DialogTitle`, …).                                          | `data-visudev-modal="id"` am Dialog-Container für eindeutigen Namen.                   |
| **Tabs**      | `<Tab value="…">`, `<Tabs.Tab value="…">`, `<TabPanel value="…">`, sowie Objekt-Konfigurationen mit `"value" : <…>` im Tab-Kontext.                                                                                                                                                                                         | `data-visudev-tab="id"` im Tab-Kontext für Anzeigenamen.                               |
| **Dropdowns** | Vorkommen von: `DropdownMenu`, `DropdownMenuItem`, `Select`, `SelectItem`, `SelectTrigger`, `<select>`. Einträge/Labels aus: `DropdownMenuItem>…</`, `SelectItem value=…>…</`, `<option value=…>…</`, `<MenuItem>…</`, sowie Key-Value in DropdownMenu-Kontext. Pro Datei ein Screen `type: "dropdown"` mit Trigger-Labels. | Derzeit kein spezielles Attribut; optional später `data-visudev-trigger` an Einträgen. |

**Navigation (Tab/Nav → Screen):** Siehe **APPFLOW_NAVIGATION_EDGES_PLAN.md**. Erfasst werden u. a. `href`, `<Link to="…">`, `router.push`, `navigate(…)`, `onNavigate(…)`, `handleNavigate(…)`, `setActiveScreen(…)` sowie Pfade in Tab/Nav-Config-Objekten. Für exakten Kanten-Start am Tab: in der Preview `data-nav-path` (bzw. `data-visudev-nav-path`) an Nav-Items.

**Zusammenfassung:** Modals, Tabs und Dropdowns sind über die obigen Muster dokumentiert und im Analyzer umgesetzt; optionale Markup-Attribute verbessern die Eindeutigkeit und Lesbarkeit der erkannten Screens.

---

## 5. Appflow-UI (Darstellung)

### 5.1 Nodes

- **Route/Page (path-basiert):** Unverändert – ein Iframe pro Screen mit `path`; `previewUrl + screen.path`.
- **Modal / Tab:**
  - **Option A:** Eigener **kleiner Node** (z.B. „Modal: Neues Projekt“) mit Verbindung zum Parent-Screen; **kein** zweiter Voll-Iframe (keine URL), Darstellung per Thumbnail/Label/Badge.
  - **Option B:** **Overlay** auf dem Parent-Node (Badge oder kleines Vorschaubild auf der Karte der Parent-Route).
- **Dropdown:** Vor allem als **Kanten-Label** (z.B. „Dropdown: Öffnen“); optional eigener Mini-Node.

### 5.2 Iframe-Strategie

- Nur Einträge **mit** `path` (und ggf. Regel „nur type page/screen/view“) erhalten einen Iframe mit `previewUrl + path`.
- Modals/Tabs erhalten **keinen** eigenen Iframe; Darstellung über Screenshot/Thumbnail aus Crawl oder Platzhalter.

### 5.3 Kanten

- Aus `navigatesTo` und neuen Edge-Typen (`open-modal`, `switch-tab`, …) mit **Trigger-Metadaten** rendern.
- Tooltip/Label z.B.: „Button: Neues Projekt“, „Tab: Einstellungen“, „Dropdown: Öffnen“.

### 5.4 Layout

- Modals/Tabs als **Sub-Nodes** nahe am Parent platzieren (versetzt oder als Layer), damit der Graph lesbar bleibt und die Hierarchie erkennbar ist.

---

## 6. Runtime / Crawl (optional)

- Wie in APPFLOW_GAP_AND_TARGET Phase 4 (B1):
  - Pro Route laden, klickbare Elemente finden, Safe-Clicks ausführen.
  - Nach Klick: **URL-Wechsel** → Navigate-Edge; **nur State-Change** (Modal öffnet sich, Tab wechselt) → State-Edge / `open-modal` / `switch-tab`.
  - Öffnete Modals/Tab-Zustände erfassen (Screenshot oder DOM-Snapshot) und als Sub-Screens/Overlays speichern.
- **Abhängigkeiten:** Commit-Handshake (C1), ggf. Fixtures (D1/D2), Crawler (z.B. Playwright) im Preview-Runner oder separater Service.

---

## 7. Thumbnails / Screenshots

- **State-basierte Screens:** Thumbnails nur möglich, wenn ein **Runtime-Crawl** (oder manueller Ablauf) den Zustand (Modal offen, Tab X aktiv) herbeiführt und einen Screenshot erzeugt (vgl. APPFLOW_GAP_AND_TARGET A1).
- Ohne Crawl: Modals/Tabs nur mit **Platzhalter-Icon/Label** im Node.

---

## 8. Reihenfolge und Abhängigkeiten

| Phase           | Inhalt                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- |
| **Grundlage**   | C1 Commit-Handshake (Analyzer und Preview gleicher Stand).                                     |
| **Datenmodell** | Screen-Typen (`modal`, `tab`), Parent/stateKey, Trigger an Kanten, neue Edge-Typen.            |
| **Analyzer**    | Statische Erkennung Modals/Tabs/Dropdowns, Anreicherung von Screens und Kanten.                |
| **Appflow-UI**  | Neue Node-Typen (Modal/Tab) und Kanten-Typen darstellen; Iframe nur für path-basierte Screens. |
| **Optional**    | Fixtures (D1/D2), Thumbnails aus lokalem Preview (A1), Runtime-Crawl (B1).                     |

---

## 9. Kurz-Checkliste

| Bereich         | Aufgabe                                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Datenmodell** | Screen-Typen `modal`, `tab` (evtl. `dropdown`); `parentScreenId`/`stateKey`; Trigger an Edges; Edge-Typen `open-modal`, `switch-tab`. |
| **Analyzer**    | Modals/Dialoge im Code erkennen, Parent + Trigger zuordnen.                                                                           |
| **Analyzer**    | Tabs erkennen (Tab-Liste + Panels), pro Panel einen Screen, Parent + Trigger.                                                         |
| **Analyzer**    | Dropdown-Menüs erkennen, Einträge als Trigger für Navigate/Modal-Kanten.                                                              |
| **Appflow-UI**  | Modal/Tab-Nodes rendern (ohne zweiten Iframe), mit Parent verknüpfen.                                                                 |
| **Appflow-UI**  | Kanten mit Trigger-Label (Button/Tab/Dropdown-Text) anzeigen.                                                                         |
| **Optional**    | Runtime-Crawl: Klicks, Modal/Tab-Öffnung erkennen, Screenshots für state-Screens.                                                     |
| **Optional**    | Thumbnails aus lokalem Preview für alle Screen-Typen.                                                                                 |

---

## 10. Referenzen

- **VISUDEV_MARKUP_CONVENTION.md** – Optionale `data-visudev-*`-Attribute für eindeutige Erkennung (additiv, sicher).
- **APPFLOW_GAP_AND_TARGET.md** – Ist-Zustand, Lücken, Phasen C1, D1/D2, A1, B1/B2.
- **Screen-Extraction:** `visudev-analyzer` – `screen.service.ts`, `screen-extraction.service.ts`.
- **Screen-DTO:** `visudev-analyzer` – `dto/screen/screen.dto.ts` (ScreenType, Screen).
- **Appflow-UI:** `LiveFlowCanvas.tsx`, `FlowNodeCard.tsx`, `layout.ts` (getScreenPreviewPath, buildEdges).

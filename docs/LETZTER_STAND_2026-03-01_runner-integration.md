# Letzter Stand 01.03.26 – Runner-Integration & App Flow

Dokumentation des aktuellen Stands zu Preview-Runner, App Flow, Sitemap und Backend-Erreichbarkeit.

---

## 1. Umgesetzte Fixes (Session 01.03.26)

### 1.1 Preview-URL bei Wiederverwendung

- **Problem:** Beim Wiederverwenden eines bestehenden Runs lieferte der Runner `previewUrl` mit, die App Flow-Karten zeigten aber „Basis-URL fehlt“ und leere Iframes.
- **Lösung (umgesetzt):**
  - **Parser** (`preview-runner-parser.ts`): `parseRunnerStartPayload` liest optional `previewUrl` und gibt es zurück.
  - **Start-API** (`preview-runner-lifecycle-start.ts`): `previewUrl` wird bei Erfolg in `data` mitgeliefert.
  - **Store** (`store.tsx`): Beim Start-Erfolg wird `previewUrl` aus der Response übernommen (`nextPreviewUrl ?? prev.previewUrl`).
- **Ergebnis:** Bei Wiederverwendung steht die Basis-URL sofort zur Verfügung, Karten bekommen gültige Iframe-URLs.

### 1.2 Fehlermeldungen unter den Screen-Karten entfernt

- **Problem:** Unter jeder Screen-Karte und in der Toolbar erschien dauerhaft der Hinweis „Bad Gateway/ECONNREFUSED? → Preview-App läuft nicht …“.
- **Lösung (umgesetzt):**
  - **FlowNodeCard.tsx:** Der Hinweis-Block bei `loadState === "loaded"` wurde entfernt.
  - **CanvasToolbar.tsx:** Der lange Hinweis wurde auf „Klick auf Kante: Punkt animiert.“ gekürzt.
- **Ergebnis:** Bei tatsächlichem Ladefehler bleibt die konkrete Fehlermeldung in der Karte plus „→ Preview neu starten“ / „In neuem Tab öffnen“.

---

## 2. Ziel von VisuDEV App Flow

- Repo per GitHub anbinden.
- **Alle Screens** und **Flow-Verbindungen** wie eine Sitemap sehen und den Aufbau verstehen.
- **User Journey:** Erkennen, **welcher Button zu welchem Screen** führt (nicht nur „Screen A → Screen B“, sondern „Button X → Screen B“).
- Optional: Live durch die Screens klicken (wenn die App das ohne Backend erlaubt oder Backend erreichbar ist).

---

## 3. Backend-Erreichbarkeit – Klarstellung

### 3.1 Wann welches „Backend“ nötig ist

| Was                                     | Backend nötig?    | Erklärung                                                                                                                                         |
| --------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **VisuDEV nutzbar**                     | Ja (euer Backend) | Supabase/Server für VisuDEV müssen erreichbar sein.                                                                                               |
| **Screens + Flows (Sitemap, Graph)**    | **Nein**          | Kommt aus **statischer Repo-Analyse** (visudev-analyzer). Kein laufendes Backend der User-App nötig.                                              |
| **Live-Iframe lädt**                    | Preview-Runner    | Der Runner liefert die gebaute App. Kein „extra“ Backend der User-App.                                                                            |
| **Inhalt in den Karten (Login, Daten)** | **Evtl. ja**      | Wenn die gepreviewte App API/DB braucht, muss dieses Backend von der Preview-Umgebung aus erreichbar sein (z. B. Host oder host.docker.internal). |

### 3.2 „Ohne Backend“ – wie funktioniert das?

- **Graph (welcher Button führt wohin):** Aus **Quellcode**:
  - `<Link to="/dashboard">`, `navigate('/login')`, `router.push('/settings')`, `href="/about"` usw.
  - Optional: ARIA-Label / Button-Text aus demselben File.
- Der Analyzer liest nur Code, baut Kanten „Element X → Screen B“ und speichert sie im Graphen. **Dafür muss die App nicht laufen und kein Backend erreichbar sein.**
- **Live durchklicken** in den Iframes ist ein Zusatz: Dafür muss die Preview-App laufen (Runner); ob Login/API funktioniert, hängt davon ab, ob die App ein Backend braucht und ob es erreichbar ist.

---

## 4. Generische Lösung für alle Projekttypen

### 4.1 Grundsatz

- **Sitemap & Flows:** Immer aus **statischer Analyse** (Analyzer). Unabhängig von Backend, für alle Repos nutzbar.
- **Live-Preview in Karten:** Best effort. Wenn die App im Container kein Backend erreicht (z. B. Login/Netzwerkfehler), bleibt die Sitemap/der Graph vollständig nutzbar.
- **Docker:** Beibehalten als Standard für Clone → Build → Serve (einheitlich für alle Stacks).
- **Host-Modus:** Optional (Runner mit `USE_DOCKER=0`), wenn volle Interaktivität mit lokalem Backend gewünscht ist.

### 4.2 Kein generischer Backend-Runner

- Es wird **kein** eigener Service gebaut, der das Backend der User-App startet (kein „Backend-Runner“).
- **Begründung:** Jedes Projekt hat anderes Backend (Node, Go, Python, Supabase, verschiedene Ports/Env). Automatisches Erkennen und zuverlässiges Starten wäre sehr aufwendig und wenig generisch.
- **Stattdessen:** Eine optionale Konfiguration für die **Backend-URL** der User-App; der Runner macht die Preview-App damit erreichbar (insbesondere im Docker).

### 4.3 Optionale Konfiguration „Preview Backend / API URL“

- **Wo:** Projekt in VisuDEV und/oder `visudev.config.json`.
- **Inhalt:** z. B. „Preview Backend / API URL“ (z. B. `http://localhost:3001`).
- **Verhalten im Docker-Modus:** Runner setzt für die Preview-App z. B. `VITE_API_URL=http://host.docker.internal:3001` (oder konfigurierbarer Env-Name).
- **Nutzerablauf:** User startet sein Backend einmal wie gewohnt; trägt die URL einmal ein (oder sie wird aus bestehendem `.env`/Config gelesen). Danach funktioniert Preview inkl. Login/API ohne weitere manuelle Env-Anpassung.
- **Doku:** „Reines Client-Routing: nur Preview starten. Mit Login/API: Backend lokal starten, Backend-URL in VisuDEV/visudev.config setzen.“

---

## 5. MUSS: „Button X → Screen B“ im Graphen

- **Anforderung:** Im Graphen nicht nur „Screen A → Screen B“, sondern wo möglich **„Button/Link X → Screen B“** (aus Code + ARIA/Label).
- **Umsetzung:** Statische Code-Analyse (bereits Ansätze: `navigatesTo`, `extractNavigationLinks`). Erweiterung um:
  - Zuordnung von Navigation zu konkreten UI-Elementen (Button-Text, ARIA-Label, umgebende JSX-Elemente).
  - Speicherung als Kante „Element X (Label/ARIA) → Screen B“ im Graphen.
- **Backend:** Nicht nötig; alles aus Repo-Code.

---

## 6. Bereits vorhanden vs. offen

### 6.1 Vorhanden

- Screens + Flows aus statischer Analyse (visudev-analyzer, viele Frameworks).
- Flows aus Code (Events, Links, API-Calls); `navigatesTo` aus Links/Router.
- Docker Build/Serve; Modus `docker` | `real` | `stub`.
- Host-Modus im Runner (z. B. `USE_DOCKER=0` in run-preview-runner).
- Live-Iframe pro Screen (Best effort); Fehlerbehandlung bei Ladefehler; `previewUrl` bei Wiederverwendung.

### 6.2 Noch offen / optional

- **Button X → Screen B:** Erweiterung der Analyse und des Graphen (MUSS, siehe Abschnitt 5).
- **Preview Backend URL:** Optionale Konfiguration + Injection im Docker (z. B. host.docker.internal).
- **Host-Modus in der UI:** Zusätzlich zur Doku evtl. Einstellung „Preview ohne Docker“ oder Hinweis, wie man den Runner mit `USE_DOCKER=0` startet.
- **Hinweis bei „loaded“ aber Fehler im Iframe:** Optional kurzer, neutraler Hinweis (z. B. „Sitemap & Flows unabhängig von Live-Ansicht“).
- **Doku:** Sitemap/Flows = aus Repo; Live-Karten = Best effort; Backend optional über Konfiguration.

---

## 7. Blueprint & Data (später)

- **Blueprint:** Architektur aus Code (Dateien, Imports). Kein laufendes Backend der User-App nötig; Repo-Zugriff wie beim App-Flow-Scan.
- **Data:** Visualisierung von Datenbanken (z. B. Supabase, DB-Schema). Bedeutet Anbindung an eine DB (Credentials, read-only), nicht das Starten des User-Backends.

---

## 8. Kurzüberblick

| Thema                               | Stand                                                |
| ----------------------------------- | ---------------------------------------------------- |
| Sitemap & Flows aus Repo            | ✅ Analyzer, unabhängig von Backend                  |
| „Button X → Screen B“ im Graph      | 🔲 MUSS, aus Code-Analyse                            |
| Docker für Preview                  | ✅ Beibehalten                                       |
| Backend der User-App starten        | ❌ Kein Backend-Runner                               |
| Backend-URL konfigurierbar          | 🔲 Optional: eine Config + Auto host.docker.internal |
| Doku (Client-Routing vs. Login/API) | 🔲 Empfohlen                                         |

---

_Stand: 01.03.2026 – Runner-Integration & App Flow._

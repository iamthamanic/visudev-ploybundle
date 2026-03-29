# App Flow: Wie Screens erkannt werden

Kurze Übersicht, damit du verstehst, warum manchmal „falsche“ Screens erscheinen und was du tun kannst.

---

## Ablauf der Erkennung

1. **Framework-Erkennung** (aus `package.json` + Dateistruktur)
   - Next.js App Router → `app/**/page.tsx`
   - Next.js Pages Router → `pages/**/*.tsx`
   - React Router → `<Route path="..." />` / `createBrowserRouter`
   - Nuxt → `pages/**/*.vue`
   - React (ohne Router) → State/Hash-Heuristik, danach **Heuristik-Fallback**

2. **Heuristik** (wenn kein Framework-Router erkannt wird)
   - **Neu:** `src/modules/<Modul>/pages/*.tsx` → ein Screen pro Modul, Pfad = `/<Modul>` (Shell → `/`)
   - Klassisch: Ordner `screens/`, `pages/`, `views/`, `routes/` unter `src/` oder `app/` → Pfad aus Dateiname (z. B. `DashboardPage.tsx` → `/dashboard`)
   - Zusätzlich: Komponenten in `components/` mit Namen auf `*Page`, `*Screen`, `*View` → können falsche Screens liefern

3. **Modals/Tabs/Dropdowns**
   - Werden nachträglich aus dem Code (Dialoge, Tabs, Dropdowns) ergänzt.

---

## Typische „falsche“ Screens

| Problem                                                 | Ursache                                                                                                             | Was tun                                                                                                                                                          |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Falsche **Namen** (z. B. „Shell“ statt „Projekte“)      | Heuristik leitet Namen aus Datei-/Modulnamen ab                                                                     | Erwartung anpassen oder Fallback-Routen nutzen (siehe unten).                                                                                                    |
| Falsche **Pfade** (z. B. `/shell` statt `/`)            | Alte Heuristik: Pfad nur aus Dateiname                                                                              | Mit **`src/modules/…/pages/`**-Struktur werden Pfade jetzt aus dem **Modulnamen** abgeleitet (Shell → `/`, Appflow → `/appflow`). Nach „Neu analysieren“ prüfen. |
| **Zu viele** Screens (z. B. jede Komponente als Screen) | Heuristik wertet alle `*Page`/`*Screen` in `components/`                                                            | Framework-Router im Repo nutzen (React Router/Next), damit keine Komponenten-Heuristik greift; oder Analyzer-Konfiguration anpassen.                             |
| **Zu wenige** Screens (z. B. Login fehlt)               | Route wird vom gewählten Extractor nicht erkannt (z. B. keine `app/login/page.tsx`, kein `<Route path="/login" />`) | Route so anlegen, dass der Analyzer sie findet (z. B. Next: `app/login/page.tsx`, React Router: `<Route path="/login" />`).                                      |
| **Doppelte** oder **falsche Modals**                    | State-Target-Extractor erkennt z. B. jeden Dialog als eigenen Screen                                                | In der Analyse-Logik/Config prüfen; ggf. Modals in der UI ausblenden oder Konfiguration verfeinern.                                                              |

---

## Fallback-Routen (wenn Erkennung nicht passt)

Wenn **kein** Screen gefunden wird, können im Analyzer **Fallback-Routen** gesetzt werden (Konfiguration der Edge Function / Umgebungsvariable). Dann werden genau diese Routen als Screens verwendet (Name + Pfad vorgegeben). So kannst du die Liste der Screens erzwingen, wenn die automatische Erkennung für dein Projekt ungeeignet ist.

---

## Nach einer Änderung

- Im App Flow **„Neu analysieren“** ausführen, damit die neue Heuristik (z. B. `modules/…/pages/`) und Framework-Erkennung greifen.
- Wenn du **VisuDEV selbst** (dieses Repo) analysierst: Mit der neuen Heuristik sollten die Haupt-Screens aus `src/modules/<modul>/pages/` mit den richtigen Pfaden erscheinen (z. B. `/`, `/appflow`, `/blueprint`, …).

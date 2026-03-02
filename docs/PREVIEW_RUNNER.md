# Preview Runner (Live App)

VisuDEV kann die angebundene App **aus dem Repo bauen und starten**, sodass du dich in der **echten laufenden App** im Tab **Live App** durchklicken kannst – ohne die App selbst zu starten oder auf Vercel/Netlify zu deployen.

## User-Flow (lokal): Einmal starten, Rest automatisch

**Der Nutzer soll nur sein Repo verbinden – VisuDEV erledigt die Arbeit.**

- **Einmal:** Im VisuDEV-Projektordner `npm run dev` ausführen. Das startet VisuDEV (App + Preview-Dienst), öffnet den Browser und setzt die richtige Runner-URL automatisch.
- **Danach:** Im UI nur noch **Repo verbinden** (Projekt anlegen/auswählen). Die Preview startet automatisch; kein weiterer Klick nötig. Technisch startet der Runner beim ersten Aufruf, die App ruft ihn mit der von `npm run dev` gesetzten URL auf.

Die Web-App kann auf dem Rechner **keine Prozesse starten** (Browser-Sicherheit). Darum ist „VisuDEV starten“ (einmal `npm run dev`) der eine Einstieg; alles Weitere (Preview anstoßen, URL setzen, Build) passiert im Hintergrund, sobald ein Repo verbunden ist.

## Runner lokal vs. feste URL

**Du kannst den Runner lokal hosten.** Es gibt zwei Wege:

| Weg                             | Wer ruft den Runner auf?                      | Runner lokal möglich?                                                                                                                                                                                            | Feste URL nötig?                                                                                                                                      |
| ------------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A: Direkt (empfohlen lokal)** | Das **Frontend** (Browser auf deinem Rechner) | **Ja** – Browser und Runner sind auf derselben Maschine, `localhost:4000` funktioniert.                                                                                                                          | Nein – du setzt nur `VITE_PREVIEW_RUNNER_URL=http://localhost:4000` in `.env`.                                                                        |
| **B: Über Edge Function**       | Die **Edge Function** (läuft bei Supabase)    | **Nur wenn Supabase auch lokal läuft** (`supabase start`). Wenn Supabase in der **Cloud** läuft, kann die Function deinen Rechner nicht erreichen – dann brauchst du eine **öffentlich erreichbare** Runner-URL. | Nur bei **Supabase in der Cloud**: Ja, feste URL (z. B. `https://runner.example.com`), weil die Function von Supabase-Servern aus den Runner aufruft. |

**Kurz:** Runner lokal ist möglich. Setze `VITE_PREVIEW_RUNNER_URL=http://localhost:4000`, starte den Runner lokal – dann spricht das Frontend den Runner direkt an, **kein Supabase-Secret und keine feste öffentliche URL** nötig. Eine feste URL brauchst du nur, wenn du den Umweg über die Edge Function (in der Cloud) nutzen willst.

## Architektur

1. **Preview Runner** (separater Service): Vergibt **automatisch einen freien Port** pro Lauf (z. B. 4001, 4002, …), klont/baut/startet die App, liefert die **Preview-URL** (lokal: `http://localhost:PORT`; Produktion: öffentliche URL).
2. **Edge Function `visudev-preview`** (optional): Ruft den Runner auf, speichert Preview-URL und Status in KV. Wird nicht genutzt, wenn `VITE_PREVIEW_RUNNER_URL` gesetzt ist.
3. **Frontend**: App Flow mit Live-Preview-Iframes. Ruft entweder den Runner **direkt** (bei `VITE_PREVIEW_RUNNER_URL`) oder die Edge Function auf.

## Preview Runner einrichten

Der Preview Runner ist ein **eigener Service** (läuft nicht in Supabase). Im Repo liegt eine **MVP-Stub-Version** unter `preview-runner/`.

### Lokal starten (Stub)

```bash
cd preview-runner
npm install
npm start
```

Der Stub antwortet auf:

- `POST /start` – Body: `{ repo, branchOrCommit, projectId }` → weist einen **freien Port** aus dem Pool zu, speichert `previewUrl: http://localhost:PORT` (oder optional `PREVIEW_BASE_URL` + Query), antwortet mit `{ runId, status: "starting" }`
- `GET /status/:runId` – nach ein paar Sekunden: `{ status: "ready", previewUrl }` (z. B. `http://localhost:4001`)
- `POST /stop/:runId` – Port wird wieder freigegeben, `{ status: "stopped" }`
- `POST /refresh` – Body: `{ runId }`. **Live-Update:** `git pull`, Rebuild, App neu starten (gleicher Port).
- `POST /webhook/github` – **GitHub Webhook:** Bei Push ruft GitHub diese URL auf; der Runner findet die passende Preview (repo + branch) und startet automatisch Refresh (pull + rebuild + restart). So siehst du Änderungen **live**, ohne „Preview aktualisieren“ zu klicken.

Umgebungsvariablen:

- `PORT` – Server-Port des Runners (Standard: 4000)
- `USE_REAL_BUILD` – **optional**. Wenn `1` oder `true`: echter Clone/Build/Start (Repo klonen, bauen, App auf zugewiesenem Port starten). Ohne: Stub (Platzhalter-Seite).
- `USE_DOCKER` – **optional**. Wenn `1` oder `true`: Build und Serve laufen **im Docker-Container** (fipso/runner-ähnlich). Ein Container pro Preview: `install → build → npx serve dist -s -l 3000` im Container; Host-Port wird auf Container:3000 gemappt. **Vorteil:** Kein „App ignoriert PORT“ (ECONNREFUSED); funktioniert auch bei Vite/React-Apps, die sonst auf 5173 laufen. **Voraussetzung:** Docker muss laufen (`docker info`). Image: `node:20-alpine` (über `VISUDEV_DOCKER_IMAGE` änderbar).
- `PREVIEW_DOCKER_READY_TIMEOUT_MS` – **optional** (nur Docker-Modus). Timeout bis die App im Container auf dem gemappten Port antwortet (Standard: `300000` = 300s).
- `PREVIEW_DOCKER_LOG_TAIL` – **optional** (nur Docker-Modus). Anzahl Log-Zeilen, die bei Docker-Boot-Fehlern ins Preview-Terminal geschrieben werden (Standard: `120`).
- `PREVIEW_BOOT_MODE` – **optional** (nur `USE_REAL_BUILD` ohne Docker). Standard: `best_effort`.  
  `best_effort`: Bei Build-Fehler wird automatisch ein Dev-Fallback (`dev/start`) versucht; nur wenn auch der Fallback nicht bootet, wird der Run als failed markiert.  
  `strict`: Build muss erfolgreich sein, sonst failed.
- `injectSupabasePlaceholders` (pro `/start` oder `/refresh`) – **optional**.  
  Wenn nicht gesetzt: Auto-Modus. Platzhalter für `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` werden nur gesetzt, wenn Supabase im App-Code erkannt wird.  
  Wenn `true`: Platzhalter werden erzwungen. Wenn `false`: Platzhalter werden nie gesetzt.
- `GITHUB_TOKEN` – **optional**. Für private Repos: Token mit Lese-Recht, damit der Runner klonen kann.
- `GITHUB_WEBHOOK_SECRET` – **optional**. Secret, das du in den GitHub-Webhook-Einstellungen einträgst; der Runner prüft damit die Signatur (X-Hub-Signature-256) und lehnt unbefugte Aufrufe ab.
- `PREVIEW_PORT_MIN` / `PREVIEW_PORT_MAX` – Port-Pool für Preview-URLs (Standard: 4001–4099). Pro Lauf wird automatisch ein freier Port vergeben.
- `PREVIEW_BASE_URL` – **optional**. Wenn gesetzt (z. B. Tunnel-URL), wird diese Basis + Query als `previewUrl` genutzt; sonst immer `http://localhost:${port}`.
- `SIMULATE_DELAY_MS` – Verzögerung in ms, bis „ready“ (nur im Stub-Modus; Standard: 3000)
- `AUTO_REFRESH_INTERVAL_MS` – **optional**. Im REAL-Modus prüft der Runner alle N ms, ob das Repo neue Commits hat; bei Bedarf automatisch pull + rebuild + restart (Standard: 60000 = 1 Minute). Auf 0 setzen deaktiviert Auto-Refresh.

**Unterstützte Paketmanager:** Der Runner erkennt den Paketmanager anhand der Lock-Dateien und führt Install/Build mit dem passenden Befehl aus:

- **npm** – `package-lock.json` → `npm ci --ignore-scripts` bzw. `npm install --ignore-scripts`
- **pnpm** – `pnpm-lock.yaml` → `pnpm install --ignore-scripts` (pnpm muss installiert sein, z. B. `npm install -g pnpm`)
- **yarn** – `yarn.lock` → `yarn install --ignore-scripts` (yarn muss installiert sein, z. B. `corepack enable`)

### Hosting (Produktion)

Für echte Builds (Clone, `npm install`, `npm run build`, Start) den Runner auf **VPS, Railway, Render, Fly.io** o. Ä. hosten und dort:

- Repo klonen (GitHub Token aus Env)
- Optional `visudev.config.json` im Repo lesen (siehe unten)
- Build und Start in isoliertem Container; **freien Port** pro Lauf vergeben (Port-Pool oder dynamisch)
- Reverse Proxy oder Subdomain pro Run, damit die **Preview-URL vom Browser aus erreichbar** ist (VisuDev lädt die URL im iframe; bei lokalem Runner reicht `http://localhost:PORT`, bei VisuDev auf Vercel muss die URL öffentlich erreichbar sein)

### Lokal ohne Supabase-Secret (empfohlen für Entwicklung)

Du musst **keinen** freien Port als Secret eintragen. Du trägst nur **eine** URL ein: die des **Runner-Services** (API mit `/start`, `/status`, `/stop`). Der Runner vergibt **intern** freie Ports pro Preview (z. B. 4001, 4002, …).

**Lokal ohne Edge Function:** Setze in `.env` (oder `.env.local`):

```bash
VITE_PREVIEW_RUNNER_URL=http://localhost:4000
```

Dann starte den Runner (`cd preview-runner && npm start`). Das Frontend spricht den Runner direkt an – **kein Supabase-Secret nötig**. Der Runner läuft auf Port 4000 (API); die einzelnen Previews bekommen automatisch freie Ports (4001–4099).

### Supabase: Runner-URL eintragen (Produktion / mit Edge Function)

1. Supabase Dashboard → dein Projekt → **Edge Functions** → **Secrets**
2. Secret anlegen: `PREVIEW_RUNNER_URL` = **Runner-API-URL** (z. B. `https://preview-runner.example.com`). Das ist die **eine** feste URL, unter der der Runner-Service erreichbar ist – **nicht** die Ports der einzelnen Previews (die vergibt der Runner selbst).
3. Edge Function `visudev-preview` deployen: `supabase functions deploy visudev-preview`

## visudev.config (optional)

Im **Root des User-Repos** (z. B. Scriptony) kann optional eine Datei `visudev.config.json` liegen, damit der Preview Runner die App korrekt baut und startet:

```json
{
  "buildCommand": "npm ci && npm run build",
  "startCommand": "npx serve dist",
  "appDirectory": "frontend",
  "injectSupabasePlaceholders": false,
  "port": 3000
}
```

- **buildCommand** – Befehl zum Bauen (Standard z. B. `npm run build`)
- **startCommand** – Befehl zum Starten der App (z. B. `npx serve dist` oder `npm run start`)
- **appDirectory** – optionales Unterverzeichnis für Monorepos (z. B. `frontend`, `apps/web`).  
  Ohne Angabe versucht der Runner das App-Verzeichnis automatisch zu erkennen.
- **injectSupabasePlaceholders** – optionaler Override (`true`/`false`) für Supabase-Preview-Platzhalter.
- **port** – Port, auf dem die App läuft

Fehlt die Datei, verwendet der Runner sinnvolle Defaults (z. B. `npm run build` + `npx serve dist`, Port 3000).

### Auto-Erkennung (ohne Config)

Ohne `visudev.config.json` scannt der Runner das Repo nach mehreren App-Kandidaten (z. B. `frontend/`, `apps/web`, `packages/frontend`, Root), bewertet sie per Score und probiert sie in Reihenfolge.

- Pro Kandidat: `install -> build -> start`
- Bei `best_effort`: wenn Build/Start fehlschlägt, wird zusätzlich ein Fallback (`dev/start`) probiert
- Wenn ein Kandidat nicht bootet, testet der Runner den nächsten Kandidaten automatisch
- In den Preview-Logs siehst du die Reihenfolge als `Scanner: Kandidat X/Y: ...`

## Build-Test (Runner-Funktion prüfen)

Der Preview Runner hat einen Build-Test, der **ohne echten Git-Clone** prüft, ob `runBuildNodeDirect` (Paketmanager-Erkennung, Install, Build) funktioniert:

- **Im Runner-Verzeichnis:** `cd preview-runner && npm run test:build`
- **Im Projekt-Root:** `npm run test:preview-runner`

Der Test legt ein minimales Workspace mit `package.json` an, führt `npm ci --ignore-scripts` und `npm run build` aus und räumt danach auf. So kannst du nach Änderungen an `build.js` schnell prüfen, dass der Build-Pfad funktioniert.

## Nach Code-Änderungen (Neustart / Deploy)

**Preview Runner:** Änderungen an `preview-runner/build.js`, `preview-runner/index.js` oder `preview-runner/docker.js` werden erst nach einem **Neustart** des Runners wirksam:

1. Runner im Terminal mit **Ctrl+C** beenden.
2. Erneut starten:
   - Stub: `npm start`
   - Echter Build: `USE_REAL_BUILD=1 npm start` (optional mit `GITHUB_TOKEN=…`).

Ohne Neustart läuft weiterhin die alte Version.

**Screen-Analyzer („Neu analysieren“):** Änderungen an der Edge Function `visudev-analyzer` (z. B. unter `supabase/functions/visudev-analyzer/`) werden erst nach **Deploy** wirksam: `supabase functions deploy visudev-analyzer`. Danach im UI „Neu analysieren“ ausführen, damit die verbesserte Screen-Erkennung greift. Siehe auch `docs/SUPABASE_SETUP.md`.

## Checkliste: alles lokal (ohne Supabase-Secret)

1. **Runner starten:** `cd preview-runner && npm install && npm start` (läuft auf `http://localhost:4000`).
2. **In `.env` oder `.env.local`:** `VITE_PREVIEW_RUNNER_URL=http://localhost:4000`
3. **VisuDev starten:** `npm run dev` (Frontend spricht Runner direkt an).
4. Im App Flow **Preview starten** – der Runner vergibt intern einen freien Port (z. B. 4001) und liefert die Preview-URL.
5. **Preview beenden** gibt den Port im Runner wieder frei.

Kein Supabase-Secret, keine feste URL – der Runner kann lokal laufen.

## GitHub Webhook (Live bei Push)

Wenn jemand ins Repo pusht (z. B. Button blau → grün), kann die Preview **automatisch** aktualisiert werden – ohne „Preview aktualisieren“ zu klicken.

1. **Runner muss von GitHub erreichbar sein:** Lokal z. B. mit [ngrok](https://ngrok.com): `ngrok http 4000` → du bekommst eine URL wie `https://abc123.ngrok.io`. Oder Runner auf einem Server mit öffentlicher URL deployen.
2. **Webhook in GitHub anlegen:** Repo auf GitHub → **Settings** → **Webhooks** → **Add webhook**
   - **Payload URL:** `https://deine-runner-url/webhook/github` (z. B. `https://abc123.ngrok.io/webhook/github`)
   - **Content type:** `application/json`
   - **Secret:** Beliebiges geheimes Passwort (z. B. mit `openssl rand -hex 32` erzeugen). Dasselbe Secret als `GITHUB_WEBHOOK_SECRET` im Runner setzen (Env oder `.env` im `preview-runner`-Ordner).
   - **Events:** „Just the push event“ reicht.
3. **Runner mit Secret starten:** `GITHUB_WEBHOOK_SECRET=dein-secret USE_REAL_BUILD=1 npm start`
4. **Ablauf:** Push ins Repo → GitHub ruft deine Webhook-URL auf → Runner findet die laufende Preview für dieses Repo+Branch → führt `git pull`, Rebuild und Neustart aus → die Preview zeigt den neuesten Stand.

Ohne Webhook: **„Preview aktualisieren“** in VisuDEV klicken erzeugt denselben Effekt (Pull + Rebuild + Restart).

## Ablauf in der UI

1. Projekt mit GitHub-Repo auswählen.
2. App Flow öffnen (Live-Preview-Iframes oder Einzel-iframe). **Pro Screen:** Jede Karte lädt die Route in einem eigenen Iframe. Kann ein Screen nicht geladen werden (Timeout, Fehler, keine URL), wird nur diese Karte mit einem **klar benannten Grund** angezeigt (z. B. „Timeout: Screen konnte nicht innerhalb von 12 s geladen werden …“); die übrigen Screens bleiben unberührt und werden weiter angezeigt.
3. **Preview starten** (oder Auto-Start bei verbundenem Repo) → VisuDEV ruft entweder den Runner **direkt** (wenn `VITE_PREVIEW_RUNNER_URL` gesetzt) oder die Edge Function auf; der Runner vergibt einen freien Port und liefert die Preview-URL.
4. Nach einigen Sekunden (Stub) bzw. Minuten (echter Build) erscheint die **Preview-URL** im iframe.
5. **Live:** Nach Push ins Repo wird die Preview automatisch aktualisiert (wenn Webhook konfiguriert), sonst **„Preview aktualisieren“** klicken.
6. Optional: **Preview beenden** zum Stoppen (Port wird im Runner wieder freigegeben).
7. Optional: **Live Route/Buttons** anzeigen – wenn deine App im iframe `postMessage` mit Typ `visudev-dom-report` sendet, zeigt VisuDEV z. B. „Live: /dashboard · 3 Buttons“ am Preview-Knoten. Snippet und Doku: [LIVE_DOM_REPORT.md](./LIVE_DOM_REPORT.md).

## Iframe-Einbetten (Frame-Proxy)

Der Preview Runner startet im **echten Build** (USE_REAL_BUILD=1) einen **Frame-Proxy**: Die Preview-App läuft auf einem internen Port (z. B. 4004), der **Proxy** läuft auf dem Port, den VisuDEV als Preview-URL nutzt (z. B. 4003). Der Proxy leitet alle Anfragen an die App weiter und setzt die Header **Content-Security-Policy: frame-ancestors …** so, dass VisuDEV (localhost:5173, 3000) die Preview in Iframes einbetten kann. **Du musst in der Preview-App (hrkoordinator o. Ä.) nichts anpassen** – der Runner übernimmt das.

## Wenn alle Screens mit Timeout fehlschlagen (ohne Frame-Proxy)

Falls du den Runner **ohne** USE_REAL_BUILD nutzt (Stub) oder der Proxy ausfällt, kann die Preview-App das Einbetten blockieren. Dann in der **Preview-App** (das Repo, das auf z. B. `http://localhost:4003` läuft) Einbetten erlauben:

- **X-Frame-Options:** Nicht setzen oder nicht `DENY`/`SAMEORIGIN` (bzw. erlauben, dass VisuDEV (z. B. `http://localhost:5173`) einbetten darf).
- **CSP (Content-Security-Policy):** `frame-ancestors` so setzen, dass die VisuDEV-Origin erlaubt ist.

**Beispiel Vite (Preview-App):** In `vite.config.ts`:

```ts
export default defineConfig({
  server: {
    headers: {
      "Content-Security-Policy":
        "frame-ancestors 'self' http://localhost:5173 http://localhost:3000",
    },
  },
});
```

**Beispiel Express (Preview-App):** Vor dem Ausliefern der statischen Dateien:

```js
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "frame-ancestors 'self' http://localhost:5173 http://localhost:3000",
  );
  next();
});
```

Danach Preview-App neu starten und in VisuDEV erneut „Preview aktualisieren“ oder Preview starten. Im **Terminal** (Button neben dem Home-Icon) siehst du, welche URLs geladen werden und ob weiterhin Timeouts auftreten.

## Hinweis zu Projekten in KV

Die Edge Function liest das Projekt aus dem KV-Store (`project:${projectId}`). Sind Projekte nur im Frontend-State (nicht über die Projects-API gespeichert), sendet das Frontend beim Start **repo** und **branchOrCommit** mit; die Edge Function nutzt diese dann für den Aufruf des Runners.

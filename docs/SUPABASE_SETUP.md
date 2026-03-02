# Supabase-Projekt im Repo sichern & wiederherstellen

Dieses Repo enthält alles, um das Supabase-Projekt später neu aufzusetzen (z. B. nach Löschen des Cloud-Projekts).

**Standard:** Die App nutzt **Supabase Cloud** (Projekt `tzfxbgxnjkthxwvoeyse`). Keine `.env` nötig – URL und Anon-Key sind im Code hinterlegt. Einfach `npm run dev` starten, anmelden/registrieren im Dashboard, GitHub-Verbindung usw. funktionieren gegen die Cloud.

## PROJECT_REF (Cloud – Standard)

- **PROJECT_REF:** `tzfxbgxnjkthxwvoeyse`
- Dashboard: https://supabase.com/dashboard/project/tzfxbgxnjkthxwvoeyse
- Edge Functions: https://supabase.com/dashboard/project/tzfxbgxnjkthxwvoeyse/functions
- API-URL: `https://tzfxbgxnjkthxwvoeyse.supabase.co`

## Frontend auf Supabase Cloud (Standard)

Ohne weitere Konfiguration nutzt die Vite-App die Cloud:

1. **Keine `.env.local` nötig** – `src/utils/supabase/info.tsx` verwendet standardmäßig die Cloud-URL und den Anon-Key des Projekts `tzfxbgxnjkthxwvoeyse`.
2. **`npm run dev`** – App spricht mit Auth, DB und Edge Functions in der Cloud.
3. **Anmelden:** Im Dashboard unter Authentication → Users Nutzer anlegen oder in der App „Konto erstellen“ / „Anmelden“ nutzen.
4. **Secrets für Edge Functions** (z. B. GitHub OAuth): Im [Supabase Dashboard](https://supabase.com/dashboard/project/tzfxbgxnjkthxwvoeyse/settings/functions) unter Edge Functions → Secrets setzen (`GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, ggf. `GITHUB_REDIRECT_URI`).

Falls du doch lokale Werte überschreiben willst: `.env.local` mit `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` anlegen (siehe `.env.example`).

## Voraussetzungen

- Git-Repo ausgecheckt
- **Supabase CLI:** `brew install supabase/tap/supabase` (macOS)
- **Docker** läuft (für `supabase db dump` und lokale Entwicklung)
- Optional: `jq` für JSON (ansonsten Python)

## Supabase lokal auf dem Mac hosten

Ja – du kannst die **komplette Supabase-Umgebung lokal** auf deinem Mac betreiben (Datenbank, Auth, Storage, Edge Functions, Studio). Alles läuft in Docker.

### 1. Voraussetzungen

- **Docker Desktop** für Mac: [docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/) – installieren und starten (Docker muss laufen).
- **Supabase CLI** (falls noch nicht vorhanden):
  ```bash
  brew install supabase/tap/supabase
  ```

### 2. Lokalen Stack starten

- **Docker Desktop** muss laufen – Supabase nutzt Docker für Postgres, Kong, Studio usw.
- Am **Repo-Root** (dort liegt `supabase/config.toml`):

```bash
cd /path/to/Visudevfigma
supabase start
```

Falls ihr Projekt ein **Supabase-Wrapper-Skript** nutzt (`scripts/supabase-checked.sh`): Für `start`, `stop`, `status`, `db`, `functions` werden keine Code-Checks ausgeführt – Supabase startet auch bei Prettier/Lint-Warnungen. Wenn du die echte CLI direkt nutzen willst: `SUPABASE_REAL_BIN=/opt/homebrew/bin/supabase supabase start` oder `npm run supabase:checked -- start`.

Beim ersten Mal werden die Docker-Images geladen – das kann einige Minuten dauern. Danach laufen:

- **API (Kong):** `http://localhost:54321`
- **Postgres:** `postgresql://postgres:postgres@localhost:54322/postgres`
- **Supabase Studio (Dashboard):** `http://localhost:54323`
- **Mailpit (E-Mails):** `http://localhost:54324`

**Hinweis Lokal vs. Cloud:** Beim lokalen Supabase gibt es **keine Projektliste** (nur eine lokale Instanz). Unter **Edge Functions** im lokalen Studio siehst du ggf. keine oder wenige Einträge – lokal werden die Functions **aus dem Repo** geladen (`src/supabase/functions/` bei `--workdir src`), sie werden nicht „deployt“. Sie sind trotzdem erreichbar unter `http://127.0.0.1:54321/functions/v1/<name>` (z. B. `visudev-auth`, `visudev-projects`). Im Studio nutzen: **Database** (Tabellen, SQL Editor), **Authentication** (User, Provider), **Storage**, **Logs** – das funktioniert lokal wie gewohnt.

**Edge Functions im Browser testen:** Für `visudev-auth` ist in der Config **`verify_jwt = false`** gesetzt (wie in der Cloud „Verify JWT“ aus). Das Gateway verlangt dann keinen Authorization-Header; die Auth prüft die Function selbst (Bearer + getUser). Ohne diese Einstellung würde das Gateway „Missing authorization header“ zurückgeben, bevor die Function läuft. Nach Config-Änderung: `supabase stop` und `supabase start`. Health im Browser: `http://127.0.0.1:54321/functions/v1/visudev-auth/health` → `{"success":true,"data":{"service":"visudev-auth","ok":true}}`. Geschützte Endpoints (z. B. `/github/status`) verlangen weiterhin `Authorization: Bearer <user-jwt>` – geprüft im Code.

Die **Anon Key** und **Service Role Key** für lokal zeigt dir:

```bash
supabase status
```

### 3. Datenbank-Schema anwenden (Migrationen)

Nach dem ersten Start die Migrationen aus dem Repo anwenden:

```bash
supabase db reset
```

Das wendet alle Dateien in `supabase/migrations/` auf die lokale DB an (inkl. Tabelle `kv_store_edf036ef`).

### 4. Edge Functions lokal ausführen (optional)

Functions einzeln testen:

```bash
supabase functions serve
# oder eine Function: supabase functions serve visudev-analyzer
```

Dann erreichst du sie z. B. unter `http://localhost:54321/functions/v1/<function-name>`.

### 5. Supabase Auth (E-Mail/Passwort) im Frontend

Die App nutzt **Supabase Auth** (E-Mail/Passwort) über den Browser-Client (`src/lib/supabase/client.ts`). Anmelden/Konto erstellen ist in der Sidebar („Anmelden“) und im Dialog möglich. Session wird von Supabase verwaltet (auth.users).  
Lokal: In Supabase Studio (http://127.0.0.1:54323) unter **Authentication → Providers → Email** kannst du „Confirm email“ deaktivieren, damit sich Nutzer ohne E-Mail-Bestätigung anmelden können. **Wichtig:** Nutzer der Cloud existieren lokal nicht – bei lokalem Supabase zuerst **„Konto erstellen“** (Sign up) ausführen, dann mit dieser E-Mail/Passwort anmelden.

### 6. Frontend auf lokales Supabase umstellen (optional)

**Hinweis:** Standard ist Cloud. Nur nötig, wenn du bewusst gegen eine lokale Supabase-Instanz entwickeln willst.

1. Nach `supabase start` im Repo-Root ausführen: `supabase status`
2. **Project URL** = `http://127.0.0.1:54321`, **Publishable** = Anon-Key für den Client
3. Datei **`.env.local`** im Repo-Root anlegen (wird von Git ignoriert):

   ```bash
   VITE_SUPABASE_URL=http://127.0.0.1:54321
   VITE_SUPABASE_ANON_KEY=<Publishable-Key aus supabase status>
   ```

4. Vite neu starten (`npm run dev`). Die App nutzt dann die lokale Instanz (siehe `src/utils/supabase/info.tsx`).

**Zurück zu Cloud:** `.env.local` löschen oder die Zeilen `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` entfernen – dann nutzt die App wieder die Cloud (tzfxbgxnjkthxwvoeyse).

Vorlage: **`.env.example`** (ohne echte Keys).

### 6. Nützliche Befehle

| Befehl                      | Bedeutung                                    |
| --------------------------- | -------------------------------------------- |
| `supabase start`            | Lokalen Stack starten                        |
| `supabase stop`             | Stack anhalten (Daten bleiben)               |
| `supabase stop --no-backup` | Anhalten und Daten löschen                   |
| `supabase status`           | URLs und Keys anzeigen                       |
| `supabase db reset`         | DB zurücksetzen und Migrationen neu anwenden |

Damit hast du Datenbank und alles Supabase-Relevante lokal auf deinem Mac.

## Repo-Layout (Standard am Root)

| Pfad                     | Inhalt                                                      |
| ------------------------ | ----------------------------------------------------------- |
| `supabase/config.toml`   | Function-Entrypoints (index.tsx)                            |
| `supabase/migrations/`   | SQL-Migrationen (Schema)                                    |
| `supabase/functions/`    | Edge Functions Source (server, visudev-\*)                  |
| `supabase/backups/`      | DB-Dumps; nur `schema_and_data_LATEST.sql` wird versioniert |
| `docs/SUPABASE_SETUP.md` | Diese Anleitung                                             |
| `src/supabase/`          | Aktuelles Deploy mit `--workdir src` (unverändert)          |

## Login & Link

```bash
# Einmalig: Login (öffnet Browser)
supabase login

# Projekt verlinken (am Repo-Root)
cd /path/to/Visudevfigma
supabase link --project-ref tzfxbgxnjkthxwvoeyse
```

Bei DB-Passwort-Abfrage: Passwort aus Supabase Dashboard → Project Settings → Database verwenden oder `SUPABASE_DB_PASSWORD` setzen.

## Backup erstellen (Schema + Daten)

Docker muss laufen. Am Repo-Root:

```bash
# 1) Schema-Dump
supabase db dump -f supabase/backups/schema_and_data_$(date +%Y%m%d_%H%M%S).sql

# 2) Daten-Dump anhängen (gleicher Timestamp wie oben verwenden oder LATEST nutzen)
# Zuerst Schema in schema_and_data_LATEST.sql, dann:
supabase db dump --data-only -f supabase/backups/_data.sql
cat supabase/backups/_data.sql >> supabase/backups/schema_and_data_LATEST.sql
rm supabase/backups/_data.sql
```

Oder Schema und Daten getrennt halten:

```bash
supabase db dump -f supabase/backups/schema_$(date +%Y%m%d).sql
supabase db dump --data-only -f supabase/backups/data_$(date +%Y%m%d).sql
cp supabase/backups/schema_*.sql supabase/backups/schema_and_data_LATEST.sql
cat supabase/backups/data_*.sql >> supabase/backups/schema_and_data_LATEST.sql
```

## Restore (neues Projekt)

1. Neues Supabase-Projekt im Dashboard anlegen.
2. `supabase link --project-ref <NEUER_REF>`
3. Migrationen anwenden: `supabase db push` (oder SQL aus `supabase/migrations/` im SQL Editor ausführen).
4. Optional: Daten wiederherstellen: `psql` mit Connection-String aus Dashboard, dann `\i supabase/backups/schema_and_data_LATEST.sql` (oder nur Daten-Teil einspielen).
5. Edge Functions deployen: `supabase functions deploy <name>` für jede Function unter `supabase/functions/`.
6. Secrets setzen (Dashboard → Edge Functions → Secrets): z. B. `SCREENSHOT_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (werden beim Deploy gesetzt). Für **GitHub Actions**-Secrets siehe `docs/GITHUB_SECRETS.md` (CLI: `gh secret set`).

## Im Repo vs. separat sichern

| Im Repo (versioniert)                                        | Separat sichern                                          |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `supabase/config.toml`                                       | DB-Passwort (Dashboard)                                  |
| `supabase/migrations/*.sql`                                  | Service Role Key (Dashboard)                             |
| `supabase/functions/*` (Source)                              | Anon Key (in `src/utils/supabase/info.tsx` für Frontend) |
| `supabase/backups/schema_and_data_LATEST.sql` (ein Snapshot) | Weitere Backup-Dateien (z. B. ältere Dumps)              |
| `docs/SUPABASE_SETUP.md`                                     | GitHub/Supabase OAuth-Tokens (falls genutzt)             |
| PROJECT_REF in Doku und `src/utils/supabase/info.tsx`        |                                                          |

## Edge Functions deployen (Root-Layout)

Am Repo-Root (nach `supabase link`):

```bash
supabase functions deploy server
supabase functions deploy visudev-analyzer
supabase functions deploy visudev-integrations
# … weitere: visudev-data, visudev-logs, visudev-projects, visudev-screenshots, visudev-auth, visudev-appflow, visudev-blueprint, visudev-account, visudev-server
```

Hinweis: Das Frontend und die bestehenden Scripts nutzen weiterhin `src/supabase/` mit `--workdir src`. Das Root-`supabase/` dient der vollständigen Sicherung und dem Restore auf ein neues Projekt.

### Deploy-Fehler: „Unsupported lockfile version '5'“

Der Supabase-Build-Container nutzt eine ältere Deno-Version, die nur Lockfile-Version 4 (oder niedriger) unterstützt. Lokales Deno 2.x erzeugt Lockfile v5 – der Deploy schlägt dann fehl.

**Saubere Lösung (Lockfile nicht löschen):** Lockfile mit Deno 1.x neu erzeugen. Langfristig am besten mit einem Version-Manager (reproduzierbar, pro Projekt, fürs Team dokumentierbar).

#### Option B (empfohlen, langfristig): Version-Manager (mise oder asdf)

So bleibt Deno 1.46 für die Edge Functions reproduzierbar und ihr müsst nicht jedes Mal manuell wechseln.

**Mit [mise](https://mise.jdx.dev/):**

```bash
# mise installieren (einmalig), z. B. Homebrew: brew install mise
cd src/supabase/functions/visudev-analyzer
mise use deno@1.46.0
deno cache index.tsx
```

**Mit [asdf](https://asdf-vm.com/) + [asdf-deno](https://github.com/asdf-community/asdf-deno):**

```bash
asdf plugin add deno
asdf install deno 1.46.0
cd src/supabase/functions/visudev-analyzer
echo "deno 1.46.0" >> .tool-versions
deno cache index.tsx
```

Im Verzeichnis `src/supabase/functions/visudev-analyzer` liegt optional eine `.mise.toml` bzw. `.tool-versions` mit `deno 1.46.0` – dann nutzt jeder, der dort arbeitet, automatisch die richtige Version. Danach: `head -2 deno.lock` → `"version": "3"` oder `"4"` (je nach Deno-Version; der Supabase-Container akzeptiert beides), dann `supabase functions deploy visudev-analyzer` aus dem Repo-Root.

#### Option A (Fallback): Einmalig Deno 1.46-Binary

Falls kein Version-Manager gewünscht ist: Deno 1.46 von [GitHub Releases](https://github.com/denoland/deno/releases/tag/v1.46.0) herunterladen, temporär nutzen, im Function-Verzeichnis `deno cache index.tsx` ausführen, Lockfile prüfen, deployen.

Supabase arbeitet an Support für neuere Deno-Versionen; bis dahin bleibt das Lockfile nach der einmaligen Neuerzeugung mit dem Container kompatibel.

# Logs & Execution Units: Ist-Zustand und Zielbild

Kurzes Konzept-Dokument: Wie der aktuelle Log-Tab funktioniert, wie er sich zum **provider-agnostischen „Logs pro Execution Unit“**-Modell (Supabase-Feeling für beliebige Codebases) weiterentwickeln lässt, und welche Umsetzungsoptionen es gibt.

---

## 1. Logs heute (Ist-Zustand)

### Ablauf

- **Frontend:** Log-Tab ruft `GET /functions/v1/visudev-logs/${projectId}` auf.
- **Backend:** Supabase Edge Function **visudev-logs** (Deno/Hono).
- **Speicher:** KV-artig (Supabase-Tabelle als Key-Value), Key-Pattern `logs:${projectId}:${logId}`.
- **Datenmodell:** Pro Eintrag u. a. `id`, `projectId`, `timestamp`, `level`, `message` – **keine** Zuordnung zu einer „Funktion“ oder Route.

### Was fehlt für „Logs pro Feature“

- Keine **Execution Unit** (Route, Job, Resolver, Cron, …) als Abstraktion.
- Keine **execution_unit_id** (oder vergleichbar) an den Logs.
- Keine **Filterung/Gruppierung nach Unit** in der UI.
- Keine **Traces/Spans**; keine automatische Zuordnung von Requests/Jobs zu Units.

**Fazit:** Der Tab ist ein **projektweiter Log-Stream**. Für „Logs pro Unit“ wie bei Supabase Edge Functions fehlt das Unit-Konzept und die Anreicherung der Logs.

---

## 2. Zielbild: Execution Units (provider-agnostisch)

Statt „Function = Deployment Unit = Log Unit“ (Supabase-spezifisch) eine **einheitliche Abstraktion** für beliebige Repos:

### Execution Unit

- **Operative Einheit**, die Nutzer mental als „Feature-Funktion“ verstehen und für Logs anklicken:
  - HTTP Endpoint (Route/Handler)
  - RPC/GraphQL Resolver
  - Background Job (Queue Worker)
  - Event Consumer (Kafka/SQS/PubSub/Webhooks)
  - Cron/Scheduled Task
  - CLI/Batch Task
  - (optional) Server Action / Server Function

- **Metadaten pro Unit:** `kind`, `name`, `framework`, `source` (file/symbol/line), `entrypoint` (method+route / queue / topic / cron expr), `runtime`, `confidence`.

### Discovery: Static + Runtime

- **Static:** Repo-Scan (AST/Heuristiken) → potentielle Units mit Source-Mapping.
- **Runtime:** Instrumentierung (HTTP, Queue, …) → beobachtete Units aus echten Invocations.
- **Merge:** Einheitliche Liste mit stabiler ID; Namensgebung aus Route/Job/Resolver oder Fallback file:line/Symbol.

### Logs & Traces

- **Logs:** Mindestens `timestamp`, `level`, `message`, **execution_unit_id**, `request_id`/`trace_id`, `service`/`env`/`version`/`commit`.
- **Traces:** OpenTelemetry-Modell; Root-Span pro Request/Job, Kind-Spans für Handler/Resolver/Job; Exceptions am Span → saubere Zuordnung pro Unit.
- **UI:** „Logs pro Unit“ = Filter `execution_unit_id = X` (plus optional Deploy-Version).

### Integration (ohne dass Nutzer „drauf achten“ müssen)

- **Instrumentierung** (Auto-Instrumentation + minimaler Wrapper) + **Export zu VisuDEV** (OTLP + Logs).
- **Dev:** Lokaler Agent (z. B. Docker) nimmt OTLP + Logs entgegen.
- **Prod:** Log-Drain/Agent (Vector/Fluent Bit) + OTLP Exporter → VisuDEV Backend.
- **CI/CD:** GitHub Action setzt Commit/Release/Env als Labels für „Deployments“ in der UI.

---

## 3. Optionen: Wie „Logs heute“ und „Logs pro Unit“ zusammenspielen

### Option A: Schema-Erweiterung in der bestehenden Edge Function

- **visudev-logs** bleibt die einzige Log-API.
- **Log-Schema erweitern:** z. B. optionale Felder `execution_unit_id`, `trace_id`, `request_id`, `service`, `version`.
- **Execution Units** werden separat gespeichert (z. B. neuer KV-Prefix oder Tabelle `execution_units`); sie kommen aus einem **Static Discovery** (Analyzer) und optional aus **Runtime** (wenn später Instrumentierung dazukommt).
- **Log-Tab UI:** Zuerst Liste/Filter nach **Execution Units**; Klick auf eine Unit → Logs gefiltert nach `execution_unit_id`. Bestehende Logs ohne Unit bleiben sichtbar (z. B. „Ohne Unit“ oder Projekt-Gesamt).

**Vorteil:** Eine Codebasis, eine Edge Function, klare Erweiterung.  
**Einschränkung:** Logs müssen von irgendwoher mit `execution_unit_id` angereichert werden (z. B. nur aus eigenem VisuDEV-Code oder manuell; echte User-App-Logs brauchen Instrumentierung).

### Option B: Neuer Collector/Agent („Logs-Runner“) für instrumentierte Logs

- **visudev-logs** bleibt für **manuelle/CRUD-Logs** und ggf. für VisuDEV-interne Logs (weiter wie heute).
- **Neuer Service:** Agent/Collector (kann als „Runner“ oder separater Service laufen) nimmt **OTLP + Log-Drains** von der **User-App** entgegen, normalisiert auf ein Schema mit `execution_unit_id`, schreibt in eine **gemeinsame Log-Speicherung** (oder eigene Tabelle/Stream).
- **Execution Units** kommen aus Static Discovery (Analyzer) + Runtime (Spans/Invocation-Namen); der Collector ordnet eingehende Logs/Traces den Units zu (z. B. über Span-Namen, Attribut `execution_unit_id` oder Mapping Route → Unit).
- **Log-Tab UI:** Einheitliche Ansicht: Projekt-Logs aus beiden Quellen; Filter nach Unit, Deployment, Zeit. Optional Tabs „Alle“ / „Pro Unit“.

**Vorteil:** Echte Logs aus der laufenden User-App, beliebige Stacks, Supabase-artiges Erlebnis.  
**Aufwand:** Betrieb eines Collectors, Instrumentierungs-Setup für User-Apps, CI-Labels für Deployments.

### Option C: Hybrid (empfohlen für schrittweise Einführung)

1. **Phase 1:** Option A umsetzen – Schema erweitern, Execution Units aus **Static Discovery** (Analyzer) ableiten, in der UI „Units“ anzeigen und Logs (sofern vorhanden) nach `execution_unit_id` filtern. Bestehende Logs ohne Unit weiterhin unter „Projekt“ sichtbar.
2. **Phase 2:** Optional Collector (Option B) einführen – Instrumentierung + OTLP/Log-Export der User-App; Collector schreibt angereicherte Logs in dasselbe Schema; Log-Tab zeigt dann auch echte Runtime-Logs pro Unit.

So bleibt die Edge Function die zentrale Log-API; der Collector ist eine **zusätzliche Quelle**, die das gleiche Log-Schema befüllt.

---

## 4. Kurz-Checkliste für die Umsetzung

| Bereich          | Inhalt                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Datenmodell**  | Log-Schema um `execution_unit_id`, `trace_id`, `request_id`, ggf. `service`/`version` erweitern. Execution-Unit-Entität (ID, kind, name, source, entrypoint, …) speichern. |
| **Discovery**    | Static: Analyzer erweitern (Routes, Resolver, Worker, Cron) → Units mit Source-Mapping. Optional: Runtime (Instrumentierung) → beobachtete Units.                          |
| **visudev-logs** | API erweitern: Logs mit optionalen Unit-Feldern anlegen/lesen; Abfrage nach `execution_unit_id` (Filter).                                                                  |
| **Log-Tab UI**   | Sidebar/Filter „Execution Units“; Klick auf Unit → Logs gefiltert; „Alle“ / „Ohne Unit“ beibehalten.                                                                       |
| **Optional**     | Collector/Agent für OTLP + Log-Drains; Zuordnung zu Units; CI-Labels für Deployments.                                                                                      |

---

## 5. Referenzen

- **Aktuell:** Edge Function `visudev-logs` (Supabase), Frontend `api.logs.getAll(projectId)`, `useLogs(projectId)`; Speicher KV-Prefix `logs:${projectId}:`.
- **Log-Typen:** `src/modules/logs/types.ts` (`LogEntry`, `LogCreateInput`).
- **Konzept Execution Units:** (siehe Nutzer-Input: HTTP/RPC/Job/Event/Cron/CLI, Static + Runtime Discovery, Logs + Traces mit Labels, Instrumentierung, UI „Logs pro Unit“).

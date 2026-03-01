# AGENTS.md (VisuDEV)

## Purpose

This repo enforces strict modular architecture and quality gates. Agents must follow these rules to keep code clean, secure, and consistent.

## Mandatory Workflow (Do NOT bypass)

- Always run checks before push/deploy.
- Preferred: `npm run checks`
- `npm run push` or `git push` run pre-push checks: fast checks + **AI review in commit mode** (only the latest commit; stable, no shifting diff). Full codebase review runs in Refactor-Modus.
- `supabase ...` uses the shim and runs checks automatically before invoking Supabase.
- Never call the real Supabase binary directly. Use the shim (`supabase`) or `npm run supabase:checked`. The package exposes `supabase` and `push` in `bin` (postinstall symlinks in `node_modules/.bin`).
- If any check fails, fix it before proceeding. Do not bypass the shim or hooks.
- **Zero warnings policy:** Lint and AI review must pass with **no warnings**. ESLint is run with `--max-warnings 0`; any warning fails the pipeline. Push/deploy is only allowed when all checks pass.
- **AI review (Codex):** Default is **commit mode** (only the last commit, HEAD~1..HEAD) — stable, no shifting diff. Pre-push and `run-checks.sh` use commit mode. **Full codebase** review (all chunks) runs in **Refactor-Modus** (`run-checks.sh --refactor`). Flow: Full-Scan → fix parts → commit → push (commit review in pipeline) → run full scan again; repeat until full scan ≥95%.
- **AI review pass criteria:** Strict architect checklist (SOLID, performance, security, robustness, maintainability). Only **score ≥ 95%** and **verdict ACCEPT** count as PASS. Deductions are listed per checklist point; fix and re-run until the review passes. No push with verdict REJECT or score &lt; 95%.
- **When AI review REJECTs — address broadly:** Do not fix only the single mentioned point. For each **affected file** from the deductions, do **one pass** over the full checklist (IDOR / auth, rate limiting, input validation, error handling, edge cases). Then commit and re-run. This avoids the loop where the next run flags another item in the same code. See `docs/AI_REVIEW_WHY_NEW_ERRORS_AFTER_FIXES.md` for rationale and a per-route checklist.
- **Agent after failed AI review (commit, diff, or full):** When the AI review fails (REJECT or score &lt; 95%), the agent must **automatically** read the latest review in `.shimwrapper/reviews/` (most recent file), address all deductions in the affected files (broad pass per file as above), then **re-run the full check pipeline** (including AI review in the same mode). Repeat until the review passes or the user instructs otherwise. This applies to CHECK_MODE=commit, diff, and full (chunked); in full mode, fix issues from all chunk sections before re-running.
- **Review-failed artifact:** When the pipeline exits with AI review REJECT, it writes **`.shimwrapper/review-failed.json`** (fields: `verdict`, `score`, `review_file`, `timestamp`) and prints a line starting with **`REVIEW_FAILED_AGENT_ACTION:`**. The agent must check for this file when the user asks to deploy, push, or fix the review: read `review-failed.json`, then the referenced file in `.shimwrapper/reviews/`, then run the fix loop (broad pass per affected file → commit → re-run pipeline). After a successful re-run (ACCEPT), the pipeline removes `review-failed.json`.
- **AI review timeout:** If the AI review aborts with "timed out", increase `TIMEOUT_SEC` in `scripts/ai-code-review.sh` (e.g. 420 → 600) and re-run until the review completes. Do not reduce scope or skip the review; raise the timeout until it passes.
- **Refactor-Modus (Full-Scan → To-do → Diff pro Fix → Full-Scan):**
  1. **Phase 1:** `bash scripts/run-checks.sh --refactor`. Full-Scan (alle Chunks). Bei Pass ≥95%: fertig, Hinweis zum Pushen.
  2. **Bei Fehlschlag:** Review wird geparst → To-do-Liste (`.shimwrapper/refactor-todo.json`). **Phase 2:** Pro To-do-Item schreibt das Skript `.shimwrapper/refactor-current-item.json` (id, chunk, point, reason, commit_message, instruction). Der **Agent** soll diese Datei nutzen (siehe nächster Bullet). Fix umsetzen, **ein Fix pro Commit** → Skript startet Diff-Check automatisch bei neuem Commit (`AI_REVIEW_DIFF_RANGE=HEAD~1..HEAD`). Bei ≥95%: Item erledigt, nächstes. Bei Fail: erneut fixen, commit, Retry.
  3. **Phase 3:** Alle Items erledigt → Full-Scan zur Verifikation. Bei Pass: Hinweis `git push`. Bei Fail: neue To-do aus Review, zurück zu Phase 2.
  4. **Pushen:** `git push`. Beim Push läuft die Pipeline mit AI-Review im **Commit-Modus** (nur letzter Commit). Danach erneut Full-Scan; nicht ≥95% → weiter fixen → Push → Schritt 4.
  5. **Resume:** Wenn `refactor-todo.json` mit offenen Items existiert, Phase 1 wird übersprungen und direkt Phase 2 fortgesetzt.
- **Agent und Refactor-Current-Item:** Wenn `.shimwrapper/refactor-current-item.json` existiert, hat das Refactor-Skript gerade ein To-do-Item aus Phase 2 angezeigt und wartet auf einen Commit. Der Agent soll **automatisch** (oder wenn der User z. B. „arbeit am aktuellen Refactor-Item“ sagt): (1) `refactor-current-item.json` lesen, (2) den Fix für dieses Item im Code umsetzen (id, chunk, point, reason beachten), (3) `git add -A` und `git commit -m "<commit_message>"` ausführen (commit_message aus der Datei). Danach erkennt das Refactor-Skript den Commit und startet den Diff-Check von selbst. So ist der Agent an den Refactor-Modus angebunden.
- **CHECK_MODE (AI review scope):** `commit` (default) = nur letzter Commit (HEAD~1..HEAD), stabil. Bei **mehreren lokalen Commits** wird nur der neueste geprüft. **Technische Durchsetzung:** Der Pre-Push-Hook (`.githooks/pre-push`) verweigert den Push, wenn mehr als ein Commit gegenüber Upstream existiert; dann squashen (z. B. `git rebase -i @{u}`) oder einzeln pushen. Gilt nur bei gesetztem Upstream (normales Push); erster Push (noch kein Upstream) wird nicht erzwungen. Beim Deploy (supabase-checked) bleibt die Prüfung nur auf den letzten Commit beschränkt. `diff` = nur wenn AI_REVIEW_DIFF_FILE oder AI_REVIEW_DIFF_RANGE gesetzt (feste Eingabe); staged/unstaged ist deaktiviert (verschiebt sich). `full` = pro Verzeichnis (src, supabase, scripts) ein Chunk. **Single-Chunk (nur bei full):** `--chunk=src` (oder supabase/scripts). Format, lint, typecheck, etc. laufen immer auf der ganzen Codebase.
- Reviews are saved to `.shimwrapper/reviews/` (gitignored). If the shim or push prints Token usage + review output, include it in your response.

## Repository Structure

### Frontend (Vite + React)

- Domain modules live in `src/modules/<domain>/...`.
- No cross-module imports. Export only via each module's `index.ts`.
- `src/components/` is for shared UI only (no business logic).
- `src/lib/` is for shared utilities, API client, and helpers.

Recommended module layout:

```
src/modules/<domain>/
  pages/
  components/
  hooks/
  services/
  styles/
  types/
  index.ts
```

### Backend (Supabase Edge Functions)

- Each function is isolated under `src/supabase/functions/<domain>/`.
- No cross-imports between functions.

Recommended function layout:

```
src/supabase/functions/<domain>/
  index.tsx            # HTTP routing only
  services/
  internal/
    repositories/
    middleware/
  validators/
  dto/
  types/
```

## Frontend Rules (Strict)

### TypeScript

- `strict: true`, `noImplicitAny: true`.
- No `any` in new code.
- Explicit return types for exported functions.
- File size <= 300 lines; component <= 150 lines; hook <= 50 lines.
- No `console.log` in production code.
- No `@ts-ignore` without a ticket/reference.

### Styling

- CSS Modules only (`.module.css/.module.scss`).
- No Tailwind classes in JSX. `@apply` only in CSS Modules, used sparingly.
- No inline styles (`style={{ ... }}` forbidden).
- No hardcoded colors outside `src/styles/globals.css`. Use CSS variables.

### Data Access

- API calls only in module services or `src/lib/api.ts`.
- No `fetch`/`axios` in UI components.
- Pages should be thin; move logic into hooks/services.
- Prefer `react-hook-form` + Zod for forms and validation.

### Accessibility

- Semantic HTML for interactive elements (no `<div>` as buttons).
- Keyboard navigation and `aria-label` for icon-only controls.

## Backend Rules (Supabase Edge Functions)

- Dependency Injection required (Supabase client, logger, config).
- No hardcoded secrets or URLs. Use env + validation (Zod).
- Validate all inputs with Zod.
- `index.tsx` should only handle routing/HTTP.
- Standard response format:
  - Success: `{ success: true, data, meta? }`
  - Error: `{ success: false, error: { code, message, details? } }`
- Avoid `console.*` in services; use injected logger.
- Logger is required (never optional).
- No Prisma/Next patterns in backend (Deno + Hono only).

## Naming Conventions

- Components: `PascalCase` (e.g., `UserCard.tsx`)
- Hooks: `useX` (e.g., `useAuth.ts`)
- Services: `camelCase` (e.g., `authService.ts`)
- DTOs/Types: `PascalCase` (e.g., `UserDto`)
- CSS Modules: `kebab-case.module.scss`

## Security

- Never expose secrets in responses or logs.
- Validate and sanitize all inputs.
- Do not store tokens in localStorage.

## Lockfiles and dependency manifests

- **Do not delete lockfiles** (e.g. `deno.lock`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`) or similar dependency/version pins to “fix” a build or deploy error. Removing them is dangerous: builds become non-reproducible and dependency versions can drift, introducing subtle bugs and security risks.
- **Always find an alternative solution** that is robust and secure in the long term (e.g. regenerate the lockfile with a compatible tool version, upgrade the build/deploy environment, or document the required version and a safe regeneration step). If a tool reports an “unsupported lockfile version”, resolve it by regenerating the lockfile with a compatible version of the tool, not by deleting it.

## Testing

- Frontend: Vitest (`npm run test:run`).
- Backend: Deno tests when introduced (`deno test`).

## Quality Gates (what `npm run checks` does)

- Frontend: format check, lint, typecheck, tests, project rules, build (build always).
- Backend (only when backend files change): `deno fmt --check`, `deno lint`.
- Shim/push add-ons: AI review (Codex), `npm audit` (frontend), `deno audit` (backend), optional Snyk (`SKIP_SNYK=1` to skip).

## Required Setup (damit alles funktioniert)

1. **Git Hooks (einmalig):** `npm run hooks:setup` — setzt `core.hooksPath=.githooks`, damit bei `git push` der Pre-Push-Hook (Checks + AI-Review) läuft.
2. **Supabase-Shim:** `~/.local/bin` zuerst in der `PATH`, damit `supabase` das Projekt-Shim (checks vor Supabase-Befehlen) nutzt.
3. **AI-Review (Codex):** Codex CLI installieren und `codex login` — sonst wird die AI-Review übersprungen (Push kann dann trotzdem durchgehen, wenn der Hook sie nicht erzwingt). **jq** wird für Refactor-Modus (To-do-Extraktion und Item-Updates) sowie für vollständige Bewertung benötigt.
4. **Runner (optional):** Für AppFlow/Preview: `npx visudev-runner` starten (oder im Repo `npm run dev`, dann startet der Runner mit). Keine weiteren Code-Änderungen nötig.
5. **Push mit Checks:** `npm run push` oder `git push` — beides läuft über Checks; bei Push ist AI-Review Pflicht (kein Skip). Bei Problemen: `npm run checks` einzeln ausführen und Fehler beheben.

## Notes

- Backend stack is Deno/Hono + Supabase (NOT Prisma/Next). Translate generic DDD rules accordingly.

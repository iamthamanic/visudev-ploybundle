#!/usr/bin/env bash
# Shared checks for pre-push (GitHub) and supabase-checked (Supabase deploy).
# Verantwortlichkeiten: Frontend/Backend-Checks, AI-Review-Ansteuerung, Refactor-Loop (siehe docs/AI_REVIEW_ACCEPTED_TRADEOFFS.md § Scripts).
# Usage: run-checks.sh [--frontend] [--backend] [--no-ai-review] [--ai-review] [--chunk=src|supabase|scripts] [--until-95] [--refactor]
#   With no args: run frontend and backend checks (same as --frontend --backend).
#   AI review runs by default unless SKIP_AI_REVIEW=1 (pre-push sets this so push does not time out).
#   --chunk: bei full-Codebase-Review nur diesen Chunk prüfen. Setzt CHECK_MODE=full.
#   --until-95: Full-Modus mit Loop — alle Chunks bis ≥95%. Nach Fehlschlag: Fix, commit, Enter zum Retry. Kein --chunk.
#   --refactor: Refactor-Modus (wie --until-95). Alle Probleme identifizieren → fixen → committen → Loop bis alle Chunks ≥95%.
#               Bei Erfolg: Hinweis „git push“, danach erneut alle Checks laufen lassen; schlagen sie fehl, Spiel von vorne (fix, commit, push, checks).
# Pre-push runs only fast checks (no AI review). Use refactor mode to reach 95%, then push; run full checks again after push.
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
REVIEWS_DIR="$ROOT_DIR/.shimwrapper/reviews"

run_frontend=false
run_backend=false
run_ai_review=true
ai_review_chunk=""
until_95=false
refactor_mode=false

if [[ $# -eq 0 ]]; then
  run_frontend=true
  run_backend=true
else
  for arg in "$@"; do
    case "$arg" in
      --frontend) run_frontend=true ;;
      --backend) run_backend=true ;;
      --ai-review) run_ai_review=true ;;
      --no-ai-review) run_ai_review=false ;;
      --until-95) until_95=true ;;
      --refactor) until_95=true; refactor_mode=true ;;
      --chunk=*)
        ai_review_chunk="${arg#--chunk=}"
        if [[ "$ai_review_chunk" != "src" && "$ai_review_chunk" != "supabase" && "$ai_review_chunk" != "scripts" ]]; then
          echo "Invalid --chunk=$ai_review_chunk. Use src, supabase, or scripts." >&2
          exit 1
        fi
        run_ai_review=true
        ;;
      *)
        echo "Unknown option: $arg. Use --frontend, --backend, --no-ai-review, --ai-review, --chunk=..., --until-95, or --refactor." >&2
        exit 1
        ;;
    esac
  done
fi

# --until-95: einfacher Loop (Full-Scan → Fix → Commit → Retry)
# --refactor: Full-Scan → To-do-Liste → Item-Loop (Diff-Check pro Fix) → Full-Scan
if [[ "$until_95" = true ]]; then
  if [[ -n "$ai_review_chunk" ]]; then
    echo "Invalid: --until-95/--refactor and --chunk cannot be used together. Use full codebase (all chunks)." >&2
    exit 1
  fi
  export CHECK_MODE=full
  export GIT_CMD="${GIT_CMD:-/usr/bin/git}"
  mkdir -p "$REVIEWS_DIR"
  TODO_FILE="$ROOT_DIR/.shimwrapper/refactor-todo.json"

  if [[ "$refactor_mode" = true ]]; then
    REFACTOR_STATUS="$ROOT_DIR/.shimwrapper/refactor-status.txt"
    REFACTOR_CURRENT_ITEM="$ROOT_DIR/.shimwrapper/refactor-current-item.json"
    refactor_notify() {
      local msg="$1"
      local ts
      ts="$(date '+%Y-%m-%d %H:%M:%S')"
      echo "[$ts] $msg" >> "$REFACTOR_STATUS"
      echo "[$ts] $msg" >&2
      if [[ "$(uname -s)" = Darwin ]] && command -v osascript >/dev/null 2>&1; then
        osascript -e "display notification \"$msg\" with title \"Refactor-Modus\"" 2>/dev/null || true
      fi
    }
    refactor_auto_commit_and_push() {
      local item_id="$1"
      local chunk="$2"
      local point="$3"
      local minus="$4"
      local branch
      branch="$("${GIT_CMD:-git}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

      # Nur committen, wenn es tatsächliche Änderungen gibt
      if ! "${GIT_CMD:-git}" diff --quiet 2>/dev/null || ! "${GIT_CMD:-git}" diff --cached --quiet 2>/dev/null; then
        refactor_notify "Auto-Commit für Item $item_id wird vorbereitet..."
        if ! "${GIT_CMD:-git}" add -A; then
          refactor_notify "Auto-Commit fehlgeschlagen: git add -A"
          return 1
        fi
        local msg="refactor: ${item_id} [${chunk}] ${point} (-${minus}%)"
        if ! "${GIT_CMD:-git}" commit -m "$msg"; then
          refactor_notify "Auto-Commit fehlgeschlagen: git commit"
          return 1
        fi
        refactor_notify "Auto-Commit erstellt: $msg"

        if [[ -n "$branch" ]]; then
          if ! "${GIT_CMD:-git}" push origin "$branch"; then
            refactor_notify "Auto-Push fehlgeschlagen (Branch ${branch}). Bitte manuell prüfen."
            return 1
          fi
          refactor_notify "Auto-Push auf origin/${branch} abgeschlossen."
        else
          refactor_notify "Auto-Push übersprungen: aktueller Branch konnte nicht ermittelt werden."
        fi
      else
        refactor_notify "Keine Änderungen zum Commit für Item ${item_id} – Auto-Commit übersprungen."
      fi
    }
    refactor_status_line() {
      local done_count="${1:-0}"
      local total="${2:-?}"
      local open="?"
      if [[ "$total" =~ ^[0-9]+$ ]] && [[ "$done_count" =~ ^[0-9]+$ ]]; then
        open=$((total - done_count))
      fi
      if [[ -f "$REFACTOR_STATUS" ]]; then
        local rest
        rest=$(tail -n +2 "$REFACTOR_STATUS" 2>/dev/null)
        {
          echo "Status: ${done_count}/${total} erledigt — ${open} offen"
          echo "$rest"
        } > "$REFACTOR_STATUS.tmp"
        mv "$REFACTOR_STATUS.tmp" "$REFACTOR_STATUS"
      else
        {
          echo "Status: ${done_count}/${total} erledigt — ${open} offen"
          echo ""
        } > "$REFACTOR_STATUS"
      fi
    }
    echo "Status: 0/0 erledigt — 0 offen" > "$REFACTOR_STATUS"
    echo "" >> "$REFACTOR_STATUS"
    refactor_notify "Refactor-Modus gestartet"

    # Refactor-Modus: 3-Phasen-Flow
    echo "========== Refactor-Modus: Full-Scan → To-do-Liste → gezielter Diff-Check pro Fix → Full-Scan ==========" >&2
    echo "Ein Fix pro Commit während des Item-Loops." >&2
    echo "Status-Updates: $REFACTOR_STATUS  (tail -f zum Mitverfolgen)" >&2
    echo "" >&2

    # Phase 1: Full-Scan und ggf. To-do-Erzeugung
    # Resume: wenn refactor-todo.json existiert mit offenen Items, Phase 1 überspringen
    DO_PHASE1=true
    if [[ -f "$TODO_FILE" ]] && command -v jq >/dev/null 2>&1; then
      OPEN_COUNT="$(jq '[.items[]? | select(.done != true)] | length' "$TODO_FILE" 2>/dev/null || echo "1")"
      if [[ "${OPEN_COUNT:-1}" -gt 0 ]]; then
        refactor_notify "Resume: $OPEN_COUNT offene To-dos — Phase 1 übersprungen, starte Item-Loop"
        echo "Resume: offene To-dos gefunden, Phase 1 übersprungen." >&2
        DO_PHASE1=false
      fi
    fi

    refactor_success_msg() {
      echo "" >&2
      echo "==========================================" >&2
      echo "✅ REFACTOR-TODO ABGEARBEITET" >&2
      echo "==========================================" >&2
      echo "Alle To-do-Items behoben, Full-Scan bestanden (≥95%)." >&2
      echo "" >&2
      echo "Nächster Schritt:  git push" >&2
      echo "Danach:  npm run checks  oder  run-checks.sh --refactor" >&2
      echo "==========================================" >&2
      echo "" >&2
    }
    if [[ "$DO_PHASE1" = true ]]; then
      refactor_notify "Phase 1: Full-Scan läuft..."
      if bash "$ROOT_DIR/scripts/run-checks.sh" 2>&1; then
        rm -f "$REFACTOR_CURRENT_ITEM"
        refactor_notify "✅ Alles erledigt (Full-Scan bestanden). Nächster Schritt: git push"
        refactor_success_msg
        exit 0
      fi
      LATEST_REVIEW="$(ls -t "$REVIEWS_DIR"/review-*.md 2>/dev/null | head -1)"
      if [[ -z "$LATEST_REVIEW" || ! -f "$LATEST_REVIEW" ]]; then
        echo "Check failed but no review file found. Fix format/lint/typecheck/build errors, then retry." >&2
        exit 1
      fi
      bash "$ROOT_DIR/scripts/extract-refactor-todo.sh" "$LATEST_REVIEW" 2>&1 || exit 1
      ITEM_COUNT="$(jq '.items | length' "$TODO_FILE" 2>/dev/null || echo "?")"
      refactor_notify "Phase 1 fehlgeschlagen. To-do-Liste erstellt: $ITEM_COUNT Items"
      echo "" >&2
      echo "To-do-Liste (Chunk, Point, Reason):" >&2
      jq -r '.items[]? | select(.done != true) | "  [\(.chunk)] \(.point) (-\(.minus)%): \(.reason | split("\n")[0] | .[0:80])..."' "$TODO_FILE" 2>/dev/null || true
      echo "" >&2
    fi

    # Phase 2 + 3: Item-Loop, dann Verifikation; bei Fail neue To-do, erneut Phase 2
    while true; do
    # Phase 2: Item-Loop
    while true; do
      NEXT_ITEM="$(jq -r '[.items[]? | select(.done != true)] | .[0] | select(. != null) | .id' "$TODO_FILE" 2>/dev/null)"
      if [[ -z "$NEXT_ITEM" ]]; then
        rm -f "$REFACTOR_CURRENT_ITEM"
        break
      fi
      ITEM_JSON="$(jq -r '[.items[]? | select(.id == "'"$NEXT_ITEM"'")] | .[0]' "$TODO_FILE" 2>/dev/null)"
      TOTAL_ITEMS="$(jq '.items | length' "$TODO_FILE" 2>/dev/null)"
      TOTAL="$(jq '[.items[]? | select(.done != true)] | length' "$TODO_FILE" 2>/dev/null)"
      DONE_COUNT="$(jq '[.items[]? | select(.done == true)] | length' "$TODO_FILE" 2>/dev/null)"
      CURR="$((DONE_COUNT + 1))"
      CHUNK="$(echo "$ITEM_JSON" | jq -r '.chunk')"
      POINT="$(echo "$ITEM_JSON" | jq -r '.point')"
      MINUS="$(echo "$ITEM_JSON" | jq -r '.minus')"
      REASON="$(echo "$ITEM_JSON" | jq -r '.reason' | head -3)"
      refactor_status_line "$DONE_COUNT" "$TOTAL_ITEMS"
      refactor_notify "Item $CURR von $TOTAL: [$CHUNK] $POINT (-$MINUS%) — Agent macht Fix + Commit, dann automatischer Diff-Check"
      refactor_notify "Item fix run (Item $CURR)"
      COMMIT_MSG_REFACTOR="refactor: ${NEXT_ITEM} [${CHUNK}] ${POINT} (-${MINUS}%)"
      echo "$ITEM_JSON" | jq -c --arg cm "$COMMIT_MSG_REFACTOR" '. + {commit_message: $cm, instruction: "Implement the fix described in reason. Then run: git add -A && git commit -m <commit_message> (use the commit_message field). The refactor script will detect the commit and run the diff check automatically."}' > "$REFACTOR_CURRENT_ITEM" 2>/dev/null || true
      echo "" >&2
      echo "========== Item $CURR von $TOTAL: [$CHUNK] $POINT (-$MINUS%) ==========" >&2
      echo "$REASON" >&2
      echo "" >&2
      echo "Agent/User macht Fix und Commit. Skript startet Diff-Check automatisch bei neuem Commit (kein Enter nötig)." >&2
      INITIAL_HEAD="$("${GIT_CMD:-git}" rev-parse HEAD 2>/dev/null || echo "")"
      LAST_NOTIFIED_COMMIT="$INITIAL_HEAD"
      LAST_HEARTBEAT_TS="$(date +%s 2>/dev/null || echo "")"
      while true; do
        sleep 15
        CURR_HEAD="$("${GIT_CMD:-git}" rev-parse HEAD 2>/dev/null || echo "")"
        if [[ -n "$CURR_HEAD" && "$CURR_HEAD" != "$INITIAL_HEAD" ]]; then
          if [[ "$CURR_HEAD" != "$LAST_NOTIFIED_COMMIT" ]]; then
            LAST_NOTIFIED_COMMIT="$CURR_HEAD"
            COMMIT_MSG="$("${GIT_CMD:-git}" log -1 --pretty=format:"%h %s" 2>/dev/null || echo "commit")"
            refactor_notify "Item fix run (Item $CURR) – Teilfortschritt: $COMMIT_MSG"
          fi
          refactor_notify "Neuer Commit erkannt – starte Diff-Check in 15 s (weitere Commits möglich)."
          sleep 15
          break
        fi
        if [[ "$LAST_NOTIFIED_COMMIT" = "$INITIAL_HEAD" ]]; then
          STAGED="$("${GIT_CMD:-git}" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
          MODIFIED="$("${GIT_CMD:-git}" status -s 2>/dev/null | wc -l | tr -d ' ')"
          if [[ "${STAGED:-0}" -gt 0 ]] || [[ "${MODIFIED:-0}" -gt 0 ]]; then
            refactor_notify "Item fix run (Item $CURR) – Teilfortschritt: Änderungen in Arbeit"
            LAST_NOTIFIED_COMMIT="__in_progress__"
          fi
        fi
        NOW_TS="$(date +%s 2>/dev/null || echo "")"
        if [[ -n "$LAST_HEARTBEAT_TS" ]] && [[ -n "$NOW_TS" ]] && [[ $((NOW_TS - LAST_HEARTBEAT_TS)) -ge 60 ]] && { [[ "$LAST_NOTIFIED_COMMIT" = "$INITIAL_HEAD" ]] || [[ "$LAST_NOTIFIED_COMMIT" = "__in_progress__" ]]; }; then
          refactor_notify "Item fix run (Item $CURR) – Prozess läuft noch (warte auf Commit vom Agent)..."
          LAST_HEARTBEAT_TS="$NOW_TS"
        fi
      done
      refactor_notify "Item fix done (Item $CURR)"
      export CHECK_MODE=diff
      export AI_REVIEW_DIFF_RANGE="HEAD~1..HEAD"
      export GIT_CMD="${GIT_CMD:-/usr/bin/git}"
      ITEM_DONE=false
      while [[ "$ITEM_DONE" != true ]]; do
        refactor_notify "Item analyze run (Item $CURR)"
        REFACTOR_REPORT_FILE="$(mktemp)"
        export REFACTOR_REPORT_FILE
        if bash "$ROOT_DIR/scripts/run-checks.sh" 2>&1; then
          SUCCESS=1
        else
          SUCCESS=0
        fi
        CHECKS_LINE=""
        REVIEW_NAME="?"
        REVIEW_SCORE="?"
        REVIEW_RESULT="nicht bestanden"
        if [[ -f "${REFACTOR_REPORT_FILE:-}" ]]; then
          while IFS= read -r line; do
            case "$line" in
              *:pass) CHECKS_LINE="${CHECKS_LINE}${line%%:pass} ✓, " ;;
              *:fail) CHECKS_LINE="${CHECKS_LINE}${line%%:fail} ✗, " ;;
              AI_REVIEW_FILE:*) REVIEW_NAME="${line#AI_REVIEW_FILE:}" ;;
              AI_REVIEW_SCORE:*) REVIEW_SCORE="${line#AI_REVIEW_SCORE:}" ;;
              AI_REVIEW_VERDICT:ACCEPT) REVIEW_RESULT="bestanden" ;;
            esac
          done < "$REFACTOR_REPORT_FILE" 2>/dev/null || true
          rm -f "$REFACTOR_REPORT_FILE"
        fi
        unset REFACTOR_REPORT_FILE
        refactor_notify "Item analyze done (Item $CURR)"
        refactor_notify "  Checks: $CHECKS_LINE"
        refactor_notify "  AI Review: $REVIEW_NAME"
        refactor_notify "  Score: $REVIEW_SCORE%"
        refactor_notify "  Ergebnis: $REVIEW_RESULT"
        if [[ "$SUCCESS" -eq 1 ]]; then
          if ! refactor_auto_commit_and_push "$NEXT_ITEM" "$CHUNK" "$POINT" "$MINUS"; then
            refactor_notify "Auto-Push fehlgeschlagen. Bitte beheben (z. B. manuell git push). Skript wartet auf erfolgreichen Push."
            echo "" >&2
            echo "Auto-Push fehlgeschlagen. Bitte beheben (z. B. manuell: git push origin main). Skript wartet, bis Push erfolgreich war." >&2
            BRANCH="$("${GIT_CMD:-git}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "main")"
            while true; do
              sleep 30
              AHEAD="$("${GIT_CMD:-git}" rev-list "origin/${BRANCH}..HEAD" 2>/dev/null | wc -l | tr -d ' ')"
              if [[ "${AHEAD:-1}" -eq 0 ]]; then
                refactor_notify "Push erfolgreich erkannt – markiere Item $CURR erledigt."
                break
              fi
              refactor_notify "Item $CURR – warte auf erfolgreichen Push (noch ${AHEAD} Commit(s) vor origin/${BRANCH})..."
            done
          fi
          jq --arg id "$NEXT_ITEM" '.items |= map(if .id == $id then . + {done: true} else . end)' "$TODO_FILE" > "$TODO_FILE.tmp" && mv "$TODO_FILE.tmp" "$TODO_FILE"
          refactor_status_line "$((DONE_COUNT + 1))" "$TOTAL_ITEMS"
          refactor_notify "Item $CURR von $TOTAL erledigt: [$CHUNK] $POINT"
          echo "" >&2
          echo "Item \"$NEXT_ITEM\" erledigt." >&2
          ITEM_DONE=true
        else
          echo "" >&2
          echo "Diff-Review fehlgeschlagen. Agent macht erneut Fix + Commit – Skript startet Check automatisch bei neuem Commit." >&2
          INITIAL_HEAD="$("${GIT_CMD:-git}" rev-parse HEAD 2>/dev/null || echo "")"
          LAST_NOTIFIED_COMMIT="$INITIAL_HEAD"
          LAST_HEARTBEAT_TS="$(date +%s 2>/dev/null || echo "")"
          while true; do
            sleep 15
            CURR_HEAD="$("${GIT_CMD:-git}" rev-parse HEAD 2>/dev/null || echo "")"
            if [[ -n "$CURR_HEAD" && "$CURR_HEAD" != "$INITIAL_HEAD" ]]; then
              if [[ "$CURR_HEAD" != "$LAST_NOTIFIED_COMMIT" ]]; then
                LAST_NOTIFIED_COMMIT="$CURR_HEAD"
                COMMIT_MSG="$("${GIT_CMD:-git}" log -1 --pretty=format:"%h %s" 2>/dev/null || echo "commit")"
                refactor_notify "Item fix run (Item $CURR) – Teilfortschritt: $COMMIT_MSG"
              fi
              refactor_notify "Neuer Commit erkannt (Retry) – starte Diff-Check in 15 s."
              sleep 15
              break
            fi
            if [[ "$LAST_NOTIFIED_COMMIT" = "$INITIAL_HEAD" ]]; then
              STAGED="$("${GIT_CMD:-git}" diff --cached --name-only 2>/dev/null | wc -l | tr -d ' ')"
              MODIFIED="$("${GIT_CMD:-git}" status -s 2>/dev/null | wc -l | tr -d ' ')"
              if [[ "${STAGED:-0}" -gt 0 ]] || [[ "${MODIFIED:-0}" -gt 0 ]]; then
                refactor_notify "Item fix run (Item $CURR) – Teilfortschritt: Änderungen in Arbeit"
                LAST_NOTIFIED_COMMIT="__in_progress__"
              fi
            fi
            NOW_TS="$(date +%s 2>/dev/null || echo "")"
            if [[ -n "$LAST_HEARTBEAT_TS" ]] && [[ -n "$NOW_TS" ]] && [[ $((NOW_TS - LAST_HEARTBEAT_TS)) -ge 60 ]] && { [[ "$LAST_NOTIFIED_COMMIT" = "$INITIAL_HEAD" ]] || [[ "$LAST_NOTIFIED_COMMIT" = "__in_progress__" ]]; }; then
              refactor_notify "Item fix run (Item $CURR) – Prozess läuft noch (Retry, warte auf Commit vom Agent)..."
              LAST_HEARTBEAT_TS="$NOW_TS"
            fi
          done
        fi
      done
    done

    # Phase 3: Verifikation per Full-Scan
    rm -f "$REFACTOR_CURRENT_ITEM"
    echo "" >&2
    DONE_TOTAL="$(jq '.items | length' "$TODO_FILE" 2>/dev/null || echo "?")"
    refactor_notify "Alle $DONE_TOTAL Items erledigt. Phase 3: Full-Scan Verifikation läuft..."
    echo "========== Alle $DONE_TOTAL To-do-Items erledigt — Phase 3: Verifikation (Full-Scan) ==========" >&2
    export CHECK_MODE=full
    unset AI_REVIEW_DIFF_RANGE
    if bash "$ROOT_DIR/scripts/run-checks.sh" 2>&1; then
      rm -f "$REFACTOR_CURRENT_ITEM"
      refactor_notify "✅ REFACTOR-TODO ABGEARBEITET — Full-Scan bestanden. Nächster Schritt: git push"
      refactor_success_msg
      exit 0
    fi
    refactor_notify "Full-Scan fehlgeschlagen (< 95%). Analyse erforderlich."
    LATEST_REVIEW="$(ls -t "$REVIEWS_DIR"/review-*.md 2>/dev/null | head -1)"
    if [[ -n "$LATEST_REVIEW" && -f "$LATEST_REVIEW" ]]; then
      refactor_notify "Full-Scan fehlgeschlagen. Erzeuge neue To-do-Liste, weiter mit Phase 2."
      echo "" >&2
      echo "Full-Scan fehlgeschlagen. Erzeuge neue To-do-Liste aus Review." >&2
      bash "$ROOT_DIR/scripts/extract-refactor-todo.sh" "$LATEST_REVIEW" 2>&1 || true
      # Loop zurück zu Phase 2
    else
      echo "" >&2
      echo "Full-Scan fehlgeschlagen. Review-Datei: $REVIEWS_DIR" >&2
      exit 1
    fi
    done
  else
    # --until-95 ohne --refactor: einfacher Loop
    while true; do
      if bash "$ROOT_DIR/scripts/run-checks.sh" 2>&1; then
        echo "" >&2
        echo "All checks and AI review passed (all chunks ≥95%)." >&2
        exit 0
      fi
      LATEST_REVIEW="$(ls -t "$REVIEWS_DIR"/review-*.md 2>/dev/null | head -1)"
      echo "" >&2
      echo "========== Check failed ==========" >&2
      if [[ -n "$LATEST_REVIEW" && -f "$LATEST_REVIEW" ]]; then
        echo "Chunk scores:" >&2
        grep -E "^## Chunk:|Score:|Verdict:" "$LATEST_REVIEW" | head -20 >&2
        echo "" >&2
        echo "Review details: $LATEST_REVIEW" >&2
      else
        echo "No review file found. Check output above for format/lint/typecheck/build/deno errors." >&2
      fi
      echo "" >&2
      echo "Fix the issues (commit changes if needed). Then press Enter to retry or Ctrl+C to abort." >&2
      read -r || { echo ""; exit 130; }
    done
  fi
fi

# Opt-out via env: SKIP_AI_REVIEW=1 disables AI review
[[ -n "${SKIP_AI_REVIEW:-}" ]] && run_ai_review=false

# Bei nur --chunk=X: trotzdem Frontend+Backend laufen lassen, damit AI-Review (ein Chunk) ausgeführt wird
[[ -n "$ai_review_chunk" ]] && [[ "$run_frontend" = false ]] && [[ "$run_backend" = false ]] && run_frontend=true && run_backend=true

# Required checks that failed (hook will exit 1 at end). Optional checks (Snyk, AI review) are not added here.
REQUIRED_FAILED=()

run_required() {
  local name="$1"
  shift
  if "$@" 2>&1; then
    [[ -n "${REFACTOR_REPORT_FILE:-}" ]] && [[ -f "${REFACTOR_REPORT_FILE:-}" ]] && echo "${name}:pass" >> "$REFACTOR_REPORT_FILE"
    return 0
  else
    [[ -n "${REFACTOR_REPORT_FILE:-}" ]] && [[ -f "${REFACTOR_REPORT_FILE:-}" ]] && echo "${name}:fail" >> "$REFACTOR_REPORT_FILE"
    REQUIRED_FAILED+=("$name")
    echo "[FAILED] $name (weiter mit nächstem Check)" >&2
    return 1
  fi
}

run_optional() {
  local name="$1"
  shift
  if "$@" 2>&1; then
    [[ -n "${REFACTOR_REPORT_FILE:-}" ]] && [[ -f "${REFACTOR_REPORT_FILE:-}" ]] && echo "${name}:pass" >> "$REFACTOR_REPORT_FILE"
    return 0
  else
    [[ -n "${REFACTOR_REPORT_FILE:-}" ]] && [[ -f "${REFACTOR_REPORT_FILE:-}" ]] && echo "${name}:fail" >> "$REFACTOR_REPORT_FILE"
    echo "[SKIPPED] $name fehlgeschlagen – weitere Checks laufen weiter." >&2
    return 1
  fi
}

if [[ "$run_frontend" = true ]]; then
  echo "Running frontend checks..."
  run_required "format:check" npm run format:check
  run_required "lint" npm run lint
  run_required "typecheck" npm run typecheck
  run_required "test:run" npm run test:run
  run_required "rules:check" npm run rules:check
  echo "Running frontend security (npm audit)..."
  run_required "npm audit" npm audit --audit-level=high

  if [[ -z "${SKIP_SNYK:-}" ]]; then
    if command -v snyk >/dev/null 2>&1; then
      echo "Running Snyk (dependency scan)..."
      run_optional "Snyk" snyk test
    elif npm exec --yes snyk -- --version >/dev/null 2>&1; then
      echo "Running Snyk (dependency scan)..."
      run_optional "Snyk" npx snyk test
    else
      echo "Skipping Snyk: not installed (optional; set SKIP_SNYK=1 to suppress)." >&2
    fi
  fi
fi

echo "Running frontend build (always)..."
run_required "build" npm run build

if [[ "$run_backend" = true ]]; then
  echo "Running Supabase edge function checks..."
  backend_dirs=()
  if [[ -d "src/supabase/functions" ]]; then
    backend_dirs+=("src/supabase/functions")
  fi
  if [[ -d "supabase/functions" ]]; then
    backend_dirs+=("supabase/functions")
  fi
  if [[ ${#backend_dirs[@]} -eq 0 ]]; then
    echo "Skipping backend checks: no functions directory found."
  else
    run_required "deno fmt" deno fmt --check "${backend_dirs[@]}"
    run_required "deno lint" deno lint "${backend_dirs[@]}"
    echo "Running backend security (deno audit)..."
    if [[ -d "src/supabase/functions/server" ]]; then
      run_required "deno audit" bash -c 'cd src/supabase/functions/server && deno audit'
    elif [[ -d "supabase/functions/server" ]]; then
      run_required "deno audit" bash -c 'cd supabase/functions/server && deno audit'
    else
      echo "Skipping deno audit: server function not found."
    fi
  fi
fi

if [[ "$run_ai_review" = true ]] && { [[ "$run_frontend" = true ]] || [[ "$run_backend" = true ]]; }; then
  echo "Running AI code review..."
  # Pre-push sets CHECK_MODE=diff (review only pushed changes); else default commit (only last commit — stable, fast). Full is for --until-95/--refactor only.
  export CHECK_MODE="${CHECK_MODE:-commit}"
  [[ -n "$ai_review_chunk" ]] && export AI_REVIEW_CHUNK="$ai_review_chunk"
  run_required "AI review" bash "$ROOT_DIR/scripts/ai-code-review.sh"
fi

if [[ ${#REQUIRED_FAILED[@]} -gt 0 ]]; then
  echo "" >&2
  echo "Erforderliche Checks fehlgeschlagen: ${REQUIRED_FAILED[*]}" >&2
  exit 1
fi
echo "All checks passed."
exit 0
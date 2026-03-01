#!/usr/bin/env bash
# AI code review: Codex only (Cursor disabled). Called from run-checks.sh.
# Verantwortlichkeiten: Diff-Ermittlung, Prompting, Parsing, Persistenz (siehe docs/AI_REVIEW_ACCEPTED_TRADEOFFS.md § Scripts).
# Prompt: senior-dev, decades-of-expertise, best-code bar.
# Codex: codex in PATH; use session after codex login (ChatGPT account, no API key in terminal).
#
# CHECK_MODE steuert, welches Diff die AI bekommt:
#   CHECK_MODE=commit (Default bei Checks): Nur der letzte Commit (HEAD~1..HEAD). Stabil, kein
#                    Verschieben des Diffs; gleicher Commit = gleiche Bewertung.
#   CHECK_MODE=diff: Nur wenn AI_REVIEW_DIFF_FILE oder AI_REVIEW_DIFF_RANGE gesetzt (feste Eingabe).
#                    Staged/unstaged ist abgeschaltet, da der Diff sich zwischen Läufen verschiebt.
#   CHECK_MODE=full: Gesamte Codebase — pro Verzeichnis (src, supabase, scripts) ein eigener
#                    Review; die AI sieht jedes Chunk vollständig (bis CHUNK_LIMIT_BYTES), kein
#                    willkürliches Kopf/Schwanz-Kürzen. Ehrliches Feedback pro Bereich.
# AI_REVIEW_CHUNK (nur bei CHECK_MODE=full): Nur diesen Chunk prüfen (src|supabase|scripts).
#                    Schnellere Iteration auf 95% ohne alle drei Chunks pro Lauf. Siehe docs/AI_REVIEW_95_PERCENT_PLAN.md.
# Alle anderen Checks (format, lint, typecheck, …) laufen immer auf der ganzen Codebase.
#
# Timeout: bei full pro Chunk TIMEOUT_SEC; bei diff einmal TIMEOUT_SEC.
# On REJECT: address all checklist items (see AGENTS.md / docs/AI_REVIEW_WHY_NEW_ERRORS_AFTER_FIXES.md).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Use real git for diffs (PATH may point to a shim that doesn't support diff)
if [[ -x /usr/bin/git ]]; then
  GIT_CMD="/usr/bin/git"
elif command -v git >/dev/null 2>&1; then
  GIT_CMD="git"
else
  GIT_CMD="/usr/bin/git"
fi

# CHECK_MODE: "commit" = nur letzter Commit (Default bei run-checks); "full" = ganze Codebase; "diff" = Änderungen (staged/unstaged/range)
CHECK_MODE="${CHECK_MODE:-full}"
# AI_REVIEW_CHUNK: bei CHECK_MODE=full nur diesen Chunk prüfen (src | supabase | scripts). Schnellere Iteration auf 95%.
AI_REVIEW_CHUNK="${AI_REVIEW_CHUNK:-}"

# Redact long token-like strings before writing review to disk (Data Leakage prevention)
redact_review_text() {
  local t="$1"
  [[ -z "$t" ]] && return
  if command -v sed >/dev/null 2>&1; then
    echo "$t" | sed -E 's/[A-Za-z0-9+/=]{48,}/***REDACTED***/g'
  else
    echo "$t"
  fi
}

DIFF_FILE=""
cleanup() {
  [[ -n "$DIFF_FILE" ]] && [[ -f "$DIFF_FILE" ]] && rm -f "$DIFF_FILE"
}
trap cleanup EXIT

DIFF_FILE="$(mktemp)"
USE_CHUNKED=0
EMPTY_TREE="4b825dc642cb6eb9a060e54bf8d69288fbee4904"

if [[ "$CHECK_MODE" == "full" ]]; then
  # --- Full-Codebase: pro Verzeichnis ein Review (git diff EMPTY_TREE..HEAD = nur committed Code). ---
  # Wichtig: Uncommitted Änderungen werden NICHT geprüft. Erst committen, dann Review laufen lassen.
  CHUNK_DIRS=()
  for d in src supabase scripts; do
    [[ -d "$d" ]] && CHUNK_DIRS+=("$d")
  done
  # Einzel-Chunk-Modus: nur einen Bereich prüfen (z. B. AI_REVIEW_CHUNK=src für schnelle Iteration)
  if [[ -n "$AI_REVIEW_CHUNK" ]]; then
    if [[ "$AI_REVIEW_CHUNK" != "src" && "$AI_REVIEW_CHUNK" != "supabase" && "$AI_REVIEW_CHUNK" != "scripts" ]]; then
      echo "AI review: AI_REVIEW_CHUNK must be src, supabase, or scripts (got: $AI_REVIEW_CHUNK)." >&2
      exit 1
    fi
    if [[ -d "$AI_REVIEW_CHUNK" ]]; then
      CHUNK_DIRS=("$AI_REVIEW_CHUNK")
      echo "AI review: CHECK_MODE=full (single chunk: $AI_REVIEW_CHUNK — nur committed Code)." >&2
    else
      echo "AI review: chunk dir $AI_REVIEW_CHUNK not found, skip." >&2
      exit 0
    fi
  fi
  if [[ ${#CHUNK_DIRS[@]} -gt 0 ]]; then
    USE_CHUNKED=1
    [[ -z "$AI_REVIEW_CHUNK" ]] && echo "AI review: CHECK_MODE=full (chunked: ${CHUNK_DIRS[*]} — nur committed Code)." >&2
  else
    # Fallback: ein Diff über alles. Nur 0 (diff ok) und 1 (kein diff) akzeptieren; alle anderen Exit-Codes (2, 128, …) → abbrechen.
    "$GIT_CMD" diff --no-color "$EMPTY_TREE"..HEAD -- . >> "$DIFF_FILE" 2>/dev/null; r=$?; [[ $r -ne 0 && $r -ne 1 ]] && { echo "AI review: git diff (full fallback) failed (exit $r)." >&2; exit 1; }
    if [[ ! -s "$DIFF_FILE" ]]; then
      echo "Skipping AI review (CHECK_MODE=full): no diff (empty repo?)." >&2
      exit 0
    fi
    echo "AI review: CHECK_MODE=full (single diff, no chunk dirs)." >&2
  fi
else
  # --- Diff-/Commit-Modus: nur geänderte/zu pushende Inhalte oder genau ein Commit ---
  # CHECK_MODE=commit: immer nur letzter Commit (HEAD~1..HEAD), stabil, kein Verschieben des Diffs.
  # Bei mehreren lokalen Commits: Pre-Push-Hook verweigert den Push (siehe .githooks/pre-push).
  if [[ "$CHECK_MODE" == "commit" ]]; then
    COMMIT_RANGE="HEAD~1..HEAD"
    if ! "$GIT_CMD" rev-parse --verify HEAD~1 >/dev/null 2>&1; then
      COMMIT_RANGE="$EMPTY_TREE..HEAD"
    fi
    if ! "$GIT_CMD" diff --no-color "$COMMIT_RANGE" >> "$DIFF_FILE" 2>/dev/null; then
      echo "AI review: git diff $COMMIT_RANGE failed. Abort to avoid review with empty/incomplete diff." >&2
      exit 1
    fi
    if [[ ! -s "$DIFF_FILE" ]]; then
      echo "Skipping AI review (CHECK_MODE=commit): no changes in last commit." >&2
      exit 0
    fi
    echo "AI review: CHECK_MODE=commit (range: $COMMIT_RANGE — nur letzter Commit)." >&2
  # AI_REVIEW_DIFF_FILE: wenn gesetzt und lesbar, diesen Diff verwenden (z.B. git diff > .review-diff-snapshot; AI_REVIEW_DIFF_FILE=.review-diff-snapshot)
  elif [[ -n "${AI_REVIEW_DIFF_FILE:-}" ]] && [[ -r "${AI_REVIEW_DIFF_FILE}" ]]; then
    if ! cp "$AI_REVIEW_DIFF_FILE" "$DIFF_FILE"; then
      echo "AI review: AI_REVIEW_DIFF_FILE not readable or copy failed." >&2
      exit 1
    fi
    echo "AI review: CHECK_MODE=diff (from file: $AI_REVIEW_DIFF_FILE)." >&2
  elif [[ -n "${AI_REVIEW_DIFF_RANGE:-}" ]]; then
  # AI_REVIEW_DIFF_RANGE: wenn gesetzt, nur diese Range (feste Eingabe, kein Verschieben)
    if ! "$GIT_CMD" diff --no-color "$AI_REVIEW_DIFF_RANGE" >> "$DIFF_FILE" 2>/dev/null; then
      echo "AI review: git diff $AI_REVIEW_DIFF_RANGE failed. Abort to avoid review with empty/incomplete diff." >&2
      exit 1
    fi
    echo "AI review: CHECK_MODE=diff (range: $AI_REVIEW_DIFF_RANGE)." >&2
  else
    # Kein stabiles Diff-Input: commit ist Default; staged/unstaged absichtlich nicht mehr (verschiebt sich).
    echo "AI review: Kein stabiles Diff-Input. Nutze CHECK_MODE=commit (Default) oder setze AI_REVIEW_DIFF_FILE / AI_REVIEW_DIFF_RANGE. Staged/unstaged ist deaktiviert (Diff verschiebt sich zwischen Läufen)." >&2
    exit 1
  fi
  if [[ ! -s "$DIFF_FILE" ]]; then
    echo "Skipping AI review: no diff for range (CHECK_MODE=diff)." >&2
    exit 0
  fi
fi

run_with_timeout() {
  local timeout_sec="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$timeout_sec" "$@"
    return $?
  fi
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$timeout_sec" "$@" <<'PY'
import subprocess
import sys

timeout = int(float(sys.argv[1]))
cmd = sys.argv[2:]

try:
    result = subprocess.run(cmd, check=False, timeout=timeout)
    sys.exit(result.returncode)
except subprocess.TimeoutExpired:
    sys.exit(124)
PY
    return $?
  fi
  if command -v perl >/dev/null 2>&1; then
    perl -e 'my $t=shift @ARGV; $SIG{ALRM}=sub{exit 124}; alarm $t; system @ARGV; exit ($? >> 8);' "$timeout_sec" "$@"
    return $?
  fi
  "$@"
}

# ---------- Chunked Full-Review: pro Verzeichnis ein Durchlauf, AI sieht jedes Chunk vollständig ----------
if [[ "$USE_CHUNKED" -eq 1 ]]; then
  if ! command -v codex >/dev/null 2>&1; then
    echo "Skipping AI review: Codex CLI not available." >&2
    exit 0
  fi
  TIMEOUT_SEC="${TIMEOUT_SEC:-600}"
  # Larger chunks so IDOR/redaction/rate-limit fixes are visible (head+tail each; increase if chunks still truncated)
  CHUNK_LIMIT_BYTES=256000
  REVIEWS_DIR="$ROOT_DIR/.shimwrapper/reviews"
  mkdir -p "$REVIEWS_DIR"
  REVIEW_FILE="$REVIEWS_DIR/review-$(date +%Y%m%d-%H%M%S)-$$.md"
  OVERALL_PASS=1
  TOTAL_IN=0
  TOTAL_OUT=0
  REVIEW_SECTIONS=""
  CHUNK_TRUNCATED_ANY=0
  CHUNK_DIFF_FILE="$(mktemp)"
  CODEX_JSON_FILE="$(mktemp)"
  CODEX_LAST_MSG_FILE="$(mktemp)"
  cleanup() {
    [[ -n "$DIFF_FILE" ]] && [[ -f "$DIFF_FILE" ]] && rm -f "$DIFF_FILE"
    [[ -n "$CHUNK_DIFF_FILE" ]] && [[ -f "$CHUNK_DIFF_FILE" ]] && rm -f "$CHUNK_DIFF_FILE"
    [[ -n "$CODEX_JSON_FILE" ]] && [[ -f "$CODEX_JSON_FILE" ]] && rm -f "$CODEX_JSON_FILE"
    [[ -n "$CODEX_LAST_MSG_FILE" ]] && [[ -f "$CODEX_LAST_MSG_FILE" ]] && rm -f "$CODEX_LAST_MSG_FILE"
  }
  trap cleanup EXIT
  # DIFF_FILE nicht mehr nutzen (Chunk-Loop); Aufräumen trotzdem
  rm -f "$DIFF_FILE" 2>/dev/null || true

  PROMPT_HEAD='Du bist ein extrem strenger Senior-Software-Architekt. Deine Aufgabe ist es, einen Code-Diff zu bewerten.

Regeln:
Starte mit 100 Punkten.
Gehe die folgende Checkliste durch und ziehe für jeden Verstoß die angegebenen Punkte ab. Sei gnadenlos. Ein '\''okay'\'' reicht nicht für 95%. 95% bedeutet Weltklasse-Niveau.

1. Architektur & SOLID (Die Struktur-Prüfung)
- Single Responsibility (SRP): Hat die Klasse/Funktion mehr als einen Grund, sich zu ändern? (Abzug: -15%)
- Dependency Inversion: Werden Abhängigkeiten (z.B. Datenbanken, APIs) hart instanziiert oder injiziert? (Abzug: -10%)
- Kopplung: Gibt es zirkuläre Abhängigkeiten oder zu tief verschachtelte Datei-Importe? (Abzug: -10%)
- YAGNI (You Ain'\''t Gonna Need It): Wurde Code für "zukünftige Fälle" geschrieben, der jetzt noch nicht gebraucht wird? (Abzug: -5%)

2. Performance & Ressourcen (Der Effizienz-Check)
- Zeitkomplexität: Gibt es verschachtelte Schleifen (O(n²)), die bei größeren Datenmengen explodieren? (Abzug: -20%)
- Datenbank-Effizienz: Werden in einer Schleife Datenbankabfragen gemacht (N+1 Problem)? (Abzug: -20%)
- Memory Leaks: Werden Event-Listener oder Streams geöffnet, aber nicht wieder geschlossen? (Abzug: -15%)
- Bundle-Size: Werden riesige Bibliotheken importiert, um nur eine kleine Funktion zu nutzen? (Abzug: -5%)

3. Sicherheit (Logik-Ebene, die Snyk nicht sieht)
- IDOR (Insecure Direct Object Reference): Akzeptiert die API eine ID (z.B. user_id), ohne zu prüfen, ob der aktuelle User diese ID überhaupt sehen darf? (Abzug: -25%)
- Data Leakage: Werden sensible Daten (Passwörter, PII) in Logs geschrieben oder im Frontend ausgegeben? (Abzug: -20%)
- Rate Limiting: Könnte diese Funktion durch massenhafte Aufrufe den Server lahmlegen? (Abzug: -10%)

4. Robustheit & Error Handling (Die Stabilitäts-Prüfung)
- Silent Fails: Gibt es leere catch-Blöcke, die Fehler einfach "verschlucken"? (Abzug: -15%)
- Input Validation: Werden externe Daten (API-Inputs) validiert, bevor sie verarbeitet werden? (Abzug: -15%)
- Edge Cases: Was passiert bei null, undefined, [] oder extrem langen Strings? (Abzug: -10%)

5. Wartbarkeit & Lesbarkeit (Clean Code)
- Naming: Sind Variablennamen beschreibend oder heißen sie data, info, item? (Abzug: -5%)
- Side Effects: Verändert eine Funktion unvorhersehbar globale Zustände? (Abzug: -10%)
- Kommentar-Qualität: Erklärt der Kommentar das "Warum", oder nur das offensichtliche "Was"? (Abzug: -2%)

Antworte ausschließlich mit einem einzigen JSON-Objekt (kein anderer Text davor oder danach). Keine Dateien ändern oder Edits vorschlagen.

Format:
{"score": number, "deductions": [{"point": "Kurzname", "minus": number, "reason": "..."}], "verdict": "REJECT" | "ACCEPT"}

Regel: verdict muss "ACCEPT" sein nur wenn score >= 95 und keine kritischen Verstöße unadressiert; sonst verdict "REJECT".

Akzeptierte Trade-offs (keine Abzüge): Logger = injizierte logError(message, err?); nur message + optional err.message (kein Stack). Rate Limiting = get-then-set dokumentiert; Schreib-Endpunkte gedrosselt; GET-Endpunkte ohne Throttling = kein Abzug. Scans = fire-and-forget + mehrere Verantwortungen in Scans-Handler = dokumentiert, kein SRP-Abzug. Externe API (fetch/URL in integrations/scans) = kein DI-Abzug. Route-Handler = Validierung + ein Service-Call = kein SRP-Abzug.
Konflikte: Silent Fails vs Data Leakage: Wenn Fehler an injizierte Logging-Funktion übergeben werden und nur feste Meldung plus optional err.message geloggt wird: weder Silent Fails noch Data Leakage abziehen. Nur abziehen: Silent Fails wenn Fehler weder weitergereicht noch geloggt; Data Leakage wenn Passwörter, Tokens, PII oder Stack/volle Objekte in Logs. Dependency Inversion: Logging über injizierte Funktion (z.B. c.get('\''logError'\'')) gilt als erfüllt; kein Abzug nur weil die Implementierung console.log verwendet.
Verwende für Abzüge ausschließlich die in der Checkliste genannten Werte (z.B. SRP -15, DI -10, Data Leakage -20). Keine anderen Werte. Jeder Eintrag in deductions muss einen point-Kurznamen aus der Checkliste haben und exakt den zugehörigen minus-Wert.

--- DIFF ---
'

  for chunk in "${CHUNK_DIRS[@]}"; do
    echo "Running Codex AI review chunk: $chunk (timeout ${TIMEOUT_SEC}s)..." >&2
    if ! "$GIT_CMD" diff --no-color "$EMPTY_TREE"..HEAD -- "$chunk" > "$CHUNK_DIFF_FILE" 2>/dev/null; then
      echo "Chunk $chunk: git diff failed (exit $?), skip." >&2
      continue
    fi
    if [[ ! -s "$CHUNK_DIFF_FILE" ]]; then
      echo "Chunk $chunk: empty diff, skip." >&2
      continue
    fi
    # Only flag literal assignments (exclude variable substitution lines like VAR="${VAR:-...}")
    if grep -v '\${' "$CHUNK_DIFF_FILE" | grep -iE '(password|api_key|secret|token|private_key|service_role_key|anon_key)\s*=\s*['\''\"][^'\''\"]{16,}['\''\"]' >/dev/null 2>&1; then
      echo "Chunk $chunk: diff may contain secrets, skip." >&2
      continue
    fi
    if grep -iE '^[^#]*(SUPABASE_SERVICE_ROLE_KEY|GITHUB_TOKEN|API_KEY)\s*=\s*[A-Za-z0-9_-]{32,}' "$CHUNK_DIFF_FILE" >/dev/null 2>&1; then
      echo "Chunk $chunk: diff may contain unquoted secrets, skip." >&2
      continue
    fi
    BYTES=$(wc -c < "$CHUNK_DIFF_FILE")
    if [[ "$BYTES" -le $((CHUNK_LIMIT_BYTES * 2)) ]]; then
      DIFF_LIMITED=$(cat "$CHUNK_DIFF_FILE")
    else
      CHUNK_TRUNCATED_ANY=1
      DIFF_LIMITED="$(head -c $CHUNK_LIMIT_BYTES "$CHUNK_DIFF_FILE")
...(Chunk gekürzt, $BYTES bytes total)
$(tail -c $CHUNK_LIMIT_BYTES "$CHUNK_DIFF_FILE")"
    fi
    PROMPT="${PROMPT_HEAD}${DIFF_LIMITED}"
    CODEX_RC=0
    run_with_timeout "$TIMEOUT_SEC" codex exec --json -o "$CODEX_LAST_MSG_FILE" "$PROMPT" 2>/dev/null > "$CODEX_JSON_FILE" || CODEX_RC=$?
    if [[ $CODEX_RC -eq 124 ]] || [[ $CODEX_RC -eq 142 ]]; then
      echo "Chunk $chunk: timed out." >&2
      REVIEW_SECTIONS="${REVIEW_SECTIONS}## Chunk: $chunk\n**Timeout.**\n\n"
      OVERALL_PASS=0
      continue
    fi
    if [[ $CODEX_RC -ne 0 ]]; then
      echo "Chunk $chunk: codex failed ($CODEX_RC)." >&2
      REVIEW_SECTIONS="${REVIEW_SECTIONS}## Chunk: $chunk\n**Codex error.**\n\n"
      OVERALL_PASS=0
      continue
    fi
    RESULT_TEXT=""
    if command -v jq >/dev/null 2>&1; then
      while IFS= read -r line; do
        [[ -z "$line" ]] && continue
        type="$(echo "$line" | jq -r '.type // empty')"
        if [[ "$type" == "turn.completed" ]]; then
          inc=$(echo "$line" | jq -r '.usage.input_tokens // 0' 2>/dev/null)
          out=$(echo "$line" | jq -r '.usage.output_tokens // 0' 2>/dev/null)
          TOTAL_IN=$((TOTAL_IN + inc))
          TOTAL_OUT=$((TOTAL_OUT + out))
        fi
        if [[ "$type" == "item.completed" ]]; then
          item_type="$(echo "$line" | jq -r '.item.item_type // empty')"
          if [[ "$item_type" == "assistant_message" ]]; then
            RESULT_TEXT="$(echo "$line" | jq -r '.item.text // empty')"
          fi
        fi
      done < "$CODEX_JSON_FILE"
    fi
    [[ -z "$RESULT_TEXT" ]] && [[ -s "$CODEX_LAST_MSG_FILE" ]] && RESULT_TEXT="$(cat "$CODEX_LAST_MSG_FILE")"
    SCORE=0
    VERDICT="REJECT"
    if [[ -n "$RESULT_TEXT" ]] && command -v jq >/dev/null 2>&1; then
      JSON_BLOCK="$(echo "$RESULT_TEXT" | sed -n '/^```.*json/,/^```/p' | sed '/^```/d')"
      [[ -z "$JSON_BLOCK" ]] && JSON_BLOCK="$(echo "$RESULT_TEXT" | grep -oE '\{[^{}]*( \{[^{}]*\}[^{}]*)*\}' | head -1)"
      [[ -z "$JSON_BLOCK" ]] && JSON_BLOCK="$RESULT_TEXT"
      SCORE=$(echo "$JSON_BLOCK" | jq -r '.score // 0' 2>/dev/null)
      VERDICT=$(echo "$JSON_BLOCK" | jq -r '.verdict // "REJECT"' 2>/dev/null)
      [[ "$SCORE" == "null" ]] && SCORE=0
      [[ "$VERDICT" == "null" ]] && VERDICT="REJECT"
    fi
    [[ "$SCORE" -lt 95 ]] 2>/dev/null && OVERALL_PASS=0
    [[ "$VERDICT" != "ACCEPT" ]] && OVERALL_PASS=0
    REDACTED=$(redact_review_text "$RESULT_TEXT")
    REVIEW_SECTIONS="${REVIEW_SECTIONS}## Chunk: $chunk — Score: ${SCORE}% Verdict: ${VERDICT}\n\n\`\`\`\n${REDACTED}\n\`\`\`\n\n"
  done

  BRANCH="${GIT_BRANCH:-$("$GIT_CMD" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")}"
  {
    echo "# AI Code Review (Full Codebase, Chunked) — $(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')"
    echo ""
    [[ "$CHUNK_TRUNCATED_ANY" -eq 1 ]] && echo "> **Note:** One or more chunks had diff truncated (head+tail only); the middle of those chunks was not sent for review." && echo ""
    if [[ -n "$AI_REVIEW_CHUNK" ]]; then
      echo "- **Mode:** full (single chunk: $AI_REVIEW_CHUNK)"
    else
      echo "- **Mode:** full (chunked)"
    fi
    echo "- **Branch:** $BRANCH"
    echo "- **Verdict:** $([ "$OVERALL_PASS" -eq 1 ] && echo "ACCEPT (PASS)" || echo "REJECT (FAIL)")"
    echo "- **Tokens:** ${TOTAL_IN} input, ${TOTAL_OUT} output (total $((TOTAL_IN + TOTAL_OUT)))"
    echo ""
    echo "---"
    echo ""
    echo -e "$REVIEW_SECTIONS"
  } >> "$REVIEW_FILE"
  echo "Token usage: ${TOTAL_IN} input, ${TOTAL_OUT} output (total $((TOTAL_IN + TOTAL_OUT)))" >&2
  echo "Review saved: $REVIEW_FILE" >&2
  if [[ $OVERALL_PASS -eq 1 ]]; then
    echo "Codex AI review: PASS (all chunks)" >&2
    rm -f "$ROOT_DIR/.shimwrapper/review-failed.json" 2>/dev/null || true
  else
    echo "Codex AI review: FAIL (see deductions per chunk in $REVIEW_FILE)" >&2
    REVIEW_FAILED_JSON="$ROOT_DIR/.shimwrapper/review-failed.json"
    mkdir -p "$(dirname "$REVIEW_FAILED_JSON")"
    CHUNK_SCORE=$(grep -oE 'Score: [0-9]+' "$REVIEW_FILE" 2>/dev/null | grep -oE '[0-9]+' | sort -n | head -1)
    [[ -z "$CHUNK_SCORE" ]] && CHUNK_SCORE=0
    echo "{\"verdict\":\"REJECT\",\"score\":${CHUNK_SCORE},\"review_file\":\"$(basename "$REVIEW_FILE")\",\"timestamp\":\"$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')\"}" > "$REVIEW_FAILED_JSON"
    echo "REVIEW_FAILED_AGENT_ACTION: Read .shimwrapper/review-failed.json and AGENTS.md § \"Agent after failed AI review\"; fix all deductions (broad pass per file), commit, then re-run pipeline (e.g. supabase --workdir src functions deploy <name> or npm run push)." >&2
  fi
  if [[ -n "${REFACTOR_REPORT_FILE:-}" ]] && [[ -f "${REFACTOR_REPORT_FILE:-}" ]]; then
    REVIEW_SCORE_CHUNKED="$(echo "$REVIEW_SECTIONS" | grep -oE 'Score: [0-9]+' | grep -oE '[0-9]+' | sort -n | head -1)"
    [[ -z "$REVIEW_SCORE_CHUNKED" ]] && REVIEW_SCORE_CHUNKED=0
    echo "AI_REVIEW_FILE:$(basename "$REVIEW_FILE")" >> "$REFACTOR_REPORT_FILE"
    echo "AI_REVIEW_SCORE:${REVIEW_SCORE_CHUNKED}" >> "$REFACTOR_REPORT_FILE"
    echo "AI_REVIEW_VERDICT:$([ "$OVERALL_PASS" -eq 1 ] && echo ACCEPT || echo REJECT)" >> "$REFACTOR_REPORT_FILE"
  fi
  [[ $OVERALL_PASS -eq 1 ]] && exit 0 || exit 1
fi

# Refuse to send diff to Codex if it might contain literal secrets (Data Leakage prevention).
# Exclude variable substitution lines (e.g. VAR="${VAR:-...}").
if grep -v '\${' "$DIFF_FILE" | grep -iE '(password|api_key|secret|token|private_key|service_role_key|anon_key|bearer)\s*=\s*['\''\"][^'\''\"]{16,}['\''\"]' >/dev/null 2>&1; then
  echo "AI review aborted: diff may contain literal secrets (long quoted values). Remove or redact before push." >&2
  exit 1
fi
if grep -iE '^[^#]*(SUPABASE_SERVICE_ROLE_KEY|GITHUB_TOKEN|API_KEY|SECRET)\s*=\s*[A-Za-z0-9_-]{32,}' "$DIFF_FILE" >/dev/null 2>&1; then
  echo "AI review aborted: diff may contain unquoted secrets (32+ char values). Remove or redact before push." >&2
  exit 1
fi

# Diff auf ~100KB (Kopf + Schwanz) begrenzen, damit Codex nicht an Token-Limit/Timeout scheitert.
# Bei CHECK_MODE=full kann das Repo-Diff sehr groß sein; dann sieht die AI nur Anfang + Ende.
LIMIT_BYTES=51200
DIFF_LIMITED=""
if [[ $(wc -c < "$DIFF_FILE") -le $((LIMIT_BYTES * 2)) ]]; then
  DIFF_LIMITED="$(cat "$DIFF_FILE")"
else
  DIFF_LIMITED="$(head -c $LIMIT_BYTES "$DIFF_FILE")
...[truncated]...
$(tail -c $LIMIT_BYTES "$DIFF_FILE")"
fi

# Strict Senior-Software-Architekt review: start at 100, deduct per checklist item. Output JSON only.
PROMPT="Du bist ein extrem strenger Senior-Software-Architekt. Deine Aufgabe ist es, einen Code-Diff zu bewerten.

Regeln:
Starte mit 100 Punkten.
Gehe die folgende Checkliste durch und ziehe für jeden Verstoß die angegebenen Punkte ab. Sei gnadenlos. Ein 'okay' reicht nicht für 95%. 95% bedeutet Weltklasse-Niveau.

1. Architektur & SOLID (Die Struktur-Prüfung)
- Single Responsibility (SRP): Hat die Klasse/Funktion mehr als einen Grund, sich zu ändern? (Abzug: -15%)
- Dependency Inversion: Werden Abhängigkeiten (z.B. Datenbanken, APIs) hart instanziiert oder injiziert? (Abzug: -10%)
- Kopplung: Gibt es zirkuläre Abhängigkeiten oder zu tief verschachtelte Datei-Importe? (Abzug: -10%)
- YAGNI (You Ain't Gonna Need It): Wurde Code für \"zukünftige Fälle\" geschrieben, der jetzt noch nicht gebraucht wird? (Abzug: -5%)

2. Performance & Ressourcen (Der Effizienz-Check)
- Zeitkomplexität: Gibt es verschachtelte Schleifen (O(n²)), die bei größeren Datenmengen explodieren? (Abzug: -20%)
- Datenbank-Effizienz: Werden in einer Schleife Datenbankabfragen gemacht (N+1 Problem)? (Abzug: -20%)
- Memory Leaks: Werden Event-Listener oder Streams geöffnet, aber nicht wieder geschlossen? (Abzug: -15%)
- Bundle-Size: Werden riesige Bibliotheken importiert, um nur eine kleine Funktion zu nutzen? (Abzug: -5%)

3. Sicherheit (Logik-Ebene, die Snyk nicht sieht)
- IDOR (Insecure Direct Object Reference): Akzeptiert die API eine ID (z.B. user_id), ohne zu prüfen, ob der aktuelle User diese ID überhaupt sehen darf? (Abzug: -25%)
- Data Leakage: Werden sensible Daten (Passwörter, PII) in Logs geschrieben oder im Frontend ausgegeben? (Abzug: -20%)
- Rate Limiting: Könnte diese Funktion durch massenhafte Aufrufe den Server lahmlegen? (Abzug: -10%)

4. Robustheit & Error Handling (Die Stabilitäts-Prüfung)
- Silent Fails: Gibt es leere catch-Blöcke, die Fehler einfach \"verschlucken\"? (Abzug: -15%)
- Input Validation: Werden externe Daten (API-Inputs) validiert, bevor sie verarbeitet werden? (Abzug: -15%)
- Edge Cases: Was passiert bei null, undefined, [] oder extrem langen Strings? (Abzug: -10%)

5. Wartbarkeit & Lesbarkeit (Clean Code)
- Naming: Sind Variablennamen beschreibend oder heißen sie data, info, item? (Abzug: -5%)
- Side Effects: Verändert eine Funktion unvorhersehbar globale Zustände? (Abzug: -10%)
- Kommentar-Qualität: Erklärt der Kommentar das \"Warum\", oder nur das offensichtliche \"Was\"? (Abzug: -2%)

Antworte ausschließlich mit einem einzigen JSON-Objekt (kein anderer Text davor oder danach). Keine Dateien ändern oder Edits vorschlagen.

Format:
{\"score\": number, \"deductions\": [{\"point\": \"Kurzname\", \"minus\": number, \"reason\": \"...\"}], \"verdict\": \"REJECT\" | \"ACCEPT\"}

Regel: verdict muss \"ACCEPT\" sein nur wenn score >= 95 und keine kritischen Verstöße unadressiert; sonst verdict \"REJECT\".

Akzeptierte Trade-offs (keine Abzüge): Logger = injizierte logError(message, err?); nur message + optional err.message (kein Stack). Rate Limiting = get-then-set dokumentiert; Schreib-Endpunkte gedrosselt; GET-Endpunkte ohne Throttling = kein Abzug. Scans = fire-and-forget + mehrere Verantwortungen in Scans-Handler = dokumentiert, kein SRP-Abzug. Externe API (fetch/URL in integrations/scans) = kein DI-Abzug. Route-Handler = Validierung + ein Service-Call = kein SRP-Abzug.
Konflikte: Silent Fails vs Data Leakage: Wenn Fehler an injizierte Logging-Funktion übergeben werden und nur feste Meldung plus optional err.message geloggt wird: weder Silent Fails noch Data Leakage abziehen. Nur abziehen: Silent Fails wenn Fehler weder weitergereicht noch geloggt; Data Leakage wenn Passwörter, Tokens, PII oder Stack/volle Objekte in Logs. Dependency Inversion: Logging über injizierte Funktion (z.B. c.get(\\\"logError\\\")) gilt als erfüllt; kein Abzug nur weil die Implementierung console.log verwendet.
Verwende für Abzüge ausschließlich die in der Checkliste genannten Werte (z.B. SRP -15, Dependency Inversion -10, Data Leakage -20). Keine anderen Werte (z.B. -7 oder -12). Jeder Eintrag in deductions muss einen point-Kurznamen aus der Checkliste haben und exakt den zugehörigen minus-Wert.

--- DIFF ---
$DIFF_LIMITED"

CODEX_JSON_FILE="$(mktemp)"
CODEX_LAST_MSG_FILE="$(mktemp)"
cleanup() {
  [[ -n "$DIFF_FILE" ]] && [[ -f "$DIFF_FILE" ]] && rm -f "$DIFF_FILE"
  [[ -n "$CODEX_JSON_FILE" ]] && [[ -f "$CODEX_JSON_FILE" ]] && rm -f "$CODEX_JSON_FILE"
  [[ -n "$CODEX_LAST_MSG_FILE" ]] && [[ -f "$CODEX_LAST_MSG_FILE" ]] && rm -f "$CODEX_LAST_MSG_FILE"
}
trap cleanup EXIT

if ! command -v codex >/dev/null 2>&1; then
  echo "Skipping AI review: Codex CLI not available (run codex login or install codex in PATH)." >&2
  exit 0
fi

# Full-Codebase-Diff ist größer → längerer Timeout, damit die Review nicht abbricht
if [[ "$CHECK_MODE" == "full" ]]; then
  TIMEOUT_SEC="${TIMEOUT_SEC:-600}"
else
  TIMEOUT_SEC="${TIMEOUT_SEC:-600}"
fi
echo "Running Codex AI review (timeout ${TIMEOUT_SEC}s)..." >&2

# Run with --json to get turn.completed (token usage) and item.completed (assistant message). Use -o to get final message for PASS/FAIL.
CODEX_RC=0
run_with_timeout "$TIMEOUT_SEC" codex exec --json -o "$CODEX_LAST_MSG_FILE" "$PROMPT" 2>/dev/null > "$CODEX_JSON_FILE" || CODEX_RC=$?

if [[ $CODEX_RC -eq 124 ]] || [[ $CODEX_RC -eq 142 ]]; then
  echo "Codex AI review timed out after ${TIMEOUT_SEC}s." >&2
  exit 1
fi

if [[ $CODEX_RC -ne 0 ]]; then
  echo "Codex AI review command failed (exit $CODEX_RC)." >&2
  cat "$CODEX_JSON_FILE" 2>/dev/null | head -50 >&2
  exit 1
fi

# Parse JSONL: turn.completed has usage (input_tokens, output_tokens); last assistant_message is in item.completed.
INPUT_T=""
OUTPUT_T=""
RESULT_TEXT=""
if command -v jq >/dev/null 2>&1; then
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    type="$(echo "$line" | jq -r '.type // empty')"
    if [[ "$type" == "turn.completed" ]]; then
      INPUT_T="$(echo "$line" | jq -r '.usage.input_tokens // empty')"
      OUTPUT_T="$(echo "$line" | jq -r '.usage.output_tokens // empty')"
    fi
    if [[ "$type" == "item.completed" ]]; then
      item_type="$(echo "$line" | jq -r '.item.item_type // empty')"
      if [[ "$item_type" == "assistant_message" ]]; then
        RESULT_TEXT="$(echo "$line" | jq -r '.item.text // empty')"
      fi
    fi
  done < "$CODEX_JSON_FILE"
fi

# Fallback: use --output-last-message file for PASS/FAIL if we didn't get assistant_message from JSONL
if [[ -z "$RESULT_TEXT" ]] && [[ -s "$CODEX_LAST_MSG_FILE" ]]; then
  RESULT_TEXT="$(cat "$CODEX_LAST_MSG_FILE")"
fi

# Parse JSON review: score, deductions[], verdict (ACCEPT | REJECT). Extract JSON from markdown code block if present.
REVIEW_RATING=0
REVIEW_DEDUCTIONS=""
REVIEW_VERDICT="REJECT"
PASS=0

if [[ -n "$RESULT_TEXT" ]]; then
  JSON_BLOCK="$(echo "$RESULT_TEXT" | sed -n '/^```.*json/,/^```/p' | sed '/^```/d')"
  if [[ -z "$JSON_BLOCK" ]]; then
    JSON_BLOCK="$(echo "$RESULT_TEXT" | grep -oE '\{[^{}]*( \{[^{}]*\}[^{}]*)*\}' | head -1)"
  fi
  if [[ -z "$JSON_BLOCK" ]]; then
    JSON_BLOCK="$RESULT_TEXT"
  fi
  if command -v jq >/dev/null 2>&1 && [[ -n "$JSON_BLOCK" ]]; then
    REVIEW_RATING=$(echo "$JSON_BLOCK" | jq -r '.score // 0' 2>/dev/null)
    REVIEW_VERDICT=$(echo "$JSON_BLOCK" | jq -r '.verdict // "REJECT"' 2>/dev/null)
    REVIEW_DEDUCTIONS=$(echo "$JSON_BLOCK" | jq -r '.deductions // [] | .[] | "\(.point): -\(.minus)% — \(.reason)"' 2>/dev/null | tr '\n' '; ')
    [[ -z "$REVIEW_RATING" || "$REVIEW_RATING" == "null" ]] && REVIEW_RATING=0
    [[ -z "$REVIEW_VERDICT" || "$REVIEW_VERDICT" == "null" ]] && REVIEW_VERDICT="REJECT"
  fi
  # Fallback: try to grep score and verdict from raw text
  if [[ "$REVIEW_RATING" -eq 0 ]] && echo "$RESULT_TEXT" | grep -qE '"score"[[:space:]]*:[[:space:]]*[0-9]+'; then
    REVIEW_RATING=$(echo "$RESULT_TEXT" | grep -oE '"score"[[:space:]]*:[[:space:]]*[0-9]+' | grep -oE '[0-9]+' | head -1)
  fi
  if [[ "$REVIEW_VERDICT" == "REJECT" ]] && echo "$RESULT_TEXT" | grep -qE '"verdict"[[:space:]]*:[[:space:]]*"ACCEPT"'; then
    REVIEW_VERDICT="ACCEPT"
  fi
  [[ "$REVIEW_RATING" -lt 0 ]] 2>/dev/null && REVIEW_RATING=0
  [[ "$REVIEW_RATING" -gt 100 ]] 2>/dev/null && REVIEW_RATING=100
fi

# Pass only if verdict is ACCEPT and score >= 95
if [[ "$REVIEW_VERDICT" == "ACCEPT" ]] && [[ "$REVIEW_RATING" -ge 95 ]]; then
  PASS=1
fi

# Always print token usage
if [[ -n "$INPUT_T" && -n "$OUTPUT_T" ]]; then
  TOTAL=$((INPUT_T + OUTPUT_T))
  echo "Token usage: ${INPUT_T} input, ${OUTPUT_T} output (total ${TOTAL})" >&2
else
  echo "Token usage: not reported by Codex CLI" >&2
fi

# Save review to .shimwrapper/reviews/ as markdown (always, pass or fail)
REVIEWS_DIR="$ROOT_DIR/.shimwrapper/reviews"
mkdir -p "$REVIEWS_DIR"
REVIEW_FILE="$REVIEWS_DIR/review-$(date +%Y%m%d-%H%M%S)-$$.md"
BRANCH=""
[[ -n "${GIT_BRANCH:-}" ]] && BRANCH="$GIT_BRANCH" || BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"
{
  echo "# AI Code Review — $(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')"
  echo ""
  echo "- **Mode:** $CHECK_MODE"
  echo "- **Branch:** $BRANCH"
  echo "- **Verdict:** ${REVIEW_VERDICT} ($([ "$PASS" -eq 1 ] && echo "PASS" || echo "FAIL"))"
  echo "- **Score:** ${REVIEW_RATING}%"
  echo "- **Tokens:** ${INPUT_T:-?} input, ${OUTPUT_T:-?} output"
  [[ -n "$REVIEW_DEDUCTIONS" ]] && { echo ""; echo "## Deductions"; echo ""; echo "$REVIEW_DEDUCTIONS" | tr ';' '\n' | sed 's/^/ - /'; echo ""; }
  echo "## Raw response"
  echo ""
  echo '```'
  [[ -n "$RESULT_TEXT" ]] && redact_review_text "$RESULT_TEXT" || echo "(no review text)"
  echo '```'
} >> "$REVIEW_FILE"
echo "Review saved: $REVIEW_FILE" >&2

# Always print review result
if [[ $PASS -eq 1 ]]; then
  echo "Codex AI review: PASS" >&2
  rm -f "$ROOT_DIR/.shimwrapper/review-failed.json" 2>/dev/null || true
else
  echo "Codex AI review: FAIL" >&2
  echo "→ Address deductions above (or in $REVIEW_FILE). Do a broad pass per affected file (IDOR, rate limiting, input validation, error handling, edge cases) before re-running — see AGENTS.md and docs/AI_REVIEW_WHY_NEW_ERRORS_AFTER_FIXES.md." >&2
  REVIEW_FAILED_JSON="$ROOT_DIR/.shimwrapper/review-failed.json"
  mkdir -p "$(dirname "$REVIEW_FAILED_JSON")"
  echo "{\"verdict\":\"REJECT\",\"score\":${REVIEW_RATING:-0},\"review_file\":\"$(basename "$REVIEW_FILE")\",\"timestamp\":\"$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S%z')\"}" > "$REVIEW_FAILED_JSON"
  echo "REVIEW_FAILED_AGENT_ACTION: Read .shimwrapper/review-failed.json and AGENTS.md § \"Agent after failed AI review\"; fix all deductions (broad pass per file), commit, then re-run pipeline (e.g. supabase --workdir src functions deploy <name> or npm run push)." >&2
fi
echo "Score: ${REVIEW_RATING}%" >&2
echo "Verdict: ${REVIEW_VERDICT}" >&2
[[ -n "$REVIEW_DEDUCTIONS" ]] && echo "Deductions: ${REVIEW_DEDUCTIONS}" >&2

if [[ -n "${REFACTOR_REPORT_FILE:-}" ]] && [[ -f "${REFACTOR_REPORT_FILE:-}" ]] && [[ -n "$REVIEW_FILE" ]]; then
  echo "AI_REVIEW_FILE:$(basename "$REVIEW_FILE")" >> "$REFACTOR_REPORT_FILE"
  echo "AI_REVIEW_SCORE:${REVIEW_RATING:-0}" >> "$REFACTOR_REPORT_FILE"
  echo "AI_REVIEW_VERDICT:${REVIEW_VERDICT:-REJECT}" >> "$REFACTOR_REPORT_FILE"
fi

[[ $PASS -eq 1 ]] && exit 0 || exit 1

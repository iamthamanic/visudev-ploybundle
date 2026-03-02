/**
 * PreviewTerminal – Log-Panel für Preview-Schritte und Screen-Lade-Logs.
 * Zeigt refreshLogs (Runner) und loadLogs (Iframe-Lade-Status). Copy-to-clipboard (intern).
 * Location: src/modules/appflow/components/PreviewTerminal.tsx
 */

import { forwardRef, useState, useRef, useCallback, useEffect } from "react";
import clsx from "clsx";
import { Terminal, Copy, Check, Loader2 } from "lucide-react";
import type { StepLogEntry } from "../../../lib/visudev/types";
import type { PreviewStepLog } from "../../../utils/api";
import type { LoadLogEntry } from "../hooks/useScreenLoadState";
import styles from "../styles/LiveFlowCanvas.module.css";

function formatLogTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("de-DE", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "";
  }
}

interface PreviewTerminalProps {
  runId?: string | null;
  analysisLogs: StepLogEntry[];
  refreshLogs: PreviewStepLog[];
  loadLogs: LoadLogEntry[];
  refreshInProgress: boolean;
}

export const PreviewTerminal = forwardRef<HTMLDivElement, PreviewTerminalProps>(
  ({ runId, analysisLogs, refreshLogs, loadLogs, refreshInProgress }, ref) => {
    const [copyFeedback, setCopyFeedback] = useState(false);
    const copyFeedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const getFullLogText = useCallback((): string => {
      const lines: string[] = [];
      if (runId) {
        lines.push(`Aktiver Run: ${runId}`);
        lines.push("");
      }
      if (analysisLogs.length > 0) {
        lines.push("Code-Analyse (Repository-Scan)");
        for (const entry of analysisLogs) {
          lines.push(`[${formatLogTime(entry.time)}] ${entry.message}`);
        }
        if (lines.length) lines.push("");
      }
      if (refreshLogs.length > 0) {
        lines.push("Preview-Schritte (Start/Refresh)");
        for (const entry of refreshLogs) {
          lines.push(`[${formatLogTime(entry.time)}] ${entry.message}`);
        }
        if (refreshInProgress) lines.push("…");
      }
      if (loadLogs.length > 0) {
        if (lines.length) lines.push("");
        lines.push("Lade-Logs (Screens)");
        for (const entry of loadLogs) {
          lines.push(`[${entry.time}] ${entry.message}`);
        }
      }
      if (lines.length === 0) {
        if (refreshInProgress) lines.push("Preview wird aktualisiert (Pull, Rebuild, Restart) …");
        else lines.push("Keine Einträge. Screens werden geladen …");
      }
      return lines.join("\n");
    }, [runId, analysisLogs, refreshLogs, refreshInProgress, loadLogs]);

    const onCopyLog = useCallback(async () => {
      const text = getFullLogText();
      try {
        await navigator.clipboard.writeText(text);
        if (copyFeedbackTimeoutRef.current) clearTimeout(copyFeedbackTimeoutRef.current);
        setCopyFeedback(true);
        copyFeedbackTimeoutRef.current = setTimeout(() => {
          setCopyFeedback(false);
          copyFeedbackTimeoutRef.current = null;
        }, 2000);
      } catch {
        setCopyFeedback(false);
      }
    }, [getFullLogText]);

    useEffect(() => {
      return () => {
        if (copyFeedbackTimeoutRef.current) clearTimeout(copyFeedbackTimeoutRef.current);
      };
    }, []);
    return (
      <div className={styles.terminalPanel} role="region" aria-label="Logs">
        <div className={styles.terminalHeader}>
          <Terminal className={styles.terminalHeaderIcon} aria-hidden="true" />
          <span>
            {analysisLogs.length > 0 || refreshLogs.length > 0 || refreshInProgress
              ? "Analyse-, Preview- & Lade-Logs"
              : "Lade-Logs – was passiert beim Anzeigen der Screens"}
          </span>
          <button
            type="button"
            onClick={onCopyLog}
            className={styles.terminalCopyBtn}
            title="Gesamtes Log in Zwischenablage kopieren"
            aria-label="Log kopieren"
          >
            {copyFeedback ? (
              <Check className={styles.terminalCopyIcon} aria-hidden="true" />
            ) : (
              <Copy className={styles.terminalCopyIcon} aria-hidden="true" />
            )}
            <span className={styles.terminalCopyLabel}>
              {copyFeedback ? "Kopiert!" : "Log kopieren"}
            </span>
          </button>
        </div>
        <div ref={ref} className={styles.terminalBody} tabIndex={0}>
          {runId && (
            <div className={styles.terminalLine}>
              <strong>Aktiver Run:</strong> <code>{runId}</code>
            </div>
          )}
          {analysisLogs.length > 0 && (
            <>
              <div className={styles.terminalLine}>
                <strong>Code-Analyse (Repository-Scan)</strong>
              </div>
              {analysisLogs.map((entry: StepLogEntry, i: number) => (
                <div
                  key={`analysis-${i}-${entry.time}`}
                  className={clsx(
                    styles.terminalLine,
                    entry.type === "success" && styles.terminalLineSuccess,
                    entry.type === "error" && styles.terminalLineError,
                  )}
                >
                  <span className={styles.terminalTime}>[{formatLogTime(entry.time)}]</span>{" "}
                  {entry.message}
                </div>
              ))}
            </>
          )}
          {refreshLogs.length > 0 && (
            <>
              <div className={styles.terminalLine}>
                <strong>Preview-Schritte (Start/Refresh)</strong>
              </div>
              {refreshLogs.map((entry: PreviewStepLog, i: number) => (
                <div
                  key={`step-${i}-${entry.time}`}
                  className={clsx(
                    styles.terminalLine,
                    entry.message.startsWith("Fehlgeschlagen") && styles.terminalLineError,
                    entry.message === "Bereit" && styles.terminalLineSuccess,
                  )}
                >
                  <span className={styles.terminalTime}>[{formatLogTime(entry.time)}]</span>{" "}
                  {entry.message}
                </div>
              ))}
              {refreshInProgress && (
                <div className={clsx(styles.terminalLine, styles.terminalLineRefresh)}>
                  <Loader2 className={styles.terminalSpinner} aria-hidden="true" />
                  <span>…</span>
                </div>
              )}
            </>
          )}
          {refreshLogs.length > 0 && loadLogs.length > 0 && (
            <div className={styles.terminalLine}>
              <strong>Lade-Logs (Screens)</strong>
            </div>
          )}
          {loadLogs.length > 0 &&
            loadLogs.map((entry) => (
              <div
                key={entry.id}
                className={clsx(
                  styles.terminalLine,
                  entry.type === "success" && styles.terminalLineSuccess,
                  entry.type === "error" && styles.terminalLineError,
                )}
              >
                <span className={styles.terminalTime}>[{entry.time}]</span> {entry.message}
              </div>
            ))}
          {refreshLogs.length === 0 && loadLogs.length === 0 && !refreshInProgress && (
            <div className={styles.terminalLine}>Keine Einträge. Screens werden geladen …</div>
          )}
          {refreshLogs.length === 0 && refreshInProgress && loadLogs.length === 0 && (
            <div className={clsx(styles.terminalLine, styles.terminalLineRefresh)}>
              <Loader2 className={styles.terminalSpinner} aria-hidden="true" />
              <span>Preview wird aktualisiert (Pull, Rebuild, Restart) …</span>
            </div>
          )}
        </div>
      </div>
    );
  },
);

PreviewTerminal.displayName = "PreviewTerminal";

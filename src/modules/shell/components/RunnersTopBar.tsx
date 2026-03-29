/**
 * RunnersTopBar: Top-Leiste mit allen Runnern (App Flow Runner, Logs Runner, ggf. weitere).
 * Jeder Runner: gleiche Zustände (checking, online, offline, warning). Neue Runner einfach hier ergänzen.
 * Location: src/modules/shell/components/RunnersTopBar.tsx
 */

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import { Check, ChevronDown, Copy, Loader2, RefreshCw } from "lucide-react";
import { useVisudev } from "../../../lib/visudev/store";
import {
  getLocalPreviewRunnerHealth,
  getLocalPreviewRunnerRuns,
  getLocalLogsRunnerHealth,
  type LocalPreviewRunnerHealth,
  type LocalPreviewRunnerRunsSnapshot,
  type LocalLogsRunnerHealth,
} from "../../../utils/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import styles from "./RunnersTopBar.module.css";

function formatRunnerTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("de-DE");
}

export function RunnersTopBar() {
  const { activeProject } = useVisudev();
  const [previewHealth, setPreviewHealth] = useState<LocalPreviewRunnerHealth | null>(null);
  const [previewLoading, setPreviewLoading] = useState(true);
  const [logsHealth, setLogsHealth] = useState<LocalLogsRunnerHealth | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const [runnerDialogOpen, setRunnerDialogOpen] = useState(false);
  const [runnerRunsLoading, setRunnerRunsLoading] = useState(false);
  const [runnerRunsSnapshot, setRunnerRunsSnapshot] =
    useState<LocalPreviewRunnerRunsSnapshot | null>(null);
  const [runsCopied, setRunsCopied] = useState(false);

  const previewMode = activeProject?.preview_mode ?? "auto";
  const shouldCheckPreviewRunner = previewMode === "local" || previewMode === "auto";
  const activeProjectId = activeProject?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!shouldCheckPreviewRunner) {
      setPreviewHealth(null);
      setPreviewLoading(false);
      return () => {
        cancelled = true;
      };
    }
    const poll = async (showLoading: boolean) => {
      if (showLoading) setPreviewLoading(true);
      const h = await getLocalPreviewRunnerHealth();
      if (!cancelled) {
        setPreviewHealth(h);
        setPreviewLoading(false);
      }
    };
    void poll(true);
    const interval = setInterval(() => void poll(false), 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeProject?.id, shouldCheckPreviewRunner]);

  useEffect(() => {
    let cancelled = false;
    const poll = async (showLoading: boolean) => {
      if (showLoading) setLogsLoading(true);
      const h = await getLocalLogsRunnerHealth();
      if (!cancelled) {
        setLogsHealth(h);
        setLogsLoading(false);
      }
    };
    void poll(true);
    const interval = setInterval(() => void poll(false), 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const loadRunnerRuns = useCallback(
    async (showLoading: boolean) => {
      if (!shouldCheckPreviewRunner) {
        setRunnerRunsSnapshot(null);
        return;
      }
      if (showLoading) setRunnerRunsLoading(true);
      const snapshot = await getLocalPreviewRunnerRuns(activeProjectId);
      setRunnerRunsSnapshot(snapshot);
      if (showLoading) setRunnerRunsLoading(false);
    },
    [activeProjectId, shouldCheckPreviewRunner],
  );

  useEffect(() => {
    if (!runnerDialogOpen) return;
    void loadRunnerRuns(true);
    const interval = setInterval(() => void loadRunnerRuns(false), 10_000);
    return () => clearInterval(interval);
  }, [loadRunnerRuns, runnerDialogOpen]);

  const isPreviewOnline = previewHealth?.reachable === true;
  const isPreviewDegraded =
    isPreviewOnline && previewHealth?.useDocker && previewHealth?.dockerAvailable === false;
  const previewActiveRuns =
    typeof previewHealth?.activeRuns === "number" && Number.isFinite(previewHealth?.activeRuns)
      ? Math.max(0, previewHealth.activeRuns)
      : null;

  let previewPillClass = styles.pillChecking;
  if (!previewLoading && previewHealth) {
    if (isPreviewDegraded) previewPillClass = styles.pillWarning;
    else if (isPreviewOnline) previewPillClass = styles.pillOnline;
    else previewPillClass = styles.pillOffline;
  }
  if (!shouldCheckPreviewRunner) previewPillClass = styles.pillNeutral;

  let previewPrimary = "App Flow Runner";
  let previewSecondary = "Wird geprüft…";
  if (!previewLoading && previewHealth) {
    if (!shouldCheckPreviewRunner) {
      previewPrimary = "App Flow Runner";
      previewSecondary =
        previewMode === "deployed" ? "Deployed (nicht lokal)" : "Zentral (nicht lokal prüfbar)";
    } else if (isPreviewOnline) {
      const runsText = previewActiveRuns == null ? "Runs: ?" : `Runs: ${previewActiveRuns}`;
      previewSecondary = isPreviewDegraded
        ? `${previewHealth.baseUrl ?? "lokal"} · ${runsText} · Docker nicht erreichbar`
        : `${previewHealth.baseUrl ?? "lokal"} · ${runsText} · ${previewHealth.mode ?? "ok"}`;
    } else {
      previewSecondary = previewHealth.error ?? "Nicht erreichbar (localhost:4000/4100)";
    }
  }

  const isLogsOnline = logsHealth?.reachable === true;
  let logsPillClass = styles.pillChecking;
  if (!logsLoading && logsHealth) {
    logsPillClass = isLogsOnline ? styles.pillOnline : styles.pillOffline;
  }

  const runsForDialog = runnerRunsSnapshot?.runs ?? [];
  const runsTotals = runnerRunsSnapshot?.totals;

  const copyRunsToClipboard = async () => {
    const payload = {
      checkedAt: new Date().toISOString(),
      baseUrl: runnerRunsSnapshot?.baseUrl ?? previewHealth?.baseUrl ?? null,
      projectId: activeProjectId,
      totals: runsTotals ?? {
        total: runsForDialog.length,
        active: runsForDialog.filter((e) => e.status !== "stopped").length,
        ready: runsForDialog.filter((e) => e.status === "ready").length,
        starting: runsForDialog.filter((e) => e.status === "starting").length,
        failed: runsForDialog.filter((e) => e.status === "failed").length,
        stopped: runsForDialog.filter((e) => e.status === "stopped").length,
      },
      runs: runsForDialog,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setRunsCopied(true);
      window.setTimeout(() => setRunsCopied(false), 2000);
    } catch {
      setRunsCopied(false);
    }
  };

  return (
    <div className={styles.root} role="region" aria-label="Runner-Status">
      <div className={styles.runners}>
        {/* App Flow Runner – weitere Runner als weiteres .pill hier ergänzen */}
        <div
          className={clsx(styles.pill, previewPillClass)}
          role="status"
          aria-live="polite"
          aria-label={
            previewLoading
              ? "App Flow Runner wird geprüft"
              : isPreviewOnline
                ? "App Flow Runner aktiv"
                : "App Flow Runner aus"
          }
        >
          <span className={styles.pillDot} aria-hidden="true" />
          <div className={styles.pillText}>
            <span className={styles.pillPrimary}>{previewPrimary}</span>
            <span className={styles.pillSecondary}>{previewSecondary}</span>
          </div>
          {shouldCheckPreviewRunner && (
            <button
              type="button"
              className={styles.runsButton}
              onClick={() => setRunnerDialogOpen(true)}
              aria-label="App Flow Runner Runs anzeigen"
            >
              <ChevronDown className={styles.runsButtonIcon} aria-hidden="true" />
              Runs
            </button>
          )}
        </div>

        <div
          className={clsx(styles.pill, logsPillClass)}
          role="status"
          aria-live="polite"
          aria-label={
            logsLoading
              ? "Logs Runner wird geprüft"
              : isLogsOnline
                ? "Logs Runner aktiv"
                : "Logs Runner aus"
          }
        >
          <span className={styles.pillDot} aria-hidden="true" />
          <div className={styles.pillText}>
            <span className={styles.pillPrimary}>Logs Runner</span>
            <span className={styles.pillSecondary}>
              {logsLoading
                ? "Wird geprüft…"
                : isLogsOnline
                  ? (logsHealth?.baseUrl ?? "lokal")
                  : (logsHealth?.error ?? "Nicht erreichbar (localhost:5000)")}
            </span>
          </div>
        </div>
      </div>

      <Dialog open={runnerDialogOpen} onOpenChange={setRunnerDialogOpen}>
        <DialogContent className={styles.runnerDialogContent} data-visudev-modal="runner-runs">
          <DialogHeader>
            <DialogTitle>App Flow Runner – Runs</DialogTitle>
            <DialogDescription>
              {activeProjectId ? `Projekt: ${activeProjectId}` : "Kein aktives Projekt ausgewählt."}
              {runnerRunsSnapshot?.baseUrl ? ` · ${runnerRunsSnapshot.baseUrl}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className={styles.runnerDialogToolbar}>
            <button
              type="button"
              className={styles.runnerDialogButton}
              onClick={() => void loadRunnerRuns(true)}
              disabled={runnerRunsLoading}
            >
              <RefreshCw
                className={clsx(styles.runnerDialogButtonIcon, runnerRunsLoading && styles.spin)}
                aria-hidden="true"
              />
              Aktualisieren
            </button>
            <button
              type="button"
              className={styles.runnerDialogButton}
              onClick={() => void copyRunsToClipboard()}
              disabled={runsForDialog.length === 0}
            >
              {runsCopied ? (
                <Check className={styles.runnerDialogButtonIcon} aria-hidden="true" />
              ) : (
                <Copy className={styles.runnerDialogButtonIcon} aria-hidden="true" />
              )}
              {runsCopied ? "Kopiert" : "Kopieren"}
            </button>
          </div>
          {!shouldCheckPreviewRunner ? (
            <div className={styles.runnerDialogEmpty}>
              Lokaler Runner ist im aktuellen Preview-Modus nicht aktiv.
            </div>
          ) : runnerRunsLoading && !runnerRunsSnapshot ? (
            <div className={styles.runnerDialogEmpty}>
              <Loader2
                className={clsx(styles.runnerDialogButtonIcon, styles.spin)}
                aria-hidden="true"
              />{" "}
              Lade Runner-Runs …
            </div>
          ) : !runnerRunsSnapshot?.reachable ? (
            <div className={styles.runnerDialogError}>
              {runnerRunsSnapshot?.error ?? "Runner-Runs konnten nicht geladen werden."}
            </div>
          ) : (
            <>
              <div className={styles.runnerDialogStats}>
                <span>Total: {runsTotals?.total ?? runsForDialog.length}</span>
                <span>Aktiv: {runsTotals?.active ?? 0}</span>
                <span>Ready: {runsTotals?.ready ?? 0}</span>
                <span>Starting: {runsTotals?.starting ?? 0}</span>
                <span>Failed: {runsTotals?.failed ?? 0}</span>
                <span>Stopped: {runsTotals?.stopped ?? 0}</span>
              </div>
              <div className={styles.runnerRunsList}>
                {runsForDialog.length === 0 ? (
                  <div className={styles.runnerDialogEmpty}>Keine Runs vorhanden.</div>
                ) : (
                  runsForDialog.map((run) => (
                    <div key={run.runId} className={styles.runnerRunCard}>
                      <div className={styles.runnerRunHeader}>
                        <span className={styles.runnerRunId}>{run.runId}</span>
                        <span
                          className={clsx(
                            styles.runnerRunStatus,
                            run.status === "ready" && styles.runnerRunStatusReady,
                            run.status === "starting" && styles.runnerRunStatusStarting,
                            run.status === "failed" && styles.runnerRunStatusFailed,
                            run.status === "stopped" && styles.runnerRunStatusStopped,
                          )}
                        >
                          {run.status}
                        </span>
                      </div>
                      <div className={styles.runnerRunMeta}>
                        <span>Repo: {run.repo || "—"}</span>
                        <span>Ref: {run.branchOrCommit || "—"}</span>
                        <span>Preview: {run.previewUrl || "—"}</span>
                        <span>Start: {formatRunnerTime(run.startedAt)}</span>
                        <span>Ready: {formatRunnerTime(run.readyAt)}</span>
                        <span>Stop: {formatRunnerTime(run.stoppedAt)}</span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Download, Loader2, Map, Play, RefreshCw, Square, X } from "lucide-react";
import { useVisudev } from "../../../lib/visudev/store";
import {
  discoverPreviewRunner,
  getLocalPreviewRunnerHealth,
  type LocalPreviewRunnerHealth,
} from "../../../utils/api";
import { LiveFlowCanvas } from "../components/LiveFlowCanvas";
import styles from "../styles/AppFlowPage.module.css";

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

interface AppFlowPageProps {
  projectId: string;
  githubRepo?: string;
  githubBranch?: string;
}

type PendingPreviewAction = "start" | "restart" | "refresh" | null;

const PREVIEW_POLL_INTERVAL_MS = 2500;
const AUTO_PREVIEW_DELAY_MS = 800;
/** Nach dieser Zeit wird "starting" als fehlgeschlagen markiert. Sollte > Runner BUILD_TIMEOUT_MS (6 Min) sein, damit der Runner zuerst mit klarer Build-Timeout-Meldung antwortet. */
const PREVIEW_START_TIMEOUT_MS = 7 * 60 * 1000; // 7 Min

/** Format ISO timestamp as DD.MM.YYYY - HH:MM:SS for display in live app bar. */
function formatDateTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} - ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function AppFlowPage({ projectId, githubRepo, githubBranch }: AppFlowPageProps) {
  const {
    activeProject,
    scans,
    scanStatuses,
    startScan,
    preview,
    startPreview,
    refreshPreviewStatus,
    stopPreview,
    refreshPreview,
    markPreviewStuck,
  } = useVisudev();
  const [isRescan, setIsRescan] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [runnerHealth, setRunnerHealth] = useState<LocalPreviewRunnerHealth | null>(null);
  const [pendingPreviewAction, setPendingPreviewAction] = useState<PendingPreviewAction>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoPreviewDoneRef = useRef(false);
  const autoPreviewRetryAtRef = useRef(0);
  const startingActionRef = useRef<PendingPreviewAction>(null);

  const handleRescan = useCallback(async () => {
    setIsRescan(true);
    try {
      await startScan("appflow");
    } finally {
      setIsRescan(false);
    }
  }, [startScan]);

  const triggerPreviewAction = useCallback(
    (action: Exclude<PendingPreviewAction, null>, run: () => Promise<void>) => {
      setPendingPreviewAction(action);
      startingActionRef.current = action;
      void run().finally(() => {
        setPendingPreviewAction((current) => (current === action ? null : current));
      });
    },
    [],
  );

  const handlePreviewStart = useCallback(
    (action: "start" | "restart") => {
      triggerPreviewAction(action, async () => {
        await startPreview(
          projectId,
          activeProject?.github_repo,
          activeProject?.github_branch,
          activeProject?.lastAnalyzedCommitSha,
        );
      });
    },
    [
      activeProject?.github_branch,
      activeProject?.github_repo,
      activeProject?.lastAnalyzedCommitSha,
      projectId,
      startPreview,
      triggerPreviewAction,
    ],
  );

  const handlePreviewRefresh = useCallback(() => {
    triggerPreviewAction("refresh", async () => {
      await refreshPreview(projectId);
    });
  }, [projectId, refreshPreview, triggerPreviewAction]);

  // Auto-scan, sobald ein Projekt mit verbundenem Repo geladen ist und noch keine Screens (einmal pro Projekt)
  useEffect(() => {
    if (
      activeProject?.id === projectId &&
      activeProject?.github_repo &&
      activeProject.screens.length === 0 &&
      scanStatuses.appflow.status === "idle"
    ) {
      handleRescan();
    }
  }, [
    activeProject?.id,
    activeProject?.github_repo,
    activeProject?.screens?.length,
    projectId,
    scanStatuses.appflow.status,
    handleRescan,
  ]);

  // Zuerst Runner ermitteln (4000, 4100, …), danach Preview-Status – sonst erscheint „nicht erreichbar“, obwohl Runner läuft
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await discoverPreviewRunner();
      if (cancelled || !projectId) return;
      await refreshPreviewStatus(projectId);
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, refreshPreviewStatus]);

  // Wenn „Preview Runner nicht erreichbar“ angezeigt wird: periodisch Discovery + Status prüfen (Runner wurde nachträglich gestartet)
  const isRunnerUnreachable =
    preview.projectId === projectId &&
    preview.status === "failed" &&
    (preview.error?.includes("nicht erreichbar") ?? false);
  useEffect(() => {
    if (!isRunnerUnreachable || !projectId) return;
    const interval = setInterval(async () => {
      await discoverPreviewRunner();
      await refreshPreviewStatus(projectId);
    }, 10_000);
    return () => clearInterval(interval);
  }, [isRunnerUnreachable, projectId, refreshPreviewStatus]);

  // Runner-/Docker-Runtime-Status für UI-Hinweise (z. B. Docker fehlt im Docker-Modus).
  useEffect(() => {
    if (activeProject?.preview_mode === "deployed") {
      setRunnerHealth(null);
      return;
    }
    let cancelled = false;
    const tick = async () => {
      const health = await getLocalPreviewRunnerHealth();
      if (!cancelled) setRunnerHealth(health);
    };
    void tick();
    const interval = setInterval(() => {
      void tick();
    }, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeProject?.preview_mode, projectId]);

  // Auto-start preview when repo is connected (once per project; also when status not yet loaded)
  useEffect(() => {
    if (!activeProject?.github_repo || activeProject.id !== projectId) return;
    if (activeProject.preview_mode === "deployed") return;
    if (preview.status === "ready" || preview.status === "starting") {
      autoPreviewDoneRef.current = true;
      return;
    }
    if (autoPreviewDoneRef.current) return;
    const isIdle =
      preview.status === "idle" && (preview.projectId === null || preview.projectId === projectId);
    if (!isIdle) return;
    autoPreviewDoneRef.current = true;
    const t = setTimeout(() => {
      autoPreviewRetryAtRef.current = Date.now();
      void startPreview(
        projectId,
        activeProject.github_repo,
        activeProject.github_branch,
        activeProject.lastAnalyzedCommitSha,
      );
    }, AUTO_PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(t);
      autoPreviewDoneRef.current = false;
    };
  }, [
    projectId,
    activeProject?.id,
    activeProject?.github_repo,
    activeProject?.github_branch,
    activeProject?.lastAnalyzedCommitSha,
    activeProject?.preview_mode,
    preview.projectId,
    preview.status,
    startPreview,
  ]);

  // Reset retry button state when preview is failed again (after start attempt)
  useEffect(() => {
    if (preview.projectId === projectId && preview.status === "failed") {
      setIsRetrying(false);
    }
  }, [projectId, preview.projectId, preview.status]);

  useEffect(() => {
    if (preview.projectId !== projectId || preview.status !== "starting") {
      startingActionRef.current = null;
    }
  }, [projectId, preview.projectId, preview.status]);

  // Reset auto-preview flag when switching project
  useEffect(() => {
    autoPreviewDoneRef.current = false;
  }, [projectId]);

  // If preview falls back to idle for this project (e.g. runner restart), allow auto-start again.
  useEffect(() => {
    if (preview.projectId === projectId && preview.status === "idle") {
      autoPreviewDoneRef.current = false;
    }
  }, [projectId, preview.projectId, preview.status]);

  // Fallback: if preview is idle and no live URL is available, retry auto-start (throttled).
  useEffect(() => {
    if (!activeProject?.github_repo || activeProject.id !== projectId) return;
    if (activeProject.preview_mode === "deployed") return;
    if (autoPreviewDoneRef.current) return;
    const isIdle =
      preview.status === "idle" && (preview.projectId === null || preview.projectId === projectId);
    if (!isIdle) return;
    const hasLiveUrl =
      (preview.previewUrl != null && preview.previewUrl.trim() !== "") ||
      (activeProject.deployed_url != null && activeProject.deployed_url.trim() !== "");
    if (hasLiveUrl) return;
    const now = Date.now();
    if (now - autoPreviewRetryAtRef.current < 15_000) return;
    autoPreviewDoneRef.current = true;
    const t = setTimeout(() => {
      autoPreviewRetryAtRef.current = Date.now();
      void startPreview(
        projectId,
        activeProject.github_repo,
        activeProject.github_branch,
        activeProject.lastAnalyzedCommitSha,
      );
    }, AUTO_PREVIEW_DELAY_MS);
    return () => {
      clearTimeout(t);
      autoPreviewDoneRef.current = false;
    };
  }, [
    projectId,
    activeProject?.id,
    activeProject?.github_repo,
    activeProject?.github_branch,
    activeProject?.deployed_url,
    activeProject?.lastAnalyzedCommitSha,
    activeProject?.preview_mode,
    preview.projectId,
    preview.previewUrl,
    preview.status,
    startPreview,
  ]);

  // Poll preview status when starting
  useEffect(() => {
    if (preview.projectId === projectId && preview.status === "starting") {
      const tick = () => void refreshPreviewStatus(projectId);
      pollRef.current = setInterval(tick, PREVIEW_POLL_INTERVAL_MS);
      return () => {
        if (pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      };
    }
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [projectId, preview.projectId, preview.status, refreshPreviewStatus]);

  // Timeout: wenn "starting" zu lange (Runner/Build reagiert nicht), auf "failed" setzen
  useEffect(() => {
    if (preview.projectId !== projectId || preview.status !== "starting") return;
    const t = setTimeout(() => {
      void markPreviewStuck(
        projectId,
        "Timeout – Preview startet nicht. Bitte Runner (npm run dev) und ggf. Docker prüfen.",
      );
    }, PREVIEW_START_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [projectId, preview.projectId, preview.status, markPreviewStuck]);

  const handleExportJson = useCallback(() => {
    if (!activeProject) return;
    const data = {
      screens: activeProject.screens,
      flows: activeProject.flows,
    };
    downloadFile(JSON.stringify(data, null, 2), `appflow-${projectId}.json`, "application/json");
  }, [activeProject, projectId]);

  const handleExportMermaid = useCallback(() => {
    if (!activeProject) return;
    const id = (s: string) => s.replace(/\s+/g, "_").replace(/-/g, "_") || "n";
    const lines: string[] = ["flowchart LR"];
    const seen = new Set<string>();
    activeProject.screens.forEach((s) => {
      const n = id(s.name);
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(`  ${n}["${s.name}"]`);
      }
    });
    activeProject.flows.forEach((f) => {
      const from = id(f.name);
      f.calls.forEach((c) => {
        const to = id(c);
        lines.push(`  ${from} --> ${to}`);
      });
    });
    if (lines.length === 1) lines.push("  empty[Keine Flows]");
    downloadFile(lines.join("\n"), `appflow-${projectId}.md`, "text/markdown");
  }, [activeProject, projectId]);

  const analysisLogs = useMemo(() => {
    const appflowScans = scans
      .filter((scan) => scan.projectId === projectId && scan.scanType === "appflow")
      .sort((a, b) => {
        const bTs = Date.parse(b.startedAt);
        const aTs = Date.parse(a.startedAt);
        return (Number.isFinite(bTs) ? bTs : 0) - (Number.isFinite(aTs) ? aTs : 0);
      });
    return appflowScans[0]?.logs ?? [];
  }, [projectId, scans]);

  /** Last completed appflow analysis timestamp (for "Letzte Code-Analyse" in live app bar). */
  const lastAnalysisAt = useMemo(() => {
    const completed = scans
      .filter(
        (s) => s.projectId === projectId && s.scanType === "appflow" && s.completedAt != null,
      )
      .sort((a, b) =>
        (Date.parse(b.completedAt!) || 0) - (Date.parse(a.completedAt!) || 0),
      );
    return completed[0]?.completedAt ?? null;
  }, [projectId, scans]);

  /** Last time preview became ready (for "Letzter Preview-Start" in live app bar). */
  const lastPreviewReadyAt =
    preview.projectId === projectId ? preview.previewReadyAt ?? null : null;

  if (!activeProject) {
    return (
      <div className={styles.centerState}>
        <p className={styles.emptyTitle}>Kein Projekt ausgewählt</p>
      </div>
    );
  }

  const isScanning = scanStatuses.appflow.status === "running" || isRescan;
  const hasError = scanStatuses.appflow.status === "failed";
  const hasData = activeProject.screens.length > 0;

  // Live App Flow: nutzt Preview-URL (lokal gebaut) ODER Deployed URL als Fallback
  const previewReady =
    preview.projectId === projectId && preview.previewUrl && preview.status === "ready";
  const deployedUrl = activeProject.deployed_url?.trim() || null;
  const liveFlowBaseUrl = previewReady ? preview.previewUrl : deployedUrl;
  const liveFlowFromDeployed = !!deployedUrl && !previewReady;
  const previewMode = activeProject.preview_mode ?? "auto";
  const previewModeHint =
    previewMode === "local"
      ? "Preview-Modus: Lokal (Docker erforderlich)."
      : previewMode === "central"
        ? "Preview-Modus: Server (zentral). PREVIEW_RUNNER_URL in Supabase setzen."
        : previewMode === "deployed"
          ? "Preview-Modus: Deployed URL. Bitte im Projekt eine URL hinterlegen."
          : "Preview-Modus: Auto (lokal wenn verfügbar, sonst Server).";
  const isPreviewStartingForProject =
    preview.projectId === projectId && preview.status === "starting";
  const activeStartingAction = isPreviewStartingForProject ? startingActionRef.current : null;
  const isRefreshLoading = pendingPreviewAction === "refresh" || activeStartingAction === "refresh";
  const isRestartLoading =
    pendingPreviewAction === "restart" ||
    activeStartingAction === "restart" ||
    isPreviewStartingForProject;
  const isStartLoading =
    pendingPreviewAction === "start" ||
    activeStartingAction === "start" ||
    (isPreviewStartingForProject && !preview.previewUrl);
  const disablePreviewStartActions =
    pendingPreviewAction !== null || (isPreviewStartingForProject && activeStartingAction !== null);
  const showDockerMissingWarning =
    (previewMode === "local" || previewMode === "auto") &&
    runnerHealth?.useDocker === true &&
    runnerHealth.dockerAvailable === false;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>App Flow</h1>
            <p className={styles.subtitle}>
              {activeProject.name} • {activeProject.screens.length} Screens •{" "}
              {activeProject.flows.length} Flows
            </p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              onClick={handleExportJson}
              className={styles.secondaryButton}
              aria-label="App Flow als JSON exportieren"
            >
              <Download className={styles.inlineIcon} aria-hidden="true" />
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleExportMermaid}
              className={styles.secondaryButton}
              aria-label="App Flow als Mermaid exportieren"
            >
              <Download className={styles.inlineIcon} aria-hidden="true" />
              Export Mermaid
            </button>
            <button
              type="button"
              onClick={handleRescan}
              disabled={isScanning}
              className={styles.primaryButton}
            >
              {isScanning ? (
                <>
                  <Loader2
                    className={`${styles.inlineIcon} ${styles.spinner}`}
                    aria-hidden="true"
                  />
                  Analysiere...
                </>
              ) : (
                <>
                  <RefreshCw className={styles.inlineIcon} aria-hidden="true" />
                  Neu analysieren
                </>
              )}
            </button>
          </div>
        </div>

        {isScanning && (
          <div className={`${styles.statusBar} ${styles.statusInfo}`}>
            <Loader2 className={`${styles.inlineIcon} ${styles.spinner}`} aria-hidden="true" />
            <div>
              <p className={styles.statusTitle}>Code wird analysiert...</p>
              <p className={styles.statusMeta}>
                Repo: {githubRepo || "unknown"} @ {githubBranch || "main"}
              </p>
            </div>
          </div>
        )}

        {hasError && (
          <div className={`${styles.statusBar} ${styles.statusError}`}>
            <AlertCircle className={styles.inlineIcon} aria-hidden="true" />
            <div>
              <p className={styles.statusTitle}>Fehler bei der Analyse</p>
              <p className={styles.statusMeta}>
                {scanStatuses.appflow.error || "Unbekannter Fehler"}
              </p>
            </div>
          </div>
        )}

        {showDockerMissingWarning && (
          <div className={`${styles.statusBar} ${styles.statusError}`} role="status">
            <AlertCircle className={styles.inlineIcon} aria-hidden="true" />
            <div>
              <p className={styles.statusTitle}>Docker nicht erreichbar</p>
              <p className={styles.statusMeta}>
                Der Preview-Runner läuft im Docker-Modus, aber Docker antwortet nicht. Bitte Docker
                Desktop starten und danach <strong>Preview neu starten</strong>.
              </p>
              <p className={styles.statusMetaSecondary}>
                Runner: {runnerHealth?.baseUrl ?? "http://127.0.0.1:4000"}
              </p>
            </div>
          </div>
        )}

        {hasData && !liveFlowBaseUrl && (
          <div className={`${styles.statusBar} ${styles.statusInfo}`} role="status">
            <p className={styles.statusMeta}>
              {preview.projectId === projectId &&
              preview.status === "failed" &&
              preview.error?.includes("nicht erreichbar")
                ? "VisuDEV läuft nicht. Im VisuDEV-Projektordner im Terminal starten: "
                : "Für Inhalte in den Karten: "}
              {preview.projectId === projectId &&
              preview.status === "failed" &&
              preview.error?.includes("nicht erreichbar") ? (
                <>
                  <strong>
                    <code>npm run dev</code>
                  </strong>
                  , dann diese Seite neu laden. Danach reicht Repo verbinden – VisuDEV erledigt den
                  Rest.
                </>
              ) : (
                <>
                  <strong>Preview starten</strong> (Button bei „Sitemap") oder im Projekt eine{" "}
                  <strong>Deployed URL</strong> setzen. {previewModeHint}
                </>
              )}
            </p>
            {preview.projectId === projectId &&
              preview.status === "failed" &&
              preview.error &&
              !preview.error.includes("nicht erreichbar") && (
                <p className={styles.statusMetaSecondary}>
                  <strong>Grund:</strong> {preview.error}
                </p>
              )}
          </div>
        )}
      </div>

      <div className={styles.content}>
        {hasData ? (
          <div className={styles.liveAppWrap}>
            <div className={styles.liveAppBar}>
              <div className={styles.liveAppLabelBlock}>
                <span className={styles.liveAppLabel}>
                  Sitemap · {activeProject.screens.length} Screens · {activeProject.flows.length}{" "}
                  Flows
                  {liveFlowFromDeployed ? " (Deployed URL)" : " (Preview)"}
                  {liveFlowBaseUrl && (
                    <span className={styles.liveAppBarUrl} title="Basis-URL für die Karten">
                      {" "}
                      · {liveFlowBaseUrl}
                    </span>
                  )}
                </span>
                <span className={styles.liveAppLabelMeta}>
                  Letzte Code-Analyse: {formatDateTime(lastAnalysisAt) ?? "–"}
                  {" · "}
                  Letzter Preview-Start: {formatDateTime(lastPreviewReadyAt) ?? "–"}
                  {!liveFlowFromDeployed &&
                    activeProject.screens.length > 0 &&
                    ' · Unterschiedliche Inhalte pro Karte: Preview mit aktuellem Code (USE_LOCAL_WORKSPACE oder Push + "Preview aktualisieren").'}
                </span>
              </div>
              <div className={styles.liveAppBarRight}>
                {!liveFlowFromDeployed && (
                  <div className={styles.liveAppBarActions}>
                    {preview.projectId === projectId &&
                    (preview.status === "ready" || preview.status === "starting") ? (
                      <>
                        <button
                          type="button"
                          onClick={handlePreviewRefresh}
                          disabled={disablePreviewStartActions}
                          className={styles.secondaryButton}
                          aria-label="Preview aktualisieren (Pull, Rebuild, Restart)"
                        >
                          {isRefreshLoading ? (
                            <Loader2
                              className={`${styles.inlineIcon} ${styles.spinner}`}
                              aria-hidden="true"
                            />
                          ) : (
                            <RefreshCw className={styles.inlineIcon} aria-hidden="true" />
                          )}
                          {isRefreshLoading ? "Aktualisiere…" : "Preview aktualisieren"}
                        </button>
                        <button
                          type="button"
                          onClick={() => stopPreview(projectId)}
                          className={styles.secondaryButton}
                          aria-label="Preview beenden"
                        >
                          <Square className={styles.inlineIcon} aria-hidden="true" />
                          Preview beenden
                        </button>
                        <button
                          type="button"
                          onClick={() => handlePreviewStart("restart")}
                          disabled={disablePreviewStartActions}
                          className={styles.secondaryButton}
                          aria-label="Preview neu starten (frischer Start)"
                        >
                          {isRestartLoading ? (
                            <Loader2
                              className={`${styles.inlineIcon} ${styles.spinner}`}
                              aria-hidden="true"
                            />
                          ) : (
                            <Play className={styles.inlineIcon} aria-hidden="true" />
                          )}
                          {isRestartLoading ? "Starte neu…" : "Preview neu starten"}
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handlePreviewStart("start")}
                        disabled={disablePreviewStartActions}
                        className={styles.secondaryButton}
                        aria-label="Preview starten"
                      >
                        {isStartLoading ? (
                          <Loader2
                            className={`${styles.inlineIcon} ${styles.spinner}`}
                            aria-hidden="true"
                          />
                        ) : (
                          <Play className={styles.inlineIcon} aria-hidden="true" />
                        )}
                        {isStartLoading ? "Starte…" : "Preview starten"}
                      </button>
                    )}
                  </div>
                )}
                {liveFlowFromDeployed && (
                  <p className={styles.liveAppBarHint}>
                    Inhalte kommen von der Deployed URL. Für lokale Preview: Repo verbinden und
                    Preview starten.
                  </p>
                )}
              </div>
            </div>
            <LiveFlowCanvas
              screens={activeProject.screens}
              flows={activeProject.flows}
              previewUrl={liveFlowBaseUrl ?? ""}
              previewRunId={preview.projectId === projectId ? preview.runId : null}
              analysisLogs={analysisLogs}
              projectId={projectId}
              previewError={
                preview.projectId === projectId && preview.status === "failed"
                  ? preview.error
                  : null
              }
              refreshInProgress={preview.projectId === projectId && preview.status === "starting"}
              refreshLogs={preview.projectId === projectId ? preview.refreshLogs : undefined}
            />
          </div>
        ) : (
          <div className={styles.previewOnly}>
            {drawerOpen && (
              <div className={styles.drawer}>
                <div className={styles.drawerHeader}>
                  <span className={styles.drawerTitle}>Sitemap & Flow Graph</span>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(false)}
                    className={styles.drawerClose}
                    aria-label="Panel schließen"
                  >
                    <X className={styles.inlineIcon} aria-hidden="true" />
                  </button>
                </div>
                <div className={styles.drawerBody}>
                  {isScanning ? (
                    <div className={styles.centerState}>
                      <Loader2
                        className={`${styles.emptyIcon} ${styles.spinner}`}
                        aria-hidden="true"
                      />
                      <p className={styles.emptyTitle}>Code wird analysiert...</p>
                    </div>
                  ) : (
                    <div className={styles.centerState}>
                      <p className={styles.emptyTitle}>Noch keine Flows</p>
                      <button
                        type="button"
                        onClick={handleRescan}
                        disabled={isScanning}
                        className={styles.primaryButton}
                      >
                        <RefreshCw className={styles.inlineIcon} aria-hidden="true" />
                        Scan starten
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className={styles.previewMain}>
              {preview.projectId === projectId && preview.previewUrl ? (
                <div className={styles.liveAppWrap}>
                  <div className={styles.liveAppBar}>
                    <span className={styles.liveAppLabel}>Live App (Preview)</span>
                    <div className={styles.liveAppBarActions}>
                      <button
                        type="button"
                        onClick={() => setDrawerOpen(!drawerOpen)}
                        className={styles.secondaryButton}
                        aria-label={drawerOpen ? "Sitemap schließen" : "Sitemap & Flow Graph"}
                      >
                        <Map className={styles.inlineIcon} aria-hidden="true" />
                        {drawerOpen ? "Sitemap schließen" : "Sitemap & Flow Graph"}
                      </button>
                      <button
                        type="button"
                        onClick={() => stopPreview(projectId)}
                        className={styles.secondaryButton}
                        aria-label="Preview beenden"
                      >
                        <Square className={styles.inlineIcon} aria-hidden="true" />
                        Preview beenden
                      </button>
                    </div>
                  </div>
                  <iframe
                    src={preview.previewUrl}
                    title="Live App Preview"
                    className={styles.liveAppIframe}
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                  />
                </div>
              ) : preview.projectId === projectId && preview.status === "starting" ? (
                <div className={styles.liveAppPlaceholder}>
                  <Loader2 className={`${styles.emptyIcon} ${styles.spinner}`} aria-hidden="true" />
                  <p className={styles.emptyTitle}>Preview wird gestartet...</p>
                  <p className={styles.emptyHint}>VisuDEV baut und startet die App aus dem Repo.</p>
                </div>
              ) : preview.projectId === projectId && preview.status === "failed" ? (
                <div className={styles.liveAppPlaceholder}>
                  <AlertCircle className={styles.emptyIcon} aria-hidden="true" />
                  <p className={styles.emptyTitle}>Preview fehlgeschlagen</p>
                  <p className={styles.emptyHint}>{preview.error ?? "Unbekannter Fehler"}</p>
                  <button
                    type="button"
                    disabled={isRetrying}
                    onClick={() => {
                      setIsRetrying(true);
                      void startPreview(
                        projectId,
                        activeProject?.github_repo,
                        activeProject?.github_branch,
                        activeProject?.lastAnalyzedCommitSha,
                      );
                    }}
                    className={styles.primaryButton}
                    aria-busy={isRetrying}
                    aria-label="Preview erneut starten"
                  >
                    {isRetrying ? (
                      <Loader2
                        className={`${styles.inlineIcon} ${styles.spinner}`}
                        aria-hidden="true"
                      />
                    ) : (
                      <RefreshCw className={styles.inlineIcon} aria-hidden="true" />
                    )}
                    {isRetrying ? "Starte…" : "Erneut versuchen"}
                  </button>
                </div>
              ) : (
                <div className={styles.liveAppPlaceholder}>
                  <p className={styles.emptyTitle}>Live App</p>
                  <p className={styles.emptyHint}>
                    Die App aus dem Repo wird automatisch gestartet. Falls nicht, unten starten.
                  </p>
                  {activeProject?.github_repo ? (
                    <button
                      type="button"
                      onClick={() => handlePreviewStart("start")}
                      disabled={disablePreviewStartActions}
                      className={styles.primaryButton}
                      aria-label="Preview starten"
                    >
                      {isStartLoading ? (
                        <Loader2
                          className={`${styles.inlineIcon} ${styles.spinner}`}
                          aria-hidden="true"
                        />
                      ) : (
                        <Play className={styles.inlineIcon} aria-hidden="true" />
                      )}
                      {isStartLoading ? "Starte…" : "Preview starten"}
                    </button>
                  ) : (
                    <p className={styles.emptyHint}>
                      Verbinde ein GitHub-Repo in Settings → Projekt-Anbindungen.
                    </p>
                  )}
                </div>
              )}
              {(!preview.previewUrl || preview.projectId !== projectId) && (
                <div className={styles.previewToolbar}>
                  <button
                    type="button"
                    onClick={() => setDrawerOpen(!drawerOpen)}
                    className={styles.secondaryButton}
                    aria-label={drawerOpen ? "Sitemap schließen" : "Sitemap & Flow Graph anzeigen"}
                  >
                    <Map className={styles.inlineIcon} aria-hidden="true" />
                    {drawerOpen ? "Sitemap schließen" : "Sitemap & Flow Graph"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

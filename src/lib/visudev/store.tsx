/* eslint-disable react-refresh/only-export-components */
import React, {
  createContext,
  useContext,
  useState,
  useRef,
  ReactNode,
  useCallback,
  useEffect,
} from "react";
import type { AnalyzerResponse, AnalyzerScreenshotsResponse } from "./analyzer";
import {
  AnalysisResult,
  Project,
  ScanResult,
  ScanStatuses,
  Screen,
  ScreenshotStatus,
  StepLogEntry,
} from "./types";
import type { PreviewMode, PreviewStatus } from "./types";
import { publicAnonKey, supabaseUrl } from "../../utils/supabase/info";
import { api, previewAPI, type PreviewStepLog } from "../../utils/api";

export type { PreviewStepLog };

export interface PreviewState {
  projectId: string | null;
  runId: string | null;
  status: PreviewStatus;
  previewUrl: string | null;
  error: string | null;
  /** Schritte vom Preview-Runner (Start/Refresh): Git, Build, Start, Bereit. */
  refreshLogs: PreviewStepLog[];
}

interface VisudevStore {
  // Projects
  projects: Project[];
  projectsLoading: boolean;
  setProjectsLoading: (loading: boolean) => void;
  activeProject: Project | null;
  setActiveProject: (project: Project | null) => void;
  addProject: (
    project: Omit<Project, "id" | "createdAt" | "screens" | "flows">,
  ) => Promise<Project>;
  updateProject: (project: Project) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  loadProjects: () => Promise<void>;

  // Scans
  scans: ScanResult[];
  scanStatuses: ScanStatuses;
  startScan: (scanType: "appflow" | "blueprint" | "data" | "all") => Promise<void>;
  refreshScanStatus: () => Promise<void>;

  // Preview (Live App)
  preview: PreviewState;
  startPreview: (
    projectId: string,
    repo?: string,
    branchOrCommit?: string,
    commitSha?: string,
  ) => Promise<void>;
  refreshPreviewStatus: (projectId: string) => Promise<PreviewStatus | undefined>;
  refreshPreview: (projectId: string) => Promise<void>;
  stopPreview: (projectId: string) => Promise<void>;
  /** Set preview to failed when stuck in "starting" (e.g. timeout). */
  markPreviewStuck: (projectId: string, error: string) => Promise<void>;
  /** Set access token for preview Edge API (central mode). Call with session?.access_token when user logs in. */
  setPreviewAccessToken: (token: string | null) => void;
}

const VisudevContext = createContext<VisudevStore | null>(null);

/** Projekt aus API-Response normalisieren (screens/flows immer Arrays). */
function normalizeProject(p: Record<string, unknown> & { id: string }): Project {
  return {
    ...p,
    id: p.id,
    screens: Array.isArray(p.screens) ? (p.screens as Project["screens"]) : [],
    flows: Array.isArray(p.flows) ? (p.flows as Project["flows"]) : [],
  } as Project;
}

function apiErrorMsg(err: unknown): string {
  if (typeof err === "string") return err;
  if (err && typeof err === "object" && "message" in err)
    return String((err as { message: unknown }).message);
  return "Request failed";
}

export function VisudevProvider({ children }: { children: ReactNode }) {
  const makePreviewLog = useCallback((message: string): PreviewStepLog => {
    return { time: new Date().toISOString(), message };
  }, []);
  const previewAccessTokenRef = useRef<string | null>(null);
  const setPreviewAccessToken = useCallback((token: string | null) => {
    previewAccessTokenRef.current = token;
  }, []);

  const [projects, setProjects] = useState<Project[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [activeProject, setActiveProjectState] = useState<Project | null>(null);
  const [scans, setScans] = useState<ScanResult[]>([]);
  const [scanStatuses, setScanStatuses] = useState<ScanStatuses>({
    appflow: { status: "idle", progress: 0 },
    blueprint: { status: "idle", progress: 0 },
    data: { status: "idle", progress: 0 },
  });
  const [preview, setPreview] = useState<PreviewState>({
    projectId: null,
    runId: null,
    status: "idle",
    previewUrl: null,
    error: null,
    refreshLogs: [],
  });

  const getProjectPreviewMode = useCallback(
    (projectId: string): PreviewMode =>
      projects.find((project) => project.id === projectId)?.preview_mode ?? "auto",
    [projects],
  );

  const setActiveProject = useCallback((project: Project | null) => {
    setActiveProjectState(project);
  }, []);

  const loadProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const res = await api.projects.getAll();
      if (res.success && Array.isArray(res.data)) {
        setProjects(
          res.data.map((p) =>
            normalizeProject(p as unknown as Record<string, unknown> & { id: string }),
          ),
        );
      } else {
        setProjects([]);
      }
    } catch {
      setProjects([]);
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const addProject = useCallback(
    async (
      projectData: Omit<Project, "id" | "createdAt" | "screens" | "flows">,
    ): Promise<Project> => {
      const res = await api.projects.create(projectData);
      if (!res.success) throw new Error(apiErrorMsg(res.error));
      const raw = res.data as unknown as (Record<string, unknown> & { id: string }) | undefined;
      if (!raw?.id) throw new Error("Projekt wurde nicht zurückgegeben.");
      const newProject = normalizeProject(raw);
      setProjects((prev) => [...prev, newProject]);
      return newProject;
    },
    [],
  );

  // Auto-activate first project when list has items
  useEffect(() => {
    if (projects.length > 0 && !activeProject) {
      setActiveProject(projects[0]);
    }
  }, [projects, activeProject, setActiveProject]);

  const updateProject = useCallback(async (project: Project) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit from payload
    const { id, createdAt, updatedAt, ...payload } = project;
    const res = await api.projects.update(id, payload);
    if (!res.success) throw new Error(apiErrorMsg(res.error));
    const raw = res.data as unknown as (Record<string, unknown> & { id: string }) | undefined;
    const updated = raw ? normalizeProject(raw) : project;
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    setActiveProjectState((current) => (current?.id === updated.id ? updated : current));
  }, []);

  const deleteProject = useCallback(async (id: string) => {
    const res = await api.projects.delete(id);
    if (!res.success) throw new Error(apiErrorMsg(res.error));
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setActiveProjectState((current) => (current?.id === id ? null : current));
    setScans((prev) => prev.filter((s) => s.projectId !== id));
  }, []);

  const refreshScanStatus = useCallback(async () => {
    // In local-only mode, scan status is already in state
    // This function is a no-op for compatibility
  }, []);

  const startScan = useCallback(
    async (scanType: "appflow" | "blueprint" | "data" | "all") => {
      if (!activeProject) {
        console.warn("⚠️ [VisuDEV] No active project to scan");
        return;
      }

      const scanTypes =
        scanType === "all" ? (["appflow", "blueprint", "data"] as const) : [scanType];

      for (const type of scanTypes) {
        const scanId = crypto.randomUUID();
        const timestamp = new Date().toISOString();
        const repoLabel = activeProject.github_repo ?? "unknown";
        const branchLabel = activeProject.github_branch ?? "main";
        const makeScanLog = (
          message: string,
          logType: StepLogEntry["type"] = "info",
        ): StepLogEntry => ({
          time: new Date().toISOString(),
          message,
          type: logType,
        });
        const appendScanLog = (message: string, logType: StepLogEntry["type"] = "info") => {
          setScans((prev) =>
            prev.map((scan) =>
              scan.id === scanId
                ? {
                    ...scan,
                    logs: [...(scan.logs ?? []), makeScanLog(message, logType)],
                  }
                : scan,
            ),
          );
        };

        // Set status to running
        setScanStatuses((prev) => ({
          ...prev,
          [type]: { status: "running", progress: 10, message: "Analyse gestartet" },
        }));

        // Create scan record
        const newScan: ScanResult = {
          id: scanId,
          projectId: activeProject.id,
          scanType: type,
          status: "running",
          progress: 10,
          startedAt: timestamp,
          logs: [
            makeScanLog(
              `Analyse gestartet (${type}) – Repo: ${repoLabel} @ ${branchLabel}`,
              "info",
            ),
          ],
        };

        setScans((prev) => [...prev, newScan]);
        appendScanLog("Analyzer-Request wird gesendet …", "info");

        try {
          // ONLY call visudev-analyzer Edge Function for code analysis
          const analyzeResponse = await fetch(
            `${supabaseUrl}/functions/v1/visudev-analyzer/analyze`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${publicAnonKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                repo: activeProject.github_repo ?? "",
                branch: activeProject.github_branch ?? "main",
              }),
            },
          );

          setScanStatuses((prev) => ({
            ...prev,
            [type]: { status: "running", progress: 50, message: "Analyzer-Antwort empfangen" },
          }));

          if (!analyzeResponse.ok) {
            const errorText = await analyzeResponse.text();
            console.error(`❌ [VisuDEV] Analyzer error response:`, errorText);
            appendScanLog(
              `Analyzer fehlgeschlagen (${analyzeResponse.status}): ${errorText || "keine Details"}`,
              "error",
            );
            throw new Error(`Analyzer returned ${analyzeResponse.status}: ${errorText}`);
          }

          const analysisData = (await analyzeResponse.json()) as AnalyzerResponse;
          if (!analysisData.success || !analysisData.data) {
            appendScanLog(
              `Analyzer lieferte keine Daten: ${analysisData.error || "unbekannter Fehler"}`,
              "error",
            );
            throw new Error(analysisData.error || "Analyzer returned no data");
          }
          appendScanLog(
            `Analyzer erfolgreich: ${analysisData.data.screens?.length ?? 0} Screens, ${analysisData.data.flows?.length ?? 0} Flows.`,
            "success",
          );
          if (analysisData.data.commitSha) {
            appendScanLog(`Analyzed commit: ${analysisData.data.commitSha}`, "info");
          }

          // Step: Capture screenshots for all detected screens
          let screensWithScreenshots: Screen[] = analysisData.data.screens || [];

          const getPlaceholderUrl = (screen: Screen) =>
            `https://placehold.co/1200x800/1a1a1a/03ffa3?text=${encodeURIComponent(screen.name)}`;
          const applyPlaceholderScreens = (screens: Screen[]) =>
            screens.map((screen) => ({
              ...screen,
              screenshotUrl: getPlaceholderUrl(screen),
              screenshotStatus: "failed" as ScreenshotStatus,
            }));

          // ✅ TRY to capture screenshots, but fallback to placeholders on error
          if (activeProject.deployed_url && screensWithScreenshots.length > 0) {
            appendScanLog(
              `Screenshot-Phase gestartet (${screensWithScreenshots.length} Screen(s)) über ${activeProject.deployed_url}.`,
              "info",
            );
            try {
              const screenshotResponse = await fetch(
                `${supabaseUrl}/functions/v1/visudev-analyzer/screenshots`,
                {
                  method: "POST",
                  headers: {
                    Authorization: `Bearer ${publicAnonKey}`,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    projectId: activeProject.id,
                    baseUrl: activeProject.deployed_url,
                    screens: screensWithScreenshots,
                  }),
                },
              );

              if (screenshotResponse.ok) {
                const screenshotData =
                  (await screenshotResponse.json()) as AnalyzerScreenshotsResponse;
                const results = screenshotData.data?.results ?? [];
                if (!screenshotData.success || !screenshotData.data) {
                  appendScanLog(
                    "Screenshot-Service gab kein valides Ergebnis zurück – nutze Platzhalterbilder.",
                    "error",
                  );
                  screensWithScreenshots = applyPlaceholderScreens(screensWithScreenshots);
                } else {
                  // Map screenshot URLs to screens
                  screensWithScreenshots = screensWithScreenshots.map((screen) => {
                    const result = results.find((item) => item.screenId === screen.id);
                    const status: ScreenshotStatus = result?.status === "ok" ? "ok" : "failed";
                    return {
                      ...screen,
                      screenshotUrl: result?.url ?? getPlaceholderUrl(screen),
                      screenshotStatus: status,
                    };
                  });
                  const okCount = screensWithScreenshots.filter(
                    (screen) => screen.screenshotStatus === "ok",
                  ).length;
                  const failedCount = screensWithScreenshots.length - okCount;
                  appendScanLog(
                    `Screenshots abgeschlossen: ${okCount} erfolgreich, ${failedCount} fehlgeschlagen.`,
                    failedCount > 0 ? "info" : "success",
                  );
                }
              } else {
                const errorText = await screenshotResponse.text();
                console.warn(
                  `⚠️ [VisuDEV] Screenshot API failed (${screenshotResponse.status}): ${errorText}`,
                );
                appendScanLog(
                  `Screenshot-API fehlgeschlagen (${screenshotResponse.status}) – nutze Platzhalterbilder.`,
                  "error",
                );
                // Fallback to placeholders
                screensWithScreenshots = applyPlaceholderScreens(screensWithScreenshots);
              }
            } catch (screenshotError) {
              const message =
                screenshotError instanceof Error
                  ? screenshotError.message
                  : String(screenshotError);
              console.error(`❌ [VisuDEV] Screenshot capture failed:`, message);
              appendScanLog(
                `Screenshot-Erfassung fehlgeschlagen (${message}) – nutze Platzhalterbilder.`,
                "error",
              );
              // Fallback to placeholders
              screensWithScreenshots = applyPlaceholderScreens(screensWithScreenshots);
            }
          } else {
            // No deployed URL - use placeholders
            screensWithScreenshots = applyPlaceholderScreens(screensWithScreenshots);
            if (!activeProject.deployed_url) {
              appendScanLog(
                "Keine Deployed-URL gesetzt – Screenshots werden als Platzhalter erzeugt.",
                "info",
              );
            } else {
              appendScanLog("Keine Screens erkannt – Screenshot-Phase übersprungen.", "info");
            }
          }

          // Transform analyzer result into AnalysisResult
          const result: AnalysisResult = {
            screens: screensWithScreenshots,
            flows: analysisData.data.flows || activeProject.flows,
            stats: {
              totalScreens: screensWithScreenshots.length,
              totalFlows: (analysisData.data.flows || activeProject.flows).length,
              maxDepth: Math.max(...screensWithScreenshots.map((screen) => screen.depth ?? 0), 0),
            },
          };

          // Update project with new screens/flows and analysis commit (for C1: Preview at exact SHA)
          const updatedProject: Project = {
            ...activeProject,
            screens: result.screens,
            flows: result.flows,
            lastAnalyzedCommitSha:
              analysisData.data.commitSha ?? activeProject.lastAnalyzedCommitSha,
          };

          updateProject(updatedProject);
          appendScanLog(
            `Analyse abgeschlossen: ${result.stats.totalScreens} Screens, ${result.stats.totalFlows} Flows, maxDepth ${result.stats.maxDepth}.`,
            "success",
          );

          // Update scan record
          setScans((prev) =>
            prev.map((scan) =>
              scan.id === scanId
                ? {
                    ...scan,
                    status: "completed",
                    progress: 100,
                    result,
                    completedAt: new Date().toISOString(),
                  }
                : scan,
            ),
          );

          setScanStatuses((prev) => ({
            ...prev,
            [type]: { status: "completed", progress: 100, message: "Analyse abgeschlossen" },
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`❌ [VisuDEV] ${type} scan failed:`, message);
          appendScanLog(`Analyse fehlgeschlagen: ${message || "Unknown error"}`, "error");

          // Update scan record with error
          setScans((prev) =>
            prev.map((scan) =>
              scan.id === scanId
                ? {
                    ...scan,
                    status: "failed",
                    progress: 0,
                    errorMessage: message || "Unknown error",
                    completedAt: new Date().toISOString(),
                  }
                : scan,
            ),
          );

          setScanStatuses((prev) => ({
            ...prev,
            [type]: {
              status: "failed",
              progress: 0,
              message: "Analyse fehlgeschlagen",
              error: message || "Analysis failed",
            },
          }));

          // Use existing sample data as fallback
        }
      }
    },
    [activeProject, updateProject],
  );

  const startPreview = useCallback(
    async (projectId: string, repo?: string, branchOrCommit?: string, commitSha?: string) => {
      const setPreviewError = (error: string) => {
        setPreview((prev) => ({
          ...prev,
          projectId,
          runId: null,
          status: "failed" as const,
          error,
          previewUrl: null,
        }));
      };
      const previewMode = getProjectPreviewMode(projectId);
      if (previewMode === "deployed") {
        setPreviewError("Preview-Modus ist 'Deployed URL'. Bitte eine URL im Projekt setzen.");
        return;
      }
      if (repo) {
        if (repo.startsWith("http://") || repo.startsWith("https://")) {
          setPreviewError("Repo als 'owner/repo' angeben, keine URL.");
          return;
        }
        if (!repo.includes("/")) {
          setPreviewError("Repo-Format: owner/repo (z. B. user/my-app).");
          return;
        }
      }
      const branch = (branchOrCommit ?? "").trim();
      if (branch.startsWith("-")) {
        setPreviewError("Branch darf nicht mit - beginnen (z. B. -h, --help).");
        return;
      }
      setPreview((prev) => ({
        ...prev,
        projectId,
        runId: null,
        status: "starting",
        previewUrl: null,
        error: null,
        refreshLogs: [
          makePreviewLog(`Start angefordert (${repo ?? "owner/repo"} @ ${branch || "main"})`),
        ],
      }));
      await new Promise((r) => setTimeout(r, 0));
      try {
        const res = await previewAPI.start(
          projectId,
          {
            repo,
            branchOrCommit,
            commitSha,
            accessToken: previewAccessTokenRef.current ?? undefined,
          },
          getProjectPreviewMode(projectId),
        );
        if (!res.success) {
          setPreview((prev) =>
            prev.projectId === projectId
              ? {
                  ...prev,
                  status: "failed",
                  error: res.error ?? "Start failed",
                  refreshLogs: [
                    ...prev.refreshLogs,
                    makePreviewLog(`Fehlgeschlagen (Start): ${res.error ?? "Start failed"}`),
                  ],
                }
              : prev,
          );
          return;
        }
        const nextRunId = res.data?.runId ?? null;
        const nextStatusRaw = res.data?.status;
        const nextStatus: PreviewStatus =
          nextStatusRaw === "idle" ||
          nextStatusRaw === "starting" ||
          nextStatusRaw === "ready" ||
          nextStatusRaw === "failed" ||
          nextStatusRaw === "stopped"
            ? nextStatusRaw
            : "starting";
        const startMessage =
          res.data?.reusedExistingRun === true
            ? `Start wiederverwendet. Aktiver Run: ${nextRunId ?? "unbekannt"} (${nextStatus}).`
            : `Start akzeptiert. Run: ${nextRunId ?? "unbekannt"}. Warte auf Build/Runner-Status …`;
        setPreview((prev) =>
          prev.projectId === projectId
            ? {
                ...prev,
                runId: nextRunId ?? prev.runId,
                status: nextStatus,
                refreshLogs: [...prev.refreshLogs, makePreviewLog(startMessage)],
              }
            : prev,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setPreview((prev) =>
          prev.projectId === projectId
            ? {
                ...prev,
                status: "failed",
                error: message || "Start failed",
                refreshLogs: [
                  ...prev.refreshLogs,
                  makePreviewLog(`Fehlgeschlagen (Start): ${message || "Start failed"}`),
                ],
              }
            : prev,
        );
      }
      // Keep status "starting"; UI will poll refreshPreviewStatus
    },
    [getProjectPreviewMode, makePreviewLog],
  );

  const refreshPreviewStatus = useCallback(
    async (projectId: string): Promise<PreviewStatus | undefined> => {
      let res: Awaited<ReturnType<typeof previewAPI.status>>;
      try {
        res = await previewAPI.status(
          projectId,
          getProjectPreviewMode(projectId),
          previewAccessTokenRef.current ?? undefined,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setPreview((prev) =>
          prev.projectId === projectId && prev.status === "starting"
            ? {
                ...prev,
                status: "failed" as const,
                error: message,
                previewUrl: null,
                refreshLogs: [
                  ...prev.refreshLogs,
                  makePreviewLog(`Fehlgeschlagen (Status): ${message}`),
                ],
              }
            : prev,
        );
        return undefined;
      }
      if (!res.success) {
        const error = (res as { error?: string }).error ?? "Status-Abfrage fehlgeschlagen";
        setPreview((prev) =>
          prev.projectId === projectId && prev.status === "starting"
            ? {
                ...prev,
                status: "failed" as const,
                error,
                previewUrl: null,
                refreshLogs: [
                  ...prev.refreshLogs,
                  makePreviewLog(`Fehlgeschlagen (Status): ${error}`),
                ],
              }
            : prev,
        );
        return undefined;
      }
      const payload = res as {
        runId?: string | null;
        status?: PreviewStatus;
        previewUrl?: string | null;
        error?: string | null;
        logs?: PreviewStepLog[];
      };
      const status = (payload.status as PreviewStatus) ?? "idle";
      const payloadRunId =
        typeof payload.runId === "string" && payload.runId.trim() ? payload.runId : null;
      const logs = Array.isArray(payload.logs) ? payload.logs : [];
      setPreview((prev) =>
        prev.projectId !== projectId
          ? prev
          : prev.status === "failed" && status === "starting"
            ? {
                ...prev,
                // Do not override a local timeout/failure with stale "starting" responses.
                runId: payloadRunId ?? prev.runId,
                error: payload.error ?? prev.error,
                refreshLogs: logs.length > 0 ? logs : prev.refreshLogs,
              }
            : {
                ...prev,
                runId:
                  status === "idle" || status === "stopped" ? null : (payloadRunId ?? prev.runId),
                status,
                previewUrl: status === "failed" ? null : (payload.previewUrl ?? prev.previewUrl),
                error: payload.error ?? prev.error,
                refreshLogs: logs.length > 0 ? logs : prev.refreshLogs,
              },
      );
      return status;
    },
    [getProjectPreviewMode, makePreviewLog],
  );

  const stopPreview = useCallback(
    async (projectId: string) => {
      try {
        await previewAPI.stop(
          projectId,
          getProjectPreviewMode(projectId),
          previewAccessTokenRef.current ?? undefined,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn("[VisuDEV] stopPreview failed (state reset anyway):", msg);
      } finally {
        setPreview((prev) =>
          prev.projectId === projectId
            ? {
                ...prev,
                runId: null,
                status: "stopped",
                previewUrl: null,
                error: null,
                refreshLogs: [],
              }
            : prev,
        );
      }
    },
    [getProjectPreviewMode],
  );

  const refreshPreview = useCallback(
    async (projectId: string) => {
      setPreview((prev) =>
        prev.projectId === projectId
          ? {
              ...prev,
              status: "starting",
              error: null,
              refreshLogs: [...prev.refreshLogs, makePreviewLog("Refresh angefordert …")],
            }
          : prev,
      );
      const res = await previewAPI.refresh(projectId, getProjectPreviewMode(projectId));
      if (!res.success) {
        setPreview((prev) =>
          prev.projectId === projectId
            ? {
                ...prev,
                status: "failed",
                error: res.error ?? "Refresh failed",
                refreshLogs: [
                  ...prev.refreshLogs,
                  makePreviewLog(`Fehlgeschlagen (Refresh): ${res.error ?? "Refresh failed"}`),
                ],
              }
            : prev,
        );
        return;
      }
      setPreview((prev) =>
        prev.projectId === projectId
          ? {
              ...prev,
              status: "starting",
              error: null,
              refreshLogs: [
                ...prev.refreshLogs,
                makePreviewLog("Refresh akzeptiert. Warte auf Status …"),
              ],
            }
          : prev,
      );
    },
    [getProjectPreviewMode, makePreviewLog],
  );

  const markPreviewStuck = useCallback(
    async (projectId: string, error: string) => {
      let stopSummary = "Timeout-Cleanup: aktive Projekt-Runs konnten nicht gestoppt werden.";
      try {
        const stopRes = await previewAPI.stopProject(
          projectId,
          getProjectPreviewMode(projectId),
          previewAccessTokenRef.current ?? undefined,
        );
        stopSummary = stopRes.success
          ? `Timeout-Cleanup: ${stopRes.stopped ?? 0} aktive Projekt-Run(s) gestoppt.`
          : `Timeout-Cleanup fehlgeschlagen: ${stopRes.error ?? "Unbekannter Fehler"}`;
      } catch (cleanupErr) {
        const msg = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
        stopSummary = `Timeout-Cleanup fehlgeschlagen: ${msg}`;
      }

      setPreview((prev) =>
        prev.projectId === projectId && prev.status === "starting"
          ? {
              ...prev,
              runId: null,
              status: "failed" as const,
              error,
              previewUrl: null,
              refreshLogs: [
                ...prev.refreshLogs,
                makePreviewLog(`Fehlgeschlagen (Timeout): ${error}`),
                makePreviewLog(stopSummary),
              ],
            }
          : prev,
      );
    },
    [getProjectPreviewMode, makePreviewLog],
  );

  const value: VisudevStore = {
    projects,
    projectsLoading,
    setProjectsLoading,
    activeProject,
    setActiveProject,
    addProject,
    updateProject,
    deleteProject,
    loadProjects,
    scans,
    scanStatuses,
    startScan,
    refreshScanStatus,
    preview,
    startPreview,
    refreshPreviewStatus,
    refreshPreview,
    stopPreview,
    markPreviewStuck,
    setPreviewAccessToken,
  };

  return <VisudevContext.Provider value={value}>{children}</VisudevContext.Provider>;
}

export function useVisudev() {
  const ctx = useContext(VisudevContext);
  if (!ctx) {
    throw new Error("useVisudev must be used within VisudevProvider");
  }
  return ctx;
}

// Backwards compatibility alias for existing code
export const useProject = useVisudev;

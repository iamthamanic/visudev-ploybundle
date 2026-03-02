import { useEffect, useState, useCallback, lazy, Suspense } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "../../../contexts/useAuth";
import { useVisudev } from "../../../lib/visudev/store";
import { Sidebar } from "../components/Sidebar";
import type { ShellScreen } from "../types";
import styles from "../styles/ShellPage.module.css";

const VALID_SCREENS: ShellScreen[] = [
  "projects",
  "appflow",
  "blueprint",
  "data",
  "logs",
  "settings",
];

/** Maps URL path segment to ShellScreen. Analyzer/heuristic use PascalCase paths (e.g. /AppFlowPage); shell uses lowercase (e.g. /appflow). */
const PATH_SEGMENT_TO_SCREEN: Record<string, ShellScreen> = {
  projects: "projects",
  appflow: "appflow",
  blueprint: "blueprint",
  data: "data",
  logs: "logs",
  settings: "settings",
  ProjectsPage: "projects",
  AppFlowPage: "appflow",
  BlueprintPage: "blueprint",
  DataPage: "data",
  LogsPage: "logs",
  SettingsPage: "settings",
  ShellPage: "projects",
};

function pathnameToScreen(): ShellScreen {
  if (typeof window === "undefined") return "projects";
  const seg = (window.location.pathname.replace(/\/$/, "").slice(1) || "projects").trim();
  if (VALID_SCREENS.includes(seg as ShellScreen)) return seg as ShellScreen;
  return PATH_SEGMENT_TO_SCREEN[seg] ?? "projects";
}

/** When in iframe, prefer #visudev-screen= or ?visudev-screen= (hash is never sent to server, so always preserved). */
function getScreenFromUrl(): ShellScreen {
  if (typeof window === "undefined") return "projects";
  const inIframe = window !== window.top;
  if (inIframe) {
    const fromHash = window.location.hash ? new URLSearchParams(window.location.hash.slice(1)).get("visudev-screen") : null;
    const fromQuery = new URLSearchParams(window.location.search).get("visudev-screen");
    const param = fromHash ?? fromQuery;
    if (param) {
      const seg = param.trim().toLowerCase();
      if (VALID_SCREENS.includes(seg as ShellScreen)) return seg as ShellScreen;
      const mapped = PATH_SEGMENT_TO_SCREEN[param.trim()];
      if (mapped) return mapped;
    }
  }
  return pathnameToScreen();
}

function screenToPath(screen: ShellScreen): string {
  return screen === "projects" ? "/" : `/${screen}`;
}

const ProjectsPage = lazy(() =>
  import("../../projects").then((m) => ({ default: m.ProjectsPage })),
);
const AppFlowPage = lazy(() => import("../../appflow").then((m) => ({ default: m.AppFlowPage })));
const BlueprintPage = lazy(() =>
  import("../../blueprint").then((m) => ({ default: m.BlueprintPage })),
);
const DataPage = lazy(() => import("../../data").then((m) => ({ default: m.DataPage })));
const LogsPage = lazy(() => import("../../logs").then((m) => ({ default: m.LogsPage })));
const SettingsPage = lazy(() =>
  import("../../settings").then((m) => ({ default: m.SettingsPage })),
);

export function ShellPage() {
  const [activeScreen, setActiveScreen] = useState<ShellScreen>(getScreenFromUrl);
  const { activeProject, setPreviewAccessToken } = useVisudev();
  const { session } = useAuth();

  useEffect(() => {
    setPreviewAccessToken(session?.access_token ?? null);
  }, [session?.access_token, setPreviewAccessToken]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected") {
      setActiveScreen("settings");
      const path = window.location.pathname + window.location.hash;
      window.history.replaceState({}, "", path);
    }
  }, []);

  useEffect(() => {
    const onPopState = () => setActiveScreen(getScreenFromUrl());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // When loaded inside an iframe, sync tab from URL once (#visudev-screen or ?visudev-screen or pathname).
  useEffect(() => {
    if (typeof window === "undefined" || window === window.top) return;
    setActiveScreen(getScreenFromUrl());
  }, []);

  const handleNavigate = useCallback((screen: ShellScreen) => {
    const path = screenToPath(screen);
    const inIframe = typeof window !== "undefined" && window !== window.top;
    if (inIframe) {
      window.parent.postMessage({ type: "visudev-navigate", path }, "*");
      return;
    }
    setActiveScreen(screen);
    if (window.history?.pushState) window.history.pushState({}, "", path);
  }, []);

  const handleProjectSelect = () => {
    handleNavigate("appflow");
  };

  const handleNewProject = () => {
    handleNavigate("projects");
  };

  return (
    <div className={styles.root}>
      <Sidebar
        activeScreen={activeScreen}
        onNavigate={handleNavigate}
        onNewProject={handleNewProject}
      />

      <main className={styles.main}>
        <Suspense
          fallback={
            <div className={styles.suspenseFallback}>
              <Loader2 className={styles.suspenseSpinner} aria-hidden="true" />
              <p className={styles.suspenseText}>Lade...</p>
            </div>
          }
        >
          {activeScreen === "projects" && (
            <ProjectsPage
              onProjectSelect={handleProjectSelect}
              onNewProject={handleNewProject}
              onOpenSettings={() => handleNavigate("settings")}
            />
          )}

          {activeScreen === "appflow" && activeProject && (
            <AppFlowPage
              projectId={activeProject.id}
              githubRepo={activeProject.github_repo}
              githubBranch={activeProject.github_branch}
            />
          )}

          {activeScreen === "blueprint" && activeProject && (
            <BlueprintPage projectId={activeProject.id} />
          )}

          {activeScreen === "data" && activeProject && <DataPage projectId={activeProject.id} />}

          {activeScreen === "logs" && activeProject && <LogsPage projectId={activeProject.id} />}

          {activeScreen === "settings" && <SettingsPage project={activeProject ?? null} />}

          {!activeProject && activeScreen !== "projects" && (
            <div className={styles.emptyState}>
              <div className={styles.emptyCard}>
                <p className={styles.emptyTitle}>Kein Projekt ausgewählt</p>
                <button
                  type="button"
                  onClick={() => handleNavigate("projects")}
                  className={styles.emptyAction}
                >
                  Projekt auswählen
                </button>
              </div>
            </div>
          )}
        </Suspense>
      </main>
    </div>
  );
}

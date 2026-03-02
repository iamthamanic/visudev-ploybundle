import {
  Fragment,
  useCallback,
  useEffect,
  useState,
  type ComponentType,
  type SVGProps,
} from "react";
import clsx from "clsx";
import { Check, ChevronDown, Copy, File, Loader2, RefreshCw } from "lucide-react";
import { useVisudev } from "../../../lib/visudev/store";
import { useAuth } from "../../../contexts/useAuth";
import { AuthDialog } from "../../../components/AuthDialog";
import {
  getLocalPreviewRunnerHealth,
  getLocalPreviewRunnerRuns,
  type LocalPreviewRunnerHealth,
  type LocalPreviewRunnerRunsSnapshot,
} from "../../../utils/api";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import svgPaths from "../../../imports/svg-mni0z0xtlg";
import logoImage from "../../../assets/visudev-logo.png";
import type { ShellScreen } from "../types";
import styles from "../styles/Sidebar.module.css";

interface SidebarProps {
  activeScreen: ShellScreen;
  onNavigate: (screen: ShellScreen) => void;
  onNewProject: () => void;
}

type ScanType = "appflow" | "blueprint" | "data";

type NavItem = {
  key: ShellScreen;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  requiresProject?: boolean;
  scanType?: ScanType;
};

const navItems: NavItem[] = [
  { key: "projects", label: "Projekte", icon: File },
  {
    key: "appflow",
    label: "App Flow",
    icon: AppFlowIcon,
    requiresProject: true,
    scanType: "appflow",
  },
  {
    key: "blueprint",
    label: "Blueprint",
    icon: BlueprintIcon,
    requiresProject: true,
    scanType: "blueprint",
  },
  {
    key: "data",
    label: "Data",
    icon: DataIcon,
    requiresProject: true,
    scanType: "data",
  },
  {
    key: "logs",
    label: "Logs",
    icon: LogsIcon,
    requiresProject: true,
  },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

function formatRunnerTime(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("de-DE");
}

export function Sidebar({ activeScreen, onNavigate, onNewProject }: SidebarProps) {
  const { activeProject, scanStatuses } = useVisudev();
  const { user, loading: authLoading, signOut } = useAuth();
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [runnerHealth, setRunnerHealth] = useState<LocalPreviewRunnerHealth | null>(null);
  const [runnerStatusLoading, setRunnerStatusLoading] = useState(true);
  const [runnerDialogOpen, setRunnerDialogOpen] = useState(false);
  const [runnerRunsLoading, setRunnerRunsLoading] = useState(false);
  const [runnerRunsSnapshot, setRunnerRunsSnapshot] =
    useState<LocalPreviewRunnerRunsSnapshot | null>(null);
  const [runsCopied, setRunsCopied] = useState(false);

  const previewMode = activeProject?.preview_mode ?? "auto";
  const shouldCheckLocalRunner = previewMode === "local" || previewMode === "auto";
  const activeProjectId = activeProject?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    if (!shouldCheckLocalRunner) {
      setRunnerHealth(null);
      setRunnerStatusLoading(false);
      return;
    }

    const pollRunner = async (showLoading: boolean) => {
      if (showLoading) setRunnerStatusLoading(true);
      const health = await getLocalPreviewRunnerHealth();
      if (!cancelled) {
        setRunnerHealth(health);
        setRunnerStatusLoading(false);
      }
    };

    void pollRunner(true);
    const interval = setInterval(() => {
      void pollRunner(false);
    }, 10_000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeProject?.id, shouldCheckLocalRunner]);

  const loadRunnerRuns = useCallback(
    async (showLoading: boolean) => {
      if (!shouldCheckLocalRunner) {
        setRunnerRunsSnapshot(null);
        return;
      }
      if (showLoading) setRunnerRunsLoading(true);
      const snapshot = await getLocalPreviewRunnerRuns(activeProjectId);
      setRunnerRunsSnapshot(snapshot);
      if (showLoading) setRunnerRunsLoading(false);
    },
    [activeProjectId, shouldCheckLocalRunner],
  );

  useEffect(() => {
    if (!runnerDialogOpen) return;
    void loadRunnerRuns(true);
    const interval = setInterval(() => {
      void loadRunnerRuns(false);
    }, 10_000);
    return () => clearInterval(interval);
  }, [loadRunnerRuns, runnerDialogOpen]);

  const isRunnerOnline = runnerHealth?.reachable === true;
  const isRunnerDegraded =
    isRunnerOnline && runnerHealth.useDocker && runnerHealth.dockerAvailable === false;
  const runnerActiveRuns =
    typeof runnerHealth?.activeRuns === "number" && Number.isFinite(runnerHealth.activeRuns)
      ? Math.max(0, runnerHealth.activeRuns)
      : null;

  let runnerPrimaryText = "Runner wird geprüft…";
  let runnerSecondaryText = "Prüfe localhost:4000/4100";
  let runnerStatusClass = styles.runnerStatusChecking;

  if (!shouldCheckLocalRunner) {
    if (previewMode === "deployed") {
      runnerPrimaryText = "Runner nicht nötig (Deployed)";
      runnerSecondaryText = "Preview kommt aus deployed URL";
    } else {
      runnerPrimaryText = "Runner zentral (nicht lokal prüfbar)";
      runnerSecondaryText = "Nutzt zentrale Runner-URL";
    }
    runnerStatusClass = styles.runnerStatusNeutral;
  } else if (!runnerStatusLoading && runnerHealth) {
    if (isRunnerOnline) {
      const runsText = runnerActiveRuns == null ? "Runs: ?" : `Runs: ${runnerActiveRuns}`;
      const modeText = runnerHealth.mode
        ? `Modus: ${runnerHealth.mode}`
        : "Health-Check erfolgreich";
      const baseText = runnerHealth.baseUrl ?? "lokal";
      const hasActiveRun = (runnerActiveRuns ?? 0) > 0;
      runnerPrimaryText = hasActiveRun
        ? `Runner active (${runnerActiveRuns ?? "?"})`
        : "Runner waiting";
      runnerSecondaryText = isRunnerDegraded
        ? `${baseText} · ${runsText} · Docker-Modus aktiv, Docker aktuell nicht erreichbar`
        : `${baseText} · ${runsText} · ${modeText}`;
      if (isRunnerDegraded) {
        runnerStatusClass = styles.runnerStatusWarning;
      } else {
        runnerStatusClass = hasActiveRun ? styles.runnerStatusOnline : styles.runnerStatusWaiting;
      }
    } else {
      runnerPrimaryText = "Runner off";
      runnerSecondaryText = runnerHealth.error ?? "Nicht erreichbar auf localhost:4000/4100";
      runnerStatusClass = styles.runnerStatusOffline;
    }
  }

  const runsForDialog = runnerRunsSnapshot?.runs ?? [];
  const runsTotals = runnerRunsSnapshot?.totals;

  const copyRunsToClipboard = async () => {
    const payload = {
      checkedAt: new Date().toISOString(),
      baseUrl: runnerRunsSnapshot?.baseUrl ?? runnerHealth?.baseUrl ?? null,
      projectId: activeProjectId,
      totals: runsTotals ?? {
        total: runsForDialog.length,
        active: runsForDialog.filter((entry) => entry.status !== "stopped").length,
        ready: runsForDialog.filter((entry) => entry.status === "ready").length,
        starting: runsForDialog.filter((entry) => entry.status === "starting").length,
        failed: runsForDialog.filter((entry) => entry.status === "failed").length,
        stopped: runsForDialog.filter((entry) => entry.status === "stopped").length,
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

  const renderScanIndicator = (scanType: ScanType) => {
    const status = scanStatuses[scanType];
    if (status.status === "running") {
      return (
        <span className={styles.scanIndicator}>
          <Loader2 className={styles.scanIcon} />
          <span>{status.progress}%</span>
        </span>
      );
    }
    return null;
  };

  return (
    <aside className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <div className={styles.logoWrapper}>
            <img src={logoImage} alt="VisuDEV Logo" className={styles.logoImage} />
          </div>
          <div className={styles.brand}>
            <span className={styles.brandTitle}>VisuDEV</span>
            <span className={styles.brandSubtitle}>Visualize Code</span>
          </div>
        </div>
        <div
          className={clsx(styles.runnerStatus, runnerStatusClass)}
          role="status"
          aria-live="polite"
        >
          <span className={styles.runnerStatusDot} aria-hidden="true" />
          <div className={styles.runnerStatusText}>
            <span className={styles.runnerStatusPrimary}>{runnerPrimaryText}</span>
            <span className={styles.runnerStatusSecondary}>{runnerSecondaryText}</span>
          </div>
          <button
            type="button"
            className={styles.runnerStatusExpandButton}
            onClick={() => setRunnerDialogOpen(true)}
            aria-label="Runner-Details öffnen"
          >
            <ChevronDown className={styles.runnerStatusExpandIcon} aria-hidden="true" />
            <span className={styles.runnerStatusExpandLabel}>Runs</span>
          </button>
        </div>
      </div>

      <nav className={styles.nav}>
        {navItems.map((item) => {
          const isActive = activeScreen === item.key;
          const isDisabled = Boolean(item.requiresProject && !activeProject);
          const Icon = item.icon;

          return (
            <Fragment key={item.key}>
              <button
                type="button"
                onClick={() => (!isDisabled ? onNavigate(item.key) : undefined)}
                disabled={isDisabled}
                className={clsx(
                  styles.navButton,
                  isActive && styles.navButtonActive,
                  isDisabled && styles.navButtonDisabled,
                )}
                aria-label={`Zu ${item.label} wechseln`}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className={styles.navIcon} aria-hidden="true" />
                <span className={styles.navLabel}>{item.label}</span>
                {item.scanType ? renderScanIndicator(item.scanType) : null}
              </button>

              {item.key === "projects" && activeProject ? (
                <div className={styles.activeProject}>
                  <span className={styles.activeProjectName}>{activeProject.name}</span>
                </div>
              ) : null}
            </Fragment>
          );
        })}
      </nav>

      {!authLoading && (
        <div className={styles.authBlock}>
          {user ? (
            <div className={styles.authUser}>
              <span className={styles.authEmail} title={user.email ?? undefined}>
                {user.email ?? user.id.slice(0, 8)}
              </span>
              <button
                type="button"
                onClick={() => signOut()}
                className={styles.authSignOut}
                aria-label="Abmelden"
              >
                Abmelden
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAuthDialogOpen(true)}
              className={styles.authSignIn}
              aria-label="Anmelden"
            >
              Anmelden
            </button>
          )}
        </div>
      )}

      <div className={styles.footer}>
        <button
          type="button"
          onClick={onNewProject}
          className={styles.newProjectButton}
          aria-label="Neues Projekt erstellen"
        >
          <PlusIcon className={styles.navIcon} aria-hidden="true" />
          <span className={styles.newProjectLabel}>Neues Projekt</span>
        </button>
      </div>

      <AuthDialog open={authDialogOpen} onOpenChange={setAuthDialogOpen} />
      <Dialog open={runnerDialogOpen} onOpenChange={setRunnerDialogOpen}>
        <DialogContent className={styles.runnerDialogContent}>
          <DialogHeader>
            <DialogTitle>Runner-Runs</DialogTitle>
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

          {!shouldCheckLocalRunner ? (
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
    </aside>
  );
}

function AppFlowIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path
        d={svgPaths.p1f5dba00}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.p17f7d000}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.p42d6b00}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
    </svg>
  );
}

function BlueprintIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path
        d="M5 2.5V12.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.p3a3cf580}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.p34c9bb80}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.p13cf9c00}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
    </svg>
  );
}

function DataIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path
        d={svgPaths.p2e7662c0}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.pbd81000}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.p2a44e700}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
    </svg>
  );
}

function LogsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <g clipPath="url(#logsIconClip)">
        <path
          d={svgPaths.p363df2c0}
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.66667"
        />
      </g>
      <defs>
        <clipPath id="logsIconClip">
          <rect width="20" height="20" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}

function SettingsIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path
        d={svgPaths.p2483b8c0}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d={svgPaths.p3b27f100}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
    </svg>
  );
}

function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 20 20" fill="none" {...props}>
      <path
        d="M4.16667 10H15.8333"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
      <path
        d="M10 4.16667V15.8333"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.66667"
      />
    </svg>
  );
}

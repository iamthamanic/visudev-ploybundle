/**
 * SettingsPage: Tabs Profile (user info) and Connections (GitHub, etc.).
 * GitHub connection is done here; Projects page only shows repo selector when connected.
 * Location: src/modules/settings/pages/SettingsPage.tsx
 */

import { useCallback, useEffect, useState } from "react";
import {
  Bot,
  Check,
  CheckCircle,
  Copy,
  Database,
  Github,
  Info,
  Link2,
  Loader2,
  RefreshCw,
  User,
  Users,
  Webhook,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "../../../components/ui/button";
import { Tooltip } from "../../../components/ui/Tooltip";
import { Input } from "../../../components/ui/input";
import { useAuth } from "../../../contexts/useAuth";
import type { Project } from "../../../lib/visudev/types";
import { checkScreenshotsHealth } from "../../../lib/services/screenshots";
import {
  disconnectGitHub,
  getGitHubAuthorizeUrl,
  getGitHubStatus,
} from "../../projects/services/githubAuth";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { IntegrationsPanel } from "../../../components/IntegrationsPanel";
import { LlmIntegrationsPanel } from "../components/LlmIntegrationsPanel";
import { projectId as supabaseProjectId, supabaseUrl } from "../../../utils/supabase/info";
import styles from "../styles/SettingsPage.module.css";

type SettingsTab = "profile" | "connections" | "integrations" | "project" | "project-integrations";

interface SettingsPageProps {
  project: Project | null;
}

export function SettingsPage({ project }: SettingsPageProps) {
  const { session, user } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [activeTab, setActiveTab] = useState<SettingsTab>("profile");

  const [githubStatusLoading, setGitHubStatusLoading] = useState(true);
  const [githubConnected, setGitHubConnected] = useState(false);
  const [githubAccount, setGithubAccount] = useState<{ login: string; id: number } | null>(null);
  const [githubError, setGithubError] = useState<string | null>(null);
  const [isConnectingGitHub, setIsConnectingGitHub] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const [isDisconnectingGitHub, setIsDisconnectingGitHub] = useState(false);

  const [isConnectingSupabase, setIsConnectingSupabase] = useState(false);
  const [supabaseConnected, setSupabaseConnected] = useState(true);
  const [webhookStatus] = useState<"active" | "inactive" | "error">("active");
  const [pollingInterval, setPollingInterval] = useState(60);

  const [testStatus, setTestStatus] = useState<"idle" | "testing" | "success" | "error">("idle");
  const [testResult, setTestResult] = useState<unknown | null>(null);
  const [supabaseIdCopied, setSupabaseIdCopied] = useState(false);

  const supabaseRegion =
    supabaseUrl.includes("127.0.0.1") || supabaseUrl.includes("localhost") ? "Lokal" : "Cloud";

  const handleCopySupabaseProjectId = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(supabaseProjectId);
      setSupabaseIdCopied(true);
      setTimeout(() => setSupabaseIdCopied(false), 2000);
    } catch {
      setSupabaseIdCopied(false);
    }
  }, []);

  const loadGitHubStatus = useCallback(async (token: string) => {
    setGitHubStatusLoading(true);
    setGithubError(null);
    try {
      const status = await getGitHubStatus(token);
      setGitHubConnected(status.connected);
      setGithubAccount(status.account ?? null);
    } catch (err) {
      setGitHubConnected(false);
      setGithubAccount(null);
      const msg = err instanceof Error ? err.message : "Status konnte nicht geladen werden.";
      const isAuthError =
        msg.toLowerCase().includes("sign in") ||
        msg.toLowerCase().includes("unauthorized") ||
        msg.toLowerCase().includes("401");
      setGithubError(
        isAuthError
          ? "Sitzung ungültig oder von anderem Supabase (z. B. Cloud vs. lokal). Bitte abmelden und mit derselben Umgebung erneut anmelden."
          : msg,
      );
    } finally {
      setGitHubStatusLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!accessToken) {
      setGitHubStatusLoading(false);
      setGitHubConnected(false);
      setGithubAccount(null);
      return;
    }
    loadGitHubStatus(accessToken);
  }, [accessToken, loadGitHubStatus]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("github") === "connected" && accessToken) {
      loadGitHubStatus(accessToken);
    }
  }, [accessToken, loadGitHubStatus]);

  const runScreenshotTest = async () => {
    setTestStatus("testing");
    setTestResult(null);
    try {
      const data = await checkScreenshotsHealth();
      setTestResult(data);
      setTestStatus("success");
    } catch (error) {
      setTestResult({ error: String(error) });
      setTestStatus("error");
    }
  };

  const handleGitHubDisconnectConfirm = async () => {
    if (!accessToken) return;
    setIsDisconnectingGitHub(true);
    setGithubError(null);
    try {
      await disconnectGitHub(accessToken);
      setShowDisconnectModal(false);
      await loadGitHubStatus(accessToken);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Trennen fehlgeschlagen.";
      setGithubError(msg);
    } finally {
      setIsDisconnectingGitHub(false);
    }
  };

  const handleGitHubConnect = async () => {
    if (!accessToken) {
      setGithubError("Bitte zuerst anmelden.");
      return;
    }
    setGithubError(null);
    setIsConnectingGitHub(true);
    try {
      const returnUrl = window.location.origin + window.location.pathname + window.location.hash;
      const authUrl = await getGitHubAuthorizeUrl(returnUrl, accessToken);
      if (!authUrl) {
        setGithubError("Keine Weiterleitungs-URL erhalten.");
        setIsConnectingGitHub(false);
        return;
      }
      window.location.href = authUrl;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : typeof err === "string"
            ? err
            : "Verbinden fehlgeschlagen.";
      const isAuthError =
        msg.toLowerCase().includes("sign in") ||
        msg.toLowerCase().includes("unauthorized") ||
        msg.toLowerCase().includes("401");
      setGithubError(
        isAuthError
          ? "Sitzung von anderem Supabase (z. B. Cloud vs. lokal). Abmelden, dann mit derselben Umgebung anmelden und erneut „GitHub verbinden“ klicken."
          : msg,
      );
      setIsConnectingGitHub(false);
    }
  };

  const handleSupabaseConnect = async () => {
    setIsConnectingSupabase(true);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    setSupabaseConnected(true);
    setIsConnectingSupabase(false);
  };

  const tabs: { key: SettingsTab; label: string; icon: typeof User }[] = [
    { key: "profile", label: "Profil", icon: User },
    { key: "connections", label: "Verbindungen", icon: Github },
    { key: "integrations", label: "Integrationen", icon: Bot },
  ];
  if (project) {
    tabs.push({ key: "project", label: "Projekt", icon: Database });
    tabs.push({ key: "project-integrations", label: "Projekt-Anbindungen", icon: Link2 });
  }

  return (
    <div className={styles.root}>
      <div className={styles.tabsRow} role="tablist">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={activeTab === key}
            className={activeTab === key ? styles.tabActive : styles.tab}
            onClick={() => setActiveTab(key)}
          >
            <Icon className={styles.tabIcon} aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "profile" && (
        <section className={styles.section} role="tabpanel">
          <h2 className={styles.sectionTitle}>Profil</h2>
          <div className={styles.card}>
            <div className={styles.infoGrid}>
              <div>
                <div className={styles.infoLabel}>E-Mail</div>
                <div>{user?.email ?? "—"}</div>
              </div>
              <div>
                <div className={styles.infoLabel}>Angemeldet als</div>
                <div className={styles.statusText}>{user?.email ?? "Nicht angemeldet"}</div>
              </div>
            </div>
          </div>
        </section>
      )}

      {activeTab === "connections" && (
        <section className={styles.section} role="tabpanel">
          <h2 className={styles.sectionTitle}>
            <Github className={styles.inlineIcon} aria-hidden="true" />
            GitHub
          </h2>
          <div className={styles.card}>
            <div className={styles.splitRow}>
              <div>
                <div className={styles.statusRow}>
                  <span>Status</span>
                  {githubStatusLoading ? (
                    <Loader2
                      className={`${styles.inlineIcon} ${styles.spinner}`}
                      aria-hidden="true"
                    />
                  ) : githubConnected && githubAccount ? (
                    <CheckCircle className={styles.statusSuccess} aria-hidden="true" />
                  ) : (
                    <XCircle className={styles.statusError} aria-hidden="true" />
                  )}
                </div>
                {!githubStatusLoading && githubConnected && githubAccount && (
                  <div className={styles.statusText}>
                    Verbunden als <strong>{githubAccount.login}</strong>
                  </div>
                )}
                {!githubStatusLoading && !githubConnected && (
                  <div className={styles.statusText}>
                    GitHub ist nicht verbunden. Verbinde dich, um Repositories in Projekten
                    auszuwählen. Bei lokalem Supabase (127.0.0.1) musst du dich nach dem Umstellen
                    ab- und wieder anmelden.
                  </div>
                )}
              </div>
              {githubConnected && githubAccount && !githubStatusLoading && (
                <Button
                  type="button"
                  onClick={() => setShowDisconnectModal(true)}
                  className={styles.dangerButton}
                  aria-label="GitHub trennen"
                >
                  GitHub trennen
                </Button>
              )}
              {!githubConnected && !githubStatusLoading && (
                <Button
                  type="button"
                  onClick={handleGitHubConnect}
                  disabled={isConnectingGitHub}
                  className={styles.secondaryButton}
                >
                  {isConnectingGitHub ? (
                    <>
                      <Loader2
                        className={`${styles.inlineIcon} ${styles.spinner}`}
                        aria-hidden="true"
                      />
                      Weiterleitung zu GitHub…
                    </>
                  ) : (
                    <>
                      <Github className={styles.inlineIcon} aria-hidden="true" />
                      GitHub verbinden
                    </>
                  )}
                </Button>
              )}
            </div>
            <Dialog open={showDisconnectModal} onOpenChange={setShowDisconnectModal}>
              <DialogContent data-visudev-modal="github-disconnect">
                <DialogHeader>
                  <DialogTitle>GitHub trennen?</DialogTitle>
                  <DialogDescription>
                    Wirklich trennen? Du kannst dich später wieder verbinden. Repositories in
                    Projekten sind danach nicht mehr nutzbar, bis du erneut verbindest.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button
                    type="button"
                    onClick={() => setShowDisconnectModal(false)}
                    className={styles.secondaryButton}
                  >
                    Abbrechen
                  </Button>
                  <Button
                    type="button"
                    onClick={handleGitHubDisconnectConfirm}
                    disabled={isDisconnectingGitHub}
                    className={styles.dangerButton}
                  >
                    {isDisconnectingGitHub ? (
                      <>
                        <Loader2
                          className={`${styles.inlineIcon} ${styles.spinner}`}
                          aria-hidden="true"
                        />
                        Trennen…
                      </>
                    ) : (
                      "Trennen"
                    )}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
            {githubError && (
              <p className={styles.errorText} role="alert">
                {githubError}
              </p>
            )}
          </div>

          <h3 className={styles.sectionTitle}>
            <Database className={styles.inlineIcon} aria-hidden="true" />
            Supabase
            <Tooltip
              content="Konfiguration über Supabase Dashboard"
              aria-label="Konfiguration über Supabase Dashboard"
            >
              <Info className={styles.inlineIcon} aria-hidden="true" size={16} />
            </Tooltip>
          </h3>
          <div className={styles.card}>
            <div className={styles.supabaseInfoGrid}>
              <div>
                <div className={styles.infoLabel}>Projekt-ID</div>
                <div className={styles.copyRow}>
                  <code className={styles.inlineCode}>{supabaseProjectId}</code>
                  <button
                    type="button"
                    onClick={handleCopySupabaseProjectId}
                    className={styles.copyButton}
                    aria-label="Projekt-ID kopieren"
                  >
                    {supabaseIdCopied ? (
                      <>
                        <Check className={styles.inlineIcon} aria-hidden="true" size={14} />
                        Kopiert!
                      </>
                    ) : (
                      <>
                        <Copy className={styles.inlineIcon} aria-hidden="true" size={14} />
                        Kopieren
                      </>
                    )}
                  </button>
                </div>
              </div>
              <div>
                <div className={styles.infoLabel}>Region</div>
                <div className={styles.statusText}>{supabaseRegion}</div>
              </div>
              <div>
                <div className={styles.infoLabel}>DB/Edge-Status</div>
                <div className={styles.statusText}>{supabaseConnected ? "Aktiv" : "Inaktiv"}</div>
              </div>
            </div>
            <div className={styles.splitRow}>
              <div>
                <div className={styles.statusRow}>
                  <span>Status</span>
                  {supabaseConnected ? (
                    <CheckCircle className={styles.statusSuccess} aria-hidden="true" />
                  ) : (
                    <XCircle className={styles.statusError} aria-hidden="true" />
                  )}
                </div>
                {supabaseConnected && <div className={styles.statusText}>Verbindung aktiv</div>}
              </div>
              {!supabaseConnected && (
                <button
                  type="button"
                  onClick={handleSupabaseConnect}
                  disabled={isConnectingSupabase}
                  className={styles.secondaryButton}
                >
                  {isConnectingSupabase ? (
                    <>
                      <RefreshCw
                        className={`${styles.inlineIcon} ${styles.spinner}`}
                        aria-hidden="true"
                      />
                      Verbinde…
                    </>
                  ) : (
                    <>
                      <Database className={styles.inlineIcon} aria-hidden="true" />
                      Supabase verbinden
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {activeTab === "integrations" && (
        <section className={styles.section} role="tabpanel">
          <h2 className={styles.sectionTitle}>Integrationen</h2>
          <p className={styles.caption}>
            API-Keys und Standard-Modelle für die ergänzende LLM-Auswertung von Analyse-Konflikten
            verwalten.
          </p>
          <LlmIntegrationsPanel />
        </section>
      )}

      {activeTab === "project-integrations" && project && (
        <section className={styles.section} role="tabpanel">
          <h2 className={styles.sectionTitle}>Projekt-Anbindungen</h2>
          <p className={styles.caption}>
            GitHub-Repo und Supabase für dieses Projekt verbinden (für Scan, Preview, Daten).
          </p>
          <IntegrationsPanel projectId={project.id} />
        </section>
      )}

      {activeTab === "project" && project && (
        <>
          <section className={styles.section} role="tabpanel">
            <h2 className={styles.sectionTitle}>Projekt</h2>
            <div className={styles.card}>
              <div className={styles.infoGrid}>
                <div>
                  <div className={styles.infoLabel}>Projektname</div>
                  <div>{project.name}</div>
                </div>
                <div>
                  <div className={styles.infoLabel}>Projekt-ID</div>
                  <code className={styles.inlineCode}>{project.id}</code>
                </div>
              </div>
              {project.github_repo && (
                <div className={styles.statusRow}>
                  <span className={styles.caption}>Repository:</span>
                  <code className={styles.inlineCode}>{project.github_repo}</code>
                  <span className={styles.caption}>Branch:</span>
                  <code className={styles.inlineCode}>{project.github_branch || "main"}</code>
                </div>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <Webhook className={styles.inlineIcon} aria-hidden="true" />
              Webhooks & Sync
            </h3>
            <div className={styles.card}>
              <div className={styles.splitRow}>
                <div>
                  <div className={styles.statusRow}>
                    <span>Webhook-Status</span>
                    {webhookStatus === "active" && (
                      <CheckCircle className={styles.statusSuccess} aria-hidden="true" />
                    )}
                    {webhookStatus === "inactive" && (
                      <XCircle className={styles.statusText} aria-hidden="true" />
                    )}
                    {webhookStatus === "error" && (
                      <XCircle className={styles.statusError} aria-hidden="true" />
                    )}
                  </div>
                  <div className={styles.statusText}>
                    {webhookStatus === "active" && "Echtzeit-Updates von GitHub"}
                    {webhookStatus === "inactive" && "Webhooks nicht konfiguriert"}
                    {webhookStatus === "error" && "Webhook-Fehler"}
                  </div>
                </div>
              </div>
              <div className={styles.splitRow}>
                <label>
                  <span className={styles.caption}>Polling-Intervall (Sekunden)</span>
                </label>
                <div className={styles.splitRow}>
                  <Input
                    type="number"
                    min={30}
                    max={3600}
                    value={pollingInterval}
                    onChange={(event) => {
                      const value = Number.parseInt(event.target.value, 10);
                      setPollingInterval(Number.isNaN(value) ? 30 : value);
                    }}
                    className={styles.shortInput}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <Users className={styles.inlineIcon} aria-hidden="true" />
              Team & Zugriff
            </h3>
            <div className={styles.card}>
              <p className={styles.caption}>
                Teammitglieder und Rollen (Owner, Maintainer, Viewer)
              </p>
              <div className={styles.memberRow}>
                <div>
                  <div>{user?.email ?? "—"}</div>
                  <div className={styles.caption}>Du</div>
                </div>
                <span className={styles.memberBadge}>Owner</span>
              </div>
              <button type="button" className={styles.secondaryButton}>
                Teammitglied einladen
              </button>
            </div>
          </section>

          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>
              <Zap className={styles.inlineIcon} aria-hidden="true" />
              Screenshot-API Test
            </h3>
            <div className={styles.card}>
              <p className={styles.caption}>Visudev-Screenshots Edge Function testen</p>
              <Button
                type="button"
                onClick={runScreenshotTest}
                disabled={testStatus === "testing"}
                className={styles.primaryButton}
              >
                {testStatus === "testing" ? (
                  <>
                    <RefreshCw
                      className={`${styles.inlineIcon} ${styles.spinner}`}
                      aria-hidden="true"
                    />
                    Teste…
                  </>
                ) : (
                  <>
                    <Zap className={styles.inlineIcon} aria-hidden="true" />
                    Health Check
                  </>
                )}
              </Button>
              {testResult !== null && (
                <div
                  className={`${styles.testResult} ${
                    testStatus === "success" ? styles.testSuccess : styles.testError
                  }`}
                >
                  <div className={styles.resultHeader}>
                    {testStatus === "success" ? (
                      <CheckCircle className={styles.statusSuccess} aria-hidden="true" />
                    ) : (
                      <XCircle className={styles.statusError} aria-hidden="true" />
                    )}
                    <span className={styles.resultLabel}>
                      {testStatus === "success" ? "Erfolg" : "Fehler"}
                    </span>
                  </div>
                  <pre className={styles.resultBody}>{JSON.stringify(testResult, null, 2)}</pre>
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

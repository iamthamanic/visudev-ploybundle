import { useCallback, useMemo, useState } from "react";
import clsx from "clsx";
import { FolderGit2, LayoutGrid, List, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Button } from "../../../components/ui/button";
import { Skeleton } from "../../../components/ui/Skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { useAuth } from "../../../contexts/useAuth";
import { useVisudev } from "../../../lib/visudev/store";
import type { PreviewMode, Project } from "../../../lib/visudev/types";
import { api } from "../../../utils/api";
import { ProjectCard } from "../components/ProjectCard";
import { ProjectListWithDnD, type ListSortColumn } from "../components/ProjectListWithDnD";
import { GitHubRepoSelector } from "../components/GitHubRepoSelector";
import { useProjectOrder, sortProjectsByOrder } from "../hooks/useProjectOrder";
import { SupabaseProjectSelector } from "../components/SupabaseProjectSelector";
import styles from "../styles/ProjectsPage.module.css";

interface ProjectsPageProps {
  onProjectSelect?: (project: Project) => void;
  onNewProject?: () => void;
  onOpenSettings?: () => void;
}

export function ProjectsPage({ onProjectSelect, onNewProject, onOpenSettings }: ProjectsPageProps) {
  const { session, user, signInWithPassword } = useAuth();
  const {
    projects,
    projectsLoading,
    setActiveProject,
    addProject,
    updateProject,
    deleteProject,
    startPreview,
  } = useVisudev();
  const accessToken = session?.access_token ?? null;
  const defaultPreviewMode: PreviewMode = (() => {
    const localUrl =
      (typeof import.meta !== "undefined" && import.meta.env?.VITE_PREVIEW_RUNNER_URL) ||
      (typeof import.meta !== "undefined" && import.meta.env?.DEV ? "http://localhost:4000" : "");
    return localUrl ? "local" : "central";
  })();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [listSortBy, setListSortBy] = useState<ListSortColumn | null>(null);
  const [listSortDir, setListSortDir] = useState<"asc" | "desc">("asc");
  const { order, pinned, togglePinned, moveProject } = useProjectOrder();

  const handleListSort = useCallback((column: ListSortColumn) => {
    setListSortBy((prev) => {
      if (prev === column) {
        setListSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setListSortDir("asc");
      return column;
    });
  }, []);

  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [deleteConfirmProjectId, setDeleteConfirmProjectId] = useState<string | null>(null);
  const [deleteConfirmPassword, setDeleteConfirmPassword] = useState("");
  const [isDeleteLoading, setIsDeleteLoading] = useState(false);

  const [projectName, setProjectName] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [githubBranch, setGithubBranch] = useState("main");
  const [githubAccessToken, setGithubAccessToken] = useState("");
  const [deployedUrl, setDeployedUrl] = useState("");
  const [previewMode, setPreviewMode] = useState<PreviewMode>(defaultPreviewMode);
  const [databaseType, setDatabaseType] = useState<"supabase" | "local">("supabase");
  const [supabaseProjectId, setSupabaseProjectId] = useState("");
  const [supabaseAnonKey, setSupabaseAnonKey] = useState("");
  const [supabaseManagementToken, setSupabaseManagementToken] = useState("");

  const handleCreateProject = async () => {
    setIsLoading(true);
    try {
      const newProject: Omit<Project, "id" | "createdAt" | "screens" | "flows"> = {
        name: projectName,
        github_repo: githubRepo,
        github_branch: githubBranch,
        github_access_token: githubAccessToken,
        deployed_url: deployedUrl,
        preview_mode: previewMode,
        database_type: databaseType,
        supabase_project_id: databaseType === "supabase" ? supabaseProjectId : undefined,
        supabase_anon_key: databaseType === "supabase" ? supabaseAnonKey : undefined,
        supabase_management_token:
          databaseType === "supabase" ? supabaseManagementToken : undefined,
        description: `GitHub: ${githubRepo}${deployedUrl ? ` | Live: ${deployedUrl}` : ""}`,
      };

      const created = await addProject(newProject);
      if (githubRepo && accessToken && created.id) {
        await api.integrations.github.setProjectGitHubRepo(
          created.id,
          { repo: githubRepo, branch: githubBranch || "main" },
          accessToken,
        );
      }
      // Preview sofort anstoßen, sobald Projekt mit Repo angelegt ist (außer Modus "deployed")
      if (created.id && created.github_repo?.trim() && created.preview_mode !== "deployed") {
        void startPreview(
          created.id,
          created.github_repo,
          created.github_branch || "main",
          undefined,
        );
      }
      setIsDialogOpen(false);
      setStep(1);
      resetForm();
    } catch {
      toast.error("Projekt konnte nicht erstellt werden.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateProject = async () => {
    if (!editingProject) return;

    setIsLoading(true);
    try {
      const updatedProject: Project = {
        ...editingProject,
        name: projectName,
        github_repo: githubRepo,
        github_branch: githubBranch,
        github_access_token: githubAccessToken,
        deployed_url: deployedUrl,
        preview_mode: previewMode,
        database_type: databaseType,
        supabase_project_id: databaseType === "supabase" ? supabaseProjectId : undefined,
        supabase_anon_key: databaseType === "supabase" ? supabaseAnonKey : undefined,
        supabase_management_token:
          databaseType === "supabase" ? supabaseManagementToken : undefined,
        description: `GitHub: ${githubRepo}${deployedUrl ? ` | Live: ${deployedUrl}` : ""}`,
      };

      await updateProject(updatedProject);
      if (githubRepo && accessToken) {
        await api.integrations.github.setProjectGitHubRepo(
          editingProject.id,
          { repo: githubRepo, branch: githubBranch || "main" },
          accessToken,
        );
      }
      setIsEditDialogOpen(false);
      setEditingProject(null);
      resetForm();
    } catch {
      toast.error("Projekt konnte nicht gespeichert werden.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteClick = (id: string) => {
    setDeleteConfirmProjectId(id);
    setDeleteConfirmPassword("");
    setIsDeleteConfirmOpen(true);
  };

  const handleDeleteConfirmClose = () => {
    setIsDeleteConfirmOpen(false);
    setDeleteConfirmProjectId(null);
    setDeleteConfirmPassword("");
  };

  const handleDeleteConfirmSubmit = async () => {
    if (!deleteConfirmProjectId || !deleteConfirmPassword.trim()) return;
    const email = user?.email;
    if (!email) {
      toast.error("Nicht angemeldet. Bitte zuerst anmelden.");
      return;
    }
    setIsDeleteLoading(true);
    try {
      const { error } = await signInWithPassword(email, deleteConfirmPassword.trim());
      if (error) {
        toast.error("Falsches Passwort. Löschen abgebrochen.");
        return;
      }
      await deleteProject(deleteConfirmProjectId);
      handleDeleteConfirmClose();
      toast.success("Projekt wurde gelöscht.");
    } catch {
      toast.error("Fehler beim Löschen des Projekts");
    } finally {
      setIsDeleteLoading(false);
    }
  };

  const handleProjectClick = (project: Project) => {
    setActiveProject(project);
    onProjectSelect?.(project);
  };

  const handleEditClick = (project: Project) => {
    setEditingProject(project);
    setProjectName(project.name || "");
    setGithubRepo(project.github_repo || "");
    setGithubBranch(project.github_branch || "main");
    setGithubAccessToken(project.github_access_token || "");
    setDeployedUrl(project.deployed_url || "");
    setPreviewMode(project.preview_mode ?? defaultPreviewMode);
    setDatabaseType(project.database_type === "local" ? "local" : "supabase");
    setSupabaseProjectId(project.supabase_project_id || "");
    setSupabaseAnonKey(project.supabase_anon_key || "");
    setSupabaseManagementToken(project.supabase_management_token || "");
    setIsEditDialogOpen(true);
  };

  const resetForm = () => {
    setProjectName("");
    setGithubRepo("");
    setGithubBranch("main");
    setGithubAccessToken("");
    setDeployedUrl("");
    setPreviewMode(defaultPreviewMode);
    setDatabaseType("supabase");
    setSupabaseProjectId("");
    setSupabaseAnonKey("");
    setSupabaseManagementToken("");
  };

  const handleNextStep = () => {
    if (step === 1) {
      if (!githubRepo.trim()) {
        alert("Bitte wähle zuerst ein GitHub-Repository aus.");
        return;
      }
      if (!projectName.trim()) {
        setProjectName(githubRepo.split("/").pop() ?? githubRepo);
      }
    }
    setStep(step + 1);
  };

  const handlePreviousStep = () => {
    setStep(step - 1);
  };

  const filteredProjects = projects.filter((project) => {
    const nameMatch = project.name.toLowerCase().includes(searchQuery.toLowerCase());
    const repoMatch = project.github_repo
      ? project.github_repo.toLowerCase().includes(searchQuery.toLowerCase())
      : false;
    return nameMatch || repoMatch;
  });

  const sortedProjects = useMemo(() => {
    const byOrder = sortProjectsByOrder(filteredProjects, order, pinned);
    if (!listSortBy) return byOrder;
    const pinnedSet = new Set(pinned);
    const getVal = (p: Project): string | number => {
      switch (listSortBy) {
        case "name":
          return (p.name ?? "").toLowerCase();
        case "repo":
          return (p.github_repo ?? "").toLowerCase();
        case "branch":
          return (p.github_branch ?? "").toLowerCase();
        case "createdAt":
          return new Date(p.createdAt).getTime();
        default:
          return 0;
      }
    };
    return [...byOrder].sort((a, b) => {
      const aPinned = pinnedSet.has(a.id) ? 0 : 1;
      const bPinned = pinnedSet.has(b.id) ? 0 : 1;
      if (aPinned !== bPinned) return aPinned - bPinned;
      const va = getVal(a);
      const vb = getVal(b);
      if (va < vb) return listSortDir === "asc" ? -1 : 1;
      if (va > vb) return listSortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredProjects, order, pinned, listSortBy, listSortDir]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Projekte</h1>
            <p className={styles.subtitle}>
              {projects.length} {projects.length === 1 ? "Projekt" : "Projekte"} • Analyzer-First
              Mode
            </p>
          </div>
          <Button
            onClick={() => {
              setIsDialogOpen(true);
              onNewProject?.();
            }}
            className={styles.primaryButton}
          >
            <Plus aria-hidden="true" />
            Neues Projekt
          </Button>
        </div>

        <div className={styles.toolbar}>
          <div className={styles.search}>
            <Search className={styles.searchIcon} aria-hidden="true" />
            <Input
              placeholder="Projekte durchsuchen..."
              className={styles.searchInput}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
            />
          </div>
          <div className={styles.viewToggle} role="group" aria-label="Ansicht umschalten">
            <Button
              variant={viewMode === "list" ? "secondary" : "ghost"}
              size="icon"
              type="button"
              onClick={() => setViewMode("list")}
              aria-label="Listenansicht"
              aria-pressed={viewMode === "list"}
            >
              <List className={styles.viewIcon} aria-hidden="true" />
            </Button>
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              type="button"
              onClick={() => setViewMode("grid")}
              aria-label="Kartenansicht"
              aria-pressed={viewMode === "grid"}
            >
              <LayoutGrid className={styles.viewIcon} aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <div className={clsx(styles.content, viewMode === "list" && styles.contentList)}>
        {viewMode === "list" ? (
          projectsLoading ? (
            <div className={styles.listContainer}>
              <div className={styles.list}>
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={`skeleton-${i}`} className={styles.skeletonRow} />
                ))}
              </div>
            </div>
          ) : (
            <div className={styles.listContainer}>
              <ProjectListWithDnD
                projects={sortedProjects}
                onProjectClick={handleProjectClick}
                onEdit={handleEditClick}
                onDelete={handleDeleteClick}
                onPinToggle={togglePinned}
                pinnedIds={pinned}
                onMove={(projectId, toIndex) =>
                  moveProject(
                    projectId,
                    toIndex,
                    sortedProjects.map((p) => p.id),
                  )
                }
                sortBy={listSortBy}
                sortDir={listSortDir}
                onSort={handleListSort}
              />
            </div>
          )
        ) : (
          <div className={clsx(styles.listContainer, styles.listContainerGrid)}>
            <div className={styles.grid}>
              {projectsLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={`skeleton-${i}`} className={styles.skeletonCard} />
                  ))
                : sortedProjects.map((project) => (
                    <ProjectCard
                      key={project.id}
                      project={project}
                      onClick={() => handleProjectClick(project)}
                      onEdit={() => handleEditClick(project)}
                      onDelete={() => handleDeleteClick(project.id)}
                      onPinToggle={togglePinned}
                      isPinned={pinned.includes(project.id)}
                    />
                  ))}
            </div>
          </div>
        )}

        {!projectsLoading && filteredProjects.length === 0 && (
          <div className={styles.emptyState}>
            <FolderGit2 className={styles.emptyIcon} aria-hidden="true" />
            <p className={styles.emptyTitle}>
              {searchQuery ? "Keine Projekte gefunden" : "Noch keine Projekte"}
            </p>
            <p className={styles.emptyHint}>
              {searchQuery
                ? "Versuche eine andere Suchanfrage"
                : "Erstelle dein erstes Projekt um loszulegen"}
            </p>
            {!searchQuery && (
              <Button
                onClick={() => {
                  setIsDialogOpen(true);
                  onNewProject?.();
                }}
                className={styles.primaryButton}
              >
                <Plus aria-hidden="true" />
                Projekt erstellen
              </Button>
            )}
          </div>
        )}
      </div>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className={styles.dialogContent} data-visudev-modal="new-project">
          <DialogHeader>
            <DialogTitle>Neues Projekt erstellen</DialogTitle>
            <DialogDescription>
              {step === 1 && "Schritt 1 von 3: Repository & Projektname"}
              {step === 2 && "Schritt 2 von 3: Preview-Modus"}
              {step === 3 && "Schritt 3 von 3: Datenbank (optional, nur für Daten-Ansicht)"}
            </DialogDescription>
          </DialogHeader>

          <div className={styles.stackLg}>
            {step === 1 && (
              <div className={styles.stackMd}>
                <div className={styles.stackSm}>
                  <Label>GitHub Repository *</Label>
                  <GitHubRepoSelector
                    projectId={null}
                    onSelect={(repoFullName, branch) => {
                      setGithubRepo(repoFullName);
                      setGithubBranch(branch || "main");
                      const nameFromRepo = repoFullName.split("/").pop() ?? repoFullName;
                      setProjectName(nameFromRepo);
                    }}
                    onOpenSettings={onOpenSettings}
                    initialRepo={githubRepo}
                    initialBranch={githubBranch}
                  />
                  <Input
                    className={styles.inputSpacing}
                    value={githubRepo}
                    onChange={(event) => setGithubRepo(event.target.value)}
                    placeholder="username/repository"
                  />
                </div>

                <div className={styles.stackSm}>
                  <Label htmlFor="projectName">Projektname *</Label>
                  <Input
                    id="projectName"
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="z.B. Meine App (wird aus dem Repository übernommen)"
                  />
                  <p className={`${styles.fieldHint} ${styles.fieldHintSpacing}`}>
                    Wird beim Auswählen des Repositories gesetzt; kannst du anpassen.
                  </p>
                </div>

                <div className={styles.stackSm}>
                  <Label htmlFor="githubBranch">Branch</Label>
                  <Input
                    id="githubBranch"
                    value={githubBranch}
                    onChange={(event) => setGithubBranch(event.target.value)}
                    placeholder="main"
                  />
                </div>

                <div className={styles.stackSm}>
                  <Label htmlFor="githubToken">GitHub Access Token (optional)</Label>
                  <Input
                    id="githubToken"
                    type="password"
                    value={githubAccessToken}
                    onChange={(event) => setGithubAccessToken(event.target.value)}
                    placeholder="ghp_..."
                  />
                  <p className={`${styles.fieldHint} ${styles.fieldHintSpacing}`}>
                    Nur für private Repositories nötig
                  </p>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className={styles.stackMd}>
                <div className={styles.stackSm}>
                  <Label htmlFor="previewMode">Preview-Modus</Label>
                  <Select
                    value={previewMode}
                    onValueChange={(value) => setPreviewMode(value as PreviewMode)}
                  >
                    <SelectTrigger id="previewMode" className={styles.selectTrigger}>
                      <SelectValue placeholder="Preview-Modus auswählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="central">Server (zentral)</SelectItem>
                      <SelectItem value="local">Lokal (Docker erforderlich)</SelectItem>
                      <SelectItem value="deployed">Deployed URL</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className={`${styles.fieldHint} ${styles.fieldHintSpacing}`}>
                    Server: PREVIEW_RUNNER_URL in Supabase setzen. Lokal erfordert Docker.
                  </p>
                </div>

                {previewMode === "deployed" && (
                  <div className={styles.stackSm}>
                    <Label htmlFor="deployedUrl">Deployed URL</Label>
                    <Input
                      id="deployedUrl"
                      value={deployedUrl}
                      onChange={(event) => setDeployedUrl(event.target.value)}
                      placeholder="https://myapp.vercel.app"
                    />
                    <p className={`${styles.fieldHint} ${styles.fieldHintSpacing}`}>
                      Für Live‑Screenshots aus der Deploy‑Preview
                    </p>
                  </div>
                )}
              </div>
            )}

            {step === 3 && (
              <div className={styles.stackMd}>
                <p className={`${styles.fieldHint} ${styles.fieldHintSpacing}`}>
                  Nur für die <strong>Daten-Ansicht</strong> (ERD / Tabellen & RLS). Entweder
                  Supabase-Projekt verbinden oder lokale Datenbank auswählen.
                </p>
                <div className={styles.stackSm}>
                  <Label>Datenbank-Typ</Label>
                  <Select
                    value={databaseType}
                    onValueChange={(v) => setDatabaseType(v as "supabase" | "local")}
                  >
                    <SelectTrigger id="databaseType" className={styles.selectTrigger}>
                      <SelectValue placeholder="Datenbank wählen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="supabase">Supabase (Cloud)</SelectItem>
                      <SelectItem value="local">Lokal (z. B. PostgreSQL, SQLite)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {databaseType === "supabase" && (
                  <>
                    <div className={styles.stackSm}>
                      <Label>Supabase Projekt</Label>
                      <SupabaseProjectSelector
                        onSelect={(projectId, anonKey, managementToken) => {
                          setSupabaseProjectId(projectId);
                          setSupabaseAnonKey(anonKey);
                          setSupabaseManagementToken(managementToken);
                        }}
                        initialProjectId={supabaseProjectId}
                        initialAnonKey={supabaseAnonKey}
                      />
                    </div>

                    <div className={styles.stackSm}>
                      <Label htmlFor="supabaseToken">Supabase Management Token</Label>
                      <Input
                        id="supabaseToken"
                        type="password"
                        value={supabaseManagementToken}
                        onChange={(event) => setSupabaseManagementToken(event.target.value)}
                        placeholder="sbp_..."
                      />
                    </div>

                    <div className={styles.stackSm}>
                      <Label htmlFor="supabaseProjectId">Supabase Project ID</Label>
                      <Input
                        id="supabaseProjectId"
                        value={supabaseProjectId}
                        onChange={(event) => setSupabaseProjectId(event.target.value)}
                        placeholder="abc123..."
                      />
                    </div>

                    <div className={styles.stackSm}>
                      <Label htmlFor="supabaseAnonKey">Supabase Anon Key</Label>
                      <Input
                        id="supabaseAnonKey"
                        type="password"
                        value={supabaseAnonKey}
                        onChange={(event) => setSupabaseAnonKey(event.target.value)}
                        placeholder="eyJ..."
                      />
                    </div>
                  </>
                )}

                {databaseType === "local" && (
                  <div className={styles.stackSm}>
                    <p className={styles.fieldHint}>
                      Lokale Datenbank ausgewählt. Die Daten-Ansicht zeigt Platzhalter, bis die
                      Schema-Erkennung für lokale DBs (z. B. Connection-String) ergänzt wird.
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className={styles.actionsRow}>
              <div>
                {step > 1 && (
                  <Button variant="outline" onClick={handlePreviousStep}>
                    Zurück
                  </Button>
                )}
              </div>
              <div className={styles.actionsGroup}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsDialogOpen(false);
                    resetForm();
                    setStep(1);
                  }}
                >
                  Abbrechen
                </Button>
                {step < 3 ? (
                  <Button onClick={handleNextStep}>Weiter</Button>
                ) : (
                  <Button onClick={handleCreateProject} disabled={isLoading}>
                    {isLoading ? (
                      <>
                        <Loader2
                          className={clsx(styles.inlineIcon, styles.spinner)}
                          aria-hidden="true"
                        />
                        Wird erstellt…
                      </>
                    ) : (
                      "Projekt erstellen"
                    )}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className={styles.dialogContent} data-visudev-modal="edit-project">
          <DialogHeader>
            <DialogTitle>Projekt bearbeiten</DialogTitle>
            <DialogDescription>Projektdaten und Verknüpfungen anpassen.</DialogDescription>
          </DialogHeader>

          <div className={styles.stackMd}>
            <div className={styles.stackSm}>
              <Label htmlFor="editProjectName">Projektname</Label>
              <Input
                id="editProjectName"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
              />
            </div>

            <div className={styles.stackSm}>
              <Label htmlFor="editGithubRepo">GitHub Repository</Label>
              <Input
                id="editGithubRepo"
                value={githubRepo}
                onChange={(event) => setGithubRepo(event.target.value)}
              />
            </div>

            <div className={styles.stackSm}>
              <Label htmlFor="editGithubBranch">Branch</Label>
              <Input
                id="editGithubBranch"
                value={githubBranch}
                onChange={(event) => setGithubBranch(event.target.value)}
              />
            </div>

            <div className={styles.stackSm}>
              <Label htmlFor="editPreviewMode">Preview-Modus</Label>
              <Select
                value={previewMode}
                onValueChange={(value) => setPreviewMode(value as PreviewMode)}
              >
                <SelectTrigger id="editPreviewMode" className={styles.selectTrigger}>
                  <SelectValue placeholder="Preview-Modus auswählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="central">Server (zentral)</SelectItem>
                  <SelectItem value="local">Lokal (Docker erforderlich)</SelectItem>
                  <SelectItem value="deployed">Deployed URL</SelectItem>
                </SelectContent>
              </Select>
              <p className={`${styles.fieldHint} ${styles.fieldHintSpacing}`}>
                Server nutzt zentrale Runner‑Instanz. Lokal erfordert Docker.
              </p>
            </div>

            {previewMode === "deployed" && (
              <div className={styles.stackSm}>
                <Label htmlFor="editDeployedUrl">Deployed URL</Label>
                <Input
                  id="editDeployedUrl"
                  value={deployedUrl}
                  onChange={(event) => setDeployedUrl(event.target.value)}
                />
                <p className={`${styles.fieldHint} ${styles.fieldHintSpacing}`}>
                  Für Live‑Screenshots aus der Deploy‑Preview
                </p>
              </div>
            )}

            <div className={styles.stackSm}>
              <Label>Datenbank-Typ (Daten-Ansicht)</Label>
              <Select
                value={databaseType}
                onValueChange={(v) => setDatabaseType(v as "supabase" | "local")}
              >
                <SelectTrigger id="editDatabaseType" className={styles.selectTrigger}>
                  <SelectValue placeholder="Datenbank wählen" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supabase">Supabase (Cloud)</SelectItem>
                  <SelectItem value="local">Lokal</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {databaseType === "supabase" && (
              <>
                <div className={styles.stackSm}>
                  <Label>Supabase Projekt</Label>
                  <SupabaseProjectSelector
                    onSelect={(projectId, anonKey, managementToken) => {
                      setSupabaseProjectId(projectId);
                      setSupabaseAnonKey(anonKey);
                      setSupabaseManagementToken(managementToken);
                    }}
                    initialProjectId={supabaseProjectId}
                    initialAnonKey={supabaseAnonKey}
                  />
                </div>
                <div className={styles.stackSm}>
                  <Label htmlFor="editSupabaseToken">Supabase Management Token</Label>
                  <Input
                    id="editSupabaseToken"
                    type="password"
                    value={supabaseManagementToken}
                    onChange={(e) => setSupabaseManagementToken(e.target.value)}
                    placeholder="sbp_..."
                  />
                </div>
                <div className={styles.stackSm}>
                  <Label htmlFor="editSupabaseProjectId">Supabase Project ID</Label>
                  <Input
                    id="editSupabaseProjectId"
                    value={supabaseProjectId}
                    onChange={(e) => setSupabaseProjectId(e.target.value)}
                    placeholder="abc123..."
                  />
                </div>
                <div className={styles.stackSm}>
                  <Label htmlFor="editSupabaseAnonKey">Supabase Anon Key</Label>
                  <Input
                    id="editSupabaseAnonKey"
                    type="password"
                    value={supabaseAnonKey}
                    onChange={(e) => setSupabaseAnonKey(e.target.value)}
                    placeholder="eyJ..."
                  />
                </div>
              </>
            )}

            <div className={styles.actionsRow}>
              <div />
              <div className={styles.actionsGroup}>
                <Button
                  variant="outline"
                  onClick={() => {
                    setIsEditDialogOpen(false);
                    setEditingProject(null);
                    resetForm();
                  }}
                >
                  Abbrechen
                </Button>
                <Button onClick={handleUpdateProject} disabled={isLoading}>
                  {isLoading ? (
                    <>
                      <Loader2
                        className={clsx(styles.inlineIcon, styles.spinner)}
                        aria-hidden="true"
                      />
                      Wird gespeichert…
                    </>
                  ) : (
                    "Speichern"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={isDeleteConfirmOpen}
        onOpenChange={(open) => !open && handleDeleteConfirmClose()}
      >
        <DialogContent className={styles.dialogContent} data-visudev-modal="delete-project">
          <DialogHeader>
            <DialogTitle>Projekt löschen</DialogTitle>
            <DialogDescription>
              Dieses Projekt wird endgültig gelöscht. Zum Bestätigen bitte dein Passwort eingeben.
            </DialogDescription>
          </DialogHeader>
          <div className={styles.stackMd}>
            <div className={styles.stackSm}>
              <Label htmlFor="deleteConfirmPassword">Passwort</Label>
              <Input
                id="deleteConfirmPassword"
                type="password"
                value={deleteConfirmPassword}
                onChange={(e) => setDeleteConfirmPassword(e.target.value)}
                placeholder="Dein Passwort"
                autoComplete="current-password"
                disabled={isDeleteLoading}
              />
            </div>
            <div className={styles.actionsRow}>
              <div />
              <div className={styles.actionsGroup}>
                <Button
                  variant="outline"
                  onClick={handleDeleteConfirmClose}
                  disabled={isDeleteLoading}
                >
                  Abbrechen
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteConfirmSubmit}
                  disabled={!deleteConfirmPassword.trim() || isDeleteLoading}
                >
                  {isDeleteLoading ? (
                    <>
                      <Loader2
                        className={clsx(styles.inlineIcon, styles.spinner)}
                        aria-hidden="true"
                      />
                      Wird gelöscht…
                    </>
                  ) : (
                    "Projekt löschen"
                  )}
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

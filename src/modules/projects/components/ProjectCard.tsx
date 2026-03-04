import type { MouseEvent } from "react";
import clsx from "clsx";
import {
  Calendar,
  Database,
  FolderGit2,
  Github,
  Globe,
  MoreVertical,
  Pin,
  Trash2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { useVisudev } from "../../../lib/visudev/store";
import type { Project } from "../../../lib/visudev/types";
import styles from "../styles/ProjectCard.module.css";

interface ProjectCardProps {
  project: Project;
  onDelete?: (id: string) => void;
  onClick?: (project: Project) => void;
  onEdit?: (project: Project) => void;
  onPinToggle?: (projectId: string) => void;
  isPinned?: boolean;
}

export function ProjectCard({
  project,
  onDelete,
  onClick,
  onEdit,
  onPinToggle,
  isPinned,
}: ProjectCardProps) {
  const { activeProject, setActiveProject } = useVisudev();
  const isActive = activeProject?.id === project.id;

  const formattedDate = new Date(project.createdAt).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  const handleOpen = (event: MouseEvent) => {
    event.stopPropagation();
    onClick?.(project);
  };

  const handleEdit = (event: MouseEvent) => {
    event.stopPropagation();
    onEdit?.(project);
  };

  const handleUnselect = (event: MouseEvent) => {
    event.stopPropagation();
    setActiveProject(null);
  };

  const handleDelete = (event: MouseEvent) => {
    event.stopPropagation();
    onDelete?.(project.id);
  };

  const handlePinToggle = (event: MouseEvent) => {
    event.stopPropagation();
    onPinToggle?.(project.id);
  };

  return (
    <div
      className={clsx(styles.card, isActive && styles.cardActive)}
      onClick={() => onClick?.(project)}
    >
      <div
        className={styles.header}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className={styles.iconBadge}>
          <FolderGit2 className={styles.icon} aria-hidden="true" />
        </div>
        <div className={styles.headerActions}>
          {onPinToggle && (
            <button
              type="button"
              className={clsx(styles.pinButton, isPinned && styles.pinActive)}
              onClick={handlePinToggle}
              aria-label={isPinned ? "Projekt ablösen" : "Projekt anpinnen"}
            >
              <Pin className={styles.pinIcon} />
            </button>
          )}
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={styles.dropdownButton}
                aria-label="Projekt-Aktionen öffnen"
              >
                <MoreVertical aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              collisionPadding={8}
              className={styles.dropdownContent}
            >
              <DropdownMenuItem onClick={handleOpen}>Öffnen</DropdownMenuItem>
              <DropdownMenuItem onClick={handleEdit}>Bearbeiten</DropdownMenuItem>
              {isActive && <DropdownMenuItem onClick={handleUnselect}>Abwählen</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={styles.dropdownDanger}
                onClick={handleDelete}
                aria-label="Projekt löschen"
              >
                <Trash2 className={styles.menuIcon} aria-hidden="true" />
                Projekt löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <h3 className={styles.title}>{project.name}</h3>

      <div className={styles.metaList}>
        {project.github_repo && (
          <div className={styles.metaRow}>
            <Github className={styles.icon} aria-hidden="true" />
            <span className={styles.metaRowText}>{project.github_repo}</span>
            {project.github_branch && (
              <span className={styles.branchBadge}>{project.github_branch}</span>
            )}
          </div>
        )}
        {(project.database_type === "local" || project.supabase_project_id) && (
          <div className={styles.metaRow}>
            <Database className={styles.icon} aria-hidden="true" />
            <span className={styles.metaRowText}>
              {project.database_type === "local" ? "Lokale Datenbank" : project.supabase_project_id}
            </span>
          </div>
        )}
        <div className={styles.metaRow}>
          <Globe className={styles.icon} aria-hidden="true" />
          {project.deployed_url ? (
            <span className={styles.metaRowText}>{project.deployed_url}</span>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onEdit?.(project);
              }}
              className={styles.deployedLink}
            >
              Deployed URL hinzufügen...
            </button>
          )}
        </div>
      </div>

      <div className={styles.footer}>
        <Calendar className={styles.icon} aria-hidden="true" />
        <span>Erstellt am {formattedDate}</span>
      </div>
    </div>
  );
}

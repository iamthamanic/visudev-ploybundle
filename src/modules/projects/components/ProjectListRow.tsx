/**
 * Projekt als kompakte Listenzeile (Name, Repo, Datum, Aktionen).
 * Wird auf der Projekte-Seite in der Listenansicht verwendet.
 */

import type { MouseEvent } from "react";
import clsx from "clsx";
import { Calendar, FolderGit2, Github, MoreVertical, Pin, Trash2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { useVisudev } from "../../../lib/visudev/store";
import type { Project } from "../../../lib/visudev/types";
import styles from "../styles/ProjectListRow.module.css";

interface ProjectListRowProps {
  project: Project;
  onDelete?: (id: string) => void;
  onClick?: (project: Project) => void;
  onEdit?: (project: Project) => void;
  onPinToggle?: (projectId: string) => void;
  isPinned?: boolean;
  /** When true, row is inside table (no card border/radius, only bottom border). */
  isTableRow?: boolean;
}

export function ProjectListRow({
  project,
  onDelete,
  onClick,
  onEdit,
  onPinToggle,
  isPinned = false,
  isTableRow = false,
}: ProjectListRowProps) {
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
      className={clsx(styles.row, isActive && styles.rowActive, isTableRow && styles.rowInTable)}
      onClick={() => onClick?.(project)}
    >
      <div className={styles.iconCell}>
        <FolderGit2 className={styles.icon} aria-hidden="true" />
      </div>
      <div className={styles.nameCell}>
        <span className={styles.name}>{project.name}</span>
      </div>
      <div className={styles.repoCell}>
        {project.github_repo ? (
          <span className={styles.repo}>
            <Github className={styles.repoIcon} aria-hidden="true" />
            <span className={styles.repoText} title={project.github_repo}>
              {project.github_repo}
            </span>
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </div>
      <div className={styles.branchCell}>
        {project.github_branch ? (
          <span className={styles.branch} title={project.github_branch}>
            {project.github_branch}
          </span>
        ) : (
          <span className={styles.muted}>—</span>
        )}
      </div>
      <div className={styles.dateCell}>
        <Calendar className={styles.dateIcon} aria-hidden="true" />
        <span>{formattedDate}</span>
      </div>
      <div
        className={styles.pinCell}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {onPinToggle && (
          <button
            type="button"
            className={clsx(styles.menuButton, isPinned && styles.pinActive)}
            onClick={handlePinToggle}
            aria-label={
              isPinned ? "Projekt oben anheften (Anpinnen aufheben)" : "Projekt oben anheften"
            }
            title={isPinned ? "Anpinnen aufheben" : "Oben anheften"}
          >
            <Pin className={styles.pinIcon} aria-hidden="true" />
          </button>
        )}
      </div>
      <div
        className={styles.actionsCell}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={styles.menuButton}
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
  );
}

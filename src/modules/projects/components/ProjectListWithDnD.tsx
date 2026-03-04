/**
 * Listen-Container mit Drag-and-Drop und Drop-Zonen zum Verschieben von Projekten.
 * Tabellen-Header (NAME, REPO, BRANCH, CREATED AT, PIN, EDIT) mit Klick-Sortierung.
 * Location: src/modules/projects/components/ProjectListWithDnD.tsx
 */

import { useCallback, useState } from "react";
import clsx from "clsx";
import { GripVertical } from "lucide-react";
import type { Project } from "../../../lib/visudev/types";
import { ProjectListRow } from "./ProjectListRow";
import styles from "../styles/ProjectListWithDnD.module.css";

export type ListSortColumn = "name" | "repo" | "branch" | "createdAt";

interface ProjectListWithDnDProps {
  projects: Project[];
  onProjectClick: (project: Project) => void;
  onEdit: (project: Project) => void;
  onDelete: (id: string) => void;
  onPinToggle: (projectId: string) => void;
  pinnedIds: string[];
  onMove: (projectId: string, toIndex: number) => void;
  sortBy?: ListSortColumn | null;
  sortDir?: "asc" | "desc";
  onSort?: (column: ListSortColumn) => void;
}

export function ProjectListWithDnD({
  projects,
  onProjectClick,
  onEdit,
  onDelete,
  onPinToggle,
  pinnedIds,
  onMove,
  sortBy = null,
  sortDir = "asc",
  onSort,
}: ProjectListWithDnDProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, projectId: string) => {
    e.dataTransfer.setData("text/plain", projectId);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(projectId);
  }, []);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDropTargetIndex(null);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetIndex((prev) => (prev === index ? prev : index));
  }, []);

  const handleDragLeave = useCallback(() => {
    setDropTargetIndex(null);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, toIndex: number) => {
      e.preventDefault();
      const projectId = e.dataTransfer.getData("text/plain");
      if (projectId) onMove(projectId, toIndex);
      setDraggingId(null);
      setDropTargetIndex(null);
    },
    [onMove],
  );

  return (
    <div className={styles.tableWrap}>
      <div className={styles.headerRow}>
        <div className={styles.headerSpacer} aria-hidden="true" />
        <div className={styles.headerGrid}>
          <span className={styles.headerCell} aria-hidden="true" />
          {onSort ? (
            <>
              <button
                type="button"
                className={clsx(styles.headerCell, styles.headerCellSortable)}
                onClick={() => onSort("name")}
                aria-label={
                  sortBy === "name"
                    ? `Nach Name ${sortDir === "asc" ? "aufsteigend" : "absteigend"}`
                    : "Nach Name sortieren"
                }
              >
                Name{sortBy === "name" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
              <button
                type="button"
                className={clsx(styles.headerCell, styles.headerCellSortable)}
                onClick={() => onSort("repo")}
                aria-label={
                  sortBy === "repo"
                    ? `Nach Repo ${sortDir === "asc" ? "aufsteigend" : "absteigend"}`
                    : "Nach Repo sortieren"
                }
              >
                Repo{sortBy === "repo" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
              <button
                type="button"
                className={clsx(styles.headerCell, styles.headerCellSortable)}
                onClick={() => onSort("branch")}
                aria-label={
                  sortBy === "branch"
                    ? `Nach Branch ${sortDir === "asc" ? "aufsteigend" : "absteigend"}`
                    : "Nach Branch sortieren"
                }
              >
                Branch{sortBy === "branch" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
              <button
                type="button"
                className={clsx(styles.headerCell, styles.headerCellSortable)}
                onClick={() => onSort("createdAt")}
                aria-label={
                  sortBy === "createdAt"
                    ? `Nach Datum ${sortDir === "asc" ? "aufsteigend" : "absteigend"}`
                    : "Nach Erstellungsdatum sortieren"
                }
              >
                Erstellt{sortBy === "createdAt" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
              </button>
            </>
          ) : (
            <>
              <span className={styles.headerCell}>Name</span>
              <span className={styles.headerCell}>Repo</span>
              <span className={styles.headerCell}>Branch</span>
              <span className={styles.headerCell}>Erstellt</span>
            </>
          )}
          <span className={styles.headerCell}>Pin</span>
          <span className={styles.headerCell}>Bearb.</span>
        </div>
      </div>
      <div className={styles.list}>
        {projects.map((project, index) => (
          <div key={project.id} className={styles.listGroup}>
            <div
              className={clsx(styles.dropZone, dropTargetIndex === index && styles.dropZoneActive)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
            >
              {dropTargetIndex === index && (
                <span className={styles.dropZoneLabel}>Hier einfügen</span>
              )}
            </div>
            <div
              className={clsx(styles.rowWrap, draggingId === project.id && styles.rowWrapDragging)}
              draggable
              onDragStart={(e) => handleDragStart(e, project.id)}
              onDragEnd={handleDragEnd}
            >
              <div
                className={styles.dragHandle}
                onPointerDown={(e) => e.stopPropagation()}
                title="Zum Verschieben ziehen"
              >
                <GripVertical aria-hidden="true" />
              </div>
              <ProjectListRow
                project={project}
                onClick={() => onProjectClick(project)}
                onEdit={() => onEdit(project)}
                onDelete={(id) => onDelete(id)}
                onPinToggle={() => onPinToggle(project.id)}
                isPinned={pinnedIds.includes(project.id)}
                isTableRow
              />
            </div>
          </div>
        ))}
        <div
          className={clsx(
            styles.dropZone,
            dropTargetIndex === projects.length && styles.dropZoneActive,
          )}
          onDragOver={(e) => handleDragOver(e, projects.length)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, projects.length)}
        >
          {dropTargetIndex === projects.length && (
            <span className={styles.dropZoneLabel}>Hier einfügen</span>
          )}
        </div>
      </div>
    </div>
  );
}

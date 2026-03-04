/**
 * LogsPage: Projekt-Logs mit Filter (INFO/WARN/ERROR), Suche und Auto-Scroll.
 * Lädt Einträge von visudev-logs API; max. 1000 Einträge; Styling über CSS-Module.
 * Location: src/modules/logs/pages/LogsPage.tsx
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, Loader2, Search, ToggleLeft, ToggleRight } from "lucide-react";
import clsx from "clsx";
import { toast } from "sonner";
import { useLogs } from "../../../utils/useVisuDev";
import type { LogEntry } from "../types";
import styles from "../styles/LogsPage.module.css";

const MAX_ENTRIES = 1000;
const LEVELS = ["INFO", "WARN", "ERROR"] as const;
type LevelFilter = "all" | (typeof LEVELS)[number];

function getLevel(entry: LogEntry): string {
  const level = entry.level;
  if (typeof level === "string") return level.toUpperCase();
  return "INFO";
}

function matchesSearch(entry: LogEntry, query: string): boolean {
  if (!query.trim()) return true;
  const q = query.trim().toLowerCase();
  const msg = typeof entry.message === "string" ? entry.message : "";
  const rest = JSON.stringify(entry).toLowerCase();
  return msg.toLowerCase().includes(q) || rest.includes(q);
}

function highlightText(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const q = query.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(${q})`, "gi");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <mark key={i} className={styles.highlight}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

interface LogsPageProps {
  projectId: string;
}

export function LogsPage({ projectId }: LogsPageProps) {
  const { logs, loading, error, refresh } = useLogs(projectId);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);
  const listEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) {
      toast.error("Logs konnten nicht geladen werden.", {
        description: "Versuche es erneut mit „Erneut laden“.",
      });
    }
  }, [error]);

  const filteredLogs = useMemo(() => {
    let list = logs;
    if (levelFilter !== "all") {
      list = list.filter((e) => getLevel(e) === levelFilter);
    }
    list = list.filter((e) => matchesSearch(e, searchQuery));
    return list.slice(0, MAX_ENTRIES);
  }, [logs, levelFilter, searchQuery]);

  useEffect(() => {
    if (autoScroll && listEndRef.current) {
      listEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [autoScroll, filteredLogs.length]);

  const messageText = useCallback((entry: LogEntry): string => {
    if (typeof entry.message === "string") return entry.message;
    const { id, ...rest } = entry;
    return Object.keys(rest).length ? JSON.stringify(rest) : id;
  }, []);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Logs</h1>
          <p className={styles.subtitle}>Projekt-Logs • max. {MAX_ENTRIES} Einträge</p>
        </div>
      </div>

      <div className={styles.toolbar}>
        <div className={styles.filterRow}>
          <span className={styles.filterLabel}>Level:</span>
          <button
            type="button"
            className={clsx(styles.filterBtn, levelFilter === "all" && styles.filterBtnActive)}
            onClick={() => setLevelFilter("all")}
          >
            Alle
          </button>
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              className={clsx(
                styles.filterBtn,
                styles[`level${level}` as keyof typeof styles],
                levelFilter === level && styles.filterBtnActive,
              )}
              onClick={() => setLevelFilter(level)}
            >
              {level}
            </button>
          ))}
        </div>
        <div className={styles.searchRow}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <input
            type="search"
            placeholder="Suchen…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={styles.searchInput}
            aria-label="Logs durchsuchen"
          />
        </div>
        <button
          type="button"
          className={styles.autoScrollBtn}
          onClick={() => setAutoScroll((v) => !v)}
          aria-pressed={autoScroll}
          aria-label={autoScroll ? "Auto-Scroll aus" : "Auto-Scroll an"}
        >
          {autoScroll ? (
            <ToggleRight className={styles.autoScrollIcon} aria-hidden="true" />
          ) : (
            <ToggleLeft className={styles.autoScrollIcon} aria-hidden="true" />
          )}
          <span>Auto-Scroll</span>
        </button>
      </div>

      <div className={styles.content}>
        {loading ? (
          <div className={styles.loadingState} role="status" aria-live="polite">
            <Loader2 className={styles.loadingSpinner} aria-hidden="true" />
            <p className={styles.loadingText}>Lade Logs…</p>
          </div>
        ) : error ? (
          <div className={styles.errorState}>
            <AlertCircle className={styles.emptyIcon} aria-hidden="true" />
            <p className={styles.emptyTitle}>{error}</p>
            <button type="button" onClick={() => refresh()} className={styles.retryBtn}>
              Erneut laden
            </button>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className={styles.emptyState}>
            <AlertCircle className={styles.emptyIcon} aria-hidden="true" />
            <p className={styles.emptyTitle}>
              {logs.length === 0 ? "Keine Logs vorhanden" : "Keine Einträge passen zum Filter"}
            </p>
            <p className={styles.emptyHint}>
              {logs.length === 0
                ? "Logs erscheinen hier, sobald sie vom Projekt erzeugt werden."
                : "Level oder Suchbegriff anpassen."}
            </p>
          </div>
        ) : (
          <div className={styles.list}>
            {filteredLogs.map((entry) => {
              const level = getLevel(entry);
              const levelClass = styles[`level${level}` as keyof typeof styles] ?? styles.levelINFO;
              return (
                <div key={entry.id} className={styles.logRow}>
                  <span className={styles.logTime}>
                    {new Date(entry.timestamp).toLocaleString("de-DE")}
                  </span>
                  <span className={clsx(styles.logLevel, levelClass)}>{level}</span>
                  <span className={styles.logMessage}>
                    {highlightText(messageText(entry), searchQuery)}
                  </span>
                </div>
              );
            })}
            <div ref={listEndRef} className={styles.listEnd} aria-hidden="true" />
          </div>
        )}
      </div>
    </div>
  );
}

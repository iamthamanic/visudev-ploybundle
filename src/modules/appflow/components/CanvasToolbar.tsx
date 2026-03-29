/**
 * CanvasToolbar – Zoom, Home, Terminal-Toggle und optional Fortschrittsbalken für Live Flow.
 * Location: src/modules/appflow/components/CanvasToolbar.tsx
 */

import clsx from "clsx";
import { ZoomIn, ZoomOut, Home, Terminal, LayoutGrid } from "lucide-react";
import type { FlowAnalysisSummary } from "../services/analysis-status";
import styles from "../styles/LiveFlowCanvas.module.css";

interface CanvasToolbarProps {
  showProgress: boolean;
  progressTrackRef: React.RefObject<HTMLDivElement>;
  loadedCount: number;
  totalWithUrl: number;
  progressPercent: number;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onZoomReset: () => void;
  showTerminal: boolean;
  onToggleTerminal: () => void;
  /** When true, show "Positionen zurücksetzen" (clear drag overrides). */
  hasPositionOverrides?: boolean;
  onResetPositions?: () => void;
  /** When true, show hint that tab positions were not received (lines start at card edge). */
  showNavHint?: boolean;
  analysisSummary?: FlowAnalysisSummary;
}

export function CanvasToolbar({
  showProgress,
  progressTrackRef,
  loadedCount,
  totalWithUrl,
  progressPercent,
  zoom,
  onZoomOut,
  onZoomIn,
  onZoomReset,
  showTerminal,
  onToggleTerminal,
  hasPositionOverrides = false,
  onResetPositions,
  showNavHint = false,
  analysisSummary,
}: CanvasToolbarProps): React.ReactElement {
  return (
    <div className={styles.controls}>
      {showProgress && (
        <div className={styles.progressWrap} role="status" aria-live="polite">
          <div className={styles.progressBarTrack} ref={progressTrackRef}>
            <div className={styles.progressBarFill} />
          </div>
          <span className={styles.progressText}>
            Screens: {loadedCount}/{totalWithUrl} ({progressPercent} %)
          </span>
        </div>
      )}
      {analysisSummary && (
        <div className={styles.analysisSummary} role="status" aria-live="polite">
          {analysisSummary.score != null && (
            <span
              className={styles.analysisPill}
              title="Analyse-Score aus Deterministik, Evidence und Runtime-Verifikation"
            >
              Score {analysisSummary.score}
            </span>
          )}
          <span className={styles.analysisPill} title="Screens mit verifiziertem Status">
            Screens {analysisSummary.verifiedNodeCount}
          </span>
          <span className={styles.analysisPill} title="Kanten mit Runtime-Verifikation">
            Kanten {analysisSummary.verifiedEdgeCount}
          </span>
          {analysisSummary.mismatchCount > 0 && (
            <span
              className={styles.analysisPillWarning}
              title="Runtime-Crawl meldet Abweichungen zwischen DOM und Graph"
            >
              Mismatch {analysisSummary.mismatchCount}
            </span>
          )}
          {analysisSummary.highIssueCount > 0 && (
            <span className={styles.analysisPillDanger} title="Offene High-Issues im Analyse-Graph">
              High {analysisSummary.highIssueCount}
            </span>
          )}
        </div>
      )}
      <button type="button" onClick={onZoomOut} className={styles.zoomBtn} title="Verkleinern">
        <ZoomOut className={styles.zoomIcon} aria-hidden="true" />
      </button>
      <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={onZoomIn} className={styles.zoomBtn} title="Vergrößern">
        <ZoomIn className={styles.zoomIcon} aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={onZoomReset}
        className={styles.zoomBtn}
        title="Zoom & Pan zurücksetzen"
      >
        <Home className={styles.zoomIcon} aria-hidden="true" />
      </button>
      {hasPositionOverrides && onResetPositions && (
        <button
          type="button"
          onClick={onResetPositions}
          className={styles.zoomBtn}
          title="Kartenpositionen auf automatisches Layout zurücksetzen"
        >
          <LayoutGrid className={styles.zoomIcon} aria-hidden="true" />
          <span className={styles.terminalBtnLabel}>Layout</span>
        </button>
      )}
      <button
        type="button"
        onClick={onToggleTerminal}
        className={clsx(
          styles.zoomBtn,
          styles.terminalBtn,
          showTerminal && styles.terminalBtnActive,
        )}
        title={showTerminal ? "Logs schließen" : "Logs: Lade-Logs der Screens anzeigen"}
        aria-expanded={showTerminal}
      >
        <Terminal className={styles.zoomIcon} aria-hidden="true" />
        <span className={styles.terminalBtnLabel}>Logs</span>
      </button>
      {showNavHint && (
        <span
          className={styles.hintNav}
          title="Die Preview-App muss im Iframe Tab-Positionen senden (visudev-dom-report)."
        >
          Linien am Kartenrand – Tab-Positionen nicht empfangen
        </span>
      )}
      <span className={styles.hint}>Klick auf Kante: Punkt animiert.</span>
    </div>
  );
}

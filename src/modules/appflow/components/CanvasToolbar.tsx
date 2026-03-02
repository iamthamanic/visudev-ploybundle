/**
 * CanvasToolbar – Zoom, Home, Terminal-Toggle und optional Fortschrittsbalken für Live Flow.
 * Location: src/modules/appflow/components/CanvasToolbar.tsx
 */

import clsx from "clsx";
import { ZoomIn, ZoomOut, Home, Terminal, LayoutGrid } from "lucide-react";
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
      <button type="button" onClick={onZoomOut} className={styles.zoomBtn} title="Verkleinern">
        <ZoomOut className={styles.zoomIcon} aria-hidden="true" />
      </button>
      <span className={styles.zoomValue}>{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={onZoomIn} className={styles.zoomBtn} title="Vergrößern">
        <ZoomIn className={styles.zoomIcon} aria-hidden="true" />
      </button>
      <button type="button" onClick={onZoomReset} className={styles.zoomBtn} title="Zoom & Pan zurücksetzen">
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
      <span className={styles.hint}>Klick auf Kante: Punkt animiert.</span>
    </div>
  );
}

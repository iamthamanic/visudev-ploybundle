/**
 * FlowNodeCard – Einzelne Screen-Karte im Live Flow (Label, Iframe, Fehler oder Platzhalter).
 * Optional: Drag-Handle zum Verschieben der Karte auf dem Canvas.
 * Location: src/modules/appflow/components/FlowNodeCard.tsx
 */

import { GripVertical, Loader2 } from "lucide-react";
import type { CSSProperties } from "react";
import clsx from "clsx";
import type { Screen } from "../../../lib/visudev/types";
import type { VisudevDomReport } from "../types";
import styles from "../styles/LiveFlowCanvas.module.css";

/** Virtual viewport scale: iframe content is rendered at (width/scale x height/scale) then scaled down so it fits the card and keeps proportion. */
const NODE_IFRAME_SCALE = 0.45;

export const NODE_FAIL_REASONS = {
  LOAD_ERROR:
    "Ladefehler (-102 = Verbindung verweigert: nichts läuft unter der URL). „Preview starten“ oder Deployed-URL prüfen.",
  NO_URL: "Keine URL: Basis-URL oder Screen-Pfad fehlt.",
} as const;

interface FlowNodeCardProps {
  screen: Screen;
  pos: { x: number; y: number };
  iframeSrc: string;
  loadState: "loading" | "loaded" | "failed";
  failReason: string | undefined;
  domReport: VisudevDomReport | undefined;
  onLoad: () => void;
  onError: (reason: string, name: string, url: string) => void;
  registerIframe: (win: Window, screenId: string) => void;
  nodeWidth: number;
  nodeHeight: number;
  isFocused?: boolean;
  isDimmed?: boolean;
  /** Called when user starts dragging this card (mousedown on handle). Pass clientX, clientY for delta calculation. */
  onDragHandleMouseDown?: (screenId: string, clientX: number, clientY: number) => void;
}

export function FlowNodeCard({
  screen,
  pos,
  iframeSrc,
  loadState,
  failReason,
  domReport,
  onLoad,
  onError,
  registerIframe,
  nodeWidth,
  nodeHeight,
  isFocused = false,
  isDimmed = false,
  onDragHandleMouseDown,
}: FlowNodeCardProps) {
  const reason = failReason ?? NODE_FAIL_REASONS.LOAD_ERROR;
  const isConnectionError =
    /ECONNREFUSED|Bad Gateway|nicht erreichbar|502|-102|Verbindung verweigert/i.test(reason);

  return (
    <div
      className={clsx(
        styles.nodeCard,
        isFocused && styles.nodeCardFocused,
        isDimmed && styles.nodeCardDimmed,
      )}
      ref={(el) => {
        if (el) {
          el.style.setProperty("--node-left", `${pos.x}px`);
          el.style.setProperty("--node-top", `${pos.y}px`);
          el.style.setProperty("--node-width", `${nodeWidth}px`);
          el.style.setProperty("--node-height", `${nodeHeight}px`);
        }
      }}
    >
      <div className={styles.nodeLabel}>
        {onDragHandleMouseDown && (
          <button
            type="button"
            className={styles.nodeDragHandle}
            aria-label="Karte verschieben"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onDragHandleMouseDown(screen.id, e.clientX, e.clientY);
            }}
          >
            <GripVertical aria-hidden="true" />
          </button>
        )}
        {screen.name}
        {screen.path ? ` · ${screen.path}` : ""}
      </div>
      {domReport && (
        <div className={styles.nodeLiveReport} title="Live-Daten von der App">
          Live: {domReport.route}
          {domReport.buttons != null && ` · ${domReport.buttons.length} Buttons`}
        </div>
      )}
      {loadState === "failed" ? (
        <div
          className={styles.nodeFailed}
          role="status"
          data-testid="screen-card-failed"
          data-screen-id={screen.id}
        >
          <span className={styles.nodeFailedReason} data-testid="screen-fail-reason">
            {reason}
          </span>
          {isConnectionError && (
            <span className={styles.nodeFailedAction}>
              → „Preview neu starten“ oben oder Docker prüfen.
            </span>
          )}
          {iframeSrc ? (
            <a
              href={iframeSrc}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.nodeOpenInTab}
            >
              In neuem Tab öffnen
            </a>
          ) : null}
        </div>
      ) : iframeSrc ? (
        <div className={styles.nodeIframeWrap}>
          <div
            className={styles.nodeIframeScaled}
            style={
              {
                "--iframe-scale": NODE_IFRAME_SCALE,
                "--iframe-inner-width": `${Math.round(nodeWidth / NODE_IFRAME_SCALE)}px`,
                "--iframe-inner-height": `${Math.round(nodeHeight / NODE_IFRAME_SCALE)}px`,
              } as CSSProperties
            }
          >
            <iframe
              src={iframeSrc}
              title={`Live: ${screen.name}`}
              className={styles.nodeIframe}
              data-testid="screen-card-iframe"
              data-screen-id={screen.id}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={onLoad}
              onError={() => onError(NODE_FAIL_REASONS.LOAD_ERROR, screen.name, iframeSrc)}
              ref={(el) => {
                if (el?.contentWindow) registerIframe(el.contentWindow, screen.id);
              }}
            />
          </div>
          {loadState === "loading" && (
            <div className={styles.nodeLoadingOverlay} data-testid="screen-card-loading">
              <Loader2 className={styles.nodeLoadingSpinner} aria-hidden="true" />
              <span className={styles.nodeLoadingText}>Laden…</span>
            </div>
          )}
        </div>
      ) : (
        <div className={styles.nodePlaceholder}>{NODE_FAIL_REASONS.NO_URL}</div>
      )}
    </div>
  );
}

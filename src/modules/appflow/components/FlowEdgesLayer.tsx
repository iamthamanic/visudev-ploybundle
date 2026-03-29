/**
 * FlowEdgesLayer – SVG-Kanten und Klick-Hit-Targets für den Live Flow Graph.
 * Zeichnet Kanten zwischen Nodes und animierbaren Punkt; ref-Callback füllt pathRefs für Animation.
 * Phase 4: Navigate-Edges starten an der exakten Tab-Position (domReports[fromId].navItems), wenn
 * der Nav-Host-Screen (fromId) den DOM-Report von seiner Iframe-Preview sendet; sonst Fallback am rechten Kartenrand verteilt.
 * Location: src/modules/appflow/components/FlowEdgesLayer.tsx
 */

import { useMemo } from "react";
import type { FlowEdgeAnalysisMeta } from "../services/analysis-status";
import type { GraphEdge } from "../layout";
import type { NodePosition } from "../layout";
import type { VisudevDomReport, VisudevNavItem } from "../types";
import styles from "../styles/LiveFlowCanvas.module.css";

const NODE_WIDTH = 320;
/** Must match LiveFlowCanvas NODE_HEIGHT (card height for 320×240 iframe area). */
const NODE_HEIGHT = 296;
const ANCHOR_MARGIN = 24;
/** Label row height (title + drag handle). Incoming edges dock at this Y. */
export const LABEL_HEIGHT = 28;
/** Offset of dock point from right edge of card (dot right of title). Must match .nodeDock right in CSS. */
export const DOCK_OFFSET_X = 8;
/** Must match FlowNodeCard NODE_IFRAME_SCALE – iframe content is drawn scaled so nav rects must be scaled to card coords. */
const NODE_IFRAME_SCALE = 0.45;

/** Normalize path for matching: leading slash, no trailing, lowercase, "/" and "/projects" both → "/" (Projekte tab). */
function normalizePathForMatch(p: string): string {
  const t = (p ?? "").trim();
  const withSlash = t.startsWith("/") ? t : `/${t}`;
  const noTrailing = withSlash.replace(/\/$/, "") || "/";
  const lower = noTrailing.toLowerCase();
  /* Sidebar sends "/" for Projekte; edges often have targetPath "/projects" – treat as same. */
  return lower === "/projects" ? "/" : lower;
}

/** Segment only: "appflow", "blueprint", "" for projects. Used for fallback matching. */
function pathToSegment(p: string): string {
  const norm = normalizePathForMatch(p);
  if (norm === "/" || norm === "/projects") return "projects";
  return norm.replace(/^\//, "") || "projects";
}

function findNavItemForTarget(
  navItems: VisudevNavItem[] | undefined,
  targetPath: string | undefined,
): VisudevNavItem | undefined {
  if (!navItems?.length || targetPath == null) return undefined;
  const targetNorm = normalizePathForMatch(targetPath);
  const targetSeg = pathToSegment(targetPath);
  const exact = navItems.find((item) => normalizePathForMatch(item.path) === targetNorm);
  if (exact) return exact;
  return navItems.find((item) => pathToSegment(item.path) === targetSeg);
}

/** When we only have fallback report, get tab index by path so we can place edge start Y by tab order on the source card. */
function getTabIndexFromNavItems(
  navItems: VisudevNavItem[] | undefined,
  targetPath: string | undefined,
): { index: number; total: number } | null {
  if (!navItems?.length || targetPath == null) return null;
  const targetNorm = normalizePathForMatch(targetPath);
  const targetSeg = pathToSegment(targetPath);
  const index = navItems.findIndex(
    (item) =>
      normalizePathForMatch(item.path) === targetNorm || pathToSegment(item.path) === targetSeg,
  );
  if (index < 0) return null;
  return { index, total: navItems.length };
}

/** Per (fromId, toId) or edge index: 0..1 for Y offset on source card right edge (navigate only). */
function useNavigateAnchorRanks(edges: GraphEdge[]): Map<string, { index: number; total: number }> {
  return useMemo(() => {
    const navByFrom = new Map<string, GraphEdge[]>();
    edges.forEach((e) => {
      if (e.type !== "navigate") return;
      const list = navByFrom.get(e.fromId) ?? [];
      list.push(e);
      navByFrom.set(e.fromId, list);
    });
    const ranks = new Map<string, { index: number; total: number }>();
    navByFrom.forEach((list) => {
      const sorted = [...list].sort((a, b) =>
        (a.targetPath ?? "").localeCompare(b.targetPath ?? ""),
      );
      sorted.forEach((edge, index) => {
        ranks.set(`${edge.fromId}-${edge.toId}`, { index, total: sorted.length });
      });
    });
    return ranks;
  }, [edges]);
}

function getStartY(
  fromPos: NodePosition,
  edge: GraphEdge,
  anchorRanks: Map<string, { index: number; total: number }>,
): number {
  if (edge.type !== "navigate") {
    return fromPos.y + NODE_HEIGHT / 2;
  }
  const rank = anchorRanks.get(`${edge.fromId}-${edge.toId}`);
  if (!rank || rank.total <= 0) return fromPos.y + NODE_HEIGHT / 2;
  if (rank.total === 1) return fromPos.y + NODE_HEIGHT / 2;
  const t = rank.total === 1 ? 0.5 : rank.index / (rank.total - 1);
  return fromPos.y + ANCHOR_MARGIN + t * (NODE_HEIGHT - 2 * ANCHOR_MARGIN);
}

interface FlowEdgesLayerProps {
  edges: GraphEdge[];
  positions: Map<string, NodePosition>;
  minX: number;
  minY: number;
  contentWidth: number;
  contentHeight: number;
  pathRefs: React.MutableRefObject<Map<string, SVGPathElement>>;
  dotPosition: { x: number; y: number } | null;
  /** DOM reports per screen id (from iframe postMessage). edge.fromId must be nav-host screen so domReports[fromId].navItems gives tab rects for start position. */
  domReports?: Record<string, VisudevDomReport>;
  /** Fallback: use this report's navItems when fromId has no report (e.g. Shell loaded in different screen id). */
  fallbackDomReport?: VisudevDomReport | null;
  /** Edge key (fromId-toId) of the clicked edge; only this edge is drawn green, others gray. */
  selectedEdgeKey?: string | null;
  edgeMetaByKey?: Record<string, FlowEdgeAnalysisMeta>;
  onEdgeClick: (edge: GraphEdge) => void;
}

export function FlowEdgesLayer({
  edges,
  positions,
  minX,
  minY,
  contentWidth,
  contentHeight,
  pathRefs,
  dotPosition,
  domReports,
  fallbackDomReport = null,
  selectedEdgeKey = null,
  edgeMetaByKey,
  onEdgeClick,
}: FlowEdgesLayerProps): React.ReactElement {
  const anchorRanks = useNavigateAnchorRanks(edges);

  const renderPath = (edge: GraphEdge) => {
    const fromPos = positions.get(edge.fromId);
    const toPos = positions.get(edge.toId);
    if (!fromPos || !toPos) return null;
    let x1 = fromPos.x + NODE_WIDTH;
    let y1 = fromPos.y + NODE_HEIGHT / 2;
    if (
      edge.type === "navigate" ||
      edge.type === "open-modal" ||
      edge.type === "switch-tab" ||
      edge.type === "dropdown-action"
    ) {
      if (edge.type === "navigate") {
        const reportFromId = domReports?.[edge.fromId];
        let navItem = findNavItemForTarget(reportFromId?.navItems, edge.targetPath);
        if (!navItem && fallbackDomReport?.navItems?.length) {
          navItem = findNavItemForTarget(fallbackDomReport.navItems, edge.targetPath);
        }
        if (navItem) {
          const r = navItem.rect;
          x1 = fromPos.x + (r.x + r.width) * NODE_IFRAME_SCALE;
          y1 = fromPos.y + LABEL_HEIGHT + (r.y + r.height / 2) * NODE_IFRAME_SCALE;
        } else {
          x1 = fromPos.x + NODE_WIDTH;
          const tabIndex = getTabIndexFromNavItems(fallbackDomReport?.navItems, edge.targetPath);
          if (tabIndex && tabIndex.total > 1) {
            const t = tabIndex.total === 1 ? 0.5 : tabIndex.index / Math.max(tabIndex.total - 1, 1);
            y1 = fromPos.y + ANCHOR_MARGIN + t * (NODE_HEIGHT - 2 * ANCHOR_MARGIN);
          } else {
            y1 = getStartY(fromPos, edge, anchorRanks);
          }
        }
      } else {
        x1 = fromPos.x + NODE_WIDTH;
        y1 = getStartY(fromPos, edge, anchorRanks);
      }
    } else {
      x1 = fromPos.x + NODE_WIDTH;
      y1 = getStartY(fromPos, edge, anchorRanks);
    }
    const x2 = toPos.x + NODE_WIDTH - DOCK_OFFSET_X;
    const y2 = toPos.y + LABEL_HEIGHT / 2;
    const cpx = (x1 + x2) / 2;
    return { pathD: `M ${x1} ${y1} C ${cpx} ${y1}, ${cpx} ${y2}, ${x2} ${y2}`, x1, y1, x2, y2 };
  };

  const transform = `translate(${-minX}, ${-minY})`;

  return (
    <>
      <svg
        className={styles.svgLayer}
        width={contentWidth}
        height={contentHeight}
        aria-hidden="true"
      >
        <defs>
          <marker
            id="live-arrow-nav"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon className={styles.arrowNavDefault} points="0 0, 8 4, 0 8" />
          </marker>
          <marker
            id="live-arrow-nav-selected"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon className={styles.arrowNavSelected} points="0 0, 8 4, 0 8" />
          </marker>
          <marker
            id="live-arrow-nav-verified"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon className={styles.arrowNavVerified} points="0 0, 8 4, 0 8" />
          </marker>
          <marker
            id="live-arrow-nav-conflict"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon className={styles.arrowNavConflict} points="0 0, 8 4, 0 8" />
          </marker>
          <marker
            id="live-arrow-call"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
          >
            <polygon className={styles.arrowCall} points="0 0, 8 4, 0 8" />
          </marker>
        </defs>
        <g transform={transform}>
          {edges.map((edge, i) => {
            const rendered = renderPath(edge);
            if (!rendered) return null;
            const edgeKey = `${edge.fromId}-${edge.toId}`;
            const isSelected = selectedEdgeKey === edgeKey;
            const isNavLike =
              edge.type === "navigate" ||
              edge.type === "open-modal" ||
              edge.type === "switch-tab" ||
              edge.type === "dropdown-action";
            const edgeMeta = edgeMetaByKey?.[edgeKey];
            const navClass = isNavLike
              ? isSelected
                ? styles.edgeNavSelected
                : edgeMeta?.isConflicted
                  ? styles.edgeNavConflict
                  : edgeMeta?.isVerified
                    ? styles.edgeNavVerified
                    : styles.edgeNavDefault
              : styles.edgeCall;
            const navMarker = isNavLike
              ? isSelected
                ? "url(#live-arrow-nav-selected)"
                : edgeMeta?.isConflicted
                  ? "url(#live-arrow-nav-conflict)"
                  : edgeMeta?.isVerified
                    ? "url(#live-arrow-nav-verified)"
                    : "url(#live-arrow-nav)"
              : "url(#live-arrow-call)";
            const triggerLabel =
              edge.type === "open-modal" ||
              edge.type === "switch-tab" ||
              edge.type === "dropdown-action"
                ? (edge.trigger?.label ?? edge.type)
                : null;
            const title =
              triggerLabel != null
                ? `${
                    edge.type === "open-modal"
                      ? "Modal: "
                      : edge.type === "switch-tab"
                        ? "Tab: "
                        : "Dropdown: "
                  }${triggerLabel}`
                : edgeMeta?.title;
            const fullTitle =
              edgeMeta?.title && title && edgeMeta.title !== title
                ? `${title} · ${edgeMeta.title}`
                : (title ?? edgeMeta?.title);
            return (
              <path
                key={`${edge.fromId}-${edge.toId}-${i}`}
                id={edgeKey}
                d={rendered.pathD}
                className={navClass}
                markerEnd={navMarker}
                aria-label={fullTitle ?? undefined}
              >
                {fullTitle != null ? <title>{fullTitle}</title> : null}
              </path>
            );
          })}
          {dotPosition && (
            <circle className={styles.dot} r={8} cx={dotPosition.x} cy={dotPosition.y} />
          )}
        </g>
      </svg>
      <svg className={styles.svgHit} width={contentWidth} height={contentHeight} aria-hidden="true">
        <g transform={transform}>
          {edges.map((edge, i) => {
            const rendered = renderPath(edge);
            if (!rendered) return null;
            const edgeKey = `${edge.fromId}-${edge.toId}`;
            return (
              <path
                key={`hit-${edge.fromId}-${edge.toId}-${i}`}
                ref={(el) => {
                  if (el) pathRefs.current.set(edgeKey, el);
                }}
                d={rendered.pathD}
                className={styles.edgeHit}
                onClick={(e) => {
                  e.stopPropagation();
                  onEdgeClick(edge);
                }}
              />
            );
          })}
        </g>
      </svg>
    </>
  );
}

/**
 * LiveFlowCanvas – App Flow as one view: nodes = live preview iframes, edges = SVG paths.
 * Click on an edge animates a dot along that edge. Optional postMessage from preview app for auto-animation.
 * Location: src/modules/appflow/components/LiveFlowCanvas.tsx
 */

import { useRef, useState, useEffect, useMemo, useCallback } from "react";
import clsx from "clsx";
import type { Screen, Flow, StepLogEntry, Project } from "../../../lib/visudev/types";
import type { PreviewStepLog } from "../../../utils/api";
import type { VisudevDomReport } from "../types";
import {
  getScreenDepths,
  getScreenPreviewPath,
  buildEdges,
  computePositions,
  normalizePreviewUrl,
  previewPathToSegment,
  type GraphEdge,
  type NodePosition,
} from "../layout";
import {
  buildEdgeAnalysisMeta,
  buildFlowAnalysisSummary,
  buildNodeAnalysisBadges,
} from "../services/analysis-status";
import { useScreenLoadState, SCREEN_FAIL_REASONS } from "../hooks/useScreenLoadState";
import { usePreviewPostMessage } from "../hooks/usePreviewPostMessage";
import { FlowNodeCard } from "./FlowNodeCard";
import { CanvasToolbar } from "./CanvasToolbar";
import { EscalationPanel } from "./EscalationPanel";
import { FlowEdgesLayer } from "./FlowEdgesLayer";
import { PreviewTerminal } from "./PreviewTerminal";
import styles from "../styles/LiveFlowCanvas.module.css";

export { SCREEN_FAIL_REASONS };

const NODE_WIDTH = 320;
/** Card height so iframe area is 320×240: 240 + label + report (~56px) */
const NODE_HEIGHT = 296;
const HORIZONTAL_SPACING = 60;
const VERTICAL_SPACING = 40;
const ANIMATION_DURATION_MS = 400;
const FOCUS_HIGHLIGHT_MS = 3000;

interface LiveFlowCanvasProps {
  screens: Screen[];
  flows: Flow[];
  previewUrl: string;
  /** Wenn false, werden DOM-Reports geleert (Kanten starten wieder am rechten Kartenrand bis Preview neu sendet). */
  isLivePreviewActive?: boolean;
  projectId?: string;
  /** Aktive Runner-Run-ID für klare Zuordnung der Logs. */
  previewRunId?: string | null;
  /** Schritte der Code-Analyse (Analyzer + Screenshots). */
  analysisLogs?: StepLogEntry[];
  /** Exakte Fehlermeldung vom Preview/Build (Runner); wird als erste Zeile im Terminal angezeigt. */
  previewError?: string | null;
  /** „Preview aktualisieren“ läuft – im Terminal einen Eintrag mit Spinner anzeigen. */
  refreshInProgress?: boolean;
  /** Log-Einträge vom Preview-Start/Refresh (Runner/Edge). */
  refreshLogs?: PreviewStepLog[];
  analysisGraph?: Project["analysisGraph"];
  analysisQuality?: Project["analysisQuality"];
  analysisRuntime?: Project["analysisRuntime"];
  analysisEscalations?: Project["analysisEscalations"];
}

const POSITIONS_STORAGE_PREFIX = "visudev-flow-positions-";

export function LiveFlowCanvas({
  screens,
  flows,
  previewUrl,
  isLivePreviewActive = false,
  projectId,
  previewRunId = null,
  analysisLogs = [],
  previewError,
  refreshInProgress = false,
  refreshLogs = [],
  analysisGraph,
  analysisQuality,
  analysisRuntime,
  analysisEscalations,
}: LiveFlowCanvasProps) {
  const [zoom, setZoom] = useState(0.6);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  /** User-dragged position overrides (graph space). Persisted to localStorage by projectId. */
  const [positionOverrides, setPositionOverrides] = useState<
    Record<string, { x: number; y: number }>
  >({});
  /** Node drag: which screen is being dragged and start coords for delta. */
  const [nodeDrag, setNodeDrag] = useState<{
    screenId: string;
    startClient: { x: number; y: number };
    startPos: { x: number; y: number };
  } | null>(null);
  const [animatingEdge, setAnimatingEdge] = useState<GraphEdge | null>(null);
  const [dotPosition, setDotPosition] = useState<{ x: number; y: number } | null>(null);
  /** When set, this screen card is focused (highlight) and others dimmed; cleared after FOCUS_HIGHLIGHT_MS. */
  const [focusedScreenId, setFocusedScreenId] = useState<string | null>(null);
  /** Last visudev-dom-report per screen id (from iframe postMessage). Cleared when preview ends or screens change. */
  const [domReportsByScreenId, setDomReportsByScreenId] = useState<
    Record<string, VisudevDomReport>
  >({});
  /** Edge key (fromId-toId) of the clicked edge; used for green highlight, gray default. */
  const [selectedEdgeKey, setSelectedEdgeKey] = useState<string | null>(null);
  const [showTerminal, setShowTerminal] = useState(false);
  const focusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevLivePreviewActiveRef = useRef(isLivePreviewActive);

  const { screenLoadState, screenFailReason, loadLogs, markScreenLoaded, markScreenFailed } =
    useScreenLoadState(screens, previewUrl, previewError);

  const canvasRef = useRef<HTMLDivElement>(null);
  const terminalScrollRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<HTMLDivElement>(null);
  const nodesLayerRef = useRef<HTMLDivElement>(null);
  const progressTrackRef = useRef<HTMLDivElement>(null);
  const pathRefs = useRef<Map<string, SVGPathElement>>(new Map());
  const animFrameRef = useRef<number | null>(null);
  const iframeToScreenRef = useRef<Map<Window, string>>(new Map());

  const depths = useMemo(() => getScreenDepths(screens), [screens]);
  const computedPositions = useMemo(
    () =>
      computePositions(
        screens,
        depths,
        NODE_WIDTH,
        NODE_HEIGHT,
        HORIZONTAL_SPACING,
        VERTICAL_SPACING,
      ),
    [screens, depths],
  );
  /** Final positions: overrides (from drag) or computed. Used for layout and edges. */
  const positions = useMemo(() => {
    const map = new Map<string, NodePosition>();
    screens.forEach((s) => {
      const base = computedPositions.get(s.id);
      const override = positionOverrides[s.id];
      if (override != null) {
        map.set(s.id, { x: override.x, y: override.y, depth: base?.depth ?? 0 });
      } else if (base) {
        map.set(s.id, base);
      }
    });
    return map;
  }, [screens, computedPositions, positionOverrides]);
  const edges = useMemo(() => buildEdges(screens, flows), [screens, flows]);
  const nodeBadges = useMemo(() => buildNodeAnalysisBadges(analysisGraph), [analysisGraph]);
  const edgeMetaByKey = useMemo(
    () => buildEdgeAnalysisMeta(edges, analysisGraph),
    [analysisGraph, edges],
  );
  const analysisSummary = useMemo(
    () => buildFlowAnalysisSummary(analysisGraph, analysisQuality, analysisRuntime),
    [analysisGraph, analysisQuality, analysisRuntime],
  );
  const visibleEscalations = useMemo(
    () => (analysisEscalations ?? []).filter((job) => job.status === "pending").slice(0, 6),
    [analysisEscalations],
  );
  /** UI edges: navigate, open-modal, switch-tab (exclude call edges to avoid clutter). */
  const uiEdges = useMemo(() => edges.filter((e) => e.type !== "call"), [edges]);
  /** Report with navItems for tab positions. Prefer screen with path / or /projects (Shell); else first report with navItems. */
  const fallbackDomReport = useMemo(() => {
    const withNav = (r: { navItems?: unknown[] }) => r.navItems && r.navItems.length > 0;
    for (const screen of screens) {
      const p = (screen.path ?? "").trim().toLowerCase();
      if (p === "/" || p === "/projects") {
        const report = domReportsByScreenId[screen.id];
        if (report && withNav(report)) return report;
      }
    }
    const reports = Object.values(domReportsByScreenId);
    return reports.find((r) => withNav(r)) ?? null;
  }, [domReportsByScreenId, screens]);

  /* Clear DOM reports when live preview ends (lines fall back to right edge until preview sends again). */
  useEffect(() => {
    if (prevLivePreviewActiveRef.current && !isLivePreviewActive) {
      setDomReportsByScreenId({});
    }
    prevLivePreviewActiveRef.current = isLivePreviewActive;
  }, [isLivePreviewActive]);

  /* Clear DOM reports and selection when screens or flows change (e.g. after "Neu analysieren") so lines redraw from analysis. */
  const analysisKey = `${screens.map((s) => s.id).join(",")}-${flows.length}`;
  useEffect(() => {
    setDomReportsByScreenId({});
    setSelectedEdgeKey(null);
  }, [analysisKey]);

  useEffect(() => {
    if (!projectId || typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(`${POSITIONS_STORAGE_PREFIX}${projectId}`);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, { x: number; y: number }>;
      if (typeof parsed === "object" && parsed !== null) {
        setPositionOverrides(parsed);
      }
    } catch {
      /* ignore */
    }
  }, [projectId]);

  useEffect(() => {
    if (!projectId || typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        `${POSITIONS_STORAGE_PREFIX}${projectId}`,
        JSON.stringify(positionOverrides),
      );
    } catch {
      /* ignore */
    }
  }, [projectId, positionOverrides]);

  useEffect(() => {
    if (!graphRef.current) return;
    graphRef.current.style.setProperty("--graph-translate-x", `${pan.x}px`);
    graphRef.current.style.setProperty("--graph-translate-y", `${pan.y}px`);
    graphRef.current.style.setProperty("--graph-scale", String(zoom));
  }, [pan, zoom]);

  useEffect(() => {
    if (showTerminal && terminalScrollRef.current) {
      terminalScrollRef.current.scrollTop = terminalScrollRef.current.scrollHeight;
    }
  }, [showTerminal, analysisLogs, loadLogs, refreshLogs, refreshInProgress]);

  const positionValues = Array.from(positions.values());
  const minX = positionValues.length ? Math.min(...positionValues.map((p) => p.x), 0) : 0;
  const minY = positionValues.length ? Math.min(...positionValues.map((p) => p.y), 0) : 0;
  const maxX = positionValues.length
    ? Math.max(...positionValues.map((p) => p.x), 0) + NODE_WIDTH + 80
    : 0;
  const maxY = positionValues.length
    ? Math.max(...positionValues.map((p) => p.y), 0) + NODE_HEIGHT + 80
    : 0;
  const contentWidth = maxX - minX;
  const contentHeight = maxY - minY;

  const screensWithUrl = screens.filter((s) =>
    normalizePreviewUrl(previewUrl, getScreenPreviewPath(s)),
  );
  const totalWithUrl = screensWithUrl.length;
  const loadedCount = screensWithUrl.filter((s) => screenLoadState[s.id] === "loaded").length;
  const progressPercent = totalWithUrl > 0 ? Math.round((loadedCount / totalWithUrl) * 100) : 100;

  useEffect(() => {
    if (!nodesLayerRef.current) return;
    nodesLayerRef.current.style.setProperty("--nodes-layer-width", `${contentWidth}px`);
    nodesLayerRef.current.style.setProperty("--nodes-layer-height", `${contentHeight}px`);
    nodesLayerRef.current.style.setProperty("--nodes-layer-offset-x", `${-minX}px`);
    nodesLayerRef.current.style.setProperty("--nodes-layer-offset-y", `${-minY}px`);
  }, [contentWidth, contentHeight, minX, minY]);

  useEffect(() => {
    if (!progressTrackRef.current) return;
    progressTrackRef.current.style.setProperty("--progress-percent", `${progressPercent}%`);
  }, [progressPercent]);

  const runEdgeAnimation = useCallback((edge: GraphEdge) => {
    const key = `${edge.fromId}-${edge.toId}`;
    const pathEl = pathRefs.current.get(key);
    if (!pathEl) {
      setAnimatingEdge(null);
      setDotPosition(null);
      return;
    }
    const totalLength = pathEl.getTotalLength();
    const start = performance.now();
    const tick = () => {
      const elapsed = performance.now() - start;
      const progress = Math.min(elapsed / ANIMATION_DURATION_MS, 1);
      const point = pathEl.getPointAtLength(progress * totalLength);
      setDotPosition({ x: point.x, y: point.y });
      if (progress < 1) {
        animFrameRef.current = requestAnimationFrame(tick);
      } else {
        setAnimatingEdge(null);
        setDotPosition(null);
        animFrameRef.current = null;
      }
    };
    animFrameRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (animatingEdge) {
      runEdgeAnimation(animatingEdge);
    }
    return () => {
      if (animFrameRef.current != null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    };
  }, [animatingEdge, runEdgeAnimation]);

  useEffect(() => {
    return () => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
    };
  }, []);

  const handleEdgeClick = useCallback((edge: GraphEdge) => {
    setSelectedEdgeKey(`${edge.fromId}-${edge.toId}`);
    setAnimatingEdge(edge);
    setDotPosition(null);
  }, []);

  const handleNodeDragStart = useCallback(
    (screenId: string, clientX: number, clientY: number) => {
      const pos = positions.get(screenId);
      if (!pos) return;
      setNodeDrag({
        screenId,
        startClient: { x: clientX, y: clientY },
        startPos: { x: pos.x, y: pos.y },
      });
    },
    [positions],
  );

  const applyNodeDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!nodeDrag) return;
      const dx = (clientX - nodeDrag.startClient.x) / zoom;
      const dy = (clientY - nodeDrag.startClient.y) / zoom;
      setPositionOverrides((prev) => ({
        ...prev,
        [nodeDrag.screenId]: {
          x: nodeDrag.startPos.x + dx,
          y: nodeDrag.startPos.y + dy,
        },
      }));
    },
    [nodeDrag, zoom],
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0 && !nodeDrag) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
    }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
    if (nodeDrag) {
      applyNodeDragMove(e.clientX, e.clientY);
    } else if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    }
  };
  const handleMouseUp = useCallback(() => {
    if (nodeDrag) setNodeDrag(null);
    setIsDragging(false);
  }, [nodeDrag]);

  useEffect(() => {
    if (!nodeDrag) return;
    const onMove = (e: MouseEvent) => applyNodeDragMove(e.clientX, e.clientY);
    const onUp = () => {
      setNodeDrag(null);
      setIsDragging(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [nodeDrag, applyNodeDragMove]);

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.1, 1.5));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.1, 0.25));
  const handleZoomReset = () => {
    setZoom(0.6);
    setPan({ x: 40, y: 40 });
  };

  /** Trackpad/Mausrad-Zoom: Pinch (ctrl+wheel) oder zwei Finger scrollen auf dem Canvas. */
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const isPinch = e.ctrlKey || e.metaKey;
    const isOverCanvas = canvasRef.current?.contains(e.target as Node);
    if (isPinch || isOverCanvas) {
      e.preventDefault();
      const delta = -e.deltaY * (isPinch ? 0.002 : 0.0015);
      setZoom((z) => Math.min(Math.max(z + delta, 0.25), 1.5));
    }
  }, []);

  const onNavigateToScreen = useCallback(
    (targetScreenId: string) => {
      if (focusTimeoutRef.current) {
        clearTimeout(focusTimeoutRef.current);
        focusTimeoutRef.current = null;
      }
      const pos = positions.get(targetScreenId);
      const canvas = canvasRef.current;
      if (pos && canvas) {
        const cx = canvas.clientWidth / 2;
        const cy = canvas.clientHeight / 2;
        const nodeCenterX = pos.x + NODE_WIDTH / 2;
        const nodeCenterY = pos.y + NODE_HEIGHT / 2;
        setPan({
          x: cx - nodeCenterX * zoom,
          y: cy - nodeCenterY * zoom,
        });
      }
      setFocusedScreenId(targetScreenId);
      focusTimeoutRef.current = setTimeout(() => {
        setFocusedScreenId(null);
        focusTimeoutRef.current = null;
      }, FOCUS_HIGHLIGHT_MS);
    },
    [positions, zoom],
  );

  const handleEscalationSelect = useCallback(
    (job: NonNullable<Project["analysisEscalations"]>[number]) => {
      if (job.sourceScreenId && job.targetScreenId) {
        setSelectedEdgeKey(`${job.sourceScreenId}-${job.targetScreenId}`);
      } else {
        setSelectedEdgeKey(null);
      }
      const focusTarget = job.sourceScreenId ?? job.targetScreenId;
      if (focusTarget) {
        onNavigateToScreen(focusTarget);
      }
    },
    [onNavigateToScreen],
  );

  usePreviewPostMessage(
    iframeToScreenRef,
    screens,
    edges,
    markScreenLoaded,
    markScreenFailed,
    setDomReportsByScreenId,
    setAnimatingEdge,
    onNavigateToScreen,
  );

  if (screens.length === 0) {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyText}>Keine Screens für Live Flow</p>
      </div>
    );
  }

  const loadingCount = screensWithUrl.filter((s) => screenLoadState[s.id] === "loading").length;
  const showProgress = totalWithUrl > 0 && (loadingCount > 0 || loadedCount < totalWithUrl);
  const hasNavItemsForEdges = Boolean(fallbackDomReport?.navItems?.length);
  const hasNavigateEdges = uiEdges.some((e) => e.type === "navigate");

  return (
    <div className={styles.root}>
      <CanvasToolbar
        showProgress={showProgress}
        progressTrackRef={progressTrackRef}
        loadedCount={loadedCount}
        totalWithUrl={totalWithUrl}
        progressPercent={progressPercent}
        zoom={zoom}
        onZoomOut={handleZoomOut}
        onZoomIn={handleZoomIn}
        onZoomReset={handleZoomReset}
        showTerminal={showTerminal}
        onToggleTerminal={() => setShowTerminal((v) => !v)}
        hasPositionOverrides={Object.keys(positionOverrides).length > 0}
        onResetPositions={() => setPositionOverrides({})}
        showNavHint={hasNavigateEdges && !hasNavItemsForEdges}
        analysisSummary={analysisSummary}
      />

      <EscalationPanel jobs={visibleEscalations} onSelect={handleEscalationSelect} />

      {showTerminal && (
        <PreviewTerminal
          ref={terminalScrollRef}
          runId={previewRunId}
          analysisLogs={analysisLogs}
          refreshLogs={refreshLogs}
          loadLogs={loadLogs}
          refreshInProgress={refreshInProgress}
        />
      )}

      <div
        ref={canvasRef}
        className={clsx(styles.canvas, isDragging && styles.canvasDragging)}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <div ref={graphRef} className={styles.graph}>
          {/* Nodes zuerst (unten), Kanten per z-index darüber – so sind Verbindungen sichtbar */}
          <div className={styles.nodesLayer} ref={nodesLayerRef}>
            {screens.map((screen) => {
              const pos = positions.get(screen.id);
              if (!pos) return null;
              const previewPath = getScreenPreviewPath(screen);
              const baseUrl = normalizePreviewUrl(previewUrl, previewPath);
              const segment = previewPathToSegment(previewPath);
              const baseNoHash = baseUrl ? baseUrl.replace(/#.*$/, "") : "";
              const iframeSrc = baseNoHash
                ? `${baseNoHash}#visudev-screen=${encodeURIComponent(segment)}`
                : "";
              const isFocused = focusedScreenId === screen.id;
              const isDimmed = focusedScreenId != null && focusedScreenId !== screen.id;
              return (
                <FlowNodeCard
                  key={screen.id}
                  screen={screen}
                  pos={pos}
                  iframeSrc={iframeSrc}
                  loadState={screenLoadState[screen.id] ?? "loading"}
                  failReason={screenFailReason[screen.id]}
                  domReport={domReportsByScreenId[screen.id]}
                  analysisBadge={nodeBadges[screen.id]}
                  onLoad={() => markScreenLoaded(screen.id, screen.name, "onLoad")}
                  onError={(reason, name, url) => markScreenFailed(screen.id, reason, name, url)}
                  registerIframe={(win, screenId) => iframeToScreenRef.current.set(win, screenId)}
                  nodeWidth={NODE_WIDTH}
                  nodeHeight={NODE_HEIGHT}
                  isFocused={isFocused}
                  isDimmed={isDimmed}
                  onDragHandleMouseDown={handleNodeDragStart}
                />
              );
            })}
          </div>

          <FlowEdgesLayer
            edges={uiEdges}
            positions={positions}
            minX={minX}
            minY={minY}
            contentWidth={contentWidth}
            contentHeight={contentHeight}
            pathRefs={pathRefs}
            dotPosition={dotPosition}
            domReports={domReportsByScreenId}
            fallbackDomReport={fallbackDomReport}
            selectedEdgeKey={selectedEdgeKey}
            edgeMetaByKey={edgeMetaByKey}
            onEdgeClick={handleEdgeClick}
          />
        </div>
      </div>
    </div>
  );
}

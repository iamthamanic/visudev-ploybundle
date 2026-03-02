/**
 * usePreviewPostMessage – postMessage-Listener für Preview-Iframes (Fehler, DOM-Report, Navigation).
 * Location: src/modules/appflow/hooks/usePreviewPostMessage.ts
 */

import { useEffect } from "react";
import type { Screen } from "../../../lib/visudev/types";
import type { VisudevDomReport } from "../types";
import type { GraphEdge } from "../layout";
import { SCREEN_FAIL_REASONS } from "./useScreenLoadState";

/** Normalize path for matching: /AppFlowPage and /appflow both become "appflow". */
function pathSegmentForMatch(path: string): string {
  const seg = (path || "").replace(/\/$/, "").slice(1).trim();
  return seg.replace(/Page$/i, "").toLowerCase();
}

export function usePreviewPostMessage(
  iframeToScreenRef: React.MutableRefObject<Map<Window, string>>,
  screens: Screen[],
  edges: GraphEdge[],
  markScreenLoaded: (
    screenId: string,
    screenName?: string,
    source?: "onLoad" | "dom-report" | "timeout-fallback",
  ) => void,
  markScreenFailed: (screenId: string, reason: string, screenName?: string, url?: string) => void,
  setDomReportsByScreenId: React.Dispatch<React.SetStateAction<Record<string, VisudevDomReport>>>,
  setAnimatingEdge: React.Dispatch<React.SetStateAction<GraphEdge | null>>,
  onNavigateToScreen?: (targetScreenId: string, sourceScreenId: string) => void,
): void {
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "visudev-preview-error") {
        const sourceScreenId = iframeToScreenRef.current.get(event.source as Window);
        const reason =
          typeof (data as { reason?: string }).reason === "string"
            ? (data as { reason: string }).reason
            : SCREEN_FAIL_REASONS.LOAD_ERROR;
        if (sourceScreenId) markScreenFailed(sourceScreenId, reason);
        return;
      }

      if (data.type === "visudev-dom-report") {
        const report = data as VisudevDomReport;
        if (typeof report.route !== "string") return;
        const sourceScreenId = iframeToScreenRef.current.get(event.source as Window);
        if (!sourceScreenId) return;
        const sourceScreen = screens.find((screen) => screen.id === sourceScreenId);
        markScreenLoaded(sourceScreenId, sourceScreen?.name, "dom-report");
        setDomReportsByScreenId((prev) => ({ ...prev, [sourceScreenId]: report }));
        return;
      }

      if (data.type !== "visudev-navigate" || typeof data.path !== "string") return;
      const targetPath = data.path;
      const targetNorm = pathSegmentForMatch(targetPath);
      const targetScreen = screens.find(
        (s) =>
          s.path === targetPath ||
          (targetPath && s.path?.includes(targetPath)) ||
          (targetNorm && pathSegmentForMatch(s.path ?? "") === targetNorm),
      );
      if (!targetScreen) return;
      const sourceScreenId = iframeToScreenRef.current.get(event.source as Window);
      if (!sourceScreenId) return;
      const edge = edges.find((e) => e.fromId === sourceScreenId && e.toId === targetScreen.id);
      if (edge) setAnimatingEdge(edge);
      onNavigateToScreen?.(targetScreen.id, sourceScreenId);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    screens,
    edges,
    markScreenLoaded,
    markScreenFailed,
    setDomReportsByScreenId,
    setAnimatingEdge,
    onNavigateToScreen,
    iframeToScreenRef,
  ]);
}

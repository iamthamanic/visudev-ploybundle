/**
 * Shared layout and edge logic for App Flow graph (FlowGraphView, LiveFlowCanvas).
 * Location: src/modules/appflow/layout.ts
 */

import type { Screen, Flow, EdgeTrigger } from "../../lib/visudev/types";

export interface NodePosition {
  x: number;
  y: number;
  depth: number;
}

export type GraphEdgeType = "navigate" | "call" | "open-modal" | "switch-tab" | "dropdown-action";

export interface GraphEdge {
  fromId: string;
  toId: string;
  type: GraphEdgeType;
  /** For type "navigate": target path used for this edge (enables anchor Y by order). */
  targetPath?: string;
  /** For open-modal / switch-tab: trigger label, selector, etc. */
  trigger?: EdgeTrigger;
}

/**
 * Derives a preview path for a screen when path is missing or generic.
 * Modal/tab screens have no URL → return "" so no iframe is loaded (placeholder card).
 */
export function getScreenPreviewPath(screen: Screen): string {
  const type = screen.type ?? "page";
  if (type === "modal" || type === "tab" || type === "dropdown") return "";
  const p = (screen.path || "").trim();
  if (p && p !== "/") return p;
  const name = (screen.name || "").trim();
  if (!name) return "/";
  const lower = name
    .toLowerCase()
    .replace(/page|screen|view$/i, "")
    .trim();
  if (lower === "projects" || lower === "shell" || name === "ProjectsPage") return "/projects";
  if (lower === "appflow" || name === "AppFlowPage") return "/appflow";
  if (lower === "blueprint" || name === "BlueprintPage") return "/blueprint";
  if (lower === "data" || name === "DataPage") return "/data";
  if (lower === "logs" || name === "LogsPage") return "/logs";
  if (lower === "settings" || name === "SettingsPage") return "/settings";
  return `/${lower || name.toLowerCase()}`;
}

export function normalizePreviewUrl(base: string, screenPath: string): string {
  const trimmed = (base || "").trim();
  if (!trimmed || (!trimmed.startsWith("http://") && !trimmed.startsWith("https://"))) return "";
  const path = (screenPath || "/").trim();
  const safePath =
    path.startsWith("/") && !path.includes("//") && !path.toLowerCase().includes("javascript:")
      ? path
      : path.startsWith("/")
        ? path
        : `/${path}`;
  const baseClean = trimmed.replace(/\/$/, "");
  return `${baseClean}${safePath}`;
}

/** Segment for visudev-screen query param (so Shell can show correct tab even if server rewrites path). */
export function previewPathToSegment(previewPath: string): string {
  const p = (previewPath || "/").replace(/\/$/, "").slice(1).trim();
  return p === "" || p === "projects" ? "projects" : p;
}

/** Normalize path to a segment for matching (lowercase, no leading slash, strip page/screen/view suffix). */
function pathToSegment(path: string): string {
  let p = (path || "").trim().replace(/\/$/, "").slice(1).toLowerCase();
  p = p.replace(/(?:page|screen|view)$/i, "") || p;
  return p === "" ? "projects" : p;
}

/** Screens that have a real route (page/screen/view). Modals/tabs/dropdowns are state-only and must not count as path targets. */
function isRouteScreen(s: Screen): boolean {
  const t = s.type ?? "page";
  return t !== "modal" && t !== "tab" && t !== "dropdown";
}

/** Resolve target screen by path: only route screens (no modal/tab/dropdown), so "projects" doesn't match every modal with path "/". */
function findTargetScreenByPath(screens: Screen[], targetPath: string): Screen | undefined {
  if (!targetPath || typeof targetPath !== "string") return undefined;
  const normalized = targetPath.trim().startsWith("/")
    ? targetPath.trim()
    : `/${targetPath.trim()}`;
  const routeScreens = screens.filter(isRouteScreen);
  const exact = routeScreens.find((s) => (s.path || "").trim() === normalized);
  if (exact) return exact;
  const segment = pathToSegment(normalized);
  const bySegment = routeScreens.filter((s) => pathToSegment(s.path || "") === segment);
  if (bySegment.length === 0) return undefined;
  if (bySegment.length === 1) return bySegment[0];
  return bySegment.sort((a, b) => (a.path || "").length - (b.path || "").length)[0];
}

export function getScreenDepths(screens: Screen[]): Map<string, number> {
  const depths = new Map<string, number>();
  const visited = new Set<string>();
  const screenById = new Map(screens.map((s) => [s.id, s]));

  const rootScreens = screens.filter((s) => {
    const path = (s.path || "").toLowerCase();
    const name = (s.name || "").toLowerCase();
    const isRoute = s.type === "page" || s.type === "screen" || s.type === "view";
    return (
      isRoute &&
      (path === "/" ||
        path === "/home" ||
        path === "/login" ||
        path === "/index" ||
        path === "/projects" ||
        name.includes("home") ||
        name.includes("index") ||
        name.includes("projects") ||
        name.includes("shell"))
    );
  });
  const queue: Array<{ screen: Screen; depth: number }> = (
    rootScreens.length > 0
      ? rootScreens
      : screens
          .filter(
            (s) =>
              (s.type ?? "page") !== "modal" &&
              (s.type ?? "page") !== "tab" &&
              (s.type ?? "page") !== "dropdown",
          )
          .slice(0, 1)
  ).map((s) => ({ screen: s, depth: 0 }));

  while (queue.length > 0) {
    const { screen, depth } = queue.shift()!;
    if (!screen || visited.has(screen.id)) continue;
    visited.add(screen.id);
    depths.set(screen.id, depth);
    (screen.navigatesTo || []).forEach((targetPath) => {
      const target = findTargetScreenByPath(screens, targetPath);
      if (target && !visited.has(target.id)) queue.push({ screen: target, depth: depth + 1 });
    });
    (screen.stateTargets || []).forEach((st) => {
      const target = screenById.get(st.targetScreenId);
      if (target && !visited.has(target.id)) queue.push({ screen: target, depth: depth + 1 });
    });
  }
  screens.forEach((s) => {
    if (!depths.has(s.id)) {
      const parent = s.parentScreenId ? screenById.get(s.parentScreenId) : undefined;
      depths.set(s.id, parent != null ? (depths.get(parent.id) ?? 0) + 1 : 0);
    }
  });
  return depths;
}

export function buildEdges(screens: Screen[], flows: Flow[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seenNavigate = new Set<string>();

  const flowToScreen = new Map<string, string>();
  screens.forEach((s) => {
    (s.flows || []).forEach((fid) => flowToScreen.set(fid, s.id));
  });
  const flowByNameOrId = new Map<string, Flow>();
  flows.forEach((f) => {
    flowByNameOrId.set(f.id, f);
    flowByNameOrId.set(f.name, f);
  });

  /* Phase 3: target resolved by findTargetScreenByPath (exact path then segment, deterministic). */
  screens.forEach((source) => {
    (source.navigatesTo || []).forEach((targetPath) => {
      const target = findTargetScreenByPath(screens, targetPath);
      if (!target || target.id === source.id) return;
      const key = `${source.id}\t${target.id}`;
      if (seenNavigate.has(key)) return;
      seenNavigate.add(key);
      const pathNorm = targetPath.trim().startsWith("/")
        ? targetPath.trim()
        : `/${targetPath.trim()}`;
      edges.push({
        fromId: source.id,
        toId: target.id,
        type: "navigate",
        targetPath: pathNorm,
      });
    });
    (source.stateTargets || []).forEach((st) => {
      const target = screens.find((s) => s.id === st.targetScreenId);
      if (!target || target.id === source.id) return;
      const key = `${source.id}\t${target.id}\t${st.edgeType}\t${st.trigger?.label ?? ""}`;
      if (seenNavigate.has(key)) return;
      seenNavigate.add(key);
      edges.push({
        fromId: source.id,
        toId: target.id,
        type: st.edgeType,
        trigger: st.trigger,
      });
    });
  });

  flows.forEach((flow) => {
    const fromScreenId = flowToScreen.get(flow.id);
    if (!fromScreenId) return;
    (flow.calls || []).forEach((callTarget) => {
      const targetFlow = flowByNameOrId.get(callTarget);
      const toScreenId = targetFlow ? flowToScreen.get(targetFlow.id) : undefined;
      if (toScreenId && toScreenId !== fromScreenId)
        edges.push({ fromId: fromScreenId, toId: toScreenId, type: "call" });
    });
  });

  /* Fallback when no navigate edges: root → all others. Root must be a route screen (not modal/tab/dropdown). */
  if (edges.length === 0 && screens.length >= 2) {
    const routeScreens = screens.filter(isRouteScreen);
    const root =
      routeScreens.find(
        (s) =>
          (s.path || "").trim() === "/" ||
          (s.path || "").trim() === "/projects" ||
          (s.path || "").trim() === "/ProjectsPage",
      ) ??
      routeScreens[0] ??
      screens[0];
    screens.forEach((target) => {
      if (target.id !== root.id)
        edges.push({
          fromId: root.id,
          toId: target.id,
          type: "navigate",
          targetPath: target.path?.trim() || undefined,
        });
    });
  }

  /* If Shell (/ or /projects) has no outgoing navigate edges, add edges from Shell to all others. Shell must be a route screen (not a modal with path "/"). */
  const shellScreen = screens
    .filter(isRouteScreen)
    .find((s) => (s.path || "").trim() === "/" || (s.path || "").trim() === "/projects");
  if (
    shellScreen &&
    screens.length >= 2 &&
    !edges.some((e) => e.type === "navigate" && e.fromId === shellScreen.id)
  ) {
    screens.forEach((target) => {
      if (target.id === shellScreen.id) return;
      const key = `${shellScreen.id}\t${target.id}`;
      if (seenNavigate.has(key)) return;
      seenNavigate.add(key);
      const pathNorm = (target.path || "").trim().startsWith("/")
        ? (target.path || "").trim()
        : `/${(target.path || "").trim()}`;
      edges.push({
        fromId: shellScreen.id,
        toId: target.id,
        type: "navigate",
        targetPath: pathNorm || undefined,
      });
    });
  }

  return edges;
}

export function computePositions(
  screens: Screen[],
  depths: Map<string, number>,
  nodeWidth: number,
  nodeHeight: number,
  hSpacing: number,
  vSpacing: number,
): Map<string, NodePosition> {
  const pos = new Map<string, NodePosition>();
  const columns: Screen[][] = [];
  screens.forEach((s) => {
    const d = depths.get(s.id) ?? 0;
    if (!columns[d]) columns[d] = [];
    columns[d].push(s);
  });
  let x = 0;
  columns.forEach((col) => {
    if (!col?.length) return;
    const routeScreens = col.filter(
      (s) =>
        (s.type ?? "page") !== "modal" &&
        (s.type ?? "page") !== "tab" &&
        (s.type ?? "page") !== "dropdown",
    );
    const stateScreens = col.filter(
      (s) => s.type === "modal" || s.type === "tab" || s.type === "dropdown",
    );
    const ordered: Screen[] = [];
    routeScreens.sort((a, b) => a.name.localeCompare(b.name));
    stateScreens.sort(
      (a, b) =>
        (a.parentScreenId ?? "").localeCompare(b.parentScreenId ?? "") ||
        a.name.localeCompare(b.name),
    );
    routeScreens.forEach((r) => {
      ordered.push(r);
      stateScreens
        .filter((s) => s.parentScreenId === r.id || s.parentPath === r.path)
        .forEach((s) => ordered.push(s));
    });
    stateScreens.filter((s) => !ordered.includes(s)).forEach((s) => ordered.push(s));
    let y = 0;
    ordered.forEach((s) => {
      pos.set(s.id, { x, y, depth: depths.get(s.id) ?? 0 });
      y += nodeHeight + vSpacing;
    });
    x += nodeWidth + hSpacing;
  });
  return pos;
}

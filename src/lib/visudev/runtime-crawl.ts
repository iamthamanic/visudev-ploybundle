import type {
  AnalysisEdge,
  AnalysisEvidence,
  AnalysisGraph,
  AnalysisIssue,
  AnalysisNode,
  AnalysisOrigin,
  AnalysisQuality,
} from "./analysis-graph";

export interface RuntimeCrawlTrigger {
  label?: string;
  role?: string;
  href?: string;
  selector?: string;
  testId?: string;
}

export interface RuntimeRouteSnapshot {
  screenId: string;
  route: string;
  title?: string;
  interactiveCount: number;
  containerCount: number;
  openContainerCount: number;
}

export interface RuntimeVerifiedEdge {
  fromScreenId: string;
  toScreenId?: string;
  type: "navigate" | "open-modal" | "switch-tab" | "dropdown-action";
  targetPath?: string;
  trigger?: RuntimeCrawlTrigger;
  verification: "route-change" | "state-change";
  sourceRoute: string;
  targetRoute?: string;
  matchedBy?: "path" | "parent-state" | "label";
  screenshotUrl?: string;
}

export interface RuntimeStateCapture {
  screenId?: string;
  parentScreenId: string;
  type: "modal" | "tab" | "dropdown";
  label?: string;
  screenshotUrl?: string;
  matchedBy?: "parent-state" | "label";
  trigger?: RuntimeCrawlTrigger;
}

export interface RuntimeCrawlIssue {
  code:
    | "click_failed"
    | "screen_load_failed"
    | "no_interactive_candidates"
    | "graph_without_runtime_match"
    | "dom_without_graph_match";
  severity: "info" | "warning" | "high";
  message: string;
  screenId?: string;
  targetScreenId?: string;
  triggerLabel?: string;
}

export interface RuntimeCrawlSummary {
  visitedScreens: number;
  attemptedClicks: number;
  verifiedEdges: number;
  stateCaptures: number;
  mismatchCount: number;
  issueCount: number;
}

export interface RuntimeCrawlResult {
  baseUrl: string;
  crawledAt: string;
  summary: RuntimeCrawlSummary;
  snapshots: RuntimeRouteSnapshot[];
  verifiedEdges: RuntimeVerifiedEdge[];
  stateScreens: RuntimeStateCapture[];
  issues: RuntimeCrawlIssue[];
}

const DETERMINISTIC_ORIGINS = new Set<AnalysisOrigin>([
  "explicit-markup",
  "runtime-verified",
  "ast",
  "static",
  "manual",
]);

export function mergeRuntimeIntoAnalysis(
  graph: AnalysisGraph | undefined,
  quality: AnalysisQuality | undefined,
  runtime: RuntimeCrawlResult | undefined,
): { graph?: AnalysisGraph; quality?: AnalysisQuality } {
  if (!graph || !runtime) {
    return { graph, quality };
  }

  const nextGraph = JSON.parse(JSON.stringify(graph)) as AnalysisGraph;
  const nodeBySourceScreenId = new Map(nextGraph.nodes.map((node) => [node.sourceScreenId, node]));
  const edgeByKey = new Map<string, AnalysisEdge>();
  nextGraph.edges.forEach((edge) => {
    edgeByKey.set(edgeKey(edge.fromNodeId, edge.toNodeId, edge.type, edge.targetPath), edge);
  });

  runtime.snapshots.forEach((snapshot, index) => {
    const node = nodeBySourceScreenId.get(snapshot.screenId);
    if (!node) return;
    node.status = "verified";
    const evidenceId = `evidence:runtime:snapshot:${snapshot.screenId}:${index}`;
    ensureEvidence(
      nextGraph,
      {
        id: evidenceId,
        subjectType: "node",
        subjectId: node.id,
        kind: "runtime-snapshot",
        source: "runtime-crawler",
        commitSha: runtime.crawledAt,
        route: snapshot.route,
        summary: `Runtime snapshot for ${node.name} (${snapshot.route})`,
        payload: {
          interactiveCount: snapshot.interactiveCount,
          containerCount: snapshot.containerCount,
          openContainerCount: snapshot.openContainerCount,
          title: snapshot.title,
        },
      },
      node,
    );
  });

  runtime.stateScreens.forEach((capture, index) => {
    if (!capture.screenId) return;
    const node = nodeBySourceScreenId.get(capture.screenId);
    if (!node) return;
    node.status = "verified";
    if (capture.screenshotUrl) {
      node.screenshotUrl = capture.screenshotUrl;
    }
    const evidenceId = `evidence:runtime:state:${capture.screenId}:${index}`;
    ensureEvidence(
      nextGraph,
      {
        id: evidenceId,
        subjectType: "node",
        subjectId: node.id,
        kind: "runtime-state-change",
        source: "runtime-crawler",
        commitSha: runtime.crawledAt,
        route: capture.label,
        summary: `Runtime state capture for ${node.name}`,
        payload: {
          type: capture.type,
          label: capture.label,
          matchedBy: capture.matchedBy,
          parentScreenId: capture.parentScreenId,
        },
      },
      node,
    );
  });

  runtime.verifiedEdges.forEach((verifiedEdge, index) => {
    const fromNodeId = `node:${verifiedEdge.fromScreenId}`;
    const toNodeId = verifiedEdge.toScreenId ? `node:${verifiedEdge.toScreenId}` : undefined;
    const existing = toNodeId
      ? edgeByKey.get(edgeKey(fromNodeId, toNodeId, verifiedEdge.type, verifiedEdge.targetPath))
      : nextGraph.edges.find(
          (edge) =>
            edge.fromNodeId === fromNodeId &&
            edge.type === verifiedEdge.type &&
            edge.targetPath === verifiedEdge.targetPath,
        );

    const evidence: AnalysisEvidence = {
      id: `evidence:runtime:edge:${verifiedEdge.fromScreenId}:${index}`,
      subjectType: "edge",
      subjectId:
        existing?.id ??
        `edge:runtime:${verifiedEdge.fromScreenId}:${verifiedEdge.toScreenId ?? "unknown"}:${index}`,
      kind:
        verifiedEdge.verification === "route-change"
          ? "runtime-navigation"
          : "runtime-state-change",
      source: "runtime-crawler",
      commitSha: runtime.crawledAt,
      route: verifiedEdge.targetRoute ?? verifiedEdge.targetPath,
      selector: verifiedEdge.trigger?.selector,
      summary: `Runtime verified ${verifiedEdge.type} from ${verifiedEdge.fromScreenId}`,
      payload: {
        sourceRoute: verifiedEdge.sourceRoute,
        targetRoute: verifiedEdge.targetRoute,
        matchedBy: verifiedEdge.matchedBy,
        trigger: verifiedEdge.trigger,
      },
    };

    if (existing) {
      existing.origin = "runtime-verified";
      existing.status = "verified";
      existing.confidence = 1;
      if (verifiedEdge.trigger) {
        existing.trigger = { ...existing.trigger, ...verifiedEdge.trigger };
      }
      if (verifiedEdge.targetPath) {
        existing.targetPath = verifiedEdge.targetPath;
      }
      ensureEvidence(nextGraph, evidence, existing);
      return;
    }

    if (!toNodeId) {
      return;
    }

    const newEdge: AnalysisEdge = {
      id: evidence.subjectId,
      fromNodeId,
      toNodeId,
      type: verifiedEdge.type,
      trigger: verifiedEdge.trigger,
      targetPath: verifiedEdge.targetPath,
      origin: "runtime-verified",
      status: "verified",
      confidence: 1,
      evidenceIds: [evidence.id],
      uncertaintyReasons: [],
      metadata: {
        verification: verifiedEdge.verification,
        matchedBy: verifiedEdge.matchedBy,
      },
    };
    nextGraph.edges.push(newEdge);
    nextGraph.evidence.push(evidence);
    edgeByKey.set(
      edgeKey(fromNodeId, toNodeId, verifiedEdge.type, verifiedEdge.targetPath),
      newEdge,
    );
  });

  runtime.issues.forEach((issue, index) => {
    const existing = nextGraph.issues.find(
      (candidate) => candidate.code === issue.code && candidate.message === issue.message,
    );
    if (existing) return;
    const graphIssue: AnalysisIssue = {
      id: `issue:runtime:${index}`,
      code: issue.code,
      severity: issue.severity,
      subjectType: "graph",
      subjectId: undefined,
      relatedIds: [issue.screenId, issue.targetScreenId].filter(Boolean) as string[],
      evidenceIds: [],
      llmEligible:
        issue.code === "graph_without_runtime_match" || issue.code === "dom_without_graph_match",
      message: issue.message,
    };
    nextGraph.issues.push(graphIssue);
  });

  nextGraph.stats.nodeCount = nextGraph.nodes.length;
  nextGraph.stats.edgeCount = nextGraph.edges.length;
  nextGraph.stats.routeNodeCount = nextGraph.nodes.filter((node) => node.kind === "route").length;
  nextGraph.stats.stateNodeCount = nextGraph.nodes.filter((node) => node.kind === "state").length;
  nextGraph.stats.heuristicNodeCount = nextGraph.nodes.filter(
    (node) => node.origin === "heuristic",
  ).length;
  nextGraph.stats.heuristicEdgeCount = nextGraph.edges.filter(
    (edge) => edge.origin === "heuristic",
  ).length;

  return {
    graph: nextGraph,
    quality: recomputeQuality(nextGraph, quality),
  };
}

function ensureEvidence(
  graph: AnalysisGraph,
  evidence: AnalysisEvidence,
  subject: AnalysisNode | AnalysisEdge,
): void {
  if (!graph.evidence.some((item) => item.id === evidence.id)) {
    graph.evidence.push(evidence);
  }
  if (!subject.evidenceIds.includes(evidence.id)) {
    subject.evidenceIds.push(evidence.id);
  }
}

function edgeKey(
  fromNodeId: string,
  toNodeId: string,
  type: AnalysisEdge["type"],
  targetPath?: string,
): string {
  return `${fromNodeId}\t${toNodeId}\t${type}\t${targetPath ?? ""}`;
}

function recomputeQuality(
  graph: AnalysisGraph,
  previous: AnalysisQuality | undefined,
): AnalysisQuality {
  const nodeCount = graph.nodes.length || 1;
  const edgeCount = graph.edges.length || 1;
  const graphItemCount = graph.nodes.length + graph.edges.length || 1;
  const deterministicNodeCoverage = round(
    graph.nodes.filter((node) => DETERMINISTIC_ORIGINS.has(node.origin)).length / nodeCount,
  );
  const deterministicEdgeCoverage = round(
    graph.edges.filter((edge) => DETERMINISTIC_ORIGINS.has(edge.origin)).length / edgeCount,
  );
  const evidenceCoverage = round(
    [...graph.nodes, ...graph.edges].filter((item) => item.evidenceIds.length > 0).length /
      graphItemCount,
  );
  const runtimeVerifiedCoverage = round(
    [...graph.nodes, ...graph.edges].filter((item) => item.origin === "runtime-verified").length /
      graphItemCount,
  );
  const llmAssistedCoverage = round(
    [...graph.nodes, ...graph.edges].filter((item) => item.origin === "llm").length /
      graphItemCount,
  );
  const highIssueCount = graph.issues.filter((issue) => issue.severity === "high").length;
  const warningIssueCount = graph.issues.filter((issue) => issue.severity === "warning").length;
  const scoreBase =
    deterministicNodeCoverage * 0.32 +
    deterministicEdgeCoverage * 0.28 +
    evidenceCoverage * 0.2 +
    runtimeVerifiedCoverage * 0.2;
  const score = Math.max(
    previous?.score ?? 0,
    Math.min(100, Math.round(scoreBase * 100 - highIssueCount * 8 - warningIssueCount * 3)),
  );

  return {
    score,
    deterministicNodeCoverage,
    deterministicEdgeCoverage,
    evidenceCoverage,
    runtimeVerifiedCoverage,
    llmAssistedCoverage,
    issueCount: graph.issues.length,
    highIssueCount,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

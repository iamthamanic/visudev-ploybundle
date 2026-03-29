import type {
  AnalysisEdge,
  AnalysisGraph,
  AnalysisIssue,
  AnalysisNode,
  AnalysisQuality,
} from "../../../lib/visudev/analysis-graph";
import type { RuntimeCrawlResult } from "../../../lib/visudev/runtime-crawl";
import type { GraphEdge } from "../layout";

export interface FlowNodeAnalysisBadge {
  label: string;
  tone: "verified" | "conflicted" | "heuristic" | "deterministic";
  title: string;
  confidence: number;
  issueCount: number;
}

export interface FlowEdgeAnalysisMeta {
  isVerified: boolean;
  isConflicted: boolean;
  title?: string;
}

export interface FlowAnalysisSummary {
  score?: number;
  verifiedNodeCount: number;
  verifiedEdgeCount: number;
  conflictedCount: number;
  mismatchCount: number;
  highIssueCount: number;
}

export function buildNodeAnalysisBadges(
  graph: AnalysisGraph | undefined,
): Record<string, FlowNodeAnalysisBadge> {
  if (!graph) return {};

  const issuesByNodeId = collectIssuesByNodeId(graph);
  const badges = new Map<string, FlowNodeAnalysisBadge>();

  graph.nodes.forEach((node) => {
    const issues = issuesByNodeId.get(node.id) ?? [];
    const hasConflict =
      node.status === "conflicted" ||
      issues.some((issue) => issue.severity === "high" || isRuntimeMismatchIssue(issue));
    const isVerified = node.status === "verified" || node.status === "confirmed";
    const isHeuristic = node.origin === "heuristic" || node.uncertaintyReasons.length > 0;
    const tone = hasConflict
      ? "conflicted"
      : isVerified
        ? "verified"
        : isHeuristic
          ? "heuristic"
          : "deterministic";
    const label = hasConflict
      ? "Konflikt"
      : isVerified
        ? "Verifiziert"
        : isHeuristic
          ? "Heuristik"
          : "Statisch";
    const details = [originLabel(node), `${Math.round(node.confidence * 100)} %`];
    if (issues.length > 0) {
      details.push(`${issues.length} Hinweis${issues.length === 1 ? "" : "e"}`);
    }
    badges.set(node.sourceScreenId, {
      label,
      tone,
      title: details.join(" · "),
      confidence: node.confidence,
      issueCount: issues.length,
    });
  });

  return Object.fromEntries(badges);
}

export function buildEdgeAnalysisMeta(
  edges: GraphEdge[],
  graph: AnalysisGraph | undefined,
): Record<string, FlowEdgeAnalysisMeta> {
  if (!graph) return {};

  const issuesByNodeId = collectIssuesByNodeId(graph);
  const metaByKey = new Map<string, FlowEdgeAnalysisMeta>();

  edges.forEach((edge) => {
    const analysisEdge = findAnalysisEdge(graph.edges, edge);
    const relatedIssues = [
      ...(issuesByNodeId.get(`node:${edge.fromId}`) ?? []),
      ...(issuesByNodeId.get(`node:${edge.toId}`) ?? []),
    ];
    const isConflicted =
      analysisEdge?.status === "conflicted" ||
      relatedIssues.some((issue) => {
        if (!isRuntimeMismatchIssue(issue)) return false;
        return issue.relatedIds?.includes(edge.fromId) && issue.relatedIds?.includes(edge.toId);
      }) ||
      false;
    const isVerified =
      !isConflicted &&
      (analysisEdge?.status === "verified" ||
        analysisEdge?.status === "confirmed" ||
        analysisEdge?.origin === "runtime-verified");
    const titleParts: string[] = [];
    if (isConflicted) {
      titleParts.push("Runtime-Abweichung");
    } else if (isVerified) {
      titleParts.push("Runtime verifiziert");
    } else if (analysisEdge) {
      titleParts.push(originLabel(analysisEdge));
      titleParts.push(`${Math.round(analysisEdge.confidence * 100)} %`);
    }
    metaByKey.set(edgeKey(edge), {
      isVerified,
      isConflicted,
      title: titleParts.length > 0 ? titleParts.join(" · ") : undefined,
    });
  });

  return Object.fromEntries(metaByKey);
}

export function buildFlowAnalysisSummary(
  graph: AnalysisGraph | undefined,
  quality: AnalysisQuality | undefined,
  runtime: RuntimeCrawlResult | undefined,
): FlowAnalysisSummary | undefined {
  if (!graph && !quality && !runtime) return undefined;

  const verifiedNodeCount =
    graph?.nodes.filter((node) => node.status === "verified" || node.status === "confirmed")
      .length ?? 0;
  const verifiedEdgeCount =
    graph?.edges.filter(
      (edge) =>
        edge.status === "verified" ||
        edge.status === "confirmed" ||
        edge.origin === "runtime-verified",
    ).length ??
    runtime?.summary.verifiedEdges ??
    0;
  const conflictedCount =
    graph?.issues.filter((issue) => issue.severity === "high" || isRuntimeMismatchIssue(issue))
      .length ?? 0;

  return {
    score: quality?.score,
    verifiedNodeCount,
    verifiedEdgeCount,
    conflictedCount,
    mismatchCount:
      runtime?.summary.mismatchCount ??
      graph?.issues.filter((issue) => isRuntimeMismatchIssue(issue)).length ??
      0,
    highIssueCount: quality?.highIssueCount ?? 0,
  };
}

function collectIssuesByNodeId(graph: AnalysisGraph): Map<string, AnalysisIssue[]> {
  const byNodeId = new Map<string, AnalysisIssue[]>();
  const nodeBySourceScreenId = new Map(graph.nodes.map((node) => [node.sourceScreenId, node]));

  graph.issues.forEach((issue) => {
    if (issue.subjectType === "node" && issue.subjectId) {
      pushIssue(byNodeId, issue.subjectId, issue);
    }
    issue.relatedIds?.forEach((relatedId) => {
      const relatedNode = nodeBySourceScreenId.get(relatedId);
      if (relatedNode) {
        pushIssue(byNodeId, relatedNode.id, issue);
      }
    });
  });

  return byNodeId;
}

function pushIssue(map: Map<string, AnalysisIssue[]>, key: string, issue: AnalysisIssue): void {
  const items = map.get(key) ?? [];
  items.push(issue);
  map.set(key, items);
}

function findAnalysisEdge(edges: AnalysisEdge[], edge: GraphEdge): AnalysisEdge | undefined {
  const fromNodeId = `node:${edge.fromId}`;
  const toNodeId = `node:${edge.toId}`;
  const exact = edges.find(
    (candidate) =>
      candidate.fromNodeId === fromNodeId &&
      candidate.toNodeId === toNodeId &&
      candidate.type === edge.type &&
      (candidate.targetPath ?? "") === (edge.targetPath ?? ""),
  );
  if (exact) return exact;
  return edges.find(
    (candidate) =>
      candidate.fromNodeId === fromNodeId &&
      candidate.toNodeId === toNodeId &&
      candidate.type === edge.type,
  );
}

function edgeKey(edge: GraphEdge): string {
  return `${edge.fromId}-${edge.toId}`;
}

function isRuntimeMismatchIssue(issue: AnalysisIssue): boolean {
  return (
    issue.code === "runtime_mismatch" ||
    issue.code === "graph_without_runtime_match" ||
    issue.code === "dom_without_graph_match"
  );
}

function originLabel(subject: AnalysisNode | AnalysisEdge): string {
  switch (subject.origin) {
    case "runtime-verified":
      return "Runtime";
    case "explicit-markup":
      return "Markup";
    case "ast":
      return "AST";
    case "static":
      return "Static";
    case "heuristic":
      return "Heuristik";
    case "llm":
      return "LLM";
    case "manual":
      return "Manual";
    default:
      return "Unknown";
  }
}

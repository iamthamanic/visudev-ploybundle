import type { AnalysisGraph, AnalysisIssue } from "./analysis-graph";
import type { RuntimeCrawlResult } from "./runtime-crawl";

export type EscalationStatus = "pending" | "accepted" | "dismissed";

export type EscalationSuggestedAction = "inspect-runtime" | "add-markup" | "llm-review";

export interface AnalysisEscalationJob {
  id: string;
  issueId: string;
  createdAt: string;
  status: EscalationStatus;
  reason: AnalysisIssue["code"];
  severity: AnalysisIssue["severity"];
  source: "runtime" | "static" | "hybrid";
  subjectType: AnalysisIssue["subjectType"];
  subjectId?: string;
  sourceScreenId?: string;
  targetScreenId?: string;
  evidenceIds: string[];
  llmEligible: boolean;
  suggestedAction: EscalationSuggestedAction;
  title: string;
  description: string;
}

export function buildEscalationJobs(
  graph: AnalysisGraph | undefined,
  runtime: RuntimeCrawlResult | undefined,
): AnalysisEscalationJob[] {
  if (!graph) return [];

  const nodeScreenIdByNodeId = new Map(graph.nodes.map((node) => [node.id, node.sourceScreenId]));
  const timestamp = runtime?.crawledAt ?? new Date().toISOString();

  return graph.issues
    .filter((issue) => shouldEscalate(issue))
    .map((issue) => {
      const relatedScreenIds = (issue.relatedIds ?? []).filter(Boolean);
      const sourceScreenId =
        relatedScreenIds[0] ??
        (issue.subjectType === "node" && issue.subjectId
          ? nodeScreenIdByNodeId.get(issue.subjectId)
          : undefined);
      const targetScreenId = relatedScreenIds[1];

      return {
        id: `escalation:${issue.id}`,
        issueId: issue.id,
        createdAt: timestamp,
        status: "pending",
        reason: issue.code,
        severity: issue.severity,
        source: resolveSource(issue),
        subjectType: issue.subjectType,
        subjectId: issue.subjectId,
        sourceScreenId,
        targetScreenId,
        evidenceIds: issue.evidenceIds,
        llmEligible: issue.llmEligible,
        suggestedAction: resolveSuggestedAction(issue),
        title: buildTitle(issue),
        description: issue.message,
      };
    });
}

function shouldEscalate(issue: AnalysisIssue): boolean {
  if (issue.llmEligible) return true;
  return (
    issue.code === "graph_without_runtime_match" ||
    issue.code === "dom_without_graph_match" ||
    issue.code === "runtime_mismatch"
  );
}

function resolveSource(issue: AnalysisIssue): AnalysisEscalationJob["source"] {
  if (
    issue.code === "graph_without_runtime_match" ||
    issue.code === "dom_without_graph_match" ||
    issue.code === "runtime_mismatch"
  ) {
    return issue.llmEligible ? "hybrid" : "runtime";
  }
  return "static";
}

function resolveSuggestedAction(issue: AnalysisIssue): EscalationSuggestedAction {
  if (
    issue.code === "graph_without_runtime_match" ||
    issue.code === "dom_without_graph_match" ||
    issue.code === "runtime_mismatch" ||
    issue.code === "missing_target"
  ) {
    return "llm-review";
  }
  if (issue.code === "heuristic_only" || issue.code === "ambiguous_parent") {
    return "add-markup";
  }
  return "inspect-runtime";
}

function buildTitle(issue: AnalysisIssue): string {
  switch (issue.code) {
    case "graph_without_runtime_match":
      return "Runtime zeigt ungeklärte Navigation";
    case "dom_without_graph_match":
      return "Runtime zeigt ungeklärten State-Wechsel";
    case "missing_target":
      return "Statisches Target fehlt";
    case "heuristic_only":
      return "Heuristik ohne harte Beweise";
    case "ambiguous_parent":
      return "Parent-Zuordnung ist mehrdeutig";
    case "runtime_mismatch":
      return "Runtime widerspricht dem Graph";
    default:
      return "Analyse-Konflikt";
  }
}

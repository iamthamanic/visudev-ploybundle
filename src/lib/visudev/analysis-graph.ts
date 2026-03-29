import type { EdgeTrigger } from "./types";

export type AnalysisOrigin =
  | "explicit-markup"
  | "runtime-verified"
  | "ast"
  | "static"
  | "heuristic"
  | "llm"
  | "manual";

export type AnalysisStatus = "inferred" | "verified" | "confirmed" | "conflicted" | "deprecated";

export type UncertaintyReason =
  | "heuristic_only"
  | "missing_trigger"
  | "dynamic_path"
  | "multiple_targets"
  | "runtime_mismatch"
  | "dom_without_graph_match"
  | "graph_without_runtime_match"
  | "unresolved_state_container"
  | "ambiguous_parent"
  | "insufficient_dom"
  | "insufficient_static_evidence";

export interface AnalysisGraph {
  version: 1;
  nodes: AnalysisNode[];
  edges: AnalysisEdge[];
  evidence: AnalysisEvidence[];
  issues: AnalysisIssue[];
  stats: AnalysisStats;
}

export interface AnalysisNode {
  id: string;
  sourceScreenId: string;
  kind: "route" | "state" | "data" | "external";
  subtype: "page" | "screen" | "view" | "cli-command" | "modal" | "tab" | "dropdown";
  name: string;
  semanticLabel?: string;
  path?: string;
  stateKey?: string;
  parentNodeId?: string;
  filePath?: string;
  framework?: string;
  origin: AnalysisOrigin;
  status: AnalysisStatus;
  confidence: number;
  evidenceIds: string[];
  uncertaintyReasons: UncertaintyReason[];
  screenshotUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface AnalysisEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  type: "navigate" | "open-modal" | "switch-tab" | "dropdown-action" | "api-call" | "db-query";
  trigger?: EdgeTrigger;
  targetPath?: string;
  origin: AnalysisOrigin;
  status: AnalysisStatus;
  confidence: number;
  evidenceIds: string[];
  uncertaintyReasons: UncertaintyReason[];
  metadata?: Record<string, unknown>;
}

export interface AnalysisEvidence {
  id: string;
  subjectType: "node" | "edge";
  subjectId: string;
  kind:
    | "framework-route"
    | "state-detection"
    | "fallback-screen"
    | "static-navigation"
    | "heuristic-navigation"
    | "runtime-navigation"
    | "runtime-state-change"
    | "runtime-snapshot"
    | "manual-confirmation"
    | "llm-suggestion";
  source: "static-analyzer" | "preview-bridge" | "runtime-crawler" | "user" | "llm";
  commitSha: string;
  filePath?: string;
  line?: number;
  route?: string;
  selector?: string;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface AnalysisIssue {
  id: string;
  code:
    | UncertaintyReason
    | "orphan_node"
    | "missing_target"
    | "click_failed"
    | "screen_load_failed"
    | "no_interactive_candidates";
  severity: "info" | "warning" | "high";
  subjectType: "node" | "edge" | "graph";
  subjectId?: string;
  relatedIds?: string[];
  evidenceIds: string[];
  llmEligible: boolean;
  message: string;
}

export interface AnalysisStats {
  nodeCount: number;
  edgeCount: number;
  routeNodeCount: number;
  stateNodeCount: number;
  heuristicNodeCount: number;
  heuristicEdgeCount: number;
}

export interface AnalysisQuality {
  score: number;
  deterministicNodeCoverage: number;
  deterministicEdgeCoverage: number;
  evidenceCoverage: number;
  runtimeVerifiedCoverage: number;
  llmAssistedCoverage: number;
  issueCount: number;
  highIssueCount: number;
}

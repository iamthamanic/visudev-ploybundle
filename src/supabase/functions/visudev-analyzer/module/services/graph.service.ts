import { BaseService } from "./base.service.ts";
import type {
  AnalysisEdge,
  AnalysisEvidence,
  AnalysisGraph,
  AnalysisIssue,
  AnalysisNode,
  AnalysisOrigin,
  AnalysisQuality,
  CodeFlow,
  FrameworkDetectionResult,
  Screen,
  StateTarget,
  UncertaintyReason,
} from "../dto/index.ts";

interface GraphBuildResult {
  graph: AnalysisGraph;
  quality: AnalysisQuality;
}

const STATE_SCREEN_TYPES = new Set<Screen["type"]>([
  "modal",
  "tab",
  "dropdown",
]);
const DETERMINISTIC_ORIGINS = new Set<AnalysisOrigin>([
  "explicit-markup",
  "runtime-verified",
  "ast",
  "static",
  "manual",
]);

export class GraphService extends BaseService {
  public buildGraph(
    screens: Screen[],
    flows: CodeFlow[],
    framework: FrameworkDetectionResult,
    commitSha: string,
  ): GraphBuildResult {
    const evidence: AnalysisEvidence[] = [];
    const issues: AnalysisIssue[] = [];
    const nodes = screens.map((screen) =>
      this.buildNode(screen, commitSha, framework, evidence, issues)
    );
    const nodeIdByScreenId = new Map(
      nodes.map((node) => [node.sourceScreenId, node.id]),
    );
    const routeNodeByPath = new Map<string, AnalysisNode>();

    nodes.forEach((node) => {
      if (node.kind === "route" && node.path) {
        routeNodeByPath.set(this.normalizePath(node.path), node);
      }
    });

    const edges: AnalysisEdge[] = [];
    screens.forEach((screen) => {
      const sourceNodeId = nodeIdByScreenId.get(screen.id);
      if (!sourceNodeId) return;
      edges.push(
        ...this.buildNavigationEdges(
          screen,
          sourceNodeId,
          routeNodeByPath,
          commitSha,
          evidence,
          issues,
        ),
      );
      edges.push(
        ...this.buildStateEdges(
          screen,
          sourceNodeId,
          nodeIdByScreenId,
          commitSha,
          evidence,
          issues,
        ),
      );
    });

    const graph: AnalysisGraph = {
      version: 1,
      nodes,
      edges,
      evidence,
      issues,
      stats: {
        nodeCount: nodes.length,
        edgeCount: edges.length,
        routeNodeCount: nodes.filter((node) => node.kind === "route").length,
        stateNodeCount: nodes.filter((node) => node.kind === "state").length,
        heuristicNodeCount:
          nodes.filter((node) => node.origin === "heuristic").length,
        heuristicEdgeCount:
          edges.filter((edge) => edge.origin === "heuristic").length,
      },
    };

    return {
      graph,
      quality: this.buildQuality(graph, flows),
    };
  }

  private buildNode(
    screen: Screen,
    commitSha: string,
    framework: FrameworkDetectionResult,
    evidence: AnalysisEvidence[],
    issues: AnalysisIssue[],
  ): AnalysisNode {
    const isStateNode = STATE_SCREEN_TYPES.has(screen.type);
    const origin = this.resolveNodeOrigin(screen);
    const uncertaintyReasons = this.resolveNodeUncertainty(screen, origin);
    const nodeId = `node:${screen.id}`;
    const evidenceId = `evidence:node:${screen.id}:primary`;
    const node: AnalysisNode = {
      id: nodeId,
      sourceScreenId: screen.id,
      kind: isStateNode ? "state" : "route",
      subtype: screen.type,
      name: screen.name,
      path: screen.path,
      stateKey: screen.stateKey,
      parentNodeId: screen.parentScreenId
        ? `node:${screen.parentScreenId}`
        : undefined,
      filePath: screen.filePath,
      framework: screen.framework,
      origin,
      status: "inferred",
      confidence: this.resolveNodeConfidence(screen, framework, origin),
      evidenceIds: [evidenceId],
      uncertaintyReasons,
      screenshotUrl: screen.screenshotUrl,
      metadata: {
        flowCount: screen.flows.length,
        navigatesToCount: screen.navigatesTo.length,
        stateTargetCount: screen.stateTargets?.length ?? 0,
      },
    };

    evidence.push({
      id: evidenceId,
      subjectType: "node",
      subjectId: nodeId,
      kind: origin === "heuristic" ? "fallback-screen" : "framework-route",
      source: "static-analyzer",
      commitSha,
      filePath: screen.filePath,
      route: screen.path,
      summary: origin === "heuristic"
        ? `Heuristic screen candidate ${screen.name}`
        : `Static screen ${screen.name} extracted from ${screen.filePath}`,
      payload: {
        screenType: screen.type,
        framework: screen.framework,
      },
    });

    if (isStateNode && !screen.parentScreenId) {
      issues.push({
        id: `issue:node:${screen.id}:orphan`,
        code: "orphan_node",
        severity: "high",
        subjectType: "node",
        subjectId: nodeId,
        evidenceIds: [evidenceId],
        llmEligible: false,
        message: `State screen ${screen.name} has no parent screen.`,
      });
    }

    if (uncertaintyReasons.includes("heuristic_only")) {
      issues.push({
        id: `issue:node:${screen.id}:heuristic`,
        code: "heuristic_only",
        severity: "warning",
        subjectType: "node",
        subjectId: nodeId,
        evidenceIds: [evidenceId],
        llmEligible: true,
        message:
          `Screen ${screen.name} is currently backed only by heuristic extraction.`,
      });
    }

    return node;
  }

  private buildNavigationEdges(
    screen: Screen,
    sourceNodeId: string,
    routeNodeByPath: Map<string, AnalysisNode>,
    commitSha: string,
    evidence: AnalysisEvidence[],
    issues: AnalysisIssue[],
  ): AnalysisEdge[] {
    return screen.navigatesTo.flatMap((targetPath, index) => {
      const normalizedTargetPath = this.normalizePath(targetPath);
      const targetNode = routeNodeByPath.get(normalizedTargetPath);
      const edgeId =
        `edge:navigate:${screen.id}:${normalizedTargetPath}:${index}`;
      const evidenceId =
        `evidence:edge:navigate:${screen.id}:${normalizedTargetPath}:${index}`;
      const uncertaintyReasons: UncertaintyReason[] = [];

      if (!targetNode) {
        uncertaintyReasons.push("insufficient_static_evidence");
        issues.push({
          id:
            `issue:edge:navigate:${screen.id}:${normalizedTargetPath}:${index}`,
          code: "missing_target",
          severity: "warning",
          subjectType: "edge",
          subjectId: edgeId,
          evidenceIds: [evidenceId],
          llmEligible: true,
          message:
            `Navigation from ${screen.name} points to ${targetPath}, but no target screen was resolved.`,
        });
      }

      const origin = screen.framework === "fallback" ? "heuristic" : "static";
      if (origin === "heuristic") {
        uncertaintyReasons.push("heuristic_only");
      }

      evidence.push({
        id: evidenceId,
        subjectType: "edge",
        subjectId: edgeId,
        kind: origin === "heuristic"
          ? "heuristic-navigation"
          : "static-navigation",
        source: "static-analyzer",
        commitSha,
        filePath: screen.filePath,
        route: targetPath,
        summary:
          `Static navigation candidate from ${screen.name} to ${targetPath}`,
      });

      return [{
        id: edgeId,
        fromNodeId: sourceNodeId,
        toNodeId: targetNode?.id ?? `missing:${normalizedTargetPath}`,
        type: "navigate",
        targetPath,
        origin,
        status: targetNode ? "inferred" : "conflicted",
        confidence: targetNode ? (origin === "heuristic" ? 0.48 : 0.78) : 0.32,
        evidenceIds: [evidenceId],
        uncertaintyReasons,
        metadata: {
          sourceScreenId: screen.id,
          targetResolved: Boolean(targetNode),
        },
      }];
    });
  }

  private buildStateEdges(
    screen: Screen,
    sourceNodeId: string,
    nodeIdByScreenId: Map<string, string>,
    commitSha: string,
    evidence: AnalysisEvidence[],
    issues: AnalysisIssue[],
  ): AnalysisEdge[] {
    return (screen.stateTargets ?? []).flatMap((stateTarget, index) => {
      const targetNodeId = nodeIdByScreenId.get(stateTarget.targetScreenId);
      const edgeId =
        `edge:state:${screen.id}:${stateTarget.targetScreenId}:${index}`;
      const evidenceId =
        `evidence:edge:state:${screen.id}:${stateTarget.targetScreenId}:${index}`;
      const uncertaintyReasons: UncertaintyReason[] = ["heuristic_only"];

      if (!stateTarget.trigger?.label) {
        uncertaintyReasons.push("missing_trigger");
      }
      if (!targetNodeId) {
        uncertaintyReasons.push("insufficient_static_evidence");
        issues.push({
          id:
            `issue:edge:state:${screen.id}:${stateTarget.targetScreenId}:${index}`,
          code: "missing_target",
          severity: "high",
          subjectType: "edge",
          subjectId: edgeId,
          evidenceIds: [evidenceId],
          llmEligible: true,
          message:
            `State edge from ${screen.name} references missing target ${stateTarget.targetScreenId}.`,
        });
      }

      evidence.push({
        id: evidenceId,
        subjectType: "edge",
        subjectId: edgeId,
        kind: "state-detection",
        source: "static-analyzer",
        commitSha,
        filePath: screen.filePath,
        line: stateTarget.trigger?.line,
        selector: stateTarget.trigger?.selector,
        summary:
          `Heuristic ${stateTarget.edgeType} candidate from ${screen.name}`,
        payload: {
          label: stateTarget.trigger?.label,
          testId: stateTarget.trigger?.testId,
        },
      });

      return [{
        id: edgeId,
        fromNodeId: sourceNodeId,
        toNodeId: targetNodeId ?? `missing:${stateTarget.targetScreenId}`,
        type: stateTarget.edgeType,
        trigger: stateTarget.trigger,
        origin: "heuristic",
        status: targetNodeId ? "inferred" : "conflicted",
        confidence: this.resolveStateEdgeConfidence(stateTarget),
        evidenceIds: [evidenceId],
        uncertaintyReasons,
        metadata: {
          sourceScreenId: screen.id,
          targetScreenId: stateTarget.targetScreenId,
        },
      }];
    });
  }

  private buildQuality(
    graph: AnalysisGraph,
    flows: CodeFlow[],
  ): AnalysisQuality {
    const nodes = graph.nodes.length || 1;
    const edges = graph.edges.length || 1;
    const graphItems = graph.nodes.length + graph.edges.length || 1;
    const deterministicNodeCoverage = this.round(
      graph.nodes.filter((node) => DETERMINISTIC_ORIGINS.has(node.origin))
        .length / nodes,
    );
    const deterministicEdgeCoverage = this.round(
      graph.edges.filter((edge) => DETERMINISTIC_ORIGINS.has(edge.origin))
        .length / edges,
    );
    const evidenceCoverage = this.round(
      [...graph.nodes, ...graph.edges].filter((item) =>
        item.evidenceIds.length > 0
      ).length /
        graphItems,
    );
    const runtimeVerifiedCoverage = this.round(
      [...graph.nodes, ...graph.edges].filter((item) =>
        item.origin === "runtime-verified"
      )
        .length / graphItems,
    );
    const llmAssistedCoverage = this.round(
      [...graph.nodes, ...graph.edges].filter((item) => item.origin === "llm")
        .length /
        graphItems,
    );
    const highIssueCount =
      graph.issues.filter((issue) => issue.severity === "high").length;
    const warningIssueCount =
      graph.issues.filter((issue) => issue.severity === "warning").length;
    const baseScore = deterministicNodeCoverage * 0.35 +
      deterministicEdgeCoverage * 0.35 +
      evidenceCoverage * 0.2 +
      Math.min(1, flows.length / Math.max(graph.nodes.length, 1)) * 0.1;
    const penalty = highIssueCount * 0.12 + warningIssueCount * 0.04;
    const score = Math.max(
      0,
      Math.min(100, Math.round((baseScore - penalty) * 100)),
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

  private resolveNodeOrigin(screen: Screen): AnalysisOrigin {
    if (screen.framework === "fallback" || screen.filePath === "unknown") {
      return "heuristic";
    }
    if (STATE_SCREEN_TYPES.has(screen.type)) {
      return "heuristic";
    }
    if (screen.framework === "state") {
      return "heuristic";
    }
    return "ast";
  }

  private resolveNodeConfidence(
    screen: Screen,
    framework: FrameworkDetectionResult,
    origin: AnalysisOrigin,
  ): number {
    if (origin === "heuristic") {
      return screen.filePath === "unknown" ? 0.28 : 0.52;
    }
    if (
      screen.framework && framework.primary &&
      screen.framework.includes(framework.primary)
    ) {
      return 0.9;
    }
    return 0.82;
  }

  private resolveNodeUncertainty(
    screen: Screen,
    origin: AnalysisOrigin,
  ): UncertaintyReason[] {
    const uncertaintyReasons: UncertaintyReason[] = [];
    if (origin === "heuristic") {
      uncertaintyReasons.push("heuristic_only");
    }
    if (screen.filePath === "unknown") {
      uncertaintyReasons.push("insufficient_static_evidence");
    }
    if (STATE_SCREEN_TYPES.has(screen.type) && !screen.parentScreenId) {
      uncertaintyReasons.push("ambiguous_parent");
    }
    return uncertaintyReasons;
  }

  private resolveStateEdgeConfidence(
    stateTarget: StateTarget,
  ): number {
    if (!stateTarget?.trigger) {
      return 0.38;
    }
    if (stateTarget.trigger.label && stateTarget.trigger.file) {
      return 0.6;
    }
    if (stateTarget.trigger.label) {
      return 0.52;
    }
    return 0.44;
  }

  private normalizePath(path: string): string {
    if (!path || path === "/") return "/";
    return path.replace(/\/+$/, "") || "/";
  }

  private round(value: number): number {
    return Math.round(value * 1000) / 1000;
  }
}

import type { AnalysisGraph, AnalysisQuality } from "./analysis-graph.dto.ts";
import type { CodeFlow } from "../flow/code-flow.dto.ts";
import type { FrameworkDetectionResult } from "../framework/framework-detection.dto.ts";
import type { Screen } from "../screen/screen.dto.ts";

export interface AnalysisRecord {
  repo: string;
  branch: string;
  commitSha: string;
  timestamp: string;
  flowsCount: number;
  filesAnalyzed: number;
  screens: Screen[];
  flows: CodeFlow[];
  framework: FrameworkDetectionResult;
  graph: AnalysisGraph;
  quality: AnalysisQuality;
}

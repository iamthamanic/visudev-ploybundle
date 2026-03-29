import { BaseService } from "./base.service.ts";
import type {
  AnalysisRecord,
  AnalysisRequestDto,
  AnalysisResultDto,
  CodeFlow,
  FileContent,
} from "../dto/index.ts";
import { AnalysisRepository } from "../internal/repositories/analysis.repository.ts";
import { NotFoundException } from "../internal/exceptions/index.ts";
import { FlowService } from "./flow.service.ts";
import { GitHubService } from "./github.service.ts";
import { GraphService } from "./graph.service.ts";
import { ScreenService } from "./screen.service.ts";

export class AnalysisService extends BaseService {
  constructor(
    private readonly repository: AnalysisRepository,
    private readonly gitHubService: GitHubService,
    private readonly flowService: FlowService,
    private readonly screenService: ScreenService,
    private readonly graphService: GraphService,
  ) {
    super();
  }

  public async analyze(
    request: AnalysisRequestDto,
  ): Promise<AnalysisResultDto> {
    const { access_token, repo, branch } = request;
    this.logger.info("Starting analysis", {
      repo,
      branch,
      authenticated: Boolean(access_token),
    });

    const commitSha = await this.gitHubService.getCurrentCommitSha(
      access_token,
      repo,
      branch,
    );
    const tree = await this.gitHubService.fetchRepoTree(
      access_token,
      repo,
      branch,
    );

    const packageJsonNode = tree.find(
      (file) => file.type === "blob" && file.path === "package.json",
    );

    const codeFiles = tree.filter(
      (file) => file.type === "blob" && this.isSupportedFile(file.path),
    );
    this.logger.info("Code files discovered", { count: codeFiles.length });

    const filesToAnalyze = codeFiles.slice(0, this.config.analysisFileLimit);
    const fileContents: FileContent[] = [];
    const allFlows: CodeFlow[] = [];

    if (packageJsonNode) {
      try {
        const content = await this.gitHubService.fetchFileContent(
          access_token,
          repo,
          packageJsonNode.path,
        );
        fileContents.push({ path: packageJsonNode.path, content });
      } catch (error) {
        this.logger.warn("Failed to fetch package.json", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    let analyzed = 0;
    for (const file of filesToAnalyze) {
      try {
        const content = await this.gitHubService.fetchFileContent(
          access_token,
          repo,
          file.path,
        );
        const flows = this.flowService.analyzeFile(file.path, content);
        allFlows.push(...flows);
        fileContents.push({ path: file.path, content });

        analyzed += 1;
        if (
          this.config.analysisProgressLogEvery > 0 &&
          analyzed % this.config.analysisProgressLogEvery === 0
        ) {
          this.logger.info("Analysis progress", {
            analyzed,
            total: filesToAnalyze.length,
          });
        }
      } catch (error) {
        this.logger.warn("Failed to analyze file", {
          path: file.path,
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    this.logger.info("Analysis scan complete", {
      analyzed,
      flows: allFlows.length,
    });

    const { screens, framework } = this.screenService.extractScreens(
      fileContents,
    );
    const mappedScreens = this.flowService.mapFlowsToScreens(
      screens,
      allFlows,
      commitSha,
    );
    const { graph, quality } = this.graphService.buildGraph(
      mappedScreens,
      allFlows,
      framework,
      commitSha,
    );

    const analysisId = crypto.randomUUID();
    const record: AnalysisRecord = {
      repo,
      branch,
      commitSha,
      timestamp: new Date().toISOString(),
      flowsCount: allFlows.length,
      filesAnalyzed: analyzed,
      screens: mappedScreens,
      flows: allFlows,
      framework,
      graph,
      quality,
    };

    await this.repository.saveAnalysis(analysisId, record);

    return {
      analysisId,
      commitSha,
      screens: mappedScreens,
      flows: allFlows,
      framework,
      graph,
      quality,
    };
  }

  public async getAnalysis(id: string): Promise<AnalysisRecord> {
    const analysis = await this.repository.getAnalysis(id);
    if (!analysis) {
      throw new NotFoundException("Analysis");
    }
    return analysis;
  }

  private isSupportedFile(path: string): boolean {
    const ext = path.split(".").pop()?.toLowerCase();
    return Boolean(ext && ["ts", "tsx", "js", "jsx", "vue"].includes(ext));
  }
}

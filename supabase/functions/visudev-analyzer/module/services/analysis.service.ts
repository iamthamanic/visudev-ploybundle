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
import { ScreenService } from "./screen.service.ts";

export class AnalysisService extends BaseService {
  constructor(
    private readonly repository: AnalysisRepository,
    private readonly gitHubService: GitHubService,
    private readonly flowService: FlowService,
    private readonly screenService: ScreenService,
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

    const prioritized = this.prioritizeRouteFiles(codeFiles);
    const filesToAnalyze = prioritized.slice(0, this.config.analysisFileLimit);
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
    };

    await this.repository.saveAnalysis(analysisId, record);

    return {
      analysisId,
      commitSha,
      screens: mappedScreens,
      flows: allFlows,
      framework,
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

  /** Put route/page-like files first so they are within analysisFileLimit. Supports app in subdirs (e.g. apps/web/app, frontend/app) and nested routes. */
  private prioritizeRouteFiles<T extends { path: string }>(files: T[]): T[] {
    const routeScore = (p: string): number => {
      const path = p.toLowerCase();
      // Next.js App Router: app/.../page or */app/.../page (any nesting, incl. root app/page)
      if (/(?:^|\/)app\/(?:.*\/)?page\.(tsx?|jsx?)$/.test(path)) return 100;
      // Next.js Pages: pages/*.tsx
      if (/(?:^|\/)pages\/.+\.(tsx?|jsx?|vue)$/.test(path)) return 90;
      if (/\/routes?\/[^/]+\.(tsx?|jsx?)$/.test(path)) return 80;
      if (/\/views?\/[^/]+\.(tsx?|jsx?|vue)$/.test(path)) return 70;
      if (/\/screens?\/[^/]+\.(tsx?|jsx?)$/.test(path)) return 60;
      if (
        /\.(tsx?|jsx?)$/.test(path) &&
        (path.includes("route") || path.includes("router"))
      ) return 50;
      return 0;
    };
    return [...files].sort((a, b) => routeScore(b.path) - routeScore(a.path));
  }
}

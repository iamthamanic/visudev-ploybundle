import type { Hono } from "hono";
import type { AnalyzerModuleConfig } from "./interfaces/module.interface.ts";
import { initModuleServices } from "./services/base.service.ts";
import { AnalysisRepository } from "./internal/repositories/analysis.repository.ts";
import { GitHubService } from "./services/github.service.ts";
import { FlowService } from "./services/flow.service.ts";
import { GraphService } from "./services/graph.service.ts";
import { NavigationLinkExtractor } from "./services/navigation-link-extractor.ts";
import { PageLikeExtractor } from "./services/page-like-extractor.ts";
import { ScreenExtractionService } from "./services/screen-extraction.service.ts";
import { ScreenService } from "./services/screen.service.ts";
import { StateTargetExtractor } from "./services/state-target-extractor.ts";
import { AnalysisService } from "./services/analysis.service.ts";
import { ScreenshotService } from "./services/screenshot.service.ts";
import { AnalyzerController } from "./controllers/analyzer.controller.ts";
import { registerAnalyzerRoutes } from "./routes/analyzer.routes.ts";

export function createAnalyzerModule(config: AnalyzerModuleConfig): {
  registerRoutes: (app: Hono) => void;
  controller: AnalyzerController;
  analysisService: AnalysisService;
  screenshotService: ScreenshotService;
  repository: AnalysisRepository;
} {
  initModuleServices(config);

  const repository = new AnalysisRepository();
  const gitHubService = new GitHubService();
  const flowService = new FlowService();
  const nav = new NavigationLinkExtractor();
  const screenExtractor = new ScreenExtractionService(
    nav,
    new StateTargetExtractor(),
    new PageLikeExtractor(nav),
  );
  const screenService = new ScreenService(screenExtractor);
  const graphService = new GraphService();
  const analysisService = new AnalysisService(
    repository,
    gitHubService,
    flowService,
    screenService,
    graphService,
  );
  const screenshotService = new ScreenshotService();
  const controller = new AnalyzerController(analysisService, screenshotService);

  return {
    registerRoutes: (app: Hono): void =>
      registerAnalyzerRoutes(app, controller),
    controller,
    analysisService,
    screenshotService,
    repository,
  };
}

export type { AnalyzerModuleConfig } from "./interfaces/module.interface.ts";
export * from "./dto/index.ts";

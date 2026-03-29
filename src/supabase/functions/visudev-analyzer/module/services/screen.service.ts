import { BaseService } from "./base.service.ts";
import type {
  FileContent,
  FrameworkDetectionResult,
  Screen,
} from "../dto/index.ts";
import { ScreenExtractionService } from "./screen-extraction.service.ts";

export class ScreenService extends BaseService {
  constructor(private readonly extractor: ScreenExtractionService) {
    super();
  }

  public extractScreens(files: FileContent[]): {
    screens: Screen[];
    framework: FrameworkDetectionResult;
  } {
    const framework = this.detectFrameworks(files);
    let screens: Screen[] = [];
    const packageJson = files.find((f) => f.path === "package.json");
    const packageContent = packageJson?.content;

    if (
      framework.primary === "nextjs-app-router" ||
      framework.detected.includes("nextjs-app-router")
    ) {
      screens = this.extractor.extractNextJsAppRouterScreens(files);
    } else if (
      framework.primary === "nextjs-pages-router" ||
      framework.detected.includes("nextjs-pages-router")
    ) {
      screens = this.extractor.extractNextJsPagesRouterScreens(files);
    } else if (framework.primary === "react-router") {
      screens = this.extractor.extractReactRouterScreens(files);
    } else if (framework.primary === "nuxt") {
      screens = this.extractor.extractNuxtScreens(files);
    }

    if (screens.length === 0 && framework.detected.includes("react")) {
      this.logger.info("Trying state-based and hash routing");
      screens = this.extractor.extractStateBasedScreens(files);
      if (screens.length === 0) {
        screens = this.extractor.extractHashRoutingScreens(files);
      }
    }

    if (screens.length === 0 && framework.detected.includes("cli-commander")) {
      this.logger.info("Trying CLI Commander extraction");
      screens = this.extractor.extractCliCommanderScreens(
        files,
        packageContent,
      );
    }

    if (screens.length === 0) {
      this.logger.info(
        "No screens detected by framework rules, using heuristic fallback",
      );
      screens = this.extractor.extractScreensHeuristic(files);
    }

    if (screens.length === 0) {
      this.logger.info("Using single-page fallback");
      screens = this.extractor.extractSinglePageFallback(files, packageContent);
    }

    if (screens.length === 0 && this.config.fallbackRoutes.length > 0) {
      this.logger.info("Using fallback routes", {
        count: this.config.fallbackRoutes.length,
      });
      screens = this.config.fallbackRoutes.map((route) => ({
        id: `screen:fallback:${route.path}`,
        name: route.name,
        path: route.path,
        filePath: "unknown",
        type: "page",
        flows: [],
        navigatesTo: [],
        framework: "fallback",
      }));
    }

    this.extractor.extractPageLikeScreens(screens, files);
    this.extractor.extractModalsTabsAndDropdowns(screens, files);
    this.logger.info("Screens extracted", { count: screens.length });
    return { screens, framework };
  }

  private detectFrameworks(files: FileContent[]): FrameworkDetectionResult {
    const detected: string[] = [];
    let confidence = 0;

    const packageJson = files.find((file) => file.path === "package.json");
    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson.content) as Record<string, unknown>;
        const dependencies = this.normalizeDependencyMap(pkg.dependencies);
        const devDependencies = this.normalizeDependencyMap(
          pkg.devDependencies,
        );
        const deps = { ...dependencies, ...devDependencies };

        if (deps.next) {
          detected.push("next.js");
          confidence = Math.max(confidence, 0.95);
        }
        if (deps.react || deps["react-dom"]) {
          detected.push("react");
        }
        if (deps["react-router-dom"]) {
          detected.push("react-router");
          confidence = Math.max(confidence, 0.85);
        }
        if (deps.nuxt) {
          detected.push("nuxt");
          confidence = Math.max(confidence, 0.95);
        }
        if (deps.commander) {
          detected.push("cli-commander");
          confidence = Math.max(confidence, 0.8);
        }
      } catch (error) {
        this.logger.warn("Failed to parse package.json", {
          error: error instanceof Error ? error.message : "unknown",
        });
      }
    }

    if (files.some((file) => /app\/.*\/page\.(tsx?|jsx?)$/.test(file.path))) {
      if (!detected.includes("next.js")) detected.push("next.js");
      detected.push("nextjs-app-router");
      confidence = Math.max(confidence, 0.95);
    }

    if (files.some((file) => /^pages\/.*\.(tsx?|jsx?)$/.test(file.path))) {
      if (!detected.includes("next.js")) detected.push("next.js");
      detected.push("nextjs-pages-router");
      confidence = Math.max(confidence, 0.95);
    }

    if (
      files.some(
        (file) =>
          file.content.includes("createBrowserRouter") ||
          file.content.includes("<Routes>") ||
          file.content.includes("<Route"),
      )
    ) {
      if (!detected.includes("react-router")) detected.push("react-router");
      confidence = Math.max(confidence, 0.85);
    }

    if (files.some((file) => /^pages\/.*\.vue$/.test(file.path))) {
      if (!detected.includes("nuxt")) detected.push("nuxt");
      confidence = Math.max(confidence, 0.95);
    }

    if (
      files.some(
        (f) =>
          f.content.includes("program.command(") ||
          f.content.includes("cmd.command("),
      )
    ) {
      if (!detected.includes("cli-commander")) detected.push("cli-commander");
      confidence = Math.max(confidence, 0.8);
    }

    if (
      packageJson &&
      JSON.parse(packageJson.content as string)?.bin &&
      !detected.includes("cli-commander")
    ) {
      try {
        const pkg = JSON.parse(packageJson.content as string) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = {
          ...(pkg.dependencies ?? {}),
          ...(pkg.devDependencies ?? {}),
        };
        if (deps.commander) detected.push("cli-commander");
      } catch {
        // ignore
      }
    }

    const primary = detected[0] ?? null;
    this.logger.info("Frameworks detected", { detected, confidence });

    return { detected, primary, confidence };
  }

  private normalizeDependencyMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object") {
      return {};
    }

    return Object.entries(value).reduce<Record<string, string>>(
      (acc, [key, val]) => {
        if (typeof val === "string") {
          acc[key] = val;
        }
        return acc;
      },
      {},
    );
  }
}

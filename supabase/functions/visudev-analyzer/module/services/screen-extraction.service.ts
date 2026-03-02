import type { FileContent, Screen } from "../dto/index.ts";
import {
  extractNavigationFromAst,
  extractReactRouterRoutesFromAst,
} from "./ast-navigation.service.ts";

export class ScreenExtractionService {
  /** Use AST first for navigatesTo; fallback to regex on parse error or empty result. */
  private getNavigationLinks(content: string, filePath: string): string[] {
    try {
      const astResult = extractNavigationFromAst(content, filePath);
      if (astResult && astResult.navigatesTo.length > 0) {
        return astResult.navigatesTo;
      }
    } catch {
      // fallback to regex
    }
    return this.extractNavigationLinks(content);
  }

  /** Next.js App Router: app/.../page or src/app/.../page; strip route groups (parentheses). Dedup by path so route aliases / multiple files mapping to same route yield one screen. */
  public extractNextJsAppRouterScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];
    const seenPaths = new Set<string>();
    const appPageRegex = /(?:^|\/)(?:src\/)?app\/(.*?)\/page\.(tsx?|jsx?)$/;

    files.forEach((file) => {
      const match = file.path.match(appPageRegex);
      if (match) {
        let segmentPath = match[1] ?? "";
        segmentPath = segmentPath.replace(/\([^)]+\)\/?/g, "").replace(
          /\/$/,
          "",
        );
        let routePath = segmentPath === "" ? "/" : `/${segmentPath}`;
        routePath = routePath.replace(/\[([^\]]+)\]/g, ":$1");
        if (seenPaths.has(routePath)) return;
        seenPaths.add(routePath);
        const segment = routePath === "/"
          ? "Home"
          : (routePath.split("/").filter(Boolean).pop() ?? "Unknown");

        screens.push({
          id: `screen:${file.path}`,
          name: segment.charAt(0).toUpperCase() + segment.slice(1),
          path: routePath,
          filePath: file.path,
          type: "page",
          flows: [],
          navigatesTo: this.getNavigationLinks(file.content, file.path),
          framework: "nextjs-app-router",
          componentCode: file.content,
        });
      }
    });

    return screens;
  }

  /** Next.js Pages: pages/... or src/pages/... (any prefix). Dedup by path to avoid duplicate routes. */
  public extractNextJsPagesRouterScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];
    const seenPaths = new Set<string>();
    const pagesRegex = /(?:^|\/)(?:src\/)?pages\/(.*?)\.(tsx?|jsx?)$/;

    files.forEach((file) => {
      const match = file.path.match(pagesRegex);
      if (match) {
        let routePath = `/${match[1]}`;

        if (routePath.endsWith("/index")) {
          routePath = routePath.replace("/index", "") || "/";
        }
        if (routePath === "/index") {
          routePath = "/";
        }

        routePath = routePath.replace(/\[([^\]]+)\]/g, ":$1");
        if (seenPaths.has(routePath)) return;
        seenPaths.add(routePath);

        const segment = routePath === "/"
          ? "Home"
          : (routePath.split("/").filter(Boolean).pop() ?? "Unknown");

        screens.push({
          id: `screen:${file.path}`,
          name: segment.charAt(0).toUpperCase() + segment.slice(1),
          path: routePath,
          filePath: file.path,
          type: "page",
          flows: [],
          navigatesTo: this.getNavigationLinks(file.content, file.path),
          framework: "nextjs-pages-router",
          componentCode: file.content,
        });
      }
    });

    return screens;
  }

  public extractReactRouterScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];

    files.forEach((file) => {
      const astRoutes = extractReactRouterRoutesFromAst(file.content);
      if (astRoutes && astRoutes.length > 0) {
        astRoutes.forEach(({ path: routePath, componentName }) => {
          screens.push({
            id: `screen:${componentName}:${routePath}`,
            name: componentName,
            path: routePath,
            filePath: file.path,
            type: "page",
            flows: [],
            navigatesTo: this.getNavigationLinks(file.content, file.path),
            framework: "react-router",
          });
        });
        return;
      }

      const routeRegex = /<Route\s+path=["']([^"']+)["']\s+element=\{<(\w+)/g;
      let match: RegExpExecArray | null;

      while ((match = routeRegex.exec(file.content)) !== null) {
        const routePath = match[1];
        const componentName = match[2];

        screens.push({
          id: `screen:${componentName}:${routePath}`,
          name: componentName,
          path: routePath,
          filePath: file.path,
          type: "page",
          flows: [],
          navigatesTo: this.getNavigationLinks(file.content, file.path),
          framework: "react-router",
        });
      }

      const routerConfigRegex =
        /\{\s*path:\s*["']([^"']+)["'],\s*element:\s*<(\w+)/g;
      while ((match = routerConfigRegex.exec(file.content)) !== null) {
        const routePath = match[1];
        const componentName = match[2];

        if (
          !screens.some((screen) =>
            screen.path === routePath && screen.name === componentName
          )
        ) {
          screens.push({
            id: `screen:${componentName}:${routePath}`,
            name: componentName,
            path: routePath,
            filePath: file.path,
            type: "page",
            flows: [],
            navigatesTo: this.getNavigationLinks(file.content, file.path),
            framework: "react-router",
          });
        }
      }
    });

    return screens;
  }

  /** Nuxt: pages/... or src/pages/... (any prefix). */
  public extractNuxtScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];
    const nuxtPagesRegex = /(?:^|\/)(?:src\/)?pages\/(.*?)\.vue$/;

    files.forEach((file) => {
      const match = file.path.match(nuxtPagesRegex);
      if (match) {
        let routePath = `/${match[1]}`;

        if (routePath.endsWith("/index")) {
          routePath = routePath.replace("/index", "") || "/";
        }
        if (routePath === "/index") {
          routePath = "/";
        }

        routePath = routePath.replace(/\[([^\]]+)\]/g, ":$1");

        const segment = routePath === "/"
          ? "Home"
          : (routePath.split("/").filter(Boolean).pop() ?? "Unknown");

        screens.push({
          id: `screen:${file.path}`,
          name: segment.charAt(0).toUpperCase() + segment.slice(1),
          path: routePath,
          filePath: file.path,
          type: "page",
          flows: [],
          navigatesTo: this.getNavigationLinks(file.content, file.path),
          framework: "nuxt",
          componentCode: file.content,
        });
      }
    });

    return screens;
  }

  /** Heuristic: screens?, pages?, views?, routes? anywhere; components/pages, components/screens. Dedup by id and by path to avoid duplicate routes (e.g. route aliases, multiple files → same path). */
  public extractScreensHeuristic(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];
    const seenIds = new Set<string>();
    const seenPaths = new Set<string>();

    const pushScreen = (screen: Screen) => {
      if (seenIds.has(screen.id)) return;
      const normPath = (screen.path ?? "").replace(/\/$/, "") || "/";
      if (seenPaths.has(normPath)) return;
      seenIds.add(screen.id);
      seenPaths.add(normPath);
      screens.push(screen);
    };

    files.forEach((file) => {
      const pathLower = file.path.toLowerCase();

      const routeFolderMatch = file.path.match(
        /(?:^|\/)(?:screens?|pages?|views?|routes?)\/([^/]+)\.(tsx?|jsx?)$/i,
      );
      if (routeFolderMatch) {
        const screenName = routeFolderMatch[1];
        const routePath = `/${
          screenName.toLowerCase().replace(/screen|page|view$/i, "").trim() ||
          screenName.toLowerCase()
        }`;

        pushScreen({
          id: `screen:${file.path}`,
          name: screenName.charAt(0).toUpperCase() + screenName.slice(1),
          path: routePath,
          filePath: file.path,
          type: "screen",
          flows: [],
          navigatesTo: this.getNavigationLinks(file.content, file.path),
          framework: "heuristic",
          componentCode: file.content,
        });
        return;
      }

      const componentMatch = file.path.match(
        /\/components?\/([^/]+)\.(tsx?|jsx?)$/,
      );
      if (componentMatch) {
        const componentName = componentMatch[1];
        const isPageLike = pathLower.includes("/components/pages/") ||
          pathLower.includes("/components/screens/") ||
          (!pathLower.includes("/components/pages/") &&
            (componentName.endsWith("Screen") ||
              componentName.endsWith("Page") ||
              componentName.endsWith("View") ||
              componentName.length > 8));

        if (/^[A-Z]/.test(componentName) && isPageLike) {
          pushScreen({
            id: `screen:${file.path}`,
            name: componentName,
            path: `/${
              componentName.toLowerCase().replace(/screen|page|view$/i, "") ||
              componentName.toLowerCase()
            }`,
            filePath: file.path,
            type: "screen",
            flows: [],
            navigatesTo: this.getNavigationLinks(file.content, file.path),
            framework: "heuristic",
            componentCode: file.content,
          });
        }
      }
    });

    return screens;
  }

  private extractNavigationLinks(content: string): string[] {
    const links: string[] = [];
    const patterns = [
      /router\.push\s*\(\s*["']([^"']+)["']/g,
      /href=["']([^"']+)["']/g,
      /navigate\s*\(\s*["']([^"']+)["']/g,
      /navigateTo\s*\(\s*["']([^"']+)["']/g,
      /<Link[^>]+to=["']([^"']+)["']/g,
      /<NavLink[^>]+to=["']([^"']+)["']/g,
    ];

    patterns.forEach((pattern) => {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const link = match[1];
        if (
          link.startsWith("/") && !link.startsWith("//") &&
          !links.includes(link)
        ) {
          links.push(link);
        }
      }
    });

    return links;
  }
}

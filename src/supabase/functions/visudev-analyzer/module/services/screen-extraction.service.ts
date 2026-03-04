import type { FileContent, Screen, StateTarget } from "../dto/index.ts";

/** Optional: read data-visudev-* attribute near a match (same line or next ~200 chars). Safe, additive only. */
function getVisudevAttrInContext(
  content: string,
  startIndex: number,
  attrName: string,
): string | undefined {
  const slice = content.slice(startIndex, startIndex + 400);
  const re = new RegExp(
    `${attrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=["']([^"']{1,80})["']`,
    "i",
  );
  const m = re.exec(slice);
  const raw = m?.[1]?.trim();
  return raw && raw.length >= 1 && raw.length <= 80 ? raw : undefined;
}

export class ScreenExtractionService {
  public extractNextJsAppRouterScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];

    files.forEach((file) => {
      const match = file.path.match(/app\/(.*?)\/page\.(tsx?|jsx?)$/);
      if (match) {
        let pathSegment = match[1] === "" ? "" : match[1];
        pathSegment = pathSegment.replace(/\([^)]+\)\/?/g, "").replace(
          /\/+/g,
          "/",
        ).replace(/^\/|\/$/g, "");
        let routePath = pathSegment ? `/${pathSegment}` : "/";
        routePath = routePath.replace(/\[([^\]]+)\]/g, ":$1");
        const nameSegment = routePath === "/"
          ? "Home"
          : (routePath.split("/").filter(Boolean).pop() ?? "Unknown");

        screens.push({
          id: `screen:${file.path}`,
          name: nameSegment.charAt(0).toUpperCase() + nameSegment.slice(1),
          path: routePath,
          filePath: file.path,
          type: "page",
          flows: [],
          navigatesTo: this.extractNavigationLinks(file.content),
          framework: "nextjs-app-router",
          componentCode: file.content,
        });
      }
    });

    return screens;
  }

  public extractNextJsPagesRouterScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];

    files.forEach((file) => {
      const match = file.path.match(/^pages\/(.*?)\.(tsx?|jsx?)$/);
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
          navigatesTo: this.extractNavigationLinks(file.content),
          framework: "nextjs-pages-router",
          componentCode: file.content,
        });
      }
    });

    return screens;
  }

  public extractReactRouterScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];

    for (const file of files) {
      if (
        !file.content.includes("<Route") &&
        !file.content.includes("<Routes>")
      ) {
        continue;
      }

      const routeEntries = this.parseReactRouterRoutes(file.content);
      const navigatesTo = this.extractNavigationLinks(file.content);
      const basename = this.getReactRouterBasename(file.content);

      const pathCandidates: string[] = [];
      for (const entry of routeEntries) {
        if (entry.skip) {
          continue;
        }
        let fullPath = this.normalizeRoutePath(entry.fullPath);
        if (basename) {
          const base = basename.replace(/\/+$/, "") || "";
          fullPath = base + (fullPath === "/" ? "" : fullPath);
          fullPath = fullPath.replace(/\/+/g, "/") || "/";
        }
        pathCandidates.push(fullPath);
      }
      /* Phase 2: Only the screen that hosts the nav gets navigatesTo. Prefer /projects over / so the "Shell /projects" card (the one that loads the Shell) gets the report and tab rects. */
      const navHostPath = pathCandidates.find((p) =>
        p === "/projects" || p.endsWith("/projects")
      ) ??
        pathCandidates.find((p) =>
          p === "/"
        ) ??
        pathCandidates[0] ??
        null;

      for (const entry of routeEntries) {
        if (entry.skip) {
          continue;
        }
        let fullPath = this.normalizeRoutePath(entry.fullPath);
        if (basename) {
          const base = basename.replace(/\/+$/, "") || "";
          fullPath = base + (fullPath === "/" ? "" : fullPath);
          fullPath = fullPath.replace(/\/+/g, "/") || "/";
        }
        const name = this.screenNameFromPathOrComponent(
          fullPath,
          entry.componentName,
        );

        screens.push({
          id: `screen:${name}:${fullPath}`,
          name,
          path: fullPath,
          filePath: file.path,
          type: "page",
          flows: [],
          navigatesTo: fullPath === navHostPath ? navigatesTo : [],
          framework: "react-router",
        });
      }

      const routerConfigRegex =
        /\{\s*path:\s*["']([^"']+)["'],\s*element:\s*<(\w+)/g;
      let match: RegExpExecArray | null;
      while ((match = routerConfigRegex.exec(file.content)) !== null) {
        const routePath = match[1];
        const componentName = match[2];
        if (componentName === "Navigate") {
          continue;
        }
        let fullPath = this.normalizeRoutePath(routePath);
        if (basename) {
          const base = basename.replace(/\/+$/, "") || "";
          fullPath = base + (fullPath === "/" ? "" : fullPath);
          fullPath = fullPath.replace(/\/+/g, "/") || "/";
        }
        const name = this.screenNameFromPathOrComponent(
          fullPath,
          componentName,
        );
        if (
          !screens.some(
            (s) => s.path === fullPath && s.name === name,
          )
        ) {
          screens.push({
            id: `screen:${name}:${fullPath}`,
            name,
            path: fullPath,
            filePath: file.path,
            type: "page",
            flows: [],
            navigatesTo: [],
            framework: "react-router",
          });
        }
      }
    }

    return screens;
  }

  /**
   * Parse all <Route path="..." ...> from JSX, including nested routes.
   * Returns route entries with fullPath (parent + path), componentName, and skip=true for Navigate redirects.
   */
  private parseReactRouterRoutes(content: string): Array<{
    fullPath: string;
    componentName: string;
    skip: boolean;
  }> {
    const routeStartRegex = /<Route\s+path=["']([^"']*)["']/g;
    let m: RegExpExecArray | null;
    const routeStarts: Array<{ path: string; index: number }> = [];
    while ((m = routeStartRegex.exec(content)) !== null) {
      routeStarts.push({ path: m[1], index: m.index });
    }

    const raw: Array<{
      path: string;
      start: number;
      end: number;
      componentName: string;
      skip: boolean;
    }> = [];

    for (const { path, index: startIndex } of routeStarts) {
      const afterOpen = content.slice(startIndex);
      const openTagEnd = afterOpen.indexOf(">");
      const segmentToTagEnd = afterOpen.slice(0, openTagEnd + 1);
      const isSelfClosingTag = /\/\s*>/.test(segmentToTagEnd) &&
        segmentToTagEnd.indexOf("</") === -1;
      const selfClosePos = this.findRouteSelfCloseEnd(afterOpen, 0);

      let endIndex: number;
      if (isSelfClosingTag) {
        const close = afterOpen.indexOf("/>");
        endIndex = startIndex + (close >= 0 ? close + 2 : openTagEnd + 1);
      } else if (selfClosePos >= 0) {
        endIndex = startIndex + selfClosePos + 2;
      } else {
        let depth = 1;
        let i = openTagEnd + 1;
        endIndex = startIndex + afterOpen.length;
        while (depth > 0 && i < afterOpen.length) {
          const open = afterOpen.indexOf("<Route", i);
          const close = afterOpen.indexOf("</Route>", i);
          const innerSelfClose = this.findRouteSelfCloseEnd(afterOpen, open);
          if (
            open >= 0 &&
            innerSelfClose >= 0 &&
            (close < 0 || innerSelfClose < close)
          ) {
            i = innerSelfClose + 2;
            continue;
          }
          if (close >= 0 && (open < 0 || close < open)) {
            depth -= 1;
            i = close + 8;
            if (depth === 0) {
              endIndex = startIndex + close + 8;
              break;
            }
          } else if (open >= 0) {
            depth += 1;
            i = open + 6;
          } else {
            break;
          }
        }
      }

      const block = content.slice(startIndex, endIndex);
      const componentName = this.extractRouteElementComponentName(block);
      const skip = this.isRouteRedirect(block) ||
        path === "*" ||
        this.isLayoutOnlyRoute(block, componentName);
      raw.push({
        path,
        start: startIndex,
        end: endIndex,
        componentName,
        skip,
      });
    }

    const sorted = [...raw].sort(
      (a, b) => a.start - b.start || b.end - b.start - (a.end - a.start),
    );
    const withFullPath: Array<typeof raw[0] & { fullPath: string }> = [];
    for (const r of sorted) {
      let parent = this.findContainingRouteWithFullPath(
        withFullPath,
        r.start,
        r.end,
      );
      if (parent == null && !r.path.startsWith("/") && r.path !== "*") {
        const lastRoot = withFullPath.filter((x) =>
          x.path.startsWith("/") && x.path !== "*"
        ).pop();
        if (lastRoot != null && lastRoot.start < r.start) {
          parent = { fullPath: lastRoot.fullPath };
        }
      }
      let fullPath = r.path;
      if (parent != null) {
        const base = parent.fullPath.endsWith("/")
          ? parent.fullPath.slice(0, -1)
          : parent.fullPath;
        fullPath = r.path.startsWith("/")
          ? r.path
          : base + (base === "" ? "" : "/") + r.path;
      } else if (!r.path.startsWith("/") && r.path !== "*") {
        fullPath = "/" + r.path;
      }
      fullPath = fullPath.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
      withFullPath.push({ ...r, fullPath });
    }

    return withFullPath.map((e) => ({
      fullPath: e.fullPath,
      componentName: e.componentName,
      skip: e.skip,
    }));
  }

  /** Find the position of /> that closes a self-closing <Route ... /> (balanced braces in element={}). */
  private findRouteSelfCloseEnd(content: string, routeStart: number): number {
    if (routeStart < 0 || !content.slice(routeStart).startsWith("<Route")) {
      return -1;
    }
    const seg = content.slice(routeStart, routeStart + 2000);
    let pos = 0;
    while (pos < seg.length) {
      const slashGt = seg.indexOf("/>", pos);
      if (slashGt < 0) return -1;
      const sub = seg.slice(0, slashGt + 2);
      let brace = 0;
      for (const c of sub) {
        if (c === "{") brace += 1;
        if (c === "}") brace -= 1;
      }
      if (brace === 0 && /path=/.test(sub)) {
        return routeStart + slashGt;
      }
      pos = slashGt + 1;
    }
    return -1;
  }

  private findContainingRouteWithFullPath(
    withFullPath: Array<{ start: number; end: number; fullPath: string }>,
    start: number,
    end: number,
  ): { fullPath: string } | null {
    let best: { fullPath: string; span: number } | null = null;
    for (const r of withFullPath) {
      if (r.start < start && r.end > end) {
        const span = r.end - r.start;
        if (!best || span < best.span) {
          best = { fullPath: r.fullPath, span };
        }
      }
    }
    return best;
  }

  private static readonly LAYOUT_WRAPPER_NAMES = new Set([
    "ProtectedRoute",
    "AdminRoute",
    "MainLayout",
    "AdminLayout",
    "ErrorBoundary",
  ]);

  private isRouteRedirect(routeBlock: string): boolean {
    const elementMatch = routeBlock.match(/element\s*=\s*\{\s*<\s*(\w+)/);
    return elementMatch != null && elementMatch[1] === "Navigate";
  }

  private isLayoutOnlyRoute(
    routeBlock: string,
    componentName: string,
  ): boolean {
    const elementMatch = routeBlock.match(/element\s*=\s*\{\s*<\s*(\w+)/);
    const first = elementMatch?.[1];
    return (
      !!first &&
      ScreenExtractionService.LAYOUT_WRAPPER_NAMES.has(first) &&
      (componentName === first || componentName === "Unknown")
    );
  }

  private extractRouteElementComponentName(routeBlock: string): string {
    const elementMatch = routeBlock.match(/element\s*=\s*\{\s*<\s*(\w+)/);
    if (!elementMatch) return "Unknown";
    const first = elementMatch[1];
    if (first === "Navigate") return "Redirect";
    if (first === "Suspense") {
      const inner = routeBlock.match(
        /<Suspense[^>]*>[\s\S]*?<\s*(\w+)[\s\/>]/,
      );
      return inner ? inner[1] : first;
    }
    return first;
  }

  /** Extract Router basename from JSX or createBrowserRouter config (e.g. basename="/multiagentultra"). */
  private getReactRouterBasename(content: string): string | null {
    const jsxMatch = content.match(
      /(?:Router|BrowserRouter)\s+[^>]*basename=["']([^"']+)["']/,
    );
    if (jsxMatch) return jsxMatch[1];
    const configMatch = content.match(
      /createBrowserRouter\s*\([^)]*\{\s*[^}]*basename:\s*["']([^"']+)["']/,
    );
    return configMatch ? configMatch[1] : null;
  }

  private normalizeRoutePath(path: string): string {
    if (!path || path === "*") return "/";
    let p = path.trim();
    if (!p.startsWith("/")) p = "/" + p;
    p = p.replace(/\/+/g, "/").replace(/\/$/, "") || "/";
    return p;
  }

  private screenNameFromPathOrComponent(
    path: string,
    componentName: string,
  ): string {
    if (
      componentName && componentName !== "Unknown" &&
      componentName !== "Redirect"
    ) {
      return componentName.replace(/Screen$/, "").replace(/Page$/, "") ||
        componentName;
    }
    const segment = path.split("/").filter(Boolean).pop() ?? "index";
    const name = segment.replace(/^:/, "").replace(/-/g, " ");
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  public extractNuxtScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];

    files.forEach((file) => {
      const match = file.path.match(/^pages\/(.*?)\.vue$/);
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
          navigatesTo: this.extractNavigationLinks(file.content),
          framework: "nuxt",
          componentCode: file.content,
        });
      }
    });

    return screens;
  }

  /**
   * State-based "routing": currentView/currentPage + switch/case returning JSX.
   * Paths like /view/dashboard for VisuDEV consistency.
   */
  public extractStateBasedScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];
    const appFile = files.find(
      (f) =>
        f.path.endsWith("App.tsx") ||
        f.path.endsWith("App.jsx") ||
        f.path === "src/app/App.tsx" ||
        f.path === "src/app/App.jsx",
    );
    if (!appFile || !appFile.content.includes("useState")) return screens;

    const viewStateMatch = appFile.content.match(
      /useState\s*[<(].*?(currentView|currentPage|view|page)\s*[>,)]/,
    );
    if (!viewStateMatch) return screens;

    const caseRegex = /case\s+["']([^"']+)["']\s*:[\s\S]*?return\s+<(\w+)/g;
    let m: RegExpExecArray | null;
    const seen = new Set<string>();
    while ((m = caseRegex.exec(appFile.content)) !== null) {
      const pathSegment = m[1];
      const componentName = m[2];
      const path = `/view/${pathSegment}`;
      if (seen.has(path)) continue;
      seen.add(path);
      const name = componentName.replace(/Screen$|Page$|View$/i, "") ||
        pathSegment;
      screens.push({
        id: `screen:state:${pathSegment}`,
        name: name.charAt(0).toUpperCase() + name.slice(1),
        path,
        filePath: appFile.path,
        type: "view",
        flows: [],
        navigatesTo: this.extractNavigationLinks(appFile.content),
        framework: "react-state",
      });
    }
    return screens;
  }

  /**
   * Hash-based routing: validPages array, location.hash, pathParts[0].
   * Paths like /hash/home for VisuDEV consistency.
   */
  public extractHashRoutingScreens(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];
    const appFile = files.find(
      (f) =>
        f.path.endsWith("App.tsx") ||
        f.path.endsWith("App.jsx") ||
        f.path === "src/app/App.tsx",
    );
    if (!appFile) return screens;

    const validPagesMatch = appFile.content.match(
      /validPages\s*=\s*\[([^\]]+)\]/,
    );
    if (validPagesMatch) {
      const pageList = validPagesMatch[1]
        .split(",")
        .map((s) => s.replace(/["'\s]/g, ""))
        .filter(Boolean);
      const seen = new Set<string>();
      for (const page of pageList) {
        const path = `/hash/${page}`;
        if (seen.has(path)) continue;
        seen.add(path);
        const name = page.charAt(0).toUpperCase() +
          page.slice(1).replace(/-/g, " ");
        screens.push({
          id: `screen:hash:${page}`,
          name,
          path,
          filePath: appFile.path,
          type: "view",
          flows: [],
          navigatesTo: this.extractNavigationLinks(appFile.content),
          framework: "react-hash",
        });
      }
      return screens;
    }

    const hashPathMatch = appFile.content.match(
      /(?:location\.hash|window\.location\.hash)\s*[^;]*pathParts\s*[^;]*\[0\].*?validPages?\s*[^[]*\[([^\]]+)\]/s,
    );
    if (hashPathMatch) {
      const pageList = hashPathMatch[1]
        .split(",")
        .map((s) => s.replace(/["'\s]/g, ""))
        .filter(Boolean);
      for (const page of pageList) {
        const path = `/hash/${page}`;
        const name = page.charAt(0).toUpperCase() +
          page.slice(1).replace(/-/g, " ");
        if (!screens.some((s) => s.path === path)) {
          screens.push({
            id: `screen:hash:${page}`,
            name,
            path,
            filePath: appFile.path,
            type: "view",
            flows: [],
            navigatesTo: this.extractNavigationLinks(appFile.content),
            framework: "react-hash",
          });
        }
      }
    }
    return screens;
  }

  /**
   * CLI Commander: program.command('name') and subcommands.
   * path = "binName command" e.g. "rag save", "woaru init".
   */
  public extractCliCommanderScreens(
    files: FileContent[],
    packageJsonContent?: string,
  ): Screen[] {
    const screens: Screen[] = [];
    let binName = "cli";
    if (packageJsonContent) {
      try {
        const pkg = JSON.parse(packageJsonContent) as {
          name?: string;
          bin?: string | Record<string, string>;
        };
        if (typeof pkg.bin === "string") {
          binName = pkg.name ?? "cli";
        } else if (pkg.bin && typeof pkg.bin === "object") {
          const firstKey = Object.keys(pkg.bin)[0];
          if (firstKey) binName = firstKey;
        }
      } catch {
        // ignore
      }
    }

    const cliFile = files.find(
      (f) =>
        f.content.includes("program.command(") ||
        f.content.includes("cmd.command(") ||
        f.content.includes("new Command()"),
    );
    if (!cliFile) return screens;

    const commandRegex =
      /\.command\s*\(\s*["']([^"']+)["'](?:\s*,\s*["']([^"']*)["'])?/g;
    const seen = new Set<string>();
    let m: RegExpExecArray | null;

    while ((m = commandRegex.exec(cliFile.content)) !== null) {
      const commandName = m[1];
      const fullPath = `${binName} ${commandName}`.trim();
      if (seen.has(fullPath)) continue;
      seen.add(fullPath);
      const name = commandName
        .split(/[- ]/)
        .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
        .join(" ");
      screens.push({
        id: `screen:cli:${fullPath.replace(/\s/g, ":")}`,
        name,
        path: fullPath,
        filePath: cliFile.path,
        type: "cli-command",
        flows: [],
        navigatesTo: [],
        framework: "cli-commander",
      });
    }
    return screens;
  }

  /**
   * Single-page fallback: one screen when no router/state/hash/cli detected.
   */
  public extractSinglePageFallback(
    files: FileContent[],
    packageJsonContent?: string,
  ): Screen[] {
    let name = "App";
    if (packageJsonContent) {
      try {
        const pkg = JSON.parse(packageJsonContent) as { name?: string };
        if (pkg.name) {
          name = pkg.name
            .replace(/^@[^/]+\//, "")
            .replace(/[-_]/g, " ")
            .replace(/\b\w/g, (c) => c.toUpperCase());
        }
      } catch {
        // ignore
      }
    }
    const appFile = files.find(
      (f) =>
        f.path.endsWith("App.tsx") ||
        f.path.endsWith("App.jsx") ||
        f.path.endsWith("main.tsx") ||
        f.path.endsWith("main.jsx"),
    );
    return [{
      id: "screen:single:app",
      name,
      path: "/",
      filePath: appFile?.path ?? "unknown",
      type: "screen",
      flows: [],
      navigatesTo: appFile ? this.extractNavigationLinks(appFile.content) : [],
      framework: "single-page",
    }];
  }

  public extractScreensHeuristic(files: FileContent[]): Screen[] {
    const screens: Screen[] = [];

    files.forEach((file) => {
      if (file.path.includes("/components/")) {
        return;
      }

      const pathMatch = file.path.match(
        /(?:^|\/(?:src|app)\/)(?:screens?|pages?|views?|routes?)\/([^\/]+)\.(tsx?|jsx?)$/i,
      );
      if (pathMatch) {
        const screenName = pathMatch[1];
        const routePath = `/${
          screenName.toLowerCase().replace(/screen|page|view$/i, "")
        }`;

        screens.push({
          id: `screen:${file.path}`,
          name: screenName.charAt(0).toUpperCase() + screenName.slice(1),
          path: routePath,
          filePath: file.path,
          type: "screen",
          flows: [],
          navigatesTo: this.extractNavigationLinks(file.content),
          framework: "heuristic",
          componentCode: file.content,
        });
        return;
      }

      const componentMatch = file.path.match(
        /\/components?\/([^\/]+)\.(tsx?|jsx?)$/,
      );
      if (componentMatch && !file.path.includes("/components/pages/")) {
        const componentName = componentMatch[1];

        if (
          /^[A-Z]/.test(componentName) &&
          (componentName.endsWith("Screen") ||
            componentName.endsWith("Page") ||
            componentName.endsWith("View") ||
            componentName.length > 8)
        ) {
          screens.push({
            id: `screen:${file.path}`,
            name: componentName,
            path: `/${
              componentName.toLowerCase().replace(/screen|page|view$/i, "")
            }`,
            filePath: file.path,
            type: "screen",
            flows: [],
            navigatesTo: this.extractNavigationLinks(file.content),
            framework: "heuristic",
            componentCode: file.content,
          });
        }
      }
    });

    return screens;
  }

  /** Normalize segment (e.g. "appflow") or path to a path with leading slash. */
  private normalizeNavPath(segmentOrPath: string): string {
    const s = segmentOrPath.trim();
    if (!s || s.startsWith("//") || s.toLowerCase().startsWith("javascript:")) {
      return "";
    }
    if (s.includes("://")) return "";
    if (s.startsWith("/")) return s;
    return `/${s}`;
  }

  private extractNavigationLinks(content: string): string[] {
    const links: string[] = [];
    const add = (raw: string) => {
      const path = this.normalizeNavPath(raw);
      if (path && !links.includes(path)) links.push(path);
    };

    const patterns = [
      /router\.push\s*\(\s*["']([^"']+)["']/g,
      /href=["']([^"']+)["']/g,
      /navigate\s*\(\s*["']([^"']+)["']/g,
      /navigateTo\s*\(\s*["']([^"']+)["']/g,
      /<Link[^>]+to=["']([^"']+)["']/g,
      /<NavLink[^>]+to=["']([^"']+)["']/g,
      // Programmatic / tab navigation (Phase 1: Shell onNavigate, handleNavigate, setActiveScreen)
      /onNavigate\s*\(\s*["']([^"']+)["']/g,
      /handleNavigate\s*\(\s*[\w\s,]*["']([^"']+)["']/g,
      /setActiveScreen\s*\(\s*["']([^"']+)["']/g,
      /(?:pushState|replaceState)\s*\(\s*[^,]*,\s*["'][^"']*([^"']*\/[^"']+)["']/g,
      // Nav config: path, route, screen in objects; key in nav items (appflow, blueprint, ...)
      /\bpath\s*:\s*["']([^"']+)["']/g,
      /\broute\s*:\s*["']([^"']+)["']/g,
      /\bscreen\s*:\s*["']([^"']+)["']/g,
      /\bkey\s*:\s*["'](appflow|blueprint|data|logs|settings|projects)["']/g,
    ];

    patterns.forEach((pattern) => {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const value = match[1];
        if (value && value.length < 120) add(value);
      }
    });

    return links;
  }

  public extractPageLikeScreens(
    screens: Screen[],
    files: FileContent[],
  ): void {
    const existingPaths = new Set(
      screens.map((s) =>
        (s.path || "").trim().toLowerCase().replace(/\/$/, "") || "/"
      ),
    );
    const primitiveSuffixes =
      /(Trigger|Footer|Context|Title|Description|Content)$/i;
    const pageLikePattern =
      /(?:export\s+)?(?:function|const)\s+(\w+(?:Screen|Page|View)|Auth)\s*[<(]/g;
    files.forEach((file) => {
      const content = file.content;
      const seen = new Set<string>();
      let match: RegExpExecArray | null;
      pageLikePattern.lastIndex = 0;
      while ((match = pageLikePattern.exec(content)) !== null) {
        const name = match[1];
        if (primitiveSuffixes.test(name)) continue;
        if (seen.has(name)) continue;
        seen.add(name);
        const base = name.replace(/(Screen|Page|View|Auth)$/i, "").trim() ||
          name;
        const pathSeg = base.replace(/([A-Z])/g, (c) => c.toLowerCase());
        const path = pathSeg ? `/${pathSeg}` : "/";
        const pathNorm = path.toLowerCase().replace(/\/$/, "") || "/";
        if (existingPaths.has(pathNorm)) continue;
        existingPaths.add(pathNorm);
        const id = `screen:page-like:${file.path}:${pathNorm}`;
        const displayName = name === "Auth"
          ? "Auth"
          : name.replace(/(Screen|Page|View)$/i, "").trim() || name;
        screens.push({
          id,
          name: displayName,
          path,
          filePath: file.path,
          type: "screen",
          flows: [],
          navigatesTo: this.extractNavigationLinks(content),
          framework: "page-like",
        });
      }
    });
  }

  public extractModalsTabsAndDropdowns(
    screens: Screen[],
    files: FileContent[],
  ): void {
    const hostByFilePath = new Map<string, Screen>();
    screens.forEach((s) => {
      if (!hostByFilePath.has(s.filePath)) hostByFilePath.set(s.filePath, s);
    });
    files.forEach((file) => {
      const host = hostByFilePath.get(file.path);
      const parentPath = host?.path ?? "/";
      const parentId = host?.id;
      this.extractModalsInFile(file, screens, parentPath, parentId);
      this.extractTabsInFile(file, screens, parentPath, parentId);
      this.extractDropdownsInFile(file, screens, parentPath, parentId);
    });
  }

  private extractDropdownsInFile(
    file: FileContent,
    screens: Screen[],
    parentPath: string,
    parentId: string | undefined,
  ): void {
    const content = file.content;
    const hasDropdown =
      /DropdownMenu|DropdownMenuItem|Select\b|SelectItem|SelectTrigger|<select\b/i
        .test(
          content,
        );
    if (!hasDropdown) return;
    const itemLabels = new Set<string>();
    const itemPatterns = [
      /DropdownMenuItem\s+[^>]*>\s*([^<]+)</g,
      /SelectItem\s+value=["'][^"']*["'][^>]*>\s*([^<]+)</g,
      /<option\s+value=["'][^"']*["'][^>]*>\s*([^<]+)</g,
      /<MenuItem[^>]*>\s*([^<]+)</g,
      /["']([^"']{2,40})["']\s*:\s*(?:<\w+|\()[\s\S]*?DropdownMenu/gi,
    ];
    for (const pattern of itemPatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const raw = (match[1] ?? "").trim().replace(/\s+/g, " ").slice(0, 50);
        if (raw.length >= 2) itemLabels.add(raw);
      }
    }
    if (itemLabels.size === 0) return;
    const id = `screen:dropdown:${file.path}:0`;
    const dropdownScreen: Screen = {
      id,
      name: "Dropdown",
      path: parentPath,
      filePath: file.path,
      type: "dropdown",
      flows: [],
      navigatesTo: [],
      framework: "state",
      parentPath,
      parentScreenId: parentId,
      stateKey: "dropdown:menu",
    };
    screens.push(dropdownScreen);
    if (parentId) {
      const host = screens.find((s) => s.id === parentId);
      if (host) {
        host.stateTargets = host.stateTargets ?? [];
        itemLabels.forEach((label) => {
          host!.stateTargets!.push({
            targetScreenId: id,
            edgeType: "dropdown-action",
            trigger: { label },
          });
        });
      }
    }
  }

  private extractModalsInFile(
    file: FileContent,
    screens: Screen[],
    parentPath: string,
    parentId: string | undefined,
  ): void {
    const content = file.content;
    const seenKeys = new Set<string>();
    const seenDisplayNames = new Set<string>();
    let index = 0;

    const pushModal = (name: string, explicitDisplayName?: string | null) => {
      const displayName = explicitDisplayName != null
        ? explicitDisplayName.replace(/-/g, " ").replace(
          /\b\w/g,
          (c) => c.toUpperCase(),
        )
        : name.replace(/(Modal|Dialog|Drawer)$/i, "").trim() || name;
      if (seenDisplayNames.has(displayName)) return;
      const slug = name.replace(/[^a-z0-9]/gi, "-").toLowerCase() || "modal";
      const stateKey = `modal:${slug}:${index}`;
      if (seenKeys.has(stateKey)) return;
      seenKeys.add(stateKey);
      seenDisplayNames.add(displayName);
      const id = `screen:modal:${file.path}:${index}`;
      const modalScreen: Screen = {
        id,
        name: displayName,
        path: parentPath,
        filePath: file.path,
        type: "modal",
        flows: [],
        navigatesTo: [],
        framework: "state",
        parentPath,
        parentScreenId: parentId,
        stateKey,
      };
      screens.push(modalScreen);
      if (parentId) {
        const host = screens.find((s) => s.id === parentId);
        if (host) {
          const st: StateTarget = {
            targetScreenId: id,
            edgeType: "open-modal",
            trigger: { label: modalScreen.name },
          };
          host.stateTargets = host.stateTargets ?? [];
          host.stateTargets.push(st);
        }
      }
      index += 1;
    };

    /* 1) JSX: dialog/modal usage – tags (optional data-visudev-modal), role/aria, class patterns, modal-like props. */
    const jsxTagPatterns: Array<{ re: RegExp; name: string }> = [
      { re: /<Dialog\b[^>]*>/g, name: "Dialog" },
      { re: /<Modal\b[^>]*>/g, name: "Modal" },
      { re: /<Drawer\b[^>]*>/g, name: "Drawer" },
      { re: /<DialogContent\b[^>]*>/g, name: "DialogContent" },
      { re: /<Popover\b[^>]*>/g, name: "Popover" },
      { re: /<Sheet\b[^>]*>/g, name: "Sheet" },
      { re: /<AlertDialog\b[^>]*>/g, name: "AlertDialog" },
      { re: /<AlertModal\b[^>]*>/g, name: "AlertModal" },
      { re: /<Popup\b[^>]*>/g, name: "Popup" },
      { re: /<Overlay\b[^>]*>/g, name: "Overlay" },
    ];
    jsxTagPatterns.forEach(({ re, name }) => {
      re.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = re.exec(content)) !== null) {
        const explicitName = getVisudevAttrInContext(
          content,
          match.index,
          "data-visudev-modal",
        );
        pushModal(explicitName ?? name, explicitName ?? undefined);
      }
    });
    /* role/aria (no tag). */
    [/role=["']dialog["']/g, /aria-modal=["']true["']/g].forEach((re) => {
      re.lastIndex = 0;
      let _match: RegExpExecArray | null;
      while ((_match = re.exec(content)) !== null) {
        pushModal("Modal", undefined);
      }
    });
    /* className/class with modal|dialog|drawer|overlay|popup. */
    [
      /className=["'][^"']*(?:modal|dialog|drawer|overlay|popup)[^"']*["']/gi,
      /class=["'][^"']*(?:modal|dialog|drawer|overlay|popup)[^"']*["']/gi,
    ].forEach((re) => {
      re.lastIndex = 0;
      let _match: RegExpExecArray | null;
      while ((_match = re.exec(content)) !== null) {
        pushModal("Modal", undefined);
      }
    });
    /* Props: open=, onClose=, isOpen=, visible=, show=. */
    const propsRe = /<(\w+)\b[^>]*\b(?:open|onClose|isOpen|visible|show)\s*=/g;
    let propsMatch: RegExpExecArray | null;
    while ((propsMatch = propsRe.exec(content)) !== null) {
      const tagName = propsMatch[1] ?? "Modal";
      if (!/^(button|input|select|textarea|form|a)$/i.test(tagName)) {
        pushModal(tagName, undefined);
      }
    }

    /* 2) Großzügig: Komponenten-Namen – *Dialog* / *Modal* / *Drawer* / *Popover* / *Popup* / *Overlay* / *Sheet* (auch unsauber), außer Primitives. */
    const componentNamePatterns = [
      /export\s+(?:function|const|class)\s+(\w*(?:Dialog|Modal|Drawer|Popover|Popup|Overlay|Sheet|AlertDialog|AlertModal)\w*)/gi,
      /(?:function|const)\s+(\w*(?:Dialog|Modal|Drawer|Popover|Popup|Overlay|Sheet|AlertDialog|AlertModal)\w*)\s*[=(]/g,
    ];
    const primitiveNames =
      /^(DialogTrigger|DialogClose|DialogTitle|DialogDescription|DialogContext|DialogFooter|PopoverTrigger|PopoverClose)$/i;
    const modalNamesFromNames = new Set<string>();
    for (const re of componentNamePatterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(content)) !== null) {
        const raw = (m[1] ?? "").trim();
        if (!raw) continue;
        if (primitiveNames.test(raw)) continue;
        modalNamesFromNames.add(raw);
      }
    }
    modalNamesFromNames.forEach((name) => pushModal(name));
  }

  private extractTabsInFile(
    file: FileContent,
    screens: Screen[],
    parentPath: string,
    parentId: string | undefined,
  ): void {
    const content = file.content;
    const tabValuePatterns = [
      /<Tab\s+value=["']([^"']+)["']/g,
      /<Tabs\.Tab\s+value=["']([^"']+)["']/g,
      /<TabPanel\s+value=["']([^"']+)["']/g,
      /["'](\w+)["']\s*:\s*<\w+[\s\S]*?tab/gi,
    ];
    const tabLabels = new Set<string>();
    const valueToMatchIndex = new Map<string, number>();
    for (const pattern of tabValuePatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const raw = match[1]?.trim() ?? "";
        if (raw.length > 0 && raw.length < 60) {
          tabLabels.add(raw);
          if (!valueToMatchIndex.has(raw)) {
            valueToMatchIndex.set(raw, match.index);
          }
        }
      }
    }
    if (tabLabels.size === 0) return;
    let index = 0;
    tabLabels.forEach((value) => {
      const stateKey = `tab:${value}`;
      const id = `screen:tab:${file.path}:${index}`;
      const explicitTab = getVisudevAttrInContext(
        content,
        valueToMatchIndex.get(value) ?? 0,
        "data-visudev-tab",
      );
      const label = explicitTab != null
        ? explicitTab.replace(/-/g, " ").replace(
          /\b\w/g,
          (c) => c.toUpperCase(),
        )
        : value.charAt(0).toUpperCase() + value.slice(1);
      const tabScreen: Screen = {
        id,
        name: `Tab: ${label}`,
        path: parentPath,
        filePath: file.path,
        type: "tab",
        flows: [],
        navigatesTo: [],
        framework: "state",
        parentPath,
        parentScreenId: parentId,
        stateKey,
      };
      screens.push(tabScreen);
      if (parentId) {
        const host = screens.find((s) => s.id === parentId);
        if (host) {
          const st: StateTarget = {
            targetScreenId: id,
            edgeType: "switch-tab",
            trigger: { label },
          };
          host.stateTargets = host.stateTargets ?? [];
          host.stateTargets.push(st);
        }
      }
      index += 1;
    });
  }
}

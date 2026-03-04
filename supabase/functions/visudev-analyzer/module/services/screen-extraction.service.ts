import type { FileContent, Screen, StateTarget } from "../dto/index.ts";
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
        const pathCandidates = astRoutes.map((r) => r.path);
        const navHostPath = pathCandidates.find((p) =>
          p === "/projects" || p.endsWith("/projects")
        ) ??
          pathCandidates.find((p) =>
            p === "/"
          ) ??
          pathCandidates[0] ??
          null;
        const navigatesTo = this.getNavigationLinks(file.content, file.path);
        astRoutes.forEach(({ path: routePath, componentName }) => {
          screens.push({
            id: `screen:${componentName}:${routePath}`,
            name: componentName,
            path: routePath,
            filePath: file.path,
            type: "page",
            flows: [],
            navigatesTo: routePath === navHostPath ? navigatesTo : [],
            framework: "react-router",
          });
        });
        return;
      }

      const routeRegex = /<Route\s+path=["']([^"']+)["']\s+element=\{<(\w+)/g;
      let match: RegExpExecArray | null;
      const routeEntries: { routePath: string; componentName: string }[] = [];
      while ((match = routeRegex.exec(file.content)) !== null) {
        routeEntries.push({ routePath: match[1], componentName: match[2] });
      }
      const pathCandidates = routeEntries.map((e) => e.routePath);
      const navHostPath = pathCandidates.find((p) =>
        p === "/projects" || p.endsWith("/projects")
      ) ??
        pathCandidates.find((p) =>
          p === "/"
        ) ??
        pathCandidates[0] ??
        null;
      const navigatesTo = this.getNavigationLinks(file.content, file.path);
      routeEntries.forEach(({ routePath, componentName }) => {
        screens.push({
          id: `screen:${componentName}:${routePath}`,
          name: componentName,
          path: routePath,
          filePath: file.path,
          type: "page",
          flows: [],
          navigatesTo: routePath === navHostPath ? navigatesTo : [],
          framework: "react-router",
        });
      });

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
            navigatesTo: [],
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
      /onNavigate\s*\(\s*["']([^"']+)["']/g,
      /handleNavigate\s*\(\s*[\w\s,]*["']([^"']+)["']/g,
      /setActiveScreen\s*\(\s*["']([^"']+)["']/g,
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

  /**
   * Supplement route extraction: find exported components that look like pages
   * (Auth, *Screen, *Page, *View) and add them as type "screen" with iframe path.
   * Excludes Radix primitives (DialogTrigger, DialogContext, etc.).
   */
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
          navigatesTo: this.getNavigationLinks(content, file.path),
          framework: "page-like",
        });
      }
    });
  }

  /**
   * Enrich screens with state-based nodes (modals, tabs) and stateTargets on host screens.
   * Detects Dialog/Modal/Drawer, Radix/MUI Tabs; dropdowns as trigger labels on edges.
   */
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

    const pushModal = (name: string) => {
      const displayName = name.replace(/(Modal|Dialog|Drawer)$/i, "").trim() ||
        name;
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

    /* 1) JSX: dialog/modal usage – tags, role/aria, class patterns, modal-like props (open/onClose). */
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
      let _match: RegExpExecArray | null;
      while ((_match = re.exec(content)) !== null) pushModal(name);
    });
    /* role/aria (no tag name). */
    [/role=["']dialog["']/g, /aria-modal=["']true["']/g].forEach((re) => {
      re.lastIndex = 0;
      let _match: RegExpExecArray | null;
      while ((_match = re.exec(content)) !== null) pushModal("Modal");
    });
    /* className/class with modal|dialog|drawer|overlay|popup – unsauber benannte Wrapper. */
    [
      /className=["'][^"']*(?:modal|dialog|drawer|overlay|popup)[^"']*["']/gi,
      /class=["'][^"']*(?:modal|dialog|drawer|overlay|popup)[^"']*["']/gi,
    ].forEach((re) => {
      re.lastIndex = 0;
      let _match: RegExpExecArray | null;
      while ((_match = re.exec(content)) !== null) pushModal("Modal");
    });
    /* Props: open=, onClose=, isOpen=, visible=, show= – typische Modal/Overlay-Props. */
    const propsRe = /<(\w+)\b[^>]*\b(?:open|onClose|isOpen|visible|show)\s*=/g;
    let propsMatch: RegExpExecArray | null;
    while ((propsMatch = propsRe.exec(content)) !== null) {
      const tagName = propsMatch[1] ?? "Modal";
      if (!/^(button|input|select|textarea|form|a)$/i.test(tagName)) {
        pushModal(tagName);
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
    for (const pattern of tabValuePatterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(content)) !== null) {
        const raw = match[1]?.trim() ?? "";
        if (raw.length > 0 && raw.length < 60) tabLabels.add(raw);
      }
    }
    if (tabLabels.size === 0) return;
    let index = 0;
    tabLabels.forEach((value) => {
      const stateKey = `tab:${value}`;
      const id = `screen:tab:${file.path}:${index}`;
      const name = value.charAt(0).toUpperCase() + value.slice(1);
      const tabScreen: Screen = {
        id,
        name: `Tab: ${name}`,
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
            trigger: { label: name },
          };
          host.stateTargets = host.stateTargets ?? [];
          host.stateTargets.push(st);
        }
      }
      index += 1;
    });
  }
}

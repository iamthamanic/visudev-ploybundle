/**
 * Single responsibility: detect page-like screens from component names (Screen/Page/View/Auth).
 * Heuristic only; separate from modal/tab/dropdown so each concern has one change reason.
 */
import type { FileContent, Screen } from "../dto/index.ts";
import type { NavigationLinkExtractor } from "./navigation-link-extractor.ts";

export class PageLikeExtractor {
  constructor(private readonly navExtractor: NavigationLinkExtractor) {}

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
          navigatesTo: this.navExtractor.extractNavigationLinks(content),
          framework: "page-like",
        });
      }
    });
  }
}

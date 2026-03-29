/**
 * Single responsibility: extract navigation link targets from source content.
 * Used by ScreenExtractionService so routing extraction and nav heuristics are separate concerns.
 */

export class NavigationLinkExtractor {
  /** Normalize segment or path to a path with leading slash; reject dangerous or external URLs. */
  public normalizeNavPath(segmentOrPath: string): string {
    const s = segmentOrPath.trim();
    if (!s || s.startsWith("//") || s.toLowerCase().startsWith("javascript:")) {
      return "";
    }
    if (s.includes("://")) return "";
    if (s.startsWith("/")) return s;
    return `/${s}`;
  }

  public extractNavigationLinks(content: string): string[] {
    const linkSet = new Set<string>();
    const add = (raw: string) => {
      const path = this.normalizeNavPath(raw);
      if (path) linkSet.add(path);
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
      /(?:pushState|replaceState)\s*\(\s*[^,]*,\s*["'][^"']*([^"']*\/[^"']+)["']/g,
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

    return [...linkSet];
  }
}

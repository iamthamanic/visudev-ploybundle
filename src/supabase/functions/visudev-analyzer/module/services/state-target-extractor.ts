/**
 * Single responsibility: detect modal, tab, and dropdown state targets from source (heuristics only).
 * Page-like detection lives in PageLikeExtractor. Design: regex-based; host lookup via Map for O(1).
 * Limits: multiple dropdowns in one file get unique id via index.
 */
import type { FileContent, Screen, StateTarget } from "../dto/index.ts";

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

export class StateTargetExtractor {
  public extractModalsTabsAndDropdowns(
    screens: Screen[],
    files: FileContent[],
  ): void {
    const hostByFilePath = new Map<string, Screen>();
    screens.forEach((s) => {
      if (!hostByFilePath.has(s.filePath)) hostByFilePath.set(s.filePath, s);
    });
    const hostById = new Map<string, Screen>(
      screens.map((s) => [s.id, s]),
    );
    let dropdownIndex = 0;
    const nextDropdownIndex = (): number => dropdownIndex++;
    files.forEach((file) => {
      const host = hostByFilePath.get(file.path);
      const parentPath = host?.path ?? "/";
      const parentId = host?.id;
      this.extractModalsInFile(file, screens, parentPath, parentId, hostById);
      this.extractTabsInFile(file, screens, parentPath, parentId, hostById);
      this.extractDropdownsInFile(
        file,
        screens,
        parentPath,
        parentId,
        hostById,
        nextDropdownIndex,
      );
    });
  }

  private extractDropdownsInFile(
    file: FileContent,
    screens: Screen[],
    parentPath: string,
    parentId: string | undefined,
    hostById: Map<string, Screen>,
    nextDropdownIndex: () => number,
  ): void {
    const content = file.content;
    const hasDropdown =
      /DropdownMenu|DropdownMenuItem|Select\b|SelectItem|SelectTrigger|<select\b/i
        .test(content);
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
    const id = `screen:dropdown:${file.path}:${nextDropdownIndex()}`;
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
      const host = hostById.get(parentId);
      if (host) {
        host.stateTargets = host.stateTargets ?? [];
        itemLabels.forEach((label) => {
          host.stateTargets!.push({
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
    hostById: Map<string, Screen>,
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
        const host = hostById.get(parentId);
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
    [/role=["']dialog["']/g, /aria-modal=["']true["']/g].forEach((re) => {
      re.lastIndex = 0;
      let _match: RegExpExecArray | null;
      while ((_match = re.exec(content)) !== null) {
        pushModal("Modal", undefined);
      }
    });
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
    const propsRe = /<(\w+)\b[^>]*\b(?:open|onClose|isOpen|visible|show)\s*=/g;
    let propsMatch: RegExpExecArray | null;
    while ((propsMatch = propsRe.exec(content)) !== null) {
      const tagName = propsMatch[1] ?? "Modal";
      if (!/^(button|input|select|textarea|form|a)$/i.test(tagName)) {
        pushModal(tagName, undefined);
      }
    }

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
    hostById: Map<string, Screen>,
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
        const host = hostById.get(parentId);
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

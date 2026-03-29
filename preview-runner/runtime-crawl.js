import { chromium } from "@playwright/test";

const DANGEROUS_ACTION_RE =
  /\b(delete|remove|destroy|drop|truncate|logout|sign out|signout|buy|purchase|checkout|pay|billing|subscribe)\b/i;
const CLICKABLE_SELECTOR =
  'button,[role="button"],a[href],[role="tab"],[role="menuitem"],[data-visudev-trigger]';

export async function runRuntimeCrawl(options) {
  const {
    baseUrl,
    screens = [],
    maxScreens = 8,
    maxClicksPerScreen = 5,
    viewport = { width: 1440, height: 960 },
    logger = console,
  } = options;
  const normalizedBaseUrl = String(baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  if (!normalizedBaseUrl) {
    throw new Error("Runtime crawl requires a baseUrl.");
  }

  const routeScreens = screens.filter(isRouteScreen).slice(0, Math.max(1, maxScreens));
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport,
  });
  const page = await context.newPage();
  const result = {
    baseUrl: normalizedBaseUrl,
    crawledAt: new Date().toISOString(),
    summary: {
      visitedScreens: 0,
      attemptedClicks: 0,
      verifiedEdges: 0,
      stateCaptures: 0,
      mismatchCount: 0,
      issueCount: 0,
    },
    snapshots: [],
    verifiedEdges: [],
    stateScreens: [],
    issues: [],
  };
  const stateCaptureByScreenId = new Map();

  try {
    for (const screen of routeScreens) {
      const screenUrl = toScreenUrl(normalizedBaseUrl, screen.path);
      try {
        await visitScreen(page, screenUrl);
      } catch (error) {
        pushIssue(result, {
          code: "screen_load_failed",
          severity: "high",
          screenId: screen.id,
          message: `Screen ${screen.name} konnte nicht geladen werden: ${toMessage(error)}`,
        });
        continue;
      }

      result.summary.visitedScreens += 1;
      const before = await collectDomSnapshot(page);
      result.snapshots.push({
        screenId: screen.id,
        route: before.route,
        title: before.title,
        interactiveCount: before.interactiveElements.length,
        containerCount: before.containers.length,
        openContainerCount: before.containers.filter((item) => item.visible && item.open !== false)
          .length,
      });

      const candidates = before.interactiveElements
        .filter((candidate) => isSafeCandidate(candidate))
        .slice(0, Math.max(1, maxClicksPerScreen));
      if (candidates.length === 0) {
        pushIssue(result, {
          code: "no_interactive_candidates",
          severity: "info",
          screenId: screen.id,
          message: `Keine sicheren Klick-Ziele auf ${screen.name} gefunden.`,
        });
        continue;
      }

      for (const candidate of candidates) {
        result.summary.attemptedClicks += 1;
        try {
          await visitScreen(page, screenUrl);
          const baseline = await collectDomSnapshot(page);
          const locator = await resolveLocator(page, candidate);
          if (!locator) {
            pushIssue(result, {
              code: "click_failed",
              severity: "warning",
              screenId: screen.id,
              triggerLabel: candidate.label,
              message: `Kein Locator für ${candidate.label ?? candidate.selector ?? candidate.href ?? candidate.tagName} gefunden.`,
            });
            continue;
          }
          await locator.click({ timeout: 2500, noWaitAfter: true });
          await settlePage(page);
          const after = await collectDomSnapshot(page);
          const trigger = buildTrigger(candidate);

          if (after.route !== baseline.route) {
            const targetScreen = findTargetRouteScreen(screens, after.route);
            if (!targetScreen) {
              pushIssue(result, {
                code: "graph_without_runtime_match",
                severity: "warning",
                screenId: screen.id,
                triggerLabel: candidate.label,
                message: `Navigation nach ${after.route} konnte keinem Screen zugeordnet werden.`,
              });
            }
            result.verifiedEdges.push({
              fromScreenId: screen.id,
              toScreenId: targetScreen?.id,
              type: "navigate",
              targetPath: after.route,
              trigger,
              verification: "route-change",
              sourceRoute: baseline.route,
              targetRoute: after.route,
              matchedBy: targetScreen ? "path" : undefined,
            });
            continue;
          }

          if (!isStateChange(baseline, after, candidate)) {
            continue;
          }

          const edgeType = classifyStateEdge(candidate, after);
          const matchedState = matchStateScreen(screens, screen, edgeType, candidate, after);
          const screenshotUrl = await captureStateScreenshot(page, after);
          result.verifiedEdges.push({
            fromScreenId: screen.id,
            toScreenId: matchedState?.id,
            type: edgeType,
            trigger,
            verification: "state-change",
            sourceRoute: baseline.route,
            targetRoute: after.route,
            matchedBy: matchedState?.matchedBy,
            screenshotUrl,
          });
          if (matchedState?.id && !stateCaptureByScreenId.has(matchedState.id)) {
            stateCaptureByScreenId.set(matchedState.id, {
              screenId: matchedState.id,
              parentScreenId: screen.id,
              type: matchedState.type,
              label: matchedState.label,
              screenshotUrl,
              matchedBy: matchedState.matchedBy,
              trigger,
            });
          } else if (!matchedState) {
            pushIssue(result, {
              code: "dom_without_graph_match",
              severity: "warning",
              screenId: screen.id,
              triggerLabel: candidate.label,
              message: `State-Change auf ${screen.name} konnte keinem vorhandenen State-Screen zugeordnet werden.`,
            });
          }
        } catch (error) {
          pushIssue(result, {
            code: "click_failed",
            severity: "warning",
            screenId: screen.id,
            triggerLabel: candidate.label,
            message: `Klick auf ${candidate.label ?? candidate.selector ?? candidate.href ?? candidate.tagName} fehlgeschlagen: ${toMessage(error)}`,
          });
        }
      }
    }
  } finally {
    await browser.close();
  }

  result.stateScreens = [...stateCaptureByScreenId.values()];
  result.summary.verifiedEdges = result.verifiedEdges.length;
  result.summary.stateCaptures = result.stateScreens.length;
  result.summary.mismatchCount = result.issues.filter(
    (issue) =>
      issue.code === "graph_without_runtime_match" || issue.code === "dom_without_graph_match",
  ).length;
  result.summary.issueCount = result.issues.length;
  logger.info?.("[runtime-crawl] completed", result.summary);
  return result;
}

async function visitScreen(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
  await settlePage(page);
}

async function settlePage(page) {
  await page.waitForLoadState("networkidle", { timeout: 1500 }).catch(() => undefined);
  await page.waitForTimeout(350);
}

async function collectDomSnapshot(page) {
  return await page.evaluate((selector) => {
    const normalizePath = (path) => {
      const raw =
        String(path || "/")
          .split("?")[0]
          .split("#")[0] || "/";
      const withoutProxy = raw.replace(/^\/p\/\d+(?=\/|$)/, "") || "/";
      const withSlash = withoutProxy.startsWith("/") ? withoutProxy : `/${withoutProxy}`;
      return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
    };
    const clean = (value, max = 80) => {
      const text = String(value || "")
        .replace(/\s+/g, " ")
        .trim();
      return text ? text.slice(0, max) : undefined;
    };
    const rectOf = (el) => {
      const rect = el?.getBoundingClientRect?.();
      return rect
        ? {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          }
        : undefined;
    };
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = rectOf(el);
      return Boolean(
        rect &&
        rect.width > 0 &&
        rect.height > 0 &&
        style.display !== "none" &&
        style.visibility !== "hidden",
      );
    };
    const selectorFor = (el) => {
      if (el.id) return `#${String(el.id).replace(/\s+/g, "-")}`;
      const testId = clean(el.getAttribute("data-testid") || el.getAttribute("data-test-id"));
      if (testId) return `${String(el.tagName || "").toLowerCase()}[data-testid="${testId}"]`;
      const href = clean(el.getAttribute("href"));
      if (href && href.startsWith("/")) return `a[href="${href}"]`;
      const ariaLabel = clean(el.getAttribute("aria-label"));
      return ariaLabel
        ? `${String(el.tagName || "").toLowerCase()}[aria-label="${ariaLabel}"]`
        : String(el.tagName || "").toLowerCase();
    };
    const interactiveElements = Array.from(document.querySelectorAll(selector))
      .slice(0, 80)
      .map((el) => ({
        tagName: String(el.tagName || "").toLowerCase(),
        role: el.getAttribute("role") || undefined,
        label: clean(el.getAttribute("aria-label") || el.textContent || el.getAttribute("title")),
        href: clean(el.getAttribute("href")),
        selector: selectorFor(el),
        testId: clean(el.getAttribute("data-testid") || el.getAttribute("data-test-id")),
        visible: visible(el),
        enabled: !el.hasAttribute("disabled") && el.getAttribute("aria-disabled") !== "true",
        active:
          el.getAttribute("aria-selected") === "true" ||
          el.getAttribute("aria-current") != null ||
          /\b(active|selected|current)\b/i.test(el.className || ""),
        open:
          el.hasAttribute("open") ||
          el.getAttribute("aria-expanded") === "true" ||
          (el.getAttribute("data-state") || "").toLowerCase() === "open",
      }));
    const containers = Array.from(
      document.querySelectorAll(
        '[role="dialog"],[aria-modal="true"],dialog,[role="tablist"],[role="tabpanel"],[role="menu"],[role="listbox"],[data-visudev-modal],[data-visudev-tab],[data-visudev-dropdown],details',
      ),
    )
      .slice(0, 40)
      .map((el) => ({
        type: el.matches('[role="tablist"],[data-visudev-tab]')
          ? "tablist"
          : el.matches('[role="tabpanel"]')
            ? "tabpanel"
            : el.matches('[role="menu"],[data-visudev-dropdown]')
              ? "menu"
              : el.matches('[role="listbox"]')
                ? "listbox"
                : el.matches("details")
                  ? "drawer"
                  : "dialog",
        label: clean(el.getAttribute("aria-label") || el.textContent || el.getAttribute("title")),
        visible: visible(el),
        open:
          el.hasAttribute("open") ||
          el.getAttribute("aria-expanded") === "true" ||
          el.getAttribute("aria-hidden") === "false" ||
          (el.getAttribute("data-state") || "").toLowerCase() === "open",
        rect: rectOf(el),
      }));
    return {
      route: normalizePath(window.location.pathname || "/"),
      title: clean(document.title, 120),
      interactiveElements,
      containers,
    };
  }, CLICKABLE_SELECTOR);
}

function isSafeCandidate(candidate) {
  const label = `${candidate.label ?? ""} ${candidate.href ?? ""}`.trim();
  return candidate.visible && candidate.enabled && !DANGEROUS_ACTION_RE.test(label);
}

async function resolveLocator(page, candidate) {
  if (candidate.testId) return page.getByTestId(candidate.testId).first();
  if (candidate.selector && /^#|^\w+\[/.test(candidate.selector))
    return page.locator(candidate.selector).first();
  if (candidate.href && candidate.tagName === "a")
    return page.locator(`a[href="${candidate.href}"]`).first();
  if (
    candidate.role &&
    candidate.label &&
    ["button", "link", "tab", "menuitem"].includes(candidate.role)
  ) {
    return page.getByRole(candidate.role, { name: candidate.label, exact: true }).first();
  }
  if (candidate.label)
    return page.locator(CLICKABLE_SELECTOR).filter({ hasText: candidate.label }).first();
  return null;
}

function isStateChange(before, after, candidate) {
  const beforeOpen = before.containers.filter((item) => item.visible && item.open !== false).length;
  const afterOpen = after.containers.filter((item) => item.visible && item.open !== false).length;
  if (afterOpen > beforeOpen) return true;
  if (candidate.role !== "tab") return false;
  const beforeActive = before.interactiveElements.find(
    (item) => item.selector === candidate.selector,
  )?.active;
  const afterActive = after.interactiveElements.find(
    (item) => item.selector === candidate.selector,
  )?.active;
  return beforeActive !== afterActive && afterActive === true;
}

function classifyStateEdge(candidate, after) {
  if (candidate.role === "tab" || after.containers.some((item) => item.type === "tabpanel")) {
    return "switch-tab";
  }
  if (after.containers.some((item) => item.type === "menu" || item.type === "listbox")) {
    return "dropdown-action";
  }
  return "open-modal";
}

function matchStateScreen(screens, sourceScreen, edgeType, candidate, after) {
  const expectedType =
    edgeType === "switch-tab" ? "tab" : edgeType === "dropdown-action" ? "dropdown" : "modal";
  const candidates = screens.filter(
    (screen) =>
      screen.type === expectedType &&
      (screen.parentScreenId === sourceScreen.id ||
        normalizePath(screen.parentPath) === normalizePath(sourceScreen.path)),
  );
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    return {
      id: candidates[0].id,
      type: expectedType,
      label: candidates[0].name,
      matchedBy: "parent-state",
    };
  }
  const tokens = [candidate.label, ...after.containers.map((item) => item.label)]
    .map(normalizeToken)
    .filter(Boolean);
  const matched = candidates.find((screen) => tokens.some((token) => labelMatches(screen, token)));
  return matched
    ? { id: matched.id, type: expectedType, label: matched.name, matchedBy: "label" }
    : null;
}

async function captureStateScreenshot(page, snapshot) {
  const target = snapshot.containers.find(
    (item) => item.visible && item.rect && item.rect.width > 40 && item.rect.height > 40,
  );
  const image = target?.rect
    ? await page.screenshot({ type: "jpeg", quality: 60, clip: clampClip(page, target.rect) })
    : await page.screenshot({ type: "jpeg", quality: 60, fullPage: false });
  return `data:image/jpeg;base64,${image.toString("base64")}`;
}

function clampClip(page, rect) {
  const viewport = page.viewportSize() || { width: 1440, height: 960 };
  return {
    x: Math.max(0, rect.x),
    y: Math.max(0, rect.y),
    width: Math.max(1, Math.min(rect.width, viewport.width - Math.max(0, rect.x))),
    height: Math.max(1, Math.min(rect.height, viewport.height - Math.max(0, rect.y))),
  };
}

function findTargetRouteScreen(screens, route) {
  const normalizedRoute = normalizePath(route);
  return (
    screens
      .filter(isRouteScreen)
      .find((screen) => normalizePath(screen.path) === normalizedRoute) ??
    screens
      .filter(isRouteScreen)
      .find((screen) => segment(screen.path) === segment(normalizedRoute))
  );
}

function pushIssue(result, issue) {
  result.issues.push(issue);
}

function buildTrigger(candidate) {
  return {
    label: candidate.label,
    role: candidate.role,
    href: candidate.href,
    selector: candidate.selector,
    testId: candidate.testId,
  };
}

function isRouteScreen(screen) {
  return screen.type !== "modal" && screen.type !== "tab" && screen.type !== "dropdown";
}

function toScreenUrl(baseUrl, path) {
  return `${baseUrl}${normalizePath(path)}`;
}

function normalizePath(value) {
  const raw = String(value || "/").trim() || "/";
  const withoutProxy = raw.replace(/^\/p\/\d+(?=\/|$)/, "") || "/";
  const withSlash = withoutProxy.startsWith("/") ? withoutProxy : `/${withoutProxy}`;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}

function segment(path) {
  return normalizePath(path).replace(/^\//, "").toLowerCase() || "projects";
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function labelMatches(screen, token) {
  return [screen.name, screen.stateKey].some((value) => normalizeToken(value).includes(token));
}

function toMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

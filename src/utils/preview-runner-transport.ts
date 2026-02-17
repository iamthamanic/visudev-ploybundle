import { discoverRunnerUrl } from "./preview-runner-core";
import { warnRunnerOnce } from "./preview-runner-parser";

interface RunnerFetchResult {
  res: Response;
  text: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}

function shouldFallbackToDiscovery(status: number, context: string): boolean {
  if (status >= 500 || status === 408 || status === 429) return true;
  // 404 can indicate a wrong runner base for startup endpoints.
  if (status === 404 && context.includes("/start")) return true;
  return false;
}

export async function requestRunnerWithDiscovery(
  baseUrl: string,
  context: string,
  doFetch: (urlBase: string) => Promise<RunnerFetchResult>,
): Promise<
  { ok: true; baseUrl: string; res: Response; text: string } | { ok: false; error: string }
> {
  const base = normalizeBaseUrl(baseUrl);
  let firstResult: RunnerFetchResult | null = null;
  try {
    firstResult = await doFetch(base);
    if (firstResult.res.ok || !shouldFallbackToDiscovery(firstResult.res.status, context)) {
      return { ok: true, baseUrl: base, res: firstResult.res, text: firstResult.text };
    }
  } catch (error) {
    warnRunnerOnce(`${context} request failed (${base})`, error);
  }

  const found = await discoverRunnerUrl();
  const discoveredBase = found ? normalizeBaseUrl(found) : null;
  if (discoveredBase && discoveredBase !== base) {
    try {
      const retry = await doFetch(discoveredBase);
      return { ok: true, baseUrl: discoveredBase, res: retry.res, text: retry.text };
    } catch (retryError) {
      warnRunnerOnce(`${context} retry failed (${discoveredBase})`, retryError);
    }
  }

  if (firstResult) {
    return { ok: true, baseUrl: base, res: firstResult.res, text: firstResult.text };
  }

  return {
    ok: false,
    error: `Preview Runner nicht erreichbar. Läuft der Runner? (lokal: ${base})`,
  };
}

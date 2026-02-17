import { discoverRunnerUrl } from "./preview-runner-core";
import { warnRunnerOnce } from "./preview-runner-parser";

interface RunnerFetchResult {
  res: Response;
  text: string;
}

export async function requestRunnerWithDiscovery(
  baseUrl: string,
  context: string,
  doFetch: (urlBase: string) => Promise<RunnerFetchResult>,
): Promise<
  { ok: true; baseUrl: string; res: Response; text: string } | { ok: false; error: string }
> {
  let base = baseUrl;
  try {
    const first = await doFetch(base);
    return { ok: true, baseUrl: base, res: first.res, text: first.text };
  } catch (error) {
    warnRunnerOnce(`${context} request failed (${base})`, error);
    const found = await discoverRunnerUrl();
    if (found) {
      base = found.replace(/\/$/, "");
      try {
        const retry = await doFetch(base);
        return { ok: true, baseUrl: base, res: retry.res, text: retry.text };
      } catch (retryError) {
        warnRunnerOnce(`${context} retry failed (${base})`, retryError);
        return {
          ok: false,
          error: `Preview Runner nicht erreichbar. Läuft der Runner? (lokal: ${base})`,
        };
      }
    }

    return {
      ok: false,
      error: "Preview Runner nicht erreichbar. Läuft der Runner? (lokal: http://localhost:4000)",
    };
  }
}

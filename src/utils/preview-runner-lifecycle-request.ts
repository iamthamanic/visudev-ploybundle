import { getPreviewRunnerClientDeps } from "./preview-runner-deps";
import { getEffectiveRunnerUrl } from "./preview-runner-mode";
import { parseRunnerError, parseRunnerJsonText } from "./preview-runner-parser";
import { runnerHeaders } from "./preview-runner-session";
import { requestRunnerWithDiscovery } from "./preview-runner-transport";

interface RunnerJsonRequestOptions {
  projectId: string;
  path: string;
  context: string;
  method?: "GET" | "POST";
  body?: string;
  withJsonBody?: boolean;
}

export type RunnerJsonResult =
  | { ok: true; payload: unknown }
  | { ok: false; error: string; status?: number };

export function isRunnerSessionGoneStatus(status?: number): boolean {
  return status === 401 || status === 403 || status === 404;
}

export async function requestRunnerJson(
  options: RunnerJsonRequestOptions,
): Promise<RunnerJsonResult> {
  const deps = getPreviewRunnerClientDeps();
  const base = getEffectiveRunnerUrl().replace(/\/$/, "");
  const doFetch = async (urlBase: string): Promise<{ res: Response; text: string }> => {
    const requestInit: RequestInit = {
      method: options.method ?? "GET",
      headers: runnerHeaders(
        options.projectId,
        options.withJsonBody ?? typeof options.body === "string",
      ),
    };
    if (typeof options.body === "string") {
      requestInit.body = options.body;
    }
    const res = await deps.fetch(`${urlBase}${options.path}`, requestInit);
    return { res, text: await res.text() };
  };

  const request = await requestRunnerWithDiscovery(base, options.context, doFetch);
  if (!request.ok) {
    return { ok: false, error: request.error };
  }

  const payload = parseRunnerJsonText(request.text, `${options.context} response`);
  if (payload == null) {
    return { ok: false, status: request.res.status, error: "Runner response not JSON" };
  }
  if (!request.res.ok) {
    return {
      ok: false,
      status: request.res.status,
      error: parseRunnerError(payload, request.res.status),
    };
  }

  return { ok: true, payload };
}

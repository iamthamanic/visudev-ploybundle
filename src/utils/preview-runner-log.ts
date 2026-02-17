export function logPreviewRunnerClientError(context: string, error?: unknown): void {
  const message =
    error instanceof Error ? error.message : error != null ? String(error) : "unknown error";
  console.warn(`[preview-runner-client] ${context}: ${message}`);
}

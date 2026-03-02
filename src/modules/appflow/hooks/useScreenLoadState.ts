/**
 * useScreenLoadState – Hook für Lade-Status und Logs der Screen-Iframes.
 * Setzt Timeouts, initiale Logs und stellt markScreenLoaded/markScreenFailed bereit.
 * Location: src/modules/appflow/hooks/useScreenLoadState.ts
 */

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { Screen } from "../../../lib/visudev/types";
import { getScreenPreviewPath, normalizePreviewUrl } from "../layout";

const SCREEN_LOAD_TIMEOUT_MS = 60_000;

const EMBEDDING_HINT =
  "Tipp: Wenn alle Screens mit Timeout fehlschlagen, blockiert die Preview-App vermutlich Iframe-Einbetten. " +
  "In der Preview-App (z. B. Vite/Express) X-Frame-Options entfernen oder CSP setzen: frame-ancestors 'self' http://localhost:5173 http://localhost:3000; " +
  "oder in vite.config.ts: server: { headers: { 'Content-Security-Policy': \"frame-ancestors 'self' *\" } }. " +
  "Alternativ hängen externe Ressourcen (Fonts/APIs/CDNs): in dem Fall Netzwerk/DNS prüfen.";

/** Error -102 (Chromium) = ERR_CONNECTION_REFUSED – nichts hört auf die angegebene URL. */
export const SCREEN_FAIL_REASONS = {
  TIMEOUT: `Timeout (60 s). onLoad wurde nicht ausgelöst. ${EMBEDDING_HINT}`,
  LOAD_ERROR:
    "Ladefehler (z. B. -102 = Verbindung verweigert). Nichts läuft unter der Basis-URL. Lokal: „Preview starten“ (Runner + npx visudev-runner). Deployed-URL: App muss unter dieser URL laufen.",
  NO_URL: "Keine URL: Basis-URL oder Screen-Pfad fehlt.",
} as const;

export type LoadLogEntry = {
  id: string;
  time: string;
  message: string;
  type?: "info" | "success" | "error";
};

type ScreenLoadStatus = "loading" | "loaded" | "failed";

type LoadBootstrap = {
  hasBaseUrl: boolean;
  initialState: Record<string, ScreenLoadStatus>;
  initialReasons: Record<string, string>;
  logEntries: LoadLogEntry[];
  screensWithUrl: Array<{ screen: Screen; src: string }>;
};

function buildLoadBootstrap(
  screens: Screen[],
  previewUrl: string,
  previewError: string | null | undefined,
): LoadBootstrap {
  const initialState: Record<string, ScreenLoadStatus> = {};
  const initialReasons: Record<string, string> = {};
  const now = new Date().toLocaleTimeString("de-DE");
  const logEntries: LoadLogEntry[] = [];
  const screensWithUrl: Array<{ screen: Screen; src: string }> = [];

  if (previewError && previewError.trim()) {
    logEntries.push({
      id: "preview-error",
      time: now,
      message: `Preview/Build fehlgeschlagen (exakte Fehlermeldung):\n${previewError.trim()}`,
      type: "error",
    });
  }

  const hasBaseUrl =
    (previewUrl || "").trim().startsWith("http://") ||
    (previewUrl || "").trim().startsWith("https://");

  if (!hasBaseUrl) {
    screens.forEach((s) => {
      initialState[s.id] = "failed";
      initialReasons[s.id] = SCREEN_FAIL_REASONS.NO_URL;
    });
    logEntries.push({
      id: "no-base-url",
      time: now,
      message:
        "Basis-URL fehlt. Bitte „Preview starten“ (oder Seite neu laden) oder im Projekt eine Deployed-URL setzen.",
      type: "info",
    });
    return { hasBaseUrl, initialState, initialReasons, logEntries, screensWithUrl };
  }

  screens.forEach((s) => {
    const src = normalizePreviewUrl(previewUrl, getScreenPreviewPath(s));
    if (src) {
      screensWithUrl.push({ screen: s, src });
      initialState[s.id] = "loading";
    } else {
      initialState[s.id] = "failed";
      initialReasons[s.id] = SCREEN_FAIL_REASONS.NO_URL;
    }
  });

  logEntries.push({
    id: "step-start",
    time: now,
    message: `Schritt 1: Starte Ladevorgang für ${screensWithUrl.length} Screen(s). Basis-URL: ${previewUrl}. Timeout pro Screen: ${SCREEN_LOAD_TIMEOUT_MS / 1000} s.`,
    type: "info",
  });

  screens.forEach((s) => {
    const path = getScreenPreviewPath(s);
    const src = normalizePreviewUrl(previewUrl, path);
    if (!src) {
      logEntries.push({
        id: `${s.id}-no-url`,
        time: new Date().toLocaleTimeString("de-DE"),
        message: `✗ ${s.name} (${path}): Keine URL – Basis-URL oder Screen-Pfad fehlt. Basis-URL war: ${previewUrl || "(leer)"}`,
        type: "error",
      });
      return;
    }

    logEntries.push({
      id: `${s.id}-start`,
      time: new Date().toLocaleTimeString("de-DE"),
      message: `Schritt 2: Iframe für "${s.name}" (Pfad: ${path}) eingebunden. URL: ${src}. Warte auf onLoad oder Timeout.`,
      type: "info",
    });
  });

  return { hasBaseUrl, initialState, initialReasons, logEntries, screensWithUrl };
}

function buildLoadContextKey(
  screens: Screen[],
  previewUrl: string,
  previewError: string | null | undefined,
): string {
  const screenKey = screens.map((s) => `${s.id}:${s.name}:${s.path ?? ""}`).join("|");
  return `${(previewUrl || "").trim()}__${(previewError || "").trim()}__${screenKey}`;
}

export function useScreenLoadState(
  screens: Screen[],
  previewUrl: string,
  previewError: string | null | undefined,
): {
  screenLoadState: Record<string, ScreenLoadStatus>;
  screenFailReason: Record<string, string>;
  loadLogs: LoadLogEntry[];
  setLoadLogs: React.Dispatch<React.SetStateAction<LoadLogEntry[]>>;
  markScreenLoaded: (
    screenId: string,
    screenName?: string,
    source?: "onLoad" | "dom-report" | "timeout-fallback",
  ) => void;
  markScreenFailed: (screenId: string, reason: string, screenName?: string, url?: string) => void;
} {
  const contextKey = useMemo(
    () => buildLoadContextKey(screens, previewUrl, previewError),
    [screens, previewUrl, previewError],
  );
  const bootstrapCacheRef = useRef<{ key: string; value: LoadBootstrap } | null>(null);
  if (!bootstrapCacheRef.current || bootstrapCacheRef.current.key !== contextKey) {
    bootstrapCacheRef.current = {
      key: contextKey,
      value: buildLoadBootstrap(screens, previewUrl, previewError),
    };
  }
  const bootstrap = bootstrapCacheRef.current.value;

  const [screenLoadState, setScreenLoadState] = useState<Record<string, ScreenLoadStatus>>(
    bootstrap.initialState,
  );
  const [screenFailReason, setScreenFailReason] = useState<Record<string, string>>(
    bootstrap.initialReasons,
  );
  const [loadLogs, setLoadLogs] = useState<LoadLogEntry[]>(bootstrap.logEntries);
  const loadTimeoutsRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const screenLoadStateRef = useRef<Record<string, ScreenLoadStatus>>(bootstrap.initialState);
  const screenFailReasonRef = useRef<Record<string, string>>(bootstrap.initialReasons);
  const contextKeyRef = useRef(contextKey);

  const markScreenLoaded = useCallback(
    (
      screenId: string,
      screenName?: string,
      source: "onLoad" | "dom-report" | "timeout-fallback" = "onLoad",
    ) => {
      const t = loadTimeoutsRef.current.get(screenId);
      if (t) {
        clearTimeout(t);
        loadTimeoutsRef.current.delete(screenId);
      }
      const currentStatus = screenLoadStateRef.current[screenId];
      if (currentStatus === "loaded" || currentStatus === "failed") return;
      const name = screenName ?? screenId;
      setLoadLogs((prev) => [
        ...prev,
        {
          id: `${screenId}-loaded-${Date.now()}`,
          time: new Date().toLocaleTimeString("de-DE"),
          message:
            source === "dom-report"
              ? `✓ ${name}: DOM-Report aus dem Iframe empfangen (Dokument aktiv).`
              : source === "timeout-fallback"
                ? `✓ ${name}: Nach Timeout als geladen markiert (Seite könnte noch Ressourcen laden).`
                : `✓ ${name}: onLoad ausgelöst (Dokument geladen). Leere Karte? „In neuem Tab öffnen“ auf der Karte testen – wenn dort Inhalt sichtbar ist, blockiert die App die Einbettung (CSP/X-Frame-Options). Sonst: App liefert leere Seite (z. B. Auth, fehlende Env).`,
          type: "success" as const,
        },
      ]);
      setScreenLoadState((prev) => {
        if (prev[screenId] === "failed") return prev;
        const next = { ...prev, [screenId]: "loaded" as const };
        screenLoadStateRef.current = next;
        return next;
      });
      setScreenFailReason((prev) => {
        if (!(screenId in prev)) return prev;
        const next = { ...prev };
        delete next[screenId];
        screenFailReasonRef.current = next;
        return next;
      });
    },
    [],
  );

  const markScreenFailed = useCallback(
    (screenId: string, reason: string, screenName?: string, url?: string) => {
      const t = loadTimeoutsRef.current.get(screenId);
      if (t) {
        clearTimeout(t);
        loadTimeoutsRef.current.delete(screenId);
      }
      const name = screenName ?? screenId;
      const detail = url ? ` URL: ${url}` : "";
      setLoadLogs((prev) => [
        ...prev,
        {
          id: `${screenId}-failed-${Date.now()}`,
          time: new Date().toLocaleTimeString("de-DE"),
          message: `✗ ${name} fehlgeschlagen: ${reason}${detail}`,
          type: "error" as const,
        },
      ]);
      setScreenLoadState((prev) => {
        if (prev[screenId] === "failed" && screenFailReasonRef.current[screenId] === reason) {
          return prev;
        }
        const next = { ...prev, [screenId]: "failed" as const };
        screenLoadStateRef.current = next;
        return next;
      });
      setScreenFailReason((prev) => {
        if (prev[screenId] === reason) return prev;
        const next = { ...prev, [screenId]: reason };
        screenFailReasonRef.current = next;
        return next;
      });
    },
    [],
  );

  useEffect(() => {
    const keepTerminalStates = contextKeyRef.current === contextKey;
    contextKeyRef.current = contextKey;

    loadTimeoutsRef.current.forEach((t) => clearTimeout(t));
    loadTimeoutsRef.current.clear();
    const nextState: Record<string, ScreenLoadStatus> = { ...bootstrap.initialState };
    const nextReasons: Record<string, string> = { ...bootstrap.initialReasons };

    if (keepTerminalStates) {
      Object.keys(nextState).forEach((screenId) => {
        const previousStatus = screenLoadStateRef.current[screenId];
        if (previousStatus === "loaded") {
          nextState[screenId] = "loaded";
          delete nextReasons[screenId];
          return;
        }
        if (previousStatus === "failed") {
          nextState[screenId] = "failed";
          if (screenFailReasonRef.current[screenId]) {
            nextReasons[screenId] = screenFailReasonRef.current[screenId];
          }
        }
      });
    }

    screenLoadStateRef.current = nextState;
    screenFailReasonRef.current = nextReasons;
    setScreenLoadState(nextState);
    setScreenFailReason(nextReasons);
    setLoadLogs((prev) => {
      if (!keepTerminalStates || prev.length === 0) return bootstrap.logEntries;
      const hasBootstrapLog = prev.some(
        (entry) =>
          entry.id === "step-start" || entry.id === "no-base-url" || entry.id === "preview-error",
      );
      if (hasBootstrapLog) return prev;
      return [...bootstrap.logEntries, ...prev];
    });

    if (!bootstrap.hasBaseUrl) return;

    bootstrap.screensWithUrl.forEach(({ screen }) => {
      if (nextState[screen.id] !== "loading") return;
      const t = setTimeout(() => {
        loadTimeoutsRef.current.delete(screen.id);
        markScreenLoaded(screen.id, screen.name, "timeout-fallback");
      }, SCREEN_LOAD_TIMEOUT_MS);
      loadTimeoutsRef.current.set(screen.id, t);
    });

    const timeouts = loadTimeoutsRef.current;
    return () => {
      timeouts.forEach((t) => clearTimeout(t));
      timeouts.clear();
    };
  }, [contextKey, bootstrap, markScreenLoaded]);

  return {
    screenLoadState,
    screenFailReason,
    loadLogs,
    setLoadLogs,
    markScreenLoaded,
    markScreenFailed,
  };
}

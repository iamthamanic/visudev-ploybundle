import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Download, Loader2, RefreshCw } from "lucide-react";
import { useVisudev } from "../../../lib/visudev/store";
import { blueprintAPI } from "../../../utils/api";
import type { BlueprintData, BlueprintCycle, RuleViolation } from "../types";
import styles from "../styles/BlueprintPage.module.css";

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

interface BlueprintPageProps {
  projectId: string;
}

export function BlueprintPage({ projectId }: BlueprintPageProps) {
  const { activeProject, scanStatuses, startScan } = useVisudev();
  const [isRescan, setIsRescan] = useState(false);
  const [blueprint, setBlueprint] = useState<BlueprintData | null>(null);
  const [blueprintLoadError, setBlueprintLoadError] = useState<string | null>(null);

  const loadBlueprint = useCallback(async () => {
    if (!projectId) return;
    setBlueprintLoadError(null);
    const res = await blueprintAPI.get(projectId);
    if (res.success && res.data) {
      setBlueprint(res.data as BlueprintData);
    } else {
      setBlueprint(null);
      if (!res.success)
        setBlueprintLoadError(res.error ?? "Blueprint konnte nicht geladen werden.");
    }
  }, [projectId]);

  const handleRescan = useCallback(async () => {
    setIsRescan(true);
    try {
      await startScan("blueprint");
    } finally {
      setIsRescan(false);
    }
  }, [startScan]);

  useEffect(() => {
    if (activeProject && scanStatuses.blueprint.status === "idle") {
      handleRescan();
    }
  }, [activeProject, projectId, scanStatuses.blueprint.status, handleRescan]);

  useEffect(() => {
    if (projectId && scanStatuses.blueprint.status !== "running" && !isRescan) {
      loadBlueprint();
    }
  }, [projectId, scanStatuses.blueprint.status, isRescan, loadBlueprint]);

  const isScanning = scanStatuses.blueprint.status === "running" || isRescan;
  const hasError = scanStatuses.blueprint.status === "failed";
  const violations: RuleViolation[] = Array.isArray(blueprint?.violations)
    ? blueprint.violations
    : [];
  const cycles = useMemo<BlueprintCycle[]>(
    () => (Array.isArray(blueprint?.cycles) ? blueprint.cycles : []),
    [blueprint?.cycles],
  );

  function severityClass(severity: RuleViolation["severity"]) {
    if (severity === "error") return styles.severityError;
    if (severity === "warn") return styles.severityWarn;
    return styles.severityInfo;
  }

  const handleExportJson = useCallback(() => {
    const data = blueprint ?? {};
    downloadFile(JSON.stringify(data, null, 2), `blueprint-${projectId}.json`, "application/json");
  }, [blueprint, projectId]);

  const handleExportMermaid = useCallback(() => {
    const lines: string[] = ["flowchart LR"];
    const id = (s: string) => s.replace(/\s+/g, "_").replace(/-/g, "_") || "node";
    cycles.forEach((c) => {
      if (c.nodes.length < 2) return;
      c.nodes.forEach((node, i) => {
        const next = c.nodes[(i + 1) % c.nodes.length];
        lines.push(`  ${id(node)} --> ${id(next)}`);
      });
    });
    if (lines.length === 1) lines.push("  empty[Keine Zyklen]");
    downloadFile(lines.join("\n"), `blueprint-${projectId}.md`, "text/markdown");
  }, [cycles, projectId]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerRow}>
          <div>
            <h1 className={styles.title}>Blueprint</h1>
            <p className={styles.subtitle}>Architektur-Übersicht • {activeProject?.name}</p>
          </div>
          <div className={styles.headerActions}>
            <button
              type="button"
              onClick={handleExportJson}
              className={styles.secondaryButton}
              aria-label="Blueprint als JSON exportieren"
            >
              <Download className={styles.inlineIcon} aria-hidden="true" />
              Export JSON
            </button>
            <button
              type="button"
              onClick={handleExportMermaid}
              className={styles.secondaryButton}
              aria-label="Blueprint als Mermaid exportieren"
            >
              <Download className={styles.inlineIcon} aria-hidden="true" />
              Export Mermaid
            </button>
            <button
              type="button"
              onClick={handleRescan}
              disabled={isScanning}
              className={styles.primaryButton}
            >
              {isScanning ? (
                <>
                  <Loader2
                    className={`${styles.inlineIcon} ${styles.spinner}`}
                    aria-hidden="true"
                  />
                  Analysiere...
                </>
              ) : (
                <>
                  <RefreshCw className={styles.inlineIcon} aria-hidden="true" />
                  Neu analysieren
                </>
              )}
            </button>
          </div>
        </div>

        {isScanning && (
          <div className={`${styles.statusBar} ${styles.statusInfo}`} role="status">
            <Loader2 className={`${styles.inlineIcon} ${styles.spinner}`} aria-hidden="true" />
            <div>
              <p className={styles.statusTitle}>Blueprint wird analysiert...</p>
              <p className={styles.statusMeta}>
                Repo: {activeProject?.github_repo ?? "—"} @ {activeProject?.github_branch ?? "main"}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className={styles.content}>
        {isScanning ? (
          <div className={styles.centerState}>
            <div className={styles.emptyCard}>
              <Loader2 className={`${styles.emptyIcon} ${styles.spinner}`} aria-hidden="true" />
              <p className={styles.emptyTitle}>Blueprint wird generiert...</p>
            </div>
          </div>
        ) : hasError ? (
          <div className={styles.centerState}>
            <div className={styles.emptyCard}>
              <AlertCircle
                className={`${styles.emptyIcon} ${styles.errorIcon}`}
                aria-hidden="true"
              />
              <p className={styles.emptyTitle}>Fehler bei der Blueprint-Generierung</p>
            </div>
          </div>
        ) : (
          <div className={styles.centerState}>
            <div className={styles.emptyCard}>
              <p className={styles.emptyHint}>
                Blueprint Feature wird in einer späteren Version verfügbar sein
              </p>
            </div>
          </div>
        )}

        {!isScanning && (
          <section className={styles.rulesPanel} aria-labelledby="rules-title">
            <h2 id="rules-title" className={styles.rulesPanelTitle}>
              Rules
            </h2>
            {blueprintLoadError ? (
              <p className={styles.rulesEmpty} role="alert">
                {blueprintLoadError}
              </p>
            ) : violations.length === 0 ? (
              <p className={styles.rulesEmpty}>Keine Violations</p>
            ) : (
              <table className={styles.rulesTable}>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Severity</th>
                    <th>Source</th>
                    <th>Target</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {violations.map((v, i) => (
                    <tr key={`${v.ruleId}-${v.source}-${i}`}>
                      <td>
                        <code>{v.ruleId}</code>
                      </td>
                      <td className={severityClass(v.severity)}>{v.severity}</td>
                      <td>
                        <code>{v.source}</code>
                      </td>
                      <td>
                        <code>{v.target ?? "—"}</code>
                      </td>
                      <td>{v.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )}

        {!isScanning && (
          <section className={styles.cyclesPanel} aria-labelledby="cycles-title">
            <h2 id="cycles-title" className={styles.cyclesPanelTitle}>
              <span className={styles.cycleBadge}>Zyklus</span>
              Zyklen
            </h2>
            {cycles.length === 0 ? (
              <p className={styles.cyclesEmpty}>Keine zyklischen Abhängigkeiten erkannt.</p>
            ) : (
              <ul className={styles.cycleList}>
                {cycles.map((c, i) => (
                  <li key={i} className={styles.cycleItem}>
                    {c.message && <div>{c.message}</div>}
                    <div className={styles.cycleNodes}>{c.nodes.join(" → ")}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </div>
  );
}

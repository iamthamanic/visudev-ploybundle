import clsx from "clsx";
import type { AnalysisEscalationJob } from "../../../lib/visudev/escalation-jobs";
import styles from "../styles/LiveFlowCanvas.module.css";

interface EscalationPanelProps {
  jobs: AnalysisEscalationJob[];
  onSelect: (job: AnalysisEscalationJob) => void;
}

export function EscalationPanel({
  jobs,
  onSelect,
}: EscalationPanelProps): React.ReactElement | null {
  if (jobs.length === 0) return null;

  return (
    <div className={styles.escalationPanel}>
      <div className={styles.escalationHeader}>
        <span className={styles.escalationTitle}>Offene Konflikte</span>
        <span className={styles.escalationMeta}>
          {jobs.length} Job{jobs.length === 1 ? "" : "s"}
        </span>
      </div>
      <div className={styles.escalationList}>
        {jobs.map((job) => (
          <button
            key={job.id}
            type="button"
            className={styles.escalationItem}
            onClick={() => onSelect(job)}
            title={job.description}
          >
            <span
              className={clsx(
                styles.escalationSeverity,
                job.severity === "high" && styles.escalationSeverityHigh,
              )}
            >
              {job.severity === "high" ? "High" : "Warn"}
            </span>
            <span className={styles.escalationBody}>
              <span className={styles.escalationItemTitle}>{job.title}</span>
              <span className={styles.escalationItemText}>{job.description}</span>
              <span className={styles.escalationItemMeta}>
                {job.source === "runtime"
                  ? "Runtime"
                  : job.source === "hybrid"
                    ? "Runtime + Graph"
                    : "Statisch"}
                {" · "}
                {job.suggestedAction === "llm-review"
                  ? "LLM-Kandidat"
                  : job.suggestedAction === "add-markup"
                    ? "Markup-Hinweis"
                    : "Runtime prüfen"}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

import { Copy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../../components/ui/dialog";
import type { PreviewRunnerRuntimeStatus } from "../../../utils/preview-runner-local";
import { formatUptime, RUNNER_COMMANDS } from "./runner-status-config";
import styles from "../styles/RunnerStatusControl.module.css";

interface RunnerStatusDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  status: PreviewRunnerRuntimeStatus;
  copiedCommandId: string | null;
  onCopyCommand: (commandId: string, command: string) => void;
}

export function RunnerStatusDialog({
  open,
  onOpenChange,
  status,
  copiedCommandId,
  onCopyCommand,
}: RunnerStatusDialogProps) {
  const projectsText = status.projects.length > 0 ? status.projects.join(", ") : "-";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={styles.dialogContent} data-visudev-modal="runner-status">
        <DialogHeader>
          <DialogTitle>VisuDEV Runner</DialogTitle>
        </DialogHeader>

        <div className={styles.statusGrid}>
          <div className={styles.statusCard}>
            <span className={styles.statusLabel}>Status</span>
            <span className={styles.statusValue}>
              {status.state === "active" ? "Active" : "Inactive"}
            </span>
          </div>
          <div className={styles.statusCard}>
            <span className={styles.statusLabel}>Runner URL</span>
            <span className={styles.statusValueMono}>{status.baseUrl ?? "-"}</span>
          </div>
          <div className={styles.statusCard}>
            <span className={styles.statusLabel}>Uptime</span>
            <span className={styles.statusValue}>{formatUptime(status.uptimeSec)}</span>
          </div>
          <div className={styles.statusCard}>
            <span className={styles.statusLabel}>Aktive Runs</span>
            <span className={styles.statusValue}>{status.activeRuns}</span>
          </div>
          <div className={styles.statusCardWide}>
            <span className={styles.statusLabel}>Aktive Projekte</span>
            <span className={styles.statusValueMono}>{projectsText}</span>
          </div>
        </div>

        <div className={styles.commandsSection}>
          <h3 className={styles.sectionTitle}>Terminal Befehle</h3>
          <div className={styles.commandsList}>
            {RUNNER_COMMANDS.map((entry) => (
              <div key={entry.id} className={styles.commandRow}>
                <div className={styles.commandText}>
                  <code className={styles.commandCode}>{entry.command}</code>
                  <span className={styles.commandDescription}>{entry.description}</span>
                </div>
                <button
                  type="button"
                  className={styles.copyButton}
                  onClick={() => onCopyCommand(entry.id, entry.command)}
                  aria-label={`Befehl kopieren: ${entry.command}`}
                >
                  <Copy className={styles.copyIcon} aria-hidden="true" />
                  {copiedCommandId === entry.id ? "Kopiert" : "Copy"}
                </button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

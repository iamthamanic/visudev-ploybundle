import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, Loader2 } from "lucide-react";
import { getPreviewRunnerRuntimeStatus, type PreviewRunnerRuntimeStatus } from "../../../utils/api";
import { INITIAL_RUNNER_STATUS, RUNNER_POLL_MS } from "./runner-status-config";
import { RunnerStatusDialog } from "./RunnerStatusDialog";
import styles from "../styles/RunnerStatusControl.module.css";

export function RunnerStatusControl() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [status, setStatus] = useState<PreviewRunnerRuntimeStatus>(INITIAL_RUNNER_STATUS);
  const [copiedCommandId, setCopiedCommandId] = useState<string | null>(null);
  const copiedResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const refreshStatus = async () => {
      const next = await getPreviewRunnerRuntimeStatus();
      if (cancelled) return;
      setStatus(next);
      setIsChecking(false);
    };

    void refreshStatus();
    const intervalId = setInterval(() => {
      void refreshStatus();
    }, RUNNER_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, []);

  useEffect(
    () => () => {
      if (copiedResetTimerRef.current) clearTimeout(copiedResetTimerRef.current);
    },
    [],
  );

  const badgeClass = isChecking
    ? styles.statusTriggerChecking
    : status.state === "active"
      ? styles.statusTriggerActive
      : styles.statusTriggerInactive;
  const dotClass = isChecking
    ? styles.statusDotChecking
    : status.state === "active"
      ? styles.statusDotActive
      : styles.statusDotInactive;
  const statusText = isChecking
    ? "VisuDEV Runner checking"
    : status.state === "active"
      ? "VisuDEV Runner active"
      : "VisuDEV Runner inactive";

  const copyCommand = async (commandId: string, command: string) => {
    try {
      await navigator.clipboard.writeText(command);
      setCopiedCommandId(commandId);
      if (copiedResetTimerRef.current) clearTimeout(copiedResetTimerRef.current);
      copiedResetTimerRef.current = setTimeout(() => {
        setCopiedCommandId(null);
        copiedResetTimerRef.current = null;
      }, 1800);
    } catch (error) {
      console.error("RunnerStatusControl: copy command failed", error);
      setCopiedCommandId(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setDialogOpen(true)}
        className={`${styles.statusTrigger} ${badgeClass}`}
        aria-label="Runner Status und Befehle anzeigen"
      >
        <span className={styles.statusLeft}>
          {isChecking ? (
            <Loader2 className={styles.statusIconSpinner} aria-hidden="true" />
          ) : status.state === "active" ? (
            <CheckCircle2 className={styles.statusIcon} aria-hidden="true" />
          ) : (
            <AlertCircle className={styles.statusIcon} aria-hidden="true" />
          )}
          <span className={styles.statusText}>
            <span className={`${styles.statusDot} ${dotClass}`} aria-hidden="true" />
            {statusText}
          </span>
        </span>
        <ChevronDown className={styles.chevronIcon} aria-hidden="true" />
      </button>

      <RunnerStatusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        status={status}
        copiedCommandId={copiedCommandId}
        onCopyCommand={copyCommand}
      />
    </>
  );
}

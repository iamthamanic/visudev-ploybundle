import { Loader2 } from "lucide-react";
import { useAuth } from "../../../contexts/useAuth";
import { LlmDefaultsCard } from "./LlmDefaultsCard";
import { LlmProviderCard } from "./LlmProviderCard";
import { useLlmIntegrations } from "../hooks/useLlmIntegrations";
import styles from "../styles/LlmIntegrationsPanel.module.css";

export function LlmIntegrationsPanel() {
  const { user } = useAuth();
  const {
    providers,
    settings,
    availableDefaultModels,
    loading,
    error,
    testProvider,
    saveProviderKey,
    saveProviderSelection,
    deleteProviderKey,
    saveSettings,
  } = useLlmIntegrations();

  if (!user) {
    return (
      <div className={styles.notice}>
        Bitte zuerst anmelden, um API-Keys und LLM-Modelle für VisuDEV zu verwalten.
      </div>
    );
  }

  if (loading) {
    return (
      <div className={styles.notice}>
        <Loader2 className={styles.buttonIcon} aria-hidden="true" /> Lade Integrationen…
      </div>
    );
  }

  return (
    <div className={styles.stack}>
      {error ? <div className={styles.errorBox}>{error}</div> : null}

      <LlmDefaultsCard
        providers={providers}
        settings={settings}
        availableDefaultModels={availableDefaultModels}
        onSave={saveSettings}
      />

      <div className={styles.grid}>
        {providers.map((provider) => (
          <LlmProviderCard
            key={provider.providerId}
            provider={provider}
            onTest={testProvider}
            onSaveKey={saveProviderKey}
            onSaveSelection={saveProviderSelection}
            onDeleteKey={deleteProviderKey}
          />
        ))}
      </div>
    </div>
  );
}

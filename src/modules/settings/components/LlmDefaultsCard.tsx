import { useEffect, useState } from "react";
import { Loader2, Save } from "lucide-react";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type {
  LlmProviderId,
  LlmProviderModel,
  LlmProviderSettings,
  LlmProviderState,
} from "../../../lib/visudev/llm-providers";
import styles from "../styles/LlmIntegrationsPanel.module.css";

interface LlmDefaultsCardProps {
  providers: LlmProviderState[];
  settings: LlmProviderSettings;
  availableDefaultModels: LlmProviderModel[];
  onSave: (patch: Partial<LlmProviderSettings>) => Promise<LlmProviderSettings>;
}

export function LlmDefaultsCard({
  providers,
  settings,
  availableDefaultModels,
  onSave,
}: LlmDefaultsCardProps) {
  const [defaultProvider, setDefaultProvider] = useState<LlmProviderId | "">(
    settings.defaultProvider ?? "",
  );
  const [defaultModel, setDefaultModel] = useState(settings.defaultModel ?? "");
  const [allowLlmForEscalations, setAllowLlmForEscalations] = useState(
    settings.allowLlmForEscalations,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDefaultProvider(settings.defaultProvider ?? "");
    setDefaultModel(settings.defaultModel ?? "");
    setAllowLlmForEscalations(settings.allowLlmForEscalations);
  }, [settings]);

  useEffect(() => {
    if (!availableDefaultModels.some((model) => model.id === defaultModel)) {
      setDefaultModel(availableDefaultModels[0]?.id ?? "");
    }
  }, [availableDefaultModels, defaultModel]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        defaultProvider: defaultProvider || undefined,
        defaultModel: defaultModel || undefined,
        allowLlmForEscalations,
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Einstellungen konnten nicht gespeichert werden.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Standard für Analyse-Eskalationen</CardTitle>
        <CardDescription>
          Dieser Provider wird später vom EscalationRunner für offene LLM-fähige Konflikte
          verwendet.
        </CardDescription>
      </CardHeader>
      <CardContent className={styles.cardContent}>
        <div className={styles.settingsCardContent}>
          <div className={styles.fieldStack}>
            <label className={styles.fieldLabel} htmlFor="default-llm-provider">
              Standard-Provider
            </label>
            <Select
              value={defaultProvider}
              onValueChange={(value) => setDefaultProvider(value as LlmProviderId)}
            >
              <SelectTrigger id="default-llm-provider">
                <SelectValue placeholder="Provider auswählen" />
              </SelectTrigger>
              <SelectContent>
                {providers
                  .filter((provider) => provider.hasKey)
                  .map((provider) => (
                    <SelectItem key={provider.providerId} value={provider.providerId}>
                      {provider.displayName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <div className={styles.fieldStack}>
            <label className={styles.fieldLabel} htmlFor="default-llm-model">
              Standard-Modell
            </label>
            <Select
              value={defaultModel}
              onValueChange={setDefaultModel}
              disabled={availableDefaultModels.length === 0}
            >
              <SelectTrigger id="default-llm-model">
                <SelectValue placeholder="Modell auswählen" />
              </SelectTrigger>
              <SelectContent>
                {availableDefaultModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {model.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <label className={styles.checkboxRow}>
            <input
              className={styles.checkbox}
              type="checkbox"
              checked={allowLlmForEscalations}
              onChange={(event) => setAllowLlmForEscalations(event.target.checked)}
            />
            <span className={styles.fieldHint}>LLM-Unterstützung für Escalation-Jobs erlauben</span>
          </label>
        </div>

        {error ? <div className={styles.errorBox}>{error}</div> : null}

        <div className={styles.settingsFooter}>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className={styles.buttonIcon} aria-hidden="true" />
            ) : (
              <Save className={styles.buttonIcon} aria-hidden="true" />
            )}
            Defaults speichern
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

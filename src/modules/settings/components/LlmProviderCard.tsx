import { useEffect, useMemo, useState } from "react";
import { Bot, ExternalLink, Loader2, Save, TestTube2, Trash2 } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { LlmProviderState, LlmProviderTestResult } from "../../../lib/visudev/llm-providers";
import styles from "../styles/LlmIntegrationsPanel.module.css";

interface LlmProviderCardProps {
  provider: LlmProviderState;
  onTest: (
    providerId: LlmProviderState["providerId"],
    apiKey?: string,
  ) => Promise<LlmProviderTestResult>;
  onSaveKey: (
    providerId: LlmProviderState["providerId"],
    apiKey: string,
    selectedModel?: string,
  ) => Promise<LlmProviderState>;
  onSaveSelection: (
    providerId: LlmProviderState["providerId"],
    selectedModel: string,
  ) => Promise<LlmProviderState>;
  onDeleteKey: (providerId: LlmProviderState["providerId"]) => Promise<void>;
}

function formatTimestamp(value: string | undefined): string {
  if (!value) return "Noch nicht getestet";
  return new Date(value).toLocaleString("de-DE");
}

export function LlmProviderCard({
  provider,
  onTest,
  onSaveKey,
  onSaveSelection,
  onDeleteKey,
}: LlmProviderCardProps) {
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(provider.selectedModel ?? "");
  const [availableModels, setAvailableModels] = useState(provider.models);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [savingKey, setSavingKey] = useState(false);
  const [savingSelection, setSavingSelection] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    setAvailableModels(provider.models);
    setSelectedModel(provider.selectedModel ?? "");
  }, [provider.models, provider.selectedModel]);

  const canTest = apiKey.trim().length > 0 || provider.hasKey;
  const canSaveKey = apiKey.trim().length > 0;
  const canSaveSelection =
    provider.hasKey && selectedModel !== "" && selectedModel !== provider.selectedModel;

  const statusVariant = useMemo(() => {
    if (provider.status === "valid") return "default";
    if (provider.status === "invalid") return "destructive";
    return "outline";
  }, [provider.status]);

  const handleTest = async () => {
    if (!canTest) return;
    setTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const result = await onTest(provider.providerId, apiKey.trim() || undefined);
      setAvailableModels(result.models);
      if (!selectedModel && result.models[0]?.id) {
        setSelectedModel(result.models[0].id);
      }
      setSuccess(`API-Key gültig. ${result.models.length} Modelle gefunden.`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Provider-Test fehlgeschlagen.");
    } finally {
      setTesting(false);
    }
  };

  const handleSaveKey = async () => {
    if (!canSaveKey) return;
    setSavingKey(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await onSaveKey(provider.providerId, apiKey.trim(), selectedModel || undefined);
      setApiKey("");
      setAvailableModels(saved.models);
      setSelectedModel(saved.selectedModel ?? selectedModel);
      setSuccess("Provider gespeichert.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Speichern fehlgeschlagen.");
    } finally {
      setSavingKey(false);
    }
  };

  const handleSaveSelection = async () => {
    if (!canSaveSelection) return;
    setSavingSelection(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await onSaveSelection(provider.providerId, selectedModel);
      setSelectedModel(saved.selectedModel ?? "");
      setSuccess("Modell gespeichert.");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "Modell konnte nicht gespeichert werden.",
      );
    } finally {
      setSavingSelection(false);
    }
  };

  const handleDelete = async () => {
    if (!provider.hasKey || deleting) return;
    const shouldDelete = window.confirm(`${provider.displayName} wirklich entfernen?`);
    if (!shouldDelete) return;
    setDeleting(true);
    setError(null);
    setSuccess(null);
    try {
      await onDeleteKey(provider.providerId);
      setApiKey("");
      setAvailableModels([]);
      setSelectedModel("");
      setSuccess("Provider entfernt.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className={styles.providerHeader}>
          <div className={styles.providerName}>
            <Bot className={styles.buttonIcon} aria-hidden="true" />
            <div>
              <CardTitle>{provider.displayName}</CardTitle>
              <CardDescription>{provider.adapter}</CardDescription>
            </div>
          </div>
          <Badge variant={statusVariant}>{provider.hasKey ? provider.status : "missing"}</Badge>
        </div>
      </CardHeader>
      <CardContent className={styles.cardContent}>
        <div className={styles.providerMeta}>
          <span>
            {provider.hasKey
              ? `Gespeichert: ${provider.maskedKey ?? "vorhanden"}`
              : "Kein API-Key gespeichert"}
          </span>
          <span>Zuletzt getestet: {formatTimestamp(provider.lastTestedAt)}</span>
        </div>

        {provider.docsUrl ? (
          <a className={styles.linkButton} href={provider.docsUrl} target="_blank" rel="noreferrer">
            API-Key öffnen
            <ExternalLink className={styles.buttonIcon} aria-hidden="true" />
          </a>
        ) : null}

        <div className={styles.fieldStack}>
          <label className={styles.fieldLabel} htmlFor={`llm-key-${provider.providerId}`}>
            API-Key
          </label>
          <Input
            id={`llm-key-${provider.providerId}`}
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={provider.maskedKey ?? "Key eingeben"}
          />
          <span className={styles.fieldHint}>
            Gespeicherte Keys bleiben serverseitig und werden nicht an den Browser zurückgegeben.
          </span>
        </div>

        {(availableModels.length > 0 || provider.models.length > 0) && (
          <div className={styles.fieldStack}>
            <label className={styles.fieldLabel} htmlFor={`llm-model-${provider.providerId}`}>
              Modell
            </label>
            <div className={styles.selectWrap}>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger id={`llm-model-${provider.providerId}`}>
                  <SelectValue placeholder="Modell auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {availableModels.map((model) => (
                    <SelectItem key={model.id} value={model.id}>
                      {model.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {availableModels.length === 0 && provider.hasKey ? (
          <p className={styles.emptyModels}>
            Noch keine Modelle geladen. Teste den gespeicherten Key, um die Modellliste zu
            aktualisieren.
          </p>
        ) : null}

        {error ? <div className={styles.errorBox}>{error}</div> : null}
        {success ? <div className={styles.successBox}>{success}</div> : null}

        <div className={styles.actions}>
          <Button
            type="button"
            variant="outline"
            onClick={handleTest}
            disabled={!canTest || testing}
          >
            {testing ? (
              <Loader2 className={styles.buttonIcon} aria-hidden="true" />
            ) : (
              <TestTube2 className={styles.buttonIcon} aria-hidden="true" />
            )}
            Testen
          </Button>
          <Button type="button" onClick={handleSaveKey} disabled={!canSaveKey || savingKey}>
            {savingKey ? (
              <Loader2 className={styles.buttonIcon} aria-hidden="true" />
            ) : (
              <Save className={styles.buttonIcon} aria-hidden="true" />
            )}
            Key speichern
          </Button>
        </div>

        <div className={styles.secondaryActions}>
          <Button
            type="button"
            variant="secondary"
            onClick={handleSaveSelection}
            disabled={!canSaveSelection || savingSelection}
          >
            {savingSelection ? (
              <Loader2 className={styles.buttonIcon} aria-hidden="true" />
            ) : (
              <Save className={styles.buttonIcon} aria-hidden="true" />
            )}
            Modell speichern
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={!provider.hasKey || deleting}
          >
            {deleting ? (
              <Loader2 className={styles.buttonIcon} aria-hidden="true" />
            ) : (
              <Trash2 className={styles.buttonIcon} aria-hidden="true" />
            )}
            Entfernen
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

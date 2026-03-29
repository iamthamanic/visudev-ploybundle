import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../../contexts/useAuth";
import {
  buildEmptyLlmProviderState,
  LLM_PROVIDER_CATALOG,
  type LlmProviderId,
  type LlmProviderSettings,
  type LlmProviderState,
  type LlmProviderTestResult,
} from "../../../lib/visudev/llm-providers";
import { api } from "../../../utils/api";

function mergeProviderStates(states: LlmProviderState[]): LlmProviderState[] {
  const stateById = new Map(states.map((state) => [state.providerId, state]));
  return LLM_PROVIDER_CATALOG.map(
    (entry) => stateById.get(entry.id) ?? buildEmptyLlmProviderState(entry),
  );
}

const DEFAULT_SETTINGS: LlmProviderSettings = {
  allowLlmForEscalations: true,
};

export function useLlmIntegrations() {
  const { session } = useAuth();
  const accessToken = session?.access_token ?? null;

  const [providers, setProviders] = useState<LlmProviderState[]>(() => mergeProviderStates([]));
  const [settings, setSettings] = useState<LlmProviderSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!accessToken) {
      setProviders(mergeProviderStates([]));
      setSettings(DEFAULT_SETTINGS);
      setLoading(false);
      return;
    }

    setLoading(true);

    const [providersResult, settingsResult] = await Promise.all([
      api.llmProviders.getProviders(accessToken),
      api.llmProviders.getSettings(accessToken),
    ]);

    if (providersResult.success && providersResult.data) {
      setProviders(mergeProviderStates(providersResult.data));
    } else {
      setProviders(mergeProviderStates([]));
    }

    if (settingsResult.success && settingsResult.data) {
      setSettings(settingsResult.data);
    } else {
      setSettings(DEFAULT_SETTINGS);
    }

    if (!providersResult.success || !settingsResult.success) {
      setError(
        providersResult.error ??
          settingsResult.error ??
          "LLM-Integrationen konnten nicht geladen werden.",
      );
    } else {
      setError(null);
    }

    setLoading(false);
  }, [accessToken]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const updateProvider = useCallback((provider: LlmProviderState) => {
    setProviders((current) =>
      current.map((entry) => (entry.providerId === provider.providerId ? provider : entry)),
    );
  }, []);

  const testProvider = useCallback(
    async (providerId: LlmProviderId, apiKey?: string): Promise<LlmProviderTestResult> => {
      if (!accessToken) {
        throw new Error("Bitte zuerst anmelden.");
      }

      const result = await api.llmProviders.testProvider(providerId, accessToken, apiKey);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? "Provider-Test fehlgeschlagen.");
      }
      return result.data;
    },
    [accessToken],
  );

  const saveProviderKey = useCallback(
    async (
      providerId: LlmProviderId,
      apiKey: string,
      selectedModel?: string,
    ): Promise<LlmProviderState> => {
      if (!accessToken) {
        throw new Error("Bitte zuerst anmelden.");
      }

      const result = await api.llmProviders.saveProviderKey(
        providerId,
        accessToken,
        apiKey,
        selectedModel,
      );
      if (!result.success || !result.data) {
        throw new Error(result.error ?? "Provider konnte nicht gespeichert werden.");
      }

      updateProvider(result.data);
      return result.data;
    },
    [accessToken, updateProvider],
  );

  const saveProviderSelection = useCallback(
    async (providerId: LlmProviderId, selectedModel: string): Promise<LlmProviderState> => {
      if (!accessToken) {
        throw new Error("Bitte zuerst anmelden.");
      }

      const result = await api.llmProviders.saveProviderSelection(
        providerId,
        accessToken,
        selectedModel,
      );
      if (!result.success || !result.data) {
        throw new Error(result.error ?? "Modell konnte nicht gespeichert werden.");
      }

      updateProvider(result.data);
      return result.data;
    },
    [accessToken, updateProvider],
  );

  const deleteProviderKey = useCallback(
    async (providerId: LlmProviderId): Promise<void> => {
      if (!accessToken) {
        throw new Error("Bitte zuerst anmelden.");
      }

      const result = await api.llmProviders.deleteProviderKey(providerId, accessToken);
      if (!result.success) {
        throw new Error(result.error ?? "Provider konnte nicht gelöscht werden.");
      }

      const catalogEntry = LLM_PROVIDER_CATALOG.find((entry) => entry.id === providerId);
      if (catalogEntry) {
        updateProvider(buildEmptyLlmProviderState(catalogEntry));
      }
    },
    [accessToken, updateProvider],
  );

  const saveSettings = useCallback(
    async (patch: Partial<LlmProviderSettings>): Promise<LlmProviderSettings> => {
      if (!accessToken) {
        throw new Error("Bitte zuerst anmelden.");
      }

      const result = await api.llmProviders.updateSettings(accessToken, patch);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? "Einstellungen konnten nicht gespeichert werden.");
      }

      setSettings(result.data);
      return result.data;
    },
    [accessToken],
  );

  const availableDefaultModels = useMemo(() => {
    if (!settings.defaultProvider) return [];
    return (
      providers.find((provider) => provider.providerId === settings.defaultProvider)?.models ?? []
    );
  }, [providers, settings.defaultProvider]);

  return {
    providers,
    settings,
    availableDefaultModels,
    loading,
    error,
    refresh,
    testProvider,
    saveProviderKey,
    saveProviderSelection,
    deleteProviderKey,
    saveSettings,
  };
}

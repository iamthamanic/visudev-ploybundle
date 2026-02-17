/**
 * VisuDEV API Client
 * Frontend integration for all Edge Functions
 */

import type { AccountPreferencesUpdateInput, AccountUpdateInput } from "../lib/visudev/account";
import type {
  IntegrationsState,
  IntegrationsUpdateInput,
  GitHubRepo,
} from "../lib/visudev/integrations";
import type { PreviewMode, PreviewRuntimeOptions, Project } from "../lib/visudev/types";
import type {
  AppFlowCreateInput,
  AppFlowRecord,
  AppFlowUpdateInput,
} from "../modules/appflow/types";
import type { BlueprintData, BlueprintUpdateInput } from "../modules/blueprint/types";
import type {
  DataSchema,
  DataSchemaUpdateInput,
  ERDData,
  ERDUpdateInput,
  MigrationEntry,
} from "../modules/data/types";
import type { LogCreateInput, LogEntry } from "../modules/logs/types";
import type { ProjectCreateInput, ProjectUpdateInput } from "../modules/projects/types";
import {
  discoverPreviewRunner,
  getPreviewRunnerRuntimeStatus,
  localPreviewRefresh,
  localPreviewStart,
  localPreviewStatus,
  localPreviewStop,
  localPreviewStopProject,
  localRunnerGuard,
  resolvePreviewMode,
} from "./preview-runner-local";
import type {
  PreviewRunnerRuntimeStatus,
  PreviewStatusResponse,
  PreviewStepLog,
} from "./preview-runner-local";
import { publicAnonKey, supabaseUrl } from "./supabase/info";

const BASE_URL = `${supabaseUrl}/functions/v1`;

export interface ApiRequestOptions extends RequestInit {
  /** When set, used as Bearer token instead of anon key (e.g. user session for integrations/auth). */
  accessToken?: string | null;
}

// Base fetch wrapper with auth
async function apiRequest<T>(
  endpoint: string,
  options: ApiRequestOptions = {},
): Promise<{ success: boolean; data?: T; error?: string }> {
  const { accessToken, ...fetchOptions } = options;
  const authHeader =
    accessToken != null && accessToken !== "" ? `Bearer ${accessToken}` : `Bearer ${publicAnonKey}`;

  try {
    const response = await fetch(`${BASE_URL}${endpoint}`, {
      ...fetchOptions,
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
        ...fetchOptions.headers,
      },
    });

    const text = await response.text();
    let result: { success?: boolean; error?: string; [key: string]: unknown };
    try {
      result = text ? (JSON.parse(text) as typeof result) : {};
    } catch {
      console.error(`API [${endpoint}]: response is not JSON (status ${response.status})`);
      const isPreview = endpoint.includes("preview");
      const is404 = response.status === 404;
      let errorMsg: string;
      if (response.ok === false) {
        if (is404 && isPreview) {
          errorMsg =
            "Edge Function 'visudev-preview' nicht gefunden (404). " +
            "Lokal: npm run dev ausführen (startet Runner + Vite; Preview nutzt automatisch localhost:4000). " +
            "Oder deployen: supabase functions deploy visudev-preview und PREVIEW_RUNNER_URL in Supabase → Edge Functions → Secrets setzen (Runner-API-URL, z.B. https://dein-runner.example.com; der Runner vergibt intern freie Ports pro Preview).";
        } else {
          errorMsg = `Server error ${response.status}. Check that Edge Functions are deployed and reachable.`;
        }
      } else {
        errorMsg =
          "Server returned invalid response (not JSON). Check network and Edge Function URL.";
      }
      return { success: false, error: errorMsg };
    }

    if (!response.ok) {
      console.error(`API Error [${endpoint}]:`, result.error || response.statusText);
      const isPreview = endpoint.includes("preview");
      const is404 = response.status === 404;
      const error =
        (result.error as string) ||
        (is404 && isPreview
          ? "Edge Function 'visudev-preview' nicht gefunden (404). Lokal: npm run dev ausführen (Runner + Vite). Oder deployen und PREVIEW_RUNNER_URL (Runner-API-URL) in Secrets setzen."
          : response.statusText);
      return { success: false, error };
    }

    return { ...result, success: result.success !== false };
  } catch (error) {
    console.error(`Network Error [${endpoint}]:`, error);
    return { success: false, error: String(error) };
  }
}

// ==================== PROJECTS ====================

export const projectsAPI = {
  // Get all projects
  getAll: () => apiRequest<Project[]>("/visudev-projects"),

  // Get single project
  get: (id: string) => apiRequest<Project>(`/visudev-projects/${id}`),

  // Create project
  create: (data: ProjectCreateInput) =>
    apiRequest<Project>("/visudev-projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Update project
  update: (id: string, data: ProjectUpdateInput) =>
    apiRequest(`/visudev-projects/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Delete project
  delete: (id: string) =>
    apiRequest(`/visudev-projects/${id}`, {
      method: "DELETE",
    }),
};

// ==================== APP FLOW ====================

export const appflowAPI = {
  // Get all flows for project
  getAll: (projectId: string) => apiRequest<AppFlowRecord[]>(`/visudev-appflow/${projectId}`),

  // Get single flow
  get: (projectId: string, flowId: string) =>
    apiRequest<AppFlowRecord>(`/visudev-appflow/${projectId}/${flowId}`),

  // Create flow
  create: (projectId: string, data: AppFlowCreateInput) =>
    apiRequest(`/visudev-appflow/${projectId}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Update flow
  update: (projectId: string, flowId: string, data: AppFlowUpdateInput) =>
    apiRequest(`/visudev-appflow/${projectId}/${flowId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Delete flow
  delete: (projectId: string, flowId: string) =>
    apiRequest(`/visudev-appflow/${projectId}/${flowId}`, {
      method: "DELETE",
    }),
};

// ==================== BLUEPRINT ====================

export const blueprintAPI = {
  // Get blueprint for project
  get: (projectId: string) => apiRequest<BlueprintData>(`/visudev-blueprint/${projectId}`),

  // Update blueprint
  update: (projectId: string, data: BlueprintUpdateInput) =>
    apiRequest(`/visudev-blueprint/${projectId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Delete blueprint
  delete: (projectId: string) =>
    apiRequest(`/visudev-blueprint/${projectId}`, {
      method: "DELETE",
    }),
};

// ==================== DATA ====================

export const dataAPI = {
  // Schema
  getSchema: (projectId: string) => apiRequest<DataSchema>(`/visudev-data/${projectId}/schema`),

  updateSchema: (projectId: string, data: DataSchemaUpdateInput) =>
    apiRequest(`/visudev-data/${projectId}/schema`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Migrations
  getMigrations: (projectId: string) =>
    apiRequest<MigrationEntry[]>(`/visudev-data/${projectId}/migrations`),

  updateMigrations: (projectId: string, data: MigrationEntry[]) =>
    apiRequest(`/visudev-data/${projectId}/migrations`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // ERD
  getERD: (projectId: string) => apiRequest<ERDData>(`/visudev-data/${projectId}/erd`),

  updateERD: (projectId: string, data: ERDUpdateInput) =>
    apiRequest(`/visudev-data/${projectId}/erd`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// ==================== LOGS ====================

export const logsAPI = {
  // Get all logs for project
  getAll: (projectId: string) => apiRequest<LogEntry[]>(`/visudev-logs/${projectId}`),

  // Get single log
  get: (projectId: string, logId: string) =>
    apiRequest<LogEntry>(`/visudev-logs/${projectId}/${logId}`),

  // Create log entry
  create: (projectId: string, data: LogCreateInput) =>
    apiRequest(`/visudev-logs/${projectId}`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Delete all logs for project
  deleteAll: (projectId: string) =>
    apiRequest(`/visudev-logs/${projectId}`, {
      method: "DELETE",
    }),

  // Delete single log
  delete: (projectId: string, logId: string) =>
    apiRequest(`/visudev-logs/${projectId}/${logId}`, {
      method: "DELETE",
    }),
};

// ==================== ACCOUNT ====================

export const accountAPI = {
  // Get account settings
  get: (userId: string) => apiRequest(`/visudev-account/${userId}`),

  // Update account settings
  update: (userId: string, data: AccountUpdateInput) =>
    apiRequest(`/visudev-account/${userId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // Get preferences
  getPreferences: (userId: string) => apiRequest(`/visudev-account/${userId}/preferences`),

  // Update preferences
  updatePreferences: (userId: string, data: AccountPreferencesUpdateInput) =>
    apiRequest(`/visudev-account/${userId}/preferences`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
};

// ==================== INTEGRATIONS ====================

export const integrationsAPI = {
  // Get all integrations
  get: (projectId: string) => apiRequest<IntegrationsState>(`/visudev-integrations/${projectId}`),

  // Update integrations
  update: (projectId: string, data: IntegrationsUpdateInput) =>
    apiRequest(`/visudev-integrations/${projectId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  // GitHub
  github: {
    // Connect GitHub (manual token)
    connect: (projectId: string, token: string, username?: string) =>
      apiRequest(`/visudev-integrations/${projectId}/github`, {
        method: "POST",
        body: JSON.stringify({ token, username }),
      }),

    // Set project GitHub repo from user-scoped OAuth (Bearer required)
    setProjectGitHubRepo: (
      projectId: string,
      payload: { repo: string; branch?: string },
      accessToken: string,
    ) =>
      apiRequest(`/visudev-integrations/${projectId}/github`, {
        method: "PUT",
        body: JSON.stringify(payload),
        accessToken,
      }),

    // Get repositories (Bearer required for user-scoped token)
    getRepos: (projectId: string, accessToken?: string | null) =>
      apiRequest<GitHubRepo[]>(
        `/visudev-integrations/${projectId}/github/repos`,
        accessToken != null && accessToken !== "" ? { accessToken } : {},
      ),

    // Get branches
    getBranches: (projectId: string, owner: string, repo: string) =>
      apiRequest(`/visudev-integrations/${projectId}/github/branches?owner=${owner}&repo=${repo}`),

    // Get file/directory content
    getContent: (
      projectId: string,
      owner: string,
      repo: string,
      path: string = "",
      ref: string = "main",
    ) =>
      apiRequest(
        `/visudev-integrations/${projectId}/github/content?owner=${owner}&repo=${repo}&path=${path}&ref=${ref}`,
      ),

    // Disconnect GitHub
    disconnect: (projectId: string) =>
      apiRequest(`/visudev-integrations/${projectId}/github`, {
        method: "DELETE",
      }),
  },

  // Supabase
  supabase: {
    // Connect Supabase
    connect: (
      projectId: string,
      url: string,
      anonKey: string,
      serviceKey?: string,
      projectRef?: string,
    ) =>
      apiRequest(`/visudev-integrations/${projectId}/supabase`, {
        method: "POST",
        body: JSON.stringify({ url, anonKey, serviceKey, projectRef }),
      }),

    // Get Supabase info
    getInfo: (projectId: string) => apiRequest(`/visudev-integrations/${projectId}/supabase`),

    // Disconnect Supabase
    disconnect: (projectId: string) =>
      apiRequest(`/visudev-integrations/${projectId}/supabase`, {
        method: "DELETE",
      }),
  },
};

export { discoverPreviewRunner, getPreviewRunnerRuntimeStatus };
export type { PreviewRunnerRuntimeStatus, PreviewStatusResponse, PreviewStepLog };

export const previewAPI = {
  /** Start preview (build/run app from repo via Preview Runner). Pass repo/branch/commitSha when project not in backend KV. */
  start: async (
    projectId: string,
    options?: {
      repo?: string;
      branchOrCommit?: string;
      commitSha?: string;
      accessToken?: string;
      bootMode?: PreviewRuntimeOptions["bootMode"];
      injectSupabasePlaceholders?: PreviewRuntimeOptions["injectSupabasePlaceholders"];
    },
    previewMode?: PreviewMode,
  ): Promise<{ success: boolean; data?: { runId: string; status: string }; error?: string }> => {
    const mode = resolvePreviewMode(previewMode);
    if (mode === "deployed") {
      return {
        success: false,
        error: "Preview-Modus ist 'Deployed URL'. Bitte eine URL im Projekt hinterlegen.",
      };
    }
    if (mode === "local") {
      const guard = localRunnerGuard();
      if (!guard.ok) return { success: false, error: guard.error };
      const out = await localPreviewStart(projectId, options);
      return out.data ? { ...out, data: out.data } : out;
    }
    return apiRequest<{ runId: string; status: string }>("/visudev-preview/preview/start", {
      method: "POST",
      body: JSON.stringify({
        projectId,
        repo: options?.repo,
        branchOrCommit: options?.branchOrCommit,
        commitSha: options?.commitSha,
      }),
      accessToken: options?.accessToken,
    });
  },

  /** Get preview status and URL */
  status: async (projectId: string, previewMode?: PreviewMode, accessToken?: string) => {
    const mode = resolvePreviewMode(previewMode);
    if (mode === "deployed") {
      return { success: true, status: "idle" as const };
    }
    if (mode === "local") {
      const guard = localRunnerGuard();
      if (!guard.ok) return { success: false, error: guard.error };
      return localPreviewStatus(projectId);
    }
    return apiRequest<PreviewStatusResponse>(
      `/visudev-preview/preview/status?projectId=${encodeURIComponent(projectId)}`,
      { accessToken },
    );
  },

  /** Stop preview */
  stop: async (
    projectId: string,
    previewMode?: PreviewMode,
    accessToken?: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const mode = resolvePreviewMode(previewMode);
    if (mode === "deployed") {
      return { success: true };
    }
    if (mode === "local") {
      const guard = localRunnerGuard();
      if (!guard.ok) return { success: false, error: guard.error };
      return localPreviewStop(projectId);
    }
    return apiRequest<{ status: string }>("/visudev-preview/preview/stop", {
      method: "POST",
      body: JSON.stringify({ projectId }),
      accessToken,
    });
  },

  /** Stop all preview runs bound to one project. */
  stopProject: async (
    projectId: string,
    previewMode?: PreviewMode,
    accessToken?: string,
  ): Promise<{ success: boolean; error?: string }> => {
    const mode = resolvePreviewMode(previewMode);
    if (mode === "deployed") {
      return { success: true };
    }
    if (mode === "local") {
      const guard = localRunnerGuard();
      if (!guard.ok) return { success: false, error: guard.error };
      return localPreviewStopProject(projectId);
    }
    return apiRequest<{ status: string }>("/visudev-preview/preview/stop", {
      method: "POST",
      body: JSON.stringify({ projectId }),
      accessToken,
    });
  },

  /** Refresh preview: pull latest from repo, rebuild, restart (live). Only with local runner. */
  refresh: async (
    projectId: string,
    previewMode?: PreviewMode,
    options?: PreviewRuntimeOptions,
  ): Promise<{ success: boolean; error?: string }> => {
    const mode = resolvePreviewMode(previewMode);
    if (mode === "deployed") {
      return { success: false, error: "Refresh nicht verfügbar im Modus 'Deployed URL'." };
    }
    if (mode === "local") {
      const guard = localRunnerGuard();
      if (!guard.ok) return { success: false, error: guard.error };
      return localPreviewRefresh(projectId, options);
    }
    return { success: false, error: "Refresh only with local runner (VITE_PREVIEW_RUNNER_URL)" };
  },
};

// Export all APIs
export const api = {
  projects: projectsAPI,
  appflow: appflowAPI,
  blueprint: blueprintAPI,
  data: dataAPI,
  logs: logsAPI,
  account: accountAPI,
  integrations: integrationsAPI,
  preview: previewAPI,
};

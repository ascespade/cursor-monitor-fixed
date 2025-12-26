/**
 * CloudAgentsService
 *
 * Purpose:
 * - Provide a thin abstraction over the internal `/api/cloud-agents/*`
 *   routes for use in client-side hooks and components.
 * - Support request cancellation via AbortController for polling optimization
 */
import type {
  CursorAgent,
  CursorConversationResponse,
  CursorListAgentsResponse,
  CursorModelListResponse,
  CursorRepositoriesResponse,
  CursorUserInfo
} from '@/features/cloud-agents/types';

interface ListAgentsOptions {
  configId?: string;
  limit?: number;
  cursor?: string;
}

async function parseOkResponse<T>(response: Response): Promise<T> {
  const json = (await response.json()) as unknown;

  if (json && typeof json === 'object' && 'data' in (json as { data?: unknown })) {
    return (json as { data: T }).data;
  }

  return json as T;
}

export async function fetchCloudAgentConfigs(): Promise<{
  configs: Array<{ id: string; name: string; description: string | null }>;
}> {
  const response = await fetch('/api/cloud-agents/configs');
  if (!response.ok) throw new Error('Failed to load Cursor API configs');
  return parseOkResponse<{
    configs: Array<{ id: string; name: string; description: string | null }>;
  }>(response);
}

interface ListAgentsOptionsWithApiKey extends ListAgentsOptions {
  apiKey?: string;
}

export async function fetchCloudAgents(options: ListAgentsOptionsWithApiKey = {}): Promise<CursorListAgentsResponse> {
  const params = new URLSearchParams();

  if (options.configId === 'env_cursor_api_key') {
    params.set('configId', options.configId);
  } else if (options.apiKey) {
    params.set('apiKey', options.apiKey);
  } else if (options.configId) {
    params.set('configId', options.configId);
  }
  if (options.limit != null) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', String(options.cursor));

  const response = await fetch(`/api/cloud-agents/agents?${params.toString()}`);
  if (!response.ok) throw new Error('Failed to load cloud agents');
  return parseOkResponse<CursorListAgentsResponse>(response);
}

export async function fetchCloudAgent(
  id: string,
  configId?: string,
  apiKey?: string,
  signal?: AbortSignal
): Promise<CursorAgent> {
  const params = new URLSearchParams();
  if (configId === 'env_cursor_api_key') {
    params.set('configId', configId);
  } else if (apiKey) {
    params.set('apiKey', apiKey);
  } else if (configId) {
    params.set('configId', configId);
  }

  const response = await fetch(`/api/cloud-agents/agents/${encodeURIComponent(id)}?${params.toString()}`, {
    signal
  });
  if (!response.ok) throw new Error('Failed to load agent');
  return parseOkResponse<CursorAgent>(response);
}

export async function fetchCloudAgentConversation(
  id: string,
  options?: { configId?: string; apiKey?: string },
  signal?: AbortSignal
): Promise<CursorConversationResponse> {
  const params = new URLSearchParams();
  if (options?.configId === 'env_cursor_api_key') {
    params.set('configId', options.configId);
  } else if (options?.apiKey) {
    params.set('apiKey', options.apiKey);
  } else if (options?.configId) {
    params.set('configId', options.configId);
  }

  const response = await fetch(
    `/api/cloud-agents/agents/${encodeURIComponent(id)}/conversation?${params.toString()}`,
    { signal }
  );
  if (!response.ok) throw new Error('Failed to load conversation');
  return parseOkResponse<CursorConversationResponse>(response);
}

export async function launchCloudAgent(
  payload: {
    configId?: string;
    apiKey?: string;
    promptText: string;
    repository: string;
    ref?: string;
    model?: string;
    autoCreatePr?: boolean;
  },
  signal?: AbortSignal
): Promise<CursorAgent> {
  const params = new URLSearchParams();
  if (payload.configId === 'env_cursor_api_key') {
    params.set('configId', payload.configId);
  } else if (payload.apiKey) {
    params.set('apiKey', payload.apiKey);
  } else if (payload.configId) {
    params.set('configId', payload.configId);
  }

  const response = await fetch(`/api/cloud-agents/agents?${params.toString()}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: { text: payload.promptText },
      source: {
        repository: payload.repository,
        ref: payload.ref || 'main'
      },
      target: {
        autoCreatePr: payload.autoCreatePr ?? true
      },
      model: payload.model
    }),
    signal
  });

  if (!response.ok) throw new Error('Failed to launch agent');
  return parseOkResponse<CursorAgent>(response);
}

export async function addCloudAgentFollowup(
  id: string,
  payload: { configId?: string; apiKey?: string; promptText: string },
  signal?: AbortSignal
): Promise<{ id: string }> {
  const params = new URLSearchParams();
  if (payload.configId === 'env_cursor_api_key') {
    params.set('configId', payload.configId);
  } else if (payload.apiKey) {
    params.set('apiKey', payload.apiKey);
  } else if (payload.configId) {
    params.set('configId', payload.configId);
  }

  const response = await fetch(
    `/api/cloud-agents/agents/${encodeURIComponent(id)}/followup?${params.toString()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptText: payload.promptText }),
      signal
    }
  );

  if (!response.ok) throw new Error('Failed to add follow-up');
  return parseOkResponse<{ id: string }>(response);
}

export async function stopCloudAgent(
  id: string,
  options?: { configId?: string; apiKey?: string },
  signal?: AbortSignal
): Promise<{ id: string }> {
  const params = new URLSearchParams();
  if (options?.apiKey) {
    params.set('apiKey', options.apiKey);
  } else if (options?.configId) {
    params.set('configId', options.configId);
  }

  const response = await fetch(`/api/cloud-agents/agents/${encodeURIComponent(id)}/stop?${params.toString()}`, {
    method: 'POST',
    signal
  });

  if (!response.ok) throw new Error('Failed to stop agent');
  return parseOkResponse<{ id: string }>(response);
}

export async function deleteCloudAgent(
  id: string,
  options?: { configId?: string; apiKey?: string },
  signal?: AbortSignal
): Promise<{ id: string }> {
  const params = new URLSearchParams();
  if (options?.configId === 'env_cursor_api_key') {
    params.set('configId', options.configId);
  } else if (options?.apiKey) {
    params.set('apiKey', options.apiKey);
  } else if (options?.configId) {
    params.set('configId', options.configId);
  }

  const response = await fetch(`/api/cloud-agents/agents/${encodeURIComponent(id)}?${params.toString()}`, {
    method: 'DELETE',
    signal
  });

  if (!response.ok) throw new Error('Failed to delete agent');
  return parseOkResponse<{ id: string }>(response);
}

export async function fetchCloudAgentUserInfo(
  options?: { configId?: string; apiKey?: string },
  signal?: AbortSignal
): Promise<CursorUserInfo> {
  const params = new URLSearchParams();
  if (options?.configId === 'env_cursor_api_key') {
    params.set('configId', options.configId);
  } else if (options?.apiKey) {
    params.set('apiKey', options.apiKey);
  } else if (options?.configId) {
    params.set('configId', options.configId);
  }

  const response = await fetch(`/api/cloud-agents/me?${params.toString()}`, { signal });
  if (!response.ok) throw new Error('Failed to load API user info');
  return parseOkResponse<CursorUserInfo>(response);
}

export async function fetchCloudAgentModels(
  options?: { configId?: string; apiKey?: string },
  signal?: AbortSignal
): Promise<CursorModelListResponse> {
  const params = new URLSearchParams();
  if (options?.configId === 'env_cursor_api_key') {
    params.set('configId', options.configId);
  } else if (options?.apiKey) {
    params.set('apiKey', options.apiKey);
  } else if (options?.configId) {
    params.set('configId', options.configId);
  }

  const response = await fetch(`/api/cloud-agents/models?${params.toString()}`, { signal });
  if (!response.ok) throw new Error('Failed to load models');
  return parseOkResponse<CursorModelListResponse>(response);
}

export async function fetchCloudAgentRepositories(
  options?: { configId?: string; apiKey?: string },
  signal?: AbortSignal
): Promise<CursorRepositoriesResponse> {
  const params = new URLSearchParams();
  if (options?.configId === 'env_cursor_api_key') {
    params.set('configId', options.configId);
  } else if (options?.apiKey) {
    params.set('apiKey', options.apiKey);
  } else if (options?.configId) {
    params.set('configId', options.configId);
  }

  const response = await fetch(`/api/cloud-agents/repositories?${params.toString()}`, { signal });
  if (!response.ok) throw new Error('Failed to load repositories');
  return parseOkResponse<CursorRepositoriesResponse>(response);
}

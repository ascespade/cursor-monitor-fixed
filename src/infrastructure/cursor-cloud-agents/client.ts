/**
 * Cursor Cloud Agents Client
 *
 * Purpose:
 * - Wrap HTTP calls to the Cursor Cloud Agents API using Basic Auth with
 *   the provided API key, returning typed results or throwing AppErrors
 *   for centralized handling in API routes.
 *
 * Notes:
 * - This module is intended for server-side usage only.
 */
import { UnauthorizedError, InternalServerError } from '@/core/errors/AppError';
import { logger } from '@/shared/utils/logger';

export interface CursorAgent {
  id: string;
  name?: string;
  status?: string;
  createdAt?: string;
  // Additional fields from Cursor can be added as needed.
  [key: string]: unknown;
}

export interface CursorListAgentsResponse {
  agents: CursorAgent[];
  cursor?: string | null;
}

export interface CursorUserInfo {
  apiKeyName?: string;
  createdAt?: string;
  userEmail?: string;
  [key: string]: unknown;
}

export interface CursorModelListResponse {
  models: string[];
}

export interface CursorRepositorySummary {
  owner: string;
  name: string;
  repository: string;
}

export interface CursorRepositoriesResponse {
  repositories: CursorRepositorySummary[];
}

export interface CursorConversationMessage {
  id?: string;
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface CursorConversationResponse {
  messages?: CursorConversationMessage[];
  [key: string]: unknown;
}

export interface LaunchAgentPayload {
  prompt: {
    text: string;
    // Images are omitted for now; can be added later.
  };
  source: {
    repository: string;
    ref: string;
  };
  target?: {
    autoCreatePr?: boolean;
  };
  model?: string;
  webhook?: {
    url: string;
    secret: string;
  };
}

const BASE_URL = 'https://api.cursor.com';

function buildAuthHeader(apiKey: string): string {
  const encoded = Buffer.from(`${apiKey}:`).toString('base64');
  return `Basic ${encoded}`;
}

async function handleJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    if (response.status === 401) {
      throw new UnauthorizedError('Invalid or unauthorized Cursor API key');
    }

    const text = await response.text().catch(() => undefined);
    logger.error('Cursor API error', { status: response.status, body: text });
    throw new InternalServerError(`Cursor API error: HTTP ${response.status}`);
  }

  const text = await response.text();
  if (!text) {
    return {} as T;
  }

  return JSON.parse(text) as T;
}

export async function listAgents(
  apiKey: string,
  params?: { limit?: number; cursor?: string }
): Promise<CursorListAgentsResponse> {
  const url = new URL('/v0/agents', BASE_URL);
  if (params?.limit != null) {
    url.searchParams.set('limit', String(params.limit));
  }
  if (params?.cursor) {
    url.searchParams.set('cursor', params.cursor);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<CursorListAgentsResponse>(response);
}

export async function getAgent(apiKey: string, agentId: string): Promise<CursorAgent> {
  const url = new URL(`/v0/agents/${encodeURIComponent(agentId)}`, BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<CursorAgent>(response);
}

export async function getConversation(
  apiKey: string,
  agentId: string
): Promise<CursorConversationResponse> {
  const url = new URL(`/v0/agents/${encodeURIComponent(agentId)}/conversation`, BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<CursorConversationResponse>(response);
}

export async function launchAgent(
  apiKey: string,
  payload: LaunchAgentPayload
): Promise<CursorAgent> {
  const url = new URL('/v0/agents', BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return handleJsonResponse<CursorAgent>(response);
}

export async function addFollowup(
  apiKey: string,
  agentId: string,
  promptText: string
): Promise<{ id: string }> {
  const url = new URL(`/v0/agents/${encodeURIComponent(agentId)}/followup`, BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(apiKey),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      prompt: { text: promptText }
    })
  });

  return handleJsonResponse<{ id: string }>(response);
}

export async function stopAgent(apiKey: string, agentId: string): Promise<{ id: string }> {
  const url = new URL(`/v0/agents/${encodeURIComponent(agentId)}/stop`, BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<{ id: string }>(response);
}

export async function deleteAgent(apiKey: string, agentId: string): Promise<{ id: string }> {
  const url = new URL(`/v0/agents/${encodeURIComponent(agentId)}`, BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<{ id: string }>(response);
}

export async function getUserInfo(apiKey: string): Promise<CursorUserInfo> {
  const url = new URL('/v0/me', BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<CursorUserInfo>(response);
}

export async function listModels(apiKey: string): Promise<CursorModelListResponse> {
  const url = new URL('/v0/models', BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<CursorModelListResponse>(response);
}

export async function listRepositories(apiKey: string): Promise<CursorRepositoriesResponse> {
  const url = new URL('/v0/repositories', BASE_URL);
  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Authorization: buildAuthHeader(apiKey)
    }
  });

  return handleJsonResponse<CursorRepositoriesResponse>(response);
}

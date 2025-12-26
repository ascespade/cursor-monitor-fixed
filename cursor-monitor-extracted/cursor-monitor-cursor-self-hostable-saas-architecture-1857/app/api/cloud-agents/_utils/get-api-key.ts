/**
 * Helper to get API key from request params or config lookup
 *
 * Priority:
 * 1. apiKey query param (for client-side localStorage configs)
 * 2. configId='env_cursor_api_key' -> use CURSOR_API_KEY from environment variable
 * 3. configId lookup (legacy server-side configs)
 * 4. Fallback to CURSOR_API_KEY from environment variable (if available)
 */
import { getCursorApiConfigById } from '@/config/cursor-cloud-apis';
import { UnauthorizedError } from '@/core/errors/AppError';

export function getApiKeyFromRequest(request: Request): string {
  const url = new URL(request.url);
  const apiKeyParam = url.searchParams.get('apiKey');
  const configId = url.searchParams.get('configId');

  // Priority 1: API key directly from query param (from localStorage)
  if (apiKeyParam) {
    return apiKeyParam;
  }

  // Priority 2: Check if configId is for environment variable
  if (configId === 'env_cursor_api_key') {
    const envApiKey = process.env['CURSOR_API_KEY'] || process.env['NEXT_PUBLIC_CURSOR_API_KEY'];
    if (envApiKey && envApiKey.length >= 10) {
      return envApiKey;
    }
  }

  // Priority 3: Look up by configId (legacy server-side configs)
  if (configId) {
    const config = getCursorApiConfigById(configId);
    if (config?.apiKey) {
      return config.apiKey;
    }
  }

  // Priority 4: Fallback to environment variable (if no params provided)
  const envApiKey = process.env['CURSOR_API_KEY'] || process.env['NEXT_PUBLIC_CURSOR_API_KEY'];
  if (envApiKey && envApiKey.length >= 10) {
    return envApiKey;
  }

  throw new UnauthorizedError('API key is required (provide apiKey query param, valid configId, or set CURSOR_API_KEY environment variable)');
}

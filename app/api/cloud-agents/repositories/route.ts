/**
 * GET /api/cloud-agents/repositories
 *
 * Purpose:
 * - List GitHub repositories accessible to the Cursor API key.
 */
import { NextResponse } from 'next/server';

import { listRepositories } from '@/infrastructure/cursor-cloud-agents/client';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../_utils/get-api-key';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const repos = await listRepositories(apiKey);
    return ok(repos);
  } catch (error) {
    return handleApiError(error);
  }
}

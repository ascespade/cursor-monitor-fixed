/**
 * GET /api/cloud-agents/models
 *
 * Purpose:
 * - List recommended models for Cursor Cloud Agents.
 */
import { NextResponse } from 'next/server';

import { listModels } from '@/infrastructure/cursor-cloud-agents/client';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../_utils/get-api-key';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const models = await listModels(apiKey);
    return ok(models);
  } catch (error) {
    return handleApiError(error);
  }
}

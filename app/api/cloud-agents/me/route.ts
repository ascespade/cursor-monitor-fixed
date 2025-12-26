/**
 * GET /api/cloud-agents/me
 *
 * Purpose:
 * - Get information about the current Cursor API key / user.
 */
import { NextResponse } from 'next/server';

import { getUserInfo } from '@/infrastructure/cursor-cloud-agents/client';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../_utils/get-api-key';

// Force dynamic rendering (uses request.url)
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const info = await getUserInfo(apiKey);
    return ok(info);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/cloud-agents/agents/:id/stop
 *
 * Purpose:
 * - Stop a running Cursor Cloud Agent.
 */
import { NextResponse } from 'next/server';

import { stopAgent } from '@/infrastructure/cursor-cloud-agents/client';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../../../_utils/get-api-key';

interface RouteParams {
  params: {
    id: string;
  };
}

export async function POST(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const result = await stopAgent(apiKey, params.id);
    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}

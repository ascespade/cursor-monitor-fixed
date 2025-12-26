/**
 * GET /api/cloud-agents/agents/:id
 *
 * Purpose:
 * - Get a single Cursor Cloud Agent by id.
 */
import { NextResponse } from 'next/server';

import { getAgent } from '@/infrastructure/cursor-cloud-agents/client';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../../_utils/get-api-key';

interface RouteParams {
  params: {
    id: string;
  };
}

import { deleteAgent } from '@/infrastructure/cursor-cloud-agents/client';

export async function GET(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const agent = await getAgent(apiKey, params.id);
    return ok(agent);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const result = await deleteAgent(apiKey, params.id);
    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}

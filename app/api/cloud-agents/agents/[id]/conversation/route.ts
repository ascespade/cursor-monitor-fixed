/**
 * GET /api/cloud-agents/agents/:id/conversation
 *
 * Purpose:
 * - Get the conversation history for a specific Cursor Cloud Agent.
 */
import { NextResponse } from 'next/server';

import { getConversation } from '@/infrastructure/cursor-cloud-agents/client';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../../../_utils/get-api-key';

interface RouteParams {
  params: {
    id: string;
  };
}

export async function GET(request: Request, { params }: RouteParams): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const conversation = await getConversation(apiKey, params.id);
    return ok(conversation);
  } catch (error) {
    return handleApiError(error);
  }
}

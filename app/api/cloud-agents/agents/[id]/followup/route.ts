/**
 * POST /api/cloud-agents/agents/:id/followup
 *
 * Purpose:
 * - Add a follow-up prompt to an existing Cursor Cloud Agent.
 */
import { NextResponse } from 'next/server';

import { addFollowup } from '@/infrastructure/cursor-cloud-agents/client';
import { ValidationError } from '@/core/errors/AppError';
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

    const body = (await request.json()) as { promptText?: string };
    if (!body.promptText) {
      throw new ValidationError('promptText is required');
    }

    const result = await addFollowup(apiKey, params.id, body.promptText);
    return ok(result);
  } catch (error) {
    return handleApiError(error);
  }
}

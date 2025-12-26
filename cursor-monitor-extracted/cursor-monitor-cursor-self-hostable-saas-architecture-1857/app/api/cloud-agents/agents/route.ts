/**
 * GET /api/cloud-agents/agents
 * POST /api/cloud-agents/agents
 *
 * Purpose:
 * - List Cursor Cloud Agents for a given Cursor API config.
 * - Create a new Cloud Agent with automatic webhook configuration.
 */
import { NextResponse } from 'next/server';

import { listAgents, launchAgent } from '@/infrastructure/cursor-cloud-agents/client';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../_utils/get-api-key';
import { env } from '@/config/env';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    const cursorParam = url.searchParams.get('cursor');

    const apiKey = getApiKeyFromRequest(request);

    const limit = limitParam ? Number(limitParam) : undefined;

    const data = await listAgents(apiKey, {
      limit: Number.isNaN(limit) ? undefined : limit,
      cursor: cursorParam ?? undefined
    });

    return ok(data);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const body = (await request.json()) as {
      prompt?: { text?: string };
      repository?: string;
      ref?: string;
      model?: string;
      autoCreatePr?: boolean;
      source?: { repository?: string; ref?: string };
      target?: { autoCreatePr?: boolean };
    };

    if (!body.prompt?.text) {
      return handleApiError(new Error('prompt.text is required'));
    }

    // Support both old format (repository, ref, autoCreatePr) and new format (source, target)
    const repository = body.repository || body.source?.repository;
    const ref = body.ref || body.source?.ref || 'main';
    const autoCreatePr = body.autoCreatePr ?? body.target?.autoCreatePr ?? true;

    if (!repository) {
      return handleApiError(new Error('repository is required (either as repository or source.repository)'));
    }

    // Build webhook configuration if WEBHOOK_SECRET is available
    // Use VERCEL_URL if available (includes protocol), otherwise use production URL
    const vercelUrl = process.env['VERCEL_URL'];
    const webhookUrl =
      vercelUrl && !vercelUrl.startsWith('http')
        ? `https://${vercelUrl}`
        : vercelUrl || 'https://cursor-monitor.vercel.app';

    const webhookConfig =
      env.WEBHOOK_SECRET && typeof window === 'undefined'
        ? {
            url: `${webhookUrl}/api/cloud-agents/webhook`,
            secret: env.WEBHOOK_SECRET
          }
        : undefined;

    const payload = {
      prompt: { text: body.prompt.text },
      source: {
        repository,
        ref
      },
      target: {
        autoCreatePr
      },
      model: body.model,
      ...(webhookConfig && { webhook: webhookConfig })
    };

    const data = await launchAgent(apiKey, payload);
    return ok(data);
  } catch (error) {
    return handleApiError(error);
  }
}

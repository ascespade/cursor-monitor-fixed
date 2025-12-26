/**
 * POST /api/cloud-agents/orchestrations/[id]/retry
 * 
 * Retry a failed orchestration by resetting its status and creating a new outbox job
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { logger } from '@/shared/utils/logger';
import { getApiKeyFromRequest } from '../../../_utils/get-api-key';

function getSupabaseClient(requireServiceKey = false) {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error('Supabase configuration missing. NEXT_PUBLIC_SUPABASE_URL must be set.');
  }

  if (requireServiceKey && !supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for write operations.');
  }

  const supabaseKey = supabaseServiceKey || supabaseAnonKey;

  if (!supabaseKey) {
    throw new Error('Supabase configuration missing. SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.');
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
): Promise<NextResponse> {
  try {
    const resolvedParams = await Promise.resolve(params);
    const orchestrationId = resolvedParams.id;

    if (!orchestrationId) {
      return handleApiError(new Error('Orchestration ID is required'));
    }

    const supabase = getSupabaseClient(true); // Require service key for writes

    // Fetch orchestration from database
    const { data: orchestration, error: orchError } = await supabase
      .from('orchestrations')
      .select('*')
      .eq('id', orchestrationId)
      .single();

    if (orchError || !orchestration) {
      if (orchError?.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: { code: 'NOT_FOUND', message: `Orchestration not found: ${orchestrationId}` } },
          { status: 404 }
        );
      }
      logger.error('Failed to fetch orchestration', { error: orchError?.message, orchestrationId });
      return handleApiError(new Error(`Failed to load orchestration: ${orchError?.message || 'Unknown error'}`));
    }

    // Check if orchestration is in a retryable state
    if (orchestration.status !== 'error' && orchestration.status !== 'stopped') {
      return NextResponse.json(
        { 
          success: false, 
          error: { 
            code: 'INVALID_STATE', 
            message: `Orchestration is in '${orchestration.status}' state. Only 'error' or 'stopped' orchestrations can be retried.` 
          } 
        },
        { status: 400 }
      );
    }

    // Get API key from request (required for retry)
    let finalApiKey: string | undefined;
    try {
      finalApiKey = getApiKeyFromRequest(request);
    } catch (error) {
      logger.warn('API key not provided in retry request', { orchestrationId, error });
      return NextResponse.json(
        { 
          success: false, 
          error: { 
            code: 'API_KEY_REQUIRED', 
            message: 'API key is required. Please provide Cursor API key in request (apiKey query parameter).' 
          } 
        },
        { status: 400 }
      );
    }
    
    if (!finalApiKey) {
      return NextResponse.json(
        { 
          success: false, 
          error: { 
            code: 'API_KEY_REQUIRED', 
            message: 'API key is required. Please provide Cursor API key in request (apiKey query parameter).' 
          } 
        },
        { status: 400 }
      );
    }

    logger.info('Retrying orchestration', {
      orchestrationId,
      previousStatus: orchestration.status,
      repository: orchestration.repository_url,
      hasApiKey: !!finalApiKey
    });

    // Reset orchestration status to queued
    const { error: updateError } = await supabase
      .from('orchestrations')
      .update({
        status: 'queued',
        error_code: null,
        error_message: null,
        error_summary: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', orchestrationId);

    if (updateError) {
      logger.error('Failed to update orchestration status', { error: updateError, orchestrationId });
      return handleApiError(new Error(`Failed to update orchestration: ${updateError.message}`));
    }

    // Create new outbox job
    const { error: outboxError } = await supabase
      .from('orchestration_outbox_jobs')
      .insert({
        orchestration_id: orchestrationId,
        type: 'start-orchestration',
        payload: {
          prompt: orchestration.prompt,
          repository: orchestration.repository_url,
          ref: orchestration.ref || 'main',
          model: (orchestration.model === 'claude-sonnet-4' 
            ? 'claude-4.5-opus-high-thinking' 
            : orchestration.model) || 'claude-4.5-opus-high-thinking',
          apiKey: finalApiKey,
          options: orchestration.options || {},
          retry: true,
          originalOrchestrationId: orchestrationId
        },
        status: 'pending',
        attempts: 0,
        max_attempts: 3,
        next_run_at: new Date().toISOString()
      });

    if (outboxError) {
      logger.error('Failed to create outbox job for retry', { error: outboxError, orchestrationId });
      // Rollback orchestration status
      await supabase
        .from('orchestrations')
        .update({
          status: 'error',
          error_message: `Failed to create retry job: ${outboxError.message}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', orchestrationId);
      
      return handleApiError(new Error(`Failed to create retry job: ${outboxError.message}`));
    }

    // Log retry event
    await supabase.from('orchestration_events').insert({
      orchestration_id: orchestrationId,
      level: 'info',
      step_key: 'orchestration_retried',
      step_phase: 'end',
      message: 'Orchestration retried after failure',
      payload: {
        previousStatus: orchestration.status,
        previousError: orchestration.error_message,
        retryAt: new Date().toISOString()
      }
    });

    logger.info('Orchestration retry initiated', {
      orchestrationId,
      repository: orchestration.repository_url,
      mode: orchestration.mode
    });

    return ok({
      id: orchestrationId,
      status: 'queued',
      message: 'Orchestration queued for retry',
      retryAt: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Error in POST /api/cloud-agents/orchestrations/[id]/retry', { error });
    return handleApiError(error);
  }
}


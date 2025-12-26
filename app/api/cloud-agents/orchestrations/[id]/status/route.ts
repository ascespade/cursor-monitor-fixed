/**
 * GET /api/cloud-agents/orchestrations/[id]/status
 * 
 * Returns orchestration status from database (system of record)
 * Works even if worker is offline - reads from Supabase only
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { logger } from '@/shared/utils/logger';

function getSupabaseClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];

  if (!supabaseUrl) {
    throw new Error('Supabase configuration missing. NEXT_PUBLIC_SUPABASE_URL must be set.');
  }

  // Prefer service key for more complete data, fall back to anon key
  const supabaseKey = supabaseServiceKey || supabaseAnonKey;

  if (!supabaseKey) {
    throw new Error('Supabase configuration missing. SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.');
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
): Promise<NextResponse> {
  try {
    const resolvedParams = await Promise.resolve(params);
    const orchestrationId = resolvedParams.id;

    if (!orchestrationId) {
      return handleApiError(new Error('Orchestration ID is required'));
    }

    const supabase = getSupabaseClient();

    // Fetch orchestration from database (system of record)
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

    // Map database status to API status
    const apiStatus = mapSupabaseStatusToApiStatus(orchestration.status);

    // Calculate progress
    const tasksTotal = orchestration.tasks_total || 0;
    const tasksCompleted = orchestration.tasks_completed || 0;
    const progress = tasksTotal > 0 ? Math.round((tasksCompleted / tasksTotal) * 100) : 0;

    // Build response
    const statusResponse = {
      id: orchestration.id,
      status: apiStatus,
      mode: orchestration.mode,
      repository: orchestration.repository_url,
      ref: orchestration.ref,
      masterAgentId: orchestration.master_agent_id,
      tasksTotal,
      tasksCompleted,
      activeAgents: orchestration.active_agents || 0,
      progress,
      startedAt: orchestration.started_at,
      completedAt: orchestration.completed_at,
      updatedAt: orchestration.updated_at,
      createdAt: orchestration.created_at,
      errorCode: orchestration.error_code || null,
      errorMessage: orchestration.error_message || orchestration.error_summary || null,
      errorSummary: orchestration.error_summary,
      metadata: orchestration.metadata || {}
    };

    return ok(statusResponse);
  } catch (error) {
    logger.error('Error in GET /api/cloud-agents/orchestrations/[id]/status', { error });
    return handleApiError(error);
  }
}

function mapSupabaseStatusToApiStatus(status: string): 'ACTIVE' | 'COMPLETED' | 'ERROR' | 'TIMEOUT' {
  switch (status) {
    case 'completed':
      return 'COMPLETED';
    case 'error':
      return 'ERROR';
    case 'stopped':
      return 'TIMEOUT';
    case 'queued':
    case 'running':
    case 'waiting':
    case 'blocked':
      return 'ACTIVE';
    default:
      return 'ACTIVE';
  }
}

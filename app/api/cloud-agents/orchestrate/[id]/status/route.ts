/**
 * GET /api/cloud-agents/orchestrate/:id/status
 *
 * Purpose:
 * - Get orchestration job status and details from Supabase
 * - Returns current state, tasks progress, active agents
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { logger } from '@/shared/utils/logger';
import type { OrchestrationStatus } from '@/features/cloud-agents/types/orchestration';

interface RouteParams {
  params: {
    id: string;
  };
}

function getSupabaseClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error('Supabase configuration missing. NEXT_PUBLIC_SUPABASE_URL must be set.');
  }

  // Prefer service role key for read operations
  const supabaseKey = supabaseServiceKey || supabaseAnonKey;
  
  if (!supabaseKey) {
    throw new Error('Supabase configuration missing. SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) or NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.');
  }

  return createClient(supabaseUrl, supabaseKey);
}

export async function GET(
  request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const orchestrationId = params.id;

    if (!orchestrationId) {
      return handleApiError(new Error('Orchestration ID is required'));
    }

    logger.info('Fetching orchestration status', { orchestrationId });

    const supabase = getSupabaseClient();

    // Get orchestration from Supabase
    const { data: orchestration, error } = await supabase
      .from('orchestrations')
      .select('*')
      .eq('id', orchestrationId)
      .single();

    if (error || !orchestration) {
      logger.error('Orchestration not found', { error: error?.message, orchestrationId });
      return NextResponse.json(
        { success: false, error: 'Orchestration not found' },
        { status: 404 }
      );
    }

    // Map Supabase status to OrchestrationStatus format
    const status: OrchestrationStatus = {
      masterAgentId: orchestration.master_agent_id || `orch-${orchestrationId}`,
      status: mapOrchestrationStatus(orchestration.status),
      mode: orchestration.mode || 'AUTO',
      currentTask: undefined, // Can be extracted from metadata if needed
      tasksCompleted: orchestration.tasks_completed || 0,
      tasksTotal: orchestration.tasks_total || 0,
      activeAgents: orchestration.active_agents || 0,
      iterations: 0, // Can be extracted from metadata if needed
      startedAt: orchestration.started_at ? new Date(orchestration.started_at).toISOString() : new Date(orchestration.created_at).toISOString(),
      updatedAt: new Date(orchestration.updated_at).toISOString()
    };

    return ok(status);
  } catch (error) {
    logger.error('Error fetching orchestration status', { error });
    return handleApiError(error);
  }
}

function mapOrchestrationStatus(status: string): OrchestrationStatus['status'] {
  switch (status?.toUpperCase()) {
    case 'COMPLETED':
      return 'COMPLETED';
    case 'ERROR':
    case 'FAILED':
      return 'ERROR';
    case 'STOPPED':
      return 'ERROR';
    case 'RUNNING':
    case 'ACTIVE':
    case 'WAITING':
      return 'ACTIVE';
    case 'QUEUED':
      return 'ACTIVE';
    default:
      return 'ACTIVE';
  }
}

/**
 * GET /api/cloud-agents/orchestrations
 *
 * Purpose:
 * - List all orchestration jobs from Supabase (system of record)
 * - Works even if Redis/worker is offline - reads from database only
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { logger } from '@/shared/utils/logger';

export const dynamic = 'force-dynamic';
export const revalidate = 0; // Disable caching completely

/**
 * Get Supabase client for server-side operations
 */
function getSupabaseClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error('Supabase configuration missing. NEXT_PUBLIC_SUPABASE_URL must be set.');
  }

  // Prefer service role key, fall back to anon key
  const supabaseKey = supabaseServiceKey || supabaseAnonKey;
  
  if (!supabaseKey) {
    throw new Error('Supabase configuration missing. SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.');
  }

  return createClient(supabaseUrl, supabaseKey);
}

/**
 * Map Supabase status to API status format
 */
function mapSupabaseStatusToApiStatus(status: string): 'ACTIVE' | 'COMPLETED' | 'ERROR' | 'TIMEOUT' {
  switch (status) {
    case 'completed':
      return 'COMPLETED';
    case 'error':
      return 'ERROR';
    case 'stopped':
    case 'timeout':
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

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '50', 10);
    const offset = parseInt(url.searchParams.get('offset') || '0', 10);

    // Read orchestrations from Supabase (system of record)
    // This works in hybrid deployments where Redis is not accessible from Vercel
    let supabase;
    try {
      supabase = getSupabaseClient();
    } catch (supabaseError) {
      logger.error('Failed to create Supabase client', { error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError) });
      return handleApiError(new Error('Supabase configuration missing. Please check environment variables.'));
    }
    
    const { data: orchestrations, error, count } = await supabase
      .from('orchestrations')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      logger.error('Failed to fetch orchestrations from Supabase', { error: error.message, code: error.code });
      return handleApiError(new Error(`Failed to load orchestrations: ${error.message}`));
    }

    // Map Supabase records to API response format
    const mappedOrchestrations = (orchestrations || []).map((orch) => ({
      id: orch.id,
      masterAgentId: orch.master_agent_id || orch.id,
      status: mapSupabaseStatusToApiStatus(orch.status),
      mode: orch.mode,
      repository: orch.repository_url,
      promptLength: orch.prompt_length,
      tasksTotal: orch.tasks_total || 0,
      tasksCompleted: orch.tasks_completed || 0,
      activeAgents: orch.active_agents || 0,
      startedAt: orch.started_at || null,
      updatedAt: orch.updated_at || null
    }));

    const response = ok({
      orchestrations: mappedOrchestrations,
      total: count || 0,
      limit,
      offset
    });
    
    // Force no caching
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    
    return response;
  } catch (error) {
    logger.error('Error in GET /api/cloud-agents/orchestrations', { error });
    return handleApiError(error);
  }
}


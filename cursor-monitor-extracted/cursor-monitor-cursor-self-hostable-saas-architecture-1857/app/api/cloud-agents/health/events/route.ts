/**
 * GET /api/cloud-agents/health/events
 * 
 * Returns health events for a specific service
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { logger } from '@/shared/utils/logger';

export const dynamic = 'force-dynamic';

function getSupabaseClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase configuration missing');
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const url = new URL(request.url);
    const service = url.searchParams.get('service');
    const limit = parseInt(url.searchParams.get('limit') || '20', 10);

    if (!service) {
      return handleApiError(new Error('Service parameter is required'));
    }

    const supabase = getSupabaseClient();

    const { data: events, error } = await supabase
      .from('service_health_events')
      .select('*')
      .eq('service', service)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      logger.error('Failed to fetch health events', { error: error.message, service });
      return handleApiError(new Error(`Failed to fetch health events: ${error.message}`));
    }

    // Get latest heartbeat for worker
    let latestHeartbeat = null;
    if (service === 'worker') {
      const { data: heartbeat } = await supabase
        .from('service_health_events')
        .select('*')
        .eq('service', 'worker')
        .eq('status', 'healthy')
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      latestHeartbeat = heartbeat;
    }

    return ok({
      service,
      events: events || [],
      latestHeartbeat,
      total: events?.length || 0
    });
  } catch (error) {
    logger.error('Error in GET /api/cloud-agents/health/events', { error });
    return handleApiError(error);
  }
}


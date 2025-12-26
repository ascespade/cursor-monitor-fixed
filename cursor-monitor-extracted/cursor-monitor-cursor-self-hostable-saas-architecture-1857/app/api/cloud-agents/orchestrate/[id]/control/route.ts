/**
 * POST /api/cloud-agents/orchestrate/:id/control
 *
 * Purpose:
 * - Control orchestration: pause, resume, cancel
 */
import { NextResponse } from 'next/server';

import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../../../_utils/get-api-key';
import { getOrchestratorQueue } from '@/features/cloud-agents/orchestrator/queue/redis';
import { logger } from '@/shared/utils/logger';

interface RouteParams {
  params: {
    id: string;
  };
}

export async function POST(
  request: Request,
  { params }: RouteParams
): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const jobId = params.id;
    const body = (await request.json()) as { action: 'pause' | 'resume' | 'cancel' };

    if (!body.action || !['pause', 'resume', 'cancel'].includes(body.action)) {
      return NextResponse.json(
        { success: false, error: 'Invalid action. Must be: pause, resume, or cancel' },
        { status: 400 }
      );
    }

    logger.info('Orchestration control', { jobId, action: body.action });

    // Skip Redis connection during build
    if (process.env['NEXT_PHASE'] === 'phase-production-build') {
      return NextResponse.json(
        { success: false, error: 'Orchestration control not available during build' },
        { status: 503 }
      );
    }

    const orchestratorQueue = getOrchestratorQueue();
    if (!orchestratorQueue) {
      return NextResponse.json(
        { success: false, error: 'Redis not available. Control operations require Redis.' },
        { status: 503 }
      );
    }

    const job = await orchestratorQueue.getJob(jobId);
    
    if (!job) {
      return NextResponse.json(
        { success: false, error: 'Orchestration job not found' },
        { status: 404 }
      );
    }

    switch (body.action) {
      case 'pause':
        // Pause job (remove from active queue)
        await job.remove();
        // TODO: Update state in Supabase to 'PAUSED'
        logger.info('Orchestration paused', { jobId });
        return ok({ status: 'paused', message: 'Orchestration paused successfully' });

      case 'resume':
        // Re-add job to queue
        if (!orchestratorQueue) {
          return NextResponse.json(
            { success: false, error: 'Redis not available. Resume requires Redis.' },
            { status: 503 }
          );
        }
        await orchestratorQueue.add(
          'start-orchestration',
          job.data,
          { jobId: job.id }
        );
        logger.info('Orchestration resumed', { jobId });
        return ok({ status: 'resumed', message: 'Orchestration resumed successfully' });

      case 'cancel':
        // Remove job and mark as cancelled
        await job.remove();
        // TODO: Stop all active agents
        // TODO: Update state in Supabase to 'CANCELLED'
        logger.info('Orchestration cancelled', { jobId });
        return ok({ status: 'cancelled', message: 'Orchestration cancelled successfully' });

      default:
        return NextResponse.json(
          { success: false, error: 'Invalid action' },
          { status: 400 }
        );
    }
  } catch (error) {
    return handleApiError(error);
  }
}

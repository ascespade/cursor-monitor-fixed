/**
 * Orchestrator Worker
 * 
 * Background worker that processes jobs from:
 * 1. Supabase outbox (primary - always available)
 * 2. Redis queue (optional - if Redis is available)
 * 
 * Worker runs in database-first mode - Redis is optional optimization
 */

import '../utils/env-loader'; // Load centralized .env from parent directory
import { Worker } from 'bullmq';
import {
  checkRedisAvailability,
  createRedisWorker,
  closeQueue,
  isRedisEnabled,
  isRedisAvailable
} from '../queue/redis';
import { orchestratorService } from '../services/orchestrator.service';
import { logger } from '../utils/logger';
import { startHeartbeat, stopHeartbeat } from '../services/heartbeat.service';
import { startOutboxProcessor, stopOutboxProcessor } from '../services/outbox-processor.service';
import { refreshModelsCache } from '../services/model-validator.service';

let redisWorker: Worker | null = null;

/**
 * Process orchestration job (used by both Redis and outbox)
 */
interface OrchestrationJobData {
  prompt: string;
  repository: string;
  ref?: string;
  model?: string;
  apiKey?: string;
  options?: Record<string, unknown>;
  orchestrationId?: string;
  redisJobId?: string;
}

async function processOrchestrationJob(jobData: OrchestrationJobData): Promise<void> {
  const { prompt, repository, ref, model, apiKey, options, orchestrationId, redisJobId } = jobData;

  // Set API key temporarily for this job
  if (apiKey) {
    process.env['CURSOR_API_KEY'] = apiKey;
  }

  // If orchestrationId is provided, update Supabase record
  if (orchestrationId) {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env['SUPABASE_URL'] || process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const supabaseKey = process.env['SUPABASE_SERVICE_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);

      // Update status to running
      await supabase
        .from('orchestrations')
        .update({
          status: 'running',
          updated_at: new Date().toISOString()
        })
        .eq('id', orchestrationId);

      // Log event
      await supabase.from('orchestration_events').insert({
        orchestration_id: orchestrationId,
        level: 'info',
        step_key: 'worker_received',
        step_phase: 'end',
        message: redisJobId ? 'Worker received job from Redis queue' : 'Worker received job from outbox',
        payload: { redisJobId, source: redisJobId ? 'redis' : 'outbox' }
      });
    }
  }

  const result = await orchestratorService.startOrchestration(
    prompt,
    repository,
    ref,
    model,
    options
  );

  // Update Supabase record with master agent ID if available
  if (orchestrationId) {
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env['SUPABASE_URL'] || process.env['NEXT_PUBLIC_SUPABASE_URL'];
    const supabaseKey = process.env['SUPABASE_SERVICE_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);

      await supabase
        .from('orchestrations')
        .update({
          master_agent_id: result.masterAgentId,
          updated_at: new Date().toISOString()
        })
        .eq('id', orchestrationId);

      // Log event
      await supabase.from('orchestration_events').insert({
        orchestration_id: orchestrationId,
        level: 'info',
        step_key: 'orchestration_started',
        step_phase: 'end',
        message: 'Orchestration started successfully',
        payload: { masterAgentId: result.masterAgentId, totalTasks: result.taskPlan?.tasks?.length || 0 }
      });
    }
  }

  logger.info('Orchestration started', {
    orchestrationId,
    masterAgentId: result.masterAgentId,
    totalTasks: result.taskPlan?.tasks?.length || 0
  });
}

/**
 * Initialize Redis worker (optional)
 */
async function initializeRedisWorker(): Promise<void> {
  if (!isRedisEnabled()) {
    logger.info('Redis not configured - using database-only mode');
    return;
  }

  try {
    const available = await checkRedisAvailability();
    if (!available) {
      logger.info('Redis not available - using database-only mode');
      return;
    }

    // Create Redis worker
    redisWorker = createRedisWorker(
      'orchestrator',
      async (job) => {
        const jobName = job.name;

        logger.info('Processing orchestrator job from Redis', {
          jobId: job.id,
          jobName,
          attempt: job.attemptsMade + 1
        });

        try {
          if (jobName === 'start-orchestration') {
            const jobData = job.data as unknown;
            if (typeof jobData === 'object' && jobData !== null && 'prompt' in jobData && 'repository' in jobData) {
              await processOrchestrationJob({
                ...(jobData as OrchestrationJobData),
                redisJobId: job.id
              });
            } else {
              throw new Error('Invalid orchestration job data: missing required fields');
            }
          } else if (jobName === 'process-webhook') {
            const jobData = job.data as { webhookData?: unknown };
            if (jobData && typeof jobData === 'object' && 'webhookData' in jobData) {
              const webhookData = jobData.webhookData;
              if (typeof webhookData === 'object' && webhookData !== null && 'id' in webhookData && 'status' in webhookData) {
                await orchestratorService.processWebhookEvent(webhookData as { id: string; status: string; [key: string]: unknown });
                logger.info('Webhook job completed', { jobId: job.id });
              } else {
                throw new Error('Invalid webhook data: missing required fields');
              }
            } else {
              throw new Error('Invalid webhook job data: missing webhookData');
            }
          } else {
            throw new Error(`Unknown job type: ${jobName}`);
          }
        } catch (error) {
          logger.error('Orchestrator job failed', {
            jobId: job.id,
            jobName,
            error: error instanceof Error ? error.message : String(error)
          });
          throw error;
        }
      },
      { concurrency: 5 }
    );

    if (redisWorker) {
      redisWorker.on('completed', (job) => {
        logger.info('Redis worker job completed', { jobId: job.id });
      });

      redisWorker.on('failed', (job, error) => {
        logger.error('Redis worker job failed', {
          jobId: job?.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });

      redisWorker.on('error', (error) => {
        logger.error('Redis worker error', { error: error instanceof Error ? error.message : String(error) });
      });

      logger.info('Redis worker started', {
        queue: 'orchestrator',
        concurrency: 5,
        redisHost: process.env['REDIS_HOST'] || 'localhost'
      });
    }
  } catch (error) {
    logger.warn('Failed to initialize Redis worker - using database-only mode', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

// Start heartbeat and outbox processor (always available)
// Initialize models cache on startup
const apiKey = process.env['CURSOR_API_KEY'];
if (apiKey) {
  refreshModelsCache(apiKey).catch((error) => {
    logger.warn('Failed to refresh models cache on startup', {
      error: error instanceof Error ? error.message : String(error)
    });
  });
} else {
  logger.warn('No CURSOR_API_KEY found - models cache will use fallback models');
}

// Refresh models cache every hour
if (apiKey) {
  setInterval(() => {
    refreshModelsCache(apiKey).catch((error) => {
      logger.warn('Failed to refresh models cache', {
        error: error instanceof Error ? error.message : String(error)
      });
    });
  }, 60 * 60 * 1000); // Every hour
}

startHeartbeat();
startOutboxProcessor();

// Initialize Redis worker (optional)
void initializeRedisWorker();

logger.info('Orchestrator worker started', {
  mode: isRedisAvailable() ? 'redis+outbox' : 'outbox-only',
  redisEnabled: isRedisEnabled(),
  redisAvailable: isRedisAvailable()
});

// Graceful shutdown
async function shutdown(): Promise<void> {
  logger.info('Shutting down worker');
  stopHeartbeat();
  stopOutboxProcessor();

  if (redisWorker) {
    await redisWorker.close();
    redisWorker = null;
  }

  await closeQueue();
  process.exit(0);
}

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, closing worker');
  void shutdown();
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, closing worker');
  void shutdown();
});


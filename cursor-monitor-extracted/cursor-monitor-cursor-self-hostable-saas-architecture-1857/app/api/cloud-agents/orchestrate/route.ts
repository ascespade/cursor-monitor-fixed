/**
 * GET /api/cloud-agents/orchestrate
 * POST /api/cloud-agents/orchestrate
 *
 * Purpose:
 * - GET: List all orchestration jobs
 * - POST: Start new orchestration with options
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../_utils/get-api-key';
import { getOrchestratorQueue } from '@/features/cloud-agents/orchestrator/queue/redis';
import { logger } from '@/shared/utils/logger';
import type { OrchestrationRequest, OrchestrationResponse, OrchestrationOptions } from '@/features/cloud-agents/types/orchestration';
import { ORCHESTRATION_LIMITS, checkOrchestrationLimits } from '@/config/orchestration-limits';
import { checkRateLimit } from '@/shared/utils/rate-limiter';
import type { OrchestrationJobData } from '@/features/cloud-agents/types/orchestration-queue';

/**
 * Get Supabase client for server-side operations
 * Uses service role key for write operations, falls back to anon key for read operations
 */
function getSupabaseClient(requireServiceKey = false) {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error('Supabase configuration missing. NEXT_PUBLIC_SUPABASE_URL must be set.');
  }

  // For write operations, service role key is required
  if (requireServiceKey && !supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for write operations. Please set it in Vercel environment variables.');
  }

  // Prefer service role key for write operations, fall back to anon key for read operations
  const supabaseKey = supabaseServiceKey || supabaseAnonKey;
  
  if (!supabaseKey) {
    throw new Error('Supabase configuration missing. SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_KEY) or NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.');
  }

  return createClient(supabaseUrl, supabaseKey);
}

const DEFAULT_OPTIONS: OrchestrationOptions = {
  mode: 'AUTO',
  maxParallelAgents: 3,
  maxIterations: 20,
  enableAutoFix: true,
  enableTesting: true,
  enableValidation: true,
  taskSize: 'auto',
  priority: 'balanced'
};

// Use centralized limits
const LIMITS = ORCHESTRATION_LIMITS;

export async function GET(request: Request): Promise<NextResponse> {
  try {
    // API key is optional for GET (read-only operation)
    let apiKey: string | undefined;
    try {
      apiKey = getApiKeyFromRequest(request);
    } catch {
      // API key not required for listing orchestrations
      apiKey = undefined;
    }

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

    return ok({
      orchestrations: mappedOrchestrations,
      total: count || 0,
      limit,
      offset
    });
  } catch (error) {
    logger.error('Error in GET /api/cloud-agents/orchestrate', { error });
    return handleApiError(error);
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    
    // Rate limiting per API key (multi-tenant safety)
    const rateLimitResult = await checkRateLimit(apiKey, {
      windowMs: 60 * 60 * 1000, // 1 hour
      maxRequests: 20, // 20 orchestrations per hour per API key
      keyPrefix: 'orchestration:'
    });

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: rateLimitResult.retryAfter,
          resetAt: rateLimitResult.resetAt.toISOString()
        },
        {
          status: 429,
          headers: {
            'Retry-After': String(rateLimitResult.retryAfter || 3600),
            'X-RateLimit-Limit': '20',
            'X-RateLimit-Remaining': String(rateLimitResult.remaining),
            'X-RateLimit-Reset': String(Math.floor(rateLimitResult.resetAt.getTime() / 1000))
          }
        }
      );
    }

    const body = (await request.json()) as OrchestrationRequest;

    if (!body.prompt || body.prompt.trim().length === 0) {
      return handleApiError(new Error('prompt is required'));
    }

    if (!body.repository) {
      return handleApiError(new Error('repository is required'));
    }

    // Merge options with defaults
    const options: OrchestrationOptions = {
      ...DEFAULT_OPTIONS,
      ...body.options
    };

    // Validate mode-specific requirements
    if (options.mode === 'BATCH' && (!options.maxParallelAgents || options.maxParallelAgents < 1)) {
      return handleApiError(new Error('maxParallelAgents must be at least 1 for BATCH mode'));
    }

    // Estimate agents for this orchestration
    const estimatedAgents = options.mode === 'SINGLE_AGENT' 
      ? 1 
      : (options.maxParallelAgents || 3) * Math.ceil(body.prompt.length / 5000);

    // Check limits
    const limitCheck = checkOrchestrationLimits(
      body.prompt.length,
      estimatedAgents,
      options.mode
    );

    if (!limitCheck.allowed) {
      return NextResponse.json(
        { success: false, error: limitCheck.reason },
        { status: 429 }
      );
    }

    // Validate daily limits
    const dailyLimitError = await validateDailyLimits(body, estimatedAgents);
    if (dailyLimitError) {
      return NextResponse.json(
        { success: false, error: dailyLimitError.message || 'Daily limit exceeded' },
        { status: 429 }
      );
    }

    logger.info('Starting orchestration', {
      promptLength: body.prompt.length,
      repository: body.repository,
      mode: options.mode,
      maxParallelAgents: options.maxParallelAgents
    });

    // Create orchestration record in Supabase (system of record)
    // This must succeed - it's the primary record of intent
    // Require service role key for write operations
    let supabase;
    try {
      supabase = getSupabaseClient(true); // Require service role key for writes
    } catch (supabaseError) {
      logger.error('Failed to create Supabase client with service role key', { 
        error: supabaseError instanceof Error ? supabaseError.message : String(supabaseError),
        hasServiceKey: !!process.env['SUPABASE_SERVICE_ROLE_KEY'],
        hasServiceKeyAlt: !!process.env['SUPABASE_SERVICE_KEY']
      });
      return handleApiError(new Error('SUPABASE_SERVICE_ROLE_KEY is required for creating orchestrations. Please set it in Vercel environment variables.'));
    }
    
    const { data: orchestrationRecord, error: createError } = await supabase
      .from('orchestrations')
      .insert({
        status: 'queued',
        mode: options.mode,
        repository_url: body.repository,
        ref: body.ref || 'main',
        prompt: body.prompt,
        prompt_length: body.prompt.length,
        model: body.model || null, // null = Auto mode (let API choose - recommended)
        options: options,
        metadata: {
          ...((options as any).metadata || {}),
          apiKeyPrefix: apiKey ? apiKey.substring(0, 10) + '...' : undefined // Store partial key for reference (not full key for security)
        },
        started_at: new Date().toISOString()
      })
      .select()
      .single();

    if (createError || !orchestrationRecord) {
      logger.error('Failed to create orchestration record in Supabase', { error: createError });
      return handleApiError(new Error(`Failed to create orchestration: ${createError?.message || 'Unknown error'}`));
    }

    const orchestrationId = orchestrationRecord.id;

    // Create initial event for timeline
    await supabase.from('orchestration_events').insert({
      orchestration_id: orchestrationId,
      level: 'info',
      step_key: 'input_validated',
      step_phase: 'end',
      message: 'Input validated and orchestration record created',
      payload: { repository: body.repository, mode: options.mode }
    });

    // Try to enqueue to Redis (optional optimization)
    let queueSuccess = false;
    let redisJobId: string | null = null;

    try {
      const orchestratorQueue = getOrchestratorQueue();
      if (orchestratorQueue) {
        const job = await orchestratorQueue.add(
          'start-orchestration',
          {
            prompt: body.prompt,
            repository: body.repository,
            ref: body.ref || 'main',
            model: body.model || null, // null = Auto mode (let API choose - recommended)
            apiKey,
            options,
            orchestrationId, // Link to Supabase record
            timestamp: new Date().toISOString()
          },
          {
            attempts: 1,
            removeOnComplete: { count: 10 },
            removeOnFail: { count: 100 }
          }
        );

        redisJobId = job.id || null;
        queueSuccess = true;
        logger.info('Orchestration job queued to Redis', { jobId: redisJobId, orchestrationId, mode: options.mode });

        // Log event
        await supabase.from('orchestration_events').insert({
          orchestration_id: orchestrationId,
          level: 'info',
          step_key: 'job_queued',
          step_phase: 'end',
          message: 'Job queued to Redis successfully',
          payload: { redisJobId }
        });
      } else {
        // Redis not available - this is expected and normal
        logger.info('Redis not available - using Supabase outbox only', {
          orchestrationId,
          note: 'Job will be processed via Supabase outbox'
        });

        // Log event
        await supabase.from('orchestration_events').insert({
          orchestration_id: orchestrationId,
          level: 'info',
          step_key: 'job_queued',
          step_phase: 'end',
          message: 'Redis not configured - using Supabase outbox',
          payload: { source: 'outbox-only' }
        });
      }
    } catch (queueError) {
      // Redis enqueue failure is expected when Redis is unavailable - not a fatal error
      logger.warn('Could not enqueue job to Redis (expected when Redis unavailable)', {
        error: queueError instanceof Error ? queueError.message : 'Unknown error',
        orchestrationId,
        note: 'Job will be processed via Supabase outbox'
      });

      // Log event
      await supabase.from('orchestration_events').insert({
        orchestration_id: orchestrationId,
        level: 'warn',
        step_key: 'job_queued',
        step_phase: 'end',
        message: 'Redis queue not accessible - using Supabase outbox fallback',
        payload: { error: queueError instanceof Error ? queueError.message : 'Unknown error' }
      });
    }

    // Always create outbox job as fallback (or primary if Redis failed)
    const { error: outboxError } = await supabase
      .from('orchestration_outbox_jobs')
      .insert({
        orchestration_id: orchestrationId,
        type: 'start-orchestration',
        payload: {
          prompt: body.prompt,
          repository: body.repository,
          ref: body.ref || 'main',
          model: body.model || null, // null = Auto mode (let API choose - recommended)
          apiKey,
          options,
          redisJobId // Include Redis job ID if available
        },
        status: queueSuccess ? 'completed' : 'pending', // If Redis succeeded, mark as completed
        next_run_at: queueSuccess ? new Date().toISOString() : new Date().toISOString()
      });

    if (outboxError) {
      logger.error('Failed to create outbox job', { error: outboxError, orchestrationId });
      // Non-fatal - orchestration record exists, worker can poll Supabase directly
    } else {
      // Log event
      await supabase.from('orchestration_events').insert({
        orchestration_id: orchestrationId,
        level: 'info',
        step_key: 'outbox_created',
        step_phase: 'end',
        message: queueSuccess 
          ? 'Outbox job created (Redis also succeeded)' 
          : 'Outbox job created (primary mechanism)',
        payload: { queueSuccess }
      });
    }

    // Always return success - orchestration record exists in Supabase
    const response: OrchestrationResponse = {
      jobId: orchestrationId, // Use Supabase ID as the job ID
      status: 'queued',
      mode: options.mode,
      message: queueSuccess
        ? getModeMessage(options.mode)
        : `${getModeMessage(options.mode)} Job accepted for processing by local orchestrator worker via Supabase outbox.`,
      estimatedTasks: options.mode === 'SINGLE_AGENT' ? 1 : undefined,
      estimatedDuration: getEstimatedDuration(options.mode, body.prompt.length)
    };

    // Return 202 Accepted if Redis was not accessible, 200 OK if it was
    return NextResponse.json(
      {
        success: true,
        data: response
      },
      { status: queueSuccess ? 200 : 202 }
    );
  } catch (error) {
    logger.error('Error in POST /api/cloud-agents/orchestrate', { 
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    return handleApiError(error);
  }
}

/**
 * Validate daily limits before starting orchestration
 * In hybrid deployments, Redis may not be accessible, so validation is best-effort
 */
async function validateDailyLimits(
  body: OrchestrationRequest,
  estimatedAgents: number
): Promise<Error | null> {
  try {
    // Skip Redis connection during build
    if (process.env['NEXT_PHASE'] === 'phase-production-build') {
      return null; // Allow build to proceed
    }

    const orchestratorQueue = getOrchestratorQueue();
    
    // If Redis is not available, validate using database instead
    if (!orchestratorQueue) {
      logger.info('Redis not available - validating daily limits using database');
      
      // Validate using Supabase orchestrations table
      const supabase = getSupabaseClient();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const { count, error } = await supabase
        .from('orchestrations')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', today.toISOString());
      
      if (error) {
        logger.warn('Failed to validate daily limits from database', { error: error.message });
        return null; // Don't block on validation errors
      }
      
      if ((count || 0) >= LIMITS.MAX_ORCHESTRATIONS_PER_DAY) {
        return new Error(
          `Daily limit reached. Maximum ${LIMITS.MAX_ORCHESTRATIONS_PER_DAY} orchestrations per day.`
        );
      }
      
      return null; // Validation passed
    }

    // Count today's orchestrations from Redis
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let jobs;
    try {
      jobs = await orchestratorQueue.getJobs(['completed', 'active', 'waiting'], 0, 1000);
    } catch (jobError) {
      // Redis query failure - skip validation
      logger.warn('Skipping daily limit validation - could not query Redis', {
        error: jobError instanceof Error ? jobError.message : 'Unknown error'
      });
      return null; // Don't block orchestration
    }

    const todayJobs = jobs.filter(job => {
      const processedOn = job.processedOn;
      if (!processedOn) return false;
      const jobDate = new Date(processedOn);
      return jobDate >= today;
    });

    // Check orchestrations per day
    if (todayJobs.length >= LIMITS.MAX_ORCHESTRATIONS_PER_DAY) {
      return new Error(
        `Daily limit reached. Maximum ${LIMITS.MAX_ORCHESTRATIONS_PER_DAY} orchestrations per day.`
      );
    }

    // Count total agents today (simplified - would need better tracking)
    const totalAgentsToday = todayJobs.reduce((sum, job) => {
      const data = job.data as OrchestrationJobData;
      return sum + (data.activeAgents || 0);
    }, 0);

    if (totalAgentsToday + estimatedAgents > LIMITS.MAX_TOTAL_AGENTS_PER_DAY) {
      return new Error(
        `Daily agent limit reached. Maximum ${LIMITS.MAX_TOTAL_AGENTS_PER_DAY} agents per day. You've used ${totalAgentsToday}, trying to add ${estimatedAgents}.`
      );
    }

    return null;
  } catch (error) {
    // Any other error - don't block orchestration
    logger.warn('Failed to validate daily limits - allowing orchestration to proceed', { error });
    return null; // Don't block on validation errors
  }
}

function getModeMessage(mode: OrchestrationMode): string {
  switch (mode) {
    case 'SINGLE_AGENT':
      return 'Orchestration started. Full prompt sent to single agent. System will monitor until completion.';
    case 'PIPELINE':
      return 'Orchestration started. Tasks will execute sequentially (one after another).';
    case 'BATCH':
      return 'Orchestration started. Tasks will execute in parallel for faster completion.';
    case 'AUTO':
      return 'Orchestration started. System will automatically decide the best execution strategy.';
    default:
      return 'Orchestration started.';
  }
}

function getEstimatedDuration(mode: OrchestrationMode, promptLength: number): string {
  const estimatedTasks = Math.ceil(promptLength / 500); // Rough estimate
  
  switch (mode) {
    case 'SINGLE_AGENT':
      return `${Math.ceil(promptLength / 1000)}-${Math.ceil(promptLength / 500)} hours`;
    case 'PIPELINE':
      return `${estimatedTasks * 2}-${estimatedTasks * 3} hours`;
    case 'BATCH':
      return `${Math.ceil(estimatedTasks / 3) * 2}-${Math.ceil(estimatedTasks / 3) * 3} hours`;
    case 'AUTO':
      return 'Varies based on task complexity';
    default:
      return 'Unknown';
  }
}

function mapJobStateToStatus(jobState: string): 'ACTIVE' | 'COMPLETED' | 'ERROR' | 'TIMEOUT' {
  switch (jobState) {
    case 'completed':
      return 'COMPLETED';
    case 'failed':
      return 'ERROR';
    case 'active':
    case 'waiting':
    case 'delayed':
      return 'ACTIVE';
    default:
      return 'ACTIVE';
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
      return 'ACTIVE';
    default:
      return 'ACTIVE';
  }
}

import type { OrchestrationMode } from '@/features/cloud-agents/types/orchestration';

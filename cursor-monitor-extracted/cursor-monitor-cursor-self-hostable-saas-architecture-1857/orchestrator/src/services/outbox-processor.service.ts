/**
 * Outbox Processor Service
 * 
 * Processes jobs from Supabase outbox table when Redis is not available
 * Uses optimistic locking to prevent duplicate processing
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';
import { orchestratorService } from './orchestrator.service';
import { WORKER_ID } from './heartbeat.service';

const supabaseUrl = process.env['SUPABASE_URL'] || process.env['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseKey = process.env['SUPABASE_SERVICE_KEY'] || process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase configuration missing. SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_KEY (or SUPABASE_SERVICE_ROLE_KEY) must be set.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

const POLL_INTERVAL_MS = 5000; // Poll every 5 seconds
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 60000; // 1 minute

let pollInterval: NodeJS.Timeout | null = null;

interface OutboxJob {
  id: string;
  orchestration_id: string;
  type: string;
  payload: any;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  last_error: string | null;
}

async function processOutboxJob(job: OutboxJob): Promise<void> {
  logger.info('Processing outbox job', { 
    jobId: job.id, 
    orchestrationId: job.orchestration_id,
    type: job.type,
    attempts: job.attempts 
  });

  try {
    // Update orchestration status to running
    await supabase
      .from('orchestrations')
      .update({ 
        status: 'running',
        updated_at: new Date().toISOString()
      })
      .eq('id', job.orchestration_id);

    // Log event
    await supabase.from('orchestration_events').insert({
      orchestration_id: job.orchestration_id,
      level: 'info',
      step_key: 'worker_received',
      step_phase: 'end',
      message: 'Worker received job from outbox',
      payload: { jobId: job.id, workerId: WORKER_ID }
    });

    if (job.type === 'start-orchestration') {
      const { prompt, repository, ref, model, apiKey, options } = job.payload;

      // Step 1: Validate payload structure
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new Error('VALIDATION_ERROR: Prompt is required and must be a non-empty string');
      }

      if (!repository || typeof repository !== 'string' || repository.trim().length === 0) {
        throw new Error('VALIDATION_ERROR: Repository URL is required and must be a non-empty string');
      }

      // Step 2: Validate prompt length
      if (prompt.length > 100000) {
        throw new Error('VALIDATION_ERROR: Prompt exceeds maximum length of 100,000 characters');
      }

      // Step 3: Validate repository URL format (basic check)
      const repoUrlPattern = /^(https?:\/\/)?([\w\.-]+\.)+[\w-]+(\/[\w\.-]+)*\/?$/;
      if (!repoUrlPattern.test(repository) && !repository.includes('github.com') && !repository.includes('gitlab.com')) {
        logger.warn('Repository URL format may be invalid', {
          repository,
          orchestrationId: job.orchestration_id
        });
      }

      // Step 4: Validate ref
      const normalizedRef = (ref || 'main').trim();
      if (normalizedRef.length === 0 || normalizedRef.length > 255) {
        throw new Error('VALIDATION_ERROR: Ref must be between 1 and 255 characters');
      }

      // Step 5: Set API key temporarily (with validation)
      const finalApiKey = apiKey || process.env['CURSOR_API_KEY'];
      if (!finalApiKey || typeof finalApiKey !== 'string' || finalApiKey.length < 10) {
        throw new Error('VALIDATION_ERROR: API key is required and must be at least 10 characters');
      }

      if (apiKey) {
        process.env['CURSOR_API_KEY'] = apiKey;
        logger.info('CURSOR_API_KEY set from job payload', {
          orchestrationId: job.orchestration_id,
          keyLength: apiKey.length
        });
      } else {
        logger.warn('No API key in job payload, using process.env', {
          orchestrationId: job.orchestration_id,
          hasEnvKey: !!process.env['CURSOR_API_KEY']
        });
      }

      // Step 6: Log execution start with metadata
      // Note: model can be null/undefined for Auto mode (recommended)
      logger.info('Starting orchestration execution', {
        orchestrationId: job.orchestration_id,
        repository: repository.trim(),
        promptLength: prompt.length,
        model: model || 'AUTO (null - API will choose)',
        mode: options?.mode || 'AUTO',
        hasApiKey: !!finalApiKey,
        apiKeyPrefix: finalApiKey ? finalApiKey.substring(0, 10) + '...' : 'none',
        validation: 'passed'
      });

      // Step 7: Start orchestration (model validation happens inside task-dispatcher)
      // Pass model as-is (null/undefined = Auto mode, which is recommended)
      logger.info('Calling orchestratorService.startOrchestration', {
        orchestrationId: job.orchestration_id,
        repository: repository.trim(),
        ref: normalizedRef,
        model: model || 'AUTO (null - API will choose)'
      });

      const result = await orchestratorService.startOrchestration(
        prompt,
        repository.trim(),
        normalizedRef,
        model,
        {
          ...(options || {}),
          orchestrationId: job.orchestration_id // Pass orchestrationId for tracking
        }
      );

      logger.info('Orchestration started successfully', {
        orchestrationId: job.orchestration_id,
        masterAgentId: result.masterAgentId,
        totalTasks: result.taskPlan?.tasks?.length || 0,
        agentId: result.agentId
      });

      // Update orchestration with master agent ID and task plan
      const totalTasks = result.taskPlan?.tasks?.length || 0;
      await supabase
        .from('orchestrations')
        .update({
          master_agent_id: result.masterAgentId,
          status: 'running',
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          tasks_total: totalTasks,
          tasks_completed: 0,
          active_agents: result.agentId ? 1 : 0,
          // Store task plan in metadata for later reference
          metadata: {
            ...(job.payload.options?.metadata || {}),
            taskPlan: result.taskPlan
          }
        })
        .eq('id', job.orchestration_id);

      // Log event
      await supabase.from('orchestration_events').insert({
        orchestration_id: job.orchestration_id,
        level: 'info',
        step_key: 'orchestration_started',
        step_phase: 'end',
        message: 'Orchestration started successfully',
        payload: { 
          masterAgentId: result.masterAgentId, 
          totalTasks,
          taskPlan: result.taskPlan,
          agentId: result.agentId
        }
      });

      // Mark job as completed
      await supabase
        .from('orchestration_outbox_jobs')
        .update({
          status: 'completed',
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      logger.info('Outbox job completed', { jobId: job.id, orchestrationId: job.orchestration_id });
    } else {
      throw new Error(`Unknown outbox job type: ${job.type}`);
    }
  } catch (error) {
    // Deep error logging
    logger.error('Outbox job execution failed', {
      jobId: job.id,
      orchestrationId: job.orchestration_id,
      errorName: error instanceof Error ? error.name : 'Unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      errorType: typeof error,
      errorString: String(error),
      errorKeys: error instanceof Error ? Object.keys(error) : (typeof error === 'object' && error !== null ? Object.keys(error) : []),
      fullError: error
    });

    // Extract meaningful error message with full details
    let errorMessage: string;
    let errorDetails: Record<string, unknown> = {};

    if (error instanceof Error) {
      errorMessage = error.message || error.name || 'Unknown error';
      errorDetails = {
        name: error.name,
        message: error.message,
        stack: error.stack,
        cause: error.cause
      };
      
      // Include stack trace first line in message
      if (error.stack) {
        const firstStackLine = error.stack.split('\n')[1]?.trim();
        if (firstStackLine) {
          errorMessage = `${errorMessage} (${firstStackLine})`;
        }
      }
    } else if (typeof error === 'object' && error !== null) {
      // Try to extract useful information from error object
      try {
        const errorObj = error as Record<string, unknown>;
        errorDetails = { ...errorObj };
        
        if (errorObj.message && typeof errorObj.message === 'string') {
          errorMessage = errorObj.message;
        } else if (errorObj.error && typeof errorObj.error === 'string') {
          errorMessage = errorObj.error;
        } else if (errorObj.code && typeof errorObj.code === 'string') {
          errorMessage = `Error code: ${errorObj.code}`;
        } else {
          // Try to stringify, but limit length
          const errorStr = JSON.stringify(error, Object.getOwnPropertyNames(error));
          errorMessage = errorStr.length > 500 ? errorStr.substring(0, 500) + '...' : errorStr;
        }
      } catch (stringifyError) {
        errorMessage = `Error serialization failed: ${stringifyError instanceof Error ? stringifyError.message : String(stringifyError)}`;
        errorDetails = { originalError: String(error) };
      }
    } else {
      errorMessage = String(error) || 'Unknown error';
      errorDetails = { value: error };
    }

    const newAttempts = job.attempts + 1;
    const shouldRetry = newAttempts < job.max_attempts;

    // Extract error code from error
    let errorCode = 'UNKNOWN_ERROR';
    if (error instanceof Error) {
      if (error.message.includes('AUTH_FAILED') || error.message.includes('CURSOR_API_KEY') || error.message.includes('Invalid API key')) {
        errorCode = 'AUTH_FAILED';
      } else if (error.message.includes('repository') || error.message.includes('clone')) {
        errorCode = 'REPO_CLONE_FAILED';
      } else if (error.message.includes('CURSOR_API_ERROR') || error.message.includes('api.cursor.com')) {
        errorCode = 'CURSOR_API_ERROR';
      } else if (error.message.includes('RATE_LIMIT') || error.message.includes('429')) {
        errorCode = 'RATE_LIMIT';
      } else if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
        errorCode = 'NETWORK_ERROR';
      }
    }

    logger.error('Outbox job failed', { 
      jobId: job.id, 
      orchestrationId: job.orchestration_id,
      error: errorMessage,
      errorCode,
      attempts: newAttempts,
      willRetry: shouldRetry,
      errorDetails: error instanceof Error ? { name: error.name, stack: error.stack } : error
    });

    // Log error event with improved message and error code
    await supabase.from('orchestration_events').insert({
      orchestration_id: job.orchestration_id,
      level: 'error',
      step_key: 'worker_error',
      step_phase: 'end',
      message: `Job processing failed: ${errorMessage}`,
      payload: { 
        jobId: job.id, 
        attempts: newAttempts, 
        willRetry: shouldRetry,
        errorCode,
        errorMessage,
        errorDetails,
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          cause: error.cause
        } : errorDetails
      }
    });

    if (shouldRetry) {
      // Calculate exponential backoff
      const delayMs = RETRY_DELAY_MS * Math.pow(2, newAttempts - 1);
      const nextRunAt = new Date(Date.now() + delayMs).toISOString();

      // Update job for retry
      await supabase
        .from('orchestration_outbox_jobs')
        .update({
          status: 'pending',
          attempts: newAttempts,
          next_run_at: nextRunAt,
          last_error: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);
    } else {
      // Mark as failed
      await supabase
        .from('orchestration_outbox_jobs')
        .update({
          status: 'failed',
          attempts: newAttempts,
          last_error: errorMessage,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.id);

      // Extract error code from error
      let errorCode = 'UNKNOWN_ERROR';
      if (error instanceof Error) {
        if (error.message.includes('CURSOR_API_KEY') || error.message.includes('Invalid API key')) {
          errorCode = 'AUTH_FAILED';
        } else if (error.message.includes('repository') || error.message.includes('clone')) {
          errorCode = 'REPO_CLONE_FAILED';
        } else if (error.message.includes('Cursor API') || error.message.includes('api.cursor.com')) {
          errorCode = 'CURSOR_API_ERROR';
        } else if (error.message.includes('rate limit') || error.message.includes('429')) {
          errorCode = 'RATE_LIMIT';
        } else if (error.message.includes('fetch failed') || error.message.includes('ECONNREFUSED')) {
          errorCode = 'NETWORK_ERROR';
        }
      }

      // Update orchestration status with error details
      await supabase
        .from('orchestrations')
        .update({
          status: 'error',
          error_code: errorCode,
          error_message: errorMessage,
          error_summary: `Job failed after ${newAttempts} attempt${newAttempts > 1 ? 's' : ''}: ${errorMessage}`,
          updated_at: new Date().toISOString()
        })
        .eq('id', job.orchestration_id);
    }

    throw error;
  }
}

async function pollOutbox(): Promise<void> {
  try {
    const now = new Date().toISOString();

    // Find pending jobs that are ready to run (optimistic locking)
    const { data: jobs, error } = await supabase
      .from('orchestration_outbox_jobs')
      .select('*')
      .eq('status', 'pending')
      .lte('next_run_at', now)
      .order('created_at', { ascending: true })
      .limit(10); // Process up to 10 jobs per poll

    if (error) {
      logger.warn('Error querying outbox', { error: error.message });
      return;
    }

    if (!jobs || jobs.length === 0) {
      return; // No jobs to process
    }

    // Process each job with optimistic locking
    for (const job of jobs) {
      try {
        // Try to claim the job (optimistic locking)
        const { data: updated, error: updateError } = await supabase
          .from('orchestration_outbox_jobs')
          .update({
            status: 'processing',
            worker_id: WORKER_ID,
            updated_at: new Date().toISOString()
          })
          .eq('id', job.id)
          .eq('status', 'pending') // Only update if still pending
          .select()
          .single();

        if (updateError || !updated) {
          // Another worker claimed it, skip
          continue;
        }

        // Process the job
        await processOutboxJob(updated as OutboxJob);
      } catch (error) {
        logger.error('Error processing outbox job', {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error)
        });
        // Continue with next job
      }
    }
  } catch (error) {
    logger.error('Error in outbox poll', {
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export function startOutboxProcessor(): void {
  if (pollInterval) {
    logger.warn('Outbox processor already started');
    return;
  }

  // Poll immediately
  void pollOutbox();

  // Set up interval
  pollInterval = setInterval(() => {
    void pollOutbox();
  }, POLL_INTERVAL_MS);

  logger.info('Outbox processor started', { interval: POLL_INTERVAL_MS });
}

export function stopOutboxProcessor(): void {
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
    logger.info('Outbox processor stopped');
  }
}


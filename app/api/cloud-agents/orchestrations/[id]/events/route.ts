/**
 * GET /api/cloud-agents/orchestrations/[id]/events
 * 
 * Returns orchestration events for timeline visualization
 */

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { OrchestrationEvent, TimelineStepEvent } from '@/features/cloud-agents/types/orchestration-events';
import { humanizeError, getLatestErrorFromDatabase } from '@/shared/utils/error-humanizer';

export const dynamic = 'force-dynamic';

function getSupabaseClient() {
  const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL'];
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY'] || process.env['SUPABASE_SERVICE_KEY'];
  const supabaseAnonKey = process.env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

  if (!supabaseUrl) {
    throw new Error('Supabase configuration missing. NEXT_PUBLIC_SUPABASE_URL must be set.');
  }

  // Always prefer service key for server-side API routes to bypass RLS
  // This ensures we get all events, not just those visible to the anon key
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
  let orchestrationId: string | undefined;
  try {
    const resolvedParams = await Promise.resolve(params);
    orchestrationId = resolvedParams.id;

    if (!orchestrationId) {
      return NextResponse.json(
        { success: false, error: { code: 'VALIDATION_ERROR', message: 'Orchestration ID is required' } },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // Fetch orchestration details
    const { data: orchestration, error: orchError } = await supabase
      .from('orchestrations')
      .select('*')
      .eq('id', orchestrationId)
      .single();

    if (orchError || !orchestration) {
      return NextResponse.json(
        { success: false, error: { code: 'NOT_FOUND', message: `Orchestration not found: ${orchError?.message || 'Unknown error'}` } },
        { status: 404 }
      );
    }

    // Normalize orchestration data to ensure it's serializable
    let normalizedOptions: Record<string, unknown> = {};
    try {
      if (orchestration.options) {
        if (typeof orchestration.options === 'string') {
          normalizedOptions = JSON.parse(orchestration.options);
        } else if (typeof orchestration.options === 'object' && orchestration.options !== null) {
          normalizedOptions = orchestration.options as Record<string, unknown>;
        }
      }
    } catch {
      normalizedOptions = {};
    }

    const normalizedOrchestration = {
      id: String(orchestration.id || ''),
      status: String(orchestration.status || ''),
      mode: String(orchestration.mode || ''),
      repository_url: String(orchestration.repository_url || ''),
      ref: String(orchestration.ref || 'main'),
      master_agent_id: orchestration.master_agent_id ? String(orchestration.master_agent_id) : null,
      prompt: String(orchestration.prompt || ''),
      prompt_length: Number(orchestration.prompt_length || 0),
      model: String(orchestration.model || ''),
      options: normalizedOptions,
      tasks_total: Number(orchestration.tasks_total || 0),
      tasks_completed: Number(orchestration.tasks_completed || 0),
      active_agents: Number(orchestration.active_agents || 0),
      started_at: orchestration.started_at ? String(orchestration.started_at) : null,
      completed_at: orchestration.completed_at ? String(orchestration.completed_at) : null,
      created_at: orchestration.created_at ? String(orchestration.created_at) : null,
      updated_at: orchestration.updated_at ? String(orchestration.updated_at) : null,
      error_summary: orchestration.error_summary ? String(orchestration.error_summary) : null
    };

    // Fetch events - get all events to ensure we have the latest
    // Service role key is used to bypass RLS and get all events
    const { data: events, error: eventsError } = await supabase
      .from('orchestration_events')
      .select('*')
      .eq('orchestration_id', orchestrationId)
      .order('created_at', { ascending: true });

    if (eventsError) {
      console.error('Failed to fetch events', { error: eventsError.message, orchestrationId });
      return NextResponse.json(
        { success: false, error: { code: 'DATABASE_ERROR', message: `Failed to fetch events: ${eventsError.message}` } },
        { status: 500 }
      );
    }

    // Normalize events - ensure all fields are properly typed
    const normalizedEvents: OrchestrationEvent[] = (events || []).map((event: any): OrchestrationEvent => {
      // Handle payload - can be object, string, or null
      let payload: Record<string, unknown> = {};
      if (event.payload) {
        if (typeof event.payload === 'string') {
          try {
            payload = JSON.parse(event.payload);
          } catch {
            payload = {};
          }
        } else if (typeof event.payload === 'object' && event.payload !== null) {
          payload = event.payload;
        }
      }

      return {
        id: String(event.id || ''),
        orchestration_id: String(event.orchestration_id || orchestrationId),
        level: (['info', 'warn', 'error', 'debug'].includes(event.level) ? event.level : 'info') as 'info' | 'warn' | 'error' | 'debug',
        step_key: String(event.step_key || 'unknown'),
        step_phase: (['start', 'progress', 'end'].includes(event.step_phase) ? event.step_phase : null) as 'start' | 'progress' | 'end' | null,
        message: String(event.message || ''),
        payload,
        created_at: String(event.created_at || new Date().toISOString())
      };
    });

    // Group events by step_key to build timeline
    const steps = new Map<string, TimelineStepEvent>();

    // Define step order
    const stepOrder = [
      'input_validated',
      'orchestration_created',
      'job_queued',
      'outbox_created',
      'worker_received',
      'cursor_api_fetch',
      'analyzer_decision',
      'follow_up_sent',
      'waiting_webhook',
      'test_executed',
      'orchestration_started',
      'completed',
      'error'
    ];

    // Process events - with error handling
    try {
      normalizedEvents.forEach((event: OrchestrationEvent) => {
        try {
          const stepKey = event.step_key || 'unknown';
          
          if (!steps.has(stepKey)) {
            steps.set(stepKey, {
              stepKey,
              status: 'pending',
              progressEvents: []
            });
          }

          const step = steps.get(stepKey)!;

          if (event.step_phase === 'start') {
            step.startEvent = event;
            step.status = 'running';
          } else if (event.step_phase === 'progress') {
            step.progressEvents.push(event);
            step.status = 'running';
          } else if (event.step_phase === 'end') {
            // Use the latest end event (since events are processed in ascending order,
            // the last one processed will be the most recent)
            if (!step.endEvent || new Date(event.created_at) > new Date(step.endEvent.created_at)) {
              step.endEvent = event;
            }
            if (event.level === 'error') {
              step.status = 'error';
            } else if (step.status !== 'error') {
              // Only set to success if not already in error state
              step.status = 'success';
            }
          } else {
            // Events without phase - mark as progress
            step.progressEvents.push(event);
            if (step.status === 'pending') {
              step.status = 'running';
            }
          }
        } catch (eventError) {
          console.error('Error processing event', { event, error: eventError });
          // Continue processing other events
        }
      });
    } catch (processError) {
      console.error('Error in event processing loop', { error: processError });
      throw processError;
    }

    // Build timeline: first ordered steps, then any remaining steps
    let timeline: Array<{
      stepKey: string;
      stepName: string;
      status: 'pending' | 'running' | 'success' | 'error';
      startEvent?: OrchestrationEvent;
      progressEvents: OrchestrationEvent[];
      endEvent?: OrchestrationEvent;
      logs: OrchestrationEvent[];
    }> = [];

    try {
      const orderedSteps = stepOrder
        .filter(stepKey => steps.has(stepKey))
        .map(stepKey => {
          const step = steps.get(stepKey)!;
          const logs: OrchestrationEvent[] = [];
          if (step.startEvent) logs.push(step.startEvent);
          logs.push(...step.progressEvents);
          if (step.endEvent) logs.push(step.endEvent);

          return {
            stepKey,
            stepName: getStepName(stepKey),
            status: step.status,
            startEvent: step.startEvent,
            progressEvents: step.progressEvents,
            endEvent: step.endEvent,
            logs
          };
        });

      // Add any remaining steps not in stepOrder
      const remainingSteps = Array.from(steps.keys())
        .filter(stepKey => !stepOrder.includes(stepKey))
        .map(stepKey => {
          const step = steps.get(stepKey)!;
          const logs: OrchestrationEvent[] = [];
          if (step.startEvent) logs.push(step.startEvent);
          logs.push(...step.progressEvents);
          if (step.endEvent) logs.push(step.endEvent);

          return {
            stepKey,
            stepName: getStepName(stepKey),
            status: step.status,
            startEvent: step.startEvent,
            progressEvents: step.progressEvents,
            endEvent: step.endEvent,
            logs
          };
        });

      timeline = [...orderedSteps, ...remainingSteps];
    } catch (timelineError) {
      console.error('Error building timeline', { error: timelineError });
      timeline = []; // Return empty timeline on error
    }

    // Get latest error message - prioritize error_summary from orchestration table
    // This ensures we always get the most recent error, not from cached/stale events
    let latestError: string | null = null;
    let humanizedError: ReturnType<typeof humanizeError> | null = null;
    
    // First, try to get the latest error directly from database (bypassing any caching)
    try {
      const latestErrorFromDb = await getLatestErrorFromDatabase(orchestrationId, supabase);
      if (latestErrorFromDb) {
        latestError = latestErrorFromDb;
      }
    } catch (err) {
      console.warn('Failed to get latest error from database', err);
    }
    
    // Fallback to error_summary from orchestration
    if (!latestError && normalizedOrchestration.error_summary) {
      latestError = normalizedOrchestration.error_summary;
    }
    
    // Last fallback: use latest error from events array
    if (!latestError) {
      const errorEvents = normalizedEvents.filter(e => e.level === 'error');
      if (errorEvents.length > 0) {
        // Get the most recent error (events are sorted ascending, so last one is most recent)
        latestError = errorEvents[errorEvents.length - 1]?.message || null;
      }
    }

    // Humanize the error if we have one
    if (latestError) {
      humanizedError = humanizeError(latestError, 'worker');
    }

    // Ensure all data is serializable
    const responseData = {
      orchestration: {
        ...normalizedOrchestration,
        humanizedError: humanizedError ? {
          title: humanizedError.title,
          message: humanizedError.message,
          solution: humanizedError.solution,
          severity: humanizedError.severity,
          actionUrl: humanizedError.actionUrl,
          actionText: humanizedError.actionText
        } : null
      },
      events: normalizedEvents,
      timeline
    };

    return NextResponse.json(
      {
        success: true,
        data: responseData
      },
      { status: 200 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    // Log full error details for debugging
    console.error('Error in GET /api/cloud-agents/orchestrations/[id]/events', {
      error: errorMessage,
      stack: errorStack,
      orchestrationId,
      errorType: error?.constructor?.name,
      errorString: String(error)
    });
    
    // Return error with more details in development
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'INTERNAL_SERVER_ERROR',
          message: isDevelopment ? errorMessage : 'Internal server error',
          ...(isDevelopment && errorStack ? { stack: errorStack } : {})
        }
      },
      { status: 500 }
    );
  }
}

function getStepName(stepKey: string): string {
  const names: Record<string, string> = {
    'input_validated': 'Input Validated',
    'orchestration_created': 'Orchestration Record Created',
    'job_queued': 'Job Queued (Redis)',
    'outbox_created': 'Outbox Job Created',
    'worker_received': 'Worker Received Job',
    'cursor_api_fetch': 'Cursor API: Fetch Agent State',
    'analyzer_decision': 'Analyzer Decision',
    'follow_up_sent': 'Follow-up Task Sent',
    'waiting_webhook': 'Waiting for Webhook',
    'test_executed': 'Tests Executed',
    'orchestration_started': 'Orchestration Started',
    'completed': 'Completed',
    'error': 'Error',
    'worker_error': 'Worker Error',
    'webhook_received': 'Webhook Received'
  };
  // Convert snake_case to Title Case if not found
  if (!names[stepKey]) {
    return stepKey
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }
  return names[stepKey];
}

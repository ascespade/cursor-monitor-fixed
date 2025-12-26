/**
 * GET /api/cloud-agents/orchestrate/:id/tasks
 *
 * Purpose:
 * - Get detailed task list for an orchestration job from Supabase
 * - Returns task status, agent IDs, branches, PRs
 */
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { logger } from '@/shared/utils/logger';
import type { TaskDetail } from '@/features/cloud-agents/types/tasks';

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

    logger.info('Fetching orchestration tasks', { orchestrationId });

    const supabase = getSupabaseClient();

    // Get orchestration from Supabase
    const { data: orchestration, error: orchError } = await supabase
      .from('orchestrations')
      .select('*')
      .eq('id', orchestrationId)
      .single();

    if (orchError || !orchestration) {
      logger.error('Orchestration not found', { error: orchError?.message, orchestrationId });
      return NextResponse.json(
        { success: false, error: 'Orchestration not found' },
        { status: 404 }
      );
    }

    // Extract tasks from orchestration metadata or options
    // For now, return empty tasks array if no task plan exists
    // TODO: Create orchestration_tasks table for proper task tracking
    const taskPlan = orchestration.options?.taskPlan || orchestration.metadata?.taskPlan;

    if (!taskPlan || !taskPlan.tasks || !Array.isArray(taskPlan.tasks)) {
      return ok({ 
        tasks: [], 
        total: 0,
        completed: 0,
        running: 0,
        pending: 0
      });
    }

    // Reconstruct tasks from plan and events
    // Get events to determine task status
    const { data: events } = await supabase
      .from('orchestration_events')
      .select('*')
      .eq('orchestration_id', orchestrationId)
      .order('created_at', { ascending: true });

    const completedTaskIds = new Set<string>();
    const runningTaskIds = new Set<string>();

    // Parse events to determine task status
    (events || []).forEach((event) => {
      const payload = event.payload || {};
      if (payload.taskId) {
        if (event.step_key === 'task_completed' || event.step_key === 'task_succeeded') {
          completedTaskIds.add(payload.taskId);
          runningTaskIds.delete(payload.taskId);
        } else if (event.step_key === 'task_started' || event.step_key === 'task_running') {
          runningTaskIds.add(payload.taskId);
        }
      }
    });

    const tasks: TaskDetail[] = taskPlan.tasks.map((task: any) => {
      let status: TaskDetail['status'] = 'pending';
      if (completedTaskIds.has(task.id)) {
        status = 'completed';
      } else if (runningTaskIds.has(task.id)) {
        status = 'running';
      }

      // Extract agent info from events
      const taskEvents = (events || []).filter((e: any) => 
        e.payload?.taskId === task.id
      );
      const agentEvent = taskEvents.find((e: any) => e.payload?.agentId);
      const branchEvent = taskEvents.find((e: any) => e.payload?.branchName);

      return {
        id: task.id,
        title: task.title || task.name || `Task ${task.id}`,
        description: task.description || '',
        status,
        agentId: agentEvent?.payload?.agentId,
        branchName: branchEvent?.payload?.branchName || task.branchName,
        prUrl: task.prUrl,
        startedAt: taskEvents.find((e: any) => e.step_phase === 'start')?.created_at,
        completedAt: taskEvents.find((e: any) => e.step_phase === 'end' && status === 'completed')?.created_at,
        iterations: task.iterations || 0,
        dependencies: task.dependencies || [],
        priority: task.priority || 'medium'
      };
    });

    return ok({
      tasks,
      total: tasks.length,
      completed: tasks.filter(t => t.status === 'completed').length,
      running: tasks.filter(t => t.status === 'running').length,
      pending: tasks.filter(t => t.status === 'pending').length
    });
  } catch (error) {
    logger.error('Error fetching orchestration tasks', { error });
    return handleApiError(error);
  }
}

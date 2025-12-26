/**
 * POST /api/cloud-agents/orchestrate/dry-run
 *
 * Purpose:
 * - Preview task plan without executing
 * - Shows how prompt will be split into tasks
 * - No agents are created
 */
import { NextResponse } from 'next/server';

import { handleApiError } from '@/shared/utils/api-error-handler';
import { ok } from '@/shared/utils/api-response';
import { getApiKeyFromRequest } from '../../_utils/get-api-key';
import { logger } from '@/shared/utils/logger';
import type { OrchestrationRequest } from '@/features/cloud-agents/types/orchestration';
import { checkOrchestrationLimits } from '@/config/orchestration-limits';

const CURSOR_API_BASE = 'https://api.cursor.com/v0';

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const apiKey = getApiKeyFromRequest(request);
    const body = (await request.json()) as OrchestrationRequest;

    if (!body.prompt || body.prompt.trim().length === 0) {
      return handleApiError(new Error('prompt is required'));
    }

    if (!body.repository) {
      return handleApiError(new Error('repository is required'));
    }

    const mode = body.options?.mode || 'AUTO';
    const estimatedAgents = mode === 'SINGLE_AGENT' 
      ? 1 
      : (body.options?.maxParallelAgents || 3) * Math.ceil(body.prompt.length / 5000);

    // Check limits
    const limitCheck = checkOrchestrationLimits(
      body.prompt.length,
      estimatedAgents,
      mode
    );

    if (!limitCheck.allowed) {
      return NextResponse.json(
        { success: false, error: limitCheck.reason },
        { status: 429 }
      );
    }

    logger.info('Dry run: Planning tasks', {
      promptLength: body.prompt.length,
      repository: body.repository,
      mode
    });

    // Generate task plan using Cursor API (same as task planner)
    const planningPrompt = buildPlanningPrompt(body.prompt, body.repository, mode);
    const taskPlan = await generateTaskPlan(apiKey, planningPrompt);

    return ok({
      mode,
      taskPlan,
      estimatedAgents,
      estimatedDuration: getEstimatedDuration(mode, body.prompt.length),
      limits: {
        promptLength: {
          current: body.prompt.length,
          max: 50000,
          min: 100,
          status: 'ok'
        },
        agentsPerOrchestration: {
          estimated: estimatedAgents,
          max: 20,
          status: estimatedAgents <= 20 ? 'ok' : 'warning'
        }
      },
      message: 'This is a preview. No agents will be created. Use POST /api/cloud-agents/orchestrate to start execution.'
    });
  } catch (error) {
    return handleApiError(error);
  }
}

function buildPlanningPrompt(
  largePrompt: string,
  repository: string,
  mode: string
): string {
  return `You are a senior software architect. Your task is to break down a large project description into manageable, sequential subtasks.

**Project Description:**
${largePrompt}

**Repository:** ${repository}

**Execution Mode:** ${mode}

**Your Task:**
Analyze the project description and create a detailed task plan. Each task should be:
1. **Specific and actionable** - Clear what needs to be done
2. **Testable** - Can verify completion
3. **Independent** - Can be worked on separately (with dependencies noted)
4. **Appropriately sized** - Not too large (max 2-3 hours of work)

**Response Format (JSON only):**
{
  "projectDescription": "Brief summary",
  "tasks": [
    {
      "id": "task-1",
      "title": "Task title",
      "description": "Detailed description",
      "dependencies": ["task-0"],
      "priority": "high|medium|low",
      "estimatedComplexity": "simple|moderate|complex"
    }
  ],
  "totalTasks": 5,
  "estimatedDuration": "2-3 days"
}`;
}

async function generateTaskPlan(
  apiKey: string,
  prompt: string
): Promise<any> {
  try {
    const response = await fetch(`${CURSOR_API_BASE}/chat`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-4.5-opus-high-thinking',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.2,
        response_format: { type: 'json_object' }
      })
    });

    if (!response.ok) {
      throw new Error(`Cursor API error: ${response.status}`);
    }

    const data = await response.json() as any;
    const content = data.choices?.[0]?.message?.content || data.content || '{}';

    // Parse JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? jsonMatch[0] : content;
    return JSON.parse(jsonText);
  } catch (error) {
    logger.error('Dry run: Failed to generate task plan', { error });
    throw error;
  }
}

function getEstimatedDuration(mode: string, promptLength: number): string {
  const estimatedTasks = Math.ceil(promptLength / 500);
  
  switch (mode) {
    case 'SINGLE_AGENT':
      return `${Math.ceil(promptLength / 1000)}-${Math.ceil(promptLength / 500)} hours`;
    case 'PIPELINE':
      return `${estimatedTasks * 2}-${estimatedTasks * 3} hours`;
    case 'BATCH':
      return `${Math.ceil(estimatedTasks / 3) * 2}-${Math.ceil(estimatedTasks / 3) * 3} hours`;
    default:
      return 'Varies based on task complexity';
  }
}

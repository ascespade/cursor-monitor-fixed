/**
 * Task Dispatcher Service
 * 
 * Manages sending tasks to Cloud Agents
 * Handles task queue and sequential execution
 */

import { logger } from '../utils/logger';
import { taskPlanner, type Task, type TaskPlan } from './task-planner.service';
import { stateManager } from './state-manager.service';
import type { OrchestrationOptions, OrchestrationMode } from '../types/orchestration';
import { validateTaskAgainstProfile, type RepositoryProfile } from '../types/repository-profile';

// Track active agents per master agent
const activeAgentsMap = new Map<string, ActiveAgent[]>();

const CURSOR_API_BASE = 'https://api.cursor.com/v0';

interface DispatchedTask {
  taskId: string;
  agentId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: Date;
  completedAt?: Date;
}

interface ActiveAgent {
  taskId: string;
  agentId: string;
  startedAt: Date;
  branchName?: string;
}

class TaskDispatcherService {
  /**
   * Get API key dynamically from process.env
   * This allows the API key to be set after the service is instantiated
   * (e.g., from job payload in outbox-processor)
   */
  private getApiKey(): string {
    const apiKey = process.env['CURSOR_API_KEY'];
    if (!apiKey) {
      throw new Error('AUTH_FAILED: CURSOR_API_KEY is not set in process.env');
    }
    return apiKey;
  }

  /**
   * Validate and normalize model name using Model Validator Service
   * Follows international best practices for validation with fallback
   */
  private async validateAndNormalizeModel(
    model: string | undefined,
    apiKey: string
  ): Promise<{ normalizedModel: string; validationResult: any }> {
    const { validateModel } = await import('./model-validator.service');
    
    const validationResult = await validateModel(model, apiKey, {
      allowDeprecated: false,
      useFallback: true,
      forceRefreshCache: false,
      allowAutoMode: true // Enable Auto mode (recommended by API)
    });

    if (validationResult.fallbackUsed && validationResult.originalModel !== validationResult.normalizedModel) {
      logger.warn('Model validation result', {
        original: validationResult.originalModel,
        normalized: validationResult.normalizedModel,
        reason: validationResult.reason,
        fallbackUsed: validationResult.fallbackUsed
      });
    }

    return {
      normalizedModel: validationResult.normalizedModel,
      validationResult
    };
  }

  /**
   * Start orchestration from large prompt with options
   */
  async startOrchestration(
    largePrompt: string,
    repository: string,
    ref?: string,
    model?: string,
    options?: Partial<OrchestrationOptions>
  ): Promise<{ masterAgentId: string; taskPlan?: TaskPlan; agentId?: string }> {
    try {
      const mode = options?.mode || 'AUTO';
      logger.info('Starting orchestration', { 
        repository, 
        promptLength: largePrompt.length,
        mode 
      });

      const masterAgentId = `master-${Date.now()}`;

      // SINGLE_AGENT mode: Send full prompt to one agent
      if (mode === 'SINGLE_AGENT') {
        logger.info('SINGLE_AGENT mode: Sending full prompt to single agent', { masterAgentId });

        // Create agent with full prompt
        const agentId = await this.createCloudAgent(
          largePrompt,
          repository,
          ref,
          model,
          options
        );

        // Save state for monitoring
        await stateManager.saveState(masterAgentId, {
          agent_id: masterAgentId,
          task_description: largePrompt.substring(0, 200) + '...',
          repository,
          branch_name: ref || 'main',
          iterations: 0,
          status: 'ACTIVE',
          tasks_completed: [],
          tasks_remaining: [],
          last_analysis: {
            mode: 'SINGLE_AGENT',
            agentId,
            taskPlan: null
          }
        });

        logger.info('Single agent orchestration started', { masterAgentId, agentId });

        return { masterAgentId, agentId };
      }

      // PIPELINE, BATCH, or AUTO mode: Plan and split tasks
      const taskPlan = await taskPlanner.planTasks(largePrompt, repository);

      // Adjust task plan based on options
      if (options?.taskSize && options.taskSize !== 'auto') {
        // Resize tasks based on preference (simplified - in production, re-plan)
        logger.info('Task size preference', { taskSize: options.taskSize });
      }

      await stateManager.saveState(masterAgentId, {
        agent_id: masterAgentId,
        task_description: taskPlan.projectDescription,
        repository,
        branch_name: ref || 'main',
        iterations: 0,
        status: 'ACTIVE',
        tasks_completed: [],
        tasks_remaining: taskPlan.tasks.map(t => t.id),
        last_analysis: {
          taskPlan: taskPlan as unknown,
          currentTaskIndex: 0,
          mode,
          options: options as Record<string, unknown>
        }
      });

      // Start initial tasks based on mode
      if (mode === 'PIPELINE') {
        // Sequential: Start only first task
        const firstTask = taskPlan.tasks[0];
        if (firstTask) {
          await this.dispatchTask(masterAgentId, firstTask, repository, ref, model, options);
        }
      } else if (mode === 'BATCH' || mode === 'AUTO') {
        // Parallel: Start multiple tasks
        const maxParallel = options?.maxParallelAgents || 
                          parseInt(process.env['MAX_PARALLEL_AGENTS'] || '3', 10);
        
        const initialTasks = taskPlanner.getParallelizableTasks(
          taskPlan,
          [],
          [],
          maxParallel
        );

        if (initialTasks.length > 0) {
          logger.info('Starting initial tasks', { 
            masterAgentId, 
            count: initialTasks.length,
            mode 
          });

          const dispatchPromises = initialTasks.map(task =>
            this.dispatchTask(masterAgentId, task, repository, ref, model, options)
          );

          await Promise.all(dispatchPromises);
        }
      }

      logger.info('Orchestration started', { masterAgentId, totalTasks: taskPlan.tasks.length, mode });

      return { masterAgentId, taskPlan };
    } catch (error) {
      logger.error('Failed to start orchestration', { error });
      throw error;
    }
  }

  /**
   * Dispatch a single task to Cloud Agent
   */
  async dispatchTask(
    masterAgentId: string,
    task: Task,
    repository: string,
    ref?: string,
    model?: string,
    options?: Partial<OrchestrationOptions>
  ): Promise<string> {
    try {
      logger.info('Dispatching task', { masterAgentId, taskId: task.id, taskTitle: task.title });

      // Build task prompt
      const taskPrompt = this.buildTaskPrompt(task);

      // Create Cloud Agent
      const agentId = await this.createCloudAgent(taskPrompt, repository, ref, model, options);

      // Track active agent
      const activeAgents = activeAgentsMap.get(masterAgentId) || [];
      activeAgents.push({
        taskId: task.id,
        agentId,
        startedAt: new Date()
      });
      activeAgentsMap.set(masterAgentId, activeAgents);

      // Update state
      const state = await stateManager.getState(masterAgentId);
      if (state) {
        await stateManager.saveState(masterAgentId, {
          ...state,
          last_analysis: {
            ...state.last_analysis,
            currentTask: task.id as unknown,
            currentAgentId: agentId,
            taskStatus: 'running' as unknown,
            activeAgents: activeAgents.length,
            parallelExecution: activeAgents.length > 1
          }
        });
      }

      logger.info('Task dispatched', { 
        masterAgentId, 
        taskId: task.id, 
        agentId,
        activeAgents: activeAgents.length,
        parallel: activeAgents.length > 1
      });

      return agentId;
    } catch (error) {
      logger.error('Failed to dispatch task', { masterAgentId, taskId: task.id, error });
      throw error;
    }
  }

  /**
   * Build prompt for a single task
   */
  private buildTaskPrompt(task: Task): string {
    return `**Task: ${task.title}**

**Description:**
${task.description}

**Priority:** ${task.priority}
**Complexity:** ${task.estimatedComplexity}

**Requirements:**
1. Complete this task fully and correctly
2. Test your changes to ensure they work
3. Follow best practices and code standards
4. Document any significant changes
5. Ensure no breaking changes to existing functionality

**Important:**
- This is part of a larger project, so ensure compatibility
- If you encounter errors, fix them before marking as complete
- Write clear, maintainable code
- Add tests where appropriate`;
  }

  /**
   * Create Cloud Agent via Cursor API
   */
  private async createCloudAgent(
    prompt: string,
    repository: string,
    ref?: string,
    model?: string,
    options?: Partial<OrchestrationOptions>
  ): Promise<string> {
    // Declare finalModel outside try block so it's accessible in catch
    let finalModel: string = '';
    let normalizedRepository: string = '';
    let normalizedRef: string = 'main';
    
    try {
      // Step 1: Get API key dynamically
      const apiKey = this.getApiKey();
      
      // Step 2: Validate and normalize model name (with fallback)
      const { normalizedModel, validationResult } = await this.validateAndNormalizeModel(model, apiKey);
      
      // Handle Auto mode (empty string means don't send model parameter)
      finalModel = normalizedModel || ''; // Empty string = Auto mode
      
      // Step 3: Validate and normalize repository URL
      if (!repository || typeof repository !== 'string' || repository.trim().length === 0) {
        throw new Error('VALIDATION_ERROR: Repository URL is required and must be a non-empty string');
      }

      // Normalize repository to full GitHub URL format
      // API expects: https://github.com/owner/repo
      // Accepts: owner/repo, github.com/owner/repo, https://github.com/owner/repo
      normalizedRepository = repository.trim();
      if (!normalizedRepository.startsWith('http')) {
        // If it's owner/repo format, convert to full URL
        if (normalizedRepository.includes('/') && !normalizedRepository.includes('://')) {
          normalizedRepository = `https://github.com/${normalizedRepository}`;
        } else if (normalizedRepository.startsWith('github.com/')) {
          normalizedRepository = `https://${normalizedRepository}`;
        } else {
          // Assume it's owner/repo
          normalizedRepository = `https://github.com/${normalizedRepository}`;
        }
      }

      // Step 4: Validate prompt
      if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
        throw new Error('VALIDATION_ERROR: Prompt is required and must be a non-empty string');
      }

      if (prompt.length > 100000) {
        throw new Error('VALIDATION_ERROR: Prompt exceeds maximum length of 100,000 characters');
      }

      // Step 5: Validate ref
      normalizedRef = (ref || 'main').trim();
      if (normalizedRef.length === 0 || normalizedRef.length > 255) {
        throw new Error('VALIDATION_ERROR: Ref must be between 1 and 255 characters');
      }

      logger.info('Creating Cloud Agent via Cursor API', {
        repository: normalizedRepository,
        originalRepository: repository,
        ref: normalizedRef,
        model: finalModel || 'AUTO (API will choose)',
        originalModel: model || 'null',
        modelValidation: {
          isValid: validationResult.isValid,
          fallbackUsed: validationResult.fallbackUsed,
          isAutoMode: validationResult.isAutoMode,
          reason: validationResult.reason
        },
        promptLength: prompt.length,
        hasApiKey: !!apiKey,
        apiKeyPrefix: apiKey.substring(0, 10) + '...',
        options: options ? Object.keys(options) : []
      });

      const webhookUrl = process.env['WEBHOOK_URL'] || 
        'https://cursor-monitor.vercel.app/api/cloud-agents/webhook';
      const webhookSecret = process.env['WEBHOOK_SECRET'];

      // Build prompt with options context
      let enhancedPrompt = prompt;
      
      if (options) {
        const context = [];
        if (options.enableAutoFix) {
          context.push('- Auto-fix any errors you encounter');
        }
        if (options.enableTesting) {
          context.push('- Write and run tests for your changes');
        }
        if (options.enableValidation) {
          context.push('- Validate your work before marking as complete');
        }
        if (options.priority) {
          context.push(`- Priority: ${options.priority} (optimize for ${options.priority === 'speed' ? 'fast execution' : options.priority === 'quality' ? 'code quality' : 'balanced approach'})`);
        }
        
        if (context.length > 0) {
          enhancedPrompt = `${prompt}\n\n**Additional Requirements:**\n${context.join('\n')}`;
        }
      }

      interface CursorAgentPayload {
        prompt: { text: string };
        source: {
          repository: string;
          ref: string;
        };
        target?: {
          autoCreatePr?: boolean;
        };
        model?: string;
        webhook?: {
          url: string;
          secret: string;
        };
      }

      const payload: CursorAgentPayload = {
        prompt: { text: enhancedPrompt },
        source: {
          repository: normalizedRepository,
          ref: normalizedRef
        },
        target: {
          autoCreatePr: true
        }
      };

      // Only add model if not empty (empty = Auto mode - let API choose)
      // This is recommended by Cursor API docs
      if (finalModel && finalModel.trim().length > 0) {
        payload.model = finalModel;
      } else {
        logger.info('Using Auto mode - API will choose best model (not sending model parameter)');
      }

      // Add webhook if secret is configured
      if (webhookSecret) {
        payload.webhook = {
          url: webhookUrl,
          secret: webhookSecret
        };
      }

      logger.info('Sending request to Cursor API', {
        url: `${CURSOR_API_BASE}/agents`,
        repository: normalizedRepository,
        ref: normalizedRef,
        model: finalModel || 'AUTO (not in payload)',
        promptLength: enhancedPrompt.length,
        hasWebhook: !!webhookSecret,
        payload: JSON.stringify(payload)
      });

      // Log the exact payload being sent
      const payloadString = JSON.stringify(payload);
      logger.info('Payload being sent to Cursor API', {
        payload: payloadString,
        payloadParsed: payload
      });

      const response = await fetch(`${CURSOR_API_BASE}/agents`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${apiKey}:`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: payloadString
      });

      logger.info('Cursor API response received', {
        status: response.status,
        statusText: response.statusText,
        ok: response.ok,
        headers: Object.fromEntries(Array.from(response.headers.entries()))
      });

      if (!response.ok) {
        const errorText = await response.text();
        let errorMessage = `Cursor API error: ${response.status}`;
        let errorPayload: Record<string, unknown> = {
          status: response.status,
          statusText: response.statusText,
          responseBody: errorText
        };
        
        // Extract meaningful error message
        try {
          const errorData = JSON.parse(errorText);
          errorPayload.parsedError = errorData;
          
          if (errorData.message) {
            errorMessage = errorData.message;
          } else if (errorData.error) {
            errorMessage = errorData.error;
          } else {
            errorMessage = errorText.substring(0, 200); // Limit length
          }
        } catch {
          errorMessage = errorText.substring(0, 200);
        }

        logger.error('Cursor API request failed', {
          status: response.status,
          statusText: response.statusText,
          errorMessage,
          errorPayload,
          repository,
          ref: ref || 'main'
        });

        // Create specific error types
        if (response.status === 401 || response.status === 403) {
          const authError = new Error(`AUTH_FAILED: Invalid Cursor API key - ${errorMessage}`);
          (authError as any).apiResponse = errorPayload;
          throw authError;
        } else if (response.status === 429) {
          const rateLimitError = new Error(`RATE_LIMIT: Cursor API rate limit exceeded - ${errorMessage}`);
          (rateLimitError as any).apiResponse = errorPayload;
          throw rateLimitError;
        } else {
          const apiError = new Error(`CURSOR_API_ERROR: ${response.status} - ${errorMessage}`);
          (apiError as any).apiResponse = errorPayload;
          throw apiError;
        }
      }

      const data = await response.json() as { id: string };
      if (typeof data.id !== 'string') {
        logger.error('Invalid Cursor API response', {
          response: data,
          expectedField: 'id'
        });
        throw new Error('Invalid response: missing agent id');
      }

      logger.info('Cloud Agent created successfully', {
        agentId: data.id,
        repository,
        ref: ref || 'main'
      });

      return data.id;
    } catch (error) {
      // Enhanced error logging
      logger.error('Failed to create Cloud Agent', {
        error: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
          cause: error.cause
        } : error,
        repository,
        ref: ref || 'main',
        model: finalModel || 'AUTO',
        originalModel: model || 'null',
        hasApiKey: !!process.env['CURSOR_API_KEY'],
        apiResponse: (error as any)?.apiResponse
      });
      throw error;
    }
  }

  /**
   * Handle task completion and dispatch next available tasks (parallel execution)
   */
  async handleTaskCompletion(
    masterAgentId: string,
    completedTaskId: string,
    agentId: string,
    status: 'FINISHED' | 'ERROR'
  ): Promise<void> {
    try {
      logger.info('Handling task completion', { 
        masterAgentId, 
        completedTaskId, 
        agentId, 
        status 
      });

      const state = await stateManager.getState(masterAgentId);
      if (!state) {
        logger.warn('Master agent state not found', { masterAgentId });
        return;
      }

      const taskPlan = (state.last_analysis?.taskPlan as TaskPlan | undefined) ?? undefined;
      if (!taskPlan) {
        logger.warn('Task plan not found in state', { masterAgentId });
        return;
      }

      // Remove from active agents
      const activeAgents = activeAgentsMap.get(masterAgentId) || [];
      const updatedActiveAgents = activeAgents.filter(a => a.agentId !== agentId);
      activeAgentsMap.set(masterAgentId, updatedActiveAgents);

      // Update completed tasks
      const completedTasks = [...(state.tasks_completed || []), completedTaskId];
      const remainingTasks = (state.tasks_remaining || []).filter(id => id !== completedTaskId);

      // Get orchestration mode and options
      const lastAnalysis = state.last_analysis;
      const mode = (typeof lastAnalysis?.mode === 'string' ? lastAnalysis.mode : 'AUTO') as OrchestrationMode;
      const optionsRaw = lastAnalysis?.options;
      const options: OrchestrationOptions = (optionsRaw && typeof optionsRaw === 'object' && 'mode' in optionsRaw)
        ? (optionsRaw as unknown as OrchestrationOptions)
        : { mode: 'AUTO' };

      // Get running task IDs
      const runningTaskIds = updatedActiveAgents.map(a => a.taskId);

      // Get next available tasks based on mode
      let nextTasks: Task[] = [];

      if (mode === 'PIPELINE') {
        // Sequential: Get next single task
        const nextTask = taskPlanner.getNextTask(taskPlan, completedTasks);
        if (nextTask) {
          nextTasks = [nextTask];
        }
      } else {
        // BATCH or AUTO: Get parallelizable tasks
        const maxParallel = options.maxParallelAgents || 
                          parseInt(process.env['MAX_PARALLEL_AGENTS'] || '3', 10);
        nextTasks = taskPlanner.getParallelizableTasks(
          taskPlan,
          completedTasks,
          runningTaskIds,
          maxParallel
        );
      }

      if (nextTasks.length > 0) {
        // Dispatch multiple tasks in parallel
        logger.info('Dispatching parallel tasks', { 
          masterAgentId, 
          taskIds: nextTasks.map(t => t.id),
          count: nextTasks.length
        });

        const dispatchPromises = nextTasks.map(task =>
          this.dispatchTask(
            masterAgentId,
            task,
            state.repository || '',
            state.branch_name || undefined,
            undefined, // model
            options
          )
        );

        await Promise.all(dispatchPromises);

        // Update state
        await stateManager.saveState(masterAgentId, {
          ...state,
          tasks_completed: completedTasks,
          tasks_remaining: remainingTasks,
          iterations: (state.iterations || 0) + 1,
          last_analysis: {
            ...state.last_analysis,
            activeAgents: updatedActiveAgents.length + nextTasks.length,
            parallelExecution: true
          }
        });
      } else {
        // Check if all tasks are done
        if (remainingTasks.length === 0 && updatedActiveAgents.length === 0) {
          // All tasks completed
          logger.info('All tasks completed', { masterAgentId });
          await stateManager.updateStatus(masterAgentId, 'COMPLETED');
          activeAgentsMap.delete(masterAgentId);
        } else {
          // Still waiting for other tasks
          logger.info('Waiting for other tasks to complete', { 
            masterAgentId,
            remaining: remainingTasks.length,
            active: updatedActiveAgents.length
          });
        }
      }
    } catch (error) {
      logger.error('Failed to handle task completion', { masterAgentId, error });
      throw error;
    }
  }

  /**
   * Get active agents for a master agent
   */
  getActiveAgents(masterAgentId: string): ActiveAgent[] {
    return activeAgentsMap.get(masterAgentId) || [];
  }
}

export const taskDispatcher = new TaskDispatcherService();

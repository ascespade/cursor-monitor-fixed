/**
 * Orchestrator Service
 * 
 * Main service that coordinates all components
 * Processes webhook events and makes decisions
 */

import { logger } from '../utils/logger';
import { stateManager, type AgentState } from './state-manager.service';
import { analyzer } from './analyzer.service';
import { tester } from './tester.service';
import { notifier } from './notifier.service';
import { taskDispatcher } from './task-dispatcher.service';
import { qualityScorer, type QualityMetrics } from './quality-scorer.service';

const CURSOR_API_BASE = 'https://api.cursor.com/v0';

interface WebhookData {
  id: string;
  status: string;
  source?: {
    repository?: string;
    ref?: string;
  };
  target?: {
    branchName?: string;
    prUrl?: string;
  };
  summary?: string;
  [key: string]: unknown;
}

class OrchestratorService {
  private readonly maxIterations: number;

  constructor() {
    this.maxIterations = parseInt(process.env['MAX_ITERATIONS'] || '20', 10);
  }

  /**
   * Get API key dynamically from process.env
   * This allows the API key to be set after the service is instantiated
   */
  private getApiKey(): string {
    const apiKey = process.env['CURSOR_API_KEY'];
    if (!apiKey) {
      throw new Error('AUTH_FAILED: CURSOR_API_KEY is not set in process.env');
    }
    return apiKey;
  }

  /**
   * Process webhook event
   */
  async processWebhookEvent(webhookData: WebhookData): Promise<void> {
    const { id: agentId, status } = webhookData;

    logger.info('Processing webhook event', { agentId, status });

    if (status === 'FINISHED') {
      await this.handleAgentFinished(agentId, webhookData);
    } else if (status === 'ERROR') {
      await this.handleAgentError(agentId, webhookData);
    }
  }

  /**
   * Handle agent finished
   */
  private async handleAgentFinished(agentId: string, webhookData: WebhookData): Promise<void> {
    try {
      // 1. Get or create state
      let state = await stateManager.getState(agentId);

      // Check if this is a subtask agent (part of orchestration)
      const masterAgent = await stateManager.findMasterBySubAgent(agentId);
      
      if (masterAgent) {
        const masterAgentId = masterAgent.agent_id;
        const lastAnalysis = masterAgent.last_analysis as any;
        const mode = lastAnalysis?.mode || 'AUTO';

        // SINGLE_AGENT mode: Just monitor, no task splitting
        if (mode === 'SINGLE_AGENT') {
          logger.info('Single agent completed', { masterAgentId, agentId });
          
          // Analyze and decide: continue, test, or complete
          const conversation = await this.getConversation(agentId);
          const agentStatus = await this.getAgent(agentId);
          const analysis = await analyzer.analyzeProgress(
            agentId,
            conversation,
            agentStatus,
            masterAgent
          );

          if (analysis.action === 'COMPLETE') {
            await stateManager.updateStatus(masterAgentId, 'COMPLETED');
            await notifier.notifySuccess(masterAgentId, {
              branchName: masterAgent.branch_name,
              iterations: masterAgent.iterations,
              prUrl: agentStatus.target?.prUrl
            });
          } else if (analysis.action === 'TEST') {
            // Run tests
            const branchName = agentStatus.target?.branchName;
            if (branchName) {
              const testResults = await tester.testBranch(branchName, agentId);
              if (testResults.success) {
                await stateManager.updateStatus(masterAgentId, 'COMPLETED');
              } else {
                const fixInstructions = await tester.generateFixInstructions(testResults);
                await this.sendFollowup(agentId, fixInstructions);
              }
            }
          } else {
            // Continue or fix
            await this.sendFollowup(agentId, analysis.followupMessage || 'Continue working');
          }
          
          return;
        }

        // PIPELINE/BATCH/AUTO mode: Handle as subtask
        const currentTaskId = lastAnalysis?.currentTask;
        
        if (currentTaskId) {
          logger.info('Handling subtask completion', {
            masterAgentId,
            subtaskAgentId: agentId,
            taskId: currentTaskId,
            status: 'FINISHED'
          });

          await taskDispatcher.handleTaskCompletion(
            masterAgentId,
            currentTaskId,
            agentId,
            'FINISHED'
          );
          
          // Check if there are still active agents
          const activeAgents = taskDispatcher.getActiveAgents(masterAgentId);
          logger.info('Active agents after completion', {
            masterAgentId,
            activeCount: activeAgents.length,
            activeTasks: activeAgents.map(a => a.taskId)
          });
          
          return;
        }
      }

      if (!state) {
        state = await stateManager.saveState(agentId, {
          agent_id: agentId,
          task_description: webhookData.summary || 'Unknown task',
          branch_name: webhookData.target?.branchName,
          repository: webhookData.source?.repository,
          iterations: 0,
          status: 'ACTIVE',
          tasks_completed: [],
          tasks_remaining: []
        });
      }

      // 2. Increment iterations
      const currentIteration = await stateManager.incrementIterations(agentId);

      if (currentIteration >= this.maxIterations) {
        logger.warn('Max iterations reached', { agentId, iterations: currentIteration });
        await stateManager.updateStatus(agentId, 'MAX_ITERATIONS_REACHED');
        await notifier.notifyFailure(agentId, {
          message: `Max iterations (${this.maxIterations}) reached`
        });
        return;
      }

      // 3. Fetch conversation and agent status from Cursor API
      const conversation = await this.getConversation(agentId);
      const agentStatus = await this.getAgent(agentId);

      // 4. Analyze progress
      const analysis = await analyzer.analyzeProgress(
        agentId,
        conversation,
        agentStatus,
        state
      );

      // 5. Save analysis
      await stateManager.saveState(agentId, {
        last_analysis: analysis,
        tasks_completed: analysis.tasksCompleted,
        tasks_remaining: analysis.tasksRemaining
      });

      // 6. Notify progress
      await notifier.notifyProgress(agentId, currentIteration, analysis);

      // 7. Execute decision
      await this.executeDecision(agentId, analysis, state, agentStatus);

    } catch (error) {
      logger.error('Error handling finished agent', { agentId, error });
      throw error;
    }
  }

  /**
   * Execute decision
   */
  private async executeDecision(
    agentId: string,
    analysis: any,
    state: AgentState,
    agentStatus: any
  ): Promise<void> {
    switch (analysis.action) {
      case 'CONTINUE':
        await this.sendFollowup(agentId, analysis.followupMessage || 'Continue working on the task');
        break;

      case 'TEST':
        const branchName = agentStatus.target?.branchName;
        if (!branchName) {
          logger.error('No branch name found', { agentId });
          await this.handleCompletion(agentId, state, agentStatus, null);
          break;
        }

        const testResults = await tester.testBranch(branchName, agentId);
        if (testResults.success) {
          await this.handleCompletion(agentId, state, agentStatus, testResults);
        } else {
          const fixInstructions = await tester.generateFixInstructions(testResults);
          await this.sendFollowup(agentId, fixInstructions);
        }
        break;

      case 'FIX':
        await this.sendFollowup(agentId, analysis.followupMessage || 'Please fix the errors mentioned');
        break;

      case 'COMPLETE':
        await this.handleCompletion(agentId, state, agentStatus, null);
        break;
    }
  }

  /**
   * Handle completion
   */
  private async handleCompletion(
    agentId: string,
    state: AgentState,
    agentStatus: any,
    testResults: any
  ): Promise<void> {
    // Calculate quality score
    const metrics: QualityMetrics = {
      iterations: state.iterations || 0,
      maxIterations: this.maxIterations,
      testsPassed: testResults?.passed || 0,
      testsTotal: testResults?.total || 0,
      errorsFixed: (state.last_analysis as any)?.errorsFixed || 0,
      errorsTotal: (state.last_analysis as any)?.errorsTotal || 0,
      codeQuality: testResults?.codeQuality,
      testCoverage: testResults?.coverage
    };

    const qualityScore = qualityScorer.calculateScore(metrics);
    const qualityThreshold = parseInt(process.env['QUALITY_THRESHOLD'] || '70', 10);

    // Check if quality meets threshold
    if (!qualityScorer.meetsThreshold(qualityScore, qualityThreshold)) {
      logger.warn('Quality score below threshold', {
        agentId,
        score: qualityScore.score,
        threshold: qualityThreshold
      });

      // Trigger final refinement
      const refinementPrompt = `The orchestration is complete, but quality score is ${qualityScore.score}/100 (threshold: ${qualityThreshold}).

**Quality Breakdown:**
- Iterations: ${qualityScore.breakdown.iterations}/25
- Tests: ${qualityScore.breakdown.tests}/30
- Errors: ${qualityScore.breakdown.errors}/25
- Quality: ${qualityScore.breakdown.quality}/20

**Recommendations:**
${qualityScore.recommendations.map(r => `- ${r}`).join('\n')}

Please perform a final refinement pass to improve the quality score above ${qualityThreshold}.`;

      await this.sendFollowup(agentId, refinementPrompt);
      
      // Update state but don't mark as completed yet
      await stateManager.saveState(agentId, {
        ...state,
        last_analysis: {
          ...state.last_analysis,
          qualityScore: qualityScore as any, // Add to analysis object
          needsRefinement: true
        } as any
      });

      return;
    }

    // Quality is good, mark as completed
    await stateManager.updateStatus(agentId, 'COMPLETED');

    await stateManager.saveState(agentId, {
      ...state,
      last_analysis: {
        ...state.last_analysis,
        qualityScore: qualityScore as any
      } as any
    });

    await notifier.notifySuccess(agentId, {
      branchName: state.branch_name,
      iterations: state.iterations,
      tasksCompleted: state.tasks_completed,
      prUrl: agentStatus.target?.prUrl,
      testResults,
      qualityScore
    });

    logger.info('Agent completed with quality score', {
      agentId,
      score: qualityScore.score,
      grade: qualityScore.grade
    });
  }

  /**
   * Handle agent error
   */
  private async handleAgentError(agentId: string, webhookData: WebhookData): Promise<void> {
    const state = await stateManager.getState(agentId);

    if (state) {
      await stateManager.updateStatus(agentId, 'ERROR');
    }

    await notifier.notifyFailure(agentId, {
      message: 'Cloud Agent encountered an error',
      details: webhookData
    });
  }

  /**
   * Get conversation from Cursor API
   */
  private async getConversation(agentId: string): Promise<any[]> {
    try {
      const response = await fetch(`${CURSOR_API_BASE}/agents/${agentId}/conversation`, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.getApiKey()}:`).toString('base64')
        }
      });

      if (!response.ok) {
        throw new Error(`Cursor API error: ${response.status}`);
      }

      const data = await response.json() as any;
      return data.messages || data.conversation || [];
    } catch (error) {
      logger.error('Failed to get conversation', { agentId, error });
      return [];
    }
  }

  /**
   * Get agent status from Cursor API
   */
  private async getAgent(agentId: string): Promise<any> {
    try {
      const response = await fetch(`${CURSOR_API_BASE}/agents/${agentId}`, {
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.getApiKey()}:`).toString('base64')
        }
      });

      if (!response.ok) {
        throw new Error(`Cursor API error: ${response.status}`);
      }

      return await response.json() as any;
    } catch (error) {
      logger.error('Failed to get agent status', { agentId, error });
      throw error;
    }
  }

  /**
   * Send followup to agent
   */
  private async sendFollowup(agentId: string, message: string): Promise<void> {
    try {
      const response = await fetch(`${CURSOR_API_BASE}/agents/${agentId}/followup`, {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${this.getApiKey()}:`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: { text: message }
        })
      });

      if (!response.ok) {
        throw new Error(`Cursor API error: ${response.status}`);
      }

      logger.info('Follow-up sent', { agentId });
    } catch (error) {
      logger.error('Failed to send follow-up', { agentId, error });
      throw error;
    }
  }

  /**
   * Find master agent for a subtask agent
   */
  private async findMasterAgent(agentId: string): Promise<string | null> {
    try {
      // Query Supabase to find master agent that has this agentId in currentAgentId
      const state = await stateManager.findMasterBySubAgent(agentId);
      return state?.agent_id || null;
    } catch (error) {
      logger.error('Failed to find master agent', { agentId, error });
      return null;
    }
  }

  /**
   * Start orchestration from large prompt with options
   */
  async startOrchestration(
    largePrompt: string,
    repository: string,
    ref?: string,
    model?: string,
    options?: any
  ): Promise<{ masterAgentId: string; taskPlan?: any; agentId?: string }> {
    return taskDispatcher.startOrchestration(largePrompt, repository, ref, model, options);
  }
}

export const orchestratorService = new OrchestratorService();


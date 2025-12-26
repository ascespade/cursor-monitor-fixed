/**
 * State Manager Service
 * 
 * Manages agent states in Supabase database
 * Each agent has a unique state record identified by agent_id
 */

import { createClient } from '@supabase/supabase-js';
import { logger } from '../utils/logger';

// Supabase client
const supabaseUrl = process.env['NEXT_PUBLIC_SUPABASE_URL']!;
const supabaseKey = process.env['SUPABASE_SERVICE_ROLE_KEY']!;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('Supabase configuration missing. Check NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
}

const supabase = createClient(supabaseUrl, supabaseKey);

export interface AgentState {
  id?: string;
  agent_id: string;
  task_description?: string;
  branch_name?: string;
  repository?: string;
  iterations: number;
  status: 'ACTIVE' | 'COMPLETED' | 'ERROR' | 'TIMEOUT' | 'MAX_ITERATIONS_REACHED';
  tasks_completed: string[];
  tasks_remaining: string[];
  last_analysis?: {
    action?: string;
    reasoning?: string;
    followupMessage?: string;
    confidence?: number;
    tasksCompleted?: string[];
    tasksRemaining?: string[];
    // Orchestration-specific fields
    mode?: string;
    agentId?: string;
    taskPlan?: unknown;
    currentTaskIndex?: number;
    options?: Record<string, unknown>;
    activeAgents?: number;
    parallelExecution?: boolean;
    currentAgentId?: string;
    [key: string]: unknown;
  };
  created_at?: string;
  updated_at?: string;
}

class StateManagerService {
  /**
   * Get agent state by agent_id
   */
  async getState(agentId: string): Promise<AgentState | null> {
    try {
      const { data, error } = await supabase
        .from('agent_orchestrator_states')
        .select('*')
        .eq('agent_id', agentId)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          // Not found
          return null;
        }
        throw error;
      }

      return this.mapToState(data);
    } catch (error) {
      logger.error('Failed to get agent state', { agentId, error });
      throw error;
    }
  }

  /**
   * Save or update agent state
   */
  async saveState(agentId: string, state: Partial<AgentState>): Promise<AgentState> {
    try {
      const existing = await this.getState(agentId);

      const stateData = {
        agent_id: agentId,
        task_description: state.task_description,
        branch_name: state.branch_name,
        repository: state.repository,
        iterations: state.iterations ?? 0,
        status: state.status ?? 'ACTIVE',
        tasks_completed: state.tasks_completed ?? [],
        tasks_remaining: state.tasks_remaining ?? [],
        last_analysis: state.last_analysis,
        updated_at: new Date().toISOString()
      };

      if (existing) {
        // Update existing
        const { data, error } = await supabase
          .from('agent_orchestrator_states')
          .update(stateData)
          .eq('agent_id', agentId)
          .select()
          .single();

        if (error) throw error;
        return this.mapToState(data);
      } else {
        // Create new
        const { data, error } = await supabase
          .from('agent_orchestrator_states')
          .insert({
            ...stateData,
            created_at: new Date().toISOString()
          })
          .select()
          .single();

        if (error) throw error;
        return this.mapToState(data);
      }
    } catch (error) {
      logger.error('Failed to save agent state', { agentId, error });
      throw error;
    }
  }

  /**
   * Increment iterations counter
   */
  async incrementIterations(agentId: string): Promise<number> {
    try {
      const state = await this.getState(agentId);
      const newIterations = (state?.iterations ?? 0) + 1;

      await this.saveState(agentId, {
        iterations: newIterations
      });

      return newIterations;
    } catch (error) {
      logger.error('Failed to increment iterations', { agentId, error });
      throw error;
    }
  }

  /**
   * Update agent status
   */
  async updateStatus(agentId: string, status: AgentState['status']): Promise<void> {
    try {
      await this.saveState(agentId, { status });
      logger.info('Agent status updated', { agentId, status });
    } catch (error) {
      logger.error('Failed to update agent status', { agentId, status, error });
      throw error;
    }
  }

  /**
   * Get all active agents
   */
  async getActiveAgents(): Promise<AgentState[]> {
    try {
      const { data, error } = await supabase
        .from('agent_orchestrator_states')
        .select('*')
        .eq('status', 'ACTIVE')
        .order('updated_at', { ascending: false });

      if (error) throw error;

      return (data || []).map((row) => this.mapToState(row));
    } catch (error) {
      logger.error('Failed to get active agents', { error });
      throw error;
    }
  }

  /**
   * Find master agent by sub-agent ID
   */
  async findMasterBySubAgent(subAgentId: string): Promise<AgentState | null> {
    try {
      // Query all active agents and check their last_analysis for currentAgentId
      const { data, error } = await supabase
        .from('agent_orchestrator_states')
        .select('*')
        .eq('status', 'ACTIVE');

      if (error) throw error;

      // Find master agent that has this subAgentId in last_analysis.currentAgentId
      for (const row of data || []) {
        const lastAnalysis = row.last_analysis as AgentState['last_analysis'];
        if (lastAnalysis && typeof lastAnalysis === 'object' && 'currentAgentId' in lastAnalysis && lastAnalysis.currentAgentId === subAgentId) {
          return this.mapToState(row);
        }
      }

      return null;
    } catch (error) {
      logger.error('Failed to find master agent', { subAgentId, error });
      return null;
    }
  }

  /**
   * Delete agent state (cleanup after completion)
   */
  async deleteState(agentId: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('agent_orchestrator_states')
        .delete()
        .eq('agent_id', agentId);

      if (error) throw error;
      logger.info('Agent state deleted', { agentId });
    } catch (error) {
      logger.error('Failed to delete agent state', { agentId, error });
      throw error;
    }
  }

  /**
   * Map database row to AgentState
   */
  private mapToState(row: Record<string, unknown>): AgentState {
    return {
      id: typeof row.id === 'string' ? row.id : undefined,
      agent_id: typeof row.agent_id === 'string' ? row.agent_id : '',
      task_description: typeof row.task_description === 'string' ? row.task_description : undefined,
      branch_name: typeof row.branch_name === 'string' ? row.branch_name : undefined,
      repository: typeof row.repository === 'string' ? row.repository : undefined,
      iterations: typeof row.iterations === 'number' ? row.iterations : 0,
      status: (typeof row.status === 'string' && ['ACTIVE', 'COMPLETED', 'ERROR', 'TIMEOUT', 'MAX_ITERATIONS_REACHED'].includes(row.status)) 
        ? row.status as AgentState['status'] 
        : 'ACTIVE',
      tasks_completed: Array.isArray(row.tasks_completed) ? row.tasks_completed.filter((t): t is string => typeof t === 'string') : [],
      tasks_remaining: Array.isArray(row.tasks_remaining) ? row.tasks_remaining.filter((t): t is string => typeof t === 'string') : [],
      last_analysis: row.last_analysis && typeof row.last_analysis === 'object' 
        ? row.last_analysis as AgentState['last_analysis'] 
        : undefined,
      created_at: typeof row.created_at === 'string' ? row.created_at : undefined,
      updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined
    };
  }
}

export const stateManager = new StateManagerService();


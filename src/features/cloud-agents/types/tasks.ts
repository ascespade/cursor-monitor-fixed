/**
 * Task Types
 * 
 * Shared types for orchestration tasks
 */

export interface TaskDetail {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  agentId?: string;
  branchName?: string;
  prUrl?: string;
  startedAt?: string;
  completedAt?: string;
  iterations?: number;
  dependencies: string[];
  priority: 'high' | 'medium' | 'low';
}

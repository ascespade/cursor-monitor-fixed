/**
 * Orchestration Queue Job Types
 * 
 * Type definitions for BullMQ job data in orchestrator queue
 */

import type { OrchestrationOptions } from './orchestration';

export interface OrchestrationJobData {
  prompt: string;
  repository: string;
  ref?: string;
  model?: string;
  apiKey?: string;
  options?: OrchestrationOptions;
  orchestrationId?: string;
  redisJobId?: string;
  timestamp?: string;
  activeAgents?: number;
}

export interface WebhookJobData {
  webhookData: {
    agentId: string;
    status: string;
    event?: string;
    summary?: string;
    source?: {
      repository?: string;
    };
    target?: {
      branchName?: string;
      prUrl?: string;
    };
    [key: string]: unknown;
  };
  agentId: string;
  status: string;
  event?: string;
  summary?: string;
  repository?: string;
  branchName?: string;
  prUrl?: string;
  timestamp?: string;
}


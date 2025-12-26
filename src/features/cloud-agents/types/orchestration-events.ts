/**
 * Orchestration Event Types
 * 
 * Type definitions for orchestration events from Supabase
 */

export interface OrchestrationEvent {
  id: string;
  orchestration_id: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  step_key: string;
  step_phase: 'start' | 'progress' | 'end' | null;
  message: string;
  payload: Record<string, unknown>;
  created_at: string;
}

export interface TimelineStepEvent {
  stepKey: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startEvent?: OrchestrationEvent;
  progressEvents: OrchestrationEvent[];
  endEvent?: OrchestrationEvent;
}

export interface TimelineStep {
  stepKey: string;
  stepName: string;
  status: 'pending' | 'running' | 'success' | 'error';
  startEvent?: OrchestrationEvent;
  progressEvents: OrchestrationEvent[];
  endEvent?: OrchestrationEvent;
  logs: OrchestrationEvent[];
}


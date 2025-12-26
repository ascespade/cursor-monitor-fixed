/**
 * Orchestration Types (copied from main app for orchestrator use)
 * 
 * Types for autonomous task orchestration system
 */

export type OrchestrationMode = 
  | 'SINGLE_AGENT'  // Send full prompt to one agent, monitor until complete
  | 'PIPELINE'      // Sequential tasks (one after another)
  | 'BATCH'         // Parallel tasks (multiple agents simultaneously)
  | 'AUTO';         // Agent decides best approach

export interface OrchestrationOptions {
  mode: OrchestrationMode;
  maxParallelAgents?: number;  // For BATCH mode
  maxIterations?: number;       // Maximum loop iterations
  enableAutoFix?: boolean;     // Auto-fix errors
  enableTesting?: boolean;      // Run tests after completion
  enableValidation?: boolean;  // Validate each task
  taskSize?: 'small' | 'medium' | 'large' | 'auto';  // Task granularity
  priority?: 'speed' | 'quality' | 'balanced';  // Optimization priority
}

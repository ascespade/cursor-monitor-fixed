/**
 * Orchestration Limits Configuration
 * 
 * Centralized limits for safety and cost control
 */

export const ORCHESTRATION_LIMITS = {
  // Daily limits
  MAX_ORCHESTRATIONS_PER_DAY: parseInt(
    process.env['MAX_ORCHESTRATIONS_PER_DAY'] || '10',
    10
  ),
  MAX_TOTAL_AGENTS_PER_DAY: parseInt(
    process.env['MAX_TOTAL_AGENTS_PER_DAY'] || '100',
    10
  ),

  // Per orchestration limits
  MAX_AGENTS_PER_ORCHESTRATION: parseInt(
    process.env['MAX_AGENTS_PER_ORCHESTRATION'] || '20',
    10
  ),
  MAX_ITERATIONS_PER_ORCHESTRATION: parseInt(
    process.env['MAX_ITERATIONS_PER_ORCHESTRATION'] || '50',
    10
  ),

  // Input limits
  MAX_PROMPT_LENGTH: parseInt(
    process.env['MAX_PROMPT_LENGTH'] || '50000',
    10
  ), // 50k characters
  MIN_PROMPT_LENGTH: parseInt(
    process.env['MIN_PROMPT_LENGTH'] || '100',
    10
  ), // 100 characters

  // Time limits
  MAX_EXECUTION_HOURS: parseInt(
    process.env['MAX_EXECUTION_HOURS'] || '24',
    10
  ), // 24 hours max

  // Parallel execution
  MAX_PARALLEL_AGENTS: parseInt(
    process.env['MAX_PARALLEL_AGENTS'] || '5',
    10
  ), // Max 5 agents in parallel
} as const;

export interface LimitCheckResult {
  allowed: boolean;
  reason?: string;
  current?: number;
  limit?: number;
}

/**
 * Check if orchestration is allowed based on limits
 */
export function checkOrchestrationLimits(
  promptLength: number,
  estimatedAgents: number,
  mode: string
): LimitCheckResult {
  // Check prompt length
  if (promptLength < ORCHESTRATION_LIMITS.MIN_PROMPT_LENGTH) {
    return {
      allowed: false,
      reason: `Prompt too short. Minimum ${ORCHESTRATION_LIMITS.MIN_PROMPT_LENGTH} characters required.`,
      current: promptLength,
      limit: ORCHESTRATION_LIMITS.MIN_PROMPT_LENGTH
    };
  }

  if (promptLength > ORCHESTRATION_LIMITS.MAX_PROMPT_LENGTH) {
    return {
      allowed: false,
      reason: `Prompt too long. Maximum ${ORCHESTRATION_LIMITS.MAX_PROMPT_LENGTH} characters allowed.`,
      current: promptLength,
      limit: ORCHESTRATION_LIMITS.MAX_PROMPT_LENGTH
    };
  }

  // Check agents per orchestration
  if (estimatedAgents > ORCHESTRATION_LIMITS.MAX_AGENTS_PER_ORCHESTRATION) {
    return {
      allowed: false,
      reason: `Estimated agents (${estimatedAgents}) exceeds limit of ${ORCHESTRATION_LIMITS.MAX_AGENTS_PER_ORCHESTRATION} per orchestration.`,
      current: estimatedAgents,
      limit: ORCHESTRATION_LIMITS.MAX_AGENTS_PER_ORCHESTRATION
    };
  }

  // Check parallel agents for BATCH mode
  if (mode === 'BATCH' && estimatedAgents > ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS) {
    return {
      allowed: false,
      reason: `BATCH mode requires max ${ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS} parallel agents.`,
      current: estimatedAgents,
      limit: ORCHESTRATION_LIMITS.MAX_PARALLEL_AGENTS
    };
  }

  return { allowed: true };
}
